// Раскладка и отрисовка текста и обложек на 2D-холсте. Этим же кодом рисуются и превью, и экспорт.
import { S, fontInfo, cssFont } from '../store.js';

export const ANIMS_IN = {
  none: 'Нет', fade: 'Проявление', pop: 'Выпрыгивание', bounce: 'Пружина', grow: 'Из точки', zoom: 'Из большого',
  slide: 'Снизу', slidedown: 'Сверху', slideleft: 'Справа', slideright: 'Слева', drop: 'Падение', rotate: 'Поворот',
  blur: 'Из размытия', stretch: 'Растяжение', glitch: 'Глитч', flicker: 'Неон-мигание', flip: 'Переворот', spinin: 'Вращение',
  shakein: 'Встряска', swingin: 'Маятник', typing: 'Печатается (с курсором)', typewriter: 'Печатная машинка',
  words: 'По словам', letters: 'По буквам',
};
export const ANIMS_OUT = {
  none: 'Нет', fade: 'Исчезание', shrink: 'В точку', zoomout: 'В большое', slideup: 'Вверх', slidedown: 'Вниз',
  slideleft: 'Влево', slideright: 'Вправо', drop: 'Падение', rotate: 'Поворот', blur: 'В размытие', flicker: 'Неон-мигание',
  flip: 'Переворот', spinout: 'Вращение', shakeout: 'Встряска', typing: 'Стирается (с курсором)',
  typewriter: 'Стирание', words: 'По словам',
};
export const TYPING_CPS = 15; // букв в секунду по умолчанию
export const ANIMS_LOOP = { none: 'Нет', pulse: 'Пульс', heartbeat: 'Сердцебиение', shake: 'Тряска', jitter: 'Дрожь', wiggle: 'Покачивание',
  swing: 'Маятник', float: 'Парение', blink: 'Мигание', neon: 'Неон', wave: 'Волна' };
const SLIDE_PX = 80, SIDE_PX = 160, DROP_PX = 320;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIn = (x) => x * x * x;
const easeOutBack = (x) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
const elastic = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI) / 3) + 1);
const bounceOut = (x) => {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};
const hash = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const noise = (t, seed) => (Math.sin(t * 1.0 + seed) + Math.sin(t * 2.31 + seed * 1.7) * 0.6 + Math.sin(t * 4.17 + seed * 2.3) * 0.35) / 1.95;

