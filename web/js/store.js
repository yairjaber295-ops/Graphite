// Состояние редактора: проект, выделение, история (undo/redo), автосохранение и производные данные.
import { clipDur } from './engine/speed.js';

export const S = {
  backend: null,  // ServerBackend (комп) или LocalBackend (телефон)
  project: null,
  fonts: [],
  fontMap: {},
  config: {},
  sel: { kind: null, ids: [] }, // kind: clip | text | header | cut | effect | audio
  t: 0,
  playing: false,
  zoom: 40,       // пикселей на секунду
  scroll: 0,      // секунд слева за краем таймлайна
  ripple: true,
  snap: true,
  media: {},      // mid -> { meta, peaks, silences, words, tiles: [Image], status }
  undo: [],
  redo: [],
  saveState: 'saved',
};

// ---------------------------------------------------------------------------
//   События
// ---------------------------------------------------------------------------
const listeners = {};
export function on(ev, fn) { (listeners[ev] ||= []).push(fn); }
export function emit(ev, data) { (listeners[ev] || []).forEach((fn) => fn(data)); }

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
//   Значения по умолчанию
// ---------------------------------------------------------------------------
export const STYLE_BASE = {
  font: 'Rubik-700', size: 62, color: '#FFFFFF',
  strokeColor: '#000000', strokeWidth: 7,
  shadowColor: '#000000', shadowAlpha: 0.45, shadowDist: 5,
  box: false, boxColor: '#000000', boxAlpha: 0.65, boxPad: 18,
  upper: false, wrap: 22,
};

function defaults(obj, def) {
  for (const [k, v] of Object.entries(def)) {
    if (obj[k] === undefined) obj[k] = structuredClone(v);
    else if (v && typeof v === 'object' && !Array.isArray(v) && obj[k] && typeof obj[k] === 'object') defaults(obj[k], v);
  }
  return obj;
}

export const CLIP_DEFAULTS = {
  scale: 1, x: 0, y: 0, rot: 0, volume: 1, filter: 'none', speed: 1, curve: 'none',
  adjust: { bright: 0, contrast: 0, sat: 0, temp: 0 },
  transition: { type: 'none', dur: 0.5 },
};

/** Хромакей по умолчанию (как в OBS: близость, мягкость края, подавление зелёного ореола). */
export const CHROMA_DEFAULTS = { enabled: false, color: '#00FF00', sim: 0.4, smooth: 0.08, spill: 0.1 };

/** Автореклама: какие ролики, сколько (от длины части) и когда. */
export const AD_DEFAULTS = {
  enabled: false, items: [], order: 'cycle', scope: 'part',
  per: 60, min: 1, max: 2, minLen: 20,
  place: 'middle', at: 5, snap: true, maxDur: 0, pause: true, // pause — вставка: видео стоит, пока идёт ролик
  mode: 'pip', x: 0.5, y: 0.74, size: 0.6, radius: 0.04, anim: 'pop',
  volume: 1, duck: 0.3, hideSubs: false, seed: 1,
  chroma: { ...CHROMA_DEFAULTS },
};

