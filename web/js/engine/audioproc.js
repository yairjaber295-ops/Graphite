// Скорость, тон и эхо дорожек музыки/звуков («Sped up», «Slowed + reverb», «Nightcore»…).
// Дорожка обрабатывается целиком один раз (кэш) — превью и экспорт играют уже готовый звук.
// Время: на таймлайне дорожка идёт (out − in) / speed секунд; секунда исходника s ↔ таймлайн start + (s − in) / speed.
import { wsola } from './audiomix.js';
import { S } from '../store.js';

export const audioSpeed = (it) => Math.max(0.25, Math.min(4, it?.speed || 1));
/** Длительность дорожки на таймлайне. */
export const audioLen = (it) => (it.out - it.in) / audioSpeed(it);
/** Секунда исходника в момент t таймлайна. */
export const audioSrcAt = (it, t) => it.in + (t - it.start) * audioSpeed(it);
/** Момент таймлайна для секунды исходника (биты, волна). */
export const audioTlOf = (it, src) => it.start + (src - it.in) / audioSpeed(it);
export const hasAudioProc = (it) => audioSpeed(it) !== 1 || (it.pitch || 0) !== 0 || (it.reverb || 0) > 0 || !!it.remix;

/** Стили ремикса: бит, который приложение само подкладывает под найденные биты песни. */
export const REMIX_STYLES = { hardtek: 'Хардтек', hardstyle: 'Хардстайл', phonk: 'Фонк-ремикс', jersey: 'Джерси-клаб', techno: 'Техно', bass: 'Бас-буст ремикс' };

/** Готовые настройки — как популярные версии песен в TikTok. group: 'remix' — с подложенным битом. */
const R0 = { remix: null };
export const AUDIO_PRESETS = {
  normal: { label: 'Обычная', set: { speed: 1, keepPitch: true, pitch: 0, reverb: 0, ...R0 } },
  spedup: { label: 'Sped up', set: { speed: 1.25, keepPitch: false, pitch: 0, reverb: 0, ...R0 } },
  nightcore: { label: 'Nightcore', set: { speed: 1.3, keepPitch: false, pitch: 2, reverb: 0, ...R0 } },
  slowed: { label: 'Slowed', set: { speed: 0.85, keepPitch: false, pitch: 0, reverb: 0, ...R0 } },
  slowedreverb: { label: 'Slowed + reverb', set: { speed: 0.8, keepPitch: false, pitch: 0, reverb: 0.45, ...R0 } },
  faster: { label: 'Быстрее, тон тот же', set: { speed: 1.2, keepPitch: true, pitch: 0, reverb: 0, ...R0 } },
  hall: { label: 'Эхо зала', set: { speed: 1, keepPitch: true, pitch: 0, reverb: 0.5, ...R0 } },
  hardtek: { label: 'Хардтек', group: 'remix', set: { speed: 1.3, keepPitch: false, pitch: 0, reverb: 0, remix: 'hardtek', remixAmt: 0.85 } },
  hardstyle: { label: 'Хардстайл', group: 'remix', set: { speed: 1.2, keepPitch: false, pitch: 0, reverb: 0.15, remix: 'hardstyle', remixAmt: 0.85 } },
  phonkremix: { label: 'Фонк-ремикс', group: 'remix', set: { speed: 1.05, keepPitch: true, pitch: -1, reverb: 0, remix: 'phonk', remixAmt: 0.8 } },
  jersey: { label: 'Джерси-клаб', group: 'remix', set: { speed: 1.25, keepPitch: false, pitch: 0, reverb: 0, remix: 'jersey', remixAmt: 0.85 } },
  techno: { label: 'Техно', group: 'remix', set: { speed: 1.15, keepPitch: true, pitch: 0, reverb: 0.1, remix: 'techno', remixAmt: 0.8 } },
  bassremix: { label: 'Бас-буст ремикс', group: 'remix', set: { speed: 1, keepPitch: true, pitch: 0, reverb: 0, remix: 'bass', remixAmt: 0.85 } },
  slowedhardtek: { label: 'Slowed + хардтек', group: 'remix', set: { speed: 0.9, keepPitch: false, pitch: 0, reverb: 0.3, remix: 'hardtek', remixAmt: 0.75 } },
};

