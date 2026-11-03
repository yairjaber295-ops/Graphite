// Битмейкер: большое окно-студия. Каналы ударных (сила удара, громкость, панорама, высота, длина, свои сэмплы, M/S)
// и мелодические дорожки с пианороллом (аккорды, длина нот перетаскиванием, клавиатура компа как пианино).
// Готовый бит встаёт на таймлайн как обычный звук; «Изменить бит» у дорожки открывает его снова.
import { S, commit, uid, select, duration, snapFrame, emit } from './store.js';
import { h, seg, toast, fill, modal } from './ui.js';
import { loadMedia } from './mediastate.js';
import { audioCtx, decoded } from './preview.js';
import { pickFiles } from './backend/server.js';
import {
  SOUNDS, INSTRUMENTS, SCALES, NOTE_NAMES, BEAT_PRESETS, STEPS, MAX_BARS, emptyPattern, presetPattern, resizePattern, transpose,
  migrate, channel, synth, noteName, inScale, rollBase, renderPattern, cycleDur, stepDur, toWav, playHit, playNote, soundBuffer, bufferKey,
} from './engine/beatmaker.js';

let pat = null;          // паттерн в редакторе (живёт, пока открыт проект)
let editing = null;      // id дорожки-бита, если правим уже вставленный
let presetName = '';
let repeats = 8;
let loop = null;         // { src, t0, cyc }

const cur = () => (pat ||= presetPattern('trap', { bars: 2, key: 9 }));

/** Свои сэмплы каналов → декодированные буферы. */
async function samplesOf(p) {
  const out = {};
  for (const c of p.channels) if (c.sample && !out[c.sample]) out[c.sample] = await decoded(c.sample);
  return out;
}

// --- прослушивание по кругу
async function startLoop(onTick) {
  const ctx = audioCtx();
  if (ctx.state === 'suspended') await ctx.resume();
  const p = cur();
  const buf = await renderPattern(p, 1, await samplesOf(p));
  const cyc = cycleDur(p);
  const phase = loop ? ((ctx.currentTime - loop.t0) % loop.cyc) / loop.cyc : 0;
  try { loop?.src.stop(); } catch { /* уже */ }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true; src.loopStart = 0; src.loopEnd = cyc;
  src.connect(ctx.destination);
  src.start(0, phase * cyc);
  loop = { src, t0: ctx.currentTime - phase * cyc, cyc, onTick };
  requestAnimationFrame(tick);
}
function stopLoop() { try { loop?.src.stop(); } catch { /* уже */ } loop = null; }
function tick() {
  if (!loop) return;
  loop.onTick?.(curStep());
  requestAnimationFrame(tick);
}
const curStep = () => (loop ? Math.floor(((audioCtx().currentTime - loop.t0) % loop.cyc) / stepDur(cur())) : -1);
let rerender = 0;
const changed = () => { if (loop) { clearTimeout(rerender); rerender = setTimeout(() => loop && startLoop(loop.onTick), 90); } };
export function stopBeatPreview() { stopLoop(); }
/** Бит в редакторе (для проверок и отладки). */
export const currentPattern = () => pat;

// --- предпрослушка звука и ноты
const shotCache = {};
async function audition(c) {
  const ctx = audioCtx();
  if (ctx.state === 'suspended') await ctx.resume();
  const buf = c.sample ? await decoded(c.sample) : (shotCache[c.sound] ||= await soundBuffer(c.sound));
  if (buf) playHit(ctx, ctx.destination, buf, ctx.currentTime, { vel: c.vol ?? 0.9, pitch: c.pitch || 0, decay: c.decay ?? 1 });
}
async function auditionNote(s, note) {
  const ctx = audioCtx();
  if (ctx.state === 'suspended') await ctx.resume();
  const g = ctx.createGain(); g.gain.value = s.vol ?? 0.75; g.connect(ctx.destination);
  playNote(ctx, g, s.inst, ctx.currentTime, s.inst === 'pad' ? 0.6 : 0.3, note, 1, s.inst === '808' ? (shotCache.sub808 ||= await soundBuffer('sub808')) : null);
}

