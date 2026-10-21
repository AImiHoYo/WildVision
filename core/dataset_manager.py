"""Dataset archive extraction, preprocessed JSON initialization, and Animal Kingdom batch export."""

from __future__ import annotations

import ast
import csv
import io
import json
import shutil
import tarfile
import zipfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from storage import atomic_write_text

from labels import (
    LabelPair,
    frame_index,
    round_seconds,
)

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
LABEL_EXTENSIONS = {".json", ".csv", ".txt"}

DEFAULT_PREPROCESSED_SAMPLES = [
    {
        "video_id": "AAACXZTV",
        "list_animal": ["Common Crane", "Common Crane"],
        "list_animal_action": [
            ["Common Crane", "Attending"],
            ["Common Crane", "Eating"],
        ],
    },
    {
        "video_id": "AABCQPTK",
        "list_animal": ["Singing Nightingale", "Singing Nightingale"],
        "list_animal_action": [
            ["Singing Nightingale", "Attending"],
            ["Singing Nightingale", "Chirping"],
        ],
    },
]

# In-memory O(1) workspace index cache for 100,000+ video sample scalability:
# Key: str(workspace_dir.resolve()) -> {"mtime_ns": int, "payload": dict, "by_id": dict[str, dict]}
_WORKSPACE_CACHE: dict[str, dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _now_timestamp_14() -> str:
    """Return local timestamp formatted as YYYYMMDDHHMMSS (e.g. 20261018160701)."""
    return datetime.now().strftime("%Y%m%d%H%M%S")


def _clean_quotes(raw: str) -> str:
    return (
        raw.strip()
        .replace("‘", "'")
        .replace("’", "'")
        .replace("“", '"')
        .replace("”", '"')
    )


def parse_py_list(raw: str | list | None) -> list:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    cleaned = _clean_quotes(str(raw))
    if not cleaned:
        return []
    try:
        val = ast.literal_eval(cleaned)
        return list(val) if isinstance(val, (list, tuple)) else [val]
    except Exception:
        try:
            val = json.loads(cleaned)
            return list(val) if isinstance(val, list) else []
        except Exception:
            return []


def normalize_preprocessed_doc(
    doc: dict,
    *,
    fallback_video_id: str = "",
    matched_video_name: str | None = None,
    fps: float = 25.0,
) -> dict:
    """Normalize any preprocessed or legacy JSON into the standard Animal Kingdom schema."""
    video_name = str(matched_video_name or doc.get("video") or "")
    vid = str(doc.get("video_id") or (Path(video_name).stem if video_name else fallback_video_id)).strip()
    if not video_name and vid:
        video_name = f"{vid}.mp4"

    use_fps = float(doc.get("fps") or fps or 25.0)

    raw_pairs = doc.get("list_animal_action") or doc.get("source_labels") or []
    parsed_pairs = parse_py_list(raw_pairs)
    list_animal_action: list[list[str]] = []
    seen_pairs: set[tuple[str, str]] = set()
    for pair in parsed_pairs:
        if isinstance(pair, (list, tuple)) and len(pair) >= 2:
            a, act = str(pair[0]).strip(), str(pair[1]).strip()
            if a and act and (a, act) not in seen_pairs:
                seen_pairs.add((a, act))
                list_animal_action.append([a, act])

    raw_animals = doc.get("list_animal")
    parsed_animals = [str(a).strip() for a in parse_py_list(raw_animals) if str(a).strip()]
    if not parsed_animals:
        seen_a: list[str] = []
        for a, _ in list_animal_action:
            if a not in seen_a:
                seen_a.append(a)
        parsed_animals = seen_a if seen_a else ["Common Crane"]

    raw_annotations = doc.get("annotations") or []
    grouped_annotations: list[dict] = [
        {"animal": animal_name, "actions": []} for animal_name in parsed_animals
    ]

    if isinstance(raw_annotations, list) and raw_annotations:
        first = raw_annotations[0]
        if isinstance(first, dict) and ("actions" in first or "segments" in first):
            grouped_annotations = []
            for idx, track_obj in enumerate(raw_annotations):
                if not isinstance(track_obj, dict):
                    continue
                animal_name = str(
                    track_obj.get("animal")
                    or (parsed_animals[idx] if idx < len(parsed_animals) else parsed_animals[0])
                )
                raw_acts = track_obj.get("actions") if "actions" in track_obj else track_obj.get("segments", [])
                clean_acts: list[dict] = []
                for act_item in raw_acts or []:
                    if not isinstance(act_item, dict):
                        continue
                    act_name = str(act_item.get("action") or "").strip()
                    start = round_seconds(float(act_item.get("start", 0.0)))
                    end = round_seconds(float(act_item.get("end", 0.0)))
                    if end < start:
                        start, end = end, start
                    if not act_name or end <= start:
                        continue
                    clean_acts.append(
                        {
                            "action": act_name,
                            "start": start,
                            "end": end,
                            "start_frame": int(act_item.get("start_frame", frame_index(start, use_fps))),
                            "end_frame": int(act_item.get("end_frame", frame_index(end, use_fps))),
                        }
                    )
                clean_acts.sort(key=lambda x: (x["start"], x["end"]))
                grouped_annotations.append({"animal": animal_name, "actions": clean_acts})
            while len(grouped_annotations) < len(parsed_animals):
                grouped_annotations.append(
                    {"animal": parsed_animals[len(grouped_annotations)], "actions": []}
                )
        else:
            for seg in raw_annotations:
                if not isinstance(seg, dict):
                    continue
                animal_name = str(seg.get("animal") or "").strip()
                act_name = str(seg.get("action") or "").strip()
                track_idx = int(seg.get("track_index", -1))
                start = round_seconds(float(seg.get("start", 0.0)))
                end = round_seconds(float(seg.get("end", 0.0)))
                if end < start:
                    start, end = end, start
                if not act_name or end <= start:
                    continue
                target_idx = 0
                if 0 <= track_idx < len(grouped_annotations):
                    target_idx = track_idx
                else:
                    for idx, track in enumerate(grouped_annotations):
                        if track["animal"] == animal_name:
                            target_idx = idx
                            break
                grouped_annotations[target_idx]["actions"].append(
                    {
                        "action": act_name,
                        "start": start,
                        "end": end,
                        "start_frame": int(seg.get("start_frame", frame_index(start, use_fps))),
                        "end_frame": int(seg.get("end_frame", frame_index(end, use_fps))),
                    }
                )

    return {
        "video_id": vid,
        "video": video_name,
        "fps": int(use_fps) if use_fps.is_integer() else use_fps,
        "list_animal": parsed_animals,
        "list_animal_action": list_animal_action,
        "source_labels": list_animal_action,
        "annotations": grouped_annotations,
    }


def flatten_grouped_annotations(doc: dict) -> list[dict]:
    """Convert grouped per-animal-track annotations into flat segments with track_index for UI/QC compatibility."""
    norm = doc if ("annotations" in doc and "list_animal_action" in doc and "video_id" in doc) else normalize_preprocessed_doc(doc)
    flat: list[dict] = []
    counter = 1
    for track_idx, track in enumerate(norm["annotations"]):
        animal_name = track["animal"]
        for act in track.get("actions", []):
            flat.append(
                {
                    "id": f"s{counter}",
                    "track_index": track_idx,
                    "animal": animal_name,
                    "action": act["action"],
                    "start": float(act["start"]),
                    "end": float(act["end"]),
                    "start_frame": int(act["start_frame"]),
                    "end_frame": int(act["end_frame"]),
                }
            )
            counter += 1
    return flat


def build_grouped_export(
    video_id: str,
    video_name: str,
    list_animal: list[str],
    list_animal_action: list[list[str]],
    flat_segments: list[dict],
    fps: float = 25.0,
) -> dict:
    """Build the standardized JSON where user annotations only update the 'annotations' key grouped per animal track."""
    animals = list(list_animal) if list_animal else ["Common Crane"]
    tracks: list[dict] = [{"animal": animal_name, "actions": []} for animal_name in animals]

    for seg in flat_segments:
        t_idx = int(seg.get("track_index", -1))
        animal = str(seg.get("animal", ""))
        action = str(seg.get("action", ""))
        start = round_seconds(float(seg.get("start", 0.0)))
        end = round_seconds(float(seg.get("end", 0.0)))
        if end < start:
            start, end = end, start
        if end <= start or not action:
            continue

        if not (0 <= t_idx < len(tracks)):
            t_idx = 0
            for idx, tr in enumerate(tracks):
                if tr["animal"] == animal:
                    t_idx = idx
                    break

        tracks[t_idx]["actions"].append(
            {
                "action": action,
                "start": start,
                "end": end,
                "start_frame": frame_index(start, fps),
                "end_frame": frame_index(end, fps),
            }
        )

    for tr in tracks:
        tr["actions"].sort(key=lambda item: (item["start"], item["end"]))

    vid = video_id.strip() or (Path(video_name).stem if video_name else "")
    return {
        "video_id": vid,
        "video": video_name or f"{vid}.mp4",
        "fps": int(fps) if float(fps).is_integer() else float(fps),
        "list_animal": animals,
        "list_animal_action": list_animal_action,
        "source_labels": list_animal_action,
        "annotations": tracks,
    }


def _compute_card_stats(doc: dict) -> tuple[int, int, int, str]:
    norm = doc if ("annotations" in doc and "list_animal_action" in doc and "video_id" in doc) else normalize_preprocessed_doc(doc)
    pairs = norm["list_animal_action"]
    tracks = norm["annotations"]
    segment_count = sum(len(tr.get("actions", [])) for tr in tracks)
    marked_actions = {
        (tr["animal"], act["action"])
        for tr in tracks
        for act in tr.get("actions", [])
    }
    label_count = len(pairs)
    done_count = sum(1 for a, act in pairs if (a, act) in marked_actions)
    if segment_count <= 0:
        status = "unstarted"
    elif label_count > 0 and done_count >= label_count:
        status = "completed"
    else:
        status = "in_progress"
    return label_count, done_count, segment_count, status


def _discover_preprocessed_records(folder: Path) -> dict[str, dict]:
    """Scan folder for preprocessed JSONs or 3-column metadata tables (video_id | list_animal_action | list_animal)."""
    records: dict[str, dict] = {}

    for path in sorted(folder.rglob("*")):
        if not path.is_file() or path.name.startswith("._") or "__MACOSX" in path.parts:
            continue
        if path.name.lower() in {"dataset_index.json", "merged_annotations.json"}:
            continue
        if path.suffix.lower() == ".json":
            try:
                data = json.loads(path.read_text(encoding="utf-8-sig"))
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and (item.get("video_id") or item.get("video")):
                            norm = normalize_preprocessed_doc(item)
                            records[norm["video_id"]] = norm
                elif isinstance(data, dict) and (
                    "video_id" in data or "list_animal_action" in data or "source_labels" in data
                ):
                    stem = path.stem[:-3] if path.stem.endswith(".ar") else path.stem
                    norm = normalize_preprocessed_doc(data, fallback_video_id=stem)
                    records[norm["video_id"]] = norm
            except Exception:
                continue
        elif path.suffix.lower() in {".csv", ".txt", ".tsv"}:
            try:
                text = path.read_text(encoding="utf-8-sig").strip()
                lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
                if not lines:
                    continue
                first_line = lines[0].replace("｜", "|")
                if "video_id" in first_line and "list_animal" in first_line:
                    delim = "|" if "|" in first_line else ("\t" if "\t" in first_line else ",")
                    if delim == "|":
                        for ln in lines[1:]:
                            parts = [p.strip() for p in ln.replace("｜", "|").split("|")]
                            if len(parts) >= 3:
                                norm = normalize_preprocessed_doc(
                                    {
                                        "video_id": parts[0],
                                        "list_animal_action": parts[1],
                                        "list_animal": parts[2],
                                    }
                                )
                                records[norm["video_id"]] = norm
                    else:
                        for row in csv.DictReader(lines, delimiter=delim):
                            vid = (row.get("video_id") or "").strip()
                            if vid:
                                norm = normalize_preprocessed_doc(
                                    {
                                        "video_id": vid,
                                        "list_animal_action": row.get("list_animal_action") or "[]",
                                        "list_animal": row.get("list_animal") or "[]",
                                    }
                                )
                                records[norm["video_id"]] = norm
            except Exception:
                continue

    return records


def _write_card_json_files(annotations_dir: Path, vid: str, norm_doc: dict) -> Path:
    """Write standardized <video_id>.json and remove any duplicate legacy <video_id>.ar.json."""
    annotations_dir.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(norm_doc, ensure_ascii=False, indent=2) + "\n"
    primary = annotations_dir / f"{vid}.json"
    atomic_write_text(primary, serialized)
    legacy = annotations_dir / f"{vid}.ar.json"
    if legacy.is_file():
        legacy.unlink(missing_ok=True)
    return primary


MAX_ARCHIVE_TOTAL_BYTES = 20 * 1024 * 1024 * 1024  # 20 GB safety ceiling


def _persist_index_payload(
    workspace_dir: Path,
    index_payload: dict,
    *,
    existing_by_id: dict[str, dict] | None = None,
) -> dict:
    """Persist dataset_index.json efficiently and update the O(1) in-memory cache."""
    workspace_dir = workspace_dir.resolve()
    index_path = workspace_dir / "dataset_index.json"
    items = index_payload.get("items", [])
    if len(items) > 1000:
        serialized = json.dumps(index_payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    else:
        serialized = json.dumps(index_payload, ensure_ascii=False, indent=2) + "\n"
    atomic_write_text(index_path, serialized)
    try:
        mtime_ns = index_path.stat().st_mtime_ns
    except OSError:
        mtime_ns = 0
    by_id = (
        existing_by_id
        if existing_by_id is not None
        else {str(item.get("video_id", "")): item for item in items if item.get("video_id")}
    )
    _WORKSPACE_CACHE[str(workspace_dir)] = {
        "mtime_ns": mtime_ns,
        "payload": index_payload,
        "by_id": by_id,
    }
    return index_payload


def initialize_workspace(
    workspace_dir: Path,
    *,
    dataset_name: str | None = None,
    default_labels: list[LabelPair] | None = None,
) -> dict:
    """Initialize workspace by matching video_id in preprocessed JSONs with actual video files."""
    workspace_dir = workspace_dir.resolve()
    annotations_dir = workspace_dir / "annotations"
    exports_dir = workspace_dir / "exports"
    annotations_dir.mkdir(parents=True, exist_ok=True)
    exports_dir.mkdir(parents=True, exist_ok=True)

    discovered_records = _discover_preprocessed_records(workspace_dir)

    video_map: dict[str, Path] = {}
    for path in sorted(workspace_dir.rglob("*")):
        if not path.is_file() or path.name.startswith("._") or "__MACOSX" in path.parts:
            continue
        if "exports" in path.relative_to(workspace_dir).parts:
            continue
        if path.suffix.lower() in VIDEO_EXTENSIONS:
            if path.stem not in video_map:
                video_map[path.stem] = path

    all_video_ids = list(dict.fromkeys([*discovered_records.keys(), *video_map.keys()]))
    items: list[dict] = []

    fallback_pairs = [[a, act] for a, act in (default_labels or [("Common Crane", "Attending"), ("Common Crane", "Eating")])]
    now_str = _now_iso()

    for vid in all_video_ids:
        matched_video = video_map.get(vid)
        video_matched = matched_video is not None
        video_name = matched_video.name if matched_video is not None else f"{vid}.mp4"
        video_relpath = (
            str(matched_video.relative_to(workspace_dir).as_posix())
            if matched_video is not None
            else f"videos/{video_name}"
        )

        existing_doc: dict | None = None
        for candidate in (annotations_dir / f"{vid}.json", annotations_dir / f"{vid}.ar.json"):
            if candidate.is_file():
                try:
                    existing_doc = json.loads(candidate.read_text(encoding="utf-8-sig"))
                    break
                except Exception:
                    existing_doc = None

        base_doc = existing_doc or discovered_records.get(vid) or {
            "video_id": vid,
            "video": video_name,
            "list_animal": [fallback_pairs[0][0]],
            "list_animal_action": fallback_pairs,
            "annotations": [],
        }
        norm_doc = normalize_preprocessed_doc(
            base_doc,
            fallback_video_id=vid,
            matched_video_name=video_name,
        )
        ann_path = _write_card_json_files(annotations_dir, vid, norm_doc)

        label_count, done_count, segment_count, status = _compute_card_stats(norm_doc)
        items.append(
            {
                "video_id": vid,
                "video_name": video_name,
                "video_matched": video_matched,
                "video_relpath": video_relpath,
                "annotation_relpath": str(ann_path.relative_to(workspace_dir).as_posix()),
                "fps": norm_doc["fps"],
                "list_animal": norm_doc["list_animal"],
                "list_animal_action": norm_doc["list_animal_action"],
                "segments": flatten_grouped_annotations(norm_doc),
                "label_count": label_count,
                "done_count": done_count,
                "segment_count": segment_count,
                "status": status,
                "updated_at": now_str,
            }
        )

    index_payload = {
        "dataset_name": dataset_name or workspace_dir.name,
        "workspace_dir": str(workspace_dir),
        "created_at": now_str,
        "items": items,
    }
    return _persist_index_payload(workspace_dir, index_payload)


def default_datasets_root() -> Path:
    """Resolve the software's canonical datasets/ folder across source and packaged builds."""
    import sys

    candidates: list[Path] = []
    if getattr(sys, "frozen", False):
        candidates.append(Path.home() / ".wildvision" / "datasets")
    repo_dir = Path(__file__).resolve().parents[1]
    if not getattr(sys, "frozen", False):
        candidates.append(repo_dir / "datasets")

    for cand in candidates:
        try:
            cand.mkdir(parents=True, exist_ok=True)
            return cand.resolve()
        except OSError:
            continue

    fallback = Path.home() / ".wildvision" / "datasets"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback.resolve()


def _resolve_archive_member_dest(workspace_dir: Path, rel_parts: list[str]) -> Path | None:
    """Map archive member path into workspace_dir without double-nesting videos/videos or videos/annotations."""
    if any(p == ".." or "\\" in p or ":" in p or p.startswith("/") for p in rel_parts):
        raise ValueError("压缩包包含不安全路径，已停止导入。")
    parts = [p for p in rel_parts if p not in ("", ".")]
    if not parts:
        return None
    reserved = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
    if any(p.endswith((" ", ".")) or p.split(".", 1)[0].casefold() in reserved for p in parts):
        raise ValueError("压缩包包含跨平台不安全文件名，已停止导入。")
    # Strip optional single top-level wrapper folder if it contains videos/ or annotations/
    if (
        len(parts) >= 2
        and parts[0].lower() not in ("videos", "annotations", "exports")
        and (
            parts[1].lower() in ("videos", "annotations")
            or parts[-1].lower() == "dataset_preprocessed.json"
        )
    ):
        parts = parts[1:]

    first_lower = parts[0].lower()
    suffix_lower = Path(parts[-1]).suffix.lower()
    if first_lower in ("videos", "annotations"):
        dest = workspace_dir.joinpath(*parts).resolve()
    elif suffix_lower in VIDEO_EXTENSIONS:
        dest = (workspace_dir / "videos").joinpath(*parts).resolve()
    elif suffix_lower == ".json" and parts[-1].lower() not in ("dataset_preprocessed.json", "dataset_index.json"):
        dest = (workspace_dir / "annotations").joinpath(*parts).resolve()
    else:
        dest = workspace_dir.joinpath(*parts).resolve()

    if not dest.is_relative_to(workspace_dir):
        return None
    return dest


def import_dataset_archive(
    archive_path: Path,
    extract_root: Path | None = None,
    *,
    default_labels: list[LabelPair] | None = None,
) -> dict:
    archive_path = archive_path.resolve()
    if not archive_path.is_file():
        raise FileNotFoundError(f"找不到压缩包文件：{archive_path}")

    stem = archive_path.name
    for suffix in (".tar.gz", ".tgz", ".tar", ".zip"):
        if stem.lower().endswith(suffix):
            stem = stem[: -len(suffix)]
            break

    ds_root = default_datasets_root()
    base_root = extract_root.resolve() if extract_root is not None else ds_root
    if base_root == ds_root:
        folder_name = f"{stem}_{_now_timestamp_14()}"
        workspace_dir = (base_root / folder_name).resolve()
    else:
        workspace_dir = (
            base_root / f"{stem}_workspace"
            if base_root.name not in (f"{stem}_workspace", "workspace")
            else base_root
        ).resolve()

    # Reimport must never overwrite an existing workspace or its annotations.
    if workspace_dir.exists():
        workspace_dir = workspace_dir.with_name(f"{workspace_dir.name}_{uuid.uuid4().hex[:8]}")

    workspace_dir.mkdir(parents=True, exist_ok=False)
    try:
        (workspace_dir / "videos").mkdir(parents=True, exist_ok=True)
        (workspace_dir / "annotations").mkdir(parents=True, exist_ok=True)
        total_extracted = 0
        destinations: set[str] = set()

        def claim_destination(dest: Path) -> None:
            # Case-fold to avoid aliases on Windows/macOS, even when tested on Linux.
            key = str(dest.relative_to(workspace_dir)).casefold()
            if key in destinations:
                raise ValueError("压缩包包含重复目标文件，已停止导入。")
            destinations.add(key)

        lower_name = archive_path.name.lower()
        if lower_name.endswith(".zip"):
            with zipfile.ZipFile(archive_path, "r") as zf:
                for member in zf.infolist():
                    if member.is_dir() or "__MACOSX" in member.filename or Path(member.filename).name.startswith("._"):
                        continue
                    if ((member.external_attr >> 16) & 0o170000) == 0o120000:
                        continue
                    dest = _resolve_archive_member_dest(workspace_dir, list(Path(member.filename).parts))
                    if dest is None:
                        continue
                    claim_destination(dest)
                    total_extracted += max(0, int(member.file_size))
                    if total_extracted > MAX_ARCHIVE_TOTAL_BYTES:
                        raise ValueError("压缩包解压总大小超出安全上限（20GB）。")
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(member, "r") as src, dest.open("wb") as dst:
                        shutil.copyfileobj(src, dst)
        elif lower_name.endswith((".tar.gz", ".tgz", ".tar")):
            with tarfile.open(archive_path, "r:*") as tf:
                for member in tf.getmembers():
                    if (
                        not member.isfile()
                        or member.issym()
                        or member.islnk()
                        or "__MACOSX" in member.name
                        or Path(member.name).name.startswith("._")
                    ):
                        continue
                    dest = _resolve_archive_member_dest(workspace_dir, list(Path(member.name).parts))
                    if dest is None:
                        continue
                    claim_destination(dest)
                    total_extracted += max(0, int(member.size))
                    if total_extracted > MAX_ARCHIVE_TOTAL_BYTES:
                        raise ValueError("压缩包解压总大小超出安全上限（20GB）。")
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    extracted = tf.extractfile(member)
                    if extracted is not None:
                        with extracted, dest.open("wb") as dst:
                            shutil.copyfileobj(extracted, dst)
        else:
            raise ValueError("仅支持 .zip、.tar、.tar.gz 或 .tgz 格式的数据集压缩包。")

        ds_label = workspace_dir.name if base_root == ds_root else stem
        return initialize_workspace(workspace_dir, dataset_name=ds_label, default_labels=default_labels)
    except Exception:
        _WORKSPACE_CACHE.pop(str(workspace_dir), None)
        shutil.rmtree(workspace_dir)
        raise


def create_demo_dataset_workspace(repo_root: Path) -> dict:
    """Create a sample preprocessed Animal Kingdom dataset workspace with AAACXZTV and AABCQPTK."""
    sample_video = repo_root / "public" / "sample_ak.mp4"
    base_datasets = default_datasets_root()
    workspace_dir = base_datasets / "AK_Preprocessed_Demo"
    videos_dir = workspace_dir / "videos"
    annotations_dir = workspace_dir / "annotations"
    videos_dir.mkdir(parents=True, exist_ok=True)
    annotations_dir.mkdir(parents=True, exist_ok=True)

    for sample in DEFAULT_PREPROCESSED_SAMPLES:
        vid = sample["video_id"]
        target_video = videos_dir / f"{vid}.mp4"
        if sample_video.is_file() and not target_video.is_file():
            shutil.copy2(sample_video, target_video)
        ann_file = annotations_dir / f"{vid}.json"
        if not ann_file.is_file():
            norm = normalize_preprocessed_doc(sample, fallback_video_id=vid, matched_video_name=f"{vid}.mp4")
            _write_card_json_files(annotations_dir, vid, norm)

    return initialize_workspace(workspace_dir, dataset_name="AK_Preprocessed_Demo")


def import_dataset_folder(source_folder: Path) -> dict:
    """Import an external dataset folder into datasets/<folder_name>_<YYYYMMDDHHMMSS>, or load in place if already in datasets/."""
    src = source_folder.expanduser().resolve()
    if not src.is_dir():
        raise FileNotFoundError(f"找不到文件夹：{src}")
    ds_root = default_datasets_root()
    if src.parent == ds_root:
        payload = load_workspace_index(src)
        if not payload.get("items"):
            payload = initialize_workspace(src, dataset_name=src.name)
        return payload

    # Strip existing _YYYYMMDDHHMMSS or _workspace suffix from source folder name if re-importing
    import re
    base_name = re.sub(r"(_workspace|_\d{14})$", "", src.name) or src.name
    folder_name = f"{base_name}_{_now_timestamp_14()}"
    dest_ws = (ds_root / folder_name).resolve()
    if dest_ws.exists():
        dest_ws = dest_ws.with_name(f"{dest_ws.name}_{uuid.uuid4().hex[:8]}")
    dest_ws.mkdir(parents=True, exist_ok=False)

    for item in src.iterdir():
        if item.name.startswith(".") or item.name in ("__MACOSX", "exports", "dataset_index.json"):
            continue
        target = dest_ws / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        elif item.is_file():
            if item.suffix.lower() in VIDEO_EXTENSIONS:
                vids_dir = dest_ws / "videos"
                vids_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, vids_dir / item.name)
            elif item.suffix.lower() == ".json" and item.name.lower() != "dataset_preprocessed.json":
                anns_dir = dest_ws / "annotations"
                anns_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, anns_dir / item.name)
            else:
                shutil.copy2(item, target)

    return initialize_workspace(dest_ws, dataset_name=folder_name)


