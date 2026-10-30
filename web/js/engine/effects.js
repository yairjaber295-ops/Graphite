// Каталог фильтров, переходов и эффектов + расчёт их состояния во времени.
// Всё считается чистыми функциями от времени, поэтому превью и экспорт дают одинаковый кадр.

// ---------------------------------------------------------------------------
//   Фильтры (цвет клипа)
// ---------------------------------------------------------------------------
export const FILTERS = {
  none: { label: 'Без фильтра' },
  vivid: { label: 'Сочный', sat: 0.35, contrast: 0.15 },
  warm: { label: 'Тёплый', temp: 0.55, sat: 0.08 },
  cold: { label: 'Холодный', temp: -0.55, sat: 0.05 },
  cinema: { label: 'Кино', contrast: 0.2, sat: -0.08, teal: 1 },
  dramatic: { label: 'Драма', contrast: 0.38, sat: -0.18, bright: -0.06 },
  bw: { label: 'Ч/Б', sat: -1, contrast: 0.18 },
  vintage: { label: 'Винтаж', sat: -0.3, temp: 0.3, contrast: -0.08, fade: 0.35 },
  fade: { label: 'Выцветший', fade: 0.5, contrast: -0.1, sat: -0.1 },
  neon: { label: 'Неон', sat: 0.6, contrast: 0.22, temp: -0.25 },
  sunset: { label: 'Закат', temp: 0.8, sat: 0.25, contrast: 0.1, bright: 0.03 },
};

export function colorParams(clip) {
  const f = FILTERS[clip.filter] || FILTERS.none;
  const a = clip.adjust || {};
  return {
    bright: (f.bright || 0) + (a.bright || 0),
    contrast: (f.contrast || 0) + (a.contrast || 0),
    sat: (f.sat || 0) + (a.sat || 0),
    temp: (f.temp || 0) + (a.temp || 0),
    fade: f.fade || 0,
    teal: f.teal || 0,
  };
}

// ---------------------------------------------------------------------------
//   Переходы (номер — ветка в FS_TRANS)
// ---------------------------------------------------------------------------
export const TRANSITIONS = {
  none: { label: 'Нет', kind: 0, group: 'Для обычных видео' },
  // как в популярных эдитах: резко, со смазом, через вспышку, в бит (длина 0,25–0,45 с)
  flashburst: { label: 'Вспышка-взрыв', kind: 50, group: 'Для эдитов' },
  zoomburst: { label: 'Зум-рывок', kind: 51, group: 'Для эдитов' },
  spinblur: { label: 'Поворот со смазом', kind: 49, group: 'Для эдитов' },
  swishleft: { label: 'Свайп влево', kind: 52, group: 'Для эдитов' },
  swishright: { label: 'Свайп вправо', kind: 53, group: 'Для эдитов' },
  mirrorwarp: { label: 'Зеркальный разлом', kind: 54, group: 'Для эдитов' },
  irisout: { label: 'Ирис в круг', kind: 55, group: 'Для эдитов' },
  shakecut: { label: 'Тряска-склейка', kind: 56, group: 'Для эдитов' },
  // спокойные — для YouTube, историй, подкастов (длина 0,5–1 с)
  fade: { label: 'Растворение', kind: 1, group: 'Для обычных видео' },
  softzoom: { label: 'Мягкий наезд', kind: 58, group: 'Для обычных видео' },
  lumafade: { label: 'По яркости', kind: 57, group: 'Для обычных видео' },
  black: { label: 'Через чёрный', kind: 2, group: 'Для обычных видео' },
  white: { label: 'Через белый', kind: 41, group: 'Для обычных видео' },
  ink: { label: 'Чернила', kind: 60, group: 'Для обычных видео' },
  flash: { label: 'Вспышка', kind: 3, group: 'Для обычных видео' },
  dissolve: { label: 'Рассыпание', kind: 16, group: 'Для обычных видео' },
  exposure: { label: 'Двойная экспозиция', kind: 42, group: 'Для обычных видео' },
  squeeze: { label: 'Сжатие', kind: 59, group: 'Движение' },
  zoomin: { label: 'Приближение', kind: 4, group: 'Движение' },
  zoomout: { label: 'Отдаление', kind: 5, group: 'Движение' },
  spinzoom: { label: 'Зум с вращением', kind: 19, group: 'Движение' },
  bounce: { label: 'Отскок', kind: 20, group: 'Движение' },
  slideleft: { label: 'Сдвиг влево', kind: 6, group: 'Движение' },
  slideright: { label: 'Сдвиг вправо', kind: 7, group: 'Движение' },
  slideup: { label: 'Сдвиг вверх', kind: 8, group: 'Движение' },
  slidedown: { label: 'Сдвиг вниз', kind: 9, group: 'Движение' },
  whipleft: { label: 'Рывок влево', kind: 10, group: 'Движение' },
  whipright: { label: 'Рывок вправо', kind: 11, group: 'Движение' },
  whipup: { label: 'Рывок вверх', kind: 17, group: 'Движение' },
  whipdown: { label: 'Рывок вниз', kind: 18, group: 'Движение' },
  spin: { label: 'Вращение', kind: 12, group: 'Движение' },
  stretch: { label: 'Растяжение', kind: 21, group: 'Движение' },
  cube: { label: 'Куб', kind: 38, group: 'Движение' },
  flip: { label: 'Переворот', kind: 39, group: 'Движение' },
  slices: { label: 'Полосы', kind: 44, group: 'Движение' },
  circle: { label: 'Круг', kind: 15, group: 'Шторки' },
  iris: { label: 'Затвор', kind: 43, group: 'Шторки' },
  wipeleft: { label: 'Шторка влево', kind: 22, group: 'Шторки' },
  wiperight: { label: 'Шторка вправо', kind: 23, group: 'Шторки' },
  wipeup: { label: 'Шторка вверх', kind: 24, group: 'Шторки' },
  wipedown: { label: 'Шторка вниз', kind: 25, group: 'Шторки' },
  diagonal: { label: 'По диагонали', kind: 26, group: 'Шторки' },
  diamond: { label: 'Ромб', kind: 27, group: 'Шторки' },
  blinds: { label: 'Жалюзи', kind: 28, group: 'Шторки' },
  doors: { label: 'Двери', kind: 29, group: 'Шторки' },
  heart: { label: 'Сердце', kind: 30, group: 'Шторки' },
  letterbox: { label: 'Кино-шторки', kind: 40, group: 'Шторки' },
  glitch: { label: 'Глитч', kind: 13, group: 'Эффектные' },
  impact: { label: 'Удар', kind: 37, group: 'Эффектные' },
  zoomblur: { label: 'Зум-блюр', kind: 31, group: 'Эффектные' },
  rgbsplit: { label: 'RGB-разлом', kind: 33, group: 'Эффектные' },
  pixelize: { label: 'Пиксели', kind: 32, group: 'Эффектные' },
  lightleak: { label: 'Засвет', kind: 36, group: 'Эффектные' },
  ripple: { label: 'Рябь', kind: 34, group: 'Эффектные' },
  swirl: { label: 'Водоворот', kind: 35, group: 'Эффектные' },
  blur: { label: 'Размытие', kind: 14, group: 'Эффектные' },
  // вклейки как в эдитах: следующий клип влетает фигурой поверх текущего и раскрывается
  card: { label: 'Карточка', kind: 45, group: 'Окна' },
  circlecard: { label: 'Окно-круг', kind: 46, group: 'Окна' },
  star: { label: 'Звезда', kind: 47, group: 'Окна' },
  flyaway: { label: 'Улёт карточкой', kind: 48, group: 'Окна' },
};
export const TRANSITION_GROUPS = ['Для эдитов', 'Окна', 'Для обычных видео', 'Движение', 'Шторки', 'Свет и цвет', 'Эффектные'];

