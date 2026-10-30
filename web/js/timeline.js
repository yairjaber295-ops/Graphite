// Таймлайн на canvas: части, тексты, заголовки, субтитры, эффекты, видео (миниатюры + волна + переходы),
// музыка/звуки (волна + биты). На телефоне курсор закреплён по центру, лента двигается пальцем.
import { S, on, emit, clipsTL, duration, parts, renderItems, freeTexts, select, isSelected, selItems, selectItems,
  beginEdit, updateEdit, endEdit, snapFrame, clamp, fmtTime } from './store.js';
import { setClipIn, setClipOut, mediaDuration, addCut, clipStart, setFreezeDur, moveClip } from './edit.js';
import { seek, stopPlayback, peekAd } from './preview.js';
import { EFFECTS } from './engine/effects.js';
import { transitionDur } from './engine/frame.js';
import { clipDur, srcOffset, hasCurve, isSped, CURVES } from './engine/speed.js';
import { adPlacements } from './engine/ads.js';
import { audioLen, audioSpeed, audioSrcAt, audioTlOf } from './engine/audioproc.js';

const body = document.getElementById('tl-body');
const cv = document.getElementById('tl');
const ctx = cv.getContext('2d');
const RULER = 26, EDGE = 8;
let ACC = '#7c5cff';
/** Акцентный цвет темы с прозрачностью. */
const accA = (a) => { const n = parseInt(ACC.slice(1, 7), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
const C = { sub: '#4b7bec', header: '#e8a33d', text: '#a26bf5', part: '#7c5cff', audio: '#1fb58f', sfx: '#f0b429', voice: '#3fb4e8', ad: '#e8457a' };
let LEFT = 84;
let W = 0, H = 0, dpr = 1;
let rows = [];
let needs = false;

const centered = () => S.mobile;
// на телефоне курсор всегда по центру — прокрутка следует за временем
const viewStart = () => (centered() ? S.t - (W - LEFT) / 2 / S.zoom : S.scroll);
const X = (t) => LEFT + (t - viewStart()) * S.zoom;
const T = (x) => (x - LEFT) / S.zoom + viewStart();

function lanes(items) {
  const ends = [];
  const lane = {};
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    let i = ends.findIndex((e) => e <= it.start + 1e-6);
    if (i < 0) { i = ends.length; ends.push(0); }
    ends[i] = it.end;
    lane[it.id] = i;
  }
  return { count: ends.length, lane };
}
const audioItems = () => (S.project.audio || []).map((a) => ({ ...a, end: a.start + audioLen(a) }));

function layout() {
  const tl = lanes(freeTexts());
  const fl = lanes(S.project.effects || []);
  const al = lanes(audioItems());
  rows = [];
  let y = RULER;
  const add = (key, h, label, extra = {}) => { rows.push({ key, y, h, label, ...extra }); y += h; };
  add('parts', 22, 'Части');
  for (let i = 0; i < Math.max(1, tl.count); i++) add('text', 24, i ? '' : 'Текст', { lane: i });
  if (S.project.headers.enabled) add('headers', 24, 'Заголовки');
  add('subs', 26, 'Субтитры');
  for (let i = 0; i < Math.max(1, fl.count); i++) add('effects', 24, i ? '' : 'Эффекты', { lane: i });
  if (adPlacements().length) add('ads', 22, 'Реклама');
  const audioH = Math.max(1, al.count) * 34;
  add('video', Math.max(64, H - y - audioH - 4), 'Видео');
  for (let i = 0; i < Math.max(1, al.count); i++) add('audio', 34, i ? '' : 'Музыка', { lane: i });
  return { tl, fl, al };
}

/** Геометрия дорожек (для автотестов и подсказок). */
export const rowsInfo = () => ({ left: LEFT, rows: rows.map((r) => ({ key: r.key, y: r.y, h: r.h, lane: r.lane })) });

export function resize() {
  const r = body.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  W = r.width; H = r.height;
  LEFT = S.mobile ? 8 : 84;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  request();
}

export function request() {
  if (needs) return;
  needs = true;
  requestAnimationFrame(() => { needs = false; draw(); });
}

// ---------------------------------------------------------------------------
//   Отрисовка
// ---------------------------------------------------------------------------
function rr(x, y, w, h, r) {
  w = Math.max(1, w);
  ctx.beginPath();
  ctx.roundRect(x, y, w, Math.max(1, h), Math.max(0, Math.min(r, w / 2, h / 2)));
}

function niceStep() {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s * S.zoom >= 80) || 600;
}

function label(text, x, y, w, color = '#fff') {
  if (w < 16) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(Math.max(x, LEFT) + 4, y - 10, Math.min(w, W) - 8, 20); ctx.clip();
  ctx.fillStyle = color;
  ctx.fillText(text, Math.max(x + 6, LEFT + 6), y);
  ctx.restore();
}

