"""Unit tests for preprocessed Animal Kingdom JSONs, multi-track animal timelines, dirty-state save flow, and exports."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "pyqt_app") not in sys.path:
    sys.path.insert(0, str(ROOT / "pyqt_app"))

from desktop.api import BackendAPI  # noqa: E402


class DatasetManagerTests(unittest.TestCase):
    def test_preprocessed_ak_json_multi_track_annotation_and_export(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            zip_path = tmp_path / "ak_preprocessed_batch.zip"
            aaacxztv_json = {
                "video_id": "AAACXZTV",
                "video": "AAACXZTV.mp4",
                "fps": 25,
                "list_animal": ["Common Crane", "Common Crane"],
                "list_animal_action": [
                    ["Common Crane", "Attending"],
                    ["Common Crane", "Eating"],
                ],
                "annotations": [
                    {"animal": "Common Crane", "actions": []},
                    {"animal": "Common Crane", "actions": []},
                ],
            }
            aabcqptk_json = {
                "video_id": "AABCQPTK",
                "video": "AABCQPTK.mp4",
                "fps": 25,
                "list_animal": ["Singing Nightingale", "Singing Nightingale"],
                "list_animal_action": [
                    ["Singing Nightingale", "Attending"],
                    ["Singing Nightingale", "Chirping"],
                ],
                "annotations": [
                    {"animal": "Singing Nightingale", "actions": []},
                    {"animal": "Singing Nightingale", "actions": []},
                ],
            }
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("videos/AAACXZTV.mp4", b"fake-video-crane")
                zf.writestr("videos/AABCQPTK.mp4", b"fake-video-nightingale")
                zf.writestr("annotations/AAACXZTV.json", json.dumps(aaacxztv_json))
                zf.writestr("annotations/AABCQPTK.json", json.dumps(aabcqptk_json))

            api = BackendAPI()
            extract_dir = tmp_path / "workspace"
            res = api.import_dataset_zip(str(zip_path), str(extract_dir))
            self.assertTrue(res["ok"])
            self.assertEqual(res["view_mode"], "cards")
            self.assertEqual(len(res["dataset_items"]), 2)

            # Check card metadata: video_matched, list_animal, list_animal_action
            card_0 = next(item for item in res["dataset_items"] if item["video_id"] == "AAACXZTV")
            self.assertTrue(card_0["video_matched"])
            self.assertEqual(card_0["list_animal"], ["Common Crane", "Common Crane"])
            self.assertEqual(
                card_0["list_animal_action"],
                [["Common Crane", "Attending"], ["Common Crane", "Eating"]],
            )

            # Open AAACXZTV card
            opened = api.open_card("AAACXZTV")
            self.assertTrue(opened["ok"])
            self.assertEqual(opened["view_mode"], "studio")
            self.assertTrue(opened["video_matched"])
            self.assertEqual(opened["list_animal"], ["Common Crane", "Common Crane"])
            self.assertEqual(opened["available_actions"], ["Attending", "Eating"])
            self.assertFalse(opened["is_dirty"])

            # Annotate Track 0 (Common Crane #1) with two actions at different times
            api.select_track(0)
            api.select_action("Attending")
            api.mark_start(0.0)
            api.mark_end(0.907)

            api.select_action("Eating")
            api.mark_start(1.100)
            api.mark_end(1.600)

            # Annotate Track 1 (Common Crane #2) with Eating
            api.select_track(1)
            api.select_action("Eating")
            api.mark_start(0.0)
            marked = api.mark_end(0.666)
            self.assertTrue(marked["is_dirty"])
            self.assertEqual(len(marked["segments"]), 3)

            # Leaving while dirty prompts confirmation
            dirty_check = api.leave_card("check")
            self.assertEqual(dirty_check.get("needs_confirm"), "leave_dirty_card")

            # Save card -> writes grouped annotations to annotations/AAACXZTV.json
            saved = api.save_current_card()
            self.assertFalse(saved["is_dirty"])

            ws = Path(res["workspace_dir"])
            saved_doc = json.loads((ws / "annotations" / "AAACXZTV.json").read_text(encoding="utf-8"))
            self.assertEqual(saved_doc["video_id"], "AAACXZTV")
            self.assertEqual(saved_doc["list_animal"], ["Common Crane", "Common Crane"])
            self.assertEqual(len(saved_doc["annotations"]), 2)
            self.assertEqual(saved_doc["annotations"][0]["animal"], "Common Crane")
            self.assertEqual(
                saved_doc["annotations"][0]["actions"],
                [
                    {
                        "action": "Attending",
                        "start": 0.0,
                        "end": 0.907,
                        "start_frame": 0,
                        "end_frame": 23,
                    },
                    {
                        "action": "Eating",
                        "start": 1.1,
                        "end": 1.6,
                        "start_frame": 28,
                        "end_frame": 40,
                    },
                ],
            )
            self.assertEqual(saved_doc["annotations"][1]["animal"], "Common Crane")
            self.assertEqual(
                saved_doc["annotations"][1]["actions"],
                [
                    {
                        "action": "Eating",
                        "start": 0.0,
                        "end": 0.666,
                        "start_frame": 0,
                        "end_frame": 17,
                    }
                ],
            )

            # Leaving after manual save does not prompt
            after_save_leave = api.leave_card("check")
            self.assertEqual(after_save_leave["view_mode"], "cards")
            self.assertNotIn("needs_confirm", after_save_leave)

            # Batch export selected cards
            out_zip = tmp_path / "exported_bundle.zip"
            exp_zip = api.export_selected_cards(["AAACXZTV", "AABCQPTK"], "zip", str(out_zip))
            self.assertTrue(exp_zip["ok"])
            self.assertTrue(out_zip.is_file())

            with zipfile.ZipFile(out_zip, "r") as zf:
                names = set(zf.namelist())
                self.assertIn("annotations/AAACXZTV.json", names)
                self.assertIn("annotations/AABCQPTK.json", names)
                self.assertIn("ak_action_recognition.csv", names)
                self.assertIn("mmaction2_annotations.txt", names)
                self.assertIn("ak_vg_grounding.txt", names)
                csv_text = zf.read("ak_action_recognition.csv").decode("utf-8")
                self.assertIn(
                    "video_id,video,segment_index,track_index,animal,action,action_id,start,end,duration,start_frame,end_frame,fps,sentence",
                    csv_text,
                )
                self.assertIn("AAACXZTV,AAACXZTV.mp4,0,0,Common Crane,Attending", csv_text)


if __name__ == "__main__":
    unittest.main()
