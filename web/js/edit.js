// Операции редактирования: разрез, удаление, обрезка, части. Общие для таймлайна, кнопок и горячих клавиш.
import { S, commit, clipsTL, clipAt, duration, select, selectItems, selItems, uid, snapFrame, emit, STYLE_BASE, CLIP_DEFAULTS } from './store.js';
import { defaultParams, packEffects, transitionDefaultDur, EFFECTS } from './engine/effects.js';
import { clipDur, srcOffset, hasCurve } from './engine/speed.js';
import { audioLen, audioSrcAt, audioTlOf } from './engine/audioproc.js';
import { allProfiles, fitClips } from './profiles.js';

const MIN_CLIP = 0.1;
const MIN_TEXT = 0.1;

/** Убрать отрезок таймлайна [a, b]: всё, что правее, сдвигается влево (субтитры, тексты, границы частей). */
export function rippleRemove(p, a, b, withTexts = S.ripple) {
  const d = b - a;
  if (d <= 0) return;
  const map = (t) => (t <= a ? t : t >= b ? t - d : a);
  if (withTexts) {
    // тексты, субтитры и эффекты привязаны к видео — едут вместе с ним (музыка остаётся на месте)
    const shift = (list) => list.filter((it) => {
      const s = map(it.start), e = map(it.end);
      if (e - s < 0.05) return false;
      it.start = s; it.end = e;
      return true;
    });
    p.texts = shift(p.texts);
    p.effects = shift(p.effects || []);
  }
  p.parts.cuts = [...new Set(p.parts.cuts.filter((c) => c <= a || c >= b).map((c) => +(c >= b ? c - d : c).toFixed(4)))];
}

/** Вставить d секунд в точке at: всё, что правее, сдвигается вправо. */
export function rippleInsert(p, at, d, withTexts = S.ripple) {
  if (d <= 0) return;
  if (withTexts) {
    for (const it of [...p.texts, ...(p.effects || [])]) {
      if (it.start >= at - 1e-6) { it.start += d; it.end += d; }
      else if (it.end > at) it.end += d;
    }
  }
  p.parts.cuts = p.parts.cuts.map((c) => (c >= at - 1e-6 ? +(c + d).toFixed(4) : c));
}

export function clipStart(p, id) {
  let t = 0;
  for (const c of p.clips) {
    if (c.id === id) return t;
    t += clipDur(c);
  }
  return null;
}

/** Новый in клипа (в секундах исходника) с правильным сдвигом остального таймлайна. */
export function setClipIn(p, id, newIn) {
  const c = p.clips.find((x) => x.id === id);
  const start = clipStart(p, id);
  const d0 = clipDur(c);
  c.in = Math.max(0, Math.min(newIn, c.out - MIN_CLIP));
  const d1 = clipDur(c);
  if (d1 < d0) rippleRemove(p, start, start + (d0 - d1));
  else rippleInsert(p, start, d1 - d0);
}

export function setClipOut(p, id, newOut, mediaDur) {
  const c = p.clips.find((x) => x.id === id);
  const start = clipStart(p, id);
  const d0 = clipDur(c);
  c.out = Math.min(mediaDur ?? Infinity, Math.max(newOut, c.in + MIN_CLIP));
  const d1 = clipDur(c);
  if (d1 < d0) rippleRemove(p, start + d1, start + d0);
  else rippleInsert(p, start + d0, d1 - d0);
}

/** Скорость клипа: длительность на таймлайне меняется, всё правее сдвигается (тексты и эффекты — тоже). */
export function setClipSpeed(id, speed, curve, merge = null) {
  commit((p) => {
    const c = p.clips.find((x) => x.id === id);
    if (!c) return;
    const start = clipStart(p, id);
    const d0 = clipDur(c);
    if (speed != null) c.speed = Math.max(0.1, Math.min(10, +speed.toFixed(2)));
    if (curve != null) c.curve = curve;
    const d1 = clipDur(c);
    if (d1 < d0) rippleRemove(p, start + d1, start + d0);
    else rippleInsert(p, start + d0, d1 - d0);
  }, merge);
}

export const mediaDuration = (mid) => S.project.media.find((m) => m.id === mid)?.duration;

// ---------------------------------------------------------------------------

/**
 * Стоп-кадр в момент t на d секунд: видео режется, между половинами встаёт застывший кадр (без звука),
 * всё правее сдвигается. Возвращает id стоп-кадра.
 */