const cache = new Map();

/** Обработанный звук дорожки (или исходный, если обрабатывать нечего). buf — декодированный исходник. */
export function processedBuffer(it, buf) {
  if (!buf || !hasAudioProc(it)) return Promise.resolve(buf);
  const bt = S.project?.beats?.[it.media];
  const key = `${it.media}|${audioSpeed(it)}|${it.keepPitch !== false}|${it.pitch || 0}|${it.reverb || 0}|${it.remix || ''}|${it.remixAmt ?? ''}|${bt?.beats?.length || 0}`;
  if (!cache.has(key)) {
    cache.set(key, render(it, buf).catch((e) => { cache.delete(key); console.warn('обработка звука:', e); return buf; }));
    if (cache.size > 12) cache.delete(cache.keys().next().value); // не держим в памяти много версий песни
  }
  return cache.get(key);
}

async function render(it, buf) {
  const s = audioSpeed(it);
  // множитель тона: свой сдвиг (полутоны) и, если тон не сохраняем, — вместе со скоростью (как пластинка)
  const f = Math.pow(2, (it.pitch || 0) / 12) * (it.keepPitch === false ? s : 1);
  const sr = buf.sampleRate;
  let chans = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, c) => buf.getChannelData(c));
  // 1) растяжение времени без смены тона: длина × f / s
  const r1 = s / f;
  if (Math.abs(r1 - 1) > 1e-4) chans = wsola(chans, r1, sr);
  // 2) пересэмплирование: тон × f, длина / f → итог: длина / s, тон × f
  if (Math.abs(f - 1) > 1e-4) chans = chans.map((d) => resample(d, f));
  let out = new AudioBuffer({ length: Math.max(1, chans[0].length), numberOfChannels: chans.length, sampleRate: sr });
  chans.forEach((d, c) => out.copyToChannel(d, c));
  if ((it.reverb || 0) > 0) out = await addReverb(out, it.reverb);
  if (it.remix) {
    // бит под песню: биты исходника (с) → в обработанном звуке они на s / speed
    const bt = S.project?.beats?.[it.media];
    if (bt?.beats?.length > 3) out = await addRemix(out, it, bt.beats.map((b) => b / s), (bt.bpm || 120) * s, (bt.strong || []).map((b) => b / s));
  }
  return out;
}

// ---------------------------------------------------------------------------
//   Ремикс: синтезированные бочка, 808, хлопок, хэты, ковбелл — по сетке из битов песни
// ---------------------------------------------------------------------------
const sampleCache = new Map();

