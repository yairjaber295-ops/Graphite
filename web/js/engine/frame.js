// Что показывать в момент t: клипы (один или два при переходе), эффекты, тексты, обложка.
// Чистые функции от проекта — превью и экспорт считают кадр одинаково.
import { S, clipsTL, renderItems, parts, seriesTitle } from '../store.js';
import { TRANSITIONS, evalEffects } from './effects.js';
import { srcOffset } from './speed.js';
import { adsAt, adDuck, adState } from './ads.js';

const mediaDur = (mid) => S.project.media.find((m) => m.id === mid)?.duration ?? Infinity;

/** Длительность перехода в клип j (не длиннее соседних клипов). */
export function transitionDur(list, j) {
  const c = list[j];
  if (!c || j === 0 || !c.transition || c.transition.type === 'none') return 0;
  const a = list[j - 1];
  return Math.max(0, Math.min(c.transition.dur || 0.5, (a.end - a.start) * 0.9, (c.end - c.start) * 0.9));
}

export function srcTime(clip, t) {
  const fps = S.project.canvas.fps;
  return Math.max(0, Math.min(clip.in + srcOffset(clip, t - clip.start), mediaDur(clip.media) - 1 / fps));
}

/** Плавное движение кадра (для фото и не только): наезд, отъезд, панорама. */
export const MOTIONS = { none: 'Нет', zoomin: 'Медленный наезд', zoomout: 'Медленный отъезд', panleft: 'Панорама влево', panright: 'Панорама вправо' };
function withMotion(c, t) {
  if (!c.motion || c.motion === 'none') return c;
  const p = Math.max(0, Math.min(1, (t - c.start) / Math.max(0.1, c.end - c.start)));
  const e = p * p * (3 - 2 * p) * 0.6 + p * 0.4; // мягкий старт и финиш
  const s = c.scale ?? 1, W = S.project.canvas.w;
  switch (c.motion) {
    case 'zoomin': return { ...c, scale: s * (1 + 0.14 * e) };
    case 'zoomout': return { ...c, scale: s * (1.14 - 0.14 * e) };
    case 'panleft': return { ...c, scale: s * 1.15, x: (c.x || 0) + W * s * 0.065 * (1 - 2 * e) };
    case 'panright': return { ...c, scale: s * 1.15, x: (c.x || 0) - W * s * 0.065 * (1 - 2 * e) };
    default: return c;
  }
}

/** Слои кадра: [{clip, src}] и переход {kind, p} или null. */
export function layersAt(t) {
  const L = layersRaw(t);
  for (const l of L.layers) l.clip = withMotion(l.clip, t);
  return L;
}

function layersRaw(t) {
  const list = clipsTL();
  if (!list.length) return { layers: [], trans: null };
  let i = list.findIndex((c) => t >= c.start && t < c.end);
  if (i < 0) i = t < list[0].start ? 0 : list.length - 1;
  // переход в текущий клип (в его начале) или в следующий (в конце текущего)
  for (const j of [i, i + 1]) {
    const d = transitionDur(list, j);
    if (!d) continue;
    const b = list[j].start;
    if (t >= b - d / 2 && t < b + d / 2) {
      const A = list[j - 1], B = list[j];
      return {
        layers: [{ clip: A, src: srcTime(A, t) }, { clip: B, src: srcTime(B, t) }],
        trans: { kind: TRANSITIONS[B.transition.type]?.kind ?? 1, p: (t - (b - d / 2)) / d, type: B.transition.type },
      };
    }
  }
  return { layers: [{ clip: list[i], src: srcTime(list[i], t) }], trans: null };
}

/** Всё, что нужно для рисования обложки/карточки этой части. */
export function coverInfo(part, style = S.project.covers.style) {
  const c = S.project.covers;
  return { style, title: (style === 'reddit' && c.cardText?.trim()) || seriesTitle(), label: part.n > 1 ? part.label : '',
    partNo: part.n > 1 ? part.i : 0, final: part.n > 1 && part.i === part.n,
    font: c.font, accent: c.accent, avatar: c.avatar, nick: c.nick, theme: c.theme };
}

/** Обложка части, если t — её первый кадр. */
export function coverAt(t) {
  const p = S.project;
  if (!p.covers.enabled) return null;
  const ps = parts();
  if (ps.length < 2) return null;
  const f = 1 / p.canvas.fps;
  const part = ps.find((x) => t >= x.start - 1e-6 && t < x.start + f * 0.999);
  if (!part) return null;
  return coverInfo(part);
}

/** Карточка истории поверх видео в первые секунды каждой части (стиль «Reddit-история»). */
export function cardAt(t) {
  const c = S.project.covers;
  if (!c.card?.enabled || c.style !== 'reddit') return null;
  const part = parts().find((x) => t >= x.start && t < x.end);
  if (!part) return null;
  const age = t - part.start, dur = Math.min(c.card.dur || 3, part.end - part.start);
  if (age >= dur) return null;
  return { ...coverInfo(part), age, dur, y: c.card.y ?? 0.5 };
}

/** Полное описание кадра (без самих картинок). */
export function frameAt(t, { withCover = true } = {}) {
  const { layers, trans } = layersAt(t);
  const card = cardAt(t);
  const ads = adsAt(t);
  // пока карточка (или реклама, если так настроено) на экране, субтитры и заголовок не мешают
  const hide = (card && S.project.covers.card.hideSubs !== false) || (ads.length && S.project.ads.hideSubs);
  return {
    t,
    layers,
    trans,
    ads,
    bg: S.project.background,
    fx: evalEffects(S.project.effects, t),
    texts: renderItems().filter((it) => t >= it.start && t < it.end && String(it.text).trim() && !(hide && (it.kind === 'sub' || it.kind === 'header')))
      .sort((a, b) => a.layer - b.layer),
    card,
    cover: withCover ? coverAt(t) : null,
  };
}

/** Кадр вставки: видео стоит на кадре ins.start, поверх идёт ролик (age секунд от его начала). */
export function insertFrame(ins, age) {
  const f = frameAt(ins.start, { withCover: false });
  f.ads = [adState(ins, age)];
  f.frozen = true;
  if (S.project.ads.hideSubs) f.texts = f.texts.filter((it) => it.kind !== 'sub' && it.kind !== 'header');
  return f;
}

/** Громкость клипа в момент t с учётом перехода (кроссфейд звука). */
export function clipGain(clip, t) {
  const list = clipsTL();
  const j = list.findIndex((c) => c.id === clip.id);
  let g = clip.volume ?? 1;
  const dIn = transitionDur(list, j);
  if (dIn && t < clip.start + dIn / 2) g *= Math.max(0, Math.min(1, (t - (clip.start - dIn / 2)) / dIn));
  const dOut = transitionDur(list, j + 1);
  if (dOut && t > clip.end - dOut / 2) g *= Math.max(0, Math.min(1, ((clip.end + dOut / 2) - t) / dOut));
  return g * adDuck(t); // пока идёт реклама — видео тише
}

/** Окно, в котором клип виден (с учётом переходов на краях). */
export function clipWindow(list, j) {
  const c = list[j];
  return [c.start - transitionDur(list, j) / 2, c.end + transitionDur(list, j + 1) / 2];
}
