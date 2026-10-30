// Пресеты: нарезка (части, субтитры, заголовки, обложка, кадр, свои тексты) и автоэдит (ритм, переходы,
// эффекты на бит, цвет, свои тексты). Пресет состоит из блоков — свой пресет можно собрать из блоков разных
// готовых («субтитры как в CS2, обложка как у Reddit»). Свои пресеты хранятся на этом устройстве.
import { S, commit, STYLE_BASE, uid } from './store.js';

const style = (o) => ({ ...STYLE_BASE, ...o });

export const CUT_BLOCKS = { parts: 'Части', subs: 'Субтитры', headers: 'Заголовки', covers: 'Обложка', look: 'Кадр и фон', overlays: 'Свои тексты', ads: 'Реклама' };
export const EDIT_BLOCKS = { rhythm: 'Ритм склеек', transitions: 'Переходы', beatfx: 'Эффекты на бит', look: 'Кадр, фон и цвет', overlays: 'Свои тексты', ads: 'Реклама' };
export const blocksOf = (kind) => (kind === 'edit' ? EDIT_BLOCKS : CUT_BLOCKS);

// ---------------------------------------------------------------------------
//   Готовые пресеты нарезки
// ---------------------------------------------------------------------------
const CUT = {
  classic: {
    label: 'Обычная нарезка', desc: 'Части по минуте, субтитры снизу, бейдж на обложке',
    parts: { target: 60, max: 12 },
    subs: { style: style({}), y: 0.73, anim: { in: 'pop', out: 'none', dur: 180 }, opts: { maxChars: 22, maxDur: 2.6, maxGap: 0.6 } },
    headers: { enabled: true, y: 0.22, style: style({ font: 'Rubik-700', size: 66, strokeWidth: 8, shadowDist: 6, wrap: 20 }), anim: { in: 'fade', out: 'none', dur: 250 } },
    covers: { enabled: true, style: 'badge', font: 'Rubik-700', accent: '#EB2D41', card: { enabled: false } },
    look: { background: { mode: 'blur', blur: 40, dim: 0.15 }, fit: 'width' },
  },
  cs2: {
    label: 'CS2 / шутеры', desc: 'Кадр крупнее, жёлтая подсветка слов, обложка с прицелом',
    parts: { target: 60, max: 12 },
    // толстый шрифт заглавными — с запасом между строками, словами и буквами, иначе слипается
    subs: { style: style({ font: 'Rubik-800', size: 70, strokeWidth: 7, upper: true, wrap: 16, lineGap: 0.18, wordGap: 10, letterGap: 1.5 }), y: 0.72,
      anim: { in: 'pop', out: 'none', dur: 160, karaoke: true, hlColor: '#F5A524' }, opts: { maxChars: 16, maxDur: 2.2, maxGap: 0.5 } },
    headers: { enabled: true, y: 0.2, style: style({ font: 'RussoOne-400', size: 60, strokeWidth: 8, shadowDist: 6, wrap: 20, lineGap: 0.16, wordGap: 6, letterGap: 1.5 }),
      anim: { in: 'slidedown', out: 'none', dur: 300 } },
    covers: { enabled: true, style: 'cs2', font: 'RussoOne-400', accent: '#F5A524', card: { enabled: false } },
    look: { background: { mode: 'blur', blur: 40, dim: 0.25 }, fit: 'zoom' },
  },
  reddit: {
    label: 'Reddit-истории', desc: 'Карточка поста в начале частей, крупные слова по центру, видео на весь экран',
    parts: { target: 75, max: 10 },
    subs: { style: style({ font: 'Rubik-900', size: 100, strokeWidth: 10, shadowAlpha: 0.5, upper: false, wrap: 14 }), y: 0.5,
      anim: { in: 'pop', out: 'none', dur: 120 }, opts: { maxChars: 14, maxDur: 1.4, maxGap: 0.4 } },
    headers: { enabled: false },
    covers: { enabled: true, style: 'reddit', font: 'Onest-800', accent: '#FF4500', theme: 'light', card: { enabled: true, dur: 3.5, y: 0.45, hideSubs: true } },
    look: { background: { mode: 'blur', blur: 40, dim: 0.1 }, fit: 'fill' },
  },
  games: {
    label: 'Игры / стримы', desc: 'Кадр 130%, слова по одному, большая цифра части на обложке',
    parts: { target: 60, max: 12 },
    subs: { style: style({ font: 'Montserrat-900', size: 68, strokeWidth: 7, upper: true, wrap: 16, lineGap: 0.15, wordGap: 8 }), y: 0.72,
      anim: { in: 'words', out: 'none', dur: 200, karaoke: true, hlColor: '#4DFF88' }, opts: { maxChars: 18, maxDur: 2.2, maxGap: 0.5 } },
    headers: { enabled: true, y: 0.2, style: style({ font: 'Unbounded-700', size: 54, strokeWidth: 7, shadowDist: 5, wrap: 22 }), anim: { in: 'pop', out: 'none', dur: 250 } },
    covers: { enabled: true, style: 'number', font: 'Unbounded-900', accent: '#4DFF88', card: { enabled: false } },
    look: { background: { mode: 'blur', blur: 45, dim: 0.2 }, fit: 'zoom' },
  },
  podcast: {
    label: 'Подкасты / интервью', desc: 'Части по 1,5 мин, жёлтая подсветка слов, чистая обложка',
    parts: { target: 90, max: 10 },
    subs: { style: style({ font: 'Montserrat-900', size: 62, strokeWidth: 6, upper: true, wrap: 18, lineGap: 0.15, wordGap: 8 }), y: 0.74,
      anim: { in: 'pop', out: 'none', dur: 150, karaoke: true, hlColor: '#FFE14D' }, opts: { maxChars: 20, maxDur: 2.4, maxGap: 0.6 } },
    headers: { enabled: true, y: 0.16, style: style({ font: 'Onest-800', size: 56, strokeWidth: 0, box: true, boxColor: '#FFFFFF', boxAlpha: 1, color: '#111111', shadowAlpha: 0, wrap: 22 }),
      anim: { in: 'fade', out: 'none', dur: 250 } },
    covers: { enabled: true, style: 'clean', font: 'Onest-800', accent: '#7C5CFF', card: { enabled: false } },
    look: { background: { mode: 'blur', blur: 40, dim: 0.15 }, fit: 'fill' },
  },
  movie: {
    label: 'Фильмы / сериалы', desc: 'Части по 2 мин, кадр целиком, аккуратные субтитры, обложка «кино»',
    parts: { target: 120, max: 15 },
    subs: { style: style({ font: 'Onest-700', size: 54, strokeWidth: 5, upper: false, wrap: 30 }), y: 0.72,
      anim: { in: 'fade', out: 'fade', dur: 150 }, opts: { maxChars: 32, maxDur: 3, maxGap: 0.7 } },
    headers: { enabled: true, y: 0.22, style: style({ font: 'PlayfairDisplay-900', size: 60, strokeWidth: 0, shadowAlpha: 0.8, shadowDist: 4, wrap: 22 }), anim: { in: 'fade', out: 'none', dur: 400 } },
    covers: { enabled: true, style: 'cinema', font: 'PlayfairDisplay-900', accent: '#E9E3D6', card: { enabled: false } },
    look: { background: { mode: 'blur', blur: 55, dim: 0.35 }, fit: 'width' },
  },
  // обычные видео (не нарезка): без частей и обложек
  youtube: {
    label: 'Видео для YouTube', desc: '16:9, без частей, аккуратные субтитры внизу',
    aspect: '16:9',
    parts: { target: 600, max: 1 },
    subs: { style: style({ font: 'Onest-700', size: 46, strokeWidth: 5, wrap: 42 }), y: 0.86, anim: { in: 'fade', out: 'fade', dur: 120 }, opts: { maxChars: 42, maxDur: 3.2, maxGap: 0.7 } },
    headers: { enabled: false },
    covers: { enabled: false, style: 'clean', font: 'Onest-800', accent: '#FF3B30', card: { enabled: false } },
    look: { background: { mode: 'color', color: '#000000', blur: 40, dim: 0 }, fit: 'contain' },
  },
  shorts: {
    label: 'Shorts / Reels', desc: 'Вертикальное видео одним куском, крупные субтитры по центру',
    aspect: '9:16',
    parts: { target: 600, max: 1 },
    subs: { style: style({ font: 'Rubik-800', size: 76, strokeWidth: 8, wrap: 16, lineGap: 0.12, wordGap: 6 }), y: 0.6,
      anim: { in: 'pop', out: 'none', dur: 150, karaoke: true, hlColor: '#FFE14D' }, opts: { maxChars: 16, maxDur: 1.8, maxGap: 0.5 } },
    headers: { enabled: false },
    covers: { enabled: false, style: 'number', font: 'Rubik-800', accent: '#EB2D41', card: { enabled: false } },
    look: { background: { mode: 'blur', blur: 40, dim: 0.15 }, fit: 'fill' },
  },
};

