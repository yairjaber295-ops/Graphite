// Эффекты звука клипа/дорожки: бас, высокие, «телефон», «из-за стены», «радио».
// Одна и та же цепочка фильтров WebAudio — в превью (поверх <video>) и в экспорте (OfflineAudioContext).

export const AFX_FILTERS = { none: 'Без фильтра', phone: 'Телефон', wall: 'Из-за стены', radio: 'Радио', vinyl: 'Старое радио' };

/** Быстрые готовые настройки (меню по правому клику). */
export const AFX_PRESETS = {
  bass6: { label: 'Бас +6 дБ', set: { bass: 6 } },
  bassboost: { label: 'Бас-буст (+12 дБ)', set: { bass: 12 } },
  bassmax: { label: 'Бас ×2 (+20 дБ, с перегрузом)', set: { bass: 20, drive: 0.35, midcut: 4, crush: 0 } },
  bassext: { label: '💥 Бас ЭКСТРИМ — рвёт колонки', set: { bass: 0, drive: 0, midcut: 0, treble: 0, focus: 0, crush: 1 } },
  nobass: { label: 'Убрать бас', set: { bass: -12 } },
  bright: { label: 'Ярче (высокие +6)', set: { treble: 6 } },
  phone: { label: 'Как по телефону', set: { filter: 'phone' } },
  wall: { label: 'Из-за стены', set: { filter: 'wall' } },
  radio: { label: 'Радио', set: { filter: 'radio' } },
};

export const hasAfx = (a) => !!a && ((a.bass || 0) !== 0 || (a.treble || 0) !== 0 || (!!a.filter && a.filter !== 'none') || (!!a.vocal && a.vocal !== 'none')
  || Math.abs(a.pan || 0) > 0.01 || (a.drive || 0) > 0 || (a.midcut || 0) > 0 || (a.focus || 0) > 0 || (a.crush || 0) > 0);

/** Срез: линейно до 0.85, дальше почти жёстко упирается в 1 (как перегруженный мастер). */
let clipC = null;
function clipCurve() {
  if (!clipC) {
    const n = 8192;
    clipC = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // кривая на входе −1…+1 (всё громче — упирается в край, то есть срезается жёстко), у края — мягкое колено
      const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
      clipC[i] = Math.sign(x) * (ax < 0.8 ? ax : 0.8 + 0.2 * Math.tanh((ax - 0.8) / 0.2));
    }
  }
  return clipC;
}

const BUTTER = 20 * Math.log10(Math.SQRT1_2);

/** Кривая перегруза: мягкое насыщение tanh, сильнее — ближе к «рычащему» дисторшну. */
const curves = new Map();
function driveCurve(amt) {
  const key = Math.round(amt * 100);
  if (!curves.has(key)) {
    const k = 1 + amt * 40, n = 4096, c = new Float32Array(n), norm = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
    curves.set(key, c);
  }
  return curves.get(key);
}

/**
 * Цепочка: стерео-матрица (вокал) → бас → высокие → срез низа → срез верха → «середина» → громкость.
 * Вокал обычно в центре стерео: «без вокала» = L−R (центр гасится), «только вокал» = середина (L+R)/2 в полосе голоса.
 */
export function makeChain(ctx) {
  const mk = (type, f) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; return n; };
  const c = { low: mk('lowshelf', 150), sub: mk('peaking', 75), high: mk('highshelf', 4000), hp: mk('highpass', 10), lp: mk('lowpass', 22000), mid: mk('peaking', 1600),
    mcut: mk('peaking', 1300), drive: ctx.createWaveShaper(), gain: ctx.createGain() };
  // у lowpass/highpass в WebAudio Q задаётся в дБ: −3.01 дБ = 1/√2 (Баттерворт, без горба на срезе)
  c.hp.Q.value = BUTTER; c.lp.Q.value = BUTTER; c.mid.Q.value = 1; c.sub.Q.value = 0.8; c.mcut.Q.value = 0.55;   // широкая «дыра» в полосе голоса
  c.drive.oversample = '4x';
  // кроссовер Линквица–Райли 4-го порядка на 160 Гц: низ и верх в сумме дают ровную АЧХ.
  // Перегруз — только на низ (и срез после него), чтобы рычал бас, а не голос.
  const lr = (type) => { const a = mk(type, 160), b = mk(type, 160); a.Q.value = b.Q.value = BUTTER; a.connect(b); return [a, b]; };
  c.xl = lr('lowpass'); c.xh = lr('highpass');
  c.dpre = ctx.createGain(); c.dpost = mk('lowpass', 750); c.dout = ctx.createGain(); c.sum = ctx.createGain(); c.rest = ctx.createGain();
  // «рвёт колонки» (как мемы «бас на максимум»): саб убран, узкий подъём на 300 Гц — там бас слышен даже на телефоне,
  // и всё это громкостью вгоняется в почти жёсткий срез — хрипит весь трек, слова тонут
  c.chp = mk('highpass', 10); c.chp.Q.value = BUTTER; c.cpk = mk('peaking', 300); c.cpk.Q.value = 1.4;
  c.cpre = ctx.createGain(); c.clip = ctx.createWaveShaper(); c.clip.oversample = '2x';
  const pre = ctx.createGain();
  pre.channelCount = 2; pre.channelCountMode = 'explicit'; pre.channelInterpretation = 'speakers';   // моно → L=R
  const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
  c.m = { ll: ctx.createGain(), rl: ctx.createGain(), lr: ctx.createGain(), rr: ctx.createGain() };
  pre.connect(split);
  split.connect(c.m.ll, 0); split.connect(c.m.lr, 0); split.connect(c.m.rl, 1); split.connect(c.m.rr, 1);
  c.m.ll.connect(merge, 0, 0); c.m.rl.connect(merge, 0, 0);   // выход L = ll·L + rl·R
  c.m.lr.connect(merge, 0, 1); c.m.rr.connect(merge, 0, 1);   // выход R = lr·L + rr·R
  merge.connect(c.low);
  c.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  c.low.connect(c.sub).connect(c.high).connect(c.hp).connect(c.lp).connect(c.mid).connect(c.mcut);
  c.mcut.connect(c.xl[0]); c.xl[1].connect(c.dpre).connect(c.drive).connect(c.dpost).connect(c.dout).connect(c.sum);
  c.mcut.connect(c.xh[0]); c.xh[1].connect(c.rest).connect(c.sum);
  c.sum.connect(c.chp).connect(c.cpk).connect(c.cpre).connect(c.clip).connect(c.gain).connect(c.pan);
  c.input = pre; c.output = c.pan;
  return c;
}

