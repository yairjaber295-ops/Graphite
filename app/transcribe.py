"""Распознавание речи локально через faster-whisper (видеокарта NVIDIA, без интернета после загрузки модели).

Результат — список слов с таймингами по времени исходного файла; группировка в субтитры делается в интерфейсе.
"""
import glob
import os
import re
import sys

from paths import MODELS_DIR

DEFAULT_MODEL = 'large-v3-turbo'
_model = None
_model_key = None


def _add_cuda_dlls():
    """Библиотеки CUDA (pip-пакеты nvidia-* или установленный CUDA Toolkit) нужно явно показать Windows."""
    dirs = glob.glob(os.path.join(sys.prefix, 'Lib', 'site-packages', 'nvidia', '*', 'bin'))
    if os.environ.get('CUDA_PATH'):
        dirs.append(os.path.join(os.environ['CUDA_PATH'], 'bin'))
    dirs += sorted(glob.glob(os.path.join(os.environ.get('ProgramFiles', r'C:\Program Files'), 'NVIDIA GPU Computing Toolkit', 'CUDA', 'v12*', 'bin')))
    dirs += glob.glob(os.path.join(os.environ.get('ProgramFiles', r'C:\Program Files'), 'NVIDIA', 'CUDNN', 'v9*', 'bin', '12*'))
    for d in dirs:
        if not os.path.isdir(d):
            continue
        try:
            os.add_dll_directory(d)
        except Exception:
            pass
        os.environ['PATH'] = d + os.pathsep + os.environ.get('PATH', '')


def _cuda_ok():
    """Есть ли на этом компе библиотеки CUDA для Whisper (у собранной программы их нет внутри — они весят больше гигабайта)."""
    import ctypes
    for dll in ('cublas64_12.dll', 'cudnn64_9.dll'):
        try:
            ctypes.WinDLL(dll)
        except OSError:
            print(f'Whisper: нет {dll} — распознаю на процессоре')
            return False
    return True


def _is_cuda_error(e):
    return bool(re.search(r'cublas|cudnn|cuda|CUBLAS|CUDNN', str(e)))


MODEL_SIZES_MB = {'large-v3-turbo': 1545, 'medium': 1460, 'small': 465}


def _dir_mb(path):
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total / 1048576


def _watch_download(job, model_name, stop):
    """Пока модель качается в первый раз — показываем, сколько уже скачано."""
    import time
    start = _dir_mb(MODELS_DIR)
    need = MODEL_SIZES_MB.get(model_name, 1500)
    while not stop.is_set():
        got = max(0.0, _dir_mb(MODELS_DIR) - start)
        if got > 5:
            job.update(min(0.99, got / need) * 0.3, f'Первый запуск: скачиваю модель распознавания {got:.0f} / ~{need} МБ')
        time.sleep(1.5)


def _model_path(model_name, job):
    """Путь к модели: из кэша, а если её ещё нет — скачать (один раз) с прогрессом в интерфейсе."""
    # новый загрузчик hf-xet на Windows может оставить файл недокачанным — качаем обычным HTTPS с докачкой
    os.environ.setdefault('HF_HUB_DISABLE_XET', '1')
    import threading
    from faster_whisper.utils import download_model
    try:
        path = download_model(model_name, cache_dir=MODELS_DIR, local_files_only=True)
        # кэш может вернуть папку, в которой нет самого файла модели (прерванная загрузка)
        if os.path.isfile(os.path.join(path, 'model.bin')):
            return path
    except Exception:
        pass
    stop = threading.Event()
    threading.Thread(target=_watch_download, args=(job, model_name, stop), daemon=True).start()
    try:
        return download_model(model_name, cache_dir=MODELS_DIR)
    except Exception as e:
        raise RuntimeError(f'не удалось скачать модель распознавания (нужен интернет при первом запуске): {e}')
    finally:
        stop.set()


