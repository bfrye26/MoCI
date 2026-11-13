import assert from 'node:assert/strict';
import DashboardModule from '../moci/js/modules/dashboard.js';
import SystemModule from '../moci/js/modules/system.js';

const buttons = new Map(['reboot-btn','restart-network-btn','restart-firewall-btn'].map(id => [id, {
  disabled: false, listeners: [], addEventListener(event, callback) { this.listeners.push(callback); }
}]));
globalThis.document = {getElementById: id => buttons.get(id)};
const calls = [], toasts = [];
let response = [0, {code:0}], allowed = false;
globalThis.confirm = () => allowed;
const core = {
  registerRoute() {}, showToast: (...args) => toasts.push(args),
  ubusCall: async (...args) => {calls.push(args); return response;},
  serviceReload: async service => {calls.push(service); return response;}
};
new DashboardModule(core);
assert.ok([...buttons.values()].every(button => button.listeners.length === 1), 'Actions bind on a direct dashboard load');
assert.doesNotMatch(SystemModule.prototype.setupHandlers.toString(), /reboot-btn|restart-network-btn|restart-firewall-btn/, 'System navigation must not add dashboard handlers');
await buttons.get('reboot-btn').listeners[0]();
assert.equal(calls.length, 0, 'Cancelled reboot sends no request');
await buttons.get('restart-firewall-btn').listeners[0]();
assert.equal(calls.at(-1), 'firewall');
assert.equal(toasts.at(-1)[1], 'success');
response = [0,{code:1}];
await buttons.get('restart-network-btn').listeners[0]();
assert.equal(toasts.at(-1)[1], 'error', 'A failed command must not announce success');
response = [6,{}]; allowed = true;
await buttons.get('reboot-btn').listeners[0]();
assert.equal(toasts.at(-1)[1], 'error', 'Rejected reboot must not announce success');
const button = buttons.get('restart-firewall-btn'); button.disabled = true;
const count = calls.length;
await button.listeners[0]();
assert.equal(calls.length, count, 'In-flight actions cannot be duplicated');
console.log('Dashboard quick-action regression checks passed');
