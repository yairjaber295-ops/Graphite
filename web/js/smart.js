// Умные инструменты: убрать паузы (джамп-каты), приглушать музыку под голос, зум-акценты на словах, эмодзи в субтитрах.
import { S, commit, clipsTL, uid, snapFrame, subs } from './store.js';
import { clipDur, srcOffset, hasCurve } from './engine/speed.js';
import { audioLen, audioSrcAt } from './engine/audioproc.js';
import { defaultParams } from './engine/effects.js';
import { rippleRemove } from './edit.js';
import { timelineWords, timelineGaps } from './auto.js';

// ---------------------------------------------------------------------------
//   Паузы
// ---------------------------------------------------------------------------
/** Паузы длиннее minGap (в координатах таймлайна), с запасом keep по краям — то, что будет вырезано. */
export function pauseSpans({ minGap = 0.6, keep = 0.12 } = {}) {
  const words = timelineWords();
  let gaps = [];
  if (words.length >= 10) {
    for (let i = 0; i < words.length - 1; i++) gaps.push([words[i].e, words[i + 1].s]);
  } else gaps = timelineGaps().gaps;
  const curved = clipsTL().filter(hasCurve).map((c) => [c.start, c.end]);
  return gaps.filter(([a, b]) => b - a >= minGap)
    .map(([a, b]) => [a + keep, b - keep])
    .filter(([a, b]) => b - a > 0.05 && !curved.some(([s, e]) => a < e && b > s)); // клипы с кривой скорости не режем
}

/** Вырезать отрезок таймлайна [a, b] из клипов (части слева и справа остаются, всё правее сдвигается). */
function removeRange(p, a, b) {
  let t = 0;
  const out = [];
  for (const c of p.clips) {
    const d = clipDur(c), s = t, e = t + d;
    t = e;
    if (e <= a + 1e-6 || s >= b - 1e-6) { out.push(c); continue; }
    if (s < a) out.push({ ...c, out: c.in + srcOffset(c, a - s) });
    if (e > b) out.push({ ...structuredClone(c), id: uid(), in: c.in + srcOffset(c, b - s), transition: { type: 'none', dur: 0.5 }, jump: true });
  }
  p.clips = out;
  rippleRemove(p, a, b, true);
}

/**
 * Убрать паузы. zoom — чередовать приближение на склейках, как у блогеров: склейка не «дёргается», а выглядит
 * как смена плана.
 */
export function removePauses({ minGap = 0.6, keep = 0.12, zoom = false } = {}) {
  const spans = pauseSpans({ minGap, keep });
  if (!spans.length) return { n: 0, sec: 0 };
  const sec = spans.reduce((s, [a, b]) => s + b - a, 0);
  commit((p) => {
    for (const [a, b] of [...spans].sort((x, y) => y[0] - x[0])) removeRange(p, a, b);
    if (zoom) {
      let k = 0;
      for (const c of p.clips) {
        if (c.jump) { k++; if (k % 2) c.scale = +((c.scale ?? 1) * 1.12).toFixed(3); } // каждый второй кусок ближе, остальные как были
        delete c.jump;
      }
    } else for (const c of p.clips) delete c.jump;
  });
  return { n: spans.length, sec };
}

// ---------------------------------------------------------------------------
//   Приглушение музыки под голос
// ---------------------------------------------------------------------------
/** Громкость голоса в момент t (0…1): звук клипов и отделённые голосовые дорожки. */
function voiceAt(t) {
  const p = S.project;
  let v = 0;
  for (const c of clipsTL()) {
    if (t < c.start || t >= c.end || (c.volume ?? 1) === 0 || hasCurve(c)) continue;
    const pk = S.media[c.media]?.peaks;
    if (pk?.peaks?.length) v = Math.max(v, pk.peaks[Math.floor((c.in + srcOffset(c, t - c.start)) * pk.rate)] ?? 0);
  }
  for (const a of p.audio || []) {
    if (a.kind !== 'voice' || a.muted || t < a.start || t >= a.start + audioLen(a)) continue;
    const pk = S.media[a.media]?.peaks;
    if (pk?.peaks?.length) v = Math.max(v, pk.peaks[Math.floor(audioSrcAt(a, t) * pk.rate)] ?? 0);
  }
  return v;
}

/** Громкость голоса на [a, b] с шагом step — один проход по клипам (их после «убрать паузы» бывают сотни). */
function voiceEnvelope(a, b, step) {
  const n = Math.max(1, Math.ceil((b - a) / step) + 1);
  const v = new Float32Array(n);
  const list = clipsTL();
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = a + i * step;
    while (j < list.length && list[j].end <= t) j++;
    const c = list[j];
    if (!c || t < c.start || (c.volume ?? 1) === 0 || hasCurve(c)) continue;
    const pk = S.media[c.media]?.peaks;
    if (pk?.peaks?.length) v[i] = pk.peaks[Math.floor((c.in + srcOffset(c, t - c.start)) * pk.rate)] ?? 0;
  }
  for (const it of S.project.audio || []) {
    if (it.kind !== 'voice' || it.muted) continue;
    const pk = S.media[it.media]?.peaks;
    if (!pk?.peaks?.length) continue;
    const i0 = Math.max(0, Math.ceil((it.start - a) / step)), i1 = Math.min(n - 1, Math.floor((it.start + audioLen(it) - a) / step));
    for (let i = i0; i <= i1; i++) v[i] = Math.max(v[i], pk.peaks[Math.floor(audioSrcAt(it, a + i * step) * pk.rate)] ?? 0);
  }
  return v;
}

/**
 * Точки огибающей громкости музыки на [a, b] (шаг 0,1 с) — для WebAudio.
 * Музыка тише, пока говорят: с запасом 0,25 с до фразы и 0,35 с после, чтобы не «качало» между словами.
 */
