"""Provision the bundled offline WebView2 runtime before creating the window."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess


def runtime_installed() -> bool:
    import winreg
    key = r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for view in (winreg.KEY_WOW64_32KEY, winreg.KEY_WOW64_64KEY):
            try:
                with winreg.OpenKey(hive, key, 0, winreg.KEY_READ | view) as handle:
                    version, _ = winreg.QueryValueEx(handle, "pv")
                    parts = str(version).split(".")
                    if len(parts) == 4 and all(p.isdigit() for p in parts) and any(int(p) for p in parts):
                        return True
            except OSError:
                continue
    return False


def ensure_runtime(resource_root: Path) -> None:
    if runtime_installed():
        return
    import ctypes
    folder = resource_root / "redist"
    installer = folder / "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
    metadata = json.loads((folder / "webview2.json").read_text(encoding="utf-8-sig"))
    hasher = hashlib.sha256()
    with installer.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    if hasher.hexdigest() != metadata["sha256"]:
        raise RuntimeError("随包界面组件校验失败，请重新下载完整 ZIP。")
    answer = ctypes.windll.user32.MessageBoxW(
        None, "首次启动需要配置随软件附带的 Microsoft 界面组件。无需联网或另行下载。是否继续？",
        "WildVision 首次启动", 0x24,
    )
    if answer != 6:
        raise RuntimeError("已取消首次启动配置。再次打开应用即可继续。")
    result = subprocess.run([str(installer), "/silent", "/install"], timeout=600,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if not runtime_installed():
        raise RuntimeError(f"界面组件配置未完成（代码 {result.returncode}）。请重启后再试，或将启动日志交给维护者。")