export function normalize(p) {
  // v1 → v2: заголовки и обложки по умолчанию Rubik Bold (как в CapCut-нарезках)
  if (!p.version || p.version < 2) {
    if (p.headers?.style?.font === 'Rubik-900') p.headers.style.font = 'Rubik-700';
    if (p.covers?.font === 'Rubik-900') p.covers.font = 'Rubik-700';
    p.version = 2;
  }
  for (const m of p.media || []) m.kind ||= 'video';
  if (p.covers?.style === 'frame') p.covers.style = 'badge'; // старое имя стиля
  for (const c of p.clips || []) defaults(c, CLIP_DEFAULTS);
  return defaults(p, {
    name: 'Новый проект',
    title: '',
    canvas: { w: 1080, h: 1920, fps: 60 },
    background: { mode: 'blur', blur: 40, dim: 0.15, color: '#000000' },
    media: [], clips: [], texts: [], effects: [], audio: [], beats: {}, overlays: [],
    ducking: { enabled: false, level: 0.3, threshold: 0.16 },
    censor: { on: false, mode: 'beep', subs: true, custom: '', song: 'mute' },   // запикивание мата (engine/censor.js)
    ads: AD_DEFAULTS,
    subs: {
      style: { ...STYLE_BASE }, x: 540, y: 1400,
      anim: { in: 'pop', out: 'none', dur: 180 },
      opts: { maxChars: 22, maxDur: 2.6, maxGap: 0.6, lang: 'ru', model: 'large-v3-turbo' },
    },
    headers: {
      enabled: false,
      style: { ...STYLE_BASE, font: 'Rubik-700', size: 66, strokeWidth: 8, shadowDist: 6, wrap: 20 },
      x: 540, y: 430, anim: { in: 'fade', out: 'none', dur: 250 },
      template: '{title} {label}', custom: {},
    },
    parts: { cuts: [], target: 60, max: 12 },
    covers: { enabled: false, style: 'badge', font: 'Rubik-700', accent: '#EB2D41', avatar: '', nick: '', theme: 'light', cardText: '',
      card: { enabled: false, dur: 3, y: 0.5, hideSubs: true } },
  });
}

// ---------------------------------------------------------------------------
//   Изменения, история, сохранение
// ---------------------------------------------------------------------------
let mergeKey = null, mergeTime = 0, saveTimer = null, clipCache = null;

/** Все правки проекта идут через commit — так работают undo/redo и автосохранение.
 *  merge: ключ для склейки серии мелких правок (ползунки) в один шаг истории. */
export function commit(fn, merge = null) {
  const now = Date.now();
  if (!(merge && merge === mergeKey && now - mergeTime < 1200)) {
    S.undo.push(JSON.stringify(S.project));
    if (S.undo.length > 150) S.undo.shift();
    S.redo = [];
  }
  mergeKey = merge; mergeTime = now;
  fn(S.project);
  changed();
}

// Перетаскивание на таймлайне: один шаг истории на всё движение, каждый кадр применяется к исходной копии
let editBase = null;
export function beginEdit() {
  editBase = JSON.stringify(S.project);
  mergeKey = null;
}
export function updateEdit(fn) {
  if (editBase == null) return;
  S.project = JSON.parse(editBase);
  fn(S.project);
  changed();
}
export function endEdit() {
  if (editBase == null) return;
  if (JSON.stringify(S.project) !== editBase) {
    S.undo.push(editBase);
    if (S.undo.length > 150) S.undo.shift();
    S.redo = [];
  }
  editBase = null;
}

export function undo() {
  if (!S.undo.length) return;
  S.redo.push(JSON.stringify(S.project));
  S.project = JSON.parse(S.undo.pop());
  mergeKey = null;
  fixSelection();
  changed();
}

export function redo() {
  if (!S.redo.length) return;
  S.undo.push(JSON.stringify(S.project));
  S.project = JSON.parse(S.redo.pop());
  mergeKey = null;
  fixSelection();
  changed();
}

function changed() {
  clipCache = null;
  emit('derived-reset');
  S.t = clamp(S.t, 0, duration());
  S.saveState = 'dirty';
  emit('save-state');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
  emit('change');
}

export async function save() {
  clearTimeout(saveTimer);
  if (!S.project || S.saveState === 'saving') return;
  S.saveState = 'saving';
  emit('save-state');
  try {
    await S.backend.saveProject(S.project);
    S.saveState = 'saved';
  } catch (e) {
    S.saveState = 'error';
    emit('toast', { text: 'Не удалось сохранить: ' + e.message, kind: 'err' });
  }
  emit('save-state');
}

// ---------------------------------------------------------------------------
//   Выделение
// ---------------------------------------------------------------------------
/** Выделенные объекты как список {kind, id} (одного типа или вперемешку — kind 'mixed'). */
export function selItems(sel = S.sel) {
  if (!sel.kind) return [];
  if (sel.kind === 'mixed') return sel.ids.map((x) => { const i = x.indexOf(':'); return { kind: x.slice(0, i), id: x.slice(i + 1) }; });
  return sel.ids.map((id) => ({ kind: sel.kind, id }));
}

