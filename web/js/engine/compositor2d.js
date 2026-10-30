// Запасной движок на обычном 2D-холсте — если WebGL2 на устройстве нет или он не работает.
// Умеет главное: видео с кадрированием, размытый фон, цвет клипа, тряску/зум, вспышки и затемнения, Ч/Б, сепию,
// негатив, виньетку, простые переходы (растворение, сдвиги, зум, шторки, круг), тексты, обложки, карточки.
import { Compositor } from './compositor.js';
import { colorParams } from './effects.js';
import { drawItem } from './text.js';
import { drawCover, drawCard, COVER_STYLES } from './covers.js';
import { adRect, keyImageData } from './ads.js';

const ease = (x) => x * x * (3 - 2 * x);

/** Хромакей без WebGL: кадр в небольшой холст (до 720 px) и попиксельно. */
function keyed(src, w, h, ch, cv) {
  const k = Math.min(1, 720 / Math.max(w, h));
  const cw = Math.max(2, Math.round(w * k)), chh = Math.max(2, Math.round(h * k));
  if (cv.width !== cw || cv.height !== chh) { cv.width = cw; cv.height = chh; }
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, cw, chh);
  x.drawImage(src, 0, 0, cw, chh);
  x.putImageData(keyImageData(x.getImageData(0, 0, cw, chh), ch), 0, 0);
  return cv;
}

export class Compositor2D {
  constructor(canvas, W, H) {
    this.canvas = canvas;
    this.W = W; this.H = H;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('2D-холст недоступен');
    this.lite2d = true;
    this.layerA = document.createElement('canvas');
    this.layerB = document.createElement('canvas');
    this.keyCv = document.createElement('canvas');
    this.resize(canvas.width || W, canvas.height || H);
  }

  resize(w, h) {
    w = Math.max(16, Math.round(w)); h = Math.max(16, Math.round(h));
    this.canvas.width = w; this.canvas.height = h;
    this.outW = w; this.outH = h;
    for (const c of [this.layerA, this.layerB]) { c.width = w; c.height = h; }
  }

  /** Фон + видео клипа в холст размера вывода. */
  drawLayer(cv, l, bg) {
    const x = cv.getContext('2d');
    const k = this.outW / this.W;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.filter = 'none';
    x.globalAlpha = 1;
    const ch = l?.clip?.chroma?.enabled ? l.clip.chroma : null;
    x.fillStyle = bg?.mode === 'blur' && !ch ? '#000' : bg?.color || '#000';
    x.fillRect(0, 0, cv.width, cv.height);
    if (!l?.src || !l.w) return;
    if (bg?.mode === 'blur' && !ch) {
      const s = Math.max(this.outW / l.w, this.outH / l.h);
      x.filter = `blur(${Math.max(0, (bg.blur || 0) * k * 0.6)}px) brightness(${1 - (bg.dim || 0)})`;
      x.drawImage(l.src, (this.outW - l.w * s) / 2, (this.outH - l.h * s) / 2, l.w * s, l.h * s);
    }
    const c = l.clip || {};
    const col = colorParams(c);
    x.filter = `brightness(${1 + col.bright * 0.25}) contrast(${1 + col.contrast}) saturate(${Math.max(0, 1 + col.sat)})${col.temp > 0 ? ` sepia(${Math.min(0.5, col.temp * 0.3)})` : ''}`;
    const fw = this.W * (c.scale ?? 1) * (c.sx || 1), fh = this.W * (c.scale ?? 1) * l.h / l.w * (c.sy || 1); // с растягом
    x.translate((this.W / 2 + (c.x || 0)) * k, (this.H / 2 + (c.y || 0)) * k);
    x.rotate((c.rot || 0) * Math.PI / 180);
    x.drawImage(ch ? keyed(l.src, l.w, l.h, ch, this.keyCv) : l.src, -fw / 2 * k, -fh / 2 * k, fw * k, fh * k);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.filter = 'none';
  }

  drawAds(x, ads) {
    const k = this.outW / this.W, boxes = [];
    for (const ad of ads || []) {
      if (!ad.src || !ad.w) continue;
      const r = adRect(ad, this.W, this.H);
      if (!r) continue;
      if (ad.mode === 'full' && !ad.chroma) { x.globalAlpha = ad.alpha; x.fillStyle = '#000'; x.fillRect(0, 0, this.outW, this.outH); }
      x.save();
      x.globalAlpha = ad.alpha;
      const rx = (r.cx - r.w / 2) * k, ry = (r.cy - r.h / 2) * k;
      if (ad.radius > 0) { x.beginPath(); x.roundRect(rx, ry, r.w * k, r.h * k, ad.radius * Math.min(r.w, r.h) * k); x.clip(); }
      x.drawImage(ad.chroma ? keyed(ad.src, ad.w, ad.h, ad.chroma, this.keyCv) : ad.src, rx, ry, r.w * k, r.h * k);
      x.restore();
      boxes.push({ item: { kind: 'ad', id: ad.id }, box: { x: r.cx - r.w / 2, y: r.cy - r.h / 2, w: r.w, h: r.h } });
    }
    x.globalAlpha = 1;
    return boxes;
  }