// ---------------------------------------------------------------------------
//   Семейства переходов: один шейдер × параметры tp — много вариантов (направления, фигуры, цвета…)
// ---------------------------------------------------------------------------
{
  const PI = Math.PI;
  const fam = (key, label, kind, tp, group) => { TRANSITIONS[key] = { label, kind, tp, group }; };
  const DIR8 = [['→', 0], ['↘', PI / 4], ['↓', PI / 2], ['↙', 3 * PI / 4], ['←', PI], ['↖', -3 * PI / 4], ['↑', -PI / 2], ['↗', -PI / 4]];
  const DIAG = DIR8.filter((_, i) => i % 2);
  const CROSS = DIR8.filter((_, i) => i % 2 === 0);
  DIR8.forEach(([ar, a], i) => fam(`wipesoft${i}`, `Мягкая шторка ${ar}`, 61, [a, 0.14, 0, 0], 'Шторки'));
  DIAG.forEach(([ar, a], i) => fam(`wipediag${i}`, `Шторка ${ar}`, 61, [a, 0.01, 0, 0], 'Шторки'));
  // третье число — «радиус», при котором фигура закрывает весь кадр 9:16 (с запасом)
  [[4, 'шестиугольник', 0.62], [5, 'крест', 0.9], [6, 'треугольник', 1], [7, 'квадрат', 0.58], [1, 'ромб', 0.62], [2, 'звезда', 1.35]]
    .forEach(([sh, name, mul]) => fam(`shape${sh}`, `Фигура: ${name}`, 62, [sh, 0, mul, 0], 'Шторки'));
  [[4, 'шестиугольник', 0.72], [5, 'крест', 1], [6, 'треугольник', 1.15], [7, 'квадрат', 0.75], [2, 'звезда', 1.5], [3, 'сердце', 1.1]]
    .forEach(([sh, name, mul]) => fam(`shapespin${sh}`, `${name[0].toUpperCase() + name.slice(1)} с вращением`, 62, [sh, 2.5, mul, 0], 'Шторки'));
  DIAG.forEach(([ar, a], i) => fam(`pushdiag${i}`, `Сдвиг ${ar}`, 63, [a, 0, 0, 0], 'Движение'));
  DIAG.forEach(([ar, a], i) => fam(`whipdiag${i}`, `Рывок ${ar}`, 63, [a, 0.25, 0, 0], 'Движение'));
  CROSS.forEach(([ar, a], i) => fam(`pushbounce${i}`, `Сдвиг с отскоком ${ar}`, 63, [a, 0, 1, 0], 'Движение'));
  CROSS.forEach(([ar, a], i) => fam(`swishblur${i}`, `Свайп со смазом ${ar}`, 63, [a, 0.3, 0, 0], 'Движение'));
  [['zoomspincw', 'Зум с поворотом ↻', [1.6, 1.2, 0.3]], ['zoomspinccw', 'Зум с поворотом ↺', [1.6, -1.2, 0.3]],
    ['zoomoutspincw', 'Отъезд с поворотом ↻', [-0.7, 1.2, 0.2]], ['zoomoutspinccw', 'Отъезд с поворотом ↺', [-0.7, -1.2, 0.2]],
    ['zoomdeep', 'Глубокий зум', [3, 0, 0.6]], ['zoomoutdeep', 'Глубокий отъезд', [-0.85, 0, 0.4]],
    ['zoomclean', 'Чистый зум', [1.2, 0, 0]], ['zoomoutclean', 'Чистый отъезд', [-0.6, 0, 0]]]
    .forEach(([k, l, t]) => fam(k, l, 64, [...t, 0], 'Движение'));
  [['blindsv6', 'Жалюзи ║ 6', [6, 0, 0]], ['blindsv12', 'Жалюзи ║ 12', [12, 0, 0]], ['blindsh6', 'Жалюзи ═ 6', [6, PI / 2, 0]],
    ['blindsh12', 'Жалюзи ═ 12', [12, PI / 2, 0]], ['blindsdiag', 'Жалюзи по диагонали', [8, PI / 4, 0]],
    ['blindswavev', 'Жалюзи волной ║', [8, 0, 1]], ['blindswaveh', 'Жалюзи волной ═', [8, PI / 2, 1]]]
    .forEach(([k, l, t]) => fam(k, l, 65, [...t, 0], 'Шторки'));
  [['mosaic8', 'Мозаика крупная', [8, 0]], ['mosaic16', 'Мозаика', [16, 0]], ['mosaic32', 'Мозаика мелкая', [32, 0]],
    ['mosaicsweep', 'Мозаика по диагонали', [12, 1]], ['mosaiccenter', 'Мозаика из центра', [12, 2]], ['mosaiccenter24', 'Пиксели из центра', [24, 2]]]
    .forEach(([k, l, t]) => fam(k, l, 66, [...t, 0, 0], 'Шторки'));
  [['panels2v', 'Панели ║ 2', [2, 0]], ['panels3v', 'Панели ║ 3', [3, 0]], ['panels4v', 'Панели ║ 4', [4, 0]],
    ['panels2h', 'Панели ═ 2', [2, 1]], ['panels3h', 'Панели ═ 3', [3, 1]], ['panels5h', 'Панели ═ 5', [5, 1]]]
    .forEach(([k, l, t]) => fam(k, l, 67, [...t, 0, 0], 'Шторки'));
  [['dipred', 'Через красный', [1, 0.1, 0.15]], ['dippink', 'Через розовый', [1, 0.35, 0.7]], ['dipblue', 'Через синий', [0.15, 0.35, 1]],
    ['dippurple', 'Через фиолетовый', [0.55, 0.2, 1]], ['dipgold', 'Через золотой', [1, 0.78, 0.25]], ['dipgreen', 'Через зелёный', [0.2, 0.9, 0.4]],
    ['dipcyan', 'Через бирюзовый', [0.2, 0.9, 1]]].forEach(([k, l, t]) => fam(k, l, 68, [...t, 0], 'Свет и цвет'));
  [['warmflash', 'Тёплая вспышка', [1, 0.8, 0.55, 0]], ['blueflash', 'Синяя вспышка', [0.6, 0.8, 1, 0]], ['pinkflash', 'Розовая вспышка', [1, 0.5, 0.8, 0]],
    ['filmburn', 'Плёнка горит', [1, 0.5, 0.15, 1]], ['blueburn', 'Синий прожиг', [0.3, 0.5, 1, 1]], ['lensbloom', 'Блик линзы', [1, 0.9, 0.7, 2]]]
    .forEach(([k, l, t]) => fam(k, l, 72, t, 'Свет и цвет'));
  ['Глитч блоками', 'Глитч строками', 'Глитч RGB', 'Цифровой шум', 'Вертикальный разрыв'].forEach((l, i) => fam(`glitchx${i}`, l, 69, [i, 0, 0, 0], 'Эффектные'));
  ['Волна', 'Смерч', 'Выпуклость', 'Втягивание', 'Стекает вниз'].forEach((l, i) => fam(`distort${i}`, l, 70, [i, 0, 0, 0], 'Эффектные'));
  [['blurh', 'Смаз ═', 0], ['blurv', 'Смаз ║', PI / 2], ['blurd', 'Смаз по диагонали', PI / 4]].forEach(([k, l, a]) => fam(k, l, 73, [a, 0, 0, 0], 'Движение'));
  fam('stretchw', 'Растяг по ширине', 74, [0, 0, 0, 0], 'Движение');
  fam('stretchh', 'Растяг по высоте', 74, [1, 0, 0, 0], 'Движение');
}