/** Параметры фильтров под настройки (бас и высокие в дБ). */
export function setChain(c, a = {}) {
  const f = a.filter || 'none';
  const P = [...({
    none: [10, 22000, 0], phone: [380, 3200, 5], wall: [10, 420, 0], radio: [480, 5200, 3], vinyl: [250, 3800, 2],
  }[f] || [10, 22000, 0])];
  const v = a.vocal || 'none';
  const [ll, rl, lr, rr] = v === 'remove' ? [1.1, -1.1, -1.1, 1.1] : v === 'isolate' ? [0.5, 0.5, 0.5, 0.5] : [1, 0, 0, 1];
  c.m.ll.gain.value = ll; c.m.rl.gain.value = rl; c.m.lr.gain.value = lr; c.m.rr.gain.value = rr;
  if (v === 'isolate' && f === 'none') { P[0] = 140; P[1] = 7500; P[2] = 3; }   // полоса голоса, чуть ярче середина
  if (c.pan.pan) c.pan.pan.value = Math.max(-1, Math.min(1, a.pan || 0));
  // бас: полка до +18 дБ, всё сверх — в саб (~55 Гц), чтобы низ «бил», а не гудел
  const bass = Math.max(-24, Math.min(30, a.bass || 0));
  c.low.gain.value = Math.min(bass, 18);
  c.sub.gain.value = bass > 10 ? (bass - 10) * 0.9 : 0;
  c.mcut.gain.value = -Math.max(0, Math.min(24, a.midcut || 0));
  const drive = Math.max(0, Math.min(1, a.drive || 0));
  c.drive.curve = drive > 0 ? driveCurve(drive) : null;
  // низ вгоняем в перегруз и выводим громче: призвуки перегруза (150–700 Гц) слышны даже на динамиках ноутбука/телефона,
  // которые сам саб (40–60 Гц) почти не играют
  c.dpre.gain.value = 1 + drive * 12;
  c.dout.gain.value = 1 + drive * 3.2;
  c.rest.gain.value = Math.pow(10, -Math.max(0, Math.min(24, a.focus || 0)) / 20);   // «всё кроме баса тише»
  // подобрано по референсу: громкость ≈ −4 дБ RMS, энергия в 150 Гц–3 кГц, почти нет саба
  const crush = Math.max(0, Math.min(1, a.crush || 0));
  c.chp.frequency.value = crush > 0 ? 80 : 10;
  c.cpk.gain.value = 15 * crush;
  // +9 дБ в срез минус половина подъёма 300 Гц; перегруженный низ (до 1+3.2·drive) приводим к ±1
  c.cpre.gain.value = crush > 0 ? Math.pow(10, (9 * crush - 7.5 * crush) / 20) / (1 + drive * 3.2) : 1;
  c.clip.curve = crush > 0 ? clipCurve() : null;
  c.high.gain.value = (a.treble || 0) + (f === 'wall' ? -6 : 0);
  c.hp.frequency.value = P[0];
  c.lp.frequency.value = P[1];
  c.mid.gain.value = P[2];
  // бас-буст поднимает громкость — слегка убавляем; от хрипа на выходе дальше защищает лимитер (он и «давит» остальное под басом)
  c.gain.gain.value = drive > 0 || crush > 0 ? 1 : 1 / (1 + Math.max(0, bass) / 40);
  return c;
}
