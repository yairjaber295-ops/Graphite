// Режим «Музыка»: вкладка «Треки» (песни, запись голоса, темп проекта) и инструменты мешапа —
// подгонка темпа трека под проект, убрать/оставить вокал.
import { S, commit, uid, select, fmtTime, duration, emit } from './store.js';
import { h, toast, seg } from './ui.js';
import { loadMedia } from './mediastate.js';
import { audioLen, audioTlOf } from './engine/audioproc.js';
import { detectBeats } from './auto.js';
import { play, stopPlayback, seek, audioCtx, click } from './preview.js';

const KIND = { music: 'Трек', beat: 'Бит', voice: 'Голос', sfx: 'Звук' };
let rec = null;   // { mr, stream, t0, start, timer }

/** Темп трека (найденный по битам) с учётом его скорости. */
export function trackBpm(a) {
  const bt = S.project.beats?.[a.media];
  if (a.kind === 'beat' && a.pattern) return a.pattern.bpm;
  return bt?.bpm ? bt.bpm * (a.speed || 1) : null;
}

/** Подогнать темп трека под проект: скорость без смены тона (тон — отдельно, «Тон» в свойствах). */
export async function syncTrack(id, quiet = false) {
  const a = S.project.audio.find((x) => x.id === id);
  if (!a) return;
  if (!S.project.bpm) return toast('Сначала задай темп проекта (BPM) во вкладке «Треки»');
  let bt = S.project.beats?.[a.media];
  if (!bt?.bpm) {
    if (!quiet) toast('Ищу темп трека…');
    try { bt = await detectBeats(a.media); } catch (e) { return toast('Не нашёл темп: ' + e.message, 'err'); }
  }
  // темп может найтись вдвое меньше/больше — берём ближайший к темпу проекта
  let src = bt.bpm;
  while (src * 1.5 < S.project.bpm) src *= 2;
  while (src / 1.5 > S.project.bpm) src /= 2;
  const speed = +(S.project.bpm / src).toFixed(4);
  if (speed < 0.5 || speed > 2) return toast(`Темп трека ${Math.round(bt.bpm)} BPM слишком далёк от ${S.project.bpm} — подгонять не буду`, 'err');
  commit((p) => Object.assign(p.audio.find((x) => x.id === id), { speed, keepPitch: true }));
  if (!quiet) toast(`Трек: ${Math.round(src)} → ${S.project.bpm} BPM (скорость ×${speed.toFixed(2)}, тон тот же)`, 'ok');
}

/** Сдвинуть трек так, чтобы его сильная доля легла на ближайший такт сетки проекта. */
export async function alignTrack(id) {
  const a = S.project.audio.find((x) => x.id === id);
  if (!a || !S.project.bpm) return toast('Сначала задай темп проекта');
  let bt = S.project.beats?.[a.media];
  if (!bt?.beats?.length) { try { bt = await detectBeats(a.media); } catch (e) { return toast(e.message, 'err'); } }
  const src = (bt.strong?.length ? bt.strong : bt.beats).find((b) => b >= a.in) ?? bt.beats[0];
  const t = audioTlOf(a, src);                         // где эта доля сейчас на таймлайне
  const bar = 4 * 60 / S.project.bpm;
  const target = Math.round(t / bar) * bar;
  const shift = target - t;
  if (a.start + shift < 0 && a.start + shift + bar >= 0) commit((p) => { p.audio.find((x) => x.id === id).start = +(a.start + shift + bar).toFixed(4); });
  else commit((p) => { p.audio.find((x) => x.id === id).start = +Math.max(0, a.start + shift).toFixed(4); });
  toast(`Трек сдвинут на ${(shift * 1000).toFixed(0)} мс — сильная доля на такте`, 'ok');
}

