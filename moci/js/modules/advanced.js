// Native OpenWrt service administration. All operations use authenticated ubus UCI.
// Risky changes use rpcd's timed apply/confirm to recover on loss of connectivity.
const SERVICES = [
  ['mwan3','Multi-WAN & Failover','Routing','mwan3'],
  ['pbr','Policy-Based Routing','Routing','pbr'],
  ['network','Interfaces, VLANs & Routes','Routing','network'],
  ['firewall','Zones, NAT & Traffic Rules','Security','firewall'],
  ['banip','BanIP Threat Blocking','Security','banip'],
  ['acme','ACME Certificates','Security','acme'],
  ['dropbear','SSH Administration','Security','dropbear'],
  ['uhttpd','Web Interface & TLS','Security','uhttpd'],
  ['wireless','Wireless & Access Points','Network','wireless'],
  ['dhcp','DNS, DHCP & Hosts','Network','dhcp'],
  ['lldpd','LLDP Discovery','Network','lldpd'],
  ['sqm','Smart Queue Management','Network','sqm'],
  ['ddns','Dynamic DNS','Network','ddns'],
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
const SECRET = /password|passphrase|secret|token|private|key|credential|auth|community|cert|pem|salt|hash|cookie|psk/i;
const NETWORK_CRITICAL = new Set(['mwan3','pbr','network','firewall','wireless','dhcp','dropbear','uhttpd','rpcd']);
const sectionNameValid = value => /^[a-zA-Z0-9_@.\[\]-]{1,80}$/.test(value);
export default class AdvancedModule {
  constructor(core) {
    this.core=core;
    this.active=null;
    this.routeReady=false;
    this.discovered=false;
    this.busy=false;
    this.core.registerRoute('/advanced',(_path,parts)=>this.show(parts[0]||'overview'));
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
  async show(id) {
    this.page=document.getElementById('advanced-page');
    if(!this.page)return;
    this.page.classList.remove('hidden');
    await this.discoverConfigs();
    if(!this.routeReady) {this.routeReady=true;this.renderLinks();}
    const item=SERVICES.find(s=>s.id===id);
    if(!item) {this.active=null;this.overview();return;}
    this.active=item;
    await this.load();
  }
  renderLinks() {
    const nav=this.page.querySelector('#advanced-links');
    nav.replaceChildren();
    const overview=this.element('a','action-btn','OVERVIEW');
    overview.href='#/advanced';nav.appendChild(overview);
    for(const item of SERVICES){
      const link=this.element('a','action-btn',item.title);
      link.href='#/advanced/'+item.id;
      nav.appendChild(link);
    }
  }
  overview() {
    const pane=this.page.querySelector('#advanced-content');
    pane.replaceChildren(this.element('p','advanced-note','Native OpenWrt configuration. Select a service to inspect, edit, add, or remove UCI sections. Review the confirmation and timed rollback before applying connection-critical settings.'));
    const grid=this.element('div','advanced-grid');
    for(const item of SERVICES){
      const card=this.element('a','advanced-card');
      card.href='#/advanced/'+item.id;
      card.append(this.element('small','',item.group),this.element('h3','',item.title),
        this.element('p','','View and manage /etc/config/'+item.config));
      grid.appendChild(card);
    }
    pane.appendChild(grid);
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
      const remove=this.element('button','action-btn danger','DELETE SECTION');
      remove.type='button';
      remove.addEventListener('click',()=>this.deleteSection(item.config,name));
      buttons.append(save,remove);form.appendChild(buttons);
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
    const risky=NETWORK_CRITICAL.has(config);
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
      await this.apply(config,NETWORK_CRITICAL.has(config));
      await this.load();
      this.core.showToast('Section created','success');
    }catch(e){this.core.showToast('Create failed: '+e.message,'error');}
    finally{this.busy=false;}
  }
  async deleteSection(config,section) {
    if(this.busy)return;
    if(!window.confirm('DELETE section '+config+'.'+section+'?\nThis can remove connectivity, firewall rules or service settings. A backup is recommended.'))return;
    if(!window.confirm('Final confirmation: remove '+section+'?'))return;
    this.busy=true;
    try{
      await this.rpc('uci','delete',{config,section});
      await this.apply(config,NETWORK_CRITICAL.has(config));
      await this.load();
      this.core.showToast('Section removed','success');
    }catch(e){this.core.showToast('Delete failed: '+e.message,'error');}
    finally{this.busy=false;}
  }
}
