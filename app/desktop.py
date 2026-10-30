"""Graphite для Windows: своё окно (WebView2), сервер внутри, без консоли."""
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import server  # noqa: E402

def _appdata():
    base = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~')
    p = os.path.join(base, 'Graphite')
    if not os.path.exists(p) and os.path.exists(os.path.join(base, 'Narezchik')):
        return os.path.join(base, 'Narezchik')
    return p

APPDATA = _appdata()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_ID = 'Graphite.VideoEditor'  # то же значение стоит в ярлыках (tools/build_desktop.ps1)
EXE = os.path.join(ROOT, 'Graphite.exe')
ICO = os.path.join(ROOT, 'web', 'icons', 'app.ico')


# ----------------------------------------------------------------------------
#   Windows: окно — это «Graphite», а не Python (своя кнопка и иконка на панели задач, закрепление)
# ----------------------------------------------------------------------------
def set_process_app_id():
    """До создания окна: свой AppUserModelID — панель задач не склеивает окно с другими Python-программами."""
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception as e:
        print('AppUserModelID:', e)


def brand_window(title='Graphite'):
    """Окну — иконка Graphite и свойства закрепления: «Закрепить на панели задач» закрепит Graphite.exe."""
    import ctypes
    from ctypes import wintypes
    user32, shell32, ole32 = ctypes.windll.user32, ctypes.windll.shell32, ctypes.windll.ole32
    ole32.CoInitialize(None)  # вызывается из фонового потока — ему нужен свой COM
    # наше окно: по заголовку и номеру процесса
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(h, ctypes.byref(pid))
        if pid.value == os.getpid() and user32.IsWindowVisible(h):
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(h, buf, 256)
            if buf.value == title:
                found.append(h)
        return True
    user32.EnumWindows(cb, 0)
    if not found:
        return False
    hwnd = found[0]

    # иконка окна (большая — панель задач и Alt+Tab, маленькая — заголовок)
    if os.path.isfile(ICO):
        user32.LoadImageW.restype = wintypes.HANDLE
        for kind, size in ((1, 256), (0, 32)):  # ICON_BIG, ICON_SMALL
            hicon = user32.LoadImageW(None, ICO, 1, size, size, 0x10)  # IMAGE_ICON, LR_LOADFROMFILE
            if hicon:
                user32.SendMessageW(hwnd, 0x80, kind, hicon)  # WM_SETICON

    # свойства окна для панели задач (IPropertyStore через ctypes — без pywin32)
    class GUID(ctypes.Structure):
        _fields_ = [('d1', ctypes.c_uint32), ('d2', ctypes.c_uint16), ('d3', ctypes.c_uint16), ('d4', ctypes.c_ubyte * 8)]

    def guid(s):
        g = GUID()
        ole32.CLSIDFromString(ctypes.c_wchar_p(s), ctypes.byref(g))
        return g

    class PROPERTYKEY(ctypes.Structure):
        _fields_ = [('fmtid', GUID), ('pid', ctypes.c_uint32)]

    class PROPVARIANT(ctypes.Structure):  # 24 байта на x64: vt + 3 резервных + объединение
        _fields_ = [('vt', ctypes.c_ushort), ('r1', ctypes.c_ushort), ('r2', ctypes.c_ushort), ('r3', ctypes.c_ushort),
                    ('p', ctypes.c_void_p), ('p2', ctypes.c_void_p)]

    store = ctypes.c_void_p()
    iid = guid('{886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99}')  # IID_IPropertyStore
    if shell32.SHGetPropertyStoreForWindow(wintypes.HWND(hwnd), ctypes.byref(iid), ctypes.byref(store)) != 0 or not store:
        return False
    vtbl = ctypes.cast(ctypes.cast(store, ctypes.POINTER(ctypes.c_void_p))[0], ctypes.POINTER(ctypes.c_void_p))
    set_value = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(PROPERTYKEY), ctypes.POINTER(PROPVARIANT))(vtbl[6])
    release = ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtbl[2])
    fmt = guid('{9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}')  # System.AppUserModel.*
    keep = []

    def put(pid, text):
        s = ctypes.create_unicode_buffer(text)
        keep.append(s)
        v = PROPVARIANT(vt=31, p=ctypes.cast(s, ctypes.c_void_p))  # VT_LPWSTR
        return set_value(store, ctypes.byref(PROPERTYKEY(fmt, pid)), ctypes.byref(v))
    try:
        if os.path.isfile(EXE):
            put(2, f'"{EXE}"')           # RelaunchCommand — что запускать с закреплённой кнопки
            put(4, 'Graphite')           # RelaunchDisplayNameResource
            put(3, f'{EXE},0')           # RelaunchIconResource
        put(5, APP_ID)                   # ID — последним
    finally:
        release(store)
    return True


