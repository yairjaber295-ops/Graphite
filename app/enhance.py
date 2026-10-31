"""Улучшение качества видео и фото: Real-ESRGAN (ncnn, Vulkan) на видеокарте.

Видео: ffmpeg режет на кадры → нейросеть пачками → кадры собираются обратно (NVENC), звук сохраняется.
Фото: тот же алгоритм, что в PhotoForge (два прохода для больших увеличений и согласование с исходником).
"""
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time

import numpy as np
from PIL import Image, ImageFilter, ImageOps

import media
from jobs import JobCancelled
from paths import ESRGAN_DIR, FFMPEG

NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
ESRGAN = os.path.join(ESRGAN_DIR, 'realesrgan-ncnn-vulkan.exe')
MAX_SIDE = 3840
MAX_PIXELS = 20_000_000

# id → (модель, масштабы)
MODELS = {
    'fast': ('realesr-animevideov3', (2, 3, 4)),   # лёгкая видео-модель: в разы быстрее
    'quality': ('realesrgan-x4plus', (4,)),        # тяжёлая: максимум деталей
    'none': (None, ()),                            # без нейросети: Lanczos + резкость
}
QUALITY = {'normal': 23, 'high': 19, 'max': 15}
RES = ('x2', 'x4', '1080', '1440', '2160')


def available():
    return os.path.isfile(ESRGAN)


def even(v):
    return max(2, int(round(v / 2)) * 2)


def target_dims(w, h, res):
    """×2 / ×4 или по короткой стороне (1080p, 1440p, 4K) — вертикальные тоже считаются правильно."""
    k = int(res[1]) if res in ('x2', 'x4') else {'1080': 1080, '1440': 1440, '2160': 2160}[res] / min(w, h)
    k = min(k, MAX_SIDE / max(w, h))
    return even(w * k), even(h * k)


def plan(w, h, model, res):
    tw, th = target_dims(w, h, res)
    name, scales = MODELS[model]
    if not name:
        return {'model': None, 'scale': 1, 'in': (w, h), 'out': (tw, th)}
    ratio = tw / w
    scale = next((s for s in scales if s >= ratio - 1e-6), scales[-1])
    if model == 'fast':
        k = min(1.0, tw / scale / w)        # как в PhotoForge: лишнее разрешение сначала убираем
    else:
        # тяжёлая модель: вход не меньше target/4, но не больше target/2 и ~0.6 Мп — иначе часы на ролик
        k = min(1.0, tw / 2 / w, (600_000 / (w * h)) ** 0.5)
        k = max(k, min(1.0, tw / 4 / w))
    return {'model': f'{name}-x{scale}' if model == 'fast' else name, 'scale': scale,
            'in': (round(w * k), round(h * k)), 'out': (tw, th)}


def run_esrgan(src, dst, model, scale, job=None, tile=0, on_poll=None, on_percent=None):
    """Файл → файл или папка → папка. Проценты тайлов (для одного файла) отдаются в on_percent."""
    proc = subprocess.Popen([ESRGAN, '-i', str(src), '-o', str(dst), '-m', os.path.join(os.path.dirname(ESRGAN), 'models'),
                             '-n', model, '-s', str(scale), '-t', str(tile), '-f', 'png', '-j', '2:2:2'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=NO_WINDOW)
    if job:
        job.procs.add(proc)
    log = []

    def read():
        for raw in iter(proc.stderr.readline, b''):
            line = raw.decode('utf-8', 'replace').strip()
            log.append(line)
            m = re.fullmatch(r'(\d+(?:[.,]\d+)?)%', line)
            if m and on_percent:
                on_percent(float(m.group(1).replace(',', '.')))
    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    try:
        while True:
            try:
                proc.wait(timeout=0.25)
                break
            except subprocess.TimeoutExpired:
                if job and job.cancel_requested:
                    proc.kill()
                    proc.wait()
                    raise JobCancelled()
                if on_poll:
                    on_poll()
    finally:
        if job:
            job.procs.discard(proc)
    reader.join(2)
    if proc.returncode:
        raise RuntimeError('Ошибка нейросети на видеокарте:\n' + '\n'.join(l for l in log if not l.endswith('%'))[-800:])


def finish_frame(ai, src, out, power):
    """Результат нейросети → итоговый размер; при силе < 100% — смешиваем с обычным увеличением."""
    if ai.size != out:
        ai = ai.resize(out, Image.Resampling.LANCZOS)
    if src is not None and power < 1:
        ai = Image.blend(src.resize(out, Image.Resampling.LANCZOS), ai, power)
    return ai


_NVENC = None


def has_nvenc():
    global _NVENC
    if _NVENC is None:
        r = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=320x240:d=0.1',
                            '-c:v', 'h264_nvenc', '-f', 'null', '-'], capture_output=True, creationflags=NO_WINDOW)
        _NVENC = r.returncode == 0
    return _NVENC


