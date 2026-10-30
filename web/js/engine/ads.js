// Автореклама: ролики поверх видео. Сколько и когда — считается от длины каждой части (каждая часть —
// отдельное видео) или всего видео. Расстановка — чистая функция проекта: превью и экспорт видят одно и то же,
// а при изменении частей реклама переставляется сама.
import { S, on, parts, duration, subs } from '../store.js';

export const AD_PLACES = { middle: 'В середине', spread: 'Равномерно', start: 'Ближе к началу', end: 'Ближе к концу', random: 'Случайно' };
export const AD_ORDERS = { cycle: 'По очереди', random: 'Случайно' };
export const AD_ANIMS = { pop: 'Выпрыгивает', fade: 'Плавно', slide: 'Выезжает снизу', none: 'Сразу' };
export const AD_MODES = { pip: 'Поверх видео', full: 'На весь экран' };

const FADE = 0.3;
let cache = null, cacheFor = null, version = 0;
on('derived-reset', () => { version++; });

const mediaOf = (id) => S.project.media.find((m) => m.id === id);

/** Детерминированный «случайный» генератор — расстановка не прыгает между превью и экспортом. */
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Сколько роликов в части длиной len: один на каждые per секунд, не меньше min и не больше max. */
export function adCount(len, a = S.project.ads) {
  if (!a || len < (a.minLen || 0)) return 0;
  const lo = Math.max(0, a.min ?? 1), hi = Math.max(lo, a.max ?? 1);
  return Math.max(lo, Math.min(hi, Math.floor(len / Math.max(5, a.per || 60))));
}

/** Моменты, где фраза закончилась (промежутки между субтитрами) — туда реклама встаёт, не перебивая речь. */
function pauseStarts() {
  const list = subs().map((t) => [t.start, t.end]).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const next = list[i + 1]?.[0] ?? Infinity;
    if (next - list[i][1] >= 0.12) out.push(list[i][1] + 0.05);
  }
  return out;
}

/** Скорость ролика рекламы (у фото — всегда 1). */
export const adSpeed = (m, it = {}) => (m?.kind === 'image' ? 1 : Math.max(0.1, Math.min(10, it.speed || 1)));

/** Отрезок ролика без ускорения (секунды исходника). */
export function adSrcLen(m, it = {}) {
  const tin = Math.max(0, it.trimIn || 0);
  const tout = it.trimOut > tin ? Math.min(it.trimOut, m.duration || Infinity) : (m.duration || 0); // своя обрезка ролика
  return Math.max(0.1, tout - tin);
}

/** Длительность ролика в рекламе (с учётом скорости): целиком или не дольше maxDur (у фото — maxDur или 4 с). */
export function adLength(m, it = {}, a = S.project.ads) {
  let d = m.kind === 'image' ? (it.trimOut > 0 ? it.trimOut : a.maxDur || 4) : Math.max(0.3, adSrcLen(m, it) / adSpeed(m, it));
  if (a.maxDur > 0) d = Math.min(d, a.maxDur);
  return d;
}

/** Все вставки рекламы: [{id, part, media, kind, item, start, end, srcIn, w, h}]. */
export function adPlacements() {
  const p = S.project;
  const a = p?.ads;
  if (!a?.enabled || !p.clips.length) return [];
  if (cache && cacheFor === p && cache.v === version) return cache.list;
  const pool = (a.items || []).map((it) => ({ it, m: mediaOf(it.media) })).filter((x) => x.m && x.m.kind !== 'audio');
  const list = [];
  if (pool.length) {
    const spans = a.scope === 'video' ? [{ i: 1, start: 0, end: duration() }] : parts();
    const gaps = a.snap ? pauseStarts() : [];
    const rnd = rng((a.seed || 1) * 7919 + 17);
    let k = 0;
    for (const part of spans) {
      const L = part.end - part.start;
      const n = adCount(L, a);
      let prevEnd = -Infinity;
      for (let j = 0; j < n; j++) {
        const { it, m } = a.order === 'random' ? pool[Math.floor(rnd() * pool.length)] : pool[k % pool.length];
        k++;
        // вставка (видео на паузе) не занимает время видео — ролик любой длины встаёт в точку
        const d = a.pause ? adLength(m, it, a) : Math.min(adLength(m, it, a), (L / n) * 0.9);
        const dd = a.pause ? 0 : d;
        const margin = Math.min(a.at ?? 5, Math.max(0, (L - dd * n) / 2));
        const lo = part.start + margin, hi = part.end - Math.max(margin, a.pause ? 0.1 : 0) - dd;
        if (hi < lo - 1e-6) continue;
        let t;
        switch (a.place) {
          case 'start': t = lo + (j * (hi - lo)) / n; break;
          case 'end': t = hi - ((n - 1 - j) * (hi - lo)) / n; break;
          case 'random': { const w = (hi - lo) / n; t = lo + j * w + rnd() * w; break; }
          default: t = part.start + (L * (j + 1)) / (n + 1) - dd / 2; // середина / равномерно
        }
        // ближайший конец фразы в пределах 3 с
        if (gaps.length) {
          let best = null;
          for (const g of gaps) if (g >= lo && g <= hi && Math.abs(g - t) <= 3 && (best == null || Math.abs(g - t) < Math.abs(best - t))) best = g;
          if (best != null) t = best;
        }
        t = Math.max(lo, Math.min(hi, Math.max(t, prevEnd + 0.5)));
        if (t > hi + 1e-6) continue;
        prevEnd = t + (a.pause ? 2 : d);
        // при вставке start — точка видео, где оно встаёт на паузу; end - start — длина ролика
        list.push({ id: `ad${k}`, part: part.i, media: m.id, kind: m.kind, item: it.id, name: m.name, insert: !!a.pause,
          start: t, end: t + d, srcIn: Math.max(0, it.trimIn || 0), speed: adSpeed(m, it), w: m.width, h: m.height });
      }
    }
  }
  cache = { v: version, list };
  cacheFor = p;
  return list;
}