/** Удобная длина перехода по умолчанию: эдитовые — короткие (в бит), спокойные — подлиннее. */
export const transitionDefaultDur = (type) => ({ 'Для эдитов': 0.35, 'Окна': 0.6, 'Для обычных видео': 0.7 })[TRANSITIONS[type]?.group] ?? 0.5;

// ---------------------------------------------------------------------------
//   Эффекты (дорожка «Эффекты»): трансформация кадра и пост-обработка
// ---------------------------------------------------------------------------
const P = (key, label, min, max, step, def) => ({ key, label, min, max, step, def });
const AMOUNT = P('amount', 'Сила', 0, 1, 0.05, 0.6);
const SPEED = P('speed', 'Скорость', 0.2, 3, 0.1, 1);

// envelopes: u — секунд от начала эффекта, d — длительность
const ramp = (u, d, a = 0.08) => Math.max(0, Math.min(1, u / a, (d - u) / a));
const pulse = (u, d) => Math.exp(-u * 7 / Math.max(0.15, d)) * Math.min(1, u / 0.02);
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

// гладкий «шум» без библиотек: сумма синусов с некратными частотами
const noise = (t, seed) => (Math.sin(t * 1.0 + seed) + Math.sin(t * 2.31 + seed * 1.7) * 0.6 + Math.sin(t * 4.17 + seed * 2.3) * 0.35) / 1.95;
const hash1 = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
/** HSV → [r, g, b] (0…1). */
const hsv = (h, s, v) => [5, 3, 1].map((n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); });