def main():
    import webview
    set_process_app_id()
    url = f'http://127.0.0.1:{server.HTTP_PORT}/'
    if server.port_busy(server.HTTP_PORT):
        # уже открыт — показываем ещё одно окно того же сервера не нужно: просто выходим
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, 'Graphite уже открыт.', 'Graphite', 0x40)
        except Exception:
            pass
        return
    servers = server.start_servers()
    window = webview.create_window('Graphite', url, width=1520, height=940, min_size=(900, 620), background_color='#0f1011',
                                   text_select=False, zoomable=False)

    closing = {'go': False}

    def on_closing():
        # Перед закрытием страница сохраняет проект. Ждать её прямо здесь нельзя: обработчик держит поток окна,
        # а evaluate_js ждёт этот же поток — окно зависало намертво. Поэтому первое закрытие отменяем,
        # сохраняем в фоне (не дольше 3 с) и закрываем окно сами.
        if closing['go']:
            return True

        def finish():
            def save():
                try:
                    window.evaluate_js("(async () => { const S = window.__S; if (S && S.project) await S.backend.saveProject(S.project); return 1; })()")
                except Exception:
                    pass
            t = threading.Thread(target=save, daemon=True)
            t.start()
            t.join(3)
            closing['go'] = True
            window.destroy()
        threading.Thread(target=finish, daemon=True).start()
        return False

    window.events.closing += on_closing

    def on_shown():
        # окно появилось — делаем его «Graphite» для панели задач (пробуем несколько раз, пока Windows его покажет)
        import time
        for _ in range(20):
            try:
                if brand_window():
                    return
            except Exception as e:
                print('панель задач:', e)
                return
            time.sleep(0.25)

    window.events.shown += lambda: threading.Thread(target=on_shown, daemon=True).start()

    if '--selftest' in sys.argv:
        # проверка движка в окне приложения: результат в файл, окно закрывается само
        out = sys.argv[sys.argv.index('--selftest') + 1]

        def check():
            import json
            import time
            time.sleep(4)
            js = """window.__selftest = null; (async () => {
              const c = document.createElement('canvas').getContext('webgl2');
              const ext = c && c.getExtension('WEBGL_debug_renderer_info');
              const enc = typeof VideoEncoder !== 'undefined' ? (await VideoEncoder.isConfigSupported({ codec: 'avc1.640033', width: 1080, height: 1920, bitrate: 12e6, framerate: 60 })).supported : false;
              window.__selftest = JSON.stringify({ ua: navigator.userAgent, webgl: ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : !!c, avc1080x1920: enc,
                backend: window.__S && window.__S.backend && window.__S.backend.kind, fonts: window.__S && window.__S.fonts.length,
                errors: [...document.querySelectorAll('.toast.err')].map(t => t.textContent) });
            })(); 1"""
            res = None
            try:
                window.evaluate_js(js)
                for _ in range(40):
                    time.sleep(0.25)
                    res = window.evaluate_js('window.__selftest')
                    if res:
                        break
            except Exception as e:
                res = json.dumps({'error': str(e)})
            with open(out, 'w', encoding='utf-8') as f:
                f.write(res or '{"error": "нет ответа"}')
            os._exit(0)
        threading.Thread(target=check, daemon=True).start()

    os.makedirs(APPDATA, exist_ok=True)
    webview.start(gui='edgechromium', private_mode=False, storage_path=os.path.join(APPDATA, 'webview'))
    for s in servers:
        threading.Thread(target=s.shutdown, daemon=True).start()


if __name__ == '__main__':
    main()