// ---------------------------------------------------------------------------
//   Готовые пресеты автоэдита
// ---------------------------------------------------------------------------
const TR_HARD = ['flashburst', 'zoomburst', 'spinblur', 'swishleft', 'swishright', 'shakecut', 'glitch', 'impact'];
const EDIT = {
  norm: {
    label: 'Норм', desc: 'Склейка через бит, переходы на сильных долях, пульс и вспышки',
    rhythm: { energy: 'norm', loud: true, curves: 0.3, muteVideo: true },
    transitions: { pool: TR_HARD, every: 4, strong: 0.6, dur: 0.4 },
    beatfx: { pulse: 0.4, flash: 0.45, shake: 0.12, rgb: 0 },
    look: { filter: 'none', fx: null, fit: null },
  },
  phonk: {
    label: 'Фонк / жёстко', desc: 'Склейка на каждый бит, глитчи, тряска, RGB, контрастный цвет',
    rhythm: { energy: 'fast', loud: true, curves: 0.35, muteVideo: true },
    transitions: { pool: ['glitch', 'swishleft', 'swishright', 'shakecut', 'zoomburst', 'mirrorwarp'], every: 3, strong: 0.7, dur: 0.3 },
    beatfx: { pulse: 0.55, flash: 0.6, shake: 0.15, impact: 0.3, punch: 0.3, rgb: 0.3, stretch: 0.25 },
    look: { filter: 'vivid', fx: null, fit: null }, // «Драма» на тёмных кусках уводила кадр в чёрное
  },
  hype: {
    label: 'Хайп / TikTok', desc: 'Удары, зум-удары, цветные вспышки, эффектные переходы — максимум энергии',
    rhythm: { energy: 'fast', loud: true, curves: 0.4, muteVideo: true },
    transitions: { pool: ['flashburst', 'zoomburst', 'spinblur', 'rgbsplit', 'swishleft', 'swishright', 'impact'], every: 2, strong: 0.8, dur: 0.3 },
    beatfx: { pulse: 0.35, flash: 0.3, shake: 0, impact: 0.35, punch: 0.6, rgb: 0.2, cflash: 0.6, stretch: 0.35 },
    look: { filter: 'vivid', fx: null, fit: null },
  },
  dreamy: {
    label: 'Мечтательный', desc: 'Медленно, двойная экспозиция, засветы и свечение — для красивых моментов',
    rhythm: { energy: 'calm', loud: false, curves: 0.1, muteVideo: true },
    transitions: { pool: ['exposure', 'lightleak', 'softzoom', 'lumafade', 'white', 'blur'], every: 1, strong: 0.5, dur: 0.8 },
    beatfx: { pulse: 0.12, flash: 0, shake: 0, rgb: 0 },
    look: { filter: 'warm', fx: { type: 'glow', amount: 0.45 }, fit: null },
  },
  velocity: {
    label: 'Velocity', desc: 'Много кривых скорости, рывки и вспышки на сильных долях',
    rhythm: { energy: 'norm', loud: true, curves: 0.75, muteVideo: true },
    transitions: { pool: ['zoomburst', 'flashburst', 'swishright'], every: 5, strong: 0.5, dur: 0.35 },
    beatfx: { pulse: 0.3, flash: 0.5, shake: 0.1, rgb: 0 },
    look: { filter: 'vivid', fx: null, fit: null },
  },
  cinema: {
    label: 'Кино / спокойно', desc: 'Длинные планы, растворения, мягкий пульс, киношный цвет',
    rhythm: { energy: 'calm', loud: false, curves: 0, muteVideo: true },
    transitions: { pool: ['softzoom', 'lumafade', 'fade', 'black'], every: 2, strong: 0.4, dur: 0.6 },
    beatfx: { pulse: 0.15, flash: 0, shake: 0, rgb: 0 },
    look: { filter: 'cinema', fx: { type: 'vignette', amount: 0.5 }, fit: null },
  },
  // по мотивам популярных эдитов: вклейки фигурами, вспышки, толчки камеры со смазом
  cardedit: {
    label: 'Вклейки / кино', desc: 'Следующий клип влетает карточкой, тёплый цвет, белые вспышки, тряска со смазом',
    rhythm: { energy: 'norm', loud: true, curves: 0.35, muteVideo: true },
    transitions: { pool: ['card', 'card', 'flyaway', 'flashburst', 'spinblur', 'irisout', 'circlecard'], every: 2, strong: 0.8, dur: 0.6 },
    beatfx: { pulse: 0.2, flash: 0.55, shake: 0, impact: 0.15, punch: 0.3, bshake: 0.45, rgb: 0 },
    look: { filter: 'warm', fx: { type: 'glow', amount: 0.3 }, fit: 'fill' },
  },
  esport: {
    label: 'Киберспорт / хайп', desc: 'Окна-круги и звёзды, зум-блюр, разрывы полосами, вспышки на сильных долях',
    rhythm: { energy: 'fast', loud: true, curves: 0.3, muteVideo: true },
    // как у «Димитрия»: вспышка-взрыв, поворот со смазом, зеркальный разлом, ирис, окна, свайпы
    transitions: { pool: ['flashburst', 'flashburst', 'spinblur', 'mirrorwarp', 'irisout', 'circlecard', 'star', 'card', 'zoomburst', 'swishleft', 'shakecut'], every: 2, strong: 0.85, dur: 0.4 },
    beatfx: { pulse: 0.3, flash: 0.7, shake: 0, impact: 0.2, punch: 0.4, bshake: 0.4, tear: 0.35, rgb: 0.15, stretch: 0.3 },
    look: { filter: 'vivid', fx: null, fit: 'fill' },
  },
  retro: {
    label: 'Ретро VHS', desc: 'Плёнка и VHS на всё видео, глитч-переходы, тёплый цвет',
    rhythm: { energy: 'norm', loud: true, curves: 0.15, muteVideo: true },
    transitions: { pool: ['glitch', 'fade', 'black'], every: 3, strong: 0.5, dur: 0.4 },
    beatfx: { pulse: 0.25, flash: 0, shake: 0.08, rgb: 0.2 },
    look: { filter: 'vintage', fx: { type: 'vhs', amount: 0.45 }, fit: null },
  },
};

