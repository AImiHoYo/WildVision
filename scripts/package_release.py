"""Package an existing native build as an OS/architecture-labelled ZIP.

Packaging is not release approval. This does not install dependencies or publish.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile


def windows_arch(exe: Path) -> str:
    with exe.open("rb") as f:
        if f.read(2) != b"MZ":
            raise ValueError("Windows artifact is not a PE executable")
        f.seek(0x3C)
        offset = struct.unpack("<I", f.read(4))[0]
        f.seek(offset)
        if f.read(4) != b"PE\0\0":
            raise ValueError("Invalid PE header")
        machine = struct.unpack("<H", f.read(2))[0]
    names = {0x8664: "x64", 0xAA64: "arm64", 0x014C: "x86"}
    if machine not in names:
        raise ValueError(f"Unsupported PE machine: {machine:#x}")
    return names[machine]


def stage_public_source(root: Path, stage: Path) -> str:
    """Ship the reviewed Git revision, never local datasets or dependencies."""
    if subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=root).strip():
        raise ValueError("Commit reviewed source before packaging; tracked files are modified")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    snapshot = subprocess.check_output(["git", "archive", "--format=zip", "HEAD"], cwd=root)
    with zipfile.ZipFile(io.BytesIO(snapshot)) as z:
        for entry in z.infolist():
            path = Path(entry.filename)
            lower_parts = tuple(part.lower() for part in path.parts)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Unsafe source snapshot path")
            if path.parts[0] in {"datasets", "runtime", ".tools", ".git", "node_modules", "dist", "build"} or "node_modules" in path.parts or entry.filename.startswith("doc/release/validation/"):
                raise ValueError(f"Private/development data in source revision: {entry.filename}")
            if any(part == ".env" or part.startswith(".env.") or part in {".ssh", ".aws", ".netrc", ".npmrc", "credentials.json", "secrets.toml", "id_rsa", "id_ed25519"} for part in lower_parts) or path.suffix.lower() in {".key", ".pem", ".p12", ".pfx", ".mp4", ".mov", ".avi", ".mkv", ".mp3", ".wav", ".zip", ".pt", ".pth", ".onnx", ".safetensors", ".xlsx", ".xls"}:
                raise ValueError(f"Credential/media/runtime file in source revision: {entry.filename}")
            if entry.is_dir():
                continue
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Source snapshot must not contain symlinks")
            target = stage / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(entry))
            target.chmod((entry.external_attr >> 16) & 0o777 or 0o644)
    (stage / "SOURCE_COMMIT.txt").write_text(commit + "\n", encoding="ascii")
    return commit


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--expect-arch", required=True, choices=["x64", "arm64", "x86_64", "universal2"])
    args = parser.parse_args()
    root = args.root.resolve()
    version = json.loads((root / "ui/package.json").read_text())["version"]
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version) or version == "0.0.0":
        raise ValueError("Set a concrete release version in ui/package.json first")
    if sys.platform == "darwin":
        os_name = "macOS"
        artifact = root / "release/WildVision.app"
        info = plistlib.loads((artifact / "Contents/Info.plist").read_bytes())
        if info.get("CFBundleShortVersionString") != version:
            raise ValueError(f"App version {info.get('CFBundleShortVersionString')} differs from source {version}; rebuild with matching metadata")
        executable = artifact / "Contents/MacOS" / info["CFBundleExecutable"]
        architectures = set(subprocess.check_output(["lipo", "-archs", str(executable)], text=True).split())
        expected = {"arm64", "x86_64"} if args.expect_arch == "universal2" else {args.expect_arch}
        if architectures != expected:
            raise ValueError(f"Mach-O architectures {sorted(architectures)} differ from requested {sorted(expected)}")
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(artifact)], check=True)
    elif sys.platform == "win32":
        os_name = "Windows"
        artifact = root / "release/WildVision.exe"
        actual = windows_arch(artifact)
        if actual != args.expect_arch:
            raise ValueError(f"PE architecture {actual} differs from requested {args.expect_arch}")
    else:
        raise ValueError("Run packaging on native macOS or Windows")

    stem = f"WildVision-v{version}-{os_name}-{args.expect_arch}"
    destination = root / "release/archives"
    destination.mkdir(parents=True, exist_ok=True)
    output = destination / f"{stem}.zip"
    checksum = output.with_suffix(".zip.sha256")
    if output.exists() or checksum.exists():
        raise FileExistsError(f"Refusing to overwrite an existing candidate: {output.name}")
    # Stage only explicit release inputs, never the entire release/ directory.
    with tempfile.TemporaryDirectory(prefix="wildvision-zip-") as temp:
        stage = Path(temp) / stem
        stage.mkdir()
        commit = stage_public_source(root, stage)
        (stage / "datasets").mkdir()
        (stage / "datasets" / "README.txt").write_text(
            "导入的数据集保存在此目录。升级前请备份；不要用空目录覆盖已有数据。旧版数据可从 ~/.wildvision/datasets 复制到这里。\n", encoding="utf-8-sig")
        (stage / "runtime").mkdir()
        (stage / "runtime" / "README.txt").write_text(
            "本机自动保存和启动日志保存在此目录。备份整个软件文件夹时请一并保留。\n", encoding="utf-8-sig")
        if artifact.is_dir():
            shutil.copytree(artifact, stage / artifact.name, symlinks=True)
        else:
            shutil.copy2(artifact, stage / artifact.name)
        if os_name == "macOS":
            instructions = "完整解压并保留整个文件夹，双击其中的 WildVision.app。不要单独移动 app；数据存放在同级 datasets。若出现首次启动引导，请选择包含 App 和 BUILD.json 的这个解压文件夹；无需移动 App。\n"
        else:
            instructions = "请完整解压 ZIP，再双击 WildVision.exe；不要在压缩包预览窗口内运行。数据存放在同级 datasets。\n"
        (stage / "README.txt").write_text(
            f"WildVision {version}\n系统：{os_name}\n架构：{args.expect_arch}\n{instructions}"
            "本压缩包生成成功不代表已通过发布验收；请以下载页的支持范围和已知限制为准。\n",
            encoding="utf-8-sig",
        )
        (stage / "BUILD.json").write_text(json.dumps({
            "version": version, "os": os_name, "architecture": args.expect_arch,
            "layout": "portable", "datasets": "datasets", "source_commit": commit,
            "release_approval": "not_granted_by_packaging",
        }, indent=2) + "\n", encoding="utf-8")
        guide = root / "release/User_Guide_and_Data_Spec.md"
        if guide.is_file():
            shutil.copy2(guide, stage / guide.name)
        for required in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
            shutil.copy2(root / required, stage / required)
        archive = Path(temp) / output.name
        if os_name == "macOS":
            subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(stage), str(archive)], check=True)
        else:
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
                for item in sorted(stage.rglob("*")):
                    if item.is_file():
                        z.write(item, item.relative_to(stage.parent))
        with zipfile.ZipFile(archive) as z:
            if z.testzip() is not None:
                raise ValueError("ZIP CRC validation failed")
        hasher = hashlib.sha256()
        with archive.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                hasher.update(chunk)
        digest = hasher.hexdigest()
        shutil.copy2(archive, output)
        checksum.write_text(f"{digest}  {output.name}\n", encoding="ascii")
    print(output)
    print(checksum)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, struct.error, subprocess.CalledProcessError) as exc:
        print(f"ZIP packaging blocked: {exc}", file=sys.stderr)
        raise SystemExit(1)
