"""ИИ по API для Graphite: подбор футажей под описание видео, описание роликов по кадрам, генерация фонов.

Поддерживается OpenAI (и всё, что на него похоже: OpenRouter, DeepSeek, локальные серверы — через свой адрес)
и Anthropic. Ключ каждый вставляет сам в Настройки → ИИ; хранится в settings.json на этом компе.
Библиотек не нужно: запросы идут обычным urllib.
"""
import base64
import json
import os
import re
import urllib.error
import urllib.request

from paths import ROOT, read_json, write_json

SETTINGS = os.path.join(ROOT, 'settings.json')

PROVIDERS = {
    'openai': {'label': 'OpenAI', 'base': 'https://api.openai.com/v1', 'model': 'gpt-4o', 'image_model': 'gpt-image-1'},
    'anthropic': {'label': 'Anthropic (Claude)', 'base': 'https://api.anthropic.com/v1', 'model': 'claude-sonnet-5-5', 'image_model': ''},
    'custom': {'label': 'Другой (совместим с OpenAI)', 'base': '', 'model': '', 'image_model': ''},
}

# Переходы, которые ИИ может выбирать (названия — из engine/effects.js)
TRANSITIONS = {'none': 0.0, 'fade': 0.5, 'softzoom': 0.5, 'black': 0.6, 'white': 0.5, 'flash': 0.3,
               'slideleft': 0.4, 'slideright': 0.4, 'whipleft': 0.3, 'whipright': 0.3, 'zoomin': 0.4,
               'flashburst': 0.3, 'zoomburst': 0.3, 'swishleft': 0.3, 'swishright': 0.3, 'shakecut': 0.3}


class AIError(RuntimeError):
    pass


# ----------------------------------------------------------------------------
#   Настройки
# ----------------------------------------------------------------------------

def config():
    c = (read_json(SETTINGS, {}) or {}).get('ai') or {}
    c.setdefault('provider', 'openai')
    c.setdefault('api_key', '')
    c.setdefault('base_url', '')
    c.setdefault('model', '')
    c['image'] = {'api_key': '', 'base_url': '', 'model': '', 'size': '', **(c.get('image') or {})}
    return c


def public_config():
    """Настройки для окна: сам ключ не отдаём, только «есть/нет» и последние символы."""
    c = config()

    def mask(k):
        return {'set': bool(k), 'tail': k[-4:] if len(k) >= 8 else ''}
    return {'provider': c['provider'], 'base_url': c['base_url'], 'model': c['model'], 'key': mask(c['api_key']),
            'image': {'base_url': c['image']['base_url'], 'model': c['image']['model'], 'size': c['image']['size'],
                      'key': mask(c['image']['api_key'])},
            'providers': {k: {kk: vv for kk, vv in v.items()} for k, v in PROVIDERS.items()},
            'ready': bool(c['api_key']), 'image_ready': image_ready(c)}


def save_config(b):
    """Пустой ключ в запросе = «не менять»; ключ можно стереть флагом clear_key / clear_image_key."""
    s = read_json(SETTINGS, {}) or {}
    c = s.get('ai') or {}
    c.setdefault('image', {})
    if b.get('provider') in PROVIDERS:
        c['provider'] = b['provider']
    for k in ('base_url', 'model'):
        if k in b:
            c[k] = str(b[k] or '').strip()
    if b.get('api_key'):
        c['api_key'] = str(b['api_key']).strip()
    if b.get('clear_key'):
        c['api_key'] = ''
    img = b.get('image') or {}
    for k in ('base_url', 'model', 'size'):
        if k in img:
            c['image'][k] = str(img[k] or '').strip()
    if img.get('api_key'):
        c['image']['api_key'] = str(img['api_key']).strip()
    if b.get('clear_image_key'):
        c['image']['api_key'] = ''
    s['ai'] = c
    write_json(SETTINGS, s)
    return public_config()


def _image_cfg(c=None):
    """Куда слать запросы на картинки. Свой ключ для картинок, иначе — ключ OpenAI-совместимого сервиса."""
    c = c or config()
    img = c['image']
    if img['api_key']:
        return {'key': img['api_key'], 'base': (img['base_url'] or PROVIDERS['openai']['base']).rstrip('/'),
                'model': img['model'] or PROVIDERS['openai']['image_model'], 'size': img['size']}
    if c['provider'] in ('openai', 'custom') and c['api_key']:
        base = (c['base_url'] or PROVIDERS[c['provider']]['base']).rstrip('/')
        return {'key': c['api_key'], 'base': base, 'model': img['model'] or PROVIDERS['openai']['image_model'], 'size': img['size']}
    return None


def image_ready(c=None):
    return _image_cfg(c) is not None


# ----------------------------------------------------------------------------
#   Запросы
# ----------------------------------------------------------------------------

