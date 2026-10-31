// Свойства выделенного: клип (фильтр, цвет, переход), текст/субтитры/заголовки, эффект, трек, граница части.
import { S, on, emit, commit, clipsTL, parts, headerText, duration, fmtTime, subs, uid, selItems, CHROMA_DEFAULTS } from './store.js';
import { h, field, range, color, select as sel, seg, check, textInput, numberInput, fontPicker, pct, toast } from './ui.js';
import { ANIMS_IN, ANIMS_OUT, ANIMS_LOOP, TYPING_CPS, typingTimes, displayText } from './engine/text.js';
import { renderTyping } from './sfx.js';
import { loadMedia } from './mediastate.js';
import { overlayItem } from './overlays.js';
import { MOTIONS } from './engine/frame.js';
import { fxThumb } from './fxpreview.js';
import { FILTERS, TRANSITIONS, EFFECTS, defaultParams } from './engine/effects.js';
import { splitAtPlayhead, deleteSelection, duplicateSelection, setTransition, setTransitionAll, setClipSpeed, freezeFrame, setFreezeDur } from './edit.js';
import { detachAudio } from './detach.js';
import { CURVES, hasCurve, clipDur, curveAt } from './engine/speed.js';
import { seek, play, stopPlayback } from './preview.js';
import { detectBeats } from './auto.js';
import { hydrateIcons } from './icons.js';
import { adsSection, chromaEditor } from './adsui.js';
import { AFX_FILTERS, hasAfx } from './engine/afx.js';
import { speedControl } from './speedui.js';
import { openEnhance, enhanceStatus } from './enhanceui.js';
import { AUDIO_PRESETS, REMIX_STYLES, audioLen, hasAudioProc } from './engine/audioproc.js';

const root = document.getElementById('inspector');

export function styleEditor(getStyle, key) {
  const st = getStyle(S.project);
  const set = (k, v, merge = true) => commit((p) => { getStyle(p)[k] = v; }, merge ? `${key}-${k}` : null);
  return h('div', {},
    field('Шрифт', fontPicker(st.font, (v) => { set('font', v, false); render(); })),
    range('Размер', st.size, { min: 16, max: 240, onInput: (v) => set('size', v) }),
    h('div', { class: 'row' },
      field('Цвет', h('div', { class: 'row' }, color(st.color, (v) => set('color', v)))),
      field('', check('ЗАГЛАВНЫЕ', st.upper, (v) => set('upper', v, false)))),
    range('Перенос строки, символов (0 — без переноса)', st.wrap, { min: 0, max: 40, onInput: (v) => set('wrap', v) }),
    range('Между строками', st.lineGap || 0, { min: -0.2, max: 0.8, step: 0.02, fmt: (v) => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%', onInput: (v) => set('lineGap', v) }),
    h('div', { class: 'row' },
      field('', range('Между словами', st.wordGap || 0, { min: 0, max: 60, onInput: (v) => set('wordGap', v) })),
      field('', range('Между буквами', st.letterGap || 0, { min: -4, max: 20, step: 0.5, onInput: (v) => set('letterGap', v) }))),
    h('div', { class: 'group' },
      check('Плашка под текстом', st.box, (v) => { set('box', v, false); render(); }),
      st.box
        ? h('div', {},
          h('div', { class: 'row' }, field('Цвет плашки', color(st.boxColor, (v) => set('boxColor', v))),
            field('', range('Непрозрачность', st.boxAlpha, { min: 0, max: 1, step: 0.05, fmt: pct, onInput: (v) => set('boxAlpha', v) }))),
          range('Отступ', st.boxPad, { min: 0, max: 60, onInput: (v) => set('boxPad', v) }))
        : h('div', { class: 'row' },
          field('Обводка', color(st.strokeColor, (v) => set('strokeColor', v))),
          field('', range('Толщина', st.strokeWidth, { min: 0, max: 24, onInput: (v) => set('strokeWidth', v) })))),
    h('div', { class: 'group' },
      h('div', { class: 'row' },
        field('Тень', color(st.shadowColor, (v) => set('shadowColor', v))),
        field('', range('Сила', st.shadowAlpha, { min: 0, max: 1, step: 0.05, fmt: pct, onInput: (v) => set('shadowAlpha', v) }))),
      range('Смещение тени', st.shadowDist, { min: 0, max: 30, onInput: (v) => set('shadowDist', v) })));
}

/** Готовые сочетания появления, исчезания и цикла — одной кнопкой. */
const ANIM_COMBOS = {
  'Неон': { in: 'flicker', out: 'flicker', loop: 'neon', dur: 600, outDur: 400 },
  'Печать': { in: 'typing', out: 'typing', loop: 'none' },
  'Удар': { in: 'shakein', out: 'shrink', loop: 'jitter', dur: 400, outDur: 200 },
  'Мягко': { in: 'fade', out: 'fade', loop: 'float', dur: 400, outDur: 400 },
  'Эффектно': { in: 'spinin', out: 'spinout', loop: 'pulse', dur: 500, outDur: 400 },
  'Сердечко': { in: 'grow', out: 'fade', loop: 'heartbeat', dur: 350, outDur: 300 },
  'Глитч': { in: 'glitch', out: 'flicker', loop: 'jitter', dur: 400, outDur: 300 },
  'Маятник': { in: 'swingin', out: 'flip', loop: 'swing', dur: 700, outDur: 300 },
};

/** Показать анимацию: проиграть начало (или конец) текста. */
function previewAnim(range0) {
  const [a, b] = range0;
  seek(a);
  play();
  clearTimeout(previewAnim.timer);
  previewAnim.timer = setTimeout(() => { stopPlayback(); seek(Math.min(b, a + 0.01)); }, (b - a) * 1000);
}

function animEditor(getAnim, key, itemRange, typingItem = null) {
  const a = getAnim(S.project);
  const set = (k, v, merge) => commit((p) => { getAnim(p)[k] = v; }, merge ? `${key}-${k}` : null);
  const typing = a.in === 'typing' || a.out === 'typing';
  const cps = a.cps || TYPING_CPS;
  const inLen = () => (a.in === 'typing' ? 3.5 : (a.dur || 200) / 1000 + 0.8);
  const outLen = () => (a.out === 'typing' ? 2.5 : (a.outDur || a.dur || 200) / 1000 + 0.8);
  const showIn = () => { const r = itemRange(); if (r) previewAnim([Math.max(0, r[0] - 0.05), Math.min(r[1], r[0] + inLen())]); };
  const showOut = () => { const r = itemRange(); if (r) previewAnim([Math.max(r[0], r[1] - outLen()), r[1] + 0.05]); };
  const pick = (k, list, show) => sel(list, a[k] || 'none', (v) => { set(k, v); render(); if (v !== 'none') setTimeout(show, 30); });
  const durRange = (label, k, val) => range(label, val, { min: 50, max: 3000, step: 10, fmt: (v) => `${(v / 1000).toFixed(2)} с`, onInput: (v) => set(k, v, true) });
  const combo = (c) => { commit((p) => Object.assign(getAnim(p), c)); render(); setTimeout(showIn, 30); };
  return h('div', { class: 'group' },
    h('h4', { style: { marginTop: 0 } }, 'Анимация'),
    h('div', { class: 'chips' }, ...Object.entries(ANIM_COMBOS).map(([name, c]) => h('button', { class: 'chip-btn', onclick: () => combo(c) }, name))),
    field('Появление', pick('in', ANIMS_IN, showIn)),
    a.in && !['none', 'typing'].includes(a.in) ? durRange('Длительность появления', 'dur', a.dur || 200) : null,
    field('Исчезание', pick('out', ANIMS_OUT, showOut)),
    a.out && !['none', 'typing'].includes(a.out) ? durRange('Длительность исчезания', 'outDur', a.outDur || a.dur || 200) : null,
    typing ? range('Скорость печати', cps, { min: 4, max: 40, step: 1, fmt: (v) => `${v} букв/с`, onInput: (v) => set('cps', v, true) }) : null,
    typing ? check('Мигающий курсор', a.caret !== false, (v) => set('caret', v)) : null,
    typing && a.in === 'typing' && typingItem ? h('div', { class: 'btn-row', style: { marginTop: 0 } },
      h('button', { class: 'btn', onclick: () => addTypingSound(typingItem()).catch((e) => toast(e.message, 'err')) }, 'Добавить звук печати')) : null,
    field('Цикл (пока текст на экране)', pick('loop', ANIMS_LOOP, showIn)),
    a.loop && a.loop !== 'none' ? range('Скорость цикла', a.loopSpeed || 1, { min: 0.2, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) + '×', onInput: (v) => set('loopSpeed', v, true) }) : null,
    h('div', { class: 'row' },
      field('', check('Подсветка слова (караоке)', a.karaoke, (v) => { set('karaoke', v); render(); })),
      a.karaoke ? field('', h('div', { class: 'row' }, color(a.hlColor || '#FFE14D', (v) => set('hlColor', v, true)))) : null),
    a.karaoke || a.in === 'words' ? h('div', { class: 'note' }, 'У субтитров слова подсвечиваются и появляются ровно в такт речи (по распознаванию).') : null,
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: showIn }, '▶ Показать')));
}

