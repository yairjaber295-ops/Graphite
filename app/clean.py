"""Песня без мата (как «clean»-версии из трендов): нейросеть отделяет голос от музыки, Whisper распознаёт слова голоса,
и на мате убирается только голос — бит играет дальше. Варианты: тишина в голосе, слово задом наперёд (как в радио-версиях), «пик».
Список мата — тот же, что в редакторе: web/js/engine/profanity.js."""
import json
import os
import re

import numpy as np

import separate as sp
from paths import FFMPEG, WEB_DIR

PAD = 0.06          # Whisper на пении ставит границы слов неточно — берём с запасом
FADE = 0.012


def _load_list():
    with open(os.path.join(WEB_DIR, 'js', 'engine', 'profanity.js'), encoding='utf-8') as f:
        body = re.sub(r'^\s*//.*$', '', f.read(), flags=re.M).replace('export default', '').strip().rstrip(';')
    d = json.loads(body)
    return [re.compile(r) for r in d['roots']], d['except']


ROOTS, EXCEPT = _load_list()


def norm(w):
    return re.sub(r'[^a-zа-я*]', '', str(w).lower().replace('ё', 'е'))


def is_profane(word, custom=()):
    w = norm(word)
    if not w:
        return False
    if '*' in w and re.search('[a-zа-я]', w):
        return True
    if any(w.startswith(e) for e in EXCEPT):
        return False
    return any(r.search(w) for r in ROOTS) or any(w.startswith(c) for c in custom)


def find(words, custom=()):
    """[[s, e, слово], …] → слитые места с матом [{s, e, word}]."""
    out = []
    for s, e, w in words:
        if not is_profane(w, custom):
            continue
        s, e = max(0.0, s - PAD), e + PAD
        if out and s <= out[-1]['e'] + 0.05:
            out[-1]['e'] = max(out[-1]['e'], e)
            if norm(w) not in [norm(x) for x in out[-1]['word'].split()]:
                out[-1]['word'] += ' ' + w.strip()
        else:
            out.append({'s': s, 'e': e, 'word': w.strip()})
    return out


def _to16k(x):
    """(2, n) 44,1 кГц → моно 16 кГц для Whisper (ресемплинг ffmpeg — он и так есть в сборке)."""
    import subprocess
    res = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', str(sp.SR), '-ac', '2', '-i', '-',
                          '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], input=np.ascontiguousarray(x.T, np.float32).tobytes(),
                         capture_output=True, creationflags=sp.NO_WINDOW)
    if res.returncode != 0:
        raise RuntimeError('не удалось подготовить звук: ' + res.stderr.decode('utf-8', 'ignore')[-300:])
    return np.frombuffer(res.stdout, np.float32).copy()


def _ramp(n):
    return np.linspace(0, 1, n, dtype=np.float32)


def apply(voc, regions, mode, sr=sp.SR):
    """Голос (2, n) → голос без мата: 'mute' — тишина, 'reverse' — задом наперёд, 'beep' — тишина + пик (пик — отдельно)."""
    v = voc.copy()
    beep = np.zeros(v.shape[1], np.float32)
    f = int(FADE * sr)
    for r in regions:
        a, b = int(r['s'] * sr), min(v.shape[1], int(r['e'] * sr))
        if b - a <= 2 * f:
            continue
        if mode == 'reverse':
            seg = v[:, a:b][:, ::-1].copy()
            seg[:, :f] *= _ramp(f); seg[:, -f:] *= _ramp(f)[::-1]
            # исходное слово плавно уходит, на его место — оно же наоборот
            v[:, a:a + f] *= _ramp(f)[::-1]; v[:, b - f:b] *= _ramp(f)
            v[:, a + f:b - f] = 0
            v[:, a:b] += seg
        else:
            v[:, a:a + f] *= _ramp(f)[::-1]; v[:, b - f:b] *= _ramp(f)
            v[:, a + f:b - f] = 0
            if mode == 'beep':
                t = np.arange(b - a) / sr
                env = np.minimum(1, np.minimum(t, t[-1] - t) / 0.005)
                beep[a:b] = np.sin(2 * np.pi * 1000 * t) * env * 0.22
    return v, beep


def clean(job, src, out_dir, stem, mode='mute', lang='ru', model=None, custom=()):
    """src → out_dir/«stem — без мата.flac». Возвращает (путь, найденные места)."""
    import transcribe
    job.update(0.01, 'Читаю звук…')
    mix = sp.decode(src)
    # 1) голос отдельно от музыки (0…60 %)
    inst = sp.instrumental_of(_Sub(job, 0.0, 0.6), mix)
    voc = mix - inst
    # 2) слова (60…92 %): по чистому голосу и по всей песне — нейросеть иногда «съедает» звук, и Whisper слышит
    #    в голосе «глядь» вместо «блядь»; мат, найденный хоть в одном из двух, убираем
    custom = [norm(c) for c in custom if len(norm(c)) >= 2]
    words = []
    for i, (x, label) in enumerate([(voc, 'голос'), (mix, 'всю песню')]):
        job.update(0.6 + 0.16 * i, f'Распознаю слова: {label}…')
        mono = _to16k(x)
        res = transcribe.transcribe(_Sub(job, 0.6 + 0.16 * i, 0.76 + 0.16 * i), None, len(mono) / 16000, lang or 'ru',
                                    model or transcribe.DEFAULT_MODEL, audio=mono)
        words += res['words']
    regions = find(sorted(words, key=lambda w: w[0]), custom)
    # 3) склейка: музыка + голос без мата
    job.update(0.94, f'Убираю мат: {len(regions)}…')
    v, beep = apply(voc, regions, mode)
    out = inst + v + beep[None, :]
    peak = float(np.abs(out).max())
    if peak > 0.99:
        out *= 0.99 / peak
    os.makedirs(out_dir, exist_ok=True)
    n, path = 1, None
    while True:
        path = os.path.join(out_dir, f'{stem} — без мата{f" ({n})" if n > 1 else ""}.flac')
        if not os.path.exists(path):
            break
        n += 1
    sp.encode(path, out)
    return path, regions


class _Sub:
    """Прогресс вложенной задачи → в свой отрезок общей полосы."""
    def __init__(self, job, a, b):
        self.job, self.a, self.b = job, a, b

    def update(self, progress=None, message=None):
        self.job.update(None if progress is None else self.a + (self.b - self.a) * progress, message)

    def check_cancel(self):
        self.job.check_cancel()