def list_available_datasets() -> list[dict]:
    """List all dataset workspaces under default_datasets_root()."""
    ds_root = default_datasets_root()
    results: list[tuple[float, dict]] = []
    if not ds_root.is_dir():
        return []
    for sub in ds_root.iterdir():
        if not sub.is_dir() or sub.name.startswith("."):
            continue
        has_index = (sub / "dataset_index.json").is_file()
        has_media = (sub / "videos").is_dir() or (sub / "annotations").is_dir()
        if not has_index and not has_media:
            continue
        try:
            payload = load_workspace_index(sub)
            items = payload.get("items", [])
            completed = sum(1 for it in items if it.get("status") == "completed")
            mtime = (sub / "dataset_index.json").stat().st_mtime if (sub / "dataset_index.json").is_file() else sub.stat().st_mtime
            results.append(
                (
                    mtime,
                    {
                        "folder_name": sub.name,
                        "dataset_name": sub.name,
                        "workspace_dir": str(sub.resolve()),
                        "video_count": len(items),
                        "completed_count": completed,
                        "updated_at": payload.get("created_at", ""),
                    },
                )
            )
        except Exception:
            continue
    results.sort(key=lambda pair: pair[0], reverse=True)
    return [entry for _, entry in results]


def load_workspace_index(workspace_dir: Path, *, verify_files: bool = False) -> dict:
    """Load dataset_index.json with O(1) in-memory caching.

    Avoids re-scanning and re-parsing 100,000+ annotation files on every card read/save.
    """
    workspace_dir = workspace_dir.resolve()
    ws_key = str(workspace_dir)
    index_path = workspace_dir / "dataset_index.json"
    if not index_path.is_file():
        return initialize_workspace(workspace_dir)

    try:
        mtime_ns = index_path.stat().st_mtime_ns
    except OSError:
        mtime_ns = 0

    if not verify_files and ws_key in _WORKSPACE_CACHE:
        cached = _WORKSPACE_CACHE[ws_key]
        if cached["mtime_ns"] == mtime_ns and mtime_ns > 0:
            return cached["payload"]

    try:
        index_payload = json.loads(index_path.read_text(encoding="utf-8-sig"))
    except Exception:
        return initialize_workspace(workspace_dir)

    items = index_payload.get("items", [])
    needs_persist = False

    if verify_files:
        for item in items:
            vid = item["video_id"]
            ann_path = workspace_dir / item.get("annotation_relpath", f"annotations/{vid}.json")
            if not ann_path.is_file():
                alt = workspace_dir / f"annotations/{vid}.ar.json"
                if alt.is_file():
                    ann_path = alt
            vid_path = workspace_dir / item.get("video_relpath", f"videos/{item.get('video_name', f'{vid}.mp4')}")
            item["video_matched"] = vid_path.is_file() and vid_path.stem == vid
            if ann_path.is_file():
                try:
                    doc = json.loads(ann_path.read_text(encoding="utf-8-sig"))
                    norm = normalize_preprocessed_doc(doc, fallback_video_id=vid)
                    label_count, done_count, segment_count, status = _compute_card_stats(norm)
                    item["list_animal"] = norm["list_animal"]
                    item["list_animal_action"] = norm["list_animal_action"]
                    item["segments"] = flatten_grouped_annotations(norm)
                    item["label_count"] = label_count
                    item["done_count"] = done_count
                    item["segment_count"] = segment_count
                    item["status"] = status
                except Exception:
                    pass
        needs_persist = True
    else:
        for item in items:
            if "status" not in item or "label_count" not in item:
                pairs = item.get("list_animal_action") or []
                segs = item.get("segments") or []
                label_count = len(pairs)
                marked = {(s.get("animal"), s.get("action")) for s in segs if isinstance(s, dict)}
                done_count = sum(1 for p in pairs if len(p) >= 2 and (p[0], p[1]) in marked)
                segment_count = len(segs)
                item["label_count"] = label_count
                item["done_count"] = done_count
                item["segment_count"] = segment_count
                item["status"] = (
                    "unstarted"
                    if segment_count <= 0
                    else ("completed" if label_count > 0 and done_count >= label_count else "in_progress")
                )

    if needs_persist:
        return _persist_index_payload(workspace_dir, index_payload)

    by_id = {str(item.get("video_id", "")): item for item in items if item.get("video_id")}
    _WORKSPACE_CACHE[ws_key] = {
        "mtime_ns": mtime_ns,
        "payload": index_payload,
        "by_id": by_id,
    }
    return index_payload


