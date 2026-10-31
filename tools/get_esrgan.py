"""Скачивает нейросеть для «Улучшить качество»: официальный realesrgan-ncnn-vulkan (xinntao/Real-ESRGAN v0.2.5.0) → esrgan/."""
import io
import os
import urllib.request
import zipfile

URL = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip'
KEEP = ('realesrgan-ncnn-vulkan.exe', 'vcomp140.dll', 'models/realesrgan-x4plus.', 'models/realesr-animevideov3-')
DST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'esrgan')

print('Скачиваю Real-ESRGAN (~45 МБ)…')
data = urllib.request.urlopen(URL, timeout=120).read()
os.makedirs(os.path.join(DST, 'models'), exist_ok=True)
with zipfile.ZipFile(io.BytesIO(data)) as z:
    for name in z.namelist():
        if any(name.startswith(k) for k in KEEP):
            with open(os.path.join(DST, *name.split('/')), 'wb') as f:
                f.write(z.read(name))
print('Готово:', DST)
