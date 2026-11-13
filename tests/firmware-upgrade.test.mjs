import assert from 'node:assert/strict';
import SystemModule from '../moci/js/modules/system.js';
const elements = Object.fromEntries(['flash-firmware-btn','validate-firmware-btn','upgrade-status',
  'upgrade-progress','file-upload-text','firmware-info','firmware-details','keep-settings']
  .map(id=>[id,{disabled:false,style:{},checked:true}]));
globalThis.document={getElementById:id=>elements[id]};
globalThis.confirm=()=>true;
function make(){
  const m=Object.create(SystemModule.prototype); const calls=[], toasts=[];
  m.core={showToast:(...args)=>toasts.push(args),formatBytes:String,
    ubusCall:async(...args)=>{calls.push(args);return [0,{code:0}];}};
  return {m,calls,toasts};
}
const image={name:'openwrt-combined-efi.img.gz',size:100};
{
  const {m}=make();m.firmwareValidatedFile={name:'old.bin'};
  m.handleFirmwareFile(image);
  assert.equal(m.firmwareFile,image);assert.equal(m.firmwareValidatedFile,null);
  assert.equal(elements['flash-firmware-btn'].disabled,true);
  m.handleFirmwareFile({name:'installer.iso',size:100});assert.equal(m.firmwareFile,null);
}
for(const reply of [[0,{code:0}],[0,{}],[0,{code:1}],[6]]){
  const {m}=make();m.handleFirmwareFile(image);m.uploadFirmwareChunked=async()=>{};
  m.core.ubusCall=async()=>reply;
  await m.validateFirmware();
  assert.equal(m.firmwareValidatedFile===image,reply[0]===0&&reply[1]?.code===0);
  assert.equal(m.firmwareBusy,false);
}
{
  const {m,calls}=make();m.handleFirmwareFile(image);
  await m.flashFirmware();assert.equal(calls.length,0);
  m.firmwareValidatedFile=image;
  m.core.ubusCall=async(...args)=>{calls.push(args);return [6];};
  await m.flashFirmware();assert.equal(calls.length,1);
  assert.match(elements['upgrade-status'].textContent,/command failed/);
  assert.equal(m.firmwareValidatedFile,null);
}
{
  const {m}=make();m.handleFirmwareFile(image);m.firmwareValidatedFile=image;
  m.core.ubusCall=async()=>{throw Error('connection lost');};
  await m.flashFirmware();assert.match(elements['upgrade-status'].textContent,/outcome is unverified/);
}
{
  const {m,calls}=make();
  globalThis.FileReader=class{readAsArrayBuffer(){this.result=new Uint8Array([1]).buffer;this.onload();}};
  m.firmwareFile={size:100000,slice:()=>({})};
  m.core.ubusCall=async(...args)=>{calls.push(args);return [6];};
  await assert.rejects(m.uploadFirmwareChunked(),/chunk rejected/);
  assert.equal(calls.length,1);
}
console.log('Firmware upgrade tests passed: x86 images, selection invalidation, rejected chunks, strict validation and honest failure reporting.');