async function findProjectBpm(redraw) {
  const a = S.project.audio.find((x) => x.kind === 'music') || S.project.audio[0];
  if (!a) return toast('Добавь трек — темп найдётся по нему');
  toast('Ищу темп…');
  try {
    const bt = await detectBeats(a.media);
    commit((p) => { p.bpm = Math.round(bt.bpm * (a.speed || 1)); });
    toast(`Темп проекта: ${S.project.bpm} BPM`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
  redraw();
}

// --- запись голоса: проект играет с курсора, микрофон пишет поверх
async function toggleRecord(redraw) {
  if (rec) { rec.mr.stop(); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } });
  } catch (e) {
    return toast('Нет доступа к микрофону: ' + (e.message || e.name), 'err');
  }
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const start = S.t;
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = async () => {
    clearInterval(rec?.timer);
    stream.getTracks().forEach((t) => t.stop());
    stopPlayback();
    rec = null;
    redraw();
    const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
    if (blob.size < 2000) return toast('Запись слишком короткая');
    const ext = /mp4/.test(blob.type) ? 'm4a' : 'webm';
    const stamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/:/g, '-');
    try {
      toast('Сохраняю запись…');
      const m = await S.backend.uploadMedia(S.project.id, new File([blob], `Голос ${stamp}.${ext}`, { type: blob.type }));
      const id = uid();
      commit((p) => {
        p.media.push(m);
        p.audio.push({ id, media: m.id, kind: 'voice', start, in: 0, out: m.duration, volume: 1, fadeIn: 0, fadeOut: 0.05 });
      });
      loadMedia(m.id);
      select('audio', [id]);
      seek(start);
      toast('Голос записан — на отдельной дорожке', 'ok');
    } catch (e) { toast('Запись: ' + e.message, 'err'); }
  };
  // отсчёт: такт щелчков по темпу проекта, потом запись и проект с курсора
  if (S.project.bpm) {
    const ctx = audioCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const beat = 60 / S.project.bpm;
    for (let i = 0; i < 4; i++) click(ctx, ctx.currentTime + 0.05 + i * beat, i === 0);
    toast('Отсчёт: 4 щелчка — потом запись');
    await new Promise((r) => setTimeout(r, (0.05 + 4 * beat) * 1000));
  }
  mr.start(250);
  rec = { mr, stream, t0: Date.now(), timer: setInterval(redraw, 500) };
  if (duration() > 0) play();   // поём поверх бита/трека
  redraw();
}