// ---------------------------------------------------------------------------
//   Анимации из описаний (как в CapCut): целиком, по буквам, по словам, по строкам.
//   def: dx/dy — откуда (px кадра), sc/sx/sy — масштаб в начале, rot — поворот (рад), blur, ease, unit, st — доля волны,
//   rnd — случайный порядок, scatter — разлёт в разные стороны (px), fade:false — без проявления.
// ---------------------------------------------------------------------------
const EASE = { out: easeOut, back: easeOutBack, elastic, bounce: bounceOut, in: easeIn, lin: (x) => x };
export const GEN_IN = {}, GEN_OUT = {}, GEN_LOOP = {};
{
  const D4 = [['up', 'Снизу', 0, 130], ['down', 'Сверху', 0, -130], ['left', 'Справа', 170, 0], ['right', 'Слева', -170, 0]];
  const DD = [['ul', 'Снизу справа', 120, 120], ['ur', 'Снизу слева', -120, 120], ['dl', 'Сверху справа', 120, -120], ['dr', 'Сверху слева', -120, -120]];
  const EN = [['back', 'пружина'], ['elastic', 'резинка'], ['bounce', 'отскок']];
  for (const [k, l, dx, dy] of D4) for (const [ek, el] of EN) GEN_IN[`g_${k}_${ek}`] = { label: `${l} (${el})`, dx, dy, ease: ek };
  for (const [k, l, dx, dy] of DD) GEN_IN[`g_${k}`] = { label: l, dx, dy };
  for (const [k, l, dx, dy] of D4) GEN_IN[`g_far_${k}`] = { label: `${l} издалека`, dx: dx * 6, dy: dy * 7, ease: 'out' };
  Object.assign(GEN_IN, {
    g_zoom0el: { label: 'Из точки (резинка)', sc: 0, ease: 'elastic' },
    g_zoombig: { label: 'Из огромного', sc: 4 },
    g_zoombigblur: { label: 'Из огромного с размытием', sc: 3, blur: 25 },
    g_zoomrot: { label: 'Из точки с поворотом', sc: 0, rot: -1.6, ease: 'back' },
    g_stretchup: { label: 'Вытягивание', sy: 0, ease: 'back' },
    g_widen: { label: 'Раскрытие вширь', sx: 0 },
    g_squash: { label: 'Сплющенный', sx: 2.2, sy: 0.2, ease: 'elastic' },
    g_clap: { label: 'Хлопок', sc: 1.6, ease: 'back' },
    g_rotl: { label: 'Поворот слева 90°', rot: -1.57, ease: 'back' },
    g_rotr: { label: 'Поворот справа 90°', rot: 1.57, ease: 'back' },
    g_rot180: { label: 'Переворот 180°', rot: 3.14, sc: 0.5 },
    g_flipx: { label: 'Переворот карточкой', sx: -1 },
    g_tumble: { label: 'Кувырок', rot: -6.28, sc: 0.3 },
    g_blurzoom: { label: 'Проявление с зумом', blur: 20, sc: 1.3 },
    g_blurup: { label: 'Размытие снизу', blur: 18, dy: 80 },
    // по буквам
    l_rise: { label: 'Буквы снизу', unit: 'letters', dy: 60, ease: 'back', st: 0.08 },
    l_drop: { label: 'Буквы падают', unit: 'letters', dy: -140, ease: 'bounce', st: 0.08 },
    l_pop: { label: 'Буквы выпрыгивают', unit: 'letters', sc: 0, ease: 'back', st: 0.06 },
    l_zoom: { label: 'Буквы из большого', unit: 'letters', sc: 3, st: 0.06 },
    l_rot: { label: 'Буквы вращаются', unit: 'letters', rot: -3.14, sc: 0.2, st: 0.07 },
    l_rnd: { label: 'Буквы вразнобой', unit: 'letters', st: 0.05, rnd: true },
    l_rndpop: { label: 'Буквы вразнобой (хлопок)', unit: 'letters', sc: 0, ease: 'back', st: 0.05, rnd: true },
    l_right: { label: 'Буквы справа', unit: 'letters', dx: 90, st: 0.06 },
    l_left: { label: 'Буквы слева', unit: 'letters', dx: -90, st: 0.06 },
    l_elastic: { label: 'Буквы на резинке', unit: 'letters', dy: 80, ease: 'elastic', st: 0.09 },
    l_wave: { label: 'Буквы волной', unit: 'letters', dy: 40, sc: 0.6, ease: 'back', st: 0.12 },
    l_gather: { label: 'Буквы собираются', unit: 'letters', scatter: 240, st: 0.03 },
    // по словам и строкам
    w_rise: { label: 'Слова снизу', unit: 'words', dy: 70, ease: 'back', st: 0.15 },
    w_drop: { label: 'Слова падают', unit: 'words', dy: -150, ease: 'bounce', st: 0.15 },
    w_left: { label: 'Слова слева', unit: 'words', dx: -130, st: 0.15 },
    w_zoom: { label: 'Слова из большого', unit: 'words', sc: 2.5, st: 0.15 },
    w_rot: { label: 'Слова с поворотом', unit: 'words', rot: -1, sc: 0.4, ease: 'back', st: 0.15 },
    w_rnd: { label: 'Слова вразнобой', unit: 'words', st: 0.12, rnd: true },
    w_pop: { label: 'Слова хлопают', unit: 'words', sc: 0, ease: 'elastic', st: 0.18 },
    ln_rise: { label: 'Строки снизу', unit: 'lines', dy: 70, ease: 'back', st: 0.35 },
    ln_side: { label: 'Строки сбоку', unit: 'lines', dx: -220, st: 0.3 },
  });
  // исчезание: те же описания — «куда»
  for (const [k, l, dx, dy] of D4) GEN_OUT[`g_far_${k}`] = { label: `Улетает ${l.toLowerCase().replace('снизу', 'вниз').replace('сверху', 'вверх').replace('справа', 'вправо').replace('слева', 'влево')}`, dx: dx * 6, dy: dy * 7 };
  for (const [k, l, dx, dy] of DD) GEN_OUT[`g_${k}`] = { label: `Уходит: ${l.toLowerCase()}`, dx, dy };
  Object.assign(GEN_OUT, {
    g_bigblur: { label: 'В огромное с размытием', sc: 3, blur: 25 },
    g_dotrot: { label: 'В точку с поворотом', sc: 0, rot: 1.6 },
    g_squash: { label: 'Сплющивается', sy: 0 },
    g_collapse: { label: 'Схлопывается вбок', sx: 0 },
    g_flipx: { label: 'Переворот карточкой', sx: -1 },
    g_rot90: { label: 'Поворот 90°', rot: 1.57, sc: 0.6 },
    g_tumble: { label: 'Кувырок', rot: 6.28, sc: 0.2 },
    l_fall: { label: 'Буквы падают', unit: 'letters', dy: 160, st: 0.05 },
    l_up: { label: 'Буквы улетают вверх', unit: 'letters', dy: -120, st: 0.05 },
    l_rnd: { label: 'Буквы гаснут вразнобой', unit: 'letters', st: 0.05, rnd: true },
    l_scatter: { label: 'Буквы разлетаются', unit: 'letters', scatter: 260, st: 0.03 },
    l_dot: { label: 'Буквы в точку', unit: 'letters', sc: 0, st: 0.05 },
    l_spin: { label: 'Буквы вращаются', unit: 'letters', rot: 3.14, sc: 0, st: 0.05 },
    w_fall: { label: 'Слова падают', unit: 'words', dy: 160, st: 0.15 },
    w_dot: { label: 'Слова в точку', unit: 'words', sc: 0, st: 0.15 },
    w_left: { label: 'Слова улетают влево', unit: 'words', dx: -200, st: 0.15 },
    w_rnd: { label: 'Слова гаснут вразнобой', unit: 'words', st: 0.12, rnd: true },
    ln_up: { label: 'Строки вверх', unit: 'lines', dy: -80, st: 0.3 },
  });
  // циклы: целиком (fn(s, u, scale)) и по буквам/словам (each(un, i, u))
  const sin = Math.sin, PI2 = Math.PI * 2;
  Object.assign(GEN_LOOP, {
    c_breathe: { label: 'Дыхание', fn: (s, u, sc) => sc(1 + 0.04 * sin(PI2 * 0.6 * u)) },
    c_bounce: { label: 'Прыжки', fn: (s, u) => { s.dy -= Math.abs(sin(Math.PI * 1.6 * u)) * 28; } },
    c_spin: { label: 'Вращение', fn: (s, u) => { s.rot += u * 1.2; } },
    c_tilt: { label: 'Наклоны', fn: (s, u) => { s.rot += 0.1 * sin(PI2 * 0.6 * u); } },
    c_pendfast: { label: 'Маятник быстрый', fn: (s, u) => { s.rot += 0.25 * sin(PI2 * 1.8 * u); } },
    c_zoompulse: { label: 'Зум-пульс', fn: (s, u, sc) => sc(1 + 0.12 * Math.max(0, sin(PI2 * 2 * u))) },
    c_strobe: { label: 'Стробоскоп', fn: (s, u) => { s.alpha *= sin(PI2 * 6 * u) > 0 ? 1 : 0.15; } },
    c_sway: { label: 'Покачивание вбок', fn: (s, u) => { s.dx += 18 * sin(PI2 * 0.8 * u); } },
    c_orbit: { label: 'Орбита', fn: (s, u) => { s.dx += 14 * Math.cos(PI2 * u); s.dy += 14 * sin(PI2 * u); } },
    c_jelly: { label: 'Желе', fn: (s, u) => { const k = 0.08 * sin(PI2 * 2 * u); s.sx *= 1 + k; s.sy *= 1 - k; } },
    c_shakehard: { label: 'Сильная тряска', fn: (s, u) => { s.dx += noise(u * 30, 2) * 18; s.dy += noise(u * 30, 8) * 14; s.rot += noise(u * 30, 4) * 0.08; } },
    c_glitch: { label: 'Глитч', fn: (s, u) => { const f = Math.floor(u * 12); if (hash(f) > 0.75) { s.dx += (hash(f + 3) - 0.5) * 40; s.alpha *= 0.6; } } },
    c_rubber: { label: 'Резинка', fn: (s, u) => { s.sx *= 1 + 0.1 * sin(PI2 * 1.3 * u); } },
    c_drift: { label: 'Дрейф', fn: (s, u) => { s.dy += 20 * sin(PI2 * 0.3 * u); s.dx += 10 * Math.cos(PI2 * 0.2 * u); } },
    c_tremble: { label: 'Трепет', fn: (s, u) => { s.rot += 0.03 * sin(PI2 * 7 * u); } },
    c_hop: { label: 'Подскок', fn: (s, u) => { const f = (u % 1.2) / 1.2; if (f < 0.5) s.dy -= sin(Math.PI * f * 2) * 36; } },
    c_grow: { label: 'Медленный рост', fn: (s, u, sc) => sc(1 + Math.min(0.3, 0.05 * u)) },
    c_spin3d: { label: 'Вращение 3D', fn: (s, u) => { s.sx *= Math.cos(PI2 * 0.5 * u); } },
    // по буквам/словам
    u_bounce: { label: 'Буквы прыгают', unit: 'letters', each: (un, i, u) => { un.dy -= Math.abs(sin(PI2 * 0.6 * u - i * 0.3)) * 18; } },
    u_jitter: { label: 'Буквы дрожат', unit: 'letters', each: (un, i, u) => { const f = Math.floor(u * 20); un.dx += (hash(f + i * 7) - 0.5) * 8; un.dy += (hash(f + i * 13 + 3) - 0.5) * 8; } },
    u_wobble: { label: 'Буквы качаются', unit: 'letters', each: (un, i, u) => { un.rot += 0.2 * sin(PI2 * u - i * 0.5); } },
    u_pulse: { label: 'Буквы пульсируют по очереди', unit: 'letters', each: (un, i, u) => { un.scale *= 1 + 0.25 * Math.pow(Math.max(0, sin(PI2 * u - i * 0.4)), 4); } },
    u_rainbow: { label: 'Радуга', unit: 'letters', each: (un, i, u) => { un.color = `hsl(${Math.round(((u * 0.3 + i * 0.07) % 1) * 360)}, 90%, 62%)`; } },
    u_float: { label: 'Буквы парят', unit: 'letters', each: (un, i, u) => { un.dy += 10 * sin(PI2 * 0.6 * u + hash(i) * 6); } },
    u_wordbounce: { label: 'Слова прыгают', unit: 'words', each: (un, i, u) => { un.dy -= Math.abs(sin(PI2 * 0.5 * u - i * 0.6)) * 22; } },
    u_flicker: { label: 'Буквы мерцают', unit: 'letters', each: (un, i, u) => { un.alpha *= hash(Math.floor(u * 12) + i * 3.7) > 0.2 ? 1 : 0.3; } },
  });
}
// подписи в общие списки (их показывает интерфейс)
const labelsOf = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.label]));
Object.assign(ANIMS_IN, labelsOf(GEN_IN));
Object.assign(ANIMS_OUT, labelsOf(GEN_OUT));
Object.assign(ANIMS_LOOP, labelsOf(GEN_LOOP));