/** Открыть битмейкер с битом дорожки (кнопка «Изменить бит» в свойствах). */
export function editBeat(id) {
  const a = S.project.audio.find((x) => x.id === id);
  if (!a?.pattern) return;
  pat = migrate(structuredClone(a.pattern));
  editing = id;
  openStudio();
}

// --- в проект
async function insert(btn) {
  const p = cur();
  const cyc = cycleDur(p);
  const n = repeats === 0 ? Math.max(1, Math.round(Math.max(cyc, duration()) / cyc)) : repeats;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Собираю бит…';
  try {
    const buf = await renderPattern(p, n, await samplesOf(p));
    const name = `Бит ${presetName} ${p.bpm} BPM`.replace(/\s+/g, ' ').trim();
    const m = await S.backend.uploadMedia(S.project.id, new File([toWav(buf)], `${name}.wav`, { type: 'audio/wav' }));
    const old = editing && S.project.audio.find((x) => x.id === editing);
    const bar = 4 * 60 / p.bpm;
    const start = old ? old.start : snapFrame(S.project.audio.length ? Math.round(S.t / bar) * bar : 0);
    const id = old ? old.id : uid();
    commit((q) => {
      q.media.push(m);
      if (!q.bpm) q.bpm = p.bpm;
      const item = { id, media: m.id, kind: 'beat', start, in: 0, out: m.duration || buf.duration, volume: 1, fadeIn: 0, fadeOut: 0,
        pattern: structuredClone(p), repeats: n };
      const i = q.audio.findIndex((x) => x.id === id);
      if (i >= 0) q.audio[i] = { ...q.audio[i], ...item }; else q.audio.push(item);
    });
    loadMedia(m.id);
    editing = id;
    select('audio', [id]);
    toast(old ? 'Бит обновлён на таймлайне' : `Бит на таймлайне: ${n} × ${p.bars} такт.`, 'ok');
  } catch (e) {
    toast('Бит: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = editing ? 'Обновить на таймлайне' : label;
  }
}

// ---------------------------------------------------------------------------
//   Вкладка «Бит» в панели: вход в студию + биты проекта
// ---------------------------------------------------------------------------
export function beatTab() {
  const beats = S.project.audio.filter((a) => a.kind === 'beat');
  return h('div', {},
    h('div', { class: 'section' },
      h('button', { class: 'btn primary wide big', onclick: () => { editing = null; openStudio(); } }, h('span', { 'data-icon': 'beat' }), 'Открыть битмейкер'),
      h('div', { class: 'note' }, 'Каналы ударных, свои сэмплы, пианоролл с аккордами, 6 инструментов, сайдчейн. Клавиатура компа — как пианино.')),
    h('h3', {}, 'Начать с жанра'),
    h('div', { class: 'chips' }, ...Object.entries(BEAT_PRESETS).map(([k, pr]) => h('button', { class: 'chip-btn', onclick: () => {
      pat = presetPattern(k, { bars: 2, key: cur().key }); presetName = pr.label; editing = null; openStudio();
    } }, pr.label))),
    h('h3', {}, `Биты в проекте · ${beats.length}`),
    beats.length ? beats.map((a) => h('div', { class: 'media-item track-item', onclick: () => editBeat(a.id) },
      h('div', { class: 'mi-thumb track-kind k-beat' }, 'Б'),
      h('div', { class: 'mi-info' }, h('div', { class: 'mi-name' }, S.project.media.find((m) => m.id === a.media)?.name.replace(/\.[^.]+$/, '') || 'Бит'),
        h('div', { class: 'mi-meta' }, `${a.pattern?.bpm || '?'} BPM · ${a.pattern?.bars || '?'} такт. × ${a.repeats || 1}`)),
      h('button', { class: 'btn' }, 'Изменить'))) : h('div', { class: 'note' }, 'Пока нет — открой битмейкер.'));
}

// ---------------------------------------------------------------------------
//   Студия
// ---------------------------------------------------------------------------
let rollSel = 0;   // выбранная мелодическая дорожка
let lastLen = 2;   // длина новой ноты (в шагах)

export function openStudio() {
  const p = cur();
  modal((box, close) => {
    box.classList.add('studio');
    box.dataset.locked = '1';   // случайный клик мимо не закрывает
    const head = h('div', { class: 'st-head' });
    const rack = h('div', { class: 'st-rack' });
    const rollBox = h('div', { class: 'st-roll' });
    const foot = h('div', { class: 'st-foot' });
    fill(box, head, h('div', { class: 'st-body' }, rack, rollBox), foot);
    const shut = () => { stopLoop(); window.removeEventListener('keydown', keys, true); window.removeEventListener('keyup', keysUp, true); close(); import('./panels.js').then((m) => m.render()); };

    const onTick = (i) => {
      box.querySelectorAll('.st-cell.now').forEach((c) => c.classList.remove('now'));
      box.querySelectorAll(`.st-cell[data-i="${i}"]`).forEach((c) => c.classList.add('now'));
      roll.playhead(i);
    };

    const togglePlay = async () => { if (loop) stopLoop(); else await startLoop(onTick); drawHead(); };
    const drawHead = () => fill(head,
      h('b', { class: 'st-title' }, 'Битмейкер'),
      h('button', { class: 'btn primary st-play', title: 'Пробел', onclick: togglePlay }, loop ? '■ Стоп' : '▶ Слушать'),
      h('label', { class: 'st-f' }, 'BPM', h('input', { type: 'number', min: 50, max: 220, value: p.bpm, onchange: (e) => { p.bpm = Math.max(50, Math.min(220, Math.round(+e.target.value || 140))); changed(); } })),
      h('label', { class: 'st-f' }, 'Такты', h('select', { onchange: (e) => { Object.assign(p, resizePattern(p, +e.target.value)); changed(); drawAll(); } },
        ...[1, 2, 4, 8].filter((b) => b <= MAX_BARS).map((b) => h('option', { value: b, selected: b === p.bars }, b)))),
      h('label', { class: 'st-f' }, 'Тональность', h('select', { onchange: (e) => { Object.assign(p, transpose(p, +e.target.value)); changed(); drawAll(); } },
        ...NOTE_NAMES.map((nm, i) => h('option', { value: i, selected: i === p.key }, nm)))),
      h('label', { class: 'st-f' }, 'Лад', h('select', { onchange: (e) => { p.scale = e.target.value; roll.draw(); } },
        ...Object.entries(SCALES).map(([k, sc]) => h('option', { value: k, selected: k === p.scale }, sc.label)))),
      h('label', { class: 'st-f' }, 'Свинг', h('input', { type: 'range', min: 0, max: 0.6, step: 0.05, value: p.swing || 0, oninput: (e) => { p.swing = +e.target.value; changed(); } })),
      h('label', { class: 'st-f', title: 'Мелодия приглушается на каждой бочке — «качает» (хаус, трэп, хардтек)' }, 'Сайдчейн',
        h('input', { type: 'range', min: 0, max: 0.9, step: 0.05, value: p.sidechain || 0, oninput: (e) => { p.sidechain = +e.target.value; changed(); } })),
      h('label', { class: 'st-f' }, 'Жанр', h('select', { onchange: (e) => {
        if (!e.target.value) return;
        Object.assign(p, presetPattern(e.target.value, p)); presetName = BEAT_PRESETS[e.target.value].label; rollSel = 0; changed(); drawAll();
      } }, h('option', { value: '' }, '— пресет —'), ...Object.entries(BEAT_PRESETS).map(([k, pr]) => h('option', { value: k }, `${pr.label} · ${pr.bpm}`)))),
      h('div', { class: 'spacer' }),
      h('button', { class: 'icon-btn st-x', title: 'Закрыть (бит остаётся в редакторе)', onclick: shut }, '✕'));

    // --- каналы ударных
    const drawRack = () => {
      const n = p.bars * STEPS;
      const rows = p.channels.map((c, ci) => {
        const cells = Array.from({ length: n }, (_, i) => {
          const v = c.steps[i] || 0;
          const cell = h('button', { class: `st-cell${v ? ' on' : ''}${i % 4 === 0 ? ' beat' : ''}${i % STEPS === 0 ? ' bar' : ''}`, 'data-i': i,
            style: v ? { opacity: 0.35 + 0.65 * v } : null, title: 'Клик — удар; правый клик/Shift — сила (100 → 60 → 30%)' });
          const cycle = () => { c.steps[i] = !v ? 0.6 : v > 0.8 ? 0.6 : v > 0.45 ? 0.3 : 1; };
          cell.addEventListener('click', (e) => { if (e.shiftKey && v) cycle(); else c.steps[i] = v ? 0 : 1; changed(); drawRack(); if (!v) audition(c); });
          cell.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!v) c.steps[i] = 1; else cycle(); changed(); drawRack(); });
          return cell;
        });
        return h('div', { class: 'st-row' + (c.mute ? ' muted' : '') },
          h('div', { class: 'st-chan' },
            h('button', { class: 'st-ms' + (c.mute ? ' on' : ''), title: 'Выключить (M)', onclick: () => { c.mute = !c.mute; changed(); drawRack(); } }, 'M'),
            h('button', { class: 'st-ms s' + (c.solo ? ' on' : ''), title: 'Только этот (S)', onclick: () => { c.solo = !c.solo; changed(); drawRack(); } }, 'S'),
            h('button', { class: 'st-name', title: 'Настройки канала', onclick: (e) => chanMenu(e.currentTarget, c, ci) }, c.name)),
          h('div', { class: 'st-cells' }, ...cells));
      });
      fill(rack, h('div', { class: 'st-scroll' }, ...rows),
        h('div', { class: 'st-add' },
          h('select', { onchange: (e) => { const k = e.target.value; e.target.value = ''; if (!k) return; addChannel(k); } },
            h('option', { value: '' }, '+ Канал'), ...Object.entries(SOUNDS).map(([k, l]) => h('option', { value: k }, l)), h('option', { value: '__sample' }, 'Свой сэмпл (wav, mp3)…'))));
    };
    const addChannel = async (k) => {
      if (k !== '__sample') { p.channels.push(channel(k, { steps: Array(p.bars * STEPS).fill(0) })); drawRack(); return; }
      const [f] = await pickFiles('audio', false);
      if (!f) return;
      try {
        toast('Загружаю сэмпл…');
        const m = await S.backend.uploadMedia(S.project.id, f);
        commit((q) => { q.media.push(m); });   // сэмпл хранится в проекте
        loadMedia(m.id);
        const c = channel('sample', { name: f.name.replace(/\.[^.]+$/, '').slice(0, 24), sample: m.id, steps: Array(p.bars * STEPS).fill(0) });
        p.channels.push(c);
        drawRack();
        audition(c);
      } catch (e) { toast('Сэмпл: ' + e.message, 'err'); }
    };
    const chanMenu = (anchor, c, ci) => {
      box.querySelector('.st-pop')?.remove();
      const r = anchor.getBoundingClientRect(), br = box.getBoundingClientRect();
      const rng = (label, k, min, max, step, fmt) => h('label', { class: 'st-prow' }, h('span', {}, label),
        h('input', { type: 'range', min, max, step, value: c[k], oninput: (e) => { c[k] = +e.target.value; e.target.nextSibling.textContent = fmt(c[k]); changed(); } }),
        h('em', {}, fmt(c[k])));
      const pop = h('div', { class: 'st-pop', style: { left: `${r.left - br.left}px`, top: `${r.bottom - br.top + 4}px` } },
        h('label', { class: 'st-prow' }, h('span', {}, 'Звук'), h('select', { onchange: (e) => { c.sound = e.target.value; c.sample = null; c.name = SOUNDS[c.sound]; changed(); drawRack(); audition(c); } },
          ...(c.sample ? [h('option', { value: 'sample', selected: true }, `Сэмпл: ${c.name}`)] : []),
          ...Object.entries(SOUNDS).map(([k, l]) => h('option', { value: k, selected: !c.sample && k === c.sound }, l)))),
        rng('Громкость', 'vol', 0, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`),
        rng('Панорама', 'pan', -1, 1, 0.05, (v) => (Math.abs(v) < 0.03 ? 'центр' : v < 0 ? `Л ${Math.round(-v * 100)}` : `П ${Math.round(v * 100)}`)),
        rng('Высота', 'pitch', -12, 12, 1, (v) => `${v > 0 ? '+' : ''}${v} пт`),
        rng('Длина', 'decay', 0.1, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
        h('div', { class: 'st-prow' },
          h('button', { class: 'btn', onclick: () => audition(c) }, '▶ Прослушать'),
          h('button', { class: 'btn', onclick: () => { c.steps = c.steps.map(() => 0); changed(); drawRack(); } }, 'Очистить'),
          h('button', { class: 'btn danger', onclick: () => { p.channels.splice(ci, 1); pop.remove(); changed(); drawRack(); } }, 'Удалить')));
      box.append(pop);
      const off = (ev) => { if (!pop.contains(ev.target) && ev.target !== anchor) { pop.remove(); document.removeEventListener('pointerdown', off, true); } };
      setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
    };

    // --- мелодические дорожки + пианоролл
    // счётчик нот на вкладках — после каждой правки в пианоролле
    const refreshTabs = () => rollBox.querySelectorAll('.st-tab').forEach((b, i) => { const x = p.synths[i]; if (x) b.textContent = `${x.name}${x.notes.length ? ` · ${x.notes.length}` : ''}`; });
    const roll = pianoRoll(p, () => p.synths[rollSel], () => { changed(); refreshTabs(); });
    const drawRollBox = () => {
      if (rollSel >= p.synths.length) rollSel = Math.max(0, p.synths.length - 1);
      const s = p.synths[rollSel];
      fill(rollBox,
        h('div', { class: 'st-tracks' },
          ...p.synths.map((x, i) => h('button', { class: 'st-tab' + (i === rollSel ? ' on' : '') + (x.mute ? ' muted' : ''), onclick: () => { rollSel = i; drawRollBox(); } },
            `${x.name}${x.notes.length ? ` · ${x.notes.length}` : ''}`)),
          h('select', { class: 'st-addinst', onchange: (e) => { const k = e.target.value; e.target.value = ''; if (!k) return; p.synths.push(synth(k)); rollSel = p.synths.length - 1; drawRollBox(); } },
            h('option', { value: '' }, '+ Инструмент'), ...Object.entries(INSTRUMENTS).map(([k, l]) => h('option', { value: k }, l)))),
        s ? h('div', { class: 'st-tctl' },
          h('select', { onchange: (e) => { s.inst = e.target.value; s.name = INSTRUMENTS[s.inst]; changed(); drawRollBox(); } },
            ...Object.entries(INSTRUMENTS).map(([k, l]) => h('option', { value: k, selected: k === s.inst }, l))),
          h('button', { class: 'st-ms' + (s.mute ? ' on' : ''), onclick: () => { s.mute = !s.mute; changed(); drawRollBox(); } }, 'M'),
          h('button', { class: 'st-ms s' + (s.solo ? ' on' : ''), onclick: () => { s.solo = !s.solo; changed(); drawRollBox(); } }, 'S'),
          h('label', { class: 'st-f' }, 'Громк.', h('input', { type: 'range', min: 0, max: 1.5, step: 0.05, value: s.vol, oninput: (e) => { s.vol = +e.target.value; changed(); } })),
          h('label', { class: 'st-f' }, 'Пан.', h('input', { type: 'range', min: -1, max: 1, step: 0.05, value: s.pan || 0, oninput: (e) => { s.pan = +e.target.value; changed(); } })),
          h('label', { class: 'st-f' }, 'Длина ноты', h('select', { onchange: (e) => { lastLen = +e.target.value; } },
            ...[[1, '1/16'], [2, '1/8'], [4, '1/4'], [8, '1/2'], [16, 'такт']].map(([v, l]) => h('option', { value: v, selected: v === lastLen }, l)))),
          h('button', { class: 'btn', title: 'Октава ниже', onclick: () => roll.octave(-1) }, '▼ окт'),
          h('button', { class: 'btn', title: 'Октава выше', onclick: () => roll.octave(1) }, '▲ окт'),
          h('button', { class: 'btn', onclick: () => { s.notes = []; changed(); drawRollBox(); } }, 'Очистить'),
          h('button', { class: 'btn danger', onclick: () => { p.synths.splice(rollSel, 1); changed(); drawRollBox(); } }, 'Удалить')) : h('div', { class: 'note' }, 'Добавь инструмент — «+ Инструмент».'),
        s ? roll.el : null,
        s ? h('div', { class: 'note' }, 'Клик — нота, тяни вправо — длина, тяни ноту — сдвинуть, правый клик — удалить. Клавиши Z S X D C V G B H N J M (и Q 2 W 3 E…) — пианино; во время «Слушать» ноты записываются.') : null);
      if (s) roll.draw();
    };

    const drawFoot = () => fill(foot,
      editing ? h('span', { class: 'note' }, 'Правишь бит с таймлайна. ', h('button', { class: 'link', onclick: () => { editing = null; drawFoot(); } }, 'Сделать новым')) : h('span', { class: 'note' }, 'Повторить на таймлайне:'),
      editing ? null : seg({ 4: '×4', 8: '×8', 16: '×16', 0: 'На всю длину' }, String(repeats), (v) => { repeats = +v; }),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => { const { bars, key, scale, bpm } = p; Object.assign(p, resizePattern({ ...emptyPattern(bpm), key, scale }, bars)); rollSel = 0; changed(); drawAll(); } }, 'Новый пустой'),
      h('button', { class: 'btn primary', onclick: (e) => insert(e.currentTarget) }, editing ? 'Обновить на таймлайне' : 'Вставить на таймлайн'));

    const drawAll = () => { drawHead(); drawRack(); drawRollBox(); drawFoot(); };
    drawAll();

    // клавиатура: пробел — слушать; две строки клавиш — пианино для выбранного инструмента
    const KEYMAP = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24 };
    const RU = { я: 'z', ы: 's', ч: 'x', в: 'd', с: 'c', м: 'v', п: 'g', и: 'b', р: 'h', т: 'n', о: 'j', ь: 'm', й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i' };
    const held = new Set();
    function keys(e) {
      if (!box.isConnected) return;
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range') return;
      if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); togglePlay(); return; }
      if (e.key === 'Escape') { e.stopPropagation(); shut(); return; }
      const k = RU[e.key.toLowerCase()] || e.key.toLowerCase();
      const off = KEYMAP[k];
      const s = p.synths[rollSel];
      if (off == null || !s || e.ctrlKey || e.metaKey || held.has(k)) return;
      e.preventDefault(); e.stopPropagation();
      held.add(k);
      const note = roll.base() + off;
      auditionNote(s, note);
      if (loop) {   // запись на ходу — в ближайший шаг
        const i = curStep();
        s.notes = s.notes.filter((x) => !(x.s === i && x.n === note));
        s.notes.push({ s: i, n: note, l: lastLen, v: 1 });
        changed(); roll.draw();
      }
    }
    function keysUp(e) { held.delete(RU[e.key.toLowerCase()] || e.key.toLowerCase()); }
    window.addEventListener('keydown', keys, true);
    window.addEventListener('keyup', keysUp, true);
  });
}

/** Пианоролл на холсте: 2 октавы по полутонам, подсветка лада, ноты любой длины, аккорды. */
function pianoRoll(p, get, changed) {
  const ROWS = 24, RH = 15, KW = 46;
  const wrap = h('div', { class: 'st-pr' });
  const cv = h('canvas');
  wrap.append(cv);
  const view = {};   // id дорожки → сдвиг октав
  let head = -1;
  const base = () => { const s = get(); return rollBase(p, s.inst) + 12 * (view[s.id] || 0); };
  const cellW = () => Math.max(14, Math.floor((wrap.clientWidth - KW - 2) / (p.bars * STEPS)) || 18);
  function draw() {
    const s = get();
    if (!s) return;
    const n = p.bars * STEPS, cw = cellW(), W = KW + n * cw, H = ROWS * RH;
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#7c5cff';
    const b0 = base();
    for (let r = 0; r < ROWS; r++) {
      const note = b0 + ROWS - 1 - r, y = r * RH, black = [1, 3, 6, 8, 10].includes(((note % 12) + 12) % 12);
      g.fillStyle = inScale(p, note) ? (note % 12 === (p.key % 12 + 12) % 12 ? 'rgba(255,255,255,.085)' : 'rgba(255,255,255,.045)') : 'rgba(0,0,0,.25)';
      g.fillRect(KW, y, n * cw, RH - 1);
      g.fillStyle = black ? '#1c1c22' : '#e9e9ee';
      g.fillRect(0, y, KW - 4, RH - 1);
      g.fillStyle = black ? '#aaa' : '#333';
      g.font = '600 9px Onest, sans-serif';
      g.textBaseline = 'middle';
      if (!black || note % 12 === p.key % 12) g.fillText(noteName(note), 4, y + RH / 2);
    }
    for (let i = 0; i <= n; i++) {
      g.fillStyle = i % STEPS === 0 ? 'rgba(255,255,255,.28)' : i % 4 === 0 ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.04)';
      g.fillRect(KW + i * cw, 0, 1, H);
    }
    for (const nt of s.notes) {
      const r = b0 + ROWS - 1 - nt.n;
      if (r < 0 || r >= ROWS) continue;
      const x = KW + nt.s * cw, y = r * RH, w = Math.max(4, nt.l * cw - 2);
      g.fillStyle = accent;
      g.globalAlpha = 0.55 + 0.45 * (nt.v ?? 1);
      g.fillRect(x + 1, y + 1, w, RH - 3);
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.fillRect(x + w - 2, y + 3, 2, RH - 7);   // край для растягивания
    }
    if (head >= 0) { g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(KW + head * cw, 0, 2, H); }
    // ноты вне видимых октав — подсказка
    const below = s.notes.some((nt) => nt.n < b0), above = s.notes.some((nt) => nt.n > b0 + ROWS - 1);
    g.fillStyle = accent;
    if (above) g.fillText('▲ ноты выше', KW + 6, 8);
    if (below) g.fillText('▼ ноты ниже', KW + 6, H - 8);
  }
  const at = (e) => {
    // по фактическому размеру холста (не по текущей ширине панели — она могла поменяться после отрисовки)
    const r = cv.getBoundingClientRect(), cw = (r.width - KW) / (p.bars * STEPS);
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, step: Math.floor((x - KW) / cw), note: base() + ROWS - 1 - Math.floor(y / RH), cw };
  };
  let drag = null;
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    const s = get(); if (!s) return;
    const { x, step, note, cw } = at(e);
    if (x < KW) { auditionNote(s, note); return; }
    const n = p.bars * STEPS;
    if (step < 0 || step >= n) return;
    const hit = s.notes.find((nt) => nt.n === note && step >= nt.s && step < nt.s + nt.l);
    if (e.button === 2) { if (hit) { s.notes = s.notes.filter((nt) => nt !== hit); changed(); draw(); } return; }
    try { cv.setPointerCapture(e.pointerId); } catch { /* перо/эмуляция — без захвата */ }
    if (hit) {
      const edge = x > KW + (hit.s + hit.l) * cw - 7;
      drag = { mode: edge ? 'len' : 'move', nt: hit, s0: step, n0: note, from: { s: hit.s, n: hit.n, l: hit.l }, moved: false };
    } else {
      const nt = { s: step, n: note, l: Math.min(lastLen, n - step), v: 1 };
      s.notes.push(nt);
      auditionNote(s, note);
      drag = { mode: 'len', nt, s0: step, n0: note, from: { ...nt }, moved: true, created: true };
      changed(); draw();
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { step, note } = at(e);
    const n = p.bars * STEPS, d = drag;
    if (step !== d.s0 || note !== d.n0) d.moved = true;
    if (d.mode === 'len') d.nt.l = Math.max(1, Math.min(n - d.nt.s, step - d.nt.s + 1));
    else {
      const ns = Math.max(0, Math.min(n - d.nt.l, d.from.s + step - d.s0)), nn = d.from.n + note - d.n0;
      if (nn !== d.nt.n) auditionNote(get(), nn);
      d.nt.s = ns; d.nt.n = nn;
    }
    draw();
  });
  cv.addEventListener('pointerup', () => {
    if (!drag) return;
    const s = get();
    if (!drag.moved && !drag.created && drag.mode === 'move') s.notes = s.notes.filter((nt) => nt !== drag.nt);   // клик по ноте — удалить
    else if (drag.mode === 'len') lastLen = drag.nt.l;
    drag = null;
    changed(); draw();
  });
  new ResizeObserver(() => draw()).observe(wrap);
  return {
    el: wrap, draw,
    base,
    octave: (d) => { const s = get(); view[s.id] = Math.max(-3, Math.min(3, (view[s.id] || 0) + d)); draw(); },
    playhead: (i) => { if (i !== head) { head = i; draw(); } },
  };
}