function draw() {
  if (!S.project || !W) return;
  ctx.reset();
  const L = layout();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  ACC = css.getPropertyValue('--accent').trim() || '#7c5cff'; // цвет темы оформления
  C.part = ACC;
  ctx.fillStyle = css.getPropertyValue('--tl-bg').trim() || '#121318';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '500 11px Onest, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  const dur = duration();
  const t0 = T(LEFT), t1 = T(W);

  rows.forEach((r, i) => {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.018)' : 'rgba(255,255,255,.032)';
    ctx.fillRect(LEFT, r.y, W - LEFT, r.h);
  });
  if (X(dur) < W) { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(Math.max(LEFT, X(dur)), RULER, W, H); }
  if (X(0) > LEFT) { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(LEFT, RULER, X(0) - LEFT, H); }

  ctx.save();
  ctx.beginPath(); ctx.rect(LEFT, 0, W - LEFT, H); ctx.clip();

  // линейка
  const step = niceStep();
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.fillStyle = 'rgba(255,255,255,.45)';
  for (let t = Math.max(0, Math.floor(t0 / step) * step); t <= t1; t += step) {
    const x = Math.round(X(t)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, RULER - 9); ctx.lineTo(x, RULER); ctx.stroke();
    ctx.fillText(fmtTime(t, step < 1), x + 4, 10);
    for (let k = 1; k < 5; k++) {
      const xm = Math.round(X(t + step * k / 5)) + 0.5;
      ctx.beginPath(); ctx.moveTo(xm, RULER - 4); ctx.lineTo(xm, RULER); ctx.stroke();
    }
  }
  // биты на линейке
  ctx.fillStyle = 'rgba(31,181,143,.85)';
  for (const b of beatTimes()) if (b >= t0 && b <= t1) { ctx.beginPath(); ctx.arc(X(b), RULER - 3, 2, 0, 7); ctx.fill(); }

  for (const r of rows) {
    if (r.key === 'parts') drawParts(r);
    if (r.key === 'video') { drawVideo(r); drawClipDrag(r); }
  }
  for (const it of renderItems()) {
    if (it.end < t0 || it.start > t1) continue;
    let r;
    if (it.kind === 'sub') r = rows.find((x) => x.key === 'subs');
    else if (it.kind === 'header') r = rows.find((x) => x.key === 'headers');
    else r = rows.find((x) => x.key === 'text' && x.lane === L.tl.lane[it.id]);
    if (r) drawBlock(it.start, it.end, r, C[it.kind], it.text.replace(/\n/g, ' '), isSelected(it.kind === 'header' ? 'header' : 'text', it.id));
  }
  for (const e of S.project.effects || []) {
    if (e.end < t0 || e.start > t1) continue;
    const r = rows.find((x) => x.key === 'effects' && x.lane === L.fl.lane[e.id]);
    const def = EFFECTS[e.type];
    if (r) drawBlock(e.start, e.end, r, def?.color || '#888', '✦ ' + (def?.label || e.type), isSelected('effect', e.id), true);
  }
  for (const a of audioItems()) {
    if (a.end < t0 || a.start > t1) continue;
    const r = rows.find((x) => x.key === 'audio' && x.lane === L.al.lane[a.id]);
    if (r) drawAudio(a, r);
  }
  const adRow = rows.find((x) => x.key === 'ads');
  if (adRow) {
    for (const x of adPlacements()) {
      if (x.end < t0 || x.start > t1) continue;
      // вставка: блок показывает длину ролика, а черта — точку, где видео встанет на паузу
      drawBlock(x.start, x.end, adRow, C.ad, `${x.insert ? '⏸ ' : '📢 '}${x.name} · ${Math.round(x.end - x.start)} с`, isSelected('ad', 'ads'));
      if (x.insert) {
        const px = Math.round(X(x.start)) + 0.5;
        ctx.strokeStyle = C.ad;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px, adRow.y + 2); ctx.lineTo(px, H); ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
  }

  const cuts = [...S.project.parts.cuts].sort((a, b) => a - b);
  cuts.forEach((c, i) => {
    const x = Math.round(X(c)) + 0.5;
    ctx.strokeStyle = isSelected('cut', 'c' + i) ? '#fff' : accA(.7);
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x, RULER); ctx.lineTo(x, H); ctx.stroke();
    ctx.setLineDash([]);
  });

  // рамка выделения
  if (S.marquee) {
    const m = S.marquee;
    ctx.fillStyle = accA(.15);
    ctx.strokeStyle = accA(.9);
    ctx.lineWidth = 1;
    const rx = Math.min(m.x0, m.x1), ry = Math.min(m.y0, m.y1), rw = Math.abs(m.x1 - m.x0), rh = Math.abs(m.y1 - m.y0);
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
  }

  // курсор
  const px = Math.round(X(S.t)) + 0.5;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.roundRect(px - 6, 0, 12, 12, 3); ctx.fill();
  ctx.restore();

  if (!S.mobile) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--tl-bg').trim() || '#121318';
    ctx.fillRect(0, 0, LEFT, H);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    for (const r of rows) if (r.label) ctx.fillText(r.label, 12, r.y + Math.min(r.h, 26) / 2);
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.moveTo(LEFT - 0.5, 0); ctx.lineTo(LEFT - 0.5, H); ctx.stroke();
  }
}

function drawBlock(s, e, r, color, text, sel, fx = false) {
  const x = X(s), w = (e - s) * S.zoom;
  if (x + w < LEFT || x > W) return;
  rr(x + 0.5, r.y + 3, w - 1, r.h - 6, 6);
  ctx.fillStyle = sel ? color : color + (fx ? '99' : 'b8');
  ctx.fill();
  if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
  label(text, x, r.y + r.h / 2, w, fx && color === '#ffffff' ? '#222' : '#fff');
}

