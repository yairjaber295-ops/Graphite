// Отделение звука от видео: звук клипа (с учётом скорости) → файл m4a → отдельная дорожка «Звук видео».
// Считается прямо в приложении, поэтому работает и на компе, и на телефоне без компа.
import * as MB from 'mediabunny';
import { S, commit, clipsTL, uid, select } from './store.js';
import { clipDur, srcOffset, hasCurve } from './engine/speed.js';
import { readRange, wsola } from './engine/audiomix.js';
import { ensureAac } from './engine/exporter.js';
import { loadMedia } from './mediastate.js';

const CHUNK = 10; // секунд таймлайна за раз — длинный клип не занимает память целиком
const made = new Map(); // «клип как был» → уже готовый файл, чтобы после Ctrl+Z не считать заново

async function extractClipAudio(c, onProgress) {
  const p = S.project;
  const m = p.media.find((x) => x.id === c.media);
  await S.backend.prepareExport?.(p.id, [m]);
  const input = new MB.Input({ source: S.backend.exportSource(p.id, m), formats: MB.ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('В этом видео нет звука');
    await ensureAac();
    const sink = new MB.AudioBufferSink(track);
    const target = new MB.BufferTarget();
    const out = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const asrc = new MB.AudioBufferSource({ codec: 'aac', bitrate: 192e3 });
    out.addAudioTrack(asrc);
    await out.start();
    const s = c.speed || 1, D = clipDur(c);
    const nCh = Math.min(2, track.numberOfChannels || 2);
    let sr = track.sampleRate || 48000;
    for (let a = 0; a < D - 1e-6; a += CHUNK) {
      const b = Math.min(D, a + CHUNK);
      const srcA = c.in + srcOffset(c, a), srcB = c.in + srcOffset(c, b);
      const M = s === 1 ? 0 : 0.06; // запас для склейки растянутых кусков
      const r0 = Math.max(0, srcA - M);
      const got = await readRange(sink, r0, srcB + M);
      if (got.sr) sr = got.sr;
      const len = Math.round(b * sr) - Math.round(a * sr);
      const buf = new AudioBuffer({ length: Math.max(1, len), numberOfChannels: nCh, sampleRate: sr });
      if (got.chans) {
        const data = s === 1 ? got.chans : wsola(got.chans, s, sr);
        const off = Math.round(((srcA - r0) / s) * sr);
        for (let ch = 0; ch < nCh; ch++) buf.copyToChannel(data[Math.min(ch, data.length - 1)].subarray(off, off + len), ch);
      }
      await asrc.add(buf);
      onProgress?.(b / D);
    }
    await out.finalize();
    const base = (m.name || 'видео').replace(/\.[^.]+$/, '');
    return new File([target.buffer], `${base} — звук.m4a`, { type: 'audio/mp4' });
  } finally {
    input.dispose?.();
  }
}

/** Звук выделенных клипов → на аудиодорожку ровно под клипом, у самого клипа звук выключается. */
export async function detachAudio(ids, onProgress) {
  const clips = clipsTL().filter((c) => ids.includes(c.id));
  const curved = clips.filter(hasCurve);
  const todo = clips.filter((c) => !hasCurve(c) && (c.volume ?? 1) > 0);
  if (!todo.length) {
    throw new Error(curved.length ? 'У клипа с кривой скорости звук и так выключен — сначала верни обычную скорость' : 'У этого клипа звук уже выключен');
  }
  const res = [];
  for (let i = 0; i < todo.length; i++) {
    const c = todo[i];
    const key = `${c.media}|${c.in}|${c.out}|${c.speed || 1}`;
    let m = made.get(key);
    if (!m || !S.project.media.some((x) => x.id === m.id)) {
      const file = await extractClipAudio(c, (f) => onProgress?.((i + f) / todo.length));
      m = await S.backend.uploadMedia(S.project.id, file);
      made.set(key, m);
    }
    res.push({ c, m });
  }
  const newIds = [];
  commit((p) => {
    for (const { c, m } of res) {
      if (!p.media.some((x) => x.id === m.id)) p.media.push(m);
      const id = uid();
      newIds.push(id);
      p.audio.push({ id, media: m.id, kind: 'voice', start: c.start, in: 0, out: Math.min(m.duration || Infinity, clipDur(c)),
        volume: c.volume ?? 1, fadeIn: 0, fadeOut: 0 });
      p.clips.find((x) => x.id === c.id).volume = 0;
    }
  });
  for (const { m } of res) loadMedia(m.id);
  select('audio', newIds);
  return { count: res.length, skipped: curved.length };
}