export function freezeFrame(t = S.t, d = 2) {
  t = snapFrame(t);
  const c = clipAt(t);
  if (!c) { emit('toast', { text: 'Поставь курсор на видео' }); return null; }
  if (S.project.media.find((m) => m.id === c.media)?.kind === 'image') { emit('toast', { text: 'Фото и так стоит — просто сделай клип длиннее' }); return null; }
  const fr = 1 / (S.project.canvas.fps || 30);
  const id = uid();
  commit((p) => {
    const i = p.clips.findIndex((x) => x.id === c.id);
    const orig = p.clips[i];
    if (orig.freeze) { // стоп-кадр на стоп-кадре — просто длиннее
      const start = clipStart(p, orig.id);
      orig.freeze = +(orig.freeze + d).toFixed(4);
      rippleInsert(p, start + orig.freeze - d, d);
      return;
    }
    const tlL = t - c.start;
    const md = mediaDuration(orig.media) ?? Infinity;
    const src = Math.max(0, Math.min(orig.in + srcOffset(orig, tlL), md - fr)); // ровно тот кадр, что сейчас в превью
    const frz = { ...structuredClone(orig), id, freeze: d, in: src, out: src + fr, speed: 1, curve: 'none', volume: 0,
      transition: { type: 'none', dur: 0.5 } };
    if (tlL < MIN_CLIP) {
      // в начале клипа — стоп-кадр перед ним (переход клипа переезжает на стоп-кадр)
      frz.transition = orig.transition; orig.transition = { type: 'none', dur: 0.5 };
      p.clips.splice(i, 0, frz);
    } else if (c.end - t < MIN_CLIP) {
      p.clips.splice(i + 1, 0, frz);
    } else {
      const tlR = c.end - t;
      const right = { ...structuredClone(orig), id: uid(), in: orig.in + srcOffset(orig, tlL), transition: { type: 'none', dur: 0.5 } };
      if (hasCurve(orig)) {
        orig.curve = 'none'; right.curve = 'none';
        orig.speed = +((right.in - orig.in) / tlL).toFixed(4);
        right.speed = +((orig.out - right.in) / tlR).toFixed(4);
      }
      orig.out = right.in;
      p.clips.splice(i + 1, 0, frz, right);
    }
    rippleInsert(p, t, d);
  });
  select('clip', [id]);
  return id;
}

/**
 * Переставить клип на место toIndex (номер среди остальных клипов). Его субтитры, тексты, эффекты и
 * отделённый звук едут вместе с ним (если включён «Сдвиг»), остальное сдвигается как при вырезании/вставке.
 */
export function moveClip(id, toIndex) {
  commit((p) => {
    const i = p.clips.findIndex((c) => c.id === id);
    if (i < 0) return;
    const c = p.clips[i];
    const s = clipStart(p, id), d = clipDur(c), e = s + d;
    const inside = (a, b) => a >= s - 1e-3 && b <= e + 1e-3;
    const carry = [];
    if (S.ripple) {
      for (const key of ['texts', 'effects']) {
        p[key] = (p[key] || []).filter((it) => { if (!inside(it.start, it.end)) return true; carry.push({ it, off: it.start - s, key }); return false; });
      }
      p.audio = p.audio.filter((a) => { if (a.kind !== 'voice' || !inside(a.start, a.start + audioLen(a))) return true; carry.push({ it: a, off: a.start - s, key: 'audio' }); return false; });
    }
    p.clips.splice(i, 1);
    rippleRemove(p, s, e);
    const j = Math.max(0, Math.min(toIndex, p.clips.length));
    let ns = 0;
    for (let k = 0; k < j; k++) ns += clipDur(p.clips[k]);
    p.clips.splice(j, 0, c);
    rippleInsert(p, ns, d);
    for (const { it, off, key } of carry) {
      const len = it.end != null ? it.end - it.start : 0;
      it.start = ns + off;
      if (it.end != null) it.end = it.start + len;
      p[key].push(it);
    }
  });
}

/** Длина стоп-кадра (всё правее сдвигается). */
export function setFreezeDur(p, id, d) {
  const c = p.clips.find((x) => x.id === id);
  if (!c?.freeze) return;
  const start = clipStart(p, id), d0 = c.freeze;
  c.freeze = +Math.max(MIN_CLIP, d).toFixed(4);
  if (c.freeze < d0) rippleRemove(p, start + c.freeze, start + d0);
  else rippleInsert(p, start + d0, c.freeze - d0);
}

