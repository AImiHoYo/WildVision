"""Headless checks for the desktop bridge. No window is created."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from desktop.api import BackendAPI  # noqa: E402


class DesktopApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        from media_tools import ffmpeg_executable
        cls._media_temp = tempfile.TemporaryDirectory(prefix="wildvision-bridge-media-")
        cls.addClassCleanup(cls._media_temp.cleanup)
        cls._synthetic_video = Path(cls._media_temp.name) / "sample_ak.mp4"
        subprocess.run([
            ffmpeg_executable(), "-v", "error", "-y", "-f", "lavfi", "-i",
            "testsrc2=size=160x90:rate=25:duration=10", "-f", "lavfi", "-i",
            "sine=frequency=440:sample_rate=44100:duration=10", "-c:v", "libx264",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
            str(cls._synthetic_video),
        ], check=True, capture_output=True)

    def setUp(self) -> None:
        import dataset_manager
        self._case_temp = tempfile.TemporaryDirectory(prefix="wildvision-bridge-case-")
        self.addCleanup(self._case_temp.cleanup)
        root = Path(self._case_temp.name)
        home = root / "home"
        home.mkdir()
        public = root / "public"
        public.mkdir()
        shutil.copy2(self._synthetic_video, public / "sample_ak.mp4")
        for context in (
            patch.object(Path, "home", return_value=home),
            patch("desktop.api.repo_root", return_value=root),
            patch.object(dataset_manager, "default_datasets_root", return_value=root / "datasets"),
        ):
            context.start()
            self.addCleanup(context.stop)

    def test_demo_swap_and_export_frames(self) -> None:
        api = BackendAPI()
        state = api.load_demo()
        self.assertTrue(state["ok"])
        self.assertEqual(state["video_name"], "ak_000123.mp4")
        api.mark_start(2)
        swapped = api.mark_end(1)
        self.assertIn("对调", swapped["message"])
        self.assertEqual(swapped["segments"][0]["start"], 1.0)
        self.assertEqual(swapped["segments"][0]["end"], 2.0)
        api.undo()
        api.mark_start(0)
        api.mark_end(1)
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "ak_000123.ar.json")
            blocked = api.export_json(False, path)
            self.assertEqual(blocked["needs_confirm"], "empty_labels")
            self.assertFalse(Path(path).exists())
            saved = api.export_json(True, path)
            self.assertTrue(saved["ok"])
            text = Path(path).read_text(encoding="utf-8")
            self.assertIn('"end_frame": 25', text)
            payload = json.loads(text)
            self.assertEqual(list(payload), ["video", "source_labels", "annotations"])
            self.assertEqual(payload["video"], "ak_000123.mp4")

    def test_unsupported_species_cannot_mark_action(self) -> None:
        api = BackendAPI()
        loaded = api.parse_text(
            json.dumps(
                {
                    "video": "crane.mp4",
                    "list_animal": ["Common Crane", "Snake", "Bird"],
                    "list_animal_action": [
                        ["Common Crane", "Attending"],
                        ["Snake", "Attending"],
                        ["Bird", "Boarding"],
                    ],
                }
            ),
            "replace",
        )
        self.assertTrue(loaded["ok"])
        chosen = api.select_action("Attending")
        self.assertTrue(chosen["ok"])
        self.assertEqual(chosen["selected_track_index"], 0)
        blocked = api.mark_start(1.0, 2, "Attending")
        self.assertFalse(blocked["ok"])
        self.assertIn("没有该行为", blocked["message"])
        started = api.mark_start(0.0, 0, "Attending")
        self.assertTrue(started["ok"])
        ended = api.mark_end(1.0, 0, "Attending")
        self.assertTrue(ended["ok"])
        self.assertEqual(ended["segments"][0]["animal"], "Common Crane")
        self.assertEqual(ended["segments"][0]["action"], "Attending")

    def test_export_clips_and_large_dataset_ipc_omission(self) -> None:
        api = BackendAPI()
        api.load_demo()
        api.mark_start(0.0)
        api.mark_end(1.0)
        with tempfile.TemporaryDirectory() as folder:
            res = api.export_clips(folder)
            self.assertTrue(res["ok"])
            self.assertIn("clip_export", res)
            self.assertEqual(len(res["clip_export"]["clips"]), 1)
            self.assertTrue((Path(folder) / "mmaction2_annotations.txt").is_file())
            self.assertTrue((Path(folder) / "grounding_annotations.json").is_file())

        # Verify large dataset (>500 items) omits dataset_items on leave_card and set_view_mode
        api._set_dataset_items(
            [{"video_id": f"V{i:04d}", "video_name": f"V{i:04d}.mp4", "status": "unstarted"} for i in range(600)]
        )
        left = api.leave_card("check")
        self.assertTrue(left["ok"])
        self.assertNotIn("dataset_items", left)
        self.assertEqual(left["dataset_total"], 600)

    def test_undo_redo_multiselect_copy_paste(self) -> None:
        api = BackendAPI()
        api.load_demo()
        s1 = api.create_segment("Mallard Duck", "Sensing", 1.0, 2.0, 0)
        self.assertTrue(s1["ok"])
        seg1_id = s1["segments"][0]["id"]

        s2 = api.create_segment("Common Snipe", "Flapping", 3.0, 4.5, 1)
        self.assertTrue(s2["ok"])
        self.assertEqual(len(s2["segments"]), 2)
        seg2_id = next(seg["id"] for seg in s2["segments"] if seg["id"] != seg1_id)

        # Undo and Redo
        undone = api.undo()
        self.assertTrue(undone["ok"])
        self.assertEqual(len(undone["segments"]), 1)
        self.assertTrue(undone["can_redo"])

        redone = api.redo()
        self.assertTrue(redone["ok"])
        self.assertEqual(len(redone["segments"]), 2)
        self.assertFalse(redone["can_redo"])

        # Shift+Click multi-select
        sel1 = api.select_segment(seg1_id, False)
        self.assertEqual(sel1["selected_segment_ids"], [seg1_id])
        sel2 = api.select_segment(seg2_id, True)
        self.assertEqual(sel2["selected_segment_ids"], [seg1_id, seg2_id])

        # Multi-select Copy and Paste at playhead 6.0s
        copied = api.copy_segments(sel2["selected_segment_ids"], 2.0)
        self.assertTrue(copied["ok"])
        self.assertEqual(copied["clipboard_count"], 2)

        pasted = api.paste_segments(6.0, 0)
        self.assertTrue(pasted["ok"])
        self.assertEqual(len(pasted["segments"]), 4)
        self.assertEqual(len(pasted["selected_segment_ids"]), 2)
        starts = sorted(round(seg["start"], 3) for seg in pasted["segments"])
        self.assertEqual(starts, [1.0, 3.0, 6.0, 8.0])

        # Undo paste removes both pasted segments in one step
        undo_paste = api.undo()
        self.assertEqual(len(undo_paste["segments"]), 2)

        # Redo paste restores both pasted segments in one step
        redo_paste = api.redo()
        self.assertEqual(len(redo_paste["segments"]), 4)

    def test_reveal_json_and_video_paths(self) -> None:
        from unittest.mock import patch

        api = BackendAPI()
        api.load_demo_dataset()
        opened = api.open_card("AAACXZTV")
        self.assertTrue(opened["ok"])

        revealed: list[Path] = []
        with patch.object(api, "_reveal_in_file_manager", side_effect=lambda p: revealed.append(p)):
            json_res = api.reveal_json_path()
            self.assertTrue(json_res["ok"])
            self.assertTrue(str(json_res.get("revealed_path", "")).endswith("AAACXZTV.json"))

            video_res = api.reveal_video_path()
            self.assertTrue(video_res["ok"])
            self.assertTrue(str(video_res.get("revealed_path", "")).endswith("AAACXZTV.mp4"))

        self.assertEqual(len(revealed), 2)
        self.assertEqual(revealed[0].name, "AAACXZTV.json")
        self.assertEqual(revealed[1].name, "AAACXZTV.mp4")


if __name__ == "__main__":
    unittest.main()