export const BUILTIN = Object.fromEntries([
  ...Object.entries(CUT).map(([k, v]) => [k, { ...v, kind: 'cut' }]),
  ...Object.entries(EDIT).map(([k, v]) => [k, { ...v, kind: 'edit' }]),
]);

// ---------------------------------------------------------------------------
//   Свои пресеты (на этом устройстве)
// ---------------------------------------------------------------------------
const KEY = 'narezchik.profiles', DEF = 'narezchik.profile.default';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим — не запомнится */ } };

/** Старые свои профили (background + fit отдельно) → блок look. */
function upgrade(pr) {
  if (!pr.kind) pr.kind = 'cut';
  if (!pr.look && (pr.background || pr.fit !== undefined)) { pr.look = { background: pr.background, fit: pr.fit }; delete pr.background; delete pr.fit; }
  return pr;
}

export const customProfiles = () => Object.fromEntries(Object.entries(load(KEY, {})).map(([k, v]) => [k, upgrade(v)]));
export const allProfiles = () => ({ ...BUILTIN, ...customProfiles() });
export const presetsOf = (kind) => Object.fromEntries(Object.entries(allProfiles()).filter(([, v]) => v.kind === kind));
export const defaultProfile = () => load(DEF, null);
export const setDefaultProfile = (key) => store(DEF, key);