def _load(model_name, job, force_cpu=False):
    global _model, _model_key
    _add_cuda_dlls()
    from faster_whisper import WhisperModel
    if _model is not None and _model_key and _model_key[0] == model_name and not (force_cpu and _model_key[1] == 'cuda'):
        return _model, _model_key[1]
    model_path = _model_path(model_name, job)
    devices = (('cuda', 'float16'), ('cpu', 'int8')) if (not force_cpu and _cuda_ok()) else (('cpu', 'int8'),)
    for device, compute in devices:
        key = (model_name, device)
        try:
            job.update(message=f'Загрузка модели {model_name} ({"видеокарта" if device == "cuda" else "процессор — будет медленно"})...')
            _model = WhisperModel(model_path, device=device, compute_type=compute)
            _model_key = key
            return _model, device
        except Exception as e:
            print(f'Whisper на {device} не запустился: {e}')
            _model = None
    raise RuntimeError('не удалось загрузить модель Whisper')


# Whisper учился на субтитрах фильмов и на музыке/тишине «дописывает» служебные фразы
_HALLUCINATIONS = re.compile(
    r'^\W*(\w+\s+)?музыка\W*$|субтитр|dimatorzok|продолжение следует|спасибо за просмотр|'
    r'подписывайтесь на канал|редактор субтитров|корректор|аплодисменты|смех\W*$', re.I)


def is_hallucination(seg):
    text = (seg.text or '').strip()
    if not text:
        return True
    if seg.no_speech_prob > 0.6 and seg.avg_logprob < -0.8:
        return True
    return bool(_HALLUCINATIONS.search(text)) and len(text) < 60


def _decode_audio(path):
    """Звук 16 кГц моно через ffmpeg (PyAV в свежих версиях несовместим с faster-whisper и не любит кириллицу в путях)."""
    import subprocess
    import numpy as np
    from paths import FFMPEG
    res = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '16000',
                          '-f', 's16le', '-'], capture_output=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if res.returncode != 0 or not res.stdout:
        raise RuntimeError('не удалось извлечь звук из видео: ' + res.stderr.decode('utf-8', 'ignore')[-300:])
    return np.frombuffer(res.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe(job, path, duration, language='ru', model_name=DEFAULT_MODEL, audio=None):
    """path — файл; либо audio — готовый массив 16 кГц моно (звук, присланный с телефона)."""
    model, device = _load(model_name, job)
    if audio is None:
        job.update(0.02, 'Извлекаю звук...')
        audio = _decode_audio(path)
    duration = duration or len(audio) / 16000
    job.update(0.04, 'Распознаю речь...')
    try:
        return _run(job, model, device, audio, duration, language, model_name)
    except Exception as e:
        if device != 'cuda' or not _is_cuda_error(e):
            raise
        # видеокарта есть, но CUDA-библиотеки не те/не все — пробуем на процессоре
        print('Whisper на видеокарте упал, перехожу на процессор:', e)
        model, device = _load(model_name, job, force_cpu=True)
        return _run(job, model, device, audio, duration, language, model_name)


def _run(job, model, device, audio, duration, language, model_name):
    segments, info = model.transcribe(
        audio, language=None if language == 'auto' else language, word_timestamps=True,
        vad_filter=True, vad_parameters={'min_silence_duration_ms': 300}, beam_size=5,
        condition_on_previous_text=False)
    words = []
    for seg in segments:
        job.check_cancel()
        if is_hallucination(seg):
            continue
        for w in seg.words or []:
            # слово храним с его собственным пробелом впереди: «когда» + «-то» склеится в «когда-то»
            if w.word.strip():
                words.append([round(w.start, 3), round(w.end, 3), w.word])
        if duration:
            job.update(0.02 + 0.98 * min(1.0, seg.end / duration), f'Распознано {seg.end / 60:.1f} из {duration / 60:.1f} мин')
    return {'words': words, 'language': info.language, 'device': device, 'model': model_name}
