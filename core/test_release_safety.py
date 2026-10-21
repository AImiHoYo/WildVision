"""Release safety regressions; all I/O is confined to synthetic temporary trees."""
from __future__ import annotations

import copy
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from desktop.api import BackendAPI
from desktop.media_server import LocalMediaServer
import dataset_manager as dm
from media_tools import ffmpeg_executable
import storage


class ReleaseSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.media_temp = tempfile.TemporaryDirectory(prefix="wildvision-test-media-")
        cls.video = Path(cls.media_temp.name) / "SYN.mp4"
        subprocess.run([ffmpeg_executable(), "-v", "error", "-y", "-f", "lavfi", "-i",
                        "testsrc2=size=160x90:rate=25:duration=2", "-c:v", "libx264",
                        str(cls.video)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.media_temp.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="wildvision-safety-")
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.home_patch = patch.object(Path, "home", return_value=self.home)
        self.home_patch.start()
        # Even when tests run from an ordinary checkout, default import discovery
        # must not create or inspect that checkout's real datasets directory.
        self.datasets_patch = patch.object(dm, "default_datasets_root", return_value=self.root / "datasets")
        self.datasets_patch.start()
        self.apis = []
        self.archive = self.root / "valid.zip"
        doc = {"video": "SYN.mp4", "list_animal": ["Common Crane", "Common Crane"],
               "list_animal_action": [["Common Crane", "Attending"], ["Common Crane", "Eating"]],
               "annotations": []}
        with zipfile.ZipFile(self.archive, "w") as z:
            z.write(self.video, "videos/SYN.mp4")
            z.writestr("annotations/SYN.json", json.dumps(doc))

    def tearDown(self):
        for api in self.apis:
            if api.media_server._httpd:
                api.media_server._httpd.shutdown()
                api.media_server._httpd.server_close()
        dm._WORKSPACE_CACHE.clear()
        self.datasets_patch.stop()
        self.home_patch.stop()
        self.temp.cleanup()

    def api(self, name):
        api = BackendAPI()
        self.apis.append(api)
        api.autosave_dir = self.home / "autosave"
        self.assertTrue(api.import_dataset_zip(str(self.archive), str(self.root / name))["ok"])
        self.assertTrue(api.open_card("SYN")["ok"])
        self.assertTrue(api.create_segment("Common Crane", "Attending", .2, 1., 0)["ok"])
        self.assertTrue(api.save_current_card()["ok"])
        return api

    def test_failed_atomic_replace_preserves_card_and_cleans_temp(self):
        api = self.api("card")
        target = api.workspace_dir / "annotations/SYN.json"
        original = target.read_bytes()
        api.create_segment("Common Crane", "Eating", 1., 1.5, 1)
        replace = os.replace
        def fail(source, destination):
            if Path(destination) == target:
                raise OSError(28, "synthetic ENOSPC")
            return replace(source, destination)
        with patch.object(storage.os, "replace", side_effect=fail):
            result = api.save_current_card()
        self.assertFalse(result["ok"])
        self.assertTrue(api.is_dirty)
        self.assertEqual(target.read_bytes(), original)
        self.assertFalse(list(target.parent.glob("*.tmp")))

    def test_failed_index_replace_does_not_mutate_cached_ids(self):
        api = self.api("index")
        api.create_segment("Common Crane", "Eating", 1., 1.5, 1)
        target = api.workspace_dir / "dataset_index.json"
        original = target.read_bytes()
        previous = copy.deepcopy(dm._WORKSPACE_CACHE[str(api.workspace_dir)])
        replace = os.replace
        def fail(source, destination):
            if Path(destination) == target:
                raise PermissionError("synthetic index replacement denial")
            return replace(source, destination)
        with patch.object(storage.os, "replace", side_effect=fail):
            result = api.save_current_card()
        self.assertFalse(result["ok"])
        self.assertEqual(target.read_bytes(), original)
        self.assertEqual(dm._WORKSPACE_CACHE[str(api.workspace_dir)], previous)
        self.assertTrue(api.is_dirty)

    def test_same_name_autosaves_have_workspace_identity(self):
        first, second = self.api("one"), self.api("two")
        self.assertNotEqual(first.autosave()["path"], second.autosave()["path"])

    def test_fresh_recovery_is_dirty_and_requires_save(self):
        api = self.api("restore")
        api.create_segment("Common Crane", "Eating", 1., 1.5, 1)
        saved = api.autosave()
        fresh = BackendAPI()
        self.apis.append(fresh)
        fresh.autosave_dir = self.home / "autosave"
        result = fresh.restore_autosave(saved["path"])
        self.assertTrue(result["ok"])
        self.assertTrue(fresh.is_dirty)
        self.assertEqual(fresh.workspace_dir, api.workspace_dir)
        self.assertEqual(len(fresh.project.segments), 2)
        self.assertEqual(fresh.leave_card("check")["needs_confirm"], "leave_dirty_card")

    def test_unsafe_archive_rejected_and_new_directory_removed(self):
        archive = self.root / "unsafe.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("safe.txt", "SYNTHETIC")
            z.writestr("annotations/../SYN.json", "SYNTHETIC")
        destination = self.root / "extract"
        with self.assertRaises(ValueError):
            dm.import_dataset_archive(archive, destination)
        self.assertFalse(list(destination.rglob("*")))

    def test_upload_requires_token_and_rejects_foreign_origin(self):
        server = LocalMediaServer()
        server.set_roots(self.root / "workspace", ROOT)
        server.start()
        try:
            statuses = []
            for token, origin in [("", "null"), (server.upload_token, "https://external.invalid"),
                                  (server.upload_token, "null")]:
                connection = http.client.HTTPConnection("127.0.0.1", server._port, timeout=5)
                connection.request("POST", "/upload?name=SYN.txt&token=" + token, b"SYN",
                                   {"Content-Length": "3", "Origin": origin})
                response = connection.getresponse()
                statuses.append(response.status)
                response.read()
                connection.close()
            self.assertEqual(statuses, [403, 403, 200])
        finally:
            server._httpd.shutdown()
            server._httpd.server_close()


if __name__ == "__main__":
    unittest.main()
