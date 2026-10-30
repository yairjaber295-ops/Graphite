// Конструктор пресета: каждый блок берётся из любого готового пресета, из текущего проекта или настраивается тут же.
import { S } from './store.js';
import { h, field, range, select as sel, seg, check, textInput, modal, toast, pct, fill } from './ui.js';
import { allProfiles, blocksOf, blockFromProject, presetFromProject, saveCustomPreset, applyProfile, setDefaultProfile } from './profiles.js';
import { overlayList } from './overlays.js';
import { TRANSITIONS, FILTERS, EFFECTS } from './engine/effects.js';
import { ANIMS_IN } from './engine/text.js';
import { COVER_STYLES } from './engine/covers.js';
import { ENERGY } from './autoedit.js';

const FITS = { '': 'Не менять', width: 'По ширине', zoom: 'Крупнее 130%', fill: 'На весь экран', contain: 'Целиком' };
const fontName = (id) => S.fontMap[id]?.label || id;

/** Короткое описание блока — чтобы видеть, что в нём. */
function summary(block, v) {
  if (!v) return 'Пресет этот блок не трогает';
  switch (block) {
    case 'parts': return v.max <= 1 ? 'Без частей — одно видео' : `Части ~${v.target} с, не больше ${v.max}`;
    case 'subs': return `${fontName(v.style?.font)}, ${v.style?.size}px${v.style?.upper ? ', ЗАГЛАВНЫЕ' : ''} · ${ANIMS_IN[v.anim?.in] || 'без анимации'}` +
      `${v.anim?.karaoke ? ' · подсветка слов' : ''} · до ${v.opts?.maxChars} символов · высота ${pct(v.y)}`;
    case 'headers': return v.enabled ? `${fontName(v.style?.font)}, ${v.style?.size}px · ${ANIMS_IN[v.anim?.in] || 'без анимации'}` : 'Без заголовков';
    case 'covers': return `${v.enabled ? 'Обложка' : 'Обложка выключена'} «${COVER_STYLES[v.style]?.label || v.style}», ${fontName(v.font)}${v.card?.enabled ? ' + карточка поверх видео' : ''}${v.avatar ? ' + аватарка' : ''}`;
    case 'look': return [v.fit ? FITS[v.fit] : null, v.background?.mode === 'color' ? 'фон цветом' : v.background ? `размытый фон ${v.background.blur}` : null,
      v.filter && v.filter !== 'none' && v.filter !== 'keep' ? `фильтр «${FILTERS[v.filter]?.label}»` : null,
      v.fx?.type ? `${EFFECTS[v.fx.type]?.label} на всё видео` : null].filter(Boolean).join(' · ') || 'Без изменений';
    case 'overlays': return v.length ? v.map((o) => `«${o.text}»`).join(', ') : 'Нет своих текстов';
    case 'ads': return `${v.set?.mode === 'full' ? 'На весь экран' : 'Поверх видео'} · 1 на ${v.set?.per} с (до ${v.set?.max} на часть)` +
      `${v.set?.chroma?.enabled ? ' · хромакей' : ''}${v.items?.length ? ' · ' + v.items.map((i) => `«${i.name}»`).join(', ') : ''}`;
    case 'rhythm': return `${ENERGY[v.energy]} · кривые ${pct(v.curves || 0)}${v.loud ? ' · громкие куски' : ''}${v.muteVideo ? ' · без звука видео' : ''}`;
    case 'transitions': return v.pool?.length ? `${v.pool.map((t) => TRANSITIONS[t]?.label).join(', ')} · каждый ${v.every}-й стык` : 'Без переходов';
    case 'beatfx': return [v.pulse ? `пульс ${pct(v.pulse)}` : null, v.punch ? `зум-удар ${pct(v.punch)}` : null, v.flash ? `вспышки ${pct(v.flash)}` : null,
      v.cflash ? `цветные вспышки ${pct(v.cflash)}` : null, v.impact ? `удар ${pct(v.impact)}` : null, v.shake ? `тряска ${pct(v.shake)}` : null,
      v.bshake ? `тряска со смазом ${pct(v.bshake)}` : null, v.tear ? `разрывы ${pct(v.tear)}` : null, v.stretch ? `растяг ${pct(v.stretch)}` : null,
      v.rgb ? `RGB ${pct(v.rgb)}` : null].filter(Boolean).join(' · ') || 'Без эффектов';
    default: return '';
  }
}

