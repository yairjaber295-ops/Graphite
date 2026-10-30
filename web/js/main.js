// Точка входа: запуск, экран проектов, подключение телефона ↔ комп, клавиши, раскладка ПК/телефон.
import { S, on, emit, normalize, undo, redo, save, select, duration, parts, frame, clamp, fmtTime, commit } from './store.js';
import { h, toast, modal, field, seg, fill, check } from './ui.js';
import { loadFonts } from './engine/text.js';
import { resize as resizePreview, seek, togglePlay, stopPlayback, resetVideos, draw, play } from './preview.js';
import { resize as resizeTimeline, fitAll, request as redrawTimeline, setZoom } from './timeline.js';
import { render as renderInspector } from './inspector.js';
import { render as renderPanel, setTab, importMedia, TAB_LIST, currentTab, setAutoMode, placeMedia } from './panels.js';
import { splitAtPlayhead, deleteSelection, trimToPlayhead, addCut, duplicateSelection, addText, selectAll, ASPECTS } from './edit.js';
import { loadMedia } from './mediastate.js';
import { openExport } from './exportui.js';
import { initBackend, env, settings, saveSettings, connectPc, LABS, labOn, setLab } from './backend/index.js';
import { ACTIONS, PRESETS as KEY_PRESETS, current as keyMap, usePreset, setKeys, actionFor, comboOf, prettyCombo, keysText } from './keymap.js';
import { hydrateIcons, svg } from './icons.js';
import { applyTo, defaultProfile, allProfiles } from './profiles.js';
import { THEMES, currentTheme, applyTheme } from './themes.js';
import { sendReport, reportText } from './diag.js';
import './contextmenu.js'; // меню по правому клику на таймлайне и в кадре

applyTheme(); // до первого рендера — без мигания

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
//   Раскладка: ПК или телефон
// ---------------------------------------------------------------------------
function applyLayout() {
  const mobile = window.innerWidth < 820 || (env.touch && window.innerWidth < 1100 && window.innerHeight > window.innerWidth);
  if (mobile !== S.mobile) {
    S.mobile = mobile;
    document.body.classList.toggle('mobile', mobile);
    closeSheets();
    buildMobileBar();
    emit('layout');
    if (S.project) requestAnimationFrame(() => { resizePreview(); resizeTimeline(); });
  }
}
window.addEventListener('resize', applyLayout);

function openSheet(which) {
  if (!S.mobile) return;
  $('panel').classList.toggle('open', which === 'panel');
  $('inspector').classList.toggle('open', which === 'inspector');
  $('sheet-back').classList.toggle('open', !!which);
  buildMobileBar();
}
function closeSheets() { openSheet(null); }
$('sheet-back').addEventListener('click', closeSheets);
on('open-inspector', () => openSheet('inspector'));
on('open-panel', () => { if (S.mobile) openSheet('panel'); });
// включили/выключили тестовую функцию — перерисовать то, где она видна
on('labs-changed', () => { if (!$('home').hidden) showHome(); else renderPanel(); });

