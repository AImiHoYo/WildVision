"""Feature regressions using synthetic video and isolated temporary workspaces only."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from desktop.api import BackendAPI
import dataset_manager as dm
from media_tools import ffmpeg_executable


class AnnotationWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.media = tempfile.TemporaryDirectory(prefix="wildvision-workflow-media-")
        cls.addClassCleanup(cls.media.cleanup)
        cls.video = Path(cls.media.name) / "synthetic.mp4"
        subprocess.run([ffmpeg_executable(), "-v", "error", "-y", "-f", "lavfi", "-i",
                        "testsrc2=size=160x90:rate=25:duration=2", "-c:v", "libx264",
                        str(cls.video)], check=True, capture_output=True)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="wildvision-workflow-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        home = self.root / "home"
        home.mkdir()
        for context in (patch.object(Path, "home", return_value=home),
                        patch("desktop.api.repo_root", return_value=self.root),
                        patch.object(dm, "default_datasets_root", return_value=self.root / "datasets")):
            context.start()
            self.addCleanup(context.stop)
        self.addCleanup(dm._WORKSPACE_CACHE.clear)
        archive = self.root / "synthetic.zip"
        with zipfile.ZipFile(archive, "w") as z:
            for vid in ("SYN_A", "SYN_B", "SYN_C"):
                z.write(self.video, f"videos/{vid}.mp4")
                z.writestr(f"annotations/{vid}.json", json.dumps({
                    "video": f"{vid}.mp4", "list_animal": ["Common Crane", "Bird"],
                    "list_animal_action": [["Common Crane", "Attending"],
                                           ["Common Crane", "Eating"], ["Bird", "Boarding"]],
                    "annotations": []}))
        self.api = BackendAPI()
        self.addCleanup(self.close_server)
        result = self.api.import_dataset_zip(str(archive), str(self.root / "workspace"))
        self.assertTrue(result["ok"], result)
        self.assertTrue(self.api.open_card("SYN_A")["ok"])

    def close_server(self):
        if self.api.media_server._httpd:
            self.api.media_server._httpd.shutdown()
            self.api.media_server._httpd.server_close()

    def create(self, action="Attending", start=.2, end=.8):
        result = self.api.create_segment("Common Crane", action, start, end, 0)
        self.assertTrue(result["ok"], result)
        return next(s["id"] for s in result["segments"] if s["action"] == action)

    def snapshot(self):
        return copy.deepcopy(self.api.project.export_preprocessed_document())

    def test_navigation_saves_then_switches_and_rejects_duplicate_and_boundaries(self):
        self.create()
        original = self.snapshot()
        self.assertFalse(self.api.navigate_card(-1, "SYN_A")["ok"])
        self.assertTrue(self.api.is_dirty)
        self.assertTrue(self.api.navigate_card(1, "SYN_A")["ok"])
        self.assertEqual(self.api.active_card_id, "SYN_B")
        self.assertFalse(self.api.navigate_card(1, "SYN_A")["ok"])
        self.assertEqual(self.api.active_card_id, "SYN_B")
        self.assertTrue(self.api.navigate_card(-1, "SYN_B")["ok"])
        self.assertEqual(self.snapshot(), original)
        self.assertTrue(self.api.open_card("SYN_C")["ok"])
        self.assertFalse(self.api.navigate_card(1, "SYN_C")["ok"])
        self.assertEqual(self.api.active_card_id, "SYN_C")

    def test_concurrent_duplicate_navigation_moves_only_once(self):
        self.create()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.api.navigate_card(1, "SYN_A"), range(2)))
        self.assertEqual(sum(bool(result["ok"]) for result in results), 1)
        self.assertEqual(self.api.active_card_id, "SYN_B")

    def test_save_failure_keeps_original_dirty_document(self):
        self.create()
        project = self.api.project
        original = self.snapshot()
        with patch("desktop.api.save_card_document", side_effect=OSError(28, "synthetic ENOSPC")):
            result = self.api.navigate_card(1, "SYN_A")
        self.assertFalse(result["ok"])
        self.assertIs(self.api.project, project)
        self.assertEqual(self.api.active_card_id, "SYN_A")
        self.assertEqual(self.snapshot(), original)
        self.assertTrue(self.api.is_dirty)

    def test_corrupt_target_restores_document_paths_selection_and_history(self):
        sid = self.create()
        self.api.select_segment(sid)
        project = self.api.project
        original = self.snapshot()
        paths = (self.api.video_path, self.api.video_url, self.api.annotation_path)
        (self.api.workspace_dir / "annotations/SYN_B.json").write_text("{invalid", encoding="utf-8")
        result = self.api.navigate_card(1, "SYN_A")
        self.assertFalse(result["ok"])
        self.assertIs(self.api.project, project)
        self.assertEqual(self.api.active_card_id, "SYN_A")
        self.assertEqual(self.snapshot(), original)
        self.assertEqual((self.api.video_path, self.api.video_url, self.api.annotation_path), paths)
        self.assertEqual(self.api.project.selected_segment_ids, [sid])
        self.assertFalse(self.api.is_dirty)  # Original card was saved before target load.
        self.assertEqual(len(self.api.undo()["segments"]), 0)

    def test_pending_start_blocks_navigation_without_saving(self):
        self.create()
        self.assertTrue(self.api.mark_start(1.0, 0, "Attending")["ok"])
        with patch.object(self.api, "save_current_card") as save:
            result = self.api.navigate_card(1, "SYN_A")
        self.assertFalse(result["ok"])
        save.assert_not_called()
        self.assertEqual(self.api.active_card_id, "SYN_A")
        self.assertEqual(self.api.project.pending_time, 1.0)
        self.assertTrue(self.api.is_dirty)

    def test_action_change_preserves_interval_undo_redo_and_reopens(self):
        sid = self.create()
        before = copy.deepcopy(self.api.project.segments[0])
        changed = self.api.change_segment_action(sid, "Eating")
        self.assertTrue(changed["ok"], changed)
        after = self.api.project.segments[0]
        self.assertEqual((after.id, after.animal, after.track_index, after.start, after.end),
                         (before.id, before.animal, before.track_index, before.start, before.end))
        self.assertEqual(after.action, "Eating")
        self.assertEqual(self.api.undo()["segments"][0]["action"], "Attending")
        self.assertEqual(self.api.redo()["segments"][0]["action"], "Eating")
        expected = self.snapshot()
        self.assertTrue(self.api.save_current_card()["ok"])
        self.assertTrue(self.api.open_card("SYN_B")["ok"])
        self.assertTrue(self.api.open_card("SYN_A")["ok"])
        self.assertEqual(self.snapshot(), expected)

    def test_invalid_action_missing_segment_and_noop_preserve_document_history(self):
        sid = self.create()
        self.api.save_current_card()
        expected = self.snapshot()
        for segment_id, action in ((sid, "Boarding"), (sid, "unknown"), ("missing", "Eating")):
            self.assertFalse(self.api.change_segment_action(segment_id, action)["ok"])
            self.assertEqual(self.snapshot(), expected)
            self.assertFalse(self.api.is_dirty)
        self.assertTrue(self.api.change_segment_action(sid, "Attending")["ok"])
        self.assertFalse(self.api.is_dirty)
        self.assertEqual(len(self.api.undo()["segments"]), 0)

    def test_overlapping_destination_action_is_rejected_without_merge(self):
        sid = self.create()
        self.create("Eating", .5, 1.5)
        expected = self.snapshot()
        self.assertFalse(self.api.change_segment_action(sid, "Eating")["ok"])
        self.assertEqual(self.snapshot(), expected)
        self.assertEqual(len(self.api.project.segments), 2)

    def test_touching_destination_action_is_rejected_without_merge(self):
        sid = self.create()
        self.create("Eating", .8, 1.5)
        expected = self.snapshot()
        self.assertFalse(self.api.change_segment_action(sid, "Eating")["ok"])
        self.assertEqual(self.snapshot(), expected)
        # A rejected edit adds no undo record; undo removes the second creation.
        self.assertEqual(len(self.api.undo()["segments"]), 1)


if __name__ == "__main__":
    unittest.main()
