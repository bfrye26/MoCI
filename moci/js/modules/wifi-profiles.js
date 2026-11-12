// StartWRT-inspired multi-password wireless access using OpenWrt's native
// wifi-station and wifi-vlan UCI sections (hostapd PPSK / dynamic VLAN).
// Requires a full wpad/hostapd build and an existing isolated network/profile.
const SLUG=/^[a-z][a-z0-9-]{1,23}$/;
const AP=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export default class WifiProfilesModule{
  constructor(core){
    this.core=core;
    this.busy=false;
    this.core.registerRoute('/wifi-profiles',()=>this.show());
  }
  elem(tag,text,cls){
    const e=document.createElement(tag);
    if(text!==undefined)e.textContent=text;
    if(cls)e.className=cls;
    return e;
  }
  async uci(method,args){
    const [code,result]=await this.core.ubusCall('uci',method,args,{timeout:65000});
    if(code!==0)throw new Error('UCI '+method+' failed ('+code+')');
    return result||{};
  }
  async show(){
    this.page=document.getElementById('wifi-profiles-page');
    this.page?.classList.remove('hidden');
    this.root=this.page?.querySelector('#wifi-profiles-content');
    if(!this.root)return;
    this.root.replaceChildren(this.elem('p','Loading wireless interfaces and security profiles…'));
    try{
      const [wireless,network,firewall]=await Promise.all([
        this.uci('get',{config:'wireless'}),
        this.uci('get',{config:'network'}),
        this.uci('get',{config:'firewall'})
      ]);
      this.wifi=wireless.values||{};
      this.network=network.values||{};
      this.fw=firewall.values||{};
      this.render();
    }catch(e){this.root.replaceChildren(this.elem('p','Configuration unavailable: '+e.message,'profiles-description'));}
  }
  async applyConfirm(){
    await this.uci('apply',{rollback:true,timeout:60});
    await new Promise(r=>setTimeout(r,2500));
    const [code]=await this.core.ubusCall('system','info',{}, {timeout:10000});
    if(code!==0)throw new Error('Connectivity check failed; changes will roll back');
    if(!window.confirm('Wireless configuration has changed. Keep the new Wi-Fi password mapping?\nChoose Cancel to let OpenWrt restore its previous configuration within 60 seconds.'))
      throw new Error('Changes remain unconfirmed and will roll back');
    await this.uci('confirm',{});
  }
  render(){
    const root=this.root;root.replaceChildren();
    root.append(this.elem('p','Assign different passwords on the same SSID to different isolated security profiles. Each password maps to an existing logical network and VLAN. Your wireless chipset and hostapd package must support dynamic VLANs.','profiles-description'));
    if(window.location.protocol!=='https:'){
      root.append(this.elem('p','For credential safety, password changes require HTTPS. Configure a trusted TLS certificate before creating or removing Wi-Fi passwords.','wifi-security-warning'));
    }
    const aps=Object.entries(this.wifi).filter(([name,w])=>AP.test(name)&&w?.['.type']==='wifi-iface'&&w.mode==='ap'&&['psk2','psk2+ccmp','psk2+aes','sae-mixed','psk-mixed'].includes(String(w.encryption||'')));
    const zones=Object.entries(this.fw).filter(([id,z])=>z?.['.type']==='zone'&&String(z.name||'').startsWith('moci_'));
    const usable=zones.flatMap(([,z])=>{
      const names=Array.isArray(z.network)?z.network:String(z.network||'').split(/\s+/);
      return names.filter(n=>this.network[n]?.['.type']==='interface')
        .map(n=>({network:n,profile:z.name}));
    });
    const entries=Object.entries(this.wifi).filter(([n,v])=>n.startsWith('moci_psk_')&&v?.['.type']==='wifi-station');
    const form=this.elem('form',undefined,'profiles-create');
    const makeLabel=(text,field)=>{
      const label=this.elem('label',text,'advanced-field');label.appendChild(field);form.append(label);
    };
    const name=this.elem('input');name.type='text';name.required=true;name.maxLength=24;name.placeholder='guest-access';
    makeLabel('Password label',name);
    const apSelect=this.elem('select');apSelect.required=true;
    for(const [id,w] of aps){const opt=this.elem('option',(w.ssid||id)+' ('+id+')');opt.value=id;apSelect.append(opt);}
    makeLabel('Existing Wi-Fi SSID',apSelect);
    const networkSelect=this.elem('select');networkSelect.required=true;
    for(const target of usable){const opt=this.elem('option',target.profile+' → '+target.network);opt.value=target.network;networkSelect.append(opt);}
    makeLabel('Security profile network',networkSelect);
    const vid=this.elem('input');vid.type='number';vid.min='2';vid.max='4094';vid.required=true;vid.placeholder='100';
    makeLabel('VLAN ID (2–4094)',vid);
    const password=this.elem('input');password.type='password';password.autocomplete='new-password';password.required=true;password.minLength=8;password.maxLength=63;
    makeLabel('Additional Wi-Fi password (8–63 characters)',password);
    const hint=this.elem('p','Existing AP passwords and network interfaces are preserved. Add the security profile and DHCP configuration before assigning a Wi-Fi password. Never reuse a management password for an untrusted profile.','profiles-description');
    form.append(hint);
    const create=this.elem('button','ADD PASSWORD & VLAN','action-btn');
    create.type='submit';create.disabled=window.location.protocol!=='https:'||!aps.length||!usable.length;
    form.append(create);
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(this.busy)return;
      const slug=name.value.trim().toLowerCase();
      const ap=apSelect.value,target=networkSelect.value,vlan=Number(vid.value),key=password.value;
      if(!SLUG.test(slug)||!AP.test(ap)||!this.wifi[ap]||!this.network[target]||
         !usable.some(p=>p.network===target)||!Number.isInteger(vlan)||vlan<2||vlan>4094||
         key.length<8||key.length>63){this.core.showToast('Invalid Wi-Fi mapping','error');return;}
      const station='moci_psk_'+slug,vlanId='moci_vlan_'+slug;
      const vlanName='moci-'+slug.slice(0,9); // hostapd VLAN interface names cannot exceed 14 characters.
      if(Object.values(this.wifi).some(v=>v?.['.type']==='wifi-vlan'&&v.iface===ap&&v.name===vlanName)){
        this.core.showToast('VLAN interface name conflicts with another password. Choose a distinct label.','error');return;
      }
      if(this.wifi[station]||this.wifi[vlanId]||
        Object.values(this.wifi).some(v=>v?.['.type']==='wifi-vlan'&&String(v.vid)===String(vlan)&&v.iface===ap)){
        this.core.showToast('Password label or VLAN already in use on this SSID','error');return;
      }
      if(!window.confirm('Create password for '+ap+' routing VLAN '+vlan+' to '+target+'? Wi-Fi will be reconfigured and connected devices may disconnect.'))return;
      this.busy=true;create.disabled=true;
      try{
        await this.uci('add',{config:'wireless',type:'wifi-vlan',name:vlanId});
        await this.uci('set',{config:'wireless',section:vlanId,values:{
          iface:ap,name:vlanName,vid:String(vlan),network:target}});
        await this.uci('add',{config:'wireless',type:'wifi-station',name:station});
        await this.uci('set',{config:'wireless',section:station,values:{
          iface:ap,vid:String(vlan),key,mac:'00:00:00:00:00:00'}});
        // OpenWrt must activate per-PSK dynamic VLAN handling on the AP.
        await this.uci('set',{config:'wireless',section:ap,values:{dynamic_vlan:'1'}});
        await this.applyConfirm();
        this.core.showToast('Wi-Fi profile added','success');
        await this.show();
      }catch(error){this.core.showToast('Wi-Fi change not confirmed: '+error.message,'error');}
      finally{password.value='';this.busy=false;create.disabled=false;}
    });
    root.append(this.elem('h3','Add password to existing SSID'),form,
      this.elem('h3','Managed Wi-Fi password profiles'));
    if(!aps.length)root.append(this.elem('p','No compatible WPA2/mixed AP detected. Configure a WPA2-PSK or compatible mixed-mode access point first.','profiles-description'));
    if(!usable.length)root.append(this.elem('p','No isolated security profiles are available. Create one in Security Profiles first.','profiles-description'));
    if(!entries.length)root.append(this.elem('p','No additional passwords configured.','profiles-description'));
    for(const [section,entry] of entries){
      const card=this.elem('article',undefined,'stat-card profiles-entry');
      card.append(this.elem('strong',section.replace('moci_psk_','')),
        this.elem('p','SSID '+(entry.iface||'?')+' · VLAN '+(entry.vid||'?')+' · Password hidden','profiles-description'));
      const remove=this.elem('button','REMOVE PASSWORD','action-btn danger');
      remove.type='button';remove.disabled=window.location.protocol!=='https:';
      remove.addEventListener('click',async()=>{
        if(this.busy||!window.confirm('Remove this Wi-Fi password and its VLAN assignment?'))return;
        this.busy=true;remove.disabled=true;
        const vlanId='moci_vlan_'+section.replace(/^moci_psk_/,'');
        try{
          await this.uci('delete',{config:'wireless',section});
          if(this.wifi[vlanId])await this.uci('delete',{config:'wireless',section:vlanId});
          await this.applyConfirm();
          this.core.showToast('Wi-Fi password removed','success');await this.show();
        }catch(error){this.core.showToast(error.message,'error');remove.disabled=false;}
        finally{this.busy=false;}
      });
      card.append(remove);root.append(card);
    }
  }
}
