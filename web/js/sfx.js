// Встроенные звуки — синтезируются прямо в приложении (никаких чужих сэмплов и прав).
const SR = 48000;

function noise(len) {
  const d = new Float32Array(len);
  let s = 12345;
  for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; }
  return d;
}

const SOUNDS = {
  whoosh: { label: 'Свиш', dur: 0.7, make: (ctx) => {
    const src = ctx.createBufferSource();
    const b = ctx.createBuffer(1, SR * 0.7, SR); b.copyToChannel(noise(b.length), 0); src.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(300, 0); f.frequency.exponentialRampToValueAtTime(4500, 0.45); f.frequency.exponentialRampToValueAtTime(900, 0.7);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.9, 0.35); g.gain.exponentialRampToValueAtTime(0.001, 0.7);
    src.connect(f).connect(g).connect(ctx.destination); src.start(0);
  } },
  boom: { label: 'Удар', dur: 1.2, make: (ctx) => {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, 0); o.frequency.exponentialRampToValueAtTime(38, 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(1, 0); g.gain.exponentialRampToValueAtTime(0.001, 1.2);
    o.connect(g).connect(ctx.destination); o.start(0); o.stop(1.2);
    const n = ctx.createBufferSource(); const b = ctx.createBuffer(1, SR * 0.15, SR); b.copyToChannel(noise(b.length), 0); n.buffer = b;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.6, 0); ng.gain.exponentialRampToValueAtTime(0.001, 0.12);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
    n.connect(lp).connect(ng).connect(ctx.destination); n.start(0);
  } },
  click: { label: 'Щелчок', dur: 0.12, make: (ctx) => {
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(1800, 0); o.frequency.exponentialRampToValueAtTime(600, 0.05);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.08);
    o.connect(g).connect(ctx.destination); o.start(0); o.stop(0.12);
  } },
  pop: { label: 'Поп', dur: 0.25, make: (ctx) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(380, 0); o.frequency.exponentialRampToValueAtTime(1300, 0.08);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.22);
    o.connect(g).connect(ctx.destination); o.start(0); o.stop(0.25);
  } },
  riser: { label: 'Нарастание', dur: 2.2, make: (ctx) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(110, 0); o.frequency.exponentialRampToValueAtTime(1400, 2.1);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(400, 0); f.frequency.exponentialRampToValueAtTime(7000, 2.1);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.001, 0); g.gain.exponentialRampToValueAtTime(0.45, 2.0); g.gain.linearRampToValueAtTime(0, 2.2);
    o.connect(f).connect(g).connect(ctx.destination); o.start(0); o.stop(2.2);
  } },
  glitch: { label: 'Глитч', dur: 0.5, make: (ctx) => {
    for (let i = 0; i < 7; i++) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 200 + ((i * 397) % 1600);
      const g = ctx.createGain(); const t = i * 0.065;
      g.gain.setValueAtTime(0, 0); g.gain.setValueAtTime(0.25, t); g.gain.setValueAtTime(0, t + 0.04);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.05);
    }
  } },
  ding: { label: 'Дзынь', dur: 1.5, make: (ctx) => {
    for (const [f, a] of [[1320, 0.5], [2640, 0.18], [3960, 0.08]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(a, 0); g.gain.exponentialRampToValueAtTime(0.001, 1.5);
      o.connect(g).connect(ctx.destination); o.start(0); o.stop(1.5);
    }
  } },
  swipe: { label: 'Свайп', dur: 0.35, make: (ctx) => {
    const src = ctx.createBufferSource(); const b = ctx.createBuffer(1, SR * 0.35, SR); b.copyToChannel(noise(b.length), 0); src.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.setValueAtTime(800, 0); f.frequency.exponentialRampToValueAtTime(6000, 0.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.001, 0); g.gain.exponentialRampToValueAtTime(0.7, 0.12); g.gain.exponentialRampToValueAtTime(0.001, 0.35);
    src.connect(f).connect(g).connect(ctx.destination); src.start(0);
  } },
};

export const SFX = Object.fromEntries(Object.entries(SOUNDS).map(([k, v]) => [k, v.label]));

function wav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true); o += 2; }
  return new Blob([out], { type: 'audio/wav' });
}

/** Звук печати: щелчок клавиши на каждую букву (times — секунды от начала, как у анимации «печатается»). */
export async function renderTyping(times, name = 'печать') {
  const len = (times[times.length - 1] || 0) + 0.15;
  const ctx = new OfflineAudioContext(2, Math.round(SR * len), SR);
  const nb = ctx.createBuffer(1, Math.round(SR * 0.05), SR);
  nb.copyToChannel(noise(nb.length), 0);
  times.forEach((t, i) => {
    const r = Math.sin(i * 91.7 + 3.1) * 0.5 + 0.5; // у каждой клавиши свой оттенок
    const src = ctx.createBufferSource(); src.buffer = nb;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200 + 2600 * r; f.Q.value = 2.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.55 + 0.3 * r, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    src.connect(f).connect(g).connect(ctx.destination); src.start(t, (i * 0.0037) % 0.01, 0.04);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(190 + 70 * r, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.03);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.35, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(og).connect(ctx.destination); o.start(t); o.stop(t + 0.05);
  });
  return new File([wav(await ctx.startRendering())], `Звук — ${name}.wav`, { type: 'audio/wav' });
}

/** WAV-файл встроенного звука. */
export async function renderSfx(name) {
  const s = SOUNDS[name];
  const ctx = new OfflineAudioContext(2, Math.round(SR * s.dur), SR);
  s.make(ctx);
  return new File([wav(await ctx.startRendering())], `Звук — ${s.label}.wav`, { type: 'audio/wav' });
}
