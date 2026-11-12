// Native profile-scoped WireGuard policy routing inspired by StartWRT.
// UCI is authoritative: no additional routing daemon or root shell access.
// Supports outbound WG routing and limited static-IP two-hop tunnel chaining.
const ID=/^[a-z][a-z0-9_-]{0,29}$/;
function validIPv4(ip){
  const parts=ip.split('.');
  return parts.length===4&&parts.every(x=>/^\d{1,3}$/.test(x)&&Number(x)>=0&&Number(x)<=255);
}
function validCIDR(value){
  const [ip,prefix]=String(value).split('/');
  if(!validIPv4(ip)||!prefix||!/^\d{1,2}$/.test(prefix)||Number(prefix)<8||Number(prefix)>32)return false;
  const a=ip.split('.').map(Number);
  return a[0]===10||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168);
}
export default class VpnPoliciesModule{
  constructor(core){
    this.core=core;
    this.busy=false;
    this.core.registerRoute('/vpn-policies',()=>this.show());
  }
  el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
  async rpc(object,method,args={}){
    const [status,value]=await this.core.ubusCall(object,method,args,{timeout:65000});
    if(status!==0)throw new Error(object+'.'+method+' failed ('+status+')');
    return value||{};
  }
  async uci(method,args={}){return this.rpc('uci',method,args);}
  async show(){
    this.page=document.getElementById('vpn-policies-page');
    this.page?.classList.remove('hidden');
    this.root=this.page?.querySelector('#vpn-policies-content');
    if(!this.root)return;
    this.root.replaceChildren(this.el('p','Loading profile routing and VPN interfaces…'));
    try{
      const [network,firewall,pbr]=await Promise.all([
        this.uci('get',{config:'network'}),
        this.uci('get',{config:'firewall'}),
        this.uci('get',{config:'pbr'})
      ]);
      this.network=network.values||{};
      this.firewall=firewall.values||{};
      this.pbr=pbr.values||{};
      this.render();
    }catch(e){this.root.replaceChildren(this.el('p','Unable to load VPN configuration: '+e.message,'profiles-description'));}
  }
  vpnInterfaces(){
    return Object.entries(this.network).filter(([name,v])=>ID.test(name)&&v?.['.type']==='interface'&&v.proto==='wireguard');
  }
  profiles(){
    const zone=Object.entries(this.firewall)
      .filter(([name,config])=>config?.['.type']==='zone'&&String(config.name||'').startsWith('moci_'));
    return zone.flatMap(([section,z])=>{
      const nets=Array.isArray(z.network)?z.network:String(z.network||'').split(/\s+/);
      return nets.filter(net=>this.network[net]?.['.type']==='interface').map(net=>({
        id:z.name.replace(/^moci_/,''),zone:z.name,network:net,section
      }));
    }).filter(v=>ID.test(v.id));
  }
  bindNetworkZone(vpn){
    for(const [section,value] of Object.entries(this.firewall)){
      if(value?.['.type']==='zone'){
        const nets=Array.isArray(value.network)?value.network:String(value.network||'').split(/\s+/);
        if(nets.includes(vpn))return {section,name:value.name};
      }
    }
    return null;
  }
  async set(config,section,values){await this.uci('set',{config,section,values});}
  async add(config,type,name){await this.uci('add',{config,type,name});}
  async apply(){
    await this.uci('apply',{rollback:true,timeout:60});
    await new Promise(r=>setTimeout(r,2500));
    await this.rpc('system','info');
    if(!window.confirm('The router is reachable following this routing change. Keep the new settings?\nChoose Cancel to let OpenWrt roll back.'))throw new Error('Routing changes were not confirmed. OpenWrt should restore the previous configuration.');
    await this.uci('confirm');
  }
  createLabel(text,node){
    const label=this.el('label',text,'advanced-field');label.append(node);return label;
  }
  makeSelect(options){
    const select=this.el('select');select.required=true;
    for(const [value,title] of options){const opt=this.el('option',title);opt.value=value;select.append(opt);}
    return select;
  }
  render(){
    const root=this.root;root.replaceChildren();
    root.append(this.el('p','Route selected security profiles through existing outbound WireGuard tunnels. Add a second WireGuard hop using a static endpoint route. WAN fallback is blocked by the profile firewall zone when there is no WAN forwarding.','profiles-description'));
    const tunnels=this.vpnInterfaces(),profiles=this.profiles();
    const managed=Object.entries(this.pbr).filter(([id,v])=>id.startsWith('moci_pbr_')&&v?.['.type']==='policy');
    const form=this.el('form',undefined,'profiles-create');
    const profile=this.makeSelect(profiles.map(p=>[p.id,p.id+' ('+p.network+')']));
    const dest=this.makeSelect(tunnels.map(([name])=>[name,name]));
    const source=this.el('input');
    source.type='text';source.required=true;source.placeholder='192.168.60.0/24';
    source.pattern='[0-9./]+';source.maxLength=18;
    form.append(this.createLabel('Security profile',profile),
      this.createLabel('VPN exit interface',dest),
      this.createLabel('Source network CIDR',source));
    const explain=this.el('p','The source CIDR must be the actual subnet used by this security profile. An outbound WireGuard client should be configured in Network → VPN before assigning the profile.','profiles-description');
    form.append(explain);
    const button=this.el('button','ASSIGN PROFILE TO VPN','action-btn');button.type='submit';
    button.disabled=!tunnels.length||!profiles.length;form.append(button);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(this.busy)return;
      const p=profiles.find(v=>v.id===profile.value);
      const vpn=dest.value,cidr=source.value.trim();
      if(!p||!this.network[vpn]||!ID.test(vpn)||!validCIDR(cidr)){
        this.core.showToast('Invalid profile, VPN or private subnet','error');return;
      }
      const existing=this.pbr['moci_pbr_'+p.id];
      if(existing){this.core.showToast('Profile already has a VPN routing policy','error');return;}
      const anyWan=Object.entries(this.firewall).some(([,f])=>f?.['.type']==='forwarding'&&f.src===p.zone&&f.dest==='wan');
      if(anyWan){this.core.showToast('Remove WAN forwarding from this profile before assigning VPN (prevents fallback leaks)','error');return;}
      if(!window.confirm('Route '+cidr+' through '+vpn+'? The VPN must be available or this profile may lose Internet connectivity. OpenWrt will roll back unless confirmed.'))return;
      this.busy=true;button.disabled=true;
      try{
        let zone=this.bindNetworkZone(vpn);
        if(!zone){
          const section='moci_wgzone_'+vpn;
          if(this.firewall[section])throw new Error('VPN zone section conflicts with an existing configuration');
          await this.add('firewall','zone',section);
          await this.set('firewall',section,{name:'moci_vpn_'+vpn,network:[vpn],input:'REJECT',output:'ACCEPT',forward:'REJECT',masq:'1',mtu_fix:'1'});
          zone={name:'moci_vpn_'+vpn};
        }
        const forward='moci_pbr_forward_'+p.id;
        if(this.firewall[forward])throw new Error('Profile forward already exists');
        await this.add('firewall','forwarding',forward);
        await this.set('firewall',forward,{src:p.zone,dest:zone.name});
        const policy='moci_pbr_'+p.id;
        await this.add('pbr','policy',policy);
        await this.set('pbr',policy,{name:'MoCI '+p.id+' via '+vpn,src_addr:cidr,interface:vpn,enabled:'1'});
        if(this.pbr.config?.['.type'])await this.set('pbr','config',{enabled:'1'});
        await this.apply();
        this.core.showToast('Profile now assigned to VPN','success');await this.show();
      }catch(e){this.core.showToast('VPN routing not confirmed: '+e.message,'error');}
      finally{this.busy=false;button.disabled=false;}
    });
    root.append(this.el('h3','Outbound VPN per security profile'),form);
    if(!tunnels.length)root.append(this.el('p','No WireGuard interfaces found. Configure a tunnel under Network → VPN before assigning a profile.','profiles-description'));
    if(!profiles.length)root.append(this.el('p','No security profiles found. Create an isolated profile first.','profiles-description'));
    root.append(this.el('h3','Existing VPN routing policies'));
    if(!managed.length)root.append(this.el('p','No MoCI VPN policies installed.','profiles-description'));
    for(const [section,value] of managed){
      const profileId=section.slice('moci_pbr_'.length);
      const card=this.el('article',undefined,'stat-card profiles-entry');
      card.append(this.el('strong',profileId+' → '+(value.interface||'?')),
        this.el('p',String(value.src_addr||'')+' · '+String(value.name||''),'profiles-description'));
      const remove=this.el('button','REMOVE VPN POLICY','action-btn danger');remove.type='button';
      remove.addEventListener('click',async()=>{
        if(this.busy||!window.confirm('Remove VPN routing policy for '+profileId+'? This will not automatically enable WAN access for the profile.'))return;
        this.busy=true;remove.disabled=true;
        try{
          await this.uci('delete',{config:'pbr',section});
          const forward='moci_pbr_forward_'+profileId;
          if(this.firewall[forward])await this.uci('delete',{config:'firewall',section:forward});
          await this.apply();
          this.core.showToast('VPN policy removed','success');await this.show();
        }catch(e){this.core.showToast('Removal failed: '+e.message,'error');remove.disabled=false;}
        finally{this.busy=false;}
      });
      card.append(remove);root.append(card);
    }
    this.renderChain(root,tunnels);
  }
  renderChain(root,tunnels){
    root.append(this.el('h3','Optional two-hop WireGuard chain'));
    root.append(this.el('p','Route the exit tunnel’s public IPv4 endpoint through an upstream WireGuard tunnel. This is supported only for static IPv4 endpoints and requires both providers to permit the connection. Configure the profile’s exit tunnel above after installing the route.','profiles-description'));
    const form=this.el('form',undefined,'profiles-create');
    const entry=this.makeSelect(tunnels.map(([name])=>[name,name]));
    const exit=this.makeSelect(tunnels.map(([name])=>[name,name]));
    form.append(this.createLabel('Entry VPN tunnel',entry),this.createLabel('Exit VPN tunnel',exit));
    const endpoint=this.el('input');endpoint.type='text';endpoint.required=true;endpoint.placeholder='198.51.100.42';
    form.append(this.createLabel('Exit VPN server IPv4 endpoint',endpoint));
    const button=this.el('button','ADD STATIC CHAIN ROUTE','action-btn');button.type='submit';
    button.disabled=tunnels.length<2;form.append(button);
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(this.busy)return;
      const from=entry.value,to=exit.value,ip=endpoint.value.trim();
      if(!ID.test(from)||!ID.test(to)||from===to||!this.network[from]||!this.network[to]||!validIPv4(ip)){
        this.core.showToast('Invalid tunnel pair or static endpoint','error');return;
      }
      const id='moci_chain_'+to;
      if(this.network[id]){this.core.showToast('Exit tunnel already has a chain route','error');return;}
      if(!window.confirm('Create route to exit server '+ip+' through '+from+'? This can interrupt the exit tunnel. A 60-second rollback is available.'))return;
      this.busy=true;button.disabled=true;
      try{
        await this.add('network','route',id);
        await this.set('network',id,{interface:from,target:ip+'/32'});
        await this.apply();
        this.core.showToast('VPN chain route added','success');await this.show();
      }catch(e){this.core.showToast('Chain route not confirmed: '+e.message,'error');}
      finally{this.busy=false;button.disabled=false;}
    });
    root.append(form);
    const existing=Object.entries(this.network).filter(([id,v])=>id.startsWith('moci_chain_')&&v?.['.type']==='route');
    for(const [section,route] of existing){
      const card=this.el('article',undefined,'stat-card profiles-entry');
      card.append(this.el('strong',section.replace(/^moci_chain_/,'')+' endpoint '+route.target),
        this.el('p','Via '+route.interface,'profiles-description'));
      const remove=this.el('button','REMOVE CHAIN ROUTE','action-btn danger');remove.type='button';
      remove.addEventListener('click',async()=>{
        if(!window.confirm('Remove chain route '+section+'?'))return;
        remove.disabled=true;
        try{
          await this.uci('delete',{config:'network',section});
          await this.apply();
          await this.show();
        }catch(e){this.core.showToast(e.message,'error');remove.disabled=false;}
      });
      card.append(remove);root.append(card);
    }
  }
}