/** Ctrl+B: режет выделенные тексты, а если ничего не выделено (или выделен клип) — видео под курсором. */
export function splitAtPlayhead() {
  const t = snapFrame(S.t);
  const items = selItems();
  const idsOf = (k) => items.filter((x) => x.kind === k).map((x) => x.id);
  // выделенные тексты / эффекты / звуки под курсором режутся все сразу
  const hit = (list, ids) => list.filter((x) => ids.includes(x.id) && x.start + MIN_TEXT < t && x.end - MIN_TEXT > t);
  const texts = hit(S.project.texts, idsOf('text')), fx = hit(S.project.effects, idsOf('effect'));
  const auds = S.project.audio.filter((a) => idsOf('audio').includes(a.id) && t > a.start + MIN_TEXT && t < a.start + audioLen(a) - MIN_TEXT);
  const clipsSel = idsOf('clip');
  if (texts.length || fx.length || auds.length) {
    commit((p) => {
      for (const [key, targets] of [['texts', texts], ['effects', fx]]) {
        for (const it of p[key].filter((x) => targets.some((y) => y.id === x.id))) {
          const copy = structuredClone(it);
          copy.id = uid();
          copy.start = t;
          it.end = t;
          p[key].push(copy);
        }
      }
      for (const x of p.audio.filter((y) => auds.some((a) => a.id === y.id))) {
        const local = audioSrcAt(x, t); // секунда исходника под курсором (с учётом скорости)
        p.audio.push({ ...structuredClone(x), id: uid(), start: t, in: local, fadeIn: 0 });
        x.out = local;
        x.fadeOut = 0;
      }
    });
    if (!clipsSel.length) return;
  }
  const c = clipAt(t);
  if (!c || t - c.start < MIN_CLIP || c.end - t < MIN_CLIP) return emit('toast', { text: 'Поставь курсор внутрь клипа' });
  const curved = hasCurve(c);
  commit((p) => {
    const i = p.clips.findIndex((x) => x.id === c.id);
    const orig = p.clips[i];
    const tlL = t - c.start, tlR = c.end - t;
    if (orig.freeze) {
      // стоп-кадр делится по длительности
      orig.freeze = +tlL.toFixed(4);
      p.clips.splice(i + 1, 0, { ...structuredClone(orig), id: uid(), freeze: +tlR.toFixed(4), transition: { type: 'none', dur: 0.5 } });
      return;
    }
    const cut = orig.in + srcOffset(orig, tlL);
    const right = { ...structuredClone(orig), id: uid(), in: cut, transition: { type: 'none', dur: 0.5 } };
    if (curved) {
      // кривую на две половины не делим: каждой — постоянная скорость, равная средней на её куске
      orig.curve = 'none'; right.curve = 'none';
      orig.speed = +((cut - orig.in) / tlL).toFixed(4);
      right.speed = +((orig.out - cut) / tlR).toFixed(4);
    }
    orig.out = cut;
    p.clips.splice(i + 1, 0, right);
  });
  if (curved) emit('toast', { text: 'Кривая скорости заменена постоянной скоростью на обеих половинах' });
}

export function deleteSelection() {
  const items = selItems();
  if (!items.length) return;
  const ids = (k) => items.filter((x) => x.kind === k).map((x) => x.id);
  const n = items.length;
  commit((p) => {
    // клипы с конца, чтобы сдвиги таймлайна не путали позиции
    let t = 0;
    const spans = p.clips.map((c) => { const s = { id: c.id, start: t, end: t + clipDur(c) }; t = s.end; return s; })
      .filter((c) => ids('clip').includes(c.id)).sort((a, b) => b.start - a.start);
    for (const c of spans) {
      p.clips = p.clips.filter((x) => x.id !== c.id);
      rippleRemove(p, c.start, c.end);
    }
    p.texts = p.texts.filter((x) => !ids('text').includes(x.id));
    p.effects = p.effects.filter((x) => !ids('effect').includes(x.id));
    p.audio = p.audio.filter((x) => !ids('audio').includes(x.id));
    p.overlays = (p.overlays || []).filter((x) => !ids('overlay').includes(x.id));
    const idx = ids('cut').map((id) => +id.slice(1));
    if (idx.length) p.parts.cuts = [...p.parts.cuts].sort((a, b) => a - b).filter((_, i) => !idx.includes(i));
    if (ids('header').length) p.headers.enabled = false;
    if (ids('ad').length) p.ads.enabled = false;
  });
  if (ids('header').length) emit('toast', { text: 'Заголовки выключены (включить — вкладка «Авто»)' });
  else if (ids('ad').length) emit('toast', { text: 'Реклама выключена (включить — вкладка «Авто» → «Реклама»)' });
  else if (n > 1) emit('toast', { text: `Удалено: ${n}` });
  S.t = Math.min(S.t, duration());
  select(null);
}