export const EFFECTS = {
  shake: { label: 'Тряска', group: 'Тряска', color: '#ff7a45', params: [AMOUNT, SPEED],
    eval: (u, d, p) => {
      const a = p.amount * ramp(u, d, 0.05), f = 14 * p.speed;
      return { tx: noise(u * f, 1) * 0.025 * a, ty: noise(u * f, 7) * 0.02 * a, rot: noise(u * f, 13) * 0.025 * a, scale: 1 + 0.06 * a };
    } },
  shakehard: { label: 'Жёсткая тряска', group: 'Тряска', color: '#ff5a2a', params: [AMOUNT, SPEED],
    eval: (u, d, p) => {
      const a = p.amount * ramp(u, d, 0.03), f = 26 * p.speed;
      return { tx: noise(u * f, 3) * 0.06 * a, ty: noise(u * f, 11) * 0.05 * a, rot: noise(u * f, 5) * 0.06 * a, scale: 1 + 0.14 * a };
    } },
  zoomin: { label: 'Наезд', group: 'Движение', color: '#ffb347', params: [AMOUNT],
    eval: (u, d, p) => ({ scale: 1 + 0.35 * p.amount * easeInOut(Math.min(1, u / d)) }) },
  zoomout: { label: 'Отъезд', group: 'Движение', color: '#ffb347', params: [AMOUNT],
    eval: (u, d, p) => ({ scale: 1 + 0.35 * p.amount * (1 - easeInOut(Math.min(1, u / d))) }) },
  pulse: { label: 'Пульс (на бит)', group: 'Движение', color: '#ffd166', params: [AMOUNT],
    eval: (u, d, p) => ({ scale: 1 + 0.14 * p.amount * pulse(u, d) }) },
  spin: { label: 'Оборот', group: 'Движение', color: '#f4a261', params: [AMOUNT],
    eval: (u, d, p) => ({ rot: Math.PI * 2 * easeInOut(Math.min(1, u / d)) * Math.sign(p.amount || 1), scale: 1 + 0.4 * Math.sin(Math.PI * Math.min(1, u / d)) * p.amount }) },
  flash: { label: 'Вспышка', group: 'Свет', color: '#ffffff', params: [AMOUNT],
    eval: (u, d, p) => ({ flash: p.amount * pulse(u, d) }) },
  dip: { label: 'Затемнение', group: 'Свет', color: '#555b6e', params: [AMOUNT],
    eval: (u, d, p) => ({ black: p.amount * Math.sin(Math.PI * Math.min(1, u / d)) }) },
  glitch: { label: 'Глитч', group: 'Искажения', color: '#3ae3ff', params: [AMOUNT],
    eval: (u, d, p) => ({ glitch: p.amount * ramp(u, d) }) },
  rgb: { label: 'RGB-сдвиг', group: 'Искажения', color: '#c86bfa', params: [AMOUNT],
    eval: (u, d, p) => ({ rgb: p.amount * ramp(u, d) }) },
  wave: { label: 'Волна', group: 'Искажения', color: '#4cc9f0', params: [AMOUNT],
    eval: (u, d, p) => ({ wave: p.amount * ramp(u, d, 0.2) }) },
  pixel: { label: 'Пиксели', group: 'Искажения', color: '#7bdff2', params: [AMOUNT],
    eval: (u, d, p) => ({ pixel: p.amount * ramp(u, d) }) },
  blur: { label: 'Размытие', group: 'Стиль', color: '#90a4ff', params: [AMOUNT],
    eval: (u, d, p) => ({ blurA: p.amount * ramp(u, d, 0.15) }) },
  vhs: { label: 'VHS', group: 'Стиль', color: '#e76f51', params: [AMOUNT],
    eval: (u, d, p) => ({ vhs: p.amount * ramp(u, d) }) },
  bw: { label: 'Ч/Б', group: 'Стиль', color: '#adb5bd', params: [AMOUNT],
    eval: (u, d, p) => ({ bw: p.amount * ramp(u, d, 0.15) }) },
  sepia: { label: 'Сепия', group: 'Стиль', color: '#c8a27a', params: [AMOUNT],
    eval: (u, d, p) => ({ sepia: p.amount * ramp(u, d, 0.15) }) },
  invert: { label: 'Негатив', group: 'Стиль', color: '#f15bb5', params: [AMOUNT],
    eval: (u, d, p) => ({ invert: p.amount * ramp(u, d, 0.04) }) },
  vignette: { label: 'Виньетка', group: 'Стиль', color: '#6c757d', params: [AMOUNT],
    eval: (u, d, p) => ({ vign: p.amount * ramp(u, d, 0.2) }) },
  grain: { label: 'Плёнка', group: 'Стиль', color: '#b5838d', params: [AMOUNT],
    eval: (u, d, p) => ({ grain: p.amount * ramp(u, d, 0.2) }) },

  // --- тряска на любой вкус ---
  handheld: { label: 'Ручная камера', group: 'Тряска', color: '#ff9f6b', params: [AMOUNT, SPEED],
    eval: (u, d, p) => {
      const a = p.amount * ramp(u, d, 0.3), f = 2.2 * p.speed;
      return { tx: noise(u * f, 2) * 0.014 * a, ty: noise(u * f, 9) * 0.011 * a, rot: noise(u * f * 0.8, 4) * 0.014 * a, scale: 1 + 0.045 * a };
    } },
  impact: { label: 'Удар', group: 'Тряска', color: '#ff4d2e', params: [AMOUNT],
    eval: (u, d, p) => {
      const k = p.amount * Math.exp(-u * 9) * Math.min(1, u / 0.015);
      return { tx: Math.sin(u * 62) * 0.045 * k, ty: Math.cos(u * 47) * 0.035 * k, rot: Math.sin(u * 38) * 0.03 * k, scale: 1 + 0.16 * k };
    } },
  quake: { label: 'Землетрясение', group: 'Тряска', color: '#e8590c', params: [AMOUNT, SPEED],
    eval: (u, d, p) => {
      const a = p.amount * ramp(u, d, 0.1), f = 32 * p.speed;
      return { tx: noise(u * f, 21) * 0.03 * a, ty: noise(u * f * 1.3, 17) * 0.055 * a, rot: noise(u * f * 0.7, 3) * 0.035 * a, scale: 1 + 0.13 * a };
    } },
  bass: { label: 'Бас-тряска', group: 'Тряска', color: '#ff6b9d', params: [AMOUNT, SPEED],
    eval: (u, d, p) => {
      const a = p.amount * ramp(u, d, 0.05), w = Math.sin(u * Math.PI * 2 * 7 * p.speed);
      return { ty: w * 0.028 * a, scale: 1 + (0.04 + 0.03 * Math.abs(w)) * a };
    } },
  jitter: { label: 'Дрожь', group: 'Тряска', color: '#ffa94d', params: [AMOUNT],
    eval: (u, d, p) => {
      const a = p.amount * ramp(u, d, 0.03), t = Math.floor(u * 45);
      return { tx: (hash1(t) - 0.5) * 0.012 * a, ty: (hash1(t + 99) - 0.5) * 0.012 * a, scale: 1 + 0.02 * a };
    } },
  rotshake: { label: 'Вращательная тряска', group: 'Тряска', color: '#f783ac', params: [AMOUNT, SPEED],
    eval: (u, d, p) => {
      const a = p.amount * ramp(u, d, 0.05);
      return { rot: noise(u * 18 * p.speed, 6) * 0.075 * a, scale: 1 + 0.08 * a };
    } },
  zoomshake: { label: 'Тряска с зумом', group: 'Тряска', color: '#ff8787', params: [AMOUNT, SPEED],
    eval: (u, d, p) => {
      const a = p.amount * ramp(u, d, 0.05), f = 20 * p.speed;
      return { tx: noise(u * f, 31) * 0.03 * a, ty: noise(u * f, 37) * 0.025 * a, scale: 1 + (0.12 + 0.08 * Math.sin(u * f * 0.5)) * a };
    } },
  zoompunch: { label: 'Зум-удар', group: 'Тряска', color: '#ffc078', params: [AMOUNT],
    eval: (u, d, p) => {
      const k = u < 0.05 ? u / 0.05 : Math.exp(-(u - 0.05) * 5 / Math.max(0.2, d * 0.6));
      return { scale: 1 + 0.32 * p.amount * k };
    } },
  swing: { label: 'Качели', group: 'Тряска', color: '#e599f7', params: [AMOUNT, SPEED],
    eval: (u, d, p) => ({ rot: Math.sin(u * Math.PI * 1.6 * p.speed) * 0.09 * p.amount * ramp(u, d, 0.2), scale: 1 + 0.1 * p.amount }) },
  tilt: { label: 'Наклон', group: 'Тряска', color: '#d0bfff', params: [AMOUNT],
    eval: (u, d, p) => ({ rot: 0.1 * p.amount * Math.sin(Math.PI * Math.min(1, u / d)), scale: 1 + 0.08 * p.amount * Math.sin(Math.PI * Math.min(1, u / d)) }) },
  hop: { label: 'Подпрыгивание', group: 'Тряска', color: '#a9e34b', params: [AMOUNT, SPEED],
    eval: (u, d, p) => {
      const b = Math.abs(Math.sin(u * Math.PI * 2 * p.speed));
      return { ty: -b * 0.035 * p.amount * ramp(u, d, 0.1), scale: 1 + 0.05 * p.amount };
    } },
  drift: { label: 'Дрейф', group: 'Тряска', color: '#74c0fc', params: [AMOUNT],
    eval: (u, d, p) => ({ tx: (easeInOut(Math.min(1, u / d)) - 0.5) * 0.07 * p.amount, scale: 1 + 0.1 * p.amount }) },
  // как в эдитах: резкие толчки камеры, смазанные движением
  blurshake: { label: 'Тряска с размытием', group: 'Тряска', color: '#ff6f61', params: [AMOUNT, SPEED],
    eval: (u, d, p) => {
      const a = p.amount * ramp(u, d, 0.04), f = 9 * p.speed;
      return { tx: noise(u * f, 41) * 0.07 * a, ty: noise(u * f, 43) * 0.05 * a, rot: noise(u * f * 0.7, 47) * 0.05 * a, scale: 1 + 0.16 * a, mblur: a };
    } },
  motionblur: { label: 'Размытие движения', group: 'Тряска', color: '#ff9e80', params: [AMOUNT],
    eval: (u, d, p) => ({ mblur: p.amount * ramp(u, d, 0.05) }) },

  // --- свет и цвет ---
  strobe: { label: 'Стробоскоп', group: 'Свет', color: '#f8f9fa', params: [AMOUNT, SPEED],
    eval: (u, d, p) => ({ flash: Math.floor(u * 12 * p.speed) % 2 ? 0 : 0.85 * p.amount * ramp(u, d, 0.02) }) },
  colorflash: { label: 'Цветная вспышка', group: 'Свет', color: '#ff6bcb', params: [AMOUNT, P('hue', 'Цвет', 0, 1, 0.01, 0.9)],
    eval: (u, d, p) => ({ tint: 0.9 * p.amount * pulse(u, d), tintC: hsv(p.hue, 0.85, 1) }) },
  leak: { label: 'Засвет', group: 'Свет', color: '#ff922b', params: [AMOUNT],
    eval: (u, d, p) => ({ leak: p.amount * ramp(u, d, 0.3) }) },
  glow: { label: 'Свечение', group: 'Свет', color: '#ffe066', params: [AMOUNT],
    eval: (u, d, p) => ({ glow: p.amount * ramp(u, d, 0.15) }) },

  // --- искажения ---
  fisheye: { label: 'Рыбий глаз', group: 'Искажения', color: '#63e6be', params: [AMOUNT],
    eval: (u, d, p) => ({ fish: p.amount * ramp(u, d, 0.12) }) },
  kaleido: { label: 'Калейдоскоп', group: 'Искажения', color: '#b197fc', params: [AMOUNT],
    eval: (u, d, p) => ({ kaleido: p.amount * ramp(u, d, 0.02) }) },
  mirror: { label: 'Зеркало', group: 'Искажения', color: '#91a7ff', params: [AMOUNT],
    eval: (u, d, p) => ({ mirror: p.amount > 0.05 ? 1 : 0 }) },
  split: { label: 'Тройной кадр', group: 'Искажения', color: '#66d9e8', params: [AMOUNT],
    eval: (u, d, p) => ({ split: p.amount > 0.05 ? 1 : 0 }) },
  ghost: { label: 'Двойное изображение', group: 'Искажения', color: '#a5d8ff', params: [AMOUNT],
    eval: (u, d, p) => ({ ghost: p.amount * ramp(u, d, 0.1) }) },
  radialblur: { label: 'Радиальное размытие', group: 'Искажения', color: '#748ffc', params: [AMOUNT],
    eval: (u, d, p) => ({ rblur: p.amount * ramp(u, d, 0.1) }) },
  edges: { label: 'Неоновые контуры', group: 'Искажения', color: '#da77f2', params: [AMOUNT],
    eval: (u, d, p) => ({ edges: p.amount * ramp(u, d, 0.15) }) },
  tear: { label: 'Разрыв полосами', group: 'Искажения', color: '#4dabf7', params: [AMOUNT],
    eval: (u, d, p) => ({ tear: p.amount * ramp(u, d, 0.02) }) },

  // --- растяг (как в эдитах): кадр тянется по ширине/высоте на бит, «баг экрана» ---
  stretchx: { label: 'Растяг по ширине', group: 'Растяг', color: '#f06595', params: [AMOUNT],
    eval: (u, d, p) => ({ stx: 1 + 0.8 * p.amount * pulse(u, d) }) },
  stretchy: { label: 'Растяг по высоте', group: 'Растяг', color: '#e64980', params: [AMOUNT],
    eval: (u, d, p) => ({ sty: 1 + 0.8 * p.amount * pulse(u, d) }) },
  stretchhold: { label: 'Растяг (держать)', group: 'Растяг', color: '#d6336c', params: [AMOUNT],
    eval: (u, d, p) => ({ stx: 1 + 0.6 * p.amount * ramp(u, d, 0.06) }) },
  squash: { label: 'Сплющивание', group: 'Растяг', color: '#cc5de8', params: [AMOUNT],
    eval: (u, d, p) => { const k = p.amount * pulse(u, d); return { stx: 1 + 0.35 * k, sty: 1 - 0.3 * k }; } },
  pixelstretch: { label: 'Растяг пикселей (баг)', group: 'Растяг', color: '#be4bdb', params: [AMOUNT],
    eval: (u, d, p) => ({ pstretch: p.amount * ramp(u, d, 0.02) }) },

  // --- стиль ---
  crt: { label: 'CRT-телевизор', group: 'Стиль', color: '#8ce99a', params: [AMOUNT],
    eval: (u, d, p) => ({ crt: p.amount * ramp(u, d, 0.15), vign: 0.4 * p.amount * ramp(u, d, 0.15) }) },
  poster: { label: 'Постер', group: 'Стиль', color: '#ffa8a8', params: [AMOUNT],
    eval: (u, d, p) => ({ poster: p.amount * ramp(u, d, 0.1) }) },
  bars: { label: 'Кино-полосы', group: 'Стиль', color: '#495057', params: [AMOUNT],
    eval: (u, d, p) => ({ bars: p.amount * ramp(u, d, 0.25) }) },
};