function posEditor(getObj, key) {
  const o = getObj(S.project);
  const set = (k, v) => commit((p) => { getObj(p)[k] = v; }, `${key}-${k}`);
  return h('div', { class: 'group' },
    h('div', { class: 'row' },
      field('X', numberInput(Math.round(o.x), (v) => set('x', v))),
      field('Y', numberInput(Math.round(o.y), (v) => set('y', v))),
      field('', h('button', { class: 'btn', onclick: () => set('x', S.project.canvas.w / 2) }, 'По центру'))),
    h('div', { class: 'note' }, S.mobile ? 'Двигай пальцем прямо в кадре, размер — двумя пальцами.' : 'Текст можно двигать мышкой прямо в кадре.'));
}

function timing(listKey, item) {
  const set = (k, v) => commit((p) => {
    const it = p[listKey].find((x) => x.id === item.id);
    if (k === 'start') it.start = Math.max(0, Math.min(v, it.end - 0.05));
    else it.end = Math.max(it.start + 0.05, v);
  });
  return h('div', { class: 'row' },
    field('Начало, с', numberInput(item.start.toFixed(2), (v) => set('start', v), { step: 0.1 })),
    field('Конец, с', numberInput(item.end.toFixed(2), (v) => set('end', v), { step: 0.1 })));
}

function textArea(item, key) {
  const ta = h('textarea', { id: 'insp-text', spellcheck: false }, item.text);
  ta.addEventListener('input', () => commit((p) => { p.texts.find((x) => x.id === item.id).text = ta.value; }, key));
  return ta;
}

const actions = (...btns) => h('div', { class: 'btn-row' }, ...btns);

/** Всем фото — чередование наезда/отъезда/панорам (как в слайдшоу). */
function applyMotionAll() {
  const order = ['zoomin', 'panleft', 'zoomout', 'panright'];
  let k = 0;
  commit((p) => {
    for (const c of p.clips) if (p.media.find((m) => m.id === c.media)?.kind === 'image') c.motion = order[k++ % order.length];
  });
  toast('Движение расставлено на все фото', 'ok');
}