def _post(url, headers, body, timeout=180):
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), method='POST',
                                 headers={'Content-Type': 'application/json', 'User-Agent': 'Graphite', **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        try:
            j = json.loads(raw)
            msg = (j.get('error') or {}).get('message') if isinstance(j.get('error'), dict) else (j.get('error') or j.get('message'))
        except ValueError:
            msg = None
        hint = {401: ' — проверь ключ', 403: ' — нет доступа к этой модели или ключу', 404: ' — проверь адрес и название модели',
                429: ' — лимит запросов или кончились деньги на счёте'}.get(e.code, '')
        raise AIError(f'ИИ ответил {e.code}{hint}: {(msg or raw)[:300]}') from None
    except urllib.error.URLError as e:
        raise AIError(f'нет связи с ИИ ({e.reason})') from None
    except TimeoutError:
        raise AIError('ИИ не ответил вовремя') from None


def chat(system, user, images=(), max_tokens=4096):
    """Один запрос к текстовой модели (можно с картинками-JPEG). Возвращает текст ответа."""
    c = config()
    if not c['api_key']:
        raise AIError('Не указан ключ ИИ: Настройки → ИИ')
    prov = PROVIDERS.get(c['provider'], PROVIDERS['custom'])
    base = (c['base_url'] or prov['base']).rstrip('/')
    model = c['model'] or prov['model']
    if not base or not model:
        raise AIError('Укажи адрес и модель ИИ: Настройки → ИИ')
    if c['provider'] == 'anthropic':
        content = [{'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': base64.b64encode(i).decode()}}
                   for i in images] + [{'type': 'text', 'text': user}]
        j = _post(f'{base}/messages', {'x-api-key': c['api_key'], 'anthropic-version': '2023-06-01'},
                  {'model': model, 'max_tokens': max_tokens, 'system': system, 'messages': [{'role': 'user', 'content': content}]})
        text = ''.join(b.get('text', '') for b in j.get('content') or [] if b.get('type') == 'text')
    else:
        content = [{'type': 'text', 'text': user}] + [
            {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + base64.b64encode(i).decode()}} for i in images]
        j = _post(f'{base}/chat/completions', {'Authorization': 'Bearer ' + c['api_key']},
                  {'model': model, 'messages': [{'role': 'system', 'content': system},
                                                {'role': 'user', 'content': content if images else user}]})
        text = (((j.get('choices') or [{}])[0]).get('message') or {}).get('content') or ''
    if not text.strip():
        raise AIError('ИИ вернул пустой ответ')
    return text


def extract_json(text):
    """JSON из ответа модели (она может обернуть его в ```json … ``` или добавить пояснение)."""
    m = re.search(r'```(?:json)?\s*(.*?)```', text, re.S)
    if m:
        text = m.group(1)
    a, b = text.find('{'), text.rfind('}')
    if a < 0 or b <= a:
        raise AIError('ИИ ответил не по формату — попробуй ещё раз')
    try:
        return json.loads(text[a:b + 1])
    except ValueError:
        raise AIError('ИИ ответил не по формату — попробуй ещё раз') from None


def generate_image(prompt, vertical=True):
    """Картинка по описанию (PNG/JPEG-байты). Нужен OpenAI-совместимый сервис картинок."""
    cfg = _image_cfg()
    if not cfg:
        raise AIError('Для генерации фонов нужен ключ картинок (OpenAI или совместимый): Настройки → ИИ')
    size = cfg['size']
    if not size:
        dalle3 = 'dall-e-3' in cfg['model']
        size = ('1024x1792' if dalle3 else '1024x1536') if vertical else ('1792x1024' if dalle3 else '1536x1024')
    body = {'model': cfg['model'], 'prompt': prompt, 'n': 1, 'size': size}
    if 'dall-e' in cfg['model']:
        body['response_format'] = 'b64_json'
    j = _post(f'{cfg["base"]}/images/generations', {'Authorization': 'Bearer ' + cfg['key']}, body, timeout=300)
    item = (j.get('data') or [{}])[0]
    if item.get('b64_json'):
        return base64.b64decode(item['b64_json'])
    if item.get('url'):
        try:
            with urllib.request.urlopen(item['url'], timeout=120) as r:
                return r.read()
        except Exception as e:
            raise AIError(f'не удалось скачать картинку: {e}') from None
    raise AIError('сервис картинок не вернул изображение')


# ----------------------------------------------------------------------------
#   Описание ролика по кадрам
# ----------------------------------------------------------------------------

DESCRIBE_SYSTEM = (
    'Ты помогаешь монтажёру вести каталог футажей. По кадрам ролика напиши, что в нём происходит, так, чтобы потом '
    'по этому описанию можно было быстро подобрать ролик под тему. Только то, что видно. Не выдумывай имён.\n'
    'Ответ — только JSON: {"title": "короткое название до 6 слов", "description": "1–2 предложения: кто/что в кадре, '
    'действие, настроение, обстановка", "tags": ["5–10 коротких тегов"]}')


def describe(frames, hint=''):
    text = chat(DESCRIBE_SYSTEM, 'Кадры ролика по порядку.' + (f' Подсказка от автора: {hint}' if hint else ''), frames, max_tokens=600)
    j = extract_json(text)
    return {'title': str(j.get('title') or '')[:120], 'description': str(j.get('description') or '')[:1500], 'tags': j.get('tags') or []}