// ---------------------------------------------------------------------------
//   Семейства эффектов: цветокоррекция (матрица), частицы, рамки, деформации, сетка, движение камеры
// ---------------------------------------------------------------------------
const FULL = P('amount', 'Сила', 0, 1, 0.05, 1);
const LUM = [0.299, 0.587, 0.114];
/** Цветовой «лут» как матрица 3×3 + сдвиг: насыщенность → перестановка каналов → баланс → контраст/яркость. */
function look({ sat = 1, con = 1, bri = 0, r = 1, g = 1, b = 1, lift = [0, 0, 0], swap = null }) {
  let R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (1 - sat) * LUM[j] + (i === j ? sat : 0)));
  if (swap) R = swap.map((row) => [0, 1, 2].map((j) => row[0] * R[0][j] + row[1] * R[1][j] + row[2] * R[2][j]));
  const gains = [r, g, b];
  R = R.map((row, i) => row.map((v) => v * gains[i] * con));
  const a = [0, 1, 2].map((i) => 0.5 * (1 - con) + bri + lift[i]);
  return { m: [R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]], a }; // по столбцам, как ждёт GLSL
}
const LOOKS = {
  hollywood: ['Голливуд', { sat: 1.15, con: 1.15, r: 1.06, b: 0.95, lift: [0, 0.01, 0.03] }],
  tealorange: ['Тиль и оранж', { sat: 1.2, con: 1.1, r: 1.08, b: 0.92, lift: [-0.03, 0.02, 0.06] }],
  goldenhour: ['Золотой час', { sat: 1.15, r: 1.12, g: 1.02, b: 0.82, bri: 0.02 }],
  coldneon: ['Холодный неон', { sat: 1.3, con: 1.1, r: 0.85, b: 1.2 }],
  night: ['Ночь', { sat: 0.7, con: 1.05, r: 0.75, g: 0.85, b: 1.15, bri: -0.08 }],
  pinkdream: ['Розовая мечта', { sat: 1.1, r: 1.12, g: 0.92, b: 1.08, lift: [0.04, 0, 0.03] }],
  pastel: ['Пастель', { sat: 0.7, con: 0.85, bri: 0.06 }],
  acid: ['Кислотный', { sat: 1.8, con: 1.2 }],
  bleached: ['Выбеленный', { sat: 0.6, con: 0.8, bri: 0.08 }],
  bwhard: ['Ч/Б контраст', { sat: 0, con: 1.45 }],
  bwsoft: ['Ч/Б мягкий', { sat: 0, con: 0.85, bri: 0.03 }],
  sepiawarm: ['Сепия тёплая', { sat: 0, r: 1.12, g: 0.95, b: 0.72 }],
  matrix: ['Матрица', { sat: 0.6, r: 0.7, g: 1.2, b: 0.7, con: 1.15 }],
  icy: ['Ледяной', { sat: 0.85, r: 0.85, g: 0.97, b: 1.18, bri: 0.03 }],
  desert: ['Пустыня', { sat: 0.9, r: 1.12, b: 0.78, con: 1.05 }],
  forest: ['Лес', { sat: 1.1, r: 0.92, g: 1.08, b: 0.9 }],
  retro70: ['Ретро 70-х', { sat: 0.85, con: 0.9, r: 1.1, b: 0.8, lift: [0.05, 0.03, 0] }],
  cyberpunk: ['Киберпанк', { sat: 1.35, con: 1.15, r: 1.1, g: 0.8, b: 1.2 }],
  infrared: ['Инфракрасный', { sat: 1.2, swap: [[0, 1, 0], [1, 0, 0], [0, 0, 1]] }],
  bgr: ['Каналы наоборот', { swap: [[0, 0, 1], [0, 1, 0], [1, 0, 0]] }],
  duopurple: ['Дуотон фиолетовый', { sat: 0, r: 1.2, g: 0.6, b: 1.3, lift: [0, 0, 0.12] }],
  duoorange: ['Дуотон оранжевый', { sat: 0, r: 1.2, g: 0.85, b: 0.45 }],
  duogreen: ['Дуотон зелёный', { sat: 0, r: 0.6, g: 1.15, b: 0.8 }],
  faded: ['Блеклый', { sat: 0.75, con: 0.8, lift: [0.06, 0.06, 0.06] }],
  juicy: ['Сочный+', { sat: 1.45, con: 1.1 }],
  drama: ['Драма+', { sat: 0.8, con: 1.35, bri: -0.05 }],
  dark: ['Тёмный', { con: 1.15, bri: -0.12 }],
  bright: ['Светлый', { bri: 0.1, con: 0.95 }],
  warmplus: ['Тёплый+', { r: 1.12, b: 0.85 }],
  coldplus: ['Холодный+', { r: 0.88, b: 1.15 }],
  lilac: ['Лиловый закат', { sat: 1.15, r: 1.1, g: 0.85, b: 1.1 }],
  mint: ['Мятный', { sat: 0.9, r: 0.85, g: 1.08, b: 1.02, bri: 0.04 }],
  fuji: ['Плёнка Fuji', { sat: 0.95, con: 1.08, r: 0.98, g: 1.04, b: 0.98, lift: [0, 0.02, 0.02] }],
  kodak: ['Плёнка Kodak', { sat: 1.1, con: 1.08, r: 1.06, b: 0.9, lift: [0.02, 0.01, 0] }],
  polaroidc: ['Полароид-цвет', { sat: 0.85, con: 0.9, r: 1.05, g: 1.02, b: 0.92, lift: [0.06, 0.05, 0.04] }],
  noir: ['Нуар', { sat: 0, con: 1.6, bri: -0.05 }],
};
for (const [k, [label, prm]] of Object.entries(LOOKS)) {
  const cg = look(prm);
  EFFECTS['look_' + k] = { label, group: 'Цвет', color: '#e599f7', params: [FULL], eval: (u, d, p) => ({ cgk: p.amount * ramp(u, d, 0.15), cg }) };
}

