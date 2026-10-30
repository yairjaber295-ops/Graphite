// Сведение звука для экспорта: звук клипов (с кроссфейдом на переходах) + музыка и звуки.
// Считается кусками через OfflineAudioContext — длинное видео не занимает память целиком.
import { S, clipsTL } from '../store.js';
import { clipGain, clipWindow } from './frame.js';
import { srcOffset, hasCurve } from './speed.js';
import { duckPoints } from '../smart.js';
import { adPlacements, adGain } from './ads.js';
import { hasAfx, makeChain, setChain } from './afx.js';
import { audioLen, audioSpeed, processedBuffer } from './audioproc.js';

export const SAMPLE_RATE = 48000;

/** Музыка (её приглушаем под голос); звуки и голосовые дорожки — нет. */
export const isMusic = (it) => it.kind !== 'sfx' && it.kind !== 'voice';

/** Громкость элемента аудиодорожки в момент t (громкость, плавное появление/затухание). */
export function itemGain(it, t) {
  const end = it.start + audioLen(it);
  let g = it.volume ?? 1;
  if (it.fadeIn > 0) g *= Math.max(0, Math.min(1, (t - it.start) / it.fadeIn));
  if (it.fadeOut > 0) g *= Math.max(0, Math.min(1, (end - t) / it.fadeOut));
  return g;
}

/** Куда подключать звук: в цепочку эффектов (если они есть у клипа/дорожки) или сразу на выход. */
function outNode(ctx, afx) {
  if (!hasAfx(afx)) return ctx.destination;
  const c = setChain(makeChain(ctx), afx);
  c.output.connect(ctx.destination);
  return c.input;
}

/** Огибающая громкости по точкам каждые 0,1 с (переходы, приглушение под рекламу). */
function envelope(param, gainAt, st, en, a) {
  param.setValueAtTime(gainAt(st), st - a);
  for (let x = st + 0.1; x < en; x += 0.1) param.linearRampToValueAtTime(gainAt(x), x - a);
  param.linearRampToValueAtTime(gainAt(en), en - a);
}

export class AudioMixer {
  /**
   * audioSink(mid) → Promise<AudioBufferSink|null> — потоковое чтение звука видео;
   * decoded(mid) → Promise<AudioBuffer|null> — целиком декодированная музыка/звук.
   */
  constructor({ audioSink, decoded }) {
    this.audioSink = audioSink;
    this.decoded = decoded;
  }