export function duckPoints(a, b, gainAt) {
  const d = S.project?.ducking;
  const STEP = 0.05, PRE = 0.25, POST = 0.35;
  const A = a - POST;
  const env = d?.enabled ? voiceEnvelope(A, b + PRE, STEP) : null;
  const thr = d?.threshold ?? 0.16;
  const pts = [];
  const at = (x) => {
    if (!env) return gainAt(x);
    const i0 = Math.max(0, Math.floor((x - POST - A) / STEP)), i1 = Math.min(env.length - 1, Math.ceil((x + PRE - A) / STEP));
    for (let i = i0; i <= i1; i++) if (env[i] > thr) return gainAt(x) * (d.level ?? 0.3);
    return gainAt(x);
  };
  for (let x = a; x < b; x += 0.1) pts.push([x, at(x)]);
  pts.push([b, at(b)]);
  return pts;
}

// ---------------------------------------------------------------------------
//   Акценты на словах
// ---------------------------------------------------------------------------
/** Зум-удар на важных словах: с «!», самые громкие, длинные «ну-у-у». Повторный запуск заменяет прошлые акценты. */
export function addAccents({ amount = 0.45, every = 2.2 } = {}) {
  const words = timelineWords();
  if (!words.length) throw new Error('Нужны распознанные слова — сначала субтитры (вкладка «Субтитры»)');
  const scored = words.map((w) => {
    const loud = voiceAt((w.s + w.e) / 2);
    const bang = /[!]/.test(w.text) ? 0.5 : 0;
    const caps = /[А-ЯЁA-Z]{3,}/.test(w.text.trim()) && w.text.trim() === w.text.trim().toUpperCase() ? 0.3 : 0;
    return { ...w, score: loud + bang + caps + Math.min(0.2, (w.e - w.s) * 0.2) };
  });
  const sorted = [...scored].sort((x, y) => y.score - x.score);
  const top = sorted.slice(0, Math.max(3, Math.round(words.length * 0.08)));
  const chosen = [];
  for (const w of top.sort((x, y) => x.s - y.s)) if (!chosen.length || w.s - chosen[chosen.length - 1].s >= every) chosen.push(w);
  commit((p) => {
    p.effects = p.effects.filter((e) => !e.accent);
    for (const w of chosen) {
      p.effects.push({ id: uid(), type: 'zoompunch', accent: true, start: snapFrame(w.s), end: snapFrame(w.s + 0.45),
        p: { ...defaultParams('zoompunch'), amount } });
    }
  });
  return chosen.length;
}
export const clearAccents = () => commit((p) => { p.effects = p.effects.filter((e) => !e.accent); });

// ---------------------------------------------------------------------------
//   Эмодзи в субтитрах
// ---------------------------------------------------------------------------
const EMOJI = [
  [/огон|огн[её]м|пожар|жар/i, '🔥'], [/деньг|бабк|доллар|рубл|бабл|миллион/i, '💰'], [/ахах|хаха|ржак|смешн|угар|ору/i, '😂'],
  [/убил|убий|килл|фраг|kill|смерт|умер/i, '💀'], [/страшн|ужас|жутк|испуг/i, '😱'], [/побед|выиграл|чемпион|кубок|мейджор/i, '🏆'],
  [/проиграл|слил|грустн|плак/i, '😭'], [/нож|керамбит|бабочк/i, '🔪'], [/взрыв|бомб|гранат|c4|си-?4/i, '💣'],
  [/авп|awp|снайп|хедшот|хэдшот|headshot|в голову/i, '🎯'], [/клатч|clutch/i, '😤'], [/быстр|скорост|ракет|мгновенн/i, '🚀'],
  [/почему|зачем|вопрос|как так/i, '🤔'], [/внимани|важн|осторожн|запрещ|правил/i, '⚠️'], [/вау|ого|офиг|невероятн|wow/i, '😮'],
  [/музык|песн|трек/i, '🎵'], [/игр|катк|матч|раунд/i, '🎮'], [/люб|сердц|обожа/i, '❤️'], [/зл[оа]|беси|бомбит|ярост/i, '😡'],
  [/лайк|класс|круто|топ\b|имба/i, '👍'], [/подпиш|подписк/i, '🔔'], [/врем|час[аов]?\b|минут|секунд/i, '⏰'],
  [/скин|кейс|дроп/i, '🎁'], [/читер|чит\b|бан/i, '🚫'], [/мозг|умн|гени/i, '🧠'], [/холодн|лёд|лед\b|мороз/i, '🥶'],
  [/еда|пицц|бургер|голод/i, '🍕'], [/спать|сон\b|устал/i, '😴'], [/друг|команд|тиммейт/i, '🤝'], [/секрет|тайн|фишк/i, '🤫'],
];
const EMOJI_RE = new RegExp(` (${EMOJI.map(([, e]) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`, 'u');

/** Добавить эмодзи в конец субтитров с «говорящими» словами (не чаще, чем через один). */
export function addEmoji() {
  let n = 0, last = -2;
  commit((p) => {
    p.texts.filter((t) => t.track === 'subs').sort((a, b) => a.start - b.start).forEach((t, i) => {
      if (EMOJI_RE.test(t.text) || i - last < 2) return;
      const hit = EMOJI.find(([re]) => re.test(t.text));
      if (hit) { t.text = `${t.text} ${hit[1]}`; n++; last = i; }
    });
  });
  return n;
}
export function removeEmoji() {
  let n = 0;
  commit((p) => { for (const t of p.texts) if (t.track === 'subs' && EMOJI_RE.test(t.text)) { t.text = t.text.replace(EMOJI_RE, ''); n++; } });
  return n;
}
export const hasEmoji = () => subs().some((t) => EMOJI_RE.test(t.text));
