// Автосубтитры на телефоне без компа.
//  • Облако: Groq (бесплатно), OpenAI или любой сервис с OpenAI-совместимым /audio/transcriptions.
//    Телефон только отправляет звук 16 кГц — распознаёт сервер, слова приходят с таймкодами.
//  • Офлайн: Vosk (маленькая русская модель внутри приложения), считает сам телефон, без интернета.
// Результат в том же виде, что у Whisper на компе: { words: [[начало, конец, слово], …] }.

const KEY = 'graphite.asr';
const RATE = 16000;

export const ASR_PROVIDERS = {
  groq: {
    label: 'Groq — бесплатно', base: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys',
    // «Высокая» — полная модель, остальное — turbo (быстрее; в бесплатном лимите обе)
    model: (prec) => (prec === 'large-v3-turbo' ? 'whisper-large-v3' : 'whisper-large-v3-turbo'),
  },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', model: () => 'whisper-1' },
  custom: { label: 'Свой сервис (как OpenAI)', base: '', keyUrl: '', model: () => '' },
};

/** Настройки распознавания хранятся только на этом телефоне. engine: auto | pc | cloud | offline */
export function asrSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* пусто */ }
  return { engine: 'auto', provider: 'groq', key: '', base: '', model: '', ...s };
}
export function saveAsrSettings(patch) {
  const s = { ...asrSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* приватный режим — живём без сохранения */ }
  return s;
}
export const cloudReady = (s = asrSettings()) => !!s.key && (s.provider !== 'custom' || (!!s.base && !!s.model));

/** Как у Whisper на компе: слово начинается с пробела, а «приклеенные» куски (знаки, «-то») — без. */
const spaced = (t) => (/^[-–,.!?:;…%)»"']/.test(t) ? t : ' ' + t);

const baseOf = (s) => (s.provider === 'custom' ? s.base : ASR_PROVIDERS[s.provider]?.base || '').replace(/\/+$/, '');

// ---------------------------------------------------------------------------
//   Облако
// ---------------------------------------------------------------------------
function wav(pcm) {
  const b = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(b);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(b, 44).set(pcm);
  return new Blob([b], { type: 'audio/wav' });
}

/** Куски до 10 минут (у Groq бесплатно — до 25 МБ на файл); режем в самом тихом месте перед границей. */
export function splitPcm(pcm, maxSec = 600) {
  const out = [];
  const max = maxSec * RATE, win = RATE / 10;
  let a = 0;
  while (pcm.length - a > max) {
    let best = a + max, bestE = Infinity;
    for (let s = a + max - 20 * RATE; s + win <= a + max; s += win) {
      let e = 0;
      for (let i = s; i < s + win; i += 4) e += Math.abs(pcm[i]);
      if (e < bestE) { bestE = e; best = s + win / 2; }
    }
    out.push([a, Math.round(best)]);
    a = Math.round(best);
  }
  out.push([a, pcm.length]);
  return out;
}

/** Ответ сервиса → [[начало, конец, слово]]. Если слов с таймкодами нет — делим фразы по длине слов. */
export function wordsFromResponse(d, offset = 0) {
  const out = [];
  if (Array.isArray(d.words) && d.words.length) {
    for (const w of d.words) {
      const t = String(w.word ?? w.text ?? '').trim();
      if (t) out.push([+(offset + w.start).toFixed(3), +(offset + Math.max(w.end, w.start + 0.05)).toFixed(3), spaced(t)]);
    }
    return out;
  }
  for (const sg of d.segments || []) {
    const ws = String(sg.text || '').trim().split(/\s+/).filter(Boolean);
    const total = ws.reduce((n, w) => n + w.length + 1, 0);
    let t = sg.start;
    for (const w of ws) {
      const len = ((sg.end - sg.start) * (w.length + 1)) / total;
      out.push([+(offset + t).toFixed(3), +(offset + t + len).toFixed(3), spaced(w)]);
      t += len;
    }
  }
  return out;
}

function explain(status, body, s) {
  const msg = (() => { try { return JSON.parse(body).error?.message || body; } catch { return body; } })();
  const who = s.provider === 'custom' ? 'сервис' : ASR_PROVIDERS[s.provider].label.split(' ')[0];
  if (status === 401) return `${who}: ключ не подходит — проверь, что вставил его целиком`;
  if (status === 403) return `${who}: доступ запрещён. Из России такие сервисы обычно открываются только через VPN (${msg.slice(0, 120)})`;
  if (status === 404) return `${who}: нет такого адреса или модели (${msg.slice(0, 120)})`;
  if (status === 413) return `${who}: кусок звука слишком большой`;
  if (status === 429) return `${who}: лимит запросов исчерпан — подожди немного (${msg.slice(0, 120)})`;
  return `${who}: ошибка ${status} — ${msg.slice(0, 200)}`;
}

async function post(s, form) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(baseOf(s) + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + s.key }, body: form });
    } catch (e) {
      throw new Error('Нет связи с сервисом распознавания (интернет или VPN?): ' + (e?.message || e));
    }
    if (r.ok) return r.json();
    const body = await r.text();
    // лимит в минуту — подождать и повторить
    if (r.status === 429 && attempt < 3) {
      const wait = Math.min(60, +(r.headers.get('retry-after') || 0) || 10 * (attempt + 1));
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      continue;
    }
    if (r.status >= 500 && attempt < 2) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    throw new Error(explain(r.status, body, s));
  }
}

