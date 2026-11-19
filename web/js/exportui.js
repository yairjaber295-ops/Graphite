// Окно экспорта. Рендер — движком приложения (как превью). На компе файлы пишутся прямо на диск,
// на телефоне — «Поделиться» (в TikTok, галерею, мессенджеры) или «Сохранить».
import { S, parts, duration, seriesTitle, save, fmtTime } from './store.js';
import { h, field, seg, textInput, modal, toast, pct, check, fill } from './ui.js';
import { stopPlayback, decoded } from './preview.js';
import { exportVideo, checkSupport } from './engine/exporter.js';
import { exportAudio, AUDIO_FORMATS } from './engine/audioexport.js';
import { env } from './backend/index.js';
import { hydrateIcons } from './icons.js';
import { outTimeline } from './engine/ads.js';

const sanitize = (name) => name.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'Видео';

/** thenPublish — после экспорта по частям сразу открыть «Публикации» с этой серией. */
export async function openExport({ thenPublish = false } = {}) {
  const hasVideo = S.project.clips.length > 0, hasAudio = (S.project.audio || []).length > 0;
  if (!hasVideo && !hasAudio) return toast('Нечего экспортировать — добавь видео или музыку');
  stopPlayback();
  // проект «Музыка» и проект без видео — по умолчанию сохраняем звук
  let what = hasVideo && S.project.kind !== 'music' ? 'video' : 'audio';
  let afmt = 'mp3', abr = 320_000, stems = false;
  const sup = hasVideo ? await checkSupport() : { webgl: true, video: false, note: '' };
  const videoProblem = !hasVideo ? null : !sup.webgl ? 'На этом устройстве нет WebGL2 — экспорт видео невозможен. Подробности: Настройки → Диагностика.'
    : !sup.video ? 'Это устройство не умеет кодировать H.264 через WebCodecs. Обнови Android System WebView / Chrome. Подробности: Настройки → Диагностика.' : null;
  if (videoProblem && !hasAudio) return toast(videoProblem, 'err');
  if (videoProblem) what = 'audio';
  const ps = parts();
  let mode = ps.length > 1 ? 'parts' : 'whole';
  let title = seriesTitle();
  let outDir = null;
  let withCovers = S.project.covers.enabled;
  let coverImages = S.project.covers.enabled;
  const disk = S.backend.caps.saveToDisk;
  if (disk && S.backend.kind === 'pc') outDir = await S.backend.defaultOutDir(title).catch(() => null);

  modal((box, close) => {
    const draw = () => {
      const audio = what === 'audio';
      fill(box,
        h('h2', {}, 'Экспорт'),
        hasVideo ? field('Что сохранить', seg({ video: 'Видео (MP4)', audio: 'Только звук' }, what, (v) => {
          if (v === 'video' && videoProblem) return toast(videoProblem, 'err');
          what = v; draw();
        })) : null,
        audio ? field('Формат', seg(Object.fromEntries(Object.entries(AUDIO_FORMATS).map(([k, f]) => [k, f.label])), afmt, (v) => { afmt = v; draw(); })) : null,
        audio && afmt !== 'wav' ? field('Качество', seg({ 192000: '192 кбит/с', 320000: '320 кбит/с' }, String(abr), (v) => { abr = +v; draw(); })) : null,
        audio && (S.project.audio || []).length > 1 ? check('Ещё и стемы — каждая дорожка отдельным файлом (для сведения в другой программе)', stems, (v) => { stems = v; }) : null,
        audio ? null : field('Что делаем', seg({ parts: `По частям (${ps.length > 1 ? ps.length : '—'})`, whole: 'Одним видео' }, mode, (v) => {
          if (v === 'parts' && ps.length < 2) return toast('Сначала разбей видео на части (вкладка «Авто»)');
          mode = v; draw();
        })),
        field('Название (имя файлов)', textInput(title, (v) => { title = v; })),
        !audio && mode === 'parts' ? check('Обложка на первый кадр каждой части', withCovers, (v) => { withCovers = v; }) : null,
        audio ? null : check(mode === 'parts' ? 'Обложки ещё и картинками (.jpg) — чтобы ставить обложкой в TikTok' : 'Обложку ещё и картинкой (.jpg)', coverImages, (v) => { coverImages = v; }),
        S.backend.kind === 'pc' ? field('Папка', h('div', { class: 'row' },
          h('div', { class: 'file-list', style: { flex: 1 } }, outDir || '…'),
          h('button', { class: 'btn fixed', onclick: async () => { const d = await S.backend.pickFolder(); if (d) { outDir = d; draw(); } } }, 'Изменить'))) : null,
        S.backend.kind === 'remote' ? h('div', { class: 'note' }, 'Файлы сохранятся на компе в папке нарезок.') : null,
        S.backend.kind === 'local' ? h('div', { class: 'note' }, 'После рендера каждую часть можно отправить в TikTok или сохранить. Держи приложение открытым, пока идёт рендер.') : null,
        h('div', { class: 'note' }, audio
          ? `Файл «${sanitize(title)}.${AUDIO_FORMATS[afmt].ext}», ${fmtTime(duration())} — со всеми эффектами: скорость, slowed/reverb, ремиксы, бас, громкость.`
          : mode === 'parts'
            ? `${ps.length} файлов «${sanitize(title)} (часть 1)» … «(финал)». ${S.project.canvas.w}×${S.project.canvas.h}, ${S.project.canvas.fps} fps.`
            : `Один файл ${fmtTime(outTimeline(0, duration()).len)}, ${S.project.canvas.w}×${S.project.canvas.h}, ${S.project.canvas.fps} fps.`),
        !audio && sup.note ? h('div', { class: 'note warn' }, `Это устройство кодирует так: ${sup.note}. На компе будет полное качество.`) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: close }, 'Отмена'),
          h('button', { class: 'btn primary', onclick: () => (audio
            ? runAudio(box, close, { title: title.trim() || seriesTitle(), outDir, format: afmt, bitrate: abr, stems })
            : run(box, close, { mode, title: title.trim() || seriesTitle(), outDir, withCovers, coverImages, thenPublish })) },
            audio ? 'Сохранить звук' : thenPublish && mode === 'parts' ? 'Экспортировать и запланировать' : 'Экспортировать')));
    };
    draw();
  });
}

