"""Сервер Graphite.

• http://127.0.0.1:8765 — окно приложения на этом компе (полный доступ).
• http://<IP>:8765 и https://<IP>:8443 — телефон в той же Wi-Fi сети (только с кодом доступа).
Рендер видео делает само приложение (WebGL + WebCodecs); сервер готовит превью-копии,
распознаёт речь (Whisper), хранит проекты и пишет готовые файлы на диск.
"""
import datetime
import glob
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fonts  # noqa: E402
import jobs  # noqa: E402
import media  # noqa: E402
import tls  # noqa: E402
from paths import (FONTS_DIR, PROJECTS_DIR, ROOT, SCRIPTS_DIR, WEB_DIR, WORK_DIR, project_dir,  # noqa: E402
                   read_json, sanitize_filename, write_json)

VERSION = '2.0'
HTTP_PORT, HTTPS_PORT = 8765, 8443
SETTINGS = os.path.join(ROOT, 'settings.json')
APK_PATH = os.path.join(ROOT, 'dist', 'Graphite.apk')
_dialog_lock = threading.Lock()
for ext, t in (('.js', 'application/javascript'), ('.mjs', 'application/javascript'), ('.ttf', 'font/ttf'),
               ('.webmanifest', 'application/manifest+json'), ('.wasm', 'application/wasm'), ('.crt', 'application/x-x509-ca-cert'),
               ('.apk', 'application/vnd.android.package-archive')):
    mimetypes.add_type(t, ext)


# ----------------------------------------------------------------------------
#   Настройки и код доступа для телефона
# ----------------------------------------------------------------------------

def settings():
    s = read_json(SETTINGS, {}) or {}
    if not s.get('pair_code'):
        s['pair_code'] = f'{secrets.randbelow(900000) + 100000}'
        write_json(SETTINGS, s)
    return s


def is_local(addr):
    try:
        return ipaddress.ip_address(addr).is_loopback
    except ValueError:
        return False


# ----------------------------------------------------------------------------
#   Проекты
# ----------------------------------------------------------------------------

def project_path(pid):
    return os.path.join(project_dir(pid), 'project.json')


def list_projects():
    out = []
    if not os.path.isdir(PROJECTS_DIR):
        return out
    for d in os.listdir(PROJECTS_DIR):
        p = os.path.join(PROJECTS_DIR, d, 'project.json')
        if re.fullmatch(r'[0-9a-f]{12}', d) and os.path.isfile(p):
            data = read_json(p, {}) or {}
            clips = data.get('clips', [])
            cuts = (data.get('parts') or {}).get('cuts') or []
            out.append({'id': d, 'name': data.get('name') or 'Без названия', 'updated': os.path.getmtime(p),
                        # с учётом скорости клипа (кривые — приблизительно, как 1×)
                        'duration': sum((c['out'] - c['in']) / max(0.1, c.get('speed') or 1) for c in clips),
                        'media': [m.get('name') for m in data.get('media', [])][:3],
                        'kind': data.get('kind') or ('edit' if data.get('autoedit') else None),
                        'profile': data.get('profile'), 'title': data.get('title') or '',
                        'parts': len(cuts) + 1 if cuts else 0, 'clips': len(clips),
                        'subs': sum(1 for t in data.get('texts', []) if t.get('track') == 'subs'),
                        'aspect': f"{(data.get('canvas') or {}).get('w', 1080)}x{(data.get('canvas') or {}).get('h', 1920)}",
                        'poster': bool(clips)})
    return sorted(out, key=lambda x: x['updated'], reverse=True)