# ----------------------------------------------------------------------------
#   Сценарий видео из футажей
# ----------------------------------------------------------------------------

PLAN_SYSTEM = (
    'Ты — монтажёр. Из каталога футажей нужно собрать видео по заданию автора. Подбирай ролики по описаниям и тегам, '
    'а не по названиям файлов: смотри, что в ролике происходит.\n\n'
    'ПРАВИЛА\n'
    '• Используй только id из каталога. Не выдумывай ролики; если подходящего нет — возьми ближайший по смыслу и скажи об этом в notes.\n'
    '• Для видео: "in" и "out" — секунды внутри ролика (out не больше его длины, кусок не короче 1 с). Если ролик короткий, бери целиком.\n'
    '• Для картинки (фон): "in" = 0, "out" = сколько секунд показывать (2–6).\n'
    '• Сумма длин сцен — около {target} с (допустимо от {lo} до {hi} с).\n'
    '• Один и тот же ролик подряд не повторяй; в целом избегай повторов, если хватает других.\n'
    '• "text" — короткая подпись на экране (до 40 символов) только если задание этого требует или она явно к месту; иначе пустая строка.\n'
    '• "transition" — переход перед этой сценой (у первой — "none"). Допустимые: {transitions}. '
    'Для быстрых динамичных эдитов — flashburst, zoomburst, swishleft, swishright, shakecut, whipleft; для спокойных — fade, softzoom, black.\n'
    '{generate}'
    '\nОТВЕТ — ТОЛЬКО JSON, без пояснений:\n'
    '{{"title": "название видео", "scenes": [{{"clip_id": "id", "in": 0, "out": 4, "text": "", "transition": "none"}}], "notes": "кратко, что взято и чего не хватило"}}')

PLAN_GENERATE = (
    '• Можно добавить до {n} сцен с НОВЫМ фоном, если в каталоге нет подходящего: вместо clip_id укажи '
    '"new_background": "подробное описание картинки для генерации (без текста и людей с узнаваемыми лицами, вертикальный кадр)" '
    'и "out": секунды показа (2–6). Используй это экономно, только когда без фона не обойтись.\n')


def plan_video(brief, entries, target=30.0, allow_new=0):
    """Спрашивает ИИ, какие футажи и в каком порядке взять. Возвращает {title, scenes, notes} как ответила модель."""
    from footage import catalog_line
    lo, hi = max(5, round(target * 0.75)), round(target * 1.3)
    system = PLAN_SYSTEM.format(target=round(target), lo=lo, hi=hi, transitions=', '.join(TRANSITIONS),
                                generate=PLAN_GENERATE.format(n=allow_new) if allow_new else '')
    cat = '\n'.join(catalog_line(e) for e in entries)
    user = f'ЗАДАНИЕ:\n{brief.strip()}\n\nКАТАЛОГ (id | тип | вид | название | теги | описание):\n{cat}'
    return extract_json(chat(system, user, max_tokens=4096))


def clean_plan(plan, by_id, target=30.0, allow_new=0):
    """Проверка ответа ИИ: неизвестные id отбрасываем, времена — в пределы ролика. Возвращает (сцены, предупреждения)."""
    scenes, warns, new_left = [], [], max(0, allow_new)
    for i, s in enumerate(plan.get('scenes') or []):
        if not isinstance(s, dict):
            continue
        tr = s.get('transition') if s.get('transition') in TRANSITIONS else 'none'
        text = str(s.get('text') or '').strip()[:60]
        if s.get('new_background'):
            if new_left <= 0:
                warns.append('Лишний новый фон пропущен')
                continue
            new_left -= 1
            try:
                dur = max(1.5, min(8.0, float(s.get('out') or 4)))
            except (TypeError, ValueError):
                dur = 4.0
            scenes.append({'new_background': str(s['new_background'])[:800], 'in': 0.0, 'out': dur, 'text': text, 'transition': tr})
            continue
        e = by_id.get(str(s.get('clip_id')))
        if not e:
            warns.append(f'ИИ назвал несуществующий футаж «{s.get("clip_id")}» — сцена пропущена')
            continue
        try:
            a, b = float(s.get('in') or 0), float(s.get('out') or 0)
        except (TypeError, ValueError):
            a, b = 0.0, 0.0
        if e['kind'] == 'image':
            a, b = 0.0, max(1.5, min(10.0, b or 4.0))
        else:
            d = float(e.get('duration') or 0)
            a = max(0.0, min(a, max(0.0, d - 0.5)))
            b = d if b <= a + 0.3 else min(b, d)
            if b - a < 0.5:
                a, b = 0.0, d
        scenes.append({'entry': e, 'in': round(a, 3), 'out': round(b, 3), 'text': text, 'transition': tr})
    if scenes:
        scenes[0]['transition'] = 'none'
    return scenes, warns
