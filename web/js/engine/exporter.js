// Экспорт в MP4 прямо в приложении: декодирование (WebCodecs) → кадр на WebGL → аппаратное кодирование.
// Работает одинаково на ПК и на телефоне.
import * as MB from 'mediabunny';
import { S, parts } from '../store.js';
import { createCompositor } from './compositor2d.js';
import { frameAt, layersAt, coverInfo, insertFrame } from './frame.js';
import { AudioMixer } from './audiomix.js';
import { coverAssetsReady } from './covers.js';
import { adsAt, adState, outTimeline } from './ads.js';

const AUDIO_CHUNK = 5; // секунд звука за раз

let aacReady = null;
export async function ensureAac() {
  if (!aacReady) {
    aacReady = (async () => {
      if (!(await MB.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 }))) {
        // Safari без нативного AAC — подключаем кодировщик на WebAssembly
        const { registerAacEncoder } = await import('mediabunny-aac');
        registerAacEncoder();
      }
    })();
  }
  return aacReady;
}

/**
 * Настройки кодировщика, которые это устройство точно потянет. Пробуем по убыванию качества:
 * размер проекта и его fps → 30 fps → меньше битрейт → 720p → программное кодирование.
 * Телефоны часто не умеют 1080×1920 при 60 fps — тогда экспорт сам переходит на то, что получается.
 */
const AVC = ['avc1.640034', 'avc1.64002A', 'avc1.640028', 'avc1.4D4028', 'avc1.42E028']; // High 5.2 … Baseline 4.0
export async function pickEncoder(W, H, fps) {
  if (typeof VideoEncoder === 'undefined') return { width: W, height: H, fps, bitrate: fps > 30 ? 12e6 : 8e6, codec: null, hw: undefined, note: '' };
  const small = W > H ? [Math.round((W * 720) / H / 2) * 2, 720] : [720, Math.round((H * 720) / W / 2) * 2];
  const sizes = [[W, H], small];
  const tries = [];
  for (const [w, h] of sizes) {
    for (const f of [...new Set([fps, Math.min(fps, 30)])]) {
      for (const br of [f > 30 ? 12e6 : 8e6, 5e6]) for (const hw of ['no-preference', 'prefer-software']) tries.push({ w, h, f, br, hw });
    }
  }
  for (const t of tries) {
    for (const codec of AVC) {
      try {
        const r = await VideoEncoder.isConfigSupported({ codec, width: t.w, height: t.h, framerate: t.f, bitrate: t.br, hardwareAcceleration: t.hw });
        if (r.supported) {
          const note = [t.w !== W ? `${t.w}×${t.h}` : null, t.f !== fps ? `${t.f} fps` : null, t.hw === 'prefer-software' ? 'программное кодирование' : null].filter(Boolean).join(', ');
          return { width: t.w, height: t.h, fps: t.f, bitrate: t.br, codec, hw: t.hw === 'no-preference' ? undefined : t.hw, note };
        }
      } catch { /* такой вариант не подходит — пробуем следующий */ }
    }
  }
  throw new Error('Это устройство не умеет кодировать видео H.264 ни в одном из вариантов (1080p/720p, 60/30 fps).');
}

export async function checkSupport() {
  const W = S.project?.canvas.w || 1080, H = S.project?.canvas.h || 1920;
  // раньше проверялся только полный размер проекта — на телефонах без 1080×1920 экспорт даже не начинался
  let video = false, note = '';
  try { const e = await pickEncoder(W, H, S.project?.canvas.fps || 30); video = true; note = e.note; } catch (e) { console.error('[export] кодировщик:', e.message); }
  // без WebGL2 экспорт всё равно идёт — простым 2D-движком (часть эффектов упрощается)
  if (!document.createElement('canvas').getContext('webgl2')) note = [note, 'простой режим без части эффектов (нет WebGL2)'].filter(Boolean).join(', ');
  return { video, note, webgl: true };
}

/**
 * segments: [{start, end, cover: bool, name}]
 * source(mid) → MB.Source исходного видео (оригинал, не превью-копия)
 * decoded(mid) → Promise<AudioBuffer|null> для музыки
 * target(seg, i) → { target: MB.Target, fastStart, done: (output) => Promise<any> }
 */