def encoder_args(quality='high'):
    q = QUALITY.get(quality, 19)
    if has_nvenc():
        return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', str(q), '-b:v', '0']
    return ['-c:v', 'libx264', '-preset', 'medium', '-crf', str(q - 1)]


# ----------------------------------------------------------------------------
#   Фото (алгоритм PhotoForge)
# ----------------------------------------------------------------------------
def enhance_image(job, src_path, dst_path, opts):
    with Image.open(src_path) as im:
        source = ImageOps.exif_transpose(im).convert('RGB')
    w, h = source.size
    target = target_dims(w, h, opts.get('res', 'x2'))
    if target[0] * target[1] > MAX_PIXELS:
        raise ValueError('Слишком большой результат — выберите меньшее разрешение.')
    power = max(0.0, min(1.0, opts.get('power', 75) / 100))
    baseline = source.resize(target, Image.Resampling.LANCZOS)
    if power == 0 or opts.get('model') == 'none':
        result = baseline
    else:
        result = upscale_photo(job, source, target, baseline, power)
    result.save(dst_path)
    return result.size


def upscale_photo(job, source, target, baseline, power):
    target_w, target_h = target
    result = source
    with tempfile.TemporaryDirectory(prefix='enhance-') as folder:
        passes = 2 if max(target) / max(source.size) > 4 else 1
        for step in range(passes):
            job.check_cancel()
            if step or max(result.size) > max(target) / 4:
                result = result.resize((max(1, round(target_w / 4)), max(1, round(target_h / 4))), Image.Resampling.LANCZOS)
            previous = result
            inp, out = os.path.join(folder, 'input.png'), os.path.join(folder, 'output.png')
            result.save(inp)
            label = f'Нейросеть · проход {step + 1}/{passes}'
            job.update(step / passes * 0.85, label)
            run_esrgan(inp, out, 'realesrgan-x4plus', 4, job, tile=128,
                       on_percent=lambda p, s=step: job.update((s + p / 100) / passes * 0.85, label))
            with Image.open(out) as image:
                result = image.convert('RGB')
            if step:
                result = Image.blend(previous.resize(result.size, Image.Resampling.LANCZOS), result, 0.3)
    job.update(0.9, 'Согласование цвета и деталей с исходником…')
    result = Image.blend(baseline, result.resize(target, Image.Resampling.LANCZOS), power)
    observed = np.asarray(source.filter(ImageFilter.GaussianBlur(1.5)), dtype=np.float32)
    for _ in range(2):
        reduced = np.asarray(result.resize(source.size, Image.Resampling.BOX).filter(ImageFilter.GaussianBlur(1.5)), dtype=np.float32)
        residual = observed - reduced
        channels = []
        for c, channel in enumerate(result.split()):
            correction = np.asarray(Image.fromarray(residual[:, :, c]).resize(target, Image.Resampling.BICUBIC))
            channels.append(Image.fromarray(np.uint8(np.clip(np.asarray(channel, dtype=np.float32) + correction * 0.75, 0, 255))))
        result = Image.merge('RGB', channels)
    return result


