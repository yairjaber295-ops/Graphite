// Хранилище «на телефоне»: всё внутри приложения (IndexedDB), анализ видео — прямо на устройстве.
// Субтитры: если подключён комп, звук отправляется ему на распознавание.
import * as MB from 'mediabunny';
import { pickFiles } from './server.js';
import { clipDur } from '../engine/speed.js';

const DB_NAME = 'narezchik', DB_VER = 1;
let dbp = null;

function db() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['projects', 'files', 'media', 'thumbs']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Нет места на устройстве?'));
  });
}
const get = (s, k) => tx(s, 'readonly', (st) => st.get(k));
const put = (s, k, v) => tx(s, 'readwrite', (st) => st.put(v, k));
const del = (s, k) => tx(s, 'readwrite', (st) => st.delete(k));
const all = (s) => tx(s, 'readonly', (st) => st.getAll());
const keys = (s) => tx(s, 'readonly', (st) => st.getAllKeys());

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const LIB_KEY = 'narezchik.adlib';
const libLoad = () => { try { return JSON.parse(localStorage.getItem(LIB_KEY)) || []; } catch { return []; } };
const libSave = (list) => { try { localStorage.setItem(LIB_KEY, JSON.stringify(list)); } catch { /* приватный режим */ } };
const needsProxy = (m) => m.kind === 'video' && Math.max(m.width || 0, m.height || 0) > 1000;
const THUMB_H = 64, THUMB_INTERVAL = 2, PER_TILE = 50, PEAKS_RATE = 20;

export class LocalBackend {
  constructor(pcLink = null) {
    this.kind = 'local';
    this.pc = pcLink; // ServerBackend компа по Wi-Fi (для субтитров), если подключён
    this.caps = { transcribe: !!pcLink, proxies: false, saveToDisk: false, uploader: false, openFolder: false, pickPaths: false, enhance: !!pcLink };
    this.urls = {};
    this.xfiles = {};
    this.proxying = {}; this.proxyProgress = {}; this.proxyChain = Promise.resolve();   // файлы, уже отправленные на комп для улучшения: `${pid}/${mid}` → id на компе
    this.analyzing = {};
  }

  async listProjects() {
    const ps = await all('projects');
    return ps.map((p) => {
      const cuts = p.parts?.cuts || [];
      const c = p.clips?.[0];
      return { id: p.id, name: p.name, updated: p.updatedAt || 0,
        duration: (p.clips || []).reduce((s, x) => s + clipDur(x), 0)
          || Math.max(0, ...(p.audio || []).map((a) => a.start + (a.out - a.in) / Math.max(0.25, a.speed || 1))), media: (p.media || []).map((m) => m.name).slice(0, 3),
        kind: p.kind || (p.autoedit ? 'edit' : null), profile: p.profile, title: p.title || '', parts: cuts.length ? cuts.length + 1 : 0,
        clips: (p.clips || []).length, subs: (p.texts || []).filter((t) => t.track === 'subs').length,
        aspect: `${p.canvas?.w || 1080}x${p.canvas?.h || 1920}`, poster: !!c,
        posterOf: c ? { media: p.media?.find((m) => m.id === c.media), t: c.in + Math.min(1, (c.out - c.in) * 0.3) } : null };
    }).sort((a, b) => b.updated - a.updated);
  }

