// Превью: тот же движок (WebGL), что и экспорт. Источники кадров — <video> (лёгкие копии),
// музыка — WebAudio. Мышью/пальцем можно двигать текст и видео прямо в кадре.
import { S, on, emit, clipsTL, duration, commit, select, isSelected, clamp, frame } from './store.js';
import { createCompositor } from './engine/compositor2d.js';
import { frameAt, clipGain, srcTime, insertFrame } from './engine/frame.js';
import { itemGain, isMusic } from './engine/audiomix.js';
import { duckPoints } from './smart.js';
import { settings } from './backend/index.js';
import { hasCurve, speedAt } from './engine/speed.js';
import { adGain, guessKeyColor, insertsIn } from './engine/ads.js';
import { hasAfx, makeChain, setChain } from './engine/afx.js';
import { audioLen, audioSpeed, processedBuffer } from './engine/audioproc.js';

let canvas = document.getElementById('preview');
const ui = document.getElementById('preview-ui');
const uictx = ui.getContext('2d');
const stage = document.getElementById('stage');
let comp = null;
let engineError = null;
let boxes = [];
let hadFrame = false, lastGood = 0; // был ли уже полный кадр и когда (держим его, пока следующий кусок грузится)
let guides = { v: false, h: false }; // линии центра кадра, к которым сейчас прилип перетаскиваемый объект
let handles = []; // уголки выделенного: [{pts: [[x, y]] — пиксели холста ui, item, cx, cy — центр в кадре}]

/** Уголок под пальцем/мышью (с запасом ~12 точек экрана). */
function handleAt(e) {
  const r = ui.getBoundingClientRect();
  const s = ui.width / Math.max(1, r.width);
  const x = (e.clientX - r.left) * s, y = (e.clientY - r.top) * s;
  return handles.find((hd) => hd.pts.some(([px, py]) => Math.hypot(px - x, py - y) <= 12 * s)) || null;
}

/** Что меняет уголок: get/set размера выделенного объекта. */
function sizeRef(it) {
  const p = S.project;
  const style = (st) => st && { get: () => st.size, set: (v) => { st.size = Math.round(clamp(v, 10, 400)); } };
  switch (it.kind) {
    case 'clip': { const c = p.clips.find((x) => x.id === it.id); return c && { get: () => c.scale ?? 1, set: (v) => { c.scale = +clamp(v, 0.1, 6).toFixed(3); } }; }
    case 'ad': return { get: () => p.ads.size ?? 0.6, set: (v) => { p.ads.size = +clamp(v, 0.1, 1).toFixed(3); } };
    case 'sub': return style(p.subs.style);
    case 'header': return style(p.headers.style);
    case 'overlay': return style(p.overlays.find((o) => o.id === it.overlay)?.style);
    default: return style(p.texts.find((x) => x.id === it.id)?.style);
  }
}
let raf = null;
let clock = null;          // { t0, p0 } — часы воспроизведения
const pool = {};           // mid → [<video>]
let assigned = new Map();  // clipId → <video>
const warned = new Set();  // о каком файле уже сказали, что не играет

// ---------------------------------------------------------------------------
//   Видео-элементы
// ---------------------------------------------------------------------------
const mediaOf = (mid) => S.project.media.find((m) => m.id === mid);

function makeVideo() {
  const v = document.createElement('video');
  v.preload = 'auto';
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.crossOrigin = 'anonymous';
  v.muted = true;
  v.addEventListener('seeked', () => { if (!S.playing) draw(); });
  v.addEventListener('loadeddata', () => draw());
  v.addEventListener('error', () => {
    // чаще всего — формат, который это устройство не умеет показывать (HEVC/AV1 на части телефонов)
    const m = mediaOf(v.dataset.mid);
    console.error(`превью: «${m?.name}» не проигрывается (код ${v.error?.code}: ${v.error?.message || 'нет описания'})`);
    if (m && !warned.has(m.id)) {
      warned.add(m.id);
      emit('toast', { text: `Устройство не может показать «${m.name}» в превью. Подробности: Настройки → Диагностика.`, kind: 'err' });
    }
  });
  document.getElementById('videos').appendChild(v);
  return v;
}

