// 🧪 Автоэдит (тест): твои нарезанные моменты + музыка → целый эдит в бит.
// Клипы на таймлайне считаются «моментами»; из них берутся самые громкие куски и ставятся между битами,
// на сильные доли — переходы и вспышки, на каждый бит — пульс. Всё одним действием: Ctrl+Z вернёт как было.
import { S, commit, clipsTL, uid, snapFrame } from './store.js';
import { clipDur, CURVES } from './engine/speed.js';
import { defaultParams } from './engine/effects.js';
import { detectBeats } from './auto.js';
import { applyLook } from './profiles.js';
import { audioSpeed } from './engine/audioproc.js';

export const ENERGY = { calm: 'Спокойно', norm: 'Норм', fast: 'Быстро' };

/** Повторяемый «случай»: одна и та же затравка — тот же эдит, новая — другой вариант. */
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Средняя громкость исходника на [a, b] по волне (null — волны нет). */
function srcLoud(mid, a, b) {
  const pk = S.media[mid]?.peaks;
  if (!pk?.peaks?.length) return null;
  const i0 = Math.max(0, Math.floor(a * pk.rate)), i1 = Math.min(pk.peaks.length, Math.ceil(b * pk.rate));
  if (i1 <= i0) return 0;
  let s = 0;
  for (let i = i0; i < i1; i++) s += pk.peaks[i];
  return s / (i1 - i0);
}

/** Яркость каждой миниатюры видео (0…1) — по плиткам таймлайна; null, если плитки ещё не загрузились. */
const brightCache = new Map();
function thumbBrightness(mid) {
  if (brightCache.has(mid)) return brightCache.get(mid);
  const st = S.media[mid], meta = st?.meta;
  if (!meta?.thumb_w || !st.tiles?.length || !st.tiles.every((t) => t.complete && t.naturalWidth)) return null;
  try {
    const out = [];
    const c = document.createElement('canvas');
    const x = c.getContext('2d', { willReadFrequently: true });
    for (const tile of st.tiles) {
      const n = Math.max(1, Math.round(tile.naturalWidth / meta.thumb_w));
      c.width = n * 8; c.height = 8; // каждая миниатюра → 8×8
      x.drawImage(tile, 0, 0, c.width, 8);
      const d = x.getImageData(0, 0, c.width, 8).data;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) { const k = (yy * c.width + i * 8 + xx) * 4; s += d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114; }
        out.push(s / 64 / 255);
      }
    }
    brightCache.set(mid, out);
    return out;
  } catch { return null; } // холст «испорчен» чужим источником — без учёта яркости
}

/** Средняя яркость исходника на [a, b] (null — неизвестно). */
function srcBright(mid, a, b) {
  const br = thumbBrightness(mid);
  if (!br?.length) return null;
  const iv = S.media[mid].meta.thumb_interval || 2;
  const i0 = Math.min(br.length - 1, Math.floor(a / iv)), i1 = Math.min(br.length - 1, Math.max(i0, Math.floor(b / iv)));
  let s = 0;
  for (let i = i0; i <= i1; i++) s += br[i];
  return s / (i1 - i0 + 1);
}
/** Штраф за тёмный кусок: почти чёрное в эдите выглядит как провал. */
const darkPenalty = (b) => (b == null ? 0 : b < 0.1 ? 2 : b < 0.18 ? 0.6 : 0);

/** Сколько секунд исходника «съедает» секунда таймлайна при этой кривой. */
const curveRate = (curve) => 1 / clipDur({ in: 0, out: 1, speed: 1, curve });

/**
 * preset — эдит-пресет из блоков: rhythm {energy, loud, curves (доля склеек с кривой 0…1), muteVideo},
 * transitions {pool, every, strong, dur}, beatfx {pulse, flash, shake, rgb}, look {filter, fx, fit}, overlays.
 */
