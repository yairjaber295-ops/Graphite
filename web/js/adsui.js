// Автореклама: ролики, сколько и когда (от длины каждой части), вид, звук, хромакей и пресеты.
// Ролики живут в библиотеке (на компе — папка ad_library, на телефоне — в приложении) и подтягиваются в любой проект.
import { S, commit, uid, fmtTime, AD_DEFAULTS, CHROMA_DEFAULTS } from './store.js';
import { h, field, range, color, select as sel, seg, check, toast, pct } from './ui.js';
import { loadMedia } from './mediastate.js';
import { adPlacements, adCount, adLength, AD_PLACES, AD_ORDERS, AD_ANIMS, AD_MODES } from './engine/ads.js';
import { seek, keyColorOf, peekAd } from './preview.js';
import { speedControl } from './speedui.js';

const PRESETS_KEY = 'narezchik.adpresets';
const load = () => { try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || {}; } catch { return {}; } };
const store = (v) => { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(v)); } catch { /* приватный режим */ } };

/** Настройки рекламы без самих роликов (то, что переносит пресет). */
export const AD_KEYS = Object.keys(AD_DEFAULTS).filter((k) => !['enabled', 'items', 'seed'].includes(k));
export const adSettings = (a) => Object.fromEntries(AD_KEYS.filter((k) => a[k] !== undefined).map((k) => [k, structuredClone(a[k])]));

const NO_KEY = { enabled: false };
const GREEN = { enabled: true, color: '#00FF00', sim: 0.4, smooth: 0.08, spill: 0.1 };

export const AD_BUILTIN = {
  native: { label: 'Нативно внизу', desc: '1 на минуту части, в паузе между фразами, окошко снизу',
    set: { pause: true, mode: 'pip', per: 60, min: 1, max: 2, minLen: 20, place: 'middle', at: 5, snap: true, maxDur: 0,
      x: 0.5, y: 0.74, size: 0.6, radius: 0.04, anim: 'pop', volume: 1, duck: 0.3, hideSubs: true, order: 'cycle', chroma: NO_KEY } },
  greensub: { label: 'Подписка на хромакее', desc: 'Анимация с зелёным фоном за 6 с до конца каждой части',
    set: { pause: true, mode: 'pip', per: 600, min: 1, max: 1, minLen: 15, place: 'end', at: 6, snap: false, maxDur: 0,
      x: 0.5, y: 0.62, size: 0.85, radius: 0, anim: 'none', volume: 1, duck: 1, hideSubs: false, order: 'cycle', chroma: GREEN } },
  fullmid: { label: 'На весь экран', desc: 'Вставка до 6 с посреди части, звук видео выключен',
    set: { pause: true, mode: 'full', per: 90, min: 1, max: 1, minLen: 30, place: 'middle', at: 8, snap: true, maxDur: 6,
      anim: 'fade', volume: 1, duck: 0, hideSubs: true, order: 'cycle', chroma: NO_KEY } },
  intro: { label: 'В начале части', desc: 'Короткий ролик в первые секунды, сверху',
    set: { pause: true, mode: 'pip', per: 600, min: 1, max: 1, minLen: 15, place: 'start', at: 2, snap: false, maxDur: 5,
      x: 0.5, y: 0.24, size: 0.55, radius: 0.05, anim: 'slide', volume: 1, duck: 0.5, hideSubs: false, order: 'cycle', chroma: NO_KEY } },
  often: { label: 'Часто', desc: 'Каждые 40 с, до 3 за часть, ролики по очереди',
    set: { pause: true, mode: 'pip', per: 40, min: 1, max: 3, minLen: 20, place: 'spread', at: 5, snap: true, maxDur: 0,
      x: 0.5, y: 0.74, size: 0.55, radius: 0.04, anim: 'pop', volume: 1, duck: 0.35, hideSubs: true, order: 'cycle', chroma: NO_KEY } },
};

