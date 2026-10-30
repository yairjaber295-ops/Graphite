@echo off
start "" pythonw app\desktop.py
if %errorlevel% neq 0 (
    python app\desktop.py
)
