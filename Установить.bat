@echo off
chcp 65001 >nul
echo ========================================================
echo   Установка зависимостей Graphite...
echo ========================================================
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo [ОШИБКА] Не удалось установить библиотеки.
    echo Убедитесь, что Python 3.10+ установлен и стоит галочка "Add Python to PATH".
    pause
    exit /b %errorlevel%
)
echo.
echo ========================================================
echo   Настройка ярлыка и приложения...
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File tools\build_desktop.ps1
echo.
echo [УСПЕХ] Установка завершена!
echo Теперь вы можете запускать Graphite через:
echo  1) Ярлык Graphite в меню Пуск
echo  2) Graphite.exe в этой папке
echo  3) Запустить.bat
echo.
pause
