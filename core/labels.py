"""Label parsing and the Animal Kingdom AR export schema.

Supports both the legacy flat export schema and the preprocessed Animal Kingdom schema:

{
  "video_id": "AAACXZTV",
  "video": "AAACXZTV.mp4",
  "fps": 25,
  "list_animal": ["Common Crane", "Common Crane"],
  "list_animal_action": [
    ["Common Crane", "Attending"],
    ["Common Crane", "Eating"]
  ],
  "annotations": [
    {
      "animal": "Common Crane",
      "actions": [
        {
          "action": "Attending",
          "start": 0.0,
          "end": 0.907,
          "start_frame": 0,
          "end_frame": 23
        }
      ]
    },
    {
      "animal": "Common Crane",
      "actions": []
    }
  ]
}
"""

from __future__ import annotations

import json
import math
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path

LabelPair = tuple[str, str]


class ParseError(Exception):
    pass


@dataclass
class Segment:
    id: str
    animal: str
    action: str
    start: float
    end: float
    track_index: int = 0

    @classmethod
    def from_annotation(cls, annotation: dict) -> Segment:
        return cls(
            id=uuid.uuid4().hex[:12],
            animal=annotation["animal"],
            action=annotation["action"],
            start=round_seconds(float(annotation["start"])),
            end=round_seconds(float(annotation["end"])),
            track_index=int(annotation.get("track_index", 0) or 0),
        )


@dataclass
class ParsedLabels:
    source_labels: list[LabelPair]
    annotations: list[dict]
    video: str | None
    kind: str
    duplicate_count: int
    video_id: str | None = None
    list_animal: list[str] = field(default_factory=list)
    list_animal_action: list[LabelPair] = field(default_factory=list)


@dataclass
class Snapshot:
    labels: list[LabelPair]
    segments: list[Segment]
    list_animal: list[str] = field(default_factory=list)
    active_segment_id: str | None = None
    selected_segment_ids: list[str] = field(default_factory=list)


def label_key(animal: str, action: str) -> str:
    return f"{animal}\0{action}"


def format_tuple(animal: str, action: str) -> str:
    return f"('{animal}', '{action}')"


def js_round(value: float) -> int:
    if not math.isfinite(value):
        return 0
    if value >= 0:
        return math.floor(value + 0.5)
    return math.ceil(value - 0.5)


def round_seconds(seconds: float) -> float:
    if not math.isfinite(seconds):
        return 0.0
    return js_round(seconds * 1000) / 1000


def frame_index(seconds: float, fps: float) -> int:
    if not math.isfinite(seconds) or not math.isfinite(fps) or fps <= 0:
        return 0
    return max(0, js_round(round_seconds(seconds) * fps))


def format_time(seconds: float) -> str:
    if not math.isfinite(seconds) or seconds < 0:
        seconds = 0
    total_ms = js_round(seconds * 1000)
    ms = total_ms % 1000
    total_sec = total_ms // 1000
    second = total_sec % 60
    total_min = total_sec // 60
    minute = total_min % 60
    hour = total_min // 60
    body = f"{minute:02d}:{second:02d}.{ms:03d}"
    return f"{hour}:{body}" if hour else body


def dedupe_labels(pairs: list[LabelPair]) -> tuple[list[LabelPair], int]:
    seen: set[str] = set()
    labels: list[LabelPair] = []
    duplicates = 0
    for animal, action in pairs:
        key = label_key(animal, action)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        labels.append((animal, action))
    return labels, duplicates


def derive_animal_tracks(list_animal: list[str], labels: list[LabelPair]) -> list[str]:
    cleaned = [str(item).strip() for item in list_animal if str(item).strip()]
    if cleaned:
        return cleaned
    seen: list[str] = []
    for animal, _action in labels:
        if animal not in seen:
            seen.append(animal)
    return seen


def export_filename(video_name: str) -> str:
    trimmed = video_name.strip() or "annotations"
    base = re.sub(r"\.[^./\\]+$", "", trimmed)
    return f"{base or 'annotations'}.ar.json"


def build_export(video: str, source_labels: list[LabelPair], segments: list[Segment], fps: float) -> dict:
    order = {label_key(animal, action): index for index, (animal, action) in enumerate(source_labels)}
    annotations = []
    for segment in segments:
        start = round_seconds(segment.start)
        end = round_seconds(segment.end)
        if end <= start:
            continue
        annotations.append(
            {
                "animal": segment.animal,
                "action": segment.action,
                "start": start,
                "end": end,
                "start_frame": frame_index(start, fps),
                "end_frame": frame_index(end, fps),
            }
        )
    annotations.sort(key=lambda item: (item["start"], order.get(label_key(item["animal"], item["action"]), 0)))
    return {
        "video": video,
        "source_labels": [[animal, action] for animal, action in source_labels],
        "annotations": annotations,
    }


def build_preprocessed_export(
    video: str,
    video_id: str,
    list_animal: list[str],
    list_animal_action: list[LabelPair],
    segments: list[Segment],
    fps: float,
) -> dict:
    tracks = derive_animal_tracks(list_animal, list_animal_action)
    grouped_annotations: list[dict] = [
        {"animal": animal_name, "actions": []}
        for animal_name in tracks
    ]
    for segment in sorted(segments, key=lambda item: (item.track_index, item.start)):
        start = round_seconds(segment.start)
        end = round_seconds(segment.end)
        if end <= start:
            continue
        target_idx = segment.track_index
        if target_idx < 0 or target_idx >= len(grouped_annotations):
            target_idx = next(
                (idx for idx, name in enumerate(tracks) if name == segment.animal),
                -1,
            )
            if target_idx < 0:
                tracks.append(segment.animal)
                grouped_annotations.append({"animal": segment.animal, "actions": []})
                target_idx = len(grouped_annotations) - 1
        grouped_annotations[target_idx]["actions"].append(
            {
                "action": segment.action,
                "start": start,
                "end": end,
                "start_frame": frame_index(start, fps),
                "end_frame": frame_index(end, fps),
            }
        )

    clean_video = video.strip() or f"{video_id or 'untitled'}.mp4"
    clean_video_id = (video_id or Path(clean_video).stem).strip()
    return {
        "video_id": clean_video_id,
        "video": clean_video,
        "fps": int(fps) if float(fps).is_integer() else round_seconds(fps),
        "list_animal": tracks,
        "list_animal_action": [[animal, action] for animal, action in list_animal_action],
        "source_labels": [[animal, action] for animal, action in list_animal_action],
        "annotations": grouped_annotations,
    }


