"""Библиотека футажей: ролики и фоны с описаниями, по которым ИИ подбирает материал для видео.

Файлы с компа не копируются (ссылка на место, где они лежат) — футажей могут быть сотни гигабайт.
Загруженные с телефона и сгенерированные ИИ фоны лежат в footage_library\\files.
"""
import csv
import io
import json
import os
import re
import shutil
import threading
import time
import uuid

import media
from paths import ROOT, read_json, sanitize_filename, write_json

LIB_DIR = os.path.join(ROOT, 'footage_library')
FILES_DIR = os.path.join(LIB_DIR, 'files')
THUMBS_DIR = os.path.join(LIB_DIR, 'thumbs')
LIB = os.path.join(LIB_DIR, 'library.json')

CATEGORIES = {'footage': 'Футаж', 'background': 'Фон'}
VIDEO_EXT = ('.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v')
MEDIA_EXT = VIDEO_EXT + tuple(media.IMAGE_EXT)
MAX_SCAN = 5000

_lock = threading.RLock()


# ----------------------------------------------------------------------------
#   Хранилище
# ----------------------------------------------------------------------------

def _load():
    data = read_json(LIB, []) or []
    return data if isinstance(data, list) else []


def _save(lib):
    write_json(LIB, lib)


def _norm(path):
    return os.path.normcase(os.path.abspath(path))


def parse_tags(value):
    """Теги: список или строка через запятую / точку с запятой / #."""
    if isinstance(value, str):
        value = re.split(r'[,;#\n]+', value)
    out = []
    for t in value or []:
        t = re.sub(r'\s+', ' ', str(t)).strip().lstrip('#').strip()
        if t and t.lower() not in [x.lower() for x in out]:
            out.append(t[:40])
    return out[:30]


def public(e, local=True):
    """Запись для интерфейса; путь к файлу на компе с телефона не отдаём."""
    d = dict(e)
    d['missing'] = not os.path.isfile(e.get('path', ''))
    if not local:
        d.pop('path', None)
        d.pop('source', None)
    return d


def list_all(local=True):
    with _lock:
        return [public(e, local) for e in _load()]


def get(eid):
    return next((e for e in _load() if e['id'] == eid), None)


def _fields(d, title, description, tags, category):
    if title is not None:
        d['title'] = str(title).strip()[:120]
    if description is not None:
        d['description'] = str(description).strip()[:1500]
    if tags is not None:
        d['tags'] = parse_tags(tags)
    if category in CATEGORIES:
        d['category'] = category


def add_file(path, category='footage', title=None, description=None, tags=None, copy=False, source='import', lib=None, name=None):
    """Добавляет файл в библиотеку (или обновляет запись, если он там уже есть). Возвращает (запись, новая_ли)."""
    ext = os.path.splitext(path)[1].lower()
    if ext not in MEDIA_EXT:
        raise ValueError(f'{os.path.basename(path)}: нужен ролик или картинка')
    own = lib is None
    with _lock:
        if own:
            lib = _load()
        key = _norm(path)
        old = next((e for e in lib if _norm(e.get('path', '')) == key), None)
        if old:
            _fields(old, title, description, tags, category if category in CATEGORIES and (title or description or tags) else None)
            if own:
                _save(lib)
            return old, False
        info = media.probe(path)
        if info['kind'] not in ('video', 'image'):
            raise ValueError(f'{os.path.basename(path)}: это звук, а нужен ролик или картинка')
        eid = uuid.uuid4().hex[:12]
        dst = path
        if copy:
            os.makedirs(FILES_DIR, exist_ok=True)
            dst = os.path.join(FILES_DIR, eid + ext)
            shutil.copy2(path, dst)
        e = {'id': eid, 'path': dst, 'source': path, 'name': name or os.path.basename(path), 'kind': info['kind'],
             'duration': None if info['kind'] == 'image' else round(info['duration'], 2),
             'width': info['width'], 'height': info['height'], 'category': category if category in CATEGORIES else 'footage',
             'title': os.path.splitext(os.path.basename(path))[0][:120], 'description': '', 'tags': [], 'origin': source,
             'added': time.time()}
        _fields(e, title, description, tags, None)
        lib.append(e)
        if own:
            _save(lib)
        return e, True


def scan(paths):
    """Файлы и папки (с вложенными) → список путей к роликам и картинкам."""
    out = []
    for p in paths:
        if os.path.isdir(p):
            for root, dirs, names in os.walk(p):
                dirs[:] = sorted(d for d in dirs if not d.startswith(('.', '_')))
                for n in sorted(names):
                    if n.lower().endswith(MEDIA_EXT):
                        out.append(os.path.join(root, n))
                        if len(out) >= MAX_SCAN:
                            return out
        elif os.path.isfile(p):
            out.append(p)
    return out


