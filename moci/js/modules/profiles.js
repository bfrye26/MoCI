// StartWRT-inspired native Security Profiles for preconfigured OpenWrt interfaces.
// This module does not provision VLANs or multi-PSK Wi-Fi: those require driver- and
// hardware-specific validation. It applies isolated firewall zones to existing networks.
const SLUG=/^[a-z][a-z0-9]{1,19}$/;
const ACTIVE=/^[a-z][a-z0-9_]{0,29}$/;
const UCI_TIMEOUT=65000;
export default class SecurityProfilesModule{
  constructor(core){
    this.core=core;
    this.busy=false;
    this.core.registerRoute('/profiles',()=>this.show());
  }
  make(tag,text,cls){
    const e=document.createElement(tag);
    if(text!==undefined)e.textContent=text;
    if(cls)e.className=cls;
    return e;
  }
  async call(obj,method,data={}){
    const [status,result]=await this.core.ubusCall(obj,method,data,{timeout:UCI_TIMEOUT});
    if(status!==0)throw new Error(obj+'.'+method+' rejected ('+status+')');
    return result||{};
  }
  async show(){
    this.page=document.getElementById('profiles-page');
    if(!this.page)return;
    this.page.classList.remove('hidden');
    const root=this.page.querySelector('#profiles-content');
    root.replaceChildren(this.make('p','Loading existing zones and interfaces…'));
    try{
      const [zones,interfaces]=await Promise.all([
        this.call('uci','get',{config:'firewall'}),
        this.call('uci','get',{config:'network'})
      ]);
      this.firewall=zones.values||{};
      this.network=interfaces.values||{};
      this.render();
    }catch(e){root.replaceChildren(this.make('p','Could not read networking policy: '+e.message));}
  }
  zoneNetwork(value){
    const n=value.network;
    return Array.isArray(n)?n:(typeof n==='string'?n.trim().split(/\s+/).filter(Boolean):[]);
  }
  render(){
    const root=this.page.querySelector('#profiles-content');
    root.replaceChildren();
    root.append(this.make('p','Security Profiles isolate an existing network interface using a dedicated firewall zone. Only DNS and DHCP access to the router are allowed by default. Internet forwarding must be explicitly selected.','profiles-description'));
    const zones=Object.entries(this.firewall).filter(([n,v])=>v?.['.type']==='zone');
    const used=new Set(zones.flatMap(([,v])=>this.zoneNetwork(v)));
    const interfaces=Object.entries(this.network)
      .filter(([n,v])=>ACTIVE.test(n)&&v?.['.type']==='interface'&&!['loopback','lan','wan','wan6'].includes(n));
    const form=this.make('form',undefined,'profiles-create');
    const label=this.make('label','Profile name','advanced-field');
    const name=this.make('input');name.type='text';name.required=true;name.minLength=2;name.maxLength=20;name.pattern='[a-z][a-z0-9]{1,19}';name.placeholder='guest';
    label.append(name);form.append(label);
    const interfaceLabel=this.make('label','Existing isolated network interface','advanced-field');
    const select=this.make('select');select.required=true;
    for(const [key] of interfaces){
      const opt=this.make('option',key);opt.value=key;
      if(used.has(key))opt.disabled=true;
      select.appendChild(opt);
    }
    interfaceLabel.append(select);form.append(interfaceLabel);
    const internet=this.make('label',undefined,'profiles-check');
    const checkbox=this.make('input');checkbox.type='checkbox';
    internet.append(checkbox,this.make('span','Permit Internet forwarding through WAN (default: isolated)'));
    form.appendChild(internet);
    const note=this.make('p','Create the interface, bridge VLAN, IP subnet and DHCP pool first using Network or Advanced. Never assign the management LAN to an isolated profile.','profiles-description');
    form.appendChild(note);
    const add=this.make('button','CREATE ISOLATED PROFILE','action-btn');
    add.type='submit';
    add.disabled=!interfaces.some(([key])=>!used.has(key));
    form.appendChild(add);
    form.addEventListener('submit',e=>{e.preventDefault();this.create(name.value,select.value,checkbox.checked);});
    root.append(this.make('h3','New security profile'),form);
    const current=this.make('div',undefined,'profiles-list');
    const managed=zones.filter(([n,v])=>n.startsWith('moci_zone_')&&v.name?.startsWith('moci_'));
    current.append(this.make('h3','Managed security profiles'));
    if(!managed.length)current.append(this.make('p','No managed profiles configured.','profiles-description'));
    for(const [section,zone] of managed){
      const name=zone.name.replace(/^moci_/,'');
      const panel=this.make('section',undefined,'stat-card profiles-entry');
      const title=this.make('strong',name+' · '+this.zoneNetwork(zone).join(', '));
      const traffic=Object.values(this.firewall).some(v=>v?.['.type']==='forwarding'&&v.src===zone.name&&v.dest==='wan');
      const status=this.make('p',traffic?'Internet forwarding enabled':'Isolated from WAN','profiles-description');
      const remove=this.make('button','REMOVE PROFILE','action-btn danger');remove.type='button';
      remove.addEventListener('click',()=>this.remove(name,section));
      panel.append(title,status,remove);current.append(panel);
    }
    root.append(current);
  }
  async set(config,section,values){await this.call('uci','set',{config,section,values});}
  async add(type,name){await this.call('uci','add',{config:'firewall',type,name});}
  async apply(){
    await this.call('uci','apply',{rollback:true,timeout:60});
    await new Promise(resolve=>setTimeout(resolve,2500));
    await this.call('system','info',{});
    if(!window.confirm('Router connectivity is still available. Keep the firewall change?\nChoose Cancel to let OpenWrt revert it.')){
      throw new Error('Change not confirmed. Automatic rollback is expected after 60 seconds.');
    }
    await this.call('uci','confirm',{});
  }
  async create(name,iface,internet){
    if(this.busy)return;
    if(!SLUG.test(name)||!ACTIVE.test(iface)||['lan','wan','wan6','loopback'].includes(iface)){
      this.core.showToast('Invalid profile or interface name','error');return;
    }
    const zone='moci_'+name;
    if(Object.values(this.firewall).some(v=>v?.['.type']==='zone'&&(v.name===zone||this.zoneNetwork(v).includes(iface)))){
      this.core.showToast('Interface already assigned to a firewall zone','error');return;
    }
    if(!this.network[iface]||this.network[iface]['.type']!=='interface'){
      this.core.showToast('Network interface does not exist','error');return;
    }
    if(!window.confirm('Create '+name+' for interface '+iface+'?\nRouter access from this interface will be REJECTED except for DNS and DHCP. Internet access: '+(internet?'Yes':'No')+'\nAn automatic rollback protects connectivity.'))return;
    this.busy=true;
    try{
      const zoneSection='moci_zone_'+name;
      await this.add('zone',zoneSection);
      await this.set('firewall',zoneSection,{name:zone,network:[iface],input:'REJECT',output:'ACCEPT',forward:'REJECT'});
      for(const [suffix,proto,port] of [['dns','tcp udp','53'],['dhcp','udp','67']]){
        const section='moci_'+name+'_'+suffix;
        await this.add('rule',section);
        await this.set('firewall',section,{name:'MoCI '+name+' '+suffix,src:zone,proto,dest_port:port,target:'ACCEPT'});
      }
      if(internet){
        const section='moci_'+name+'_wan';
        await this.add('forwarding',section);
        await this.set('firewall',section,{src:zone,dest:'wan'});
      }
      await this.apply();
      this.core.showToast('Profile created','success');await this.show();
    }catch(e){this.core.showToast('Profile not confirmed: '+e.message,'error');}
    finally{this.busy=false;}
  }
  async remove(name,section){
    if(this.busy||!SLUG.test(name))return;
    if(!window.confirm('Delete security profile '+name+' and its MoCI-owned firewall rules? Network interfaces and DHCP configuration will be preserved.'))return;
    if(!window.confirm('Confirm removal of '+name+' firewall isolation?'))return;
    this.busy=true;
    try{
      for(const key of [section,'moci_'+name+'_dns','moci_'+name+'_dhcp','moci_'+name+'_wan']){
        if(this.firewall[key])await this.call('uci','delete',{config:'firewall',section:key});
      }
      await this.apply();
      this.core.showToast('Profile removed','success');await this.show();
    }catch(e){this.core.showToast('Removal not confirmed: '+e.message,'error');}
    finally{this.busy=false;}
  }
}
