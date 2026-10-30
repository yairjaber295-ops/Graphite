// Свои тексты пресета: «Подпишись — дальше {next}», ник на всё видео, название в начале…
// Повторяются сами в каждой части (или в начале/конце видео). Один редактор — и для проекта, и для конструктора пресетов.
import { S, commit, OVERLAY_WHEN, STYLE_BASE, uid, freeTexts, parts } from './store.js';
import { h, field, range, color, select as sel, toast } from './ui.js';
import { ANIMS_IN, ANIMS_OUT, TYPING_CPS } from './engine/text.js';
import { TEXT_STYLES } from './textstyles.js';

const st = (o) => ({ ...STYLE_BASE, wrap: 22, ...o });

/** Заготовки, с которых удобно начать. */
export const OVERLAY_TEMPLATES = {
  follow: { label: 'Подписка в конце части', make: () => ({ text: 'Подпишись — {next} уже в профиле', when: 'part-end', dur: 3, y: 0.84,
    style: st({ font: 'Rubik-800', size: 56, color: '#FFFFFF', box: true, boxColor: '#EB2D41', boxAlpha: 1, boxPad: 16, shadowAlpha: 0 }),
    anim: { in: 'pop', out: 'fade', dur: 220 } }) },
  title: { label: 'Название печатается в начале', make: () => ({ text: '{title}', when: 'video-start', dur: 3, y: 0.3,
    style: st({ font: 'Rubik-800', size: 74, strokeWidth: 8 }), anim: { in: 'typing', out: 'fade', dur: 200, cps: 16 } }) },
  part: { label: '«Часть N» в начале части', make: () => ({ text: 'ЧАСТЬ {n}', when: 'part-start', dur: 2, y: 0.12,
    style: st({ font: 'RussoOne-400', size: 52, color: '#111111', box: true, boxColor: '#FFE14D', boxAlpha: 1, boxPad: 12, shadowAlpha: 0 }),
    anim: { in: 'slidedown', out: 'slideup', dur: 250 } }) },
  nick: { label: 'Ник на всё видео', make: () => ({ text: '{nick}', when: 'always', dur: 3, y: 0.93,
    style: st({ font: 'Onest-700', size: 34, strokeWidth: 3, shadowAlpha: 0.3 }), anim: { in: 'none', out: 'none', dur: 200 } }) },
  custom: { label: 'Свой текст', make: () => ({ text: 'Текст', when: 'part-start', dur: 3, y: 0.5, style: st({ font: 'Rubik-700' }), anim: { in: 'pop', out: 'fade', dur: 200 } }) },
};

export const newOverlay = (tpl = 'custom') => ({ id: uid(), x: 0.5, offset: 0, ...OVERLAY_TEMPLATES[tpl].make() });

/** Свободные тексты проекта → свои тексты (привязка к ближайшему началу/концу части). */
export function overlaysFromTexts(p) {
  const ps = parts();
  return freeTexts().map((t) => {
    const part = ps.find((x) => t.start >= x.start - 0.01 && t.start < x.end) || ps[0];
    const fromStart = t.start - part.start, toEnd = part.end - t.end;
    const atEnd = ps.length > 1 && toEnd < fromStart;
    return { id: uid(), text: t.text, when: ps.length > 1 ? (atEnd ? 'part-end' : 'part-start') : 'video-start',
      offset: +Math.max(0, atEnd ? toEnd : fromStart).toFixed(2), dur: +(t.end - t.start).toFixed(2),
      x: t.x / p.canvas.w, y: t.y / p.canvas.h, style: structuredClone(t.style), anim: structuredClone(t.anim || {}) };
  });
}

/**
 * Список своих текстов.
 * get() — массив; mutate(fn, mergeKey) — изменить (через историю проекта или в черновике пресета); rerender() — перерисовать.
 */
export function overlayList(get, mutate, rerender, { fromProject = false } = {}) {
  const list = get() || [];
  const add = (tpl) => { mutate((arr) => arr.push(newOverlay(tpl))); rerender(); };
  return h('div', {},
    list.length ? h('div', {}, ...list.map((o) => overlayItem(o, (fn, key) => mutate((arr) => { const x = arr.find((y) => y.id === o.id); if (x) fn(x); }, key),
      () => { mutate((arr) => { const i = arr.findIndex((y) => y.id === o.id); if (i >= 0) arr.splice(i, 1); }); rerender(); }, rerender))) : h('div', { class: 'note' }, 'Пока нет. Добавь заготовку:'),
    h('div', { class: 'btn-row' }, ...Object.entries(OVERLAY_TEMPLATES).map(([k, t]) => h('button', { class: 'btn', onclick: () => add(k) }, '+ ' + t.label))),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => {
      const got = overlaysFromTexts(S.project);
      if (!got.length) return toast('В проекте нет своих текстов — добавь во вкладке «Текст»');
      if (fromProject) {
        // в проекте тексты превращаются в повторяющиеся (оригиналы убираются, иначе были бы дважды)
        commit((p) => { p.overlays = [...(p.overlays || []), ...got]; p.texts = p.texts.filter((t) => t.track === 'subs'); });
      } else mutate((arr) => arr.push(...got));
      toast(`Забрано текстов: ${got.length}. Теперь они повторяются сами`, 'ok');
      rerender();
    } }, 'Забрать тексты из проекта')),
    h('div', { class: 'note' }, 'В тексте можно писать {title} — название, {n} — номер части, {label} — «(часть N)», {next} — «часть N+1»/«финал», {nick} — ник.'));
}

