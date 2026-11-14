// Native OpenWrt service administration. All operations use authenticated ubus UCI.
// Risky changes use rpcd's timed apply/confirm to recover on loss of connectivity.
const SERVICES = [
  ['mwan3','Multi-WAN & Failover','Routing','mwan3'],
  ['pbr','Policy-Based Routing','Routing','pbr'],
  ['network','Interfaces, VLANs & Routes','Routing','network'],
  ['firewall','Zones, NAT & Traffic Rules','Security','firewall'],
  ['upnpd','UPnP & Port Mapping (Raw Rules)','Network','upnpd'],
  ['banip','BanIP Threat Blocking','Security','banip'],
  ['acme','ACME Certificates','Security','acme'],
  ['dropbear','SSH Administration','Security','dropbear'],
  ['uhttpd','Web Interface & TLS','Security','uhttpd'],
  ['wireless','Wireless & Access Points','Network','wireless'],
  ['dhcp','DNS, DHCP & Hosts','Network','dhcp'],
  ['lldpd','LLDP Discovery','Network','lldpd'],
  ['sqm','Smart Queue Management','Network','sqm'],
  ['ddns','Dynamic DNS','Network','ddns'],
  ['smartdns','SmartDNS Resolver','Network','smartdns'],
  ['watchcat','Network Watchdog','Monitoring','watchcat'],
  ['vnstat','Long-Term Traffic History','Monitoring','vnstat'],
  ['irqbalance','CPU IRQ Balancing','System','irqbalance'],
  ['openvpn','OpenVPN Tunnels','Security','openvpn'],
  ['unbound','Unbound Recursive DNS','Network','unbound'],
  ['https-dns-proxy','Encrypted DNS Proxy','Network','https-dns-proxy'],
  ['nlbwmon','Bandwidth Accounting','Monitoring','nlbwmon'],
  ['luci_statistics','System Statistics','Monitoring','luci_statistics'],
  ['collectd','Collectd Monitoring','Monitoring','collectd'],
  ['snmpd','SNMP Monitoring','Monitoring','snmpd'],
  ['nut','UPS & Power Management','Services','nut'],
  ['samba4','SMB File Sharing','Services','samba4'],
  ['fstab','Storage & Mounts','Services','fstab'],
  ['system','Time, Logging & System','Services','system'],
  ['rpcd','RPC Service','Services','rpcd']
].map(([id,title,group,config])=>({id,title,group,config}));
const GROUPS=[
  {id:'network',name:'Network & Wi-Fi',group:'Network',description:'DNS, DHCP, wireless services, dynamic DNS and LAN optimization',primary:'#/network'},
  {id:'routing',name:'Internet & Routing',group:'Routing',description:'Interfaces, routing rules, Multi-WAN and failover',primary:'#/network/routes'},
  {id:'security',name:'Security & VPN',group:'Security',description:'Firewall policies, threat protection, certificates and VPN services',primary:'#/profiles'},
  {id:'monitoring',name:'Monitoring',group:'Monitoring',description:'Network history, metrics, watchdogs, SNMP and troubleshooting',primary:'#/network/diagnostics'},
  {id:'services',name:'Services & Storage',group:'Services',description:'File sharing, UPS services and additional local services',primary:'#/system/mounts'},
  {id:'system',name:'System Administration',group:'System',description:'System settings, service configuration and advanced administration',primary:'#/system'},
  {id:'additional',name:'Other Configurations',group:'Additional',description:'Less common installed UCI configuration files',primary:'#/advanced'}
];
const CURATED_CONFIGS=new Set(SERVICES.map(item=>item.config));
const SERVICE_RELOAD=Object.freeze({
  banip:'banip',acme:'acme',lldpd:'lldpd',sqm:'sqm',ddns:'ddns',
  nlbwmon:'nlbwmon',luci_statistics:'luci_statistics',collectd:'collectd',
  snmpd:'snmpd',nut:'nut',samba4:'samba4',smartdns:'smartdns',watchcat:'watchcat',vnstat:'vnstat',openvpn:'openvpn',unbound:'unbound','https-dns-proxy':'https-dns-proxy'
});
const SECRET = /password|passphrase|secret|token|private|key|credential|auth|community|cert|pem|salt|hash|cookie|psk/i;
const NETWORK_CRITICAL = new Set(['mwan3','pbr','network','firewall','wireless','dhcp','dropbear','uhttpd','rpcd']);
const sectionNameValid = value => /^[a-zA-Z0-9_@.\[\]-]{1,80}$/.test(value);
export default class AdvancedModule {
  constructor(core) {
    this.core=core;
    this.active=null;
    this.routeReady=false;
    this.discovered=false;
    this.availableConfigs=null;
    this.busy=false;
    this.core.registerRoute('/advanced',(_path,parts)=>this.show(parts[0]||'overview',parts[1]));
  }
  element(tag,cls,text) {
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=text;
    return el;
  }
  async discoverConfigs() {
    if(this.discovered)return;
    this.discovered=true;
    try{
      const {configs=[]}=await this.rpc('uci','configs',{});
      if(!Array.isArray(configs))return;
      this.availableConfigs=new Set(configs.filter(config=>typeof config==='string'));

      const known=new Set(SERVICES.map(s=>s.config));
      for(const name of configs){
        if(typeof name!=='string'||!/^[a-z][a-z0-9_-]{0,47}$/.test(name)||known.has(name))continue;
        known.add(name);
        SERVICES.push({id:name,title:name.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase()),
                       group:'Additional',config:name});
      }
      SERVICES.sort((a,b)=>a.group.localeCompare(b.group)||a.title.localeCompare(b.title));
    }catch(error){
      // The fixed curated service list remains usable if this account cannot enumerate UCI configs.
      console.warn('UCI discovery unavailable:',error.message);
    }
  }
  visibleServices(group) {
    const list=SERVICES.filter(item=>!this.availableConfigs||this.availableConfigs.has(item.config));
    return group?list.filter(item=>item.group===group):list;
  }
  async show(id,detail) {
    this.page=document.getElementById('advanced-page');
    if(!this.page)return;
    this.page.classList.remove('hidden');
    await this.discoverConfigs();
    if(!this.routeReady){this.routeReady=true;this.renderLinks();}
    this.active=null;
    if(id==='group'){
      const group=GROUPS.find(entry=>entry.id===detail);
      if(group){this.renderGroup(group);return;}
    }
    if(id==='overview'){this.overview();return;}
    const item=this.visibleServices().find(entry=>entry.id===id);
    if(!item){this.overview();return;}
    this.active=item;
    await this.load();
  }
  renderLinks() {
    const nav=this.page.querySelector('#advanced-links');
    if(!nav)return;
    nav.replaceChildren();
    const overview=this.element('a','action-btn','ALL CATEGORIES');
    overview.href='#/advanced';nav.appendChild(overview);
    for(const group of GROUPS) {
      const count=this.visibleServices(group.group).length;
      if(!count)continue;
      const link=this.element('a','action-btn',group.name);
      link.href='#/advanced/group/'+group.id;
      link.title=group.description;
      nav.appendChild(link);
    }
  }
  overview() {
    const pane=this.page.querySelector('#advanced-content');
    pane.replaceChildren(this.element('p','advanced-note','Choose the function you want to manage. Common everyday controls remain in Network, Security, Applications and System. The categories below provide access to native OpenWrt configuration files only where needed. Changes to connectivity-critical settings have a timed rollback.'));

    const shortcuts=this.element('div','advanced-shortcuts');
    for(const [label,route] of [['Network devices & DHCP','#/network/dhcp'],
      ['Firewall & NAT','#/network/firewall'],['Security profiles','#/profiles'],
      ['Applications','#/docker'],['Backups & firmware','#/system/backup']]){
      const link=this.element('a','action-btn',label);
      link.href=route;shortcuts.appendChild(link);
    }
    pane.appendChild(shortcuts);
    const grid=this.element('div','advanced-grid');
    for(const group of GROUPS) {
      const count=this.visibleServices(group.group).length;
      if(!count)continue;
      const card=this.element('a','advanced-card');
      card.href='#/advanced/group/'+group.id;
      card.append(this.element('small','',count+' installed configuration'+(count===1?'':'s')),
        this.element('h3','',group.name),
        this.element('p','',group.description));
      grid.appendChild(card);
    }
    if(!grid.childElementCount)pane.appendChild(this.element('p','advanced-note','No configuration files are available to this account.'));
    else pane.appendChild(grid);
  }
  renderGroup(group) {
    const pane=this.page.querySelector('#advanced-content');
    pane.replaceChildren();
    const heading=this.element('h3','',group.name);
    const description=this.element('p','advanced-note',group.description+'. Choose a tool for direct UCI configuration, or use the simplified controls in its primary workspace.');
    const toolbar=this.element('div','advanced-shortcuts');
    const back=this.element('a','action-btn','All categories');
    back.href='#/advanced';
    const primary=this.element('a','action-btn','Open main workspace');
    primary.href=group.primary;
    toolbar.append(back,primary);
    const grid=this.element('div','advanced-grid');
    for(const item of this.visibleServices(group.group)){
      const card=this.element('a','advanced-card');
      card.href='#/advanced/'+item.id;
      card.append(this.element('small','',item.group),
        this.element('h3','',item.title),
        this.element('p','','Manage /etc/config/'+item.config));
      grid.appendChild(card);
    }
    pane.append(heading,description,toolbar,grid);
  }

  async rpc(object,method,args={}) {
    const result=await this.core.ubusCall(object,method,args,{timeout:25000});
    if(!Array.isArray(result)||result[0]!==0)throw new Error(object+'.'+method+' failed'+(result?.[0]!==undefined?' (code '+result[0]+')':''));
    return result[1]||{};
  }
  async load() {
    const item=this.active,root=this.page.querySelector('#advanced-content');
    root.replaceChildren(this.element('h3','',item.title),this.element('p','advanced-note','Reading OpenWrt configuration…'));
    let data;
    try{data=await this.rpc('uci','get',{config:item.config});}
    catch(error){
      root.replaceChildren(this.element('h3','',item.title),
        this.element('p','advanced-note','Configuration unavailable. The corresponding service may not be installed, or this account lacks read permissions.'));
      return;
    }
    this.render(data.values||{});
  }
  render(values) {
    const item=this.active,root=this.page.querySelector('#advanced-content');
    root.replaceChildren(this.element('h3','',item.title));
    const hint=this.element('p','advanced-note','Editing /etc/config/'+item.config+'. Changes are staged first, then applied with a 60-second safety rollback for connectivity-critical configurations.');
    root.appendChild(hint);
    const toolbar=this.element('div','advanced-toolbar');
    const reload=this.element('button','action-btn','REFRESH');
    reload.type='button';reload.addEventListener('click',()=>this.load());
    const add=this.element('button','action-btn','ADD SECTION');
    add.type='button';add.addEventListener('click',()=>this.addSection());
    toolbar.append(reload,add);root.appendChild(toolbar);
    const sections=Object.entries(values).filter(([name,value])=>sectionNameValid(name)&&value&&typeof value==='object');
    if(!sections.length){root.appendChild(this.element('p','advanced-note','No sections configured. Use Add Section to create one.'));return;}
    for(const [name,options] of sections){
      const card=this.element('section','stat-card advanced-section');
      const heading=this.element('h4','',name+' ('+(options['.type']||'section')+')');
      card.appendChild(heading);
      const form=this.element('form','advanced-form');
      const fields=this.element('div','advanced-fields');
      for(const [key,val] of Object.entries(options)){
        if(key.startsWith('.')||typeof val==='object'&&!Array.isArray(val))continue;
        const field=this.element('label','advanced-field');
        const caption=this.element('span','',key);
        const secret=SECRET.test(key);
        const input=this.element(Array.isArray(val)||String(val).length>150?'textarea':'input','form-input');
        input.dataset.key=key;input.dataset.secret=secret?'true':'false';
        if(input.tagName==='INPUT')input.type=secret?'password':'text';
        if(secret){input.placeholder='Leave blank to keep existing value';input.autocomplete='new-password';}
        else input.value=Array.isArray(val)?val.join('\n'):String(val??'');
        input.dataset.original=secret?'':input.value;
        input.dataset.array=Array.isArray(val)?'true':'false';
        field.append(caption,input);fields.appendChild(field);
      }
      form.appendChild(fields);
      const buttons=this.element('div','advanced-toolbar');
      const save=this.element('button','action-btn','REVIEW & SAVE');
      save.type='submit';
      const option=this.element('button','action-btn','ADD OPTION');
      option.type='button';option.addEventListener('click',()=>this.addOption(item.config,name,options));
      const remove=this.element('button','action-btn danger','DELETE SECTION');
      remove.type='button';
      remove.addEventListener('click',()=>this.deleteSection(item.config,name));
      buttons.append(save,option,remove);form.appendChild(buttons);
      form.addEventListener('submit',event=>{event.preventDefault();this.saveSection(item.config,name,form);});
      card.appendChild(form);root.appendChild(card);
    }
  }
  async saveSection(config,section,form) {
    if(this.busy)return;
    const changes={};
    for(const input of form.querySelectorAll('[data-key]')){
      if(input.dataset.secret==='true'&&!input.value)continue;
      if(input.value===input.dataset.original)continue;
      const value=input.dataset.array==='true'?input.value.split('\n').map(s=>s.trim()).filter(Boolean):input.value;
      changes[input.dataset.key]=value;
    }
    if(!Object.keys(changes).length){this.core.showToast('Nothing changed');return;}
    const fields=Object.keys(changes).map(k=>SECRET.test(k)?k+' (hidden)':k).join(', ');
    const risky=(NETWORK_CRITICAL.has(config)||!CURATED_CONFIGS.has(config));
    if(!window.confirm('Update '+config+'.'+section+'?\nFields: '+fields+(risky?'\n\nConnectivity-critical: changes will revert unless the router confirms the new configuration within 60 seconds.':'')))return;
    this.busy=true;
    try {
      await this.rpc('uci','set',{config,section,values:changes});
      await this.apply(config,risky);
      this.core.showToast('Settings applied','success');
      await this.load();
    }catch(error){this.core.showToast('Could not apply settings: '+error.message,'error');}
    finally{this.busy=false;}
  }
  async apply(config,risky) {
    if(risky){
      await this.rpc('uci','apply',{rollback:true,timeout:60});
      // Wait for the reconfigured network to settle and verify reachability.
      // Never automatically confirm a potentially connectivity-breaking edit.
      await new Promise(resolve=>setTimeout(resolve,2500));
      try {
        await this.rpc('system','info',{});
        if(!window.confirm('The router is reachable after the change. Keep these settings?\n\nChoose Cancel to let the 60-second rollback restore the previous configuration.')) {
          throw new Error('Changes left unconfirmed. OpenWrt should restore the previous configuration after the rollback timeout.');
        }
        await this.rpc('uci','confirm',{});
      } catch(error) {
        throw new Error('Configuration not confirmed: '+error.message);
      }
    }else{
      await this.rpc('uci','commit',{config});
      const service=SERVICE_RELOAD[config];
      if(service){
        const [code,result]=await this.core.ubusCall('file','exec',
          {command:'/etc/init.d/'+service,params:['reload']},{timeout:30000});
        if(code!==0||result?.code!==0){
          throw new Error('Configuration saved, but '+service+' did not reload. Check System → Startup before retrying.');
        }
      }
    }
  }
  async addSection() {
    if(this.busy)return;
    const config=this.active.config;
    const type=window.prompt('UCI section type to create (for example: config, rule, interface):');
    if(type===null)return;
    if(!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(type)){this.core.showToast('Invalid section type','error');return;}
    const name=window.prompt('Optional named section (leave blank for automatic name):','');
    if(name===null)return;
    if(name && !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(name)){this.core.showToast('Invalid section name','error');return;}
    if(!window.confirm('Create a new '+type+' section in '+config+'?'))return;
    this.busy=true;
    try{
      await this.rpc('uci','add',{config,type,...(name?{name}:{})});
      await this.apply(config,(NETWORK_CRITICAL.has(config)||!CURATED_CONFIGS.has(config)));
      await this.load();
      this.core.showToast('Section created','success');
    }catch(e){this.core.showToast('Create failed: '+e.message,'error');}
    finally{this.busy=false;}
  }
  async addOption(config,section,knownOptions) {
    if(this.busy)return;
    const key=window.prompt('New UCI option name (letters, digits or underscores):');
    if(key===null)return;
    if(!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)||key.startsWith('.')){
      this.core.showToast('Invalid option name','error');return;
    }
    if(Object.prototype.hasOwnProperty.call(knownOptions,key)){
      this.core.showToast('This option already exists','error');return;
    }
    const type=window.prompt('Option type: enter "string" or "list"','string');
    if(type===null)return;
    if(type!=='string'&&type!=='list'){
      this.core.showToast('Use string or list','error');return;
    }
    const raw=window.prompt('Value'+(type==='list'?' (separate list values with commas)':''),'');
    if(raw===null)return;
    const value=type==='list'?raw.split(',').map(v=>v.trim()).filter(Boolean):raw;
    if(typeof value==='string'&&value.length>4096||Array.isArray(value)&&(value.length>32||value.some(x=>x.length>256))){
      this.core.showToast('Option value too long','error');return;
    }
    const risky=NETWORK_CRITICAL.has(config)||!CURATED_CONFIGS.has(config);
    if(!window.confirm('Add '+config+'.'+section+'.'+key+'?'+(risky?' Connectivity-critical changes will be rolled back unless confirmed.':'')))return;
    this.busy=true;
    try{
      await this.rpc('uci','set',{config,section,values:{[key]:value}});
      await this.apply(config,risky);
      await this.load();
      this.core.showToast('Option added','success');
    }catch(error){this.core.showToast('Option not applied: '+error.message,'error');}
    finally{this.busy=false;}
  }
  async deleteSection(config,section) {
    if(this.busy)return;
    if(!window.confirm('DELETE section '+config+'.'+section+'?\nThis can remove connectivity, firewall rules or service settings. A backup is recommended.'))return;
    if(!window.confirm('Final confirmation: remove '+section+'?'))return;
    this.busy=true;
    try{
      await this.rpc('uci','delete',{config,section});
      await this.apply(config,(NETWORK_CRITICAL.has(config)||!CURATED_CONFIGS.has(config)));
      await this.load();
      this.core.showToast('Section removed','success');
    }catch(e){this.core.showToast('Delete failed: '+e.message,'error');}
    finally{this.busy=false;}
  }
}