def project_poster(pid):
    """Обложка карточки проекта: кадр первого клипа (через секунду от начала), кэш в папке проекта."""
    data = read_json(project_path(pid), {}) or {}
    clips = data.get('clips') or []
    if not clips:
        return None
    c = clips[0]
    meta = media_meta(pid, c['media'])
    src = meta.get('path')
    if not src or not os.path.isfile(src):
        return None
    t = c.get('in', 0) + min(1.0, max(0.0, (c.get('out', 1) - c.get('in', 0)) * 0.3))
    key = f"{c['media']}:{t:.2f}"
    out = os.path.join(project_dir(pid), 'poster.jpg')
    stamp = os.path.join(project_dir(pid), 'poster.key')
    if os.path.isfile(out) and os.path.isfile(stamp) and open(stamp, encoding='utf-8').read() == key:
        return out
    if meta.get('kind') == 'image':
        from PIL import Image, ImageOps
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im).convert('RGB')
            im.thumbnail((480, 480))
            im.save(out, quality=82)
    elif not media.frame_at(src, t, out, width=480):
        return None
    with open(stamp, 'w', encoding='utf-8') as f:
        f.write(key)
    return out


def duplicate_project(pid):
    """Копия проекта: тот же монтаж и медиа (сами видео не копируются — ссылки на те же файлы)."""
    src = project_dir(pid)
    nid = uuid.uuid4().hex[:12]
    dst = project_dir(nid)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns('history', 'poster.jpg', 'poster.key'))
    data = read_json(project_path(nid), {}) or {}
    data['id'] = nid
    data['name'] = (data.get('name') or 'Проект') + ' (копия)'
    write_json(project_path(nid), data)
    return {'id': nid, 'name': data['name']}


def create_project(name):
    pid = uuid.uuid4().hex[:12]
    data = {'version': 2, 'id': pid, 'name': name or 'Новый проект', 'media': [], 'clips': [], 'texts': []}
    write_json(project_path(pid), data)
    return data


def save_project(pid, data):
    path = project_path(pid)
    hist = os.path.join(project_dir(pid), 'history')
    if os.path.exists(path):
        os.makedirs(hist, exist_ok=True)
        backups = sorted(glob.glob(os.path.join(hist, '*.json')))
        if not backups or time.time() - os.path.getmtime(backups[-1]) > 300:
            shutil.copy2(path, os.path.join(hist, datetime.datetime.now().strftime('%Y%m%d_%H%M%S.json')))
            for old in backups[:-29]:
                os.remove(old)
    data['id'] = pid
    write_json(path, data)


def delete_project(pid):
    trash = os.path.join(PROJECTS_DIR, '_корзина')
    os.makedirs(trash, exist_ok=True)
    shutil.move(project_dir(pid), os.path.join(trash, f'{pid}_{int(time.time())}'))


# ----------------------------------------------------------------------------
#   Медиа
# ----------------------------------------------------------------------------

def media_dir(pid, mid):
    if not re.fullmatch(r'[0-9a-f]{12}', mid or ''):
        raise ValueError('bad media id')
    return os.path.join(project_dir(pid), 'media', mid)


def media_meta(pid, mid):
    return read_json(os.path.join(media_dir(pid, mid), 'meta.json'), {}) or {}


def add_media(pid, path, name=None):
    info = media.probe(path)
    mid = uuid.uuid4().hex[:12]
    item = dict(info, id=mid, path=path, name=name or os.path.basename(path))
    d = media_dir(pid, mid)
    os.makedirs(d, exist_ok=True)
    write_json(os.path.join(d, 'meta.json'), dict(item, status='preparing'))
    jobs.start('prepare', pid, f'Подготовка: {item["name"]}', prepare_media_job, pid, mid)
    return item


# ----------------------------------------------------------------------------
#   Библиотека рекламы: ролик добавляется один раз и подтягивается в любой проект.
#   Файлы копируются в ad_library\ — не пропадут, даже если проект удалить.
# ----------------------------------------------------------------------------
ADLIB_DIR = os.path.join(ROOT, 'ad_library')
ADLIB = os.path.join(ADLIB_DIR, 'library.json')


def adlib_list(local=True):
    out = []
    for e in read_json(ADLIB, []) or []:
        if os.path.isfile(e.get('path', '')):
            out.append(e if local else {k: v for k, v in e.items() if k not in ('path', 'source')})
    return out