/** Распознать звук в облаке. pcm — Int16Array 16 кГц моно. */
export async function cloudTranscribe(pcm, { lang, model: prec } = {}, onProgress) {
  const s = asrSettings();
  if (!cloudReady(s)) throw new Error('Вставь API-ключ в настройках распознавания (вкладка «Субтитры»)');
  const model = s.provider === 'custom' ? s.model : ASR_PROVIDERS[s.provider].model(prec);
  const parts = splitPcm(pcm);
  const words = [];
  for (const [k, [a, b]] of parts.entries()) {
    onProgress?.({ message: parts.length > 1 ? `Распознаю в облаке: часть ${k + 1} из ${parts.length}…` : 'Распознаю в облаке…', progress: 0.05 + (0.9 * k) / parts.length });
    const form = new FormData();
    form.append('file', wav(pcm.subarray(a, b)), 'audio.wav');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    form.append('temperature', '0');
    if (lang && lang !== 'auto') form.append('language', lang);
    words.push(...wordsFromResponse(await post(s, form), a / RATE));
  }
  onProgress?.({ message: 'Готово', progress: 1 });
  return { words, language: lang, device: 'cloud', model };
}

/** Проверка ключа: список моделей. Возвращает текст для пользователя. */
export async function checkCloud() {
  const s = asrSettings();
  if (!cloudReady(s)) return { ok: false, text: 'Сначала вставь ключ' };
  try {
    const r = await fetch(baseOf(s) + '/models', { headers: { Authorization: 'Bearer ' + s.key } });
    if (!r.ok) return { ok: false, text: explain(r.status, await r.text(), s) };
    const ids = ((await r.json()).data || []).map((m) => m.id);
    const asr = ids.filter((x) => /whisper|transcribe/i.test(x));
    return { ok: true, text: asr.length ? `Ключ работает. Модели распознавания: ${asr.join(', ')}` : 'Ключ работает' };
  } catch (e) {
    return { ok: false, text: 'Нет связи с сервисом (интернет или VPN?): ' + (e?.message || e) };
  }
}

// ---------------------------------------------------------------------------
//   Офлайн: Vosk внутри приложения (vosk/vosk.js + vosk/model.tar.gz кладёт сборка APK)
// ---------------------------------------------------------------------------
const VOSK_JS = 'vosk/vosk.js', VOSK_MODEL = 'vosk/model.tar.gz', VOSK_READY = 'vosk/ready.json';
let voskModel = null, voskLoading = null, offlineChecked = null;

/** Есть ли офлайн-модель в этой сборке (в APK — есть; в браузере с компа — нет, там Whisper на компе). */
export function offlineAvailable() {
  // маленькая метка, которую кладёт сборка APK (HEAD-запросы встроенный сервер приложения может не понимать)
  offlineChecked ||= fetch(VOSK_READY, { cache: 'no-store' }).then((r) => r.ok).catch(() => false);
  return offlineChecked;
}

function loadScript(src) {
  return new Promise((ok, bad) => {
    const el = document.createElement('script');
    el.src = src; el.onload = ok; el.onerror = () => bad(new Error('не загрузился ' + src));
    document.head.append(el);
  });
}

