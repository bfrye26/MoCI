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
        self.assertEqual(len(TEMPLATES),22)
        for name,template in TEMPLATES.items():
            self.assertIn(name,catalog_by_id)
            self.assertTrue(catalog_by_id[name]['template_available'])
            self.assertTrue(catalog_by_id[name]['risk']=='review' or (
                catalog_by_id[name]['risk']=='sensitive-data' and
                template.get('reviewed_risk')=='sensitive-data'))
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
        self.assertEqual(len(reviewed),22)
        self.assertEqual(len([a for a in apps if a['setup_state']=='manual']),51)
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

    def test_openspeedtest_reviewed_runtime_allows_nginx_cron_without_global_root(self):
        speed_image='openspeedtest/latest@sha256:'+('c'*64)
        spec={'services':{'app':{
            'image':speed_image,
            'ports':['192.168.50.1:3000:3000','192.168.50.1:3002:3001'],
            'volumes':[]}}}
        opts={'policy':lambda:{speed_image},
              'pins':lambda:{'openspeedtest':speed_image},
              'template_specs':lambda:TEMPLATES,
              'lan_ip':lambda:'192.168.50.1'}
        with patch.dict(API['spec_validate'].__globals__,opts):
            actual=API['spec_validate'](spec,app_id='openspeedtest')['services']['app']
            self.assertEqual(actual['user'],'0:0')
            self.assertFalse(actual['read_only'])
            self.assertEqual(actual['cap_drop'],['ALL'])
            self.assertEqual(actual['cap_add'],[
                'CHOWN','DAC_OVERRIDE','FOWNER','SETGID','SETUID'])
            self.assertEqual(actual['security_opt'],['no-new-privileges:true'])
            self.assertEqual(actual['ports'],spec['services']['app']['ports'])
            # Generic compose callers cannot get the reviewed root/capability
            # exemption, even if a matching image digest is approved.
            requested=dict(spec['services']['app'],cap_add=['SYS_ADMIN'])
            with self.assertRaisesRegex(ValueError,'Unsupported Compose service'):
                API['spec_validate']({'services':{'app':requested}},advanced=True)
            with self.assertRaisesRegex(ValueError,'custom users require advanced'):
                API['spec_validate']({'services':{'app':dict(spec['services']['app'],user='0:0')}},advanced=False)

    def test_root_and_caps_cannot_be_granted_through_another_reviewed_template(self):
        digest='louislam/uptime-kuma@sha256:'+('d'*64)
        spec={'services':{'app':{
            'image':digest,
            'ports':['192.168.50.1:3001:3001'],
            'volumes':['uptime-kuma-data:/app/data']}}}
        templates={key:dict(value) for key,value in TEMPLATES.items()}
        templates['uptime-kuma']['cap_add']=['CHOWN','DAC_OVERRIDE','FOWNER','SETGID','SETUID']
        with patch.dict(API['spec_validate'].__globals__,{
              'policy':lambda:{digest},
              'pins':lambda:{'uptime-kuma':digest},
              'template_specs':lambda:templates,
              'lan_ip':lambda:'192.168.50.1'}):
            with self.assertRaisesRegex(ValueError,'Unapproved application capabilities'):
                API['spec_validate'](spec,app_id='uptime-kuma')

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

    def test_new_one_click_templates_match_official_storage_and_lan_ports(self):
        expected={'memos':('5230:5230','/var/opt/memos'),
                  'beszel':('8090:8090','/beszel_data'),
                  'grafana':('3010:3000','/var/lib/grafana')}
        for name,(port,path) in expected.items():
            item=TEMPLATES[name]
            self.assertIn(port,item['ports'])
            self.assertTrue(any(mount.endswith(':'+path) for mount in item['volumes']))
            self.assertTrue(item.get('needs_write_access'))
            self.assertEqual(item['repository'],next(
                app['repository'] for app in CATALOG if app['id']==name))
            self.assertTrue(item['path'].startswith('http://ROUTER_IP:'))
        self.assertEqual(TEMPLATES['grafana']['initial_password_env'],
                         'GF_SECURITY_ADMIN_PASSWORD')
        self.assertEqual(TEMPLATES['memos']['run_as_user'],'10001:10001')
        self.assertEqual(TEMPLATES['grafana']['run_as_user'],'472:472')

    def test_twenty_two_candidate_templates_have_unique_host_ports_and_volume_owners(self):
        host_ports=set()
        catalog={app['id']:app for app in CATALOG}
        self.assertEqual(len(TEMPLATES),22)
        for name,template in TEMPLATES.items():
            self.assertTrue(catalog[name]['template_available'])
            self.assertEqual(catalog[name]['repository'],template['repository'])
            self.assertIn(template['needs_write_access'],(True,False))
            for port in template.get('ports',[]):
                host=int(port.split(':')[0])
                self.assertGreaterEqual(host,1024)
                self.assertNotIn(host,host_ports,(name,port))
                host_ports.add(host)
            mounts={value.split(':',1)[1] for value in template.get('volumes',[])}
            inits=template.get('volume_initializers',[])
            if template.get('volume_initializer'):inits=inits+[template['volume_initializer']]
            for item in inits:
                self.assertIn(item['path'],mounts)
                self.assertTrue(1<=item['uid']<=65534)
                self.assertTrue(1<=item['gid']<=65534)
        self.assertEqual(TEMPLATES['homarr']['generated_secret_env'],'SECRET_ENCRYPTION_KEY')
        self.assertEqual(TEMPLATES['homepage']['environment']['HOMEPAGE_ALLOWED_HOSTS'],'ROUTER_IP:3333')

    def test_reviewed_environment_is_not_browser_editable(self):
        digest='ghcr.io/gethomepage/homepage@sha256:'+('e'*64)
        original={'image':digest,'ports':['192.168.50.1:3333:3000'],
                  'volumes':['homepage-config:/app/config'],
                  'environment':{'HOMEPAGE_ALLOWED_HOSTS':'192.168.50.1:3333',
                                 'PUID':'1000','PGID':'1000'}}
        policy={'policy':lambda:{digest},
                'pins':lambda:{'homepage':digest},
                'template_specs':lambda:TEMPLATES,
                'lan_ip':lambda:'192.168.50.1'}
        with patch.dict(API['spec_validate'].__globals__,policy):
            good=API['spec_validate']({'services':{'app':dict(original)}},app_id='homepage')
            self.assertEqual(good['services']['app']['environment']['HOMEPAGE_ALLOWED_HOSTS'],
                             '192.168.50.1:3333')
            evil=dict(original,environment=dict(original['environment'],TRUST_ALL='yes'))
            with self.assertRaisesRegex(ValueError,'environment differs'):
                API['spec_validate']({'services':{'app':evil}},app_id='homepage')
            evil=dict(original,command=['rm','-rf','/'])
            with self.assertRaisesRegex(ValueError,'command differs'):
                API['spec_validate']({'services':{'app':evil}},app_id='homepage')

    def test_homarr_generated_encryption_secret_is_required(self):
        digest='ghcr.io/homarr-labs/homarr@sha256:'+('e'*64)
        base={'image':digest,'ports':['192.168.50.1:7575:7575'],
              'volumes':['homarr-appdata:/appdata'],'mem_limit':'768m'}
        policy={'policy':lambda:{digest},'pins':lambda:{'homarr':digest},
                'template_specs':lambda:TEMPLATES,'lan_ip':lambda:'192.168.50.1'}
        with patch.dict(API['spec_validate'].__globals__,policy):
            with self.assertRaisesRegex(ValueError,'Invalid generated'):
                API['spec_validate']({'services':{'app':base}},app_id='homarr')
            base['environment']={'SECRET_ENCRYPTION_KEY':'f'*64}
            approved=API['spec_validate']({'services':{'app':base}},app_id='homarr')
            self.assertEqual(approved['services']['app']['environment']['SECRET_ENCRYPTION_KEY'],'f'*64)

    def test_sensitive_templates_require_audited_risk_flag(self):
        approved={a['id'] for a in CATALOG if a.get('template_available')}
        for app in CATALOG:
            if app['risk']=='sensitive-data' and app['id'] in approved:
                self.assertEqual(TEMPLATES[app['id']].get('reviewed_risk'),'sensitive-data')
        for key in ['filebrowser','sftpgo','n8n']:
            self.assertIn(key,TEMPLATES)
            self.assertEqual(TEMPLATES[key]['reviewed_risk'],'sensitive-data')
        self.assertEqual(TEMPLATES['n8n']['generated_secret_env'],'N8N_ENCRYPTION_KEY')

    def test_sensitive_app_requires_explicit_confirmation_before_backend_install(self):
        # Reject before digest or Docker setup so the gateway cannot bypass it.
        methods=API['run'].__globals__
        name='n8n'
        digest='docker.n8n.io/n8nio/n8n@sha256:'+('e'*64)
        app={'id':name,'ready':True,'risk':'sensitive-data'}
        with patch.dict(methods,{'catalog':lambda:{'catalog':[app]},
                                 'writes_enabled':lambda:True,
                                 'pins':lambda:{name:digest},
                                 'policy':lambda:{digest}}):
            with self.assertRaisesRegex(ValueError,'explicit administrator acknowledgement'):
                API['run']('install_catalog',{'id':name})

    def test_sensitive_app_does_not_need_an_admin_warning_for_review_class(self):
        self.assertEqual(TEMPLATES['ntfy']['ports'],['8093:80'])
        self.assertEqual(TEMPLATES['ntfy']['command'],['serve'])
        self.assertEqual(TEMPLATES['ntfy']['environment']['NTFY_AUTH_DEFAULT_ACCESS'],
                         'read-write')

    def test_bootstrap_dashboard_configs_have_explicit_safe_paths_and_bounded_content(self):
        for app,path,port in [('dashy','/app/user-data/conf.yml','4000:8080'),
                              ('glance','/app/config/glance.yml','8088:8080')]:
            template=TEMPLATES[app]
            self.assertIn(port,template['ports'])
            self.assertTrue(template['needs_write_access'])
            seeds=template.get('seed_files',[])
            self.assertEqual(len(seeds),1)
            self.assertEqual(seeds[0]['path'],path)
            self.assertIn('pages:',seeds[0]['content']) if app=='glance' else self.assertIn('pageInfo:',seeds[0]['content'])
            self.assertLessEqual(len(seeds[0]['content']),4096)
            self.assertTrue(any(path.startswith(v.split(':',1)[1]+'/')
                for v in template.get('volumes',[])))
        self.assertTrue(all('docker.sock' not in str(t) for t in
                            (TEMPLATES['dashy'],TEMPLATES['glance'])))

    def test_seed_bootstrap_uses_only_networkless_reviewed_image_and_preserves_files(self):
        digest='glanceapp/glance@sha256:'+('e'*64)
        template=TEMPLATES['glance']
        spec={'services':{'app':{'image':digest,
                                 'volumes':template['volumes']}}}
        calls=[]
        def fake_run(argv,**kwargs):
            calls.append(argv)
            class Result:
                returncode=0
            return Result()
        with patch.dict(API['initialize_approved_volume'].__globals__,{
            'template_specs':lambda:{'glance':template},
            'subprocess':type('Proc',(),{'run':staticmethod(fake_run),
                     'DEVNULL':__import__('subprocess').DEVNULL,
                     'PIPE':__import__('subprocess').PIPE})}):
            API['initialize_approved_volume']('glance',spec)
        seed=[argv for argv in calls if 'moci-seed-config' in argv]
        self.assertEqual(len(seed),1)
        args=seed[0]
        self.assertIn('--network',args)
        self.assertEqual(args[args.index('--network')+1],'none')
        self.assertEqual(args[args.index('--user')+1],'1000:1000')
        self.assertTrue(any('test -e "$1"' in token for token in args))
        self.assertEqual(args[args.index('moci-seed-config')+1],
                         '/app/config/glance.yml')
        self.assertNotIn('--privileged',args)

    def test_docker_firewall_only_publishes_managed_running_lan_tcp_ports(self):
        fw=runpy.run_path(str(BASE/'moci-docker-firewall'))
        netid='a'*64
        networks=[{'Driver':'bridge','Id':netid,
                   'Options':{},'Labels':{'com.docker.compose.project':'moci-memos'}}]
        def container(project='moci-memos',ip='192.168.50.1',state='running',proto='tcp'):
            return {'Id':'b'*64,'State':state,
              'Labels':{'com.moci.managed':'true',
                        'com.docker.compose.project':project},
              'NetworkSettings':{'Networks':{'default':{
                  'NetworkID':netid,'IPAddress':'172.23.0.2'}}},
              'Ports':[{'IP':ip,'Type':proto,'PublicPort':5230,'PrivatePort':5230}]}
        valid=fw['plan'](networks,[container()], '192.168.50.1')
        self.assertEqual(valid['devices'],['br-'+'a'*12])
        self.assertEqual(len(valid['rules']),1)
        self.assertEqual(next(iter(valid['rules'].values()))['ip'],'172.23.0.2')
        for client in [container(ip='0.0.0.0'),container(state='exited'),
                       container(project='unrelated'),container(proto='udp')]:
            rejected=fw['plan'](networks,[client],'192.168.50.1')
            self.assertEqual(rejected['devices'],[])
            self.assertEqual(rejected['rules'],{})

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
