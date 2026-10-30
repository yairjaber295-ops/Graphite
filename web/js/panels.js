// Левая панель (на телефоне — шторка): Медиа, Аудио, Текст, Субтитры, Эффекты, Переходы, Авто (нарезка и эдит), Холст.
import { S, on, emit, commit, parts, partLabel, subs, STYLE_BASE, fmtTime, clipsTL } from './store.js';
import { h, field, range, color, select as sel, seg, check, textInput, fontPicker, toast, pct, modal } from './ui.js';
import { drawItem } from './engine/text.js';
import { EFFECTS, TRANSITIONS, EFFECT_GROUPS, TRANSITION_GROUPS, EFFECT_PACKS, transitionDefaultDur } from './engine/effects.js';
import { fxThumb } from './fxpreview.js';
import { pauseSpans, removePauses, addAccents, clearAccents, addEmoji, removeEmoji, hasEmoji } from './smart.js';
import { addMediaToTimeline, addText, addEffect, addAudio, setTransition, setTransitionAll, effectsOnBeats, cutClipsOnBeats, beatsInTimeline, ASPECTS, setAspect, containScale, addPack } from './edit.js';
import { rebuildSubs, transcribeAll, missingWords, splitIntoParts, doEverything, timelineWords, cutsSummary, detectBeats } from './auto.js';
import { seek } from './preview.js';
import { loadMedia } from './mediastate.js';
import { fitAll } from './timeline.js';
import { SFX, renderSfx } from './sfx.js';
import { TEXT_STYLES } from './textstyles.js';
import { autoEdit } from './autoedit.js';
import { allProfiles, presetsOf, applyProfile, deleteCustom, defaultProfile, setDefaultProfile } from './profiles.js';
import { presetEditor } from './presetui.js';
import { projectOverlays } from './overlays.js';
import { adsSection } from './adsui.js';
import { COVER_STYLES, drawCover, makeAvatar } from './engine/covers.js';
import { coverInfo } from './engine/frame.js';
import { hydrateIcons } from './icons.js';
import { labOn } from './backend/index.js';

const root = document.getElementById('panel');
let tab = 'media';
let busy = null;
const beatOpts = { type: 'pulse', every: 1, strongOnly: false, amount: 0.6 };

export const PRESETS = TEXT_STYLES;

// шрифты, похожие на Rubik Bold — первыми в списке
const RUBIK_LIKE = ['Rubik-700', 'Rubik-600', 'Rubik-800', 'Onest-700', 'Geologica-700', 'MPLUSRounded1c-800', 'Nunito-800', 'GolosText-700', 'MontserratAlternates-700', 'Manrope-800'];

function presetTile(preset, onclick, label = 'Текст') {
  const cv = h('canvas', { width: 260, height: 132 });
  const box = h('div', { class: 'preset', title: preset.name, onclick }, cv);
  requestAnimationFrame(() => {
    const style = { ...STYLE_BASE, wrap: 0, ...preset.style };
    // переписка — уменьшенная копия целиком (все сообщения уже появились)
    if (style.chat) return drawItem(cv.getContext('2d'), { text: preset.text, style, x: 590, y: 300, anim: {}, start: 0, end: 1 }, 0.99, 0.22);
    style.size = Math.min(style.size, 70);
    drawItem(cv.getContext('2d'), { text: label, style, x: 260, y: 132, anim: {}, start: 0, end: 1 }, 0.5, 0.5);
  });
  return box;
}

const bar = (b) => h('div', {}, h('div', { class: 'note' }, b.text), h('div', { class: 'progress' }, h('i', { style: { width: pct(b.progress || 0) } })));
const icon = (name) => h('span', { 'data-icon': name });

// ---------------------------------------------------------------------------
//   Медиа
// ---------------------------------------------------------------------------
export async function importMedia(kind = 'video') {
  const res = await S.backend.addMedia(S.project.id, kind);
  res.errors?.forEach((e) => toast(e, 'err'));
  if (!res.items?.length) return;
  await placeMedia(res.items);
}

export async function placeMedia(items, kindHint) {
  const wasEmpty = !S.project.clips.length;
  commit((p) => { p.media.push(...items); });
  for (const m of items) {
    loadMedia(m.id);
    if (m.kind === 'audio') addAudio(m, kindHint); else addMediaToTimeline(m);
  }
  if (wasEmpty) setTimeout(fitAll, 50);
  // проект без своего названия — называем по первому видео
  const first = items.find((m) => m.kind !== 'audio');
  if (first && (S.project.autoName || /^(Проект|Нарезка|Эдит|История|Shorts|Видео|Слайдшоу|Пустой)[^\n]* \d\d\.\d\d,? \d\d:\d\d$/.test(S.project.name))) {
    const name = cleanTitle(first.name);
    if (name) { commit((p) => { p.name = name; p.autoName = false; }); emit('project-renamed'); }
  }
  render();
}

/** Имя файла → название: без расширения, качества, [тегов], подчёркиваний. */
export function cleanTitle(file) {
  return String(file).replace(/\.[^.]{2,5}$/, '').replace(/\[[^\]]*\]/g, '').replace(/\((\d{3,4}p\d*|4k|hd|full ?hd)\)/gi, '')
    .replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
}