  /** Обложка карточки: кадр первого клипа, считается один раз и хранится в приложении. */
  async posterUrl(p) {
    const src = p.posterOf;
    if (!src?.media) return null;
    const key = `${p.id}/poster:${src.media.id}:${src.t.toFixed(2)}`;
    if (this.urls[key]) return this.urls[key];
    let blob = await get('thumbs', key);
    if (!blob) {
      const f = await this.file(p.id, src.media.id);
      if (!f) return null;
      if (src.media.kind === 'image') {
        const bmp = await createImageBitmap(f);
        const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
        const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
      } else {
        const input = new MB.Input({ source: new MB.BlobSource(f), formats: MB.ALL_FORMATS });
        try {
          const vt = await input.getPrimaryVideoTrack();
          if (!vt) return null;
          const w = 480, h = Math.round((480 * (src.media.height || 9)) / (src.media.width || 16));
          const wc = await new MB.CanvasSink(vt, { width: w, height: h, fit: 'cover' }).getCanvas(src.t);
          if (!wc) return null;
          let cv = wc.canvas;
          if (!(cv instanceof OffscreenCanvas)) { const o = new OffscreenCanvas(cv.width, cv.height); o.getContext('2d').drawImage(cv, 0, 0); cv = o; }
          blob = await toJpeg(cv);
        } finally { input.dispose?.(); }
      }
      if (blob) await put('thumbs', key, blob);
    }
    return blob ? (this.urls[key] = URL.createObjectURL(blob)) : null;
  }

  async renameProject(id, name) {
    const p = await get('projects', id);
    if (p) { p.name = name; await put('projects', id, p); }
  }

  /** Копия проекта: видео не дублируются — копия ссылается на те же файлы в приложении. */
  async duplicateProject(id) {
    const p = structuredClone(await get('projects', id));
    const nid = uid();
    for (const m of p.media || []) {
      const f = await this.file(id, m.id);
      if (f) await put('files', `${nid}/${m.id}`, f);
      const meta = await get('media', `${id}/${m.id}`);
      if (meta) await put('media', `${nid}/${m.id}`, meta);
      for (let k = 0; k < (meta?.tiles || 0); k++) { const t = await get('thumbs', `${id}/${m.id}/${k}`); if (t) await put('thumbs', `${nid}/${m.id}/${k}`, t); }
    }
    Object.assign(p, { id: nid, name: `${p.name} (копия)`, updatedAt: Date.now() / 1000 });
    await put('projects', nid, p);
    return { id: nid, name: p.name };
  }
  async createProject(name) {
    const p = { version: 2, id: uid(), name: name || 'Новый проект', media: [], clips: [], texts: [], updatedAt: Date.now() / 1000 };
    await put('projects', p.id, p);
    return p;
  }
  loadProject(id) { return get('projects', id); }
  async saveProject(p) { p.updatedAt = Date.now() / 1000; await put('projects', p.id, structuredClone(p)); return { ok: true }; }
  saveBeacon(p) { this.saveProject(p); }
  async deleteProject(id) {
    const p = await get('projects', id);
    for (const m of p?.media || []) await this.dropMedia(id, m.id);
    await del('projects', id);
  }
  async dropMedia(pid, mid) {
    await del('files', `${pid}/${mid}`);
    await del('files', `${pid}/${mid}/orig`);
    await del('files', `${pid}/${mid}/proxy`);
    await del('media', `${pid}/${mid}`);
    for (const k of await keys('thumbs')) if (String(k).startsWith(`${pid}/${mid}/`)) await del('thumbs', k);
  }

  async addMedia(pid, kind = 'video') {
    const files = await pickFiles(kind);
    const items = [], errors = [];
    for (const f of files) {
      try { items.push(await this.uploadMedia(pid, f)); } catch (e) { errors.push(`${f.name}: ${e.message}`); }
    }
    return { items, errors };
  }

  async uploadMedia(pid, f) {
    const info = await probeFile(f);
    const mid = uid();
    await put('files', `${pid}/${mid}`, f);
    const m = { id: mid, name: f.name, kind: info.kind, duration: info.duration, width: info.width, height: info.height,
      fps: info.fps, has_audio: info.hasAudio, local: true };
    await put('media', `${pid}/${mid}`, { status: 'preparing' });
    this.analyze(pid, m);
    return m;
  }

  async file(pid, mid) { return get('files', `${pid}/${mid}`); }

