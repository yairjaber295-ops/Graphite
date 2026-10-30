// Горячие клавиши: действия, готовые схемы (CapCut / Premiere / DaVinci) и свои назначения.
// Клавиши хранятся как физические кнопки (e.code), поэтому работают на любой раскладке.

export const ACTIONS = {
  play: 'Пуск / пауза',
  pause: 'Пауза',
  split: 'Разрезать',
  delete: 'Удалить',
  trimLeft: 'Обрезать слева до курсора',
  trimRight: 'Обрезать справа до курсора',
  undo: 'Отменить',
  redo: 'Повторить',
  frameBack: 'Кадр назад',
  frameFwd: 'Кадр вперёд',
  secBack: 'Секунда назад',
  secFwd: 'Секунда вперёд',
  home: 'В начало',
  end: 'В конец',
  prevPart: 'Предыдущая часть',
  nextPart: 'Следующая часть',
  addCut: 'Граница части',
  addText: 'Добавить текст',
  duplicate: 'Дублировать',
  zoomIn: 'Приблизить таймлайн',
  zoomOut: 'Отдалить таймлайн',
  fit: 'Весь таймлайн в окно',
  deselect: 'Снять выделение',
  selectAll: 'Выделить всё',
  exportVideo: 'Экспорт',
  save: 'Сохранить',
};

const base = {
  play: ['Space'], pause: [], delete: ['Delete', 'Backspace'], undo: ['Ctrl+KeyZ'], redo: ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY'],
  frameBack: ['ArrowLeft'], frameFwd: ['ArrowRight'], secBack: ['Shift+ArrowLeft'], secFwd: ['Shift+ArrowRight'],
  home: ['Home'], end: ['End'], prevPart: ['BracketLeft'], nextPart: ['BracketRight'], addText: ['KeyT'],
  duplicate: ['Ctrl+KeyD'], zoomIn: ['Equal', 'NumpadAdd', 'Ctrl+Equal'], zoomOut: ['Minus', 'NumpadSubtract', 'Ctrl+Minus'],
  fit: ['Shift+KeyZ'], deselect: ['Escape'], selectAll: ['Ctrl+KeyA'], exportVideo: ['Ctrl+KeyE'], save: ['Ctrl+KeyS'],
};

export const PRESETS = {
  capcut: { label: 'CapCut', keys: { ...base, split: ['Ctrl+KeyB'], trimLeft: ['KeyQ'], trimRight: ['KeyW'], addCut: ['KeyM'] } },
  premiere: { label: 'Premiere Pro', keys: { ...base, play: ['Space', 'KeyL'], pause: ['KeyK'], split: ['Ctrl+KeyK'],
    trimLeft: ['KeyQ'], trimRight: ['KeyW'], addCut: ['KeyM'], delete: ['Delete', 'Backspace', 'Shift+Delete'] } },
  davinci: { label: 'DaVinci Resolve', keys: { ...base, play: ['Space', 'KeyL'], pause: ['KeyK'], split: ['Ctrl+KeyB', 'Ctrl+Backslash'],
    trimLeft: ['Ctrl+Shift+BracketLeft'], trimRight: ['Ctrl+Shift+BracketRight'], prevPart: ['ArrowUp'], nextPart: ['ArrowDown'], addCut: ['KeyM'] } },
};

const KEY = 'narezchik.keys';
let map = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    // новые действия (появившиеся после сохранения) берутся из схемы CapCut
    if (s?.keys) return { preset: s.preset || 'custom', keys: { ...PRESETS.capcut.keys, ...s.keys } };
  } catch { /* нет сохранённых */ }
  return { preset: 'capcut', keys: structuredClone(PRESETS.capcut.keys) };
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* приватный режим */ }
}

export const current = () => map;
export function usePreset(name) { map = { preset: name, keys: structuredClone(PRESETS[name].keys) }; persist(); }
export function setKeys(action, combos) { map.keys[action] = combos; map.preset = 'custom'; persist(); }

export function comboOf(e) {
  if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return null;
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.code].filter(Boolean).join('+');
}

export function actionFor(e) {
  const c = comboOf(e);
  if (!c) return null;
  for (const [a, list] of Object.entries(map.keys)) if (list?.includes(c)) return a;
  return null;
}

const NAMES = {
  Space: 'Пробел', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Equal: '=', Minus: '−',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Escape: 'Esc',
  Delete: 'Del', Backspace: '⌫', Home: 'Home', End: 'End', Enter: 'Enter', Comma: ',', Period: '.', Slash: '/',
};
export function prettyCombo(c) {
  return c.split('+').map((p) => NAMES[p] || p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ')).join(' + ');
}
export const keysText = (action) => (map.keys[action] || []).map(prettyCombo).join(' / ');
