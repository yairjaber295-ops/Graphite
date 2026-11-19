"""Офлайн-субтитры на телефоне: кладёт в сборку приложения Vosk и маленькую русскую модель.

    python -I tools/fetch_vosk.py <папка www> <папка node_modules>

www/vosk/vosk.js        — из npm-пакета vosk-browser (распознавание на WebAssembly)
www/vosk/model.tar.gz   — vosk-model-small-ru-0.22 (~45 МБ), перепакованная из zip в tar.gz, как ждёт vosk-browser.
Модель скачивается один раз и лежит в .cache/vosk (или в GRAPHITE_CACHE).
"""
import os
import shutil
import sys
import tarfile
import urllib.request
import zipfile

MODEL = 'vosk-model-small-ru-0.22'
URL = f'https://alphacephei.com/vosk/models/{MODEL}.zip'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(www, node_modules):
    out = os.path.join(www, 'vosk')
    os.makedirs(out, exist_ok=True)
    js = os.path.join(node_modules, 'vosk-browser', 'dist', 'vosk.js')
    if not os.path.exists(js):
        sys.exit(f'нет {js} — поставь пакет: npm install vosk-browser@0.0.8')
    shutil.copyfile(js, os.path.join(out, 'vosk.js'))

    cache = os.environ.get('GRAPHITE_CACHE') or os.path.join(ROOT, '.cache', 'vosk')
    os.makedirs(cache, exist_ok=True)
    tgz = os.path.join(cache, MODEL + '.tar.gz')
    if not os.path.exists(tgz):
        z = os.path.join(cache, MODEL + '.zip')
        if not os.path.exists(z) or os.path.getsize(z) < 30_000_000:
            print('качаю офлайн-модель для субтитров (~45 МБ)…')
            urllib.request.urlretrieve(URL, z + '.part')
            os.replace(z + '.part', z)
        # распаковать и упаковать папкой целиком: vosk-browser нужны и записи каталогов, иначе модель не загрузится
        unz = os.path.join(cache, 'unzip')
        shutil.rmtree(unz, ignore_errors=True)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(unz)
        tmp = tgz + '.part'
        with tarfile.open(tmp, 'w:gz') as tf:
            tf.add(os.path.join(unz, MODEL), arcname=MODEL)
        shutil.rmtree(unz, ignore_errors=True)
        os.replace(tmp, tgz)
    shutil.copyfile(tgz, os.path.join(out, 'model.tar.gz'))
    with open(os.path.join(out, 'ready.json'), 'w', encoding='utf-8') as f:   # метка «офлайн-модель есть»
        f.write('{"model": "%s"}' % MODEL)
    print(f'офлайн-субтитры: vosk.js + {MODEL} ({os.path.getsize(tgz) / 1048576:.0f} МБ)')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
