// Наложение: видео и фото поверх основного видео (мемы, реакции, «картинка в картинке»).
// Рисуется тем же путём, что реклама поверх видео (drawAds в обоих движках), поэтому превью и экспорт
// показывают одно и то же. Слой (track) — порядок: больше — выше; на таймлайне верхний слой — верхняя дорожка.
import { S, clamp } from '../store.js';

const mediaOf = (id) => S.project.media.find((m) => m.id === id);
const isImage = (it) => mediaOf(it.media)?.kind === 'image';

export const pipSpeed = (it) => (isImage(it) ? 1 : clamp(it.speed || 1, 0.1, 10));
/** Длина на таймлайне (секунды проекта). */
export const pipLen = (it) => Math.max(0.1, ((it.out ?? 0) - (it.in ?? 0)) / pipSpeed(it));
export const pipEnd = (it) => it.start + pipLen(it);

/** Слои снизу вверх (внутри одного слоя — по порядку добавления). */
export function pipsSorted(p = S.project) {
  return (p.pips || []).map((x, i) => [x, i]).sort((a, b) => (a[0].track || 0) - (b[0].track || 0) || a[1] - b[1]).map((x) => x[0]);
}

/** Прозрачность с учётом плавного появления/исчезания. */
function fadeK(it, age, len) {
  let k = 1;
  if (it.fadeIn > 0) k = Math.min(k, age / it.fadeIn);
  if (it.fadeOut > 0) k = Math.min(k, (len - age) / it.fadeOut);
  return clamp(k, 0, 1);
}

/** Громкость звука наложения через age секунд от его начала (плавные края, чтобы без щелчков). */
export function pipGain(x, age) {
  const len = x.end - x.start;
  return (x.volume ?? 1) * fadeK(x, age, len) * clamp(Math.min(age / 0.03, (len - age) / 0.03), 0, 1);
}

/** Как наложение выглядит в момент t: тот же вид, что у рекламы (adRect / drawAds), плюс pip: true. */
function stateOf(it, t) {
  const m = mediaOf(it.media);
  if (!m) return null;
  const sp = pipSpeed(it), len = pipLen(it), age = t - it.start;
  const fps = S.project.canvas.fps || 30;
  const src = m.kind === 'image' ? 0 : clamp((it.in || 0) + age * sp, 0, Math.max(0, (m.duration || Infinity) - 1 / fps));
  return {
    id: 'pip' + it.id, pipId: it.id, pip: true, media: it.media, kind: m.kind, name: m.name,
    start: it.start, end: it.start + len, age, src, srcIn: it.in || 0, speed: sp, w: m.width, h: m.height,
    volume: it.volume ?? 1, fadeIn: it.fadeIn || 0, fadeOut: it.fadeOut || 0,
    scale: 1, dy: 0, alpha: (it.opacity ?? 1) * fadeK(it, age, len), mode: 'pip',
    x: it.x ?? 0.5, y: it.y ?? 0.5, size: it.size ?? 0.5, rot: it.rot || 0, flip: !!it.flip,
    radius: it.radius || 0, chroma: it.chroma?.enabled ? it.chroma : null,
  };
}

/** Наложения на экране в момент t, снизу вверх. */
export function pipsAt(t) {
  const out = [];
  for (const it of pipsSorted()) {
    if (t < it.start || t >= pipEnd(it)) continue;
    const s = stateOf(it, t);
    if (s && s.alpha > 0.001) out.push(s);
  }
  return out;
}

/** Все наложения с их отрезками (для сведения звука). */
export function pipPlacements() {
  return pipsSorted().map((it) => stateOf(it, it.start)).filter(Boolean);
}

// ---------------------------------------------------------------------------
//   Слои
// ---------------------------------------------------------------------------
const overlaps = (a, b) => a.id !== b.id && a.start < pipEnd(b) - 1e-6 && b.start < pipEnd(a) - 1e-6;

/** Свободный слой над всем, что идёт в это же время (новое наложение — сверху). */
export function topTrackFor(p, start, end) {
  let top = -1;
  for (const x of p.pips || []) if (x.start < end - 1e-6 && start < pipEnd(x) - 1e-6) top = Math.max(top, x.track || 0);
  return top + 1;
}

/** Номера слоёв подряд с нуля (пустые убираются). */
export function compactTracks(p) {
  const used = [...new Set((p.pips || []).map((x) => x.track || 0))].sort((a, b) => a - b);
  for (const x of p.pips || []) x.track = used.indexOf(x.track || 0);
}

/** После перетаскивания: если наложение налезло на другое в том же слое — поднимается в новый слой над ним. */
export function fixTracks(p, movedIds = []) {
  const list = p.pips || [];
  for (let guard = 0; guard < 200; guard++) {
    const a = list.find((x) => list.some((y) => (y.track || 0) === (x.track || 0) && overlaps(x, y) && movedIds.includes(x.id)))
      || list.find((x) => list.some((y) => (y.track || 0) === (x.track || 0) && overlaps(x, y) && list.indexOf(y) < list.indexOf(x)));
    if (!a) break;
    const t = (a.track || 0) + 1;
    for (const y of list) if (y !== a && (y.track || 0) >= t) y.track = (y.track || 0) + 1;
    a.track = t;
  }
  compactTracks(p);
}

/** Слой выше (dir = 1) или ниже (dir = -1). Возвращает false, если двигать некуда. */
export function moveLayer(p, id, dir) {
  const list = p.pips || [];
  const x = list.find((y) => y.id === id);
  if (!x) return false;
  const cur = x.track || 0, target = cur + dir;
  const busy = (tr) => list.some((y) => (y.track || 0) === tr && overlaps(x, y));
  const anyAbove = list.some((y) => (y.track || 0) > cur && overlaps(x, y));
  const anyBelow = list.some((y) => (y.track || 0) < cur && overlaps(x, y));
  if (dir > 0 && !anyAbove) return false;
  if (dir < 0 && !anyBelow) return false;
  if (!busy(target)) x.track = target;
  else if (dir > 0) {
    // встать прямо над тем, кто на соседнем слое
    for (const y of list) if (y !== x && (y.track || 0) >= target + 1) y.track = (y.track || 0) + 1;
    x.track = target + 1;
  } else {
    // встать прямо под тем, кто на соседнем слое
    for (const y of list) if (y !== x && (y.track || 0) >= target) y.track = (y.track || 0) + 1;
    x.track = target;
  }
  compactTracks(p);
  return true;
}
