import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Features toggle subsystem must stay consistent across four places:
// the features.js registry, the moci.config defaults, core.getDefaultFeatures(),
// and the first-boot uci-defaults script that turns add-on services off.
const features = readFileSync('moci/js/modules/features.js', 'utf8');
const config = readFileSync('files/moci.config', 'utf8');
const core = readFileSync('moci/js/core.js', 'utf8');
const defaults = readFileSync('files/moci-addon-defaults', 'utf8');

const expected = {
  sqm: 'sqm', bandwidth: 'nlbwmon', multiwan: 'mwan3', adblock: 'adblock',
  tailscale: 'tailscale', terminal: 'ttyd', statistics: 'luci_statistics', nas: 'samba4'
};

const registry = {};
for (const m of features.matchAll(/\{key:'([^']+)',name:'[^']*',group:'[^']*',service:'([^']+)'/g)) {
  registry[m[1]] = m[2];
}
for (const [key, service] of Object.entries(expected)) {
  assert.equal(registry[key], service, `features.js registry ${key} -> ${service}`);
  assert(config.includes(`option ${key} '0'`), `moci.config must default ${key} off`);
  assert(core.includes(`${key}: '0'`), `core.getDefaultFeatures must default ${key} off`);
  assert(defaults.includes(`${key}:${service}`), `uci-defaults must map ${key}:${service}`);
}

// applyFeatureFlags must toggle nav entries both ways so a switch re-shows them.
assert(/nav-item[\s\S]{0,120}classList\.toggle\('hidden', !enabled\)/.test(core),
  'applyFeatureFlags must toggle nav-item visibility both ways');

// Boot control (enable/disable) must be permitted for the toggles to persist.
const acl = JSON.parse(readFileSync('rpcd-acl.json', 'utf8'));
assert(acl.moci.write.file['/etc/init.d/* enable'], 'ACL must allow init enable');
assert(acl.moci.write.file['/etc/init.d/* disable'], 'ACL must allow init disable');

console.log('Features toggle contract passed: ' + Object.keys(expected).length +
  ' add-ons consistent across registry, defaults, core and first-boot script.');