/** Правка блоков автоэдита прямо в конструкторе. */
function editControls(block, v, set) {
  switch (block) {
    case 'rhythm': return h('div', {},
      field('Темп склеек', seg(ENERGY, v.energy, (x) => set({ ...v, energy: x }, true))),
      range('Кривые скорости', v.curves || 0, { min: 0, max: 1, step: 0.05, fmt: pct, onInput: (x) => set({ ...v, curves: x }) }),
      check('Брать самые громкие куски моментов', v.loud, (x) => set({ ...v, loud: x })),
      check('Выключить звук видео (только музыка)', v.muteVideo, (x) => set({ ...v, muteVideo: x })));
    case 'transitions': return h('div', {},
      h('div', { class: 'tile-grid' }, ...Object.entries(TRANSITIONS).filter(([k]) => k !== 'none').map(([k, t]) =>
        h('div', { class: 'tile' + (v.pool?.includes(k) ? ' on' : ''), onclick: () => set({ ...v, pool: v.pool?.includes(k) ? v.pool.filter((x) => x !== k) : [...(v.pool || []), k] }, true) }, t.label))),
      range('Переход на каждом N-м стыке', v.every || 4, { min: 1, max: 8, onInput: (x) => set({ ...v, every: x }) }),
      range('Шанс перехода на сильной доле', v.strong ?? 0.5, { min: 0, max: 1, step: 0.05, fmt: pct, onInput: (x) => set({ ...v, strong: x }) }),
      range('Длительность', v.dur || 0.4, { min: 0.1, max: 1.2, step: 0.05, fmt: (x) => x.toFixed(2) + ' с', onInput: (x) => set({ ...v, dur: x }) }));
    case 'beatfx': return h('div', {},
      ...[['pulse', 'Пульс на каждый бит'], ['punch', 'Зум-удар на сильных долях'], ['flash', 'Вспышки на сильных долях'], ['cflash', 'Цветные вспышки'],
        ['impact', 'Удар на склейках'], ['shake', 'Тряска на склейках'], ['bshake', 'Тряска со смазом на склейках'],
        ['tear', 'Разрыв полосами на сильных долях'], ['stretch', 'Растяг на сильных долях'], ['rgb', 'RGB-сдвиг на сильных долях']].map(([k, l]) =>
        range(l, v[k] || 0, { min: 0, max: 1, step: 0.05, fmt: (x) => (x ? pct(x) : 'выкл'), onInput: (x) => set({ ...v, [k]: x }) })));
    case 'look': return h('div', {},
      h('div', { class: 'row' },
        field('Кадр', sel(FITS, v.fit || '', (x) => set({ ...v, fit: x || null }))),
        field('Цвет (фильтр)', sel({ keep: 'Не менять', ...Object.fromEntries(Object.entries(FILTERS).map(([k, f]) => [k, f.label])) }, v.filter || 'keep', (x) => set({ ...v, filter: x })))),
      h('div', { class: 'row' },
        field('Эффект на всё видео', sel({ '': 'Нет', vhs: 'VHS', grain: 'Плёнка', vignette: 'Виньетка', bw: 'Ч/Б', sepia: 'Сепия', blur: 'Размытие',
          glow: 'Свечение', leak: 'Засвет', crt: 'CRT-телевизор', bars: 'Кино-полосы', handheld: 'Ручная камера', edges: 'Неоновые контуры' }, v.fx?.type || '',
          (x) => set({ ...v, fx: x ? { type: x, amount: v.fx?.amount ?? 0.5 } : null }, true))),
        v.fx?.type ? field('', range('Сила', v.fx.amount ?? 0.5, { min: 0.1, max: 1, step: 0.05, fmt: pct, onInput: (x) => set({ ...v, fx: { ...v.fx, amount: x } }) })) : null));
    default: return null;
  }
}

