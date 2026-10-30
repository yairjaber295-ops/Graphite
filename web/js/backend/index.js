// Выбор хранилища при запуске.
//  • Приложение на компе (окно Graphite.exe) → свой локальный сервер.
//  • Телефон → проекты на телефоне; если подключён комп по Wi-Fi — он делает субтитры
//    и можно открыть проекты с компа.
import { ServerBackend } from './server.js';
import { LocalBackend } from './local.js';

const KEY = 'narezchik.settings';

export function settings() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
export function saveSettings(patch) {
  const s = { ...settings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* приватный режим */ }
  return s;
}

/** Тестовые функции: по умолчанию скрыты, включаются в Настройках → «Тестовые функции». */
export const LABS = {
  autoedit: { label: 'Автоэдит под бит', desc: 'Моменты + музыка → эдит в бит с переходами и эффектами. Вкладка «Авто» → «Эдит под бит», тип проекта «Эдит под бит».' },
};
export const labOn = (key) => !!settings().labs?.[key];
export const setLab = (key, on) => saveSettings({ labs: { ...(settings().labs || {}), [key]: on } });

export const env = {
  native: !!window.Capacitor?.isNativePlatform?.(),
  ios: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  touch: matchMedia('(pointer: coarse)').matches,
  desktopApp: false,   // открыт в окне приложения на компе
  pcInfo: null,        // сведения о подключённом компе
};

async function probe(base, key, timeout = 2500) {
  const b = new ServerBackend(base, key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(b.url('/api/info'), { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) return null;
    return { backend: b, info: await r.json() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Возвращает хранилище для текущего режима. */
export async function initBackend() {
  const s = settings();
  // открыто с самого компа (окно приложения или браузер на этом же компе)
  const own = env.native ? null : await probe('', s.pcKey || '');
  if (own?.info.local) {
    env.desktopApp = true;
    env.pcInfo = own.info;
    return own.backend;
  }
  // телефон: есть ли связь с компом
  let pc = own?.info.authorized ? own : null;
  if (!pc && s.pcBase) {
    const r = await probe(s.pcBase, s.pcKey || '');
    if (r?.info.authorized) pc = r;
  }
  env.pcInfo = pc?.info || null;
  if (s.mode === 'pc' && pc) return pc.backend;
  return new LocalBackend(pc?.backend || null);
}

/** Подключение телефона к компу: адрес (http://192.168.x.x:8765) и код с экрана компа. */
export async function connectPc(base, key) {
  base = base.trim().replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) base = 'http://' + base;
  if (!/:\d+$/.test(base)) base += ':8765';
  const r = await probe(base, key.trim(), 5000);
  if (!r) throw new Error('Комп не отвечает. Проверь, что редактор запущен и телефон в той же Wi-Fi сети.');
  if (!r.info.authorized) throw new Error('Неверный код. Он показан на компе: «Телефон» → «Подключить телефон».');
  saveSettings({ pcBase: base, pcKey: key.trim() });
  return r.info;
}