export function tracksTab() {
  const box = h('div', {});
  const draw = () => {
    const p = S.project;
    const list = [...p.audio].sort((a, b) => a.start - b.start);
    box.replaceChildren(
      h('div', { class: 'section' },
        h('button', { class: 'btn primary wide big', onclick: () => import('./panels.js').then((m) => m.importMedia('audio')).catch((e) => toast(e.message, 'err')) },
          h('span', { 'data-icon': 'music' }), 'Добавить трек'),
        h('button', { class: 'btn wide big rec-btn' + (rec ? ' on' : ''), onclick: () => toggleRecord(draw) },
          rec ? `■ Остановить запись · ${fmtTime((Date.now() - rec.t0) / 1000, false)}` : '🎙 Записать голос'),
        h('div', { class: 'note' }, rec ? 'Идёт запись… Проект играет с курсора — пой/читай поверх. Лучше в наушниках.'
          : 'mp3, wav, m4a, flac. Запись голоса встаёт отдельной дорожкой с позиции курсора.')),
      h('h3', {}, 'Темп проекта'),
      h('div', { class: 'row bpm-row' },
        h('input', { type: 'number', min: 50, max: 220, value: p.bpm || '', placeholder: 'BPM',
          onchange: (e) => { const v = Math.round(+e.target.value); commit((q) => { q.bpm = v >= 50 && v <= 220 ? v : null; }); draw(); } }),
        h('button', { class: 'btn', onclick: () => findProjectBpm(draw) }, 'Найти по треку'),
        h('button', { class: 'btn', disabled: !p.bpm, onclick: async () => {
          for (const a of p.audio.filter((x) => x.kind === 'music')) await syncTrack(a.id, true);
          toast(`Все треки — в ${p.bpm} BPM`, 'ok'); draw();
        } }, 'Подогнать все')),
      h('div', { class: 'note' }, 'Темп проекта — сетка тактов на таймлайне (к ней всё прилипает), темп нового бита и цель для «Подогнать» — так сводятся мешапы.'),
      h('h3', {}, `Дорожки · ${list.length}`),
      ...list.map((a) => {
        const m = p.media.find((x) => x.id === a.media);
        const bpm = trackBpm(a);
        return h('div', { class: 'media-item track-item' + (S.sel.kind === 'audio' && S.sel.ids.includes(a.id) ? ' sel' : ''),
          onclick: () => { select('audio', [a.id]); seek(a.start); emit('open-inspector'); } },
          h('div', { class: 'mi-thumb track-kind k-' + a.kind }, (KIND[a.kind] || 'Звук')[0]),
          h('div', { class: 'mi-info' },
            h('div', { class: 'mi-name' }, (m?.name || 'звук').replace(/\.[^.]+$/, '')),
            h('div', { class: 'mi-meta' }, [KIND[a.kind] || 'Звук', fmtTime(audioLen(a), false), bpm ? `${Math.round(bpm)} BPM` : null,
              (a.speed || 1) !== 1 ? `×${(+a.speed).toFixed(2)}` : null, a.pitch ? `${a.pitch > 0 ? '+' : ''}${a.pitch} пт` : null,
              a.afx?.vocal === 'remove' ? 'без вокала' : a.afx?.vocal === 'isolate' ? 'вокал' : null, a.muted ? 'выкл.' : null].filter(Boolean).join(' · '))),
          a.kind === 'music' && p.bpm ? h('button', { class: 'btn', title: `Подогнать темп под ${p.bpm} BPM`, onclick: (e) => { e.stopPropagation(); syncTrack(a.id).then(draw); } }, '⇄') : null,
          h('button', { class: 'btn', title: a.muted ? 'Включить' : 'Выключить', onclick: (e) => { e.stopPropagation(); commit((q) => { const x = q.audio.find((y) => y.id === a.id); x.muted = !x.muted; }); draw(); } }, a.muted ? '🔇' : '🔊'));
      }),
      list.length ? null : h('div', { class: 'note' }, 'Пока пусто: добавь трек, запиши голос или собери бит во вкладке «Бит».'));
    import('./icons.js').then((x) => x.hydrateIcons(box));
  };
  draw();
  return box;
}

/** Инструментал нейросетью: трек → «инструментал» (вместо исходника) + «вокал» (выключен, для акапеллы). */
const sepRunning = {};
export const separateStatus = (id) => sepRunning[id] || null;
export async function makeInstrumental(id, btn) {
  const a = S.project.audio.find((x) => x.id === id);
  const m = a && S.project.media.find((x) => x.id === a.media);
  if (!a || !m || sepRunning[id]) return;
  if (!S.backend.separate || !S.backend.caps?.enhance) return toast('Нейросеть работает на компе — подключи комп (главный экран → «Комп»)', 'err');
  const pid = S.project.id;
  sepRunning[id] = { progress: 0, message: 'Запуск…' };
  toast('Отделяю голос от музыки — можно работать дальше, дорожки появятся сами');
  const show = () => { if (btn?.isConnected) btn.textContent = `🎤 ${sepRunning[id]?.message || 'Отделяю…'} ${Math.round((sepRunning[id]?.progress || 0) * 100)}%`; };
  try {
    const items = await S.backend.separate(pid, m, (j) => { Object.assign(sepRunning[id], { progress: j.progress, message: j.message }); show(); });
    if (S.project?.id !== pid) return;
    const [inst, voc] = items;
    const ids = [uid(), uid()];
    commit((p) => {
      p.media.push(inst, voc);
      if (p.beats?.[a.media]) { p.beats[inst.id] = p.beats[a.media]; p.beats[voc.id] = p.beats[a.media]; }   // темп/биты те же
      const src = p.audio.find((x) => x.id === id);
      if (!src) return;
      const base = structuredClone(src);
      p.audio.push({ ...base, id: ids[0], media: inst.id, muted: false, solo: false });
      p.audio.push({ ...base, id: ids[1], media: voc.id, kind: S.project.kind === 'music' ? 'music' : base.kind, muted: true, solo: false });
      src.muted = true;
    });
    loadMedia(inst.id); loadMedia(voc.id);
    select('audio', [ids[0]]);
    toast('Готово: «инструментал» играет, «вокал» — отдельной выключенной дорожкой, исходник выключен', 'ok');
  } catch (e) {
    toast('Инструментал: ' + e.message, 'err');
  } finally {
    delete sepRunning[id];
  }
}