/** Щелчки клавиш ровно под буквы анимации «печатается» → на дорожку звуков с начала текста. */
async function addTypingSound(item) {
  if (!item) return;
  const { times } = typingTimes(displayText(item), item.anim?.cps || TYPING_CPS);
  if (!times.length) throw new Error('В тексте нет букв');
  const m = await S.backend.uploadMedia(S.project.id, await renderTyping(times));
  const id = uid();
  commit((p) => {
    p.media.push(m);
    p.audio.push({ id, media: m.id, kind: 'sfx', start: item.start, in: 0, out: m.duration || times[times.length - 1] + 0.15, volume: 0.8, fadeIn: 0, fadeOut: 0 });
  });
  loadMedia(m.id);
  toast('Звук печати добавлен — если поменяешь текст или скорость, добавь заново', 'ok');
}

/** «Отделить звук» с процентами на кнопке. */
const detachBtn = (ids) => h('button', { class: 'btn', onclick: async (ev) => {
  const b = ev.currentTarget;
  b.disabled = true;
  b.textContent = 'Отделяю…';
  try {
    const r = await detachAudio(ids, (f) => { b.textContent = `Отделяю… ${Math.round(f * 100)}%`; });
    toast(r.skipped ? `Звук отделён (${r.count}); клипы с кривой скорости пропущены` : 'Звук на отдельной дорожке, у видео выключен', 'ok');
  } catch (e) { toast(e.message, 'err'); render(); }
} }, 'Отделить звук');
const delBtn = () => h('button', { class: 'btn danger', onclick: deleteSelection }, 'Удалить');

// ---------------------------------------------------------------------------

function renderProject() {
  const p = S.project;
  const ps = parts();
  const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l));
  const go = (tab, label, icon) => h('button', { class: 'btn', onclick: () => import('./panels.js').then((m) => { m.setTab(tab); emit('open-panel'); }) },
    h('span', { 'data-icon': icon }), label);
  const tip = TIPS[Math.floor(Date.now() / 60000) % TIPS.length];
  return h('div', {},
    h('h3', {}, 'Проект'),
    h('div', { class: 'stats' },
      stat(fmtTime(duration(), false), 'длительность'), stat(ps.length > 1 ? ps.length : '—', 'частей'),
      stat(subs().length, 'субтитров'), stat(p.effects.length, 'эффектов'),
      stat(p.clips.length, 'клипов'), stat(`${p.canvas.w}×${p.canvas.h}`, 'кадр')),
    field('Название серии (для заголовков, обложек и файлов)', textInput(p.title, (v) => commit((q) => { q.title = v; }, 'title'), { placeholder: p.name })),
    field('Частота кадров', seg({ 30: '30 fps', 60: '60 fps' }, p.canvas.fps, (v) => { commit((q) => { q.canvas.fps = +v; }); render(); })),
    h('h4', {}, 'Быстрые действия'),
    h('div', { class: 'btn-row', style: { marginTop: 0 } },
      go('auto', 'Авто: нарезка и эдит', 'wand'), go('subs', 'Субтитры', 'subs'), go('effects', 'Эффекты', 'sparkles'), go('transitions', 'Переходы', 'transition')),
    h('div', { class: 'tip' }, h('b', {}, 'Совет: '), tip),
    h('div', { class: 'note' }, 'Выдели клип, текст, эффект или трек на таймлайне — здесь появятся его настройки.'));
}

const TIPS = [
  'Ctrl+B режет под курсором, Q / W обрезают клип до курсора слева и справа.',
  'Перетащи видео прямо в окно — оно встанет на таймлайн.',
  '«Авто» → «Умные инструменты» → «Убрать паузы»: джамп-каты в речи одной кнопкой.',
  'Вкладка «Переходы» → «Случайные на все стыки» — быстрый эдит без ручной работы.',
  'Наведи на плитку эффекта или перехода — покажет, как он выглядит.',
  'Свой пресет: ✎ на любом готовом во вкладке «Авто» — собери из блоков разных пресетов.',
  'Наборы эффектов (Бит-дроп, Флешбэк, Ретро-ТВ…) — несколько эффектов одним кликом.',
  'У текста есть комбо анимаций: Неон, Печать, Удар, Сердечко — одной кнопкой.',
  'Приглушение музыки под голос — вкладка «Аудио», галочка вверху.',
  'Обложки картинками (.jpg) для TikTok — галочка в окне экспорта.',
  'Тема оформления — значок палитры вверху справа.',
  'Если на телефоне превью чёрное — Настройки → «Совместимое превью».',
];

function filterTiles(clip) {
  const box = h('div', { class: 'tile-grid' });
  for (const [id, f] of Object.entries(FILTERS)) {
    const c = h('canvas', { width: 90, height: 120 });
    box.append(h('div', { class: 'tile' + ((clip.filter || 'none') === id ? ' on' : ''), onclick: () => {
      commit((p) => { p.clips.find((x) => x.id === clip.id).filter = id; });
      render();
    } }, c, f.label));
    requestAnimationFrame(() => drawFilterThumb(c, clip, id));
  }
  return box;
}

/** Миниатюра фильтра: текущий кадр клипа с этим фильтром (через тот же движок, маленький холст). */
let thumbComp = null;
async function drawFilterThumb(canvas, clip, filterId) {
  const { createCompositor } = await import('./engine/compositor2d.js');
  const v = [...document.querySelectorAll('#videos video')].find((x) => x.dataset.mid === clip.media && x.readyState >= 2);
  if (!v) return;
  thumbComp ||= createCompositor(document.createElement('canvas'), S.project.canvas.w, S.project.canvas.h);
  thumbComp.resize(90, 160);
  thumbComp.render({ layers: [{ clip: { ...clip, filter: filterId }, src: v, w: v.videoWidth, h: v.videoHeight }], trans: null,
    bg: S.project.background, fx: null, texts: [], t: 0 });
  canvas.getContext('2d').drawImage(thumbComp.canvas, 0, 20, 90, 120, 0, 0, 90, 120);
}