// частицы: форма, размер, плотность, покачивание, свечение, радуга, скорость (доли высоты кадра в секунду), цвет
const PARTS = {
  snow: ['Снег', [0, 0.12, 0.55, 0.15, 0.3, 0, [0.02, 0.12], [1, 1, 1]]],
  blizzard: ['Метель', [0, 0.1, 0.9, 0.3, 0.2, 0, [0.25, 0.35], [1, 1, 1]]],
  rain: ['Дождь', [1, 0.08, 0.6, 0, 0, 0, [0.05, 1.4], [0.75, 0.85, 1]]],
  storm: ['Ливень', [1, 0.1, 0.95, 0, 0, 0, [0.15, 2.2], [0.7, 0.8, 0.95]]],
  dust: ['Пыль в лучах', [0, 0.05, 0.5, 0.1, 0.6, 0, [0.01, -0.01], [1, 0.92, 0.75]]],
  goldsparks: ['Золотые искры', [5, 0.16, 0.35, 0.05, 0.5, 0, [0, -0.15], [1, 0.8, 0.35]]],
  starsky: ['Звёзды', [5, 0.12, 0.45, 0, 0.4, 0, [0, 0], [1, 1, 1]]],
  confetti: ['Конфетти', [2, 0.22, 0.6, 0.2, 0, 1, [0.03, 0.35], [1, 1, 1]]],
  hearts: ['Сердечки', [4, 0.22, 0.35, 0.15, 0.2, 0, [0, -0.12], [1, 0.35, 0.55]]],
  bubbles: ['Пузыри', [3, 0.25, 0.4, 0.2, 0, 0, [0, -0.1], [0.8, 0.95, 1]]],
  fireflies: ['Светлячки', [0, 0.08, 0.35, 0.4, 1, 0, [0.02, -0.03], [0.9, 1, 0.5]]],
  embers: ['Огненные искры', [0, 0.06, 0.6, 0.1, 0.8, 0, [0.03, -0.45], [1, 0.5, 0.15]]],
  bokeh: ['Боке', [0, 0.4, 0.35, 0.05, 0.5, 1, [0.01, -0.02], [1, 1, 1]]],
  neondots: ['Неоновые точки', [5, 0.14, 0.4, 0.1, 0.6, 1, [0, -0.05], [1, 1, 1]]],
  sakura: ['Лепестки сакуры', [2, 0.18, 0.4, 0.35, 0, 0, [0.06, 0.12], [1, 0.75, 0.85]]],
  glitter: ['Блёстки', [5, 0.08, 0.8, 0, 0.3, 1, [0, 0], [1, 1, 1]]],
};
for (const [k, [label, [shape, size, dens, sway, glow, rain, vel, col]]] of Object.entries(PARTS)) {
  const part = { shape, size, dens, sway, glow, rain, vel, col };
  EFFECTS['p_' + k] = { label, group: 'Частицы', color: '#74c0fc', params: [FULL], eval: (u, d, p) => ({ pamt: p.amount * ramp(u, d, 0.3), part }) };
}