function buildMobileBar() {
  const bar = $('mobile-bar');
  if (!S.mobile || !S.project) { bar.replaceChildren(); return; }
  const b = (icon, label, fn, on = false) => h('button', { class: on ? 'on' : '', onclick: fn, html: svg(icon, 22) + `<span>${label}</span>` });
  const items = [];
  // «Несколько»: касания добавляют объекты к выделению
  const multi = b('check', S.multi ? `Выбрано ${S.sel.ids.length}` : 'Несколько', () => {
    S.multi = !S.multi;
    if (!S.multi && S.sel.ids.length > 1) select(null);
    buildMobileBar();
  }, S.multi);
  if (S.sel.kind) {
    items.push(multi);
    items.push(b('edit', 'Изменить', () => { renderInspector(); openSheet('inspector'); }, $('inspector').classList.contains('open')));
    if (S.sel.kind === 'clip' && S.sel.ids.length === 1) {
      items.push(b('speed', 'Скорость', () => {
        renderInspector();
        openSheet('inspector');
        setTimeout(() => document.getElementById('insp-speed')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
      }));
    }
    if (['clip', 'text', 'effect', 'audio', 'mixed'].includes(S.sel.kind)) items.push(b('split', 'Разрезать', splitAtPlayhead));
    if (['text', 'effect', 'audio', 'mixed'].includes(S.sel.kind)) items.push(b('copy', 'Копия', duplicateSelection));
    items.push(b('trash', 'Удалить', () => { deleteSelection(); closeSheets(); }));
    if (S.multi) items.push(b('sparkles', 'Все', selectAll));
    items.push(h('div', { class: 'sep' }));
  } else {
    items.push(b('split', 'Разрезать', splitAtPlayhead));
    items.push(multi);
  }
  for (const [tab, icon, label] of TAB_LIST) {
    items.push(b(icon, label, () => { setTab(tab); openSheet('panel'); }, $('panel').classList.contains('open') && currentTab() === tab));
  }
  bar.replaceChildren(...items);
}
on('selection', buildMobileBar);

// ---------------------------------------------------------------------------
//   Экран проектов
// ---------------------------------------------------------------------------
let homeList = [];
let homeSort = 'recent';
let homePending = {}; // id проекта → сколько видео ждут выкладки

async function showHome() {
  if (S.project) { await save(); stopPlayback(); resetVideos(); }
  S.project = null;
  closeSheets();
  $('editor').hidden = true;
  $('home').hidden = false;
  renderModeBar();
  // быстрый старт: плитки типов проекта
  $('quick-start').replaceChildren(...Object.entries(projectTypes()).filter(([k]) => k !== 'empty').map(([k, t]) =>
    h('button', { class: 'qs-tile', onclick: () => createTyped(k).catch((e) => toast(e.message, 'err')) },
      h('span', { class: 'type-ic', html: svg(t.icon, 22) }), h('b', {}, t.label))));
  renderSort();
  $('home-search').oninput = renderProjects;
  homeList = await S.backend.listProjects().catch((e) => { toast(e.message, 'err'); return []; });
  renderProjects();
  // какие проекты уже экспортированы и ждут выкладки — значок на карточке
  if (S.backend.caps.uploader) {
    const pending = await import('./publish.js').then((m) => m.pendingSeries());
    homePending = {};
    for (const s of pending) if (s.project) homePending[s.project] = (homePending[s.project] || 0) + s.count;
    if (Object.keys(homePending).length) renderProjects();
  }
}

function renderSort() {
  $('home-sort').replaceChildren(seg({ recent: 'Недавние', name: 'По имени', long: 'Длинные' }, homeSort, (v) => { homeSort = v; renderSort(); renderProjects(); }));
}

/** Подпись типа проекта на карточке. */
function kindLabel(p) {
  if (p.kind && PROJECT_TYPES[p.kind]) return [PROJECT_TYPES[p.kind].icon, PROJECT_TYPES[p.kind].label.replace(/ \/.*$/, '')];
  const pr = p.profile && allProfiles()[p.profile];
  if (pr) return ['scissors', pr.label.replace(/ \/.*$/, '')];
  return p.parts > 1 ? ['scissors', 'Нарезка'] : ['film', 'Видео'];
}

/** «сегодня 12:17», «вчера», «3 дн. назад», дата. */
function ago(sec) {
  const d = new Date(sec * 1000), now = new Date();
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (days <= 0) return `сегодня ${hm}`;
  if (days === 1) return `вчера ${hm}`;
  if (days < 7) return `${days} дн. назад`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function renderProjects() {
  const q = $('home-search').value.trim().toLowerCase();
  let list = homeList.filter((p) => !q || `${p.name} ${p.title} ${(p.media || []).join(' ')}`.toLowerCase().includes(q));
  if (homeSort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (homeSort === 'long') list = [...list].sort((a, b) => b.duration - a.duration);
  const total = homeList.reduce((s, p) => s + (p.duration || 0), 0);
  $('home-count').textContent = homeList.length ? `Проекты · ${homeList.length} · ${fmtTime(total, false)} видео` : 'Проекты';
  if (!homeList.length) {
    $('project-list').replaceChildren(h('div', { class: 'home-empty' },
      h('img', { src: 'icons/logo.svg', alt: '' }),
      h('b', {}, 'Здесь будут твои проекты'),
      h('span', {}, 'Выбери, что делаем, в «Быстром старте» выше — или «Новый проект». Видео можно просто перетащить в окно.')));
    return;
  }
  if (!list.length) { $('project-list').replaceChildren(h('div', { class: 'empty-note' }, 'Ничего не нашлось.')); return; }
  $('project-list').replaceChildren(...list.map(projectCard));
}

function projectCard(p) {
  const [ic, kind] = kindLabel(p);
  const [aw, ah] = (p.aspect || '1080x1920').split('x').map(Number);
  const poster = h('div', { class: 'pc-poster' + (ah > aw ? ' tall' : '') },
    h('span', { class: 'pc-kind', html: svg(ic, 13) + `<i>${kind}</i>` }),
    p.duration ? h('span', { class: 'pc-dur' }, fmtTime(p.duration, false)) : null,
    homePending[p.id] ? h('span', { class: 'pc-ready', title: 'Экспортировано, ещё не выложено' }, `готово к выкладке · ${homePending[p.id]}`) : null);
  S.backend.posterUrl?.(p).then((u) => { if (u) { poster.style.backgroundImage = `url("${u}")`; poster.classList.add('has'); } }).catch(() => {});
  const stats = [p.parts > 1 ? `${p.parts} частей` : null, p.subs ? `${p.subs} субтитров` : null, !p.parts && p.clips > 1 ? `${p.clips} клипов` : null].filter(Boolean).join(' · ');
  const act = (icon, title, fn) => h('button', { class: 'icon-btn', title, html: svg(icon, 16), onclick: (e) => { e.stopPropagation(); fn(); } });
  return h('div', { class: 'project-card', onclick: () => openProject(p.id) },
    poster,
    h('div', { class: 'pc-body' },
      h('div', { class: 'pc-name' }, p.name),
      h('div', { class: 'pc-meta' }, [ago(p.updated), stats].filter(Boolean).join(' · ')),
      p.media?.length ? h('div', { class: 'pc-meta dim' }, p.media.join(', ')) : null),
    h('div', { class: 'pc-actions' },
      S.backend.caps.uploader ? act('upload', homePending[p.id] ? 'Запланировать в TikTok' : 'Экспортировать и запланировать', () => schedule(p)) : null,
      act('edit', 'Переименовать', () => renameDialog(p)),
      S.backend.duplicateProject ? act('copy', 'Копия проекта', async () => { await S.backend.duplicateProject(p.id); toast('Копия готова', 'ok'); showHome(); }) : null,
      act('trash', 'Удалить проект', async () => {
        if (!confirm(`Удалить проект «${p.name}»?${S.backend.kind === 'local' ? ' Видео внутри проекта удалятся из приложения.' : ' (Уйдёт в папку _корзина, сами видео не трогаются.)'}`)) return;
        await S.backend.deleteProject(p.id);
        showHome();
      })));
}

/** С главного: если серия уже экспортирована — сразу публикации; иначе открыть проект и экспорт с переходом в публикации. */
async function schedule(p) {
  if (homePending[p.id]) return import('./publish.js').then((m) => m.publishDialog({ project: p }));
  await openProject(p.id);
  if (S.project?.id === p.id) openExport({ thenPublish: true });
}

function renameDialog(p) {
  modal((box, close) => {
    const inp = h('input', { type: 'text', value: p.name, spellcheck: false });
    const ok = async () => { const n = inp.value.trim(); if (n) { await S.backend.renameProject(p.id, n); close(); showHome(); } };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    fill(box, h('h2', {}, 'Название проекта'), field('', inp),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Отмена'), h('button', { class: 'btn primary', onclick: ok }, 'Сохранить')));
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

function renderModeBar() {
  const bar = $('mode-bar');
  const phoneBtn = $('btn-phone');
  $('btn-publish').hidden = !env.desktopApp;
  $('btn-schedule').hidden = !S.backend?.caps.uploader;
  if (env.desktopApp) {
    bar.hidden = true;
    phoneBtn.hidden = false;
    $('phone-label').textContent = 'Телефон';
    return;
  }
  // телефон: где хранить проекты
  phoneBtn.hidden = false;
  $('phone-label').textContent = env.pcInfo ? `Комп: ${env.pcInfo.name}` : 'Подключить комп';
  phoneBtn.classList.toggle('on', !!env.pcInfo);
  bar.hidden = false;
  const s = settings();
  bar.replaceChildren(seg({ local: 'Проекты на телефоне', pc: 'Проекты на компе' }, s.mode === 'pc' && env.pcInfo ? 'pc' : 'local', async (v) => {
    if (v === 'pc' && !env.pcInfo) return connectDialog();
    saveSettings({ mode: v });
    location.reload();
  }));
}

/** Что за видео делаем — от этого зависят кадр, пресет и с какой вкладки начать. */
const PROJECT_TYPES = {
  cut: { icon: 'scissors', label: 'Нарезка на части', desc: 'Длинное видео → части с субтитрами, заголовками и обложками', aspect: '9:16',
    preset: () => (allProfiles()[defaultProfile()]?.kind === 'cut' ? defaultProfile() : 'classic'), tab: 'auto', mode: 'cut' },
  edit: { icon: 'beat', label: 'Эдит под бит', desc: 'Закинь моменты и музыку — соберётся в бит с переходами', aspect: '9:16', edit: 'norm', tab: 'auto', mode: 'edit' },
  story: { icon: 'story', label: 'История (Reddit)', desc: 'Карточка поста, крупные слова по центру, геймплей на фоне', aspect: '9:16', preset: () => 'reddit', tab: 'auto', mode: 'cut' },
  shorts: { icon: 'phone', label: 'Shorts / Reels / TikTok', desc: 'Вертикальное видео одним куском, субтитры', aspect: '9:16', preset: () => 'shorts', tab: 'subs' },
  youtube: { icon: 'youtube', label: 'Видео для YouTube', desc: '16:9, аккуратные субтитры, без частей', aspect: '16:9', preset: () => 'youtube', tab: 'subs' },
  slides: { icon: 'image', label: 'Слайдшоу из фото', desc: 'Фото с плавным движением и переходами, музыка', aspect: '9:16', preset: () => 'shorts', tab: 'audio', slides: true },
  empty: { icon: 'square', label: 'Пустой проект', desc: 'Без настроек — всё вручную', aspect: null, tab: 'media' },
};

/** Типы проекта, которые сейчас показываем («Эдит под бит» — только если включён в тестовых функциях). */
const projectTypes = () => Object.fromEntries(Object.entries(PROJECT_TYPES).filter(([k]) => k !== 'edit' || labOn('autoedit')));

function newProject() {
  modal((box, close) => {
    box.classList.add('wide');
    const nameInp = h('input', { type: 'text', placeholder: 'Название (можно не писать — возьму из названия видео)', spellcheck: false });
    fill(box,
      h('h2', {}, 'Что делаем?'),
      field('', nameInp),
      h('div', { class: 'type-grid' }, ...Object.entries(projectTypes()).map(([k, t]) => h('button', { class: 'type-card', onclick: () => {
        close();
        createTyped(k, nameInp.value.trim()).catch((e) => toast(e.message, 'err'));
      } }, h('span', { class: 'type-ic', html: svg(t.icon, 26) }), h('b', {}, t.label), h('small', {}, t.desc)))));
    setTimeout(() => nameInp.focus(), 30);
  });
}

/** Файлы (перетащенные в окно) → в текущий проект. */
async function addFiles(files) {
  const items = [];
  for (const [i, f] of files.entries()) {
    toast(`Добавляю ${i + 1} из ${files.length}: ${f.name}`);
    try { items.push(await S.backend.uploadMedia(S.project.id, f)); } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
  }
  if (items.length) await placeMedia(items);
}

// перетаскивание файлов в окно: на главном — новый проект, в редакторе — в текущий
const MEDIA_RE = /\.(mp4|mov|mkv|webm|m4v|avi|mp3|wav|m4a|aac|ogg|flac|jpe?g|png|webp)$/i;
const dropHint = h('div', { class: 'drop-hint', hidden: true }, 'Отпусти — добавлю в проект');
document.body.append(dropHint);
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); dropHint.hidden = false; } });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dropHint.hidden = true; });
window.addEventListener('drop', async (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  dropHint.hidden = true;
  const files = [...e.dataTransfer.files].filter((f) => /^(video|audio|image)\//.test(f.type) || MEDIA_RE.test(f.name));
  if (!files.length) return toast('Это не видео, звук или фото');
  try {
    if (S.project) await addFiles(files);
    else await createTyped('cut', '', files);
  } catch (err) { toast(err.message, 'err'); }
});

async function createTyped(kind, title = '', files = null) {
  const t = PROJECT_TYPES[kind];
  const name = title || `${t.label} ${new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  const p = await S.backend.createProject(name);
  await openProject(p.id, kind);
  // своё название → оно же название серии; иначе имя возьмётся из первого видео
  S.project.autoName = !title;
  if (title) S.project.title = title;
  setTab(t.tab);
  if (t.mode) setAutoMode(t.mode);
  if (files?.length) await addFiles(files);
  else await importMedia('video').catch((e) => toast(e.message, 'err'));
  if (t.slides && S.project.clips.length) {
    // слайдшоу: у фото — плавное движение, между ними — растворение
    const order = ['zoomin', 'panleft', 'zoomout', 'panright'];
    commit((q) => q.clips.forEach((c, i) => {
      if (q.media.find((m) => m.id === c.media)?.kind === 'image') c.motion = order[i % order.length];
      if (i > 0) c.transition = { type: 'fade', dur: 0.6 };
    }));
    toast('Фото расставлены с движением и переходами. Добавь музыку — «Добавить музыку»', 'ok');
  }
}

async function openProject(pid, kind = null) {
  const data = await S.backend.loadProject(pid);
  if (!data) return toast('Проект не найден', 'err');
  S.project = normalize(data);
  const t = kind && PROJECT_TYPES[kind];
  if (t) {
    // новый проект нужного типа: кадр и пресет — до первого рендера, без шага в истории
    if (t.aspect) { const [w, hh] = ASPECTS[t.aspect]; S.project.canvas.w = w; S.project.canvas.h = hh; }
    if (t.preset) applyTo(S.project, t.preset());
    if (t.edit) S.project.editPreset = t.edit;
    S.project.kind = kind;
  } else if (!S.project.profile && !S.project.clips.length && !S.project.kind && defaultProfile()) {
    // новый пустой проект — сразу в настройках выбранного пресета
    applyTo(S.project, defaultProfile());
  }
  S.undo = []; S.redo = [];
  S.t = 0; S.sel = { kind: null, ids: [] }; S.media = {}; S.scroll = 0;
  resetVideos();
  $('home').hidden = true;
  $('editor').hidden = false;
  $('project-name').value = S.project.name;
  S.project.media.forEach((m) => loadMedia(m.id));
  setAutoMode(null);
  setTab(S.project.clips.length ? 'auto' : 'media');
  buildMobileBar();
  requestAnimationFrame(() => {
    resizePreview();
    resizeTimeline();
    fitAll();
    renderInspector();
    renderPanel();
    seek(0);
  });
  // реклама из пресета, ролики которой ещё не в проекте, — из библиотеки
  if (S.project.ads?.items?.some((i) => !i.media && i.lib)) import('./adsui.js').then((m) => m.syncAdLibrary()).catch((e) => toast(e.message, 'err'));
}

// ---------------------------------------------------------------------------
//   Телефон ↔ комп
// ---------------------------------------------------------------------------
async function phoneDialog() {
  // на компе: как подключить телефон
  const info = await S.backend.req('GET', '/api/pair').catch((e) => { toast(e.message, 'err'); return null; });
  if (!info) return;
  const { qrcode } = await import('../vendor/qrcode.mjs');
  const qrSvg = (text) => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); };
  const ip = info.lan[0] || '—';
  const httpsUrl = `https://${ip}:${info.https_port}/?k=${info.code}`;
  modal((box, close) => {
    let os = 'android';
    const draw = () => {
      fill(box, 
        h('h2', {}, 'Graphite на телефоне'),
        h('div', { class: 'note' }, 'Телефон и комп должны быть в одной Wi-Fi сети. На телефоне редактор работает и сам по себе, а с компом — ещё делает субтитры и открывает проекты отсюда.'),
        field('', seg({ android: 'Android', iphone: 'iPhone' }, os, (v) => { os = v; draw(); })),
        os === 'android' ? h('div', {},
          h('div', { class: 'note' }, info.apk ? '1. Установи приложение: открой ссылку на телефоне (или отсканируй код).' : '1. Приложение для Android ещё не собрано (см. ПРОЧТИ.txt).'),
          info.apk ? h('div', { class: 'qr', html: qrSvg(`http://${ip}:${info.http_port}/app.apk`) }) : null,
          info.apk ? h('div', { class: 'note', style: { textAlign: 'center', userSelect: 'text' } }, `http://${ip}:${info.http_port}/app.apk`) : null,
          h('div', { class: 'note' }, '2. В приложении: «Подключить комп» → адрес и код:'),
        ) : h('div', {},
          h('div', { class: 'note' }, '1. Открой на iPhone в Safari и установи сертификат компа (один раз): Настройки → Профиль загружен → Установить; потом Основные → Об этом устройстве → Доверие сертификатам → включить «Нарезчик» (так называется сертификат Graphite).'),
          h('div', { class: 'note', style: { userSelect: 'text' } }, `http://${ip}:${info.http_port}/ca.crt`),
          h('div', { class: 'note' }, '2. Отсканируй камерой код — откроется редактор. «Поделиться» → «На экран Домой» — и он будет как приложение (работает и без компа).'),
          h('div', { class: 'qr', html: qrSvg(httpsUrl) }),
        ),
        h('div', { class: 'big-code' }, info.code),
        h('div', { class: 'note', style: { textAlign: 'center', userSelect: 'text' } }, `Адрес компа: ${info.lan.map((x) => `${x}:${info.http_port}`).join('  ·  ') || 'нет сети'}`),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: async () => { await S.backend.req('POST', '/api/pair/reset'); close(); phoneDialog(); } }, 'Новый код'),
          h('button', { class: 'btn primary', onclick: close }, 'Готово')));
    };
    draw();
  });
}