def serialize_export(document: dict) -> str:
    return json.dumps(document, ensure_ascii=False, indent=2) + "\n"


def parse_label_input(raw: str) -> ParsedLabels:
    text = raw.lstrip("\ufeff").strip()
    if not text:
        raise ParseError("内容为空。")
    if text.startswith("{") or text.startswith("["):
        try:
            return _from_json(json.loads(text))
        except json.JSONDecodeError as error:
            loose = _try_loose(text)
            if loose:
                return loose
            raise ParseError(f"无法解析 JSON：{error.msg}") from error
        except ParseError:
            raise
    loose = _try_loose(text)
    if not loose:
        raise ParseError("没有识别到任何「动物, 行为」标签。")
    return loose


def _from_json(value) -> ParsedLabels:
    if isinstance(value, list):
        return _from_json_array(value)
    if not isinstance(value, dict):
        raise ParseError("无法识别的 JSON。")
    if (
        isinstance(value.get("list_animal_action"), list)
        or isinstance(value.get("list_animal"), list)
        or isinstance(value.get("source_labels"), list)
        or isinstance(value.get("annotations"), (list, dict))
        or isinstance(value.get("video"), str)
        or isinstance(value.get("video_id"), str)
    ):
        return _from_project(value)
    for key in ("labels", "ar_labels", "pairs", "actions"):
        if key in value:
            return _from_json(value[key])
    pair = _soft_pair(value)
    if pair:
        return _finish([pair], [], None, "labels")
    raise ParseError("无法识别的 JSON。需要 [[动物, 行为], ...]，或带 list_animal_action / source_labels 的导出文件。")


def _from_project(value: dict) -> ParsedLabels:
    source_labels: list[LabelPair] = []
    raw_labels = (
        value.get("list_animal_action")
        if isinstance(value.get("list_animal_action"), list)
        else value.get("source_labels")
    )
    if isinstance(raw_labels, list):
        for index, item in enumerate(raw_labels):
            pair = _soft_pair(item)
            if not pair:
                raise ParseError(f"标签列表第 {index + 1} 项不是 [动物, 行为]。")
            source_labels.append(pair)

    raw_list_animal = value.get("list_animal")
    list_animal: list[str] = []
    if isinstance(raw_list_animal, list):
        for item in raw_list_animal:
            name = _read_string(item)
            if name:
                list_animal.append(name)

    annotations: list[dict] = []
    raw_annotations = value.get("annotations")
    if isinstance(raw_annotations, list):
        for index, item in enumerate(raw_annotations):
            if isinstance(item, dict) and isinstance(item.get("actions"), list):
                track_animal = _read_string(item.get("animal")) or (
                    list_animal[index] if index < len(list_animal) else None
                )
                track_idx = int(item.get("track_index", index) if item.get("track_index") is not None else index)
                for act_idx, act_obj in enumerate(item["actions"]):
                    annotations.append(
                        _read_grouped_action(act_obj, track_animal, track_idx, index, act_idx)
                    )
            else:
                ann = _read_annotation(item, index)
                if "track_index" not in ann or ann["track_index"] is None:
                    matched_track = next(
                        (idx for idx, name in enumerate(list_animal) if name == ann["animal"]),
                        0,
                    )
                    ann["track_index"] = matched_track
                annotations.append(ann)
    elif isinstance(raw_annotations, dict):
        for track_idx, (track_key, act_list) in enumerate(raw_annotations.items()):
            track_animal = re.sub(r"\s*#\d+$", "", str(track_key)).strip()
            if isinstance(act_list, list):
                for act_idx, act_obj in enumerate(act_list):
                    annotations.append(
                        _read_grouped_action(act_obj, track_animal, track_idx, track_idx, act_idx)
                    )

    video_id_raw = _read_string(value.get("video_id"))
    video = _read_string(value.get("video"))
    if not video and video_id_raw:
        video = video_id_raw if "." in video_id_raw else f"{video_id_raw}.mp4"
    video_id = video_id_raw or (Path(video).stem if video else None)

    kind = (
        "project"
        if ("annotations" in value or "video" in value or "video_id" in value or "list_animal" in value)
        else "labels"
    )
    listed, duplicate_count = dedupe_labels(source_labels)
    merged = list(listed)
    seen = {label_key(animal, action) for animal, action in merged}
    for item in annotations:
        key = label_key(item["animal"], item["action"])
        if key in seen:
            continue
        seen.add(key)
        merged.append((item["animal"], item["action"]))
    if not merged and list_animal:
        for animal_name in list_animal:
            key = label_key(animal_name, "Attending")
            if key not in seen:
                seen.add(key)
                merged.append((animal_name, "Attending"))
    if not merged:
        raise ParseError("没有识别到任何「动物, 行为」标签。")

    final_tracks = derive_animal_tracks(list_animal, merged)
    return ParsedLabels(
        merged,
        annotations,
        video,
        kind,
        duplicate_count,
        video_id=video_id,
        list_animal=final_tracks,
        list_animal_action=list(merged),
    )