/** Сгенерированная анимация целиком: сдвиг/масштаб/поворот/размытие от «откуда» к покою (или от покоя к «куда»). */
function applyGen(s, def, pr, dir) {
  const k = dir === 'in' ? EASE[def.ease || 'out'](pr) : EASE[def.ease || 'in'](1 - pr);
  const w = dir === 'in' ? 1 - k : k; // доля «смещения» от покоя
  s.dx += (def.dx || 0) * w; s.dy += (def.dy || 0) * w;
  if (def.sc != null) { const f = 1 + (def.sc - 1) * w; s.sx *= f; s.sy *= f; }
  if (def.sx != null) s.sx *= 1 + (def.sx - 1) * w;
  if (def.sy != null) s.sy *= 1 + (def.sy - 1) * w;
  s.rot += (def.rot || 0) * w;
  s.blur += (def.blur || 0) * Math.max(0, w);
  if (def.fade !== false) s.alpha *= clamp01(pr * 2.5);
}

/** Перенос по числу символов (как в CapCut-скриптах): ручные переносы сохраняются. */
export function wrapLines(text, maxChars) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!maxChars || words.length <= 1) { out.push(words.join(' ')); continue; }
    let cur = [], len = 0;
    for (const w of words) {
      if (cur.length && len + 1 + w.length > maxChars) { out.push(cur.join(' ')); cur = [w]; len = w.length; }
      else { cur.push(w); len += w.length + (cur.length > 1 ? 1 : 0); }
    }
    if (cur.length) out.push(cur.join(' '));
  }
  return out.length ? out : [''];
}