function urlFor(mid) {
  const m = mediaOf(mid);
  return m ? S.backend.playUrl(S.project.id, m, S.media[mid]) : null;
}

function syncSrc(v, mid) {
  const src = urlFor(mid);
  if (src && v.dataset.src !== src) {
    const t = v.currentTime;
    v.dataset.src = src;
    v.dataset.mid = mid;
    v.src = src;
    if (t) v.addEventListener('loadedmetadata', () => { v.currentTime = t; }, { once: true });
  }
}

/** Элемент для клипа: свой, либо свободный элемент того же файла (ближайший по времени), либо новый. */
function elFor(clip, want, taken) {
  const prev = assigned.get(clip.id);
  if (prev && !taken.has(prev)) { syncSrc(prev, clip.media); return prev; }
  const list = (pool[clip.media] ||= []);
  let best = null, bd = Infinity;
  for (const v of list) {
    if (taken.has(v)) continue;
    const d = Math.abs(v.currentTime - want);
    if (d < bd) { bd = d; best = v; }
  }
  if (!best && list.length < 4) { best = makeVideo(); list.push(best); } // в эдитах много коротких кусков одного файла подряд
  if (!best) best = list.find((v) => !taken.has(v)) || list[0];
  syncSrc(best, clip.media);
  return best;
}

/** Цвет фона для хромакея — по кадру этого файла, который сейчас загружен в превью. */
export function keyColorOf(mid) {
  const im = S.media[mid]?.img;
  if (im?.naturalWidth) return guessKeyColor(im, im.naturalWidth, im.naturalHeight);
  const v = (pool[mid] || []).find((x) => x.readyState >= 2 && x.videoWidth);
  return v ? guessKeyColor(v, v.videoWidth, v.videoHeight) : null;
}

/** <video> → цепочка эффектов звука (подключается один раз: после этого звук элемента идёт только через неё). */
const routed = new WeakMap();
function routeVideo(v) {
  let c = routed.get(v);
  if (c) return c;
  try {
    const ctx = audioCtx();
    const src = ctx.createMediaElementSource(v);
    c = makeChain(ctx);
    src.connect(c.input);
    c.output.connect(ctx.destination);
    routed.set(v, c);
    if (ctx.state === 'suspended') ctx.resume();
    return c;
  } catch (e) {
    console.warn('эффекты звука в превью недоступны:', e);
    return null;
  }
}

export function resetVideos() {
  for (const list of Object.values(pool)) for (const v of list) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); }
  for (const k of Object.keys(pool)) delete pool[k];
  assigned = new Map();
  stopMusic();
}

// ---------------------------------------------------------------------------
//   Размер
// ---------------------------------------------------------------------------
export function resize() {
  if (!S.project) return;
  const { w, h } = S.project.canvas;
  const r = stage.getBoundingClientRect();
  const scale = Math.min((r.width - 16) / w, (r.height - 16) / h);
  const cssW = Math.max(40, Math.floor(w * scale)), cssH = Math.max(70, Math.floor(h * scale));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const c of [canvas, ui]) { c.style.width = cssW + 'px'; c.style.height = cssH + 'px'; }
  // внутреннее разрешение превью не больше самого кадра
  const pw = Math.min(w, Math.round(cssW * dpr)), ph = Math.round(pw * h / w);
  // движок на этом холсте один на всё время (пересоздание вернуло бы «потерянный» WebGL-контекст) —
  // при смене соотношения сторон меняем только размер кадра
  if (!comp) {
    try {
      comp = createCompositor(canvas, w, h);
    } catch (e) {
      console.error('превью: движок не запустился', e);
      engineError = e.message;
      draw();
      return;
    }
    if (comp.canvas !== canvas) {
      // WebGL не заработал — 2D-движок рисует на новом холсте вместо старого
      comp.canvas.id = 'preview';
      canvas.replaceWith(comp.canvas);
      canvas = comp.canvas;
      canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
      emit('toast', { text: 'Видеочип не потянул WebGL — превью в простом режиме (часть эффектов не видна). Подробности: Настройки → Диагностика.', kind: 'err' });
    } else if (comp.lite) {
      emit('toast', { text: 'Этот телефон не тянет все эффекты — включён облегчённый режим (переходы и эффекты попроще).' });
    }
  }
  window.__engine = comp.lite2d ? '2D (без WebGL — простой режим)' : comp.lite ? 'WebGL, облегчённые шейдеры' : 'WebGL, полный';
  comp.W = w; comp.H = h;
  comp.resize(pw, ph);
  ui.width = Math.round(cssW * dpr); ui.height = Math.round(cssH * dpr);
  draw();
}