function transitionEditor(clip, index) {
  if (index === 0) return h('div', { class: 'note' }, 'Это первый клип — переход ставится на стык со следующим клипом (ромбик на таймлайне).');
  const tr = clip.transition || { type: 'none', dur: 0.5 };
  const grid = h('div', { class: 'tile-grid' });
  for (const [id, t] of Object.entries(TRANSITIONS)) {
    grid.append(h('div', { class: 'tile fx' + (tr.type === id ? ' on' : ''), onclick: () => { setTransition(clip.id, id); render(); } },
      fxThumb({ trans: id }), t.label));
  }
  return h('div', { id: 'insp-trans' },
    grid,
    tr.type !== 'none' ? range('Длительность перехода', tr.dur, { min: 0.1, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + ' с',
      onInput: (v) => commit((p) => { p.clips.find((x) => x.id === clip.id).transition.dur = v; }, 'tr-dur-' + clip.id) }) : null,
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => { setTransitionAll(tr.type, tr.dur); toast('Переход поставлен на все стыки', 'ok'); } }, 'На все стыки')));
}

let speedTab = 'normal';

/** Скорость: обычная (кнопки + ползунок 0,1×–10×) или кривая (плитки с графиком). */
function speedEditor(c) {
  const cur = c.speed || 1;
  const tabs = seg({ normal: 'Обычная', curve: 'Кривая' }, hasCurve(c) ? 'curve' : speedTab, (v) => {
    speedTab = v;
    if (v === 'normal' && hasCurve(c)) setClipSpeed(c.id, null, 'none');
    render();
  });
  if ((hasCurve(c) ? 'curve' : speedTab) === 'curve') {
    const grid = h('div', { class: 'tile-grid' });
    for (const [key, cv] of Object.entries(CURVES)) {
      const g = h('canvas', { width: 90, height: 50 });
      grid.append(h('div', { class: 'tile' + ((c.curve || 'none') === key ? ' on' : ''), onclick: () => { setClipSpeed(c.id, 1, key); render(); } }, g, cv.label));
      requestAnimationFrame(() => {
        const x = g.getContext('2d');
        x.strokeStyle = (c.curve || 'none') === key ? '#c9bfff' : '#8e8ba3';
        x.lineWidth = 2;
        x.beginPath();
        for (let i = 0; i <= 40; i++) {
          const py = 45 - ((Math.log2(curveAt(key, i / 40)) + 2.5) / 5.2) * 40; // log-шкала 0,18×…6×
          if (i === 0) x.moveTo(5 + i * 2, py); else x.lineTo(5 + i * 2, py);
        }
        x.stroke();
      });
    }
    return h('div', {}, field('', tabs), grid,
      h('div', { class: 'note' }, `Длительность на таймлайне: ${fmtTime(clipDur(c))}. Звук клипа при кривой выключается — сверху обычно музыка.`));
  }
  return h('div', {}, field('', tabs),
    speedControl({ speed: cur, srcLen: c.out - c.in, onChange: (s, live) => setClipSpeed(c.id, s, 'none', live ? 'speed-' + c.id : null) }),
    h('div', { class: 'note' }, 'Тон голоса сохраняется.'));
}

/** Версия песни (Sped up, Slowed, ремиксы…) на дорожку. Ремиксу нужны биты — найдём, если их ещё нет. */
export async function applyAudioPreset(id, pr) {
  const a = S.project.audio.find((x) => x.id === id);
  if (!a) return;
  if (pr.set.remix && !S.project.beats?.[a.media]?.beats?.length) {
    toast('Ищу биты песни для ремикса…');
    try { await detectBeats(a.media); } catch (e) { return toast('Не нашёл биты: ' + e.message, 'err'); }
  }
  commit((p) => Object.assign(p.audio.find((x) => x.id === id), pr.set));
  if (pr.set.remix) toast(`${pr.label || REMIX_STYLES[pr.set.remix]}: бит соберётся при воспроизведении (пару секунд)`, 'ok');
  render();
}

/** Эффекты звука: бас, высокие, фильтр. get(p) → клип или дорожка. */
function afxEditor(get, key) {
  const a = get(S.project)?.afx || {};
  const set = (k, v, merge = true) => commit((p) => { const o = get(p); o.afx = { ...(o.afx || {}), [k]: v }; }, merge ? `${key}-afx-${k}` : null);
  return h('div', { class: 'group', id: 'insp-afx' },
    h('b', {}, 'Эффекты звука'),
    range('Бас', a.bass || 0, { min: -12, max: 15, step: 1, fmt: (v) => (v > 0 ? '+' : '') + v + ' дБ', onInput: (v) => set('bass', v) }),
    range('Высокие', a.treble || 0, { min: -12, max: 12, step: 1, fmt: (v) => (v > 0 ? '+' : '') + v + ' дБ', onInput: (v) => set('treble', v) }),
    field('Звучание', sel(AFX_FILTERS, a.filter || 'none', (v) => set('filter', v, false))),
    hasAfx(a) ? h('div', { class: 'btn-row', style: { marginTop: 0 } }, h('button', { class: 'btn', onclick: () => { commit((p) => { delete get(p).afx; }); render(); } }, 'Сбросить звук')) : null);
}

