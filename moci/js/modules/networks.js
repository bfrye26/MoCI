// Guest & IoT networks — create isolated network segments (bridge + subnet + DHCP +
// firewall zone) that keep smart-home/guest devices away from your main computers.
// Each segment can be assigned to a Wi-Fi SSID or an Ethernet port. Changes apply
// with the rollback-safe network apply.
const SLUG=/^[a-z][a-z0-9]{1,19}$/;
function privateIPv4(value){
  const parts=String(value).split('.');
  if(parts.length!==4||!parts.every(n=>/^\d{1,3}$/.test(n)&&Number(n)<=255))return false;
  const nums=parts.map(Number);
  return nums[3]>0&&nums[3]<255&&(nums[0]===10||nums[0]===172&&nums[1]>=16&&nums[1]<=31||nums[0]===192&&nums[1]===168);
}
const PRESETS={guest:{label:'Guest',internet:true},iot:{label:'Smart Home / IoT',internet:true},kids:{label:'Kids',internet:true},isolated:{label:'Fully isolated (no internet)',internet:false}};
export default class NetworksModule{
	constructor(core){
		this.core=core;this.busy=false;
		this.core.registerRoute('/networks',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async rpc(o,m,a={}){const [s,r]=await this.core.ubusCall(o,m,a,{timeout:65000});if(s!==0)throw new Error(o+'.'+m+' failed ('+s+')');return r||{};}
	async uci(m,a){return this.rpc('uci',m,a);}
	async show(){
		this.page=document.getElementById('networks-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#networks-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading network segments…','page-loading'));
		try{
			const [network,dhcp,firewall,wireless]=await Promise.all([
				this.uci('get',{config:'network'}),this.uci('get',{config:'dhcp'}),
				this.uci('get',{config:'firewall'}),this.uci('get',{config:'wireless'}).catch(()=>({values:{}}))
			]);
			this.network=network.values||{};this.dhcp=dhcp.values||{};this.firewall=firewall.values||{};this.wireless=wireless.values||{};
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read networks: '+e.message,'page-error'));}
	}
	segments(){
		return Object.entries(this.network).filter(([name,v])=>name.startsWith('moci_')&&v?.['.type']==='interface'&&v.moci_segment==='1');
	}
	ssidsFor(name){
		return Object.values(this.wireless).filter(v=>v?.['.type']==='wifi-iface'&&v.network===name).map(v=>v.ssid).filter(Boolean);
	}
	render(){
		const root=this.root;root.replaceChildren();
		root.append(this.el('p','Create a separate network for guests or smart-home devices. Each segment gets its own subnet, DHCP and firewall zone, so those devices can reach the internet (if allowed) but not your main computers. Assign a segment to a Wi-Fi network or an Ethernet port.','page-note'));
		const segs=this.segments();
		root.append(this.el('h3','Your network segments'));
		if(!segs.length){
			root.append(this.el('p','No isolated segments yet. Create one below — for example a “Guest” Wi-Fi or an “IoT” network for smart devices.','page-note'));
		}else{
			const list=this.el('div',undefined,'dev-res-list');
			for(const [name,iface] of segs){
				const label=name.replace(/^moci_/,'');
				const card=this.el('div',undefined,'dev-res-card stat-card');
				const info=this.el('div',undefined,'dev-res-info');
				const ssids=this.ssidsFor(name);
				const zone=this.firewall['moci_zone_'+label];
				const hasWan=Object.values(this.firewall).some(v=>v?.['.type']==='forwarding'&&v.src===name&&v.dest==='wan');
				info.append(this.el('strong',(PRESETS[label]?.label||label)+'  ·  '+name,'dev-name'),
					this.el('span',(iface.ipaddr||'')+'/24  ·  '+(hasWan?'Internet allowed':'No internet')+(ssids.length?'  ·  Wi-Fi: '+ssids.join(', '):''),'dev-mono dev-res-meta'));
				const actions=this.el('div',undefined,'dev-res-actions');
				const del=this.el('button','Remove','dev-action danger');del.type='button';
				del.addEventListener('click',()=>this.removeSegment(name,label));
				actions.append(del);
				card.append(info,actions);list.append(card);
			}
			root.append(list);
		}
		root.append(this.el('h3','Create a segment'));
		root.append(this.createForm());
		root.append(this.el('p','After creating a segment, assign it to a Wi-Fi network (Wi-Fi page) or an Ethernet port (Ethernet page). Devices on that segment are isolated from your main LAN.','page-note'));
	}
	createForm(){
		const form=this.el('form',undefined,'wifi-form stat-card');
		const preset=this.el('select');preset.className='form-input';
		for(const [key,p] of Object.entries(PRESETS)){const o=this.el('option',p.label);o.value=key;preset.append(o);}
		const name=this.el('input');name.className='form-input';name.placeholder='guest';name.pattern='[a-z][a-z0-9]{1,19}';name.maxLength=20;name.required=true;
		const ip=this.el('input');ip.className='form-input';ip.placeholder='192.168.60.1';ip.required=true;
		const internet=this.el('input');internet.type='checkbox';internet.checked=true;
		const internetLabel=this.el('label',undefined,'profiles-check');internetLabel.append(internet,this.el('span','Allow internet access (devices stay isolated from the main LAN)'));
		const syncPreset=()=>{const p=PRESETS[preset.value];if(p){internet.checked=p.internet;if(!name.value)name.value=preset.value;}};
		preset.addEventListener('change',syncPreset);
		form.append(this.field('Segment type',preset),this.field('Name',name,'Lowercase letters/numbers, e.g. guest or iot.'),this.field('Gateway IPv4 (/24)',ip,'Use the .1 of a private subnet not already in use.'),internetLabel);
		const create=this.el('button','CREATE SEGMENT','action-btn');create.type='submit';
		form.append(create);
		form.addEventListener('submit',async e=>{
			e.preventDefault();if(this.busy)return;
			await this.createSegment({label:name.value.trim().toLowerCase(),ip:ip.value.trim(),internet:internet.checked},create);
		});
		return form;
	}
	field(label,input,hint){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),input);if(hint)w.append(this.el('small',hint,'wan-field-hint'));return w;}
	async createSegment({label,ip,internet},btn){
		if(!SLUG.test(label)){this.core.showToast('Use a lowercase name (letters/numbers)','error');return;}
		if(!privateIPv4(ip)||!ip.endsWith('.1')){this.core.showToast('Use the .1 address of a private /24 subnet','error');return;}
		const logical='moci_'+label;
		if(this.network[logical]||this.dhcp[logical]||this.firewall['moci_zone_'+label]){this.core.showToast('A segment with that name already exists','error');return;}
		const conflict=Object.values(this.network).some(v=>v?.['.type']==='interface'&&typeof v.ipaddr==='string'&&v.ipaddr.split('.').slice(0,3).join('.')===ip.split('.').slice(0,3).join('.'));
		if(conflict){this.core.showToast('That subnet overlaps an existing interface','error');return;}
		if(!window.confirm('Create the “'+label+'” segment at '+ip+'/24 with DHCP and '+(internet?'internet access':'no internet')+'?'))return;
		this.busy=true;btn.disabled=true;
		try{
			const bridge='br-moci_'+label;
			const bridgeSection='br_moci_'+label;
			await this.uci('add',{config:'network',type:'device',name:bridgeSection});
			await this.uci('set',{config:'network',section:bridgeSection,values:{type:'bridge',name:bridge}});
			await this.uci('add',{config:'network',type:'interface',name:logical});
			await this.uci('set',{config:'network',section:logical,values:{proto:'static',device:bridge,ipaddr:ip,netmask:'255.255.255.0',moci_segment:'1'}});
			await this.uci('add',{config:'dhcp',type:'dhcp',name:logical});
			await this.uci('set',{config:'dhcp',section:logical,values:{interface:logical,start:'100',limit:'150',leasetime:'12h',ignore:'0'}});
			const zone='moci_zone_'+label;
			await this.uci('add',{config:'firewall',type:'zone',name:zone});
			await this.uci('set',{config:'firewall',section:zone,values:{name:logical,network:[logical],input:'REJECT',output:'ACCEPT',forward:'REJECT'}});
			for(const [suffix,proto,dest] of [['dns','tcp udp','53'],['dhcp','udp','67']]){
				const section='moci_'+label+'_'+suffix;
				await this.uci('add',{config:'firewall',type:'rule',name:section});
				await this.uci('set',{config:'firewall',section,values:{name:'Haven '+label+' '+suffix,src:logical,proto,dest_port:dest,target:'ACCEPT'}});
			}
			if(internet){
				const section='moci_'+label+'_wan';
				await this.uci('add',{config:'firewall',type:'forwarding',name:section});
				await this.uci('set',{config:'firewall',section,values:{src:logical,dest:'wan'}});
			}
			// A new isolated segment never touches the management LAN, so the DHCP
			// and firewall additions are committed directly; the network change is
			// applied with the rollback-safe confirm.
			await this.uci('commit',{config:'dhcp'});
			await this.uci('commit',{config:'firewall'});
			await this.core.uciApplyConfig('network');
			this.core.showToast('Segment “'+label+'” created','success');
			await this.show();
		}catch(e){this.core.showToast('Segment not created: '+e.message,'error');}
		finally{this.busy=false;btn.disabled=false;}
	}
	async removeSegment(name,label){
		if(!window.confirm('Remove the “'+label+'” segment? Devices on it will disconnect.'))return;
		if(!window.confirm('Confirm removal of the isolated network '+name+'?'))return;
		this.busy=true;
		try{
			const bridgeSection='br_moci_'+label;
			for(const [config,sections] of [
				['firewall',['moci_zone_'+label,'moci_'+label+'_dns','moci_'+label+'_dhcp','moci_'+label+'_wan']],
				['dhcp',[name]],['network',[name,bridgeSection]]]){
				for(const id of sections){
					const source={network:this.network,firewall:this.firewall,dhcp:this.dhcp}[config];
					if(source[id])await this.uci('delete',{config,section:id});
				}
			}
			await this.uci('commit',{config:'dhcp'});
			await this.uci('commit',{config:'firewall'});
			await this.core.uciApplyConfig('network');
			this.core.showToast('Segment removed','success');
			await this.show();
		}catch(e){this.core.showToast('Segment not removed: '+e.message,'error');}
		finally{this.busy=false;}
	}
}