def _read_grouped_action(
    value,
    track_animal: str | None,
    track_index: int,
    group_index: int,
    action_index: int,
) -> dict:
    if not isinstance(value, dict):
        raise ParseError(f"第 {group_index + 1} 条轨道的第 {action_index + 1} 段不是对象。")
    animal = _read_string(value.get("animal")) or track_animal
    action = _read_string(value.get("action"))
    start = _read_number(value.get("start"))
    end = _read_number(value.get("end"))
    if not animal or not action:
        raise ParseError(f"第 {group_index + 1} 条轨道的第 {action_index + 1} 段缺少 animal 或 action。")
    if start is None or end is None:
        raise ParseError(f"第 {group_index + 1} 条轨道的第 {action_index + 1} 段缺少 start 或 end。")
    if end <= start:
        raise ParseError(f"第 {group_index + 1} 条轨道的第 {action_index + 1} 段的结束时间必须晚于开始时间。")
    start_frame = _read_number(value.get("start_frame"))
    end_frame = _read_number(value.get("end_frame"))
    return {
        "animal": animal,
        "action": action,
        "start": start,
        "end": end,
        "start_frame": 0 if start_frame is None else int(js_round(start_frame)),
        "end_frame": 0 if end_frame is None else int(js_round(end_frame)),
        "track_index": track_index,
    }


def _from_json_array(value: list) -> ParsedLabels:
    if not value:
        raise ParseError("标签列表为空。")
    if (
        len(value) == 2
        and all(isinstance(item, str) for item in value)
        and not any(re.search(r"[,，\t;]", item) for item in value)
    ):
        pair = _soft_pair(value)
        if not pair:
            raise ParseError("无法识别的标签对。")
        return _finish([pair], [], None, "labels")
    if all(isinstance(item, str) for item in value):
        pairs = []
        for index, item in enumerate(value):
            pair = _parse_loose_line(item)
            if not pair:
                raise ParseError(f"第 {index + 1} 行不是「动物, 行为」。")
            pairs.append(pair)
        return _finish(pairs, [], None, "labels")
    if all(isinstance(item, list) for item in value):
        pairs = []
        for index, item in enumerate(value):
            pair = _soft_pair(item)
            if not pair:
                raise ParseError(f"第 {index + 1} 项不是 [动物, 行为]。")
            pairs.append(pair)
        return _finish(pairs, [], None, "labels")
    if all(isinstance(item, dict) for item in value):
        pairs = []
        annotations = []
        timed = False
        for index, item in enumerate(value):
            pair = _soft_pair(item)
            if not pair:
                raise ParseError(f"第 {index + 1} 项缺少 animal 与 action。")
            pairs.append(pair)
            if item.get("start") is not None or item.get("end") is not None:
                timed = True
                annotations.append(_read_annotation(item, index))
        return _finish(pairs, annotations, None, "project" if timed else "labels")
    raise ParseError("无法识别的 JSON 数组。需要 [[动物, 行为], ...]，或导出文件。")


def _finish(pairs: list[LabelPair], annotations: list[dict], video: str | None, kind: str) -> ParsedLabels:
    labels, duplicate_count = dedupe_labels(pairs)
    if not labels:
        raise ParseError("没有识别到任何「动物, 行为」标签。")
    tracks = derive_animal_tracks([], labels)
    return ParsedLabels(
        labels,
        annotations,
        video,
        kind,
        duplicate_count,
        video_id=Path(video).stem if video else None,
        list_animal=tracks,
        list_animal_action=list(labels),
    )


def _read_annotation(value, index: int) -> dict:
    if not isinstance(value, dict):
        raise ParseError(f"第 {index + 1} 段不是对象。")
    animal = _read_string(value.get("animal"))
    action = _read_string(value.get("action"))
    start = _read_number(value.get("start"))
    end = _read_number(value.get("end"))
    if not animal or not action:
        raise ParseError(f"第 {index + 1} 段缺少 animal 或 action。")
    if start is None or end is None:
        raise ParseError(f"第 {index + 1} 段缺少 start 或 end。")
    if end <= start:
        raise ParseError(f"第 {index + 1} 段的结束时间必须晚于开始时间。")
    start_frame = _read_number(value.get("start_frame"))
    end_frame = _read_number(value.get("end_frame"))
    track_index = _read_number(value.get("track_index"))
    out = {
        "animal": animal,
        "action": action,
        "start": start,
        "end": end,
        "start_frame": 0 if start_frame is None else int(js_round(start_frame)),
        "end_frame": 0 if end_frame is None else int(js_round(end_frame)),
    }
    if track_index is not None:
        out["track_index"] = max(0, int(js_round(track_index)))
    return out


_TUPLE_RE = re.compile(r"""\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*,\s*(['"])((?:\\.|(?!\3).)*)\3\s*\)""")


def _try_loose(text: str) -> ParsedLabels | None:
    normalized = text.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"').replace("，", ",")
    pairs: list[LabelPair] = []

    def replacer(match: re.Match) -> str:
        animal = _unescape(match.group(2)).strip()
        action = _unescape(match.group(4)).strip()
        if animal and action:
            pairs.append((animal, action))
        return "\n"

    stripped = _TUPLE_RE.sub(replacer, normalized)
    for line in re.split(r"\r?\n", stripped):
        pair = _parse_loose_line(line)
        if pair:
            pairs.append(pair)
    if pairs and _is_header(pairs[0]):
        pairs.pop(0)
    if not pairs:
        return None
    return _finish(pairs, [], None, "labels")


def _parse_loose_line(line: str) -> LabelPair | None:
    text = line.strip()
    if not text or text.startswith("#") or text.startswith("//"):
        return None
    text = re.sub(r"^[\[\]{}(),;\s]+|[\[\]{}(),;\s]+$", "", text).strip()
    if not text:
        return None
    if text.startswith("[") or text.startswith("{"):
        try:
            pair = _soft_pair(json.loads(text))
            if pair:
                return pair
        except json.JSONDecodeError:
            pass
    fields = _split_fields(text)
    if fields and len(fields) >= 2:
        animal = _clean_field(fields[0])
        action = _clean_field(fields[1])
        if animal and action:
            return animal, action
    parts = re.split(r"\s+[-–—|/]\s+", text)
    if len(parts) == 2:
        animal = _clean_field(parts[0])
        action = _clean_field(parts[1])
        if animal and action:
            return animal, action
    return None


