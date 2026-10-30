// Обложки частей («аватарки» видео) в разных стилях + карточка истории поверх видео в начале части.
// Рисуется на 2D-холсте в координатах кадра (W×H), k — масштаб вывода. Превью и экспорт — этим же кодом.
import { S, cssFont, emit } from '../store.js';
import { metrics } from './text.js';

/** blur — фон обложки: размытый кадр (true) или сам кадр, слегка притемнённый (false). */
export const COVER_STYLES = {
  badge: { label: 'Бейдж', blur: true },
  cs2: { label: 'CS2 / игры', blur: true },
  reddit: { label: 'Reddit-история', blur: true },
  number: { label: 'Большая цифра', blur: true },
  clean: { label: 'Чистая', blur: false },
  cinema: { label: 'Кино', blur: true },
};

// ---------------------------------------------------------------------------
//   Аватарка: картинка (data URL) грузится один раз; пока грузится — кружок с буквой
// ---------------------------------------------------------------------------
const imgs = new Map();
function avatarEntry(src) {
  let e = imgs.get(src);
  if (!e) {
    const im = new Image();
    e = { im, ready: false };
    e.p = new Promise((resolve) => {
      im.onload = () => { e.ready = true; resolve(); emit('cover-asset'); };
      im.onerror = () => resolve();
    });
    imgs.set(src, e);
    im.src = src;
  }
  return e;
}
/** Дождаться картинок обложки (перед экспортом). */
export async function coverAssetsReady() {
  const src = S.project?.covers?.avatar;
  if (src) await avatarEntry(src).p;
}

/** Картинка → квадратная аватарка 256×256 JPEG (data URL), обрезка по центру. */
export async function makeAvatar(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.86);
}

function drawAvatar(ctx, cv, x, y, d) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
  ctx.clip();
  const e = cv.avatar ? avatarEntry(cv.avatar) : null;
  if (e?.ready) ctx.drawImage(e.im, x, y, d, d);
  else {
    const g = ctx.createLinearGradient(x, y, x + d, y + d);
    g.addColorStop(0, cv.accent || '#7c5cff');
    g.addColorStop(1, '#222');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, d, d);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(d * 0.5)}px "${cssFont('Rubik-700')}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((cv.nick || cv.title || '?').replace(/^[@u/]+/, '').trim().charAt(0).toUpperCase() || '?', x + d / 2, y + d / 2 + d * 0.03);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
//   Общие кусочки
// ---------------------------------------------------------------------------
const fam = (font) => `"${cssFont(font)}"`;

function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let cur = [];
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const test = [...cur, w].join(' ');
      if (cur.length && ctx.measureText(test).width > maxW) { lines.push(cur.join(' ')); cur = [w]; } else cur.push(w);
    }
    if (cur.length) lines.push(cur.join(' '));
  }
  return lines.length ? lines : [''];
}

/** Текст, подобранный по размеру: уменьшается, пока не влезет в maxLines строк. */
function fitLines(ctx, text, font, size, maxW, maxLines, gap = 0.06) {
  let s = size, lines;
  for (;;) {
    ctx.font = `${Math.round(s)}px ${fam(font)}`;
    lines = wrap(ctx, text, maxW);
    // длинное слово не переносится — тогда уменьшаем шрифт, пока строка не влезет по ширине
    const fits = lines.length <= maxLines && Math.max(...lines.map((l) => ctx.measureText(l).width)) <= maxW;
    if (fits || s < size * 0.35) break;
    s *= 0.9;
  }
  return { lines, size: Math.round(s), m: metrics({ font, size: Math.round(s), lineGap: gap }) };
}

function badgeText(cv) {
  if (cv.final) return '★ ФИНАЛ ★';
  return (cv.label || '').replace(/[()]/g, '').trim().toUpperCase() || (cv.partNo ? `ЧАСТЬ ${cv.partNo}` : '');
}

/** Название: белое с обводкой и тенью, по центру. Возвращает нижнюю границу. */
function drawTitle(ctx, lines, m, size, cx, y, { color = '#fff', stroke = '#000', shadow = true } = {}) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  for (const line of lines) {
    const base = y + m.asc;
    if (shadow) { ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillText(line, cx + size * 0.05, base + size * 0.06); }
    if (stroke) { ctx.lineWidth = Math.max(4, size / 7); ctx.strokeStyle = stroke; ctx.strokeText(line, cx, base); }
    ctx.fillStyle = color;
    ctx.fillText(line, cx, base);
    y += m.lh;
  }
  return y;
}

