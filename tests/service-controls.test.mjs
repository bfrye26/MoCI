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
{
  const module=Object.create(SystemModule.prototype);
  module.serviceBootNames=null;
  module.core={ubusCall:async (obj,method,args)=>{
    assert.equal(obj,'file');
    assert.equal(method,'exec');
    assert.equal(args.command,'/usr/libexec/moci-service-inspect');
    return [0,{code:0,stdout:'cron\ndropbear\nminiupnpd\n'}];
  }};
  await module.loadBootServiceNames();
  assert.equal(module.serviceAutostart({},'cron'),'ENABLED');
  assert.equal(module.serviceAutostart({},'notinstalled'),'DISABLED');
  assert.equal(module.serviceBootNames.has('miniupnpd'),true);
  assert.match(module.serviceHint('miniupnpd'),/UPnP/);
  assert.match(module.serviceHint('gpio_switch'),/GPIO/);
}
{
  const module=Object.create(SystemModule.prototype);
  module.serviceBootNames=null;
  module.core={ubusCall:async()=>[6,{code:1}]};
  await module.loadBootServiceNames();
  assert.equal(module.serviceAutostart({},'cron'),'UNKNOWN');
}

assert.equal(vm.serviceIsOneShot('urandom_seed'),true);
assert.equal(vm.serviceIsOneShot('nut-server'),false);
assert.equal(vm.serviceIsOneShot('banip'),false);
assert.equal(vm.serviceIsOneShot('luci_statistics'),true);
{
  const module=Object.create(SystemModule.prototype);
  module.serviceContext={BANIP_ENABLED:'no',BANIP_STATE:'disabled',NUT_DRIVER_CONFIGURED:'no'};
  assert.equal(module.serviceDisplay('urandom_seed',false,null,null).label,'BOOT TASK');
  assert.equal(module.serviceDisplay('banip',false,null,null).label,'APP DISABLED');
  assert.equal(module.serviceDisplay('nut-server',false,null,null).label,'SETUP NEEDED');
  assert.equal(module.serviceNeedsSetup('nut-server'),true);
  assert.equal(module.serviceNeedsSetup('banip'),true);
  module.serviceContext={BANIP_ENABLED:'yes',BANIP_STATE:'active',NUT_DRIVER_CONFIGURED:'yes'};
  assert.equal(module.serviceDisplay('banip',false,null,null).label,'ACTIVE');
  assert.equal(module.serviceNeedsSetup('banip'),false);
  assert.equal(module.serviceNeedsSetup('nut-server'),false);
}
{
  const module=Object.create(SystemModule.prototype);
  module.serviceContext=null;
  module.core={ubusCall:async()=>[0,{code:0,stdout:'BANIP_ENABLED=no\nBANIP_STATE=disabled\nNUT_DRIVER_CONFIGURED=no\n'}]};
  const context=await module.loadServiceContext(true);
  assert.equal(context.BANIP_ENABLED,'no');
  assert.equal(context.BANIP_STATE,'disabled');
  assert.equal(context.NUT_DRIVER_CONFIGURED,'no');
}
{
  const {module,state}=makeServiceCore({running:false,name:'nut-server'});
  module.loadServiceContext=async()=>({NUT_DRIVER_CONFIGURED:'no'});
  module.serviceContext={NUT_DRIVER_CONFIGURED:'no'};
  await module.toggleService('nut-server');
  assert.equal(state.toasts.at(-1)[1],'info');
  assert.equal(state.calls.filter(c=>c[0]==='file' && c[1]==='exec').length,0);
}
{
  const {module,state}=makeServiceCore({running:false,name:'banip'});
  module.loadServiceContext=async()=>({BANIP_ENABLED:'no',BANIP_STATE:'disabled'});
  module.serviceContext={BANIP_ENABLED:'no',BANIP_STATE:'disabled'};
  await module.toggleService('banip');
  assert.equal(state.toasts.at(-1)[1],'info');
  assert.equal(state.calls.filter(c=>c[0]==='file' && c[1]==='exec').length,0);
}
{
  const module=Object.create(SystemModule.prototype);
  module.loadServiceContext=async()=>({BANIP_STATE:'active'});
  assert.equal(await module.waitForApplicationState('banip',true),true);
  assert.equal(await module.waitForApplicationState('banip',false),false);
}
console.log('System service controls: verified process status, bounded action feedback and errors');

