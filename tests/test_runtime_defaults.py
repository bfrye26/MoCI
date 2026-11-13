import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

source=Path(__file__).parents[1]/'firmware/files/usr/libexec/moci-runtime-defaults'
loader=importlib.machinery.SourceFileLoader('runtime_defaults',str(source))
spec=importlib.util.spec_from_loader(loader.name,loader)
runtime=importlib.util.module_from_spec(spec)
loader.exec_module(runtime)


def standard():
    return {'docker':{'.type':'interface','proto':'none','device':'docker0','auto':'0'},
            'cfg123':{'.type':'device','name':'docker0','type':'bridge'},
            'lan':{'.type':'interface','proto':'static','device':'br-lan'}}


class RuntimeDefaults(unittest.TestCase):
    def test_default_empty_bridge_is_retained(self):
        self.assertEqual(runtime.plan(standard(),{}, {})['docker'],'KEEP_DEFAULT_BRIDGE')

    def test_new_image_preseeds_default_before_dockerd_boot(self):
        self.assertEqual(runtime.plan({'lan':{'.type':'interface'}},{},{})['docker'],'CREATE_DEFAULT_BRIDGE')

    def test_configured_ups_is_never_disabled(self):
        for nut,manual in (({'ups1':{'.type':'driver'}},False),({},True)):
            self.assertEqual(runtime.plan(standard(),{},nut,manual)['ups'],'PRESERVE_CONFIGURED')

    def test_unconfigured_ups_is_disabled(self):
        self.assertEqual(runtime.plan(standard(),{}, {'upsd':{'.type':'upsd'}})['ups'],'DISABLE_UNCONFIGURED')

    def test_custom_network_and_bridge_settings_are_preserved(self):
        for owner,key,value in (('docker','device','br-custom'),('docker','proto','static'),('cfg123','ports',['eth2']),('cfg123','vlan_filtering','1')):
            network=standard(); network[owner][key]=value
            self.assertEqual(runtime.plan(network,{}, {})['docker'],'PRESERVE_CUSTOM')

    def test_alternative_daemon_configuration_is_preserved(self):
        self.assertEqual(runtime.plan(standard(),{'globals':{'alt_config_file':'/etc/custom.json'}},{})['docker'],'PRESERVE_CUSTOM')

    def test_idempotent_configuration(self):
        network=standard(); network['docker']['auto']='1'; network['cfg123']['bridge_empty']='1'
        self.assertEqual(runtime.plan(network,{}, {})['docker'],'ALREADY_CONFIGURED')

    def test_duplicate_device_definitions_are_not_modified(self):
        network=standard(); network['duplicate']=dict(network['cfg123'])
        self.assertEqual(runtime.plan(network,{}, {})['docker'],'PRESERVE_CUSTOM')

    def test_running_containers_block_before_any_mutation(self):
        calls=[]
        def command(args,*unused,**kwargs):
            calls.append(args)
            if args==['uci','changes']: return SimpleNamespace(stdout='',returncode=0)
            if args==['docker','ps','-q']: return SimpleNamespace(stdout='existing-container\n',returncode=0)
            raise AssertionError('Unexpected mutation: '+str(args))
        identity='97b3d07b-5b50-4662-9d1e-86f3fa22a857'
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            previous=os.umask(0o077)
            try:
                with patch.object(runtime,'config',side_effect=lambda name:standard() if name=='network' else {}), patch.object(runtime,'run',side_effect=command), patch.object(Path,'read_text',return_value=identity), patch.object(Path,'is_file',return_value=False), patch('sys.argv',['check','--apply','--live','--expect-hardware-uuid',identity,'--output',directory]), patch('sys.stdout',new_callable=io.StringIO):
                    result=runtime.main()
                report=json.loads((Path(directory)/'runtime-report.json').read_text())
            finally:
                os.umask(previous)
        self.assertEqual(result,1)
        self.assertFalse(report['applied'])
        self.assertEqual(calls,[['uci','changes'],['docker','ps','-q']])

    def test_idle_bridge_with_gateway_is_healthy_without_carrier(self):
        with patch.object(Path,'is_dir',return_value=True), patch.object(runtime,'default_gateway',return_value={'172.17.0.1'}), patch.object(runtime,'run',return_value=SimpleNamespace(stdout='docker0: <NO-CARRIER,UP> state DOWN\n    inet 172.17.0.1/16 scope global docker0\n')):
            self.assertTrue(runtime.bridge_ready())

    def test_missing_gateway_is_not_healthy(self):
        with patch.object(Path,'is_dir',return_value=True), patch.object(runtime,'default_gateway',return_value={'172.17.0.1'}), patch.object(runtime,'run',return_value=SimpleNamespace(stdout='docker0: <UP>\n')):
            self.assertFalse(runtime.bridge_ready())


if __name__=='__main__':
    unittest.main()
