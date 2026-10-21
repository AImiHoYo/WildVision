"""Cut annotation intervals into training clips and grounding manifests."""

from __future__ import annotations

import json
import re
import math
import os
import tempfile
import sys
import subprocess
from pathlib import Path

from qc_metrics import load_annotation
from media_tools import ffmpeg_executable, probe_media


class ClipExportError(Exception):
    pass


def nl_query(animal: str, action: str) -> str:
    return f"A {animal} is {action.lower()}."


def _token(value: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "_", value.strip(), flags=re.UNICODE)
    cleaned = cleaned.strip("_")
    return cleaned or "clip"


def clip_basename(video: str, animal: str, action: str, index: int) -> str:
    return f"{_token(Path(video).stem)}_{_token(animal)}_{_token(action)}_{index}.mp4"


def build_mmaction_list(document: dict, clip_names: list[str]) -> str:
    actions: list[str] = []
    for annotation in document.get("annotations") or []:
        action = annotation["action"]
        if action not in actions:
            actions.append(action)
    lines: list[str] = []
    for name, annotation in zip(clip_names, document.get("annotations") or []):
        lines.append(f"{name} {actions.index(annotation['action'])}")
    return ("\n".join(lines) + "\n") if lines else ""


def build_grounding_dataset(document: dict) -> dict:
    items = []
    video = document.get("video") or "untitled.mp4"
    for annotation in document.get("annotations") or []:
        items.append(
            {
                "video": video,
                "nl_query": nl_query(annotation["animal"], annotation["action"]),
                "start": annotation["start"],
                "end": annotation["end"],
            }
        )
    return {"items": items}


def cut_clip(video: Path, start: float, end: float, dest: Path) -> None:
    if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
        raise ClipExportError("区间必须为非负有限时间，结束时间晚于开始时间。")
    if not video.is_file():
        raise ClipExportError("找不到要裁剪的视频。")
    try:
        metadata = probe_media(video)
        if start >= metadata["duration"] or end > metadata["duration"] + 0.01:
            raise ClipExportError("裁剪区间超出视频时长。")
        dest.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=".clip-", suffix=".mp4", dir=dest.parent)
        os.close(fd)
        temporary = Path(name)
        try:
            kwargs = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
            proc = subprocess.run([
                ffmpeg_executable(), "-v", "error", "-y", "-ss", f"{start:.6f}",
                "-i", str(video), "-t", f"{end - start:.6f}",
                "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264",
                "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-movflags", "+faststart", str(temporary),
            ], capture_output=True, text=True, timeout=600, **kwargs)
            if proc.returncode or not temporary.stat().st_size:
                raise ClipExportError("视频裁剪失败；原文件未修改。")
            os.replace(temporary, dest)
        finally:
            temporary.unlink(missing_ok=True)
    except ClipExportError:
        raise
    except (ImportError, RuntimeError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        raise ClipExportError("视频组件不可用或文件无法解码，请检查完整安装包和输入视频。") from exc


def export_clips(
    first: Path | dict,
    second: Path | dict,
    out_dir: Path,
    *,
    fps: float = 25.0,
) -> dict:
    if isinstance(first, dict):
        document = first
        video_path = Path(second)
    elif isinstance(second, dict):
        video_path = Path(first)
        document = second
    else:
        document = load_annotation(Path(first))
        video_path = Path(second)

    clips_dir = out_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    names: list[str] = []
    clip_details: list[dict] = []
    errors: list[str] = []
    cut_count = 0
    video_name = document.get("video") or video_path.name or "untitled.mp4"
    for index, annotation in enumerate(document.get("annotations") or []):
        basename = clip_basename(video_name, annotation["animal"], annotation["action"], index)
        relative = f"clips/{basename}"
        names.append(relative)
        cut_ok = False
        err_msg = ""
        try:
            cut_clip(video_path, float(annotation["start"]), float(annotation["end"]), clips_dir / basename)
            cut_ok = True
            cut_count += 1
        except ClipExportError as exc:
            err_msg = str(exc)
            errors.append(err_msg)
        clip_details.append({"path": relative, "cut": cut_ok, "error": err_msg})
    list_path = out_dir / "mmaction2_annotations.txt"
    grounding_path = out_dir / "grounding_annotations.json"
    list_path.write_text(build_mmaction_list(document, names), encoding="utf-8")
    grounding = build_grounding_dataset(document)
    grounding_path.write_text(json.dumps(grounding, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "clips": names,
        "clip_details": clip_details,
        "cut_count": cut_count,
        "fps": fps,
        "mmaction_list": str(list_path),
        "grounding": str(grounding_path),
        "cut_errors": errors,
    }