/** Сохранить свой пресет (новый или поверх своего же). */
export function saveCustomPreset(preset, key = null) {
  const all = load(KEY, {});
  key ||= 'my_' + Date.now().toString(36);
  all[key] = { ...structuredClone(preset), custom: true };
  store(KEY, all);
  return key;
}

export function deleteCustom(key) {
  const all = load(KEY, {});
  delete all[key];
  store(KEY, all);
  if (defaultProfile() === key) setDefaultProfile(null);
}

// ---------------------------------------------------------------------------
//   Блоки из проекта (для «как сейчас в проекте»)
// ---------------------------------------------------------------------------
const FIT = (m, W, H) => {
  if (!m?.width || !m?.height) return null;
  const contain = Math.min(1, (H * m.width) / (W * m.height));
  const fill = Math.max(1, (H * m.width) / (W * m.height));
  return { width: 1, contain, zoom: contain * 1.3, fill };
};

/** Кадрирование всех клипов: width — по ширине, zoom — 130%, fill — на весь экран, contain — целиком. */
export function fitClips(p, mode) {
  for (const c of p.clips) {
    const m = p.media.find((x) => x.id === c.media);
    const f = FIT(m, p.canvas.w, p.canvas.h);
    c.scale = +(f ? f[mode] ?? 1 : 1).toFixed(3);
    c.x = 0; c.y = 0;
  }
}