export async function autoEdit(preset, { seed = Date.now() } = {}, onStatus) {
  const R = { energy: 'norm', loud: true, curves: 0.3, muteVideo: true, ...preset.rhythm };
  const TRS = { pool: ['whipleft', 'whipright', 'zoomin', 'glitch', 'flash'], every: 4, strong: 0.6, dur: 0.4, ...preset.transitions };
  const FX = { pulse: 0.4, flash: 0.45, shake: 0.12, rgb: 0, ...preset.beatfx };
  const look = preset.look || {};
  const { energy, loud, muteVideo } = R;
  const p = S.project;
  const music = p.audio.find((a) => a.kind !== 'sfx' && a.kind !== 'voice' && !a.muted);
  if (!music) throw new Error('Добавь музыку — эдит собирается под её биты');
  // повторная сборка: моменты и длина музыки — исходные, а не куски прошлого эдита
  const prev = p.autoedit && p.clips.length && p.clips.every((c) => p.autoedit.ids.includes(c.id)) ? p.autoedit : null;
  const src = prev ? prev.moments : clipsTL().map((c) => ({ media: c.media, in: c.in, out: c.out }));
  const all = src.map((m) => ({ ...m, used: [] }));
  // почти чёрные моменты пропускаем (если светлых хватает)
  const lit = all.filter((m) => { const b = srcBright(m.media, m.in, m.out); return b == null || b >= 0.1; });
  const moments = lit.length >= Math.min(3, all.length) ? lit : all;
  const musicOut = prev?.music?.id === music.id ? prev.music.out : music.out;
  if (!moments.length) throw new Error('Сначала нарежь моменты на таймлайне (каждый клип — один момент)');
  let bt = p.beats?.[music.media];
  if (!bt?.beats?.length) {
    onStatus?.('Ищу биты в музыке…');
    bt = await detectBeats(music.media);
  }
  if (!bt?.beats?.length) throw new Error('В музыке не нашлось битов');
  onStatus?.('Собираю эдит…');
  const rnd = rng(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  // длина эдита: до конца музыки, но не длиннее, чем есть материала
  // скорость песни (Sped up / Slowed): биты и длина — в секундах таймлайна
  const ms = audioSpeed(music);
  const musicLen = (musicOut - music.in) / ms;
  const material = moments.reduce((s, m) => s + (m.out - m.in), 0);
  const beats = bt.beats.map((b) => (b - music.in) / ms).filter((t) => t > 0.05 && t < musicLen - 0.05);
  const strong = new Set((bt.strong || []).map((b) => +((b - music.in) / ms).toFixed(3)));
  if (beats.length < 4) throw new Error('Слишком мало битов — возьми кусок музыки подлиннее');
  const period = 60 / ((bt.bpm || 120) * ms);
  let L = Math.min(musicLen, Math.max(6, material));
  const lastBeat = beats.filter((t) => t <= L).pop();
  if (lastBeat && L - lastBeat < period * 2) L = lastBeat; // заканчиваем ровно на бите

  // точки склеек: каждый N-й бит; в «Норм» и «Быстро» иногда очередь быстрых склеек
  const step = { calm: period < 0.5 ? 4 : 2, norm: period < 0.45 ? 2 : 1, fast: 1 }[energy] ?? 2;
  const base = { calm: 2, norm: 2, fast: 1 }[energy] ?? 2;
  const cuts = [0];
  let i = 0;
  while (i < beats.length && beats[i] < L - period * 0.75) {
    const t = beats[i];
    if (t - cuts[cuts.length - 1] >= period * 0.75) cuts.push(t);
    const burst = energy !== 'calm' && strong.has(+t.toFixed(3)) && rnd() < (energy === 'fast' ? 0.35 : 0.2);
    i += burst ? 1 : step * base;
  }
  const segs = cuts.map((t, k) => [t, k + 1 < cuts.length ? cuts[k + 1] : L]).filter(([a, b]) => b - a > 0.12);

  // куски моментов: по кругу, в каждом — самое громкое ещё не взятое место
  const curveKeys = ['montage', 'hero', 'bullet', 'jump'].filter((k) => CURVES[k]);
  const clips = [];
  segs.forEach(([a, b], k) => {
    const d = b - a;
    const m = moments[k % moments.length];
    const md = p.media.find((x) => x.id === m.media)?.duration ?? m.out;
    let curve = 'none';
    if (R.curves > 0 && d >= period * 1.8 && rnd() < R.curves) curve = pick(curveKeys);
    let need = d * (curve === 'none' ? 1 : curveRate(curve));
    let speed = 1;
    const len = m.out - m.in;
    if (need > len) {
      // момент короче куска: чуть замедляем, а если всё равно мало — берём с запасом из исходника
      if (curve === 'none') { speed = Math.max(0.5, len / need); need *= speed; }
    }
    let lo = m.in, hi = Math.max(m.in, m.out - need);
    if (need > len) { lo = Math.max(0, m.in - (need - len) / 2); hi = lo; }
    let best = lo, bestV = -Infinity;
    for (let s = lo; s <= hi + 1e-6; s += 0.1) {
      const overlap = m.used.reduce((o, [u0, u1]) => o + Math.max(0, Math.min(u1, s + need) - Math.max(u0, s)), 0);
      const v = (loud ? srcLoud(m.media, s, s + need) ?? 0 : rnd()) - overlap * 10 - (s - lo) * 1e-4 - darkPenalty(srcBright(m.media, s, s + need));
      if (v > bestV) { bestV = v; best = s; }
    }
    best = Math.min(best, Math.max(0, md - need));
    m.used.push([best, best + need]);
    clips.push({ id: uid(), media: m.media, in: best, out: best + need, speed, curve, a, b });
  });

  // переходы на сильных долях и эффекты на биты
  const TR = TRS.pool?.length ? TRS.pool : [];
  const effects = [];
  const fx = (type, start, len, amount) => effects.push({ id: uid(), type, beat: true, start: snapFrame(start), end: snapFrame(Math.min(L, start + len)),
    p: { ...defaultParams(type), amount: Math.min(1, amount) } });
  clips.forEach((c, k) => {
    if (k === 0) return;
    const onStrong = strong.has(+c.a.toFixed(3));
    if (TR.length && ((onStrong && rnd() < TRS.strong) || k % Math.max(1, TRS.every) === 0)) {
      c.transition = { type: pick(TR), dur: +Math.min(TRS.dur, period * 0.9).toFixed(2) };
    } else if (FX.bshake > 0 && rnd() < FX.bshake) fx('blurshake', c.a, Math.min(0.6, c.b - c.a), 0.8); // толчок камеры со смазом
    else if (FX.impact > 0 && rnd() < FX.impact) fx('impact', c.a, Math.min(0.55, c.b - c.a), 0.7);
    else if (FX.shake > 0 && rnd() < FX.shake) fx('shake', c.a, Math.min(0.5, c.b - c.a), 0.5);
  });
  beats.filter((t) => t < L).forEach((t, k) => {
    const st = strong.has(+t.toFixed(3));
    if (FX.pulse > 0 && (energy !== 'calm' || st)) fx('pulse', t, Math.min(0.3, period * 0.8), st ? FX.pulse + 0.15 : FX.pulse);
    if (st && FX.flash > 0 && k % 4 === 0) fx('flash', t, 0.18, FX.flash);
    if (st && FX.rgb > 0 && k % 2 === 0) fx('rgb', t, Math.min(0.25, period * 0.6), FX.rgb);
    if (st && FX.punch > 0 && rnd() < FX.punch) fx('zoompunch', t, Math.min(0.45, period * 0.9), 0.7);
    if (st && FX.tear > 0 && rnd() < FX.tear) fx('tear', t, 0.16, 0.8);
    if (st && FX.stretch > 0 && rnd() < FX.stretch) fx(rnd() < 0.7 ? 'stretchx' : 'squash', t, Math.min(0.4, period * 0.9), 0.8); // растяг на бит
    if (st && FX.cflash > 0 && k % 4 === 2) {
      effects.push({ id: uid(), type: 'colorflash', beat: true, start: snapFrame(t), end: snapFrame(Math.min(L, t + 0.3)),
        p: { ...defaultParams('colorflash'), amount: FX.cflash, hue: rnd() } });
    }
  });
  // эффект на всё видео (VHS, плёнка, виньетка…)
  if (look.fx?.type) effects.push({ id: uid(), type: look.fx.type, start: 0, end: snapFrame(L), p: { ...defaultParams(look.fx.type), amount: look.fx.amount ?? 0.5 } });

  commit((q) => {
    const old = new Map(q.clips.map((c) => [c.media, c]));
    q.clips = clips.map(({ id, media, in: i0, out, speed, curve, transition }) => {
      const tpl = old.get(media) || {};
      return { ...structuredClone(tpl), id, media, in: i0, out, speed, curve, volume: muteVideo ? 0 : 1,
        transition: transition || { type: 'none', dur: 0.4 } };
    });
    applyLook(q, { ...look, filter: look.filter && look.filter !== 'keep' ? look.filter : null });
    if (preset.overlays) q.overlays = structuredClone(preset.overlays).map((o) => ({ ...o, id: uid() }));
    const mu = q.audio.find((a) => a.id === music.id);
    Object.assign(mu, { start: 0, out: mu.in + L * ms, volume: 1, fadeIn: 0, fadeOut: Math.min(1.5, L / 6) });
    q.audio = [mu]; // остальные звуки стояли под старый монтаж
    q.texts = [];
    q.effects = effects;
    q.parts.cuts = [];
    q.headers.enabled = false;
    q.autoedit = { moments: src, music: { id: music.id, out: musicOut }, ids: clips.map((c) => c.id) };
  });
  return { clips: clips.length, length: L, bpm: bt.bpm, transitions: clips.filter((c) => c.transition).length };
}