/** Один свой текст. set(fn, mergeKey) — правка, remove() — удалить. */
export function overlayItem(o, set, remove, rerender = () => {}) {
  const k = (name) => `ov-${o.id}-${name}`;
  const ta = h('textarea', { spellcheck: false, rows: 2 }, o.text);
  ta.addEventListener('input', () => set((x) => { x.text = ta.value; }, k('text')));
  const styleNames = Object.fromEntries([['', '— стиль —'], ...TEXT_STYLES.map((s, i) => [String(i), s.name]), ['subs', 'Как у субтитров'], ['headers', 'Как у заголовков']]);
  const a = o.anim || {};
  const typing = a.in === 'typing' || a.out === 'typing';
  return h('div', { class: 'group' },
    field('Текст', ta),
    h('div', { class: 'row' },
      field('Когда', sel(OVERLAY_WHEN, o.when || 'part-start', (v) => { set((x) => { x.when = v; }); rerender(); })),
      field('Стиль', sel(styleNames, '', (v) => {
        if (v === '') return;
        const p = S.project;
        const base = v === 'subs' ? p.subs.style : v === 'headers' ? p.headers.style : TEXT_STYLES[+v].style;
        set((x) => { x.style = { ...STYLE_BASE, wrap: 22, ...structuredClone(base), size: x.style?.size || base.size || STYLE_BASE.size }; });
      }))),
    o.when !== 'always' ? h('div', { class: 'row' },
      field('', range('Сколько', o.dur || 3, { min: 0.5, max: 15, step: 0.5, fmt: (v) => v + ' с', onInput: (v) => set((x) => { x.dur = v; }, k('dur')) })),
      field('', range(o.when?.endsWith('end') ? 'До конца' : 'Отступ от начала', o.offset || 0, { min: 0, max: 30, step: 0.5, fmt: (v) => v + ' с', onInput: (v) => set((x) => { x.offset = v; }, k('off')) }))) : null,
    h('div', { class: 'row' },
      field('Появление', sel(ANIMS_IN, a.in || 'none', (v) => { set((x) => { x.anim = { ...x.anim, in: v }; }); rerender(); })),
      field('Исчезание', sel(ANIMS_OUT, a.out || 'none', (v) => { set((x) => { x.anim = { ...x.anim, out: v }; }); rerender(); }))),
    typing ? range('Скорость печати', a.cps || TYPING_CPS, { min: 4, max: 40, fmt: (v) => v + ' букв/с', onInput: (v) => set((x) => { x.anim = { ...x.anim, cps: v }; }, k('cps')) }) : null,
    h('div', { class: 'row' },
      field('', range('Размер', o.style?.size || 60, { min: 16, max: 200, onInput: (v) => set((x) => { x.style = { ...x.style, size: v }; }, k('size')) })),
      field('Цвет', h('div', { class: 'row' }, color(o.style?.color || '#FFFFFF', (v) => set((x) => { x.style = { ...x.style, color: v }; }, k('color')))))),
    h('div', { class: 'row' },
      field('', range('По высоте', Math.round((o.y ?? 0.5) * 100), { min: 3, max: 97, fmt: (v) => v + '%', onInput: (v) => set((x) => { x.y = v / 100; }, k('y')) })),
      field('', range('По ширине', Math.round((o.x ?? 0.5) * 100), { min: 3, max: 97, fmt: (v) => v + '%', onInput: (v) => set((x) => { x.x = v / 100; }, k('x')) }))),
    h('div', { class: 'btn-row', style: { marginTop: 0 } }, h('button', { class: 'btn danger', onclick: remove }, 'Удалить текст')));
}

/** Свои тексты текущего проекта (вкладка «Авто», инспектор). */
export function projectOverlays(rerender) {
  return overlayList(() => S.project.overlays, (fn, key) => commit((p) => { p.overlays ||= []; fn(p.overlays); }, key || null), rerender, { fromProject: true });
}
