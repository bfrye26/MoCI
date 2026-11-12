// StartWRT-style per-radio Wi-Fi schedules using a protected local cron helper.
// No Wi-Fi secrets are stored by this module. Radio changes happen at minute boundaries.
const RADIO=/^radio[0-9]{1,2}$/;
const NAME=/^[a-z][a-z0-9-]{1,24}$/;
const DAYS=[['1','Mon'],['2','Tue'],['3','Wed'],['4','Thu'],['5','Fri'],['6','Sat'],['0','Sun']];
function timeToDigits(value) {
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw new Error('Time must be HH:MM using a 24-hour clock');
  return value.replace(':','');
}
export default class WifiSchedulesModule{
  constructor(core){
    this.core=core;
    this.loading=false;
    this.core.registerRoute('/schedules',()=>this.show());
  }
  element(tag,label,cls){
    const el=document.createElement(tag);
    if(label!==undefined)el.textContent=label;
    if(cls)el.className=cls;
    return el;
  }
  async rpc(method,args) {
    const [status,data]=await this.core.ubusCall('uci',method,args||{},{timeout:20000});
    if(status!==0)throw new Error('UCI '+method+' failed (status '+status+')');
    return data||{};
  }
  async show(){
    this.root=document.querySelector('#schedules-content');
    const page=document.getElementById('schedules-page');
    page?.classList.remove('hidden');
    if(!this.root||this.loading)return;
    this.loading=true;this.root.textContent='Loading wireless radios and schedules…';
    try{
      const [wifi,all]=await Promise.all([
        this.rpc('get',{config:'wireless'}),
        this.rpc('get',{config:'moci_wifi_schedule'})
      ]);
      this.radios=Object.entries(wifi.values||{})
        .filter(([id,config])=>RADIO.test(id)&&config?.['.type']==='wifi-device')
        .map(([id])=>id);
      this.config=all.values||{};
      this.render();
    }catch(error){
      this.root.replaceChildren(this.element('p','Wi-Fi scheduling unavailable: '+error.message,'profiles-description'));
    }finally{this.loading=false;}
  }
  render(){
    const root=this.root;root.replaceChildren();
    root.appendChild(this.element('p','Set allowed Wi-Fi hours by radio, including overnight periods. Schedule changes take effect within a minute. Manually disabled radios stay disabled.','profiles-description'));
    if(!this.radios.length){
      root.appendChild(this.element('p','No compatible radio detected. Hyper-V x86 Ethernet-only systems do not normally include Wi-Fi hardware.','profiles-description'));
    }
    const global=this.element('div',undefined,'profiles-entry');
    const globalTitle=this.element('strong','Wi-Fi scheduling');
    const toggle=this.element('input');toggle.type='checkbox';
    toggle.checked=this.config.settings?.enabled==='1';
    const label=this.element('label',undefined,'profiles-check');
    label.append(toggle,this.element('span','Enable all configured schedules'));
    global.append(globalTitle,label);
    toggle.addEventListener('change',async()=> {
      if(!window.confirm(toggle.checked?'Enable Wi-Fi scheduling? Radios may go offline outside their allowed hours.':'Disable Wi-Fi scheduling? Previously scheduled radios will be restored if not manually disabled.')){
        toggle.checked=!toggle.checked;return;
      }
      toggle.disabled=true;
      try{
        await this.rpc('set',{config:'moci_wifi_schedule',section:'settings',values:{enabled:toggle.checked?'1':'0'}});
        await this.rpc('commit',{config:'moci_wifi_schedule'});
        this.core.showToast('Wi-Fi scheduling updated','success');
      }catch(e){toggle.checked=!toggle.checked;this.core.showToast(e.message,'error');}
      finally{toggle.disabled=false;}
    });
    root.append(global);
    const existing=Object.entries(this.config).filter(([,v])=>v?.['.type']==='schedule');
    const used=new Set(existing.map(([,v])=>v.radio));
    const form=this.element('form',undefined,'profiles-create');
    const nameField=this.element('label','Name','advanced-field');const name=this.element('input');
    name.placeholder='weekday';name.pattern='[a-z][a-z0-9-]{1,24}';name.required=true;name.maxLength=25;
    nameField.appendChild(name);
    const radioField=this.element('label','Radio','advanced-field');
    const radio=this.element('select');radio.required=true;
    for(const id of this.radios){const option=this.element('option',id);option.value=id;option.disabled=used.has(id);radio.append(option);}
    radioField.append(radio);
    const startLabel=this.element('label','Start of allowed period','advanced-field');
    const start=this.element('input');start.type='time';start.value='08:00';start.required=true;startLabel.append(start);
    const endLabel=this.element('label','End of allowed period','advanced-field');
    const end=this.element('input');end.type='time';end.value='22:00';end.required=true;endLabel.append(end);
    form.append(nameField,radioField,startLabel,endLabel);
    const days=this.element('fieldset',undefined,'schedule-days');days.append(this.element('legend','Allowed start days'));
    const checkboxes=[];
    for(const [number,title] of DAYS){
      const l=this.element('label',undefined,'profiles-check');
      const input=this.element('input');input.type='checkbox';input.checked=true;input.value=number;
      checkboxes.push(input);l.append(input,this.element('span',title));days.appendChild(l);
    }
    form.appendChild(days);
    const add=this.element('button','ADD WI-FI SCHEDULE','action-btn');
    add.type='submit';add.disabled=!this.radios.some(r=>!used.has(r));
    form.append(add);
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      if(!window.confirm('Create schedule for '+radio.value+'? Wireless clients will lose connectivity when the radio is scheduled off.'))return;
      const selectedDays=checkboxes.filter(c=>c.checked).map(c=>c.value);
      if(!selectedDays.length){this.core.showToast('Choose at least one day','error');return;}
      add.disabled=true;
      try {
        const id=name.value.trim().toLowerCase();
        if(!NAME.test(id))throw new Error('Invalid schedule name');
        if(!RADIO.test(radio.value)||used.has(radio.value))throw new Error('A schedule already exists for that radio');
        const begin=timeToDigits(start.value),finish=timeToDigits(end.value);
        if(begin===finish)throw new Error('Start and end times must be different');
        const section='moci_'+id;
        if(this.config[section])throw new Error('Schedule name is already used');
        await this.rpc('add',{config:'moci_wifi_schedule',type:'schedule',name:section});
        await this.rpc('set',{config:'moci_wifi_schedule',section,values:{
          enabled:'1',radio:radio.value,start:begin,end:finish,days:selectedDays.join(' ')}});
        await this.rpc('commit',{config:'moci_wifi_schedule'});
        this.core.showToast('Wi-Fi schedule created','success');await this.show();
      }catch(e){this.core.showToast(e.message,'error');}
      finally{add.disabled=false;}
    });
    root.append(this.element('h3','Create schedule'),form,this.element('h3','Existing schedules'));
    if(!existing.length)root.append(this.element('p','No Wi-Fi schedules defined.','profiles-description'));
    for(const [section,data] of existing){
      const card=this.element('article',undefined,'stat-card profiles-entry');
      const title=this.element('strong',section.replace(/^moci_/,'')+' · '+(data.radio||'?'));
      const status=this.element('p',String(data.start||'').replace(/^(..)(..)$/,'$1:$2')+' to '+
        String(data.end||'').replace(/^(..)(..)$/,'$1:$2')+
        ' · Days: '+(data.days||'every day'),'profiles-description');
      const remove=this.element('button','REMOVE','action-btn danger');
      remove.type='button';
      remove.addEventListener('click',async()=>{
        if(!window.confirm('Delete Wi-Fi schedule '+section+'?'))return;
        remove.disabled=true;
        try{
          await this.rpc('delete',{config:'moci_wifi_schedule',section});
          await this.rpc('commit',{config:'moci_wifi_schedule'});
          this.core.showToast('Schedule removed','success');await this.show();
        }catch(e){this.core.showToast(e.message,'error');remove.disabled=false;}
      });
      card.append(title,status,remove);root.append(card);
    }
  }
}