def import_paths(job, paths, category='footage'):
    """Задача: добавить файлы/папки в библиотеку."""
    files = scan(paths)
    added = skipped = 0
    errors = []
    lib_ids = []
    with _lock:
        lib = _load()
    for i, f in enumerate(files):
        job.check_cancel()
        job.update(i / max(1, len(files)), f'{i + 1} из {len(files)}: {os.path.basename(f)}')
        try:
            e, new = add_file(f, category, lib=lib)
            added += new
            skipped += not new
            lib_ids.append(e['id'])
        except Exception as ex:
            errors.append(f'{os.path.basename(f)}: {ex}')
        if i % 25 == 24:
            with _lock:
                _save(lib)
    with _lock:
        _save(lib)
    return {'added': added, 'skipped': skipped, 'errors': errors[:50], 'ids': lib_ids}


def update(eid, b):
    with _lock:
        lib = _load()
        e = next((x for x in lib if x['id'] == eid), None)
        if not e:
            raise ValueError('футажа нет в библиотеке')
        _fields(e, b.get('title'), b.get('description'), b.get('tags'), b.get('category'))
        _save(lib)
        return e


def remove(eid):
    """Убрать из библиотеки. Файл удаляется, только если он лежит в footage_library\\files (загружен или сгенерирован)."""
    with _lock:
        lib = _load()
        e = next((x for x in lib if x['id'] == eid), None)
        if not e:
            return
        _save([x for x in lib if x['id'] != eid])
    p = e.get('path', '')
    if os.path.isfile(p) and _norm(os.path.dirname(p)) == _norm(FILES_DIR):
        try:
            os.remove(p)
        except OSError:
            pass
    t = os.path.join(THUMBS_DIR, eid + '.jpg')
    if os.path.isfile(t):
        try:
            os.remove(t)
        except OSError:
            pass


def save_upload(name, data_iter_write, category='footage'):
    """Файл с телефона: data_iter_write(f) записывает тело запроса в открытый файл."""
    os.makedirs(FILES_DIR, exist_ok=True)
    name = sanitize_filename(name) or 'file'
    eid = uuid.uuid4().hex[:12]
    path = os.path.join(FILES_DIR, eid + os.path.splitext(name)[1].lower())
    with open(path, 'wb') as f:
        data_iter_write(f)
    try:
        e, _ = add_file(path, category, title=os.path.splitext(name)[0], source='upload', name=name)
    except Exception:
        os.remove(path)
        raise
    return e


def add_generated(png_bytes, title, description, tags, prompt):
    """Фон, сгенерированный ИИ, — в библиотеку (категория «фон»)."""
    os.makedirs(FILES_DIR, exist_ok=True)
    path = os.path.join(FILES_DIR, uuid.uuid4().hex[:12] + '.png')
    with open(path, 'wb') as f:
        f.write(png_bytes)
    e, _ = add_file(path, 'background', title=title, description=description, tags=tags, source='generated',
                    name=(sanitize_filename(title) or 'Фон') + '.png')
    with _lock:
        lib = _load()
        for x in lib:
            if x['id'] == e['id']:
                x['prompt'] = prompt
        _save(lib)
    e['prompt'] = prompt
    return e


# ----------------------------------------------------------------------------
#   Каталог из списка: JSON или строки «файл ; название ; описание ; теги»
# ----------------------------------------------------------------------------

_HEAD = {'file': 'file', 'файл': 'file', 'name': 'file', 'имя': 'file', 'path': 'file', 'путь': 'file',
         'title': 'title', 'название': 'title', 'заголовок': 'title',
         'description': 'description', 'desc': 'description', 'описание': 'description',
         'tags': 'tags', 'теги': 'tags', 'tag': 'tags',
         'category': 'category', 'категория': 'category', 'type': 'category', 'тип': 'category'}


def _row(d):
    out = {}
    for k, v in d.items():
        key = _HEAD.get(str(k).strip().lower())
        if key and v not in (None, ''):
            out[key] = v
    cat = str(out.get('category', '')).strip().lower()
    if cat:
        out['category'] = 'background' if cat.startswith(('фон', 'back', 'bg')) else 'footage'
    return out


def parse_catalog(text):
    """Текст каталога → список строк {file, title, description, tags, category}."""
    text = (text or '').strip()
    if not text:
        raise ValueError('список пустой')
    if text[0] in '[{':
        data = json.loads(text)
        if isinstance(data, dict):
            data = data.get('items') or data.get('footage') or [dict(file=k, **(v if isinstance(v, dict) else {'description': v})) for k, v in data.items()]
        return [r for r in (_row(x) for x in data if isinstance(x, dict)) if r.get('file')]
    delim = max('\t;|', key=lambda c: text.splitlines()[0].count(c)) if any(c in text.splitlines()[0] for c in '\t;|') else ','
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    rows = [[c.strip() for c in r] for r in rows if any(c.strip() for c in r)]
    heads = [_HEAD.get(c.lower()) for c in rows[0]]
    if 'file' in heads:
        body = [_row({k: v for k, v in zip(rows[0], r)}) for r in rows[1:]]
    else:
        # без заголовка: файл ; название ; описание ; теги
        body = []
        for r in rows:
            r = r + [''] * (4 - len(r))
            body.append(_row({'file': r[0], 'title': r[1], 'description': r[2], 'tags': ','.join(r[3:]) if len(r) > 3 else ''}))
    return [r for r in body if r.get('file')]