function mediaTab() {
  const p = S.project;
  const list = p.media.filter((m) => m.kind !== 'audio').map((m) => {
    const st = S.media[m.id] || {};
    const job = (S.jobs || []).find((j) => j.kind === 'prepare' && j.status === 'running' && j.title.includes(m.name));
    const tile = st.tileUrls?.[0] ? `url("${st.tileUrls[0]}")` : 'none';
    return h('div', { class: 'media-item' },
      h('div', { class: 'mi-thumb', style: { backgroundImage: tile, backgroundSize: 'auto 100%', backgroundPosition: 'left' } }),
      h('div', { class: 'mi-info' },
        h('div', { class: 'mi-name', title: m.path || m.name }, m.name),
        h('div', { class: 'mi-meta' }, `${m.role === 'ad' ? '📢 реклама · ' : ''}${fmtTime(m.duration, false)} · ${m.width}×${m.height} · ${Math.round(m.fps || 0)} fps`),
        st.status !== 'ready' ? bar({ text: job?.message || 'Готовлю…', progress: job?.progress || 0 }) : null),
      h('button', { class: 'btn', title: 'Добавить в конец таймлайна', onclick: () => { addMediaToTimeline(m); fitAll(); } }, icon('plus')));
  });
  return h('div', {},
    h('div', { class: 'section' }, h('button', { class: 'btn primary wide big', onclick: () => importMedia('video').catch((e) => toast(e.message, 'err')) }, icon('plus'), 'Импорт видео'),
      h('div', { class: 'note' }, S.backend.kind === 'local'
        ? 'Видео копируется в приложение, оригинал в галерее не меняется.'
        : 'Видео сразу встаёт на таймлайн. Пока готовится лёгкая копия для перемотки — уже можно работать.')),
    h('h3', {}, 'Файлы проекта'),
    list.length ? list : h('div', { class: 'note' }, 'Пока пусто.'));
}

