"""Dual-annotator temporal robustness metrics for Stage 1."""

from __future__ import annotations

import statistics
from pathlib import Path

from labels import frame_index, parse_label_input, round_seconds

TIOU_THRESHOLD = 0.70
HIGH_QUALITY = "HIGH_QUALITY_ROBUST (Meets 18-25 pt Rubric Tier)"


def temporal_iou(start_a: float, end_a: float, start_b: float, end_b: float) -> float:
    intersection = max(0.0, min(end_a, end_b) - max(start_a, start_b))
    union = max(end_a, end_b) - min(start_a, start_b)
    if union <= 0:
        return 0.0
    return intersection / union


def _metric(value: float) -> float:
    if value != value or value in (float("inf"), float("-inf")):
        return 0.0
    if abs(value - 1.0) < 1e-9:
        return 1.0
    if abs(value) < 1e-12:
        return 0.0
    return round(float(value), 3)


def _std(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    return _metric(statistics.pstdev(values))


def _mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return _metric(statistics.fmean(values))


def _side(annotation: dict | None) -> dict | None:
    if annotation is None:
        return None
    return {
        "start": annotation["start"],
        "end": annotation["end"],
        "start_frame": int(annotation["start_frame"]),
        "end_frame": int(annotation["end_frame"]),
    }


def _comparison(label: tuple[str, str], left: dict | None, right: dict | None, score: float) -> dict:
    rounded = _metric(score)
    row = {
        "label": [label[0], label[1]],
        "annotator_a": _side(left),
        "annotator_b": _side(right),
        "temporal_iou": rounded,
        "status": "VERIFIED" if rounded >= TIOU_THRESHOLD else "NEEDS_ARBITRATION",
    }
    if row["status"] != "VERIFIED":
        row["reason"] = f"tIoU ({rounded:.3f}) < threshold (0.70)"
    return row


def match_segments(a: list[dict], b: list[dict]) -> list[dict]:
    def key(segment: dict) -> tuple[str, str]:
        return segment["animal"], segment["action"]

    groups = sorted({key(item) for item in a} | {key(item) for item in b})
    matched: list[dict] = []
    for animal, action in groups:
        left = [item for item in a if key(item) == (animal, action)]
        right = [item for item in b if key(item) == (animal, action)]
        pairs: list[tuple[float, int, int]] = []
        for i, segment_a in enumerate(left):
            for j, segment_b in enumerate(right):
                score = temporal_iou(segment_a["start"], segment_a["end"], segment_b["start"], segment_b["end"])
                pairs.append((score, i, j))
        pairs.sort(key=lambda item: item[0], reverse=True)
        used_left: set[int] = set()
        used_right: set[int] = set()
        for score, i, j in pairs:
            if i in used_left or j in used_right:
                continue
            used_left.add(i)
            used_right.add(j)
            matched.append(_comparison((animal, action), left[i], right[j], score))
        for i, segment_a in enumerate(left):
            if i not in used_left:
                matched.append(_comparison((animal, action), segment_a, None, 0.0))
        for j, segment_b in enumerate(right):
            if j not in used_right:
                matched.append(_comparison((animal, action), None, segment_b, 0.0))
    return matched


def cohens_kappa(labels_a: list[str], labels_b: list[str]) -> float:
    if len(labels_a) != len(labels_b):
        return 0.0
    if not labels_a:
        return 1.0
    from collections import Counter

    count = len(labels_a)
    observed = sum(left == right for left, right in zip(labels_a, labels_b)) / count
    counts_a = Counter(labels_a)
    counts_b = Counter(labels_b)
    classes = counts_a.keys() | counts_b.keys()
    expected = sum((counts_a[name] / count) * (counts_b[name] / count) for name in classes)
    if abs(expected - 1.0) < 1e-12:
        return 1.0
    return (observed - expected) / (1.0 - expected)


def krippendorffs_alpha(labels_a: list[str], labels_b: list[str]) -> float:
    if len(labels_a) != len(labels_b):
        return 0.0
    if not labels_a:
        return 1.0
    categories = sorted(set(labels_a) | set(labels_b))
    index = {name: position for position, name in enumerate(categories)}
    size = len(categories)
    coincidence = [[0.0] * size for _ in range(size)]
    for left, right in zip(labels_a, labels_b):
        i = index[left]
        j = index[right]
        coincidence[i][j] += 1.0
        coincidence[j][i] += 1.0
    total = sum(sum(row) for row in coincidence)
    if total <= 1:
        return 1.0
    observed = 0.0
    expected = 0.0
    marginal = [sum(row) for row in coincidence]
    for row_index in range(size):
        for column_index in range(size):
            if row_index == column_index:
                continue
            observed += coincidence[row_index][column_index]
            expected += marginal[row_index] * marginal[column_index]
    observed /= total
    expected /= total * (total - 1)
    if expected == 0:
        return 1.0
    return 1.0 - observed / expected


def frame_labels(annotations: list[dict], n_frames: int) -> list[str]:
    total = max(0, int(n_frames))
    if total == 0:
        return []
    if not annotations:
        return ["none"] * total
    buckets: list[set[str] | None] = [None] * total
    for annotation in annotations:
        start_f = max(0, int(annotation["start_frame"]))
        end_f = min(total, int(annotation["end_frame"]))
        if end_f <= start_f:
            continue
        tag = f"{annotation['animal']}\0{annotation['action']}"
        for frame in range(start_f, end_f):
            bucket = buckets[frame]
            if bucket is None:
                buckets[frame] = {tag}
            else:
                bucket.add(tag)
    return [
        "none" if bucket is None else "|".join(sorted(bucket))
        for bucket in buckets
    ]


def _normalize(document: dict, fps: float) -> list[dict]:
    normalized: list[dict] = []
    for annotation in document.get("annotations") or []:
        start = float(annotation["start"])
        end = float(annotation["end"])
        start_frame = annotation.get("start_frame")
        end_frame = annotation.get("end_frame")
        normalized.append(
            {
                "animal": annotation["animal"],
                "action": annotation["action"],
                "start": start,
                "end": end,
                "start_frame": frame_index(start, fps) if start_frame is None else int(start_frame),
                "end_frame": frame_index(end, fps) if end_frame is None else int(end_frame),
            }
        )
    return normalized


def _source_labels(doc_a: dict, doc_b: dict) -> list[list[str]]:
    labels: list[list[str]] = []
    seen: set[tuple[str, str]] = set()
    for document in (doc_a, doc_b):
        raw = document.get("source_labels") or []
        for item in raw:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            pair = (str(item[0]), str(item[1]))
            if pair in seen:
                continue
            seen.add(pair)
            labels.append([pair[0], pair[1]])
    return labels


def compare_annotations(
    doc_a: dict,
    doc_b: dict,
    *,
    fps: float = 25.0,
    annotators: tuple[str, str] = ("Annotator_A", "Annotator_B"),
) -> dict:
    left = _normalize(doc_a, fps)
    right = _normalize(doc_b, fps)
    comparisons = match_segments(left, right)
    paired = [row for row in comparisons if row["annotator_a"] and row["annotator_b"]]
    iou_values = [float(row["temporal_iou"]) for row in comparisons]
    start_errors = [abs(row["annotator_a"]["start"] - row["annotator_b"]["start"]) for row in paired]
    end_errors = [abs(row["annotator_a"]["end"] - row["annotator_b"]["end"]) for row in paired]
    start_frames = [abs(row["annotator_a"]["start_frame"] - row["annotator_b"]["start_frame"]) for row in paired]
    end_frames = [abs(row["annotator_a"]["end_frame"] - row["annotator_b"]["end_frame"]) for row in paired]
    n_frames = 0
    for annotation in [*left, *right]:
        n_frames = max(n_frames, int(annotation["end_frame"]))
    labels_a = frame_labels(left, n_frames)
    labels_b = frame_labels(right, n_frames)
    kappa = _metric(cohens_kappa(labels_a, labels_b))
    alpha = _metric(krippendorffs_alpha(labels_a, labels_b))
    all_verified = bool(comparisons) and all(row["temporal_iou"] >= TIOU_THRESHOLD for row in comparisons)
    verdict = HIGH_QUALITY if all_verified and kappa >= 0.80 else "NEEDS_REVIEW"
    video = doc_a.get("video") or doc_b.get("video") or ""
    return {
        "video": video,
        "fps": fps,
        "annotator_pair": [annotators[0], annotators[1]],
        "source_labels": _source_labels(doc_a, doc_b),
        "overall_metrics": {
            "mean_temporal_iou": _mean(iou_values),
            "std_temporal_iou": _std(iou_values),
            "cohens_kappa_frame_level": kappa,
            "krippendorffs_alpha": alpha,
            "mean_start_boundary_error_sec": _mean(start_errors),
            "mean_end_boundary_error_sec": _mean(end_errors),
            "mean_start_boundary_error_frames": _mean([float(item) for item in start_frames]),
            "mean_end_boundary_error_frames": _mean([float(item) for item in end_frames]),
            "std_start_boundary_error_sec": _std(start_errors),
            "std_end_boundary_error_sec": _std(end_errors),
            "robustness_verdict": verdict,
        },
        "segment_comparisons": comparisons,
    }


def average_merge(segment_a: dict, segment_b: dict, fps: float) -> dict:
    start = round_seconds((float(segment_a["start"]) + float(segment_b["start"])) / 2)
    end = round_seconds((float(segment_a["end"]) + float(segment_b["end"])) / 2)
    return {
        "animal": segment_a["animal"],
        "action": segment_a["action"],
        "start": start,
        "end": end,
        "start_frame": frame_index(start, fps),
        "end_frame": frame_index(end, fps),
    }


def annotation_from_row(row: dict, decision: str, fps: float) -> dict:
    animal, action = row["label"]
    left = row.get("annotator_a")
    right = row.get("annotator_b")
    if decision == "a":
        if not left:
            raise ValueError("这一条没有标注员 A 的区间。")
        side = left
    elif decision == "b":
        if not right:
            raise ValueError("这一条没有标注员 B 的区间。")
        side = right
    elif decision == "average":
        if not left or not right:
            raise ValueError("取均值需要两边都有区间。")
        return average_merge(
            {"animal": animal, "action": action, **left},
            {"animal": animal, "action": action, **right},
            fps,
        )
    else:
        raise ValueError("请选择采用 A、采用 B 或取均值。")
    return {
        "animal": animal,
        "action": action,
        "start": side["start"],
        "end": side["end"],
        "start_frame": int(side["start_frame"]),
        "end_frame": int(side["end_frame"]),
    }


def arbitrate_one(report: dict, index: int, decision: str) -> tuple[dict, float]:
    rows = report.get("segment_comparisons") or []
    if index < 0 or index >= len(rows):
        raise ValueError("找不到这一条对比。")
    fps = float(report.get("fps") or 25.0)
    annotations: list[dict] = []
    seek_to = 0.0
    for position, row in enumerate(rows):
        if position == index:
            choice = decision
        elif row.get("annotator_a"):
            choice = "a"
        else:
            choice = "b"
        item = annotation_from_row(row, choice, fps)
        if position == index:
            seek_to = float(item["start"])
        annotations.append(item)
    annotations.sort(key=lambda item: (item["start"], item["animal"], item["action"]))
    labels = report.get("source_labels") or []
    document = {
        "video": report.get("video") or "untitled.mp4",
        "source_labels": labels,
        "annotations": annotations,
    }
    return document, seek_to


def arbitrate(report: dict, *, strategy: str = "average") -> dict:
    if strategy != "average":
        raise ValueError("目前只支持平均合并。")
    fps = float(report.get("fps") or 25.0)
    annotations: list[dict] = []
    for row in report["segment_comparisons"]:
        animal, action = row["label"]
        left = row.get("annotator_a")
        right = row.get("annotator_b")
        if left and right and row["status"] == "NEEDS_ARBITRATION":
            merged = average_merge(
                {"animal": animal, "action": action, **left},
                {"animal": animal, "action": action, **right},
                fps,
            )
            annotations.append(merged)
            continue
        side = left or right
        if not side:
            continue
        annotations.append(
            {
                "animal": animal,
                "action": action,
                "start": side["start"],
                "end": side["end"],
                "start_frame": int(side["start_frame"]),
                "end_frame": int(side["end_frame"]),
            }
        )
    annotations.sort(key=lambda item: (item["start"], item["animal"], item["action"]))
    labels = report.get("source_labels") or []
    if not labels:
        seen: set[tuple[str, str]] = set()
        labels = []
        for item in annotations:
            pair = (item["animal"], item["action"])
            if pair in seen:
                continue
            seen.add(pair)
            labels.append([item["animal"], item["action"]])
    return {
        "video": report.get("video") or "untitled.mp4",
        "source_labels": labels,
        "annotations": annotations,
    }


def export_markdown_and_latex_table(report: dict) -> tuple[str, str]:
    metrics = report["overall_metrics"]
    markdown_lines = [
        "| Animal-Action | tIoU | Status |",
        "| :--- | ---: | :--- |",
    ]
    latex_rows: list[str] = []
    for row in report["segment_comparisons"]:
        label = " / ".join(row["label"])
        score = f"{float(row['temporal_iou']):.3f}"
        markdown_lines.append(f"| {label} | {score} | {row['status']} |")
        latex_label = label.replace("_", r"\_")
        latex_rows.append(f"{latex_label} & {score} & {row['status']} \\\\")
    markdown_lines.extend(
        [
            "",
            f"Mean tIoU: {metrics['mean_temporal_iou']:.3f}",
            f"Cohen's kappa: {metrics['cohens_kappa_frame_level']:.3f}",
            f"Start boundary sigma: {metrics['std_start_boundary_error_sec']:.3f}",
            f"End boundary sigma: {metrics['std_end_boundary_error_sec']:.3f}",
            f"Verdict: {metrics['robustness_verdict']}",
            "",
        ]
    )
    latex = "\n".join(
        [
            r"\begin{tabular}{lcc}",
            r"\hline",
            r"Label & tIoU & Status \\",
            r"\hline",
            *latex_rows,
            r"\hline",
            r"\end{tabular}",
            "",
        ]
    )
    return "\n".join(markdown_lines), latex


def load_annotation(path: Path) -> dict:
    parsed = parse_label_input(path.read_text(encoding="utf-8"))
    annotations = []
    for item in parsed.annotations:
        if float(item["end"]) <= float(item["start"]):
            raise ValueError("结束时间必须晚于开始时间。")
        annotations.append(
            {
                "animal": item["animal"],
                "action": item["action"],
                "start": item["start"],
                "end": item["end"],
                "start_frame": int(item["start_frame"]),
                "end_frame": int(item["end_frame"]),
            }
        )
    return {
        "video": parsed.video or "untitled.mp4",
        "source_labels": [[animal, action] for animal, action in parsed.source_labels],
        "annotations": annotations,
    }
