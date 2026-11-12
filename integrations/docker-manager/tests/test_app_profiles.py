import importlib.machinery
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1] / 'moci-app-docker' / 'files'
loader = importlib.machinery.SourceFileLoader('moci_profile_api', str(ROOT / 'moci-docker-api'))
spec = importlib.util.spec_from_loader(loader.name, loader)
api = importlib.util.module_from_spec(spec)
loader.exec_module(api)


class ReviewedAppProfileTests(unittest.TestCase):
    def test_reviewed_stateful_app_profile(self):
        image='louislam/uptime-kuma@sha256:'+'a'*64
        templates={'schema':1,'templates':{
            'uptime-kuma':{'repository':'louislam/uptime-kuma',
                           'ports':['3001:3001'],
                           'volumes':['uptime-kuma-data:/app/data'],
                           'needs_write_access':True},
        }}
        app={'services':{'app':{'image':image,'ports':['192.168.50.1:3001:3001'],
                                'volumes':['uptime-kuma-data:/app/data']}}}
        with tempfile.TemporaryDirectory() as root:
            Path(root,'app-templates.json').write_text(json.dumps(templates))
            Path(root,'app-pins.json').write_text(json.dumps({'uptime-kuma':image}))
            with patch.object(api,'ROOT',root), patch.object(api,'policy',return_value={image}), patch.object(api,'lan_ip',return_value='192.168.50.1'):
                spec=api.spec_validate(app,app_id='uptime-kuma')
                self.assertFalse(spec['services']['app']['read_only'])
                self.assertEqual(spec['services']['app']['user'],'0:0')
                self.assertEqual(spec['services']['app']['cap_drop'],['ALL'])
                self.assertEqual(spec['services']['app']['security_opt'],['no-new-privileges:true'])
                self.assertEqual(spec['volumes'],{'uptime-kuma-data':{}})
                locked=api.spec_validate(app)
                self.assertTrue(locked['services']['app']['read_only'])
                self.assertEqual(locked['services']['app']['user'],'65534:65534')

    def test_cannot_steal_writable_profile(self):
        image='example/safe@sha256:'+'a'*64
        templates={'schema':1,'templates':{'safe':{
            'repository':'example/safe','ports':['3001:3001'],
            'volumes':['data:/app/data'],'needs_write_access':True}}}
        with tempfile.TemporaryDirectory() as root:
            Path(root,'app-templates.json').write_text(json.dumps(templates))
            Path(root,'app-pins.json').write_text(json.dumps({'safe':image}))
            with patch.object(api,'ROOT',root), patch.object(api,'policy',return_value={image}), patch.object(api,'lan_ip',return_value='192.168.50.1'):
                spec={'services':{'app':{'image':image,'ports':['192.168.50.1:3001:3001'],'volumes':['data:/app/data']}}}
                with self.assertRaisesRegex(ValueError,'differs'):
                    changed=json.loads(json.dumps(spec))
                    changed['services']['app']['volumes']=['other:/app/data']
                    api.spec_validate(changed,app_id='safe')
                with self.assertRaisesRegex(ValueError,'Unapproved'):
                    api.spec_validate(spec,app_id='other')

    def test_prepare_uses_fixed_root_owned_helper(self):
        import subprocess
        with patch.object(api,'writes_enabled',return_value=True):
            with patch.object(api.subprocess,'run',return_value=subprocess.CompletedProcess(args=[],returncode=0)) as runner:
                output=api.run('prepare_app',{'id':'uptime-kuma'})
        self.assertEqual(output['id'],'uptime-kuma')
        args=runner.call_args.args[0]
        self.assertEqual(args,['/usr/sbin/moci-docker-policy','prepare','uptime-kuma'])

    def test_prepare_rejects_untrusted_id(self):
        with patch.object(api,'writes_enabled',return_value=True):
            with self.assertRaisesRegex(ValueError,'Invalid application ID'):
                api.run('prepare_app',{'id':'../../bin/sh'})

    def test_catalog_exposes_installed_app_and_lan_link_only(self):
        image='example/safe@sha256:'+'a'*64
        app={'id':'safe','name':'Safe','repository':'example/safe','risk':'review',
             'template_available':True,'profile':'both','complexity':'easy'}
        import os
        with tempfile.TemporaryDirectory() as root:
            policy=Path(root,'policy');policy.mkdir()
            stacks=Path(root,'stacks');(stacks/'safe').mkdir(parents=True)
            (stacks/'safe'/'compose.json').write_text('{"services":{}}')
            (policy/'app-catalog.json').write_text(json.dumps({'schema':1,'apps':[app]}))
            (policy/'allowed-images.json').write_text(json.dumps({'images':[image]}))
            (policy/'app-pins.json').write_text(json.dumps({'safe':image}))
            (policy/'app-templates.json').write_text(json.dumps({'schema':1,'templates':{
                'safe':{'repository':'example/safe','path':'http://ROUTER_IP:8000/'}}}))
            with patch.object(api,'ROOT',str(policy)),patch.object(api,'STACKS',str(stacks)):
                with patch.object(api,'writes_enabled',return_value=True),patch.object(api,'lan_ip',return_value='192.168.50.1'):
                    result=api.catalog()['catalog'][0]
        self.assertTrue(result['ready'])
        self.assertTrue(result['installed'])
        self.assertEqual(result['url'],'http://192.168.50.1:8000/')

    def test_compose_multiservice_environment_and_resource_limits(self):
        image='example/safe@sha256:'+'a'*64
        spec={'services':{
            'db':{'image':image,'environment':{'DATABASE':'office','PORT':3306},
                  'mem_limit':'1024m','volumes':['moci-db:/var/lib/db']},
            'app':{'image':image,'environment':{'DATABASE_HOST':'db'},
                   'depends_on':['db'],'mem_limit':'1g'}
        }}
        with patch.object(api,'policy',return_value={image}):
            output=api.spec_validate(spec)
            self.assertEqual(output['services']['app']['depends_on'],['db'])
            self.assertEqual(output['services']['db']['environment']['PORT'],'3306')
            self.assertEqual(output['services']['app']['mem_limit'],'1g')
            self.assertEqual(output['volumes'],{'moci-db':{}})
            invalid=dict(spec)
            invalid['services']={'app':{'image':image,'depends_on':['missing']}}
            with self.assertRaisesRegex(ValueError,'dependency'):
                api.spec_validate(invalid)

if __name__=='__main__':
    unittest.main()