['Плёнка', 'Полароид', 'Скруглённая рамка', 'Видоискатель REC', 'Неоновая рамка', 'Мечтательные края', 'Старый телевизор'].forEach((label, i) => {
  EFFECTS['frame' + (i + 1)] = { label, group: 'Рамки', color: '#ffd43b', params: [FULL], eval: (u, d, p) => ({ famt: p.amount * ramp(u, d, 0.15), ftype: i + 1 }) };
});
['Смерч', 'Выпуклость', 'Линза внутрь', 'Вода', 'Марево', 'Желе'].forEach((label, i) => {
  EFFECTS['warp' + (i + 1)] = { label, group: 'Деформации', color: '#63e6be', params: [AMOUNT], eval: (u, d, p) => ({ wamt: p.amount * ramp(u, d, 0.12), wtype: i + 1 }) };
});
[2, 3, 4].forEach((n) => { EFFECTS['grid' + n] = { label: `Экран ${n}×${n}`, group: 'Деформации', color: '#91a7ff', params: [AMOUNT], eval: (u, d, p) => (p.amount > 0.05 ? { gridn: n } : {}) }; });
Object.assign(EFFECTS, {
  halftone: { label: 'Растр (комикс)', group: 'Стиль', color: '#ffa8a8', params: [AMOUNT], eval: (u, d, p) => ({ halft: p.amount * ramp(u, d, 0.12) }) },
  scanlines: { label: 'Строки развёртки', group: 'Стиль', color: '#8ce99a', params: [AMOUNT], eval: (u, d, p) => ({ scan: p.amount * ramp(u, d, 0.12) }) },
  tiltshift: { label: 'Тилт-шифт (макро)', group: 'Стиль', color: '#99e9f2', params: [FULL], eval: (u, d, p) => ({ tilt: p.amount * ramp(u, d, 0.2) }) },
  mblurh: { label: 'Смаз ═', group: 'Тряска', color: '#ffc9c9', params: [AMOUNT], eval: (u, d, p) => ({ mblur: p.amount * ramp(u, d, 0.05), mfix: [0.03, 0] }) },
  mblurv: { label: 'Смаз ║', group: 'Тряска', color: '#ffc9c9', params: [AMOUNT], eval: (u, d, p) => ({ mblur: p.amount * ramp(u, d, 0.05), mfix: [0, 0.03] }) },
  flashred: { label: 'Красная вспышка', group: 'Свет', color: '#ff6b6b', params: [AMOUNT], eval: (u, d, p) => ({ tint: 0.9 * p.amount * pulse(u, d), tintC: hsv(0, 0.85, 1) }) },
  flashblue: { label: 'Синяя вспышка', group: 'Свет', color: '#4dabf7', params: [AMOUNT], eval: (u, d, p) => ({ tint: 0.9 * p.amount * pulse(u, d), tintC: hsv(0.6, 0.85, 1) }) },
  flashgold: { label: 'Золотая вспышка', group: 'Свет', color: '#ffd43b', params: [AMOUNT], eval: (u, d, p) => ({ tint: 0.9 * p.amount * pulse(u, d), tintC: hsv(0.12, 0.8, 1) }) },
  strobeblack: { label: 'Мигание тёмным', group: 'Свет', color: '#495057', params: [AMOUNT, SPEED], eval: (u, d, p) => ({ black: Math.floor(u * 10 * p.speed) % 2 ? 0.85 * p.amount : 0 }) },
  panleft: { label: 'Панорама ←', group: 'Движение', color: '#ffb347', params: [AMOUNT], eval: (u, d, p) => ({ tx: (0.04 - 0.08 * easeInOut(Math.min(1, u / d))) * p.amount, scale: 1 + 0.1 * p.amount }) },
  panright: { label: 'Панорама →', group: 'Движение', color: '#ffb347', params: [AMOUNT], eval: (u, d, p) => ({ tx: (-0.04 + 0.08 * easeInOut(Math.min(1, u / d))) * p.amount, scale: 1 + 0.1 * p.amount }) },
  panup: { label: 'Панорама ↑', group: 'Движение', color: '#ffb347', params: [AMOUNT], eval: (u, d, p) => ({ ty: (0.04 - 0.08 * easeInOut(Math.min(1, u / d))) * p.amount, scale: 1 + 0.1 * p.amount }) },
  pandown: { label: 'Панорама ↓', group: 'Движение', color: '#ffb347', params: [AMOUNT], eval: (u, d, p) => ({ ty: (-0.04 + 0.08 * easeInOut(Math.min(1, u / d))) * p.amount, scale: 1 + 0.1 * p.amount }) },
  orbit: { label: 'Орбита', group: 'Движение', color: '#ffc078', params: [AMOUNT, SPEED], eval: (u, d, p) => ({ tx: Math.cos(u * Math.PI * p.speed) * 0.02 * p.amount, ty: Math.sin(u * Math.PI * p.speed) * 0.02 * p.amount, scale: 1 + 0.06 * p.amount }) },
  breathe: { label: 'Дыхание', group: 'Движение', color: '#ffd8a8', params: [AMOUNT, SPEED], eval: (u, d, p) => ({ scale: 1 + 0.04 * p.amount * (1 - Math.cos(u * 2 * p.speed)) }) },
  dutch: { label: 'Голландский угол', group: 'Движение', color: '#ffa94d', params: [AMOUNT], eval: (u, d, p) => ({ rot: 0.12 * p.amount * ramp(u, d, 0.3), scale: 1 + 0.15 * p.amount * ramp(u, d, 0.3) }) },
  kenburns: { label: 'Кен Бёрнс', group: 'Движение', color: '#ffe066', params: [AMOUNT], eval: (u, d, p) => { const k = easeInOut(Math.min(1, u / d)); return { scale: 1 + 0.15 * k * p.amount, tx: 0.03 * k * p.amount, ty: -0.02 * k * p.amount }; } },
});

export const EFFECT_GROUPS = ['Тряска', 'Растяг', 'Движение', 'Свет', 'Цвет', 'Частицы', 'Рамки', 'Деформации', 'Искажения', 'Стиль'];