// ---------------------------------------------------------------------------
//   Аудио: музыка, звуки, биты
// ---------------------------------------------------------------------------
function audioTab() {
  const p = S.project;
  const tracks = p.audio.filter((a) => a.kind !== 'sfx' && a.kind !== 'voice');
  const withBeats = p.audio.filter((a) => p.beats?.[a.media]);
  const allBeats = beatsInTimeline();
  const sfxGrid = h('div', { class: 'tile-grid' }, ...Object.entries(SFX).map(([k, label]) =>
    h('div', { class: 'tile', onclick: async () => {
      try {
        const f = await renderSfx(k);
        const m = await S.backend.uploadMedia(p.id, f);
        await placeMedia([m], 'sfx');
      } catch (e) { toast(e.message, 'err'); }
    } }, h('span', { class: 'sw', style: { background: 'rgba(240,180,41,.18)', color: '#f0b429' } }, icon('music')), label)));
  const findBeats = async (mid) => {
    busy = { text: 'Ищу биты…', progress: 0.5 };
    render();
    try { const r = await detectBeats(mid); toast(`${r.bpm} BPM · ${r.beats.length} битов`, 'ok'); } catch (e) { toast(e.message, 'err'); }
    busy = null;
    render();
  };
  return h('div', {},
    h('div', { class: 'section' }, h('button', { class: 'btn primary wide big', onclick: () => importMedia('audio').catch((e) => toast(e.message, 'err')) }, icon('music'), 'Добавить музыку'),
      h('div', { class: 'note' }, 'mp3, wav, m4a. Ставится с позиции курсора. За права на чужую музыку отвечаешь ты — в TikTok безопаснее брать звук из его библиотеки.')),
    duckingSection(),
    h('h3', {}, 'Звуки'),
    sfxGrid,
    h('div', { class: 'note' }, 'Синтезированы прямо в приложении — свободны от прав.'),
    h('h3', { style: { marginTop: '18px' } }, 'Автобиты'),
    busy ? bar(busy) : null,
    !tracks.length ? h('div', { class: 'note' }, 'Добавь музыку — найду в ней биты.') : h('div', {},
      ...tracks.map((a) => {
        const m = p.media.find((x) => x.id === a.media);
        const bt = p.beats?.[a.media];
        return h('div', { class: 'media-item' },
          h('div', { class: 'mi-thumb' }, icon('beat')),
          h('div', { class: 'mi-info' }, h('div', { class: 'mi-name' }, m?.name || 'Трек'),
            h('div', { class: 'mi-meta' }, bt ? `${bt.bpm} BPM · ${bt.beats.length} битов` : 'биты не найдены')),
          h('button', { class: 'btn', onclick: () => findBeats(a.media) }, bt ? 'Заново' : 'Найти'));
      })),
    withBeats.length ? h('div', { class: 'group' },
      field('Эффект на бит', sel(Object.fromEntries(['pulse', 'zoompunch', 'impact', 'flash', 'colorflash', 'strobe', 'shake', 'shakehard', 'bass', 'quake', 'jitter', 'zoomin', 'glitch', 'rgb', 'radialblur', 'invert', 'blur', 'dip'].map((k) => [k, EFFECTS[k].label])), beatOpts.type, (v) => { beatOpts.type = v; })),
      field('Как часто', seg({ 1: 'Каждый', 2: 'Через 1', 4: 'Каждый 4-й' }, beatOpts.every, (v) => { beatOpts.every = +v; render(); })),
      check('Только сильные доли', beatOpts.strongOnly, (v) => { beatOpts.strongOnly = v; }),
      range('Сила', beatOpts.amount, { min: 0.1, max: 1, step: 0.05, fmt: pct, onInput: (v) => { beatOpts.amount = v; } }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => { const n = effectsOnBeats(beatOpts.type, beatOpts); toast(n ? `Эффектов на биты: ${n}` : 'Нет битов на видео', n ? 'ok' : ''); } }, icon('sparkles'), 'Поставить на биты'),
        h('button', { class: 'btn', onclick: () => commit((q) => { q.effects = q.effects.filter((e) => !e.beat); }) }, 'Убрать')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => { const n = cutClipsOnBeats(beatOpts); toast(`Разрезов по битам: ${n}`, 'ok'); } }, icon('split'), 'Нарезать видео под бит')),
      h('div', { class: 'note' }, `Битов на видео: ${allBeats.length}. Края клипов и эффектов прилипают к битам (магнит).`)) : null,
    labOn('autoedit') ? h('div', { class: 'group', style: { marginTop: '18px' } },
      h('div', { class: 'note', style: { margin: 0 } }, '🧪 Автоэдит под бит — во вкладке «Авто» → «Эдит под бит»: пресеты Фонк, Velocity, Кино… и свои.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => { autoMode = 'edit'; setTab('auto'); } }, icon('wand'), 'Открыть автоэдит'))) : null);
}

// ---------------------------------------------------------------------------
//   Текст
// ---------------------------------------------------------------------------
function textTab() {
  const fav = RUBIK_LIKE.map((id) => S.fontMap[id]).filter(Boolean);
  const rest = S.fonts.filter((f) => !RUBIK_LIKE.includes(f.id));
  const fontTile = (f, isFav) => h('div', { class: 'font-item' + (isFav ? ' fav' : ''), style: { fontFamily: `"f_${f.id}"` }, onclick: () => applyOrAdd({ font: f.id }) }, 'Абв', h('small', {}, f.label));
  return h('div', {},
    h('div', { class: 'section' }, h('button', { class: 'btn primary wide big', onclick: () => addText() }, icon('type'), 'Добавить текст')),
    h('h3', {}, 'Стили'),
    h('div', { class: 'preset-grid section' }, ...PRESETS.map((pr) => presetTile(pr, () => applyOrAdd(pr.style, pr.text)))),
    h('div', { class: 'note' }, 'Клик — новый текст в этом стиле; если текст выделен — стиль применится к нему.'),
    h('h3', { style: { marginTop: '16px' } }, 'Как Rubik Bold'),
    h('div', { class: 'font-grid section' }, ...fav.map((f) => fontTile(f, true))),
    h('h3', {}, 'Все шрифты'),
    h('div', { class: 'note' }, 'Google Fonts, лицензия SIL OFL — свободны для любых видео, в том числе монетизированных.'),
    h('div', { class: 'font-grid' }, ...rest.map((f) => fontTile(f, false))));
}

function applyOrAdd(style, text) {
  if (style.chat) {
    // переписка — всегда новым элементом, подольше, по умолчанию — на чёрном фоне в начале
    addText(style, text);
    const id = S.sel.ids[0];
    commit((p) => { const it = p.texts.find((x) => x.id === id); if (it) { it.end = it.start + 4; it.anim = { in: 'fade', out: 'zoomout', dur: 300 }; } });
    return;
  }
  if (S.sel.kind === 'text') {
    const ids = S.sel.ids;
    commit((p) => {
      for (const it of p.texts.filter((x) => ids.includes(x.id))) {
        if (it.track === 'subs') Object.assign(p.subs.style, style); else Object.assign(it.style, style);
      }
    });
    emit('selection');
  } else if (S.sel.kind === 'header') {
    commit((p) => Object.assign(p.headers.style, style));
    emit('selection');
  } else addText(style);
}

// ---------------------------------------------------------------------------
//   Субтитры
// ---------------------------------------------------------------------------
function subsTab() {
  const p = S.project;
  const o = p.subs.opts;
  const hasWords = timelineWords().length > 0;
  const need = missingWords().length;
  const canDo = S.backend.caps.transcribe;
  const setOpt = (k, v) => commit((q) => { q.subs.opts[k] = v; }, 'subs-opt-' + k);
  const run = async () => {
    if (!p.clips.length) return toast('Сначала добавь видео');
    if (!need && subs().length && !confirm('Распознать заново? Текущие субтитры заменятся.')) return;
    busy = { text: 'Запускаю распознавание…', progress: 0 };
    render();
    try {
      await transcribeAll((j) => { busy = { text: j.message || 'Распознаю…', progress: j.progress }; render(); }, !need);
      toast(`Готово: ${rebuildSubs()} субтитров`, 'ok');
    } catch (e) { toast('Распознавание: ' + e.message, 'err'); }
    busy = null;
    render();
  };
  return h('div', {},
    h('h3', {}, 'Автосубтитры'),
    canDo ? h('div', { class: 'note' }, S.backend.kind === 'local'
      ? 'Речь распознаёт твой комп (Whisper на видеокарте): звук уходит на него по Wi-Fi.'
      : 'Речь распознаётся на видеокарте компа (Whisper), без интернета и подписок. Субтитры — обычный текст.')
      : h('div', { class: 'note warn' }, 'На телефоне без компа автосубтитров нет. Подключи комп: главный экран → «Комп». Текст можно добавить вручную.'),
    h('div', { class: 'row' },
      field('Язык', sel({ ru: 'Русский', uk: 'Украинский', en: 'Английский', auto: 'Определить' }, o.lang, (v) => setOpt('lang', v))),
      field('Точность', sel({ 'large-v3-turbo': 'Высокая', medium: 'Средняя', small: 'Быстрая' }, o.model, (v) => setOpt('model', v)))),
    busy ? h('div', { class: 'section' }, bar(busy)) : h('div', { class: 'btn-row section' },
      h('button', { class: 'btn primary', onclick: run, disabled: !p.clips.length || !canDo }, icon('subs'), need ? 'Распознать речь' : 'Распознать заново'),
      hasWords ? h('button', { class: 'btn', onclick: () => toast(`Пересобрано: ${rebuildSubs()} субтитров`, 'ok') }, 'Пересобрать') : null),
    h('h4', {}, 'Как резать на субтитры'),
    range('Символов в субтитре, максимум', o.maxChars, { min: 6, max: 50, onInput: (v) => setOpt('maxChars', v) }),
    range('Длительность, максимум', o.maxDur, { min: 0.8, max: 6, step: 0.1, fmt: (v) => v.toFixed(1) + ' с', onInput: (v) => setOpt('maxDur', v) }),
    range('Пауза, после которой новый субтитр', o.maxGap, { min: 0.1, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + ' с', onInput: (v) => setOpt('maxGap', v) }),
    h('div', { class: 'note' }, 'После изменения нажми «Пересобрать» — заново распознавать не нужно.'),
    h('h3', { style: { marginTop: '16px' } }, 'Стиль субтитров'),
    h('div', { class: 'preset-grid section' }, ...PRESETS.slice(0, 8).map((pr) =>
      presetTile(pr, () => commit((q) => Object.assign(q.subs.style, STYLE_BASE, { wrap: q.subs.style.wrap, size: q.subs.style.size }, pr.style)), 'Субтитры'))),
    h('div', { class: 'note' }, `Субтитров: ${subs().length}. Выдели любой на таймлайне — справа стиль сразу для всех.`),
    subs().length ? h('button', { class: 'btn danger', onclick: () => commit((q) => { q.texts = q.texts.filter((t) => t.track !== 'subs'); }) }, 'Удалить все субтитры') : null);
}

// ---------------------------------------------------------------------------
//   Эффекты и переходы
// ---------------------------------------------------------------------------
function effectsTab() {
  const groups = {};
  for (const [k, e] of Object.entries(EFFECTS)) (groups[e.group] ||= []).push([k, e]);
  return h('div', {},
    h('div', { class: 'note' }, 'Наведи на плитку — покажет, как выглядит. Клик — эффект встаёт с позиции курсора на дорожку «Эффекты»; длину и силу можно менять.'),
    h('div', { class: 'section' }, h('h3', {}, `Наборы — несколько эффектов сразу · ${Object.keys(EFFECT_PACKS).length}`),
      h('div', { class: 'tile-grid' }, ...Object.entries(EFFECT_PACKS).map(([k, pk]) => h('div', { class: 'tile fx', onclick: () => {
        const ids = addPack(k);
        toast(`«${pk.label}»: ${ids.length} эффекта на дорожке — Ctrl+Z уберёт набор целиком`, 'ok');
      } }, fxThumb({ pack: k }), pk.label)))),
    ...EFFECT_GROUPS.filter((g) => groups[g]).map((g) => h('div', { class: 'section' }, h('h3', {}, `${g} · ${groups[g].length}`),
      h('div', { class: 'tile-grid' }, ...groups[g].map(([k, e]) => h('div', { class: 'tile fx', onclick: () => { addEffect(k); toast(`«${e.label}» добавлен`); } },
        fxThumb({ effect: k }), e.label))))));
}

/** Случайный переход на каждый стык (из выбранной группы или из всех, кроме «Нет»). */
function randomTransitions(group = null) {
  const pool = Object.entries(TRANSITIONS).filter(([k, t]) => k !== 'none' && (!group || t.group === group)).map(([k]) => k);
  commit((p) => p.clips.forEach((c, i) => { if (i > 0) { const type = pool[Math.floor(Math.random() * pool.length)]; c.transition = { type, dur: transitionDefaultDur(type) }; } }));
}

/** Подсказка под группой: где такие переходы смотрятся. */
const GROUP_HINTS = {
  'Для эдитов': 'Резкие, со смазом и вспышками — на сильную долю бита (0,3–0,4 с). Как в эдитах по CS2, футболу, аниме.',
  'Окна': 'Следующий клип влетает фигурой поверх текущего.',
  'Для обычных видео': 'Спокойные — для YouTube, историй, подкастов, влогов (0,6–1 с).',
};

function transitionsTab() {
  const list = clipsTL();
  const selIdx = S.sel.kind === 'clip' ? list.findIndex((c) => c.id === S.sel.ids[0]) : -1;
  const target = selIdx > 0 ? list[selIdx] : null;
  const cur = target?.transition?.type || 'none';
  const groups = {};
  for (const [k, t] of Object.entries(TRANSITIONS)) (groups[t.group] ||= []).push([k, t]);
  const tile = ([k, t]) => h('div', { class: 'tile fx' + (cur === k && target ? ' on' : ''), onclick: () => {
    if (target) setTransition(target.id, k);
    else if (list.length > 1) { setTransitionAll(k); toast(`«${t.label}» на всех стыках`, 'ok'); }
    render();
  } }, fxThumb({ trans: k }), t.label);
  return h('div', {},
    h('div', { class: 'note' }, list.length < 2
      ? 'Переходы ставятся между клипами. Разрежь видео (Ctrl+B) — на стыке появится ромбик.'
      : target ? `Выбран стык перед клипом ${selIdx + 1}. Клик — поставить переход сюда.` : 'Выдели клип (или нажми ромбик на стыке) — переход встанет перед ним. Или сразу на все стыки. Наведи на плитку — покажет анимацию.'),
    list.length > 1 ? h('div', { class: 'btn-row section' },
      h('button', { class: 'btn', onclick: () => { randomTransitions(); toast('Случайные переходы на всех стыках — Ctrl+Z вернёт', 'ok'); render(); } }, icon('sparkles'), 'Случайные на все стыки'),
      h('button', { class: 'btn', onclick: () => { setTransitionAll('none'); render(); } }, 'Убрать все')) : null,
    ...TRANSITION_GROUPS.filter((g) => groups[g]).map((g) => h('div', { class: 'section' },
      h('div', { class: 'row', style: { alignItems: 'center' } }, h('h3', { style: { flex: 1 } }, `${g} · ${groups[g].length}`),
        list.length > 2 ? h('button', { class: 'btn', style: { padding: '3px 9px', fontSize: '11px' }, onclick: () => { randomTransitions(g); toast(`Случайные «${g}» на всех стыках`, 'ok'); render(); } }, 'Случайно') : null),
      GROUP_HINTS[g] ? h('div', { class: 'note', style: { margin: '-2px 0 6px' } }, GROUP_HINTS[g]) : null,
      h('div', { class: 'tile-grid' }, ...groups[g].map(tile)))));
}

// ---------------------------------------------------------------------------
//   Авто: нарезка и эдит под бит (пресеты из блоков, свои тексты)
// ---------------------------------------------------------------------------
let autoMode = null;
export const setAutoMode = (m) => { autoMode = m; if (tab === 'auto') render(); };

function autoTab() {
  const p = S.project;
  // «Эдит под бит» — тестовая функция: видна, только если включена в Настройках
  if (!labOn('autoedit')) return cutMode();
  autoMode ||= p.autoedit || p.editPreset ? 'edit' : 'cut';
  return h('div', {},
    h('div', { class: 'section' }, seg({ cut: 'Нарезка на части', edit: 'Эдит под бит 🧪' }, autoMode, (v) => { autoMode = v; render(); })),
    autoMode === 'edit' ? editMode() : cutMode());
}

/** Плитки пресетов: клик — выбрать, ✎ — свой на основе этого (или правка своего), × — удалить свой. */
function presetGrid(kind, current, onPick) {
  return h('div', { class: 'profile-grid' },
    ...Object.entries(presetsOf(kind)).map(([k, pr]) => h('div', { class: 'profile' + (current === k ? ' on' : ''), onclick: () => onPick(k, pr) },
      h('b', {}, pr.label), h('small', {}, pr.desc || ''),
      h('span', { class: 'acts' },
        h('span', { class: 'x', title: pr.custom ? 'Изменить' : 'Сделать свой на основе этого', onclick: (e) => { e.stopPropagation(); presetEditor(kind, k, render); } }, '✎'),
        pr.custom ? h('span', { class: 'x', title: 'Удалить', onclick: (e) => {
          e.stopPropagation();
          if (confirm(`Удалить пресет «${pr.label}»?`)) { deleteCustom(k); render(); }
        } }, '×') : null))),
    h('div', { class: 'profile add', onclick: () => presetEditor(kind, null, render) },
      h('b', {}, '+ Свой пресет'), h('small', {}, 'Собери из блоков: субтитры отсюда, обложка оттуда, свои тексты')));
}

function overlaysSection() {
  return h('div', {},
    h('h3', { style: { marginTop: '18px' } }, 'Свои тексты'),
    h('div', { class: 'note' }, 'Повторяются сами: в начале или конце каждой части, в начале видео или всё время. Выдели такой текст в кадре — можно двигать.'),
    projectOverlays(render));
}

/** Музыка тише, пока в видео говорят. */
function duckingSection() {
  const d = S.project.ducking || {};
  const set = (k, v, merge) => commit((q) => { q.ducking = { ...q.ducking, [k]: v }; }, merge ? 'duck-' + k : null);
  return h('div', { class: 'group' },
    check('Приглушать музыку, когда говорят', d.enabled, (v) => { set('enabled', v); render(); }),
    d.enabled ? range('Музыка под голосом', d.level ?? 0.3, { min: 0.05, max: 0.8, step: 0.05, fmt: pct, onInput: (v) => set('level', v, true) }) : null,
    d.enabled ? range('Чувствительность к голосу', 1 - (d.threshold ?? 0.16) / 0.4, { min: 0, max: 0.9, step: 0.05, fmt: pct, onInput: (v) => set('threshold', +(0.4 * (1 - v)).toFixed(3), true) }) : null,
    h('div', { class: 'note' }, 'Голос — звук видео и отделённые дорожки. Работает и в превью, и в экспорте.'));
}

/** Умные инструменты для речи: паузы, акценты, эмодзи. */
let pauseOpts = { minGap: 0.6, keep: 0.12, zoom: true };
function smartSection() {
  const p = S.project;
  const can = p.clips.length > 0;
  const spans = can ? pauseSpans(pauseOpts) : [];
  const sec = spans.reduce((s, [a, b]) => s + b - a, 0);
  const hasWords = subs().length > 0;
  return h('div', { class: 'group', style: { marginTop: '14px' } },
    h('h3', { style: { marginTop: 0 } }, '✂ Умные инструменты'),
    h('b', {}, 'Убрать паузы'),
    range('Паузы длиннее', pauseOpts.minGap, { min: 0.3, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + ' с', onInput: (v) => { pauseOpts.minGap = v; } }),
    range('Оставлять тишины по краям', pauseOpts.keep, { min: 0.03, max: 0.3, step: 0.01, fmt: (v) => v.toFixed(2) + ' с', onInput: (v) => { pauseOpts.keep = v; } }),
    check('Чередовать приближение на склейках (как у блогеров)', pauseOpts.zoom, (v) => { pauseOpts.zoom = v; }),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', disabled: !can, onclick: () => {
        const r = removePauses(pauseOpts);
        toast(r.n ? `Убрано пауз: ${r.n}, видео короче на ${fmtTime(r.sec, false)}. Ctrl+Z вернёт` : 'Пауз такой длины нет', r.n ? 'ok' : '');
        render();
      } }, `Убрать паузы${spans.length ? ` (${spans.length}, −${Math.round(sec)} с)` : ''}`)),
    h('div', { class: 'note' }, hasWords ? 'Режет по паузам между словами (из субтитров).' : 'Режет по тишине в звуке. С субтитрами — точнее, по словам.'),
    h('b', { style: { display: 'block', marginTop: '10px' } }, 'Акценты и эмодзи'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', disabled: !hasWords, onclick: () => { try { toast(`Зум на важных словах: ${addAccents()}`, 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Зум на важных словах'),
      p.effects.some((e) => e.accent) ? h('button', { class: 'btn', onclick: () => { clearAccents(); render(); } }, 'Убрать зумы') : null),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', disabled: !hasWords, onclick: () => { toast(`Эмодзи добавлено: ${addEmoji()}`, 'ok'); render(); } }, 'Эмодзи в субтитры 🔥'),
      hasEmoji() ? h('button', { class: 'btn', onclick: () => { removeEmoji(); render(); } }, 'Убрать эмодзи') : null),
    !hasWords ? h('div', { class: 'note' }, 'Для акцентов и эмодзи нужны субтитры.') : null);
}