/** Растяг (как в эдитах): клип тянется по ширине/высоте без сохранения пропорций. */
function stretchEditor(c, m, id) {
  const { w: W, h: H } = S.project.canvas;
  const setS = (sx, sy, extra = {}) => commit((p) => { Object.assign(p.clips.find((x) => x.id === id), { sx: +sx.toFixed(3), sy: +sy.toFixed(3) }, extra); });
  const full = m?.width ? (H * m.width) / (W * m.height) : 1; // во сколько раз вытянуть по высоте, чтобы кадр заполнился без обрезки
  return h('div', {},
    h('div', { class: 'btn-row', style: { marginTop: 0 } },
      h('button', { class: 'btn', title: 'Видео растягивается на весь кадр без обрезки (как «растяг экрана» в TikTok)', onclick: () => { setS(1, full, { scale: 1, x: 0, y: 0 }); render(); } }, 'На весь экран'),
      h('button', { class: 'btn', title: 'Как растянутое 4:3 в CS', onclick: () => { setS(4 / 3, 1); render(); } }, '4:3 растянутый'),
      h('button', { class: 'btn', onclick: () => { setS(1.5, 1); render(); } }, 'Широкий'),
      (c.sx || 1) !== 1 || (c.sy || 1) !== 1 ? h('button', { class: 'btn', onclick: () => { setS(1, 1); render(); } }, 'Без растяга') : null),
    range('По ширине', c.sx || 1, { min: 0.5, max: 2.5, step: 0.01, fmt: pct, onInput: (v) => commit((p) => { p.clips.find((x) => x.id === id).sx = v; }, `clip-${id}-sx`) }),
    range('По высоте', c.sy || 1, { min: 0.5, max: 4, step: 0.01, fmt: pct, onInput: (v) => commit((p) => { p.clips.find((x) => x.id === id).sy = v; }, `clip-${id}-sy`) }),
    h('div', { class: 'btn-row', style: { marginTop: 0 } }, h('button', { class: 'btn', onclick: () => {
      commit((p) => { for (const x of p.clips) if (x.media === c.media) { x.sx = c.sx || 1; x.sy = c.sy || 1; } });
      toast('Растяг на всех кусках этого видео', 'ok');
    } }, 'На все куски этого видео')),
    h('div', { class: 'note' }, 'Растяг на бит — во вкладке «Эффекты» → «Растяг».'));
}

function renderClip(id, focusTransition = false) {
  const list = clipsTL();
  const index = list.findIndex((x) => x.id === id);
  const c = S.project.clips.find((x) => x.id === id);
  if (!c) return renderProject();
  const tl = list[index];
  const m = S.project.media.find((x) => x.id === c.media);
  const set = (k, v, merge = true) => commit((p) => { p.clips.find((x) => x.id === id)[k] = v; }, merge ? `clip-${id}-${k}` : null);
  const setA = (k, v) => commit((p) => { p.clips.find((x) => x.id === id).adjust[k] = v; }, `clip-${id}-adj-${k}`);
  const fill = m ? (S.project.canvas.h * m.width) / (S.project.canvas.w * m.height) : 1;
  const sections = {
    trans: h('div', {}, h('h4', {}, 'Переход в этот клип'), transitionEditor(c, index)),
    filter: h('div', {}, h('h4', {}, 'Фильтр'), filterTiles(c)),
    adjust: h('div', {}, h('h4', {}, 'Коррекция'),
      range('Яркость', c.adjust.bright, { min: -1, max: 1, step: 0.02, fmt: (v) => Math.round(v * 100), onInput: (v) => setA('bright', v) }),
      range('Контраст', c.adjust.contrast, { min: -1, max: 1, step: 0.02, fmt: (v) => Math.round(v * 100), onInput: (v) => setA('contrast', v) }),
      range('Насыщенность', c.adjust.sat, { min: -1, max: 1, step: 0.02, fmt: (v) => Math.round(v * 100), onInput: (v) => setA('sat', v) }),
      range('Температура', c.adjust.temp, { min: -1, max: 1, step: 0.02, fmt: (v) => Math.round(v * 100), onInput: (v) => setA('temp', v) })),
  };
  const still = m?.kind === 'image' || !!c.freeze; // фото и стоп-кадр: ни скорости, ни звука
  const el = h('div', {},
    h('h3', {}, c.freeze ? 'Стоп-кадр' : m?.kind === 'image' ? 'Фото' : 'Видео'),
    h('div', { class: 'note' }, `${m?.name || ''} · ${fmtTime(tl.start)} – ${fmtTime(tl.end)}${c.freeze ? ` · кадр ${fmtTime(c.in)}` : ''}`),
    c.freeze ? range('Длина стоп-кадра', c.freeze, { min: 0.2, max: 15, step: 0.1, fmt: (v) => v.toFixed(1) + ' с',
      onInput: (v) => commit((p) => setFreezeDur(p, id, v), `freeze-${id}`) }) : null,
    c.freeze ? h('div', { class: 'note' }, 'Видео стоит на этом кадре, звук видео молчит. Длину можно тянуть и за край на таймлайне. «Движение кадра» — наезд на застывший кадр.') : null,
    h('div', { class: 'btn-row', style: { marginTop: 0 } },
      !still ? h('button', { class: 'btn', title: 'Видео застынет на кадре под курсором', onclick: () => freezeFrame(S.t, 2) }, '⏸ Стоп-кадр здесь') : null,
      m && !c.freeze ? h('button', { class: 'btn enh-btn', title: 'Нейросеть Real-ESRGAN на видеокарте компа: чётче, чище, больше разрешение',
        onclick: () => openEnhance(id) }, enhanceStatus(m.id) ? `✨ Улучшаю… ${Math.round((enhanceStatus(m.id).progress || 0) * 100)}%`
        : m.enhanced ? '✨ Улучшено' : '✨ Улучшить качество') : null),
    range('Масштаб', c.scale ?? 1, { min: 0.2, max: 4, step: 0.01, fmt: pct, onInput: (v) => set('scale', v) }),
    actions(
      h('button', { class: 'btn', onclick: () => { set('scale', 1, false); set('x', 0, false); set('y', 0, false); render(); } }, 'По ширине'),
      h('button', { class: 'btn', onclick: () => { set('scale', +fill.toFixed(3), false); set('x', 0, false); set('y', 0, false); render(); } }, 'На весь экран')),
    field(m?.kind === 'image' ? 'Движение фото' : 'Движение кадра', sel(MOTIONS, c.motion || 'none', (v) => { set('motion', v, false); render(); })),
    m?.kind === 'image' ? h('div', { class: 'btn-row', style: { marginTop: 0 } },
      h('button', { class: 'btn', onclick: () => { applyMotionAll(); render(); } }, 'Движение на все фото')) : null,
    h('h4', { id: 'insp-stretch' }, 'Растяг'),
    stretchEditor(c, m, id),
    still ? null : h('h4', { id: 'insp-speed' }, 'Скорость'),
    still ? null : speedEditor(c),
    still ? null : h('h4', {}, 'Звук'),
    still ? null : range('Громкость', c.volume ?? 1, { min: 0, max: 2, step: 0.05, fmt: pct, onInput: (v) => set('volume', v) }),
    still ? null : afxEditor((p) => p.clips.find((x) => x.id === id), `clip-${id}`),
    still ? null : h('div', { class: 'btn-row', style: { marginTop: 0 } }, detachBtn([id])),
    h('h4', {}, 'Положение'),
    range('Поворот', c.rot || 0, { min: -180, max: 180, step: 1, fmt: (v) => v + '°', onInput: (v) => set('rot', v) }),
    focusTransition ? sections.trans : null,
    sections.filter, sections.adjust,
    h('h4', {}, 'Хромакей'),
    chromaEditor(() => c.chroma, (fn) => commit((p) => { const x = p.clips.find((y) => y.id === id); x.chroma = { ...CHROMA_DEFAULTS, ...x.chroma }; fn(x.chroma); }, `clip-${id}-chroma`),
      c.media, render),
    c.chroma?.enabled ? h('div', { class: 'btn-row', style: { marginTop: 0 } }, h('button', { class: 'btn', onclick: () => {
      commit((p) => { for (const x of p.clips) if (x.media === c.media) x.chroma = { ...c.chroma }; });
      toast('Хромакей на всех кусках этого видео', 'ok');
    } }, 'На все куски этого видео')) : null,
    focusTransition ? null : sections.trans,
    actions(h('button', { class: 'btn', onclick: splitAtPlayhead }, 'Разрезать'), delBtn()));
  return el;
}

