"""Parser and export schema, matching the web annotator."""

from __future__ import annotations

import unittest

from labels import (
    ParseError,
    Segment,
    build_export,
    export_filename,
    format_time,
    frame_index,
    parse_label_input,
    round_seconds,
    serialize_export,
)


class ParseTests(unittest.TestCase):
    def test_json_pairs(self) -> None:
        parsed = parse_label_input('[["Mallard Duck", "Sensing"], ["Common Snipe", "Flapping"]]')
        self.assertEqual(parsed.kind, "labels")
        self.assertEqual(parsed.source_labels, [("Mallard Duck", "Sensing"), ("Common Snipe", "Flapping")])
        self.assertEqual(parsed.annotations, [])

    def test_one_json_pair(self) -> None:
        parsed = parse_label_input('["Mallard Duck", "Sensing"]')
        self.assertEqual(parsed.source_labels, [("Mallard Duck", "Sensing")])

    def test_objects(self) -> None:
        parsed = parse_label_input('[{"animal":"Goat","action":"Walking"}]')
        self.assertEqual(parsed.source_labels, [("Goat", "Walking")])

    def test_previous_export(self) -> None:
        parsed = parse_label_input(
            """{
              "video": "ak_000123.mp4",
              "source_labels": [["Mallard Duck", "Sensing"], ["Common Snipe", "Flapping"]],
              "annotations": [
                {"animal":"Mallard Duck","action":"Sensing","start":0,"end":1,"start_frame":0,"end_frame":25}
              ]
            }"""
        )
        self.assertEqual(parsed.kind, "project")
        self.assertEqual(parsed.video, "ak_000123.mp4")
        self.assertEqual(parsed.source_labels, [("Mallard Duck", "Sensing"), ("Common Snipe", "Flapping")])
        self.assertEqual(parsed.annotations[0]["start"], 0)
        self.assertEqual(parsed.annotations[0]["end"], 1)
        self.assertEqual(parsed.annotations[0]["start_frame"], 0)
        self.assertEqual(parsed.annotations[0]["end_frame"], 25)

    def test_labels_from_annotations(self) -> None:
        parsed = parse_label_input(
            """{
              "video": "ak_000123.mp4",
              "annotations": [
                {"animal":"Goat","action":"Walking","start":1,"end":2,"start_frame":25,"end_frame":50}
              ]
            }"""
        )
        self.assertEqual(parsed.source_labels, [("Goat", "Walking")])

    def test_csv_header(self) -> None:
        parsed = parse_label_input('animal,action\n"Mallard Duck","Sensing"\n"Common Snipe","Flapping"')
        self.assertEqual(parsed.source_labels, [("Mallard Duck", "Sensing"), ("Common Snipe", "Flapping")])

    def test_csv_without_header(self) -> None:
        parsed = parse_label_input("Mallard Duck, Sensing\nCommon Snipe, Flapping")
        self.assertEqual(parsed.source_labels, [("Mallard Duck", "Sensing"), ("Common Snipe", "Flapping")])

    def test_python_tuples(self) -> None:
        parsed = parse_label_input(
            """[
              ('Common Snipe', 'Flapping'),
              ("Steller's Sea Eagle", 'Flying'),
              ('Mallard Duck', 'Sensing'),
            ]"""
        )
        self.assertEqual(
            parsed.source_labels,
            [("Common Snipe", "Flapping"), ("Steller's Sea Eagle", "Flying"), ("Mallard Duck", "Sensing")],
        )

    def test_dash_and_comments(self) -> None:
        parsed = parse_label_input("# given AR list\nCommon Snipe - Flapping\nMallard Duck | Sensing")
        self.assertEqual(parsed.source_labels, [("Common Snipe", "Flapping"), ("Mallard Duck", "Sensing")])

    def test_dedupe(self) -> None:
        parsed = parse_label_input("('Goat', 'Walking')\nGoat, Walking\n('Bird', 'Flying')")
        self.assertEqual(parsed.duplicate_count, 1)
        self.assertEqual(parsed.source_labels, [("Goat", "Walking"), ("Bird", "Flying")])

    def test_bom(self) -> None:
        parsed = parse_label_input("\ufeffanimal,action\nGoat,Walking")
        self.assertEqual(parsed.source_labels, [("Goat", "Walking")])

    def test_rejects_empty_and_inverted(self) -> None:
        with self.assertRaises(ParseError):
            parse_label_input("   ")
        with self.assertRaisesRegex(ParseError, "结束时间"):
            parse_label_input(
                '{"video":"a.mp4","source_labels":[["Goat","Walking"]],"annotations":[{"animal":"Goat","action":"Walking","start":2,"end":1}]}'
            )


class ExportTests(unittest.TestCase):
    def test_schema_and_frames(self) -> None:
        segments = [
            Segment("b", "Common Snipe", "Flapping", 3, 6),
            Segment("a", "Mallard Duck", "Sensing", 0, 1),
            Segment("c", "Mallard Duck", "Sensing", 9, 12),
        ]
        document = build_export(
            "ak_000123.mp4",
            [("Mallard Duck", "Sensing"), ("Common Snipe", "Flapping"), ("Common Snipe", "Eating")],
            segments,
            25,
        )
        self.assertEqual(list(document), ["video", "source_labels", "annotations"])
        self.assertEqual(document["video"], "ak_000123.mp4")
        self.assertEqual(
            document["source_labels"],
            [["Mallard Duck", "Sensing"], ["Common Snipe", "Flapping"], ["Common Snipe", "Eating"]],
        )
        self.assertEqual([item["start"] for item in document["annotations"]], [0, 3, 9])
        self.assertEqual(
            list(document["annotations"][0]),
            ["animal", "action", "start", "end", "start_frame", "end_frame"],
        )
        self.assertEqual(
            document["annotations"][0],
            {
                "animal": "Mallard Duck",
                "action": "Sensing",
                "start": 0,
                "end": 1,
                "start_frame": 0,
                "end_frame": 25,
            },
        )
        self.assertEqual(document["annotations"][2]["start_frame"], 225)
        self.assertEqual(document["annotations"][2]["end_frame"], 300)
        self.assertIn('"end_frame": 25', serialize_export(document))
        self.assertEqual(export_filename("ak_000123.mp4"), "ak_000123.ar.json")

    def test_time_rounding(self) -> None:
        self.assertEqual(round_seconds(1.2346), 1.235)
        self.assertEqual(frame_index(0, 25), 0)
        self.assertEqual(frame_index(1, 25), 25)
        self.assertEqual(frame_index(0.04, 25), 1)
        self.assertEqual(format_time(0), "00:00.000")
        self.assertEqual(format_time(65.5), "01:05.500")
        self.assertEqual(format_time(3661.25), "1:01:01.250")


if __name__ == "__main__":
    unittest.main()