export function displayText(item) {
  const s = item.style.upper ? String(item.text).toUpperCase() : String(item.text);
  return wrapLines(s, item.style.wrap);
}

/** Метрики так же, как в libass: высота строки = (winAscent + winDescent) / unitsPerEm * кегль. */
export function metrics(style) {
  const f = fontInfo(style.font);
  const size = style.size;
  const gap = size * (style.lineGap || 0); // доп. интервал между строками (доля кегля)
  return { size, lh: size * (f.asc + f.desc) + gap, asc: size * f.asc, gap, font: f };
}

/** Интервалы между словами и буквами (px кадра) — measureText их учитывает. */
function spacing(ctx, st) {
  ctx.wordSpacing = `${st.wordGap || 0}px`;
  ctx.letterSpacing = `${st.letterGap || 0}px`;
}

/**
 * Состояние анимации в момент t (чистая функция времени — превью и экспорт совпадают).
 * Общая часть: {alpha, sx, sy, dx, dy, rot, blur}; посимвольная/пословная — reveal, unit, karaoke.
 */
export function animState(item, t) {
  const a = item.anim || {};
  const dIn = Math.max(0.05, (a.dur || 200) / 1000);
  const dOut = Math.max(0.05, (a.outDur || a.dur || 200) / 1000);
  const u = t - item.start, r = item.end - t;
  const p = clamp01(u / dIn), e = easeOut(p);
  const q = clamp01(r / dOut);            // 1 → полностью видно, 0 — конец
  const s = { alpha: 1, sx: 1, sy: 1, dx: 0, dy: 0, rot: 0, blur: 0, reveal: null, unit: null, karaoke: !!a.karaoke };
  const scale = (k) => { s.sx *= k; s.sy *= k; };

  switch (a.in) {
    case 'fade': s.alpha *= p; break;
    case 'pop': {
      const k1 = 0.6;
      scale(p < k1 ? 0.7 + 0.38 * (p / k1) : 1.08 - 0.08 * ((p - k1) / (1 - k1)));
      s.alpha *= clamp01(p * 2);
      break;
    }
    case 'bounce': scale(Math.max(0, elastic(p))); s.alpha *= clamp01(p * 4); break;
    case 'grow': scale(Math.max(0, easeOutBack(p))); s.alpha *= clamp01(p * 3); break;
    case 'zoom': scale(1.6 - 0.6 * e); s.alpha *= p; break;
    case 'slide': s.dy += SLIDE_PX * (1 - e); s.alpha *= p; break;
    case 'slidedown': s.dy -= SLIDE_PX * (1 - e); s.alpha *= p; break;
    case 'slideleft': s.dx += SIDE_PX * (1 - e); s.alpha *= p; break;
    case 'slideright': s.dx -= SIDE_PX * (1 - e); s.alpha *= p; break;
    case 'drop': s.dy -= DROP_PX * (1 - bounceOut(p)); s.alpha *= clamp01(p * 5); break;
    case 'rotate': s.rot -= 0.7 * (1 - e); scale(0.6 + 0.4 * e); s.alpha *= p; break;
    case 'blur': s.blur += 22 * (1 - e); s.alpha *= p; break;
    case 'stretch': s.sx *= 0.25 + 0.75 * easeOutBack(p); s.sy *= 1.35 - 0.35 * e; s.alpha *= clamp01(p * 3); break;
    case 'glitch':
      if (p < 1) {
        const f = Math.floor(u * 30);
        s.dx += (hash(f) - 0.5) * 60 * (1 - p);
        s.alpha *= hash(f + 7) > 0.35 ? 1 : 0.15;
      }
      break;
    case 'flicker': if (p < 1) s.alpha *= hash(Math.floor(u * 28)) < 0.35 + 0.65 * p ? 1 : 0.08; break;
    case 'flip': s.sy *= Math.max(0, easeOutBack(p)); s.alpha *= clamp01(p * 4); break;
    case 'spinin': s.rot -= (1 - e) * Math.PI * 2; scale(Math.max(0.01, e)); s.alpha *= clamp01(p * 3); break;
    case 'shakein': if (p < 1) { s.dx += Math.sin(u * 75) * 34 * (1 - p); s.rot += Math.sin(u * 55) * 0.08 * (1 - p); } s.alpha *= clamp01(p * 5); break;
    case 'swingin': s.rot += 0.5 * (1 - p) * Math.cos(u * 22); s.alpha *= clamp01(p * 4); break;
    case 'typing': s.reveal = { mode: 'typing', u, r: Infinity }; break;
    case 'typewriter': s.reveal = { mode: 'chars', frac: p }; break;
    case 'words': s.reveal = { mode: 'words', frac: p, timed: true }; break;
    case 'letters': s.reveal = { mode: 'letters', frac: p }; break;
  }

  const k = 1 - q; // насколько «ушло» к концу
  switch (a.out) {
    case 'fade': s.alpha *= q; break;
    case 'shrink': scale(Math.max(0, easeOut(q))); break;
    case 'zoomout': scale(1 + 0.7 * easeIn(k)); s.alpha *= q; break;
    case 'slideup': s.dy -= SLIDE_PX * easeIn(k); s.alpha *= q; break;
    case 'slidedown': s.dy += SLIDE_PX * easeIn(k); s.alpha *= q; break;
    case 'slideleft': s.dx -= SIDE_PX * easeIn(k); s.alpha *= q; break;
    case 'slideright': s.dx += SIDE_PX * easeIn(k); s.alpha *= q; break;
    case 'drop': s.dy += DROP_PX * k * k; s.rot += 0.3 * k * k; s.alpha *= clamp01(q * 1.5); break;
    case 'rotate': s.rot += 0.7 * easeIn(k); scale(1 - 0.4 * easeIn(k)); s.alpha *= q; break;
    case 'blur': s.blur += 22 * easeIn(k); s.alpha *= q; break;
    case 'flicker': if (q < 1) s.alpha *= hash(Math.floor(r * 28) + 7) < q * 0.9 ? 1 : 0.06; break;
    case 'flip': s.sy *= Math.max(0, easeOut(q)); break;
    case 'spinout': s.rot += easeIn(k) * Math.PI * 2; scale(Math.max(0.01, 1 - easeIn(k))); break;
    case 'shakeout': if (q < 1) { s.dx += Math.sin(r * 75) * 34 * k; s.rot += Math.sin(r * 55) * 0.08 * k; } s.alpha *= clamp01(q * 3); break;
    case 'typing': s.reveal = { mode: 'typing', u: s.reveal?.mode === 'typing' ? u : Infinity, r }; break;
    case 'typewriter': if (q < 1) s.reveal = { mode: 'chars', frac: Math.min(s.reveal?.frac ?? 1, q) }; break;
    case 'words': if (q < 1) s.reveal = { mode: 'words', frac: Math.min(s.reveal?.frac ?? 1, q), out: true }; break;
  }

  // сгенерированные анимации (по буквам/словам/строкам — через reveal 'gen', целиком — сразу)
  const gin = GEN_IN[a.in], gout = GEN_OUT[a.out];
  if (gin) { if (gin.unit) s.reveal = { mode: 'gen', def: gin, frac: p, dir: 'in' }; else applyGen(s, gin, p, 'in'); }
  if (gout && q < 1) { if (gout.unit) s.reveal = { mode: 'gen', def: gout, frac: q, dir: 'out' }; else applyGen(s, gout, q, 'out'); }

  // цикл, пока текст на экране
  const ls = a.loopSpeed || 1;
  const gl = GEN_LOOP[a.loop];
  if (gl?.fn) gl.fn(s, u * ls, scale);
  else if (gl?.each) s.unitLoop = gl;
  switch (a.loop) {
    case 'pulse': scale(1 + 0.07 * Math.sin(2 * Math.PI * u * 1.6 * ls)); break;
    case 'shake': s.dx += noise(u * 18 * ls, 1) * 7; s.dy += noise(u * 18 * ls, 5) * 5; s.rot += noise(u * 18 * ls, 9) * 0.035; break;
    case 'wiggle': s.rot += 0.09 * Math.sin(2 * Math.PI * u * 1.3 * ls); break;
    case 'float': s.dy += 12 * Math.sin(2 * Math.PI * u * 0.7 * ls); break;
    case 'blink': s.alpha *= Math.sin(2 * Math.PI * u * 1.5 * ls) > -0.3 ? 1 : 0.25; break;
    case 'wave': s.unit = 'wave'; break;
    case 'neon': s.alpha *= hash(Math.floor(u * 14 * ls)) < 0.88 ? 1 : 0.3; break;
    case 'heartbeat': { const f = (u * 1.2 * ls) % 1; scale(1 + 0.1 * Math.exp(-f * 14) + 0.07 * Math.exp(-Math.max(0, f - 0.22) * 14) * (f > 0.22 ? 1 : 0)); break; }
    case 'jitter': { const f = Math.floor(u * 24 * ls); s.dx += (hash(f) - 0.5) * 7; s.dy += (hash(f + 50) - 0.5) * 7; break; }
    case 'swing': s.rot += 0.16 * Math.sin(2 * Math.PI * u * 0.9 * ls); break;
  }
  s.alpha = Math.max(0, Math.min(1, s.alpha));
  return s;
}