// ---------------------------------------------------------------------------
//   Кадр
// ---------------------------------------------------------------------------
export function draw() {
  if (!S.project) return;
  const p = S.project;
  const empty = document.getElementById('stage-empty');
  if (!comp) {
    // движок не запустился — честно говорим об этом, а не «добавь видео»
    if (engineError) {
      empty.hidden = false;
      empty.replaceChildren(Object.assign(document.createElement('b'), { textContent: 'Превью не запустилось на этом устройстве' }),
        Object.assign(document.createElement('div'), { textContent: engineError }),
        Object.assign(document.createElement('div'), { className: 'dim small', textContent: 'Настройки → Диагностика → «Скопировать» и пришли мне.' }));
    }
    return;
  }
  empty.hidden = p.clips.length > 0;
  const ins = curInsert();
  const spec = ins ? insertFrame(ins.x, ins.age) : frameAt(S.t, { withCover: !S.playing });
  const taken = new Set();
  const next = new Map();
  const source = (clip, want) => {
    if (mediaOf(clip.media)?.kind === 'image') {
      const im = S.media[clip.media]?.img;
      return { src: im || null, w: im?.naturalWidth, h: im?.naturalHeight, el: null };
    }
    const v = elFor(clip, want, taken);
    taken.add(v);
    next.set(clip.id, v);
    if (!S.playing && v.readyState >= 1 && Math.abs(v.currentTime - want) > frame() / 2 && !v.seeking) v.currentTime = want;
    const ok = v.readyState >= 2 && v.videoWidth;
    return { src: ok ? v : null, w: v.videoWidth, h: v.videoHeight, el: v };
  };
  spec.layers = spec.layers.map((l) => ({ clip: l.clip, ...source(l.clip, l.src) }));
  // реклама — свои <video> на каждую вставку
  spec.ads = spec.ads.map((ad) => ({ ...ad, clip: { id: 'ad:' + ad.id, media: ad.media }, want: ad.src, ...source({ id: 'ad:' + ad.id, media: ad.media }, ad.src) }));
  assigned = next;
  // при воспроизведении кусок, который ещё не успел перемотаться/загрузиться, рисовался бы чёрным —
  // держим прошлый кадр (на долю секунды), пока видео не готово
  const waiting = S.playing && spec.layers.some((l) => l.el && !l.src);
  if (waiting && hadFrame && performance.now() - lastGood < 400) { updateTransport(); return spec; }
  if (!waiting) { hadFrame = true; lastGood = performance.now(); }
  comp.compat = compatMode();
  boxes = comp.render(spec) || [];
  checkBlack(spec);
  drawUi(spec);
  updateTransport();
  return spec;
}

// --- совместимое превью (для телефонов, где WebGL не видит кадры <video>) ---
let blackRun = 0, autoCompat = false;
const compatMode = () => autoCompat || !!settings().compatPreview;
function checkBlack(spec) {
  if (comp.compat || S.playing) return;
  const live = spec.layers.some((l) => l.el && l.src && l.el.readyState >= 2 && !spec.trans && !l.clip.chroma?.enabled);
  if (!live || spec.ads.length || !comp.isBlack()) { blackRun = 0; return; }
  if (++blackRun >= 3) {
    autoCompat = true;
    console.warn('превью: кадры видео чёрные — включаю совместимый режим');
    emit('toast', { text: 'Превью было чёрным — включил совместимый режим (Настройки → «Совместимое превью»)', kind: 'ok' });
    requestAnimationFrame(draw);
  }
}

const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c5cff';

