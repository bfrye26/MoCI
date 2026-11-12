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
      const [zones,interfaces,dhcp]=await Promise.all([
        this.call('uci','get',{config:'firewall'}),
        this.call('uci','get',{config:'network'}),
        this.call('uci','get',{config:'dhcp'})
      ]);
      this.firewall=zones.values||{};
      this.network=interfaces.values||{};
      this.dhcp=dhcp.values||{};
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
      const allowForm=this.make('form',undefined,'profiles-allow-form');
      const destInput=this.make('input');
      destInput.placeholder='LAN device IPv4 (e.g. 192.168.50.100)';
      destInput.required=true;destInput.maxLength=15;destInput.setAttribute('aria-label','Destination LAN device IPv4');
      const portInput=this.make('input');portInput.type='number';portInput.min='1';portInput.max='65535';
      portInput.placeholder='443';portInput.value='443';portInput.required=true;
      portInput.setAttribute('aria-label','Destination TCP/UDP port');
      const labelInput=this.make('input');labelInput.placeholder='Rule label (e.g. documents)';
      labelInput.pattern='[a-z][a-z0-9]{1,19}';labelInput.maxLength=20;labelInput.required=true;
      labelInput.setAttribute('aria-label','Rule identifier');
      const grant=this.make('button','ALLOW DEVICE','action-btn');grant.type='submit';
      allowForm.append(labelInput,destInput,portInput,grant);
      allowForm.addEventListener('submit',e=>{
        e.preventDefault();
        this.allowLanDevice(name,zone.name,labelInput.value,destInput.value,portInput.value);
      });
      const grants=this.make('div',undefined,'profiles-grants');
      for(const [id,rule] of Object.entries(this.firewall)){
        if(!id.startsWith('moci_allow_'+name+'_')||rule['.type']!=='rule')continue;
        const line=this.make('div',undefined,'profiles-entry');
        line.append(this.make('span',rule.dest_ip+':'+(rule.dest_port||'all')+' · '+rule.name));
        const revoke=this.make('button','REVOKE','action-btn danger');
        revoke.type='button';
        revoke.addEventListener('click',()=>this.revokeLanDevice(id));
        line.append(revoke);grants.append(line);
      }
      const interfaceName=this.zoneNetwork(zone)[0]||'';
      const dhcpSection=Object.entries(this.dhcp||{}).find(([id,entry])=>
        entry['.type']==='dhcp'&&(id===interfaceName||entry.interface===interfaceName));
      const dnsSection=this.make('div',undefined,'profiles-dns');
      dnsSection.append(this.make('h4','Profile DNS resolver'));
      if(dhcpSection){
        const [dhcpName,dhcpConfig]=dhcpSection;
        const options=Array.isArray(dhcpConfig.dhcp_option)?dhcpConfig.dhcp_option:
          typeof dhcpConfig.dhcp_option==='string'?[dhcpConfig.dhcp_option]:[];
        const current=options.find(x=>String(x).startsWith('6,'))||'';
        const dnsForm=this.make('form',undefined,'profiles-allow-form');
        const resolver=this.make('input');
        resolver.placeholder='Router default or DNS IPv4';
        resolver.value=current.replace(/^6,/,'');
        resolver.setAttribute('aria-label','Optional profile DNS resolver IPv4');
        const saveResolver=this.make('button','SAVE DNS','action-btn');
        saveResolver.type='submit';
        dnsForm.append(resolver,saveResolver);
        dnsForm.addEventListener('submit',e=>{
          e.preventDefault();
          this.setProfileDns(name,dhcpName,resolver.value.trim(),options);
        });
        dnsSection.append(this.make('p','Leave blank to use the router default resolver. An external resolver may bypass the router’s DNS filtering.','profiles-description'),dnsForm);
      }else{
        dnsSection.append(this.make('p','Create a DHCP pool for interface '+interfaceName+
          ' before setting profile-specific DNS.','profiles-description'));
      }
      const subhead=this.make('h4','Allowed LAN services');
      const quietTitle=this.make('h4','Profile quiet hours (block forwarded Internet traffic)');
      const quietForm=this.make('form',undefined,'profiles-allow-form');
      const start=this.make('input');start.type='time';start.value='22:00';start.required=true;
      start.setAttribute('aria-label','Quiet hours start');
      const end=this.make('input');end.type='time';end.value='07:00';end.required=true;
      end.setAttribute('aria-label','Quiet hours end');
      const days=this.make('fieldset',undefined,'schedule-days');
      days.append(this.make('legend','Quiet-hour start days'));
      const choices=[];
      for(const [index,day] of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].entries()){
        const wrap=this.make('label',undefined,'profiles-check');
        const input=this.make('input');input.type='checkbox';input.checked=true;
        choices.push([index,input]);
        wrap.append(input,this.make('span',day));days.append(wrap);
      }
      const block=this.make('button','SAVE QUIET HOURS','action-btn');block.type='submit';
      const forwards=Object.values(this.firewall).filter(v=>v?.['.type']==='forwarding'&&v.src===zone.name);
      block.disabled=!forwards.length;
      quietForm.append(start,end,days,block);
      quietForm.addEventListener('submit',event=>{
        event.preventDefault();
        this.setQuietHours(name,zone.name,start.value,end.value,choices.filter(([,c])=>c.checked).map(([n])=>n));
      });
      const activeQuiet=Object.entries(this.firewall).filter(([id,v])=>id.startsWith('moci_q_'+name+'_')&&v?.['.type']==='rule');
      const clear=this.make('button','CLEAR QUIET HOURS','action-btn danger');clear.type='button';
      clear.disabled=!activeQuiet.length;
      clear.addEventListener('click',()=>this.clearQuietHours(name));
      const quietStatus=this.make('p',activeQuiet.length?'Quiet-hour rules active: '+activeQuiet.length:
        forwards.length?'No quiet-hour restrictions':'Internet forwarding is not enabled for this profile',
        'profiles-description');
      panel.append(title,status,dnsSection,subhead,allowForm,grants,quietTitle,quietStatus,quietForm,clear,remove);current.append(panel);
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
  privateIPv4(ip){
    const parts=String(ip).split('.');
    if(parts.length!==4||!parts.every(n=>/^\d{1,3}$/.test(n)&&Number(n)<=255))return false;
    const a=parts.map(Number);
    return a[0]===10||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168);
  }
  async allowLanDevice(profile,zone,label,ip,port){
    if(this.busy||!SLUG.test(profile)||!SLUG.test(label)||!this.privateIPv4(ip)
      ||!/^\d{1,5}$/.test(String(port))||Number(port)<1||Number(port)>65535){
      this.core.showToast('Invalid LAN rule. Use a private IP, valid label and TCP/UDP port.','error');return;
    }
    const id='moci_allow_'+profile+'_'+label;
    if(this.firewall[id]){
      this.core.showToast('LAN access rule already exists','error');return;
    }
    if(!window.confirm('Allow the '+profile+' security profile to connect to '+ip+':'+port+' on the LAN?'))return;
    this.busy=true;
    try{
      await this.add('rule',id);
      await this.set('firewall',id,{name:'MoCI '+profile+' '+label,src:zone,dest:'lan',
        dest_ip:ip,dest_port:String(port),proto:'tcp udp',target:'ACCEPT'});
      await this.apply();
      this.core.showToast('Allowed LAN device added','success');await this.show();
    }catch(e){this.core.showToast('Access change not confirmed: '+e.message,'error');}
    finally{this.busy=false;}
  }
  async revokeLanDevice(id){
    if(this.busy||!/^moci_allow_[a-z0-9_]{1,55}$/.test(id)||!this.firewall[id])return;
    if(!window.confirm('Revoke this LAN access exception?'))return;
    this.busy=true;
    try{
      await this.call('uci','delete',{config:'firewall',section:id});
      await this.apply();
      this.core.showToast('LAN exception removed','success');await this.show();
    }catch(e){this.core.showToast('Access change failed: '+e.message,'error');}
    finally{this.busy=false;}
  }
  async setProfileDns(profile,section,resolver,previous){
    if(this.busy||!SLUG.test(profile)||!this.dhcp?.[section])return;
    if(resolver&&!this.privateIPv4(resolver)&&!/^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(resolver)){
      this.core.showToast('Use a valid IPv4 DNS resolver','error');return;
    }
    if(resolver){
      const octets=resolver.split('.').map(Number);
      if(octets.some(x=>x>255)||octets[0]===0||octets[0]>=224||octets[3]===0||octets[3]===255){
        this.core.showToast('Invalid DNS address','error');return;
      }
    }
    const configured=previous.filter(x=>typeof x==='string'&&!x.startsWith('6,'));
    if(resolver)configured.push('6,'+resolver);
    if(!window.confirm('Change the DNS server advertised to devices in '+profile+
      ' to '+(resolver||'router default')+'? Some devices will need to renew their DHCP lease.'))return;
    this.busy=true;
    try{
      await this.call('uci','set',{config:'dhcp',section,values:{dhcp_option:configured}});
      await this.apply();
      this.core.showToast('Profile DNS settings saved','success');
      await this.show();
    }catch(e){this.core.showToast('DNS setting not confirmed: '+e.message,'error');}
    finally{this.busy=false;}
  }
  async clearQuietHours(profile){
    if(this.busy||!SLUG.test(profile))return;
    const rules=Object.keys(this.firewall).filter(id=>id.startsWith('moci_q_'+profile+'_'));
    if(!rules.length)return;
    if(!window.confirm('Remove all quiet-hour restrictions from '+profile+'?'))return;
    this.busy=true;
    try{
      for(const section of rules)await this.call('uci','delete',{config:'firewall',section});
      await this.apply();
      this.core.showToast('Quiet hours cleared','success');await this.show();
    }catch(e){this.core.showToast('Unable to clear quiet hours: '+e.message,'error');}
    finally{this.busy=false;}
  }
  async setQuietHours(profile,zone,start,end,days){
    if(this.busy||!SLUG.test(profile)||!/^moci_[a-z0-9]{2,20}$/.test(zone)||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||
      start===end||!Array.isArray(days)||!days.length||days.some(d=>!Number.isInteger(d)||d<0||d>6)){
      this.core.showToast('Invalid quiet hours or weekday selection','error');return;
    }
    const forwards=Object.values(this.firewall).filter(v=>v?.['.type']==='forwarding'&&v.src===zone);
    const destinations=[...new Set(forwards.map(v=>v.dest).filter(Boolean))];
    if(!destinations.length||destinations.length>4){
      this.core.showToast('Profile needs one to four explicit forwarding destinations','error');return;
    }
    if(!window.confirm('Block '+profile+' Internet forwarding between '+start+' and '+end+
      ' on selected weekdays? Rule changes roll back unless you confirm.'))return;
    const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const weekdayString=list=>list.map(d=>names[d]).join(' ');
    const ranges=[];
    if(start<end){
      ranges.push([start+':00',end+':00',weekdayString(days)]);
    }else{
      ranges.push([start+':00','23:59:59',weekdayString(days)]);
      ranges.push(['00:00:00',end+':00',weekdayString(days.map(d=>(d+1)%7))]);
    }
    this.busy=true;
    try{
      const old=Object.keys(this.firewall).filter(id=>id.startsWith('moci_q_'+profile+'_'));
      for(const id of old)await this.call('uci','delete',{config:'firewall',section:id});
      let count=0;
      for(const dest of destinations){
        for(const [from,to,weekdays] of ranges){
          const id='moci_q_'+profile+'_'+count++;
          await this.add('rule',id);
          await this.set('firewall',id,{name:'MoCI '+profile+' quiet '+count,src:zone,dest,
            proto:'all',start_time:from,stop_time:to,weekdays,utc_time:'0',target:'REJECT'});
        }
      }
      await this.apply();
      this.core.showToast('Quiet hours applied','success');await this.show();
    }catch(e){this.core.showToast('Quiet hours were not confirmed: '+e.message,'error');}
    finally{this.busy=false;}
  }
  async remove(name,section){
    if(this.busy||!SLUG.test(name))return;
    if(!window.confirm('Delete security profile '+name+' and its MoCI-owned firewall rules? Network interfaces and DHCP configuration will be preserved.'))return;
    if(!window.confirm('Confirm removal of '+name+' firewall isolation?'))return;
    this.busy=true;
    try{
      const ownedRules=Object.keys(this.firewall).filter(key=>key.startsWith('moci_allow_'+name+'_')||key.startsWith('moci_q_'+name+'_'));
      for(const key of [section,'moci_'+name+'_dns','moci_'+name+'_dhcp','moci_'+name+'_wan',...ownedRules]){
        if(this.firewall[key])await this.call('uci','delete',{config:'firewall',section:key});
      }
      await this.apply();
      this.core.showToast('Profile removed','success');await this.show();
    }catch(e){this.core.showToast('Removal not confirmed: '+e.message,'error');}
    finally{this.busy=false;}
  }
}
