// StartWRT-parity feature contracts: device profile derivation, UPnP lease
// expiry + delegation parsing, and Help-mode persistence. No router/DOM needed.
import assert from 'node:assert/strict';
import DevicesModule from '../moci/js/modules/devices.js';
import UpnpModule from '../moci/js/modules/upnp.js';
import { OpenWrtCore } from '../moci/js/core.js';

// --- Devices: profile derivation from interface subnet -> firewall zone ---
const devices = Object.create(DevicesModule.prototype);
devices.network = {
  lan: { '.type': 'interface', ipaddr: '192.168.50.1', netmask: '255.255.255.0' },
  moci_guest: { '.type': 'interface', ipaddr: '192.168.60.1', netmask: '255.255.255.0' }
};
devices.firewall = {
  moci_zone_guest: { '.type': 'zone', name: 'moci_guest', network: ['moci_guest'] }
};
assert.equal(devices.profileForIp('192.168.50.100'), 'Main LAN');
assert.equal(devices.profileForIp('192.168.60.42'), 'guest');
assert.equal(devices.profileForIp('8.8.8.8'), '—');
assert.equal(devices.profileForIp('not-an-ip'), '—');

// --- UPnP: lease parsing keeps expiry; expiry formatting ---
const upnp = Object.create(UpnpModule.prototype);
const future = Math.floor(Date.now() / 1000) + 3600;
const leaseText = `TCP:32400:192.168.50.40:32400:Plex Media Server:${future}\nUDP:51820:192.168.50.41:51820:wireguard:${future}\n`;
const rows = upnp.leaseRows(leaseText);
assert.equal(rows.length, 2);
assert.equal(rows[0].external, 32400);
assert.equal(rows[0].client, '192.168.50.40');
assert.equal(rows[0].description, 'Plex Media Server');
assert.equal(rows[0].expires, future);
assert.ok(rows[0].expires > 0, 'expiry must be retained, not dropped');
// invalid lines ignored
assert.equal(upnp.leaseRows('garbage\nTCP:99999:1.2.3.4:80:x:0').length, 0);
assert.equal(upnp.fmtExpiry(0), '—');
assert.equal(upnp.fmtExpiry(Math.floor(Date.now() / 1000) - 10), 'expired');
assert.match(upnp.fmtExpiry(future), /h|m|s/);

// --- Core: Help-mode persistence ---
const store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
globalThis.document = {
  getElementById: () => null,
  body: { classList: { toggle() {} } }
};
globalThis.window = { location: { hash: '#/profiles' } };
const core = Object.create(OpenWrtCore.prototype);
assert.equal(core.getSavedHelpOpen(), false);
core.helpOpen = false;
core.setHelpOpen(true);
assert.equal(store['moci_help_open'], '1', 'Help state must persist');
assert.equal(core.getSavedHelpOpen(), true);
core.setHelpOpen(false);
assert.equal(store['moci_help_open'], '0');
assert.equal(core.getSavedHelpOpen(), false);
// per-field help returns a guide object for known pages
const guide = core.getFieldHelp();
assert.ok(guide && typeof guide === 'object');
assert.ok('Name' in guide, 'profiles field guide should explain Name');

console.log('StartWRT feature tests passed: device profiles, UPnP lease expiry/delegation parsing, Help persistence and field guide.');