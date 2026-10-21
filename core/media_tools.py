"""Locate the bundled FFmpeg and inspect video metadata without system tools."""
from __future__ import annotations

from pathlib import Path
import re
import subprocess
import sys


def ffmpeg_executable() -> str:
    import imageio_ffmpeg
    if getattr(sys, "frozen", False):
        binaries = Path(imageio_ffmpeg.__file__).parent / "binaries"
        matches = [p for p in binaries.glob("ffmpeg-*") if p.is_file()]
        if len(matches) != 1:
            raise RuntimeError("应用内的视频组件缺失，请重新下载完整的软件压缩包。")
        return str(matches[0])
    return imageio_ffmpeg.get_ffmpeg_exe()


def probe_media(video: Path) -> dict[str, float]:
    kwargs = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
    proc = subprocess.run([ffmpeg_executable(), "-hide_banner", "-i", str(video)],
                          capture_output=True, text=True, errors="replace", timeout=30, **kwargs)
    duration = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", proc.stderr)
    video_line = next((line for line in proc.stderr.splitlines() if "Video:" in line), "")
    rate = re.search(r"(\d+(?:\.\d+)?) fps", video_line)
    if not duration or not rate:
        raise ValueError("无法读取视频时长或帧率，请检查视频文件。")
    h, m, seconds = map(float, duration.groups())
    return {"duration": h * 3600 + m * 60 + seconds, "fps": float(rate.group(1))}