function cutMode() {
  const p = S.project;
  const ps = parts();
  const setP = (k, v) => commit((q) => { q.parts[k] = v; }, 'parts-' + k);
  const def = defaultProfile();
  const all = allProfiles();
  const canRebuild = subs().length && !missingWords().length;
  const doAll = async () => {
    busy = { text: 'Начинаю…', progress: 0 };
    render();
    try { await doEverything((text, progress) => { busy = { text, progress }; render(); }); } catch (e) { toast(e.message, 'err'); }
    busy = null;
    render();
  };
  return h('div', {},
    h('div', { class: 'section' },
      busy ? bar(busy) : h('button', { class: 'btn primary wide big', onclick: doAll, disabled: !p.clips.length }, icon('wand'), 'Сделать всё автоматически'),
      h('div', { class: 'note' }, S.backend.caps.transcribe
        ? 'Субтитры (если ещё нет) → части на концах предложений → заголовки «часть N / финал» → обложки.'
        : 'Без компа: части по паузам в звуке → заголовки → обложки (субтитры — когда подключишь комп).')),
    field('Название серии', textInput(p.title, (v) => commit((q) => { q.title = v; }, 'title'), { placeholder: p.name })),
    h('h3', { style: { marginTop: '16px' } }, 'Пресет'),
    presetGrid('cut', p.profile, (k, pr) => {
      applyProfile(k);
      setDefaultProfile(k);
      toast(`«${pr.label}»: настройки применены`, 'ok');
    }),
    h('div', { class: 'note' }, def && all[def]
      ? `Новые проекты сразу открываются в «${all[def].label}». Докрути всё ниже — и ✎ → «Как сейчас в проекте», чтобы сохранить в свой пресет.`
      : 'Выбери пресет — части, субтитры, заголовки, обложка и кадр настроятся под него.'),
    canRebuild ? h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => toast(`Субтитры перестроены: ${rebuildSubs()}`, 'ok') }, 'Перестроить субтитры под пресет')) : null,
    smartSection(),
    overlaysSection(),
    adsSection(render),
    h('h3', { style: { marginTop: '16px' } }, 'Части'),
    range('Длина части, примерно', p.parts.target, { min: 15, max: 180, step: 5, fmt: (v) => v + ' с', onInput: (v) => setP('target', v) }),
    range('Максимум частей', p.parts.max, { min: 1, max: 30, fmt: (v) => (v <= 1 ? 'без частей' : v), onInput: (v) => setP('max', v) }),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => toast(cutsSummary(splitIntoParts()), 'ok'), disabled: !p.clips.length }, 'Разбить на части'),
      p.parts.cuts.length ? h('button', { class: 'btn', onclick: () => commit((q) => { q.parts.cuts = []; }) }, 'Убрать части') : null),
    ps.length > 1 ? h('div', { class: 'file-list', style: { marginTop: '8px' } },
      ...ps.map((x) => h('div', { style: { cursor: 'pointer', padding: '3px 0' }, onclick: () => seek(x.start) }, `${x.label} — ${fmtTime(x.start, false)}, ${Math.round(x.end - x.start)} с`))) : null,
    h('h3', { style: { marginTop: '18px' } }, 'Заголовки частей'),
    check('Показывать «название (часть N)»', p.headers.enabled, (v) => commit((q) => { q.headers.enabled = v; })),
    field('Шаблон', textInput(p.headers.template, (v) => commit((q) => { q.headers.template = v; }, 'header-template'))),
    h('div', { class: 'note' }, '{title} — название серии, {label} — «(часть N)» или «(финал)». Стиль — выдели заголовок на таймлайне.'),
    coversSection(ps));
}

