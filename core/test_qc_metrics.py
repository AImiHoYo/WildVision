"""Stage 1 dual-annotator robustness metrics."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from labels import ParseError, parse_label_input
from qc_metrics import (
    arbitrate,
    arbitrate_one,
    average_merge,
    compare_annotations,
    export_markdown_and_latex_table,
    load_annotation,
    temporal_iou,
)

DOC_A = {
    "video": "ak_000123.mp4",
    "source_labels": [["Mallard Duck", "Sensing"], ["Common Snipe", "Flapping"]],
    "annotations": [
        {
            "animal": "Mallard Duck",
            "action": "Sensing",
            "start": 0.0,
            "end": 1.0,
            "start_frame": 0,
            "end_frame": 25,
        },
        {
            "animal": "Common Snipe",
            "action": "Flapping",
            "start": 2.4,
            "end": 5.2,
            "start_frame": 60,
            "end_frame": 130,
        },
    ],
}

DOC_B = {
    "video": "ak_000123.mp4",
    "source_labels": [["Mallard Duck", "Sensing"], ["Common Snipe", "Flapping"]],
    "annotations": [
        {
            "animal": "Mallard Duck",
            "action": "Sensing",
            "start": 0.08,
            "end": 1.04,
            "start_frame": 2,
            "end_frame": 26,
        },
        {
            "animal": "Common Snipe",
            "action": "Flapping",
            "start": 3.1,
            "end": 5.0,
            "start_frame": 78,
            "end_frame": 125,
        },
    ],
}


def _identical() -> dict:
    return {
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


class QcMetricTests(unittest.TestCase):
    def test_document_example_iou(self) -> None:
        self.assertAlmostEqual(temporal_iou(0.0, 1.0, 0.08, 1.04), 0.92 / 1.04, places=6)
        self.assertAlmostEqual(temporal_iou(2.4, 5.2, 3.1, 5.0), 1.9 / 2.8, places=6)
        report = compare_annotations(DOC_A, DOC_B, fps=25)
        rows = {tuple(row["label"]): row for row in report["segment_comparisons"]}
        duck = rows[("Mallard Duck", "Sensing")]
        snipe = rows[("Common Snipe", "Flapping")]
        self.assertAlmostEqual(duck["temporal_iou"], 0.885, places=3)
        self.assertEqual(duck["status"], "VERIFIED")
        self.assertAlmostEqual(snipe["temporal_iou"], 0.679, places=3)
        self.assertEqual(snipe["status"], "NEEDS_ARBITRATION")
        self.assertIn("0.679", snipe["reason"])
        self.assertIn("0.70", snipe["reason"])
        self.assertEqual(report["overall_metrics"]["robustness_verdict"], "NEEDS_REVIEW")
        self.assertIn("std_start_boundary_error_sec", report["overall_metrics"])
        self.assertIn("std_end_boundary_error_sec", report["overall_metrics"])

    def test_identical_kappa_is_one(self) -> None:
        report = compare_annotations(_identical(), _identical(), fps=25)
        metrics = report["overall_metrics"]
        self.assertEqual(metrics["cohens_kappa_frame_level"], 1.0)
        self.assertEqual(metrics["krippendorffs_alpha"], 1.0)
        self.assertEqual(metrics["std_start_boundary_error_sec"], 0.0)
        self.assertEqual(metrics["robustness_verdict"], "HIGH_QUALITY_ROBUST (Meets 18-25 pt Rubric Tier)")

    def test_average_merge_frames_and_arbitrate_roundtrip(self) -> None:
        merged_duck = average_merge(
            {"animal": "Mallard Duck", "action": "Sensing", "start": 0.0, "end": 1.0},
            {"animal": "Mallard Duck", "action": "Sensing", "start": 0.08, "end": 1.04},
            25,
        )
        self.assertEqual(merged_duck["start_frame"], 1)
        self.assertEqual(merged_duck["end_frame"], 26)
        report = compare_annotations(DOC_A, DOC_B, fps=25)
        document = arbitrate(report, strategy="average")
        self.assertEqual(set(document), {"video", "source_labels", "annotations"})
        flapping = next(item for item in document["annotations"] if item["action"] == "Flapping")
        sensing = next(item for item in document["annotations"] if item["action"] == "Sensing")
        self.assertEqual(sensing["start_frame"], 0)
        self.assertEqual(sensing["end_frame"], 25)
        self.assertEqual(flapping["start_frame"], 69)
        self.assertEqual(flapping["end_frame"], 127)
        parsed = parse_label_input(json.dumps(document))
        self.assertEqual(parsed.video, "ak_000123.mp4")
        self.assertEqual(len(parsed.annotations), 2)

    def test_single_row_can_keep_b_or_average(self) -> None:
        report = compare_annotations(DOC_A, DOC_B, fps=25)
        index = next(position for position, row in enumerate(report["segment_comparisons"]) if row["label"][1] == "Flapping")
        kept_b, seek_b = arbitrate_one(report, index, "b")
        flapping_b = next(item for item in kept_b["annotations"] if item["action"] == "Flapping")
        sensing = next(item for item in kept_b["annotations"] if item["action"] == "Sensing")
        self.assertEqual(flapping_b["start_frame"], 78)
        self.assertEqual(flapping_b["end_frame"], 125)
        self.assertEqual(sensing["start_frame"], 0)
        self.assertEqual(seek_b, 3.1)
        averaged, _seek = arbitrate_one(report, index, "average")
        flapping_m = next(item for item in averaged["annotations"] if item["action"] == "Flapping")
        self.assertEqual(flapping_m["start_frame"], 69)
        self.assertEqual(flapping_m["end_frame"], 127)

    def test_tables_include_tiou(self) -> None:
        report = compare_annotations(DOC_A, DOC_B, fps=25)
        markdown, latex = export_markdown_and_latex_table(report)
        self.assertIn("tIoU", markdown)
        self.assertIn("tIoU", latex)
        self.assertIn("tabular", latex)

    def test_load_annotation_rejects_inverted_span(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bad.json"
            path.write_text(
                json.dumps(
                    {
                        "video": "a.mp4",
                        "source_labels": [["Goat", "Walking"]],
                        "annotations": [
                            {"animal": "Goat", "action": "Walking", "start": 2, "end": 1, "start_frame": 50, "end_frame": 25}
                        ],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaises(ParseError):
                load_annotation(path)


if __name__ == "__main__":
    unittest.main()
