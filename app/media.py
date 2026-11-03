"""Работа с видео через ffmpeg: свойства файла, превью-копия, миниатюры, волна звука, паузы."""
import os
import re
import subprocess

import numpy as np

from paths import FFMPEG

NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
THUMB_INTERVAL = 2.0   # секунд между миниатюрами на таймлайне
THUMB_HEIGHT = 64
THUMBS_PER_TILE = 50
PEAKS_PER_SEC = 20


IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.webp', '.bmp')
IMAGE_DURATION = 3600.0  # фото «бесконечное»: клип можно растянуть сколько угодно


def probe(path):
    if os.path.splitext(path)[1].lower() in IMAGE_EXT:
        from PIL import Image, ImageOps
        with Image.open(path) as im:
            w, h = ImageOps.exif_transpose(im).size  # фото с телефона бывают повёрнуты в EXIF
        return {'duration': IMAGE_DURATION, 'width': w, 'height': h, 'fps': None, 'has_audio': False, 'vcodec': None, 'kind': 'image'}
    res = subprocess.run([FFMPEG, '-hide_banner', '-i', path], capture_output=True, text=True,
                         encoding='utf-8', errors='ignore', creationflags=NO_WINDOW)
    err = res.stderr
    info = {'duration': None, 'width': None, 'height': None, 'fps': None, 'has_audio': False, 'vcodec': None}
    m = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', err)
    if m:
        info['duration'] = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    m = re.search(r'Stream #\S+.*?Video: (\w+).*?, (\d{2,5})x(\d{2,5})', err)
    if m:
        info['vcodec'] = m.group(1)
        info['width'], info['height'] = int(m.group(2)), int(m.group(3))
    m = re.search(r'Video:.*?(\d+(?:\.\d+)?) fps', err)
    if m:
        info['fps'] = float(m.group(1))
    rot = re.search(r'rotation of (-?\d+(?:\.\d+)?) degrees', err) or re.search(r'rotate\s*:\s*(-?\d+)', err)
    if rot and abs(round(float(rot.group(1)))) % 180 == 90 and info['width']:
        info['width'], info['height'] = info['height'], info['width']  # ffmpeg сам повернёт кадры
    info['has_audio'] = bool(re.search(r'Stream #\S+.*?Audio:', err))
    # обложка альбома в mp3 выглядит как «видео» с attached pic — это всё равно звук
    attached_pic = bool(re.search(r'Video:.*\(attached pic\)', err))
    info['kind'] = 'video' if info['width'] and not attached_pic else 'audio'
    if not info['duration'] or (info['kind'] == 'audio' and not info['has_audio']):
        raise RuntimeError('не удалось прочитать файл (это точно видео или звук?)')
    if info['kind'] == 'audio':
        info.update(width=None, height=None, fps=None)
    if 'Estimating duration from bitrate' in err:
        # mp3 без VBR-заголовка: длина по битрейту бывает сильно неверной (1:09 вместо 0:50) — считаем точно
        real = exact_duration(path)
        if real:
            info['duration'] = real
    return info


def exact_duration(path):
    """Точная длина: прогон звука через ffmpeg без вывода (секунды на длинный трек)."""
    res = subprocess.run([FFMPEG, '-hide_banner', '-nostats', '-v', 'error', '-progress', 'pipe:1', '-i', path, '-vn', '-f', 'null', '-'],
                         capture_output=True, text=True, encoding='utf-8', errors='ignore', creationflags=NO_WINDOW)
    times = re.findall(r'out_time_us=(\d+)', res.stdout)
    return round(int(times[-1]) / 1e6, 3) if times and int(times[-1]) > 0 else None