  async mix(a, b) {
    const len = Math.max(1, Math.round((b - a) * SAMPLE_RATE));
    const ctx = new OfflineAudioContext(2, len, SAMPLE_RATE);
    const list = clipsTL();
    for (let j = 0; j < list.length; j++) {
      const c = list[j];
      const [w0, w1] = clipWindow(list, j);
      if (w1 <= a || w0 >= b) continue;
      if (hasCurve(c) || (c.volume ?? 1) === 0) continue; // кривая скорости — без звука клипа (как в эдитах)
      const sink = await this.audioSink(c.media);
      if (!sink) continue;
      const from = Math.max(a, w0), to = Math.min(b, w1);
      const dest = outNode(ctx, c.afx); // бас, высокие, «телефон»… — одна цепочка на весь кусок клипа
      if (Math.abs((c.speed || 1) - 1) > 1e-6) {
        await this.stretched(ctx, sink, c, from, to, a, dest);
        continue;
      }
      const s0 = Math.max(0, c.in + (from - c.start)), s1 = Math.max(s0, c.in + (to - c.start));
      for await (const { buffer, timestamp } of sink.buffers(Math.max(0, s0 - 0.05), s1)) {
        const tt = c.start + (timestamp - c.in); // где этот кусок звука на таймлайне
        const st = Math.max(from, tt), en = Math.min(to, tt + buffer.duration);
        if (en - st <= 1e-4) continue;
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        const g = ctx.createGain();
        envelope(g.gain, (x) => clipGain(c, x), st, en, a);
        node.connect(g).connect(dest);
        node.start(st - a, st - tt, en - st);
      }
    }
    // звук рекламы поверх видео (у вставок с паузой — свой кусок, mixAd)
    for (const ad of adPlacements()) {
      if (ad.insert || ad.end <= a || ad.start >= b) continue;
      await this.adAudio(ctx, ad, Math.max(a, ad.start) - ad.start, Math.min(b, ad.end) - ad.start, Math.max(0, ad.start - a));
    }
    for (const it of S.project.audio || []) {
      const end = it.start + audioLen(it);
      if (end <= a || it.start >= b || it.muted) continue;
      // скорость/тон/эхо: звук обработан целиком заранее; в нём секунда исходника s — на месте s / speed
      const buf = await processedBuffer(it, await this.decoded(it.media));
      if (!buf) continue;
      const st = Math.max(a, it.start), en = Math.min(b, end);
      const node = ctx.createBufferSource();
      node.buffer = buf;
      const g = ctx.createGain();
      if (isMusic(it) && S.project.ducking?.enabled) {
        // музыка тише, пока говорят
        const pts = duckPoints(st, en, (x) => itemGain(it, x));
        g.gain.setValueAtTime(pts[0][1], st - a);
        for (const [x, v] of pts.slice(1)) g.gain.linearRampToValueAtTime(v, x - a);
      } else {
        // огибающая громкости: точки в начале, в конце и на границах появления/затухания
        const pts = [st, en, it.start + (it.fadeIn || 0), end - (it.fadeOut || 0)].filter((x) => x >= st && x <= en).sort((x, y) => x - y);
        g.gain.setValueAtTime(itemGain(it, st), st - a);
        for (const x of pts.slice(1)) g.gain.linearRampToValueAtTime(itemGain(it, x), x - a);
      }
      node.connect(g).connect(outNode(ctx, it.afx));
      node.start(st - a, it.in / audioSpeed(it) + (st - it.start), en - st);
    }
    return ctx.startRendering();
  }

  /** Звук вставки рекламы (видео на паузе): кусок [a0, a1) от начала ролика, только сам ролик. */
  async mixAd(x, a0, a1) {
    const len = Math.max(1, Math.round((a1 - a0) * SAMPLE_RATE));
    const ctx = new OfflineAudioContext(2, len, SAMPLE_RATE);
    await this.adAudio(ctx, x, a0, a1, 0);
    return ctx.startRendering();
  }

  /**
   * Звук ролика рекламы: отрезок [a0, a1) от начала ролика (время готового видео) кладётся в ctx с момента at.
   * Ускоренный/замедленный ролик — с сохранением тона (как у клипов).
   */
  async adAudio(ctx, x, a0, a1, at) {
    if (x.kind === 'image' || !(S.project.ads.volume ?? 1) || a1 - a0 <= 1e-4) return;
    const sink = await this.audioSink(x.media);
    if (!sink) return;
    const sp = x.speed || 1, span = { start: 0, end: x.end - x.start };
    const off = a0 - at; // время ролика → время в ctx
    if (Math.abs(sp - 1) > 1e-6) {
      const srcA = x.srcIn + a0 * sp, srcB = x.srcIn + a1 * sp, r0 = Math.max(0, srcA - 0.06);
      const { sr, chans } = await readRange(sink, r0, srcB + 0.06);
      if (!chans) return;
      const out = wsola(chans, sp, sr);
      const buf = ctx.createBuffer(out.length, out[0].length, sr);
      out.forEach((d, ch) => buf.copyToChannel(d, ch));
      const node = ctx.createBufferSource();
      node.buffer = buf;
      const g = ctx.createGain();
      envelope(g.gain, (q) => adGain(span, q), a0, a1, off);
      node.connect(g).connect(ctx.destination);
      node.start(at, (srcA - r0) / sp, a1 - a0);
      return;
    }
    for await (const { buffer, timestamp } of sink.buffers(Math.max(0, x.srcIn + a0 - 0.05), x.srcIn + a1)) {
      const tt = timestamp - x.srcIn; // от начала ролика
      const st = Math.max(a0, tt), en = Math.min(a1, tt + buffer.duration);
      if (en - st <= 1e-4) continue;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      const g = ctx.createGain();
      envelope(g.gain, (q) => adGain(span, q), st, en, off);
      node.connect(g).connect(ctx.destination);
      node.start(st - off, st - tt, en - st);
    }
  }

