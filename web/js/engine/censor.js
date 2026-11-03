// Запикивание мата: по распознанным словам (Whisper) — «пик» или тишина в звуке клипов, «б***» в субтитрах.
// Одни и те же места — в превью и в экспорте. Настройки — S.project.censor: { on, mode: 'beep'|'mute', subs, custom }.
import { S, on, clipsTL } from '../store.js';
import { tlOffset } from './speed.js';
import P from './profanity.js';

const ROOTS = P.roots.map((r) => new RegExp(r));
const norm = (w) => String(w).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я*]/g, '');
export const BEEP_HZ = 1000;
export const BEEP_GAIN = 0.22;

/** Свои слова из настроек: «слово, другое» → начала слов. */
const customList = () => String(S.project?.censor?.custom || '').split(/[,;\n]/).map(norm).filter((x) => x.length >= 2);

export function isProfane(word, custom = customList()) {
  const w = norm(word);
  if (!w) return false;
  if (w.includes('*') && /[a-zа-я]/.test(w)) return true;   // Whisper сам скрыл звёздочками
  if (P.except.some((e) => w.startsWith(e))) return false;
  return ROOTS.some((r) => r.test(w)) || custom.some((c) => w.startsWith(c));
}

/** «блять, сука» → «б****, с***» (первая буква остаётся — понятно, что было, но не написано). */
export function maskText(text) {
  const custom = customList();
  return String(text).replace(/[A-Za-zА-Яа-яЁё*]+/g, (m) => (isProfane(m, custom) ? m[0] + '*'.repeat(m.length - 1) : m));
}

/** Текст субтитра для показа: со звёздочками, если включено. */
export function censorText(item) {
  const c = S.project?.censor;
  return item.track === 'subs' && c?.on && c.subs !== false ? maskText(item.text) : item.text;
}

let cache = null;
on('derived-reset', () => { cache = null; });

/** Места с матом на таймлайне: [{ s, e, word }], слитые, по порядку. */
export function censorRegions(force = false) {
  const p = S.project;
  if (!p || (!p.censor?.on && !force)) return [];
  const key = p.media.map((m) => S.media[m.id]?.words?.words?.length || 0).join(',') + '|' + (p.censor?.custom || '');
  if (!force && cache && cache.p === p && cache.key === key) return cache.list;
  const custom = customList();
  const out = [];
  for (const c of clipsTL()) {
    const words = S.media[c.media]?.words?.words;
    if (!words) continue;
    for (const [ws, we, text] of words) {
      if (ws < c.in - 0.02 || ws >= c.out || !isProfane(text, custom)) continue;
      const s = c.start + Math.max(0, tlOffset(c, ws - c.in)) - 0.04;
      const e = Math.min(c.end, c.start + tlOffset(c, we - c.in)) + 0.04;
      if (e > s) out.push({ s: Math.max(0, s), e, word: text.trim() });
    }
  }
  out.sort((a, b) => a.s - b.s);
  const list = [];
  for (const r of out) {
    const last = list[list.length - 1];
    if (last && r.s <= last.e + 0.05) { last.e = Math.max(last.e, r.e); last.word += ' ' + r.word; } else list.push({ ...r });
  }
  if (!force) cache = { p, key, list };
  return list;
}

const inside = (t) => censorRegions().some((r) => t >= r.s && t < r.e);
/** Множитель громкости клипов в момент t: 0 на мате. */
export const censorGain = (t) => (inside(t) ? 0 : 1);
/** Пищать ли сейчас. */
export const censorBeep = (t) => S.project?.censor?.mode !== 'mute' && inside(t);

/** Экспорт: глушение мата на параметре громкости (время — от начала куска a), края по 10 мс. */
export function automateCensor(param, a, b) {
  const list = censorRegions().filter((r) => r.e > a && r.s < b);
  param.setValueAtTime(list.some((r) => r.s <= a && r.e > a) ? 0 : 1, 0);
  for (const r of list) {
    if (r.s > a) { param.setValueAtTime(1, Math.max(0, r.s - a - 0.01)); param.linearRampToValueAtTime(0, r.s - a); }
    if (r.e < b) { param.setValueAtTime(0, r.e - a); param.linearRampToValueAtTime(1, r.e - a + 0.01); }
  }
}

/** Экспорт: «пик» поверх заглушённых мест куска [a, b). */
export function addBeeps(ctx, a, b) {
  if (S.project?.censor?.mode === 'mute') return;
  for (const r of censorRegions()) {
    if (r.e <= a || r.s >= b) continue;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = BEEP_HZ;
    const s = Math.max(0, r.s - a), e = Math.min(b, r.e) - a;
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(BEEP_GAIN, s + 0.005);
    g.gain.setValueAtTime(BEEP_GAIN, Math.max(s + 0.005, e - 0.005));
    g.gain.linearRampToValueAtTime(0, e);
    o.connect(g).connect(ctx.destination);
    o.start(s); o.stop(e);
  }
}