async function run(box, close, opts) {
  box.dataset.locked = '1';
  const status = h('div', { class: 'note' }, 'Подготовка…');
  const bar = h('i', { style: { width: '0%' } });
  let cancelled = false;
  fill(box, h('h2', {}, 'Экспорт'), status, h('div', { class: 'progress' }, bar),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { cancelled = true; status.textContent = 'Останавливаю…'; } }, 'Отменить')));
  const wakeLock = await navigator.wakeLock?.request('screen').catch(() => null); // телефон не уснёт посреди рендера
  try {
    await save();
    const name = sanitize(opts.title);
    const dir = opts.outDir || (S.backend.kind === 'remote' ? await S.backend.defaultOutDir(opts.title) : name);
    const ps = parts();
    const segments = opts.mode === 'parts'
      ? ps.map((p) => ({ start: p.start, end: p.end, name: `${name} ${p.label}`.trim(), label: p.label, cover: opts.withCovers, coverImage: opts.coverImages }))
      : [{ start: 0, end: duration(), name, label: '', cover: false, coverImage: opts.coverImages }];
    const covers = [];
    const pid = S.project.id;
    const mediaList = (S.project.media || []).filter(Boolean);
    const mediaById = Object.fromEntries(mediaList.map((m) => [m.id, m]));
    await S.backend.prepareExport?.(pid, mediaList);
    const t0 = Date.now();
    const results = await exportVideo({
      segments,
      source: (mid) => {
        const m = mediaById[mid] || mediaList.find((x) => x?.id === mid) || mid;
        return S.backend.exportSource(pid, m);
      },
      decoded,
      target: (seg) => S.backend.exportTarget(dir, sanitize(seg.name) + '.mp4'),
      isCancelled: () => cancelled,
      onCover: async (seg, i, blob) => { if (blob) covers.push(await S.backend.writeFile(dir, sanitize(seg.name) + '.jpg', blob)); },
      onProgress: (p, msg) => {
        bar.style.width = pct(p);
        const el = (Date.now() - t0) / 1000;
        const eta = p > 0.03 ? Math.round(el / p - el) : null;
        status.textContent = `${msg} — всего ${Math.round(p * 100)}%${eta != null ? `, осталось ~${eta} с` : ''}`;
      },
    });
    if (opts.mode === 'parts' && S.backend.caps.saveToDisk) {
      await S.backend.writeSeries(dir, {
        title: opts.title, source: 'editor', project: pid, created: new Date().toISOString(),
        parts: segments.map((s, i) => ({ index: i + 1, label: s.label, file: sanitize(s.name) + '.mp4', duration: +outTimeline(s.start, s.end).len.toFixed(3) })),
      });
    }
    finish(box, close, results, { ...opts, dir, covers, seconds: (Date.now() - t0) / 1000 });
  } catch (e) {
    delete box.dataset.locked;
    fill(box, h('h2', {}, cancelled ? 'Экспорт остановлен' : 'Экспорт не удался'), h('div', { class: 'note warn' }, e.message),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Закрыть')));
    console.error(e);
  } finally {
    wakeLock?.release?.();
  }
}