/** Реклама поверх видео, видимая в момент t (вставки с паузой сюда не входят — см. outTimeline). */
export function adsAt(t) {
  if (S.project.ads?.pause) return [];
  return adPlacements().filter((x) => t >= x.start && t < x.end).map((x) => adState(x, t - x.start));
}

/** Состояние ролика через age секунд от его начала: кадр ролика, анимация появления/исчезания, вид. */
export function adState(x, age) {
  const a = S.project.ads;
  const len = x.end - x.start;
  const pin = Math.min(1, age / FADE), pout = Math.min(1, (len - age) / FADE);
  let scale = 1, alpha = 1, dy = 0;
  const anim = a.mode === 'full' && a.anim !== 'none' ? 'fade' : a.anim;
  if (anim === 'fade') alpha = Math.min(pin, pout);
  else if (anim === 'pop') {
    const back = (q) => { const c = 1.9; return 1 + (c + 1) * (q - 1) ** 3 + c * (q - 1) ** 2; }; // с перелётом
    scale = pin < 1 ? Math.max(0.01, back(pin)) : pout < 1 ? Math.max(0.01, pout * pout * (3 - 2 * pout)) : 1;
    alpha = Math.min(1, pin * 3, pout * 3);
  } else if (anim === 'slide') {
    const e = (q) => 1 - (1 - q) ** 3;
    dy = (1 - e(Math.min(pin, pout))) * S.project.canvas.h * 0.6;
    alpha = Math.min(1, pin * 2, pout * 2);
  }
  return { ...x, age, src: x.srcIn + Math.max(0, Math.min(age, len - 0.001)) * (x.speed || 1), scale, alpha, dy, mode: a.mode, x: a.x, y: a.y, size: a.size,
    radius: a.mode === 'full' ? 0 : a.radius || 0, chroma: a.chroma?.enabled ? a.chroma : null };
}

/** Вставки с паузой видео, которые попадают в отрезок [a, b) (в его точке видео встаёт на паузу). */
export function insertsIn(a, b) {
  if (!S.project.ads?.pause) return [];
  return adPlacements().filter((x) => x.start >= a - 1e-6 && x.start < b - 1e-6);
}

/**
 * Время готового видео для отрезка [a, b) с учётом вставок: длина и что показывать в момент u готового видео —
 * { t: время проекта, ins: вставка или null, age: сколько секунд она уже идёт }. pieces — по порядку: видео / вставка.
 */
export function outTimeline(a, b) {
  const marks = [], pieces = [];
  let cur = a, u = 0;
  for (const x of insertsIn(a, b)) {
    const d = x.end - x.start;
    if (x.start > cur) pieces.push({ type: 'video', from: cur, to: x.start });
    u += x.start - cur;
    marks.push({ x, u0: u, u1: u + d });
    pieces.push({ type: 'ad', x, len: d });
    u += d;
    cur = x.start;
  }
  if (b > cur) pieces.push({ type: 'video', from: cur, to: b });
  const len = u + (b - cur);
  const at = (uu) => {
    let shift = 0;
    for (const m of marks) {
      if (uu < m.u0) break;
      if (uu < m.u1) return { t: m.x.start, ins: m.x, age: uu - m.u0 };
      shift += m.u1 - m.u0;
    }
    return { t: Math.min(b, a + uu - shift), ins: null, age: 0 };
  };
  return { len, at, pieces, inserts: marks.map((m) => m.x) };
}

