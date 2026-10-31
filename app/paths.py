"""Пути и общие утилиты редактора."""
import json
import os
import re
import shutil
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

# Собранная программа (PyInstaller): ресурсы — внутри папки программы, данные — в %LOCALAPPDATA%\Graphite.
# Из исходников: всё рядом, в папке редактора.
FROZEN = bool(getattr(sys, 'frozen', False))
SRC_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES_DIR = getattr(sys, '_MEIPASS', SRC_DIR)          # web, fonts, esrgan, dist (только чтение)
ROOT = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'Graphite') if FROZEN else SRC_DIR
os.makedirs(ROOT, exist_ok=True)
WEB_DIR = os.path.join(RES_DIR, 'web')
FONTS_DIR = os.path.join(RES_DIR, 'fonts')
ESRGAN_DIR = os.path.join(RES_DIR, 'esrgan')
PROJECTS_DIR = os.path.join(ROOT, 'projects')

def _models_dir():
    # Движок Whisper (CTranslate2) не открывает файлы по пути с кириллицей — держим модели в латинском пути
    base = os.environ.get('LOCALAPPDATA') or ''
    path = os.path.join(base, 'Narezchik', 'whisper-models')
    return path if base and path.isascii() else r'C:\NarezchikModels'


MODELS_DIR = _models_dir()
def _work_dir():
    """Куда кладутся готовые нарезки (их подхватывает загрузчик в TikTok): settings.json → "work_dir", иначе Видео\\Graphite."""
    try:
        with open(os.path.join(ROOT, 'settings.json'), encoding='utf-8') as f:
            d = json.load(f).get('work_dir')
        if d and os.path.isdir(os.path.splitdrive(d)[0] + os.sep):
            return d
    except Exception:
        pass
    return os.path.join(os.path.expanduser('~'), 'Videos', 'Graphite')


WORK_DIR = _work_dir()
def _find_scripts_dir():
    """Папка со скриптами (загрузчик в TikTok): из запускалки или поиском на рабочем столе."""
    env = os.environ.get('NAREZKA_SCRIPTS_DIR', '')
    if env and os.path.isdir(env):
        return env
    desk = os.path.join(os.path.expanduser('~'), 'Desktop')
    for base in [desk] + [e.path for e in os.scandir(desk) if e.is_dir()] if os.path.isdir(desk) else []:
        cand = os.path.join(base, 'Скрипты')
        if os.path.isfile(os.path.join(cand, '3_Загрузить_в_TikTok.bat')):
            return cand
    return ''


SCRIPTS_DIR = _find_scripts_dir()


def find_ffmpeg():
    try:
        import imageio_ffmpeg
        p = imageio_ffmpeg.get_ffmpeg_exe()
        if p and os.path.exists(p):
            return p
    except Exception:
        pass
    return shutil.which('ffmpeg') or 'ffmpeg'


FFMPEG = find_ffmpeg()


def read_json(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, data):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def sanitize_filename(name):
    name = re.sub(r'[\\/*?:"<>|]', '', name or '')
    name = re.sub(r'\s+', ' ', name).strip()
    return name.rstrip('. ')


def project_dir(pid):
    if not re.fullmatch(r'[0-9a-f]{12}', pid or ''):
        raise ValueError('bad project id')
    return os.path.join(PROJECTS_DIR, pid)
