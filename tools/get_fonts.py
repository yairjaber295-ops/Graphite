"""Скачивает шрифты с кириллицей с Google Fonts (лицензия SIL OFL) вместе с текстом лицензии.

Запуск: python get_fonts.py  — уже скачанные файлы пропускаются.
"""
import os
import re
import sys
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS_DIR = os.path.join(ROOT, 'fonts')
LIC_DIR = os.path.join(FONTS_DIR, 'licenses')

# (семейство, начертания) — все с поддержкой кириллицы, все SIL Open Font License
FONTS = [
    ('Rubik', [500, 600, 700, 800, 900]), ('Montserrat', [700, 900]), ('Unbounded', [700, 900]),
    # похожие на Rubik Bold: мягкие геометрические гротески с кириллицей
    ('Onest', [400, 500, 600, 700, 800]), ('Geologica', [700, 800]), ('M PLUS Rounded 1c', [800]),
    ('Nunito', [800]), ('Montserrat Alternates', [700]),
    ('Russo One', [400]), ('Dela Gothic One', [400]), ('Oswald', [600, 700]),
    ('Inter', [700, 900]), ('Golos Text', [700, 900]), ('Manrope', [800]),
    ('Comfortaa', [700]), ('Lobster', [400]), ('Pacifico', [400]), ('Caveat', [700]),
    ('Press Start 2P', [400]), ('Rubik Mono One', [400]), ('Exo 2', [800, 900]),
    ('Nunito', [900]), ('Roboto Condensed', [700]), ('Rubik Glitch', [400]),
    ('Rubik Wet Paint', [400]), ('Rubik Burned', [400]), ('Amatic SC', [700]),
    ('Yeseva One', [400]), ('Playfair Display', [900]), ('Alumni Sans', [800]),
    ('Tektur', [700]), ('Jura', [700]), ('Seymour One', [400]), ('Neucha', [400]),
    ('Marck Script', [400]),
    # заголовки эдитов: узкий контрастный с засечками и граффити
    ('Oranienbaum', [400]), ('Rubik Spray Paint', [400]),
]

# С таким User-Agent Google Fonts отдаёт один полный .ttf (с кириллицей), а не woff2-кусочки
OLD_UA = 'Wget/1.21'


def fetch(url, ua=OLD_UA):
    req = urllib.request.Request(url, headers={'User-Agent': ua})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    os.makedirs(LIC_DIR, exist_ok=True)
    failed = []
    for family, weights in FONTS:
        slug = family.replace(' ', '')
        for w in weights:
            out = os.path.join(FONTS_DIR, f'{slug}-{w}.ttf')
            if os.path.exists(out):
                continue
            try:
                css = fetch(f'https://fonts.googleapis.com/css2?family={family.replace(" ", "+")}:wght@{w}').decode()
                urls = re.findall(r'url\((https://[^)]+\.ttf)\)', css)
                if not urls:
                    raise RuntimeError('в CSS нет ссылки на .ttf')
                with open(out, 'wb') as f:
                    f.write(fetch(urls[0]))
                print(f'✓ {family} {w}')
            except Exception as e:
                failed.append(f'{family} {w}: {e}')
                print(f'✗ {family} {w}: {e}')
        lic = os.path.join(LIC_DIR, f'{slug}-OFL.txt')
        if not os.path.exists(lic):
            try:
                lic_slug = {'M PLUS Rounded 1c': 'roundedmplus1c'}.get(family, slug.lower())
                data = fetch(f'https://raw.githubusercontent.com/google/fonts/main/ofl/{lic_slug}/OFL.txt', ua='Mozilla/5.0')
                with open(lic, 'wb') as f:
                    f.write(data)
            except Exception as e:
                failed.append(f'{family} (лицензия): {e}')
    print('\nГотово.' if not failed else '\nНе скачалось:\n  ' + '\n  '.join(failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