function drawUi(spec) {
  const k = ui.width / S.project.canvas.w;
  uictx.setTransform(1, 0, 0, 1, 0, 0);
  uictx.clearRect(0, 0, ui.width, ui.height);
  uictx.lineWidth = 2;
  uictx.setLineDash([6, 4]);
  handles = [];
  const W = S.project.canvas.w, H = S.project.canvas.h;
  for (const l of spec.layers) {
    if (!isSelected('clip', l.clip.id) || !l.w) continue;
    const fw = W * (l.clip.scale ?? 1) * (l.clip.sx || 1), fh = W * (l.clip.scale ?? 1) * l.h / l.w * (l.clip.sy || 1);
    const cx = W / 2 + (l.clip.x || 0), cy = H / 2 + (l.clip.y || 0), a = (l.clip.rot || 0) * Math.PI / 180;
    uictx.save();
    uictx.translate(cx * k, cy * k);
    uictx.rotate(a);
    uictx.strokeStyle = accent();
    uictx.strokeRect(-fw / 2 * k, -fh / 2 * k, fw * k, fh * k);
    uictx.restore();
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const x = sx * fw / 2, y = sy * fh / 2;
      return [(cx + x * Math.cos(a) - y * Math.sin(a)) * k, (cy + x * Math.sin(a) + y * Math.cos(a)) * k];
    });
    handles.push({ pts, item: { kind: 'clip', id: l.clip.id }, cx, cy });
  }
  for (const { item, box } of boxes) {
    const sel = item.kind === 'ad' ? isSelected('ad', 'ads') : item.kind === 'overlay' ? isSelected('overlay', item.overlay) : isSelected(item.kind === 'header' ? 'header' : 'text', item.id);
    if (!sel) continue;
    uictx.strokeStyle = accent();
    uictx.strokeRect(box.x * k, box.y * k, box.w * k, box.h * k);
    const x0 = box.x * k, y0 = box.y * k, x1 = (box.x + box.w) * k, y1 = (box.y + box.h) * k;
    handles.push({ pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], item, cx: box.x + box.w / 2, cy: box.y + box.h / 2 });
  }
  uictx.setLineDash([]);
  // уголки: потянуть — размер (видео — масштаб, текст — кегль, реклама — размер окна)
  const hs = 5 * (ui.width / Math.max(1, ui.getBoundingClientRect().width));
  uictx.fillStyle = '#fff';
  uictx.strokeStyle = accent();
  uictx.lineWidth = 1.5;
  for (const hd of handles) for (const [x, y] of hd.pts) { uictx.fillRect(x - hs, y - hs, hs * 2, hs * 2); uictx.strokeRect(x - hs, y - hs, hs * 2, hs * 2); }
  // линии центра, пока объект прилип к ним
  if (guides.v || guides.h) {
    uictx.strokeStyle = accent();
    uictx.lineWidth = 1.5;
    uictx.beginPath();
    if (guides.v) { uictx.moveTo(ui.width / 2, 0); uictx.lineTo(ui.width / 2, ui.height); }
    if (guides.h) { uictx.moveTo(0, ui.height / 2); uictx.lineTo(ui.width, ui.height / 2); }
    uictx.stroke();
  }
}

function updateTransport() {
  const fmt = (t) => {
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  };
  document.getElementById('tc-cur').textContent = fmt(S.t);
  document.getElementById('tc-dur').textContent = fmt(duration());
  document.getElementById('btn-play').classList.toggle('playing', S.playing);
  emit('frame');
}

// ---------------------------------------------------------------------------
//   Воспроизведение: часы по performance.now(), видео подтягивается к часам
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
//   Вставки рекламы с паузой: часы видео стоят, пока идёт ролик
// ---------------------------------------------------------------------------
let insert = null; // идёт вставка: { x, p0 }
let peek = null;   // вставка, показанная на паузе: { x, age }
function curInsert() {
  if (insert) return { x: insert.x, age: Math.max(0, (performance.now() - insert.p0) / 1000) };
  return peek && !S.playing && Math.abs(S.t - peek.x.start) < 1e-3 ? peek : null;
}
/** Показать вставку в превью (клик по ней на таймлайне): видео встаёт в её точку. */
export function peekAd(x, age = 0.5) {
  if (S.playing) stopPlayback();
  S.t = x.start;
  peek = { x, age: Math.min(age, x.end - x.start - 0.05) };
  draw();
  emit('time');
}

