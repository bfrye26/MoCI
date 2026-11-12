import assert from 'node:assert/strict';
import {OpenWrtCore} from '../moci/js/core.js';
const removed=[];
globalThis.sessionStorage={removeItem:key=>removed.push(key)};
function core(){
  const c=Object.create(OpenWrtCore.prototype);
  c.sessionId='old';c.logins=0;c.stopped=0;
  c.stopPolling=()=>c.stopped++;
  c.showLoginView=()=>c.logins++;
  c.showToast=()=>{};
  return c;
}
const response=data=>({ok:true,status:200,json:async()=>data});
{
 const c=core();const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push(JSON.parse(options.body).params);return response({result:[6]});};
 await c.ubusCall('moci-docker','catalog');
 assert.equal(c.sessionId,null);assert.equal(c.logins,1);assert.equal(c.stopped,1);
 assert.deepEqual(calls.map(p=>p.slice(1,3)),[['moci-docker','catalog'],['session','access']]);
 assert.equal(removed.at(-1),'ubus_session');
}
{
 const c=core();let calls=0;
 globalThis.fetch=async()=>response({result:[++calls===1?6:0,{}]});
 await c.ubusCall('uci','get');
 assert.equal(c.sessionId,'old');assert.equal(c.logins,0);
}
{
 const c=core();let calls=0;
 globalThis.fetch=async()=>{if(++calls===1)return response({result:[6]});throw Error('offline');};
 await c.ubusCall('uci','get');assert.equal(c.sessionId,'old');assert.equal(c.logins,0);
}
{
 const c=core();let release;let probes=0;
 globalThis.fetch=()=>{probes++;return new Promise(resolve=>{release=()=>resolve(response({result:[6]}));});};
 const a=c.checkSessionAfterDenied('old');const b=c.checkSessionAfterDenied('old');
 assert.equal(probes,1);release();await Promise.all([a,b]);assert.equal(c.logins,1);
}
{
 const c=core();let release;
 globalThis.fetch=()=>new Promise(resolve=>{release=()=>resolve(response({result:[6]}));});
 const check=c.checkSessionAfterDenied('old');c.sessionId='new';release();await check;
 assert.equal(c.sessionId,'new');assert.equal(c.logins,0);
}
{
 const c=core();let calls=0;
 globalThis.fetch=async()=>response(++calls===1?{error:{code:-32002,message:'Access denied'}}:{result:[6]});
 await assert.rejects(c.ubusCall('uci','get'),/Access denied/);
 assert.equal(c.logins,1);assert.equal(calls,2);
 const d=core();calls=0;
 globalThis.fetch=async()=>{calls++;return response({result:[6]});};
 await d.ubusCall('session','access');assert.equal(calls,1);
}
{
 const c=core();let listeners=0;let attached=0;let routes=0;
 globalThis.window={location:{hash:'#/docker'},addEventListener:()=>listeners++};
 c.modules=new Map();c.attachEventListeners=()=>attached++;c.handleRouteChange=()=>routes++;
 c.startApplication();c.startApplication();
 assert.equal(listeners,1);assert.equal(attached,1);assert.equal(routes,2);
}
{
 const c=core();let calls=0;
 globalThis.fetch=async()=>response({result:[++calls===1?6:4]});
 await c.ubusCall('uci','get');assert.equal(c.sessionId,null);assert.equal(c.logins,1);
}
console.log('Session expiry, ACL denial, offline probe, concurrency and relogin checks passed.');