async function vosk(onProgress) {
  if (voskModel) return voskModel;
  voskLoading ||= (async () => {
    onProgress?.({ message: 'Загружаю офлайн-модель (первый раз — секунд 10–20)…', progress: 0.02 });
    if (!window.Vosk) await loadScript(VOSK_JS);
    window.Vosk.setLogLevel?.(-1);
    // модель читаем здесь и отдаём распознавателю как blob: так не важно, видит ли его фоновый поток файлы приложения
    const r = await fetch(VOSK_MODEL);
    if (!r.ok) throw new Error('нет офлайн-модели в приложении');
    const total = +r.headers.get('content-length') || 46e6;
    const parts = [];
    let got = 0;
    for (const rd = r.body.getReader(); ;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); got += value.length;
      onProgress?.({ message: `Загружаю офлайн-модель… ${Math.min(99, Math.round((100 * got) / total))}%`, progress: 0.02 });
    }
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/gzip' }));
    onProgress?.({ message: 'Запускаю офлайн-модель…', progress: 0.03 });
    // если модель не поднялась (мало памяти и т.п.), createModel может не ответить никогда — ограничиваем ожиданием
    voskModel = await Promise.race([
      window.Vosk.createModel(url, -1),
      new Promise((_, bad) => setTimeout(() => bad(new Error('офлайн-модель не загрузилась за 2 минуты — возможно, не хватает памяти; попробуй облако')), 120000)),
    ]);
    return voskModel;
  })();
  try { return await voskLoading; } catch (e) { voskLoading = null; throw e; }
}

/** Распознать на телефоне. На каждый кусок звука модель присылает ровно одно событие (result или partialresult),
 *  а в конце — финальный result: так видно и прогресс, и момент окончания. */
export async function offlineTranscribe(pcm, _opts, onProgress) {
  if (!(await offlineAvailable())) throw new Error('В этой версии нет офлайн-модели — она есть в приложении для Android');
  const model = await vosk(onProgress);
  const rec = new model.KaldiRecognizer(RATE);
  rec.setWords(true);
  const CH = RATE / 2;                     // по полсекунды
  const chunks = Math.ceil(pcm.length / CH);
  const words = [];
  let events = 0, finalAsked = false;
  try {
    await new Promise((resolve, reject) => {
      let idle = 0;
      const tick = () => {
        clearTimeout(idle);
        // запасной выход: после финального запроса тишина 8 с — значит всё пришло
        if (finalAsked) idle = setTimeout(resolve, 8000);
      };
      const onEvent = (isFinalish) => {
        events++;
        onProgress?.({ message: `Распознаю на телефоне… ${Math.min(100, Math.round((100 * events) / chunks))}%`, progress: 0.05 + (0.93 * Math.min(events, chunks)) / chunks });
        if (finalAsked && events >= chunks + 1 && isFinalish) { clearTimeout(idle); resolve(); } else tick();
      };
      rec.on('result', (m) => {
        for (const w of m.result?.result || []) words.push([+w.start.toFixed(3), +w.end.toFixed(3), spaced(w.word)]);
        onEvent(true);
      });
      rec.on('partialresult', () => onEvent(false));
      rec.on('error', (m) => reject(new Error('Офлайн-распознавание: ' + (m.error || 'ошибка'))));
      // подаём порциями, не забегая далеко вперёд модели — так память не раздувается
      (async () => {
        const f = new Float32Array(CH);
        for (let k = 0; k < chunks; k++) {
          while (k - events > 40) await new Promise((ok) => setTimeout(ok, 30));
          const part = pcm.subarray(k * CH, (k + 1) * CH);
          const buf = part.length === CH ? f : new Float32Array(part.length);
          for (let i = 0; i < part.length; i++) buf[i] = part[i] / 32768;
          rec.acceptWaveformFloat(buf.slice(), RATE);
        }
        finalAsked = true;
        rec.retrieveFinalResult();
        tick();
      })().catch(reject);
    });
  } finally {
    try { rec.remove(); } catch { /* уже убран */ }
  }
  words.sort((a, b) => a[0] - b[0]);
  onProgress?.({ message: 'Готово', progress: 1 });
  return { words, language: 'ru', device: 'phone', model: 'vosk-small-ru' };
}
