"""Clip manifest generation without requiring a decoded video."""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from clip_exporter import build_grounding_dataset, build_mmaction_list, clip_basename, export_clips, nl_query


class ClipExporterTests(unittest.TestCase):
    def test_query_and_list_names(self) -> None:
        self.assertEqual(nl_query("Mallard Duck", "Sensing"), "A Mallard Duck is sensing.")
        document = {
            "video": "ak_000123.mp4",
            "source_labels": [["Mallard Duck", "Sensing"]],
            "annotations": [
                {
                    "animal": "Mallard Duck",
                    "action": "Sensing",
                    "start": 0.0,
                    "end": 1.0,
                    "start_frame": 0,
                    "end_frame": 25,
                }
            ],
        }
        name = clip_basename("ak_000123.mp4", "Mallard Duck", "Sensing", 0)
        self.assertEqual(name, "ak_000123_Mallard_Duck_Sensing_0.mp4")
        listing = build_mmaction_list(document, [f"clips/{name}"])
        self.assertIn(f"clips/{name} 0", listing)
        grounding = build_grounding_dataset(document)
        self.assertEqual(grounding["items"][0]["nl_query"], "A Mallard Duck is sensing.")
        self.assertEqual(grounding["items"][0]["video"], "ak_000123.mp4")

    def test_export_writes_lists_when_media_cut_fails(self) -> None:
        document = {
            "video": "ak_000123.mp4",
            "source_labels": [["Mallard Duck", "Sensing"]],
            "annotations": [
                {
                    "animal": "Mallard Duck",
                    "action": "Sensing",
                    "start": 0.0,
                    "end": 1.0,
                    "start_frame": 0,
                    "end_frame": 25,
                }
            ],
        }
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "source.json"
            source.write_text(json.dumps(document), encoding="utf-8")
            out = root / "out"
            result = export_clips(source, root / "missing.mp4", out)
            self.assertTrue((out / "mmaction2_annotations.txt").is_file())
            self.assertTrue((out / "grounding_annotations.json").is_file())
            self.assertGreater(len(result["cut_errors"]), 0)
            saved = json.loads((out / "grounding_annotations.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["items"][0]["nl_query"], "A Mallard Duck is sensing.")
            if shutil.which("ffmpeg") is None:
                self.assertFalse(any((out / "clips").glob("*.mp4")))


if __name__ == "__main__":
    unittest.main()
