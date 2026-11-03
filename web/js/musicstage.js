// Экран плеера вместо пустого кадра, когда в проекте только музыка: обложка и название из файла,
// пресеты одним нажатием (slowed + reverb, nightcore, хардтек…), бас-буст и живой спектр.
import * as MB from 'mediabunny';
import { S, commit, emit, select, fmtTime, duration } from './store.js';
import { h, fill, toast } from './ui.js';
import { AUDIO_PRESETS, audioSrcAt, audioTlOf, audioLen } from './engine/audioproc.js';
import { musicAnalyser, play, stopPlayback, seek } from './preview.js';
import { applyAudioPreset } from './inspector.js';
import { AFX_PRESETS } from './engine/afx.js';

const QUICK = ['normal', 'slowedreverb', 'slowed', 'spedup', 'nightcore', 'hardtek', 'jersey', 'phonkremix', 'bassremix'];
const meta = {};   // mid → Promise<{ title, artist, cover }>
let root = null, raf = 0, shownFor = null;

/** Главная песня проекта: выделенная дорожка, иначе первая музыка, иначе первый звук. */
function song() {
  const list = S.project.audio || [];
  return list.find((a) => S.sel.kind === 'audio' && S.sel.ids.includes(a.id)) || list.find((a) => a.kind === 'music' && !a.muted)
    || list.find((a) => !a.muted) || list[0] || null;
}

function tags(m) {
  meta[m.id] ||= (async () => {
    const input = new MB.Input({ source: new MB.UrlSource(await S.backend.mediaUrl(S.project.id, m)), formats: MB.ALL_FORMATS });
    try {
      const t = await input.getMetadataTags();
      const img = t.images?.find((x) => x.kind === 'coverFront') || t.images?.[0];
      return { title: t.title, artist: t.artist, cover: img ? URL.createObjectURL(new Blob([img.data], { type: img.mimeType || 'image/jpeg' })) : null };
    } catch { return {}; } finally { input.dispose?.(); }
  })();
  return meta[m.id];
}

/** Какой пресет сейчас стоит у дорожки (по совпадению настроек). */
function presetOf(a) {
  const eq = (x, y) => Math.abs((x ?? 0) - (y ?? 0)) < 1e-3;
  return Object.entries(AUDIO_PRESETS).find(([, p]) => eq(a.speed ?? 1, p.set.speed) && eq(a.pitch, p.set.pitch) && eq(a.reverb, p.set.reverb)
    && (a.remix || null) === (p.set.remix || null) && !!(a.keepPitch ?? true) === !!p.set.keepPitch)?.[0] || null;
}

/** Пресет на ходу: песня продолжается с того же места (с учётом новой скорости). */
async function apply(a, key) {
  const was = S.playing;
  const src = audioSrcAt(a, Math.max(a.start, Math.min(S.t, a.start + audioLen(a))));
  if (was) stopPlayback();
  await applyAudioPreset(a.id, AUDIO_PRESETS[key]);
  const b = S.project.audio.find((x) => x.id === a.id);
  if (b) seek(Math.max(0, Math.min(duration(), audioTlOf(b, src))));
  if (was) play();
  draw();
}

const isExtreme = (a) => (a.afx?.crush || 0) >= 0.5;
const isBoost = (a) => !isExtreme(a) && (a.afx?.bass || 0) >= 6;

function toggleBass(a, extreme = false) {
  const off = extreme ? isExtreme(a) : isBoost(a);
  const set = off ? { bass: 0, drive: 0, midcut: 0, treble: 0, focus: 0, crush: 0 } : extreme ? AFX_PRESETS.bassext.set : { bass: 9, drive: 0, midcut: 0, treble: 0, focus: 0, crush: 0 };
  commit((p) => { const x = p.audio.find((y) => y.id === a.id); x.afx = { ...(x.afx || {}), ...set }; });
  if (S.playing) { stopPlayback(); play(); }
  toast(off ? 'Бас обычный' : extreme ? 'Бас ЭКСТРИМ: рвёт колонки, слова тонут в хрипе' : 'Бас-буст +9 дБ', 'ok');
  draw();
}

export function showMusicStage(on) {
  const stage = document.getElementById('stage');
  if (!on) {
    if (root) root.hidden = true;
    cancelAnimationFrame(raf); raf = 0;
    return;
  }
  if (!root) {
    root = h('div', { class: 'music-stage' });
    stage.append(root);
  }
  root.hidden = false;
  const a = song();
  const key = a ? `${a.id}|${a.speed}|${a.pitch}|${a.reverb}|${a.remix}|${a.afx?.bass}|${a.afx?.crush}|${S.project.audio.length}` : '';
  if (key !== shownFor) { shownFor = key; draw(); }
  if (!raf) raf = requestAnimationFrame(frame);
}

