// Features — the add-on control center. Every native add-on has an on/off switch
// here. A switch does three things: (1) sets moci.features.<key> so the add-on's
// nav entry + dashboard show/hide, (2) enables/disables the service at boot, and
// (3) starts/stops it now. New add-ons ship OFF by default. Service presence and
// state come from the read-only moci-service-inspect helper + procd service.list.
const ADDONS=[
	{key:'sqm',name:'SQM / Bufferbloat',group:'Network Performance',service:'sqm',route:'/qos',
		desc:'Smart Queue Management (cake / fq_codel) to keep latency low while the link is busy.'},
	{key:'bandwidth',name:'Bandwidth Monitor',group:'Network Performance',service:'nlbwmon',route:'/bandwidth',
		desc:'Per-device traffic accounting: top talkers, totals and protocol breakdown (nlbwmon).'},
	{key:'multiwan',name:'Multi-WAN / Failover',group:'Network Performance',service:'mwan3',route:'/multiwan',
		desc:'Load-balance and fail over across multiple WAN uplinks (mwan3).'},
	{key:'adblock',name:'Ad Blocking',group:'Security & Privacy',service:'adblock',route:'/adblock',
		desc:'Network-wide DNS blocking of ads, trackers and malware domains (adblock).'},
	{key:'tailscale',name:'Tailscale VPN',group:'Security & Privacy',service:'tailscale',route:'/tailscale',
		desc:'Zero-config mesh VPN to reach this network securely from anywhere.'},
	{key:'terminal',name:'Web Terminal',group:'System & Diagnostics',service:'ttyd',route:'/terminal',
		desc:'A browser terminal (ttyd) with htop for live troubleshooting.'},
	{key:'statistics',name:'Statistics / Graphs',group:'System & Diagnostics',service:'luci_statistics',route:'/statistics',
		desc:'CPU, memory, load and network graphs over time (collectd).'},
	{key:'nas',name:'NAS / File Sharing',group:'System & Diagnostics',service:'samba4',route:'/nas',
		desc:'Share USB drives with the network via Samba (block-mount).'}
];
const GROUPS=['Network Performance','Security & Privacy','System & Diagnostics'];

