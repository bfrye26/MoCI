import importlib.machinery
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

API=Path(__file__).resolve().parents[1]/'moci-app-docker'/'files'/'moci-docker-api'
loader=importlib.machinery.SourceFileLoader('moci_deploy_rollback',str(API))
spec=importlib.util.spec_from_loader(loader.name,loader)
api=importlib.util.module_from_spec(spec)
loader.exec_module(api)


class DeploymentRecovery(unittest.TestCase):
    def test_failed_first_install_stops_partial_containers(self):
        with tempfile.TemporaryDirectory() as location:
            calls=[]
            def compose(name,arguments):
                calls.append(list(arguments))
                if arguments[0]=='up':
                    raise ValueError('unhealthy container')
            spec={'services':{'app':{'image':'example/image'}}}
            with patch.object(api,'STACKS',location),patch.object(api,'spec_validate',return_value=spec):
                with patch.object(api,'compose',side_effect=compose):
                    with self.assertRaisesRegex(ValueError,'unhealthy container'):
                        api.deploy('first',json.dumps(spec))
            self.assertEqual(calls,[['up','-d','--wait','--remove-orphans'],
                                    ['down','--remove-orphans']])
            self.assertFalse((Path(location)/'first'/'compose.json').exists())

    def test_failed_update_redeploys_previous_compose(self):
        with tempfile.TemporaryDirectory() as location:
            directory=Path(location)/'existing'
            directory.mkdir()
            original=b'{"services":{"app":{"image":"old@sha256:aaa"}}}'
            (directory/'compose.json').write_bytes(original)
            calls=[]
            def compose(name,arguments):
                calls.append(list(arguments))
                if len(calls)==1:raise ValueError('new container unhealthy')
            spec={'services':{'app':{'image':'new@sha256:bbb'}}}
            with patch.object(api,'STACKS',location),patch.object(api,'spec_validate',return_value=spec):
                with patch.object(api,'compose',side_effect=compose):
                    with self.assertRaisesRegex(ValueError,'new container unhealthy'):
                        api.deploy('existing',json.dumps(spec))
            self.assertEqual((directory/'compose.json').read_bytes(),original)
            self.assertEqual(calls,[['up','-d','--wait','--remove-orphans'],
                                    ['up','-d','--wait','--remove-orphans']])

    def test_failed_restore_reports_manual_recovery(self):
        with tempfile.TemporaryDirectory() as location:
            directory=Path(location)/'existing'
            directory.mkdir()
            (directory/'compose.json').write_text('{"services":{}}')
            spec={'services':{'app':{'image':'new@sha256:bbb'}}}
            with patch.object(api,'STACKS',location),patch.object(api,'spec_validate',return_value=spec):
                with patch.object(api,'compose',side_effect=ValueError('network unavailable')):
                    with self.assertRaisesRegex(ValueError,'could not be restored'):
                        api.deploy('existing',json.dumps(spec))


if __name__=='__main__':
    unittest.main()
