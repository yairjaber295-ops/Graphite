// Хранилище «на компе»: локальный сервер редактора (на ПК) или сервер компа по Wi-Fi (с телефона).
import * as MB from 'mediabunny';

export class ServerBackend {
  /** base — '' для своего компа или 'http://192.168.x.x:8765'; key — код доступа для телефона. */
  constructor(base = '', key = '') {
    this.base = base.replace(/\/$/, '');
    this.key = key;
    this.kind = base ? 'remote' : 'pc';
    this.caps = { transcribe: true, proxies: true, saveToDisk: true, uploader: !base, openFolder: !base, pickPaths: !base, enhance: true };
  }

  url(path) {
    const u = this.base + path;
    return this.key ? u + (u.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(this.key) : u;
  }

  async req(method, path, body, raw = false) {
    const opts = { method, headers: {} };
    if (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) { opts.body = body; opts.headers['Content-Type'] = 'application/octet-stream'; }
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    const res = await fetch(this.url(path), opts);
    if (raw) return res;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }

  info() { return this.req('GET', '/api/info'); }
  fonts() { return this.req('GET', '/api/fonts'); }
  listProjects() { return this.req('GET', '/api/projects'); }
  createProject(name) { return this.req('POST', '/api/projects', { name }); }
  loadProject(id) { return this.req('GET', `/api/project/${id}`); }
  saveProject(p) { return this.req('PUT', `/api/project/${p.id}`, p); }
  saveBeacon(p) { navigator.sendBeacon?.(this.url(`/api/project/${p.id}/save`), new Blob([JSON.stringify(p)], { type: 'application/json' })); }
  deleteProject(id) { return this.req('POST', `/api/project/${id}/delete`); }
  duplicateProject(id) { return this.req('POST', `/api/project/${id}/duplicate`); }
  renameProject(id, name) { return this.req('POST', `/api/project/${id}/rename`, { name }); }
  /** Обложка карточки проекта (кадр из видео; сервер делает и кэширует сам). */
  async posterUrl(p) { return p.poster ? this.url(`/api/project/${p.id}/poster?v=${Math.round(p.updated)}`) : null; }

  /** Выбор файлов: на компе — системный диалог, с телефона — загрузка файла на комп. */
  async addMedia(pid, kind = 'video') {
    if (this.caps.pickPaths) {
      const { paths } = await this.req('POST', '/api/pick', { kind });
      if (!paths?.length) return { items: [], errors: [] };
      return this.req('POST', '/api/media/add', { pid, paths });
    }
    const files = await pickFiles(kind);
    const items = [], errors = [];
    for (const f of files) {
      try { items.push(await this.uploadMedia(pid, f)); } catch (e) { errors.push(`${f.name}: ${e.message}`); }
    }
    return { items, errors };
  }

  /** Готовый файл (с телефона или встроенный звук) → в папку проекта на компе. */
  async uploadMedia(pid, file) {
    const r = await fetch(this.url(`/api/media/upload?pid=${pid}&name=${encodeURIComponent(file.name)}`), { method: 'POST', body: file });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }

  // библиотека рекламы (хранится на компе, доступна и с телефона)
  libList() { return this.req('GET', '/api/adlib'); }
  libAdd(pid, m) { return this.req('POST', '/api/adlib/add', { pid, mid: m.id }); }
  libUse(pid, e) { return this.req('POST', '/api/adlib/use', { pid, id: e.id }); }
  libRemove(id) { return this.req('POST', '/api/adlib/remove', { id }); }

  async mediaState(pid, mid) {
    const meta = await this.req('GET', `/api/media/${pid}/${mid}/meta`).catch(() => null);
    if (!meta) return { status: 'preparing' };
    const st = { status: meta.status, meta };
    if (meta.tiles) st.tileUrls = meta.tiles.map((f) => this.url(`/files/${pid}/media/${mid}/thumbs/${f}`));
    if (meta.status === 'ready') {
      st.peaks = await this.req('GET', `/api/media/${pid}/${mid}/peaks`).catch(() => null);
      st.silences = (await this.req('GET', `/api/media/${pid}/${mid}/silences`).catch(() => null)) || [];
      st.words = await this.req('GET', `/api/media/${pid}/${mid}/words`).catch(() => null);
    }
    return st;
  }

  /** Для плеера: лёгкая копия, если готова, иначе оригинал. */
  playUrl(pid, m, st) {
    if (m.kind === 'audio') return this.url(`/source/${pid}/${m.id}`);
    const v = m.enhanced ? `?v=${Math.round(m.enhanced.at || 1)}` : '';
    if (!st?.meta?.proxy) return this.url(`/source/${pid}/${m.id}${v}`);
    return this.url(`/files/${pid}/media/${m.id}/${st.meta.proxy_name || 'proxy.mp4'}${v}`);
  }

  // --- улучшение качества (Real-ESRGAN на компе): файл подменяется под тем же id медиа
  async enhancePreview(pid, m, t, opts) {
    const r = await this.req('POST', '/api/enhance/preview', { pid, mid: m.id, t, opts });
    return { ...r, before: this.url(r.before), after: this.url(r.after) };
  }
  async enhance(pid, m, opts, onProgress, onJob) {
    const job = await this.req('POST', '/api/enhance', { pid, mid: m.id, opts });
    onJob?.(job.id);
    return (await this.waitJob(job.id, onProgress)).result;   // { width, height, enhanced }
  }
  unenhance(pid, m) { return this.req('POST', '/api/enhance/revert', { pid, mid: m.id }); }

  /** Инструментал + вокал (нейросеть на компе) → два новых файла проекта. */
  async separate(pid, m, onProgress, onJob) {
    const job = await this.req('POST', '/api/separate', { pid, mid: m.id });
    onJob?.(job.id);
    return (await this.waitJob(job.id, onProgress)).result.items;
  }

  /** Песня без мата: { items: [медиа], regions: [{ s, e, word }] }. */
  async clean(pid, m, opts, onProgress, onJob) {
    const job = await this.req('POST', '/api/clean', { pid, mid: m.id, opts });
    onJob?.(job.id);
    const r = (await this.waitJob(job.id, onProgress)).result;
    return { items: r.items, regions: r.regions };
  }

  /** Для экспорта — всегда оригинал. */
  exportSource(pid, m) {
    const mid = typeof m === 'string' ? m : (m?.id || m);
    if (!mid) throw new Error('Не найден файл медиа для экспорта');
    return new MB.UrlSource(this.url(`/source/${pid}/${mid}`));
  }

  async mediaUrl(pid, m) {
    const mid = typeof m === 'string' ? m : (m?.id || m);
    return this.url(`/source/${pid}/${mid}${m?.enhanced ? `?v=${Math.round(m.enhanced.at || 1)}` : ''}`);
  }
  async imageBitmap(pid, m) {
    const res = await fetch(await this.mediaUrl(pid, m), { cache: 'no-store' });
    return createImageBitmap(await res.blob());
  }

  async audioBuffer(pid, m, ctx) {
    const mid = typeof m === 'string' ? m : (m?.id || m);
    const res = await fetch(this.url(`/source/${pid}/${mid}`));
    return ctx.decodeAudioData(await res.arrayBuffer());
  }

  async transcribe(pid, m, { lang, model }, onProgress) {
    const job = await this.req('POST', '/api/transcribe', { pid, mid: m.id, lang, model });
    await this.waitJob(job.id, onProgress);
    return this.req('GET', `/api/media/${pid}/${m.id}/words`);
  }

  /** Распознать звук, присланный с телефона (16 кГц, моно, 16 бит). */
  async transcribePcm(pcm16, { lang, model }, onProgress) {
    const job = await this.req('POST', `/api/transcribe_pcm?lang=${lang}&model=${model}`, pcm16);
    const done = await this.waitJob(job.id, onProgress);
    return done.result;
  }

  async waitJob(id, onProgress) {
    for (;;) {
      const j = await this.req('GET', `/api/job/${id}`);
      onProgress?.(j);
      if (j.status === 'done') return j;
      if (j.status === 'error') throw new Error(j.error || 'ошибка');
      if (j.status === 'cancelled') throw new Error('Отменено');
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  jobs(pid) { return this.req('GET', `/api/jobs?pid=${pid}`); }
  cancelJob(id) { return this.req('POST', `/api/job/${id}/cancel`); }

  /** Цель записи MP4: куски пишутся прямо в файл на диске компа. */
  async exportTarget(dir, name) {
    const { id, path } = await this.req('POST', '/api/out/open', { dir, name });
    const writable = new WritableStream({
      write: (chunk) => this.req('PUT', `/api/out/${id}?pos=${chunk.position}`, chunk.data, true).then((r) => { if (!r.ok) throw new Error('запись на диск не удалась'); }),
    });
    return {
      target: new MB.StreamTarget(writable, { chunked: true, chunkSize: 8 * 1024 * 1024 }),
      fastStart: false,
      done: async () => { await this.req('POST', `/api/out/${id}/close`); return { path, name }; },
    };
  }

  /** Небольшой готовый файл (обложка .jpg) — рядом с видео. */
  async writeFile(dir, name, blob) {
    const { id, path } = await this.req('POST', '/api/out/open', { dir, name });
    const r = await this.req('PUT', `/api/out/${id}?pos=0`, new Uint8Array(await blob.arrayBuffer()), true);
    await this.req('POST', `/api/out/${id}/close`);
    if (!r.ok) throw new Error('запись на диск не удалась');
    return { path, name };
  }

  writeSeries(dir, data) { return this.req('POST', '/api/series', { dir, data }); }
  defaultOutDir(title) { return this.req('POST', '/api/outdir', { title }).then((r) => r.dir); }
  pickFolder() { return this.req('POST', '/api/pick', { kind: 'folder' }).then((r) => r.paths?.[0]); }
  openFolder(path) { return this.req('POST', '/api/open', { path }); }
  launchUploader(dir) { return this.req('POST', '/api/tiktok', { dir }); }
}

/** Системный выбор файлов в браузере/на телефоне. */
export function pickFiles(kind = 'video', multiple = true) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = multiple;
    const sound = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus';
    inp.accept = kind === 'audio' ? sound : `video/*,image/*,.mp4,.mov,.mkv,.webm,.jpg,.jpeg,.png,.webp,${sound}`;
    inp.onchange = () => resolve([...inp.files]);
    inp.addEventListener('cancel', () => resolve([]));
    inp.click();
  });
}