  // библиотека рекламы на телефоне: копии роликов в приложении (files: adlib/<id>), список — в localStorage
  libList() { return Promise.resolve(libLoad()); }
  async libAdd(pid, m) {
    const list = libLoad();
    const same = list.find((e) => e.name === m.name && Math.abs((e.duration || 0) - (m.duration || 0)) < 0.05);
    if (same) return same;
    const f = await this.file(pid, m.id);
    if (!f) throw new Error('файл ролика не найден');
    const e = { id: uid(), name: m.name, kind: m.kind, duration: m.duration, width: m.width, height: m.height, added: Date.now() / 1000 };
    await put('files', `adlib/${e.id}`, f);
    libSave([...list, e]);
    return e;
  }
  async libUse(pid, e) {
    const f = await get('files', `adlib/${e.id}`);
    if (!f) throw new Error(`«${e.name}» нет в библиотеке на этом телефоне`);
    return { ...(await this.uploadMedia(pid, new File([f], e.name, { type: f.type || 'video/mp4' }))), lib: e.id, role: 'ad' };
  }
  async libRemove(id) { await del('files', `adlib/${id}`); libSave(libLoad().filter((e) => e.id !== id)); }

  /** Миниатюры и звуковая волна считаются в фоне прямо на телефоне. */
  analyze(pid, m) {
    const key = `${pid}/${m.id}`;
    if (this.analyzing[key]) return this.analyzing[key];
    if (m.kind === 'image') return (this.analyzing[key] = put('media', key, { status: 'ready' })); // фото анализировать нечего
    this.analyzing[key] = (async () => {
      const file = await this.file(pid, m.id);
      const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
      const meta = { status: 'preparing' };
      try {
        const vt = m.kind === 'video' ? await input.getPrimaryVideoTrack() : null;
        if (vt) {
          const tw = Math.round(THUMB_H * m.width / m.height);
          const sink = new MB.CanvasSink(vt, { width: tw, height: THUMB_H, fit: 'cover' });
          const n = Math.max(1, Math.ceil(m.duration / THUMB_INTERVAL));
          const ts = Array.from({ length: n }, (_, i) => Math.min(i * THUMB_INTERVAL, Math.max(0, m.duration - 0.1)));
          const tiles = [];
          let tile = null, tctx = null, i = 0;
          for await (const wc of sink.canvasesAtTimestamps(ts)) {
            if (i % PER_TILE === 0) {
              if (tile) tiles.push(await toJpeg(tile));
              tile = new OffscreenCanvas(tw * Math.min(PER_TILE, n - i), THUMB_H);
              tctx = tile.getContext('2d');
            }
            if (wc) tctx.drawImage(wc.canvas, (i % PER_TILE) * tw, 0);
            i++;
          }
          if (tile) tiles.push(await toJpeg(tile));
          for (let k = 0; k < tiles.length; k++) await put('thumbs', `${pid}/${m.id}/${k}`, tiles[k]);
          Object.assign(meta, { tiles: tiles.length, thumb_w: tw, thumb_h: THUMB_H, thumb_interval: THUMB_INTERVAL, thumbs_per_tile: PER_TILE });
        }
        const at = await input.getPrimaryAudioTrack();
        if (at) {
          const peaks = [];
          const step = 1 / PEAKS_RATE;
          let bucketEnd = step, mx = 0;
          for await (const { buffer, timestamp } of new MB.AudioBufferSink(at).buffers()) {
            const ch = buffer.getChannelData(0), sr = buffer.sampleRate;
            for (let s = 0; s < ch.length; s++) {
              const t = timestamp + s / sr;
              while (t >= bucketEnd) { peaks.push(+Math.sqrt(mx).toFixed(3)); mx = 0; bucketEnd += step; }
              const v = Math.abs(ch[s]);
              if (v > mx) mx = v;
            }
          }
          peaks.push(+Math.sqrt(mx).toFixed(3));
          meta.peaks = { rate: PEAKS_RATE, peaks };
          meta.silences = silencesFromPeaks(peaks, PEAKS_RATE);
        }
        meta.status = 'ready';
      } catch (e) {
        console.warn('анализ видео', e);
        meta.status = 'ready';
        meta.error = String(e);
      } finally {
        input.dispose?.();
      }
      await put('media', key, meta);
      if (needsProxy(m)) this.queueProxy(pid, m);
    })();
    return this.analyzing[key];
  }

