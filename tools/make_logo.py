"""Логотип Graphite: графитовый кристалл-куб (три грани) с оранжевой гранью-срезом.
Делает web/icons/logo.svg и все иконки (PNG для браузера/телефона, app.ico для exe)."""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'web', 'icons')

# грани: (точки по индексам вершин, цвет сверху, цвет снизу)
#   вершины шестигранника: 0 верх, 1 справа-вверху, 2 справа-внизу, 3 низ, 4 слева-внизу, 5 слева-вверху, 6 центр
#   шесть треугольных граней — как огранённый кристалл; оранжевый клин идёт с верха на правую грань
FACES = [
    ((5, 0, 6), '#a3a6ad', '#6d7077'),   # верх слева — светлый графит
    ((0, 1, 6), '#ffb061', '#ff7a1a'),   # верх справа — оранжевый
    ((6, 1, 2), '#e8640f', '#9c3c08'),   # клин уходит вниз — тёмно-оранжевый
    ((6, 2, 3), '#2a2c30', '#17181b'),   # справа внизу — самая тёмная
    ((4, 6, 3), '#3d3f44', '#26282c'),   # слева внизу
    ((5, 6, 4), '#5c5e64', '#3b3d42'),   # слева вверху
]
BG = '#121315'


def verts(cx, cy, r):
    pts = [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in (-90, -30, 30, 90, 150, 210)]
    return pts + [(cx, cy)]


def hex2rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def raster(size, pad=0.17, bg=True, radius=0.22):
    """Иконка size×size: тёмная скруглённая подложка + кристалл. Рисуем в 4× и уменьшаем — края гладкие."""
    S = size * 4
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    if bg:
        m = Image.new('L', (S, S), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * radius), fill=255)
        img.paste(Image.new('RGBA', (S, S), hex2rgb(BG) + (255,)), (0, 0), m)
    r = S * (0.5 - pad) / math.cos(math.radians(30)) * 0.98
    v = verts(S / 2, S / 2 + S * 0.005, r)
    for idx, c0, c1 in FACES:
        poly = [v[i] for i in idx]
        ys = [p[1] for p in poly]
        y0, y1 = min(ys), max(ys)
        grad = Image.new('RGBA', (S, S))
        a, b = hex2rgb(c0), hex2rgb(c1)
        gd = ImageDraw.Draw(grad)
        for y in range(int(y0), int(y1) + 2):
            t = min(1, max(0, (y - y0) / max(1, y1 - y0)))
            gd.line([(0, y), (S, y)], fill=tuple(round(a[k] + (b[k] - a[k]) * t) for k in range(3)) + (255,))
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).polygon(poly, fill=255)
        img.paste(grad, (0, 0), mask)
    # тонкий блик по верхним рёбрам — отдельным слоем, чтобы прозрачность смешалась
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(hl)
    w = max(2, S // 170)
    d.line([v[5], v[0], v[1]], fill=(255, 255, 255, 90), width=w, joint='curve')
    d.line([v[6], v[0]], fill=(255, 255, 255, 45), width=w)
    img = Image.alpha_composite(img, hl)
    return img.resize((size, size), Image.LANCZOS)


def svg():
    v = verts(50, 50.4, 31.5)
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>']
    for i, (_, c0, c1) in enumerate(FACES):
        out.append(f'<linearGradient id="g{i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{c0}"/><stop offset="1" stop-color="{c1}"/></linearGradient>')
    out.append('</defs>')
    for i, (idx, _, _) in enumerate(FACES):
        pts = ' '.join(f'{v[k][0]:.2f},{v[k][1]:.2f}' for k in idx)
        out.append(f'<polygon points="{pts}" fill="url(#g{i})"/>')
    out.append(f'<polyline points="{v[5][0]:.2f},{v[5][1]:.2f} {v[0][0]:.2f},{v[0][1]:.2f} {v[1][0]:.2f},{v[1][1]:.2f}" fill="none" '
               f'stroke="#fff" stroke-opacity=".28" stroke-width="1" stroke-linejoin="round"/>')
    out.append('</svg>')
    return '\n'.join(out)


if __name__ == '__main__':
    os.makedirs(ICONS, exist_ok=True)
    open(os.path.join(ICONS, 'logo.svg'), 'w', encoding='utf-8').write(svg())
    for s in (180, 192, 512):
        raster(s).save(os.path.join(ICONS, f'icon-{s}.png'))
    # адаптивная (Android/PWA): фон на весь квадрат, кристалл в безопасной зоне
    raster(512, pad=0.27, radius=0).save(os.path.join(ICONS, 'icon-maskable-512.png'))
    big = raster(256)
    big.save(os.path.join(ICONS, 'app.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    raster(1024).save(os.path.join(ROOT, 'dist', 'Graphite-logo.png'))
    print('логотип и иконки готовы')