/** Песня без мата: нейросеть отделяет голос, Whisper ищет мат — на мате пропадает только голос, бит играет дальше.
 *  Новая дорожка «без мата» встаёт вместо исходной (та выключается). */
export const CLEAN_MODES = { mute: 'Тишина', reverse: 'Задом наперёд', beep: 'Пик' };
const cleanRunning = {};
export const cleanStatus = (id) => cleanRunning[id] || null;
export async function makeClean(id, btn) {
  const a = S.project.audio.find((x) => x.id === id);
  const m = a && S.project.media.find((x) => x.id === a.media);
  if (!a || !m || cleanRunning[id]) return;
  if (!S.backend.clean || !S.backend.caps?.enhance) return toast('Нейросеть работает на компе — подключи комп (главный экран → «Комп»)', 'err');
  const pid = S.project.id, c = S.project.censor || {};
  const opts = { mode: c.song || 'mute', lang: S.project.subs?.opts?.lang || 'ru', model: S.project.subs?.opts?.model,
    custom: String(c.custom || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean) };
  cleanRunning[id] = { progress: 0, message: 'Запуск…' };
  toast('Ищу мат в песне — можно работать дальше, дорожка появится сама');
  const show = () => { if (btn?.isConnected) btn.textContent = `🤬 ${cleanRunning[id]?.message || 'Ищу мат…'} ${Math.round((cleanRunning[id]?.progress || 0) * 100)}%`; };
  try {
    const { items, regions } = await S.backend.clean(pid, m, opts, (j) => { Object.assign(cleanRunning[id], { progress: j.progress, message: j.message }); show(); });
    if (S.project?.id !== pid) return;
    if (!regions.length) { toast('Мата в песне не нашёл 👍', 'ok'); return; }
    const [it] = items, nid = uid();
    commit((p) => {
      p.media.push(it);
      if (p.beats?.[a.media]) p.beats[it.id] = p.beats[a.media];   // темп/биты те же
      const src = p.audio.find((x) => x.id === id);
      if (!src) return;
      p.audio.push({ ...structuredClone(src), id: nid, media: it.id, muted: false, solo: false });
      src.muted = true;
    });
    loadMedia(it.id);
    select('audio', [nid]);
    toast(`Готово: мат убран в ${regions.length} местах — играет «без мата», исходник выключен`, 'ok');
  } catch (e) {
    toast('Без мата: ' + e.message, 'err');
  } finally {
    delete cleanRunning[id];
  }
}

/** Кнопка и выбор, чем заменять мат в песне (свойства дорожки). */
export function cleanTools(a, rerender) {
  const c = S.project.censor || {};
  return h('div', {},
    h('div', { class: 'field' }, h('label', {}, 'Мат в песне — вместо него'),
      seg(CLEAN_MODES, c.song || 'mute', (v) => { commit((p) => { p.censor = { ...p.censor, song: v }; }); rerender?.(); })),
    h('div', { class: 'btn-row', style: { marginTop: 0 } },
      h('button', { class: 'btn', title: 'Нейросеть отделит голос, Whisper найдёт мат: на мате пропадёт только голос — бит играет дальше',
        onclick: (e) => makeClean(a.id, e.currentTarget) }, cleanRunning[a.id] ? `🤬 Ищу мат… ${Math.round(cleanRunning[a.id].progress * 100)}%` : '🤬 Убрать мат (нейросеть)')));
}