  /**
   * Лёгкая копия для плавной перемотки — как на компе: ≤960 px, ключевой кадр каждые 0.5 с.
   * В оригиналах с YouTube/телефона ключевые кадры редкие: каждый скачок по таймлайну декодировал сотни кадров.
   * Делается в фоне аппаратным кодеком телефона, по одной за раз; экспорт и улучшение берут оригинал.
   */
  queueProxy(pid, m) {
    const key = `${pid}/${m.id}`;
    if (this.proxying[key]) return;
    this.proxying[key] = this.proxyChain = this.proxyChain.then(() => this.makeProxy(pid, m)).catch((e) => console.warn('лёгкая копия:', e));
  }
  async makeProxy(pid, m) {
    const key = `${pid}/${m.id}`;
    const meta = (await get('media', key)) || {};
    if (meta.proxy || meta.proxyFailed) return;
    const file = await this.file(pid, m.id);
    if (!file) return;
    const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
    const target = new MB.BufferTarget();
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const t0 = performance.now();
    try {
      const conv = await MB.Conversion.init({
        input, output,
        // 30 к/с и ~0.9 Мбит/с: 15-минутное видео ≈ 100 МБ в памяти телефона, декодировать вдвое легче, чем 60 к/с
        video: { ...(m.width >= m.height ? { width: 960 } : { height: 960 }), ...((m.fps || 30) > 32 ? { frameRate: 30 } : {}),
          codec: 'avc', bitrate: 900_000, keyFrameInterval: 0.5, forceTranscode: true },
      });
      if (!conv.isValid) throw new Error(conv.discardedTracks.map((t) => t.reason).join(', ') || 'кодек не поддерживается');
      conv.onProgress = (p) => { this.proxyProgress[key] = p; };
      await conv.execute();
      await put('files', `${key}/proxy`, new Blob([target.buffer], { type: 'video/mp4' }));
      const cur = (await get('media', key)) || meta;
      cur.proxy = true;
      await put('media', key, cur);
      console.info(`лёгкая копия «${m.name}»: ${((performance.now() - t0) / 1000).toFixed(1)} с`);
      this.onMeta?.(m.id, { proxy: true });
    } catch (e) {
      const cur = (await get('media', key)) || meta;
      cur.proxyFailed = String(e?.message || e);
      await put('media', key, cur);
      throw e;
    } finally {
      delete this.proxyProgress[key];
      input.dispose?.();
    }
  }
  async dropProxy(pid, mid) {
    const key = `${pid}/${mid}`;
    await del('files', `${key}/proxy`);
    const meta = (await get('media', key)) || {};
    delete meta.proxy; delete meta.proxyFailed;
    await put('media', key, meta);
    if (this.urls[`${key}/p`]) URL.revokeObjectURL(this.urls[`${key}/p`]);
    delete this.urls[`${key}/p`];
    delete this.proxying[key];
    this.onMeta?.(mid, { proxy: false });
  }

  async mediaState(pid, mid) {
    const meta = (await get('media', `${pid}/${mid}`)) || { status: 'preparing' };
    const st = { status: meta.status, meta, peaks: meta.peaks || null, silences: meta.silences || [], words: meta.words || null };
    if (meta.tiles) {
      st.tileUrls = [];
      for (let k = 0; k < meta.tiles; k++) {
        const ck = `${pid}/${mid}/t${k}`;
        if (!this.urls[ck]) { const b = await get('thumbs', `${pid}/${mid}/${k}`); if (b) this.urls[ck] = URL.createObjectURL(b); }
        st.tileUrls.push(this.urls[ck]);
      }
    }
    if (meta.status === 'ready' && !meta.proxy && !meta.proxyFailed && !this.proxying[`${pid}/${mid}`]) {
      get('projects', pid).then((p) => { const m = p?.media?.find((x) => x.id === mid); if (m && needsProxy(m)) this.queueProxy(pid, m); });
    }
    if (meta.status === 'preparing' && !this.analyzing[`${pid}/${mid}`]) {
      // приложение перезапускали во время анализа — продолжим
      const p = await get('projects', pid);
      const m = p?.media?.find((x) => x.id === mid);
      if (m) this.analyze(pid, m);
    }
    return st;
  }

