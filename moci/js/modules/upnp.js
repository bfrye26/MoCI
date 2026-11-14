// Native firewall4 UPnP / NAT-PMP management. UCI owns configuration.
// All remote lease descriptions are rendered using textContent, never innerHTML.
const IPV4=/^(?:\d{1,3}\.){3}\d{1,3}$/;
const PORT=n=>Number.isInteger(n)&&n>=1&&n<=65535;
export default class UpnpModule {
  constructor(core){this.core=core;this.busy=false;}
  el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
  async rpc(obj,method,args={}){
    const [status,value]=await this.core.ubusCall(obj,method,args,{timeout:25000});
    if(status!==0)throw new Error(obj+'.'+method+' failed ('+status+')');
    return value||{};
  }
  async optional(obj,method,args){
    try{return await this.rpc(obj,method,args);}catch{return null;}
  }
  privateWan(wan){
    const address=wan?.['ipv4-address']?.[0]?.address||'';
    if(!IPV4.test(address))return false;
    const o=address.split('.').map(Number);
    return o[0]===10||(o[0]===172&&o[1]>=16&&o[1]<=31)||
      (o[0]===192&&o[1]===168)||(o[0]===100&&o[1]>=64&&o[1]<=127);
  }
  leaseRows(text){
    if(typeof text!=='string')return [];
    const rows=[];
    for(const line of text.split(/\r?\n/).slice(0,256)){
      // miniupnpd stores protocol, external port, client IP, internal port,
      // description and expiry. Invalid or unfamiliar records are ignored.
      const parts=line.split(':');
      if(parts.length<5)continue;
      const [proto,external,client,internal]=parts;
      const e=Number(external),i=Number(internal);
      if(!['TCP','UDP'].includes(proto)||!PORT(e)||!PORT(i)||!IPV4.test(client))continue;
      if(!client.split('.').every(o=>Number(o)<=255))continue;
      const expiry=Number(parts[parts.length-1]);
      rows.push({proto,external:e,client,internal:i,
        description:parts.slice(4,-1).join(':').slice(0,150),
        expires:Number.isFinite(expiry)&&expiry>0?expiry:0});
      if(rows.length>=100)break;
    }
    return rows;
  }
  async load(target) {
    const root=target?.querySelector('#upnp-workspace')||target?.querySelector('.upnp-workspace')||target;
    if(!root)return;
    this._loadTarget=target;
    root.replaceChildren(this.el('p','Loading UPnP settings and active mappings…'));
    try{
      // An absent package is a feature availability state, not a login error.
      const config=await this.optional('uci','get',{config:'upnpd'});
      if(!config?.values){
        root.replaceChildren(this.el('h3','UPnP & Automatic Port Mapping'),
          this.el('p','miniupnpd-nftables is not installed or its UCI configuration is missing. Install the OpenWrt package to enable native UPnP and NAT-PMP. This feature stays disabled until you opt in.','profiles-description'));
        return;
      }
      const values=config.values;
      this.cfg=values;
      const instance=values.config||Object.values(values).find(v=>v?.['.type']==='upnpd');
      const section=values.config?'config':Object.keys(values).find(k=>values[k]===instance);
      if(!instance||!section)throw new Error('UPnP configuration section not found');
      this.section=section;
      const [interfaces,service,leases]=await Promise.all([
        this.optional('network.interface','dump',{}),
        this.optional('service','list',{name:'miniupnpd'}),
        this.optional('file','read',{path:'/var/run/miniupnpd.leases'})]);
      this.render(root,instance,{
        service:Object.values(service?.miniupnpd?.instances||{}).some(value=>value?.running===true),
        serviceKnown:service!==null,
        behindNat:this.privateWan((interfaces?.interface||[]).find(v=>v.interface==='wan')), 
        mappings:this.leaseRows(leases?.data)
      });
    }catch(error){
      root.replaceChildren(this.el('h3','UPnP unavailable'),
        this.el('p','Could not read UPnP settings: '+error.message,'profiles-description'));
    }
  }
  field(form,title,control){
    const label=this.el('label',title,'advanced-field');
    label.appendChild(control);form.appendChild(label);return control;
  }
  flag(form,title,checked,disabled=false){
    const field=this.el('label',undefined,'profiles-check');
    const input=this.el('input');input.type='checkbox';input.checked=checked;input.disabled=disabled;
    field.append(input,this.el('span',title));form.appendChild(field);return input;
  }
  render(root,cfg,status){
    root.replaceChildren();
    root.append(this.el('h3','UPnP & Automatic Port Mapping'),
      this.el('p','Choose which trusted devices may request incoming ports. The saved settings below reflect this router. Secure mode is enforced, and requests from the WAN are never accepted.','profiles-description'));
    const indicators=this.el('div',undefined,'upnp-status-cards');
    const badge=(name,value)=>{
      const card=this.el('div',undefined,'stat-card');
      card.append(this.el('div',name,'stat-label'),this.el('strong',value));
      return card;
    };
    indicators.append(badge('Service',status.service?'Running':status.serviceKnown?'Not running':'Status unavailable'),
      badge('Automatic mappings',String(status.mappings.length)),
      badge('Router WAN',status.behindNat?'Private / upstream NAT':'Not detected as private'));
    root.appendChild(indicators);
    if(status.behindNat)root.append(this.el('p','This router is behind another NAT device (as in VirtualBox). UPnP here cannot automatically open ports on the upstream router.','upnp-warning'));

    if(!status.service && cfg.enabled==='1'){
      const warning=this.el('div',undefined,'upnp-warning upnp-runtime-warning');
      warning.append(this.el('p','Automatic port mapping is enabled in configuration, but miniupnpd is not running. Its startup error needs to be checked before port mapping can work.'));
      const diagnostics=this.el('a','OPEN SERVICE DIAGNOSTICS','action-btn upnp-diagnostic-link');
      diagnostics.href='#/system/startup';
      warning.append(diagnostics);root.append(warning);
    }
    const form=this.el('form',undefined,'profiles-create upnp-form');
    const settings=this.el('div',undefined,'upnp-controls-grid');
    const protocols=this.el('section',undefined,'upnp-controls-card');
    protocols.append(this.el('h4','Protocol access'));
    const routing=this.el('section',undefined,'upnp-controls-card');
    routing.append(this.el('h4','Trusted network scope'));
    settings.append(protocols,routing);form.append(settings);
    const enabled=this.flag(protocols,'Enable automatic port mapping',cfg.enabled==='1');
    const upnp=this.flag(protocols,'Allow UPnP IGD (game consoles and local applications)',cfg.enable_upnp==='1');
    const pmp=this.flag(protocols,'Allow NAT-PMP / PCP',cfg.enable_natpmp==='1');
    this.flag(protocols,'Secure mode: clients may forward ports only to their own IP (required)',true,true);
    const internal=this.el('select');
    const lan=this.el('option','LAN (trusted management network)');lan.value='lan';internal.append(lan);
    const configured=String(cfg.internal_iface||'lan');
    if(configured!=='lan'){
      const other=this.el('option','Existing custom networks: '+configured);
      other.value=configured;internal.append(other);
    }
    internal.value=configured;
    this.field(routing,'Trusted client interfaces',internal);
    const external=this.el('select');
    const wan=this.el('option','WAN');wan.value='wan';external.append(wan);
    external.value='wan';
    this.field(routing,'External IPv4 interface',external);
    const rules=Object.entries(this.cfg).filter(([,v])=>v?.['.type']==='perm_rule');
    root.append(this.el('p','Port permission policy is ordered. Requests are evaluated against the rules below, with deny as the fallback. Restrict unknown devices through your firewall and separate guest/IoT networks.','profiles-description'));
    const existingList=this.el('div',undefined,'upnp-permissions');
    for(const [,v] of rules){
      const p=this.el('p',(v.action||'deny').toUpperCase()+' · external '+(v.ext_ports||'?')+
        ' → internal '+(v.int_addr||'?')+':'+(v.int_ports||'?')+' · '+(v.comment||''),'profiles-description');
      existingList.append(p);
    }
    root.append(form,this.el('h3','Existing permission rules'),existingList);
    const allowRules=rules.filter(([,v])=>v.action==='allow');
    const manageable=allowRules.length===1;
    let minExternal,maxExternal,minInternal,maxInternal;
    if(manageable){
      const [ruleId,rule]=allowRules[0];
      const externalRange=String(rule.ext_ports||'1024-65535').split('-').map(Number);
      const internalRange=String(rule.int_ports||'1024-65535').split('-').map(Number);
      const policy=this.el('section',undefined,'upnp-range-editor');
      const heading=this.el('h4','Approved automatic port ranges');
      const input=(title,value)=>{
        const wrap=this.el('label',title,'advanced-field');
        const field=this.el('input');field.type='number';field.min='1024';field.max='65535';
        field.required=true;field.value=String(value);
        wrap.append(field);policy.append(wrap);return field;
      };
      policy.append(heading);
      minExternal=input('Minimum incoming WAN port',externalRange[0]);
      maxExternal=input('Maximum incoming WAN port',externalRange[1]??externalRange[0]);
      minInternal=input('Minimum device port',internalRange[0]);
      maxInternal=input('Maximum device port',internalRange[1]??internalRange[0]);
      form.appendChild(policy);
      this.allowRuleSection=ruleId;
    }else{
      this.allowRuleSection=null;
      form.append(this.el('p','This router has multiple custom permission rules or no allow rule. MoCI will preserve them. Review their order using OpenWrt Tools > UPnP Configuration before enabling automatic mappings.','upnp-warning'));
    }

    const actions=this.el('div',undefined,'upnp-actions');
    const save=this.el('button','SAVE & APPLY UPnP SETTINGS','action-btn upnp-save-btn');
    save.type='submit';actions.append(save);
    const details=this.el('p','UPnP exposes requested WAN ports. Docker App Store LAN access is separate and never enables UPnP.','upnp-action-note');
    actions.append(details);form.append(actions);
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      if(this.busy)return;
      if(enabled.checked && !upnp.checked && !pmp.checked){
        this.core.showToast('Select UPnP or NAT-PMP before enabling','error');return;
      }
      let range=null;
      if(this.allowRuleSection){
        const nums=[minExternal,maxExternal,minInternal,maxInternal].map(field=>Number(field.value));
        if(nums.some(n=>!PORT(n)||n<1024)||nums[0]>nums[1]||nums[2]>nums[3]){
          this.core.showToast('Automatic port ranges must be 1024–65535, with minimum not exceeding maximum','error');return;
        }
        range={ext_ports:nums[0]+'-'+nums[1],int_ports:nums[2]+'-'+nums[3]};
      }
      if(enabled.checked && !window.confirm('Allow trusted LAN clients to request incoming WAN ports? This may expose services directly to the internet.'))return;
      this.busy=true;save.disabled=true;
      try{
        await this.rpc('uci','set',{config:'upnpd',section:this.section,values:{
          enabled:enabled.checked?'1':'0',
          enable_upnp:upnp.checked?'1':'0',
          enable_natpmp:pmp.checked?'1':'0',
          secure_mode:'1',internal_iface:internal.value,external_iface:'wan',
          log_output:'1'}});
        if(range)await this.rpc('uci','set',{config:'upnpd',section:this.allowRuleSection,values:range});
        await this.rpc('uci','commit',{config:'upnpd'});
        const result=await this.rpc('file','exec',{command:'/etc/init.d/miniupnpd',params:['restart']});
        if(result.code!==0)throw new Error('miniupnpd restart failed: '+String(result.stderr||result.stdout||'exit '+result.code).slice(0,200));
        const actual=await this.optional('service','list',{name:'miniupnpd',verbose:true});
        const live=Object.values(actual?.miniupnpd?.instances||{}).some(v=>v?.running===true);
        if(enabled.checked && !live){
          this.core.showToast('Settings saved, but miniupnpd is not running. Open System > Startup > Details.','error');
        }else{
          this.core.showToast(enabled.checked?'UPnP settings saved. Verify a test port mapping.':'Automatic port mapping disabled','success');
        }
        await this.load(this._loadTarget);
      }catch(error){this.core.showToast('UPnP save failed: '+error.message,'error');}
      finally{this.busy=false;save.disabled=false;}
    });

    this.renderDelegation(root);
    root.append(this.el('h3','Active automatic port mappings'));
    const table=this.el('table',undefined,'data-table');
    const head=this.el('thead');const row=this.el('tr');
    for(const name of ['Protocol','WAN port','Client IP','Client port','Description','Expires'])row.append(this.el('th',name));
    head.append(row);table.append(head);
    const tbody=this.el('tbody');
    for(const mapping of status.mappings){
      const line=this.el('tr');
      for(const value of [mapping.proto,String(mapping.external),mapping.client,String(mapping.internal),mapping.description,this.fmtExpiry(mapping.expires)])
        line.append(this.el('td',value));
      tbody.appendChild(line);
    }
    if(!status.mappings.length){
      const row=this.el('tr');const cell=this.el('td','No active UPnP leases available.','profiles-description');
      cell.colSpan=6;row.append(cell);tbody.append(row);
    }
    table.append(tbody);root.append(table);
    const refresh=this.el('button','REFRESH ACTIVE MAPPINGS','action-btn');refresh.type='button';
    refresh.addEventListener('click',()=>this.load(this._loadTarget));root.append(refresh);
    root.append(this.el('p','Mapping descriptions are untrusted client input and are displayed as text only. Leases expire automatically; delegated devices may only forward ports to themselves (secure mode).','profiles-description'));
  }
  fmtExpiry(epoch){
    if(!epoch)return '—';
    const remain=Math.max(0,Math.floor(epoch-Date.now()/1000));
    if(remain<=0)return 'expired';
    if(remain>=3600)return Math.floor(remain/3600)+'h '+Math.floor((remain%3600)/60)+'m';
    if(remain>=60)return Math.floor(remain/60)+'m';
    return remain+'s';
  }
  async reloadUpnp(){
    await this.rpc('uci','commit',{config:'upnpd'});
    const result=await this.rpc('file','exec',{command:'/etc/init.d/miniupnpd',params:['restart']});
    if(result.code!==0)throw new Error('miniupnpd restart failed');
  }
  renderDelegation(root){
    root.append(this.el('h3','Delegated device access'));
    root.append(this.el('p','Off by default. Explicitly grant a trusted device permission to open its own incoming ports via UPnP/NAT-PMP (self-service). Devices without a delegation are denied. Leases expire automatically and secure mode keeps each device forwarding only to itself.','profiles-description'));
    const rules=Object.entries(this.cfg||{}).filter(([,v])=>v?.['.type']==='perm_rule'&&String(v.comment||'').startsWith('MoCI delegation'));
    const list=this.el('div',undefined,'upnp-permissions');
    if(!rules.length)list.append(this.el('p','No devices delegated. Add one below to allow it to request ports.','profiles-description'));
    for(const [id,v] of rules){
      const line=this.el('div',undefined,'profiles-entry');
      line.append(this.el('span',(v.int_addr||'?')+' · ports '+(v.int_ports||'1024-65535')));
      const revoke=this.el('button','REVOKE','action-btn danger');revoke.type='button';
      revoke.addEventListener('click',()=>this.removeDelegation(id,v.int_addr));
      line.append(revoke);list.append(line);
    }
    root.append(list);
    const form=this.el('form',undefined,'profiles-allow-form');
    const ip=this.el('input');ip.placeholder='Trusted device IPv4 (e.g. 192.168.50.40)';ip.required=true;ip.maxLength=15;
    ip.setAttribute('aria-label','Delegated device IPv4');
    const add=this.el('button','DELEGATE DEVICE','action-btn');add.type='submit';
    form.append(ip,add);
    form.addEventListener('submit',e=>{e.preventDefault();this.addDelegation(ip.value.trim(),add);});
    root.append(form);
  }
  async addDelegation(ip,btn){
    if(this.busy)return;
    if(!IPV4.test(ip)||!ip.split('.').every(o=>Number(o)<=255)){this.core.showToast('Enter a valid device IPv4 address','error');return;}
    const exists=Object.values(this.cfg||{}).some(v=>v?.['.type']==='perm_rule'&&String(v.comment||'').startsWith('MoCI delegation')&&v.int_addr===ip);
    if(exists){this.core.showToast('That device is already delegated','error');return;}
    if(!window.confirm('Allow '+ip+' to open its own incoming ports via UPnP? It may expose services on this device to the internet. Leases expire automatically.'))return;
    this.busy=true;if(btn)btn.disabled=true;
    try{
      const r=await this.rpc('uci','add',{config:'upnpd',type:'perm_rule'});
      await this.rpc('uci','set',{config:'upnpd',section:r.section,values:{
        action:'allow',ext_ports:'1024-65535',int_addr:ip,int_ports:'1024-65535',comment:'MoCI delegation '+ip}});
      await this.reloadUpnp();
      this.core.showToast('Device delegated','success');
      await this.load(this._loadTarget);
    }catch(e){this.core.showToast('Delegation failed: '+e.message,'error');}
    finally{this.busy=false;if(btn)btn.disabled=false;}
  }
  async removeDelegation(section,ip){
    if(this.busy||!section)return;
    if(!window.confirm('Revoke port delegation for '+(ip||'this device')+'? Its active leases will expire.'))return;
    this.busy=true;
    try{
      await this.rpc('uci','delete',{config:'upnpd',section});
      await this.reloadUpnp();
      this.core.showToast('Delegation revoked','success');
      await this.load(this._loadTarget);
    }catch(e){this.core.showToast('Revoke failed: '+e.message,'error');}
    finally{this.busy=false;}
  }
}