function drawParts(r) {
  for (const p of parts()) {
    const x = X(p.start), w = (p.end - p.start) * S.zoom;
    if (x + w < LEFT || x > W) continue;
    rr(x + 1, r.y + 3, w - 2, r.h - 6, 5);
    ctx.fillStyle = p.i % 2 ? accA(.32) : accA(.18);
    ctx.fill();
    const lbl = p.n <= 1 ? 'Целиком' : p.i === p.n ? `Финал · ${Math.round(p.end - p.start)}с` : `${p.i} · ${Math.round(p.end - p.start)}с`;
    label(lbl, x, r.y + r.h / 2, w, '#fff');
  }
}

/** Волна; toSrc(t) — время исходника для времени таймлайна (с учётом скорости). */
function drawWave(peaksObj, toSrc, x0, x1, y, h, color) {
  if (!peaksObj?.peaks?.length) return;
  const pk = peaksObj.peaks, rate = peaksObj.rate;
  ctx.fillStyle = color;
  for (let px = Math.max(x0, LEFT); px < Math.min(x1, W); px += 2) {
    const a = toSrc(T(px)), b = toSrc(T(px + 2));
    let v = 0;
    for (let i = Math.max(0, Math.floor(a * rate)); i <= Math.floor(b * rate) && i < pk.length; i++) v = Math.max(v, pk[i] || 0);
    const hh = v * h;
    ctx.fillRect(px, y + (h - hh) / 2, 1.5, Math.max(1, hh));
  }
}