/** Один удар, отрисованный заранее (дальше в ремиксе он просто повторяется — это быстро). */
async function oneShot(name, sr) {
  const key = `${name}|${sr}`;
  if (sampleCache.has(key)) return sampleCache.get(key);
  const len = { kick: 0.35, hardkick: 0.4, longkick: 0.65, sub808: 0.9, clap: 0.25, hat: 0.06, openhat: 0.28, cowbell: 0.32, roll: 0.14 }[name];
  const ctx = new OfflineAudioContext(1, Math.round(sr * len), sr);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const shaper = (amount) => {
    const ws = ctx.createWaveShaper();
    const n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
    ws.curve = curve;
    return ws;
  };
  const noise = (dur) => {
    const b = ctx.createBuffer(1, Math.round(sr * dur), sr);
    const d = b.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < d.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; d[i] = seed / 2147483648 - 1; }
    const src = ctx.createBufferSource();
    src.buffer = b;
    return src;
  };
  const env = (g, peak, attack, decay, t0 = 0) => {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  };
  if (name === 'kick' || name === 'hardkick' || name === 'longkick' || name === 'sub808' || name === 'roll') {
    // бочка: синус с падающей частотой; жёсткая — с перегрузом; 808 — длинный низкий хвост
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const [f0, f1, sweep, dec, drive] = {
      kick: [150, 45, 0.11, 0.3, 2], hardkick: [190, 48, 0.09, 0.34, 12], longkick: [220, 55, 0.08, 0.6, 25],
      sub808: [75, 50, 0.25, 0.85, 3], roll: [90, 52, 0.04, 0.11, 6],
    }[name];
    o.frequency.setValueAtTime(f0, 0);
    o.frequency.exponentialRampToValueAtTime(f1, sweep);
    env(g, 1, 0.003, dec);
    const sh = shaper(drive);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = name === 'sub808' ? 900 : 5000;
    o.connect(g).connect(sh).connect(lp).connect(out);
    o.start(0); o.stop(len);
    if (name !== 'sub808' && name !== 'roll') { // щелчок атаки
      const n = noise(0.012), hp = ctx.createBiquadFilter(), gn = ctx.createGain();
      hp.type = 'highpass'; hp.frequency.value = 3000;
      env(gn, 0.5, 0.001, 0.01);
      n.connect(hp).connect(gn).connect(out);
      n.start(0);
    }
    out.gain.value = name === 'roll' ? 0.7 : 0.9;
  } else if (name === 'clap') {
    // хлопок: три коротких всплеска шума через полосовой фильтр
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.9;
    bp.connect(out);
    for (const [t, peak, dec] of [[0, 0.8, 0.012], [0.011, 0.7, 0.012], [0.022, 1, 0.2]]) {
      const n = noise(0.25), g = ctx.createGain();
      env(g, peak, 0.001, dec, t);
      n.connect(g).connect(bp);
      n.start(t);
    }
    out.gain.value = 0.9;
  } else if (name === 'hat' || name === 'openhat') {
    const n = noise(len), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 7500;
    env(g, 0.6, 0.001, name === 'hat' ? 0.045 : 0.25);
    n.connect(hp).connect(g).connect(out);
    n.start(0);
  } else if (name === 'cowbell') {
    // ковбелл как у 808: два квадрата 540 и 800 Гц через полосовой фильтр
    const bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 1.2;
    for (const f of [540, 800]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(bp); o.start(0); o.stop(len); }
    env(g, 0.7, 0.002, 0.28);
    bp.connect(g).connect(out);
  }
  const p = ctx.startRendering();
  sampleCache.set(key, p);
  return p;
}

/** Рисунок ударов по сетке 16-х: [{step (0…15 в такте из 4 долей), name, gain, rate}] для стиля. */
function pattern(style, fast) {
  const hits = [];
  const add = (steps, name, gain = 1, rate = 1) => steps.forEach((st) => hits.push({ st, name, gain, rate }));
  const every = (step, from = 0) => Array.from({ length: Math.ceil((16 - from) / step) }, (_, i) => from + i * step);
  switch (style) {
    case 'hardtek':
      add(fast ? every(2) : every(4), 'hardkick', 1);   // на медленных песнях — бочка вдвое чаще
      add(fast ? [] : every(4, 2), 'roll', 0.8);         // катящийся бас между бочками
      add(every(4, 2), 'openhat', 0.35);
      add([4, 12], 'clap', 0.45);
      break;
    case 'hardstyle':
      add(every(4), 'longkick', 1);
      add([4, 12], 'clap', 0.6);
      add(every(4, 2), 'hat', 0.4);
      break;
    case 'phonk': {
      add([0, 10], 'sub808', 1);
      add([4, 12], 'clap', 0.7);
      add(every(1), 'hat', 0.18);
      const mel = [1, 1, 1.19, 1, 0.89, 1, 1.33, 1.19]; // мелодия ковбелла
      every(2).forEach((st, i) => hits.push({ st, name: 'cowbell', gain: 0.45, rate: mel[i % 8] }));
      break;
    }
    case 'jersey':
      add([0, 3, 6, 8, 11, 14], 'kick', 1);
      add([4, 12], 'clap', 0.6);
      add(every(2), 'hat', 0.25);
      break;
    case 'techno':
      add(every(4), 'kick', 1);
      add(every(4, 2), 'openhat', 0.4);
      add([4, 12], 'clap', 0.5);
      add(every(4, 1), 'hat', 0.15);
      add(every(4, 3), 'hat', 0.15);
      break;
    case 'bass':
      add(every(4), 'kick', 0.9);
      add([0, 8], 'sub808', 1);
      add([4, 12], 'clap', 0.4);
      break;
  }
  return hits;
}