export function seek(t) {
  const was = S.playing;
  if (was) stopPlayback();
  peek = null;
  S.t = clamp(t, 0, duration());
  draw();
  emit('time');
  if (was) play();
}

export function play() {
  if (S.playing || !S.project.clips.length) return;
  if (S.t >= duration() - frame()) S.t = 0;
  // стоим ровно на вставке (или она показана) — сначала ролик
  const at = peek && Math.abs(S.t - peek.x.start) < 1e-3 ? peek : null;
  const x0 = at?.x || insertsIn(S.t - 0.02, S.t + 0.02)[0];
  insert = x0 ? { x: x0, p0: performance.now() - (at?.age || 0) * 1000 } : null;
  peek = null;
  S.playing = true;
  if (actx?.state === 'suspended') actx.resume(); // иначе звук через эффекты молчит
  clock = { t0: S.t, p0: performance.now() };
  if (!insert) startMusic(S.t);
  const loop = () => {
    if (!S.playing) return;
    tick();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  emit('play-state');
}

function tick() {
  const now = performance.now();
  if (insert && (now - insert.p0) / 1000 >= insert.x.end - insert.x.start) {
    // ролик кончился — видео идёт дальше с того же места
    clock = { t0: insert.x.start, p0: now };
    insert = null;
    startMusic(clock.t0);
  }
  let t = insert ? insert.x.start : clock.t0 + (now - clock.p0) / 1000;
  if (!insert) {
    const x = insertsIn(S.t + 1e-4, t + 1e-4)[0];
    if (x) { t = x.start; insert = { x, p0: now }; stopMusic(); }
  }
  if (t >= duration()) {
    stopPlayback();
    S.t = duration();
    draw();
    emit('time');
    return;
  }
  S.t = t;
  const spec = draw();
  const used = new Set();
  const sync = [
    ...spec.layers.map((l) => ({ v: l.el, hold: !!spec.frozen || !!l.clip.freeze, muted: hasCurve(l.clip), gain: clipGain(l.clip, t), afx: l.clip.afx, rate: clamp(speedAt(l.clip, t - l.clip.start), 0.0625, 16), want: srcTime(l.clip, t) })),
    ...spec.ads.map((ad) => ({ v: ad.el, muted: false, gain: adGain({ start: 0, end: ad.end - ad.start }, ad.age), rate: ad.speed || 1, want: ad.want })),
  ];
  for (const { v, hold, muted, gain, afx, rate, want } of sync) {
    if (!v) continue; // фото — синхронизировать нечего
    used.add(v);
    if (hold) {
      // вставка: видео стоит на своём кадре
      v.muted = true;
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - want) > 0.1 && !v.seeking) v.currentTime = want;
      continue;
    }
    v.muted = muted; // кривая скорости — без звука клипа (как в экспорте)
    // эффекты звука (бас, «телефон»…): звук элемента идёт через фильтры WebAudio, громкость — там же (можно и >100%)
    const ch = hasAfx(afx) || routed.has(v) ? routeVideo(v) : null;
    if (ch) { setChain(ch, afx || {}); ch.gain.gain.value *= clamp(gain, 0, 4); v.volume = 1; }
    else v.volume = clamp(gain, 0, 1);
    v.preservesPitch = true;
    if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
    if (v.paused) {
      if (Math.abs(v.currentTime - want) > 0.05) v.currentTime = want;
      v.play().catch(() => {});
    } else if (Math.abs(v.currentTime - want) > 0.15 * Math.max(1, rate)) {
      v.currentTime = want; // отстал или убежал — подтягиваем
    }
  }
  // заранее готовим клипы, которые начнутся через ~0,4 с
  const ahead = frameAt(Math.min(duration() - 0.01, t + 0.4), { withCover: false });
  const taken = new Set(used);
  const soon = [...ahead.ads, ...(insert ? [] : insertsIn(t, t + 0.6).map((x) => ({ ...x, src: x.srcIn })))];
  for (const l of [...ahead.layers, ...soon.map((ad) => ({ clip: { id: 'ad:' + ad.id, media: ad.media }, src: ad.src }))]) {
    if (assigned.has(l.clip.id) || mediaOf(l.clip.media)?.kind === 'image') continue;
    const v = elFor(l.clip, l.src, taken);
    taken.add(v);
    if (!used.has(v)) {
      v.muted = true;
      if (!v.paused) v.pause();
      if (v.readyState >= 1 && Math.abs(v.currentTime - l.src) > 0.05 && !v.seeking) v.currentTime = l.src;
    }
  }
  for (const list of Object.values(pool)) for (const v of list) if (!used.has(v) && !taken.has(v)) { v.muted = true; if (!v.paused) v.pause(); }
  emit('time');
}