/** Подпись канала внизу: аватарка + ник (если заданы). */
function drawChannel(ctx, cv, W, H, minDim) {
  if (!cv.avatar && !cv.nick) return;
  const d = minDim * 0.1, size = Math.round(minDim * 0.04);
  ctx.font = `${size}px ${fam('Rubik-700')}`;
  const nick = cv.nick || '';
  const tw = nick ? ctx.measureText(nick).width + minDim * 0.03 : 0;
  const x0 = (W - d - tw) / 2, y0 = H - minDim * 0.1 - d - (H > W ? H * 0.06 : 0);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 12;
  drawAvatar(ctx, cv, x0, y0, d);
  ctx.restore();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, d * 0.04);
  ctx.beginPath(); ctx.arc(x0 + d / 2, y0 + d / 2, d / 2, 0, Math.PI * 2); ctx.stroke();
  if (nick) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
    ctx.strokeText(nick, x0 + d + minDim * 0.03, y0 + d / 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(nick, x0 + d + minDim * 0.03, y0 + d / 2);
  }
}

// ---------------------------------------------------------------------------
//   Стили
// ---------------------------------------------------------------------------
function badge(ctx, cv, W, H, minDim) {
  const t = fitLines(ctx, cv.title.toUpperCase(), cv.font, minDim * 0.085, W * 0.86, 5);
  const badgeSize = Math.round(minDim * 0.058);
  const bt = badgeText(cv);
  ctx.font = `${badgeSize}px ${fam(cv.font)}`;
  const bw = ctx.measureText(bt).width, bm = metrics({ font: cv.font, size: badgeSize });
  const padX = minDim * 0.05, padY = minDim * 0.022;
  const badgeW = bw + padX * 2, badgeH = bm.lh * 0.82 + padY * 2;
  const gap = minDim * 0.045;
  const top = (H - (badgeH + gap + t.m.lh * t.lines.length)) / 2;
  ctx.fillStyle = cv.final ? '#FFB900' : cv.accent || '#EB2D41';
  ctx.beginPath();
  ctx.roundRect((W - badgeW) / 2, top, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.fillStyle = cv.final ? '#141414' : '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(bt, W / 2, top + badgeH / 2 + badgeSize * 0.04);
  ctx.font = `${t.size}px ${fam(cv.font)}`;
  drawTitle(ctx, t.lines, t.m, t.size, W / 2, top + badgeH + gap);
  drawChannel(ctx, cv, W, H, minDim);
}

/** CS2 / игры: прицел, косая плашка с номером, HUD-уголки вокруг названия. */
function cs2(ctx, cv, W, H, minDim) {
  const accent = cv.final ? '#FFB900' : cv.accent || '#F5A524';
  const t = fitLines(ctx, cv.title.toUpperCase(), cv.font, minDim * 0.09, W * 0.82, 4, 0.16);
  const titleH = t.m.lh * t.lines.length - t.m.gap;
  const bs = Math.round(minDim * 0.06);
  const bt = badgeText(cv);
  ctx.font = `${bs}px ${fam(cv.font)}`;
  const bw = ctx.measureText(bt).width + minDim * 0.12, bh = bs * 1.55;
  const cross = minDim * 0.09, gap = minDim * 0.07;
  const total = cross + gap + bh + gap + titleH;
  let y = (H - total) / 2;
  // прицел
  const cx = W / 2, cy = y + cross / 2, L = cross * 0.32, g = cross * 0.12;
  ctx.strokeStyle = '#7CFF6B'; ctx.lineWidth = Math.max(3, minDim * 0.007); ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(cx - g - L, cy); ctx.lineTo(cx - g, cy); ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g + L, cy);
  ctx.moveTo(cx, cy - g - L); ctx.lineTo(cx, cy - g); ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + g + L);
  ctx.stroke();
  ctx.fillStyle = '#7CFF6B';
  ctx.beginPath(); ctx.arc(cx, cy, ctx.lineWidth * 0.7, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  y += cross + gap;
  // косая плашка
  const sk = bh * 0.35;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(cx - bw / 2 + sk, y); ctx.lineTo(cx + bw / 2 + sk, y); ctx.lineTo(cx + bw / 2 - sk, y + bh); ctx.lineTo(cx - bw / 2 - sk, y + bh);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(bt, cx, y + bh / 2 + bs * 0.05);
  y += bh + gap;
  // название + HUD-уголки
  ctx.font = `${t.size}px ${fam(cv.font)}`;
  const tw = Math.max(...t.lines.map((l) => ctx.measureText(l).width));
  const pad = minDim * 0.05, x0 = cx - tw / 2 - pad, x1 = cx + tw / 2 + pad, y0 = y - pad * 0.7, y1 = y + titleH + pad * 0.7;
  const c = minDim * 0.05;
  ctx.strokeStyle = accent; ctx.lineWidth = Math.max(4, minDim * 0.009); ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(x0, y0 + c); ctx.lineTo(x0, y0); ctx.lineTo(x0 + c, y0);
  ctx.moveTo(x1 - c, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + c);
  ctx.moveTo(x1, y1 - c); ctx.lineTo(x1, y1); ctx.lineTo(x1 - c, y1);
  ctx.moveTo(x0 + c, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - c);
  ctx.stroke();
  drawTitle(ctx, t.lines, t.m, t.size, cx, y);
  drawChannel(ctx, cv, W, H, minDim);
}

