// Wi-Fi — manage wireless networks (SSIDs) per radio. Reads wifi-device radios and
// wifi-iface networks from UCI plus live status. Changes apply with the rollback-safe
// wireless apply. On wired-only hardware (no radios) it shows a clear availability state.
const encLabel={none:'Open','psk2':'WPA2-Personal','psk-mixed':'WPA/WPA2','sae':'WPA3-Personal','sae-mixed':'WPA2/WPA3','owe':'Enhanced Open'};
export default class WifiModule{
	constructor(core){
		this.core=core;this.busy=false;
		this.core.registerRoute('/wifi',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async rpc(o,m,a={}){const [s,r]=await this.core.ubusCall(o,m,a,{timeout:30000});if(s!==0)throw new Error(o+'.'+m+' failed ('+s+')');return r||{};}
	async uci(m,a){return this.rpc('uci',m,a);}
	async show(){
		this.page=document.getElementById('wifi-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#wifi-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading wireless radios…','page-loading'));
		try{
			const [wireless,status,net]=await Promise.all([
				this.uci('get',{config:'wireless'}).catch(()=>({values:{}})),
				this.rpc('network.wireless','status').catch(()=>({})),
				this.uci('get',{config:'network'}).catch(()=>({values:{}}))
			]);
			const values=wireless.values||{};
			this.radios=Object.entries(values).filter(([,v])=>v?.['.type']==='wifi-device');
			this.ifaces=Object.entries(values).filter(([,v])=>v?.['.type']==='wifi-iface');
			this.status=status;this.network=net.values||{};
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read wireless: '+e.message,'page-error'));}
	}
	radioLabel(id,radio){
		const band=radio.band||radio.hwmode||'';
		const b=/5|a$|ac|ax/.test(band)&&!/2\.4|g$|n$/.test(band)?'5 GHz':(/2\.4|g|n|b/.test(band)?'2.4 GHz':'Radio');
		return {name:id,band:b,channel:radio.channel||'auto'};
	}
	ifaceRadio(iface){return this.radios.find(([id])=>id===iface.device);}
	render(){
		const root=this.root;root.replaceChildren();
		if(!this.radios.length){
			const card=this.el('div',undefined,'wifi-empty stat-card');
			card.append(this.el('h3','No Wi-Fi hardware detected'),
				this.el('p','This router has no wireless radios configured. That is normal for wired-only x86 hardware and virtual machines. When a compatible Wi-Fi adapter is present, its radios and networks appear here and can be managed.','page-note'),
				this.el('p','To add Wi-Fi, attach a supported adapter (the P09B’s mini-PCIe module) and its driver will create the radios automatically.','page-note'));
			root.append(card);
			return;
		}
		// Radio overview
		const radioRow=this.el('div',undefined,'wifi-radios');
		for(const [id,radio] of this.radios){
			const info=this.radioLabel(id,radio);
			const live=(this.status[id]||{});
			const up=live.up!==false;
			const card=this.el('div',undefined,'wifi-radio stat-card');
			card.append(this.el('div',undefined,'wifi-radio-head'));
			card.firstChild.append(this.el('strong',info.band),this.el('span',up?'Active':'Inactive','dev-badge '+(up?'static':'dynamic')));
			card.append(this.el('span','Channel '+info.channel+'  ·  '+id,'dev-mono'));
			radioRow.append(card);
		}
		root.append(radioRow);

		// Networks (SSIDs)
		root.append(this.el('h3','Wireless networks'));
		root.append(this.el('p','Each network is an SSID devices can join. Assign a network to an isolated profile (guest / IoT) to keep those devices away from your main computers.','page-note'));
		if(!this.ifaces.length){
			root.append(this.el('p','No wireless networks configured yet. Add one below.','page-note'));
		}else{
			const list=this.el('div',undefined,'wifi-net-list');
			for(const [id,iface] of this.ifaces){
				list.append(this.ifaceCard(id,iface));
			}
			root.append(list);
		}

		// Add network
		root.append(this.el('h3','Add a wireless network'));
		root.append(this.addForm());
	}
	ifaceCard(id,iface){
		const card=this.el('div',undefined,'wifi-net-card stat-card');
		const info=this.el('div',undefined,'wifi-net-info');
		const radio=this.ifaceRadio(iface);
		const band=radio?this.radioLabel(radio[0],radio[1]).band:'';
		const disabled=iface.disabled==='1';
		info.append(this.el('strong',iface.ssid||'(no SSID)','dev-name'),
			this.el('span',(encLabel[iface.encryption]||iface.encryption||'Open')+'  ·  '+band+'  ·  '+(iface.network||'lan'),'dev-mono wifi-net-meta'));
		const actions=this.el('div',undefined,'dev-res-actions');
		actions.append(this.el('span',disabled?'Disabled':'Enabled','dev-badge '+(disabled?'dynamic':'static')));
		const toggle=this.el('button',disabled?'Enable':'Disable','dev-action');toggle.type='button';
		toggle.addEventListener('click',()=>this.toggleIface(id,iface));
		const edit=this.el('button','Edit','dev-action');edit.type='button';
		edit.addEventListener('click',()=>this.editIface(id,iface));
		const del=this.el('button','Remove','dev-action danger');del.type='button';
		del.addEventListener('click',()=>this.removeIface(id,iface));
		actions.append(toggle,edit,del);
		card.append(info,actions);
		return card;
	}
	networkOptions(selected){
		const sel=this.el('select');sel.className='form-input';
		const lan=this.el('option','Main LAN (trusted)');lan.value='lan';sel.append(lan);
		for(const [name,v] of Object.entries(this.network)){
			if(v?.['.type']==='interface'&&name.startsWith('moci_')){
				const o=this.el('option','Isolated: '+name.replace(/^moci_/,''));o.value=name;sel.append(o);
			}
		}
		sel.value=selected||'lan';
		return sel;
	}
	addForm(existing){
		const form=this.el('form',undefined,'wifi-form stat-card');
		const ssid=this.el('input');ssid.className='form-input';ssid.placeholder='Home Wi-Fi';ssid.value=existing?.ssid||'';ssid.required=true;ssid.maxLength=32;
		const key=this.el('input');key.className='form-input';key.type='password';key.placeholder='At least 8 characters';key.value=existing?.key||'';key.autocomplete='new-password';
		const enc=this.el('select');enc.className='form-input';
		for(const [val,label] of [['psk2','WPA2-Personal'],['sae','WPA3-Personal'],['sae-mixed','WPA2/WPA3'],['none','Open (no password)']]){
			const o=this.el('option',label);o.value=val;enc.append(o);
		}
		enc.value=existing?.encryption||'psk2';
		const radio=this.el('select');radio.className='form-input';
		for(const [id,r] of this.radios){const o=this.el('option',this.radioLabel(id,r).band+' ('+id+')');o.value=id;radio.append(o);}
		if(existing?.device)radio.value=existing.device;
		const network=this.networkOptions(existing?.network);
		const hidden=this.el('input');hidden.type='checkbox';hidden.checked=existing?.hidden==='1';
		const hiddenLabel=this.el('label',undefined,'profiles-check');hiddenLabel.append(hidden,this.el('span','Hide the network name (SSID)'));
		form.append(this.field('Network name (SSID)',ssid),this.field('Password',key),this.field('Security',enc),
			this.field('Radio / band',radio),this.field('Network',network),hiddenLabel);
		const save=this.el('button',existing?'SAVE NETWORK':'ADD NETWORK','action-btn');save.type='submit';
		form.append(save);
		const syncKey=()=>{key.disabled=enc.value==='none';if(enc.value==='none')key.value='';};
		enc.addEventListener('change',syncKey);syncKey();
		form.addEventListener('submit',async e=>{
			e.preventDefault();if(this.busy)return;
			const values={ssid:ssid.value.trim(),encryption:enc.value,device:radio.value,network:network.value,hidden:hidden.checked?'1':'0'};
			if(!values.ssid){this.core.showToast('Enter a network name','error');return;}
			if(enc.value!=='none'){
				if(key.value.length<8){this.core.showToast('Password must be at least 8 characters','error');return;}
				values.key=key.value;
			}
			await this.saveIface(existing?existing._id:null,values,save);
		});
		return form;
	}
	field(label,input){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),input);return w;}
	editIface(id,iface){
		const root=this.root;
		const existing={...iface,_id:id};
		// Replace the add form area with an edit form by re-rendering with a focus section.
		const holder=this.el('div',undefined,'wifi-edit-holder');
		holder.append(this.el('h3','Edit “'+(iface.ssid||id)+'”'),this.addForm(existing));
		const old=root.querySelector('.wifi-edit-holder');if(old)old.remove();
		root.append(holder);
		holder.scrollIntoView({behavior:'smooth',block:'start'});
	}
	async toggleIface(id,iface){
		await this.applyWireless(async()=>{
			await this.uci('set',{config:'wireless',section:id,values:{disabled:iface.disabled==='1'?'0':'1'}});
		},iface.disabled==='1'?'Network enabled':'Network disabled');
	}
	async removeIface(id,iface){
		if(!window.confirm('Remove the wireless network “'+(iface.ssid||id)+'”? Devices connected to it will disconnect.'))return;
		await this.applyWireless(async()=>{await this.uci('delete',{config:'wireless',section:id});},'Network removed');
	}
	async saveIface(id,values,btn){
		if(!window.confirm((id?'Update':'Create')+' the wireless network “'+values.ssid+'”? Wi-Fi will briefly restart.'))return;
		this.busy=true;if(btn)btn.disabled=true;
		try{
			await this.applyWireless(async()=>{
				let section=id;
				if(!section){const r=await this.uci('add',{config:'wireless',type:'wifi-iface'});section=r.section;}
				await this.uci('set',{config:'wireless',section,values});
			},id?'Network updated':'Network created');
		}finally{this.busy=false;if(btn)btn.disabled=false;}
	}
	async applyWireless(mutate,successMsg){
		this.busy=true;
		try{
			await mutate();
			await this.core.uciApplyConfig('wireless');
			this.core.showToast(successMsg,'success');
			await this.show();
		}catch(e){this.core.showToast('Wireless change not applied: '+e.message,'error');}
		finally{this.busy=false;}
	}
}