/** Ctrl+A: выделить всё (тексты, субтитры, эффекты, звуки, клипы). */
export function selectAll() {
  const p = S.project;
  selectItems([
    ...p.clips.map((c) => ({ kind: 'clip', id: c.id })),
    ...p.texts.map((t) => ({ kind: 'text', id: t.id })),
    ...p.effects.map((e) => ({ kind: 'effect', id: e.id })),
    ...p.audio.map((a) => ({ kind: 'audio', id: a.id })),
  ]);
}

/** Q / W: обрезать клип под курсором слева/справа до курсора (или выделенные тексты). */
export function trimToPlayhead(side) {
  const t = snapFrame(S.t);
  if (S.sel.kind === 'text' || S.sel.kind === 'effect') {
    const key = S.sel.kind === 'text' ? 'texts' : 'effects';
    commit((p) => {
      for (const it of p[key].filter((x) => S.sel.ids.includes(x.id))) {
        if (side === 'l' && t > it.start && t < it.end - MIN_TEXT) it.start = t;
        if (side === 'r' && t < it.end && t > it.start + MIN_TEXT) it.end = t;
      }
    });
    return;
  }
  const c = clipAt(t);
  if (!c) return;
  const local = c.in + srcOffset(c, t - c.start);
  if (side === 'l') {
    if (t - c.start < MIN_CLIP / 2) return;
    commit((p) => setClipIn(p, c.id, local));
    S.t = c.start;
  } else {
    if (c.end - t < MIN_CLIP / 2) return;
    commit((p) => setClipOut(p, c.id, local));
  }
  emit('time');
}

export function addCut(t) {
  t = snapFrame(t);
  if (t < 1 || t > duration() - 1) return emit('toast', { text: 'Граница части должна быть внутри видео' });
  if (S.project.parts.cuts.some((c) => Math.abs(c - t) < 1)) return;
  commit((p) => { p.parts.cuts = [...p.parts.cuts, t].sort((a, b) => a - b); });
}

export const PHOTO_SEC = 4;

export function addMediaToTimeline(m) {
  if (m.kind === 'audio') return addAudio(m);
  commit((p) => {
    // фото встаёт на 4 секунды (тянется за край сколько угодно)
    const c = { id: uid(), media: m.id, in: 0, out: m.kind === 'image' ? PHOTO_SEC : m.duration, ...structuredClone(CLIP_DEFAULTS) };
    p.clips.push(c);
    // кадрирование по профилю жанра (CS2 — крупнее, Reddit — на весь экран…)
    const fit = allProfiles()[p.profile]?.fit;
    if (fit) fitClips({ ...p, clips: [c], media: [...p.media, m] }, fit);
    if (!p.title) p.title = m.name.replace(/\.[^.]+$/, '');
  });
}

/** Музыка или звук на аудиодорожку — с позиции курсора. */
export function addAudio(m, kind = m.duration > 20 ? 'music' : 'sfx') {
  const id = uid();
  const start = snapFrame(S.t >= duration() - 0.05 ? 0 : S.t);
  commit((p) => {
    // в видео музыка тише голоса и с плавными краями; в проекте «Музыка» — как есть
    const under = kind === 'music' && p.kind !== 'music';
    p.audio.push({ id, media: m.id, kind, start, in: 0, out: m.duration, volume: under ? 0.6 : 1,
      fadeIn: under ? 0.5 : 0, fadeOut: under ? 1.5 : 0 });
  });
  select('audio', [id]);
  return id;
}