/** Как сейчас стоит первый клип — ближайший режим кадрирования. */
function guessFit(p) {
  const c = p.clips[0];
  const f = c && FIT(p.media.find((x) => x.id === c.media), p.canvas.w, p.canvas.h);
  if (!f) return null;
  return Object.entries(f).sort((a, b) => Math.abs(a[1] - c.scale) - Math.abs(b[1] - c.scale))[0][0];
}

export function blockFromProject(p, block) {
  const H = p.canvas.h;
  switch (block) {
    case 'parts': return { target: p.parts.target, max: p.parts.max };
    case 'subs': return { style: structuredClone(p.subs.style), y: p.subs.y / H, anim: structuredClone(p.subs.anim), opts: { ...p.subs.opts } };
    case 'headers': return { enabled: p.headers.enabled, y: p.headers.y / H, style: structuredClone(p.headers.style), anim: structuredClone(p.headers.anim), template: p.headers.template };
    case 'covers': return structuredClone(p.covers);
    case 'look': return { background: { ...p.background }, fit: guessFit(p), filter: p.clips[0]?.filter || 'none' };
    case 'overlays': return structuredClone(p.overlays || []);
    case 'ads': return p.ads?.enabled ? { set: Object.fromEntries(Object.entries(p.ads).filter(([k]) => !['enabled', 'items', 'seed', 'preset'].includes(k)).map(([k, v]) => [k, structuredClone(v)])),
      items: (p.ads.items || []).filter((i) => i.lib).map((i) => ({ lib: i.lib, name: i.name, trimIn: i.trimIn || 0, trimOut: i.trimOut || 0, speed: i.speed || 1 })) } : null;
    default: return null;
  }
}

/** Пресет целиком из текущего проекта. */
export function presetFromProject(p, kind = 'cut') {
  const pr = { kind, label: '' };
  for (const b of Object.keys(blocksOf(kind))) {
    const v = blockFromProject(p, b);
    if (v != null) pr[b] = v;
  }
  if (kind === 'edit') Object.assign(pr, structuredClone({ rhythm: EDIT.norm.rhythm, transitions: EDIT.norm.transitions, beatfx: EDIT.norm.beatfx }));
  return pr;
}

