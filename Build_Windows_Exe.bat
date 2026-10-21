@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/3] 正在准备 Python 打包环境...
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 (
    python -m venv .venv
  )
)
".venv\Scripts\python.exe" -m pip install --upgrade pip -q
".venv\Scripts\python.exe" -m pip install -r requirements-desktop.txt pyinstaller -q

echo [2/3] 正在运行单元测试与 PyInstaller 打包 WildVision.exe...
".venv\Scripts\python.exe" build_desktop_app.py
if errorlevel 1 (
  echo 打包失败，请检查上方输出信息。
  pause
  exit /b 1
)

echo [3/3] 打包完成！已生成：
echo   - dist\WildVision.exe
echo   - release\WildVision.exe
pause
