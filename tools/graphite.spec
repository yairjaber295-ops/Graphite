# Самостоятельная сборка Graphite для Windows (PyInstaller): Python, библиотеки, ffmpeg и нейросеть — внутри.
# Запуск: tools\build_release.ps1
import os
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_dynamic_libs

ROOT = os.path.dirname(SPECPATH)
datas = [(os.path.join(ROOT, 'web'), 'web'), (os.path.join(ROOT, 'fonts'), 'fonts'), (os.path.join(ROOT, 'esrgan'), 'esrgan')]
if os.path.isfile(os.path.join(ROOT, 'dist', 'Graphite.apk')):
    datas.append((os.path.join(ROOT, 'dist', 'Graphite.apk'), 'dist'))   # «Телефон» → Android: ставится по QR с компа
binaries = []
hidden = ['enhance', 'transcribe', 'schedule_queue', 'fonts', 'tls', 'media', 'jobs']
for pkg in ('faster_whisper', 'ctranslate2', 'tokenizers', 'onnxruntime', 'av'):
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hidden += h
    except Exception as e:  # noqa: BLE001
        print('пропускаю', pkg, e)
datas += collect_data_files('imageio_ffmpeg', include_py_files=False)
binaries += collect_dynamic_libs('imageio_ffmpeg')

a = Analysis([os.path.join(ROOT, 'app', 'desktop.py')], pathex=[os.path.join(ROOT, 'app')], binaries=binaries, datas=datas,
             hiddenimports=hidden, excludes=['torch', 'tensorflow', 'matplotlib', 'IPython', 'pytest'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='Graphite', icon=os.path.join(ROOT, 'web', 'icons', 'app.ico'),
          console=False, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, name='Graphite', upx=False)