def import_catalog(job, text, folder='', category='footage'):
    """Задача: применить список описаний. Файлы ищутся по имени в библиотеке и в папке folder."""
    rows = parse_catalog(text)
    index = {}
    if folder and os.path.isdir(folder):
        job.update(0, 'Ищу файлы в папке…')
        for p in scan([folder]):
            index.setdefault(os.path.basename(p).lower(), p)
    with _lock:
        lib = _load()
    by_name = {}
    for e in lib:
        by_name.setdefault(os.path.basename(e.get('source') or e.get('path', '')).lower(), e)
        by_name.setdefault(e.get('name', '').lower(), e)
    done = created = 0
    missing = []
    for i, r in enumerate(rows):
        job.check_cancel()
        job.update(i / max(1, len(rows)), f'{i + 1} из {len(rows)}')
        name = str(r['file']).strip().strip('"')
        cat = r.get('category', category)
        try:
            if os.path.isabs(name) and os.path.isfile(name):
                e, new = add_file(name, cat, r.get('title'), r.get('description'), r.get('tags'), lib=lib)
            elif by_name.get(os.path.basename(name).lower()):
                e = by_name[os.path.basename(name).lower()]
                _fields(e, r.get('title'), r.get('description'), r.get('tags'), r.get('category'))
                new = False
            elif index.get(os.path.basename(name).lower()):
                e, new = add_file(index[os.path.basename(name).lower()], cat, r.get('title'), r.get('description'), r.get('tags'), lib=lib)
            else:
                missing.append(name)
                continue
            by_name.setdefault(os.path.basename(e.get('source') or e['path']).lower(), e)
            done += 1
            created += new
        except Exception as ex:
            missing.append(f'{name} ({ex})')
    with _lock:
        _save(lib)
    return {'rows': len(rows), 'done': done, 'created': created, 'missing': missing[:100]}


# ----------------------------------------------------------------------------
#   Миниатюры и кадры для ИИ
# ----------------------------------------------------------------------------

def thumb(eid):
    e = get(eid)
    if not e or not os.path.isfile(e.get('path', '')):
        return None
    out = os.path.join(THUMBS_DIR, eid + '.jpg')
    if os.path.isfile(out):
        return out
    os.makedirs(THUMBS_DIR, exist_ok=True)
    if e['kind'] == 'image':
        from PIL import Image, ImageOps
        with Image.open(e['path']) as im:
            im = ImageOps.exif_transpose(im).convert('RGB')
            im.thumbnail((360, 360))
            im.save(out, quality=80)
        return out
    t = min(1.0, (e.get('duration') or 2) * 0.3)
    return out if media.frame_at(e['path'], t, out, width=360) else None


def frames_for_ai(e, n=3, width=512):
    """Несколько кадров ролика (JPEG-байты) — чтобы ИИ описал, что в нём."""
    if e['kind'] == 'image':
        from PIL import Image, ImageOps
        import io as _io
        with Image.open(e['path']) as im:
            im = ImageOps.exif_transpose(im).convert('RGB')
            im.thumbnail((width, width))
            b = _io.BytesIO()
            im.save(b, 'JPEG', quality=80)
            return [b.getvalue()]
    dur = e.get('duration') or 3
    tmp = os.path.join(THUMBS_DIR, f'_ai_{e["id"]}')
    os.makedirs(tmp, exist_ok=True)
    out = []
    try:
        for k in range(n):
            p = os.path.join(tmp, f'{k}.jpg')
            if media.frame_at(e['path'], dur * (k + 0.5) / n, p, width=width):
                with open(p, 'rb') as f:
                    out.append(f.read())
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


# ----------------------------------------------------------------------------
#   Каталог для ИИ
# ----------------------------------------------------------------------------

def catalog_line(e):
    kind = 'картинка' if e['kind'] == 'image' else f'видео {e.get("duration") or 0:.1f} с'
    tags = ', '.join(e.get('tags') or [])
    return (f'{e["id"]} | {CATEGORIES.get(e.get("category"), "Футаж")} | {kind} | {e.get("title", "")}'
            f'{" | теги: " + tags if tags else ""}{" | " + e["description"] if e.get("description") else ""}')


def _words(s):
    return {w for w in re.findall(r'\w{3,}', (s or '').lower())}


def usable(entries=None):
    """Футажи, у которых есть файл."""
    return [e for e in (entries if entries is not None else _load()) if os.path.isfile(e.get('path', ''))]


def catalog_for_brief(brief, limit=250):
    """Каталог для запроса. Если футажей очень много — оставляем самые подходящие по словам запроса,
    чтобы не раздувать запрос к ИИ (фоны и недавно добавленные идут с запасом)."""
    items = usable()
    if len(items) <= limit:
        return items
    want = _words(brief)

    def score(e):
        s = _words(' '.join([e.get('title', ''), e.get('description', ''), ' '.join(e.get('tags') or [])]))
        return len(want & s)
    ranked = sorted(items, key=score, reverse=True)
    keep = ranked[:limit]
    return keep
