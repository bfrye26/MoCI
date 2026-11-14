import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(name, 'utf8');
const html = read('moci/index.html');
const core = read('moci/js/core.js');
const builder = read('scripts/build.js');
const makefile = read('Makefile');
const firmware = read('firmware/scripts/build.sh');
const uciACL = JSON.parse(read('rpcd-acl.json'));
const appMakefile = read('integrations/docker-manager/moci-app-docker/Makefile');
const appManifest = JSON.parse(read('integrations/docker-manager/moci-app-docker/files/manifest.json'));
const dockerACL = JSON.parse(read('integrations/docker-manager/moci-app-docker/files/acl.json'));

const nativeRoutes = {
  dashboard: 'dashboard',
  wan: 'wan',
  'published-ports': 'published-ports',
  devices: 'devices',
  wifi: 'wifi',
  qos: 'qos',
  tls: 'tls',
  networks: 'networks',
  network: 'network',
  system: 'system',
  advanced: 'advanced',
  profiles: 'profiles',
  schedules: 'schedules',
  'wifi-profiles': 'wifi-profiles',
  'ethernet-profiles': 'ethernet-profiles',
  'vpn-policies': 'vpn-policies',
  addons: 'addons',
};
for (const [route, module] of Object.entries(nativeRoutes)) {
  const moduleFile=route==='schedules'?'wifi-schedules':module;
  assert(html.includes('id="'+route+'-page"'),
    'Missing HTML page for native '+route);
  assert(core.includes("'"+route+"': '"+module+"'") ||
         core.includes(route+": '"+module+"'"),
    'Missing router registration for '+route);
  assert(builder.includes("'moci/js/modules/"+moduleFile+".js'"),
    'Frontend build omits '+module);
}
// The firmware must install EVERY built module and the self-hosted fonts. A
// stale explicit install list once dropped wan/devices/qos/published-ports/
// app-integrations/wifi/networks/tls and the font, blanking those pages.
assert(makefile.includes('./dist/moci/js/modules/*.js'),
  'Firmware package must install all built modules via wildcard');
assert(makefile.includes('./dist/moci/fonts/*'),
  'Firmware package must install the self-hosted fonts');
for (const sub of ['upnp','app-integrations']) {
  assert(builder.includes("'moci/js/modules/"+sub+".js'"),
    'Frontend build omits sub-module '+sub);
}
const themes = ['obsidian','cloud','ocean','terminal','amethyst','copper'];
for (const theme of themes) {
  assert(html.includes('value="'+theme+'"'), 'Theme selector omits '+theme);
  assert(core.includes("'"+theme+"'"), 'Theme handler omits '+theme);
}
const configNames = [
 'network','wireless','firewall','dhcp','system','mwan3','pbr','banip',
 'acme','ddns','sqm','dropbear','uhttpd','lldpd','nlbwmon',
 'luci_statistics','snmpd','nut','samba4','fstab','moci_wifi_schedule'
];
for (const config of configNames) {
  assert(uciACL.moci.read.uci.includes(config), 'Missing read ACL: '+config);
  assert(uciACL.moci.write.uci.includes(config), 'Missing write ACL: '+config);
}
for (const packageName of [
 'moci','moci-app-docker','dockerd','docker-compose','uhttpd-mod-ubus',
 'luci-ssl','wpad-mbedtls','luci-app-mwan3','luci-app-banip','luci-app-acme'
]) {
  assert(firmware.includes('CONFIG_PACKAGE_'+packageName+'=y'),
    'Firmware does not request '+packageName);
}
const packageHelper=read('files/moci-pkg-call');
const systemModule=read('moci/js/modules/system.js');
for(const op of ['list-all-installed','search-general','install-general','remove-general']){
  assert(packageHelper.includes('    '+op+')'),'Missing package helper operation '+op);
  assert(systemModule.includes(op),'System software UI missing '+op);
  const expected='/usr/libexec/moci-pkg-call '+op+(op==='list-all-installed'?'':' *');
  const area=op==='install-general'||op==='remove-general' ? uciACL.moci.write.file : uciACL.moci.read.file;
  assert(Object.prototype.hasOwnProperty.call(area,expected),'Missing package ACL '+expected);
}
assert(!systemModule.includes("path: '/usr/lib/opkg/status'"),'Legacy opkg package view still used');
assert(makefile.includes('+uhttpd-mod-ubus'),'MoCI login dependency missing');
assert(appMakefile.includes('+python3-email') && appMakefile.includes('+python3-urllib'),
  'Docker RPC Python dependencies missing');
for (const method of [
 'status','containers','images','volumes','networks','catalog','managed_stacks',
 'install_catalog','prepare_app','prepare_custom','stack_action','container_action',
 'set_deployments'
]) {
  const roles = method==='set_deployments' || [
    'install_catalog','prepare_app','prepare_custom','stack_action','container_action'
  ].includes(method)
   ? dockerACL['moci-docker-deployer'].write.ubus['moci-docker']
   : dockerACL['moci-docker-viewer'].read.ubus['moci-docker'];
  assert(roles.includes(method), 'Missing Docker RPC ACL for '+method);
}
assert(appManifest.nav?.route==='/docker', 'Docker Applications navigation missing');
const templates=JSON.parse(read('integrations/docker-manager/moci-app-docker/files/app-templates.json'));
const catalog=JSON.parse(read('integrations/docker-manager/moci-app-docker/files/app-catalog.json'));
const catalogIds=new Set(catalog.apps.map(a=>a.id));
for(const [id,t] of Object.entries(templates.templates)){
  assert(catalogIds.has(id),'Template has no app catalogue entry: '+id);
  assert(typeof t.repository==='string'&&typeof t.image==='string','Invalid template '+id);
}
console.log('MoCI release contract passed: '+Object.keys(nativeRoutes).length+
  ' native routes, '+themes.length+' themes, '+configNames.length+
  ' UCI configs, '+Object.keys(templates.templates).length+' app profiles.');