def run_ffmpeg(job, args, duration, p0=0.0, p1=1.0, cwd=None, on_time=None):
    """Запускает ffmpeg и переводит его прогресс в прогресс задачи (от p0 до p1)
    или передаёт обработанные секунды в on_time(t), если задано."""
    cmd = [FFMPEG, '-hide_banner', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1', '-y'] + args
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8',
                            errors='ignore', cwd=cwd, creationflags=NO_WINDOW)
    if job:
        job.procs.add(proc)
    # stderr читаем в отдельном потоке, иначе ffmpeg может встать на заполненном буфере
    err_lines = []
    import threading
    reader = threading.Thread(target=lambda: err_lines.extend(proc.stderr), daemon=True)
    reader.start()
    for line in proc.stdout:
        if job and job.cancel_requested:
            proc.kill()
            break
        if line.startswith('out_time_us=') and duration:
            try:
                t = int(line.split('=')[1]) / 1e6
            except ValueError:
                continue
            if on_time:
                on_time(min(t, duration))
            elif job:
                job.update(p0 + (p1 - p0) * min(1.0, t / duration))
    proc.wait()
    reader.join(timeout=5)
    err = ''.join(err_lines)
    if job:
        job.procs.discard(proc)
        job.check_cancel()
    if proc.returncode != 0:
        raise RuntimeError((err or '').strip().splitlines()[-1] if err and err.strip() else f'ffmpeg код {proc.returncode}')


def make_proxy(job, src, dst, duration, p0, p1):
    """Лёгкая копия для плавной перемотки: ≤960 px, ключевой кадр каждые 15 кадров."""
    vf = "scale=w='if(gte(iw,ih),960,-2)':h='if(gte(iw,ih),-2,960)'"
    base = ['-i', src, '-vf', vf, '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart']
    try:
        run_ffmpeg(job, base + ['-c:v', 'h264_nvenc', '-preset', 'p1', '-g', '15', '-bf', '0', '-cq', '30', dst],
                   duration, p0, p1)
    except RuntimeError:
        if job:
            job.check_cancel()
        run_ffmpeg(job, base + ['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '15', '-bf', '0', '-crf', '30', dst],
                   duration, p0, p1)


def make_thumbs(job, src, out_dir, duration, p0, p1):
    os.makedirs(out_dir, exist_ok=True)
    vf = f'fps=1/{THUMB_INTERVAL},scale=-2:{THUMB_HEIGHT},tile={THUMBS_PER_TILE}x1'
    run_ffmpeg(job, ['-i', src, '-an', '-vf', vf, '-q:v', '5', os.path.join(out_dir, 'tile_%03d.jpg')],
               duration, p0, p1)
    return sorted(f for f in os.listdir(out_dir) if f.startswith('tile_'))


def waveform(src):
    """Пики громкости: PEAKS_PER_SEC значений в секунду, 0..1."""
    rate = 8000
    proc = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', src, '-vn', '-ac', '1', '-ar', str(rate),
                           '-f', 's16le', '-'], capture_output=True, creationflags=NO_WINDOW)
    if proc.returncode != 0 or not proc.stdout:
        return []
    a = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    step = rate // PEAKS_PER_SEC
    n = len(a) // step
    if n == 0:
        return []
    peaks = np.abs(a[:n * step]).reshape(n, step).max(axis=1)
    peaks = np.sqrt(peaks)  # визуально ровнее (тихая речь тоже видна)
    return [round(float(x), 3) for x in peaks]


def silences(src, noise_db=-32, min_dur=0.3):
    """Паузы в звуке [(начало, конец)] в секундах исходника."""
    proc = subprocess.run([FFMPEG, '-hide_banner', '-i', src, '-vn', '-af', f'silencedetect=noise={noise_db}dB:d={min_dur}',
                           '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='ignore',
                          creationflags=NO_WINDOW)
    out, start = [], None
    for line in proc.stderr.splitlines():
        m = re.search(r'silence_start: (-?\d+(?:\.\d+)?)', line)
        if m:
            start = max(0.0, float(m.group(1)))
        m = re.search(r'silence_end: (\d+(?:\.\d+)?)', line)
        if m and start is not None:
            out.append([round(start, 3), round(float(m.group(1)), 3)])
            start = None
    return out


def frame_at(src, t, out_path, width=1080):
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-ss', f'{max(0.0, t):.3f}', '-i', src,
                    '-frames:v', '1', '-vf', f'scale={width}:-2', out_path], capture_output=True, creationflags=NO_WINDOW)
    return os.path.exists(out_path)