/** Только звук: MP3 / M4A / WAV. */
async function runAudio(box, close, opts) {
  box.dataset.locked = '1';
  const status = h('div', { class: 'note' }, 'Подготовка…');
  const bar = h('i', { style: { width: '0%' } });
  let cancelled = false;
  fill(box, h('h2', {}, 'Сохраняю звук'), status, h('div', { class: 'progress' }, bar),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { cancelled = true; status.textContent = 'Останавливаю…'; } }, 'Отменить')));
  const wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
  try {
    await save();
    const name = sanitize(opts.title);
    const dir = opts.outDir || (S.backend.kind === 'remote' ? await S.backend.defaultOutDir(opts.title) : name);
    const pid = S.project.id;
    const mediaList = (S.project.media || []).filter(Boolean);
    await S.backend.prepareExport?.(pid, mediaList);
    const t0 = Date.now();
    const file = `${name}.${AUDIO_FORMATS[opts.format].ext}`;
    const ext = AUDIO_FORMATS[opts.format].ext;
    // общий микс + (по галочке) стемы: каждая включённая дорожка отдельно, той же длины — ровно ложатся друг на друга
    const jobs = [{ file, only: null, label: 'Микс' }];
    if (opts.stems) {
      S.project.audio.filter((a) => !a.muted).forEach((a, i) => {
        const nm = (mediaList.find((m) => m.id === a.media)?.name || 'дорожка').replace(/\.[^.]+$/, '');
        jobs.push({ file: sanitize(`${name} — стем ${i + 1} ${nm}`) + `.${ext}`, only: [a.id], label: `Стем ${i + 1}: ${nm}` });
      });
    }
    const results = [];
    for (const [k, j] of jobs.entries()) {
      results.push(await exportAudio({
        format: opts.format, bitrate: opts.bitrate, start: 0, end: duration(), decoded, only: j.only,
        source: (mid) => S.backend.exportSource(pid, mediaList.find((m) => m.id === mid) || mid),
        target: S.backend.exportTarget(dir, j.file),
        isCancelled: () => cancelled,
        onProgress: (p, msg) => { const all = (k + p) / jobs.length; bar.style.width = pct(all); status.textContent = `${j.label}: ${msg} — ${Math.round(all * 100)}%`; },
      }));
    }
    finish(box, close, results, { ...opts, mode: 'whole', dir, covers: [], seconds: (Date.now() - t0) / 1000 });
  } catch (e) {
    delete box.dataset.locked;
    fill(box, h('h2', {}, cancelled ? 'Экспорт остановлен' : 'Не удалось сохранить звук'), h('div', { class: 'note warn' }, e.message),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Закрыть')));
    console.error(e);
  } finally {
    wakeLock?.release?.();
  }
}

/** Строка под именем файла: размер и куда сохранён (на телефоне запись начинается сразу). */
function savedMeta(r) {
  const size = `${(r.blob.size / 1048576).toFixed(1)} МБ`;
  const el = h('div', { class: 'mi-meta' }, size);
  const p = saveOnPhone(r);
  if (p) {
    el.textContent = `${size} · сохраняю…`;
    p.then((s) => { el.textContent = s?.where ? `${size} · сохранено: ${s.where}` : `${size} · во временной папке`; })
      .catch((e) => { el.textContent = `${size} · не сохранилось: ${e?.message || e}`; });
  }
  return el;
}