function setSel(items) {
  const kinds = new Set(items.map((x) => x.kind));
  if (!items.length) S.sel = { kind: null, ids: [] };
  else if (kinds.size === 1) S.sel = { kind: items[0].kind, ids: items.map((x) => x.id) };
  else S.sel = { kind: 'mixed', ids: items.map((x) => `${x.kind}:${x.id}`) };
}

/** additive — добавить/убрать (Ctrl/Shift+клик, режим «Несколько»); можно смешивать типы. */
export function select(kind, ids = [], additive = false) {
  if (additive) {
    const items = selItems();
    for (const id of ids) {
      const i = items.findIndex((x) => x.kind === kind && x.id === id);
      if (i >= 0) items.splice(i, 1); else items.push({ kind, id });
    }
    setSel(items);
  } else {
    S.sel = { kind: ids.length ? kind : null, ids };
  }
  emit('selection');
}

export function selectItems(items) { setSel(items); emit('selection'); }

export const isSelected = (kind, id) => (S.sel.kind === 'mixed' ? S.sel.ids.includes(`${kind}:${id}`) : S.sel.kind === kind && S.sel.ids.includes(id));

function fixSelection() {
  const p = S.project;
  const exists = {
    clip: (id) => p.clips.some((c) => c.id === id),
    text: (id) => p.texts.some((t) => t.id === id),
    header: (id) => parts().some((x) => 'h' + x.i === id),
    cut: (id) => p.parts.cuts.some((_, i) => 'c' + i === id),
    effect: (id) => p.effects.some((e) => e.id === id),
    audio: (id) => p.audio.some((a) => a.id === id),
    overlay: (id) => (p.overlays || []).some((o) => o.id === id),
    ad: () => !!p.ads?.enabled,
  };
  setSel(selItems().filter((x) => exists[x.kind]?.(x.id)));
  emit('selection');
}

// ---------------------------------------------------------------------------
//   Производные данные
// ---------------------------------------------------------------------------
export function clipsTL() {
  if (!clipCache) {
    let t = 0;
    clipCache = S.project.clips.map((c) => {
      const d = clipDur(c); // с учётом скорости
      const r = { ...c, start: t, end: t + d };
      t += d;
      return r;
    });
  }
  return clipCache;
}

/** Проект «Музыка»: свои вкладки, таймлайн только из звука, сетка тактов по BPM. */
export const isMusic = () => S.project?.kind === 'music';

export function duration() {
  const c = clipsTL();
  const video = c.length ? c[c.length - 1].end : 0;
  // проект без видео (только музыка) или «Музыка» — длина по звуку; в видеопроектах трек длиннее видео его не растягивает
  if (video && S.project.kind !== 'music') return video;
  let sound = 0;
  for (const a of S.project.audio || []) sound = Math.max(sound, a.start + (a.out - a.in) / Math.max(0.25, Math.min(4, a.speed || 1)));
  return Math.max(video, sound);
}

export function clipAt(t) {
  const cs = clipsTL();
  for (const c of cs) if (t >= c.start && t < c.end) return c;
  return cs.length && t >= cs[cs.length - 1].end - 1e-6 ? cs[cs.length - 1] : null;
}

export const frame = () => 1 / (S.project?.canvas.fps || 60);
export const snapFrame = (t) => Math.round(t / frame()) * frame();

export function partLabel(i, n) {
  if (n <= 1) return '';
  return i === n ? '(финал)' : `(часть ${i})`;
}

export function seriesTitle() {
  const p = S.project;
  return (p.title || '').trim() || p.name || 'Видео';
}

/** Части: [{i, n, start, end, label}] по границам parts.cuts. */
export function parts() {
  const d = duration();
  const cuts = [...S.project.parts.cuts].filter((x) => x > 0.05 && x < d - 0.05).sort((a, b) => a - b);
  const edges = [0, ...cuts, d];
  const n = edges.length - 1;
  return edges.slice(0, -1).map((s, k) => ({ i: k + 1, n, start: s, end: edges[k + 1], label: partLabel(k + 1, n) }));
}

