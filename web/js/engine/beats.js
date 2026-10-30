// Поиск битов в музыке: огибающая атак (spectral flux) → темп (автокорреляция) → биты (динамическое
// программирование, Ellis 2007). Без библиотек; работает в фоновом потоке (beats-worker.js).

const SR = 11025, N = 1024, HOP = 128;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Огибающая атак: сколько «нового» звука появляется в каждый момент. */
export function onsetEnvelope(mono, sampleRate) {
  const f = Math.max(1, Math.round(sampleRate / SR));
  const sr = sampleRate / f;
  const x = new Float32Array(Math.floor(mono.length / f));
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < f; k++) s += mono[i * f + k];
    x[i] = s / f;
  }
  const frames = Math.max(0, Math.floor((x.length - N) / HOP));
  const env = new Float32Array(frames);
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  let prev = new Float32Array(N / 2);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let t = 0; t < frames; t++) {
    for (let i = 0; i < N; i++) { re[i] = x[t * HOP + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let flux = 0;
    const cur = new Float32Array(N / 2);
    for (let k = 1; k < N / 2; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = cur[k] - prev[k];
      if (d > 0) flux += d;
    }
    env[t] = flux;
    prev = cur;
  }
  // убираем медленный фон (скользящее среднее ~0.5 с) и отрицательные значения
  const rate = sr / HOP;
  const w = Math.round(rate * 0.25);
  const out = new Float32Array(frames);
  let acc = 0;
  for (let i = 0; i < frames; i++) {
    acc += env[i];
    if (i > 2 * w) acc -= env[i - 2 * w - 1];
    const mean = acc / Math.min(i + 1, 2 * w + 1);
    out[i] = Math.max(0, env[i] - mean);
  }
  let mx = 0;
  for (const v of out) mx = Math.max(mx, v);
  if (mx > 0) for (let i = 0; i < frames; i++) out[i] /= mx;
  return { env: out, rate };
}

/** Темп по автокорреляции с мягким предпочтением ~120 BPM. */
export function estimateTempo(env, rate) {
  let best = 0, bestLag = Math.round(rate * 0.5);
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const lag = rate * 60 / bpm;
    const l0 = Math.floor(lag), fr = lag - l0;
    let s = 0;
    for (let i = l0 + 1; i < env.length; i++) s += env[i] * (env[i - l0] * (1 - fr) + env[i - l0 - 1] * fr);
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    if (s * prior > best) { best = s * prior; bestLag = lag; }
  }
  return { bpm: rate * 60 / bestLag, period: bestLag };
}

/** Биты динамическим программированием (Ellis 2007). */
export function trackBeats(env, period, tightness = 100) {
  const n = env.length;
  const score = new Float32Array(n), back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let best = 0, arg = -1;
    const lo = Math.max(0, Math.round(t - 2 * period)), hi = Math.round(t - period / 2);
    for (let p = lo; p <= hi && p < t; p++) {
      const v = score[p] - tightness * Math.pow(Math.log((t - p) / period), 2);
      if (v > best || arg < 0) { best = v; arg = p; }
    }
    score[t] = env[t] + (arg >= 0 ? best : 0);
    back[t] = arg;
  }
  // конец — максимум в последнем периоде
  let t = n - 1, best = -Infinity;
  for (let i = Math.max(0, Math.round(n - period)); i < n; i++) if (score[i] > best) { best = score[i]; t = i; }
  const beats = [];
  while (t >= 0) { beats.push(t); t = back[t]; }
  return beats.reverse();
}

export function computeBeats(mono, sampleRate) {
  const { env, rate } = onsetEnvelope(mono, sampleRate);
  if (env.length < rate * 2) return { bpm: 0, beats: [], strong: [] };
  const { bpm, period } = estimateTempo(env, rate);
  const idx = trackBeats(env, period);
  // поправка на задержку окна анализа: прирост спектра максимален, когда удар в 3/4 окна Ханна
  const lag = (3 * N / 4) / SR;
  const beats = idx.map((i) => +(i / rate + lag).toFixed(3));
  // сильные доли: из 4 возможных фаз берём ту, где атаки громче
  let phase = 0, bestSum = -1;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0;
    for (let i = ph; i < idx.length; i += 4) s += env[idx[i]];
    if (s > bestSum) { bestSum = s; phase = ph; }
  }
  const strong = beats.filter((_, i) => i % 4 === phase);
  return { bpm: Math.round(bpm * 10) / 10, beats, strong };
}
