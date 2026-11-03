# Сборка Android-приложения Graphite (.apk).
# Запуск: правый клик → «Выполнить с помощью PowerShell» (или: powershell -ExecutionPolicy Bypass -File build_android.ps1)
# Первый раз скачает Java 21 и Android SDK (~4 ГБ) и попросит ПРИНЯТЬ ЛИЦЕНЗИИ Android SDK — это нужно сделать самому (y + Enter).
# Всё ставится в %LOCALAPPDATA%\Narezchik\android (инструменты Android не любят кириллицу в путях).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$A = Join-Path $env:LOCALAPPDATA 'Narezchik\android'
$JDK_URL = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip'
$SDK_URL = 'https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip'
New-Item -ItemType Directory -Force $A | Out-Null

if (-not (Test-Path "$A\jdk\bin\java.exe")) {
  Write-Host '⏳ Скачиваю Java 21 (Eclipse Temurin)...'
  Invoke-WebRequest -UseBasicParsing $JDK_URL -OutFile "$A\jdk.zip"
  Expand-Archive "$A\jdk.zip" -DestinationPath "$A\jdk-tmp" -Force
  Move-Item (Get-ChildItem "$A\jdk-tmp" -Directory | Select-Object -First 1).FullName "$A\jdk"
  Remove-Item "$A\jdk.zip", "$A\jdk-tmp" -Recurse -Force
}
if (-not (Test-Path "$A\sdk\cmdline-tools\latest\bin\sdkmanager.bat")) {
  Write-Host '⏳ Скачиваю Android SDK...'
  Invoke-WebRequest -UseBasicParsing $SDK_URL -OutFile "$A\cmdline.zip"
  New-Item -ItemType Directory -Force "$A\sdk\cmdline-tools" | Out-Null
  Expand-Archive "$A\cmdline.zip" -DestinationPath "$A\sdk\cmdline-tools" -Force
  Rename-Item "$A\sdk\cmdline-tools\cmdline-tools" 'latest'
  Remove-Item "$A\cmdline.zip" -Force
}
$env:JAVA_HOME = "$A\jdk"
$env:ANDROID_HOME = "$A\sdk"
$env:PATH = "$A\jdk\bin;$env:PATH"
$sdkm = "$A\sdk\cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path "$A\sdk\platforms\android-36")) {
  Write-Host ''
  Write-Host '📜 Сейчас покажутся лицензии Android SDK. Прочитай и прими каждую (y + Enter).' -ForegroundColor Yellow
  & $sdkm --licenses
  & $sdkm 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
}

# --- проект Capacitor ---
$P = "$A\project"
New-Item -ItemType Directory -Force $P | Out-Null
Push-Location $P
if (-not (Test-Path 'package.json')) {
  '{ "name": "narezchik", "version": "2.0.0", "private": true }' | Out-File -Encoding ascii package.json
}
Write-Host '⏳ Ставлю Capacitor...'
npm install --no-audit --no-fund @capacitor/core@8.5.3 @capacitor/cli@8.5.3 @capacitor/android@8.5.3 @capacitor/filesystem@8.1.4 @capacitor/share@8.0.3
$cfg = @'
{
  "appId": "ru.narezchik.app",
  "appName": "Graphite",
  "webDir": "www",
  "server": { "androidScheme": "https" },
  "android": { "allowMixedContent": true }
}
'@
[IO.File]::WriteAllText("$P\capacitor.config.json", $cfg, (New-Object System.Text.UTF8Encoding($false)))  # JSON без BOM
Write-Host '⏳ Собираю файлы приложения...'
python -I "$Root\tools\build_www.py" "$P\www"
if (-not (Test-Path 'android')) { npx cap add android }
npx cap sync android
# подключение к компу по http в домашней сети
$man = 'android\app\src\main\AndroidManifest.xml'
$x = Get-Content $man -Raw
if ($x -notmatch 'usesCleartextTraffic') { $x = $x -replace '<application', '<application android:usesCleartextTraffic="true"'; [IO.File]::WriteAllText((Resolve-Path $man), $x) }
# микрофон — запись голоса в проекте «Музыка»
$x = Get-Content $man -Raw
if ($x -notmatch 'RECORD_AUDIO') { $x = $x -replace '(<application)', "<uses-permission android:name=`"android.permission.RECORD_AUDIO`" />`n    <uses-permission android:name=`"android.permission.MODIFY_AUDIO_SETTINGS`" />`n    `$1"; [IO.File]::WriteAllText((Resolve-Path $man), $x) }
# название на телефоне (cap add записывает его один раз — обновляем сами)
$strings = 'android\app\src\main\res\values\strings.xml'
if (Test-Path $strings) {
  $sx = Get-Content $strings -Raw -Encoding UTF8
  $sx = $sx -replace '(<string name="app_name">)[^<]*', '${1}Graphite' -replace '(<string name="title_activity_main">)[^<]*', '${1}Graphite'
  [IO.File]::WriteAllText((Resolve-Path $strings), $sx, (New-Object System.Text.UTF8Encoding($false)))
}
python -I "$Root\tools\android_icons.py" "$P\android\app\src\main\res"
Push-Location android
Write-Host '⏳ Сборка APK (первый раз Gradle качает зависимости — несколько минут)...'
.\gradlew.bat assembleDebug --no-daemon
Pop-Location
Pop-Location
New-Item -ItemType Directory -Force "$Root\dist" | Out-Null
Copy-Item "$P\android\app\build\outputs\apk\debug\app-debug.apk" "$Root\dist\Graphite.apk" -Force
Write-Host ''
Write-Host "✅ Готово: $Root\dist\Graphite.apk" -ForegroundColor Green
Write-Host '   Поставить на телефон: Graphite на компе → «Телефон» → Android → отсканируй код.'