function drawVideo(r) {
  const list = clipsTL();
  list.forEach((c, j) => {
    const x = X(c.start), w = (c.end - c.start) * S.zoom;
    if (x + w < LEFT - 20 || x > W + 20) return;
    const sel = isSelected('clip', c.id);
    ctx.save();
    rr(x + 0.5, r.y + 3, w - 1, r.h - 6, 7);
    ctx.fillStyle = '#1d2a3a';
    ctx.fill();
    ctx.clip();
    const m = S.media[c.media];
    const meta = m?.meta;
    const thumbH = r.h - 6 - 20;
    if (meta?.thumb_w && m.tiles) {
      const tw = meta.thumb_w * (thumbH / meta.thumb_h);
      const xs = Math.max(x, LEFT - tw);
      for (let px = xs - ((xs - x) % tw); px < Math.min(x + w, W); px += tw) {
        const srcT = c.in + srcOffset(c, T(px) - c.start);
        const idx = Math.max(0, Math.floor(srcT / meta.thumb_interval));
        const tile = m.tiles[Math.floor(idx / meta.thumbs_per_tile)];
        if (tile?.complete && tile.naturalWidth) {
          const col = idx % meta.thumbs_per_tile;
          ctx.drawImage(tile, col * meta.thumb_w, 0, meta.thumb_w, meta.thumb_h, px, r.y + 3, tw, thumbH);
        }
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(x, r.y + r.h - 23, w, 20);
    drawWave(m?.peaks, (t) => c.in + srcOffset(c, t - c.start), x, x + w, r.y + r.h - 22, 18, c.volume === 0 || hasCurve(c) ? '#7ee0c355' : '#7ee0c3');
    // скорость — значок на клипе
    if ((isSped(c) || c.freeze) && w > 30) {
      const tag = c.freeze ? '⏸ стоп-кадр' : hasCurve(c) ? '⤳ ' + CURVES[c.curve].label : `${+(c.speed || 1).toFixed(2)}×`;
      ctx.font = '600 11px Onest, "Segoe UI", sans-serif';
      const tw = ctx.measureText(tag).width + 10;
      ctx.fillStyle = 'rgba(255,190,85,.9)';
      rr(Math.min(x + w, W) - tw - 6, r.y + 7, tw, 17, 5); ctx.fill();
      ctx.fillStyle = '#1a1300';
      ctx.fillText(tag, Math.min(x + w, W) - tw - 1, r.y + 15.5);
      ctx.font = '500 11px Onest, "Segoe UI", sans-serif';
    }
    if (c.filter && c.filter !== 'none') { ctx.fillStyle = accA(.85); ctx.fillRect(x, r.y + 3, w, 3); }
    ctx.restore();
    const name = S.project.media.find((mm) => mm.id === c.media)?.name || '';
    if (w > 50) {
      const lbl = `${name}  ${fmtTime(c.end - c.start, false)}`;
      ctx.font = '500 11px Onest, "Segoe UI", sans-serif';
      const tw = Math.min(ctx.measureText(lbl).width + 12, w - 8);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      rr(Math.max(x, LEFT) + 4, r.y + 7, tw, 17, 5); ctx.fill();
      label(lbl, Math.max(x, LEFT), r.y + 15.5, tw + 4);
    }
    if (m && m.status !== 'ready') {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(x, r.y + 3, w, r.h - 6);
      label('готовлю превью…', x, r.y + r.h / 2, w, '#ffcf66');
    }
    rr(x + 0.5, r.y + 3, w - 1, r.h - 6, 7);
    ctx.strokeStyle = sel ? '#fff' : 'rgba(255,255,255,.12)';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.stroke();
    ctx.lineWidth = 1;
    // переход в этот клип — ромбик на стыке
    if (j > 0) {
      const bx = X(c.start), by = transY(r); // ромбик внизу, над волной — середина стыка остаётся для краёв клипов
      const has = c.transition && c.transition.type !== 'none';
      if (has) {
        const d = transitionDur(list, j) * S.zoom;
        ctx.fillStyle = accA(.35);
        ctx.fillRect(bx - d / 2, r.y + 3, d, r.h - 6);
      }
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = has ? ACC : 'rgba(20,20,26,.9)';
      ctx.strokeStyle = has ? '#fff' : 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.roundRect(-6, -6, 12, 12, 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  });
}

/** Высота ромбика перехода на дорожке видео: внизу, над полосой звуковой волны. */
const transY = (r) => r.y + r.h - 36;

/** Перетаскиваемый клип: полупрозрачная копия под пальцем/мышью и черта, куда он встанет. */
function drawClipDrag(r) {
  const d = S.clipDrag;
  if (!d) return;
  const bx = Math.round(X(d.boundary)) + 0.5;
  ctx.fillStyle = ACC;
  ctx.fillRect(bx - 2, r.y, 4, r.h);
  const x = X(d.left), w = d.w * S.zoom;
  rr(x + 0.5, r.y + 8, w - 1, r.h - 16, 7);
  ctx.fillStyle = accA(.28);
  ctx.fill();
  ctx.strokeStyle = ACC;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineWidth = 1;
  const name = S.project.media.find((m) => m.id === S.project.clips.find((c) => c.id === d.id)?.media)?.name || '';
  label(`↔ ${name}`, x, r.y + r.h / 2, w);
}

function drawAudio(a, r) {
  const x = X(a.start), w = (a.end - a.start) * S.zoom;
  const sel = isSelected('audio', a.id);
  const color = C[a.kind] || C.audio;
  ctx.save();
  rr(x + 0.5, r.y + 3, w - 1, r.h - 6, 6);
  ctx.fillStyle = color + '40';
  ctx.fill();
  ctx.clip();
  drawWave(S.media[a.media]?.peaks, (t) => audioSrcAt(a, t), x, x + w, r.y + 6, r.h - 12, color);
  // биты этого трека
  const bt = S.project.beats?.[a.media];
  if (bt?.beats) {
    for (const b of bt.beats) {
      const tl = audioTlOf(a, b);
      if (tl < a.start || tl > a.end) continue;
      const bx = Math.round(X(tl)) + 0.5;
      const strong = bt.strong?.includes(b);
      ctx.strokeStyle = strong ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.35)';
      ctx.beginPath(); ctx.moveTo(bx, r.y + 3); ctx.lineTo(bx, r.y + (strong ? r.h - 3 : 12)); ctx.stroke();
    }
  }
  ctx.restore();
  rr(x + 0.5, r.y + 3, w - 1, r.h - 6, 6);
  ctx.strokeStyle = sel ? '#fff' : color;
  ctx.lineWidth = sel ? 2 : 1;
  ctx.stroke();
  ctx.lineWidth = 1;
  const name = S.project.media.find((m) => m.id === a.media)?.name || '';
  label(({ sfx: '🔊 ', voice: '🎙 ' }[a.kind] || '♪ ') + name, x, r.y + 12, w);
}

/** Биты всех треков в координатах таймлайна (для прилипания и линейки). */
export function beatTimes() {
  const out = [];
  for (const a of audioItems()) {
    const bt = S.project.beats?.[a.media];
    if (!bt?.beats) continue;
    for (const b of bt.beats) {
      const t = audioTlOf(a, b);
      if (t >= a.start && t <= a.end) out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
//   Попадание
// ---------------------------------------------------------------------------
function hitTest(mx, my) {
  if (my < RULER) return { type: 'ruler' };
  const r = rows.find((x) => my >= x.y && my < x.y + x.h);
  if (!r || mx < LEFT) return { type: 'empty' };
  const t = T(mx);
  const edgeOf = (s, e) => (Math.abs(mx - X(s)) <= EDGE ? 'l' : Math.abs(mx - X(e)) <= EDGE ? 'r' : null);
  const within = (s, e) => mx >= X(s) - EDGE && mx <= X(e) + EDGE && (mx >= X(s) && mx <= X(e) || edgeOf(s, e));
  if (r.key === 'parts') {
    const cuts = [...S.project.parts.cuts].sort((a, b) => a - b);
    const i = cuts.findIndex((c) => Math.abs(X(c) - mx) <= EDGE);
    return i >= 0 ? { type: 'cut', id: 'c' + i, index: i, row: r } : { type: 'parts', row: r };
  }
  if (r.key === 'video') {
    const list = clipsTL();
    // ромбик перехода
    for (let j = 1; j < list.length; j++) {
      if (Math.abs(mx - X(list[j].start)) <= 7 && Math.abs(my - transY(r)) <= 8) return { type: 'trans', id: list[j].id, row: r };
    }
    const c = list.find((x) => t >= x.start && t < x.end) || list.find((x) => Math.abs(X(x.end) - mx) <= EDGE);
    if (c) return { type: 'clip', id: c.id, edge: edgeOf(c.start, c.end), row: r };
    return { type: 'empty', row: r };
  }
  if (r.key === 'effects') {
    const fl = lanes(S.project.effects);
    const e = S.project.effects.find((x) => fl.lane[x.id] === r.lane && within(x.start, x.end));
    return e ? { type: 'effect', id: e.id, edge: edgeOf(e.start, e.end), row: r } : { type: 'empty', row: r };
  }
  if (r.key === 'ads') {
    const ad = adPlacements().find((x) => within(x.start, x.end));
    // правый край — длина ролика (тянуть)
    return ad ? { type: 'ad', id: 'ads', start: ad.start, ad, edge: edgeOf(ad.start, ad.end) === 'r' ? 'r' : null, row: r } : { type: 'empty', row: r };
  }
  if (r.key === 'audio') {
    const items = audioItems();
    const al = lanes(items);
    const a = items.find((x) => al.lane[x.id] === r.lane && within(x.start, x.end));
    return a ? { type: 'audio', id: a.id, edge: edgeOf(a.start, a.end), row: r } : { type: 'empty', row: r };
  }
  const items = renderItems();
  let cand = [];
  if (r.key === 'subs') cand = items.filter((it) => it.kind === 'sub');
  if (r.key === 'headers') cand = items.filter((it) => it.kind === 'header');
  if (r.key === 'text') {
    const tl = lanes(freeTexts());
    cand = items.filter((it) => it.kind === 'text' && tl.lane[it.id] === r.lane);
  }
  const hit = cand.find((it) => within(it.start, it.end));
  if (hit) return hit.kind === 'header' ? { type: 'header', id: hit.id, row: r } : { type: 'text', id: hit.id, edge: edgeOf(hit.start, hit.end), row: r };
  return { type: 'empty', row: r };
}

/** Что на таймлайне под точкой экрана (для меню по правому клику) и какое там время. */
export function hitAtClient(clientX, clientY) {
  const r = cv.getBoundingClientRect();
  const mx = clientX - r.left, my = clientY - r.top;
  return { ...hitTest(mx, my), t: clamp(T(mx), 0, duration()) };
}

/** Точки магнита: стыки клипов, края переходов, границы частей, края текстов/эффектов/треков, биты. */
function snapPoints(exclude = [], withPlayhead = true) {
  const pts = [0, duration(), ...beatTimes()];
  if (withPlayhead) pts.push(S.t);
  const list = clipsTL();
  list.forEach((c, j) => {
    pts.push(c.start, c.end);
    const d = transitionDur(list, j);
    if (d) pts.push(c.start - d / 2, c.start + d / 2); // начало и конец перехода
  });
  S.project.parts.cuts.forEach((c) => pts.push(c));
  for (const it of renderItems()) if (!exclude.includes(it.id)) pts.push(it.start, it.end);
  for (const e of S.project.effects) if (!exclude.includes(e.id)) pts.push(e.start, e.end);
  for (const a of audioItems()) if (!exclude.includes(a.id)) pts.push(a.start, a.end);
  return pts;
}

function snap(t, pts, px = 8) {
  if (!S.snap) return t;
  let best = t, bd = px / S.zoom;
  for (const p of pts) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } }
  return best;
}

// магнит курсора: при перемотке/прокрутке курсор «щёлкает» к стыкам и краям (+ вибрация на Android)
let lastSnapTo = null;
function snapPlayhead(t) {
  const s = snap(t, snapPoints([], false), S.mobile ? 10 : 6);
  if (s !== t && s !== lastSnapTo) navigator.vibrate?.(8);
  lastSnapTo = s !== t ? s : null;
  return s;
}

/** Добавлять к выделению: Ctrl/Shift/⌘ или режим «Несколько» на телефоне. */
const additive = (e) => e.shiftKey || e.ctrlKey || e.metaKey || !!S.multi;

/** Объекты внутри рамки выделения (координаты холста таймлайна). */
function itemsInRect(x0, x1, y0, y1) {
  const t0 = T(x0), t1 = T(x1);
  const hitRow = (r) => r && r.y < y1 && r.y + r.h > y0;
  const overlaps = (s, e) => e > t0 && s < t1;
  const out = [];
  const tl = lanes(freeTexts()), fl = lanes(S.project.effects), al = lanes(audioItems());
  for (const it of renderItems()) {
    if (!overlaps(it.start, it.end)) continue;
    const r = it.kind === 'sub' ? rows.find((x) => x.key === 'subs') : it.kind === 'header' ? null : rows.find((x) => x.key === 'text' && x.lane === tl.lane[it.id]);
    if (hitRow(r)) out.push({ kind: 'text', id: it.id });
  }
  for (const e of S.project.effects) if (overlaps(e.start, e.end) && hitRow(rows.find((x) => x.key === 'effects' && x.lane === fl.lane[e.id]))) out.push({ kind: 'effect', id: e.id });
  for (const a of audioItems()) if (overlaps(a.start, a.end) && hitRow(rows.find((x) => x.key === 'audio' && x.lane === al.lane[a.id]))) out.push({ kind: 'audio', id: a.id });
  if (hitRow(rows.find((x) => x.key === 'video'))) for (const c of clipsTL()) if (overlaps(c.start, c.end)) out.push({ kind: 'clip', id: c.id });
  return out;
}

/** Что выделит рамка: задетые объекты плюс то, что было выделено до неё (если добавляем). */
function marqueeItems(op) {
  const m = S.marquee;
  const found = itemsInRect(Math.min(m.x0, m.x1), Math.max(m.x0, m.x1), Math.min(m.y0, m.y1), Math.max(m.y0, m.y1));
  const seen = new Set(found.map((it) => `${it.kind}:${it.id}`));
  return [...(op.base || []).filter((it) => !seen.has(`${it.kind}:${it.id}`)), ...found];
}

// элементы, которые двигаются и тянутся одинаково: текст, эффект, звук
const movable = {
  text: { list: (p) => p.texts, get: (x) => ({ s: x.start, e: x.end }),
    set: (x, s, e) => { x.start = s; x.end = e; } },
  effect: { list: (p) => p.effects, get: (x) => ({ s: x.start, e: x.end }),
    set: (x, s, e) => { x.start = s; x.end = e; } },
  // у дорожки со скоростью секунда таймлайна = speed секунд исходника
  audio: { list: (p) => p.audio, get: (x) => ({ s: x.start, e: x.start + audioLen(x), in: x.in, out: x.out }),
    set: (x, s, e, o, edge) => {
      const md = mediaDuration(x.media) ?? Infinity, sp = audioSpeed(x);
      if (edge === 'l') { const d = (s - o.s) * sp; x.in = clamp(o.in + d, 0, o.out - 0.1); x.start = o.s + (x.in - o.in) / sp; }
      else if (edge === 'r') { x.out = clamp(o.out + (e - o.e) * sp, x.in + 0.1, md); }
      else x.start = s;
    } },
};

// ---------------------------------------------------------------------------
//   Мышь / палец
// ---------------------------------------------------------------------------
const pointers = new Map();
let pinch = null;

cv.addEventListener('pointermove', (e) => {
  if (e.buttons || e.pointerType === 'touch') return;
  const r = cv.getBoundingClientRect();
  const h = hitTest(e.clientX - r.left, e.clientY - r.top);
  cv.style.cursor = h.edge || h.type === 'cut' ? 'ew-resize' : ['text', 'clip', 'header', 'effect', 'audio', 'trans', 'ad'].includes(h.type) ? 'pointer' : 'default';
});

cv.addEventListener('pointerdown', (e) => {
  if (!S.project || (e.button !== 0 && e.pointerType === 'mouse')) return;
  pointers.set(e.pointerId, e);
  try { cv.setPointerCapture(e.pointerId); } catch { /* палец уже отпущен */ }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.abs(a.clientX - b.clientX), zoom: S.zoom };
    return;
  }
  const r = cv.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const h = hitTest(mx, my);
  const t0 = T(mx);
  const touch = e.pointerType === 'touch';
  let op = null;

  const already = h.id && isSelected(h.type === 'trans' ? 'clip' : h.type, h.id);
  if (touch && centered() && S.multi && h.type === 'empty') {
    // режим «Несколько»: палец по пустому месту рисует рамку — выделяется всё, что она задела
    if (S.playing) stopPlayback();
    op = { kind: 'marquee', add: true, base: selItems() };
  } else if (touch && centered() && (['empty', 'parts', 'ruler'].includes(h.type) || (!already && ['clip', 'text', 'effect', 'audio'].includes(h.type)))) {
    // палец по пустому месту или по невыделенному элементу — прокрутка ленты (как в CapCut);
    // в режиме «Несколько» касание добавляет объект к выделению
    if (h.id && h.type !== 'trans' && h.type !== 'header') select(h.type, [h.id], !!S.multi);
    else if (h.type !== 'ruler' && !S.multi) select(null);
    if (S.playing) stopPlayback();
    op = { kind: 'pan', t: S.t, x: e.clientX };
  } else if (h.type === 'empty' && !touch) {
    // пустое место дорожек: клик — перемотка, протяжка — рамка выделения
    if (S.playing) stopPlayback();
    op = { kind: 'marquee', add: additive(e), base: additive(e) ? selItems() : [] };
  } else if (h.type === 'ruler' || h.type === 'empty' || h.type === 'parts') {
    if (h.type !== 'ruler') select(null);
    if (S.playing) stopPlayback();
    seek(Math.max(0, snapPlayhead(t0)));
    op = { kind: 'scrub' };
  } else if (h.type === 'trans') {
    select('clip', [h.id]);
    emit('edit-transition', h.id);
  } else if (h.type === 'cut') {
    select('cut', [h.id]);
    const cuts = [...S.project.parts.cuts].sort((a, b) => a - b);
    op = { kind: 'cut', index: h.index, cuts, orig: cuts[h.index] };
    beginEdit();
  } else if (h.type === 'ad') {
    // реклама ставится сама — клик показывает её и открывает настройки справа
    select('ad', ['ads']);
    if (h.edge) {
      // тянем правый край — меняется длина этого ролика (во всех его вставках)
      const md = S.project.media.find((m) => m.id === h.ad.media)?.duration ?? 600;
      const sp = h.ad.speed || 1; // длина на экране = отрезок ролика / скорость
      op = { kind: 'adlen', item: h.ad.item, len0: h.ad.end - h.ad.start, srcIn: h.ad.srcIn, sp, max: h.ad.kind === 'image' ? 60 : (md - h.ad.srcIn) / sp };
      beginEdit();
    } else if (h.ad.insert) peekAd(h.ad, 0.5); // вставка: видео стоит в её точке, показываем ролик
    else { if (S.playing) stopPlayback(); seek(h.start + 0.4); }
  } else if (h.type === 'header') {
    select('header', [h.id], e.shiftKey);
    const part = parts().find((p) => 'h' + p.i === h.id);
    if (part && !e.shiftKey) seek(part.start + 0.01);
  } else if (movable[h.type]) {
    const add = additive(e);
    const was = isSelected(h.type, h.id);
    if (add) select(h.type, [h.id], true);
    else if (!was) select(h.type, [h.id]);
    // тянем всю группу выделенных (тексты, эффекты, звуки — вместе)
    const items = selItems().filter((x) => movable[x.kind]);
    if (items.some((x) => x.kind === h.type && x.id === h.id)) {
      const orig = {};
      for (const x of items) {
        const o = movable[x.kind].list(S.project).find((y) => y.id === x.id);
        if (o) orig[`${x.kind}:${x.id}`] = movable[x.kind].get(o);
      }
      op = { kind: 'item', type: h.type, edge: add || items.length > 1 ? null : h.edge, id: h.id, key: `${h.type}:${h.id}`,
        orig, pts: snapPoints(items.map((x) => x.id)), collapse: was && !add && items.length > 1 };
      beginEdit();
    }
  } else if (h.type === 'clip') {
    select('clip', [h.id], additive(e));
    if (h.edge) {
      const c = S.project.clips.find((x) => x.id === h.id);
      const start = clipStart(S.project, h.id), end = start + clipDur(c);
      // точки магнита — один раз, без краёв самого клипа (иначе край прилипал бы сам к себе)
      const pts = snapPoints([]).filter((p) => Math.abs(p - start) > 1e-4 && Math.abs(p - end) > 1e-4);
      op = { kind: 'clip-trim', edge: h.edge, id: h.id, inn: c.in, out: c.out, start, end, pts, clip0: structuredClone(c) };
      beginEdit();
    } else {
      // клик — перемотка; потянуть — переставить клип между другими (как в CapCut)
      seek(Math.max(0, t0));
      const c = clipsTL().find((x) => x.id === h.id);
      op = additive(e) || !c ? { kind: 'scrub' } : { kind: 'clip-move', id: h.id, grab: t0 - c.start, w: c.end - c.start, from: S.project.clips.findIndex((x) => x.id === h.id), active: false };
    }
  }
  request();
  if (!op) return;

  let moved = false;
  const onMove = (ev) => {
    pointers.set(ev.pointerId, ev);
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      setZoom(pinch.zoom * Math.max(0.1, Math.abs(a.clientX - b.clientX)) / Math.max(10, pinch.d));
      return;
    }
    const x = ev.clientX - r.left;
    const t = T(x);
    const dt = (op.kind === 'pan' ? 0 : t - t0);
    if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
    moved = true;
    if (op.kind === 'pan') { seek(snapPlayhead(clamp(op.t - (ev.clientX - op.x) / S.zoom, 0, duration()))); return; }
    if (!centered()) autoScroll(x);
    if (op.kind === 'scrub') { seek(snapPlayhead(clamp(t, 0, duration()))); return; }
    if (op.kind === 'cut') {
      const prev = op.index > 0 ? op.cuts[op.index - 1] : 0;
      const next = op.index < op.cuts.length - 1 ? op.cuts[op.index + 1] : duration();
      const v = snapFrame(clamp(snap(op.orig + dt, snapPoints()), prev + 1, next - 1));
      updateEdit((p) => { const c = [...op.cuts]; c[op.index] = v; p.parts.cuts = c; });
      return;
    }
    if (op.kind === 'clip-move') {
      if (!op.active && Math.abs(ev.clientX - e.clientX) < 6) return;
      if (!op.active && S.playing) stopPlayback();
      op.active = true;
      // куда встанет: среди остальных клипов — по середине перетаскиваемого
      const others = clipsTL().filter((c) => c.id !== op.id);
      const left = t - op.grab, mid = left + op.w / 2;
      let acc = 0, index = 0;
      for (const c of others) { const d = c.end - c.start; if (acc + d / 2 < mid) index++; acc += d; }
      const boundary = index < others.length ? others[index].start : (others.at(-1)?.end ?? 0);
      S.clipDrag = { id: op.id, left, w: op.w, index, boundary };
      op.index = index;
      request();
      return;
    }
    if (op.kind === 'adlen') {
      const len = clamp(op.len0 + dt, 0.5, op.max);
      updateEdit((p) => {
        const it = p.ads.items.find((i) => i.id === op.item);
        if (it) it.trimOut = +(op.srcIn + len * op.sp).toFixed(2);
        p.ads.maxDur = 0; // длину задаёт сам ролик
      });
      return;
    }
    if (op.kind === 'item') {
      const M = movable[op.type];
      const o = op.orig[op.key];
      if (op.edge) {
        updateEdit((p) => {
          const x0 = M.list(p).find((x) => x.id === op.id);
          if (op.edge === 'l') M.set(x0, snapFrame(clamp(snap(o.s + dt, op.pts), 0, o.e - 0.1)), o.e, o, 'l');
          else M.set(x0, o.s, snapFrame(Math.max(o.s + 0.1, snap(o.e + dt, op.pts))), o, 'r');
        });
      } else {
        let ns = snap(o.s + dt, op.pts);
        const ne = snap(o.e + dt, op.pts);
        if (ns === o.s + dt && ne !== o.e + dt) ns = ne - (o.e - o.s);
        let d = snapFrame(ns) - o.s;
        d = Math.max(d, -Math.min(...Object.values(op.orig).map((v) => v.s)));
        updateEdit((p) => {
          for (const [key, ov] of Object.entries(op.orig)) {
            const i = key.indexOf(':');
            const kind = key.slice(0, i), id = key.slice(i + 1);
            const x0 = movable[kind].list(p).find((y) => y.id === id);
            if (x0) movable[kind].set(x0, ov.s + d, ov.e + d, ov);
          }
        });
      }
      return;
    }
    if (op.kind === 'marquee') {
      S.marquee = { x0: mx, y0: my, x1: x, y1: ev.clientY - r.top };
      // выделение обновляется сразу, пока тянешь: считается всё, что рамка хоть немного задела
      const found = marqueeItems(op);
      const sig = found.map((it) => `${it.kind}:${it.id}`).join(',');
      if (sig !== op.sig) { op.sig = sig; selectItems(found); }
      request();
      return;
    }
    if (op.kind === 'clip-trim') {
      updateEdit((p) => {
        if (op.clip0.freeze) {
          // стоп-кадр: край меняет только его длину
          const d = op.edge === 'l' ? op.end - snap(op.start + dt, op.pts) : snap(op.end + dt, op.pts) - op.start;
          setFreezeDur(p, op.id, d);
          return;
        }
        // сдвиг края по таймлайну переводим в секунды исходника через скорость клипа (как он был до начала перетаскивания)
        if (op.edge === 'l') {
          const st = snap(op.start + dt, op.pts);
          setClipIn(p, op.id, op.inn + srcOffset(op.clip0, st - op.start));
        } else {
          const endT = snap(op.end + dt, op.pts);
          setClipOut(p, op.id, op.inn + srcOffset(op.clip0, endT - op.start), mediaDuration(op.clip0.media));
        }
      });
    }
  };
  const onUp = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size) return;
    pinch = null;
    cv.removeEventListener('pointermove', onMove);
    cv.removeEventListener('pointerup', onUp);
    cv.removeEventListener('pointercancel', onUp);
    if (op.kind === 'marquee') {
      if (moved && S.marquee) {
        selectItems(marqueeItems(op));
      } else if (!touch) {
        // просто клик по пустому месту — перемотка и снять выделение
        if (!op.add) select(null);
        seek(Math.max(0, snapPlayhead(t0)));
      }
      S.marquee = null;
    }
    if (op.kind === 'item' && !moved && op.collapse) select(op.type, [op.id]); // клик по объекту из группы — выделить только его
    if (op.kind === 'clip-move') {
      S.clipDrag = null;
      if (op.active && op.index !== op.from) { moveClip(op.id, op.index); select('clip', [op.id]); }
    }
    if (!['scrub', 'pan', 'marquee', 'clip-move'].includes(op.kind)) endEdit();
    request();
  };
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
});

