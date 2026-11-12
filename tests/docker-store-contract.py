#!/usr/bin/env python3
"""Offline Docker Store contract tests. No Docker daemon, root or network required."""
import json
import re
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[1]/'integrations/docker-manager/moci-app-docker/files'
API=runpy.run_path(str(BASE/'moci-docker-api'))
CATALOG=json.loads((BASE/'app-catalog.json').read_text(encoding='utf-8'))['apps']
TEMPLATES=json.loads((BASE/'app-templates.json').read_text(encoding='utf-8'))['templates']
DIGEST='louislam/uptime-kuma@sha256:'+('a'*64)


class DockerStoreContract(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        (self.root/'app-catalog.json').write_text(
            json.dumps({'schema':1,'apps':CATALOG}),encoding='utf-8')
        globals_=API['catalog'].__globals__
        self.override=patch.dict(globals_,{
            'ROOT':str(self.root),
            'STACKS':str(self.root/'stacks'),
            'policy':lambda:set(),
            'pins':lambda:{},
            'template_specs':lambda:TEMPLATES,
            'writes_enabled':lambda:False,
            'lan_ip':lambda:'192.168.50.1',
        })
        self.override.start()
        self.addCleanup(self.override.stop)

    def test_all_catalogue_entries_have_unique_safe_identifiers(self):
        self.assertEqual(len(CATALOG),73)
        ids=[a['id'] for a in CATALOG]
        self.assertEqual(len(ids),len(set(ids)))
        for app in CATALOG:
            self.assertRegex(app['id'],r'^[a-z][a-z0-9-]{0,39}$')
            self.assertTrue(app.get('name'))
            self.assertTrue(app.get('description'))
            self.assertTrue(app.get('repository'))
            self.assertIn(app.get('risk'),
                          {'review','router-critical','security-critical',
                           'resource-heavy','sensitive-data','privileged','docker-socket'})

    def test_reviewed_templates_match_listings_and_repositories(self):
        catalog_by_id={a['id']:a for a in CATALOG}
        self.assertEqual(len(TEMPLATES),5)
        for name,template in TEMPLATES.items():
            self.assertIn(name,catalog_by_id)
            self.assertTrue(catalog_by_id[name]['template_available'])
            self.assertEqual(catalog_by_id[name]['risk'],'review')
            self.assertEqual(template['repository'],catalog_by_id[name]['repository'])
            self.assertTrue(template['image'].startswith(template['repository']+':'))
            self.assertLessEqual(len(template.get('ports',[])),8)
            self.assertLessEqual(len(template.get('volumes',[])),4)
        for app in CATALOG:
            if app.get('template_available') and app.get('risk')=='review':
                self.assertIn(app['id'],TEMPLATES)

    def test_read_only_mode_keeps_every_entry_visible_but_not_installable(self):
        values=API['catalog']()
        self.assertEqual(values['total'],73)
        self.assertTrue(values['read_only'])
        self.assertEqual(len(values['catalog']),73)
        self.assertTrue(all(a['setup_state']=='disabled' for a in values['catalog']))
        self.assertTrue(all(not a['ready'] and not a['can_prepare']
                            for a in values['catalog']))

    def test_enabled_mode_only_prepares_reviewed_templates(self):
        with patch.dict(API['catalog'].__globals__,{'writes_enabled':lambda:True}):
            apps=API['catalog']()['catalog']
        reviewed=[a for a in apps if a['can_prepare']]
        self.assertEqual(len(reviewed),5)
        self.assertEqual(len([a for a in apps if a['setup_state']=='manual']),68)
        self.assertTrue(all(a['reviewed_template'] for a in reviewed))
        self.assertTrue(all(not a['ready'] for a in apps))

    def test_pinned_digest_is_ready_then_installed(self):
        overrides={'writes_enabled':lambda:True,
                   'policy':lambda:{DIGEST},
                   'pins':lambda:{'uptime-kuma':DIGEST}}
        with patch.dict(API['catalog'].__globals__,overrides):
            entry=next(a for a in API['catalog']()['catalog'] if a['id']=='uptime-kuma')
            self.assertTrue(entry['ready'])
            self.assertEqual(entry['setup_state'],'ready')
            self.assertEqual(entry['template']['ports'],['3001:3001'])
            path=self.root/'stacks'/'uptime-kuma'/'compose.json'
            path.parent.mkdir(parents=True)
            path.write_text('{}')
            entry=next(a for a in API['catalog']()['catalog'] if a['id']=='uptime-kuma')
            self.assertEqual(entry['setup_state'],'installed')

    def test_it_tools_tmpfs_is_narrowly_scoped_to_reviewed_image(self):
        docker_image='corentinth/it-tools@sha256:'+('b'*64)
        spec={'services':{'app':{
            'image':docker_image,
            'ports':['192.168.50.1:8081:80'],
            'volumes':[]}}}
        with patch.dict(API['spec_validate'].__globals__,{
            'policy':lambda:{docker_image},
            'pins':lambda:{'it-tools':docker_image},
            'template_specs':lambda:TEMPLATES,
            'lan_ip':lambda:'192.168.50.1'}):
            validated=API['spec_validate'](spec,app_id='it-tools')
            app=validated['services']['app']
            self.assertTrue(app['read_only'])
            self.assertEqual(app['user'],'65534:65534')
            self.assertEqual(app['tmpfs'],[
                '/var/cache/nginx:uid=65534,gid=65534,mode=1777,size=16m',
                '/var/run:uid=65534,gid=65534,mode=1777,size=4m',
                '/tmp:uid=65534,gid=65534,mode=1777,size=16m'])
            # Browser-supplied Compose must not choose arbitrary tmpfs mounts.
            spec['services']['app']['tmpfs']=['/:mode=777']
            with self.assertRaisesRegex(ValueError,'Unsupported Compose service'):
                API['spec_validate'](spec,advanced=True)

    def test_custom_image_registry_allowlist(self):
        allowed=['ghcr.io/advplyr/audiobookshelf:latest',
                 'docker.n8n.io/n8nio/n8n:1.3',
                 'registry.rocket.chat/rocketchat/rocket.chat:8.0',
                 'nextcloud:stable','vaultwarden/server:latest']
        denied=['router.internal:latest','evil.example.org/steal:latest',
                '127.0.0.1/local:latest','localhost/bad:latest',
                '10.0.0.1/private:latest']
        policy=runpy.run_path(str(BASE/'moci-docker-policy'))
        for tag in allowed:
            self.assertTrue(API['public_image_tag'](tag),tag)
            self.assertTrue(policy['public_image_tag'](tag),tag)
        for tag in denied:
            self.assertFalse(API['public_image_tag'](tag),tag)
            self.assertFalse(policy['public_image_tag'](tag),tag)

    def test_managed_apps_report_live_state_and_safe_lan_launch_url(self):
        names=('it-tools','openspeedtest','uptime-kuma','memos')
        for name in names:
            path=self.root/'stacks'/name/'compose.json'
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text('{"services":{}}')
        def container(name,state,ip,port,status='Up 2 minutes'):
            return {'Labels':{'com.moci.managed':'true',
                              'com.docker.compose.project':'moci-'+name},
                    'State':state,'Status':status,
                    'Ports':[{'Type':'tcp','IP':ip,'PublicPort':port}]}
        inventory=[
            container('it-tools','running','192.168.50.1',8081),
            container('openspeedtest','running','192.168.50.1',3000),
            container('uptime-kuma','exited','192.168.50.1',3001),
            container('memos','running','0.0.0.0',5230),
        ]
        with patch.dict(API['managed_stacks'].__globals__,{
            'docker':lambda method,path:inventory,
            'template_specs':lambda:TEMPLATES}):
            values=API['managed_stacks']()['managed_stacks']
        indexed={item['name']:item for item in values}
        self.assertEqual(indexed['it-tools']['state'],'running')
        self.assertEqual(indexed['it-tools']['url'],'http://192.168.50.1:8081/')
        self.assertEqual(indexed['openspeedtest']['url'],'http://192.168.50.1:3000/')
        self.assertEqual(indexed['uptime-kuma']['state'],'stopped')
        self.assertIsNone(indexed['uptime-kuma']['url'])
        self.assertEqual(indexed['memos']['state'],'running')
        self.assertIsNone(indexed['memos']['url'])

    def test_partial_and_unhealthy_stacks_are_not_advertised_as_ready(self):
        for name in ('it-tools','uptime-kuma'):
            path=self.root/'stacks'/name/'compose.json'
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text('{}')
        inventory=[
            {'Labels':{'com.moci.managed':'true','com.docker.compose.project':'moci-it-tools'},
             'State':'running','Status':'Up','Ports':[{'Type':'tcp','IP':'192.168.50.1','PublicPort':8081}]},
            {'Labels':{'com.moci.managed':'true','com.docker.compose.project':'moci-it-tools'},
             'State':'exited','Status':'Exited','Ports':[]},
            {'Labels':{'com.moci.managed':'true','com.docker.compose.project':'moci-uptime-kuma'},
             'State':'running','Status':'Up (unhealthy)','Ports':[{'Type':'tcp','IP':'192.168.50.1','PublicPort':3001}]}
        ]
        with patch.dict(API['managed_stacks'].__globals__,{
            'docker':lambda method,path:inventory,
            'template_specs':lambda:TEMPLATES}):
            indexed={item['name']:item for item in API['managed_stacks']()['managed_stacks']}
        self.assertEqual(indexed['it-tools']['state'],'partial')
        self.assertEqual(indexed['uptime-kuma']['state'],'unhealthy')
        self.assertIsNone(indexed['it-tools']['url'])
        self.assertIsNone(indexed['uptime-kuma']['url'])

    def test_unapproved_digest_cannot_be_deployed(self):
        spec={'services':{'app':{'image':DIGEST}}}
        with self.assertRaisesRegex(ValueError,'Image digest not approved'):
            API['spec_validate'](spec)

    def test_external_host_port_binding_is_rejected(self):
        spec={'services':{'app':{'image':DIGEST,'ports':['0.0.0.0:8088:80']}}}
        with patch.dict(API['spec_validate'].__globals__,{'policy':lambda:{DIGEST}}):
            with self.assertRaisesRegex(ValueError,'LAN interface'):
                API['spec_validate'](spec)

    def test_sensitive_apps_are_never_auto_promoted_to_one_click(self):
        with patch.dict(API['catalog'].__globals__,{'writes_enabled':lambda:True}):
            apps=API['catalog']()['catalog']
        for app in apps:
            if app['risk'] in {'router-critical','security-critical','privileged','docker-socket'}:
                self.assertFalse(app['reviewed_template'],app['id'])
                self.assertFalse(app['ready'],app['id'])


if __name__=='__main__':
    unittest.main(verbosity=2)
