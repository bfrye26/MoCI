"""Offline regression tests. No Docker daemon or live firewall is used."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
FW=runpy.run_path(str(ROOT/'integrations/docker-manager/moci-app-docker/files/moci-docker-firewall'))
G=FW['reconcile'].__globals__

class FirewallReconcileTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT)
        self.state=Path(self.tmp.name)/'state'
        self.patcher=patch.dict(G,{'STATE':self.state})
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.addCleanup(self.tmp.cleanup)
        self.desired={'devices':[],'rules':{}}

    def cached(self,config):
        desired=json.dumps(self.desired,sort_keys=True,separators=(',',':'))
        self.state.write_text(json.dumps({
            'desired':hashlib.sha256(desired.encode()).hexdigest(),
            'config':FW['snapshot_digest'](config)}))

    def test_unchanged_config_is_noop(self):
        self.cached('original')
        with patch.dict(G,{'firewall_snapshot':lambda:'original',
                           'current_owned':lambda:(False,[])}):
            self.assertFalse(FW['reconcile'](self.desired)['changed'])

    def test_changed_config_reconciles_even_when_ids_match(self):
        self.cached('original')
        with patch.dict(G,{'firewall_snapshot':lambda:'edited',
                           'current_owned':lambda:(False,[])}), \
             patch.object(G['tempfile'],'mkstemp',side_effect=RuntimeError('reconcile reached')):
            with self.assertRaisesRegex(RuntimeError,'reconcile reached'):
                FW['reconcile'](self.desired)

    def test_old_or_invalid_state_does_not_skip_reconcile(self):
        for state in ('old-digest','42','[]','{"desired":"wrong"}'):
            self.state.write_text(state)
            with patch.dict(G,{'firewall_snapshot':lambda:'',
                               'current_owned':lambda:(False,[])}), \
                 patch.object(G['tempfile'],'mkstemp',side_effect=RuntimeError('reconcile reached')):
                with self.assertRaisesRegex(RuntimeError,'reconcile reached'):
                    FW['reconcile'](self.desired)

    def test_any_zone_and_wildcard_ownership_conflict(self):
        for name,device in (('docker','br-aaaaaaaaaaaa'),('@zone[3]','br-*'),('custom','br-aaaaaaaaaaaa')):
            config=f"firewall.{name}=zone\nfirewall.{name}.device='{device}' 'docker0'\n"
            with self.assertRaisesRegex(ValueError,'already assigned'):
                FW['check_bridge_ownership'](config,['br-aaaaaaaaaaaa'])

    def test_owned_zone_and_unrelated_rules_are_allowed(self):
        config="firewall.moci_docker_zone=zone\nfirewall.moci_docker_zone.device='br-*'\nfirewall.test=rule\nfirewall.test.device='br-*'\n"
        FW['check_bridge_ownership'](config,['br-aaaaaaaaaaaa'])

    def test_pending_operator_edits_block_before_mutation(self):
        calls=[]
        def call(*args,**kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args,0,'firewall.example.target=ACCEPT','')
        with patch.dict(G,{'call':call}):
            with self.assertRaisesRegex(ValueError,'Pending firewall edits'):
                FW['reconcile'](self.desired)
        self.assertEqual(calls,[('/sbin/uci','changes','firewall')])

    def test_owned_zone_detection_does_not_match_substrings(self):
        def call(*args,**kwargs):
            return subprocess.CompletedProcess(args,0,"firewall.other.name='moci_docker_zone'\n",'')
        with patch.dict(G,{'call':call}):
            self.assertEqual(FW['current_owned'](),(False,[]))

    def test_rollback_discards_helper_deltas_before_restoring(self):
        actions=[]
        real_mkstemp=tempfile.mkstemp
        def mkstemp(**kwargs):
            kwargs['dir']=self.tmp.name
            return real_mkstemp(**kwargs)
        def call(*args,**kwargs):
            actions.append(args)
            if args==('/sbin/fw4','check'):
                raise RuntimeError('invalid rules')
            return subprocess.CompletedProcess(args,0,'','')
        def copyfile(*args):actions.append(('backup',))
        def copy2(*args):actions.append(('restore',))
        with patch.dict(G,{'call':call,'firewall_snapshot':lambda:'',
                           'current_owned':lambda:(False,[])}), \
             patch.object(G['tempfile'],'mkstemp',side_effect=mkstemp), \
             patch.object(G['shutil'],'copyfile',side_effect=copyfile), \
             patch.object(G['shutil'],'copy2',side_effect=copy2):
            with self.assertRaisesRegex(RuntimeError,'invalid rules'):
                FW['reconcile'](self.desired)
        revert=actions.index(('/sbin/uci','-q','revert','firewall'))
        restore=actions.index(('restore',))
        reload=actions.index(('/etc/init.d/firewall','reload'))
        self.assertLess(revert,restore)
        self.assertLess(restore,reload)
        self.assertFalse(self.state.exists())

    @unittest.skipIf(os.name=='nt','flock requires the Linux release environment')
    def test_overlapping_sync_refuses_second_writer(self):
        import fcntl
        lock=Path(self.tmp.name)/'lock'
        with lock.open('a') as held:
            fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with patch.dict(G,{'LOCK':lock,'collect':lambda:self.fail('discovery ran without lock')}), \
                 patch.object(G['sys'],'argv',['moci-docker-firewall','sync']):
                with self.assertRaises(BlockingIOError):
                    FW['main']()

if __name__=='__main__':unittest.main(verbosity=2)
