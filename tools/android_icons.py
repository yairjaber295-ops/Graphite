"""Иконки Android-приложения из web/icons/icon-512.png (mipmap всех плотностей)."""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = sys.argv[1]  # путь к android/app/src/main/res
SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
src = Image.open(os.path.join(ROOT, 'web', 'icons', 'icon-512.png')).convert('RGBA')
fg = Image.open(os.path.join(ROOT, 'web', 'icons', 'icon-maskable-512.png')).convert('RGBA')
for dens, s in SIZES.items():
    d = os.path.join(RES, f'mipmap-{dens}')
    os.makedirs(d, exist_ok=True)
    for name in ('ic_launcher.png', 'ic_launcher_round.png'):
        src.resize((s, s), Image.LANCZOS).save(os.path.join(d, name))
    # адаптивная иконка: передний план 108dp с запасом
    fs = round(s * 108 / 48)
    fg.resize((fs, fs), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_foreground.png'))
print('иконки готовы')
