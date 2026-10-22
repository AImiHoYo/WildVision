"""Python bridge between the desktop window and the annotation core."""

from __future__ import annotations

import json
import sys
import threading
from functools import wraps
from pathlib import Path

from desktop.media_server import LocalMediaServer


def _ensure_core_path() -> None:
    candidates: list[Path] = []
    if getattr(sys, "frozen", False):
        meipass = Path(getattr(sys, "_MEIPASS"))
        candidates.extend([meipass / "core", meipass / "pyqt_app"])
    repo = Path(__file__).resolve().parents[1]
    candidates.append(repo / "core")
    for folder in candidates:
        if folder.is_dir():
            entry = str(folder)
            if entry not in sys.path:
                sys.path.insert(0, entry)


_ensure_core_path()

from ai_engine import AIEngine  # noqa: E402
from clip_exporter import export_clips as export_clip_files  # noqa: E402
from dataset_manager import (  # noqa: E402
    _persist_index_payload,
    application_data_root,
    create_demo_dataset_workspace,
    default_datasets_root,
    export_selected_cards as export_dataset_cards,
    get_workspace_card,
    import_dataset_archive,
    import_dataset_folder,
    initialize_workspace,
    list_available_datasets,
    load_workspace_index,
    save_card_document,
)
from labels import (  # noqa: E402
    ParseError,
    Project,
    export_filename,
    label_key,
    parse_label_input,
    round_seconds,
    serialize_export,
)
from qc_metrics import (  # noqa: E402
    arbitrate,
    arbitrate_one,
    compare_annotations,
    export_markdown_and_latex_table,
    load_annotation,
)

SAMPLE_TEXT = """('Mallard Duck', 'Sensing')
('Common Snipe', 'Flapping')
('Common Snipe', 'Eating')
"""

ALLOWED_FPS = (24, 25, 30, 60)
LARGE_DATASET_IPC_THRESHOLD = 500


def repo_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS"))
    return Path(__file__).resolve().parents[1]


def _api(method):
    @wraps(method)
    def wrapper(self, *args, **kwargs):
        try:
            with self._api_lock:
                if getattr(self, "startup_required", False) and method.__name__ not in {"get_state", "choose_portable_folder"}:
                    return {"ok": False, "message": "请先选择 WildVision 解压文件夹。"}
                return method(self, *args, **kwargs)
        except ParseError as exc:
            return {"ok": False, "message": str(exc)}
        except OSError as exc:
            detail = exc.strerror or "请检查路径。"
            return {"ok": False, "message": f"文件无法读写：{detail}"}
        except Exception as exc:
            return {"ok": False, "message": str(exc) or "操作没有完成。请重试；如果仍失败，请换一个文件再试。"}

    return wrapper


def _chosen_path(chosen) -> str | None:
    if not chosen:
        return None
    if isinstance(chosen, (list, tuple)):
        return str(chosen[0]) if chosen else None
    return str(chosen)