/** Блок свойств дорожки в режиме «Музыка»: темп, вокал, бит. */
export function musicTrackTools(a, rerender) {
  const bpm = trackBpm(a);
  const setAfx = (k, v) => { commit((p) => { const x = p.audio.find((y) => y.id === a.id); x.afx = { ...(x.afx || {}), [k]: v }; }); rerender(); };
  return h('div', {},
    h('h4', {}, 'Мешап'),
    h('div', { class: 'note' }, bpm ? `Темп трека: ${Math.round(bpm)} BPM${S.project.bpm ? ` · проект: ${S.project.bpm} BPM` : ''}` : 'Темп трека ещё не найден.'),
    a.kind !== 'beat' ? h('div', { class: 'btn-row', style: { marginTop: 0 } },
      h('button', { class: 'btn', onclick: async () => { try { await detectBeats(a.media); rerender(); } catch (e) { toast(e.message, 'err'); } } }, 'Найти темп'),
      h('button', { class: 'btn', disabled: !S.project.bpm, onclick: () => syncTrack(a.id).then(rerender) }, S.project.bpm ? `Под ${S.project.bpm} BPM` : 'Под темп проекта'),
      h('button', { class: 'btn', onclick: () => { commit((p) => { p.bpm = Math.round(bpm || 0) || p.bpm; }); rerender(); }, disabled: !bpm }, 'Темп проекта = этот'),
      h('button', { class: 'btn', disabled: !S.project.bpm, title: 'Сдвинуть так, чтобы сильная доля трека легла на такт', onclick: () => alignTrack(a.id).then(rerender) }, 'Выровнять по сетке')) : null,
    a.kind !== 'beat' ? h('div', { class: 'btn-row', style: { marginTop: 0 } },
      h('button', { class: 'btn primary', title: 'Нейросеть Ultimate Vocal Remover отделит голос: инструментал и вокал станут отдельными дорожками',
        onclick: (e) => makeInstrumental(a.id, e.currentTarget) }, sepRunning[a.id] ? `🎤 Отделяю… ${Math.round(sepRunning[a.id].progress * 100)}%` : '🎤 Инструментал (нейросеть)')) : null,
    a.kind !== 'beat' ? cleanTools(a, rerender) : null,
    h('div', { class: 'field' }, h('label', {}, 'Вокал быстро (упрощённо, по стерео-центру)'),
      seg({ none: 'Всё', remove: 'Без вокала', isolate: 'Только вокал' }, a.afx?.vocal || 'none', (v) => setAfx('vocal', v))),
    a.kind === 'beat' && a.pattern ? h('div', { class: 'btn-row', style: { marginTop: 0 } },
      h('button', { class: 'btn primary', onclick: () => import('./beatui.js').then((m) => m.editBeat(a.id)) }, 'Изменить бит')) : null,
    h('div', { class: 'btn-row', style: { marginTop: 0 } },
      h('button', { class: 'btn', title: 'Копия дорожки сразу после неё', onclick: () => {
        const id = uid();
        commit((p) => { const x = p.audio.find((y) => y.id === a.id); p.audio.push({ ...structuredClone(x), id, start: x.start + audioLen(x) }); });
        select('audio', [id]);
      } }, 'Повторить после'),
      h('button', { class: 'btn', title: 'Плавно уйти в тишину / из тишины', onclick: () => {
        commit((p) => Object.assign(p.audio.find((y) => y.id === a.id), { fadeIn: Math.min(2, audioLen(a) / 4), fadeOut: Math.min(3, audioLen(a) / 4) }));
        rerender();
      } }, 'Плавно вход/выход')));
}

