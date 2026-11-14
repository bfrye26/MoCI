import assert from 'node:assert/strict';
import {OpenWrtCore} from '../moci/js/core.js';
import NetworkModule from '../moci/js/modules/network.js';

// Failed writes must never reach commit, close the form or announce success.
for (const operation of ['set', 'add', 'delete', 'commit']) {
  const c = Object.create(OpenWrtCore.prototype);
  c.ubusCall = async () => [6];
  await assert.rejects(c.uciWrite(operation, {config:'dhcp'}), /rejected/);
  c.ubusCall = async () => undefined;
  await assert.rejects(c.uciWrite(operation, {config:'dhcp'}), /missing/);
  c.ubusCall = async () => [0, {}];
  assert.equal((await c.uciWrite(operation, {config:'dhcp'}))[0], 0);
}

const elements = {section:{value:'host1'}, enabled:{type:'checkbox', checked:false}};
globalThis.document = {getElementById:id=>elements[id]};
const c = Object.create(OpenWrtCore.prototype);
const events = [];
c.showToast = (...args) => events.push(['toast', ...args]);
c.closeModal = () => events.push(['close']);
c.ubusCall = async (object, method) => {events.push([method]); return [6];};
await c.uciSave({config:'dhcp', sectionIdField:'section', fieldMap:{enabled:'enabled'}});
assert(!events.some(e=>e[0]==='commit'||e[0]==='close'||e[2]==='success'));
assert.deepEqual(c.getFormValues({enabled:'enabled'}), {enabled:'0'});
c.setFormValues({enabled:'enabled'}, {enabled:'0'});
assert.equal(elements.enabled.checked, false);
c.setFormValues({enabled:'enabled'}, {enabled:'1'});
assert.equal(elements.enabled.checked, true);
assert.deepEqual(c.getFormValues({enabled:'enabled'}), {enabled:'1'});

// Pool updates must reload both IPv4 and IPv6 services. Missing exit codes fail closed.
for (const reply of [[0,{code:0}], [6], [0,{code:1}], [0,{}]]) {
  const calls = [], toasts = [];
  const n = Object.create(NetworkModule.prototype);
  n.core = {serviceReload:async service=>{calls.push(service); return reply;},
    showToast:(...args)=>toasts.push(args)};
  let refreshed = false;
  await n.reloadDhcpServices(async()=>{refreshed=true;}, true);
  assert(refreshed);
  if (reply[0]===0 && reply[1]?.code===0) {
    assert.deepEqual(calls, ['dnsmasq','odhcpd']);
    assert.equal(toasts.length, 0);
  } else {
    assert(toasts.some(t=>t[1]==='error' && t[0].startsWith('Saved, but')));
  }
}

// Exercise DNS save through the real UCI wrappers, including commit rejection.
Object.assign(elements, Object.fromEntries([
  ['dns-servers','1.1.1.1'], ['dns-authoritative','1'], ['dns-domain','lan'],
  ['dns-local','/lan/'], ['dns-rebind','1'], ['dns-logqueries','0']
].map(([id,value])=>[id,{value}])));
for (const failCommit of [false,true]) {
  const calls=[], toasts=[];
  const core=Object.create(OpenWrtCore.prototype);
  core.showToast=(...args)=>toasts.push(args);
  core.ubusCall=async(object,method,params)=>{
    calls.push([object,method,params]);
    return method==='commit' && failCommit ? [6] : [0,{code:0}];
  };
  const n=Object.create(NetworkModule.prototype);
  n.core=core; n._dnsmasqSection='dns1'; n.loadDNS=async()=>{};
  await n.saveDnsConfig();
  assert.equal(calls.some(c=>c[0]==='file' && c[2].command==='/etc/init.d/dnsmasq'), !failCommit);
  assert.equal(toasts.some(t=>t[1]==='success'), !failCommit);
}
console.log('Router configuration tests passed: denied writes, checkbox values, DNS activation and DHCP service failures.');

// Connectivity-sensitive changes use rpcd snapshots, never a preceding commit.
const realSetTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn)=>{fn(); return 0;};
try {
  for (const scenario of ['keep','cancel','unreachable','other-config','denied-apply','denied-confirm','expired-rollback','denied-rollback']) {
    const calls=[];
    const core=Object.create(OpenWrtCore.prototype);
    core.showToast=()=>{};
    globalThis.window={confirm:()=>!['cancel','expired-rollback','denied-rollback'].includes(scenario)};
    core.ubusCall=async(object,method,params)=>{
      calls.push([object,method,params]);
      if(method==='changes') return [0,{changes:{network:[['set']], ...(scenario==='other-config'?{dhcp:[['set']]}:{})}}];
      if(method==='info' && scenario==='unreachable') throw new Error('offline');
      if(method==='rollback' && scenario==='expired-rollback') return [4];
      if(method==='rollback' && scenario==='denied-rollback') return [6];
      if((method==='apply' && scenario==='denied-apply') || (method==='confirm' && scenario==='denied-confirm')) return [6];
      return [0,{}];
    };
    if(scenario==='keep') await core.uciApplyConfig('network');
    else await assert.rejects(core.uciApplyConfig('network'));
    assert(!calls.some(c=>c[1]==='commit'));
    assert.equal(calls.some(c=>c[1]==='confirm'), ['keep','denied-confirm'].includes(scenario));
    assert.equal(core._uciApplyPending, false);
    if(scenario==='other-config') assert(!calls.some(c=>c[1]==='apply'));
    const rolledBack=!['keep','other-config','denied-apply'].includes(scenario);
    assert.equal(calls.some(c=>c[1]==='rollback'),rolledBack);
    assert.equal(calls.some(c=>c[1]==='revert'),rolledBack && scenario!=='denied-rollback');
    if(calls.some(c=>c[1]==='revert')) {
      assert(calls.findIndex(c=>c[1]==='rollback') < calls.findIndex(c=>c[1]==='revert'));
      assert.deepEqual(calls.find(c=>c[1]==='revert')[2],{config:'network'});
    }
  }
} finally {globalThis.setTimeout=realSetTimeout;}
console.log('Network apply tests passed: keep, cancel, lost connection, unrelated edits and denied apply/confirm.');