function editMode() {
  const p = S.project;
  const tracks = p.audio.filter((a) => a.kind !== 'sfx' && a.kind !== 'voice');
  const list = presetsOf('edit');
  const cur = list[p.editPreset] ? p.editPreset : 'norm';
  const run = async () => {
    busy = { text: 'Собираю эдит…', progress: 0.4 };
    render();
    try {
      const r = await autoEdit(list[cur], {}, (text) => { busy = { text, progress: 0.6 }; render(); });
      fitAll();
      seek(0);
      toast(`Эдит готов: ${r.clips} склеек, ${fmtTime(r.length)}, ${r.bpm} BPM. Не понравилось — Ctrl+Z или «Собрать ещё раз»`, 'ok');
    } catch (e) { toast(e.message, 'err'); }
    busy = null;
    render();
  };
  return h('div', {},
    h('div', { class: 'section' },
      busy ? bar(busy) : h('button', { class: 'btn primary wide big', disabled: !tracks.length || !p.clips.length, onclick: run }, icon('wand'), p.autoedit ? 'Собрать ещё раз' : 'Собрать эдит'),
      h('div', { class: 'note' }, !tracks.length
        ? 'Нужна музыка: вкладка «Аудио» → «Добавить музыку».'
        : 'Нарежь моменты (каждый клип на таймлайне — момент) — соберу эдит в бит. Каждое нажатие — новый вариант, Ctrl+Z — как было. Субтитры и части очищаются.')),
    h('h3', {}, 'Пресет эдита'),
    presetGrid('edit', cur, (k) => { commit((q) => { q.editPreset = k; }); render(); }),
    overlaysSection(),
    adsSection(render));
}