/** Слова строки с позициями (с учётом кернинга — через ширину префикса). */
function units(ctx, line, mode) {
  const out = [];
  if (mode === 'lines') return line.trim() ? [{ text: line, x: 0, w: ctx.measureText(line).width }] : []; // строка целиком
  const re = mode === 'chars' || mode === 'letters' ? /\S/gu : /\S+/g;
  let m;
  while ((m = re.exec(line))) {
    out.push({ text: m[0], x: ctx.measureText(line.slice(0, m.index)).width, w: ctx.measureText(m[0]).width });
  }
  return out;
}

/**
 * «Печатается»: момент появления каждой буквы (от начала текста). Ритм живой, как у человека:
 * немного неровный, с паузой на пробеле и после знаков препинания. Зависит только от текста — так же считается и звук печати.
 */
export function typingTimes(lines, cps = TYPING_CPS) {
  const base = 1 / Math.max(1, cps);
  const times = [];
  let acc = 0, prev = null;
  lines.forEach((line, li) => {
    const re = /\S/gu;
    let m;
    while ((m = re.exec(line))) {
      if (prev !== null) {
        acc += base * (0.7 + 0.6 * hash(times.length * 1.37));
        if (m.index === 0 ? li > 0 : /\s/.test(line[m.index - 1])) acc += base * 0.8;
        if (/[.,!?…:;]/.test(prev)) acc += base * 2.2;
      }
      times.push(acc);
      prev = m[0];
    }
  });
  return { times, total: acc + base, base };
}