def get_workspace_card(workspace_dir: Path, video_id: str) -> dict | None:
    """O(1) lookup of a single card item in the workspace index."""
    workspace_dir = workspace_dir.resolve()
    ws_key = str(workspace_dir)
    if ws_key not in _WORKSPACE_CACHE:
        load_workspace_index(workspace_dir)
    cached = _WORKSPACE_CACHE.get(ws_key)
    if cached and "by_id" in cached:
        return cached["by_id"].get(video_id)
    return None


def save_card_document(workspace_dir: Path, video_id: str, document: dict, fps: float = 25.0) -> dict:
    """Save the grouped per-animal-track annotation JSON for a single card in O(1) and update dataset_index.json."""
    workspace_dir = workspace_dir.resolve()
    current = load_workspace_index(workspace_dir)
    index_payload = {**current, "items": [dict(item) if item.get("video_id") == video_id else item
                                         for item in current.get("items", [])]}
    annotations_dir = workspace_dir / "annotations"
    norm_doc = normalize_preprocessed_doc(document, fallback_video_id=video_id, fps=fps)
    ann_path = _write_card_json_files(annotations_dir, video_id, norm_doc)

    label_count, done_count, segment_count, status = _compute_card_stats(norm_doc)
    ws_key = str(workspace_dir)
    by_id = {item["video_id"]: item for item in index_payload.get("items", [])}
    target_item = by_id.get(video_id) if by_id is not None else None
    if target_item is None:
        target_item = next(
            (item for item in index_payload.get("items", []) if item.get("video_id") == video_id),
            None,
        )

    if target_item is not None:
        target_item["annotation_relpath"] = str(ann_path.relative_to(workspace_dir).as_posix())
        target_item["fps"] = norm_doc["fps"]
        target_item["list_animal"] = norm_doc["list_animal"]
        target_item["list_animal_action"] = norm_doc["list_animal_action"]
        target_item["segments"] = flatten_grouped_annotations(norm_doc)
        target_item["label_count"] = label_count
        target_item["done_count"] = done_count
        target_item["segment_count"] = segment_count
        target_item["status"] = status
        target_item["updated_at"] = _now_iso()
        if by_id is not None:
            by_id[video_id] = target_item

    return _persist_index_payload(workspace_dir, index_payload, existing_by_id=by_id)