/** Наборы: несколько эффектов одним кликом. items: [тип, начало, длина, сила, доп. параметры]. */
export const EFFECT_PACKS = {
  drop: { label: 'Бит-дроп', len: 0.6, items: [['zoompunch', 0, 0.45, 0.8], ['colorflash', 0, 0.3, 0.7, { hue: 0.9 }], ['impact', 0, 0.55, 0.8]] },
  rage: { label: 'Ярость', len: 1.5, items: [['quake', 0, 1.5, 0.8], ['rgb', 0, 1.5, 0.5], ['colorflash', 0, 0.35, 0.7, { hue: 0 }], ['zoomshake', 0, 1.5, 0.4]] },
  flashback: { label: 'Флешбэк', len: 2.5, items: [['flash', 0, 0.3, 0.6], ['bw', 0, 2.5, 0.9], ['blur', 0, 2.5, 0.25], ['vignette', 0, 2.5, 0.8]] },
  epic: { label: 'Эпичный момент', len: 2, items: [['flash', 0, 0.3, 0.5], ['zoomin', 0, 2, 0.5], ['bars', 0, 2, 0.8], ['vignette', 0, 2, 0.6]] },
  retro: { label: 'Ретро-ТВ', len: 3, items: [['crt', 0, 3, 0.8], ['vhs', 0, 3, 0.5], ['rgb', 0, 3, 0.3]] },
  dream: { label: 'Сон', len: 3, items: [['glow', 0, 3, 0.6], ['leak', 0, 3, 0.6], ['blur', 0, 3, 0.2]] },
  live: { label: 'Живая камера', len: 4, items: [['handheld', 0, 4, 0.8], ['grain', 0, 4, 0.3]] },
  party: { label: 'Вечеринка', len: 2, items: [['strobe', 0, 2, 0.5], ['edges', 0, 2, 0.6], ['bass', 0, 2, 0.6]] },
  trip: { label: 'Трип', len: 3, items: [['kaleido', 0, 3, 1], ['wave', 0, 3, 0.6], ['glow', 0, 3, 0.4]] },
  cinema: { label: 'Кино', len: 4, items: [['bars', 0, 4, 0.9], ['grain', 0, 4, 0.25], ['vignette', 0, 4, 0.5]] },
  winter: { label: 'Зима', len: 4, items: [['p_snow', 0, 4, 1], ['look_icy', 0, 4, 0.8], ['glow', 0, 4, 0.3]] },
  newyear: { label: 'Новогодний', len: 4, items: [['p_snow', 0, 4, 1], ['look_goldenhour', 0, 4, 0.6], ['p_goldsparks', 0, 4, 0.7]] },
  romance: { label: 'Романтика', len: 4, items: [['p_hearts', 0, 4, 1], ['look_pinkdream', 0, 4, 0.9], ['glow', 0, 4, 0.35]] },
  rainy: { label: 'Дождливый вечер', len: 4, items: [['p_rain', 0, 4, 1], ['look_night', 0, 4, 0.8], ['vignette', 0, 4, 0.6]] },
  celebrate: { label: 'Праздник', len: 3, items: [['p_confetti', 0, 3, 1], ['look_juicy', 0, 3, 0.7], ['flash', 0, 0.3, 0.6]] },
  magic: { label: 'Волшебство', len: 4, items: [['p_glitter', 0, 4, 1], ['look_lilac', 0, 4, 0.8], ['glow', 0, 4, 0.5]] },
  fire: { label: 'Огонь', len: 3, items: [['p_embers', 0, 3, 1], ['look_goldenhour', 0, 3, 0.9], ['warp5', 0, 3, 0.4]] },
  oldfilm: { label: 'Старое кино', len: 4, items: [['frame1', 0, 4, 1], ['look_bwsoft', 0, 4, 1], ['grain', 0, 4, 0.5], ['handheld', 0, 4, 0.4]] },
  camcorder: { label: 'Видеокамера', len: 4, items: [['frame4', 0, 4, 1], ['grain', 0, 4, 0.3], ['handheld', 0, 4, 0.6]] },
  cybernight: { label: 'Киберпанк-ночь', len: 3, items: [['look_cyberpunk', 0, 3, 1], ['p_neondots', 0, 3, 0.8], ['rgb', 0, 3, 0.3]] },
  daydream: { label: 'Сон наяву', len: 4, items: [['frame6', 0, 4, 0.8], ['look_pastel', 0, 4, 0.8], ['p_bokeh', 0, 4, 0.7]] },
  comic: { label: 'Комикс', len: 3, items: [['halftone', 0, 3, 0.7], ['look_juicy', 0, 3, 0.8], ['poster', 0, 3, 0.3]] },
  oldtv: { label: 'Старый ТВ', len: 4, items: [['frame7', 0, 4, 1], ['scanlines', 0, 4, 0.6], ['vhs', 0, 4, 0.4]] },
  macro: { label: 'Макро-мир', len: 4, items: [['tiltshift', 0, 4, 1], ['look_juicy', 0, 4, 0.7]] },
  summer: { label: 'Лето', len: 4, items: [['look_goldenhour', 0, 4, 0.9], ['p_dust', 0, 4, 1], ['leak', 0, 4, 0.5]] },
};

/** Эффекты набора, начиная с момента at (для дорожки «Эффекты» и превью). */
export const packEffects = (key, at = 0) => EFFECT_PACKS[key].items.map(([type, off, len, amount, extra]) =>
  ({ type, start: at + off, end: at + off + len, p: { ...defaultParams(type), amount, ...(extra || {}) } }));

export const POST_KEYS = ['flash', 'black', 'blurA', 'glitch', 'rgb', 'vhs', 'bw', 'invert', 'pixel', 'vign', 'grain', 'wave', 'sepia',
  'tint', 'mirror', 'kaleido', 'fish', 'rblur', 'glow', 'crt', 'bars', 'poster', 'split', 'leak', 'edges', 'ghost', 'tear', 'mblur', 'pstretch',
  'cgk', 'wamt', 'famt', 'pamt', 'halft', 'scan', 'tilt'];

export function defaultParams(type) {
  return Object.fromEntries((EFFECTS[type]?.params || []).map((x) => [x.key, x.def]));
}

/** Суммарное состояние всех эффектов в момент t (+ размытие по скорости движения кадра, если включено). */
export function evalEffects(effects, t) {
  const st = evalAt(effects, t);
  if (st.mblur > 0 && st.mfix) st.mdir = st.mfix; // смаз в заданную сторону
  else if (st.mblur > 0) {
    // насколько кадр сдвинулся/приблизился за 1/30 с: сдвиг → размытие вдоль движения, зум → радиальное
    const pr = evalAt(effects, t - 1 / 30);
    st.mdir = [st.tx - pr.tx, st.ty - pr.ty];
    st.rblur = Math.min(1, st.rblur + Math.abs(st.scale - pr.scale) * 6 * st.mblur);
  }
  return st;
}

function evalAt(effects, t) {
  const st = { scale: 1, tx: 0, ty: 0, rot: 0, stx: 1, sty: 1 }; // stx/sty — растяг кадра по ширине/высоте
  for (const k of POST_KEYS) st[k] = 0;
  for (const e of effects) {
    if (t < e.start || t >= e.end) continue;
    const def = EFFECTS[e.type];
    if (!def) continue;
    const r = def.eval(t - e.start, e.end - e.start, { ...defaultParams(e.type), ...e.p });
    if (r.scale) st.scale *= r.scale;
    if (r.stx) st.stx *= r.stx;
    if (r.sty) st.sty *= r.sty;
    // «тип» эффекта не складывается — берётся последний (цветокор, частицы, рамка, деформация, сетка)
    if (r.cg) st.cg = r.cg;
    if (r.part) st.part = r.part;
    if (r.ftype) st.ftype = r.ftype;
    if (r.wtype) st.wtype = r.wtype;
    if (r.gridn) st.gridn = Math.max(st.gridn || 0, r.gridn);
    if (r.mfix) st.mfix = r.mfix;
    st.tx += r.tx || 0; st.ty += r.ty || 0; st.rot += r.rot || 0;
    for (const k of POST_KEYS) if (r[k]) st[k] = Math.min(1, st[k] + r[k]);
    if (r.tintC && r.tint) st.tintC = r.tintC;
  }
  return st;
}
