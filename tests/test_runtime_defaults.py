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
    def test_stock_wan_block_requires_established_reply_guard(self):
        configuration={'firewall':{'.type':'firewall','device':'docker0','blocked_interfaces':'wan'}}
        self.assertEqual(runtime.return_policy_plan(configuration),'ADD_RETURN_GUARD')
        configuration['firewall']['extra_iptables_args']=runtime.RETURN_GUARD
        self.assertEqual(runtime.return_policy_plan(configuration),'ALREADY_CONFIGURED')

    def test_custom_wan_filter_is_preserved(self):
        self.assertEqual(runtime.return_policy_plan({'firewall':{'.type':'firewall','device':'docker0','blocked_interfaces':'wan','extra_iptables_args':'--source 192.0.2.0/24'}}),'PRESERVE_CUSTOM')

    def test_cleanup_matches_only_exact_legacy_stock_rule(self):
        exact='-A DOCKER-USER -i eth1 -o docker0 -j REJECT'
        self.assertTrue(runtime.legacy_reject(exact,'eth1'))
        self.assertTrue(runtime.legacy_reject(exact+' --reject-with icmp-port-unreachable','eth1'))
        self.assertFalse(runtime.legacy_reject(exact,'eth2'))
        self.assertFalse(runtime.legacy_reject(exact+' -s 192.0.2.0/24','eth1'))
        self.assertFalse(runtime.legacy_reject('-A DOCKER-USER -i eth1 -o docker0 -m conntrack ! --ctstate RELATED,ESTABLISHED -j REJECT','eth1'))

    def test_return_repair_verifies_guard_before_deleting_legacy_rule(self):
        calls=[]; old='-A DOCKER-USER -i eth1 -o docker0 -j REJECT\n'; reads=0
        def command(args,*unused,**kwargs):
            nonlocal reads
            calls.append(args)
            if args[0]=='ubus': return SimpleNamespace(stdout='{"up":true,"l3_device":"eth1"}',returncode=0)
            if '-S' in args:
                reads+=1
                return SimpleNamespace(stdout=old if reads==1 else '',returncode=0)
            return SimpleNamespace(stdout='',returncode=0)
        report={'checks':[]}
        with patch.object(runtime,'run',side_effect=command): runtime.repair_return_rules(report)
        deletion=next(i for i,args in enumerate(calls) if '-D' in args)
        self.assertTrue(any('-C' in args and 'RELATED,ESTABLISHED' in args for args in calls[:deletion]))
        self.assertEqual(report['wan_return_policy']['legacy_unconditional_rules_removed'],1)
    def test_diagnostics_do_not_enter_configuration_repair(self):
        identity='97b3d07b-5b50-4662-9d1e-86f3fa22a857'
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            previous=os.umask(0o077)
            try:
                def collect(report):
                    report['success']=True
                    report['diagnostics_only']=True
                with patch.object(runtime,'diagnose',side_effect=collect), patch.object(runtime,'config') as configuration, patch.object(runtime,'run') as command, patch.object(Path,'read_text',return_value=identity), patch('sys.argv',['check','--diagnose-only','--live','--expect-hardware-uuid',identity,'--output',directory]), patch('sys.stdout',new_callable=io.StringIO):
                    self.assertEqual(runtime.main(),0)
                    configuration.assert_not_called()
                    command.assert_not_called()
                report=json.loads((Path(directory)/'runtime-report.json').read_text())
                self.assertFalse(report['applied'])
                self.assertFalse(report['release_ready'])
            finally:
                os.umask(previous)

    def test_missing_default_docker_wan_forwarding_is_added(self):
        firewall={'wan':{'.type':'zone','name':'wan','input':'REJECT'},'docker':{'.type':'zone','name':'docker','network':'docker','input':'ACCEPT'}}
        self.assertEqual(runtime.egress_plan(firewall),'ADD_FORWARDING')

    def test_existing_egress_is_not_duplicated(self):
        firewall={'wan':{'.type':'zone','name':'wan'},'docker':{'.type':'zone','name':'docker','network':'docker'},'rule':{'.type':'forwarding','src':'docker','dest':'wan'}}
        self.assertEqual(runtime.egress_plan(firewall),'ALREADY_CONFIGURED')

    def test_fresh_image_can_preseed_upstream_docker_zone(self):
        self.assertEqual(runtime.egress_plan({'wan':{'.type':'zone','name':'wan'}}),'CREATE_ZONE_AND_FORWARDING')

    def test_custom_or_shared_docker_zone_is_preserved(self):
        for docker in ({'.type':'zone','name':'custom','network':'docker'},{'.type':'zone','name':'docker','network':['docker','lan']}):
            self.assertEqual(runtime.egress_plan({'wan':{'.type':'zone','name':'wan'},'custom':docker}),'PRESERVE_CUSTOM')

    def test_unrelated_owned_section_is_not_overwritten(self):
        with self.assertRaisesRegex(RuntimeError,'already used'):
            runtime.egress_plan({'wan':{'.type':'zone','name':'wan'},'moci_default_docker_wan':{'.type':'rule','src':'wan'}})

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

    def test_container_failure_retains_error_and_cleans_up(self):
        calls=[]
        def command(args,*unused,**kwargs):
            calls.append(args)
            if args[:2]==['docker','run']:
                return SimpleNamespace(returncode=125,stderr='OCI runtime: test container could not start',stdout='')
            return SimpleNamespace(returncode=0,stderr='',stdout='')
        report={'checks':[]}
        with patch.object(runtime,'run',side_effect=command), self.assertRaisesRegex(RuntimeError,'could not launch'):
            runtime.smoke_test(report,'busybox:1.37')
        self.assertIn('OCI runtime',report['checks'][0]['detail'])
        self.assertEqual(calls[-1][:3],['docker','rm','-f'])

    def test_dns_failure_does_not_hide_http_result(self):
        def command(args,*unused,**kwargs):
            failure=args[:2]==['docker','run'] and 'nslookup' in args
            return SimpleNamespace(returncode=1 if failure else 0,stderr='DNS timed out' if failure else '',stdout='')
        report={'checks':[]}
        with patch.object(runtime,'run',side_effect=command), self.assertRaisesRegex(RuntimeError,'network validation failed'):
            runtime.smoke_test(report,'busybox:1.37')
        self.assertEqual([check['status'] for check in report['checks']],['FAIL','PASS'])


if __name__=='__main__':
    unittest.main()