export const EFFECT_LEN = { pulse: 0.35, flash: 0.3, shakehard: 0.6, spin: 0.8, dip: 0.6, invert: 0.25,
  impact: 0.55, zoompunch: 0.45, colorflash: 0.35, strobe: 1, jitter: 1, bass: 1.2, quake: 1.2, tilt: 1.2 };

/** Набор эффектов одним шагом (Ctrl+Z убирает весь набор). */
export function addPack(key, at = S.t) {
  const d = duration();
  const start = snapFrame(Math.max(0, Math.min(at, d - 0.1)));
  const ids = [];
  commit((p) => {
    for (const e of packEffects(key, start)) {
      const id = uid();
      ids.push(id);
      p.effects.push({ ...e, id, start: snapFrame(e.start), end: snapFrame(Math.min(Math.max(d, e.start + 0.1), e.end)) });
    }
  });
  select('effect', ids);
  return ids;
}

// цветокор, частицы, рамки и деформации обычно держат подольше
const LONG_GROUPS = ['Цвет', 'Частицы', 'Рамки', 'Деформации'];
export function addEffect(type, at = S.t, len = EFFECT_LEN[type] || (LONG_GROUPS.includes(EFFECTS[type]?.group) ? 4 : 1.5)) {
  const id = uid();
  const d = duration();
  const start = snapFrame(Math.max(0, Math.min(at, d - 0.1)));
  commit((p) => {
    p.effects.push({ id, type, start, end: Math.min(Math.max(d, start + 0.1), start + len), p: { ...defaultParams(type) } });
  });
  select('effect', [id]);
  return id;
}

export const ASPECTS = {
  '9:16': [1080, 1920, 'TikTok, Reels, Shorts'],
  '16:9': [1920, 1080, 'YouTube'],
  '1:1': [1080, 1080, 'Квадрат'],
  '4:5': [1080, 1350, 'Лента Instagram'],
  '3:4': [1080, 1440, 'Вертикаль 3:4'],
  '4:3': [1440, 1080, 'Горизонталь 4:3'],
};

/** Масштаб, при котором видео целиком помещается в кадр W×H (scale — доля ширины кадра). */
export function containScale(m, W, H) {
  if (!m?.width || !m?.height) return 1;
  return Math.min(1, (H * m.width) / (W * m.height));
}

/** Смена соотношения сторон: тексты, позиции и масштаб видео пересчитываются пропорционально. */
export function setAspect(key) {
  const [W, H] = ASPECTS[key];
  commit((p) => {
    const { w: w0, h: h0 } = p.canvas;
    if (w0 === W && h0 === H) return;
    const fx = W / w0, fy = H / h0;
    for (const t of p.texts) if (t.track !== 'subs') { t.x = Math.round(t.x * fx); t.y = Math.round(t.y * fy); }
    for (const o of [p.subs, p.headers]) { o.x = Math.round(o.x * fx); o.y = Math.round(o.y * fy); }
    // размер шрифтов — по меньшей стороне, чтобы текст не вылезал на широком кадре
    const fs = Math.min(W, H) / Math.min(w0, h0);
    const sizeOf = (st) => { st.size = Math.round(st.size * fs); };
    for (const t of p.texts) if (t.track !== 'subs' && t.style) sizeOf(t.style);
    sizeOf(p.subs.style); sizeOf(p.headers.style);
    for (const c of p.clips) {
      const m = p.media.find((x) => x.id === c.media);
      // сохраняем «как было относительно вписанного»: вписанное остаётся вписанным, увеличенное — увеличенным
      c.scale = +((c.scale ?? 1) / containScale(m, w0, h0) * containScale(m, W, H)).toFixed(4);
      c.x = Math.round((c.x || 0) * fx); c.y = Math.round((c.y || 0) * fy);
    }
    p.canvas.w = W; p.canvas.h = H;
  });
  emit('canvas-size');
}

export function setTransition(clipId, type, dur) {
  commit((p) => {
    const c = p.clips.find((x) => x.id === clipId);
    // новый переход — своя удобная длина (эдитовые короче), тот же — длина сохраняется
    if (c) c.transition = { type, dur: dur ?? (c.transition?.type === type ? c.transition.dur : transitionDefaultDur(type)) };
  });
}

export function setTransitionAll(type, dur = transitionDefaultDur(type)) {
  commit((p) => { p.clips.forEach((c, i) => { if (i > 0) c.transition = { type, dur }; }); });
}

