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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, 'web')
FONTS_DIR = os.path.join(ROOT, 'fonts')
PROJECTS_DIR = os.path.join(ROOT, 'projects')

def _models_dir():
    # Движок Whisper (CTranslate2) не открывает файлы по пути с кириллицей — держим модели в латинском пути
    base = os.environ.get('LOCALAPPDATA') or ''
    path = os.path.join(base, 'Graphite', 'whisper-models')
    return path if base and path.isascii() else r'C:\GraphiteModels'


MODELS_DIR = _models_dir()


def _work_dir():
    """Папка готовых нарезок: из переменной окружения, настроек или стандартная папка видео."""
    env = os.environ.get('GRAPHITE_WORK_DIR')
    if env:
        os.makedirs(env, exist_ok=True)
        return env
    cfg = read_json(os.path.join(ROOT, 'settings.json'), {}) or {}
    if cfg.get('work_dir'):
        os.makedirs(cfg['work_dir'], exist_ok=True)
        return cfg['work_dir']
    default_dir = os.path.join(os.path.expanduser('~'), 'Videos', 'Graphite')
    os.makedirs(default_dir, exist_ok=True)
    return default_dir


WORK_DIR = _work_dir()


def _find_scripts_dir():
    """Папка со скриптами (загрузчик в TikTok): из переменной окружения или настроек."""
    env = os.environ.get('GRAPHITE_SCRIPTS_DIR', '')
    if env and os.path.isdir(env):
        return env
    cfg = read_json(os.path.join(ROOT, 'settings.json'), {}) or {}
    if cfg.get('scripts_dir') and os.path.isdir(cfg['scripts_dir']):
        return cfg['scripts_dir']
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