// ---------------------------------------------------------------------------
//   Обложки («аватарки» видео)
// ---------------------------------------------------------------------------
function coverThumb(styleKey) {
  const c = h('canvas', { class: 'cover-thumb', width: 108, height: 192 });
  requestAnimationFrame(() => {
    const ctx = c.getContext('2d');
    const p = S.project, W = p.canvas.w, H = p.canvas.h;
    const k = Math.min(108 / W, 192 / H);
    const off = document.createElement('canvas');
    off.width = Math.round(W * k); off.height = Math.round(H * k);
    const o = off.getContext('2d');
    const g = o.createLinearGradient(0, 0, off.width, off.height);
    g.addColorStop(0, '#3a3f55'); g.addColorStop(1, '#141420');
    o.fillStyle = g;
    o.fillRect(0, 0, off.width, off.height);
    const ps = parts();
    const part = ps.length > 1 ? ps[1] : { i: 2, n: 5, label: partLabel(2, 5) };
    drawCover(o, coverInfo(part, styleKey), k, W, H);
    ctx.drawImage(off, (108 - off.width) / 2, (192 - off.height) / 2);
  });
  return c;
}

function coversSection(ps) {
  const p = S.project, c = p.covers;
  const set = (k, v, merge) => commit((q) => { q.covers[k] = v; }, merge ? 'cover-' + k : null);
  const setCard = (k, v, merge) => commit((q) => { q.covers.card = { ...q.covers.card, [k]: v }; }, merge ? 'card-' + k : null);
  const upload = () => {
    const inp = h('input', { type: 'file', accept: 'image/*' });
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try { set('avatar', await makeAvatar(f)); render(); } catch (e) { toast('Не получилось открыть картинку: ' + e.message, 'err'); }
    };
    inp.click();
  };
  const isStory = c.style === 'reddit';
  return h('div', {},
    h('h3', { style: { marginTop: '18px' } }, 'Обложки'),
    check('Обложка на первый кадр каждой части', c.enabled, (v) => { set('enabled', v); render(); }),
    h('div', { class: 'tile-grid section', style: { marginTop: '8px' } }, ...Object.entries(COVER_STYLES).map(([k, st]) =>
      h('div', { class: 'tile' + (c.style === k ? ' on' : ''), onclick: () => { set('style', k); render(); } }, coverThumb(k), st.label))),
    h('div', { class: 'avatar-row section' },
      h('div', { class: 'av', style: { backgroundImage: c.avatar ? `url(${c.avatar})` : 'none' } }),
      h('div', { style: { flex: 1 } },
        field(isStory ? 'Ник автора поста' : 'Ник / канал (внизу обложки, можно пусто)',
          textInput(c.nick || '', (v) => set('nick', v, true), { placeholder: isStory ? 'u/рассказчик' : '@мой_канал' })),
        h('div', { class: 'btn-row', style: { marginTop: 0 } },
          h('button', { class: 'btn', onclick: upload }, c.avatar ? 'Сменить аватарку' : 'Загрузить аватарку'),
          c.avatar ? h('button', { class: 'btn', onclick: () => { set('avatar', ''); render(); } }, 'Убрать') : null))),
    h('div', { class: 'row' },
      field('Шрифт названия', fontPicker(c.font, (v) => { set('font', v); render(); })),
      field('Цвет акцента', h('div', { class: 'row' }, color(c.accent, (v) => set('accent', v, true))))),
    isStory ? h('div', { class: 'group' },
      field('Текст карточки (заголовок поста; пусто — название серии)', textInput(c.cardText || '', (v) => set('cardText', v, true), { placeholder: 'Я узнал, что мой сосед…' })),
      field('Тема карточки', seg({ light: 'Светлая', dark: 'Тёмная' }, c.theme || 'light', (v) => { set('theme', v); render(); })),
      check('Карточка поверх видео в начале каждой части', c.card?.enabled, (v) => { setCard('enabled', v); render(); }),
      c.card?.enabled ? h('div', {},
        range('Сколько показывать', c.card.dur || 3, { min: 1, max: 10, step: 0.5, fmt: (v) => v + ' с', onInput: (v) => setCard('dur', v, true) }),
        range('Высота на экране', Math.round((c.card.y ?? 0.5) * 100), { min: 20, max: 80, fmt: (v) => v + '%', onInput: (v) => setCard('y', v / 100, true) }),
        check('Прятать субтитры, пока видна карточка', c.card.hideSubs !== false, (v) => setCard('hideSubs', v)),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => seek(Math.min(c.card.dur / 2, 1)) }, 'Показать карточку'))) : null) : null,
    ps.length > 1
      ? h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => seek(ps[1].start) }, 'Показать обложку'))
      : h('div', { class: 'note' }, 'Обложки ставятся на первый кадр частей, когда видео разбито на части. Картинками (.jpg) — галочкой в окне экспорта.'));
}

