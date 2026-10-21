"""Checks that classification and grounding metrics are computed, not hard-coded."""

from __future__ import annotations

import unittest

from eval_metrics import accuracy, confusion_matrix, macro_f1, mean_temporal_iou, recall_at_1


class EvalMetricTests(unittest.TestCase):
    def test_accuracy_macro_f1_and_matrix(self) -> None:
        truth = ["Sensing", "Flapping", "Sensing"]
        predicted = ["Sensing", "Sensing", "Sensing"]
        labels = ["Sensing", "Flapping"]
        self.assertAlmostEqual(accuracy(truth, predicted), 2 / 3)
        self.assertEqual(confusion_matrix(truth, predicted, labels), [[2, 0], [1, 0]])
        self.assertAlmostEqual(macro_f1(truth, predicted, labels), 0.4)

    def test_grounding_miou_and_recall(self) -> None:
        pairs = [(0.04, 1.02, 0.0, 1.0), (3.0, 4.0, 0.0, 1.0)]
        self.assertAlmostEqual(mean_temporal_iou(pairs), (0.96 / 1.02 + 0.0) / 2)
        self.assertEqual(recall_at_1(pairs, 0.5), 0.5)
        self.assertEqual(recall_at_1(pairs, 0.7), 0.5)


if __name__ == "__main__":
    unittest.main()