def build_animal_kingdom_exports(workspace_dir: Path, video_ids: list[str] | None = None) -> dict[str, str]:
    workspace_dir = workspace_dir.resolve()
    index_payload = load_workspace_index(workspace_dir)
    selected_set = set(video_ids) if video_ids else {item["video_id"] for item in index_payload.get("items", [])}

    selected_docs: list[tuple[dict, dict]] = []
    all_actions: set[str] = set()

    for item in index_payload.get("items", []):
        vid = item["video_id"]
        if vid not in selected_set:
            continue
        ann_path = workspace_dir / item.get("annotation_relpath", f"annotations/{vid}.json")
        if not ann_path.is_file():
            ann_path = workspace_dir / f"annotations/{vid}.ar.json"
        if ann_path.is_file():
            doc = normalize_preprocessed_doc(json.loads(ann_path.read_text(encoding="utf-8-sig")), fallback_video_id=vid)
        else:
            doc = normalize_preprocessed_doc({"video_id": vid, "video": item["video_name"]}, fallback_video_id=vid)
        selected_docs.append((item, doc))
        for pair in doc.get("list_animal_action", []):
            if len(pair) >= 2:
                all_actions.add(str(pair[1]))
        for tr in doc.get("annotations", []):
            for act in tr.get("actions", []):
                if act.get("action"):
                    all_actions.add(str(act["action"]))

    action_vocab = {act: idx for idx, act in enumerate(sorted(all_actions))}

    csv_buffer = io.StringIO()
    writer = csv.writer(csv_buffer)
    writer.writerow(
        [
            "video_id",
            "video",
            "segment_index",
            "track_index",
            "animal",
            "action",
            "action_id",
            "start",
            "end",
            "duration",
            "start_frame",
            "end_frame",
            "fps",
            "sentence",
        ]
    )

    mmaction_lines: list[str] = []
    grounding_lines: list[str] = []
    merged_videos: list[dict] = []

    for item, doc in selected_docs:
        vid = doc["video_id"]
        video_name = doc["video"]
        fps = float(doc.get("fps") or 25)
        merged_videos.append(doc)

        seg_counter = 0
        for track_idx, track in enumerate(doc.get("annotations", [])):
            animal = track["animal"]
            for act in track.get("actions", []):
                action = act["action"]
                action_id = action_vocab.get(action, 0)
                start = float(act["start"])
                end = float(act["end"])
                duration = round(max(0.0, end - start), 3)
                start_frame = int(act["start_frame"])
                end_frame = int(act["end_frame"])
                sentence = f"A {animal} is {action.lower()}."

                writer.writerow(
                    [
                        vid,
                        video_name,
                        seg_counter,
                        track_idx,
                        animal,
                        action,
                        action_id,
                        start,
                        end,
                        duration,
                        start_frame,
                        end_frame,
                        int(fps) if fps.is_integer() else fps,
                        sentence,
                    ]
                )
                safe_animal = "_".join(animal.split())
                safe_action = "_".join(action.split())
                clip_name = f"clips/{vid}_t{track_idx}_s{seg_counter:03d}_{safe_animal}_{safe_action}.mp4"
                mmaction_lines.append(f"{clip_name} {action_id}")
                grounding_lines.append(f"{vid} {start:.3f} {end:.3f}##{sentence}")
                seg_counter += 1

    merged_payload = {
        "dataset_name": index_payload.get("dataset_name", workspace_dir.name),
        "exported_at": _now_iso(),
        "video_count": len(merged_videos),
        "action_vocabulary": action_vocab,
        "videos": merged_videos,
    }

    return {
        "merged_annotations.json": json.dumps(merged_payload, ensure_ascii=False, indent=2) + "\n",
        "ak_action_recognition.csv": csv_buffer.getvalue(),
        "mmaction2_annotations.txt": "\n".join(mmaction_lines) + ("\n" if mmaction_lines else ""),
        "ak_vg_grounding.txt": "\n".join(grounding_lines) + ("\n" if grounding_lines else ""),
    }


