// Меню по правому клику (на телефоне — долгое нажатие) на таймлайне и в кадре:
// быстрые действия с тем, что под курсором — звук (бас, «телефон»…), скорость, фильтр, хромакей, переход, эффект.
import { S, commit, select, emit, isSelected, uid, fmtTime, CHROMA_DEFAULTS } from './store.js';
import { h, toast } from './ui.js';
import { splitAtPlayhead, deleteSelection, duplicateSelection, setClipSpeed, setTransition, addEffect, addText, addCut, clipStart, rippleInsert, freezeFrame, setFreezeDur } from './edit.js';
import { seek, hitAt, keyColorOf, peekAd } from './preview.js';
import { hitAtClient } from './timeline.js';
import { AFX_PRESETS, hasAfx } from './engine/afx.js';
import { adPlacements } from './engine/ads.js';
import { AUDIO_PRESETS } from './engine/audioproc.js';
import { FILTERS, TRANSITIONS, EFFECTS } from './engine/effects.js';
import { clipDur } from './engine/speed.js';
import { ANIMS_IN } from './engine/text.js';
import { TEXT_STYLES } from './textstyles.js';
import { detachAudio } from './detach.js';

let cur = null;
export function closeMenu() { cur?.remove(); cur = null; }

/** items: [{label, action, hint?, on?, danger?, sub?: [...]}, '-' (разделитель), null (пропуск)]. */
export function openMenu(x, y, items) {
  closeMenu();
  const build = (list) => h('div', { class: 'ctx-menu' }, ...list.filter(Boolean).map((it) => {
    if (it === '-') return h('div', { class: 'ctx-sep' });
    if (it.sub) {
      const row = h('div', { class: 'ctx-item has-sub', onclick: (e) => { e.stopPropagation(); row.classList.toggle('open'); } },
        h('span', {}, it.label), h('span', { class: 'ctx-arrow' }, '›'));
      const sub = build(it.sub);
      sub.classList.add('ctx-sub');
      row.append(sub);
      // подменю не должно уходить за низ экрана — поднимаем
      const fit = () => requestAnimationFrame(() => {
        sub.style.top = '';
        const r = sub.getBoundingClientRect();
        if (r.bottom > innerHeight - 6) sub.style.top = `${-6 - (r.bottom - innerHeight + 6)}px`;
      });
      row.addEventListener('mouseenter', fit);
      row.addEventListener('click', fit);
      return row;
    }
    return h('div', { class: 'ctx-item' + (it.on ? ' on' : '') + (it.danger ? ' danger' : ''), onclick: (e) => { e.stopPropagation(); closeMenu(); it.action(); } },
      h('span', {}, it.label), it.hint ? h('span', { class: 'ctx-hint' }, it.hint) : null);
  }));
  const m = build(items);
  m.classList.add('ctx-root');
  if (x > innerWidth - 440) m.classList.add('flip'); // подменю — влево, если справа нет места
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
  m.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
  cur = m;
}
addEventListener('pointerdown', (e) => { if (cur && !cur.contains(e.target)) closeMenu(); }, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
addEventListener('resize', closeMenu);
addEventListener('blur', closeMenu);

const props = (scrollTo) => { emit('open-inspector'); if (scrollTo) setTimeout(() => document.getElementById(scrollTo)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80); };

/** Звук: громкость и эффекты. get() — объект (клип/дорожка), apply(fn) — изменить его. */
function soundMenu(get, apply) {
  const o = get() || {}, a = o.afx || {};
  const vol = o.volume ?? 1;
  return [
    { label: 'Без звука', on: vol === 0, action: () => apply((x) => { x.volume = 0; }) },
    ...[1, 1.5, 2].map((v) => ({ label: `Громкость ${v * 100}%`, on: vol === v, action: () => apply((x) => { x.volume = v; }) })),
    '-',
    ...Object.values(AFX_PRESETS).map((pr) => ({ label: pr.label,
      on: Object.entries(pr.set).every(([k, v]) => (a[k] ?? (k === 'filter' ? 'none' : 0)) === v),
      action: () => { apply((x) => { x.afx = { ...(x.afx || {}), ...pr.set }; }); toast(`Звук: ${pr.label.toLowerCase()}`, 'ok'); } })),
    hasAfx(a) ? { label: 'Сбросить эффекты звука', action: () => apply((x) => { delete x.afx; }) } : null,
    { label: 'Тонкая настройка…', action: () => props('insp-afx') },
  ];
}

function duplicateClip(id) {
  commit((p) => {
    const i = p.clips.findIndex((x) => x.id === id);
    if (i < 0) return;
    const c = { ...structuredClone(p.clips[i]), id: uid(), transition: { type: 'none', dur: 0.5 } };
    rippleInsert(p, clipStart(p, id) + clipDur(p.clips[i]), clipDur(c));
    p.clips.splice(i + 1, 0, c);
  });
}

function clipMenu(id, t) {
  const c = S.project.clips.find((x) => x.id === id);
  if (!c) return [];
  const m = S.project.media.find((x) => x.id === c.media);
  const img = m?.kind === 'image';
  const idx = S.project.clips.indexOf(c);
  const apply = (fn) => commit((p) => fn(p.clips.find((x) => x.id === id)));
  const key = (fn) => apply((x) => { x.chroma = { ...CHROMA_DEFAULTS, ...x.chroma }; fn(x.chroma); });
  // стоп-кадр — там, где сейчас стоит видео (курсор), если он на этом клипе; иначе — где кликнули
  const start = clipStart(S.project, id), end = start + clipDur(c);
  const ft = S.t >= start && S.t < end ? S.t : t;
  const still = img || c.freeze;
  return [
    still ? null : { label: `⏸ Стоп-кадр на ${fmtTime(ft)}`, action: () => {
      if (freezeFrame(ft, 2)) toast('Стоп-кадр готов — длину тяни за край на таймлайне', 'ok');
    } },
    c.freeze ? { label: 'Длина стоп-кадра', sub: [0.5, 1, 2, 3, 5].map((d) => ({ label: `${d} с`, on: Math.abs(c.freeze - d) < 1e-3, action: () => commit((p) => setFreezeDur(p, id, d)) })) } : null,
    { label: 'Разрезать здесь', hint: 'Ctrl+B', action: () => { seek(t); splitAtPlayhead(); } },
    { label: 'Копия клипа', action: () => duplicateClip(id) },
    '-',
    still ? null : { label: 'Звук', sub: [...soundMenu(() => S.project.clips.find((x) => x.id === id), apply), '-',
      { label: 'Отделить звук на дорожку', action: () => detachAudio([id]).catch((e) => toast(e.message, 'err')) }] },
    still ? null : { label: 'Скорость', sub: [0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((v) => ({ label: `${v}×`, on: (c.speed || 1) === v && (c.curve || 'none') === 'none', action: () => setClipSpeed(id, v, 'none') })) },
    { label: 'Растяг', sub: [
      { label: 'На весь экран', action: () => { const m0 = m?.width ? (S.project.canvas.h * m.width) / (S.project.canvas.w * m.height) : 1; apply((x) => Object.assign(x, { sx: 1, sy: +m0.toFixed(3), scale: 1, x: 0, y: 0 })); } },
      { label: '4:3 растянутый', on: Math.abs((c.sx || 1) - 4 / 3) < 0.01, action: () => apply((x) => { x.sx = 1.333; x.sy = 1; }) },
      { label: 'Широкий 150%', on: Math.abs((c.sx || 1) - 1.5) < 0.01, action: () => apply((x) => { x.sx = 1.5; x.sy = 1; }) },
      (c.sx || 1) !== 1 || (c.sy || 1) !== 1 ? { label: 'Без растяга', action: () => apply((x) => { x.sx = 1; x.sy = 1; }) } : null,
      { label: 'Растяг на бит здесь', action: () => addEffect('stretchx', t) },
    ] },
    { label: 'Фильтр', sub: Object.entries(FILTERS).map(([k, f]) => ({ label: f.label, on: (c.filter || 'none') === k, action: () => apply((x) => { x.filter = k; }) })) },
    { label: 'Хромакей', sub: [
      { label: 'Убрать зелёный фон', on: c.chroma?.enabled && c.chroma.color === '#00FF00', action: () => key((k) => { k.enabled = true; k.color = '#00FF00'; }) },
      { label: 'Убрать синий фон', on: c.chroma?.enabled && c.chroma.color === '#0000FF', action: () => key((k) => { k.enabled = true; k.color = '#0000FF'; }) },
      { label: 'Определить цвет фона', action: () => { const col = keyColorOf(c.media); if (!col) return toast('Поставь курсор на этот клип и попробуй ещё раз'); key((k) => { k.enabled = true; k.color = col; }); } },
      c.chroma?.enabled ? { label: 'Выключить хромакей', action: () => key((k) => { k.enabled = false; }) } : null,
    ] },
    idx > 0 ? { label: 'Переход в этот клип', sub: ['none', 'flashburst', 'zoomburst', 'spinblur', 'swishleft', 'mirrorwarp', 'irisout', 'shakecut', 'card', 'circlecard', 'star',
      'fade', 'softzoom', 'lumafade', 'ink', 'glitch']
      .map((k) => ({ label: TRANSITIONS[k].label, on: (c.transition?.type || 'none') === k, action: () => setTransition(id, k) })) } : null,
    { label: 'Эффект здесь', sub: effectItems(t) },
    '-',
    { label: 'Свойства…', action: () => props() },
    { label: 'Удалить', hint: 'Del', danger: true, action: deleteSelection },
  ];
}

const effectItems = (t) => ['blurshake', 'zoompunch', 'stretchx', 'squash', 'pixelstretch', 'flash', 'tear', 'glitch', 'shake', 'rgb', 'motionblur', 'impact']
  .map((k) => ({ label: EFFECTS[k].label, action: () => addEffect(k, t) }));

function audioMenu(id) {
  const apply = (fn) => commit((p) => fn(p.audio.find((x) => x.id === id)));
  const a = S.project.audio.find((x) => x.id === id) || {};
  return [
    ...soundMenu(() => S.project.audio.find((x) => x.id === id), apply),
    { label: 'Ремикс', sub: Object.values(AUDIO_PRESETS).filter((pr) => pr.group === 'remix').map((pr) => ({ label: pr.label, on: a.remix === pr.set.remix && (a.speed || 1) === pr.set.speed,
      action: () => import('./inspector.js').then((m) => m.applyAudioPreset(id, pr)) })) },
    { label: 'Скорость и тон', sub: [
      ...Object.values(AUDIO_PRESETS).filter((pr) => !pr.group).map((pr) => ({ label: pr.label, action: () => { apply((x) => Object.assign(x, pr.set)); toast(`Музыка: ${pr.label}`, 'ok'); } })),
      '-',
      ...[0.5, 0.75, 1.25, 1.5, 2].map((v) => ({ label: `${v}× (тон тот же)`, on: (a.speed || 1) === v && a.keepPitch !== false, action: () => apply((x) => { x.speed = v; x.keepPitch = true; }) })),
      { label: 'Тонкая настройка…', action: () => props('insp-aspeed') },
    ] },
    '-',
    { label: 'Копия', action: duplicateSelection },
    { label: 'Удалить', hint: 'Del', danger: true, action: deleteSelection },
  ];
}

function textMenu(id) {
  const it = S.project.texts.find((x) => x.id === id);
  if (!it) return [];
  const apply = (fn) => commit((p) => { const x = p.texts.find((y) => y.id === id); if (x.track === 'subs') fn(p.subs); else fn(x); });
  return [
    { label: it.style?.chat ? 'Изменить сообщения' : 'Изменить текст', action: () => emit('focus-text') },
    it.style?.chat ? null : { label: it.track === 'subs' ? 'Стиль всех субтитров' : 'Стиль', sub: TEXT_STYLES.filter((s) => !s.style.chat).map((s) => ({ label: s.name, action: () => apply((x) => { Object.assign(x.style, s.style); }) })) },
    { label: 'Появление', sub: ['pop', 'fade', 'bounce', 'zoom', 'flicker', 'glitch', 'typing', 'words', 'none'].map((k) => ({ label: ANIMS_IN[k], on: (it.track === 'subs' ? S.project.subs.anim : it.anim)?.in === k, action: () => apply((x) => { x.anim = { ...x.anim, in: k }; }) })) },
    '-',
    it.track === 'subs' ? null : { label: 'Копия', action: duplicateSelection },
    { label: 'Свойства…', action: () => props() },
    { label: 'Удалить', hint: 'Del', danger: true, action: deleteSelection },
  ];
}

function effectMenu(id) {
  const e = S.project.effects.find((x) => x.id === id);
  if (!e) return [];
  return [
    { label: 'Сила', sub: [0.3, 0.6, 1].map((v) => ({ label: `${v * 100}%`, on: e.p?.amount === v, action: () => commit((p) => { const x = p.effects.find((y) => y.id === id); x.p = { ...x.p, amount: v }; }) })) },
    { label: 'Копия', action: duplicateSelection },
    { label: 'Свойства…', action: () => props() },
    { label: 'Удалить', hint: 'Del', danger: true, action: deleteSelection },
  ];
}

function adMenu(ad) {
  const a = S.project.ads;
  const setItem = (len) => commit((p) => { const it = p.ads.items.find((i) => i.id === ad?.item); if (it) it.trimOut = len ? +(ad.srcIn + len * (ad.speed || 1)).toFixed(2) : 0; p.ads.maxDur = 0; });
  const setSpeed = (s) => commit((p) => { const it = p.ads.items.find((i) => i.id === ad?.item); if (it) it.speed = s; });
  return [
    { label: 'Настройки рекламы…', action: () => { select('ad', ['ads']); props(); } },
    ad ? { label: 'Показать', action: () => (ad.insert ? peekAd(ad, 0.5) : seek(ad.start + 0.4)) } : null,
    ad ? { label: 'Длина этого ролика', sub: [[3, '3 с'], [5, '5 с'], [8, '8 с'], [0, 'Целиком']].map(([v, l]) => ({ label: l, action: () => setItem(v) })) } : null,
    ad && ad.kind !== 'image' ? { label: 'Скорость ролика', sub: [0.75, 1, 1.25, 1.5, 2, 3].map((v) => ({ label: `${v}×`, on: (ad.speed || 1) === v, action: () => setSpeed(v) })) } : null,
    { label: 'Видео на паузе во время рекламы', on: a.pause, action: () => commit((p) => { p.ads.pause = !p.ads.pause; }) },
    '-',
    { label: 'Выключить рекламу', danger: true, action: () => commit((p) => { p.ads.enabled = false; }) },
  ];
}

function emptyMenu(t) {
  const at = (fn) => () => { seek(t); fn(); };
  const chat = TEXT_STYLES.find((s) => s.style.chat);
  return [
    { label: 'Текст здесь', action: at(() => addText()) },
    chat ? { label: 'Переписка здесь', action: at(() => { addText(chat.style, chat.text); const id = S.sel.ids[0]; commit((p) => { const x = p.texts.find((y) => y.id === id); if (x) x.end = x.start + 4; }); }) } : null,
    { label: 'Эффект здесь', sub: effectItems(t) },
    { label: 'Граница части здесь', action: () => addCut(t) },
  ];
}

/** Выделить объект, если он ещё не выделен (меню действует на выделение). */
const ensureSel = (kind, id) => { if (!isSelected(kind, id)) select(kind, [id]); };

function menuFor(hit, t) {
  switch (hit?.type) {
    case 'clip': case 'trans': ensureSel('clip', hit.id); return clipMenu(hit.id, t);
    case 'audio': ensureSel('audio', hit.id); return audioMenu(hit.id);
    case 'text': ensureSel('text', hit.id); return textMenu(hit.id);
    case 'effect': ensureSel('effect', hit.id); return effectMenu(hit.id);
    case 'ad': select('ad', ['ads']); return adMenu(hit.ad);
    case 'header': select('header', [hit.id]); return [{ label: 'Свойства заголовка…', action: () => props() }, { label: 'Выключить заголовки', danger: true, action: deleteSelection }];
    default: return emptyMenu(t);
  }
}

document.getElementById('tl').addEventListener('contextmenu', (e) => {
  if (!S.project) return;
  e.preventDefault();
  const hit = hitAtClient(e.clientX, e.clientY);
  if (hit.type === 'ruler') return;
  openMenu(e.clientX, e.clientY, menuFor(hit, hit.t));
});

document.getElementById('preview-ui').addEventListener('contextmenu', (e) => {
  if (!S.project) return;
  e.preventDefault();
  const it = hitAt(e.clientX, e.clientY);
  if (!it) return;
  const type = { sub: 'text', text: 'text', overlay: 'overlay' }[it.kind] || it.kind;
  if (type === 'overlay') { select('overlay', [it.overlay]); return openMenu(e.clientX, e.clientY, [{ label: 'Свойства…', action: () => props() }, { label: 'Удалить', danger: true, action: deleteSelection }]); }
  openMenu(e.clientX, e.clientY, menuFor({ type, id: it.id, ad: type === 'ad' ? adPlacements().find((x) => x.id === it.id) : undefined }, S.t));
});