# ----------------------------------------------------------------------------
#   Видео: декодер → нейросеть пачками → кодировщик (всё параллельно)
# ----------------------------------------------------------------------------
def enhance_video(job, src, dst, info, opts):
    w, h, fps, dur = info['width'], info['height'], info.get('fps') or 30.0, info['duration']
    p = plan(w, h, opts.get('model', 'fast'), opts.get('res', '1080'))
    power = max(0.0, min(1.0, opts.get('power', 100) / 100))
    total = max(1, round(dur * fps))
    state = {'done': 0, 't0': time.time(), 'last': 0.0}
    tw, th = p['out']

    def report(stage, force=False):
        now = time.time()
        if not force and now - state['last'] < 0.4:
            return
        state['last'] = now
        el = now - state['t0']
        state['done'] = max(state['done'], state.get('gpu', 0))   # видеокарта — самое медленное звено: считаем по ней
        speed = state['done'] / el if el > 1 else 0
        eta = f' · осталось {int((total - state["done"]) / speed // 60)}:{int((total - state["done"]) / speed % 60):02d}' if speed else ''
        job.update(min(0.99, state['done'] / total), f'{stage}: {state["done"]}/{total} кадров' + (f' · {speed:.1f} к/с' if speed else '') + eta)

    log_path = dst + '.log'
    log = open(log_path, 'wb')
    procs = []

    def popen(args, **kw):
        proc = subprocess.Popen(args, creationflags=NO_WINDOW, **kw)
        procs.append(proc)
        job.procs.add(proc)
        return proc

    tail = ['-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'aac', '-b:a', '256k'] if not p['model'] else []
    try:
        if not p['model']:
            args = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', '-i', src] + tail + [
                '-vf', f'scale={tw}:{th}:flags=lanczos,unsharp=5:5:{0.4 + 0.6 * power:.2f}'] + encoder_args(opts.get('quality')) + [
                '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst]
            proc = popen(args, stdout=subprocess.PIPE, stderr=log, text=True)
            for line in proc.stdout:
                if job.cancel_requested:
                    proc.kill()
                    break
                if line.startswith('frame='):
                    state['done'] = int(line.split('=')[1])
                    report('Увеличение')
            proc.wait()
            job.check_cancel()
        else:
            neural(job, src, dst, info, p, power, opts, popen, log, state, report)
    except BaseException:
        for proc in procs:
            if proc.poll() is None:
                proc.kill()
        for proc in procs:
            job.procs.discard(proc)
        log.close()
        for f in (dst, log_path):
            try:
                os.remove(f)
            except OSError:
                pass
        raise
    log.close()
    for proc in procs:
        job.procs.discard(proc)
    err = open(log_path, encoding='utf-8', errors='replace').read().strip()
    os.remove(log_path)
    if not os.path.exists(dst) or os.path.getsize(dst) < 1000:
        raise RuntimeError('Не удалось записать видео:\n' + err[-800:])
    return p['out']


def neural(job, src, dst, info, p, power, opts, popen, log, state, report):
    w, h, fps = info['width'], info['height'], info.get('fps') or 30.0
    iw, ih = p['in']
    tw, th = p['out']
    ow, oh = iw * p['scale'], ih * p['scale']
    chunk = max(12, min(120, round(600e6 / (ow * oh * 3))))   # пачка на один запуск: реже грузим модель, ≤ ~0.6 ГБ
    need_src = power < 1
    gpu_q, enc_q = queue.Queue(maxsize=2), queue.Queue(maxsize=2)
    errors = []
    stop = threading.Event()
    tmp = tempfile.mkdtemp(prefix='enhance-')

    def guard(fn):
        def run():
            try:
                fn()
            except BaseException as e:  # noqa: BLE001
                errors.append(e)
                stop.set()
        return run

    def alive():
        if stop.is_set() or job.cancel_requested:
            raise JobCancelled()

    def decode():
        size = (w, h) if need_src else (iw, ih)
        dec = popen([FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', src, '-map', '0:v:0',
                     '-vf', f'scale={size[0]}:{size[1]}:flags=lanczos', '-r', str(fps), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=size[0] * size[1] * 6)
        nbytes = size[0] * size[1] * 3
        k = n = 0
        cur = None
        try:
            while True:
                alive()
                buf = dec.stdout.read(nbytes)
                if len(buf) < nbytes:
                    break
                if cur is None:
                    cur = os.path.join(tmp, f'in{k}')
                    os.mkdir(cur)
                    if need_src:
                        os.mkdir(os.path.join(tmp, f'src{k}'))
                img = Image.frombuffer('RGB', size, buf, 'raw', 'RGB', 0, 1)
                name = f'{n:06d}.bmp'
                if need_src:
                    img.save(os.path.join(tmp, f'src{k}', name))
                    if size != (iw, ih):
                        img = img.resize((iw, ih), Image.Resampling.LANCZOS)
                img.save(os.path.join(cur, name))
                n += 1
                if n % chunk == 0:
                    gpu_q.put(k)
                    k, cur = k + 1, None
            if cur is not None:
                gpu_q.put(k)
        finally:
            dec.kill()
            gpu_q.put(None)

    def gpu():
        base = 0
        try:
            while True:
                k = gpu_q.get()
                if k is None or stop.is_set():
                    break
                out = os.path.join(tmp, f'out{k}')
                os.mkdir(out)

                def poll(out=out, base=base):
                    state['gpu'] = base + len(os.listdir(out))
                    report('Нейросеть')
                run_esrgan(os.path.join(tmp, f'in{k}'), out, p['model'], p['scale'], job, on_poll=poll)
                base += len(os.listdir(out))
                shutil.rmtree(os.path.join(tmp, f'in{k}'), ignore_errors=True)
                enc_q.put(k)
        finally:
            enc_q.put(None)

    threads = [threading.Thread(target=guard(decode), daemon=True), threading.Thread(target=guard(gpu), daemon=True)]
    for t in threads:
        t.start()
    args = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{tw}x{th}',
            '-framerate', str(fps), '-i', '-']
    if info.get('has_audio'):
        args += ['-i', src, '-map', '0:v', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '256k', '-shortest']
    args += encoder_args(opts.get('quality')) + ['-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst]
    enc = popen(args, stdin=subprocess.PIPE, stderr=log)
    try:
        while True:
            k = enc_q.get()
            if k is None or stop.is_set():
                break
            out = os.path.join(tmp, f'out{k}')
            for f in sorted(os.listdir(out)):
                alive()
                with Image.open(os.path.join(out, f)) as ai:
                    srcf = Image.open(os.path.join(tmp, f'src{k}', f[:-4] + '.bmp')) if need_src else None
                    frame = finish_frame(ai.convert('RGB'), srcf, (tw, th), power)
                enc.stdin.write(frame.tobytes())
                state['enc'] = state.get('enc', 0) + 1
                report('Нейросеть')
            shutil.rmtree(out, ignore_errors=True)
            shutil.rmtree(os.path.join(tmp, f'src{k}'), ignore_errors=True)
    except (BrokenPipeError, OSError) as e:
        if not job.cancel_requested:
            errors.append(RuntimeError('Кодировщик остановился: ' + str(e)))
        stop.set()
    except JobCancelled:
        stop.set()
    finally:
        try:
            enc.stdin.close()
        except OSError:
            pass
        if stop.is_set() or job.cancel_requested:
            enc.kill()
        enc.wait()
        stop.set()
        # разблокировать потоки, если они ждут в полных очередях
        for q in (gpu_q, enc_q):
            try:
                while True:
                    q.get_nowait()
            except queue.Empty:
                pass
        for t in threads:
            t.join(5)
        shutil.rmtree(tmp, ignore_errors=True)
    job.check_cancel()
    real = [e for e in errors if not isinstance(e, JobCancelled)]
    if real:
        raise real[0]


# ----------------------------------------------------------------------------
#   Предпросмотр одного кадра (сравнение и оценка времени)
# ----------------------------------------------------------------------------
def preview(src, info, t, opts, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        try:
            os.remove(os.path.join(out_dir, f))
        except OSError:
            pass
    stamp = str(int(time.time() * 1000))
    before, after = os.path.join(out_dir, f'b{stamp}.png'), os.path.join(out_dir, f'a{stamp}.png')
    model, res = opts.get('model', 'fast'), opts.get('res', '1080')
    power = max(0.0, min(1.0, opts.get('power', 100) / 100))
    if info.get('kind') == 'image':
        with Image.open(src) as im:
            frame = ImageOps.exif_transpose(im).convert('RGB')
    else:
        media.frame_at(src, t, before, width=info['width'])
        frame = Image.open(before).convert('RGB')
    w, h = frame.size
    p = plan(w, h, 'quality' if info.get('kind') == 'image' and model != 'none' else model, res)
    per = 0.004
    with tempfile.TemporaryDirectory(prefix='enhance-pv-') as d:
        if p['model']:
            small = frame.resize(p['in'], Image.Resampling.LANCZOS) if frame.size != p['in'] else frame
            n = 7 if model == 'fast' else 3
            times = []
            for run, count in (('a', 1), ('b', n if info.get('kind') != 'image' else 1)):
                os.mkdir(os.path.join(d, 'in' + run))
                os.mkdir(os.path.join(d, 'out' + run))
                for i in range(count):
                    small.save(os.path.join(d, 'in' + run, f'{i}.bmp'))
                t0 = time.time()
                run_esrgan(os.path.join(d, 'in' + run), os.path.join(d, 'out' + run), p['model'], p['scale'])
                times.append(time.time() - t0)
                if info.get('kind') == 'image':
                    break
            if len(times) > 1:
                per = max(0.005, (times[1] - times[0]) / (n - 1))
            with Image.open(os.path.join(d, 'outa', '0.png')) as ai:
                res_img = finish_frame(ai.convert('RGB'), frame, p['out'], power)
        else:
            res_img = frame.resize(p['out'], Image.Resampling.LANCZOS)
    frame.save(before, compress_level=1)
    res_img.save(after, compress_level=1)
    frames = 1 if info.get('kind') == 'image' else info['duration'] * (info.get('fps') or 30)
    return {'before': os.path.basename(before), 'after': os.path.basename(after), 'w': p['out'][0], 'h': p['out'][1],
            'per': per, 'eta': frames * per * 1.4 if info.get('kind') != 'image' else None}
