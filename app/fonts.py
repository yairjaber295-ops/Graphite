"""Каталог шрифтов: имена и метрики из самих .ttf (без внешних библиотек).

Метрики нужны, чтобы предпросмотр в окне и итоговый рендер через libass совпадали:
libass задаёт размер шрифта как высоту (usWinAscent + usWinDescent), а браузер — как кегль (em).
"""
import os
import struct

from paths import FONTS_DIR

# Подписи для меню: семейство → как показывать
WEIGHT_NAMES = {400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black'}


def _tables(data):
    num = struct.unpack('>H', data[4:6])[0]
    out = {}
    for i in range(num):
        tag, _, off, length = struct.unpack('>4sIII', data[12 + 16 * i: 28 + 16 * i])
        out[tag.decode('latin-1')] = (off, length)
    return out


def _names(data, off):
    fmt, count, str_off = struct.unpack('>HHH', data[off:off + 6])
    names = {}
    for i in range(count):
        pid, eid, lang, nid, length, noff = struct.unpack('>HHHHHH', data[off + 6 + 12 * i: off + 18 + 12 * i])
        raw = data[off + str_off + noff: off + str_off + noff + length]
        if pid == 3 and eid in (0, 1):
            score = 2 if lang == 0x409 else 1
            text = raw.decode('utf-16-be', errors='ignore')
        elif pid == 1 and eid == 0:
            score = 0
            text = raw.decode('mac_roman', errors='ignore')
        else:
            continue
        if nid not in names or names[nid][0] < score:
            names[nid] = (score, text)
    return {k: v[1] for k, v in names.items()}


def read_font(path):
    with open(path, 'rb') as f:
        data = f.read()
    t = _tables(data)
    upm = struct.unpack('>H', data[t['head'][0] + 18: t['head'][0] + 20])[0]
    os2 = t['OS/2'][0]
    win_asc, win_desc = struct.unpack('>HH', data[os2 + 74: os2 + 78])
    typo_asc, typo_desc = struct.unpack('>hh', data[os2 + 68: os2 + 72])
    weight = struct.unpack('>H', data[os2 + 4: os2 + 6])[0]
    hhea = t['hhea'][0]
    hh_asc, hh_desc = struct.unpack('>hh', data[hhea + 4: hhea + 8])
    if not (win_asc + win_desc):  # так же, как libass: если win-метрик нет — берём hhea
        win_asc, win_desc = hh_asc, -hh_desc
    names = _names(data, t['name'][0])
    family = names.get(16) or names.get(1) or os.path.splitext(os.path.basename(path))[0]
    return {
        'family': family,
        'full_name': names.get(4) or family,
        'weight': weight,
        'upm': upm,
        'asc': win_asc / upm,     # доля кегля над базовой линией
        'desc': win_desc / upm,   # доля кегля под базовой линией
    }


_cache = None


def catalog():
    """Список шрифтов для интерфейса и экспорта."""
    global _cache
    if _cache is not None:
        return _cache
    items = []
    for fn in sorted(os.listdir(FONTS_DIR)):
        if not fn.lower().endswith(('.ttf', '.otf')):
            continue
        fid = os.path.splitext(fn)[0]
        try:
            meta = read_font(os.path.join(FONTS_DIR, fn))
        except Exception as e:
            print(f'⚠️ шрифт {fn} пропущен: {e}')
            continue
        w = meta['weight']
        label = meta['family'] if w == 400 else f'{meta["family"]} {WEIGHT_NAMES.get(w, w)}'
        items.append(dict(meta, id=fid, file=fn, label=label))
    items.sort(key=lambda x: (x['family'].lower(), x['weight']))
    _cache = items
    return items


def by_id(fid):
    for f in catalog():
        if f['id'] == fid:
            return f
    return None