  /** Переход A → B (упрощённо): сдвиги, зум, шторки, круг; остальное — растворение. */
  mixTrans(x, kind, p) {
    // переходы для эдитов — похожим простым вариантом
    kind = { 49: 4, 50: 41, 51: 4, 52: 10, 53: 11, 55: 43, 56: 3, 58: 4, 64: 4, 68: 2, 72: 41 }[kind] ?? kind;
    const A = this.layerA, B = this.layerB, w = this.outW, h = this.outH, e = ease(p);
    const slide = { 6: [-1, 0], 7: [1, 0], 8: [0, -1], 9: [0, 1], 10: [-1, 0], 11: [1, 0], 17: [0, -1], 18: [0, 1] }[kind];
    if (slide) {
      x.drawImage(A, slide[0] * e * w, slide[1] * e * h);
      x.drawImage(B, slide[0] * (e - 1) * w, slide[1] * (e - 1) * h);
      return;
    }
    if (kind === 2 || kind === 41 || kind === 3) {
      x.drawImage(p < 0.5 ? A : B, 0, 0);
      x.fillStyle = kind === 2 ? '#000' : '#fff';
      x.globalAlpha = 1 - Math.abs(p * 2 - 1);
      x.fillRect(0, 0, w, h);
      x.globalAlpha = 1;
      return;
    }
    if (kind === 4 || kind === 19 || kind === 31) {
      const za = 1 + e, zb = 1.6 - e * 0.6;
      x.globalAlpha = 1;
      x.drawImage(A, (w - w * za) / 2, (h - h * za) / 2, w * za, h * za);
      x.globalAlpha = Math.min(1, Math.max(0, (p - 0.35) / 0.3));
      x.drawImage(B, (w - w * zb) / 2, (h - h * zb) / 2, w * zb, h * zb);
      x.globalAlpha = 1;
      return;
    }
    const wipe = { 22: [w * (1 - e), 0, w * e, h], 23: [0, 0, w * e, h], 24: [0, h * (1 - e), w, h * e], 25: [0, 0, w, h * e] }[kind];
    if (wipe) { x.drawImage(A, 0, 0); if (e > 0.001) x.drawImage(B, ...wipe, ...wipe); return; }
    if (kind >= 45 && kind <= 47) {
      // окно: B в фигуре поверх затемнённого A, раскрывается на весь кадр
      const k1 = ease(Math.min(1, p / 0.62)), k2 = ease(Math.max(0, (p - 0.62) / 0.38));
      x.drawImage(A, 0, 0);
      x.fillStyle = `rgba(0,0,0,${0.6 * k1})`; x.fillRect(0, 0, w, h);
      x.save();
      x.translate(w / 2, h / 2);
      x.beginPath();
      if (kind === 45) {
        const sc = (0.1 + 0.38 * k1) * (1 - k2) + k2;
        x.rotate((-0.42 + 0.32 * k1) * (1 - k2));
        x.rect(-w * sc / 2, -h * sc / 2, w * sc, h * sc);
        x.clip();
        x.drawImage(B, -w * sc / 2, -h * sc / 2, w * sc, h * sc);
      } else {
        const R = Math.hypot(w, h) * ((0.04 + 0.26 * k1) * (1 - k2) + 1.2 * k2) / 1.2;
        if (kind === 46) x.arc(0, 0, R, 0, Math.PI * 2);
        else for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5 + (1 - k1) * 1.4, r = i % 2 ? R * 0.45 : R * 1.3; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        x.clip();
        x.drawImage(B, -w / 2, -h / 2, w, h);
      }
      x.restore();
      return;
    }
    if (kind === 15 || kind === 43) {
      x.drawImage(A, 0, 0);
      x.save(); x.beginPath(); x.arc(w / 2, h / 2, e * Math.hypot(w, h) / 2, 0, Math.PI * 2); x.clip(); x.drawImage(B, 0, 0); x.restore();
      return;
    }
    x.drawImage(A, 0, 0);
    x.globalAlpha = e;
    x.drawImage(B, 0, 0);
    x.globalAlpha = 1;
  }

