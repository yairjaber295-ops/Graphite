// Темы оформления интерфейса (на видео не влияют). Выбор хранится на этом устройстве.
export const THEMES = {
  graphite: { label: 'Графит', desc: 'Строгая «профи», как монтажки на ПК, оранжевый акцент', bg: '#0f1011', surface: '#1e1f22', accent: '#ff7a1a', accent2: '#ffb366', text: '#ececed' },
  carbon: { label: 'Карбон', desc: 'Плетёнка карбона, металлический блик, красный гоночный акцент', bg: '#0c0c0d', surface: '#1d1d1f', accent: '#ff2a3d', accent2: '#c9ced6', text: '#eeeef0' },
  neon: { label: 'Неон', desc: 'Тёмная, фиолетово-голубой градиент', bg: '#0b0b10', surface: '#1b1b25', accent: '#7c5cff', accent2: '#22d3ee', text: '#ecebf5' },
  acid: { label: 'Кислота', desc: 'Чёрный + кислотный лайм, острые углы — вайб эдитов', bg: '#050505', surface: '#151515', accent: '#c6ff3d', accent2: '#3dffd8', text: '#f2f2f2' },
  sunset: { label: 'Закат', desc: 'Тёплая тёмная, розово-оранжевая', bg: '#140c12', surface: '#2a1825', accent: '#ff5c8a', accent2: '#ffb347', text: '#f9ecf2' },
  light: { label: 'Светлая', desc: 'Для дня; кадр и таймлайн остаются тёмными', bg: '#f3f4f7', surface: '#ffffff', accent: '#3b6cff', accent2: '#00b3d6', text: '#15171d' },
};

// новый ключ: прошлая версия сама записывала «Неон» при каждом запуске, хотя никто его не выбирал
const KEY = 'narezchik.ui-theme';
export const DEFAULT_THEME = 'graphite';

export function currentTheme() {
  try { const k = localStorage.getItem(KEY); return THEMES[k] ? k : DEFAULT_THEME; } catch { return DEFAULT_THEME; }
}

/** save — запомнить выбор (только когда тему выбрали в настройках). */
export function applyTheme(key = currentTheme(), save = false) {
  if (!THEMES[key]) key = DEFAULT_THEME;
  if (key === 'neon') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = key;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES[key].bg);
  if (save) try { localStorage.setItem(KEY, key); } catch { /* не запомнится — не страшно */ }
}