class BackendAPI:
    def __init__(self) -> None:
        self._api_lock = threading.RLock()
        self.project = Project()
        self.media_server = LocalMediaServer()
        self.media_server.set_roots(None, repo_root())
        self.ai_engine = AIEngine()
        self.autosave_dir: Path | None = None
        self.startup_required = False
        self.mode = "annotate"
        self.view_mode = "cards"
        self.status_message = "打开视频，或点试用示例 / 导入数据集压缩包。"
        self.video_path: Path | None = None
        self.annotation_path: Path | None = None
        self.video_url = ""
        self.compare_doc: dict | None = None
        self.compare_name = ""
        self.qc_report_cache: dict | None = None
        self.action_result: dict | None = None
        self.grounding_result: dict | None = None
        self.arbitrated_ids: list[str] = []
        self.workspace_dir: Path | None = None
        self.dataset_name: str = ""
        self.dataset_items: list[dict] = []
        self._dataset_by_id: dict[str, dict] = {}
        self._dataset_positions: dict[str, int] = {}
        self.active_card_id: str | None = None
        self.is_dirty: bool = False
        self.clipboard_segments: list[dict] = []
        self._clipboard_playhead: float | None = None
        self._clipboard_track_index: int | None = None

        if getattr(sys, "frozen", False):
            from portable_paths import ensure_writable, remembered_root, use_selected_root
            try:
                ensure_writable(application_data_root())
            except OSError:
                selected = remembered_root()
                if selected is not None:
                    use_selected_root(selected)
                else:
                    self.startup_required = True
                    self.status_message = "请选择解压后的 WildVision 文件夹，数据会保存在其中的 datasets。"
            if not self.startup_required:
                self.autosave_dir = application_data_root() / "runtime" / "autosave"
        else:
            self.autosave_dir = Path.home() / ".wildvision" / "autosave"

    @_api
    def choose_portable_folder(self, folder: str = "", remember: bool = True) -> dict:
        if not self.startup_required:
            return {"ok": False, "message": "数据位置已确定；更换位置请退出后移动整个便携文件夹。"}
        chosen = folder or self._choose_file(folder=True)
        if not chosen:
            return self._state("尚未选择文件夹。准备好后可再次点击下面的按钮。")
        from portable_paths import validate_selected_root, use_selected_root, remember_root
        try:
            selected = validate_selected_root(Path(chosen))
        except OSError as exc:
            return self._state(str(exc))
        use_selected_root(selected)
        self.autosave_dir = selected / "runtime" / "autosave"
        self.startup_required = False
        warning = remember_root(selected, remember)
        available = list_available_datasets()
        if available:
            result = self.switch_dataset(available[0]["folder_name"])
            if warning:
                result["message"] = result["status_message"] = warning
            return result
        return self._state(warning or f"数据位置已确定：{selected / 'datasets'}。可以开始导入数据。")

    def _set_dataset_items(self, items: list[dict]) -> None:
        self.dataset_items = items
        self._dataset_positions = {str(item.get("video_id", "")): i for i, item in enumerate(items)}
        self._dataset_by_id = {
            str(item.get("video_id", "")): item
            for item in items
            if item.get("video_id")
        }
        self.media_server.set_roots(self.workspace_dir, repo_root())

    def _sync_active_card_in_place(self) -> dict | None:
        if not self.active_card_id:
            return None
        target = self._dataset_by_id.get(self.active_card_id)
        if target is None:
            return None
        project = self.project
        segs = [
            {
                "id": seg.id,
                "animal": seg.animal,
                "action": seg.action,
                "start": seg.start,
                "end": seg.end,
                "track_index": seg.track_index,
            }
            for seg in project.segments
        ]
        done_count = project.done_count()
        label_count = len(project.labels)
        seg_count = len(segs)
        status = (
            "unstarted"
            if seg_count == 0
            else ("completed" if label_count > 0 and done_count >= label_count else "in_progress")
        )
        target["segments"] = segs
        target["done_count"] = done_count
        target["label_count"] = label_count
        target["segment_count"] = seg_count
        target["status"] = status
        return target

    def _state(
        self,
        message: str | None = None,
        *,
        omit_dataset_if_large: bool = False,
        **extra,
    ) -> dict:
        if message is not None:
            self.status_message = message
        project = self.project
        tracks = project.animal_tracks()
        vid_stem = Path(project.video_name).stem if project.video_name else ""
        video_id = project.video_id or vid_stem
        video_matched = bool(not video_id or not vid_stem or video_id == vid_stem)
        active_patch = self._sync_active_card_in_place()
        skip_full_dataset = (
            omit_dataset_if_large and len(self.dataset_items) > LARGE_DATASET_IPC_THRESHOLD
        )

        payload = {
            "ok": True,
            "mode": self.mode,
            "view_mode": self.view_mode,
            "video_id": video_id,
            "video_name": project.video_name,
            "video_matched": video_matched,
            "video_url": self.video_url,
            "media_base_url": self.media_server.base_url,
            "fps": project.fps,
            "list_animal": tracks,
            "list_animal_action": [[animal, action] for animal, action in project.labels],
            "available_actions": project.available_actions(),
            "labels": [
                {"animal": animal, "action": action, "key": label_key(animal, action)}
                for animal, action in project.labels
            ],
            "segments": [
                {
                    "id": segment.id,
                    "animal": segment.animal,
                    "action": segment.action,
                    "start": segment.start,
                    "end": segment.end,
                    "track_index": segment.track_index,
                }
                for segment in project.segments
            ],
            "selected_key": project.selected_key,
            "selected_track_index": project.selected_track_index,
            "selected_action": project.selected_action,
            "pending_time": project.pending_time,
            "pending_key": project.pending_key,
            "pending_track_index": project.pending_track_index,
            "pending_action": project.pending_action,
            "active_segment_id": project.active_segment_id,
            "selected_segment_ids": list(project.selected_segment_ids),
            "done_count": project.done_count(),
            "label_count": len(project.labels),
            "status_message": self.status_message,
            "message": self.status_message,
            "qc_report": self.qc_report_cache,
            "action_result": self.action_result,
            "grounding_result": self.grounding_result,
            "arbitrated_ids": list(self.arbitrated_ids),
            "compare_name": self.compare_name,
            "workspace_dir": str(self.workspace_dir) if self.workspace_dir else "",
            "datasets_root": "" if self.startup_required else str(default_datasets_root()),
            "startup_required": self.startup_required,
            "dataset_name": self.dataset_name,
            "available_datasets": [] if self.startup_required else list_available_datasets(),
            "dataset_total": len(self.dataset_items),
            "active_card_id": self.active_card_id,
            "active_card_position": self._dataset_positions.get(self.active_card_id, -1),
            "active_card_patch": active_patch,
            "is_dirty": self.is_dirty,
            "can_undo": bool(project._history),
            "can_redo": bool(project._redo_history),
            "clipboard_count": len(self.clipboard_segments),
        }
        if not skip_full_dataset:
            payload["dataset_items"] = self.dataset_items
        payload.update(extra)
        return payload

    def _choose_file(
        self,
        file_types: tuple[str, ...] = (),
        save_name: str | None = None,
        folder: bool = False,
    ) -> str | None:
        try:
            import webview
        except ImportError:
            return None
        windows = getattr(webview, "windows", None)
        if not windows:
            return None
        window = windows[0]
        if folder:
            chosen = window.create_file_dialog(webview.FOLDER_DIALOG)
        elif save_name is not None:
            chosen = window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=save_name,
                file_types=file_types,
            )
        else:
            chosen = window.create_file_dialog(webview.OPEN_DIALOG, file_types=file_types)
        return _chosen_path(chosen)

    def _open_video_path(self, path: str, *, alias: str | None = None) -> dict:
        candidate = Path(path).expanduser()
        if not candidate.is_file():
            return {"ok": False, "message": "找不到这个视频文件。"}
        previous = self.project.video_name
        self.video_path = candidate.resolve()
        self.video_url = self.media_server.publish(self.video_path)
        self.project.fps = 25
        metadata_note = ""
        try:
            from media_tools import probe_media
            self.project.fps = probe_media(self.video_path)["fps"]
        except (ImportError, OSError, RuntimeError, ValueError):
            metadata_note = "；未读到视频帧率，暂用 25 fps，请核对后调整。"
        name = alias if alias is not None else candidate.name
        self.project.video_name = name
        if previous and previous != name and (self.project.labels or self.project.segments):
            message = f"视频文件名改为 {name}。导出使用这个名字。"
        else:
            message = f"已打开 {name}"
        return self._state(message + metadata_note, omit_dataset_if_large=True)

    def _selected_pair(self) -> tuple[str, str] | None:
        return self.project.selected_pair()

    def _active_segment(self):
        active = self.project.active_segment_id
        for segment in self.project.segments:
            if segment.id == active:
                return segment
        if self.project.segments:
            return sorted(self.project.segments, key=lambda item: item.start)[0]
        return None

    @_api
    def get_state(self) -> dict:
        return self._state()

    @_api
    def query_dataset_page(
        self,
        page: int = 1,
        page_size: int = 12,
        status_filter: str = "all",
        species_filter: str = "ALL",
        search_text: str = "",
    ) -> dict:
        """Fast O(N) filtered pagination for 100,000+ dataset items."""
        needle = (search_text or "").strip().lower()
        sp_target = (species_filter or "ALL").strip()
        st_target = (status_filter or "all").strip()
        matched: list[dict] = []

        for item in self.dataset_items:
            if st_target != "all" and item.get("status") != st_target:
                continue
            if sp_target != "ALL":
                animals = item.get("list_animal") or []
                if not any(str(a).strip() == sp_target for a in animals):
                    continue
            if needle:
                vid = str(item.get("video_id", "")).lower()
                vname = str(item.get("video_name", "")).lower()
                if needle not in vid and needle not in vname:
                    animals_str = " ".join(str(a) for a in (item.get("list_animal") or [])).lower()
                    actions_str = " ".join(
                        f"{p[0]} {p[1]}"
                        for p in (item.get("list_animal_action") or [])
                        if isinstance(p, (list, tuple)) and len(p) >= 2
                    ).lower()
                    if needle not in animals_str and needle not in actions_str:
                        continue
            matched.append(item)

        total = len(matched)
        p_size = max(1, int(page_size))
        total_pages = max(1, (total + p_size - 1) // p_size)
        safe_page = min(total_pages, max(1, int(page)))
        start = (safe_page - 1) * p_size
        return {
            "ok": True,
            "page": safe_page,
            "page_size": p_size,
            "total": total,
            "total_pages": total_pages,
            "items": matched[start : start + p_size],
        }

    @_api
    def set_mode(self, mode: str) -> dict:
        if mode not in ("annotate", "evaluate"):
            return {"ok": False, "message": "模式只能是标注或评测。"}
        self.mode = mode
        label = "标注模式" if mode == "annotate" else "评测模式"
        return self._state(f"已切换到{label}。", omit_dataset_if_large=True)

    @_api
    def set_view_mode(self, view_mode: str) -> dict:
        if view_mode not in ("cards", "studio"):
            return {"ok": False, "message": "视图模式只能是卡片或工作台。"}
        self.view_mode = view_mode
        return self._state(omit_dataset_if_large=True)

    def _find_local_dropped_file(self, filename: str, file_size: int = 0) -> Path | None:
        clean_name = Path(filename).name
        if not clean_name:
            return None
        ds_root = default_datasets_root()
        project_root = ds_root.parent
        search_roots = [
            project_root,
            Path.home() / "Desktop",
            Path.home() / "Downloads",
            Path.home() / "Documents",
        ]
        seen_dirs: set[Path] = set()
        for root_dir in search_roots:
            if not root_dir.is_dir():
                continue
            # Check direct child and up to 2 levels of subdirectories
            candidates = [root_dir]
            try:
                for sub1 in root_dir.iterdir():
                    if sub1.is_dir() and not sub1.name.startswith(".") and sub1.name not in ("node_modules", "dist", "build", "release"):
                        candidates.append(sub1)
                        try:
                            for sub2 in sub1.iterdir():
                                if sub2.is_dir() and not sub2.name.startswith("."):
                                    candidates.append(sub2)
                        except OSError:
                            pass
            except OSError:
                continue
            for folder in candidates:
                if folder in seen_dirs:
                    continue
                seen_dirs.add(folder)
                cand = folder / clean_name
                try:
                    if cand.is_file():
                        if file_size <= 0 or cand.stat().st_size == int(file_size):
                            return cand.resolve()
                except OSError:
                    continue
        return None

    @_api
    def import_dropped_file(self, filename: str, file_size: int = 0, explicit_path: str = "") -> dict:
        from urllib.parse import quote
        resolved: Path | None = None
        if explicit_path:
            cand = Path(explicit_path).expanduser()
            if cand.is_file():
                resolved = cand.resolve()
        if resolved is None:
            resolved = self._find_local_dropped_file(filename, int(file_size or 0))
        if resolved is None:
            base = self.media_server.base_url
            return {
                "ok": True,
                "needs_upload": True,
                "upload_url": f"{base}/upload?name={quote(Path(filename).name)}&token={self.media_server.upload_token}",
            }
        lower = resolved.name.lower()
        if any(lower.endswith(ext) for ext in (".zip", ".tar.gz", ".tgz", ".tar")):
            return self.import_dataset_zip(str(resolved), "")
        if any(lower.endswith(ext) for ext in (".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v")):
            if self.view_mode == "cards":
                return self.add_video_to_dataset(str(resolved))
            return self.open_video_path(str(resolved))
        return {"ok": False, "message": f"不支持拖入该文件类型：{resolved.name}"}

    @_api
    def switch_dataset(self, target: str) -> dict:
        clean = (target or "").strip()
        if not clean:
            return {"ok": False, "message": "请选择要切换的数据集文件夹。"}
        ds_root = default_datasets_root()
        cand = Path(clean).expanduser()
        if not cand.is_Absolute() if hasattr(cand, "is_Absolute") else not cand.is_absolute():
            cand = ds_root / clean
        cand = cand.resolve()
        if not cand.is_dir():
            return {"ok": False, "message": f"找不到数据集文件夹：{clean}"}
        index_payload = load_workspace_index(cand)
        if not index_payload.get("items"):
            index_payload = initialize_workspace(cand, dataset_name=cand.name)
        self.workspace_dir = Path(index_payload["workspace_dir"])
        self.dataset_name = self.workspace_dir.name
        self._set_dataset_items(index_payload.get("items", []))
        self.active_card_id = None
        self.is_dirty = False
        self.view_mode = "cards"
        return self._state(f"已切换数据集为「{self.dataset_name}」，共 {len(self.dataset_items)} 个视频卡片。")

    @_api
    def import_dataset_zip(self, zip_path: str | None = None, extract_dir: str | None = None) -> dict:
        chosen_zip = zip_path or self._choose_file(("数据集压缩包 (*.zip;*.tar.gz;*.tgz;*.tar)", "所有文件 (*.*)"))
        if not chosen_zip:
            return self._state("已取消导入数据集压缩包。")
        target_root = Path(extract_dir).expanduser().resolve() if extract_dir else default_datasets_root()
        index_payload = import_dataset_archive(Path(chosen_zip).expanduser(), target_root)
        self.workspace_dir = Path(index_payload["workspace_dir"])
        self.dataset_name = self.workspace_dir.name
        self._set_dataset_items(index_payload.get("items", []))
        self.active_card_id = None
        self.is_dirty = False
        self.view_mode = "cards"
        return self._state(
            f"已解压数据集到 datasets/{self.workspace_dir.name}，共 {len(self.dataset_items)} 个视频卡片。"
        )

    @_api
    def open_dataset_folder(self, folder_path: str | None = None) -> dict:
        chosen_folder = folder_path or self._choose_file(folder=True)
        if not chosen_folder:
            return self._state("已取消打开数据集文件夹。")
        folder = Path(chosen_folder).expanduser()
        index_payload = import_dataset_folder(folder)
        self.workspace_dir = Path(index_payload["workspace_dir"])
        self.dataset_name = self.workspace_dir.name
        self._set_dataset_items(index_payload.get("items", []))
        self.active_card_id = None
        self.is_dirty = False
        self.view_mode = "cards"
        return self._state(f"已导入并载入数据集「{self.dataset_name}」，共 {len(self.dataset_items)} 个视频卡片。")

    @_api
    def load_demo_dataset(self) -> dict:
        index_payload = create_demo_dataset_workspace(repo_root())
        self.workspace_dir = Path(index_payload["workspace_dir"])
        self.dataset_name = index_payload.get("dataset_name", "AK_Preprocessed_Demo")
        self._set_dataset_items(index_payload.get("items", []))
        self.view_mode = "cards"
        return self._state(f"已加载示例数据集「{self.dataset_name}」（含 {len(self.dataset_items)} 张视频卡片）。")

    @_api
    def open_card(self, video_id: str) -> dict:
        # Opening a malformed next card must not discard the current document.
        keys = ("project", "active_card_id", "video_path", "video_url", "annotation_path",
                "is_dirty", "view_mode", "mode", "status_message")
        previous = {key: getattr(self, key) for key in keys}
        try:
            result = self._open_card(video_id)
            if not result.get("ok"):
                for key, value in previous.items():
                    setattr(self, key, value)
            return result
        except Exception:
            for key, value in previous.items():
                setattr(self, key, value)
            raise

    def _open_card(self, video_id: str) -> dict:
        if not self.workspace_dir:
            return {"ok": False, "message": "请先导入或打开数据集工作区。"}
        target_item = self._dataset_by_id.get(video_id)
        if target_item is None:
            target_item = get_workspace_card(self.workspace_dir, video_id)
        if target_item is None:
            index_payload = load_workspace_index(self.workspace_dir)
            self._set_dataset_items(index_payload.get("items", []))
            target_item = self._dataset_by_id.get(video_id)
        if target_item is None:
            return {"ok": False, "message": f"找不到视频卡片：{video_id}"}

        video_file = self.workspace_dir / target_item["video_relpath"]
        ann_file = self.workspace_dir / target_item["annotation_relpath"]

        self.active_card_id = None
        self.project = Project()
        self.project.video_id = video_id
        if video_file.is_file():
            self._open_video_path(str(video_file), alias=target_item["video_name"])
        else:
            self.project.video_name = target_item["video_name"]
            self.video_path = None
            self.video_url = ""

        if ann_file.is_file():
            self.annotation_path = ann_file.resolve()
            parsed = parse_label_input(ann_file.read_text(encoding="utf-8-sig"))
            self.project.apply(parsed, "replace")
            self.project.video_name = target_item["video_name"]
            self.project.video_id = parsed.video_id or video_id
        else:
            self.annotation_path = ann_file.resolve()
        if not self.project.list_animal and target_item.get("list_animal"):
            self.project.list_animal = list(target_item["list_animal"])

        self.project.fps = float(target_item.get("fps") or 25)
        self.project.clear_history()
        self.active_card_id = video_id
        self.is_dirty = False
        self.view_mode = "studio"
        self.mode = "annotate"
        match_note = (
            f"video_id ({self.project.video_id}) 与视频名称 ({target_item['video_name']}) 校验匹配"
            if target_item.get("video_matched", True)
            else f"⚠️ 注意：video_id ({self.project.video_id}) 与视频文件名 ({target_item['video_name']}) 不一致"
        )
        return self._state(
            f"正在标注卡片：{target_item['video_name']} · {match_note}（按 Ctrl+S / ⌘S 保存）",
            omit_dataset_if_large=True,
        )

    @_api
    def navigate_card(self, direction: int, expected_card_id: str) -> dict:
        if direction not in (-1, 1):
            raise ValueError("切换方向无效。")
        if not self.workspace_dir or not self.active_card_id:
            raise ValueError("请先打开数据集中的视频。")
        if expected_card_id != self.active_card_id:
            raise ValueError("当前视频已切换，请稍后再试。")
        position = self._dataset_positions.get(self.active_card_id, -1)
        target_position = position + direction
        if position < 0 or not 0 <= target_position < len(self.dataset_items):
            raise ValueError("已经是第一个视频。" if direction < 0 else "已经是最后一个视频。")
        if self.project.pending_time is not None:
            raise ValueError("请先完成当前标注的终点，或取消起点后再切换视频。")
        target_id = self.dataset_items[target_position]["video_id"]
        if self.is_dirty:
            saved = self.save_current_card()
            if not saved.get("ok"):
                return saved
        return self.open_card(target_id)

    @_api
    def save_current_card(self) -> dict:
        if self.workspace_dir and self.active_card_id:
            doc = self.project.export_preprocessed_document()
            index_payload = save_card_document(
                self.workspace_dir,
                self.active_card_id,
                doc,
                fps=float(self.project.fps),
            )
            ann_file = self.workspace_dir / "annotations" / f"{self.active_card_id}.json"
            if ann_file.is_file():
                self.annotation_path = ann_file.resolve()
            if len(self.dataset_items) <= LARGE_DATASET_IPC_THRESHOLD:
                self._set_dataset_items(index_payload.get("items", []))
            else:
                self._sync_active_card_in_place()
            self.is_dirty = False
            return self._state(
                f"已保存 {self.project.video_name} 的标注到 annotations/{self.active_card_id}.json（{len(self.project.segments)} 段）。",
                omit_dataset_if_large=True,
            )
        return self.export_json(confirm_empty=True)

    @_api
    def leave_card(self, action: str = "check") -> dict:
        if action == "check" and self.is_dirty:
            return self._state(
                f"视频「{self.project.video_name}」有未保存的标注修改，退出卡片前是否要保存？",
                needs_confirm="leave_dirty_card",
                omit_dataset_if_large=True,
            )
        if action == "save_and_leave":
            if self.workspace_dir and self.active_card_id:
                doc = self.project.export_preprocessed_document()
                index_payload = save_card_document(
                    self.workspace_dir,
                    self.active_card_id,
                    doc,
                    fps=float(self.project.fps),
                )
                if len(self.dataset_items) <= LARGE_DATASET_IPC_THRESHOLD:
                    self._set_dataset_items(index_payload.get("items", []))
                else:
                    self._sync_active_card_in_place()
            self.is_dirty = False
            self.view_mode = "cards"
            return self._state(
                f"已保存 {self.project.video_name} 并返回卡片列表。",
                omit_dataset_if_large=True,
            )

        # Discard unsaved in-memory edits by restoring active card from disk if needed
        if self.workspace_dir and self.active_card_id and self.is_dirty:
            target = self._dataset_by_id.get(self.active_card_id)
            if target:
                ann_file = self.workspace_dir / target.get("annotation_relpath", f"annotations/{self.active_card_id}.json")
                if ann_file.is_file():
                    try:
                        parsed = parse_label_input(ann_file.read_text(encoding="utf-8-sig"))
                        self.project.apply(parsed, "replace")
                        self._sync_active_card_in_place()
                    except Exception:
                        pass
        self.is_dirty = False
        self.view_mode = "cards"
        return self._state("已返回数据集卡片列表。", omit_dataset_if_large=True)

    @_api
    def export_selected_cards(
        self,
        video_ids: list[str] | None = None,
        export_mode: str = "zip",
        dest_path: str | None = None,
    ) -> dict:
        if not self.workspace_dir:
            return {"ok": False, "message": "请先导入或打开数据集工作区。"}
        ids = list(video_ids or [])
        if not ids:
            return {"ok": False, "message": "请至少勾选一张视频卡片再导出。"}

        chosen_dest = dest_path
        if not chosen_dest:
            default_name = (
                f"{self.dataset_name or 'dataset'}_annotations.zip"
                if export_mode == "zip"
                else f"{self.dataset_name or 'dataset'}_merged_annotations.json"
            )
            file_types = (
                ("ZIP 压缩包 (*.zip)", "所有文件 (*.*)")
                if export_mode == "zip"
                else ("JSON 文件 (*.json)", "所有文件 (*.*)")
            )
            chosen_dest = self._choose_file(file_types, save_name=default_name)
            if not chosen_dest:
                chosen_dest = str(self.workspace_dir / "exports" / default_name)

        out_path = export_dataset_cards(
            self.workspace_dir,
            ids,
            mode=export_mode,
            dest_path=Path(chosen_dest).expanduser(),
        )
        return self._state(
            f"已批量导出 {len(ids)} 张卡片的标注数据至：{out_path.name}（含 Animal Kingdom 预处理 JSON、CSV、MMAction2 与 Grounding 格式）。",
            exported_path=str(out_path),
            omit_dataset_if_large=True,
        )

    @_api
    def add_video_to_dataset(self, video_path: str | None = None) -> dict:
        import shutil
        chosen = video_path or self._choose_file(("视频文件 (*.mp4;*.webm;*.mov;*.mkv;*.avi;*.m4v)", "所有文件 (*.*)"))
        if not chosen:
            return self._state("已取消添加视频。")
        src = Path(chosen).expanduser().resolve()
        if not src.is_file():
            return {"ok": False, "message": "找不到所选视频文件。"}
        if not self.workspace_dir:
            base_ds = default_datasets_root()
            self.workspace_dir = base_ds / "Default_Workspace"
            self.dataset_name = "Default_Workspace"
        videos_dir = self.workspace_dir / "videos"
        videos_dir.mkdir(parents=True, exist_ok=True)
        dest = videos_dir / src.name
        if src != dest:
            shutil.copy2(src, dest)
        index_payload = initialize_workspace(self.workspace_dir, dataset_name=self.dataset_name or self.workspace_dir.name)
        self._set_dataset_items(index_payload.get("items", []))
        self.view_mode = "cards"
        return self._state(f"已将视频 {src.name} 添加到当前卡片集（共 {len(self.dataset_items)} 张卡片）。")

    @_api
    def remove_selected_cards(self, video_ids: list[str] | None = None) -> dict:
        if not self.workspace_dir:
            return {"ok": False, "message": "当前没有打开的数据集工作区。"}
        ids = set(video_ids or [])
        if not ids:
            return {"ok": False, "message": "请先勾选要移除的卡片。"}
        index_payload = load_workspace_index(self.workspace_dir)
        kept = []
        for item in index_payload.get("items", []):
            vid = item.get("video_id")
            if vid in ids:
                for rel in (item.get("annotation_relpath"), f"annotations/{vid}.json", f"annotations/{vid}.ar.json"):
                    if rel:
                        ann_file = self.workspace_dir / rel
                        if ann_file.is_file():
                            ann_file.unlink(missing_ok=True)
                vid_file = self.workspace_dir / item.get("video_relpath", f"videos/{item.get('video_name', '')}")
                if vid_file.is_file():
                    vid_file.unlink(missing_ok=True)
            else:
                kept.append(item)
        index_payload["items"] = kept
        _persist_index_payload(self.workspace_dir, index_payload)
        self._set_dataset_items(kept)
        if self.active_card_id in ids:
            self.active_card_id = None
            self.is_dirty = False
        self.view_mode = "cards"
        return self._state(f"已从卡片集中移除 {len(ids)} 项（剩余 {len(kept)} 张卡片）。")

    @_api
    def load_demo(self, force: bool = False) -> dict:
        if (self.project.labels or self.project.segments) and not force:
            return self._state(
                "当前已有标签或标注段。载入示例会替换它们，要继续吗？",
                needs_confirm="demo",
                omit_dataset_if_large=True,
            )
        parsed = parse_label_input(SAMPLE_TEXT)
        self.project.apply(parsed, "replace")
        sample = repo_root() / "public" / "sample_ak.mp4"
        self.project.video_name = "ak_000123.mp4"
        self.project.video_id = ""
        if sample.is_file():
            self._open_video_path(str(sample), alias="ak_000123.mp4")
            message = "已打开示例视频和示例标签。正式任务请换成你们自己的文件。"
        else:
            message = "已载入示例标签；未找到 public/sample_ak.mp4，文件名已设为 ak_000123.mp4。"
        self.arbitrated_ids = []
        self.is_dirty = False
        self.view_mode = "studio"
        return self._state(message, omit_dataset_if_large=True)

    @_api
    def open_video_dialog(self) -> dict:
        chosen = self._choose_file(("视频文件 (*.mp4;*.webm;*.mov;*.mkv;*.avi;*.m4v)", "所有文件 (*.*)"))
        if not chosen:
            return self._state("已取消打开视频。", omit_dataset_if_large=True)
        return self._open_video_path(chosen)

    @_api
    def open_video_path(self, path: str) -> dict:
        return self._open_video_path(path)

    @_api
    def open_labels_dialog(self) -> dict:
        chosen = self._choose_file(("预处理 JSON 或标签文件 (*.json;*.csv;*.txt)", "所有文件 (*.*)"))
        if not chosen:
            return self._state("已取消载入标签。", omit_dataset_if_large=True)
        chosen_path = Path(chosen).expanduser().resolve()
        self.annotation_path = chosen_path
        text = chosen_path.read_text(encoding="utf-8-sig")
        return self.parse_text(text, "")

    def _resolve_current_json_path(self) -> Path | None:
        if self.workspace_dir and self.active_card_id:
            target_item = self._dataset_by_id.get(self.active_card_id)
            candidates: list[Path] = []
            if target_item and target_item.get("annotation_relpath"):
                candidates.append(self.workspace_dir / str(target_item["annotation_relpath"]))
            candidates.append(self.workspace_dir / "annotations" / f"{self.active_card_id}.json")
            candidates.append(self.workspace_dir / "annotations" / f"{self.active_card_id}.ar.json")
            for cand in candidates:
                if cand.is_file():
                    return cand.resolve()
        if self.annotation_path and self.annotation_path.is_file():
            return self.annotation_path.resolve()
        return None

    def _resolve_current_video_path(self) -> Path | None:
        if self.video_path and self.video_path.is_file():
            return self.video_path.resolve()
        if self.workspace_dir and self.active_card_id:
            target_item = self._dataset_by_id.get(self.active_card_id)
            candidates: list[Path] = []
            if target_item and target_item.get("video_relpath"):
                candidates.append(self.workspace_dir / str(target_item["video_relpath"]))
            if target_item and target_item.get("video_name"):
                candidates.append(self.workspace_dir / "videos" / str(target_item["video_name"]))
            candidates.append(self.workspace_dir / "videos" / f"{self.active_card_id}.mp4")
            for cand in candidates:
                if cand.is_file():
                    return cand.resolve()
        return None

    def _reveal_in_file_manager(self, target_path: Path) -> None:
        import os
        import subprocess

        resolved = target_path.expanduser().resolve()
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(resolved)])
        elif os.name == "nt" or sys.platform.startswith("win"):
            subprocess.Popen(["explorer", f"/select,{os.path.normpath(str(resolved))}"])
        else:
            subprocess.Popen(["xdg-open", str(resolved.parent)])

    @_api
    def reveal_dataset_folder(self) -> dict:
        import os
        import subprocess
        target = self.workspace_dir or default_datasets_root()
        if sys.platform == "darwin":
            subprocess.Popen(["open", str(target)])
        elif sys.platform == "win32":
            os.startfile(str(target))
        else:
            subprocess.Popen(["xdg-open", str(target)])
        return {"ok": True, "message": f"已打开数据目录：{target}"}

    @_api
    def reveal_json_path(self) -> dict:
        target = self._resolve_current_json_path()
        if target is None:
            return {"ok": False, "message": "未找到当前卡片对应的原 JSON 文件。"}
        self._reveal_in_file_manager(target)
        return self._state(
            f"已在文件管理器中定位并选中原 JSON：{target.name}",
            revealed_path=str(target),
            omit_dataset_if_large=True,
        )

    @_api
    def reveal_video_path(self) -> dict:
        target = self._resolve_current_video_path()
        if target is None:
            return {"ok": False, "message": "未找到当前卡片对应的原视频文件。"}
        self._reveal_in_file_manager(target)
        return self._state(
            f"已在文件管理器中定位并选中原视频：{target.name}",
            revealed_path=str(target),
            omit_dataset_if_large=True,
        )

    @_api
    def parse_text(self, text: str, mode: str = "") -> dict:
        parsed = parse_label_input(text)
        has_work = bool(self.project.labels or self.project.segments)
        if parsed.kind == "project":
            if has_work and mode not in ("replace", "merge"):
                return self._state(
                    f"这个文件带有 {len(parsed.annotations)} 段标注。载入后会替换当前标签和已标时间段，要继续吗？",
                    needs_confirm="replace_project",
                    pending_text=text,
                    omit_dataset_if_large=True,
                )
            mode = "replace"
        else:
            if has_work and mode not in ("replace", "merge"):
                return self._state(
                    "当前已有标签。请选择合并新增标签，或替换并清空现有标注。",
                    needs_confirm="merge_or_replace",
                    pending_text=text,
                    omit_dataset_if_large=True,
                )
            if not mode:
                mode = "replace"
        self.project.apply(parsed, mode)
        self.is_dirty = True
        note = ""
        if parsed.video:
            if not self.project.video_name:
                self.project.video_name = parsed.video
            elif Path(self.project.video_name).stem != Path(parsed.video).stem:
                note = f"⚠️ 预处理 JSON 的 video_id/video 是 {parsed.video}，当前视频名称是 {self.project.video_name}。"
        duplicate = f"（已忽略 {parsed.duplicate_count} 条重复）" if parsed.duplicate_count else ""
        ranges = f"，恢复 {len(parsed.annotations)} 段标注" if parsed.kind == "project" else ""
        tracks_info = f"、{len(self.project.animal_tracks())} 条动物轨道" if self.project.animal_tracks() else ""
        message = f"已载入 {len(self.project.labels)} 个动物-行为键值对{tracks_info}{ranges}{duplicate}。"
        if note:
            message = f"{message} {note}"
        return self._state(message, omit_dataset_if_large=True)

    @_api
    def set_fps(self, fps: float) -> dict:
        number = round_seconds(float(fps))
        if number not in ALLOWED_FPS:
            return {"ok": False, "message": "帧率只能选 24、25、30 或 60。"}
        self.project.fps = number
        self.is_dirty = True
        return self._state(f"帧率已设为 {int(number)}", omit_dataset_if_large=True)

    @_api
    def select_label(self, animal: str, action: str) -> dict:
        key = label_key(animal, action)
        if key not in {label_key(item_animal, item_action) for item_animal, item_action in self.project.labels}:
            return {"ok": False, "message": "没有找到这个标签。"}
        self.project.selected_key = key
        self.project.selected_action = action
        tracks = self.project.animal_tracks()
        if tracks:
            if not (0 <= self.project.selected_track_index < len(tracks)) or tracks[self.project.selected_track_index] != animal:
                for idx, name in enumerate(tracks):
                    if name == animal:
                        self.project.selected_track_index = idx
                        break
        return self._state(omit_dataset_if_large=True)

    @_api
    def select_action(self, action: str) -> dict:
        self.project.select_action(action)
        tracks = self.project.animal_tracks()
        track_label = (
            f"{tracks[self.project.selected_track_index]} #{self.project.selected_track_index + 1}"
            if 0 <= self.project.selected_track_index < len(tracks)
            else ""
        )
        msg = f"已选行为「{action}」" + (f" · 当前目标轨道：{track_label}" if track_label else "")
        return self._state(msg, omit_dataset_if_large=True)

    @_api
    def select_track(self, track_index: int) -> dict:
        self.project.select_track(int(track_index))
        tracks = self.project.animal_tracks()
        animal = tracks[self.project.selected_track_index] if 0 <= self.project.selected_track_index < len(tracks) else ""
        msg = f"已选中下方第 {self.project.selected_track_index + 1} 条动物时间轴：{animal}"
        if self.project.selected_action:
            msg += f"（当前标注行为：{self.project.selected_action}）"
        return self._state(msg, omit_dataset_if_large=True)

    @_api
    def select_segment(self, segment_id: str, multi: bool = False) -> dict:
        if not self.project.select_segment(str(segment_id), multi=bool(multi)):
            return {"ok": False, "message": "没有找到这一段标注。"}
        count = len(self.project.selected_segment_ids)
        msg = f"已多选 {count} 段标注。" if bool(multi) and count > 1 else None
        return self._state(msg, omit_dataset_if_large=True)

    @_api
    def deselect_segment(self) -> dict:
        self.project.deselect_segment()
        return self._state("已取消选中。", omit_dataset_if_large=True)

    @_api
    def mark_start(
        self,
        seconds: float,
        track_index: int | None = None,
        action: str | None = None,
    ) -> dict:
        message = self.project.mark_start(float(seconds), track_index=track_index, action=action)
        return self._state(message, omit_dataset_if_large=True)

    @_api
    def mark_end(
        self,
        seconds: float,
        track_index: int | None = None,
        action: str | None = None,
    ) -> dict:
        message = self.project.mark_end(float(seconds), track_index=track_index, action=action)
        self.is_dirty = True
        return self._state(message, omit_dataset_if_large=True)

    @_api
    def create_segment(
        self,
        animal: str,
        action: str,
        start: float,
        end: float,
        track_index: int = 0,
    ) -> dict:
        message = self.project.create_segment(
            str(animal),
            str(action),
            float(start),
            float(end),
            track_index=int(track_index),
        )
        self.is_dirty = True
        return self._state(message, omit_dataset_if_large=True)

    @_api
    def cancel_pending(self) -> dict:
        self.project.pending_key = None
        self.project.pending_track_index = None
        self.project.pending_action = None
        self.project.pending_time = None
        return self._state("已取消起点。", omit_dataset_if_large=True)

    @_api
    def delete_segment(self, segment_id: str) -> dict:
        self.project.delete_segment(segment_id)
        self.is_dirty = True
        return self._state("已删除这段。", omit_dataset_if_large=True)

    @_api
    def delete_segments(self, segment_ids: list[str] | None = None) -> dict:
        removed = self.project.delete_segments(segment_ids)
        if removed <= 0:
            return self._state("请先选中要删除的标注区间。", omit_dataset_if_large=True)
        self.is_dirty = True
        msg = f"已删除选中的 {removed} 段标注。" if removed > 1 else "已删除这段。"
        return self._state(msg, omit_dataset_if_large=True)

    @_api
    def copy_segments(
        self,
        segment_ids: list[str] | None = None,
        playhead_time: float | None = None,
    ) -> dict:
        if segment_ids:
            id_set = {str(sid) for sid in segment_ids if sid}
            chosen = [item for item in self.project.segments if item.id in id_set]
            chosen.sort(key=lambda s: (s.start, s.end, s.track_index))
        else:
            chosen = self.project.selected_segments()
        if not chosen:
            return self._state("请先选中要复制的标注区间。", omit_dataset_if_large=True)
        self.clipboard_segments = [
            {
                "animal": seg.animal,
                "action": seg.action,
                "start": seg.start,
                "end": seg.end,
                "track_index": seg.track_index,
            }
            for seg in chosen
        ]
        self._clipboard_playhead = (
            round_seconds(float(playhead_time)) if playhead_time is not None else None
        )
        self._clipboard_track_index = self.project.selected_track_index
        count = len(self.clipboard_segments)
        return self._state(f"已复制 {count} 段标注（按 Ctrl+V / ⌘V 粘贴）。", omit_dataset_if_large=True)

    @_api
    def paste_segments(
        self,
        playhead_time: float | None = None,
        target_track_index: int | None = None,
    ) -> dict:
        if not self.clipboard_segments:
            return self._state("剪贴板为空，请先按 Ctrl+C / ⌘C 复制标注。", omit_dataset_if_large=True)
        resolved_track = (
            int(target_track_index)
            if target_track_index is not None
            else self.project.selected_track_index
        )
        current_t = (
            round_seconds(float(playhead_time)) if playhead_time is not None else None
        )
        playhead_moved = (
            current_t is not None
            and self._clipboard_playhead is not None
            and abs(current_t - self._clipboard_playhead) > 1e-3
        )
        is_multi = len(self.clipboard_segments) > 1
        track_changed = (
            not is_multi
            and self._clipboard_track_index is not None
            and resolved_track != self._clipboard_track_index
        )
        if playhead_moved:
            anchor_time: float | None = current_t
            avoid_self_overlap = False
            paste_track: int | None = None
        elif track_changed:
            anchor_time = None
            avoid_self_overlap = False
            paste_track = resolved_track
        else:
            anchor_time = current_t
            avoid_self_overlap = True
            paste_track = None

        _pasted, did_merge = self.project.paste_segments(
            self.clipboard_segments,
            anchor_time=anchor_time,
            target_track_index=paste_track,
            avoid_self_overlap=avoid_self_overlap,
        )
        self.is_dirty = True
        count = len(self.clipboard_segments)
        merge_note = "（重叠区间已自动合并）" if did_merge else ""
        return self._state(f"已粘贴 {count} 段标注{merge_note}。", omit_dataset_if_large=True)

    @_api
    def update_segment(self, segment_id: str, start: float, end: float, record: bool = True) -> dict:
        self.project.update_segment(segment_id, float(start), float(end), record=bool(record))
        self.is_dirty = True
        return self._state("已调整区间。", omit_dataset_if_large=True)

    @_api
    def change_segment_action(self, segment_id: str, action: str, record: bool = True) -> dict:
        changed = self.project.change_segment_action(segment_id, action, record=bool(record))
        if changed:
            self.is_dirty = True
        return self._state("已更换该段行为，时间与动物轨道保持不变。" if changed else "行为未改变。",
                           omit_dataset_if_large=True)

    @_api
    def begin_edit(self) -> dict:
        self.project.begin_edit()
        return self._state(omit_dataset_if_large=True)

    @_api
    def end_edit(self) -> dict:
        self.project.end_edit()
        return self._state(omit_dataset_if_large=True)

    @_api
    def undo(self) -> dict:
        if not self.project.undo():
            return self._state("没有可撤销的操作。", omit_dataset_if_large=True)
        self.is_dirty = True
        return self._state("已撤销。", omit_dataset_if_large=True)

    @_api
    def redo(self) -> dict:
        if not self.project.redo():
            return self._state("没有可恢复的操作。", omit_dataset_if_large=True)
        self.is_dirty = True
        return self._state("已恢复重做。", omit_dataset_if_large=True)

    @_api
    def export_json(self, confirm_empty: bool = False, path: str | None = None) -> dict:
        if self.workspace_dir and self.active_card_id and not path:
            return self.save_current_card()
        name = self.project.video_name.strip()
        if not name:
            return {"ok": False, "message": "请先打开视频，再导出。"}
        if not self.project.labels:
            return {"ok": False, "message": "请先载入动物–行为标签。"}
        empty = len(self.project.labels) - self.project.done_count()
        if empty > 0 and not confirm_empty:
            return self._state(
                f"还有 {empty} 个标签没有标时间段。仍要导出吗？",
                needs_confirm="empty_labels",
                omit_dataset_if_large=True,
            )
        if not path:
            path = self._choose_file(("JSON 文件 (*.json)",), save_name=export_filename(name))
            if not path:
                return self._state("已取消导出。", omit_dataset_if_large=True)
        if self.project.video_id or self.active_card_id:
            document = self.project.export_preprocessed_document()
        else:
            document = self.project.export_document()
        out_file = Path(path).expanduser().resolve()
        from storage import atomic_write_text
        atomic_write_text(out_file, serialize_export(document))
        self.annotation_path = out_file
        self.is_dirty = False
        return self._state(
            f"已导出 {out_file.name}（{len(self.project.segments)} 段，帧率 {self.project.fps:g}）。",
            omit_dataset_if_large=True,
        )

    @_api
    def autosave(self) -> dict:
        if not self.project.video_name and not self.project.labels and not self.project.segments:
            return {"ok": True, "saved": False}
        self.autosave_dir.mkdir(parents=True, exist_ok=True)
        import hashlib
        identity = self._autosave_identity()
        filename = hashlib.sha256(identity.encode("utf-8")).hexdigest() + ".ar.json"
        dest = self.autosave_dir / filename
        document = self.project.export_preprocessed_document()
        document["_wildvision_autosave"] = {
            "identity": identity,
            "workspace": str(self.workspace_dir.resolve()) if self.workspace_dir else None,
            "card_id": self.active_card_id,
            "video_path": str(self.video_path.resolve()) if self.video_path else None,
        }
        if getattr(sys, "frozen", False) and self.workspace_dir:
            root = application_data_root().resolve()
            if self.workspace_dir.resolve().is_relative_to(root / "datasets"):
                document["_wildvision_autosave"]["portable_workspace"] = self.workspace_dir.resolve().relative_to(root).as_posix()
        from storage import atomic_write_text
        atomic_write_text(dest, serialize_export(document))
        return {"ok": True, "saved": True, "path": str(dest)}

    def _autosave_identity(self) -> str:
        if self.workspace_dir and self.active_card_id:
            if getattr(sys, "frozen", False):
                root = application_data_root().resolve()
                if self.workspace_dir.resolve().is_relative_to(root / "datasets"):
                    return f"portable:{self.workspace_dir.resolve().relative_to(root).as_posix()}:{self.active_card_id}"
            return f"workspace:{self.workspace_dir.resolve()}:{self.active_card_id}"
        return f"video:{self.video_path.resolve()}" if self.video_path else f"draft:{self.project.video_name}"

    @_api
    def latest_autosave(self) -> dict:
        if not self.autosave_dir.is_dir():
            return {"ok": True, "found": False}
        files = sorted(self.autosave_dir.glob("*.ar.json"), key=lambda item: item.stat().st_mtime, reverse=True)
        if not files:
            return {"ok": True, "found": False}
        latest = files[0]
        return {"ok": True, "found": True, "path": str(latest), "name": latest.name}

    @_api
    def restore_autosave(self, path: str) -> dict:
        candidate = Path(path).expanduser().resolve()
        if not candidate.is_relative_to(self.autosave_dir.resolve()) or not candidate.is_file():
            return {"ok": False, "message": "找不到自动保存文件。"}
        if self.is_dirty:
            return {"ok": False, "message": "请先保存或放弃当前修改，再恢复自动保存。"}
        text = candidate.read_text(encoding="utf-8-sig")
        metadata = json.loads(text).get("_wildvision_autosave")
        if metadata and metadata.get("identity") != self._autosave_identity():
            if self.active_card_id or self.video_path:
                return {"ok": False, "message": "这份自动保存属于其他视频或数据集，请先打开对应视频。"}
            workspace = metadata.get("workspace")
            if getattr(sys, "frozen", False) and metadata.get("portable_workspace"):
                root = application_data_root().resolve()
                relocated = (root / metadata["portable_workspace"]).resolve()
                if not relocated.is_relative_to(root / "datasets"):
                    return {"ok": False, "message": "自动保存中的数据集位置无效。"}
                workspace = str(relocated)
            card_id = metadata.get("card_id")
            if workspace and card_id:
                payload = load_workspace_index(Path(workspace))
                self.workspace_dir = Path(workspace).resolve()
                self.dataset_name = self.workspace_dir.name
                self._set_dataset_items(payload.get("items", []))
                opened = self.open_card(card_id)
                if not opened.get("ok"):
                    return opened
            elif metadata.get("video_path"):
                opened = self.open_video_path(metadata["video_path"])
                if not opened.get("ok"):
                    return opened
        if not metadata and (self.active_card_id or self.video_path):
            return {"ok": False, "message": "旧版自动保存没有数据集标识，请在空白工作台恢复后另存，避免覆盖当前视频。"}
        result = self.parse_text(text, "replace")
        if not result.get("ok"):
            return result
        self.is_dirty = True
        return self._state("已恢复自动保存；请保存以写入正式标注。", omit_dataset_if_large=True)

    @_api
    def load_compare_json(self, path: str | None = None) -> dict:
        if not path:
            path = self._choose_file(("JSON 文件 (*.json)", "所有文件 (*.*)"))
            if not path:
                return self._state("已取消载入对比文件。", omit_dataset_if_large=True)
        candidate = Path(path).expanduser()
        self.compare_doc = load_annotation(candidate)
        self.compare_name = candidate.name
        self.qc_report_cache = compare_annotations(
            self.project.export_document(),
            self.compare_doc,
            fps=self.project.fps,
        )
        return self._state(f"已载入对比文件 {self.compare_name}。", omit_dataset_if_large=True)

    @_api
    def qc_report(self) -> dict:
        if self.compare_doc is None:
            return {"ok": False, "message": "请先载入第二份标注 JSON。"}
        self.qc_report_cache = compare_annotations(
            self.project.export_document(),
            self.compare_doc,
            fps=self.project.fps,
        )
        metrics = self.qc_report_cache["overall_metrics"]
        mean_iou = metrics["mean_temporal_iou"]
        kappa = metrics["cohens_kappa_frame_level"]
        return self._state(f"Mean tIoU {mean_iou:.3f}，Cohen's κ {kappa:.3f}。", omit_dataset_if_large=True)

    def _conflict_ids(self, report: dict) -> list[str]:
        conflicts = [
            row
            for row in report.get("segment_comparisons", [])
            if row.get("status") == "NEEDS_ARBITRATION"
        ]
        matched: list[str] = []
        for row in conflicts:
            animal, action = row["label"]
            for segment in self.project.segments:
                if segment.animal == animal and segment.action == action:
                    matched.append(segment.id)
        return matched

    @_api
    def arbitrate_conflicts(self) -> dict:
        if self.compare_doc is None:
            return {"ok": False, "message": "请先载入对比标注 JSON。"}
        report = compare_annotations(self.project.export_document(), self.compare_doc, fps=self.project.fps)
        self.arbitrated_ids = self._conflict_ids(report)
        merged = arbitrate(report, strategy="average")
        parsed = parse_label_input(serialize_export(merged))
        self.project.apply(parsed, "replace")
        if self.video_url and self.project.video_name != merged["video"]:
            self.project.video_name = merged["video"]
        self.qc_report_cache = compare_annotations(
            self.project.export_document(),
            self.compare_doc,
            fps=self.project.fps,
        )
        self.is_dirty = True
        count = len(self.arbitrated_ids)
        message = f"已按起止均值合并 {count} 处低一致性区间。" if count else "所有区间一致，无需合并。"
        return self._state(message, omit_dataset_if_large=True)

    @_api
    def arbitrate_row(self, index: int, decision: str) -> dict:
        if self.compare_doc is None:
            return {"ok": False, "message": "请先载入对比标注 JSON。"}
        if decision not in ("keep_a", "keep_b", "average"):
            return {"ok": False, "message": "仲裁方式只能选 A、B 或均值。"}
        report = compare_annotations(self.project.export_document(), self.compare_doc, fps=self.project.fps)
        merged, seek_to = arbitrate_one(report, int(index), decision)
        parsed = parse_label_input(serialize_export(merged))
        self.project.apply(parsed, "replace")
        if self.video_url and self.project.video_name != merged["video"]:
            self.project.video_name = merged["video"]
        self.qc_report_cache = compare_annotations(
            self.project.export_document(),
            self.compare_doc,
            fps=self.project.fps,
        )
        self.is_dirty = True
        labels = {"keep_a": "采用 A", "keep_b": "采用 B", "average": "取均值"}
        return self._state(f"这一条已{labels.get(decision, '更新')}。", seek_to=seek_to, omit_dataset_if_large=True)

    @_api
    def export_qc_tables(self, directory: str | None = None) -> dict:
        if self.qc_report_cache is None:
            self.qc_report()
        if self.qc_report_cache is None:
            return {"ok": False, "message": "请先计算双人质检指标。"}
        if not directory:
            directory = self._choose_file(folder=True)
            if not directory:
                return self._state("已取消导出统计表。", omit_dataset_if_large=True)
        folder = Path(directory).expanduser()
        folder.mkdir(parents=True, exist_ok=True)
        markdown, latex = export_markdown_and_latex_table(self.qc_report_cache)
        (folder / "qc_robustness.md").write_text(markdown, encoding="utf-8")
        (folder / "qc_robustness.tex").write_text(latex, encoding="utf-8")
        return self._state("已导出 qc_robustness.md 与 qc_robustness.tex。", omit_dataset_if_large=True)

    @_api
    def export_clips(self, out_dir: str | None = None) -> dict:
        if not self.project.segments:
            return {"ok": False, "message": "请先标出至少一段区间。"}
        if not out_dir:
            out_dir = self._choose_file(folder=True)
            if not out_dir:
                return self._state("已取消切分。", omit_dataset_if_large=True)
        video = self.video_path or (repo_root() / "public" / "sample_ak.mp4")
        result = export_clip_files(
            video,
            self.project.export_document(),
            Path(out_dir).expanduser(),
            fps=self.project.fps,
        )
        cut_count = int(
            result.get(
                "cut_count",
                sum(1 for item in result.get("clip_details", []) if isinstance(item, dict) and item.get("cut")),
            )
        )
        total = len(result["clips"])
        if cut_count == total:
            message = f"已切分 {total} 段短片，并写入 MMAction2 与 Grounding 清单。"
        else:
            message = f"已写入 MMAction2 与 Grounding 清单（切出 {cut_count}/{total} 段视频）。"
        return self._state(message, clip_export=result, omit_dataset_if_large=True)

    @_api
    def run_action_recognition(self, model_name: str = "VideoMAE") -> dict:
        segment = self._active_segment()
        pair = self._selected_pair()
        action = segment.action if segment else (pair[1] if pair else "Sensing")
        start = segment.start if segment else 0.0
        end = segment.end if segment else 1.0
        video = self.project.video_name or "ak_000123.mp4"
        self.action_result = self.ai_engine.run_action_recognition(
            video=video,
            clip_start=start,
            clip_end=end,
            ground_truth_action=action,
            model_name=model_name,
        )
        predicted = self.action_result["stage2_action_recognition"]["output"]["predicted_action"]
        return self._state(f"动作识别完成：{predicted}（离线演示缓存）。", omit_dataset_if_large=True)

    @_api
    def run_grounding(self, query: str = "", model_name: str = "Moment-DETR") -> dict:
        clean = query.strip()
        if not clean:
            pair = self._selected_pair()
            if pair:
                clean = f"A {pair[0]} is {pair[1].lower()}."
            else:
                clean = "A Mallard Duck is sensing."
        segment = self._active_segment()
        gt = (segment.start, segment.end) if segment else (0.0, 1.0)
        video = self.project.video_name or "ak_000123.mp4"
        self.grounding_result = self.ai_engine.run_temporal_grounding(
            video=video,
            nl_query=clean,
            ground_truth_segment=gt,
            model_name=model_name,
        )
        window = self.grounding_result["output"]["top1_window"]
        return self._state(f"语言定位完成：{window[0]:.2f}s – {window[1]:.2f}s。", omit_dataset_if_large=True)
