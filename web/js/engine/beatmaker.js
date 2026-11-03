// Битмейкер: каналы ударных (свои настройки и свои сэмплы) + мелодические дорожки с пианороллом
// (ноты любой длины, аккорды, инструменты) → готовый звук (WAV) для таймлайна.
// Встроенные звуки — синтез (audioproc.oneShot), без чужих сэмплов и прав.
import { oneShot } from './audioproc.js';

export const SR = 48000;
export const STEPS = 16;   // шагов в такте (16-е)
export const MAX_BARS = 8;

/** Встроенные звуки для каналов. */
export const SOUNDS = {
  kick: 'Бочка', hardkick: 'Жёсткая бочка', longkick: 'Бочка хардстайл', roll: 'Бас-удар', snare: 'Снейр', clap: 'Хлопок', snap: 'Снэп',
  hat: 'Хэт', openhat: 'Открытый хэт', shaker: 'Шейкер', crash: 'Тарелка', rim: 'Римшот', tom: 'Том', perc: 'Перкуссия', cowbell: 'Ковбелл',
};
const KICKS = new Set(['kick', 'hardkick', 'longkick']);

/** Мелодические инструменты. */
export const INSTRUMENTS = { '808': '808-бас', lead: 'Лид', pluck: 'Плак', pad: 'Пэд', keys: 'Электропиано', bell: 'Колокол' };
const INST_OCTAVE = { '808': 1, lead: 4, pluck: 4, pad: 3, keys: 3, bell: 5 };   // с какой октавы начинается пианоролл

