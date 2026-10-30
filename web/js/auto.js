// Автоматика: субтитры из распознанных слов, разбиение на части по паузам, биты, «сделать всё».
import { S, commit, clipsTL, clipAt, duration, subs, uid, emit, snapFrame } from './store.js';
import { srcOffset, tlOffset } from './engine/speed.js';
import { allProfiles } from './profiles.js';

/** Слова всех клипов в координатах таймлайна. */
export function timelineWords() {
  const out = [];
  for (const c of clipsTL()) {
    const words = S.media[c.media]?.words?.words;
    if (!words) continue;
    for (const [ws, we, text] of words) {
      if (ws >= c.in - 0.02 && ws < c.out) {
        const s = c.start + Math.max(0, tlOffset(c, ws - c.in));
        const e = Math.min(c.end, c.start + tlOffset(c, we - c.in));
        if (e > s) out.push({ s, e, text });
      }
    }
  }
  return out.sort((a, b) => a.s - b.s);
}

/** Группировка слов в короткие субтитры, как в CapCut: по длине, паузам и концу фразы.
 *  cuts — границы частей: субтитр никогда не переходит из одной части в другую. */
export function groupWords(words, { maxChars = 22, maxDur = 2.6, maxGap = 0.6 } = {}, cuts = []) {
  const items = [];
  let cur = [];
  // слова Whisper несут свой пробел впереди (« слово», «-то»), поэтому склеиваем как есть
  const joinWords = (ws) => ws.map((w) => w.text).join('').replace(/\s+/g, ' ').trim();
  const flush = () => {
    if (!cur.length) return;
    // тайминги отображаемых слов (кусочки вроде «-то» приклеиваются к предыдущему слову) — для «по словам» и караоке
    const t0 = cur[0].s;
    const w = [];
    for (const x of cur) {
      if (w.length && !/^\s/.test(x.text)) w[w.length - 1][1] = +(x.e - t0).toFixed(3);
      else w.push([+(x.s - t0).toFixed(3), +(x.e - t0).toFixed(3)]);
    }
    items.push({ start: t0, end: cur[cur.length - 1].e, text: joinWords(cur), w });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const len = joinWords([...cur, w]).length;
      const glued = !/^\s/.test(w.text); // «-то», «%» и т.п. — не отрываем от предыдущего слова
      const crossesCut = cuts.some((c) => c > cur[0].s + 1e-3 && c <= w.s + 1e-3);
      if (crossesCut || (!glued && (w.s - last.e > maxGap || len > maxChars || w.e - cur[0].s > maxDur || /[.!?…]$/.test(last.text.trim())))) flush();
    }
    cur.push(w);
  }
  flush();
  // держим субтитр чуть дольше, но не залезая на следующий и не перескакивая границу части
  for (let i = 0; i < items.length; i++) {
    const next = items[i + 1];
    const cut = cuts.find((c) => c > items[i].end - 1e-3 && c < items[i].end + 0.25);
    const hold = Math.min(0.25, next ? next.start - items[i].end : 0.25, cut != null ? cut - items[i].end : 0.25);
    items[i].end += Math.max(0, hold);
    // слово чуть залезло за границу части (пауза короче кадра) — обрезаем хвост по границе
    const over = cuts.find((c) => c > items[i].start + 0.05 && c < items[i].end && items[i].end - c < 0.1);
    if (over != null) items[i].end = over;
    if (items[i].end - items[i].start < 0.3) items[i].end = Math.min(items[i].start + 0.3, next ? next.start : Infinity);
    items[i].start = snapFrame(items[i].start);
    items[i].end = snapFrame(items[i].end);
  }
  return items.filter((x) => x.end > x.start);
}

export function rebuildSubs() {
  const words = timelineWords();
  if (!words.length) return 0;
  const items = groupWords(words, S.project.subs.opts, S.project.parts.cuts);
  commit((p) => {
    p.texts = p.texts.filter((t) => t.track !== 'subs');
    for (const it of items) p.texts.push({ id: uid(), track: 'subs', ...it });
  });
  return items.length;
}

// фото не распознаём — в них нет звука
export const mediaInTimeline = () => [...new Set(S.project.clips.map((c) => c.media))]
  .filter((mid) => S.project.media.find((m) => m.id === mid)?.kind !== 'image');
export const missingWords = () => mediaInTimeline().filter((mid) => !S.media[mid]?.words);

/** Распознаёт речь во всех видео таймлайна, у которых ещё нет расшифровки (force — заново во всех). */
export async function transcribeAll(onProgress, force = false) {
  const { lang, model } = S.project.subs.opts;
  for (const mid of force ? mediaInTimeline() : missingWords()) {
    const m = S.project.media.find((x) => x.id === mid);
    S.media[mid].words = await S.backend.transcribe(S.project.id, m, { lang, model }, onProgress);
  }
}

