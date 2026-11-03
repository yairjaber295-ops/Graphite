"""Инструментал автоматически: нейросети Ultimate Vocal Remover (MDX-Net, onnxruntime).

«Качество»: ансамбль двух моделей — инструментальная Inst_HQ_4 и вокальная Kim_Vocal_2 (инструментал = смесь − вокал),
результаты усредняются: на тестовой смеси (чистая речь поверх музыки) голоса в инструментале на 1–1.5 дБ меньше, чем у Inst_HQ_3.
Перебраны также Inst_HQ_5, Voc_FT, тройки моделей, шумоподавление UVR и нахлёст кусков — лучше не стало.
«Быстро»: одна модель Inst_HQ_3. Модели скачиваются один раз при первом использовании.
"""
import hashlib
import os
import subprocess
import urllib.request

import numpy as np

from jobs import JobCancelled
from paths import FFMPEG

NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
SR, HOP, DIM_T = 44100, 1024, 256
REPO = 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/'
# параметры — из официальной таблицы UVR (model_data_new.json, ключ — md5 последних 10 МБ файла)
MODELS = {
    'inst_hq3': {'file': 'UVR-MDX-NET-Inst_HQ_3.onnx', 'hash': '55657dd70583b0fedfba5f67df11d711', 'size': 66759214,
                 'n_fft': 6144, 'dim_f': 3072, 'comp': 1.022, 'stem': 'inst'},
    'inst_hq4': {'file': 'UVR-MDX-NET-Inst_HQ_4.onnx', 'hash': '0f2a6bc5b49d87d64728ee40e23bceb1', 'size': 59074342,
                 'n_fft': 5120, 'dim_f': 2560, 'comp': 1.019, 'stem': 'inst'},
    'kim_vocal2': {'file': 'Kim_Vocal_2.onnx', 'hash': '970b3f9492014d18fefeedfe4773cb42', 'size': 66759214,
                   'n_fft': 7680, 'dim_f': 3072, 'comp': 1.009, 'stem': 'vocal'},
    'inst_hq5': {'file': 'UVR-MDX-NET-Inst_HQ_5.onnx', 'hash': 'cb790d0c913647ced70fc6b38f5bea1a', 'size': 59074342,
                 'n_fft': 5120, 'dim_f': 2560, 'comp': 1.01, 'stem': 'inst'},
    'voc_ft': {'file': 'UVR-MDX-NET-Voc_FT.onnx', 'hash': '77d07b2667ddf05b9e3175941b4454a0', 'size': 66762490,
               'n_fft': 7680, 'dim_f': 3072, 'comp': 1.021, 'stem': 'vocal'},
}
QUALITY = {'best': ['inst_hq4', 'kim_vocal2'], 'fast': ['inst_hq3']}


def models_dir():
    base = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~')
    d = os.path.join(base, 'Graphite', 'models')
    if not d.isascii():   # onnxruntime и кириллица в пути не дружат
        d = r'C:\GraphiteModels'
    os.makedirs(d, exist_ok=True)
    return d


def _hash(path):
    with open(path, 'rb') as f:
        f.seek(-10000 * 1024, 2)
        return hashlib.md5(f.read()).hexdigest()


def ensure_model(job, key, p0=0.0, p1=0.2):
    m = MODELS[key]
    path = os.path.join(models_dir(), m['file'])
    if os.path.isfile(path) and (not m['size'] or os.path.getsize(path) == m['size']):
        return path
    tmp = path + '.part'
    try:
        with urllib.request.urlopen(REPO + m['file'], timeout=60) as r, open(tmp, 'wb') as f:
            total = int(r.headers.get('Content-Length') or m['size'] or 0)
            got = 0
            while True:
                job.check_cancel()
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
                job.update(p0 + (p1 - p0) * (got / total if total else 0), f'Первый запуск: скачиваю нейросеть {got >> 20}{f" / {total >> 20}" if total else ""} МБ')
    except JobCancelled:
        raise
    except Exception as e:
        raise RuntimeError(f'не удалось скачать нейросеть (нужен интернет при первом запуске): {e}')
    if (m['size'] and os.path.getsize(tmp) != m['size']) or (m['hash'] and _hash(tmp) != m['hash']):
        os.remove(tmp)
        raise RuntimeError('скачанная нейросеть повреждена — попробуй ещё раз')
    os.replace(tmp, path)
    return path


_sessions = {}


def session(path):
    if path not in _sessions:
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) - 1)
        prov = [p for p in ('CUDAExecutionProvider', 'DmlExecutionProvider') if p in ort.get_available_providers()] + ['CPUExecutionProvider']
        _sessions[path] = ort.InferenceSession(path, opts, providers=prov)
    return _sessions[path]


def decode(path):
    res = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', path, '-vn', '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, creationflags=NO_WINDOW)
    if res.returncode != 0 or not res.stdout:
        raise RuntimeError('не удалось прочитать звук: ' + res.stderr.decode('utf-8', 'ignore')[-300:])
    return np.frombuffer(res.stdout, dtype=np.float32).reshape(-1, 2).T.copy()   # (2, n)


def _window(n_fft):
    return (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n_fft) / n_fft)).astype(np.float32)   # Ханн, периодическое (как torch)


def stft(x, n_fft, dim_f):
    """(2, n) → (4, dim_f, кадры): как torch.stft(center=True, reflect) → [re0, im0, re1, im1] (как в UVR)."""
    pad = n_fft // 2
    xp = np.pad(x, ((0, 0), (pad, pad)), mode='reflect')
    frames = 1 + (xp.shape[1] - n_fft) // HOP
    idx = np.arange(n_fft)[None, :] + HOP * np.arange(frames)[:, None]
    spec = np.fft.rfft(xp[:, idx] * _window(n_fft), axis=-1).transpose(0, 2, 1)[:, :dim_f, :]
    return np.stack([spec[0].real, spec[0].imag, spec[1].real, spec[1].imag]).astype(np.float32)