function finish(box, close, results, opts) {
  delete box.dataset.locked;
  const schedule = () => { close(); import('./publish.js').then((m) => m.publishDialog({ project: S.project })); };
  if (opts.thenPublish && opts.mode === 'parts' && S.backend.caps.uploader) {
    toast(`Готово: ${results.length} файлов — открываю публикации`, 'ok');
    return schedule();
  }
  const local = S.backend.kind === 'local';
  fill(box, 
    h('h2', {}, `Готово: ${results.length} ${results.length === 1 ? 'файл' : 'файлов'} за ${Math.round(opts.seconds)} с`),
    local
      ? h('div', {}, ...results.map((r) => h('div', { class: 'media-item' },
        h('div', { class: 'mi-thumb' }, h('span', { 'data-icon': /^audio\//.test(r.blob.type) ? 'music' : 'film' })),
        h('div', { class: 'mi-info' }, h('div', { class: 'mi-name' }, r.name), savedMeta(r)),
        h('button', { class: 'btn primary', onclick: () => shareFile(r) }, h('span', { 'data-icon': 'share' }), 'Отправить'))))
      : h('div', { class: 'file-list' }, ...results.map((r) => h('div', {}, r.name))),
    local ? h('div', { class: 'note' }, env.native
      ? 'Видео сохраняется в «Документы/Graphite» (приложение «Файлы»). «Отправить» → TikTok, галерея, Telegram или любое приложение.'
      : '«Отправить» → TikTok, «Сохранить видео» в галерею или любое приложение.') : null,
    opts.covers.length ? h('h3', { style: { marginTop: '14px' } }, 'Обложки') : null,
    opts.covers.length ? (local
      ? h('div', { class: 'cover-row' }, ...opts.covers.map((c) => h('img', { src: URL.createObjectURL(c.blob), title: c.name, onclick: () => shareFile(c) })))
      : h('div', { class: 'file-list' }, ...opts.covers.map((c) => h('div', {}, c.name)))) : null,
    opts.covers.length && local ? h('div', { class: 'note' }, 'Нажми на обложку — сохранить или отправить.') : null,
    opts.mode === 'parts' && !local ? h('div', { class: 'note' }, 'Рядом лежит series.json — загрузчик в TikTok сам возьмёт названия частей.') : null,
    h('div', { class: 'actions' },
      S.backend.caps.openFolder ? h('button', { class: 'btn', onclick: () => S.backend.openFolder(opts.dir) }, 'Открыть папку') : null,
      opts.mode === 'parts' && S.backend.caps.uploader
        ? h('button', { class: 'btn', onclick: schedule }, 'Запланировать в TikTok')
        : null,
      h('button', { class: 'btn primary', onclick: close }, 'Закрыть')));
  hydrateIcons(box);
}

const CHUNK = 3 * 1024 * 1024;   // кратно 3 байтам — куски base64 склеиваются без порчи
const SAVE_DIR = 'Graphite';

const b64Of = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1] || '');
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(blob);
});

/** Записать файл на телефон кусками (целиком в одну строку не влезает в память на длинных видео —
 *  из-за этого приложение и падало на «Отправить»). Возвращает { uri, where }. */
async function writeChunked(FS, blob, path, directory) {
  for (let off = 0, first = true; off < blob.size || first; off += CHUNK, first = false) {
    const data = await b64Of(blob.slice(off, off + CHUNK));
    if (first) await FS.writeFile({ path, data, directory, recursive: true });
    else await FS.appendFile({ path, data, directory });
  }
  return (await FS.getUri({ path, directory })).uri;
}

/** Сохранить готовый файл на телефоне: «Документы/Graphite» (видно в «Файлах»), если нельзя — во временную папку.
 *  Один раз на файл: повторное «Отправить» берёт уже записанный. */
export function saveOnPhone(r) {
  const FS = window.Capacitor?.Plugins?.Filesystem;
  if (!env.native || !FS) return Promise.resolve(null);
  r.saving ||= (async () => {
    try {
      const uri = await writeChunked(FS, r.blob, `${SAVE_DIR}/${r.name}`, 'DOCUMENTS');
      return { uri, where: `Документы/${SAVE_DIR}` };
    } catch (e) {
      console.warn('Документы недоступны, пишу во временную папку', e);
      const uri = await writeChunked(FS, r.blob, r.name, 'CACHE');
      return { uri, where: null };
    }
  })();
  r.saving.catch(() => { r.saving = null; });   // при ошибке — можно попробовать ещё раз
  return r.saving;
}

/** Сохранить/поделиться готовым видео на телефоне. */
export async function shareFile(r) {
  const { blob, name } = r;
  const Cap = window.Capacitor?.Plugins;
  try {
    if (env.native && Cap?.Filesystem && Cap?.Share) {
      // Android-приложение: файл уже на телефоне — открываем системное «Поделиться» (TikTok, галерея, Telegram…)
      const saved = await saveOnPhone(r);
      try {
        await Cap.Share.share({ title: name, files: [saved.uri] });
      } catch (e) {
        if (!saved.where || /cancel/i.test(e?.message || '')) throw e;
        // Samsung «Защищённая папка» (Knox) и другие профили могут не дать поделиться файлом из «Документов» —
        // тогда отдаём копию из внутренней временной папки приложения
        console.warn('share из Документов не вышел, пробую временную папку', e);
        r.cacheUri ||= await writeChunked(Cap.Filesystem, blob, name, 'CACHE');
        await Cap.Share.share({ title: name, files: [r.cacheUri] });
      }
      return;
    }
    const file = new File([blob], name, { type: blob.type || 'video/mp4' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError' || /cancel/i.test(e?.message || '')) return;
    console.warn(e);
    if (env.native) { toast('Не получилось отправить: ' + (e?.message || e), 'err'); return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
