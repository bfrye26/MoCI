import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('restore_check',Path(__file__).parents[1]/'scripts/router-restore-check.py')
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)
TEST_ID = '97b3d07b-5b50-4662-9d1e-86f3fa22a857'


class RestoreCheck(unittest.TestCase):
    def exercise(self, mismatch=False, pending=False, fail_restore=False):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            original = {'/etc/config/'+name:('baseline-'+name).encode() for name in ('system','network','dhcp','firewall')}
            state = dict(original)
            calls = []
            saved_read, saved_write, saved_text = Path.read_bytes, Path.write_bytes, Path.read_text

            def read_bytes(path):
                return state[path.as_posix()] if path.as_posix() in state else saved_read(path)

            def write_bytes(path, data):
                if path.as_posix() in state:
                    state[path.as_posix()] = data
                    return len(data)
                return saved_write(path,data)

            def read_text(path, *args, **kwargs):
                if path.as_posix() == '/sys/class/dmi/id/product_uuid':
                    return '00000000-0000-0000-0000-000000000000' if mismatch else TEST_ID
                return saved_text(path,*args,**kwargs)

            def command(args, timeout=30):
                calls.append(args)
                if args[:2] == ['uci','changes']:
                    return 'pending' if pending else ''
                if args[:2] == ['/sbin/sysupgrade','--create-backup']:
                    with tarfile.open(args[2],'w:gz') as archive:
                        for name,data in state.items():
                            entry = tarfile.TarInfo(name.lstrip('/')); entry.size = len(data)
                            archive.addfile(entry,io.BytesIO(data))
                elif args[:2] == ['uci','set']:
                    state['/etc/config/system'] = args[2].split('=',1)[1].encode()
                elif args[:2] == ['uci','get']:
                    return state['/etc/config/system'].decode()
                elif args[:2] == ['/sbin/sysupgrade','--restore-backup']:
                    if fail_restore:
                        raise RuntimeError('simulated restore error')
                    with tarfile.open(args[2],'r:gz') as archive:
                        for entry in archive:
                            state['/'+entry.name] = archive.extractfile(entry).read()
                return ''

            previous_mask = os.umask(0o077)
            try:
                with patch.object(restore,'__file__',str(root/'check.py')), patch.object(restore,'command',side_effect=command), patch.object(Path,'read_bytes',read_bytes), patch.object(Path,'write_bytes',write_bytes), patch.object(Path,'read_text',read_text), patch('sys.argv',['check.py','--expect-hardware-uuid',TEST_ID]), patch('sys.stdout',new_callable=io.StringIO):
                    result = restore.main()
                report = json.loads((root/'restore-report.json').read_text())
            finally:
                os.umask(previous_mask)
            return result,report,calls,state,original

    def test_wrong_vm_never_reaches_configuration_commands(self):
        result,report,calls,state,original = self.exercise(mismatch=True)
        self.assertEqual(result,1)
        self.assertEqual(calls,[])
        self.assertEqual(state,original)

    def test_pending_changes_stop_before_backup_or_marker(self):
        result,report,calls,state,original = self.exercise(pending=True)
        self.assertEqual(result,1)
        self.assertEqual(calls,[['uci','changes']])
        self.assertEqual(state,original)

    def test_restore_removes_marker_and_retains_all_core_files(self):
        result,report,calls,state,original = self.exercise()
        self.assertEqual(result,0)
        self.assertTrue(report['restore_checks_passed'])
        self.assertFalse(report['release_ready'])
        self.assertEqual(state,original)
        self.assertEqual(report['post_boot'],'NOT_TESTED')

    def test_restore_failure_recovers_temporary_setting_and_fails(self):
        result,report,calls,state,original = self.exercise(fail_restore=True)
        self.assertEqual(result,1)
        self.assertFalse(report['restore_checks_passed'])
        self.assertEqual(report['temporary-setting-recovery'],'PASS')
        self.assertEqual(state,original)


if __name__ == '__main__':
    unittest.main()