export function headerText(part) {
  const h = S.project.headers;
  const custom = h.custom?.[part.i];
  if (custom != null && custom !== '') return custom;
  return h.template.replace('{title}', seriesTitle()).replace('{label}', part.label).replace(/\s+/g, ' ').trim();
}

/** Всё, что рисуется поверх видео, с уже применённым стилем/позицией/анимацией. */
export function renderItems() {
  const p = S.project;
  const out = [];
  for (const t of p.texts) {
    if (t.track === 'subs') {
      out.push({ id: t.id, kind: 'sub', layer: 1, start: t.start, end: t.end, text: t.text, w: t.w,
        style: p.subs.style, x: p.subs.x, y: p.subs.y, anim: p.subs.anim });
    } else {
      out.push({ id: t.id, kind: 'text', layer: 3, start: t.start, end: t.end, text: t.text,
        style: t.style, x: t.x, y: t.y, anim: t.anim });
    }
  }
  if (p.headers.enabled && duration() > 0) {
    for (const part of parts()) {
      out.push({ id: 'h' + part.i, kind: 'header', layer: 2, part: part.i, start: part.start, end: part.end,
        text: headerText(part), style: p.headers.style, x: p.headers.x, y: p.headers.y, anim: p.headers.anim });
    }
  }
  if (p.overlays?.length && duration() > 0) {
    const ps = parts();
    for (const o of p.overlays) {
      if (!o.text?.trim()) continue;
      overlaySpans(o, ps, duration()).forEach(([start, end, part], k) => {
        out.push({ id: `ov:${o.id}:${k}`, kind: 'overlay', overlay: o.id, layer: 4, start, end, text: overlayText(o.text, part, ps.length),
          style: o.style, x: (o.x ?? 0.5) * p.canvas.w, y: (o.y ?? 0.5) * p.canvas.h, anim: o.anim || {} });
      });
    }
  }
  return out;
}

/**
 * Свои тексты пресета: когда показывать.
 * always — всё видео; video-start / video-end — в начале/конце видео; part-start / part-end — в каждой части.
 */
export const OVERLAY_WHEN = {
  'part-start': 'В начале каждой части', 'part-end': 'В конце каждой части', always: 'Всё время',
  'video-start': 'В начале видео', 'video-end': 'В конце видео',
};
export function overlaySpans(o, ps, total) {
  const d = Math.max(0.2, o.dur || 3), off = Math.max(0, o.offset || 0);
  const clip = (a, b, part) => { a = Math.max(part.start, a); b = Math.min(part.end, b); return b - a > 0.05 ? [[a, b, part]] : []; };
  const whole = { i: 1, n: 1, start: 0, end: total, label: '' };
  switch (o.when) {
    case 'always': return [[0, total, whole]];
    case 'video-start': return clip(off, off + d, whole);
    case 'video-end': return clip(total - off - d, total - off, whole);
    case 'part-end': return ps.flatMap((part) => clip(part.end - off - d, part.end - off, part));
    default: return ps.flatMap((part) => clip(part.start + off, part.start + off + d, part));
  }
}
/** Переменные: {title} {label} {n} {total} {next} {nick}. */
export function overlayText(text, part, n) {
  const p = S.project;
  const next = part.i < n ? (part.i + 1 === n ? 'финал' : `часть ${part.i + 1}`) : '';
  return String(text).replaceAll('{title}', seriesTitle()).replaceAll('{label}', part.label || '').replaceAll('{n}', String(part.i))
    .replaceAll('{total}', String(n)).replaceAll('{next}', next).replaceAll('{nick}', p.covers?.nick || '')
    .replace(/[ \t]+/g, ' ').trim();
}

export const subs = () => S.project.texts.filter((t) => t.track === 'subs');
export const freeTexts = () => S.project.texts.filter((t) => t.track !== 'subs');
export const fontInfo = (id) => S.fontMap[id] || S.fontMap['Rubik-700'] || S.fonts[0];
export const cssFont = (id) => `f_${(fontInfo(id) || {}).id}`;

export function fmtTime(t, cs = true) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${(cs ? s.toFixed(2) : Math.floor(s).toString()).padStart(cs ? 5 : 2, '0')}`;
}