  /** Звук ускоренного/замедленного клипа с сохранением тона (WSOLA). */
  async stretched(ctx, sink, c, from, to, a, dest = ctx.destination) {
    const s = c.speed;
    const M = 0.06; // запас по краям, чтобы склейка кусков была без щелчков
    const srcA = c.in + srcOffset(c, from - c.start), srcB = c.in + srcOffset(c, to - c.start);
    const r0 = Math.max(0, srcA - M);
    const { sr, chans } = await readRange(sink, r0, srcB + M);
    if (!chans) return;
    const out = wsola(chans, s, sr);
    const buf = ctx.createBuffer(out.length, out[0].length, sr);
    out.forEach((d, ch) => buf.copyToChannel(d, ch));
    const node = ctx.createBufferSource();
    node.buffer = buf;
    const g = ctx.createGain();
    envelope(g.gain, (x) => clipGain(c, x), from, to, a);
    node.connect(g).connect(dest);
    node.start(from - a, (srcA - r0) / s, to - from);
  }
}

/** Звук исходника на отрезке [r0, r1] одним куском (до 2 каналов). */
export async function readRange(sink, r0, r1) {
  let sr = 0, chans = null;
  for await (const { buffer, timestamp } of sink.buffers(r0, r1)) {
    if (!chans) {
      sr = buffer.sampleRate;
      const len = Math.ceil((r1 - r0) * sr) + 1;
      chans = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, () => new Float32Array(len));
    }
    const off = Math.round((timestamp - r0) * sr);
    for (let ch = 0; ch < chans.length; ch++) {
      const d = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
      const dst = chans[ch];
      for (let i = 0; i < d.length; i++) { const k = off + i; if (k >= 0 && k < dst.length) dst[k] = d[i]; }
    }
  }
  return { sr, chans };
}

/**
 * Растяжение времени без изменения тона (WSOLA): окна по 40 мс, на каждом шаге ищется место
 * в исходнике, которое лучше всего продолжает уже собранный звук (по корреляции).
 */
export function wsola(chans, rate, sr) {
  const W = Math.round(sr * 0.04) & ~1, H = W / 2, tol = Math.round(sr * 0.012);
  const n = chans[0].length;
  const outLen = Math.max(1, Math.floor(n / rate));
  const out = chans.map(() => new Float32Array(outLen + W));
  const win = new Float32Array(W);
  for (let i = 0; i < W; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W);
  const mono = chans.length > 1 ? chans[0].map((v, i) => (v + chans[1][i]) * 0.5) : chans[0];
  let prev = 0;
  for (let k = 0; k * H < outLen; k++) {
    const ideal = Math.round(k * H * rate);
    let best = Math.min(Math.max(0, ideal), Math.max(0, n - W));
    if (k > 0) {
      // ищем сдвиг, при котором кусок лучше всего совпадает с естественным продолжением прошлого
      const nat = prev + H;
      let bestC = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const p = ideal + d;
        if (p < 0 || p + H >= n || nat + H >= n) continue;
        let cc = 0;
        for (let i = 0; i < H; i += 4) cc += mono[p + i] * mono[nat + i];
        if (cc > bestC) { bestC = cc; best = p; }
      }
    }
    const o = k * H;
    for (let ch = 0; ch < chans.length; ch++) {
      const src = chans[ch], dst = out[ch];
      for (let i = 0; i < W && best + i < n; i++) dst[o + i] += src[best + i] * win[i];
    }
    prev = best;
  }
  return out.map((d) => d.subarray(0, outLen));
}