  render(f) {
    const x = this.ctx, W = this.W, H = this.H, k = this.outW / W;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.filter = 'none';
    x.globalAlpha = 1;
    this.drawLayer(this.layerA, f.layers[0], f.bg);
    let frame = this.layerA;
    if (f.layers.length >= 2 && f.trans) {
      this.drawLayer(this.layerB, f.layers[1], f.bg);
      const out = document.createElement('canvas'); // небольшая цена за простоту: только на кадрах перехода
      out.width = this.outW; out.height = this.outH;
      this.mixTrans(out.getContext('2d'), f.trans.kind, Math.max(0, Math.min(1, f.trans.p)));
      frame = out;
    }
    if (f.cover) {
      const blur = COVER_STYLES[f.cover.style]?.blur !== false;
      x.filter = `${blur ? `blur(${18 * k}px) ` : ''}brightness(${blur ? 0.45 : 0.8}) saturate(0.9)`;
      x.drawImage(frame, 0, 0);
      x.filter = 'none';
      drawCover(x, f.cover, k, W, H);
      return [];
    }
    // тряска/зум и цветовые эффекты кадра
    const fx = f.fx || { scale: 1, tx: 0, ty: 0, rot: 0 };
    x.fillStyle = '#000';
    x.fillRect(0, 0, this.outW, this.outH);
    const filt = [fx.bw ? `grayscale(${fx.bw})` : '', fx.sepia ? `sepia(${fx.sepia})` : '', fx.invert ? `invert(${fx.invert})` : '',
      fx.blurA ? `blur(${fx.blurA * 12 * k}px)` : '', fx.glow ? `brightness(${1 + fx.glow * 0.25})` : ''].filter(Boolean).join(' ');
    x.filter = filt || 'none';
    x.translate(this.outW / 2 + (fx.tx || 0) * this.outW, this.outH / 2 + (fx.ty || 0) * this.outH);
    x.rotate(fx.rot || 0);
    x.scale((fx.scale || 1) * (fx.stx || 1), (fx.scale || 1) * (fx.sty || 1));
    x.drawImage(frame, -this.outW / 2, -this.outH / 2);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.filter = 'none';
    const over = (color, a) => { if (a > 0.001) { x.globalAlpha = Math.min(1, a); x.fillStyle = color; x.fillRect(0, 0, this.outW, this.outH); x.globalAlpha = 1; } };
    if (fx.tint && fx.tintC) { x.globalCompositeOperation = 'screen'; over(`rgb(${fx.tintC.map((v) => Math.round(v * 255)).join(',')})`, fx.tint); x.globalCompositeOperation = 'source-over'; }
    if (fx.vign) {
      const g = x.createRadialGradient(this.outW / 2, this.outH / 2, Math.min(this.outW, this.outH) * 0.25, this.outW / 2, this.outH / 2, Math.hypot(this.outW, this.outH) / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.85 * fx.vign})`);
      x.fillStyle = g; x.fillRect(0, 0, this.outW, this.outH);
    }
    if (fx.bars) { const b = fx.bars * 0.13 * this.outH; x.fillStyle = '#000'; x.fillRect(0, 0, this.outW, b); x.fillRect(0, this.outH - b, this.outW, b); }
    over('#fff', fx.flash || 0);
    over('#000', fx.black || 0);
    const boxes = this.drawAds(x, f.ads);
    for (const it of f.texts || []) {
      const b = drawItem(x, it, f.t, k);
      if (b) boxes.push({ item: it, box: b });
    }
    if (f.card) drawCard(x, f.card, k, W, H);
    return boxes;
  }

  isBlack() {
    try {
      for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.4], [0.7, 0.6]]) {
        const d = this.ctx.getImageData(Math.floor(this.outW * fx), Math.floor(this.outH * fy), 1, 1).data;
        if (d[0] + d[1] + d[2] > 6) return false;
      }
      return true;
    } catch { return false; }
  }

  dispose() {}
}

/**
 * Движок кадра: WebGL2 (полный или облегчённый), а если он не работает — 2D.
 * WebGL занимает холст навсегда, поэтому для 2D берётся новый холст (вызывающий подменяет его у себя).
 */
export function createCompositor(canvas, W, H) {
  try {
    return new Compositor(canvas, W, H);
  } catch (e) {
    console.error(`[видеочип] WebGL не работает — включаю простой 2D-движок. ${e.message}`);
    const c2 = document.createElement('canvas');
    c2.width = canvas.width; c2.height = canvas.height;
    return new Compositor2D(c2, W, H);
  }
}
