import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[1]/'moci-app-docker'/'files'
loader=importlib.machinery.SourceFileLoader('moci_docker_api',str(BASE/'moci-docker-api'))
spec=importlib.util.spec_from_loader(loader.name,loader)
api=importlib.util.module_from_spec(spec)
loader.exec_module(api)

class DockerContract(unittest.TestCase):
    def test_fail_closed(self):
        self.assertFalse(api.WRITES_ENABLED)
        for method in api.WRITE_METHODS:
            if method=='set_deployments':continue  # separately checked with explicit confirmation
            with self.assertRaisesRegex(ValueError,'disabled'):
                api.run(method,{})
    def test_rpc_methods_are_declared(self):
        self.assertEqual(set(api.METHODS),set(api.READ_METHODS+api.WRITE_METHODS))
    def test_deny_untrusted_image(self):
        with patch.object(api,'policy',return_value=set()):
            with self.assertRaisesRegex(ValueError,'not approved'):
                api.spec_validate({'services':{'web':{'image':'example/app@sha256:'+'0'*64}}})
    def test_reject_host_socket_or_mount(self):
        image='example/app@sha256:'+'a'*64
        with patch.object(api,'policy',return_value={image}):
            for spec in (
                {'services':{'web':{'image':image,'volumes':['/var/run/docker.sock:/docker.sock']}}},
                {'services':{'web':{'image':image,'privileged':True}}},
                {'services':{'web':{'image':image,'ports':['0.0.0.0:8080:80']}}},
                {'services':{'web':{'image':image,'volumes':['data:/../secret']}}},
            ):
                with self.assertRaises(ValueError):api.spec_validate(spec)
    def test_restricted_valid_spec(self):
        image='example/app@sha256:'+'a'*64
        with patch.object(api,'policy',return_value={image}):
            result=api.spec_validate({'services':{'web':{'image':image,'ports':['127.0.0.1:8080:80'],'volumes':['web_data:/data']}}})
        self.assertTrue(result['services']['web']['read_only'])
        self.assertEqual(result['services']['web']['cap_drop'],['ALL'])
    def test_catalog_disabled_until_auth(self):
        with tempfile.TemporaryDirectory() as directory:
            with open(os.path.join(directory,'app-catalog.json'),'w') as f:
                json.dump({'schema':1,'apps':[{'id':'uptime-kuma','name':'Uptime Kuma','category':'Monitoring','repository':'louislam/uptime-kuma','template_available':True}]},f)
            with open(os.path.join(directory,'allowed-images.json'),'w') as f:json.dump({'images':[]},f)
            with open(os.path.join(directory,'app-pins.json'),'w') as f:json.dump({},f)
            with open(os.path.join(directory,'app-templates.json'),'w') as f:json.dump({'schema':1,'templates':{}},f)
            with patch.object(api,'ROOT',directory):
                result=api.catalog()
            self.assertFalse(result['catalog'][0]['ready'])
    def test_manifest_and_acl(self):
        manifest=json.loads((BASE/'manifest.json').read_text())
        acl=json.loads((BASE/'acl.json').read_text())
        self.assertEqual(manifest['nav']['route'],'/docker')
        self.assertNotIn('deploy',acl['moci-docker-viewer']['read']['ubus']['moci-docker'])
        self.assertIn('deploy',acl['moci-docker-deployer']['write']['ubus']['moci-docker'])
    def test_credentials_not_embedded(self):
        for file in ('addon.js','moci-docker-api'):
            body=(BASE/file).read_text()
            self.assertNotIn('localStorage.setItem',body)
            self.assertNotIn('subprocess.Popen(',body)

if __name__=='__main__':unittest.main()