def _split_fields(line: str) -> list[str] | None:
    comma = _split_delimited(line, ",")
    if len(comma) >= 2:
        return comma
    semi = _split_delimited(line, ";")
    if len(semi) >= 2:
        return semi
    if "\t" in line:
        tab = [item.strip() for item in line.split("\t")]
        if len(tab) >= 2:
            return tab
    return None


def _split_delimited(line: str, delimiter: str) -> list[str]:
    out: list[str] = []
    current: list[str] = []
    quote: str | None = None
    index = 0
    while index < len(line):
        char = line[index]
        if quote:
            if char == "\\" and index + 1 < len(line):
                current.append(line[index + 1])
                index += 2
                continue
            if char == quote:
                if index + 1 < len(line) and line[index + 1] == quote:
                    current.append(quote)
                    index += 2
                    continue
                quote = None
            else:
                current.append(char)
            index += 1
            continue
        if char in {'"', "'"} and not "".join(current).strip():
            quote = char
            index += 1
            continue
        if char == delimiter:
            out.append("".join(current).strip())
            current = []
            index += 1
            continue
        current.append(char)
        index += 1
    out.append("".join(current).strip())
    return out


def _soft_pair(value) -> LabelPair | None:
    if isinstance(value, list) and len(value) >= 2:
        animal = _read_string(value[0])
        action = _read_string(value[1])
        if animal and action:
            return animal, action
        return None
    if not isinstance(value, dict):
        return None
    animal = _read_string(value.get("animal", value.get("species", value.get("Animal"))))
    action = _read_string(value.get("action", value.get("behavior", value.get("behaviour", value.get("Action")))))
    if animal and action:
        return animal, action
    return None


def _is_header(pair: LabelPair) -> bool:
    return bool(re.fullmatch(r"animal|species|动物", pair[0], re.IGNORECASE) and re.fullmatch(r"action|behavior|behaviour|行为", pair[1], re.IGNORECASE))


def _clean_field(value: str) -> str:
    return re.sub(r"^['\"]|['\"]$", "", _unescape(value).strip()).strip()


def _unescape(value: str) -> str:
    def replace(match: re.Match) -> str:
        char = match.group(1)
        if char == "n":
            return "\n"
        if char == "t":
            return "\t"
        return char

    return re.sub(r"\\(.)", replace, value)


def _read_string(value) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def _read_number(value) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            number = float(value)
        except ValueError:
            return None
        if math.isfinite(number):
            return number
    return None


