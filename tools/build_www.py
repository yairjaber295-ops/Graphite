"""Собирает автономную копию приложения (для Android-приложения и проверки телефонного режима).

dist/www = web/ + fonts/ + fonts.json + precache.json. Сервер компа для работы не нужен.
"""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'app'))
import fonts  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist', 'www')


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    shutil.copytree(os.path.join(ROOT, 'web'), OUT)
    fdir = os.path.join(OUT, 'fonts')
    os.makedirs(fdir, exist_ok=True)
    for n in os.listdir(os.path.join(ROOT, 'fonts')):
        src = os.path.join(ROOT, 'fonts', n)
        if os.path.isfile(src) and n.endswith('.ttf'):
            shutil.copy2(src, fdir)
    shutil.copytree(os.path.join(ROOT, 'fonts', 'licenses'), os.path.join(fdir, 'licenses'))
    with open(os.path.join(fdir, 'fonts.json'), 'w', encoding='utf-8') as f:
        json.dump(fonts.catalog(), f, ensure_ascii=False)
    files = []
    for root, _, names in os.walk(OUT):
        for n in names:
            files.append(os.path.relpath(os.path.join(root, n), OUT).replace('\\', '/'))
    with open(os.path.join(OUT, 'precache.json'), 'w', encoding='utf-8') as f:
        json.dump([x for x in files if '/licenses/' not in x], f)
    print(f'Готово: {OUT} ({len(files)} файлов)')


if __name__ == '__main__':
    main()