def export_selected_cards(
    workspace_dir: Path,
    video_ids: list[str],
    *,
    mode: str = "zip",
    dest_path: Path | None = None,
) -> Path:
    workspace_dir = workspace_dir.resolve()
    exports_dir = workspace_dir / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)

    index_payload = load_workspace_index(workspace_dir)
    selected_set = set(video_ids) if video_ids else {item["video_id"] for item in index_payload.get("items", [])}
    generated = build_animal_kingdom_exports(workspace_dir, list(selected_set))

    for filename, content in generated.items():
        (exports_dir / filename).write_text(content, encoding="utf-8")

    if mode == "merged_json":
        target = dest_path.resolve() if dest_path else (exports_dir / "merged_annotations.json")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(generated["merged_annotations.json"], encoding="utf-8")
        return target

    target_zip = dest_path.resolve() if dest_path else (exports_dir / "selected_annotations_bundle.zip")
    if target_zip.suffix.lower() != ".zip":
        target_zip = target_zip.with_suffix(".zip")
    target_zip.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(target_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for item in index_payload.get("items", []):
            vid = item["video_id"]
            if vid not in selected_set:
                continue
            for rel in (f"annotations/{vid}.json",):
                ann_file = workspace_dir / rel
                if ann_file.is_file():
                    zf.write(ann_file, arcname=rel)
        for filename in ("merged_annotations.json", "ak_action_recognition.csv", "mmaction2_annotations.txt", "ak_vg_grounding.txt"):
            fpath = exports_dir / filename
            if fpath.is_file():
                zf.write(fpath, arcname=filename)

    return target_zip