/** Время появления каждого слова: по таймингам Whisper (субтитры) или равномерно. */
function wordTimes(item, nWords) {
  const w = item.w;
  if (Array.isArray(w) && w.length === nWords) return w;
  const d = item.end - item.start;
  return Array.from({ length: nWords }, (_, i) => [d * i / nWords, d * (i + 1) / nWords]);
}

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
};

let shadowCanvas = null;

// ---------------------------------------------------------------------------
//   Переписка: пузыри сообщений как в мессенджере, появляются по одному
// ---------------------------------------------------------------------------
const CHAT = { mine: '#2F6BFF', other: '#26272B', text: '#FFFFFF', meta: 'rgba(255,255,255,0.55)', bar: '#1B1C1F', hint: 'rgba(255,255,255,0.4)' };

/** Сообщения из текста: строка — сообщение, «>» в начале — своё (справа, синее). */
export const chatMessages = (text) => String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
  .map((s) => ({ mine: s.startsWith('>'), text: s.replace(/^>\s*/, '') }));

function wrapWidth(ctx, text, maxW) {
  const out = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    const next = cur ? cur + ' ' + w : w;
    if (cur && ctx.measureText(next).width > maxW) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

function drawChat(ctx, item, t, k, an) {
  const st = item.style;
  const W = S.project?.canvas.w || 1080, H = S.project?.canvas.h || 1920;
  const size = st.size || 40, fam = `"${cssFont(st.font)}"`;
  const msgs = chatMessages(item.text);
  const BW = W * 0.88, padX = size * 0.55, padY = size * 0.36, gap = size * 0.32, lh = size * 1.22, r = size * 0.62;
  const time = st.chatTime || '11:18';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${size * 0.52}px ${fam}`;
  const timeW = ctx.measureText(time).width + size * 0.3;
  ctx.font = `${size}px ${fam}`;
  const lay = msgs.map((m) => {
    const lines = wrapWidth(ctx, m.text, W * 0.6);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + timeW + (m.mine ? size * 0.6 : 0) + padX * 2;
    return { ...m, lines, w, h: lines.length * lh + padY * 2 };
  });
  const barH = st.chatBar === false ? 0 : size * 1.9;
  const total = lay.reduce((s, m) => s + m.h + gap, 0) + barH;
  // по очереди: всё появляется за первую половину показа, не медленнее ~0,7 с на сообщение
  const dur = item.end - item.start, step = Math.min(0.7, (dur * 0.5) / Math.max(1, lay.length));
  if (st.chatBg) { ctx.globalAlpha = an.alpha; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); }
  ctx.translate((item.x + an.dx) * k, (item.y + an.dy) * k);
  if (an.rot) ctx.rotate(an.rot);
  ctx.scale(k * an.sx, k * an.sy);
  let y = -total / 2;
  lay.forEach((m, i) => {
    const age = t - item.start - i * step;
    const top = y;
    y += m.h + gap;
    if (age < 0) return;
    const e = Math.min(1, age / 0.2);
    const x0 = m.mine ? BW / 2 - m.w : -BW / 2;
    ctx.save();
    ctx.globalAlpha = an.alpha * e;
    // выскакивает от своего края
    const ox = m.mine ? x0 + m.w : x0, oy = top + m.h;
    ctx.translate(ox, oy); ctx.scale(0.85 + 0.15 * easeOutBack(e), 0.85 + 0.15 * easeOutBack(e)); ctx.translate(-ox, -oy);
    ctx.fillStyle = m.mine ? CHAT.mine : CHAT.other;
    ctx.beginPath(); ctx.roundRect(x0, top, m.w, m.h, r); ctx.fill();
    ctx.fillStyle = st.color && st.color !== '#FFFFFF' ? st.color : CHAT.text;
    ctx.font = `${size}px ${fam}`; ctx.textBaseline = 'alphabetic';
    m.lines.forEach((l, j) => ctx.fillText(l, x0 + padX, top + padY + size * 0.95 + j * lh));
    ctx.fillStyle = CHAT.meta;
    ctx.font = `${size * 0.52}px ${fam}`;
    const tx = x0 + m.w - padX - timeW + size * 0.3 - (m.mine ? size * 0.6 : 0);
    ctx.fillText(time, tx, top + m.h - padY * 0.9);
    if (m.mine) ctx.fillText('✓✓', x0 + m.w - padX - size * 0.55, top + m.h - padY * 0.9);
    ctx.restore();
  });
  if (barH) {
    // строка ввода «Сообщение» снизу, как в мессенджере
    const by = total / 2 - barH + gap;
    ctx.globalAlpha = an.alpha;
    ctx.fillStyle = CHAT.bar;
    ctx.beginPath(); ctx.roundRect(-BW / 2, by, BW, barH - gap, (barH - gap) / 2); ctx.fill();
    ctx.fillStyle = CHAT.hint;
    ctx.font = `${size * 0.9}px ${fam}`;
    ctx.fillText('Сообщение', -BW / 2 + size * 1.6, by + (barH - gap) / 2 + size * 0.32);
    ctx.strokeStyle = CHAT.hint; ctx.lineWidth = size * 0.08;
    ctx.beginPath(); ctx.arc(-BW / 2 + size * 0.8, by + (barH - gap) / 2, size * 0.32, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  return { x: item.x - BW / 2, y: item.y - total / 2, w: BW, h: total };
}

/** Рисует элемент на ctx. k — масштаб предпросмотра (пикселей экрана на пиксель кадра 1080×1920). */
export function drawItem(ctx, item, t, k) {
  const st = item.style;
  if (st.chat) {
    const an0 = animState(item, t);
    return an0.alpha <= 0.001 ? null : drawChat(ctx, item, t, k, an0);
  }
  const lines = displayText(item);
  const m = metrics(st);
  const an = animState(item, t);
  if (an.alpha <= 0.001) return null;
  ctx.save();
  ctx.font = `${m.size}px "${cssFont(st.font)}"`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  spacing(ctx, st);
  const widths = lines.map((l) => ctx.measureText(l).width);
  const blockH = m.lh * lines.length - m.gap;
  const top = -blockH / 2;

  // пословная/побуквенная отрисовка — для печатной машинки, «по словам», волны и караоке
  const mode = an.reveal?.mode || (an.unit === 'wave' || an.karaoke ? 'words' : an.unitLoop ? 'loop' : null);
  let U = null, caret = null;
  if (mode) {
    // на какие кусочки делить: сгенерированные анимации и циклы знают сами (буквы/слова/строки)
    const unitOf = (def) => (def.unit === 'words' ? 'words' : def.unit === 'lines' ? 'lines' : 'chars');
    const um = mode === 'gen' ? unitOf(an.reveal.def) : mode === 'loop' ? unitOf(an.unitLoop) : mode === 'words' ? 'words' : 'chars';
    U = lines.map((l) => units(ctx, l, um));
    const all = U.flat();
    const n = all.length;
    const u = t - item.start;
    const times = um === 'words' ? wordTimes(item, n) : null;
    let vis = n, tp = null;
    if (mode === 'typing') {
      const rv = an.reveal, a = item.anim || {};
      tp = typingTimes(lines, a.cps || TYPING_CPS);
      const typed = rv.u === Infinity ? n : tp.times.filter((x) => x <= rv.u).length;
      // стирание с конца: вдвое быстрее печати, заканчивается чуть раньше конца текста
      const dt = tp.base / 2;
      const deleted = rv.r === Infinity ? 0 : Math.max(0, Math.min(n, Math.ceil((n * dt + 0.1 - rv.r) / dt)));
      vis = Math.max(0, Math.min(typed, n - deleted));
      if (a.caret !== false) {
        const busy = (typed < n && rv.u !== Infinity) || (deleted > 0 && deleted < n);
        let line = 0, x = 0;
        if (vis > 0) {
          let k = vis - 1;
          while (k >= U[line].length) { k -= U[line].length; line++; }
          x = U[line][k].x + U[line][k].w + m.size * 0.04;
        }
        caret = { line, x, on: busy || u % 1.06 < 0.6 }; // пока печатает — горит, потом мигает
      }
    }
    const timed = um === 'words' && Array.isArray(item.w) && item.w.length === n;
    let cur = -1;
    if (an.karaoke && times) cur = times.findIndex(([ws, we], i) => u >= ws && (u < we || (times[i + 1] ? u < times[i + 1][0] : true)));
    all.forEach((un, i) => {
      un.alpha = 1; un.dy = 0; un.dx = 0; un.rot = 0; un.scale = 1; un.color = null;
      const rv = an.reveal;
      if (rv?.mode === 'gen') {
        // по очереди (или вразнобой): у каждого кусочка свой отрезок, волна — доля st
        const def = rv.def, st = def.st ?? 0.08;
        const order = def.rnd ? hash(i * 5.17 + 0.3) * (n - 1) : i;
        const l = clamp01(rv.frac * (1 + st * (n - 1)) - order * st);
        const kk = rv.dir === 'in' ? EASE[def.ease || 'out'](l) : EASE[def.ease || 'in'](1 - l);
        const w = rv.dir === 'in' ? 1 - kk : kk;
        un.alpha = def.fade === false ? (l > 0 ? 1 : 0) : clamp01(l * 2.5);
        un.dx = (def.dx || 0) * w + (def.scatter ? (hash(i * 3.1) - 0.5) * 2 * def.scatter * w : 0);
        un.dy = (def.dy || 0) * w + (def.scatter ? (hash(i * 7.3) - 0.5) * 2 * def.scatter * w : 0);
        un.scale = def.sc != null ? Math.max(0, 1 + (def.sc - 1) * w) : 1;
        un.rot = (def.rot || 0) * w;
      } else if (rv?.mode === 'typing') {
        un.alpha = i < vis ? 1 : 0;
        const age = rv.u - tp.times[i]; // только что напечатанная буква чуть «выстреливает»
        if (i < vis && age >= 0 && age < 0.08) un.scale = 1 + 0.22 * (1 - age / 0.08);
      } else if (rv?.mode === 'chars') un.alpha = i < Math.floor(rv.frac * n + 1e-6) ? 1 : 0;
      else if (rv?.mode === 'letters') { const l = clamp01((rv.frac * (n + 2) - i) / 2); un.alpha = l; un.dy = 22 * (1 - easeOut(l)); } // буквы проявляются внахлёст
      else if (rv?.mode === 'words') {
        let l;
        if (rv.out) l = clamp01(rv.frac * n - (n - 1 - i));
        else if (timed && (item.anim?.in === 'words')) l = clamp01((u - times[i][0]) / 0.14);
        else l = clamp01(rv.frac * n - i);
        un.alpha = l;
        un.scale = l < 1 ? 0.55 + 0.45 * easeOutBack(l) : 1;
      }
      if (an.unit === 'wave') un.dy += 14 * Math.sin(2 * Math.PI * (u * 1.4 * (item.anim?.loopSpeed || 1) - i * 0.18));
      if (an.unitLoop) an.unitLoop.each(un, i, u * (item.anim?.loopSpeed || 1));
      if (i === cur) { un.color = item.anim?.hlColor || '#FFE14D'; un.scale *= 1.07; } // сильнее — наезжает на соседние слова
    });
  }

  const paint = (c, mode) => {
    // mode: 'shadow' — силуэт цветом тени; 'main' — сам текст
    const baseAlpha = c.globalAlpha;
    lines.forEach((line, i) => {
      const yTop = top + i * m.lh;
      const base = yTop + m.asc;
      const lx = -widths[i] / 2;
      if (st.box) {
        let w = widths[i];
        if (U) {
          const vis = U[i].filter((un) => un.alpha > 0.02);
          w = vis.length ? Math.max(...vis.map((un) => un.x + un.w)) : 0;
          if (caret?.on && caret.line === i) w = Math.max(w, caret.x + m.size * 0.09);
        }
        if (w > 0) {
          const pad = st.boxPad;
          c.fillStyle = mode === 'shadow' ? st.shadowColor : hexA(st.boxColor, st.boxAlpha);
          c.fillRect(lx - pad, yTop - pad, w + 2 * pad, m.lh + 2 * pad);
        }
      }
      const stroke = !st.box && st.strokeWidth > 0;
      if (stroke) { c.lineWidth = st.strokeWidth * 2; c.strokeStyle = mode === 'shadow' ? st.shadowColor : st.strokeColor; }
      if (!U) {
        if (stroke) c.strokeText(line, lx, base);
        c.fillStyle = mode === 'shadow' ? st.shadowColor : st.color;
        c.fillText(line, lx, base);
        return;
      }
      for (const un of U[i]) {
        if (un.alpha <= 0.01) continue;
        c.save();
        c.globalAlpha = baseAlpha * un.alpha;
        const ux = lx + un.x + (un.dx || 0);
        const cx = ux + un.w / 2, cy = base - m.size * 0.35 + un.dy;
        c.translate(cx, cy);
        if (un.rot) c.rotate(un.rot);
        c.scale(un.scale, un.scale);
        c.translate(-cx, -cy);
        if (stroke) c.strokeText(un.text, ux, base + un.dy);
        c.fillStyle = mode === 'shadow' ? st.shadowColor : un.color || st.color;
        c.fillText(un.text, ux, base + un.dy);
        c.restore();
      }
      if (caret?.on && caret.line === i) {
        const cw = Math.max(3, m.size * 0.075);
        c.fillStyle = mode === 'shadow' ? st.shadowColor : st.color;
        if (stroke) c.strokeRect(lx + caret.x, base - m.size * 0.8, cw, m.size * 0.98);
        c.fillRect(lx + caret.x, base - m.size * 0.8, cw, m.size * 0.98);
      }
    });
  };

  const setup = (c) => {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.translate((item.x + an.dx) * k, (item.y + an.dy) * k);
    if (an.rot) c.rotate(an.rot);
    c.scale(k * an.sx, k * an.sy);
    c.font = ctx.font; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
    spacing(c, st);
    c.filter = an.blur > 0.3 ? `blur(${(an.blur * k).toFixed(2)}px)` : 'none';
  };

  // Тень: силуэт рисуется непрозрачно на отдельный холст и накладывается с прозрачностью — как в libass
  if (st.shadowAlpha > 0 && st.shadowDist > 0) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    if (!shadowCanvas) shadowCanvas = document.createElement('canvas');
    if (shadowCanvas.width !== W || shadowCanvas.height !== H) { shadowCanvas.width = W; shadowCanvas.height = H; }
    const sc = shadowCanvas.getContext('2d');
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, W, H);
    setup(sc);
    sc.translate(st.shadowDist, st.shadowDist);
    sc.globalAlpha = 1;
    paint(sc, 'shadow');
    sc.filter = 'none';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = an.alpha * st.shadowAlpha;
    ctx.drawImage(shadowCanvas, 0, 0);
  }
  ctx.globalAlpha = an.alpha;
  setup(ctx);
  paint(ctx, 'main');
  ctx.filter = 'none';
  ctx.restore();

  // Рамка для выделения и перетаскивания (в координатах кадра, без учёта анимации)
  const pad = st.box ? st.boxPad : st.strokeWidth;
  const w = Math.max(...widths) + pad * 2;
  return { x: item.x - w / 2, y: item.y + top - pad, w, h: blockH + pad * 2 };
}

/** Рамка без отрисовки (для попадания мышью). */
export function measureItem(ctx, item) {
  const st = item.style;
  if (st.chat) { const W = S.project?.canvas.w || 1080, h = chatMessages(item.text).length * st.size * 1.95 + st.size * 1.9; return { x: item.x - W * 0.44, y: item.y - h / 2, w: W * 0.88, h }; }
  const lines = displayText(item);
  const m = metrics(st);
  ctx.save();
  ctx.font = `${m.size}px "${cssFont(st.font)}"`;
  spacing(ctx, st);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.restore();
  const pad = st.box ? st.boxPad : st.strokeWidth;
  const h = m.lh * lines.length - m.gap;
  return { x: item.x - w / 2 - pad, y: item.y - h / 2 - pad, w: w + 2 * pad, h: h + 2 * pad };
}

/** Загружает все шрифты в браузер (FontFace API). base — откуда брать файлы шрифтов. */
export async function loadFonts(base = 'fonts/') {
  await Promise.all(S.fonts.map(async (f) => {
    try {
      const face = new FontFace(`f_${f.id}`, `url(${base}${encodeURIComponent(f.file)})`);
      await face.load();
      document.fonts.add(face);
    } catch (e) {
      console.warn('шрифт не загрузился', f.file, e);
    }
  }));
}