function connectDialog() {
  const s = settings();
  modal((box, close) => {
    const addr = h('input', { type: 'url', placeholder: '192.168.1.10:8765', value: s.pcBase?.replace(/^https?:\/\//, '') || '' });
    const code = h('input', { type: 'text', placeholder: 'код с экрана компа', value: s.pcKey || '', inputmode: 'numeric' });
    const status = h('div', { class: 'note' });
    box.append(
      h('h2', {}, 'Подключить комп'),
      h('div', { class: 'note' }, 'На компе открой Graphite → кнопка «Телефон». Там адрес и код. Комп и телефон — в одной Wi-Fi сети.'),
      field('Адрес компа', addr), field('Код', code), status,
      h('div', { class: 'actions' },
        env.pcInfo ? h('button', { class: 'btn danger', onclick: () => { saveSettings({ pcBase: '', pcKey: '', mode: 'local' }); location.reload(); } }, 'Отключить') : null,
        h('button', { class: 'btn', onclick: close }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: async () => {
          status.textContent = 'Подключаюсь…';
          try { const info = await connectPc(addr.value, code.value); toast(`Подключено: ${info.name}`, 'ok'); location.reload(); } catch (e) { status.textContent = e.message; status.classList.add('warn'); }
        } }, 'Подключить')));
  });
}

$('btn-phone').onclick = () => (env.desktopApp ? phoneDialog() : connectDialog());

// ---------------------------------------------------------------------------
//   Горячие клавиши
// ---------------------------------------------------------------------------
const ACT = {
  play: togglePlay, pause: () => stopPlayback(), split: splitAtPlayhead, delete: deleteSelection,
  trimLeft: () => trimToPlayhead('l'), trimRight: () => trimToPlayhead('r'), undo, redo,
  frameBack: () => seek(clamp(S.t - frame(), 0, duration())), frameFwd: () => seek(clamp(S.t + frame(), 0, duration())),
  secBack: () => seek(clamp(S.t - 1, 0, duration())), secFwd: () => seek(clamp(S.t + 1, 0, duration())),
  home: () => seek(0), end: () => seek(duration()),
  prevPart: () => { const c = [...parts()].reverse().find((p) => p.start < S.t - 0.05); seek(c ? c.start : 0); },
  nextPart: () => { const n = parts().find((p) => p.start > S.t + 0.05); if (n) seek(n.start); },
  addCut: () => addCut(S.t), addText: () => addText(), duplicate: duplicateSelection,
  zoomIn: () => setZoom(S.zoom * 1.3), zoomOut: () => setZoom(S.zoom / 1.3), fit: fitAll,
  deselect: () => { S.multi = false; select(null); }, selectAll, exportVideo: openExport, save,
};

let listening = null; // переназначение: ждём нажатие
document.addEventListener('keydown', (e) => {
  if (listening) {
    e.preventDefault();
    if (e.code === 'Escape') { listening.cancel(); return; }
    const c = comboOf(e);
    if (c) listening.done(c);
    return;
  }
  if (!S.project || $('editor').hidden) return;
  const tag = document.activeElement?.tagName;
  const typing = (tag === 'INPUT' && !['range', 'checkbox', 'color'].includes(document.activeElement.type)) || tag === 'TEXTAREA' || tag === 'SELECT';
  const action = actionFor(e);
  if (action === 'save') { e.preventDefault(); save(); return; }
  if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
  if (document.querySelector('.modal-back')) return;
  if (!action) return;
  e.preventDefault();
  ACT[action]?.();
  if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
});

const renderPreviewNow = () => { if (S.project) draw(); };

/** Диагностика: что умеет устройство + журнал ошибок; с телефона можно отправить на комп. */
function diagDialog() {
  modal((box, close) => {
    box.classList.add('wide');
    const pre = h('pre', { class: 'diag' }, 'Проверяю устройство…');
    const linked = S.backend?.kind === 'remote' || !!S.backend?.pc;
    fill(box, h('h2', {}, 'Диагностика'),
      h('div', { class: 'note' }, 'Если что-то не работает (превью, экспорт) — здесь видно, что умеет устройство и какие были ошибки.'),
      pre,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(pre.textContent); toast('Скопировано', 'ok'); } catch { toast('Не скопировалось — выдели текст вручную'); } } }, 'Скопировать'),
        linked && !env.desktopApp ? h('button', { class: 'btn', onclick: async () => {
          try { await sendReport(true); toast('Отправлено на комп (папка logs у Graphite)', 'ok'); } catch (e) { toast(e.message, 'err'); }
        } }, 'Отправить на комп') : null,
        h('button', { class: 'btn primary', onclick: close }, 'Закрыть')));
    reportText().then((t) => { pre.textContent = t; }, (e) => { pre.textContent = 'Ошибка проверки: ' + e.message; });
  });
}