/** Биты выбранного (или всех) треков в координатах таймлайна. */
export function beatsInTimeline({ strongOnly = false, onlyItem = null } = {}) {
  const out = [];
  for (const a of S.project.audio) {
    if (onlyItem && a.id !== onlyItem) continue;
    const bt = S.project.beats?.[a.media];
    if (!bt) continue;
    for (const b of strongOnly ? bt.strong : bt.beats) {
      const t = audioTlOf(a, b); // с учётом скорости дорожки
      if (t >= a.start && t <= a.start + audioLen(a) && t < duration()) out.push(t);
    }
  }
  return [...new Set(out.map((t) => +t.toFixed(3)))].sort((x, y) => x - y);
}

/** Автобиты: эффект на каждый (или каждый N-й / сильный) бит. Старые бит-эффекты этого типа заменяются. */
export function effectsOnBeats(type, { every = 1, strongOnly = false, amount = 0.6, len } = {}) {
  const beats = beatsInTimeline({ strongOnly }).filter((_, i) => i % every === 0);
  if (!beats.length) return 0;
  const L = len ?? EFFECT_LEN[type] ?? 0.3;
  commit((p) => {
    p.effects = p.effects.filter((e) => !(e.beat && e.type === type));
    beats.forEach((b, i) => {
      const next = beats[i + 1] ?? Infinity;
      p.effects.push({ id: uid(), type, beat: true, start: snapFrame(b), end: snapFrame(Math.min(b + L, next - 0.02)),
        p: { ...defaultParams(type), amount } });
    });
  });
  return beats.length;
}

/** Нарезка видео по битам (монтаж «под бит»): разрез клипа на каждом N-м бите. */
export function cutClipsOnBeats({ every = 1, strongOnly = false } = {}) {
  const beats = beatsInTimeline({ strongOnly }).filter((_, i) => i % every === 0);
  let made = 0;
  commit((p) => {
    for (const b of beats) {
      let t = 0;
      for (let i = 0; i < p.clips.length; i++) {
        const c = p.clips[i], d = clipDur(c);
        if (b > t + MIN_CLIP && b < t + d - MIN_CLIP && !hasCurve(c)) {
          const cut = c.in + srcOffset(c, b - t);
          p.clips.splice(i + 1, 0, { ...structuredClone(c), id: uid(), in: cut, transition: { type: 'none', dur: 0.5 } });
          c.out = cut;
          made++;
          break;
        }
        t += d;
      }
    }
  });
  return made;
}

export function addText(style = {}, text = 'Текст') {
  const t = S.t;
  const d = duration();
  const id = uid();
  commit((p) => {
    p.texts.push({
      id, track: 'text', text, start: Math.min(t, Math.max(0, d - 0.5)), end: Math.min(d || t + 3, t + 3),
      x: p.canvas.w / 2, y: p.canvas.h / 2, style: { ...STYLE_BASE, wrap: 18, ...style },
      anim: { in: 'pop', out: 'fade', dur: 220 },
    });
  });
  select('text', [id]);
  emit('focus-text');
}

/** Копия выделенных текстов/эффектов/звуков сразу после них (вся группа сдвигается целиком). */
export function duplicateSelection() {
  const items = selItems().filter((x) => ['text', 'effect', 'audio'].includes(x.kind));
  if (!items.length) return;
  const p0 = S.project;
  const find = (x) => ({ text: p0.texts, effect: p0.effects, audio: p0.audio }[x.kind]).find((y) => y.id === x.id);
  const span = (o) => (o.out != null ? [o.start, o.start + audioLen(o)] : [o.start, o.end]);
  const objs = items.map(find).filter(Boolean);
  const gStart = Math.min(...objs.map((o) => span(o)[0])), gEnd = Math.max(...objs.map((o) => span(o)[1]));
  const shift = gEnd - gStart;
  const made = [];
  commit((p) => {
    for (const x of items) {
      const key = { text: 'texts', effect: 'effects', audio: 'audio' }[x.kind];
      const it = p[key].find((y) => y.id === x.id);
      if (!it) continue;
      const c = structuredClone(it);
      c.id = uid();
      c.start += shift;
      if (c.end != null) c.end += shift;
      delete c.beat;
      p[key].push(c);
      made.push({ kind: x.kind, id: c.id });
    }
  });
  selectItems(made);
}