export const SCALES = {
  minor: { label: 'Минор', steps: [0, 2, 3, 5, 7, 8, 10] },
  major: { label: 'Мажор', steps: [0, 2, 4, 5, 7, 9, 11] },
  harmonic: { label: 'Гарм. минор (фонк)', steps: [0, 2, 3, 5, 7, 8, 11] },
  dorian: { label: 'Дорийский', steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { label: 'Фригийский (дрилл)', steps: [0, 1, 3, 5, 7, 8, 10] },
  penta: { label: 'Пентатоника', steps: [0, 3, 5, 7, 10] },
  chromatic: { label: 'Все ноты', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n) => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
export const inScale = (p, n) => (SCALES[p.scale]?.steps || SCALES.minor.steps).includes((((n - (p.key || 0)) % 12) + 12) % 12);
/** Нижняя нота пианоролла инструмента (тоника его октавы). */
export const rollBase = (p, inst) => 12 * (INST_OCTAVE[inst] + 1) + (p.key || 0);
/** Ступень лада → нота (ступени дальше лада — следующие октавы). */
function degree(p, inst, d) {
  const sc = SCALES[p.scale]?.steps || SCALES.minor.steps;
  const oct = Math.floor(d / sc.length), i = ((d % sc.length) + sc.length) % sc.length;
  return rollBase(p, inst) + sc[i] + 12 * oct;
}

const uid = () => Math.random().toString(36).slice(2, 10);
export const channel = (sound, extra = {}) => ({ id: uid(), name: SOUNDS[sound] || 'Сэмпл', sound, sample: null, steps: [], vol: 0.9, pan: 0, pitch: 0, decay: 1, mute: false, solo: false, ...extra });
export const synth = (inst, extra = {}) => ({ id: uid(), name: INSTRUMENTS[inst], inst, notes: [], vol: inst === 'pad' ? 0.5 : 0.75, pan: 0, mute: false, solo: false, ...extra });

const DEFAULT_KIT = ['kick', 'snare', 'clap', 'hat', 'openhat', 'rim', 'perc', 'crash'];

export function emptyPattern(bpm = 140) {
  return { v: 2, bpm, bars: 2, swing: 0, key: 9, scale: 'minor', sidechain: 0,
    channels: DEFAULT_KIT.map((s) => channel(s, { steps: Array(32).fill(0) })), synths: [synth('808')] };
}

/** Старый формат (до студии): drums/bass/lead → каналы и дорожки. */
export function migrate(p) {
  if (!p || p.v === 2) return p;
  const n = (p.bars || 2) * STEPS;
  const q = { v: 2, bpm: p.bpm || 140, bars: p.bars || 2, swing: p.swing || 0, key: p.key ?? 9, scale: p.scale || 'minor', sidechain: 0, channels: [], synths: [] };
  for (const [k, arr] of Object.entries(p.drums || {})) {
    if (!SOUNDS[k]) continue;
    q.channels.push(channel(k, { steps: Array.from({ length: n }, (_, i) => (arr[i] ? 1 : 0)), vol: p.vol?.drums ?? 0.9 }));
  }
  for (const [row, inst] of [['bass', '808'], ['lead', 'lead']]) {
    const arr = p[row] || [];
    const notes = [];
    for (let i = 0; i < n; i++) {
      if (arr[i] == null) continue;
      let j = i + 1;
      while (j < n && arr[j] == null) j++;
      notes.push({ s: i, n: arr[i], l: j - i, v: 1 });
    }
    if (notes.length || inst === '808') q.synths.push(synth(inst, { notes, vol: p.vol?.[row] ?? (inst === '808' ? 0.9 : 0.55) }));
  }
  return q;
}

// --- готовые биты: ударные строками (x — удар, o — тихий «призрак»), мелодия — [шаг, ступень, длина]
const D = (s, bars) => Array.from({ length: bars }, () => [...s].map((c) => (c === 'x' ? 1 : c === 'o' ? 0.5 : 0))).flat();
export const BEAT_PRESETS = {
  trap: { label: 'Трэп', bpm: 140, scale: 'minor', swing: 0, sidechain: 0.3,
    drums: { kick: 'x......x..x.....', snare: '........x.......', hat: 'x.x.x.x.x.x.xxxx', openhat: '..............x.' },
    synths: { '808': [[0, 0, 7], [7, 0, 3], [10, 3, 6]], bell: [[0, 7, 2], [3, 9, 2], [6, 11, 2], [8, 9, 4], [12, 7, 4]] } },
  drill: { label: 'Дрилл', bpm: 142, scale: 'phrygian', swing: 0, sidechain: 0.2,
    drums: { kick: 'x.........x.....', snare: '......x.....x...', hat: 'x..x..x.x..x.x..', perc: '...x.......x....' },
    synths: { '808': [[0, 0, 3], [3, 1, 3], [10, 0, 6]], pluck: [[0, 7, 2], [2, 8, 2], [4, 7, 2], [8, 5, 2], [12, 4, 4]] } },
  phonk: { label: 'Фонк', bpm: 130, scale: 'harmonic', swing: 0, sidechain: 0.2,
    drums: { kick: 'x.....x...x.....', clap: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', cowbell: 'x..x..x...x.x...' },
    synths: { '808': [[0, 0, 6], [6, 0, 4], [10, 4, 6]] } },
  hardtek: { label: 'Хардтек', bpm: 165, scale: 'minor', swing: 0, sidechain: 0.5,
    drums: { hardkick: 'x...x...x...x...', openhat: '..x...x...x...x.', clap: '....x.......x...' },
    synths: { '808': [[2, 0, 2], [6, 0, 2], [10, 0, 2], [14, 0, 2]], lead: [[0, 7, 2], [4, 7, 2], [8, 9, 2], [12, 6, 4]] } },
  house: { label: 'Хаус', bpm: 124, scale: 'minor', swing: 0.1, sidechain: 0.55,
    drums: { kick: 'x...x...x...x...', clap: '....x.......x...', hat: '..x...x...x...x.', shaker: 'xoxoxoxoxoxoxoxo' },
    synths: { '808': [[2, 0, 2], [6, 0, 2], [10, 2, 2], [14, 0, 2]], pad: [[0, 0, 16], [0, 2, 16], [0, 4, 16]] } },
  lofi: { label: 'Лоу-фай', bpm: 82, scale: 'dorian', swing: 0.35, sidechain: 0.15,
    drums: { kick: 'x......x..x.....', snare: '....x.......x...', hat: 'x.x.xox.x.x.xox.', rim: '..........x.....' },
    synths: { keys: [[0, 0, 8], [0, 2, 8], [0, 4, 8], [0, 6, 8], [8, 3, 8], [8, 5, 8], [8, 7, 8]], '808': [[0, 0, 8], [8, 3, 8]] } },
  boombap: { label: 'Бум-бэп', bpm: 90, scale: 'minor', swing: 0.25, sidechain: 0,
    drums: { kick: 'x......x.x......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', rim: '..........x.....' },
    synths: { '808': [[0, 0, 7], [7, 0, 2], [9, 4, 7]] } },
  jersey: { label: 'Джерси-клаб', bpm: 140, scale: 'minor', swing: 0, sidechain: 0.3,
    drums: { kick: 'x..x..x...x.x..x', clap: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    synths: { '808': [[0, 0, 3], [3, 0, 3], [6, 0, 4], [10, 3, 3], [13, 3, 3]] } },
  dnb: { label: 'Драм-н-бейс', bpm: 174, scale: 'minor', swing: 0, sidechain: 0.4,
    drums: { kick: 'x.........x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', crash: 'x...............' },
    synths: { '808': [[0, 0, 10], [10, 0, 2], [14, 4, 2]], pad: [[0, 0, 16], [0, 2, 16], [0, 4, 16]] } },
};

/** Пресет → паттерн (сохраняя тональность и число тактов, если они уже выбраны). */
export function presetPattern(key, base) {
  const pr = BEAT_PRESETS[key];
  const bars = base?.bars || 2;
  const p = { v: 2, bpm: pr.bpm, bars, swing: pr.swing, key: base?.key ?? 9, scale: pr.scale, sidechain: pr.sidechain, channels: [], synths: [] };
  const kit = [...new Set([...Object.keys(pr.drums), ...DEFAULT_KIT])];
  p.channels = kit.map((s) => channel(s, { steps: D(pr.drums[s] || '................', bars) }));
  for (const [inst, notes] of Object.entries(pr.synths)) {
    const out = [];
    for (let b = 0; b < bars; b++) for (const [s, d, l] of notes) out.push({ s: s + b * STEPS, n: degree(p, inst, d), l, v: 1 });
    p.synths.push(synth(inst, { notes: out }));
  }
  if (!p.synths.some((x) => x.inst === '808')) p.synths.unshift(synth('808'));
  return p;
}

/** Сменить число тактов: рисунок повторяется / обрезается. */
export function resizePattern(p, bars) {
  const n = bars * STEPS, old = p.bars * STEPS;
  const ch = p.channels.map((c) => ({ ...c, steps: Array.from({ length: n }, (_, i) => c.steps[i % old] || 0) }));
  const sy = p.synths.map((s) => {
    const notes = [];
    for (let k = 0; k * old < n; k++) for (const nt of s.notes) if (nt.s + k * old < n) notes.push({ ...nt, s: nt.s + k * old, l: Math.min(nt.l, n - nt.s - k * old) });
    return { ...s, notes };
  });
  return { ...p, bars, channels: ch, synths: sy };
}

/** Сменить тональность: ноты сдвигаются на разницу (лад меняется отдельно — ноты не трогаем). */
export function transpose(p, key) {
  const d = key - (p.key || 0);
  return { ...p, key, synths: p.synths.map((s) => ({ ...s, notes: s.notes.map((n) => ({ ...n, n: n.n + d })) })) };
}

export const stepDur = (p) => 60 / p.bpm / 4;
export const cycleDur = (p) => p.bars * STEPS * stepDur(p);
const stepTime = (p, i) => i * stepDur(p) + (i % 2 ? (p.swing || 0) * stepDur(p) * 0.5 : 0);

const panner = (ctx, pan) => {
  const n = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  if (n.pan) n.pan.value = Math.max(-1, Math.min(1, pan || 0));
  return n;
};

/** Сыграть удар/сэмпл (и в предпрослушке, и в рендере). */
export function playHit(ctx, dest, buf, t, { vel = 1, pitch = 0, decay = 1 } = {}) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const rate = Math.pow(2, pitch / 12);
  s.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = vel;
  s.connect(g).connect(dest);
  s.start(t);
  if (decay < 0.999) {
    const end = t + (buf.duration / rate) * Math.max(0.05, decay);
    g.gain.setValueAtTime(vel, Math.max(t, end - 0.03));
    g.gain.linearRampToValueAtTime(0, end);
    s.stop(end + 0.01);
  }
  return s;
}

/** Нота инструмента. sub808 — отрисованный удар 808 (для инструмента «808»). */
export function playNote(ctx, dest, inst, t, len, note, vel = 1, sub808 = null) {
  const f = 440 * Math.pow(2, (note - 69) / 12);
  const osc = (type, freq, det = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det; return o; };
  const amp = ctx.createGain();
  amp.connect(dest);
  const A = amp.gain;
  if (inst === '808') {
    if (!sub808) return;
    const s = ctx.createBufferSource();
    s.buffer = sub808;
    s.playbackRate.value = Math.pow(2, (note - 31) / 12);   // удар 808 ≈ G1
    A.value = vel;
    s.connect(amp);
    s.start(t);
    A.setValueAtTime(vel, t + Math.max(0.02, len - 0.02));
    A.linearRampToValueAtTime(0, t + len + 0.03);
    s.stop(t + len + 0.05);
    return;
  }
  const stopAt = (o, end) => { o.start(t); o.stop(end); };
  if (inst === 'lead' || inst === 'pluck') {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = inst === 'pluck' ? 6 : 4;
    const L = inst === 'pluck' ? Math.min(len, 0.35) : len;
    lp.frequency.setValueAtTime(f * (inst === 'pluck' ? 10 : 6), t);
    lp.frequency.exponentialRampToValueAtTime(f * (inst === 'pluck' ? 1.2 : 2), t + (inst === 'pluck' ? 0.16 : Math.min(0.25, len)));
    A.setValueAtTime(0.0001, t);
    A.exponentialRampToValueAtTime(0.5 * vel, t + 0.005);
    if (inst === 'pluck') A.exponentialRampToValueAtTime(0.0001, t + L + 0.1);
    else { A.exponentialRampToValueAtTime(0.32 * vel, t + 0.12); A.setValueAtTime(0.32 * vel, t + Math.max(0.12, len - 0.03)); A.exponentialRampToValueAtTime(0.0001, t + len + 0.09); }
    for (const [type, det] of inst === 'pluck' ? [['square', 0], ['sawtooth', 5]] : [['sawtooth', -7], ['sawtooth', 7]]) { const o = osc(type, f, det); o.connect(lp); stopAt(o, t + L + 0.15); }
    lp.connect(amp);
  } else if (inst === 'pad') {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.min(2400, f * 5); lp.Q.value = 0.8;
    A.setValueAtTime(0.0001, t);
    A.linearRampToValueAtTime(0.16 * vel, t + 0.18);
    A.setValueAtTime(0.16 * vel, t + Math.max(0.18, len));
    A.linearRampToValueAtTime(0.0001, t + len + 0.45);
    for (const det of [-11, 0, 11]) { const o = osc('sawtooth', f, det); o.connect(lp); stopAt(o, t + len + 0.5); }
    lp.connect(amp);
  } else if (inst === 'keys' || inst === 'bell') {
    // FM: модулятор с затухающим индексом — электропиано (1:1) и колокол (3.5:1)
    const ratio = inst === 'bell' ? 3.5 : 1, dec = inst === 'bell' ? 1.8 : 0.9;
    const car = osc('sine', f), mod = osc('sine', f * ratio), idx = ctx.createGain();
    idx.gain.setValueAtTime(f * (inst === 'bell' ? 3 : 2.2), t);
    idx.gain.exponentialRampToValueAtTime(f * 0.15, t + dec);
    mod.connect(idx).connect(car.frequency);
    const L = inst === 'bell' ? Math.max(len, 1.6) : len;
    A.setValueAtTime(0.0001, t);
    A.exponentialRampToValueAtTime(0.38 * vel, t + 0.004);
    A.exponentialRampToValueAtTime(0.18 * vel, t + Math.min(dec, L));
    A.setValueAtTime(0.18 * vel, t + Math.max(Math.min(dec, L), L - 0.02));
    A.exponentialRampToValueAtTime(0.0001, t + L + 0.25);
    car.connect(amp);
    stopAt(car, t + L + 0.3); stopAt(mod, t + L + 0.3);
  }
}

/** Отрисованные звуки для паттерна: встроенные (синтез) и свои сэмплы (samples: mediaId → AudioBuffer). */
async function buffersFor(p, samples = {}) {
  const out = {};
  for (const c of p.channels) {
    const k = c.sample ? `s:${c.sample}` : c.sound;
    if (out[k]) continue;
    out[k] = c.sample ? samples[c.sample] || null : await oneShot(c.sound, SR);
  }
  out.sub808 = p.synths.some((s) => s.inst === '808' && s.notes.length) ? await oneShot('sub808', SR) : null;
  return out;
}
export const bufferKey = (c) => (c.sample ? `s:${c.sample}` : c.sound);

/** Отрисовать repeats циклов паттерна в AudioBuffer (стерео, 48 кГц). samples — свои сэмплы каналов. */
export async function renderPattern(p, repeats = 1, samples = {}) {
  p = migrate(p);
  const n = p.bars * STEPS, cyc = cycleDur(p);
  const total = cyc * repeats + 1.8;   // хвост последних нот
  const ctx = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
  const bufs = await buffersFor(p, samples);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const anySoloC = p.channels.some((c) => c.solo) || p.synths.some((s) => s.solo);
  const on = (x) => !x.mute && (!anySoloC || x.solo);
  // мелодия «качается» под бочку (сайдчейн)
  const synthBus = ctx.createGain();
  synthBus.connect(master);
  const sc = Math.max(0, Math.min(0.9, p.sidechain || 0));
  if (sc > 0) {
    const kicks = [];
    // от бочки, даже если её сейчас не слышно (mute/solo) — как сайдчейн-вход в студийных программах
    for (const c of p.channels) if (KICKS.has(c.sound) || /kick|бочк/i.test(c.name)) c.steps.forEach((v, i) => { if (v) kicks.push(i); });
    const times = [];
    for (let r = 0; r < repeats; r++) for (const i of new Set(kicks)) times.push(r * cyc + stepTime(p, i));
    times.sort((a, b) => a - b);
    synthBus.gain.setValueAtTime(1, 0);
    for (const t of times) {
      synthBus.gain.setValueAtTime(1, Math.max(0, t - 0.004));
      synthBus.gain.linearRampToValueAtTime(1 - sc, t + 0.004);
      synthBus.gain.linearRampToValueAtTime(1, t + Math.min(0.22, stepDur(p) * 3));
    }
  }
  for (const c of p.channels) {
    const buf = bufs[bufferKey(c)];
    if (!on(c) || !buf) continue;
    const g = ctx.createGain();
    g.gain.value = c.vol ?? 0.9;
    g.connect(panner(ctx, c.pan)).connect(master);
    for (let r = 0; r < repeats; r++) {
      for (let i = 0; i < n; i++) if (c.steps[i]) playHit(ctx, g, buf, r * cyc + stepTime(p, i), { vel: c.steps[i], pitch: c.pitch || 0, decay: c.decay ?? 1 });
    }
  }
  for (const s of p.synths) {
    if (!on(s) || !s.notes.length) continue;
    const g = ctx.createGain();
    g.gain.value = s.vol ?? 0.75;
    g.connect(panner(ctx, s.pan)).connect(synthBus);
    for (let r = 0; r < repeats; r++) {
      for (const nt of s.notes) {
        const t = r * cyc + stepTime(p, nt.s);
        playNote(ctx, g, s.inst, t, nt.l * stepDur(p), nt.n, nt.v ?? 1, bufs.sub808);
      }
    }
  }
  // всё вместе легко выходит за ноль — бит целиком, поэтому нормализуем по пику (динамика та же)
  const out = await ctx.startRendering();
  let pk = 0;
  for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > pk) pk = v; } }
  if (pk > 0.95) {
    const k = 0.95 / pk;
    for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  }
  return out;
}

/** AudioBuffer → WAV (16 бит) для загрузки в проект. */
export function toWav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, bytes = 44 + n * ch * 2;
  const ab = new ArrayBuffer(bytes), v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([ab], { type: 'audio/wav' });
}

/** Звуки для предпрослушки в редакторе (тот же синтез). */
export const soundBuffer = (sound) => oneShot(sound, SR);