def adlib_add(pid, mid):
    meta = media_meta(pid, mid)
    src = meta.get('path')
    if not src or not os.path.isfile(src):
        raise ValueError('файл ролика не найден')
    lib = read_json(ADLIB, []) or []
    for e in lib:
        if os.path.isfile(e.get('path', '')) and (e.get('source') == src or
                                                  (e['name'] == meta['name'] and abs(e.get('duration', 0) - meta.get('duration', 0)) < 0.05)):
            return e
    os.makedirs(ADLIB_DIR, exist_ok=True)
    eid = uuid.uuid4().hex[:12]
    dst = os.path.join(ADLIB_DIR, eid + os.path.splitext(src)[1].lower())
    shutil.copy2(src, dst)
    e = {'id': eid, 'name': meta['name'], 'path': dst, 'source': src, 'kind': meta.get('kind'), 'duration': meta.get('duration'),
         'width': meta.get('width'), 'height': meta.get('height'), 'added': time.time()}
    lib.append(e)
    write_json(ADLIB, lib)
    return e


def adlib_use(pid, eid):
    e = next((x for x in read_json(ADLIB, []) or [] if x['id'] == eid), None)
    if not e or not os.path.isfile(e.get('path', '')):
        raise ValueError('ролика нет в библиотеке')
    return dict(add_media(pid, e['path'], e['name']), lib=eid, role='ad')


def adlib_remove(eid):
    # файл не трогаем: на него могут ссылаться проекты
    write_json(ADLIB, [x for x in read_json(ADLIB, []) or [] if x['id'] != eid])


def prepare_media_job(job, pid, mid):
    d = media_dir(pid, mid)
    meta = media_meta(pid, mid)
    src, dur = meta['path'], meta['duration']
    if meta.get('kind') == 'image':
        # фото: ни лёгкой копии, ни звука — миниатюру таймлайн рисует из самого файла
        meta['status'] = 'ready'
        write_json(os.path.join(d, 'meta.json'), meta)
        return {'mid': mid}
    if meta.get('kind') == 'video':
        proxy = os.path.join(d, 'proxy.mp4')
        if not os.path.exists(proxy):
            job.update(0, 'Лёгкая копия для плавной перемотки...')
            tmp = os.path.join(d, 'proxy_tmp.mp4')
            media.make_proxy(job, src, tmp, dur, 0.0, 0.7)
            os.replace(tmp, proxy)
        meta['proxy'] = True
        write_json(os.path.join(d, 'meta.json'), meta)
        job.update(0.7, 'Миниатюры для таймлайна...')
        tiles = media.make_thumbs(job, proxy, os.path.join(d, 'thumbs'), dur, 0.7, 0.88)
        p = media.probe(proxy)
        meta.update(tiles=tiles, thumb_w=round(media.THUMB_HEIGHT * p['width'] / p['height']), thumb_h=media.THUMB_HEIGHT,
                    thumb_interval=media.THUMB_INTERVAL, thumbs_per_tile=media.THUMBS_PER_TILE)
        write_json(os.path.join(d, 'meta.json'), meta)
        wave_src = proxy
    else:
        wave_src = src
    job.update(0.9, 'Звуковая волна...')
    write_json(os.path.join(d, 'peaks.json'), {'rate': media.PEAKS_PER_SEC, 'peaks': media.waveform(wave_src)})
    job.update(0.95, 'Поиск пауз...')
    write_json(os.path.join(d, 'silences.json'), media.silences(wave_src))
    meta['status'] = 'ready'
    write_json(os.path.join(d, 'meta.json'), meta)
    return {'mid': mid}


def transcribe_job(job, pid, mid, lang, model):
    import transcribe
    meta = media_meta(pid, mid)
    with jobs.gpu_lock:
        res = transcribe.transcribe(job, meta['path'], meta.get('duration'), lang, model)
    write_json(os.path.join(media_dir(pid, mid), 'words.json'), res)
    return {'mid': mid, 'count': len(res['words'])}


def transcribe_pcm_job(job, pcm_bytes, lang, model):
    import numpy as np
    import transcribe
    audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    with jobs.gpu_lock:
        return transcribe.transcribe(job, None, len(audio) / 16000, lang, model, audio=audio)


# ----------------------------------------------------------------------------
#   Запись готовых видео на диск (рендер идёт в приложении, сюда приходят куски файла)
# ----------------------------------------------------------------------------
_outputs = {}


