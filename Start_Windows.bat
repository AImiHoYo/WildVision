@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%USERPROFILE%\.wildvision" mkdir "%USERPROFILE%\.wildvision"
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 goto fail
)
".venv\Scripts\python.exe" -m pip install -q -r requirements-desktop.txt
if errorlevel 1 goto fail
".venv\Scripts\python.exe" desktop_main.py >"%USERPROFILE%\.wildvision\launcher.log" 2>&1
if errorlevel 1 goto fail
exit /b 0

:fail
mshta "javascript:var sh=new ActiveXObject('WScript.Shell'); sh.Popup('WildVision 暂时无法启动。请确认已安装 Python 3，或改用打包好的 WildVision.exe。',0,'WildVision',48);close()"
exit /b 1
