"""Portable data regressions use only synthetic temporary directories."""
from pathlib import Path
import json
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from desktop.api import BackendAPI
import dataset_manager as dm


class PortableLayoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='wildvision-portable-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.addCleanup(dm._WORKSPACE_CACHE.clear)

    def test_windows_root_ignores_cwd_and_meipass(self):
        executable = self.root / 'Windows portable' / 'WildVision.exe'
        executable.parent.mkdir()
        with patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'platform', 'win32'), patch.object(sys, 'executable', str(executable)), patch.object(sys, '_MEIPASS', str(self.root / 'temp-unpack'), create=True):
            self.assertEqual(dm.default_datasets_root(), executable.parent / 'datasets')
            self.assertFalse((self.root / 'temp-unpack').exists())

    def test_mac_root_is_outside_bundle(self):
        executable = self.root / 'Mac portable' / 'WildVision.app/Contents/MacOS/WildVision'
        with patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'platform', 'darwin'), patch.object(sys, 'executable', str(executable)):
            self.assertEqual(dm.default_datasets_root(), self.root / 'Mac portable/datasets')
            self.assertFalse(executable.parent.exists())

    def test_translocation_is_explicit_and_creates_no_data(self):
        executable = self.root / 'AppTranslocation/ID/d/WildVision.app/Contents/MacOS/WildVision'
        with patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'platform', 'darwin'), patch.object(sys, 'executable', str(executable)):
            with self.assertRaisesRegex(OSError, '请选择'):
                dm.default_datasets_root()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_read_only_directory_does_not_fall_back_to_home(self):
        with patch.object(dm, 'application_data_root', return_value=self.root), patch.object(Path, 'mkdir', side_effect=PermissionError('synthetic denial')):
            with self.assertRaises(OSError) as raised:
                dm.default_datasets_root()
            self.assertIn(str(self.root / 'datasets'), str(raised.exception))
        self.assertEqual(list(self.root.iterdir()), [])

    def test_relocated_dataset_rebinds_index_without_changing_annotations(self):
        old = self.root / 'old/datasets/SYN'
        (old / 'annotations').mkdir(parents=True)
        doc = {'video_id': 'SYN', 'video': 'SYN.mp4', 'list_animal': ['Bird'], 'list_animal_action': [['Bird', 'Eating']], 'annotations': [{'animal': 'Bird', 'actions': [{'action': 'Eating', 'start': 1, 'end': 2}]}]}
        annotation = old / 'annotations/SYN.json'
        annotation.write_text(json.dumps(doc))
        dm.initialize_workspace(old)
        original = annotation.read_bytes()
        new = self.root / 'moved/datasets/SYN'
        new.parent.mkdir(parents=True)
        shutil.move(str(old), new)
        loaded = dm.load_workspace_index(new)
        self.assertEqual(loaded['workspace_dir'], str(new.resolve()))
        self.assertEqual((new / 'annotations/SYN.json').read_bytes(), original)
        self.assertEqual(json.loads((new / 'dataset_index.json').read_text())['workspace_dir'], str(new.resolve()))

    def test_portable_autosave_identity_survives_move(self):
        with patch.object(sys, 'frozen', True, create=True), patch('desktop.api.repo_root', return_value=ROOT), patch('desktop.api.application_data_root', return_value=self.root):
            api = BackendAPI()
            api.workspace_dir = self.root / 'datasets/SYN'
            api.active_card_id = 'SYN'
            identity = api._autosave_identity()
            self.assertEqual(api.autosave_dir, self.root / 'runtime/autosave')
            with patch('desktop.api.application_data_root', return_value=self.root / 'moved'):
                api.workspace_dir = self.root / 'moved/datasets/SYN'
                self.assertEqual(api._autosave_identity(), identity)

class SourceSnapshotTests(unittest.TestCase):
    def test_source_snapshot_excludes_untracked_data_and_rejects_tracked_env(self):
        import importlib.util
        import subprocess
        spec = importlib.util.spec_from_file_location('portable_packaging', ROOT / 'scripts/package_release.py')
        packaging = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(packaging)
        with tempfile.TemporaryDirectory(prefix='wildvision-source-test-') as folder:
            repo = Path(folder) / 'repo'; repo.mkdir()
            subprocess.run(['git', 'init', '-q', str(repo)], check=True)
            def git(*args):
                subprocess.run(['git', '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', *args], cwd=repo, check=True, capture_output=True)
            (repo / 'README.md').write_text('SYNTHETIC SOURCE')
            (repo / 'private.txt').write_text('UNTRACKED SYNTHETIC DATA')
            git('add', 'README.md'); git('commit', '-qm', 'synthetic source')
            stage = Path(folder) / 'safe'; stage.mkdir()
            packaging.stage_public_source(repo, stage)
            self.assertTrue((stage / 'README.md').is_file())
            self.assertFalse((stage / 'private.txt').exists())
            (repo / '.env').write_text('SYNTHETIC_PLACEHOLDER=yes')
            git('add', '-f', '.env'); git('commit', '-qm', 'synthetic forbidden file')
            rejected = Path(folder) / 'rejected'; rejected.mkdir()
            with self.assertRaisesRegex(ValueError, 'Credential'):
                packaging.stage_public_source(repo, rejected)


if __name__ == '__main__':
    unittest.main()