function renderText(ids) {
  const items = S.project.texts.filter((x) => ids.includes(x.id));
  if (!items.length) return renderProject();
  const item = items[0];
  if (item.track === 'subs') {
    return h('div', {},
      h('h3', {}, items.length > 1 ? `Субтитры (${items.length})` : 'Субтитр'),
      items.length === 1 ? field('Текст', textArea(item, 'sub-' + item.id)) : null,
      items.length === 1 ? timing('texts', item) : null,
      actions(delBtn()),
      h('h4', {}, 'Стиль всех субтитров'),
      styleEditor((p) => p.subs.style, 'subs'),
      animEditor((p) => p.subs.anim, 'subs-anim', () => { const x = S.project.texts.find((y) => y.id === item.id); return x && [x.start, x.end]; }),
      posEditor((p) => p.subs, 'subs-pos'));
  }
  const get = (p) => p.texts.find((x) => x.id === item.id);
  if (item.style.chat) {
    const setS = (k, v) => commit((p) => { get(p).style[k] = v; }, `chat-${item.id}-${k}`);
    return h('div', {},
      h('h3', {}, 'Переписка'),
      field('Сообщения', textArea(item, 'text-' + item.id)),
      h('div', { class: 'note' }, 'Каждая строка — сообщение. Строка с «>» в начале — твоё (синее, справа). Появляются по очереди за первую половину показа.'),
      timing('texts', item),
      range('Размер', item.style.size, { min: 24, max: 80, onInput: (v) => setS('size', v) }),
      field('Время у сообщений', textInput(item.style.chatTime || '11:18', (v) => setS('chatTime', v))),
      check('Чёрный фон на весь кадр', item.style.chatBg, (v) => setS('chatBg', v)),
      check('Строка «Сообщение» снизу', item.style.chatBar !== false, (v) => setS('chatBar', v)),
      animEditor((p) => get(p).anim, 'text-anim-' + item.id, () => { const x = get(S.project); return x && [x.start, x.end]; }, () => get(S.project)),
      posEditor(get, 'text-pos-' + item.id),
      actions(h('button', { class: 'btn', onclick: duplicateSelection }, 'Дублировать'), delBtn()));
  }
  return h('div', {},
    h('h3', {}, 'Текст'),
    field('Текст', textArea(item, 'text-' + item.id)),
    timing('texts', item),
    styleEditor((p) => get(p).style, 'text-' + item.id),
    animEditor((p) => get(p).anim, 'text-anim-' + item.id, () => { const x = get(S.project); return x && [x.start, x.end]; }, () => get(S.project)),
    posEditor(get, 'text-pos-' + item.id),
    actions(h('button', { class: 'btn', onclick: duplicateSelection }, 'Дублировать'), delBtn()));
}

