// Экспорт только звука: MP3 / M4A (AAC) / WAV. Сведение — тем же AudioMixer, что и у видео,
// поэтому в файл попадает всё: скорость и тон, slowed/reverb, ремиксы, бас, громкость, появление/затухание.
import * as MB from 'mediabunny';
import { S } from '../store.js';
import { AudioMixer, SAMPLE_RATE } from './audiomix.js';
import { ensureAac } from './exporter.js';

export const AUDIO_FORMATS = {
  mp3: { label: 'MP3', ext: 'mp3', codec: 'mp3', mime: 'audio/mpeg' },
  m4a: { label: 'M4A', ext: 'm4a', codec: 'aac', mime: 'audio/mp4' },
  wav: { label: 'WAV', ext: 'wav', codec: 'pcm-s16', mime: 'audio/wav' },
};

let mp3Ready = null;
async function ensureMp3() {
  mp3Ready ||= (async () => {
    // браузеры MP3 не кодируют — подключаем LAME на WebAssembly (@mediabunny/mp3-encoder)
    if (!(await MB.canEncodeAudio('mp3', { numberOfChannels: 2, sampleRate: SAMPLE_RATE }))) {
      const { registerMp3Encoder } = await import('mediabunny-mp3');
      registerMp3Encoder();
    }
  })();
  return mp3Ready;
}

const CHUNK = 10;   // секунд звука за раз — длинный трек не держим в памяти целиком

/**
 * format — mp3 | m4a | wav; start/end — отрезок таймлайна (с).
 * source(mid) → MB.Source; decoded(mid) → AudioBuffer музыки; target → { target, fastStart, done(output) }.
 */
export async function exportAudio({ format = 'mp3', bitrate = 320_000, start = 0, end, source, decoded, target, onProgress, isCancelled, only = null }) {
  const f = AUDIO_FORMATS[format];
  if (format === 'mp3') await ensureMp3();
  else if (format === 'm4a') {
    await ensureAac();
    // встроенный AAC обычно не выше 256 кбит/с — берём самый высокий, что умеет устройство
    for (const br of [bitrate, 256_000, 192_000, 128_000].filter((x) => x <= bitrate)) {
      bitrate = br;
      if (await MB.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: SAMPLE_RATE, bitrate: br })) break;
    }
  }
  const inputs = {}, sinks = {};
  const kindOf = (mid) => S.project.media.find((m) => m.id === mid)?.kind;
  const mixer = new AudioMixer({
    audioSink: (mid) => (sinks[mid] ||= kindOf(mid) === 'image' ? Promise.resolve(null)
      : (inputs[mid] ||= new MB.Input({ source: source(mid), formats: MB.ALL_FORMATS })).getPrimaryAudioTrack()
        .then((t) => (t ? new MB.AudioBufferSink(t) : null))),
    decoded,
    only,   // стем: только эти дорожки
  });
  const out = await target;
  const fmt = format === 'mp3' ? new MB.Mp3OutputFormat() : format === 'wav' ? new MB.WavOutputFormat()
    : new MB.Mp4OutputFormat({ fastStart: out.fastStart ?? false });
  const output = new MB.Output({ format: fmt, target: out.target });
  const src = new MB.AudioBufferSource(format === 'wav' ? { codec: f.codec } : { codec: f.codec, bitrate });
  output.addAudioTrack(src);
  await output.start();
  try {
    for (let a = start; a < end - 1e-6; a += CHUNK) {
      if (isCancelled?.()) throw new Error('Экспорт остановлен');
      const b = Math.min(end, a + CHUNK);
      await src.add(await mixer.mix(a, b));
      onProgress?.((b - start) / (end - start), 'Свожу и кодирую звук');
    }
    src.close();
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    for (const i of Object.values(inputs)) i.dispose?.();
  }
  return out.done(output);
}
