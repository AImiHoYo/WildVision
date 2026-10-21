#!/bin/bash
cd "$(dirname "$0")" || exit 1
mkdir -p "$HOME/.wildvision"
fail() {
  osascript -e 'display dialog "WildVision 暂时无法启动。请确认已安装 Python 3，或改用打包好的 WildVision.app。" buttons {"好"} default button "好" with title "WildVision"' >/dev/null 2>&1
  exit 1
}
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv || fail
fi
.venv/bin/python -m pip install -q -r requirements-desktop.txt || fail
.venv/bin/python desktop_main.py >"$HOME/.wildvision/launcher.log" 2>&1 || fail