export function stopPlayback() {
  if (!S.playing) return;
  // остановили посреди вставки — продолжится с того же места ролика
  if (insert) peek = { x: insert.x, age: Math.max(0, (performance.now() - insert.p0) / 1000) };
  insert = null;
  S.playing = false;
  cancelAnimationFrame(raf);
  for (const list of Object.values(pool)) for (const v of list) { v.pause(); v.muted = true; v.playbackRate = 1; }
  stopMusic();
  emit('play-state');
  draw();
}

export function togglePlay() {
  if (S.playing) stopPlayback(); else play();
}

// ---------------------------------------------------------------------------
//   Музыка и звуки (WebAudio)
// ---------------------------------------------------------------------------
let actx = null;
let playing = [];
const decodedCache = {};

export function audioCtx() {
  actx ||= new (window.AudioContext || window.webkitAudioContext)();
  return actx;
}

/** Декодированный звук (музыка/звук/звуковая дорожка видео для поиска битов). */
export function decoded(mid) {
  const m = mediaOf(mid);
  if (!m) return Promise.resolve(null);
  decodedCache[mid] ||= S.backend.audioBuffer(S.project.id, m, audioCtx()).catch((e) => { console.warn(e); delete decodedCache[mid]; return null; });
  return decodedCache[mid];
}

async function startMusic(t) {
  stopMusic();
  const items = (S.project.audio || []).filter((it) => !it.muted && it.start + audioLen(it) > t);
  if (!items.length) return;
  const ctx = audioCtx();
  if (ctx.state === 'suspended') await ctx.resume();
  const startedAt = ctx.currentTime, tStart = t;
  for (const it of items) {
    // скорость/тон/эхо — готовый обработанный звук (первый раз считается ~секунду, дальше из кэша)
    const buf = await processedBuffer(it, await decoded(it.media));
    if (!buf || !S.playing) continue;
    const now = tStart + (ctx.currentTime - startedAt);
    const end = it.start + audioLen(it);
    if (end <= now) continue;
    const st = Math.max(now, it.start);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    const g = ctx.createGain();
    const when = ctx.currentTime + (st - now);
    if (isMusic(it) && S.project.ducking?.enabled) {
      const pts = duckPoints(st, end, (x) => itemGain(it, x)); // музыка тише, пока говорят
      g.gain.setValueAtTime(pts[0][1], when);
      for (const [x, v] of pts.slice(1)) g.gain.linearRampToValueAtTime(v, when + (x - st));
    } else {
      const pts = [st, end, it.start + (it.fadeIn || 0), end - (it.fadeOut || 0)].filter((x) => x >= st && x <= end).sort((a, b) => a - b);
      g.gain.setValueAtTime(itemGain(it, st), when);
      for (const x of pts.slice(1)) g.gain.linearRampToValueAtTime(itemGain(it, x), when + (x - st));
    }
    if (hasAfx(it.afx)) { const ch = setChain(makeChain(ctx), it.afx); node.connect(g).connect(ch.input); ch.output.connect(ctx.destination); }
    else node.connect(g).connect(ctx.destination);
    node.start(when, it.in / audioSpeed(it) + (st - it.start), end - st);
    playing.push(node);
  }
}

function stopMusic() {
  for (const n of playing) { try { n.stop(); } catch { /* уже остановлен */ } }
  playing = [];
}

// ---------------------------------------------------------------------------
//   Мышь и палец: выбор и перетаскивание в кадре
// ---------------------------------------------------------------------------
function toFrame(e) {
  const r = ui.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * S.project.canvas.w, y: (e.clientY - r.top) / r.height * S.project.canvas.h };
}