// ---------------------------------------------------------------------------
//   Биты
// ---------------------------------------------------------------------------
let worker = null;
const waiting = {};

/** Находит биты в звуке (музыка или звук видео), результат сохраняется в проекте. */
export async function detectBeats(mid) {
  const { decoded } = await import('./preview.js');
  const buf = await decoded(mid);
  if (!buf) throw new Error('не удалось прочитать звук');
  const n = buf.length, chs = buf.numberOfChannels;
  const mono = new Float32Array(n);
  for (let c = 0; c < chs; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / chs; }
  worker ||= new Worker(new URL('./engine/beats-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { const w = waiting[e.data.id]; delete waiting[e.data.id]; e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data.result); };
  const id = uid();
  const res = await new Promise((resolve, reject) => {
    waiting[id] = { resolve, reject };
    worker.postMessage({ id, mono, sampleRate: buf.sampleRate }, [mono.buffer]);
  });
  commit((p) => { p.beats[mid] = res; });
  return res;
}

// ---------------------------------------------------------------------------
//   Части
// ---------------------------------------------------------------------------

/** Паузы в таймлайне: между субтитрами, а если их нет — по тишине в звуке. */
export function timelineGaps() {
  const s = subs().map((x) => [x.start, x.end]).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  if (s.length > 3) {
    let end = s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (s[i][0] - end >= 0.15) gaps.push([end, s[i][0]]);
      end = Math.max(end, s[i][1]);
    }
    return { gaps, source: 'субтитрам' };
  }
  for (const c of clipsTL()) {
    for (const [a, b] of S.media[c.media]?.silences || []) {
      const s0 = Math.max(a, c.in), s1 = Math.min(b, c.out);
      const g0 = c.start + tlOffset(c, s0 - c.in), g1 = c.start + tlOffset(c, s1 - c.in);
      if (g1 - g0 >= 0.15) gaps.push([g0, g1]);
    }
  }
  return { gaps, source: 'тишине в звуке' };
}

/** Места между словами, где можно резать: конец предложения (3) > запятая (2) > просто пауза (1). */
function wordGaps() {
  const ws = timelineWords();
  if (ws.length < 10) return null;
  const out = [];
  for (let i = 0; i < ws.length - 1; i++) {
    const a = ws[i], b = ws[i + 1];
    if (!/^\s/.test(b.text)) continue; // «-то» и т.п. не отрываем
    const prev = a.text.trim();
    const kind = /[.!?…]["»)]?$/.test(prev) ? 3 : /[,;:—–]$/.test(prev) ? 2 : 1;
    const len = Math.max(0, b.s - a.e);
    if (kind === 3 || (kind === 2 && len >= 0.1) || len >= 0.25) out.push({ a: a.e, b: Math.max(a.e, b.s), len, kind });
  }
  return out;
}

/** Кадр внутри паузы [a, b]; если пауза короче кадра — кадр не позже начала следующего слова. */
function frameInside(a, b) {
  const f = 1 / S.project.canvas.fps;
  const mid = Math.round(((a + b) / 2) / f) * f;
  if (mid >= a - 1e-6 && mid <= b + 1e-6) return mid;
  return Math.floor((b + 1e-6) / f) * f;
}

/** Точка разреза по словам рядом с ideal: сначала ±10%, потом ±25%; предпочитаем концы предложений. */
function cutByWords(gaps, ideal, step, prev) {
  for (const win of [step * 0.1, step * 0.25]) {
    const cands = gaps.filter((g) => Math.abs((g.a + g.b) / 2 - ideal) <= win && (g.a + g.b) / 2 - prev > step * 0.5);
    for (const kind of [3, 2, 1]) {
      const pool = cands.filter((g) => g.kind === kind);
      if (pool.length) {
        const g = pool.reduce((best, x) => (Math.abs((x.a + x.b) / 2 - ideal) < Math.abs((best.a + best.b) / 2 - ideal) ? x : best));
        return { t: frameInside(g.a, g.b), kind };
      }
    }
  }
  return null;
}

/** Точки разреза ~каждые target секунд: по словам (концы предложений), иначе в паузы, иначе в тихие места. */
export function planCuts(target, maxParts) {
  const total = duration();
  const n = Math.min(maxParts, Math.max(1, Math.round(total / target)));
  if (n <= 1) return { cuts: [], moved: 0, n: 1 };
  const wg = wordGaps();
  if (wg) {
    const step = total / n;
    const cuts = [];
    let prev = 0, sentences = 0, moved = 0, quiet = 0;
    for (let i = 1; i < n; i++) {
      const ideal = step * i;
      const r = cutByWords(wg, ideal, step, prev);
      let cp;
      if (r) { cp = r.t; moved++; if (r.kind === 3) sentences++; } // уже выровнено по кадру внутри паузы
      else {
        cp = quietest(Math.max(prev + step * 0.5, ideal - step * 0.15), ideal + step * 0.15);
        if (cp != null) quiet++; else cp = ideal;
        cp = snapFrame(cp);
      }
      cuts.push(cp);
      prev = cp;
    }
    return { cuts, moved, quiet, sentences, n, source: 'словам' };
  }
  const { gaps, source } = timelineGaps();
  const step = total / n;
  const cuts = [];
  let prev = 0, moved = 0, quiet = 0;
  for (let i = 1; i < n; i++) {
    const ideal = step * i;
    let cp = null;
    for (const win of [step * 0.1, step * 0.25]) {
      const cands = gaps.filter(([a, b]) => Math.abs((a + b) / 2 - ideal) <= win && (a + b) / 2 - prev > step * 0.5);
      const pool = cands.filter(([a, b]) => b - a >= 0.4).length ? cands.filter(([a, b]) => b - a >= 0.4) : cands;
      if (pool.length) {
        const g = pool.reduce((best, g) => (Math.abs((g[0] + g[1]) / 2 - ideal) < Math.abs((best[0] + best[1]) / 2 - ideal) ? g : best));
        cp = (g[0] + g[1]) / 2;
        moved++;
        break;
      }
    }
    if (cp == null) {
      // паузы рядом нет — ищем самый тихий момент по звуковой волне
      cp = quietest(Math.max(prev + step * 0.5, ideal - step * 0.15), ideal + step * 0.15);
      if (cp != null) quiet++; else cp = ideal;
    }
    cp = snapFrame(cp);
    cuts.push(cp);
    prev = cp;
  }
  return { cuts, moved, quiet, n, source };
}

/** Громкость в момент таймлайна по пикам волны (null — волны ещё нет). */
function loudness(t) {
  const c = clipAt(t);
  const pk = c && S.media[c.media]?.peaks;
  if (!pk?.peaks?.length) return null;
  return pk.peaks[Math.floor((c.in + srcOffset(c, t - c.start)) * pk.rate)] ?? null;
}

/** Самый тихий момент (окно 0,3 с) на отрезке [lo, hi]. */
function quietest(lo, hi) {
  const dt = 0.05, win = 6;
  const vals = [];
  for (let t = lo; t <= hi; t += dt) vals.push([t, loudness(t)]);
  if (!vals.length || vals.every(([, v]) => v == null)) return null;
  let best = null, bestV = Infinity;
  for (let i = 0; i + win <= vals.length; i++) {
    const seg = vals.slice(i, i + win).map(([, v]) => v ?? 1);
    const avg = seg.reduce((a, b) => a + b, 0) / win;
    if (avg < bestV) { bestV = avg; best = vals[i + Math.floor(win / 2)][0]; }
  }
  return best;
}

export function splitIntoParts() {
  const { target, max } = S.project.parts;
  const r = planCuts(target, max);
  commit((p) => { p.parts.cuts = r.cuts; });
  return r;
}

/** Всё сразу: субтитры (если нет) → части → заголовки → обложки. */
export async function doEverything(onStatus) {
  if (!S.project.clips.length) throw new Error('Сначала добавь видео на таймлайн');
  let fresh = false;
  // без компа (телефон сам по себе) субтитры пропускаем — части режутся по паузам в звуке
  if (!subs().length && (S.backend.caps.transcribe || !missingWords().length)) {
    if (missingWords().length) {
      onStatus('Распознаю речь…', 0);
      await transcribeAll((j) => onStatus(j.message || 'Распознаю речь…', j.progress));
    }
    onStatus('Собираю субтитры…');
    rebuildSubs();
    fresh = true;
  }
  onStatus('Делю на части по паузам…');
  const r = splitIntoParts();
  // свежие субтитры пересобираем так, чтобы ни один не перескакивал границу части
  // (если субтитры уже были и ты их правил — не трогаем)
  if (fresh) rebuildSubs();
  // заголовки — если профиль жанра их не выключает (у Reddit-историй их заменяет карточка)
  commit((p) => { p.headers.enabled = allProfiles()[p.profile]?.headers?.enabled ?? true; p.covers.enabled = true; });
  emit('toast', { text: 'Готово! ' + cutsSummary(r), kind: 'ok' });
  return r;
}

export function cutsSummary(r) {
  if (r.n <= 1) return 'Видео короче одной части — делить нечего';
  const rest = r.cuts.length - r.moved - (r.quiet || 0);
  if (r.source === 'словам') {
    return `${r.n} частей: ${r.sentences} разрезов на концах предложений, ${r.moved - r.sentences} на запятых и паузах` +
      (r.quiet ? `, ${r.quiet} в тихих местах` : '') + (rest ? `, ${rest} по времени` : '');
  }
  return `${r.n} частей: ${r.moved} разрезов в паузах (по ${r.source})` +
    (r.quiet ? `, ${r.quiet} в самых тихих местах` : '') + (rest ? `, ${rest} просто по времени` : '');
}
