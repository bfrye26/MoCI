import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Devices page resolves vendors from the full IEEE MA-L registry, detects
// private/randomized MACs, and recognises well-known virtualization prefixes.
const oui = (await import('../moci/js/modules/oui-data.js')).default;
assert(Object.keys(oui).length > 30000, 'OUI registry should be comprehensive (IEEE MA-L)');

const known = {
  '00:26:bb': /apple/i,
  '00:1a:11': /google/i,
  '00:1b:21': /intel/i,
  'b8:27:eb': /raspberry/i,
  '24:0a:c4': /espressif/i,
  '00:15:5d': /microsoft/i
};
for (const [prefix, re] of Object.entries(known)) {
  assert(oui[prefix] && re.test(oui[prefix]), `OUI ${prefix} should resolve (${oui[prefix]})`);
}

// Locally-administered bit (bit 1 of first octet) => private/randomized MAC.
const isRandomMac = mac => {
  const o = parseInt(String(mac).toLowerCase().split(':')[0], 16);
  return Number.isFinite(o) && (o & 0x02) !== 0;
};
assert.equal(isRandomMac('da:a1:19:00:00:01'), true, 'randomized MAC detected');
assert.equal(isRandomMac('02:11:22:33:44:55'), true, 'locally-administered MAC detected');
assert.equal(isRandomMac('00:26:bb:00:00:01'), false, 'universal MAC not flagged');
assert.equal(isRandomMac('b8:27:eb:00:00:01'), false, 'Raspberry Pi universal MAC not flagged');

// QEMU's 52:54:00 is locally administered but a known virtual NIC, not random.
assert.equal(isRandomMac('52:54:00:12:34:56'), true, 'QEMU prefix has the local bit set');
const devices = readFileSync('moci/js/modules/devices.js', 'utf8');
assert(devices.includes("'52:54:00':'QEMU/KVM'"), 'QEMU override must precede randomized check');
assert(devices.includes("import('./oui-data.js"), 'Devices must lazy-load the OUI registry');
assert(devices.includes('vendorForMac(mac)'), 'Devices must expose vendorForMac');
assert(devices.includes('Private / randomized MAC'), 'Devices must label randomized MACs');
assert(devices.includes('this.oui[p]'), 'vendorForMac must consult the loaded registry');

console.log('Device vendor lookup passed: ' + Object.keys(oui).length + ' OUI entries, randomized-MAC + virtualization handling.');