/**
 * Окно конструктора. kind — 'cut' или 'edit'; key — свой пресет для правки или готовый, с которого начать копию.
 */
export function presetEditor(kind, key = null, onSaved = () => {}) {
  const all = allProfiles();
  const base = key ? all[key] : null;
  const draft = base ? structuredClone(base) : presetFromProject(S.project, kind);
  draft.kind = kind;
  delete draft.custom;
  draft.label = base?.custom ? base.label : base ? `${base.label} (мой)` : '';
  const editKey = base?.custom ? key : null;
  const src = {}; // откуда взят каждый блок (для подписи в списке)
  const BLOCKS = blocksOf(kind);
  const sameKind = Object.entries(all).filter(([, v]) => v.kind === kind);

  modal((box, close) => {
    box.classList.add('wide');
    const draw = () => {
      const blocks = Object.entries(BLOCKS).map(([b, label]) => {
        const options = { '': src[b] ? `Из «${src[b]}»` : 'Как сейчас в пресете', project: 'Как сейчас в проекте', none: 'Не трогать',
          ...Object.fromEntries(sameKind.filter(([, v]) => v[b] != null).map(([k, v]) => [k, `Как в «${v.label}»`])) };
        if (kind === 'edit' && ['rhythm', 'transitions', 'beatfx'].includes(b)) delete options.project;
        const pick = sel(options, '', (v) => {
          if (v === 'project') { draft[b] = blockFromProject(S.project, b); src[b] = 'проекта'; }
          else if (v === 'none') { delete draft[b]; src[b] = null; }
          else if (v) { draft[b] = structuredClone(all[v][b]); src[b] = all[v].label; }
          draw();
        });
        const sumEl = h('div', { class: 'note', style: { margin: '4px 0 0' } }, summary(b, draft[b]));
        const set = (nv, redraw) => { draft[b] = nv; if (redraw) draw(); else sumEl.textContent = summary(b, nv); };
        return h('div', { class: 'group preset-block' },
          h('div', { class: 'row', style: { alignItems: 'center' } }, h('b', { style: { flex: 1 } }, label), h('div', { style: { flex: 1.3 } }, pick)),
          sumEl,
          draft[b] && kind === 'edit' ? editControls(b, draft[b], set) : null,
          b === 'overlays' ? overlayList(() => draft.overlays || [], (fn) => { draft.overlays ||= []; fn(draft.overlays); }, draw) : null);
      });
      fill(box, 
        h('h2', {}, kind === 'edit' ? 'Свой пресет автоэдита' : 'Свой пресет нарезки'),
        field('Название', textInput(draft.label, (v) => { draft.label = v; }, { placeholder: kind === 'edit' ? 'Например: Мой фонк' : 'Например: Майнкрафт-истории' })),
        h('div', { class: 'note' }, 'Каждый блок можно взять из любого готового пресета или из того, как сейчас настроен проект. ' +
          (kind === 'cut' ? 'Свой стиль субтитров/заголовков/обложки: настрой его в проекте и выбери «Как сейчас в проекте».' : 'Ритм, переходы и эффекты настраиваются прямо здесь.')),
        ...blocks,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: close }, 'Отмена'),
          h('button', { class: 'btn primary', onclick: () => {
            if (!draft.label.trim()) return toast('Назови пресет');
            draft.desc = Object.keys(BLOCKS).filter((b) => draft[b] != null).map((b) => BLOCKS[b].toLowerCase()).join(', ');
            const k = saveCustomPreset(draft, editKey);
            if (kind === 'cut') { applyProfile(k); setDefaultProfile(k); }
            else applyProfile(k);
            close();
            toast(`Пресет «${draft.label}» сохранён и выбран`, 'ok');
            onSaved(k);
          } }, 'Сохранить')));
    };
    draw();
  });
}