function draw() {
  const a = song();
  if (!root) return;
  if (!a) {
    // пустой музыкальный проект: с чего начать
    const tab = (t) => import('./panels.js').then((m) => { m.setTab(t); emit('open-panel'); });
    fill(root, h('div', { class: 'ms-main' },
      h('div', { class: 'ms-cover' }, h('span', { 'data-icon': 'music' })),
      h('div', { class: 'ms-title' }, 'Начнём с музыки'),
      h('div', { class: 'ms-sub' }, 'Трек для ремикса или мешапа, свой бит или запись голоса'),
      h('div', { class: 'ms-chips' },
        h('button', { class: 'ms-chip on', onclick: () => import('./panels.js').then((m) => m.importMedia('audio')).catch((e) => toast(e.message, 'err')) }, 'Добавить трек'),
        h('button', { class: 'ms-chip', onclick: () => tab('beat') }, 'Собрать бит'),
        h('button', { class: 'ms-chip', onclick: () => tab('tracks') }, 'Записать голос'))));
    import('./icons.js').then((x) => x.hydrateIcons(root));
    return;
  }
  const m = S.project.media.find((x) => x.id === a.media);
  const cur = presetOf(a);
  const cover = h('div', { class: 'ms-cover' }, h('span', { 'data-icon': 'music' }));
  const title = h('div', { class: 'ms-title' }, (m?.name || 'Музыка').replace(/\.[^.]+$/, ''));
  const sub = h('div', { class: 'ms-sub' }, `${fmtTime(audioLen(a), false)}${(a.speed ?? 1) !== 1 ? ` · скорость ×${(+a.speed).toFixed(2)}` : ''}`);
  const bg = h('div', { class: 'ms-bg' });
  fill(root, bg,
    h('div', { class: 'ms-main' }, cover, title, sub,
      h('div', { class: 'ms-chips' },
        ...QUICK.map((k) => h('button', { class: 'ms-chip' + (cur === k ? ' on' : '') + (AUDIO_PRESETS[k].group === 'remix' ? ' remix' : ''),
          onclick: () => apply(a, k) }, AUDIO_PRESETS[k].label)),
        h('button', { class: 'ms-chip' + (isBoost(a) ? ' on' : ''), onclick: () => toggleBass(a) }, 'Бас-буст'),
        h('button', { class: 'ms-chip remix' + (isExtreme(a) ? ' on' : ''), onclick: () => toggleBass(a, true) }, '💥 Бас ЭКСТРИМ'),
        a.kind !== 'beat' ? h('button', { class: 'ms-chip', onclick: (e) => import('./musicui.js').then((x) => x.makeInstrumental(a.id, e.currentTarget)) }, '🎤 Инструментал') : null,
        a.kind !== 'beat' ? h('button', { class: 'ms-chip', onclick: (e) => import('./musicui.js').then((x) => x.makeClean(a.id, e.currentTarget)) }, '🤬 Без мата') : null,
        h('button', { class: 'ms-chip more', onclick: () => { select('audio', [a.id]); emit('open-inspector'); } }, 'Тонко…'))),
    h('canvas', { class: 'ms-spectrum' }));
  import('./icons.js').then((x) => x.hydrateIcons(root));
  if (m) {
    tags(m).then((t) => {
      if (t.cover) { cover.replaceChildren(h('img', { src: t.cover, alt: '' })); bg.style.backgroundImage = `url("${t.cover}")`; root.classList.add('has-cover'); }
      if (t.title) title.textContent = t.title;
      if (t.artist) sub.textContent = `${t.artist} · ${sub.textContent}`;
    });
  }
}

const levels = new Float32Array(64);
function frame() {
  raf = 0;
  if (!root || root.hidden || !S.project || document.getElementById('editor')?.hidden) return;
  raf = requestAnimationFrame(frame);
  const cv = root.querySelector('.ms-spectrum');
  if (!cv) return;
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const an = musicAnalyser();
  const data = new Uint8Array(an.frequencyBinCount);
  if (S.playing) an.getByteFrequencyData(data);
  const n = levels.length, sr = an.context.sampleRate;
  let bass = 0;
  for (let i = 0; i < n; i++) {
    // полосы по логарифмической шкале 40 Гц … 16 кГц
    const f0 = 40 * Math.pow(400, i / n), f1 = 40 * Math.pow(400, (i + 1) / n);
    const b0 = Math.floor(f0 / sr * an.fftSize), b1 = Math.max(b0 + 1, Math.floor(f1 / sr * an.fftSize));
    let v = 0;
    for (let b = b0; b < b1; b++) v = Math.max(v, data[b] || 0);
    v /= 255;
    levels[i] = Math.max(v, levels[i] * 0.9);
    if (i < 6) bass += levels[i] / 6;
  }
  const css = getComputedStyle(document.documentElement);
  const g = ctx.createLinearGradient(0, cv.height, 0, 0);
  g.addColorStop(0, css.getPropertyValue('--accent').trim() || '#7c5cff');
  g.addColorStop(1, css.getPropertyValue('--accent-2').trim() || '#22d3ee');
  ctx.fillStyle = g;
  const bw = cv.width / n;
  for (let i = 0; i < n; i++) {
    const hh = Math.max(2 * dpr, levels[i] * cv.height);
    ctx.globalAlpha = 0.35 + 0.65 * levels[i];
    ctx.fillRect(i * bw + bw * 0.18, cv.height - hh, bw * 0.64, hh);
  }
  ctx.globalAlpha = 1;
  const cover = root.querySelector('.ms-cover');
  if (cover) cover.style.transform = `scale(${1 + bass * 0.06})`;
}
