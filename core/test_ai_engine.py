"""Offline action-recognition and grounding cache."""

from __future__ import annotations

import unittest

import ai_engine
from ai_engine import AIEngine, DeviceProbe


class AiEngineTests(unittest.TestCase):
    def test_offline_cache_metrics(self) -> None:
        engine = AIEngine()
        action = engine.run_action_recognition(
            video="ak_000123.mp4",
            clip_start=0.0,
            clip_end=1.0,
            ground_truth_action="Sensing",
            model_name="VideoMAE",
        )
        evaluation = action["stage2_action_recognition"]["output"]["dataset_evaluation"]
        self.assertEqual(evaluation["accuracy"], 0.885)
        self.assertEqual(evaluation["macro_f1"], 0.872)
        matrix = evaluation["confusion_matrix"]
        self.assertEqual(len(matrix), 6)
        self.assertTrue(all(len(row) == 6 for row in matrix))
        self.assertEqual(action["stage2_action_recognition"]["output"]["runtime"], "offline_cache")

        grounding = engine.run_temporal_grounding(
            video="ak_000123.mp4",
            nl_query="A Mallard Duck is sensing.",
            model_name="Moment-DETR",
            ground_truth={"start": 0.0, "end": 1.0},
        )
        block = grounding["bonus_temporal_grounding"]["output"]
        self.assertEqual(block["dataset_evaluation"]["mIoU"], 0.684)
        self.assertEqual(block["dataset_evaluation"]["R1_iou_05"], 0.792)
        self.assertEqual(block["dataset_evaluation"]["R1_iou_07"], 0.615)
        self.assertEqual(block["predicted_intervals"][0]["iou_with_gt"], 0.941)

    def test_missing_torch_uses_offline_cache(self) -> None:
        original = ai_engine._import_torch

        def _missing():
            raise ImportError("torch")

        ai_engine._import_torch = _missing
        try:
            self.assertEqual(DeviceProbe().detect(), "offline_cache")
        finally:
            ai_engine._import_torch = original


if __name__ == "__main__":
    unittest.main()