/** Настройки: оформление (темы) и горячие клавиши. */
function settingsDialog() {
  modal((box, close) => {
    box.classList.add('wide');
    const draw = () => {
      const cur = currentTheme();
      fill(box, 
        h('h2', {}, 'Настройки'),
        h('h3', {}, 'Оформление'),
        h('div', { class: 'theme-grid' }, ...Object.entries(THEMES).map(([k, t]) => h('button', { class: 'theme-card' + (cur === k ? ' on' : ''), onclick: () => {
          applyTheme(k, true);
          redrawTimeline();
          draw();
        } },
          // мини-превью окна в цветах темы
          h('div', { class: 'theme-mini', style: { background: t.bg } },
            h('i', { style: { background: t.surface } }), h('i', { style: { background: t.surface } }),
            h('b', { style: { background: `linear-gradient(135deg, ${t.accent}, ${t.accent2})` } }),
            h('u', { style: { background: t.text } }), h('u', { style: { background: t.text, width: '40%' } })),
          h('b', {}, t.label), h('small', {}, t.desc)))),
        h('div', { class: 'note' }, 'Тема меняет только вид приложения — на видео не влияет. Запоминается на этом устройстве.'),
        h('h3', { style: { marginTop: '16px' } }, 'Превью'),
        check('Совместимое превью (если на телефоне превью чёрное)', !!settings().compatPreview, (v) => { saveSettings({ compatPreview: v }); draw(); renderPreviewNow(); }),
        h('div', { class: 'note' }, 'Кадр видео сначала копируется через обычный холст. Чуть медленнее, но работает на любых видеочипах. Включается и сам, если превью несколько раз подряд чёрное.'),
        h('h3', { style: { marginTop: '16px' } }, '🧪 Тестовые функции'),
        h('div', { class: 'note' }, 'Ещё доделываются — могут работать не идеально. Включи, чтобы попробовать.'),
        ...Object.entries(LABS).map(([k, l]) => h('div', {},
          check(l.label, labOn(k), (v) => { setLab(k, v); emit('labs-changed'); draw(); }),
          h('div', { class: 'note', style: { margin: '0 0 8px 26px' } }, l.desc))),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => { close(); diagDialog(); } }, h('span', { 'data-icon': 'help' }), 'Диагностика'),
          h('button', { class: 'btn', onclick: () => { close(); keysDialog(); } }, h('span', { 'data-icon': 'keyboard' }), 'Горячие клавиши'),
          h('button', { class: 'btn primary', onclick: close }, 'Готово')));
      hydrateIcons(box);
    };
    draw();
  });
}