export const adPresets = () => ({ ...AD_BUILTIN, ...Object.fromEntries(Object.entries(load()).map(([k, v]) => [k, { ...v, custom: true }])) });

/** Пресет → проект: настройки сразу, ролики из библиотеки — подтягиваются следом. */
export async function applyAdPreset(key) {
  const pr = adPresets()[key];
  if (!pr) return;
  commit((p) => {
    Object.assign(p.ads, structuredClone(pr.set), { enabled: true, preset: key });
    p.ads.chroma = { ...CHROMA_DEFAULTS, ...(pr.set.chroma || {}) };
    if (pr.items?.length) p.ads.items = pr.items.map((i) => ({ id: uid(), media: null, lib: i.lib, name: i.name, trimIn: i.trimIn || 0, trimOut: i.trimOut || 0, speed: i.speed || 1 }));
  });
  await syncAdLibrary();
}

export function saveAdPreset(label) {
  const a = S.project.ads;
  const all = load();
  const key = 'myad_' + Date.now().toString(36);
  all[key] = { label, desc: describe(a), set: adSettings(a), items: (a.items || []).filter((i) => i.lib).map((i) => ({ lib: i.lib, name: i.name, trimIn: i.trimIn || 0, trimOut: i.trimOut || 0, speed: i.speed || 1 })) };
  store(all);
  commit((p) => { p.ads.preset = key; });
  return key;
}

export function deleteAdPreset(key) { const all = load(); delete all[key]; store(all); }

function describe(a) {
  const n = a.min === a.max ? `${a.min}` : `${a.min}–${a.max}`;
  return `${AD_MODES[a.mode]} · 1 на ${a.per} с (${n} на часть) · ${AD_PLACES[a.place]?.toLowerCase()}${a.chroma?.enabled ? ' · хромакей' : ''}`;
}

// ---------------------------------------------------------------------------
//   Ролики и библиотека
// ---------------------------------------------------------------------------
let libCache = null;
async function library(force = false) {
  if (!libCache || force) libCache = await S.backend.libList().catch(() => []);
  return libCache;
}

/** Ролики пресета, которых ещё нет в проекте, — из библиотеки. */
export async function syncAdLibrary() {
  const p = S.project;
  const missing = (p?.ads?.items || []).filter((i) => !i.media && i.lib);
  if (!missing.length) return;
  const lib = await library(true);
  for (const it of missing) {
    let m = p.media.find((x) => x.lib === it.lib);
    if (!m) {
      const e = lib.find((x) => x.id === it.lib);
      if (!e) { toast(`Ролика «${it.name}» нет в библиотеке на этом устройстве`, 'err'); continue; }
      try { m = await S.backend.libUse(p.id, e); } catch (err) { toast(`«${it.name}»: ${err.message}`, 'err'); continue; }
      commit((q) => { q.media.push({ ...m, lib: e.id, role: 'ad' }); });
      loadMedia(m.id);
    }
    commit((q) => { const x = q.ads.items.find((i) => i.id === it.id); if (x) x.media = m.id; });
  }
}

async function addFromDevice(rerender) {
  const res = await S.backend.addMedia(S.project.id, 'video');
  res.errors?.forEach((e) => toast(e, 'err'));
  if (!res.items?.length) return;
  for (const m of res.items) {
    commit((p) => {
      p.media.push({ ...m, role: 'ad' });
      p.ads.items.push({ id: uid(), media: m.id, lib: null, name: m.name });
      p.ads.enabled = true;
    });
    loadMedia(m.id);
    // сразу в библиотеку — чтобы пресеты и другие проекты могли его взять
    S.backend.libAdd(S.project.id, m).then((e) => {
      libCache = null;
      commit((p) => { const it = p.ads.items.find((i) => i.media === m.id); if (it) it.lib = e.id; const mm = p.media.find((x) => x.id === m.id); if (mm) mm.lib = e.id; });
      rerender();
    }).catch((e) => console.warn('библиотека рекламы:', e));
  }
  rerender();
}

