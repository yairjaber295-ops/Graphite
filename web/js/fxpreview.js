// Живые превью переходов и эффектов на плитках: один маленький движок рисует пример
// (две картинки A и B), плитка показывает кадр в середине, а при наведении/касании — анимацию.
import { createCompositor } from './engine/compositor2d.js';
import { TRANSITIONS, evalEffects, defaultParams, EFFECT_PACKS, packEffects } from './engine/effects.js';
import { CLIP_DEFAULTS } from './store.js';

const W = 540, H = 720; // 3:4 — как плитки
let comp = null, imgA = null, imgB = null;

/** Пример-кадры: «закат» с солнцем и «ночь» с луной — движение и цвет хорошо видны. */
function sample(kind) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H);
  if (kind === 'A') { g.addColorStop(0, '#ff9a3d'); g.addColorStop(0.55, '#e8505b'); g.addColorStop(1, '#2b1b3d'); }
  else { g.addColorStop(0, '#0b1d3a'); g.addColorStop(0.6, '#1f6f8b'); g.addColorStop(1, '#0a0f1e'); }
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  if (kind === 'A') {
    x.fillStyle = '#ffe8a3'; x.beginPath(); x.arc(W * 0.5, H * 0.46, 95, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#1d1230';
    x.beginPath(); x.moveTo(0, H); x.lineTo(0, H * 0.7); x.lineTo(W * 0.3, H * 0.55); x.lineTo(W * 0.55, H * 0.72); x.lineTo(W * 0.8, H * 0.58); x.lineTo(W, H * 0.68); x.lineTo(W, H); x.fill();
  } else {
    for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(255,255,255,${0.3 + ((i * 37) % 7) / 10})`; x.fillRect((i * 97) % W, (i * 53) % (H * 0.6), 3, 3); }
    x.fillStyle = '#f1f3f5'; x.beginPath(); x.arc(W * 0.68, H * 0.25, 60, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#0b1d3a'; x.beginPath(); x.arc(W * 0.64, H * 0.23, 52, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#06101f';
    for (let i = 0; i < 7; i++) x.fillRect(i * W / 7 + 6, H * (0.62 + ((i * 13) % 5) / 30), W / 7 - 12, H);
  }
  x.font = '900 120px Onest, sans-serif';
  x.fillStyle = 'rgba(255,255,255,.92)';
  x.textAlign = 'center';
  x.fillText(kind, W / 2, H * 0.9);
  return c;
}

function engine() {
  if (!comp) {
    const cv = document.createElement('canvas');
    comp = createCompositor(cv, W, H);
    comp.resize(150, 200);
    imgA = sample('A'); imgB = sample('B');
  }
  return comp;
}

const clip = { ...structuredClone(CLIP_DEFAULTS), id: 'pv' };
const BG = { mode: 'color', color: '#000000' };
const layer = (src) => ({ clip, src, w: W, h: H });

/** Кадр примера: what = {trans} или {effect}; t — 0…1 по ходу. */
function frame(what, t) {
  const c = engine();
  if (what.trans) {
    const tr = TRANSITIONS[what.trans];
    if (!tr || what.trans === 'none') c.render({ layers: [layer(imgA)], trans: null, bg: BG, fx: null, texts: [], t: 0 });
    else c.render({ layers: [layer(imgA), layer(imgB)], trans: { kind: tr.kind, p: t, type: what.trans }, bg: BG, fx: null, texts: [], t: 0 });
  } else {
    const L = what.pack ? EFFECT_PACKS[what.pack].len : 1.6;
    const list = what.pack ? packEffects(what.pack) : [{ type: what.effect, start: 0, end: L, p: defaultParams(what.effect) }];
    const fx = evalEffects(list, t * L);
    c.render({ layers: [layer(imgA)], trans: null, bg: BG, fx, texts: [], t: t * L });
  }
  return c.canvas;
}

let active = null; // плитка, которая сейчас анимируется (одна на всё приложение)

/** Холст-превью для плитки. Анимация — пока курсор над плиткой (на телефоне — после касания, 2 круга). */
export function fxThumb(what) {
  const cv = document.createElement('canvas');
  cv.width = 150; cv.height = 200;
  cv.className = 'fx-thumb';
  const ctx = cv.getContext('2d');
  const paint = (t) => { try { ctx.drawImage(frame(what, t), 0, 0); } catch { /* WebGL недоступен — останется пусто */ } };
  const still = what.trans ? 0.36 : 0.25; // не ровно середина: у «Переворота» и «Затвора» там чёрный кадр
  requestAnimationFrame(() => paint(still));
  const start = (loops = Infinity) => {
    if (active) active.stop();
    let raf = 0, t0 = performance.now(), stopped = false;
    const tick = (now) => {
      if (stopped) return;
      const cycle = what.trans ? 1600 : 1900; // переход: 0,2 с A → 1,1 с перехода → 0,3 с B
      const k = (now - t0) / cycle;
      if (k >= loops) return api.stop();
      const f = k % 1;
      paint(what.trans ? Math.max(0, Math.min(1, (f - 0.12) / 0.7)) : f);
      raf = requestAnimationFrame(tick);
    };
    const api = { stop: () => { stopped = true; cancelAnimationFrame(raf); paint(still); if (active === api) active = null; } };
    active = api;
    raf = requestAnimationFrame(tick);
  };
  const tile = () => cv.closest('.tile') || cv;
  requestAnimationFrame(() => {
    const t = tile();
    t.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') start(); });
    t.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') active?.stop(); });
    t.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') start(2); });
  });
  return cv;
}