function keysDialog() {
  modal((box, close) => {
    const draw = () => {
      const m = keyMap();
      fill(box, 
        h('h2', {}, 'Горячие клавиши'),
        field('Готовая схема', seg({ ...Object.fromEntries(Object.entries(KEY_PRESETS).map(([k, v]) => [k, v.label])), ...(m.preset === 'custom' ? { custom: 'Своя' } : {}) },
          m.preset, (v) => { if (v !== 'custom') { usePreset(v); draw(); } })),
        h('div', { class: 'note' }, 'Нажми на кнопку справа и затем нужное сочетание. Esc — отмена. Работает на любой раскладке.'),
        h('div', { class: 'keys' }, ...Object.entries(ACTIONS).flatMap(([a, label]) => {
          const btn = h('button', { class: 'keybtn' }, keysText(a) || '—');
          btn.onclick = () => {
            btn.classList.add('listen');
            btn.textContent = 'Нажми клавиши…';
            listening = {
              done: (c) => { listening = null; setKeys(a, [c]); draw(); },
              cancel: () => { listening = null; draw(); },
            };
          };
          btn.oncontextmenu = (ev) => { ev.preventDefault(); setKeys(a, []); draw(); };
          return [h('div', {}, label), btn];
        })),
        h('div', { class: 'note' }, 'Правый клик по кнопке — убрать сочетание.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => { listening = null; close(); } }, 'Готово')));
    };
    draw();
  });
}

// ---------------------------------------------------------------------------
//   Верхняя панель и кнопки
// ---------------------------------------------------------------------------
$('btn-new').onclick = newProject;
$('btn-home').onclick = () => showHome();
for (const id of ['btn-undo', 'btn-undo-m']) $(id).onclick = undo;
for (const id of ['btn-redo', 'btn-redo-m']) $(id).onclick = redo;
$('btn-export').onclick = openExport;
$('btn-play').onclick = togglePlay;
$('btn-keys').onclick = keysDialog;
$('btn-settings-home').onclick = settingsDialog;
$('btn-settings').onclick = settingsDialog;
$('project-name').addEventListener('change', (e) => commit((p) => { p.name = e.target.value.trim() || p.name; p.autoName = false; }));
on('project-renamed', () => { if (S.project) $('project-name').value = S.project.name; });
$('btn-publish').onclick = () => import('./publish.js').then((m) => m.publishDialog());
$('btn-schedule').onclick = async () => { await save(); import('./publish.js').then((m) => m.publishDialog({ project: S.project })); };
$('btn-import-empty').onclick = () => importMedia('video').catch((e) => toast(e.message, 'err'));
$('btn-prev').onclick = ACT.prevPart;
$('btn-next').onclick = ACT.nextPart;
$('tl-split').onclick = splitAtPlayhead;
$('tl-delete').onclick = deleteSelection;
$('tl-dup').onclick = duplicateSelection;
$('tl-trim-l').onclick = () => trimToPlayhead('l');
$('tl-trim-r').onclick = () => trimToPlayhead('r');
$('tl-addcut').onclick = () => addCut(S.t);
$('tl-ripple').onchange = (e) => { S.ripple = e.target.checked; };
$('tl-snap').onchange = (e) => { S.snap = e.target.checked; };

const titles = { 'tl-split': 'split', 'tl-delete': 'delete', 'tl-trim-l': 'trimLeft', 'tl-trim-r': 'trimRight', 'tl-addcut': 'addCut', 'tl-dup': 'duplicate', 'btn-undo': 'undo', 'btn-redo': 'redo', 'btn-play': 'play' };
function refreshTitles() { for (const [id, a] of Object.entries(titles)) { const el = $(id); if (el) el.title = `${ACTIONS[a]} (${keysText(a) || 'без клавиши'})`; } }

on('save-state', () => {
  $('save-state').textContent = { saved: 'Сохранено', saving: 'Сохраняю…', dirty: '•', error: '⚠ не сохранено' }[S.saveState] || '';
});
on('change', () => {
  for (const id of ['btn-undo', 'btn-undo-m']) $(id).disabled = !S.undo.length;
  for (const id of ['btn-redo', 'btn-redo-m']) $(id).disabled = !S.redo.length;
});
on('frame', () => {
  const ps = parts();
  const part = ps.find((x) => S.t >= x.start && S.t < x.end) || ps[ps.length - 1];
  $('part-indicator').textContent = ps.length > 1 && part ? `Часть ${part.i}/${part.n}` : '';
});
on('toast', ({ text, kind }) => toast(text, kind));

// ---------------------------------------------------------------------------
//   Фоновые задачи компа (превью-копии, распознавание)
// ---------------------------------------------------------------------------
const seen = new Set();
async function pollJobs() {
  if (S.project && S.backend.jobs) {
    try {
      const list = await S.backend.jobs(S.project.id);
      S.jobs = list;
      $('jobs').replaceChildren(...list.filter((j) => j.status === 'running' || j.status === 'queued').map((j) =>
        h('div', { class: 'job-chip', title: j.message },
          h('span', {}, j.title.length > 34 ? j.title.slice(0, 33) + '…' : j.title),
          h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(j.progress * 100)}%` } })),
          h('span', { class: 'x', title: 'Отменить', onclick: () => S.backend.cancelJob(j.id) }, '✕'))));
      for (const j of list) {
        if (j.status === 'error' && !seen.has(j.id)) { seen.add(j.id); toast(`${j.title}: ${j.error}`, 'err'); }
        if (j.status === 'done' && j.kind === 'prepare' && !seen.has(j.id)) { seen.add(j.id); loadMedia(j.result.mid); }
      }
      emit('jobs');
    } catch { /* комп недоступен */ }
  }
  setTimeout(pollJobs, 1200);
}

// высота таймлайна (ПК)
$('resizer').addEventListener('pointerdown', (e) => {
  const wrap = $('timeline-wrap');
  const startY = e.clientY, startH = wrap.getBoundingClientRect().height;
  const move = (ev) => { wrap.style.height = clamp(startH - (ev.clientY - startY), 170, window.innerHeight - 260) + 'px'; };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
});

window.addEventListener('beforeunload', () => { if (S.project && S.saveState !== 'saved') S.backend.saveBeacon?.(S.project); });
document.addEventListener('visibilitychange', () => { if (document.hidden && S.project) { save(); stopPlayback(); } });

// ---------------------------------------------------------------------------
async function init() {
  hydrateIcons();
  // код доступа из QR-ссылки (iPhone открывает https://комп/?k=код)
  const k = new URLSearchParams(location.search).get('k');
  if (k) { saveSettings({ pcKey: k, mode: 'pc' }); history.replaceState(null, '', location.pathname); }
  S.backend = await initBackend();
  S.backend.onUrl = () => draw();
  // телефон, связанный с компом: один раз за запуск отправляем возможности устройства (для разбора проблем)
  if (!env.desktopApp && (S.backend.kind === 'remote' || S.backend.pc)) setTimeout(() => sendReport(true).catch(() => {}), 8000);
  S.fonts = await fetch('fonts/fonts.json').then((r) => r.json());
  S.fontMap = Object.fromEntries(S.fonts.map((f) => [f.id, f]));
  await loadFonts('fonts/');
  applyLayout();
  refreshTitles();
  await showHome();
  pollJobs();
  if ('serviceWorker' in navigator && !env.native && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init().catch((e) => { document.body.prepend(h('div', { class: 'toast err' }, 'Ошибка запуска: ' + e.message)); console.error(e); });
window.__S = S;
