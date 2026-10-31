# Сборка Graphite для раздачи (GitHub Releases): release\Graphite\Graphite.exe + архив Graphite-win64.zip.
# Нужно: Python 3.12 и pip install -r requirements.txt pyinstaller
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
if (-not (Test-Path 'esrgan\realesrgan-ncnn-vulkan.exe')) { python -I tools\get_esrgan.py }
python -m PyInstaller --noconfirm --clean --distpath release --workpath build tools\graphite.spec
if ($LASTEXITCODE) { Write-Host 'Сборка не удалась'; exit 1 }
# .NET не грузит DLL «из интернета» без этого (вторая защита к снятию пометки при запуске)
[IO.File]::WriteAllText("$Root\release\Graphite\Graphite.exe.config", "<?xml version=`"1.0`" encoding=`"utf-8`"?>`r`n<configuration><runtime><loadFromRemoteSources enabled=`"true`"/></runtime></configuration>`r`n")
Copy-Item 'ПРОЧТИ.txt', 'LICENSE-THIRD-PARTY.txt' 'release\Graphite\' -ErrorAction SilentlyContinue
Remove-Item 'release\Graphite-win64.zip' -ErrorAction SilentlyContinue
python -I -c "import shutil; shutil.make_archive(r'release\Graphite-win64', 'zip', r'release', 'Graphite')"
Write-Host "✅ Готово: release\Graphite\Graphite.exe и release\Graphite-win64.zip"
