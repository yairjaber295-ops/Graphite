"""Постоянная подпись и растущий номер версии для Graphite.apk.

Без этого каждая сборка подписывалась случайным ключом (свой у каждого компа и у каждого запуска на GitHub),
и Android отказывался ставить новую версию поверх старой — приходилось удалять приложение вместе с проектами.
Теперь все сборки (на компе и на GitHub) подписаны одним ключом из tools/android/graphite.keystore,
а versionCode — минуты с 1 января 2026 (UTC): каждая следующая сборка новее предыдущей.

Запуск: python -I tools/android_signing.py <папка android проекта Capacitor>
Свой ключ вместо общего: переменные окружения GRAPHITE_KEYSTORE (путь), GRAPHITE_KEYSTORE_PASS, GRAPHITE_KEY_ALIAS.
"""
import os
import re
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
EPOCH_2026 = 1767225600  # 2026-01-01 00:00 UTC


def main(android_dir):
    app = os.path.join(android_dir, 'app')
    gradle = os.path.join(app, 'build.gradle')
    if not os.path.exists(gradle):
        sys.exit(f'нет {gradle}')
    store = os.environ.get('GRAPHITE_KEYSTORE') or os.path.join(HERE, 'android', 'graphite.keystore')
    password = os.environ.get('GRAPHITE_KEYSTORE_PASS') or 'graphite-app'
    alias = os.environ.get('GRAPHITE_KEY_ALIAS') or 'graphite'
    shutil.copyfile(store, os.path.join(app, 'graphite.keystore'))

    code = max(1, int((time.time() - EPOCH_2026) // 60))
    name = time.strftime('2.%Y%m%d.%H%M', time.gmtime())

    with open(gradle, encoding='utf-8') as f:
        g = f.read()
    g = re.sub(r'versionCode\s+\d+', f'versionCode {code}', g)
    g = re.sub(r'versionName\s+"[^"]*"', f'versionName "{name}"', g)
    block = ('    // graphite-signing: один ключ для всех сборок — обновление ставится поверх старой версии\n'
             '    signingConfigs {\n'
             '        debug {\n'
             "            storeFile file('graphite.keystore')\n"
             f"            storePassword '{password}'\n"
             f"            keyAlias '{alias}'\n"
             f"            keyPassword '{password}'\n"
             '        }\n'
             '    }\n')
    g = re.sub(r'    // graphite-signing:.*?\n    signingConfigs \{.*?\n    \}\n', '', g, flags=re.S)  # повторная сборка
    g, n = re.subn(r'(^android\s*\{\s*\n)', lambda m: m.group(1) + block, g, count=1, flags=re.M)
    if not n:
        sys.exit('не нашёл блок android { } в build.gradle')
    with open(gradle, 'w', encoding='utf-8') as f:
        f.write(g)
    print(f'подпись: {os.path.basename(store)} ({alias}), версия {name} ({code})')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
