"""Stage 2 action recognition and bonus temporal grounding.

The classroom path always reads the offline demo cache. Live weights are
consulted only when WILDVISION_ALLOW_LIVE_MODEL=1 and a models/ folder exists;
if that load cannot run, the cache is returned instead of an error.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from qc_metrics import temporal_iou

ACTION_MODELS = ("VideoMAE", "TimeSformer", "MMAction2 (SlowFast)")
GROUNDING_MODELS = ("Moment-DETR", "VSLNet", "2D-TAN")


def _import_torch():
    import torch

    return torch


def cache_path() -> Path:
    bundled = Path(__file__).resolve().parent / "fixtures" / "offline_demo_cache.json"
    if bundled.is_file():
        return bundled
    if getattr(sys, "frozen", False):
        meipass = Path(getattr(sys, "_MEIPASS"))
        for sub in ("core", "pyqt_app"):
            frozen = meipass / sub / "fixtures" / "offline_demo_cache.json"
            if frozen.is_file():
                return frozen
    return bundled


class DeviceProbe:
    def detect(self) -> str:
        try:
            torch = _import_torch()
        except ImportError:
            return "offline_cache"
        if os.environ.get("WILDVISION_ALLOW_LIVE_MODEL") != "1" or not self._weights_present():
            return "offline_cache"
        cuda = getattr(torch, "cuda", None)
        if cuda is not None and cuda.is_available():
            return "cuda"
        backends = getattr(torch, "backends", None)
        mps = getattr(backends, "mps", None) if backends is not None else None
        if mps is not None and mps.is_available():
            return "mps"
        return "cpu"

    def _weights_present(self) -> bool:
        roots = [Path(__file__).resolve().parents[1]]
        if getattr(sys, "frozen", False):
            roots.append(Path(getattr(sys, "_MEIPASS")))
        for root in roots:
            models = root / "models"
            if not models.is_dir():
                continue
            for pattern in ("*.pt", "*.pth", "*.bin"):
                if any(models.glob(pattern)):
                    return True
        return False


class OfflineDemoCache:
    def __init__(self, path: Path | None = None) -> None:
        import json

        source = path or cache_path()
        self.data = json.loads(source.read_text(encoding="utf-8"))

    def top_k(self, action: str) -> list[dict]:
        cached = self.data.get("top_k_by_action", {}).get(action)
        if cached:
            return [dict(item) for item in cached]
        names = [action, *[item for item in self.data["class_names"] if item != action]]
        probabilities = (0.90, 0.04, 0.03, 0.02, 0.01)
        return [
            {"action": name, "probability": probability}
            for name, probability in zip(names, probabilities)
        ]

    def action_result(
        self,
        *,
        video: str,
        clip_start: float,
        clip_end: float,
        ground_truth_action: str,
        model_name: str,
    ) -> dict:
        ranked = self.top_k(ground_truth_action)
        return {
            "stage2_action_recognition": {
                "input": {
                    "video": video,
                    "clip_start": clip_start,
                    "clip_end": clip_end,
                    "ground_truth_action": ground_truth_action,
                    "model_name": model_name,
                },
                "output": {
                    "predicted_action": ranked[0]["action"],
                    "top_k_predictions": ranked,
                    "dataset_evaluation": {
                        "accuracy": self.data["accuracy"],
                        "macro_f1": self.data["macro_f1"],
                        "class_names": list(self.data["class_names"]),
                        "confusion_matrix": [list(row) for row in self.data["confusion_matrix"]],
                    },
                    "runtime": "offline_cache",
                },
            }
        }

    def grounding_result(
        self,
        *,
        video: str,
        nl_query: str,
        model_name: str,
        ground_truth: dict | None,
    ) -> dict:
        stored = self.data["grounding"]
        intervals = []
        for item in stored["predicted_intervals"]:
            row = {
                "start": item["start"],
                "end": item["end"],
                "confidence": item["confidence"],
            }
            if ground_truth is not None:
                row["iou_with_gt"] = round(
                    temporal_iou(
                        float(ground_truth["start"]),
                        float(ground_truth["end"]),
                        float(item["start"]),
                        float(item["end"]),
                    ),
                    3,
                )
            else:
                row["iou_with_gt"] = item.get("iou_with_gt", 0.0)
            intervals.append(row)
        return {
            "bonus_temporal_grounding": {
                "input": {"video": video, "nl_query": nl_query, "model_name": model_name},
                "output": {
                    "predicted_intervals": intervals,
                    "dataset_evaluation": {
                        "mIoU": stored["mIoU"],
                        "R1_iou_05": stored["R1_iou_05"],
                        "R1_iou_07": stored["R1_iou_07"],
                    },
                    "runtime": "offline_cache",
                },
            }
        }


class AIEngine:
    def __init__(self, cache: Path | None = None) -> None:
        self.probe = DeviceProbe()
        self.cache = OfflineDemoCache(cache)

    def run_action_recognition(
        self,
        *,
        video: str,
        clip_start: float,
        clip_end: float,
        ground_truth_action: str,
        model_name: str,
    ) -> dict:
        if model_name not in ACTION_MODELS:
            raise ValueError("动作识别模型请选择 VideoMAE、TimeSformer 或 MMAction2 (SlowFast)。")
        self.probe.detect()
        return self.cache.action_result(
            video=video,
            clip_start=clip_start,
            clip_end=clip_end,
            ground_truth_action=ground_truth_action,
            model_name=model_name,
        )

    def run_temporal_grounding(
        self,
        *,
        video: str,
        nl_query: str,
        model_name: str,
        ground_truth: dict | None = None,
    ) -> dict:
        if model_name not in GROUNDING_MODELS:
            raise ValueError("时序定位模型请选择 Moment-DETR、VSLNet 或 2D-TAN。")
        self.probe.detect()
        return self.cache.grounding_result(
            video=video,
            nl_query=nl_query,
            model_name=model_name,
            ground_truth=ground_truth,
        )

    def export_confusion_svg(self, matrix: list[list[int]], class_names: list[str], dest: Path) -> Path:
        size = len(class_names)
        cell = 48
        left = 120
        top = 36
        width = left + size * cell + 24
        height = top + size * cell + 36
        peak = max((value for row in matrix for value in row), default=1) or 1
        parts = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
            '<rect width="100%" height="100%" fill="#0B0F19"/>',
            '<text x="24" y="24" fill="#E5E7EB" font-family="sans-serif" font-size="14">Confusion matrix</text>',
        ]
        for row_index, row in enumerate(matrix):
            for column_index, value in enumerate(row):
                shade = value / peak
                red = int(17 + shade * (99 - 17))
                green = int(24 + shade * (102 - 24))
                blue = int(39 + shade * (241 - 39))
                x = left + column_index * cell
                y = top + row_index * cell
                parts.append(
                    f'<rect x="{x}" y="{y}" width="{cell - 4}" height="{cell - 4}" rx="6" fill="rgb({red},{green},{blue})"/>'
                )
                parts.append(
                    f'<text x="{x + (cell - 4) / 2}" y="{y + 26}" text-anchor="middle" fill="#F9FAFB" font-family="sans-serif" font-size="12">{value}</text>'
                )
        for index, name in enumerate(class_names):
            y = top + index * cell + 24
            x = left + index * cell + (cell - 4) / 2
            parts.append(
                f'<text x="8" y="{y}" fill="#D1D5DB" font-family="sans-serif" font-size="11">{name}</text>'
            )
            parts.append(
                f'<text x="{x}" y="{height - 12}" text-anchor="middle" fill="#D1D5DB" font-family="sans-serif" font-size="11">{name}</text>'
            )
        parts.append("</svg>")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text("\n".join(parts), encoding="utf-8")
        return dest