  playUrl(pid, m, st) {
    const base = `${pid}/${m.id}`;
    const load = (k, get_) => {
      if (k in this.urls) return;   // null — уже грузится (раньше файл заново читался на каждом кадре, пока не загрузится)
      this.urls[k] = null;
      get_().then((f) => { if (f) { this.urls[k] = URL.createObjectURL(f); this.onUrl?.(m.id); } else delete this.urls[k]; });
    };
    if (st?.meta?.proxy && m.kind === 'video') {
      load(`${base}/p`, () => get('files', `${base}/proxy`));
      if (this.urls[`${base}/p`]) return this.urls[`${base}/p`];
    }
    load(base, () => this.file(pid, m.id));
    return this.urls[base];
  }

  exportSource(pid, m) {
    // BlobSource читает файл кусками, целиком в память не грузит
    const mid = typeof m === 'string' ? m : (m?.id || m);
    return new MB.BlobSource((mid && this.fileCache?.[mid]) ?? new Blob());
  }
  async prepareExport(pid, media) {
    this.fileCache = {};
    for (const m of (media || []).filter(Boolean)) {
      const mid = typeof m === 'string' ? m : (m?.id || m);
      if (mid) this.fileCache[mid] = await this.file(pid, mid);
    }
  }

  /** Адрес файла для <img> (фото). */
  async mediaUrl(pid, m) {
    const mid = typeof m === 'string' ? m : (m?.id || m);
    const k = `${pid}/${mid}`;
    if (!this.urls[k]) { const f = await this.file(pid, mid); if (f) this.urls[k] = URL.createObjectURL(f); }
    return this.urls[k];
  }
  /** Фото для экспорта (с учётом поворота из EXIF). */
  async imageBitmap(pid, m) {
    const mid = typeof m === 'string' ? m : (m?.id || m);
    return createImageBitmap(await this.file(pid, mid));
  }

  async audioBuffer(pid, m, ctx) {
    const mid = typeof m === 'string' ? m : (m?.id || m);
    const f = await this.file(pid, mid);
    return f ? ctx.decodeAudioData(await f.arrayBuffer()) : null;
  }

  /** Субтитры: звук 16 кГц отправляется на комп (Whisper работает там). */
  async transcribe(pid, m, opts, onProgress) {
    if (!this.pc) throw new Error('Для субтитров подключись к компу (кнопка «Комп» на главном экране)');
    onProgress?.({ message: 'Готовлю звук…', progress: 0.01 });
    const f = await this.file(pid, m.id);
    const pcm = await pcm16k(f);
    onProgress?.({ message: 'Отправляю звук на комп…', progress: 0.03 });
    const res = await this.pc.transcribePcm(pcm, opts, onProgress);
    const key = `${pid}/${m.id}`;
    const meta = (await get('media', key)) || {};
    meta.words = res;
    await put('media', key, meta);
    return res;
  }