async function addFromLibrary(e, rerender) {
  commit((p) => { p.ads.items.push({ id: uid(), media: null, lib: e.id, name: e.name }); p.ads.enabled = true; });
  await syncAdLibrary();
  rerender();
}

// ---------------------------------------------------------------------------
//   Хромакей (и для рекламы, и для клипа)
// ---------------------------------------------------------------------------
/** get() → объект хромакея, set(fn, merge) — изменить его, mid — файл (для «Определить»). */
export function chromaEditor(get, set, mid, rerender) {
  const c = { ...CHROMA_DEFAULTS, ...(get() || {}) };
  const auto = () => {
    const col = mid && keyColorOf(mid);
    if (!col) return toast('Не вижу кадр этого видео — поставь курсор на него и попробуй ещё раз');
    set((x) => { x.enabled = true; x.color = col; });
    toast(`Фон: ${col}`, 'ok');
    rerender();
  };
  return h('div', { class: 'group' },
    check('Хромакей — убрать фон по цвету', c.enabled, (v) => { set((x) => { x.enabled = v; }); rerender(); }),
    c.enabled ? h('div', {},
      h('div', { class: 'row', style: { alignItems: 'center' } },
        field('Цвет фона', h('div', { class: 'row' }, color(c.color, (v) => set((x) => { x.color = v.toUpperCase(); }, 'color')))),
        h('div', { class: 'btn-row', style: { marginTop: '18px' } },
          h('button', { class: 'btn', onclick: () => { set((x) => { x.color = '#00FF00'; }); rerender(); } }, 'Зелёный'),
          h('button', { class: 'btn', onclick: () => { set((x) => { x.color = '#0000FF'; }); rerender(); } }, 'Синий'),
          mid ? h('button', { class: 'btn', onclick: auto }, 'Определить') : null)),
      range('Близость к цвету', c.sim, { min: 0.05, max: 0.8, step: 0.01, fmt: pct, onInput: (v) => set((x) => { x.sim = v; }, 'sim') }),
      range('Мягкость края', c.smooth, { min: 0.01, max: 0.4, step: 0.01, fmt: pct, onInput: (v) => set((x) => { x.smooth = v; }, 'smooth') }),
      range('Убрать цветной ореол', c.spill, { min: 0.01, max: 0.5, step: 0.01, fmt: pct, onInput: (v) => set((x) => { x.spill = v; }, 'spill') }),
      h('div', { class: 'note' }, 'Остаются куски фона — прибавь «Близость». Пропадают детали (серое, белое) — убавь. Ореол по краям — «Убрать цветной ореол».')) : null);
}