function renderHeader(id) {
  const part = parts().find((x) => 'h' + x.i === id);
  if (!part) return renderProject();
  const custom = S.project.headers.custom[part.i] ?? '';
  const ta = h('textarea', { id: 'insp-text', placeholder: headerText({ ...part, i: -1 }), spellcheck: false }, custom);
  ta.addEventListener('input', () => commit((p) => { p.headers.custom[part.i] = ta.value; }, 'header-' + part.i));
  return h('div', {},
    h('h3', {}, `Заголовок · ${part.label || 'видео'}`),
    field('Свой текст для этой части (пусто — по шаблону)', ta),
    field('Шаблон для всех частей ({title} — название, {label} — часть)',
      textInput(S.project.headers.template, (v) => commit((p) => { p.headers.template = v; }, 'header-template'))),
    h('h4', {}, 'Стиль всех заголовков'),
    styleEditor((p) => p.headers.style, 'headers'),
    animEditor((p) => p.headers.anim, 'headers-anim', () => [part.start, part.end]),
    posEditor((p) => p.headers, 'headers-pos'));
}

function renderEffect(ids) {
  const e = S.project.effects.find((x) => x.id === ids[0]);
  if (!e) return renderProject();
  const def = EFFECTS[e.type];
  const params = { ...defaultParams(e.type), ...e.p };
  const typeSel = sel(Object.fromEntries(Object.entries(EFFECTS).map(([k, v]) => [k, v.label])), e.type, (v) => {
    commit((p) => { const x = p.effects.find((y) => y.id === e.id); x.type = v; x.p = { ...defaultParams(v), amount: x.p?.amount ?? 0.6 }; });
    render();
  });
  return h('div', {},
    h('h3', {}, ids.length > 1 ? `Эффекты (${ids.length})` : 'Эффект'),
    field('Тип', typeSel),
    ...(def?.params || []).map((pr) => range(pr.label, params[pr.key], { min: pr.min, max: pr.max, step: pr.step,
      fmt: pr.key === 'amount' ? pct : pr.key === 'hue' ? (v) => `${Math.round(v * 360)}°` : (v) => v.toFixed(1) + '×',
      onInput: (v) => commit((p) => { for (const x of p.effects.filter((y) => ids.includes(y.id))) x.p = { ...x.p, [pr.key]: v }; }, `fx-${e.id}-${pr.key}`) })),
    ids.length === 1 ? timing('effects', e) : null,
    e.beat ? h('div', { class: 'note' }, 'Поставлен на бит (вкладка «Аудио» → автобиты).') : null,
    actions(h('button', { class: 'btn', onclick: duplicateSelection }, 'Дублировать'), h('button', { class: 'btn', onclick: splitAtPlayhead }, 'Разрезать'), delBtn()));
}

function renderAudio(id) {
  const a = S.project.audio.find((x) => x.id === id);
  if (!a) return renderProject();
  const m = S.project.media.find((x) => x.id === a.media);
  const bt = S.project.beats?.[a.media];
  const set = (k, v, merge = true) => commit((p) => { p.audio.find((x) => x.id === id)[k] = v; }, merge ? `aud-${id}-${k}` : null);
  return h('div', {},
    h('h3', {}, { sfx: 'Звук', voice: 'Звук видео' }[a.kind] || 'Музыка'),
    h('div', { class: 'note' }, `${m?.name || ''} · ${fmtTime(audioLen(a))}${(a.speed || 1) !== 1 ? ` (${+(a.speed).toFixed(2)}×)` : ''}`),
    field('Тип', seg({ music: 'Музыка', sfx: 'Звук', voice: 'Голос' }, a.kind, (v) => { set('kind', v, false); render(); })),
    range('Громкость', a.volume ?? 1, { min: 0, max: 2, step: 0.05, fmt: pct, onInput: (v) => set('volume', v) }),
    range('Плавное появление', a.fadeIn || 0, { min: 0, max: 5, step: 0.1, fmt: (v) => v.toFixed(1) + ' с', onInput: (v) => set('fadeIn', v) }),
    range('Плавное затухание', a.fadeOut || 0, { min: 0, max: 5, step: 0.1, fmt: (v) => v.toFixed(1) + ' с', onInput: (v) => set('fadeOut', v) }),
    check('Выключить звук', a.muted, (v) => set('muted', v, false)),
    h('h4', { id: 'insp-aspeed' }, 'Скорость и тон'),
    ...['', 'remix'].map((grp) => h('div', {},
      grp ? h('div', { class: 'note', style: { margin: '6px 0 4px' } }, '🔊 Ремиксы — под песню сам подкладывается бит (по её битам):') : null,
      h('div', { class: 'chips' }, ...Object.entries(AUDIO_PRESETS).filter(([, pr]) => (pr.group || '') === grp).map(([, pr]) => {
        const on = Object.entries(pr.set).every(([kk, vv]) => (kk === 'keepPitch' ? (a.keepPitch !== false) === vv : (a[kk] ?? (kk === 'speed' ? 1 : kk === 'remix' ? null : 0)) === vv));
        return h('button', { class: 'chip-btn' + (on ? ' on' : ''), onclick: () => applyAudioPreset(id, pr) }, pr.label);
      })))),
    field('Бит ремикса', sel({ '': 'Нет', ...REMIX_STYLES }, a.remix || '', (v) => applyAudioPreset(id, { set: { remix: v || null } }))),
    a.remix ? range('Громкость бита', a.remixAmt ?? 0.85, { min: 0.1, max: 1.5, step: 0.05, fmt: pct, onInput: (v) => set('remixAmt', v) }) : null,
    speedControl({ speed: a.speed || 1, srcLen: a.out - a.in, min: 0.25, max: 4, presets: [0.5, 0.75, 0.8, 1, 1.25, 1.5, 2],
      onChange: (s, live) => set('speed', s, live) }),
    check('Сохранять тон (иначе — как пластинка: быстрее = выше)', a.keepPitch !== false, (v) => { set('keepPitch', v, false); render(); }),
    range('Тон', a.pitch || 0, { min: -12, max: 12, step: 1, fmt: (v) => (v > 0 ? '+' : '') + v + ' полут.', onInput: (v) => set('pitch', v) }),
    range('Эхо (реверб)', a.reverb || 0, { min: 0, max: 1, step: 0.05, fmt: (v) => (v ? pct(v) : 'нет'), onInput: (v) => set('reverb', v) }),
    hasAudioProc(a) ? h('div', { class: 'note' }, 'Звук пересчитывается при первом воспроизведении (около секунды), дальше — сразу.') : null,
    afxEditor((p) => p.audio.find((x) => x.id === id), `aud-${id}`),
    h('h4', {}, 'Биты'),
    bt ? h('div', { class: 'note' }, `${bt.bpm} BPM · ${bt.beats.length} битов. Метки видны на треке; автобиты — во вкладке «Аудио».`)
      : h('div', { class: 'note' }, 'Биты ещё не найдены.'),
    actions(h('button', { class: 'btn', onclick: async (ev) => {
      ev.target.disabled = true; ev.target.textContent = 'Ищу биты…';
      try { const r = await detectBeats(a.media); toast(`${r.bpm} BPM, ${r.beats.length} битов`, 'ok'); } catch (e) { toast(e.message, 'err'); }
      render();
    } }, bt ? 'Найти биты заново' : 'Найти биты')),
    actions(h('button', { class: 'btn', onclick: splitAtPlayhead }, 'Разрезать'), delBtn()));
}