  // --- улучшение качества: файл → на комп (там видеокарта) → результат обратно на место исходника
  async xfile(pid, m, onProgress) {
    const key = `${pid}/${m.id}`;
    if (this.xfiles[key]) return this.xfiles[key];
    if (!this.pc) throw new Error('Подключи комп: улучшение работает на его видеокарте');
    const f = (await get('files', `${key}/orig`)) || (await this.file(pid, m.id));
    if (!f) throw new Error('файл не найден');
    onProgress?.({ message: `Отправляю файл на комп (${Math.round(f.size / 1048576)} МБ)…`, progress: 0 });
    const r = await fetch(this.pc.url(`/api/xfile?name=${encodeURIComponent(m.name || 'video.mp4')}`), { method: 'POST', body: f });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return (this.xfiles[key] = d.fid);
  }
  async enhancePreview(pid, m, t, opts) {
    const fid = await this.xfile(pid, m);
    const r = await this.pc.req('POST', '/api/enhance/preview', { fid, t, opts });
    return { ...r, before: this.pc.url(r.before), after: this.pc.url(r.after) };
  }
  async enhance(pid, m, opts, onProgress, onJob) {
    const key = `${pid}/${m.id}`;
    const fid = await this.xfile(pid, m, onProgress);
    const job = await this.pc.req('POST', '/api/enhance', { fid, opts });
    onJob?.(job.id);
    const r = (await this.pc.waitJob(job.id, onProgress)).result;
    onProgress?.({ message: 'Забираю результат с компа…', progress: 0.99 });
    const res = await fetch(this.pc.url(`/api/xfile/${fid}/${r.file}`));
    if (!res.ok) throw new Error('не удалось скачать результат');
    const blob = await res.blob();
    if (!(await get('files', `${key}/orig`))) await put('files', `${key}/orig`, await this.file(pid, m.id));   // оригинал — для «Вернуть»
    await put('files', key, new File([blob], m.name, { type: r.kind === 'image' ? 'image/png' : 'video/mp4' }));
    this.resetUrl(key);
    if (r.kind !== 'image') { await this.dropProxy(pid, m.id); this.queueProxy(pid, { ...m, width: r.width, height: r.height }); }
    return { width: r.width, height: r.height, enhanced: { ...opts, at: Date.now() / 1000 } };
  }
  /** Инструментал + вокал: файл → на комп (нейросеть там) → два файла обратно в проект на телефоне. */
  async separate(pid, m, onProgress, onJob) {
    const fid = await this.xfile(pid, m, onProgress);
    const job = await this.pc.req('POST', '/api/separate', { fid });
    onJob?.(job.id);
    const r = (await this.pc.waitJob(job.id, onProgress)).result;
    onProgress?.({ message: 'Забираю инструментал и вокал с компа…', progress: 0.99 });
    const base = (m.name || 'звук').replace(/\.[^.]+$/, '');
    const items = [];
    for (const [file, label] of [[r.files[0], 'инструментал'], [r.files[1], 'вокал']]) {
      const res = await fetch(this.pc.url(`/api/xfile/${fid}/${encodeURIComponent(file)}`));
      if (!res.ok) throw new Error('не удалось скачать результат');
      items.push(await this.uploadMedia(pid, new File([await res.blob()], `${base} — ${label}.flac`, { type: 'audio/flac' })));
    }
    return items;
  }

  /** Песня без мата: файл → на комп (нейросеть и Whisper там) → чистая версия обратно в проект на телефоне. */
  async clean(pid, m, opts, onProgress, onJob) {
    const fid = await this.xfile(pid, m, onProgress);
    const job = await this.pc.req('POST', '/api/clean', { fid, opts });
    onJob?.(job.id);
    const r = (await this.pc.waitJob(job.id, onProgress)).result;
    onProgress?.({ message: 'Забираю чистую версию с компа…', progress: 0.99 });
    const res = await fetch(this.pc.url(`/api/xfile/${fid}/${encodeURIComponent(r.files[0])}`));
    if (!res.ok) throw new Error('не удалось скачать результат');
    const base = (m.name || 'звук').replace(/\.[^.]+$/, '');
    return { items: [await this.uploadMedia(pid, new File([await res.blob()], `${base} — без мата.flac`, { type: 'audio/flac' }))], regions: r.regions };
  }

  async unenhance(pid, m) {
    const key = `${pid}/${m.id}`;
    const orig = await get('files', `${key}/orig`);
    const [width, height] = m.enhanced?.from || [m.width, m.height];
    if (orig) {
      await put('files', key, orig); await del('files', `${key}/orig`); this.resetUrl(key);
      if (m.kind === 'video') { await this.dropProxy(pid, m.id); this.queueProxy(pid, { ...m, width, height }); }
    }
    return { width, height };
  }
  resetUrl(key) {
    if (this.urls[key]) URL.revokeObjectURL(this.urls[key]);
    delete this.urls[key];
    if (this.fileCache) delete this.fileCache[key.split('/')[1]];
  }

