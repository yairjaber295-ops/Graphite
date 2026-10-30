// Окно экспорта. Рендер — движком приложения (как превью). На компе файлы пишутся прямо на диск,
// на телефоне — «Поделиться» (в TikTok, галерею, мессенджеры) или «Сохранить».
import { S, parts, duration, seriesTitle, save, fmtTime } from './store.js';
import { h, field, seg, textInput, modal, toast, pct, check, fill } from './ui.js';
import { stopPlayback, decoded } from './preview.js';
import { exportVideo, checkSupport } from './engine/exporter.js';
import { env } from './backend/index.js';
import { hydrateIcons } from './icons.js';
import { outTimeline } from './engine/ads.js';

const sanitize = (name) => name.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'Видео';

/** thenPublish — после экспорта по частям сразу открыть «Публикации» с этой серией. */
export async function openExport({ thenPublish = false } = {}) {
  if (!S.project.clips.length) return toast('Нечего экспортировать — добавь видео');
  stopPlayback();
  const sup = await checkSupport();
  if (!sup.webgl) return toast('На этом устройстве нет WebGL2 — экспорт невозможен. Подробности: Настройки → Диагностика.', 'err');
  if (!sup.video) return toast('Это устройство не умеет кодировать H.264 через WebCodecs. Обнови Android System WebView / Chrome. Подробности: Настройки → Диагностика.', 'err');
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
      fill(box,
        h('h2', {}, 'Экспорт'),
        field('Что делаем', seg({ parts: `По частям (${ps.length > 1 ? ps.length : '—'})`, whole: 'Одним видео' }, mode, (v) => {
          if (v === 'parts' && ps.length < 2) return toast('Сначала разбей видео на части (вкладка «Авто»)');
          mode = v; draw();
        })),
        field('Название (имя файлов)', textInput(title, (v) => { title = v; })),
        mode === 'parts' ? check('Обложка на первый кадр каждой части', withCovers, (v) => { withCovers = v; }) : null,
        check(mode === 'parts' ? 'Обложки ещё и картинками (.jpg) — чтобы ставить обложкой в TikTok' : 'Обложку ещё и картинкой (.jpg)', coverImages, (v) => { coverImages = v; }),
        S.backend.kind === 'pc' ? field('Папка', h('div', { class: 'row' },
          h('div', { class: 'file-list', style: { flex: 1 } }, outDir || '…'),
          h('button', { class: 'btn fixed', onclick: async () => { const d = await S.backend.pickFolder(); if (d) { outDir = d; draw(); } } }, 'Изменить'))) : null,
        S.backend.kind === 'remote' ? h('div', { class: 'note' }, 'Файлы сохранятся на компе в папке нарезок.') : null,
        S.backend.kind === 'local' ? h('div', { class: 'note' }, 'После рендера каждую часть можно отправить в TikTok или сохранить. Держи приложение открытым, пока идёт рендер.') : null,
        h('div', { class: 'note' }, mode === 'parts'
          ? `${ps.length} файлов «${sanitize(title)} (часть 1)» … «(финал)». ${S.project.canvas.w}×${S.project.canvas.h}, ${S.project.canvas.fps} fps.`
          : `Один файл ${fmtTime(outTimeline(0, duration()).len)}, ${S.project.canvas.w}×${S.project.canvas.h}, ${S.project.canvas.fps} fps.`),
        sup.note ? h('div', { class: 'note warn' }, `Это устройство кодирует так: ${sup.note}. На компе будет полное качество.`) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: close }, 'Отмена'),
          h('button', { class: 'btn primary', onclick: () => run(box, close, { mode, title: title.trim() || seriesTitle(), outDir, withCovers, coverImages, thenPublish }) },
            thenPublish && mode === 'parts' ? 'Экспортировать и запланировать' : 'Экспортировать')));
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
        h('div', { class: 'mi-thumb' }, h('span', { 'data-icon': 'film' })),
        h('div', { class: 'mi-info' }, h('div', { class: 'mi-name' }, r.name), h('div', { class: 'mi-meta' }, `${(r.blob.size / 1048576).toFixed(1)} МБ`)),
        h('button', { class: 'btn primary', onclick: () => shareFile(r) }, h('span', { 'data-icon': 'share' }), 'Отправить'))))
      : h('div', { class: 'file-list' }, ...results.map((r) => h('div', {}, r.name))),
    local ? h('div', { class: 'note' }, '«Отправить» → TikTok, «Сохранить видео» в галерею или любое приложение.') : null,
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

/** Сохранить/поделиться готовым видео на телефоне. */
export async function shareFile({ blob, name }) {
  const file = new File([blob], name, { type: blob.type || 'video/mp4' });
  const Cap = window.Capacitor?.Plugins;
  try {
    if (env.native && Cap?.Filesystem && Cap?.Share) {
      // Android-приложение: пишем во временную папку и открываем системное «Поделиться»
      const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
      const w = await Cap.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' });
      await Cap.Share.share({ title: name, files: [w.uri] });
      return;
    }
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
    console.warn(e);
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
