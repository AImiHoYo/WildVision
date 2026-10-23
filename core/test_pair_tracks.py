"""Pair-level temporal annotations, independent of legacy repeated animal indices."""
import json
import unittest

from labels import Project, parse_label_input


class PairTrackTests(unittest.TestCase):
    def project(self):
        project = Project()
        project.apply(parse_label_input(json.dumps({
            "video": "synthetic.mp4",
            "list_animal": ["Flamingo", "Flamingo", "Duck"],
            "list_animal_action": [["Flamingo", "Walking"], ["Flamingo", "Drinking"], ["Duck", "Walking"]],
            "annotations": [
                {"animal": "Flamingo", "actions": [{"action": "Walking", "start": 0, "end": 2}]},
                {"animal": "Flamingo", "actions": [{"action": "Walking", "start": 1, "end": 3}]},
                {"animal": "Duck", "actions": [{"action": "Walking", "start": 1, "end": 2}]},
            ],
        })), "replace")
        return project

    def test_legacy_same_pair_overlaps_merge_but_other_species_stays_separate(self):
        project = self.project()
        flamingo = [s for s in project.segments if s.animal == "Flamingo"]
        self.assertEqual([(s.start, s.end) for s in flamingo], [(0, 3)])
        self.assertEqual(len(project.segments), 2)

    def test_same_pair_can_repeat_and_different_behaviors_can_overlap(self):
        project = self.project()
        project.create_segment("Flamingo", "Walking", 5, 7, 1)
        project.create_segment("Flamingo", "Drinking", 1, 2, 0)
        walking = sorted((s.start, s.end) for s in project.segments if s.animal == "Flamingo" and s.action == "Walking")
        self.assertEqual(walking, [(0, 3), (5, 7)])
        self.assertEqual(len(project.segments), 4)
        document = project.export_preprocessed_document()
        reopened = Project()
        reopened.apply(parse_label_input(json.dumps(document)), "replace")
        self.assertEqual(reopened.export_preprocessed_document(), document)


if __name__ == "__main__":
    unittest.main()