// ---------------------------------------------------------------------------
//   Применение
// ---------------------------------------------------------------------------
/** Свои тексты пресета → в проект (каждому новый id, чтобы не путались между проектами). */
const cloneOverlays = (list) => structuredClone(list || []).map((o) => ({ ...o, id: uid() }));

/** Реклама пресета → в проект: настройки сразу, ролики — из библиотеки при открытии (syncAdLibrary). */
function applyAds(p, ads) {
  if (!ads?.set) return;
  Object.assign(p.ads, structuredClone(ads.set), { enabled: true });
  if (ads.items?.length) {
    const have = new Set((p.ads.items || []).map((i) => i.lib).filter(Boolean));
    if (!ads.items.every((i) => have.has(i.lib))) {
      p.ads.items = ads.items.map((i) => ({ id: uid(), media: p.media.find((m) => m.lib === i.lib)?.id || null, lib: i.lib, name: i.name, trimIn: i.trimIn || 0, trimOut: i.trimOut || 0, speed: i.speed || 1 }));
    }
  }
}

export function applyLook(p, look) {
  if (!look) return;
  if (look.background) Object.assign(p.background, look.background);
  if (look.fit) fitClips(p, look.fit);
  if (look.filter && look.filter !== 'keep') for (const c of p.clips) c.filter = look.filter;
}

/** Пресет → проект (без истории — для нового проекта; из интерфейса — через applyProfile). */
export function applyTo(p, key) {
  const pr = allProfiles()[key];
  if (!pr) return false;
  if (pr.kind === 'edit') {
    // эдит-пресет сам по себе применяется при сборке; сразу ставим только цвет и тексты
    p.editPreset = key;
    if (pr.overlays) p.overlays = cloneOverlays(pr.overlays);
    applyAds(p, pr.ads);
    return true;
  }
  const { w: W, h: H } = p.canvas;
  p.profile = key;
  if (pr.parts) Object.assign(p.parts, pr.parts);
  if (pr.subs) {
    p.subs.style = structuredClone(pr.subs.style);
    p.subs.anim = structuredClone(pr.subs.anim);
    Object.assign(p.subs.opts, pr.subs.opts);
    p.subs.x = W / 2; p.subs.y = Math.round(pr.subs.y * H);
  }
  if (pr.headers) {
    p.headers.enabled = !!pr.headers.enabled;
    if (pr.headers.style) p.headers.style = structuredClone(pr.headers.style);
    if (pr.headers.anim) p.headers.anim = structuredClone(pr.headers.anim);
    if (pr.headers.template) p.headers.template = pr.headers.template;
    if (pr.headers.y != null) { p.headers.x = W / 2; p.headers.y = Math.round(pr.headers.y * H); }
  }
  if (pr.covers) {
    // аватарку и ник не стираем, если в пресете их нет — это твои данные, а не стиль
    const keep = { avatar: p.covers.avatar, nick: p.covers.nick, cardText: p.covers.cardText };
    const card = { ...p.covers.card, enabled: false, ...structuredClone(pr.covers.card || {}) };
    Object.assign(p.covers, structuredClone(pr.covers), { card });
    for (const [k, v] of Object.entries(keep)) if (!pr.covers[k]) p.covers[k] = v;
  }
  applyLook(p, pr.look);
  if (pr.overlays) p.overlays = cloneOverlays(pr.overlays);
  applyAds(p, pr.ads);
  return true;
}

export function applyProfile(key) {
  const pr = allProfiles()[key];
  // ролики рекламы пресета — из библиотеки, после применения
  const sync = () => { if (pr?.ads?.items?.length) import('./adsui.js').then((m) => m.syncAdLibrary()); };
  // у пресетов для YouTube/Shorts своё соотношение сторон — его ставит setAspect (с подгонкой текстов)
  if (pr?.aspect) import('./edit.js').then(({ setAspect, ASPECTS }) => {
    const [w, h] = ASPECTS[pr.aspect];
    if (S.project.canvas.w !== w || S.project.canvas.h !== h) setAspect(pr.aspect);
    commit((p) => applyTo(p, key));
    sync();
  });
  else { commit((p) => applyTo(p, key)); sync(); }
}