def out_open(dir_, name):
    dir_ = dir_ if os.path.isabs(dir_ or '') else os.path.join(WORK_DIR, sanitize_filename(dir_ or 'Видео'))
    os.makedirs(dir_, exist_ok=True)
    path = os.path.join(dir_, sanitize_filename(name))
    oid = uuid.uuid4().hex[:12]
    _outputs[oid] = {'f': open(path, 'wb'), 'path': path, 'lock': threading.Lock()}
    return {'id': oid, 'path': path, 'dir': dir_}


def out_write(oid, pos, data):
    o = _outputs[oid]
    with o['lock']:
        o['f'].seek(pos)
        o['f'].write(data)


def out_close(oid):
    o = _outputs.pop(oid)
    o['f'].close()
    return o['path']


def out_dir(title):
    return os.path.join(WORK_DIR, sanitize_filename(title) or 'Видео')


# ----------------------------------------------------------------------------
#   Системное
# ----------------------------------------------------------------------------

def pick_files(kind):
    with _dialog_lock:
        import tkinter
        from tkinter import filedialog
        root = tkinter.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        try:
            if kind == 'folder':
                p = filedialog.askdirectory(parent=root, title='Выбери папку', initialdir=WORK_DIR)
                return [os.path.normpath(p)] if p else []
            video = '*.mp4 *.mov *.mkv *.webm *.avi *.m4v'
            photo = ' '.join('*' + e for e in media.IMAGE_EXT)
            types = ([('Звук', '*.mp3 *.wav *.m4a *.aac *.ogg *.flac')] if kind == 'audio'
                     else [('Видео и фото', f'{video} {photo}'), ('Видео', video), ('Фото', photo)])
            paths = filedialog.askopenfilenames(parent=root, title='Выбери музыку' if kind == 'audio' else 'Выбери видео или фото',
                                                initialdir=WORK_DIR, filetypes=types + [('Все файлы', '*.*')])
            return [os.path.normpath(p) for p in paths]
        finally:
            root.destroy()


def open_folder(path):
    if os.path.isdir(path):
        os.startfile(path)
    elif os.path.isfile(path):
        subprocess.Popen(['explorer', '/select,', path])


def launch_uploader(series_dir):
    bat = os.path.join(SCRIPTS_DIR, '3_Загрузить_в_TikTok.bat') if SCRIPTS_DIR else ''
    if not bat or not os.path.isfile(bat):
        raise RuntimeError('не найден 3_Загрузить_в_TikTok.bat в папке Скрипты')
    subprocess.Popen([bat, series_dir], cwd=SCRIPTS_DIR, creationflags=subprocess.CREATE_NEW_CONSOLE)


# ----------------------------------------------------------------------------
#   Публикации в TikTok: очередь серий, расписание, настройки (сам загрузчик — в папке «Скрипты»)
# ----------------------------------------------------------------------------
PUBLISH_CFG = os.path.join(WORK_DIR, 'tiktok_config.json')
ARCHIVE_DIR = os.path.join(WORK_DIR, 'Запланировано_в_TikTok')
UPLOAD_LOGS = os.path.join(WORK_DIR, '_логи')
_publish_proc = None


def publish_info():
    cfg = read_json(PUBLISH_CFG, {}) or {}
    pending = []
    if os.path.isdir(WORK_DIR):
        for e in os.scandir(WORK_DIR):
            if not e.is_dir() or e.name.startswith(('.', '_')) or e.path == ARCHIVE_DIR:
                continue
            meta = read_json(os.path.join(e.path, 'series.json'), None)
            files = sorted(f for f in os.listdir(e.path) if f.lower().endswith('.mp4'))
            if meta and files:
                pending.append({'dir': e.path, 'title': meta.get('title') or e.name, 'count': len(files),
                                'files': files, 'updated': os.path.getmtime(e.path), 'project': meta.get('project')})
    scheduled = []
    if os.path.isdir(ARCHIVE_DIR):
        for e in os.scandir(ARCHIVE_DIR):
            j = read_json(os.path.join(e.path, '_журнал.json'), None) if e.is_dir() else None
            for f, v in ((j or {}).get('parts') or {}).items():
                scheduled.append({'series': e.name, 'file': f, 'when': v.get('scheduled_for'), 'status': v.get('status'),
                                  'error': (v.get('error') or '')[:200]})
    scheduled.sort(key=lambda x: x['when'] or '')
    log_tail = []
    logs = sorted(glob.glob(os.path.join(UPLOAD_LOGS, 'upload_*.log')))
    if logs:
        with open(logs[-1], encoding='utf-8', errors='replace') as f:
            log_tail = f.read().splitlines()[-40:]
    running = _publish_proc is not None and _publish_proc.poll() is None
    return {'pending': sorted(pending, key=lambda x: x['updated']), 'scheduled': scheduled, 'running': running,
            'interval_hours': cfg.get('interval_hours', 6), 'hashtags': cfg.get('hashtags', ''),
            'max_days': cfg.get('max_schedule_days', 10), 'log': log_tail, 'uploader': bool(SCRIPTS_DIR)}


