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
      rows.push({proto,external:e,client,internal:i,
        description:parts.slice(4,-1).join(':').slice(0,150)});
      if(rows.length>=100)break;
    }
    return rows;
  }
  async load(target) {
    const root=target?.querySelector('#upnp-workspace');
    if(!root)return;
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
      const [wan,service,leases]=await Promise.all([
        this.optional('network.interface.wan','status',{}),
        this.optional('service','list',{name:'miniupnpd'}),
        this.optional('file','read',{path:'/var/run/miniupnpd.leases'})]);
      this.render(root,instance,{
        service:!!service?.miniupnpd?.instances,
        behindNat:this.privateWan(wan),
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
      this.el('p','Control which trusted clients can request inbound ports. UPnP and NAT-PMP/PCP are disabled by default; secure mode remains enforced, and automatic requests from the WAN are never accepted.','profiles-description'));
    const indicators=this.el('div','upnp-status-cards');
    const badge=(name,value)=>{
      const card=this.el('div',undefined,'stat-card');
      card.append(this.el('div',name,'stat-label'),this.el('strong',value));
      return card;
    };
    indicators.append(badge('Service',status.service?'Installed / service registered':'Not running or status unavailable'),
      badge('Automatic mappings',String(status.mappings.length)),
      badge('Router WAN',status.behindNat?'Private / upstream NAT':'Not detected as private'));
    root.appendChild(indicators);
    if(status.behindNat)root.append(this.el('p','This router is behind another NAT device (as in VirtualBox). UPnP here cannot automatically open ports on the upstream router.','upnp-warning'));

    const form=this.el('form',undefined,'profiles-create');
    const enabled=this.flag(form,'Enable automatic port mapping',cfg.enabled==='1');
    const upnp=this.flag(form,'Allow UPnP IGD (game consoles and local applications)',cfg.enable_upnp==='1');
    const pmp=this.flag(form,'Allow NAT-PMP / PCP',cfg.enable_natpmp==='1');
    this.flag(form,'Secure mode: clients may forward ports only to their own IP (required)',true,true);
    const internal=this.el('select');
    const lan=this.el('option','LAN (trusted management network)');lan.value='lan';internal.append(lan);
    const configured=String(cfg.internal_iface||'lan');
    if(configured!=='lan'){
      const other=this.el('option','Existing custom networks: '+configured);
      other.value=configured;internal.append(other);
    }
    internal.value=configured;
    this.field(form,'Trusted client interfaces',internal);
    const external=this.el('select');
    const wan=this.el('option','WAN');wan.value='wan';external.append(wan);
    external.value='wan';
    this.field(form,'External IPv4 interface',external);
    const rules=Object.entries(this.cfg).filter(([,v])=>v?.['.type']==='perm_rule');
    root.append(this.el('p','Port permission policy is ordered. Requests are evaluated against the rules below, with deny as the fallback. Restrict unknown devices through your firewall and separate guest/IoT networks.','profiles-description'));
    const existingList=this.el('div','upnp-permissions');
    for(const [,v] of rules){
      const p=this.el('p',(v.action||'deny').toUpperCase()+' · external '+(v.ext_ports||'?')+
        ' → internal '+(v.int_addr||'?')+':'+(v.int_ports||'?')+' · '+(v.comment||''),'profiles-description');
      existingList.append(p);
    }
    root.append(form,this.el('h3','Existing permission rules'),existingList);

    const save=this.el('button','SAVE & APPLY UPnP SETTINGS','action-btn');
    save.type='submit';form.append(save);
    const details=this.el('p','UPnP maps external WAN ports. Docker App Store LAN access is separate and never enables UPnP. Automatic mappings are disabled until you enable this service.','profiles-description');
    form.append(details);
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      if(this.busy)return;
      if(enabled.checked && !upnp.checked && !pmp.checked){
        this.core.showToast('Select UPnP or NAT-PMP before enabling','error');return;
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
        await this.rpc('uci','commit',{config:'upnpd'});
        const result=await this.optional('file','exec',{command:'/etc/init.d/miniupnpd',params:['restart']});
        if(!result||Number(result.code||0)!==0){
          this.core.showToast('UPnP settings saved. Restart miniupnpd to apply the changes.','info');
        }else{
          this.core.showToast('UPnP settings applied','success');
        }
        await this.load(target);
      }catch(error){this.core.showToast('UPnP save failed: '+error.message,'error');}
      finally{this.busy=false;save.disabled=false;}
    });

    root.append(this.el('h3','Active automatic port mappings'));
    const table=this.el('table',undefined,'data-table');
    const head=this.el('thead');const row=this.el('tr');
    for(const name of ['Protocol','WAN port','Client IP','Client port','Description'])row.append(this.el('th',name));
    head.append(row);table.append(head);
    const tbody=this.el('tbody');
    for(const mapping of status.mappings){
      const line=this.el('tr');
      for(const value of [mapping.proto,String(mapping.external),mapping.client,String(mapping.internal),mapping.description])
        line.append(this.el('td',value));
      tbody.appendChild(line);
    }
    if(!status.mappings.length){
      const row=this.el('tr');const cell=this.el('td','No active UPnP leases available.','profiles-description');
      cell.colSpan=5;row.append(cell);tbody.append(row);
    }
    table.append(tbody);root.append(table);
    const refresh=this.el('button','REFRESH ACTIVE MAPPINGS','action-btn');refresh.type='button';
    refresh.addEventListener('click',()=>this.load(target));root.append(refresh);
    root.append(this.el('p','Mapping descriptions are untrusted client input and are displayed as text only. For granular permission-rule editing, use OpenWrt Tools > UPnP configuration until a dedicated rule editor is validated.','profiles-description'));
  }
}
