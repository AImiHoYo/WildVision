"""WildVision Studio desktop entry: python desktop_main.py"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path


def repo_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS"))
    return Path(__file__).resolve().parent


def _bootstrap() -> None:
    root = repo_root()
    core = root / "core"
    for folder in (root, core):
        if folder.is_dir():
            entry = str(folder)
            if entry not in sys.path:
                sys.path.insert(0, entry)


def _fail(message: str) -> int:
    log_dir = Path.home() / ".wildvision"
    if getattr(sys, "frozen", False):
        try:
            from dataset_manager import application_data_root
            log_dir = application_data_root() / "runtime" / "logs"
        except OSError:
            log_dir = None
    try:
        if log_dir is None:
            raise OSError("数据目录暂不可用")
        log_dir.mkdir(parents=True, exist_ok=True)
        (log_dir / "startup.log").write_text(message + "\n" + traceback.format_exc(), encoding="utf-8")
    except OSError:
        pass
    print(message)
    try:
        visible = message + (f"\n\n日志：{log_dir / 'startup.log'}" if log_dir else "")
        if sys.platform == "win32":
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, visible, "WildVision 启动失败", 0x10)
        elif sys.platform == "darwin":
            from AppKit import NSAlert
            alert = NSAlert.alloc().init()
            alert.setMessageText_("WildVision 启动失败")
            alert.setInformativeText_(visible)
            alert.runModal()
    except Exception:
        pass
    return 1


def main() -> int:
    _bootstrap()
    index = repo_root() / "ui" / "dist" / "index.html"
    if not index.is_file():
        return _fail("软件界面资源缺失，请重新下载并完整解压 WildVision ZIP。")
    try:
        if sys.platform == "win32" and getattr(sys, "frozen", False):
            from desktop.windows_runtime import ensure_runtime
            ensure_runtime(repo_root())
        import webview

        from desktop.api import BackendAPI

        from dataset_manager import default_datasets_root
        default_datasets_root()
        api = BackendAPI()
        webview.create_window(
            "WildVision Studio",
            url=index.resolve().as_uri(),
            js_api=api,
            width=1440,
            height=900,
            min_size=(1100, 720),
            background_color="#F8FAFC",
            text_select=True,
        )
        webview.start(gui="edgechromium" if sys.platform == "win32" else None)
    except Exception as exc:
        return _fail(f"WildVision 没有启动成功：{exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