  /** Экспорт на телефоне: файл собирается в памяти, потом «Поделиться»/«Сохранить». */
  async exportTarget(dir, name) {
    const target = new MB.BufferTarget();
    return {
      target, fastStart: 'in-memory',
      done: async () => ({ name, blob: new Blob([target.buffer], { type: { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav' }[name.split('.').pop()] || 'video/mp4' }) }),
    };
  }
  /** Обложка на телефоне: остаётся в памяти — в окне «Готово» её можно отправить или сохранить. */
  async writeFile(dir, name, blob) { return { name, blob }; }
  async writeSeries() { /* на телефоне не нужно */ }
  async defaultOutDir(title) { return title; }
}

async function toJpeg(canvas) {
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
}

/** Свойства файла без сервера. */
const IMAGE_DURATION = 3600; // фото «бесконечное»: клип можно растянуть сколько угодно

export async function probeFile(file) {
  if (/^image\//.test(file.type) || /\.(jpe?g|png|webp|bmp)$/i.test(file.name)) {
    const bmp = await createImageBitmap(file);
    const info = { kind: 'image', duration: IMAGE_DURATION, width: bmp.width, height: bmp.height, fps: null, hasAudio: false };
    bmp.close?.();
    return info;
  }
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    const at = await input.getPrimaryAudioTrack();
    if (!vt && !at) throw new Error('не похоже на видео или звук');
    const duration = await input.computeDuration();
    if (!vt) return { kind: 'audio', duration, hasAudio: true };
    const stats = await vt.computePacketStats(120).catch(() => null);
    return { kind: 'video', duration, width: await vt.getDisplayWidth(), height: await vt.getDisplayHeight(),
      fps: stats ? Math.round(stats.averagePacketRate * 100) / 100 : 30, hasAudio: !!at };
  } finally {
    input.dispose?.();
  }
}

/** Паузы по звуковой волне: тише 12% от типичной громкости дольше 0,3 с. */
export function silencesFromPeaks(peaks, rate) {
  const sorted = [...peaks].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length * 0.6)] || 0;
  const thr = Math.max(0.02, typical * 0.35);
  const out = [];
  let start = null;
  for (let i = 0; i <= peaks.length; i++) {
    const quiet = i < peaks.length && peaks[i] < thr;
    if (quiet && start == null) start = i;
    if (!quiet && start != null) {
      if ((i - start) / rate >= 0.3) out.push([start / rate, i / rate]);
      start = null;
    }
  }
  return out;
}

/** Звук файла → 16 кГц моно, 16 бит (то, что ест Whisper). */
export async function pcm16k(file) {
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  try {
    const at = await input.getPrimaryAudioTrack();
    if (!at) throw new Error('в видео нет звука');
    const dur = await input.computeDuration();
    const out = new Int16Array(Math.ceil(dur * 16000) + 16000);
    const CH = 30; // секунд за раз
    for (let a = 0; a < dur; a += CH) {
      const b = Math.min(dur, a + CH);
      const ctx = new OfflineAudioContext(1, Math.max(1, Math.round((b - a) * 16000)), 16000);
      for await (const { buffer, timestamp } of new MB.AudioBufferSink(at).buffers(a, b)) {
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(ctx.destination);
        const when = timestamp - a;
        if (when < 0) node.start(0, -when); else node.start(when);
      }
      const r = await ctx.startRendering();
      const d = r.getChannelData(0);
      const off = Math.round(a * 16000);
      for (let i = 0; i < d.length && off + i < out.length; i++) out[off + i] = Math.max(-32768, Math.min(32767, d[i] * 32767));
    }
    return out.subarray(0, Math.ceil(dur * 16000));
  } finally {
    input.dispose?.();
  }
}