function renderCut(id) {
  const cuts = [...S.project.parts.cuts].sort((a, b) => a - b);
  const i = +id.slice(1);
  if (cuts[i] == null) return renderProject();
  return h('div', {},
    h('h3', {}, 'Граница части'),
    h('div', { class: 'note' }, `Между частью ${i + 1} и ${i + 2}. Перетаскивай на полосе «Части».`),
    field('Время, с', numberInput(cuts[i].toFixed(2), (v) => commit((p) => {
      const c = [...p.parts.cuts].sort((a, b) => a - b);
      c[i] = Math.max(0.5, Math.min(v, duration() - 0.5));
      p.parts.cuts = c.sort((a, b) => a - b);
    }), { step: 0.1 })),
    actions(h('button', { class: 'btn', onclick: () => seek(cuts[i]) }, 'Перейти'), h('button', { class: 'btn danger', onclick: deleteSelection }, 'Удалить границу')));
}

function renderOverlay(id) {
  const o = (S.project.overlays || []).find((x) => x.id === id);
  if (!o) return renderProject();
  return h('div', {},
    h('h3', {}, 'Свой текст'),
    h('div', { class: 'note' }, 'Повторяется сам по правилу «Когда». Все свои тексты — вкладка «Авто».'),
    overlayItem(o, (fn, key) => commit((p) => { const x = p.overlays.find((y) => y.id === id); if (x) fn(x); }, key || null),
      () => { commit((p) => { p.overlays = p.overlays.filter((y) => y.id !== id); }); }, render));
}

function renderMixed() {
  const items = selItems();
  const names = { clip: 'клипов', text: 'текстов и субтитров', effect: 'эффектов', audio: 'звуков', cut: 'границ', header: 'заголовков' };
  const counts = {};
  for (const x of items) counts[x.kind] = (counts[x.kind] || 0) + 1;
  return h('div', {},
    h('h3', {}, `Выбрано: ${items.length}`),
    h('div', { class: 'note' }, Object.entries(counts).map(([k, n]) => `${names[k] || k}: ${n}`).join(' · ')),
    h('div', { class: 'note' }, S.mobile ? 'Двигай любой из выбранных — поедут все. В режиме «Несколько» протяни пальцем по пустому месту — рамка выделит всё, что задела.'
      : 'Тащи любой из выбранных — поедут все. Ctrl/Shift+клик — добавить или убрать, протяжка по пустому месту — рамка (считается всё, что она задела).'),
    actions(h('button', { class: 'btn', onclick: duplicateSelection }, 'Дублировать'), h('button', { class: 'btn', onclick: splitAtPlayhead }, 'Разрезать'), delBtn()),
    counts.clip ? actions(detachBtn(items.filter((x) => x.kind === 'clip').map((x) => x.id))) : null);
}

let focusTrans = false;
export function render() {
  if (!S.project) return;
  const { kind, ids } = S.sel;
  let el;
  if (kind === 'mixed' || (ids.length > 1 && ['clip', 'audio', 'cut', 'header'].includes(kind))) el = renderMixed();
  else if (kind === 'clip') el = renderClip(ids[0], focusTrans);
  else if (kind === 'text') el = renderText(ids);
  else if (kind === 'header') el = renderHeader(ids[0]);
  else if (kind === 'cut') el = renderCut(ids[0]);
  else if (kind === 'effect') el = renderEffect(ids);
  else if (kind === 'audio') el = renderAudio(ids[0]);
  else if (kind === 'overlay') el = renderOverlay(ids[0]);
  else if (kind === 'ad') el = adsSection(render, { open: true });
  else el = renderProject();
  root.replaceChildren(el);
  hydrateIcons(root);
}

on('selection', () => { focusTrans = false; render(); });
on('edit-transition', () => {
  focusTrans = true;
  render();
  emit('open-inspector');
  setTimeout(() => document.getElementById('insp-trans')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
});
on('change', () => { if (!root.contains(document.activeElement)) render(); });
on('media-ready', () => { if (S.sel.kind === 'clip' && !root.contains(document.activeElement)) render(); });
on('focus-text', () => setTimeout(() => { const ta = document.getElementById('insp-text'); ta?.focus(); ta?.select(); emit('open-inspector'); }, 30));
