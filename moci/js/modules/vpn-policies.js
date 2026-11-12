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
      // Missing pbr is common on small/test images; it should not hide
      // other VPN functions such as inbound WireGuard server setup.
      const pbrCall=this.uci('get',{config:'pbr'})
        .then(data=>({data,missing:false}))
        .catch(error=>{
          if(/\bfailed \(4\)/.test(error.message))return {data:{values:{}},missing:true};
          throw error;
        });
      const [network,firewall,pbr]=await Promise.all([
        this.uci('get',{config:'network'}),
        this.uci('get',{config:'firewall'}),
        pbrCall
      ]);
      this.network=network.values||{};
      this.firewall=firewall.values||{};
      this.pbr=pbr.data.values||{};
      this.pbrAvailable=!pbr.missing;
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
    if(!this.pbrAvailable){
      root.append(this.el('p','Policy-based routing (pbr) is not installed or configured. Outbound per-profile VPN routing is disabled until pbr is available, but inbound WireGuard and existing network configuration can still be viewed.','profiles-description'));
    }
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
    button.disabled=!this.pbrAvailable||!tunnels.length||!profiles.length;form.append(button);
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
    this.renderInbound(root);
  }
  renderInbound(root){
    root.append(this.el('h3','Inbound WireGuard VPN servers'));
    root.append(this.el('p','Create separate inbound WireGuard interfaces for remote users. Each server receives its own firewall security zone, private subnet and external UDP port. Assign peer public keys and allowed client addresses through the native VPN peer editor.','profiles-description'));
    const managed=Object.entries(this.network).filter(([id,v])=>id.startsWith('moci_wgsrv_')&&v?.['.type']==='interface'&&v.proto==='wireguard');
    const form=this.el('form',undefined,'profiles-create');
    const name=this.el('input');name.required=true;name.pattern='[a-z][a-z0-9]{1,16}';name.placeholder='staff';
    const subnet=this.el('input');subnet.required=true;subnet.placeholder='10.45.0.1/24';
    const port=this.el('input');port.type='number';port.min='1024';port.max='65535';port.required=true;port.value='51821';
    const internet=this.el('input');internet.type='checkbox';
    form.append(this.createLabel('Server name',name),this.createLabel('Server interface address (CIDR)',subnet),
      this.createLabel('Inbound UDP port',port));
    const wan=this.el('label',undefined,'profiles-check');
    wan.append(internet,this.el('span','Permit remote users to reach the internet through the router'));
    form.append(wan);
    const button=this.el('button','CREATE INBOUND VPN SERVER','action-btn');button.type='submit';form.append(button);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(this.busy)return;
      const slug=name.value.trim().toLowerCase(),address=subnet.value.trim(),listen=Number(port.value);
      if(!/^[a-z][a-z0-9]{1,16}$/.test(slug)||
        !validCIDR(address)||!Number.isInteger(listen)||listen<1024||listen>65535){
        this.core.showToast('Invalid VPN subnet, name or UDP port. Use a private address such as 10.45.0.1/24.','error');return;
      }
      if(Object.values(this.network).some(v=>v?.proto==='wireguard'&&Number(v.listen_port)===listen)){
        this.core.showToast('A WireGuard listener already uses this UDP port','error');return;
      }
      const iface='moci_wgsrv_'+slug;
      if(this.network[iface]){
        this.core.showToast('Server name already exists','error');return;
      }
      if(!window.confirm('Create inbound VPN '+iface+' on UDP '+listen+'? It will use a separate REJECT-by-default security zone.')){
        return;
      }
      this.busy=true;button.disabled=true;
      try{
        const keys=await this.rpc('moci','wgGenKey');
        if(!/^[A-Za-z0-9+/]{43}=$/.test(keys.private_key||''))throw new Error('WireGuard key generation failed');
        await this.add('network','interface',iface);
        await this.set('network',iface,{
          proto:'wireguard',private_key:keys.private_key,listen_port:String(listen),
          addresses:[address],moci_inbound:'1'});
        const zone='moci_wgzone_'+slug;
        await this.add('firewall','zone',zone);
        await this.set('firewall',zone,{name:'moci_remote_'+slug,network:[iface],
          input:'REJECT',output:'ACCEPT',forward:'REJECT'});
        const ingress='moci_wgport_'+slug;
        await this.add('firewall','rule',ingress);
        await this.set('firewall',ingress,{
          name:'MoCI VPN '+slug+' UDP',src:'wan',proto:'udp',
          dest_port:String(listen),target:'ACCEPT'});
        if(internet.checked){
          const forward='moci_wginternet_'+slug;
          await this.add('firewall','forwarding',forward);
          await this.set('firewall',forward,{src:'moci_remote_'+slug,dest:'wan'});
        }
        await this.apply();
        this.core.showToast('Inbound VPN server created. Add peers using Network → VPN.','success');
        await this.show();
      }catch(e){this.core.showToast('VPN server was not confirmed: '+e.message,'error');}
      finally{this.busy=false;button.disabled=false;}
    });
    root.append(form);
    if(!managed.length)root.append(this.el('p','No inbound servers created.','profiles-description'));
    for(const [iface,values] of managed){
      const slug=iface.replace('moci_wgsrv_','');
      const card=this.el('article',undefined,'stat-card profiles-entry');
      card.append(this.el('strong',iface+' · UDP '+values.listen_port),
        this.el('p',(values.addresses||[]).toString()+' · Private key stored in OpenWrt UCI, not displayed.','profiles-description'));
      const remove=this.el('button','REMOVE VPN SERVER','action-btn danger');remove.type='button';
      remove.addEventListener('click',async()=>{
        if(!window.confirm('Remove inbound VPN '+iface+' and disconnect all connected users?')){
          return;
        }
        if(!window.confirm('Final confirmation: remove the WireGuard interface, its peers and managed firewall rules?')){
          return;
        }
        this.busy=true;remove.disabled=true;
        try{
          for(const peer of Object.keys(this.network).filter(n=>this.network[n]?.['.type']==='wireguard_'+iface)){
            await this.uci('delete',{config:'network',section:peer});
          }
          await this.uci('delete',{config:'network',section:iface});
          for(const section of ['moci_wgzone_'+slug,'moci_wgport_'+slug,'moci_wginternet_'+slug]){
            if(this.firewall[section])await this.uci('delete',{config:'firewall',section});
          }
          await this.apply();
          this.core.showToast('Inbound VPN removed','success');await this.show();
        }catch(e){this.core.showToast('Removal not confirmed: '+e.message,'error');remove.disabled=false;}
        finally{this.busy=false;}
      });
      const peerForm=this.el('form',undefined,'profiles-create');
      const peerName=this.el('input');peerName.placeholder='laptop';peerName.required=true;
      peerName.pattern='[a-z][a-z0-9]{1,20}';peerName.maxLength=21;
      const publicKey=this.el('input');publicKey.required=true;publicKey.placeholder='Base64 peer public key';
      publicKey.maxLength=44;publicKey.minLength=44;
      const address=this.el('input');address.required=true;address.placeholder='10.45.0.2/32';
      peerForm.append(this.createLabel('Peer label',peerName),this.createLabel('Client public key',publicKey),
        this.createLabel('Client IPv4 address /32',address));
      const addPeer=this.el('button','ADD VPN PEER','action-btn');addPeer.type='submit';
      peerForm.append(addPeer);
      peerForm.addEventListener('submit',async e=>{
        e.preventDefault();if(this.busy)return;
        const name=peerName.value.trim().toLowerCase(),key=publicKey.value.trim(),ip=address.value.trim();
        if(!/^[a-z][a-z0-9]{1,20}$/.test(name)||!/^[A-Za-z0-9+/]{43}=$/.test(key)||
           !validCIDR(ip)||!ip.endsWith('/32')){
          this.core.showToast('Invalid peer name, public key or /32 client address','error');return;
        }
        const section='moci_peer_'+slug+'_'+name;
        if(this.network[section]){this.core.showToast('Peer already exists','error');return;}
        if(!window.confirm('Add peer '+name+' to inbound VPN '+iface+'?'))return;
        this.busy=true;addPeer.disabled=true;
        try{
          await this.add('network','wireguard_'+iface,section);
          await this.set('network',section,{description:'MoCI '+name,public_key:key,
            allowed_ips:[ip],route_allowed_ips:'0'});
          await this.apply();
          this.core.showToast('Peer saved','success');await this.show();
        }catch(error){this.core.showToast('Peer not confirmed: '+error.message,'error');}
        finally{this.busy=false;addPeer.disabled=false;}
      });
      const peers=this.el('div',undefined,'profiles-list');
      for(const [peerSection,peer] of Object.entries(this.network)){
        if(peer['.type']!=='wireguard_'+iface)continue;
        const line=this.el('article',undefined,'profiles-entry');
        line.append(this.el('strong',peer.description||peerSection),
          this.el('p',Array.isArray(peer.allowed_ips)?peer.allowed_ips.join(', '):String(peer.allowed_ips||''),'profiles-description'));
        const revoke=this.el('button','REMOVE PEER','action-btn danger');revoke.type='button';
        revoke.addEventListener('click',async()=>{
          if(!window.confirm('Remove VPN client '+(peer.description||peerSection)+'?'))return;
          revoke.disabled=true;
          try{
            await this.uci('delete',{config:'network',section:peerSection});
            await this.apply();await this.show();
          }catch(error){this.core.showToast(error.message,'error');revoke.disabled=false;}
        });
        line.append(revoke);peers.append(line);
      }
      const sectionTitle=this.el('h4','Remote clients');
      card.append(sectionTitle,peerForm,peers,remove);root.append(card);
    }
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