@dataclass
class Project:
    video_name: str = ""
    video_id: str = ""
    fps: float = 25.0
    labels: list[LabelPair] = field(default_factory=list)
    list_animal: list[str] = field(default_factory=list)
    segments: list[Segment] = field(default_factory=list)
    selected_key: str | None = None
    selected_track_index: int = 0
    selected_action: str | None = None
    pending_key: str | None = None
    pending_track_index: int | None = None
    pending_action: str | None = None
    pending_time: float | None = None
    active_segment_id: str | None = None
    selected_segment_ids: list[str] = field(default_factory=list)
    _history: list[Snapshot] = field(default_factory=list)
    _redo_history: list[Snapshot] = field(default_factory=list)
    _edit_open: bool = False

    def _make_snapshot(self) -> Snapshot:
        return Snapshot(
            labels=list(self.labels),
            segments=[
                Segment(item.id, item.animal, item.action, item.start, item.end, item.track_index)
                for item in self.segments
            ],
            list_animal=list(self.list_animal),
            active_segment_id=self.active_segment_id,
            selected_segment_ids=list(self.selected_segment_ids),
        )

    def _restore_snapshot(self, snap: Snapshot) -> None:
        self.labels = list(snap.labels)
        self.segments = [
            Segment(item.id, item.animal, item.action, item.start, item.end, item.track_index)
            for item in snap.segments
        ]
        if snap.list_animal:
            self.list_animal = list(snap.list_animal)
        self.active_segment_id = snap.active_segment_id
        self.selected_segment_ids = list(snap.selected_segment_ids)
        self.pending_key = None
        self.pending_track_index = None
        self.pending_action = None
        self.pending_time = None
        self._keep_selection()

    def push_history(self) -> None:
        self._history.append(self._make_snapshot())
        if len(self._history) > 50:
            self._history.pop(0)
        self._redo_history.clear()

    def clear_history(self) -> None:
        self._history.clear()
        self._redo_history.clear()
        self._edit_open = False

    def undo(self) -> bool:
        if not self._history:
            return False
        self._redo_history.append(self._make_snapshot())
        if len(self._redo_history) > 50:
            self._redo_history.pop(0)
        previous = self._history.pop()
        self._restore_snapshot(previous)
        return True

    def redo(self) -> bool:
        if not self._redo_history:
            return False
        self._history.append(self._make_snapshot())
        if len(self._history) > 50:
            self._history.pop(0)
        next_snap = self._redo_history.pop()
        self._restore_snapshot(next_snap)
        return True

    def begin_edit(self) -> None:
        if not self._edit_open:
            self.push_history()
            self._edit_open = True

    def end_edit(self) -> None:
        self._edit_open = False

    def apply(self, parsed: ParsedLabels, mode: str) -> None:
        if mode == "merge":
            labels, _duplicates = dedupe_labels([*self.labels, *parsed.source_labels])
            list_animal = list(self.list_animal)
            for animal_name in parsed.list_animal:
                if animal_name not in list_animal:
                    list_animal.append(animal_name)
            if not list_animal:
                list_animal = derive_animal_tracks([], labels)
        else:
            labels = list(parsed.source_labels)
            list_animal = derive_animal_tracks(parsed.list_animal, labels)

        if parsed.kind == "project" and mode == "replace":
            segments = [Segment.from_annotation(item) for item in parsed.annotations]
        elif mode == "merge" and parsed.annotations:
            segments = [*self.segments, *[Segment.from_annotation(item) for item in parsed.annotations]]
        else:
            allowed = {label_key(animal, action) for animal, action in labels}
            segments = [item for item in self.segments if label_key(item.animal, item.action) in allowed]

        for seg in segments:
            if seg.track_index < 0 or seg.track_index >= len(list_animal):
                matched = next((idx for idx, name in enumerate(list_animal) if name == seg.animal), 0)
                seg.track_index = matched

        self.push_history()
        self.labels = labels
        self.list_animal = list_animal
        if parsed.video_id:
            self.video_id = parsed.video_id
        self.segments = segments
        self._merge_all_overlapping_segments()
        self.pending_key = None
        self.pending_track_index = None
        self.pending_action = None
        self.pending_time = None
        self._keep_selection()

    def select_track(self, track_index: int) -> None:
        tracks = self.animal_tracks()
        if not tracks:
            raise ValueError("当前没有动物时间轴轨道。")
        idx = int(track_index)
        if idx < 0 or idx >= len(tracks):
            raise ValueError("找不到对应的动物轨道。")
        track_animal = tracks[idx]
        if self.selected_action and not self._pair_allowed(track_animal, self.selected_action):
            raise ValueError("这个物种没有该行为。")
        self.selected_track_index = idx
        if self.selected_action:
            self.selected_key = label_key(track_animal, self.selected_action)
            return
        for animal, action in self.labels:
            if animal == track_animal:
                self.selected_action = action
                self.selected_key = label_key(animal, action)
                return

    def select_action(self, action: str) -> None:
        clean = action.strip()
        if not clean:
            raise ValueError("请选择一个有效行为。")
        if not any(act == clean for _animal, act in self.labels):
            raise ValueError("没有找到这个行为。")
        self.selected_action = clean
        tracks = self.animal_tracks()
        if 0 <= self.selected_track_index < len(tracks) and self._pair_allowed(tracks[self.selected_track_index], clean):
            self.selected_key = label_key(tracks[self.selected_track_index], clean)
            return
        for idx, name in enumerate(tracks):
            if self._pair_allowed(name, clean):
                self.selected_track_index = idx
                self.selected_key = label_key(name, clean)
                return
        for animal, act in self.labels:
            if act == clean:
                self.selected_key = label_key(animal, clean)
                return

    def _pair_allowed(self, animal: str, action: str) -> bool:
        return any(item_animal == animal and item_action == action for item_animal, item_action in self.labels)

    def _require_pair(self, animal: str, action: str) -> None:
        if not self._pair_allowed(animal, action):
            raise ValueError("这个物种没有该行为。")

    def animal_tracks(self) -> list[str]:
        if self.list_animal:
            return list(self.list_animal)
        return derive_animal_tracks([], self.labels)

    def available_actions(self) -> list[str]:
        seen: list[str] = []
        for _animal, action in self.labels:
            if action not in seen:
                seen.append(action)
        return seen

    def mark_start(self, time: float, track_index: int | None = None, action: str | None = None) -> str:
        if action is not None:
            self.select_action(str(action))
        if track_index is not None:
            self.select_track(int(track_index))
        if not self.selected_key and not self.selected_action:
            raise ValueError("请先在右侧选择一个行为。")
        tracks = self.animal_tracks()
        animal = tracks[self.selected_track_index] if tracks and 0 <= self.selected_track_index < len(tracks) else ""
        chosen = self.selected_action or ""
        if animal and chosen:
            self._require_pair(animal, chosen)
        self.pending_key = self.selected_key
        self.pending_track_index = self.selected_track_index
        self.pending_action = self.selected_action
        self.pending_time = round_seconds(max(0.0, time))
        return f"起点 {format_time(self.pending_time)}"

    def mark_end(self, time: float, track_index: int | None = None, action: str | None = None) -> str:
        if action is not None:
            self.select_action(str(action))
        if track_index is not None:
            self.select_track(int(track_index))
        if not self.selected_key and not self.selected_action:
            raise ValueError("请先在右侧选择一个行为。")
        if self.pending_time is None or (
            self.pending_key != self.selected_key and self.pending_action != self.selected_action
        ):
            raise ValueError("请先标记起点。")
        start = self.pending_time
        end = round_seconds(max(0.0, time))
        swapped = False
        if end < start:
            start, end = end, start
            swapped = True
        if end - start < 0.001:
            raise ValueError("终点必须晚于起点。")

        tracks = self.animal_tracks()
        if self.selected_key:
            animal, chosen_action = self.selected_pair()
        else:
            target_guess = self.pending_track_index if self.pending_track_index is not None else self.selected_track_index
            if tracks and 0 <= target_guess < len(tracks):
                animal = tracks[target_guess]
            else:
                animal, _ = self.selected_pair()
            chosen_action = self.selected_action or self.pending_action
            if not chosen_action:
                _, chosen_action = self.selected_pair()
        self._require_pair(animal, chosen_action)
        tracks = self.animal_tracks()
        explicit = self.selected_track_index if track_index is not None else (
            self.pending_track_index if self.pending_track_index is not None else self.selected_track_index
        )
        if tracks and 0 <= explicit < len(tracks) and tracks[explicit] == animal:
            target_track = explicit
        elif tracks:
            target_track = next((idx for idx, name in enumerate(tracks) if name == animal), 0)
        else:
            target_track = 0

        segment = Segment(
            uuid.uuid4().hex[:12],
            animal,
            chosen_action,
            start,
            end,
            track_index=target_track,
        )
        self.push_history()
        self.segments.append(segment)
        merged_seg, did_merge = self._merge_overlapping_segments(
            target_track=target_track,
            animal=animal,
            action=chosen_action,
            preferred_id=segment.id,
        )
        self.active_segment_id = merged_seg.id
        self.selected_segment_ids = [merged_seg.id]
        self.pending_key = None
        self.pending_track_index = None
        self.pending_action = None
        self.pending_time = None
        if swapped:
            return "终点早于起点，已对调并合并保存。" if did_merge else "终点早于起点，已对调并保存。"
        if did_merge:
            return "已与同轨道同行为的重叠区间自动合并。"
        return "已添加一段区间。"

    def create_segment(
        self,
        animal: str,
        action: str,
        start: float,
        end: float,
        track_index: int = 0,
    ) -> str:
        self.select_action(str(action))
        self.select_track(int(track_index))
        s = round_seconds(max(0.0, min(float(start), float(end))))
        e = round_seconds(max(0.0, max(float(start), float(end))))
        if e - s < 0.001:
            raise ValueError("终点必须晚于起点。")
        tracks = self.animal_tracks()
        target_track = int(track_index) if tracks and 0 <= int(track_index) < len(tracks) else 0
        resolved_animal = tracks[target_track] if tracks and 0 <= target_track < len(tracks) else animal.strip()
        clean_action = str(action).strip()
        self._require_pair(resolved_animal, clean_action)

        segment = Segment(
            uuid.uuid4().hex[:12],
            resolved_animal,
            clean_action,
            s,
            e,
            track_index=target_track,
        )
        self.push_history()
        self.segments.append(segment)
        merged_seg, did_merge = self._merge_overlapping_segments(
            target_track=target_track,
            animal=resolved_animal,
            action=clean_action,
            preferred_id=segment.id,
        )
        self.active_segment_id = merged_seg.id
        self.selected_segment_ids = [merged_seg.id]
        self.pending_key = None
        self.pending_track_index = None
        self.pending_action = None
        self.pending_time = None
        if did_merge:
            return "已与同轨道同行为的重叠区间自动合并。"
        return "已添加一段区间。"

    def _merge_all_overlapping_segments(self) -> bool:
        keys = list({(s.track_index, s.animal, s.action) for s in self.segments})
        any_merged = False
        for track_idx, animal, action in keys:
            _, did = self._merge_overlapping_segments(
                target_track=track_idx,
                animal=animal,
                action=action,
                preferred_id=self.active_segment_id,
            )
            if did:
                any_merged = True
        return any_merged

    def _merge_overlapping_segments(
        self,
        *,
        target_track: int,
        animal: str,
        action: str,
        preferred_id: str | None = None,
    ) -> tuple[Segment, bool]:
        matching: list[Segment] = []
        others: list[Segment] = []
        for item in self.segments:
            if (
                item.animal == animal
                and item.action == action
            ):
                matching.append(item)
            else:
                others.append(item)
        if len(matching) <= 1:
            return (matching[0], False) if matching else (Segment("", animal, action, 0.0, 0.0, target_track), False)

        matching.sort(key=lambda s: (s.start, s.end))
        merged_list: list[Segment] = []
        did_merge = False
        chosen_seg: Segment | None = None

        for seg in matching:
            if not merged_list:
                merged_list.append(seg)
                continue
            prev = merged_list[-1]
            if seg.start <= prev.end + 1e-4:
                did_merge = True
                prev.start = round_seconds(min(prev.start, seg.start))
                prev.end = round_seconds(max(prev.end, seg.end))
                if preferred_id and seg.id == preferred_id:
                    chosen_seg = prev
            else:
                merged_list.append(seg)

        if chosen_seg is None:
            if preferred_id:
                chosen_seg = next((s for s in merged_list if s.id == preferred_id), merged_list[-1])
            else:
                chosen_seg = merged_list[-1]

        self.segments = [*others, *merged_list]
        return chosen_seg, did_merge

    def select_segment(self, segment_id: str, *, multi: bool = False) -> bool:
        target = next((item for item in self.segments if item.id == segment_id), None)
        if target is None:
            return False
        self._keep_selection()
        if multi:
            if segment_id in self.selected_segment_ids:
                self.selected_segment_ids = [
                    sid for sid in self.selected_segment_ids if sid != segment_id
                ]
                self.active_segment_id = (
                    self.selected_segment_ids[-1] if self.selected_segment_ids else None
                )
                if self.active_segment_id:
                    active_seg = next(
                        (item for item in self.segments if item.id == self.active_segment_id),
                        None,
                    )
                    if active_seg:
                        self.selected_key = label_key(active_seg.animal, active_seg.action)
                        self.selected_action = active_seg.action
                        self.selected_track_index = active_seg.track_index
            else:
                self.selected_segment_ids.append(segment_id)
                self.active_segment_id = segment_id
                self.selected_key = label_key(target.animal, target.action)
                self.selected_action = target.action
                self.selected_track_index = target.track_index
        else:
            self.selected_segment_ids = [segment_id]
            self.active_segment_id = segment_id
            self.selected_key = label_key(target.animal, target.action)
            self.selected_action = target.action
            self.selected_track_index = target.track_index
        return True

    def deselect_segment(self) -> None:
        self.active_segment_id = None
        self.selected_segment_ids = []

    def selected_segments(self) -> list[Segment]:
        self._keep_selection()
        ids = set(self.selected_segment_ids)
        if not ids and self.active_segment_id:
            ids = {self.active_segment_id}
        selected = [item for item in self.segments if item.id in ids]
        selected.sort(key=lambda s: (s.start, s.end, s.track_index))
        return selected

    def delete_segments(self, segment_ids: list[str] | None = None) -> int:
        self._keep_selection()
        if segment_ids:
            targets = {str(sid) for sid in segment_ids if sid}
        elif self.selected_segment_ids:
            targets = set(self.selected_segment_ids)
        elif self.active_segment_id:
            targets = {self.active_segment_id}
        else:
            targets = set()
        existing = [item for item in self.segments if item.id in targets]
        if not existing:
            return 0
        self.push_history()
        self.segments = [item for item in self.segments if item.id not in targets]
        self.selected_segment_ids = [
            sid for sid in self.selected_segment_ids if sid not in targets
        ]
        if self.active_segment_id in targets:
            self.active_segment_id = (
                self.selected_segment_ids[-1] if self.selected_segment_ids else None
            )
        return len(existing)

    def delete_segment(self, segment_id: str) -> None:
        self.delete_segments([segment_id])

    def paste_segments(
        self,
        copied_items: list[dict],
        *,
        anchor_time: float | None = None,
        target_track_index: int | None = None,
        avoid_self_overlap: bool = False,
    ) -> tuple[list[Segment], bool]:
        valid_items: list[dict] = []
        for raw in copied_items or []:
            if not isinstance(raw, dict):
                continue
            animal = _read_string(raw.get("animal"))
            action = _read_string(raw.get("action"))
            start = _read_number(raw.get("start"))
            end = _read_number(raw.get("end"))
            track_idx = _read_number(raw.get("track_index"))
            if not animal or not action or start is None or end is None or end <= start:
                continue
            valid_items.append(
                {
                    "animal": animal,
                    "action": action,
                    "start": round_seconds(start),
                    "end": round_seconds(end),
                    "track_index": max(0, int(js_round(track_idx))) if track_idx is not None else 0,
                }
            )
        if not valid_items:
            raise ValueError("剪贴板中没有可粘贴的标注区间。")

        valid_items.sort(key=lambda item: (item["start"], item["end"], item["track_index"]))
        min_start = min(item["start"] for item in valid_items)
        tracks = self.animal_tracks()
        source_tracks = {item["track_index"] for item in valid_items}
        single_source_track = len(source_tracks) == 1

        resolved_specs: list[tuple[int, str, str, float, float]] = []
        for item in valid_items:
            act = item["action"]
            orig_animal = item["animal"]
            orig_track = item["track_index"]
            chosen_track = orig_track
            chosen_animal = orig_animal

            if single_source_track and target_track_index is not None and tracks and 0 <= int(target_track_index) < len(tracks):
                cand_track = int(target_track_index)
                cand_animal = tracks[cand_track]
                if self._pair_allowed(cand_animal, act):
                    chosen_track = cand_track
                    chosen_animal = cand_animal
                elif 0 <= orig_track < len(tracks) and self._pair_allowed(tracks[orig_track], act):
                    chosen_track = orig_track
                    chosen_animal = tracks[orig_track]
                else:
                    matched = next((idx for idx, name in enumerate(tracks) if self._pair_allowed(name, act)), -1)
                    if matched >= 0:
                        chosen_track = matched
                        chosen_animal = tracks[matched]
                    else:
                        chosen_track = cand_track
                        chosen_animal = cand_animal
            elif tracks:
                if 0 <= orig_track < len(tracks) and self._pair_allowed(tracks[orig_track], act):
                    chosen_track = orig_track
                    chosen_animal = tracks[orig_track]
                else:
                    matched = next((idx for idx, name in enumerate(tracks) if self._pair_allowed(name, act)), -1)
                    if matched >= 0:
                        chosen_track = matched
                        chosen_animal = tracks[matched]
                    elif 0 <= orig_track < len(tracks):
                        chosen_track = orig_track
                        chosen_animal = tracks[orig_track]
                    else:
                        chosen_track = 0
                        chosen_animal = tracks[0]
            else:
                chosen_track = 0

            offset = round_seconds(item["start"] - min_start)
            duration = round_seconds(max(0.001, item["end"] - item["start"]))
            resolved_specs.append((chosen_track, chosen_animal, act, offset, duration))

        if anchor_time is not None and math.isfinite(anchor_time):
            base_start = round_seconds(max(0.0, float(anchor_time)))
        else:
            base_start = min_start

        if avoid_self_overlap:
            step_gap = round_seconds(max(0.04, 1.0 / (self.fps if self.fps > 0 else 25.0)))
            for _attempt in range(50):
                conflict_end: float | None = None
                for chosen_track, chosen_animal, act, offset, duration in resolved_specs:
                    cand_s = round_seconds(base_start + offset)
                    cand_e = round_seconds(cand_s + duration)
                    for existing in self.segments:
                        if (
                            existing.track_index == chosen_track
                            and existing.animal == chosen_animal
                            and existing.action == act
                            and cand_s <= existing.end + 1e-4
                            and cand_e >= existing.start - 1e-4
                        ):
                            conflict_end = (
                                existing.end
                                if conflict_end is None
                                else max(conflict_end, existing.end)
                            )
                if conflict_end is None:
                    break
                base_start = round_seconds(conflict_end + step_gap)

        self.push_history()
        created_segments: list[Segment] = []
        for chosen_track, chosen_animal, act, offset, duration in resolved_specs:
            if not self._pair_allowed(chosen_animal, act):
                self.labels.append((chosen_animal, act))
                if chosen_animal not in self.list_animal:
                    self.list_animal.append(chosen_animal)
            seg_start = round_seconds(max(0.0, base_start + offset))
            seg_end = round_seconds(seg_start + duration)
            seg = Segment(
                uuid.uuid4().hex[:12],
                chosen_animal,
                act,
                seg_start,
                seg_end,
                track_index=chosen_track,
            )
            self.segments.append(seg)
            created_segments.append(seg)

        did_merge = False
        final_ids: list[str] = []
        affected_groups = list({(s.track_index, s.animal, s.action) for s in created_segments})
        merged_map: dict[str, str] = {s.id: s.id for s in created_segments}
        for track_idx, animal_name, act_name in affected_groups:
            for created in [s for s in created_segments if (s.track_index, s.animal, s.action) == (track_idx, animal_name, act_name)]:
                merged_seg, merged = self._merge_overlapping_segments(
                    target_track=track_idx,
                    animal=animal_name,
                    action=act_name,
                    preferred_id=created.id,
                )
                if merged:
                    did_merge = True
                merged_map[created.id] = merged_seg.id

        for s in created_segments:
            mid = merged_map.get(s.id, s.id)
            if mid and mid not in final_ids and any(item.id == mid for item in self.segments):
                final_ids.append(mid)

        self.selected_segment_ids = final_ids
        self.active_segment_id = final_ids[-1] if final_ids else None
        if self.active_segment_id:
            active_seg = next((item for item in self.segments if item.id == self.active_segment_id), None)
            if active_seg:
                self.selected_key = label_key(active_seg.animal, active_seg.action)
                self.selected_action = active_seg.action
                self.selected_track_index = active_seg.track_index

        pasted_objs = [item for item in self.segments if item.id in set(final_ids)]
        return pasted_objs, did_merge

    def change_segment_action(self, segment_id: str, action: str, *, record: bool = True) -> bool:
        segment = next((item for item in self.segments if item.id == segment_id), None)
        if segment is None:
            raise ValueError("找不到这段区间。")
        action = str(action).strip()
        self._require_pair(segment.animal, action)
        if action == segment.action:
            return False
        if record:
            self.push_history()
        segment.action = action
        merged, _ = self._merge_overlapping_segments(
            target_track=segment.track_index, animal=segment.animal,
            action=action, preferred_id=segment.id,
        )
        self.active_segment_id = merged.id
        self.selected_segment_ids = [merged.id]
        self.selected_track_index = merged.track_index
        self.selected_action = action
        self.selected_key = label_key(segment.animal, action)
        return True

    def update_segment(self, segment_id: str, start: float, end: float, *, record: bool) -> None:
        start = round_seconds(start)
        end = round_seconds(end)
        if end <= start:
            raise ValueError("结束时间必须晚于开始时间。")
        if start < 0:
            raise ValueError("时间不能为负。")
        if record:
            self.push_history()
        for item in self.segments:
            if item.id == segment_id:
                item.start = start
                item.end = end
                merged_seg, _ = self._merge_overlapping_segments(
                    target_track=item.track_index,
                    animal=item.animal,
                    action=item.action,
                    preferred_id=item.id,
                )
                if self.active_segment_id == segment_id:
                    self.active_segment_id = merged_seg.id
                if segment_id in self.selected_segment_ids:
                    self.selected_segment_ids = list(
                        dict.fromkeys(
                            merged_seg.id if sid == segment_id else sid
                            for sid in self.selected_segment_ids
                        )
                    )
                self._keep_selection()
                return
        raise ValueError("找不到这段区间。")

    def add_custom(self, animal: str, action: str) -> None:
        animal = animal.strip()
        action = action.strip()
        if not animal or not action:
            raise ValueError("动物和行为都要填。")
        if any(pair == (animal, action) for pair in self.labels):
            self.selected_key = label_key(animal, action)
            self.selected_action = action
            raise ValueError("这个标签已经在清单里。")
        self.push_history()
        self.labels.append((animal, action))
        if animal not in self.list_animal:
            self.list_animal.append(animal)
        self.selected_key = label_key(animal, action)
        self.selected_action = action

    def selected_pair(self) -> LabelPair:
        for animal, action in self.labels:
            if label_key(animal, action) == self.selected_key:
                return animal, action
        if self.labels:
            return self.labels[0]
        raise ValueError("请先在右侧选择一个标签。")

    def segments_for_selected(self) -> list[Segment]:
        if not self.selected_key:
            return []
        animal, action = self.selected_pair()
        return sorted(
            [item for item in self.segments if item.animal == animal and item.action == action],
            key=lambda item: item.start,
        )

    def done_count(self) -> int:
        done = {label_key(item.animal, item.action) for item in self.segments}
        return sum(1 for animal, action in self.labels if label_key(animal, action) in done)

    def export_document(self) -> dict:
        return build_export(self.video_name.strip() or "untitled.mp4", self.labels, self.segments, self.fps)

    def export_preprocessed_document(self) -> dict:
        video_name = self.video_name.strip() or "untitled.mp4"
        vid = self.video_id.strip() or Path(video_name).stem
        return build_preprocessed_export(
            video=video_name,
            video_id=vid,
            list_animal=self.animal_tracks(),
            list_animal_action=self.labels,
            segments=self.segments,
            fps=self.fps,
        )

    def _keep_selection(self) -> None:
        keys = {label_key(animal, action) for animal, action in self.labels}
        if self.selected_key not in keys:
            self.selected_key = label_key(*self.labels[0]) if self.labels else None
        if self.selected_key:
            pair = self.selected_pair()
            self.selected_action = pair[1]
        else:
            self.selected_action = None
        tracks = self.animal_tracks()
        if not tracks:
            self.selected_track_index = 0
        elif self.selected_track_index < 0 or self.selected_track_index >= len(tracks):
            self.selected_track_index = 0
        valid_ids = {item.id for item in self.segments}
        self.selected_segment_ids = [
            sid for sid in dict.fromkeys(self.selected_segment_ids) if sid in valid_ids
        ]
        if self.active_segment_id and self.active_segment_id not in valid_ids:
            self.active_segment_id = (
                self.selected_segment_ids[-1] if self.selected_segment_ids else None
            )
        elif self.active_segment_id and self.active_segment_id not in self.selected_segment_ids:
            self.selected_segment_ids.append(self.active_segment_id)
        elif not self.active_segment_id and self.selected_segment_ids:
            self.active_segment_id = self.selected_segment_ids[-1]