/** Множитель громкости основного видео: пока идёт реклама — duck (с плавным переходом). */
export function adDuck(t) {
  const a = S.project.ads;
  if (!a?.enabled || a.pause || (a.duck ?? 1) >= 1) return 1;
  let k = 1;
  for (const x of adPlacements()) {
    if (t < x.start - FADE || t > x.end + FADE) continue;
    const inside = Math.min(1, Math.max(0, (t - (x.start - FADE)) / FADE), Math.max(0, (x.end + FADE - t) / FADE));
    k = Math.min(k, 1 - inside * (1 - (a.duck ?? 0.3)));
  }
  return k;
}

/** Громкость самой рекламы в момент t (плавно в начале и в конце). */
export function adGain(x, t) {
  const v = S.project.ads.volume ?? 1;
  return v * Math.max(0, Math.min(1, (t - x.start) / 0.12, (x.end - t) / 0.12));
}

/** Прямоугольник рекламы в кадре (центр и размер в пикселях проекта). */
export function adRect(ad, W, H) {
  if (!ad.w || !ad.h) return null;
  if (ad.mode === 'full') {
    const s = Math.min(W / ad.w, H / ad.h);
    return { cx: W / 2, cy: H / 2, w: ad.w * s, h: ad.h * s };
  }
  let w = (ad.size || 0.6) * W, h = (w * ad.h) / ad.w;
  if (h > H * 0.9) { w *= (H * 0.9) / h; h = H * 0.9; }
  return { cx: (ad.x ?? 0.5) * W, cy: (ad.y ?? 0.74) * H + (ad.dy || 0), w: w * ad.scale, h: h * ad.scale };
}

/** Коротко: сколько рекламы выйдет в каждой части. */
export function adSummary() {
  const list = adPlacements();
  if (!list.length) return '';
  const by = {};
  for (const x of list) by[x.part] = (by[x.part] || 0) + 1;
  return `${list.length} вставок · ${Object.keys(by).length} ${S.project.ads.scope === 'video' ? 'видео' : 'частей'}`;
}

// ---------------------------------------------------------------------------
//   Хромакей: тот же расчёт, что в шейдере (для 2D-движка и проверок)
// ---------------------------------------------------------------------------
export const hexRgb = (hex) => { const n = parseInt(String(hex || '#00ff00').slice(1, 7), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const toUV = (r, g, b) => [r * -0.169 + g * -0.331 + b * 0.5 + 0.5, r * 0.5 + g * -0.419 + b * -0.081 + 0.5];

/** Вырезать цвет у ImageData на месте. */
export function keyImageData(img, ch) {
  const [kr, kg, kb] = hexRgb(ch.color);
  const [ku, kv] = toUV(kr, kg, kb);
  const sim = ch.sim ?? 0.4, smooth = Math.max(0.001, ch.smooth ?? 0.08), spill = Math.max(0.001, ch.spill ?? 0.1);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const [u, v] = toUV(r, g, b);
    const base = Math.hypot(u - ku, v - kv) - sim;
    const mask = Math.pow(Math.min(1, Math.max(0, base / smooth)), 1.5);
    const sp = Math.pow(Math.min(1, Math.max(0, base / spill)), 1.5);
    const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
    d[i] = (l + (r - l) * sp) * 255; d[i + 1] = (l + (g - l) * sp) * 255; d[i + 2] = (l + (b - l) * sp) * 255;
    d[i + 3] *= mask;
  }
  return img;
}

/** Цвет фона для хромакея: самый частый насыщенный цвет по краям кадра. */
export function guessKeyColor(src, w, h) {
  const c = document.createElement('canvas');
  c.width = 48; c.height = Math.max(8, Math.round((48 * h) / w)) || 48;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const bins = {};
  for (let yy = 0; yy < c.height; yy++) {
    for (let xx = 0; xx < c.width; xx++) {
      if (xx > 2 && xx < c.width - 3 && yy > 2 && yy < c.height - 3) continue; // только рамка
      const i = (yy * c.width + xx) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 40) continue; // серое — не фон хромакея
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      (bins[key] ||= { n: 0, r: 0, g: 0, b: 0 }).n++;
      Object.assign(bins[key], { r: bins[key].r + r, g: bins[key].g + g, b: bins[key].b + b });
    }
  }
  const best = Object.values(bins).sort((p, q) => q.n - p.n)[0];
  if (!best) return null;
  // берём только оттенок, насыщенность и яркость — максимальные: иначе вместе с фоном уходят серые и белые
  // детали (как пресеты «зелёный/синий» в OBS)
  const [r, g, b] = [best.r, best.g, best.b].map((v) => v / best.n);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const hx = (v) => Math.round(((v - mn) / (mx - mn || 1)) * 255).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`.toUpperCase();
}