cv.addEventListener('pointerup', (e) => { pointers.delete(e.pointerId); if (!pointers.size) pinch = null; });

cv.addEventListener('dblclick', (e) => {
  const r = cv.getBoundingClientRect();
  const h = hitTest(e.clientX - r.left, e.clientY - r.top);
  if (h.type === 'parts') addCut(T(e.clientX - r.left));
  if (h.type === 'text' || h.type === 'header') emit('focus-text');
});

cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const mx = e.clientX - r.left;
  if (e.ctrlKey || e.metaKey) {
    const tAt = T(mx);
    setZoom(S.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    if (!centered()) S.scroll = Math.max(0, tAt - (mx - LEFT) / S.zoom);
  } else if (centered()) {
    seek(clamp(S.t + (e.deltaX || e.deltaY) / S.zoom, 0, duration()));
  } else {
    S.scroll = Math.max(0, S.scroll + (e.deltaX || e.deltaY) / S.zoom);
  }
  request();
}, { passive: false });

function autoScroll(x) {
  if (x > W - 30) S.scroll += 20 / S.zoom;
  if (x < LEFT + 10) S.scroll = Math.max(0, S.scroll - 20 / S.zoom);
}

// ---------------------------------------------------------------------------
//   Масштаб
// ---------------------------------------------------------------------------
const ZMIN = 1.5, ZMAX = 600;
const zoomSlider = document.getElementById('tl-zoom');
export function setZoom(z) {
  S.zoom = clamp(z, ZMIN, ZMAX);
  if (zoomSlider) zoomSlider.value = Math.round(100 * Math.log(S.zoom / ZMIN) / Math.log(ZMAX / ZMIN));
  request();
}
zoomSlider?.addEventListener('input', () => {
  const center = T(LEFT + (W - LEFT) / 2);
  S.zoom = ZMIN * Math.pow(ZMAX / ZMIN, zoomSlider.value / 100);
  if (!centered()) S.scroll = Math.max(0, center - (W - LEFT) / 2 / S.zoom);
  request();
});

export function fitAll() {
  const d = duration();
  if (d > 0 && W > LEFT) { setZoom((W - LEFT - 40) / d * (centered() ? 0.5 : 1)); S.scroll = 0; }
}

on('time', () => {
  const x = X(S.t);
  if (!centered() && S.playing && (x > W - 40 || x < LEFT)) S.scroll = Math.max(0, S.t - (W - LEFT) * 0.15 / S.zoom);
  request();
});
on('change', request);
on('selection', request);
on('media-ready', request);
on('layout', resize);
new ResizeObserver(resize).observe(body);