def publish_config(b):
    cfg = read_json(PUBLISH_CFG, {}) or {}
    if 'hashtags' in b:
        cfg['hashtags'] = ' '.join(t if t.startswith('#') else '#' + t for t in str(b['hashtags']).split() if t.strip('#'))
    if 'interval_hours' in b:
        cfg['interval_hours'] = max(0.5, min(48.0, float(b['interval_hours'])))
    write_json(PUBLISH_CFG, cfg)
    return cfg


def publish_run(b):
    """Запуск очереди в отдельном окне (видно, что происходит; Firefox — твой вход в TikTok)."""
    global _publish_proc
    if _publish_proc is not None and _publish_proc.poll() is None:
        raise RuntimeError('публикация уже идёт — дождись окончания')
    dirs = [d for d in b.get('dirs') or [] if os.path.isdir(d) and os.path.abspath(d).startswith(os.path.abspath(WORK_DIR))]
    if not dirs:
        raise RuntimeError('не выбрано ни одной серии')
    py = os.path.join(os.path.dirname(sys.executable), 'python.exe')
    cmd = [py if os.path.isfile(py) else sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schedule_queue.py'),
           '--interval', str(float(b.get('interval') or 6))]
    if b.get('start'):
        cmd += ['--start', str(b['start']).replace('T', ' ')[:16]]
    if b.get('dry'):
        cmd.append('--dry-run')
    _publish_proc = subprocess.Popen(cmd + dirs, cwd=WORK_DIR, creationflags=subprocess.CREATE_NEW_CONSOLE)
    return {'ok': True}


def write_fonts_json():
    write_json(os.path.join(FONTS_DIR, 'fonts.json'), fonts.catalog())


# ----------------------------------------------------------------------------
#   HTTP
# ----------------------------------------------------------------------------