def istft(s, length, n_fft, dim_f):
    """(4, dim_f, кадры) → (2, length): верхние бины — нули, сложение окон с нормировкой (как torch.istft)."""
    frames = s.shape[-1]
    win = _window(n_fft)
    out = []
    for c in range(2):
        spec = np.zeros((n_fft // 2 + 1, frames), dtype=np.complex64)
        spec[:dim_f] = s[2 * c] + 1j * s[2 * c + 1]
        fr = np.fft.irfft(spec.T, n=n_fft, axis=-1) * win
        total = n_fft + HOP * (frames - 1)
        y = np.zeros(total, dtype=np.float32)
        wsum = np.zeros(total, dtype=np.float32)
        for i in range(frames):
            y[i * HOP:i * HOP + n_fft] += fr[i]
            wsum[i * HOP:i * HOP + n_fft] += win ** 2
        y /= np.maximum(wsum, 1e-8)
        out.append(y[n_fft // 2:n_fft // 2 + length])
    return np.stack(out)


def run_model(job, mix, key, path, p0, p1, overlap=0.0):
    """Основная дорожка модели (инструментал или вокал) для смеси (2, n).
    Края каждого куска (по n_fft/2) отбрасываются, как в UVR, — стыков не слышно; overlap > 0 — ещё и плавное сшивание."""
    m = MODELS[key]
    n_fft, dim_f = m['n_fft'], m['dim_f']
    sess = session(path)
    chunk = HOP * (DIM_T - 1)
    trim = n_fft // 2
    gen = chunk - 2 * trim
    step = max(HOP, int(gen * (1 - overlap)))
    n = mix.shape[1]
    total = trim + n + gen + trim
    mixture = np.zeros((2, total), np.float32)
    mixture[:, trim:trim + n] = mix
    acc = np.zeros((2, total), np.float32)
    wacc = np.zeros(total, np.float32)
    w = np.hanning(gen + 2)[1:-1].astype(np.float32) + 1e-3   # вес середины куска
    starts = list(range(0, n, step))
    name = 'голос' if m['stem'] == 'vocal' else 'музыку'
    for k, i in enumerate(starts):
        job.check_cancel()
        job.update(p0 + (p1 - p0) * k / len(starts), f'Нейросеть выделяет {name}: {k + 1} из {len(starts)}')
        wave = mixture[:, i:i + chunk]
        if wave.shape[1] < chunk:
            wave = np.pad(wave, ((0, 0), (0, chunk - wave.shape[1])))
        spec = stft(wave, n_fft, dim_f)
        spec[:, :3, :] = 0   # самые низкие бины модель не видит (как в UVR)
        pred = sess.run(None, {sess.get_inputs()[0].name: spec[None]})[0][0]
        part = istft(pred, chunk, n_fft, dim_f)[:, trim:trim + gen]
        end = min(total, i + trim + gen)
        L = end - (i + trim)
        if L <= 0:
            continue
        acc[:, i + trim:end] += part[:, :L] * w[:L]
        wacc[i + trim:end] += w[:L]
    out = acc[:, trim:trim + n] / np.maximum(wacc[trim:trim + n], 1e-6)
    return out * m['comp']


def encode(path, x):
    """(2, n) float → FLAC (без потерь, вдвое меньше WAV)."""
    data = np.clip(x.T, -1, 1).astype(np.float32).tobytes()
    res = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-',
                          '-c:a', 'flac', path], input=data, capture_output=True, creationflags=NO_WINDOW)
    if res.returncode != 0:
        raise RuntimeError('не удалось записать звук: ' + res.stderr.decode('utf-8', 'ignore')[-300:])


def instrumental_of(job, mix, quality='best'):
    keys = QUALITY.get(quality, QUALITY['best'])
    if quality == 'best':
        try:
            paths = [ensure_model(job, k, 0.02 + 0.1 * i, 0.12 + 0.1 * i) for i, k in enumerate(keys)]
        except RuntimeError:
            keys, paths = QUALITY['fast'], [ensure_model(job, 'inst_hq3', 0.02, 0.2)]   # нет сети/модели — быстрая
    else:
        paths = [ensure_model(job, k, 0.02, 0.2) for k in keys]
    insts = []
    span = 0.7 / len(keys)
    for i, (k, p) in enumerate(zip(keys, paths)):
        est = run_model(job, mix, k, p, 0.25 + span * i, 0.25 + span * (i + 1))
        insts.append(mix - est if MODELS[k]['stem'] == 'vocal' else est)
    return sum(insts) / len(insts)


def separate(job, src, out_dir, stem, quality='best'):
    """src → out_dir/«stem — инструментал.flac» и «stem — вокал.flac». Возвращает пути."""
    job.update(0.01, 'Читаю звук…')
    mix = decode(src)
    inst = instrumental_of(job, mix, quality)
    job.update(0.96, 'Сохраняю инструментал и вокал…')
    voc = mix - inst
    os.makedirs(out_dir, exist_ok=True)
    # повторный запуск не затирает файлы, на которые уже ссылается проект
    n = 1
    while True:
        suf = f' ({n})' if n > 1 else ''
        pi = os.path.join(out_dir, f'{stem} — инструментал{suf}.flac')
        pv = os.path.join(out_dir, f'{stem} — вокал{suf}.flac')
        if not os.path.exists(pi) and not os.path.exists(pv):
            break
        n += 1
    encode(pi, inst)
    encode(pv, voc)
    return pi, pv