/** Что в кадре под точкой экрана (для меню по правому клику): текст/реклама/… или клип. */
export function hitAt(clientX, clientY) {
  if (!S.project) return null;
  const pt = toFrame({ clientX, clientY });
  const hit = [...boxes].reverse().find(({ box }) => pt.x >= box.x && pt.x <= box.x + box.w && pt.y >= box.y && pt.y <= box.y + box.h);
  if (hit) return hit.item;
  const l = frameAt(S.t, { withCover: false }).layers.at(-1);
  return l ? { kind: 'clip', id: l.clip.id } : null;
}

const pointers = new Map();
ui.addEventListener('pointerdown', (e) => {
  if (!S.project) return;
  pointers.set(e.pointerId, e);
  try { ui.setPointerCapture(e.pointerId); } catch { /* палец уже отпущен */ }
  if (pointers.size > 1) return; // второй палец — масштаб (см. ниже)
  const pt = toFrame(e);
  // уголок выделенного — меняем размер: во сколько раз дальше от центра, во столько и крупнее
  const hd = handleAt(e);
  const ref = hd && sizeRef(hd.item);
  if (ref) {
    const d0 = Math.max(4, Math.hypot(pt.x - hd.cx, pt.y - hd.cy)), v0 = ref.get(), key = 'resize-' + (hd.item.id || hd.item.kind);
    const onMove = (ev) => {
      const q = toFrame(ev);
      commit(() => ref.set(v0 * Math.hypot(q.x - hd.cx, q.y - hd.cy) / d0), key);
    };
    const onUp = () => {
      ui.removeEventListener('pointermove', onMove);
      ui.removeEventListener('pointerup', onUp);
      ui.removeEventListener('pointercancel', onUp);
      pointers.clear();
    };
    ui.addEventListener('pointermove', onMove);
    ui.addEventListener('pointerup', onUp);
    ui.addEventListener('pointercancel', onUp);
    return;
  }
  const hit = [...boxes].reverse().find(({ box }) => pt.x >= box.x && pt.x <= box.x + box.w && pt.y >= box.y && pt.y <= box.y + box.h);
  let drag = null;
  if (hit) {
    const it = hit.item;
    if (it.kind === 'ad') {
      // реклама: одна позиция на все вставки (доли кадра); на весь экран — не двигается
      const { w: W, h: H } = S.project.canvas;
      const a = S.project.ads;
      select('ad', ['ads']);
      if (a.mode !== 'full') drag = { target: a, frac: [W, H], x0: (a.x ?? 0.5) * W, y0: (a.y ?? 0.74) * H, key: 'move-ad', cx: W / 2, cy: H / 2, ad: true };
    } else if (it.kind === 'overlay') {
      // свой текст пресета: позиция хранится долями кадра (одинаково для любого соотношения сторон)
      const { w: W, h: H } = S.project.canvas;
      const target = S.project.overlays.find((o) => o.id === it.overlay);
      select('overlay', [it.overlay]);
      drag = { target, frac: [W, H], x0: (target.x ?? 0.5) * W, y0: (target.y ?? 0.5) * H, key: 'move-ov-' + target.id, cx: W / 2, cy: H / 2 };
    } else {
      select(it.kind === 'header' ? 'header' : 'text', [it.id], e.shiftKey);
      const target = it.kind === 'sub' ? S.project.subs : it.kind === 'header' ? S.project.headers : S.project.texts.find((t) => t.id === it.id);
      drag = { target, x0: target.x, y0: target.y, key: 'move-' + it.id, cx: S.project.canvas.w / 2, cy: S.project.canvas.h / 2 };
    }
  } else {
    const l = frameAt(S.t, { withCover: false }).layers.at(-1);
    if (l) {
      select('clip', [l.clip.id]);
      const c = S.project.clips.find((x) => x.id === l.clip.id);
      drag = { target: c, x0: c.x || 0, y0: c.y || 0, key: 'move-clip-' + c.id, cx: 0, cy: 0, clip: c }; // у видео 0 — по центру кадра
    } else select(null);
  }
  draw();
  if (!drag) return;
  const start = pt;
  let moved = false;
  const onMove = (ev) => {
    pointers.set(ev.pointerId, ev);
    if (pointers.size > 1) return pinch(drag);
    const q = toFrame(ev);
    const dx = q.x - start.x, dy = q.y - start.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    let nx = drag.x0 + dx, ny = drag.y0 + dy;
    // прилипание к центру кадра по каждой оси: ~10 точек экрана, с линией-подсказкой; Alt — двигать свободно
    const thr = 10 * S.project.canvas.w / Math.max(1, ui.getBoundingClientRect().width);
    const was = guides.v || guides.h;
    guides = { v: !ev.altKey && Math.abs(nx - drag.cx) < thr, h: !ev.altKey && Math.abs(ny - drag.cy) < thr };
    if (guides.v) nx = drag.cx;
    if (guides.h) ny = drag.cy;
    if ((guides.v || guides.h) && !was) navigator.vibrate?.(8);
    if (drag.frac) commit(() => { drag.target.x = +(nx / drag.frac[0]).toFixed(4); drag.target.y = +(ny / drag.frac[1]).toFixed(4); }, drag.key);
    else commit(() => { drag.target.x = Math.round(nx); drag.target.y = Math.round(ny); }, drag.key);
  };
  const onUp = (ev) => {
    pointers.delete(ev.pointerId);
    pinchStart = null;
    if (pointers.size) return;
    if (guides.v || guides.h) { guides = { v: false, h: false }; draw(); }
    ui.removeEventListener('pointermove', onMove);
    ui.removeEventListener('pointerup', onUp);
    ui.removeEventListener('pointercancel', onUp);
  };
  ui.addEventListener('pointermove', onMove);
  ui.addEventListener('pointerup', onUp);
  ui.addEventListener('pointercancel', onUp);
});