def safe_join(base, parts):
    path = os.path.normpath(os.path.join(base, *parts))
    if not (path == os.path.normpath(base) or path.startswith(os.path.normpath(base) + os.sep)):
        raise ValueError('bad path')
    return path


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        pass

    # --- доступ ---
    @property
    def local(self):
        return is_local(self.client_address[0])

    def key_ok(self):
        if self.local:
            return True
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        return q.get('k', [''])[0] == settings()['pair_code']

    def cors(self):
        origin = self.headers.get('Origin')
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Range')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
            self.send_header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges')
            self.send_header('Access-Control-Allow-Private-Network', 'true')

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    # --- ответы ---
    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, code, msg):
        self.send_json({'error': msg}, code)

    def send_file(self, path, cache=False):
        if not path or not os.path.isfile(path):
            return self.send_error_json(404, 'not found')
        size = os.path.getsize(path)
        ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        rng = self.headers.get('Range')
        start, end = 0, size - 1
        if rng and (m := re.match(r'bytes=(\d*)-(\d*)', rng)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            self.send_response(206)
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        else:
            self.send_response(200)
        self.cors()
        length = end - start + 1
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(length))
        self.send_header('Cache-Control', 'max-age=3600' if cache else 'no-cache')
        self.end_headers()
        if self.command == 'HEAD':
            return
        with open(path, 'rb') as f:
            f.seek(start)
            left = length
            try:
                while left > 0:
                    chunk = f.read(min(1 << 20, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
            except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                pass

    def read_raw(self):
        n = int(self.headers.get('Content-Length') or 0)
        buf = bytearray()
        while len(buf) < n:
            chunk = self.rfile.read(min(1 << 20, n - len(buf)))
            if not chunk:
                break
            buf += chunk
        return bytes(buf)

    def read_body(self):
        raw = self.read_raw()
        return json.loads(raw.decode('utf-8')) if raw else {}

    def guard(fn):
        def wrapper(self):
            try:
                fn(self)
            except ValueError as e:
                self.send_error_json(400, str(e))
            except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                pass
            except Exception as e:
                import traceback
                traceback.print_exc()
                try:
                    self.send_error_json(500, str(e))
                except Exception:
                    pass
        return wrapper

    # --- GET ---
    def do_HEAD(self):
        self.do_GET()

    @guard
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        parts = [urllib.parse.unquote(p) for p in u.path.split('/') if p]
        q = urllib.parse.parse_qs(u.query)
        head = parts[0] if parts else ''
        if head == 'api':
            if parts[1:] == ['info']:
                return self.send_json({'name': socket.gethostname(), 'version': VERSION, 'local': self.local,
                                       'authorized': self.key_ok(), 'http_port': HTTP_PORT, 'https_port': HTTPS_PORT})
            if not self.key_ok():
                return self.send_error_json(403, 'нужен код доступа')
            return self.api_get(parts[1:], q)
        if head in ('files', 'source') and not self.key_ok():
            return self.send_error_json(403, 'нужен код доступа')
        if head == 'files':
            return self.send_file(safe_join(project_dir(parts[1]), parts[2:]))
        if head == 'source':
            return self.send_file(media_meta(parts[1], parts[2]).get('path', ''))
        if head == 'fonts':
            return self.send_file(safe_join(FONTS_DIR, parts[1:]), cache=parts[-1] != 'fonts.json')
        if head == 'ca.crt':
            return self.send_file(tls.CA_CRT)
        if head == 'app.apk':
            return self.send_file(APK_PATH)
        if head == 'precache.json':
            return self.send_json(precache_list())
        # само приложение
        path = safe_join(WEB_DIR, parts) if parts else os.path.join(WEB_DIR, 'index.html')
        if os.path.isdir(path):
            path = os.path.join(path, 'index.html')
        return self.send_file(path)

    def api_get(self, p, q):
        if p == ['projects']:
            return self.send_json(list_projects())
        if p == ['publish']:
            if not self.local:
                return self.send_error_json(403, 'только на компе')
            return self.send_json(publish_info())
        if p[0] == 'project' and len(p) == 3 and p[2] == 'poster':
            path = project_poster(p[1])
            return self.send_file(path) if path else self.send_error_json(404, 'нет обложки')
        if p[0] == 'project' and len(p) == 2:
            data = read_json(project_path(p[1]))
            return self.send_json(data) if data else self.send_error_json(404, 'нет проекта')
        if p == ['fonts']:
            return self.send_json(fonts.catalog())
        if p == ['adlib']:
            return self.send_json(adlib_list(self.local))
        if p == ['pair']:
            if not self.local:
                return self.send_error_json(403, 'только на компе')
            return self.send_json({'code': settings()['pair_code'], 'lan': tls.lan_ips(), 'http_port': HTTP_PORT,
                                   'https_port': HTTPS_PORT, 'apk': os.path.isfile(APK_PATH), 'name': socket.gethostname()})
        if p == ['jobs']:
            return self.send_json(jobs.list_for(q.get('pid', [None])[0]))
        if p[0] == 'job' and len(p) == 2:
            j = jobs.get(p[1])
            return self.send_json(j.to_dict()) if j else self.send_error_json(404, 'нет задачи')
        if p[0] == 'media' and len(p) == 4:
            if p[3] not in ('meta', 'peaks', 'silences', 'words'):
                return self.send_error_json(404, 'not found')
            data = read_json(os.path.join(media_dir(p[1], p[2]), f'{p[3]}.json'))
            if data and p[3] == 'meta':
                data = {k: v for k, v in data.items() if k != 'path'} if not self.local else data
            return self.send_json(data)
        self.send_error_json(404, 'not found')

    # --- PUT ---
    @guard
    def do_PUT(self):
        if not self.key_ok():
            return self.send_error_json(403, 'нужен код доступа')
        u = urllib.parse.urlparse(self.path)
        p = [x for x in u.path.split('/') if x]
        if p[:2] == ['api', 'project'] and len(p) == 3:
            save_project(p[2], self.read_body())
            return self.send_json({'ok': True})
        if p[:2] == ['api', 'out'] and len(p) == 3:
            pos = int(urllib.parse.parse_qs(u.query).get('pos', ['0'])[0])
            out_write(p[2], pos, self.read_raw())
            return self.send_json({'ok': True})
        self.send_error_json(404, 'not found')

    # --- POST ---
    @guard
    def do_POST(self):
        if not self.key_ok():
            return self.send_error_json(403, 'нужен код доступа')
        u = urllib.parse.urlparse(self.path)
        p = [urllib.parse.unquote(x) for x in u.path.split('/') if x][1:]
        q = urllib.parse.parse_qs(u.query)
        if p == ['media', 'upload']:
            pid, name = q['pid'][0], sanitize_filename(q.get('name', ['file'])[0]) or 'file'
            d = os.path.join(project_dir(pid), 'uploads')
            os.makedirs(d, exist_ok=True)
            base, ext = os.path.splitext(name)
            path = os.path.join(d, name)
            n = 1
            while os.path.exists(path):
                path = os.path.join(d, f'{base} ({n}){ext}')
                n += 1
            with open(path, 'wb') as f:
                left = int(self.headers.get('Content-Length') or 0)
                while left > 0:
                    chunk = self.rfile.read(min(1 << 20, left))
                    if not chunk:
                        break
                    f.write(chunk)
                    left -= len(chunk)
            return self.send_json(add_media(pid, path))
        if p == ['log']:
            # журнал ошибок и возможности телефона — чтобы разбирать проблемы на телефоне с компа
            d = os.path.join(ROOT, 'logs')
            os.makedirs(d, exist_ok=True)
            data = self.read_raw()[:2_000_000]
            name = time.strftime('phone_%Y%m%d.jsonl')
            with open(os.path.join(d, name), 'ab') as f:
                f.write(data.rstrip(b'\n') + b'\n')
            return self.send_json({'ok': True})
        if p == ['transcribe_pcm']:
            pcm = self.read_raw()
            j = jobs.start('transcribe', None, 'Распознавание речи (с телефона)', transcribe_pcm_job, pcm,
                           q.get('lang', ['ru'])[0], q.get('model', ['large-v3-turbo'])[0])
            return self.send_json(j.to_dict())
        b = self.read_body()
        if p == ['projects']:
            return self.send_json(create_project(b.get('name')))
        if p[0] == 'project' and len(p) == 3 and p[2] == 'save':
            save_project(p[1], b)
            return self.send_json({'ok': True})
        if p[0] == 'project' and len(p) == 3 and p[2] == 'delete':
            delete_project(p[1])
            return self.send_json({'ok': True})
        if p[0] == 'project' and len(p) == 3 and p[2] == 'duplicate':
            return self.send_json(duplicate_project(p[1]))
        if p[0] == 'project' and len(p) == 3 and p[2] == 'rename':
            data = read_json(project_path(p[1]), {}) or {}
            data['name'] = str(b.get('name') or data.get('name') or 'Проект')[:120]
            write_json(project_path(p[1]), data)
            return self.send_json({'ok': True})
        if p == ['pick']:
            if not self.local:
                return self.send_error_json(403, 'только на компе')
            return self.send_json({'paths': pick_files(b.get('kind', 'video'))})
        if p == ['media', 'add']:
            if not self.local:
                return self.send_error_json(403, 'только на компе')
            items, errors = [], []
            for path in b.get('paths', []):
                try:
                    items.append(add_media(b['pid'], path))
                except Exception as e:
                    errors.append(f'{os.path.basename(path)}: {e}')
            return self.send_json({'items': items, 'errors': errors})
        if p == ['adlib', 'add']:
            e = adlib_add(b['pid'], b['mid'])
            return self.send_json(e if self.local else {k: v for k, v in e.items() if k not in ('path', 'source')})
        if p == ['adlib', 'use']:
            item = adlib_use(b['pid'], b['id'])
            return self.send_json(item if self.local else {k: v for k, v in item.items() if k != 'path'})
        if p == ['adlib', 'remove']:
            adlib_remove(b['id'])
            return self.send_json({'ok': True})
        if p == ['transcribe']:
            j = jobs.start('transcribe', b['pid'], 'Распознавание речи', transcribe_job, b['pid'], b['mid'],
                           b.get('lang', 'ru'), b.get('model', 'large-v3-turbo'))
            return self.send_json(j.to_dict())
        if p[0] == 'job' and len(p) == 3 and p[2] == 'cancel':
            return self.send_json({'ok': jobs.cancel(p[1])})
        if p == ['out', 'open']:
            return self.send_json(out_open(b.get('dir'), b['name']))
        if p[0] == 'out' and len(p) == 3 and p[2] == 'close':
            return self.send_json({'path': out_close(p[1])})
        if p == ['outdir']:
            return self.send_json({'dir': out_dir(b.get('title', ''))})
        if p == ['series']:
            d = b['dir'] if os.path.isabs(b['dir']) else out_dir(b['dir'])
            write_json(os.path.join(d, 'series.json'), b['data'])
            return self.send_json({'ok': True})
        if p == ['pair', 'reset']:
            if not self.local:
                return self.send_error_json(403, 'только на компе')
            s = settings()
            s['pair_code'] = ''
            write_json(SETTINGS, s)
            settings()
            return self.send_json({'ok': True})
        if p == ['open']:
            if self.local:
                open_folder(b['path'])
            return self.send_json({'ok': True})
        if p == ['tiktok']:
            if not self.local:
                return self.send_error_json(403, 'только на компе')
            launch_uploader(b['dir'])
            return self.send_json({'ok': True})
        if p[:1] == ['publish'] and not self.local:
            return self.send_error_json(403, 'только на компе')
        if p == ['publish', 'config']:
            return self.send_json(publish_config(b))
        if p == ['publish', 'run']:
            try:
                return self.send_json(publish_run(b))
            except RuntimeError as e:
                return self.send_error_json(400, str(e))
        self.send_error_json(404, 'not found')


def precache_list():
    """Файлы приложения для офлайн-кэша (телефон без компа)."""
    files = []
    for root, _, names in os.walk(WEB_DIR):
        for n in names:
            files.append(os.path.relpath(os.path.join(root, n), WEB_DIR).replace('\\', '/'))
    files += ['fonts/' + n for n in os.listdir(FONTS_DIR) if n.endswith(('.ttf', '.json'))]
    return files


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def port_busy(port):
    with socket.socket() as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def start_servers():
    """HTTP для этого компа и Android, HTTPS для iPhone. Возвращает список серверов."""
    os.makedirs(PROJECTS_DIR, exist_ok=True)
    write_fonts_json()
    settings()
    servers = []
    try:
        servers.append(Server(('0.0.0.0', HTTP_PORT), Handler))
    except OSError:
        servers.append(Server(('127.0.0.1', HTTP_PORT), Handler))  # сеть недоступна — хотя бы для себя
    try:
        certs = tls.ensure_certs()
        if certs:
            https = Server(('0.0.0.0', HTTPS_PORT), Handler)
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(*certs)
            https.socket = ctx.wrap_socket(https.socket, server_side=True)
            servers.append(https)
    except Exception as e:
        print('HTTPS для iPhone не запущен:', e)
    for s in servers:
        threading.Thread(target=s.serve_forever, daemon=True).start()
    return servers


def main():
    if port_busy(HTTP_PORT):
        print('Graphite уже запущен.')
        return
    start_servers()
    print(f'Graphite: http://127.0.0.1:{HTTP_PORT}/  (в сети: {", ".join(tls.lan_ips()) or "нет"})')
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