/** Сердечко для нижней строки карточки. */
function heart(ctx, x, y, s, color) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, s * 0.12); ctx.lineJoin = 'round';
  // сердце
  ctx.beginPath();
  ctx.moveTo(x + s / 2, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 0.15, y + s * 0.4, x + s * 0.1, y - s * 0.1, x + s / 2, y + s * 0.25);
  ctx.bezierCurveTo(x + s * 0.9, y - s * 0.1, x + s * 1.15, y + s * 0.4, x + s / 2, y + s * 0.9);
  ctx.stroke();
  return s;
}

/** Карточка истории (как пост): аватарка, ник, бейдж части, заголовок, строка реакций. */
export function drawStoryCard(ctx, cv, W, H, { cx = W / 2, cy = H / 2, scale = 1, alpha = 1 } = {}) {
  const minDim = Math.min(W, H);
  const dark = cv.theme === 'dark';
  const bg = dark ? '#1A1A1B' : '#FFFFFF', fg = dark ? '#E8E8EA' : '#111111', sub = dark ? '#8A8D91' : '#7A7A7A';
  const cw = Math.min(W * 0.86, minDim * 0.9 * (W > H ? 1.1 : 1));
  const pad = minDim * 0.045, av = minDim * 0.1;
  const font = cv.font || 'Onest-700';
  const t = fitLines(ctx, cv.title, font, minDim * 0.056, cw - pad * 2, 7);
  const titleH = t.m.lh * t.lines.length;
  const footH = minDim * 0.05;
  const ch = pad + av + pad * 0.7 + titleH + pad * 0.6 + footH + pad;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cw / 2, -ch / 2);
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = minDim * 0.04; ctx.shadowOffsetY = minDim * 0.01;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(0, 0, cw, ch, minDim * 0.035); ctx.fill();
  ctx.shadowColor = 'transparent';
  // шапка
  drawAvatar(ctx, cv, pad, pad, av);
  const nickSize = Math.round(minDim * 0.036);
  ctx.font = `${nickSize}px ${fam('Onest-700')}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  const nx = pad + av + pad * 0.5;
  ctx.fillText(cv.nick || 'u/рассказчик', nx, pad + av * 0.36);
  // «награды» — три цветных кружка
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = ['#FFB900', '#46D160', '#24A0ED'][i];
    ctx.beginPath(); ctx.arc(nx + nickSize * 0.45 + i * nickSize * 1.05, pad + av * 0.78, nickSize * 0.4, 0, Math.PI * 2); ctx.fill();
  }
  const bt = badgeText(cv);
  if (bt) {
    const bs = Math.round(minDim * 0.03);
    ctx.font = `${bs}px ${fam('Onest-700')}`;
    const bw = ctx.measureText(bt).width + bs * 1.4, bh = bs * 1.8;
    ctx.fillStyle = cv.final ? '#FFB900' : cv.accent || '#FF4500';
    ctx.beginPath(); ctx.roundRect(cw - pad - bw, pad + (av - bh) / 2, bw, bh, bh / 2); ctx.fill();
    ctx.fillStyle = cv.final ? '#141414' : '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(bt, cw - pad - bw / 2, pad + av / 2 + bs * 0.05);
  }
  // заголовок
  let y = pad + av + pad * 0.7;
  ctx.font = `${t.size}px ${fam(font)}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = fg;
  for (const line of t.lines) { ctx.fillText(line, pad, y + t.m.asc); y += t.m.lh; }
  // реакции
  y += pad * 0.6;
  const s = footH * 0.62, fs = Math.round(footH * 0.55);
  ctx.font = `${fs}px ${fam('Onest-700')}`;
  ctx.textBaseline = 'middle';
  let x = pad;
  heart(ctx, x, y + (footH - s) / 2, s, sub);
  ctx.fillStyle = sub;
  ctx.fillText('99+', x + s * 1.35, y + footH / 2); x += s * 1.35 + ctx.measureText('99+').width + pad;
  // облачко комментариев
  ctx.lineWidth = Math.max(2, s * 0.12);
  ctx.beginPath(); ctx.roundRect(x, y + (footH - s) / 2, s, s * 0.78, s * 0.25); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + s * 0.25, y + (footH - s) / 2 + s * 0.78); ctx.lineTo(x + s * 0.2, y + (footH - s) / 2 + s); ctx.lineTo(x + s * 0.5, y + (footH - s) / 2 + s * 0.78); ctx.stroke();
  ctx.fillText('99+', x + s * 1.35, y + footH / 2); x += s * 1.35 + ctx.measureText('99+').width + pad;
  // поделиться
  ctx.beginPath(); ctx.moveTo(x, y + footH * 0.75); ctx.lineTo(x + s * 0.5, y + footH * 0.75 - s * 0.45); ctx.lineTo(x + s, y + footH * 0.75);
  ctx.moveTo(x + s * 0.5, y + footH * 0.75 - s * 0.45); ctx.lineTo(x + s * 0.5, y + footH * 0.75 + s * 0.15); ctx.stroke();
  ctx.fillText('Поделиться', x + s * 1.35, y + footH / 2);
  ctx.restore();
}