// курсор над уголком — «тянуть размер»
ui.addEventListener('pointermove', (e) => { if (!e.buttons) ui.style.cursor = handleAt(e) ? 'nwse-resize' : ''; });

// масштаб двумя пальцами: видео — scale, текст — размер шрифта
let pinchStart = null;
function pinch(drag) {
  const [a, b] = [...pointers.values()];
  const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  if (!pinchStart) {
    pinchStart = { d, scale: drag.ad ? drag.target.size ?? 0.6 : drag.clip ? drag.clip.scale ?? 1 : (drag.target.style || drag.target.style)?.size };
    return;
  }
  const f = d / pinchStart.d;
  if (drag.ad) commit(() => { drag.target.size = +clamp(pinchStart.scale * f, 0.15, 1).toFixed(3); }, 'pinch-ad');
  else if (drag.clip) commit(() => { drag.clip.scale = +clamp(pinchStart.scale * f, 0.2, 5).toFixed(3); }, 'pinch-' + drag.clip.id);
  else if (drag.target.style) commit(() => { drag.target.style.size = Math.round(clamp(pinchStart.scale * f, 16, 260)); }, 'pinch-text');
}

ui.addEventListener('wheel', (e) => {
  if (S.sel.kind === 'ad') {
    e.preventDefault();
    const a = S.project.ads;
    commit(() => { a.size = +clamp((a.size ?? 0.6) * (e.deltaY < 0 ? 1.04 : 1 / 1.04), 0.15, 1).toFixed(3); }, 'scale-ad');
    return;
  }
  if (S.sel.kind !== 'clip') return;
  e.preventDefault();
  const c = S.project.clips.find((x) => x.id === S.sel.ids[0]);
  if (!c) return;
  commit(() => { c.scale = +clamp((c.scale ?? 1) * (e.deltaY < 0 ? 1.04 : 1 / 1.04), 0.2, 5).toFixed(3); }, 'scale-' + c.id);
}, { passive: false });

on('change', () => {
  // сменилось соотношение сторон (или отменили смену) — пересобираем холст
  if (comp && (comp.W !== S.project.canvas.w || comp.H !== S.project.canvas.h)) return resize();
  if (!S.playing) draw();
});
on('canvas-size', () => resize());
on('selection', () => { if (!S.playing) draw(); });
on('media-ready', () => { if (!S.playing) draw(); });
on('cover-asset', () => { if (!S.playing) draw(); });
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(stage);
