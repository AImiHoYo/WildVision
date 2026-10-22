"""Build a windowed WildVision desktop app with PyInstaller and sync to dist/ and release/."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import json
import plistlib
from pathlib import Path


def main() -> int:
    # Windows CI pipes may default to cp1252 even when the console is UTF-8.
    # Use the same encoding for this script and Python child processes.
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    root = Path(__file__).resolve().parent
    version = json.loads((root / "ui/package.json").read_text())["version"]
    build_assets = root / "build" / "release-assets"
    build_assets.mkdir(parents=True, exist_ok=True)
    macos_icon = root / "assets" / "branding" / "WildVision.icns"
    if sys.platform == "darwin" and not macos_icon.is_file():
        print(f"缺少应用图标：{macos_icon}")
        return 1
    ui_dir = root / "ui"
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    node_tools = root / ".tools" / "node-v22.20.0-darwin-arm64" / "bin"
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYINSTALLER_CONFIG_DIR"] = str(root / "build" / "pyinstaller-cache")
    if node_tools.is_dir():
        env["PATH"] = f"{node_tools}{os.pathsep}{env.get('PATH', '')}"

    if (ui_dir / "package.json").is_file() and shutil.which(npm_cmd, path=env.get("PATH")):
        print("正在构建前端资源 (ui/dist)...")
        ui_build = subprocess.run([npm_cmd, "run", "build"], cwd=ui_dir, env=env)
        if ui_build.returncode != 0:
            print("前端构建失败，已停止打包。")
            return ui_build.returncode

    index = root / "ui" / "dist" / "index.html"
    if not index.is_file():
        print("界面还没构建。请先在 ui 目录执行 npm run build。")
        return 1
    tests = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", ".", "-p", "test_*.py"],
        cwd=root / "core",
        env=env,
    )
    if tests.returncode != 0:
        print("单元测试未通过，已停止打包。")
        return tests.returncode
    separator = os.pathsep
    cache = root / "core" / "fixtures" / "offline_demo_cache.json"
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--windowed",
        "--name",
        "WildVision",
        "--paths",
        str(root),
        "--paths",
        str(root / "core"),
        "--hidden-import",
        "labels",
        "--hidden-import",
        "dataset_manager",
        "--hidden-import",
        "eval_metrics",
        "--hidden-import",
        "qc_metrics",
        "--hidden-import",
        "clip_exporter",
        "--hidden-import",
        "ai_engine",
        "--hidden-import",
        "desktop",
        "--hidden-import",
        "desktop.api",
        "--hidden-import",
        "desktop.media_server",
        "--collect-all",
        "webview",
        "--collect-all",
        "imageio_ffmpeg",
        "--add-data",
        f"{root / 'ui' / 'dist'}{separator}ui/dist",
        "--add-data",
        f"{root / 'examples'}{separator}examples",
        "--add-data",
        f"{cache}{separator}core/fixtures",
    ]
    # Generate a synthetic demo; never redistribute an unreviewed local video.
    import imageio_ffmpeg
    import importlib.metadata
    notices = build_assets / "third-party-licenses"
    if notices.exists():
        shutil.rmtree(notices)
    notices.mkdir()
    def is_notice(path: Path) -> bool:
        return (path.name.lower().startswith(("license", "licence", "copying", "copyright", "notice"))
                and path.suffix.lower() in ("", ".txt", ".md", ".rst"))
    inventory = []
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name", "unknown")
        inventory.append({"name": name, "version": distribution.version})
        for item in distribution.files or []:
            if is_notice(Path(str(item))):
                origin = Path(distribution.locate_file(item))
                if origin.is_file():
                    target = notices / name / Path(str(item)).name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(origin, target)
    (notices / "build-python-packages.json").write_text(json.dumps(inventory, indent=2), encoding="utf-8")
    for option, filename in (("-version", "ffmpeg-build.txt"), ("-L", "ffmpeg-license.txt")):
        metadata = subprocess.check_output([imageio_ffmpeg.get_ffmpeg_exe(), option], stderr=subprocess.STDOUT)
        (notices / filename).write_bytes(metadata)
    # Preserve frontend license notices from the installed locked dependencies.
    modules = root / "ui/node_modules"
    for origin in modules.rglob("*"):
        if origin.is_file() and is_notice(origin):
            target = notices / "frontend" / origin.relative_to(modules)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(origin, target)
    command.extend(["--add-data", f"{notices}{separator}licenses/third-party"])
    public = build_assets / "public"
    public.mkdir(exist_ok=True)
    subprocess.run([
        imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=4",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=4",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        str(public / "sample_ak.mp4"),
    ], check=True)
    command.extend(["--add-data", f"{public}{separator}public"])
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        if not (root / name).is_file():
            raise FileNotFoundError(f"发布所需文件缺失：{name}")
        command.extend(["--add-data", f"{root / name}{separator}licenses"])
    if sys.platform == "darwin":
        command.extend(["--icon", str(macos_icon)])
    if sys.platform == "win32":
        command.append("--onefile")
        command.extend(["--icon", str(root / "assets/branding/WildVision.ico")])
        redist = root / ".tools" / "redist"
        if not (redist / "webview2.json").is_file() or not (redist / "MicrosoftEdgeWebView2RuntimeInstallerX64.exe").is_file():
            raise FileNotFoundError("请先在构建机运行 scripts/fetch_windows_runtime.ps1，准备离线界面组件。")
        command.extend(["--add-data", f"{redist}{separator}redist"])
        parts = tuple(int(p) for p in version.split("-")[0].split(".")) + (0,)
        version_file = build_assets / "windows-version.txt"
        version_file.write_text(
            "VSVersionInfo(ffi=FixedFileInfo(filevers=" + repr(parts) + ", prodvers=" + repr(parts) +
            ", mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0,0)), "
            "kids=[StringFileInfo([StringTable('040904B0', [StringStruct('ProductName','WildVision'), "
            "StringStruct('FileVersion'," + repr(version) + "), StringStruct('ProductVersion'," + repr(version) +
            ")])]), VarFileInfo([VarStruct('Translation',[1033,1200])])])", encoding="utf-8",
        )
        command.extend(["--version-file", str(version_file)])
    command.append(str(root / "desktop_main.py"))
    built = subprocess.run(command, cwd=root, env=env)
    if built.returncode != 0:
        print("打包没有完成。")
        return built.returncode
    release_dir = root / "release"
    release_dir.mkdir(parents=True, exist_ok=True)
    if sys.platform == "darwin":
        app_src = root / "dist" / "WildVision.app"
        app_dst = release_dir / "WildVision.app"
        if app_src.is_dir():
            plist_path = app_src / "Contents" / "Info.plist"
            info = plistlib.loads(plist_path.read_bytes())
            info["CFBundleShortVersionString"] = version
            info["CFBundleVersion"] = version.split("-")[0]
            plist_path.write_bytes(plistlib.dumps(info))
            # Metadata belongs to this new build; sign again after finalizing it.
            subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(app_src)], check=True)
            if app_dst.exists():
                shutil.rmtree(app_dst)
            shutil.copytree(app_src, app_dst, symlinks=True)
        print("已生成 dist/WildVision.app、dist/WildVision 并同步至 release/WildVision.app")
    else:
        exe_src = root / "dist" / "WildVision.exe"
        exe_dst = release_dir / "WildVision.exe"
        if exe_src.is_file():
            shutil.copy2(exe_src, exe_dst)
        print("已生成 dist/WildVision.exe 并同步至 release/WildVision.exe")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