function reddit(ctx, cv, W, H) {
  drawStoryCard(ctx, cv, W, H);
}

/** Огромная цифра части, сверху «ЧАСТЬ», снизу название. */
function number(ctx, cv, W, H, minDim) {
  const accent = cv.final ? '#FFB900' : cv.accent || '#EB2D41';
  const big = cv.final ? 'ФИНАЛ' : String(cv.partNo || 1);
  let bigSize = minDim * (cv.final ? 0.2 : 0.42);
  ctx.font = `${Math.round(bigSize)}px ${fam(cv.font)}`;
  const bwid = ctx.measureText(big).width;
  if (bwid > W * 0.9) { bigSize *= (W * 0.9) / bwid; ctx.font = `${Math.round(bigSize)}px ${fam(cv.font)}`; }
  const bm = metrics({ font: cv.font, size: Math.round(bigSize) });
  const small = Math.round(minDim * 0.05);
  const t = fitLines(ctx, cv.title.toUpperCase(), cv.font, minDim * 0.07, W * 0.86, 4);
  const total = (cv.final ? 0 : small * 1.4) + bm.lh * 0.85 + t.m.lh * t.lines.length;
  let y = (H - total) / 2;
  ctx.textAlign = 'center';
  if (!cv.final) {
    ctx.font = `${small}px ${fam(cv.font)}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';
    ctx.letterSpacing = `${Math.round(small * 0.3)}px`;
    ctx.fillText('ЧАСТЬ', W / 2, y);
    ctx.letterSpacing = '0px';
    y += small * 1.4;
  }
  ctx.font = `${Math.round(bigSize)}px ${fam(cv.font)}`;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  const base = y + bm.asc * 0.92;
  ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillText(big, W / 2 + bigSize * 0.03, base + bigSize * 0.04);
  ctx.lineWidth = Math.max(6, bigSize / 14); ctx.strokeStyle = '#000'; ctx.strokeText(big, W / 2, base);
  ctx.fillStyle = accent; ctx.fillText(big, W / 2, base);
  y += bm.lh * 0.85;
  ctx.font = `${t.size}px ${fam(cv.font)}`;
  drawTitle(ctx, t.lines, t.m, t.size, W / 2, y);
  drawChannel(ctx, cv, W, H, minDim);
}

/** Чистая: кадр без размытия, название в белой плашке сверху, номер части под ней. */
function clean(ctx, cv, W, H, minDim) {
  const t = fitLines(ctx, cv.title, cv.font, minDim * 0.068, W * 0.78, 4);
  const pad = minDim * 0.035;
  ctx.font = `${t.size}px ${fam(cv.font)}`;
  const y0 = H > W ? H * 0.16 : H * 0.1;
  let y = y0;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  for (const line of t.lines) {
    const w = ctx.measureText(line).width;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.roundRect(W / 2 - w / 2 - pad, y - pad * 0.35, w + pad * 2, t.m.lh + pad * 0.7, pad * 0.6); ctx.fill();
    y += t.m.lh + pad * 0.1;
  }
  y = y0;
  ctx.fillStyle = '#111';
  for (const line of t.lines) { ctx.fillText(line, W / 2, y + t.m.asc); y += t.m.lh + pad * 0.1; }
  const bt = badgeText(cv);
  if (bt) {
    const bs = Math.round(minDim * 0.05);
    ctx.font = `${bs}px ${fam(cv.font)}`;
    const bw = ctx.measureText(bt).width + bs * 1.2, bh = bs * 1.6;
    y += pad;
    ctx.fillStyle = cv.final ? '#FFB900' : cv.accent || '#EB2D41';
    ctx.beginPath(); ctx.roundRect(W / 2 - bw / 2, y, bw, bh, bh * 0.3); ctx.fill();
    ctx.fillStyle = cv.final ? '#141414' : '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(bt, W / 2, y + bh / 2 + bs * 0.04);
  }
  drawChannel(ctx, cv, W, H, minDim);
}

/** Кино: чёрные полосы, название по центру, «ЧАСТЬ N» разреженными буквами между линиями. */
function cinema(ctx, cv, W, H, minDim) {
  const bar = H * (H > W ? 0.14 : 0.1);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, bar);
  ctx.fillRect(0, H - bar, W, bar);
  const t = fitLines(ctx, cv.title, cv.font, minDim * 0.08, W * 0.84, 4);
  const titleH = t.m.lh * t.lines.length;
  const small = Math.round(minDim * 0.032);
  const gap = minDim * 0.04;
  let y = (H - (titleH + gap + small)) / 2;
  ctx.font = `${t.size}px ${fam(cv.font)}`;
  y = drawTitle(ctx, t.lines, t.m, t.size, W / 2, y, { stroke: null });
  const bt = badgeText(cv).replace(/★/g, '').trim();
  if (bt) {
    y += gap;
    ctx.font = `${small}px ${fam('Onest-600')}`;
    ctx.letterSpacing = `${Math.round(small * 0.45)}px`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(bt).width;
    ctx.fillStyle = cv.final ? '#FFB900' : '#E9E3D6';
    ctx.fillText(bt, W / 2, y);
    ctx.letterSpacing = '0px';
    ctx.strokeStyle = 'rgba(233,227,214,.7)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - w / 2 - minDim * 0.14, y); ctx.lineTo(W / 2 - w / 2 - minDim * 0.03, y);
    ctx.moveTo(W / 2 + w / 2 + minDim * 0.03, y); ctx.lineTo(W / 2 + w / 2 + minDim * 0.14, y);
    ctx.stroke();
  }
  drawChannel(ctx, cv, W, H, minDim);
}

const DRAW = { badge, cs2, reddit, number, clean, cinema };

/** Обложка поверх фона (фон — размытый или обычный кадр — рисует движок). */
export function drawCover(ctx, cv, k, W, H) {
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  (DRAW[cv.style] || badge)(ctx, cv, W, H, Math.min(W, H));
  ctx.restore();
}

/** Карточка поверх видео в начале части: выпрыгивает и плавно уходит. */
export function drawCard(ctx, cv, k, W, H) {
  const inP = Math.min(1, cv.age / 0.28), outP = Math.min(1, (cv.dur - cv.age) / 0.3);
  const ease = 1 + 2.2 * Math.pow(inP - 1, 3) + 1.2 * Math.pow(inP - 1, 2);
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawStoryCard(ctx, cv, W, H, { cy: H * (cv.y ?? 0.5), scale: (0.82 + 0.18 * ease) * (0.92 + 0.08 * outP), alpha: Math.min(inP * 1.5, outP) });
  ctx.restore();
}
