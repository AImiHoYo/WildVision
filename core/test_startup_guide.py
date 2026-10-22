"""Startup recovery with isolated home directories and synthetic portable packages."""
from contextlib import ExitStack
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from desktop.api import BackendAPI
import portable_paths as paths


class StartupGuideTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='wildvision-startup-test-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()
        self.home=self.root/'home';self.home.mkdir()
        self.bundle=self.root/'downloaded portable'
        self.bundle.mkdir()
        self.executable=self.bundle/('WildVision.app' if sys.platform=='darwin' else 'WildVision.exe')
        if sys.platform=='darwin':self.executable.mkdir()
        else:self.executable.write_bytes(b'SYNTHETIC')
        (self.bundle/'BUILD.json').write_text(json.dumps({'layout':'portable','version':'1.1.3'}))
        self.stack=ExitStack();self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(paths,'_selected_root',None))
        self.stack.enter_context(patch.object(Path,'home',return_value=self.home))
        self.stack.enter_context(patch.object(paths,'current_version',return_value='1.1.3'))
        self.stack.enter_context(patch.object(sys,'frozen',True,create=True))
        self.stack.enter_context(patch('desktop.api.repo_root',return_value=self.root))
        self.stack.enter_context(patch('desktop.api.application_data_root',side_effect=lambda: paths._selected_root or self.unresolved()))
        # Block only automatic discovery; explicit selection remains real filesystem I/O.
        self.apis=[]
        self.addCleanup(self.cleanup_servers)

    def unresolved(self):
        raise OSError('SYNTHETIC TRANSLOCATION')

    def cleanup_servers(self):
        for api in self.apis:
            if api.media_server._httpd:
                api.media_server._httpd.shutdown();api.media_server._httpd.server_close()

    def api(self):
        api=BackendAPI();self.apis.append(api);return api

    def test_unresolved_boot_returns_welcome_state_without_data_writes(self):
        api=self.api();state=api.get_state()
        self.assertTrue(state['ok']);self.assertTrue(state['startup_required'])
        self.assertEqual(state['available_datasets'],[])
        self.assertEqual(state['datasets_root'],'')
        self.assertIsNone(api.autosave_dir)
        self.assertFalse((self.bundle/'datasets').exists())
        self.assertFalse(api.load_demo_dataset()['ok'])
        self.assertFalse(api.autosave()['ok'])

    def test_cancel_and_wrong_folder_keep_guide_open_and_existing_files(self):
        api=self.api()
        with patch.object(api,'_choose_file',return_value=None):
            self.assertTrue(api.choose_portable_folder()['startup_required'])
        wrong=self.root/'My_Dataset';wrong.mkdir()
        marker=wrong/'annotations.json';marker.write_text('SYNTHETIC DATASET, MUST KEEP')
        result=api.choose_portable_folder(str(wrong))
        self.assertTrue(result['startup_required']);self.assertIn('请选择',result['message'])
        self.assertTrue(result['startup_error'])
        self.assertEqual(result['startup_selected_path'],str(wrong))
        self.assertIn('进入样本库后再导入',result['message'])
        self.assertEqual(marker.read_text(),'SYNTHETIC DATASET, MUST KEEP')
        self.assertFalse((wrong/'datasets').exists())
        with patch.object(api,'_choose_file',return_value=None):
            cancelled=api.choose_portable_folder()
        self.assertFalse(cancelled['startup_error'])
        result=api.choose_portable_folder(str(self.bundle),False)
        self.assertFalse(result['startup_required'])
        self.assertFalse(result['startup_error'])
        self.assertEqual(result['startup_selected_path'],str(self.bundle))

    def test_choose_remember_and_restart_from_isolated_path(self):
        api=self.api();result=api.choose_portable_folder(str(self.bundle))
        self.assertTrue(result['ok']);self.assertFalse(result['startup_required'])
        self.assertEqual(paths.application_data_root(),self.bundle)
        self.assertEqual(api.autosave_dir,self.bundle/'runtime/autosave')
        hint=json.loads(paths.preference_path().read_text())
        self.assertEqual(hint['folder'],str(self.bundle))
        paths._selected_root=None
        fresh=self.api();self.assertFalse(fresh.get_state()['startup_required'])
        self.assertEqual(fresh.autosave_dir,api.autosave_dir)
        self.assertEqual(list((self.bundle/'datasets').iterdir()),[])

    def test_unchecked_remember_and_stale_hint_require_guide_again(self):
        api=self.api();self.assertFalse(api.choose_portable_folder(str(self.bundle),False)['startup_required'])
        paths._selected_root=None
        self.assertTrue(self.api().get_state()['startup_required'])
        paths.remember_root(self.bundle,True)
        (self.bundle/'BUILD.json').write_text(json.dumps({'layout':'portable','version':'OLD'}))
        self.assertTrue(self.api().get_state()['startup_required'])

    def test_read_only_selection_stays_in_guide_and_can_retry(self):
        api=self.api()
        with patch.object(paths,'ensure_writable',side_effect=OSError('SYNTHETIC READ ONLY')):
            result=api.choose_portable_folder(str(self.bundle))
        self.assertTrue(result['startup_required']);self.assertIn('READ ONLY',result['message'])
        self.assertIsNone(paths._selected_root)
        self.assertFalse(api.choose_portable_folder(str(self.bundle))['startup_required'])

    def test_preference_write_failure_does_not_prevent_session_use(self):
        api=self.api()
        with patch.object(paths,'atomic_write_text',side_effect=PermissionError('SYNTHETIC DENIAL')):
            result=api.choose_portable_folder(str(self.bundle))
        self.assertTrue(result['ok']);self.assertFalse(result['startup_required'])
        self.assertIn('未能记住',result['message'])
        self.assertFalse(paths.preference_path().exists())


if __name__=='__main__':unittest.main()
