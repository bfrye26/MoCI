import assert from 'node:assert/strict';
import SystemModule from '../moci/js/modules/system.js';

function makeServiceCore({running=false,execStatus=0,execCode=0,stderr='',verified=true,name='demo'}={}){
  const state={calls:[],toasts:[],reloads:0};
  const module=Object.create(SystemModule.prototype);
  module.servicePending=new Map();
  module.serviceFeedback=new Map();
  module.loadStartup=async()=>{state.reloads++;};
  module.waitForServiceState=async(name,expect)=>{
    state.calls.push(['verify',name,expect]);
    return verified;
  };
  module.core={
    showToast:(...args)=>{state.toasts.push(args);},
    ubusCall:async (object,method,params)=>{
      state.calls.push([object,method,params]);
      if(object==='service'&&method==='list'){
        return [0,{[name]:{autostart:true,instances:{instance1:{running}}}}];
      }
      if(object==='file'&&method==='exec'){
        return [execStatus,{code:execCode,stderr}];
      }
      throw Error('Unexpected call');
    }
  };
  return {module,state};
}

const vm=Object.create(SystemModule.prototype);
assert.equal(vm.serviceIsRunning({instances:{main:{running:false}}}),false,
  'A registered procd instance is not necessarily running');
assert.equal(vm.serviceIsRunning({instances:{main:{running:true}}}),true);
assert.equal(vm.serviceIsRunning({instances:{}}),false);
assert.equal(vm.serviceIsRunning({}),false);
assert.equal(vm.serviceAutostart({autostart:true}),'ENABLED');
assert.equal(vm.serviceAutostart({autostart:false}),'DISABLED');
assert.equal(vm.serviceAutostart({}),'UNKNOWN');

{
  const {module,state}=makeServiceCore({running:false,verified:true});
  await module.toggleService('demo');
  const command=state.calls.find(c=>c[0]==='file'&&c[1]==='exec');
  assert.equal(command[2].command,'/etc/init.d/demo');
  assert.deepEqual(command[2].params,['start']);
  const request=state.calls.find(c=>c[0]==='service'&&c[1]==='list');
  assert.deepEqual(request[2],{verbose:true,name:'demo'});
  assert.equal(module.servicePending.size,0);
  assert.equal(state.toasts.at(-1)[1],'success');
  assert.equal(state.reloads,2);
}
{
  const {module,state}=makeServiceCore({running:false,execCode:1,stderr:'Permission denied'});
  await module.toggleService('demo');
  assert.equal(state.toasts.at(-1)[1],'error');
  assert.match(state.toasts.at(-1)[0],/Permission denied/);
  assert.equal(module.serviceFeedback.get('demo').kind,'failed');
  assert.equal(module.servicePending.size,0);
}
{
  const {module,state}=makeServiceCore({running:false,execStatus:6});
  await module.toggleService('demo');
  assert.equal(state.toasts.at(-1)[1],'error');
  assert.match(state.toasts.at(-1)[0],/rejected/);
}
{
  const {module,state}=makeServiceCore({running:false,verified:false});
  await module.toggleService('demo');
  assert.equal(state.toasts.at(-1)[1],'info');
  assert.equal(module.serviceFeedback.get('demo').expected,true);
  assert.equal(module.servicePending.size,0);
}
{
  const {module,state}=makeServiceCore({running:true,verified:true});
  await module.toggleService('demo');
  const command=state.calls.find(c=>c[0]==='file'&&c[1]==='exec');
  assert.deepEqual(command[2].params,['stop']);
  assert.equal(state.toasts.at(-1)[1],'success');
}
assert.equal(vm.serviceIsOneShot('acme'),true);
assert.equal(vm.serviceIsOneShot('firewall'),true);
assert.equal(vm.serviceIsOneShot('dropbear'),false);
{
  const {module,state}=makeServiceCore({running:false,verified:false,name:'acme'});
  await module.toggleService('acme');
  assert.equal(module.serviceFeedback.get('acme').kind,'completed');
  assert.match(state.toasts.at(-1)[0],/no daemon expected/);
  assert.equal(state.toasts.at(-1)[1],'success');
  assert.ok(!state.calls.some(c=>c[0]==='verify'));
}
console.log('System service controls: verified process status, bounded action feedback and errors');