export default class FeaturesModule{
	constructor(core){
		this.core=core;
		this.busy=new Set();
		this._bound=false;
		this.core.registerRoute('/features',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){
		const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:20000});
		if(s!==0)throw new Error('Command denied by router permissions ('+s+')');
		return r||{};
	}
	async loadStatus(){
		const [present,boot,svc]=await Promise.all([
			this.exec('/usr/libexec/moci-service-inspect',['present']).catch(()=>({stdout:''})),
			this.exec('/usr/libexec/moci-service-inspect',['list']).catch(()=>({stdout:''})),
			this.core.ubusCall('service','list',{verbose:true},{timeout:10000}).catch(()=>[1,{}])
		]);
		const lines=s=>String(s||'').split('\n').map(x=>x.trim()).filter(Boolean);
		const installed=new Set(lines(present.stdout));
		const bootEnabled=new Set(lines(boot.stdout));
		const services=(svc[0]===0&&svc[1]&&typeof svc[1]==='object')?svc[1]:{};
		return {installed,bootEnabled,services};
	}
	isRunning(services,name){
		const inst=services?.[name]?.instances;
		if(!inst||typeof inst!=='object')return false;
		return Object.values(inst).some(i=>i?.running===true);
	}
	async show(){
		this.page=document.getElementById('features-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#features-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Loading add-on status…','page-loading'));
		try{
			await this.core.loadFeatures();
			this.status=await this.loadStatus();
			this.render();
			this.bind();
		}catch(e){
			this.root.replaceChildren(this.el('p','Unable to load add-ons: '+e.message,'page-error'));
		}
	}
	statusFor(a){
		const {installed,bootEnabled,services}=this.status;
		if(!installed.has(a.service))return {label:'NOT INSTALLED',variant:'info',running:false,installed:false,boot:false};
		const running=this.isRunning(services,a.service);
		return {label:running?'RUNNING':'STOPPED',variant:running?'success':'error',running,installed:true,boot:bootEnabled.has(a.service)};
	}
	render(){
		const esc=t=>this.core.escapeHtml(t);
		const frag=document.createDocumentFragment();
		const intro=this.el('p','Turn add-ons on or off. New add-ons start off. Turning one on enables its service and reveals its dashboard; turning it off stops the service and hides it.','page-intro');
		frag.appendChild(intro);
		for(const group of GROUPS){
			const items=ADDONS.filter(a=>a.group===group);
			if(!items.length)continue;
			frag.appendChild(this.el('div',group,'feature-group-title'));
			for(const a of items){
				const on=this.core.isFeatureEnabled(a.key);
				const st=this.statusFor(a);
				const card=this.el('div','','addon-card feature-card');
				card.dataset.key=a.key;
				const busy=this.busy.has(a.key);
				const badge=this.core.renderBadge(st.variant,st.label);
				const bootNote=st.installed?(st.boot?'Starts at boot':'Manual start'):'Install the firmware update to add this service';
				card.innerHTML=`
					<div class="addon-card-info">
						<div class="addon-card-name">${esc(a.name)}</div>
						<div class="addon-card-desc">${esc(a.desc)}</div>
						<div class="feature-card-status">${badge}
							<span class="addon-card-meta"><span>${esc(a.service)}</span><span>${esc(bootNote)}</span></span>
						</div>
					</div>
					<div class="addon-card-actions" style="align-items:center">
						${on?`<a class="action-btn" href="#${a.route}">OPEN</a>`:''}
						<label class="feature-switch" title="${on?'Turn off':'Turn on'} ${esc(a.name)}">
							<input type="checkbox" data-feature-key="${a.key}" ${on?'checked':''} ${busy?'disabled':''}
								aria-label="Toggle ${esc(a.name)}">
							<span class="slider"></span>
						</label>
					</div>`;
				frag.appendChild(card);
			}
		}
		this.root.replaceChildren(frag);
	}
	bind(){
		if(this._bound)return;
		this._bound=true;
		this.root.addEventListener('change',e=>{
			const input=e.target.closest('input[data-feature-key]');
			if(!input)return;
			const key=input.getAttribute('data-feature-key');
			const addon=ADDONS.find(a=>a.key===key);
			if(addon)this.toggle(addon,input.checked);
		});
	}
	async setFeature(key,on){
		await this.core.uciSet('moci','features',{[key]:on?'1':'0'});
		await this.core.uciCommit('moci');
		await this.core.loadFeatures();
		this.core.applyFeatureFlags();
	}
	async serviceAction(service,action){
		const r=await this.exec('/etc/init.d/'+service,[action]);
		if(r.code!==0){
			const reason=String(r.stderr||r.stdout||'').trim().slice(0,200);
			throw new Error(reason||('init '+action+' returned '+r.code));
		}
	}
	async toggle(a,on){
		if(this.busy.has(a.key))return;
		this.busy.add(a.key);
		this.render();
		const {installed}=this.status;
		try{
			await this.setFeature(a.key,on);
			if(installed.has(a.service)){
				try{
					if(on){
						await this.serviceAction(a.service,'enable');
						await this.serviceAction(a.service,'start');
					}else{
						await this.serviceAction(a.service,'stop');
						await this.serviceAction(a.service,'disable');
					}
					this.core.showToast(a.name+(on?' turned on':' turned off'),'success');
				}catch(err){
					// The dashboard flag is already set; the service may need configuration
					// first (e.g. SQM interface, Tailscale login). Surface that, don't fail hard.
					this.core.showToast(a.name+(on?' enabled, but the service needs setup: ':' could not stop: ')+err.message,'info');
				}
			}else{
				this.core.showToast(a.name+(on?' enabled. Its service arrives with the firmware update.':' disabled.'),'info');
			}
		}catch(err){
			this.core.showToast('Could not update '+a.name+': '+err.message,'error');
			try{await this.setFeature(a.key,!on);}catch{}
		}finally{
			this.busy.delete(a.key);
			try{this.status=await this.loadStatus();}catch{}
			this.render();
		}
	}
}