// ---------------------------------------------------------------------------
//   Холст
// ---------------------------------------------------------------------------
function canvasTab() {
  const p = S.project;
  const bg = p.background;
  const set = (k, v, merge = true) => commit((q) => { q.background[k] = v; }, merge ? 'bg-' + k : null);
  const fitAllClips = (mode) => commit((q) => {
    for (const c of q.clips) {
      const m = q.media.find((x) => x.id === c.media);
      const fill = m ? Math.max(1, (q.canvas.h * m.width) / (q.canvas.w * m.height)) : 1;
      const contain = containScale(m, q.canvas.w, q.canvas.h);
      c.scale = +({ fill, contain, width: 1, zoom: contain * 1.3 }[mode]).toFixed(3);
      c.x = 0; c.y = 0;
    }
  });
  const curAspect = Object.entries(ASPECTS).find(([, [w, hh]]) => w === p.canvas.w && hh === p.canvas.h)?.[0];
  const aspectTile = (key) => {
    const [w, hh, hint] = ASPECTS[key];
    const k = 34 / Math.max(w, hh);
    return h('div', { class: 'tile' + (curAspect === key ? ' on' : ''), title: hint, onclick: () => { setAspect(key); render(); } },
      h('span', { class: 'sw' }, h('span', { style: { width: Math.round(w * k) + 'px', height: Math.round(hh * k) + 'px', border: '2px solid currentColor', borderRadius: '4px', display: 'block' } })),
      key, h('span', { class: 'dim', style: { fontSize: '10px' } }, hint));
  };
  return h('div', {},
    h('h3', {}, 'Соотношение сторон'),
    h('div', { class: 'tile-grid section' }, ...Object.keys(ASPECTS).map(aspectTile)),
    h('div', { class: 'note' }, `Сейчас ${p.canvas.w}×${p.canvas.h}. Тексты и видео подстраиваются при смене.`),
    h('h3', { style: { marginTop: '16px' } }, 'Фон'),
    field('', seg({ blur: 'Размытое видео', color: 'Цвет' }, bg.mode, (v) => { set('mode', v, false); render(); })),
    bg.mode === 'blur'
      ? h('div', {},
        range('Размытие', bg.blur, { min: 0, max: 100, onInput: (v) => set('blur', v) }),
        range('Затемнение', bg.dim, { min: 0, max: 0.8, step: 0.05, fmt: pct, onInput: (v) => set('dim', v) }))
      : field('Цвет фона', h('div', { class: 'row' }, color(bg.color, (v) => set('color', v)))),
    h('h3', { style: { marginTop: '18px' } }, 'Видео в кадре (все клипы)'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => fitAllClips('contain') }, 'Вписать целиком'),
      h('button', { class: 'btn', onclick: () => fitAllClips('width') }, 'По ширине'),
      h('button', { class: 'btn', onclick: () => fitAllClips('zoom') }, 'Крупнее 130%'),
      h('button', { class: 'btn', onclick: () => fitAllClips('fill') }, 'На весь экран')),
    field('Частота кадров', seg({ 30: '30 fps', 60: '60 fps' }, p.canvas.fps, (v) => { commit((q) => { q.canvas.fps = +v; }); render(); })));
}

// ---------------------------------------------------------------------------
const TABS = { media: mediaTab, audio: audioTab, text: textTab, subs: subsTab, effects: effectsTab, transitions: transitionsTab, auto: autoTab, canvas: canvasTab };
export const TAB_LIST = [['media', 'film', 'Медиа'], ['audio', 'music', 'Аудио'], ['text', 'type', 'Текст'], ['subs', 'subs', 'Субтитры'],
  ['effects', 'sparkles', 'Эффекты'], ['transitions', 'transition', 'Переходы'], ['auto', 'wand', 'Авто'], ['canvas', 'canvas', 'Холст']];

export function render() {
  if (!S.project) return;
  root.replaceChildren(TABS[tab]());
  hydrateIcons(root);
}

export function setTab(t) {
  tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  render();
}
export const currentTab = () => tab;

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setTab(b.dataset.tab);
});

const softRender = () => { if (!root.contains(document.activeElement) || document.activeElement === document.body) render(); };
on('change', softRender);
on('media-ready', softRender);
on('cover-asset', () => { if (tab === 'auto') softRender(); });
on('selection', () => { if (tab === 'transitions') softRender(); });
on('jobs', () => { if (tab === 'media') softRender(); });
