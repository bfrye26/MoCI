// Native per-physical-Ethernet port security profiles for x86 router hardware.
// Only unassigned NICs may be adopted; WAN and management-bridge ports cannot
// be reassigned here. Changes are staged and protected by UCI timed rollback.
const NIC=/^[a-zA-Z][a-zA-Z0-9_.:-]{0,29}$/;
const SLUG=/^[a-z][a-z0-9]{1,19}$/;
function privateIPv4(value){
  const parts=String(value).split('.');
  if(parts.length!==4||!parts.every(n=>/^\d{1,3}$/.test(n)&&Number(n)<=255))return false;
  const nums=parts.map(Number);
  return nums[3]>0&&nums[3]<255&&(nums[0]===10||
    nums[0]===172&&nums[1]>=16&&nums[1]<=31||
    nums[0]===192&&nums[1]===168);
}
export default class EthernetProfilesModule{
  constructor(core){
    this.core=core;this.busy=false;
    this.core.registerRoute('/ethernet-profiles',()=>this.show());
  }
  el(tag,text,cls){
    const element=document.createElement(tag);
    if(text!==undefined)element.textContent=text;
    if(cls)element.className=cls;
    return element;
  }
  async rpc(object,method,args={}){
    const [status,result]=await this.core.ubusCall(object,method,args,{timeout:65000});
    if(status!==0)throw new Error(object+'.'+method+' failed ('+status+')');
    return result||{};
  }
  async uci(method,args){return this.rpc('uci',method,args);}
  async show(){
    this.page=document.getElementById('ethernet-profiles-page');
    this.page?.classList.remove('hidden');
    this.root=this.page?.querySelector('#ethernet-profiles-content');
    if(!this.root)return;
    this.root.replaceChildren(this.el('p','Discovering physical Ethernet ports and management networks…'));
    try{
      const [network,dhcp,firewall,ports]=await Promise.all([
        this.uci('get',{config:'network'}),this.uci('get',{config:'dhcp'}),
        this.uci('get',{config:'firewall'}),this.rpc('moci','getPorts')
      ]);
      this.network=network.values||{};
      this.dhcp=dhcp.values||{};
      this.firewall=firewall.values||{};
      this.ports=Array.isArray(ports.ports)?ports.ports.filter(p=>NIC.test(p)):[];
      this.render();
    }catch(e){this.root.replaceChildren(this.el('p','Unable to enumerate Ethernet ports: '+e.message,'profiles-description'));}
  }
  allReservedPorts(){
    const reserved=new Set();
    let lanPorts=[];
    for(const item of Object.values(this.network)){
      if(item?.['.type']==='device'&&item.type==='bridge'&&item.name==='br-lan'){
        lanPorts=Array.isArray(item.ports)?item.ports:String(item.ports||'').split(/\s+/).filter(Boolean);
      }
      // WAN uplinks and ports already owned by a profile stay reserved.
      if(item?.['.type']==='interface'&&NIC.test(item.device||'')){
        reserved.add(item.device);
      }
    }
    // Other LAN-bridge ports may be reclaimed into an isolated port profile, but
    // always keep at least one port in br-lan so management stays reachable.
    if(lanPorts.length===1)reserved.add(lanPorts[0]);
    return reserved;
  }
  async removeFromBridge(dev){
    for(const [section,item] of Object.entries(this.network)){
      if(item?.['.type']==='device'&&item.type==='bridge'&&item.name==='br-lan'){
        const ports=(Array.isArray(item.ports)?item.ports:String(item.ports||'').split(/\s+/)).filter(p=>p&&p!==dev);
        await this.set('network',section,{ports});
        return;
      }
    }
  }
  async set(config,section,values){return this.uci('set',{config,section,values});}
  async add(config,type,name){return this.uci('add',{config,type,name});}
  async apply(){
    await this.uci('apply',{rollback:true,timeout:60});
    await new Promise(resolve=>setTimeout(resolve,2500));
    await this.rpc('system','info');
    if(!window.confirm('Router connectivity is still available. Keep these Ethernet changes?\nCancel to let the 60-second rollback restore earlier settings.')){
      throw new Error('Network edits were not confirmed. Rollback is expected.');
    }
    await this.uci('confirm',{});
  }
  labeled(text,input){
    const field=this.el('label',text,'advanced-field');field.append(input);return field;
  }
  render(){
    const root=this.root;root.replaceChildren();
    root.append(this.el('p','Give a physical Ethernet port its own private subnet, DHCP service and isolated firewall zone. The WAN uplink is reserved, and the last remaining LAN port stays in the management bridge; any other LAN port can be reclaimed into a profile (it is removed from the LAN bridge).','profiles-description'));
    const reserved=this.allReservedPorts();
    const free=this.ports.filter(port=>!reserved.has(port));
    const owned=Object.entries(this.network).filter(([name,value])=>
      name.startsWith('moci_')&&value?.['.type']==='interface'&&value.proto==='static'&&value.moci_port_profile==='1'&&NIC.test(value.device||''));
    const usedInterfaces=new Set(owned.map(([,v])=>v.device));
    const form=this.el('form',undefined,'profiles-create');
    const name=this.el('input');name.required=true;name.placeholder='office';name.pattern='[a-z][a-z0-9]{1,19}';name.maxLength=20;
    const port=this.el('select');port.required=true;
    for(const nic of free){
      const choice=this.el('option',nic);choice.value=nic;port.append(choice);
    }
    const ip=this.el('input');ip.required=true;ip.placeholder='192.168.60.1';ip.maxLength=15;
    const internet=this.el('input');internet.type='checkbox';
    const internetLabel=this.el('label',undefined,'profiles-check');
    internetLabel.append(internet,this.el('span','Allow internet access via WAN (default: isolated)'));
    form.append(this.labeled('Profile name',name),this.labeled('Physical Ethernet port',port),
      this.labeled('LAN gateway IPv4 (/24)',ip),internetLabel);
    form.append(this.el('p','Check the physical port and cable before saving. The WAN uplink and the last management LAN port are reserved. Each profile gets 192.168.x.100–249 DHCP addresses in its selected /24 subnet.','profiles-description'));
    const button=this.el('button','CREATE PORT PROFILE','action-btn');
    button.type='submit';button.disabled=!free.length;form.append(button);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(this.busy)return;
      const label=name.value.trim().toLowerCase(),dev=port.value,addr=ip.value.trim();
      if(!SLUG.test(label)||!free.includes(dev)||!privateIPv4(addr)){
        this.core.showToast('Invalid profile name, port or private IP','error');return;
      }
      if(!addr.endsWith('.1')){
        this.core.showToast('Use the .1 address of a private /24 subnet to avoid DHCP conflicts','error');return;
      }
      const logical='moci_'+label;
      if(this.network[logical]||this.dhcp[logical]||this.firewall['moci_zone_'+label]){
        this.core.showToast('Profile already exists','error');return;
      }
      const conflict=Object.values(this.network).some(v=>v?.['.type']==='interface'&&
        typeof v.ipaddr==='string'&&v.ipaddr.split('.').slice(0,3).join('.')===addr.split('.').slice(0,3).join('.'));
      if(conflict){this.core.showToast('Subnet overlaps another interface','error');return;}
      const inLan=Object.values(this.network).some(v=>v?.['.type']==='device'&&v.type==='bridge'&&v.name==='br-lan'&&
        (Array.isArray(v.ports)?v.ports:String(v.ports||'').split(/\s+/)).includes(dev));
      const lanNote=inLan?'\n\n'+dev+' is currently a LAN port: it will be removed from the LAN bridge. If it is the port you are connected through, you will be disconnected and the change will roll back automatically.':'';
      if(!window.confirm('Assign '+dev+' to '+logical+' at '+addr+'/24 with DHCP and '+(internet.checked?'WAN forwarding':'no WAN forwarding')+'? This changes routing and firewall rules.'+lanNote))return;
      this.busy=true;button.disabled=true;
      try{
        if(inLan)await this.removeFromBridge(dev);
        await this.add('network','interface',logical);
        await this.set('network',logical,{proto:'static',device:dev,ipaddr:addr,netmask:'255.255.255.0',moci_port_profile:'1'});
        await this.add('dhcp','dhcp',logical);
        await this.set('dhcp',logical,{interface:logical,start:'100',limit:'150',leasetime:'12h',ignore:'0'});
        const zone='moci_zone_'+label;
        await this.add('firewall','zone',zone);
        await this.set('firewall',zone,{name:logical,network:[logical],input:'REJECT',output:'ACCEPT',forward:'REJECT'});
        for(const [suffix,proto,dest] of [['dns','tcp udp','53'],['dhcp','udp','67']]){
          const section='moci_'+label+'_'+suffix;
          await this.add('firewall','rule',section);
          await this.set('firewall',section,{name:'MoCI '+label+' '+suffix,src:logical,proto,dest_port:dest,target:'ACCEPT'});
        }
        if(internet.checked){
          const section='moci_'+label+'_wan';
          await this.add('firewall','forwarding',section);
          await this.set('firewall',section,{src:logical,dest:'wan'});
        }
        await this.apply();
        this.core.showToast('Ethernet profile created','success');await this.show();
      }catch(e){this.core.showToast('Port assignment not confirmed: '+e.message,'error');}
      finally{this.busy=false;button.disabled=false;}
    });
    root.append(this.el('h3','Assign unused Ethernet port'),form);
    if(!free.length)root.append(this.el('p','No Ethernet port is available to assign. The WAN uplink and the last management LAN port are reserved for safety; add more physical ports to create additional profiles.','profiles-description'));
    root.append(this.el('h3','Managed Ethernet port profiles'));
    if(!owned.length)root.append(this.el('p','No per-port profiles configured.','profiles-description'));
    for(const [section,value] of owned){
      const label=section.replace(/^moci_/,'');
      if(!SLUG.test(label))continue;
      const card=this.el('article',undefined,'stat-card profiles-entry');
      card.append(this.el('strong',section+' · '+value.device),
        this.el('p',value.ipaddr+'/24','profiles-description'));
      const remove=this.el('button','REMOVE PROFILE','action-btn danger');remove.type='button';
      remove.addEventListener('click',async()=>{
        if(this.busy||!window.confirm('Delete '+section+' and its DHCP/firewall configuration? Devices on '+value.device+' will disconnect.'))return;
        if(!window.confirm('Confirm deletion of isolated Ethernet network '+section+'?'))return;
        this.busy=true;remove.disabled=true;
        try{
          for(const [config,names] of [
            ['firewall',['moci_zone_'+label,'moci_'+label+'_dns','moci_'+label+'_dhcp','moci_'+label+'_wan']],
            ['dhcp',[section]],['network',[section]]]){
            for(const id of names){
              const source={network:this.network,firewall:this.firewall,dhcp:this.dhcp}[config];
              if(source[id])await this.uci('delete',{config,section:id});
            }
          }
          await this.apply();
          this.core.showToast('Ethernet profile removed','success');await this.show();
        }catch(e){this.core.showToast('Port release not confirmed: '+e.message,'error');remove.disabled=false;}
        finally{this.busy=false;}
      });
      card.append(remove);root.append(card);
    }
  }
}

