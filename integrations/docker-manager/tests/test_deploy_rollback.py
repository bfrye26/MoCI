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
            timeouts=[]
            def compose(name,arguments,timeout=None):
                timeouts.append(timeout)
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
            self.assertEqual(timeouts,[180,None])

    def test_failed_update_redeploys_previous_compose(self):
        with tempfile.TemporaryDirectory() as location:
            directory=Path(location)/'existing'
            directory.mkdir()
            original=b'{"services":{"app":{"image":"old@sha256:aaa"}}}'
            (directory/'compose.json').write_bytes(original)
            calls=[]
            timeouts=[]
            def compose(name,arguments,timeout=None):
                timeouts.append(timeout)
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
            self.assertEqual(timeouts,[180,None])

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


    def test_export_requires_management_authorization_and_flags_secrets(self):
        with tempfile.TemporaryDirectory() as location:
            folder=Path(location)/'app'
            folder.mkdir()
            (folder/'compose.json').write_text(json.dumps({'services':{'app':{
                'image':'image@sha256:'+'a'*64,
                'environment':{'PASSWORD':'local-only-secret'}}}}))
            with patch.object(api,'STACKS',location):
                with patch.object(api,'writes_enabled',return_value=False):
                    with self.assertRaisesRegex(ValueError,'disabled'):
                        api.run('stack_config',{'name':'app'})
                with patch.object(api,'writes_enabled',return_value=True):
                    result=api.run('stack_config',{'name':'app'})
                    self.assertTrue(result['contains_secrets'])
                    self.assertEqual(result['config']['services']['app']['environment']['PASSWORD'],
                                     'local-only-secret')
                    with self.assertRaises(ValueError):
                        api.run('stack_config',{'name':'../../etc/passwd'})

    def test_export_rejects_symlinked_configuration(self):
        with tempfile.TemporaryDirectory() as location:
            folder=Path(location)/'app'
            folder.mkdir()
            target=Path(location)/'target.json'
            target.write_text('{}')
            (folder/'compose.json').symlink_to(target)
            with patch.object(api,'STACKS',location):
                with patch.object(api,'writes_enabled',return_value=True):
                    with self.assertRaisesRegex(ValueError,'not found'):
                        api.run('stack_config',{'name':'app'})


if __name__=='__main__':
    unittest.main()