// ---------------------------------------------------------------------------
//   Раздел «Реклама»
// ---------------------------------------------------------------------------
export function adsSection(rerender, { open = null } = {}) {
  const p = S.project, a = p.ads;
  const set = (k, v, merge) => commit((q) => { q.ads[k] = v; }, merge ? 'ads-' + k : null);
  const setR = (k, v) => { set(k, v); rerender(); };
  const items = a.items || [];
  const list = adPlacements();
  const presets = adPresets();
  const lib = libCache || [];
  if (!libCache) library().then(() => rerender());
  const inProject = new Set(items.map((i) => i.lib).filter(Boolean));
  const mediaOf = (id) => p.media.find((m) => m.id === id);
  const first = mediaOf(items.find((i) => i.media)?.media);
  const sample = first ? Math.round(adLength(first, {}, a)) : null;

  const presetTiles = h('div', { class: 'profile-grid' },
    ...Object.entries(presets).map(([k, pr]) => h('div', { class: 'profile' + (a.preset === k && a.enabled ? ' on' : ''), onclick: () => applyAdPreset(k).then(() => { rerender(); toast(`Реклама: «${pr.label}»`, 'ok'); }) },
      h('b', {}, pr.label), h('small', {}, pr.desc || ''),
      pr.custom ? h('span', { class: 'acts' }, h('span', { class: 'x', title: 'Удалить', onclick: (e) => {
        e.stopPropagation();
        if (confirm(`Удалить пресет рекламы «${pr.label}»?`)) { deleteAdPreset(k); rerender(); }
      } }, '×')) : null)),
    h('div', { class: 'profile add', onclick: () => {
      const name = prompt('Название пресета рекламы', 'Моя реклама');
      if (!name?.trim()) return;
      saveAdPreset(name.trim());
      toast(`Пресет «${name.trim()}» сохранён — с роликами и всеми настройками`, 'ok');
      rerender();
    } }, h('b', {}, '+ Сохранить как пресет'), h('small', {}, 'Ролики, сколько, когда, вид и хромакей — как сейчас')));

  const setItem = (id, k, v) => commit((q) => { const x = q.ads.items.find((i) => i.id === id); if (x) x[k] = v; q.ads.maxDur = 0; }, `ad-item-${id}-${k}`);
  /** Длина ролика: с какой секунды и по какую (у фото — сколько показывать). */
  const trimRow = (it, m) => {
    if (!m) return null;
    if (m.kind === 'image') return range('Показывать', it.trimOut || a.maxDur || 4, { min: 1, max: 15, step: 0.5, fmt: (v) => v + ' с', onInput: (v) => setItem(it.id, 'trimOut', v) });
    const dur = m.duration || 1, tin = it.trimIn || 0, tout = it.trimOut > tin ? it.trimOut : dur;
    const lenEl = h('span', { class: 'dim' }, `отрезок ${(tout - tin).toFixed(1)} с`);
    return h('div', { class: 'ad-trim' },
      range('Начало ролика', tin, { min: 0, max: Math.max(0, dur - 0.5), step: 0.1, fmt: (v) => v.toFixed(1) + ' с', onInput: (v) => {
        setItem(it.id, 'trimIn', v);
        lenEl.textContent = `отрезок ${((it.trimOut > v ? it.trimOut : dur) - v).toFixed(1)} с`;
      } }),
      range('Конец ролика', tout, { min: 0.5, max: dur, step: 0.1, fmt: (v) => v.toFixed(1) + ' с', onInput: (v) => {
        setItem(it.id, 'trimOut', Math.max(v, (it.trimIn || 0) + 0.5));
        lenEl.textContent = `отрезок ${(Math.max(v, (it.trimIn || 0) + 0.5) - (it.trimIn || 0)).toFixed(1)} с`;
      } }),
      h('div', { class: 'note', style: { margin: '0 0 6px' } }, lenEl, ' · или тяни правый край рекламы на таймлайне'),
      h('b', { style: { fontSize: '12px' } }, 'Скорость ролика'),
      speedControl({ speed: it.speed || 1, srcLen: tout - tin, min: 0.25, max: 4, presets: [0.75, 1, 1.25, 1.5, 2, 3],
        onChange: (s, live) => commit((q) => { const x = q.ads.items.find((i) => i.id === it.id); if (x) x.speed = s; }, live ? `ad-item-${it.id}-speed` : null) }));
  };
  const itemRows = items.map((it) => {
    const m = mediaOf(it.media);
    return h('div', {}, h('div', { class: 'media-item' },
      h('div', { class: 'mi-thumb', style: { backgroundImage: S.media[it.media]?.tileUrls?.[0] ? `url("${S.media[it.media].tileUrls[0]}")` : 'none', backgroundSize: 'auto 100%' } }),
      h('div', { class: 'mi-info' },
        h('div', { class: 'mi-name' }, it.name || m?.name || 'Ролик'),
        h('div', { class: 'mi-meta' }, m ? `${fmtTime(m.duration, false)} · ${m.width}×${m.height}${it.lib ? ' · в библиотеке' : ''}` : 'подтягиваю из библиотеки…')),
      h('button', { class: 'icon-btn', title: 'Убрать из проекта (в библиотеке останется)', onclick: () => { commit((q) => { q.ads.items = q.ads.items.filter((x) => x.id !== it.id); }); rerender(); } }, '×')),
      trimRow(it, m));
  });

  const libChips = lib.filter((e) => !inProject.has(e.id));
  const byPart = {};
  for (const x of list) (byPart[x.part] ||= []).push(x);

  const box = h('details', { class: 'group ads-box', open: open ?? adsOpen ?? a.enabled },
    h('summary', {}, h('b', {}, '📢 Реклама'), h('span', { class: 'dim' }, a.enabled && list.length ? ` · ${list.length} вставок` : a.enabled ? ' · включена' : ' · выключена')),
    h('div', { class: 'note' }, 'Твои ролики сами встают в каждую часть: сколько и когда — от длины части. Части поменялись — реклама переставится сама.'),
    check('Вставлять рекламу', a.enabled, (v) => setR('enabled', v)),
    h('h4', {}, 'Пресеты'),
    presetTiles,
    h('h4', {}, `Ролики · ${items.length}`),
    itemRows.length ? h('div', {}, ...itemRows) : h('div', { class: 'note' }, 'Добавь ролик рекламы — он сохранится в библиотеку и будет доступен в любом проекте.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: () => addFromDevice(rerender).catch((e) => toast(e.message, 'err')) }, '+ Ролик рекламы'),
      items.length > 1 ? field('', seg(AD_ORDERS, a.order, (v) => setR('order', v))) : null),
    libChips.length ? h('div', {}, h('div', { class: 'note', style: { marginBottom: '4px' } }, 'Из библиотеки:'),
      h('div', { class: 'chips' }, ...libChips.map((e) => h('button', { class: 'chip-btn', title: 'Добавить в проект', onclick: () => addFromLibrary(e, rerender) }, `+ ${e.name}`,
        h('span', { class: 'dim', title: 'Удалить из библиотеки', style: { marginLeft: '6px' }, onclick: (ev) => {
          ev.stopPropagation();
          if (!confirm(`Убрать «${e.name}» из библиотеки рекламы?`)) return;
          S.backend.libRemove(e.id).then(() => { libCache = null; library(true).then(rerender); });
        } }, '×'))))) : null,

    h('h4', {}, 'Сколько'),
    field('', seg({ part: 'В каждой части', video: 'На всё видео' }, a.scope, (v) => setR('scope', v))),
    range('Один ролик на каждые', a.per, { min: 15, max: 300, step: 5, fmt: (v) => (v >= 300 ? '5 мин' : v + ' с'), onInput: (v) => set('per', v, true) }),
    h('div', { class: 'row' },
      field('', range('Минимум', a.min, { min: 0, max: 5, onInput: (v) => commit((q) => { q.ads.min = v; q.ads.max = Math.max(q.ads.max, v); }, 'ads-min') })),
      field('', range('Максимум', a.max, { min: 1, max: 6, onInput: (v) => commit((q) => { q.ads.max = v; q.ads.min = Math.min(q.ads.min, v); }, 'ads-max') }))),
    range(a.scope === 'video' ? 'Видео короче — без рекламы' : 'Части короче — без рекламы', a.minLen, { min: 0, max: 120, step: 5, fmt: (v) => (v ? v + ' с' : 'нет'), onInput: (v) => set('minLen', v, true) }),
    h('div', { class: 'note' }, `Например: 45 с → ${adCount(45, a)}, 1 мин → ${adCount(60, a)}, 2 мин → ${adCount(120, a)}, 4 мин → ${adCount(240, a)}.`),

    h('h4', {}, 'Когда'),
    field('', sel(AD_PLACES, a.place, (v) => setR('place', v))),
    range('Не ближе к краю части', a.at, { min: 0, max: 30, step: 1, fmt: (v) => v + ' с', onInput: (v) => set('at', v, true) }),
    check('Ставить в паузу между фразами (по субтитрам)', a.snap, (v) => setR('snap', v)),
    range('Длительность ролика', a.maxDur, { min: 0, max: 30, step: 0.5, fmt: (v) => (v ? `до ${v} с` : `целиком${sample ? ` (${sample} с)` : ''}`), onInput: (v) => set('maxDur', v, true) }),
    a.place === 'random' || a.order === 'random' ? h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => setR('seed', (a.seed || 1) + 1) }, '🎲 Перемешать')) : null,

    h('h4', {}, 'Вид'),
    check('Видео на паузе, пока идёт реклама (вставка)', a.pause, (v) => setR('pause', v)),
    h('div', { class: 'note' }, a.pause
      ? 'Видео останавливается в точке вставки, идёт ролик, потом видео продолжается с того же места. Каждая часть становится длиннее на длину рекламы.'
      : 'Ролик идёт поверх, видео не останавливается (его звук приглушается — ниже, «Звук»).'),
    field('', seg(AD_MODES, a.mode, (v) => setR('mode', v))),
    a.mode === 'pip' ? h('div', {},
      range('Размер', a.size, { min: 0.15, max: 1, step: 0.01, fmt: pct, onInput: (v) => set('size', v, true) }),
      range('Высота на экране', a.y, { min: 0.05, max: 0.95, step: 0.01, fmt: pct, onInput: (v) => set('y', v, true) }),
      range('Скругление углов', a.radius, { min: 0, max: 0.25, step: 0.01, fmt: pct, onInput: (v) => set('radius', v, true) }),
      h('div', { class: 'note' }, 'В кадре рекламу можно двигать мышкой/пальцем, колесо или два пальца — размер.')) : null,
    field('Появление', sel(AD_ANIMS, a.anim, (v) => setR('anim', v))),
    check('Прятать субтитры и заголовки, пока идёт реклама', a.hideSubs, (v) => setR('hideSubs', v)),

    h('h4', {}, 'Звук'),
    range('Громкость рекламы', a.volume, { min: 0, max: 1.5, step: 0.05, fmt: pct, onInput: (v) => set('volume', v, true) }),
    a.pause ? null : range('Видео во время рекламы', a.duck, { min: 0, max: 1, step: 0.05, fmt: (v) => (v ? pct(v) : 'без звука'), onInput: (v) => set('duck', v, true) }),

    h('h4', {}, 'Хромакей'),
    chromaEditor(() => a.chroma, (fn, merge) => commit((q) => { q.ads.chroma = { ...CHROMA_DEFAULTS, ...q.ads.chroma }; fn(q.ads.chroma); }, merge ? 'ads-chroma-' + merge : null),
      items.find((i) => i.media)?.media, rerender),

    a.enabled && items.length ? h('div', {},
      h('h4', {}, `Расстановка · ${list.length}`),
      list.length ? h('div', { class: 'file-list' }, ...Object.entries(byPart).map(([part, xs]) => h('div', {},
        h('b', {}, a.scope === 'video' ? 'Видео: ' : `Часть ${part}: `),
        ...xs.map((x, i) => h('span', { style: { cursor: 'pointer', textDecoration: 'underline dotted' }, title: x.name, onclick: () => (x.insert ? peekAd(x, 0.5) : seek(x.start + 0.4)) },
          `${i ? ', ' : ''}${x.insert ? `⏸ ${fmtTime(x.start, false)} (+${Math.round(x.end - x.start)} с)` : `${fmtTime(x.start, false)}–${fmtTime(x.end, false)}`}`)))))
        : h('div', { class: 'note warn' }, 'Ни одна часть не подошла: части короче минимума или ролик длиннее части.')) : null);
  if (open == null) box.addEventListener('toggle', () => { adsOpen = box.open; });
  return box;
}
let adsOpen = null;