export async function exportVideo({ segments, source, decoded, target, onProgress, isCancelled, onCover, image }) {
  await ensureAac();
  await coverAssetsReady();
  const p = S.project;
  const { w: W, h: H } = p.canvas;
  const enc = await pickEncoder(W, H, p.canvas.fps);
  const fps = enc.fps;
  if (enc.note) {
    console.warn(`[exporter] устройство не тянет ${W}×${H} ${p.canvas.fps} fps — экспорт: ${enc.note}`);
    onProgress?.(0, `Это устройство кодирует так: ${enc.note}`, 0);
  }
  // WebGL, а если на устройстве он не работает — 2D-движок (на своём холсте)
  const comp = createCompositor(document.createElement('canvas'), W, H);
  const canvas = comp.canvas;
  comp.resize(enc.width, enc.height); // кадр проекта рисуется в размер, который потянет кодировщик
  const inputs = {};
  const getInput = (mid) => (inputs[mid] ||= new MB.Input({ source: source(mid), formats: MB.ALL_FORMATS }));
  const mediaList = (p.media || []).filter(Boolean);
  const mediaById = Object.fromEntries(mediaList.map((m) => [m.id, m]));
  const isImage = (mid) => mediaById[mid]?.kind === 'image';
  const bitmaps = {};
  const bitmapFor = (mid) => (bitmaps[mid] ||= (image ? image(mid) : S.backend.imageBitmap(p.id, mediaById[mid] || mid)));
  const audioSinks = {};
  const mixer = new AudioMixer({
    audioSink: (mid) => (audioSinks[mid] ||= isImage(mid) ? Promise.resolve(null)
      : getInput(mid).getPrimaryAudioTrack().then((t) => (t ? new MB.AudioBufferSink(t) : null))),
    decoded,
  });
  // время готового видео: вставки рекламы с паузой удлиняют каждый кусок
  const outs = segments.map((s) => outTimeline(s.start, s.end));
  const total = outs.reduce((s, x) => s + x.len, 0) || 1;
  let doneSec = 0;
  const results = [];
  const rotCanvas = document.createElement('canvas');
  let rotCanvas2 = null; // второй — если и реклама снята телефоном с поворотом
  let lastValidSample = {};

  try {
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      const tl = outs[si];
      const N = Math.max(1, Math.round(tl.len * fps));
      // план: какие клипы и с каких моментов исходника нужны для каждого кадра
      // (на вставке видео стоит — его кадр не декодируется заново, а повторяется)
      const plan = [];
      const times = new Map(); // clipId → [srcTime...]
      const clipsList = (p.clips || []).filter(Boolean);
      const clipById = Object.fromEntries(clipsList.map((c) => [c.id, c]));
      const need = (id, src) => { if (!times.has(id)) times.set(id, []); times.get(id).push(src); };
      const seen = new Set();
      for (let n = 0; n < N; n++) {
        const at = tl.at(n / fps);
        const L = layersAt(at.t);
        const ids = [], dec = [];
        for (const l of L.layers) {
          const fresh = !(at.ins || l.clip.freeze) || !seen.has(l.clip.id); // вставка и стоп-кадр — кадр не меняется
          ids.push(l.clip.id); dec.push(fresh);
          if (fresh) { need(l.clip.id, l.src); seen.add(l.clip.id); }
        }
        // реклама: каждая вставка — свой «клип» со своим декодером
        const ads = at.ins ? [adState(at.ins, at.age)] : adsAt(at.t);
        for (const ad of ads) {
          const id = 'ad:' + ad.id;
          clipById[id] ||= { id, media: ad.media };
          ids.push(id); dec.push(true);
          need(id, ad.src);
        }
        plan.push({ ids, dec, at });
      }
      // звук по порядку: куски видео и ролики вставок
      const chunks = [];
      for (const pc of tl.pieces) {
        if (pc.type === 'video') {
          for (let a = pc.from; a < pc.to - 1e-6; a += AUDIO_CHUNK) { const b = Math.min(pc.to, a + AUDIO_CHUNK); chunks.push({ len: b - a, make: () => mixer.mix(a, b) }); }
        } else {
          for (let a = 0; a < pc.len - 1e-6; a += AUDIO_CHUNK) { const b = Math.min(pc.len, a + AUDIO_CHUNK); chunks.push({ len: b - a, make: () => mixer.mixAd(pc.x, a, b) }); }
        }
      }
      // декодер: сначала видеокарта (быстро); если на каком-то файле она сбоит — этот клип дальше декодирует процессор
      const iters = new Map(), taken = new Map(), soft = new Set();
      const makeIter = async (id) => {
        const mid = clipById[id]?.media || id;
        const track = await getInput(mid).getPrimaryVideoTrack();
        if (!track) {
          console.warn(`[exporter] Нет видеотрека для клипа ${id}`);
          iters.set(id, { next: async () => ({ value: null, done: false }) });
          return;
        }
        const sink = new MB.VideoSampleSink(track, soft.has(id) ? { hardwareAcceleration: 'prefer-software' } : {});
        iters.set(id, sink.samplesAtTimestamps(times.get(id).slice(taken.get(id) || 0))[Symbol.asyncIterator]());
      };
      const iterFor = async (id) => {
        if (!iters.has(id)) await makeIter(id);
        return iters.get(id);
      };
      const nextSample = async (id) => {
        try {
          const r = await (await iterFor(id)).next();
          taken.set(id, (taken.get(id) || 0) + 1);
          return r?.value || null;
        } catch (err) {
          if (soft.has(id)) throw err;
          console.warn(`[exporter] видеокарта не декодировала клип ${id} — переключаюсь на процессор`, err);
          soft.add(id);
          try { await iters.get(id)?.return?.(); } catch { /* уже сломан */ }
          await makeIter(id);
          const r = await iters.get(id).next();
          taken.set(id, (taken.get(id) || 0) + 1);
          return r?.value || null;
        }
      };

      const tg = await target(seg, si);
      const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: tg.fastStart ?? 'in-memory' }), target: tg.target });
      const vsrc = new MB.CanvasSource(canvas, { codec: 'avc', bitrate: enc.bitrate, keyFrameInterval: 1,
        ...(enc.codec ? { fullCodecString: enc.codec } : {}), ...(enc.hw ? { hardwareAcceleration: enc.hw } : {}) });
      output.addVideoTrack(vsrc, { frameRate: fps });
      const asrc = new MB.AudioBufferSource({ codec: 'aac', bitrate: 192e3 });
      output.addAudioTrack(asrc);
      await output.start();

      let audioOut = 0, ci = 0;
      const feed = async (until) => {
        while (ci < chunks.length && audioOut < until) { await asrc.add(await chunks[ci].make()); audioOut += chunks[ci].len; ci++; }
      };
      for (let n = 0; n < N; n++) {
        if (isCancelled?.()) throw new Error('Отменено');
        const { at, ids, dec } = plan[n];
        const t = at.t;
        await feed(n / fps + 1);
        const spec = at.ins ? insertFrame(at.ins, at.age) : frameAt(t, { withCover: false });
        const cover = n === 0 && (seg.cover || seg.coverImage)
          ? coverInfo(parts().find((x) => Math.abs(x.start - seg.start) < 1e-3) || { i: 1, n: 1, label: '' }) : null;
        if (cover && seg.cover) spec.cover = cover;
        const samples = [];
        for (let k = 0; k < ids.length; k++) {
          const id = ids[k];
          const clip = clipById[id];
          const mid = clip?.media || id;
          if (isImage(mid)) { samples.push({ bitmap: await bitmapFor(mid) }); continue; }
          let sample = null;
          try {
            if (dec[k]) sample = await nextSample(id); // иначе — стоп-кадр: ниже повторится последний
          } catch (decodeErr) {
            console.warn(`[exporter] Ошибка декодирования кадра клипа ${id} на t=${t.toFixed(3)}s:`, decodeErr);
          }
          if (sample) {
            lastValidSample[id]?.close?.();
            lastValidSample[id] = sample.clone ? sample.clone() : sample;
          } else if (lastValidSample[id]) {
            sample = lastValidSample[id].clone ? lastValidSample[id].clone() : lastValidSample[id];
          }
          samples.push(sample || null);
        }
        let rotUsed = false;
        const frameOf = (s) => {
          if (!s) return { src: null };
          if (s.bitmap) return { src: s.bitmap, w: s.bitmap.width, h: s.bitmap.height };
          if (s.rotation) {
            // видео с телефона с поворотом в метаданных — поворачиваем сами
            const cv = rotUsed ? (rotCanvas2 ||= document.createElement('canvas')) : rotCanvas;
            rotUsed = true;
            cv.width = s.displayWidth; cv.height = s.displayHeight;
            s.drawWithFit(cv.getContext('2d'), { fit: 'fill' });
            return { src: cv, w: s.displayWidth, h: s.displayHeight };
          }
          return { src: s.toCanvasImageSource(), w: s.displayWidth, h: s.displayHeight };
        };
        spec.layers = spec.layers.map((l, i) => ({ clip: l.clip, ...frameOf(samples[i]) }));
        spec.ads = spec.ads.map((ad, i) => ({ ...ad, ...frameOf(samples[spec.layers.length + i]) }));
        if (cover && seg.coverImage) {
          // обложка картинкой (.jpg) — тот же кадр с оформлением; в само видео идёт, только если seg.cover
          comp.render({ ...spec, cover });
          await onCover?.(seg, si, await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92)));
        }
        comp.render(spec);
        samples.forEach((s) => s?.close?.());
        await vsrc.add(n / fps, 1 / fps);
        if (n % 10 === 0) onProgress?.((doneSec + n / fps) / total, `${seg.name || 'Видео'}: ${Math.round((n / N) * 100)}%`, si);
      }
      await feed(Infinity);
      for (const it of iters.values()) await it.return?.();
      for (const s of Object.values(lastValidSample)) s?.close?.();
      lastValidSample = {};
      await output.finalize();
      results.push(await tg.done(output));
      doneSec += tl.len;
      onProgress?.(doneSec / total, `Готово: ${si + 1} из ${segments.length}`, si);
    }
  } finally {
    comp.dispose();
    for (const inp of Object.values(inputs)) { try { inp.dispose?.(); } catch { /* уже закрыт */ } }
    for (const b of Object.values(bitmaps)) b?.then?.((x) => x?.close?.(), () => {});
    for (const s of Object.values(lastValidSample)) s?.close?.();
  }
  return results;
}