/** Бит поверх музыки + «качание» музыки под бочку (sidechain), как в хардтеке и техно. */
async function addRemix(buf, it, beats, tempo, strong = []) {
  const sr = buf.sampleRate, style = it.remix, amt = it.remixAmt ?? 0.85;
  const fast = style === 'hardtek' && tempo < 140;
  const hits = pattern(style, fast);
  const names = [...new Set(hits.map((h) => h.name))];
  const samples = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await oneShot(n, sr)])));
  const ctx = new OfflineAudioContext(2, buf.length, sr);
  // общий выход через лимитер: песня и так громкая, с битом сверху иначе будет перегруз (хрип)
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -6; master.knee.value = 3; master.ratio.value = 20; master.attack.value = 0.002; master.release.value = 0.15;
  const trim = ctx.createGain();
  trim.gain.value = 0.92;
  master.connect(trim).connect(ctx.destination);
  const music = ctx.createBufferSource();
  music.buffer = buf;
  const duck = ctx.createGain();
  const musicLevel = ctx.createGain();
  musicLevel.gain.value = 0.72; // музыку чуть тише — под битом, как в ремиксах
  music.connect(duck).connect(musicLevel).connect(master);
  const drums = ctx.createGain();
  drums.gain.value = amt;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.12;
  drums.connect(comp).connect(master);
  const period = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 60 / tempo;
  const depth = { hardtek: 0.45, hardstyle: 0.4, techno: 0.35, jersey: 0.25, phonk: 0.2, bass: 0.3 }[style] ?? 0.3;
  // начало такта — там, где чаще всего сильные доли (иначе хлопки «2 и 4» съедут)
  const strongSet = new Set(strong.map((x) => x.toFixed(2)));
  let phase = 0, best = -1;
  for (let k = 0; k < 4; k++) {
    let n = 0;
    for (let i = k; i < beats.length; i += 4) if (strongSet.has(beats[i].toFixed(2))) n++;
    if (n > best) { best = n; phase = k; }
  }
  // такты по 4 доли; внутри доли — 4 шестнадцатых
  for (let i = 0; i + 1 <= beats.length; i++) {
    const b0 = beats[i], d = (beats[i + 1] ?? b0 + period) - b0;
    if (d <= 0 || d > period * 2.5) continue; // в пропусках детектора не стучим
    const beatInBar = (((i - phase) % 4) + 4) % 4;
    for (const h of hits) {
      if (Math.floor(h.st / 4) !== beatInBar) continue;
      const t = b0 + ((h.st % 4) / 4) * d;
      if (t < 0 || t >= buf.length / sr) continue;
      const src = ctx.createBufferSource();
      src.buffer = samples[h.name];
      src.playbackRate.value = h.rate;
      const g = ctx.createGain();
      g.gain.value = h.gain;
      src.connect(g).connect(drums);
      src.start(t);
      if (/kick/.test(h.name) && depth > 0) {
        duck.gain.setTargetAtTime(1 - depth * amt, t, 0.004);
        duck.gain.setTargetAtTime(1, t + 0.04, Math.min(0.09, d * 0.3));
      }
    }
  }
  music.start();
  return ctx.startRendering();
}

function resample(d, f) {
  const n = Math.max(1, Math.floor(d.length / f));
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * f, k = Math.floor(x), t = x - k;
    o[i] = (d[k] || 0) * (1 - t) + (d[k + 1] || 0) * t;
  }
  return o;
}

/** Эхо (реверберация): свёртка с затухающим шумом; одинаковый «зал» в превью и экспорте. */
async function addReverb(buf, amt) {
  const sr = buf.sampleRate, tail = Math.round(sr * 2.6);
  const ctx = new OfflineAudioContext(2, buf.length, sr);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const ir = ctx.createBuffer(2, tail, sr);
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < tail; i++) d[i] = rnd() * Math.pow(1 - i / tail, 3.2);
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const dry = ctx.createGain(), wet = ctx.createGain();
  dry.gain.value = 1 - amt * 0.35;
  wet.gain.value = amt * 0.5;
  src.connect(dry).connect(ctx.destination);
  src.connect(conv).connect(wet).connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}
