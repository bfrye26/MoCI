// Native in-UI integrations for select running apps. Detects active managed apps
// that have an integration, adds a sidebar entry, and renders a live panel inside
// Haven (no separate URL). App APIs are fetched through the restricted moci-docker
// app_fetch proxy, so HTTP app endpoints work from the HTTPS UI without CORS issues.
const ICONS={
	pihole:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/><path d="M9 12l2 2 4-4"/></svg>',
	'adguard-home':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
	'uptime-kuma':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2 6 4-14 2 8h6"/></svg>'
};
const INTEGRATIONS={pihole:{label:'Pi-hole'},'adguard-home':{label:'AdGuard Home'},'uptime-kuma':{label:'Uptime Kuma'}};
export default class AppIntegrationsModule{
	constructor(core){
		this.core=core;this.active=[];
	}
	async init(){
		// Refresh whenever the Docker addon changes the set of managed apps, so
		// newly installed integrations appear in the sidebar without a reload.
		window.addEventListener('moci:stacks-changed',()=>this.refresh());
		await this.refresh();
	}
	async refresh(){
		try{
			const [s,r]=await this.core.ubusCall('moci-docker','managed_stacks',{});
			if(s!==0)return;
			const running=new Set((r.managed_stacks||[]).filter(x=>x.running).map(x=>x.name));
			for(const name of Object.keys(INTEGRATIONS)){
				if(running.has(name)){
					if(!this.active.includes(name))this.active.push(name);
					this.injectNav(name);
					this.createPage(name);
					this.core.registerRoute('/app-'+name,()=>this.show(name));
				}else{
					// App stopped/removed: drop its sidebar entry (page stays hidden).
					document.querySelector('a[data-integration="'+name+'"]')?.remove();
					this.active=this.active.filter(x=>x!==name);
				}
			}
			const group=document.getElementById('integrations-nav-group');
			if(group&&!group.querySelector('a.nav-item'))group.remove();
		}catch(e){/* Docker unavailable — integrations simply stay hidden */}
	}
	injectNav(app){
		if(document.querySelector('a[data-integration="'+app+'"]'))return;
		const nav=document.querySelector('.sidebar-nav');if(!nav)return;
		let group=document.getElementById('integrations-nav-group');
		if(!group){
			group=document.createElement('div');group.className='nav-group';group.id='integrations-nav-group';
			const label=document.createElement('span');label.className='nav-group-label';label.textContent='Integrations';
			group.appendChild(label);
			const apps=document.getElementById('apps-nav-group');
			if(apps&&apps.parentElement===nav)nav.insertBefore(group,apps.nextSibling);else nav.appendChild(group);
		}
		const a=document.createElement('a');
		a.className='nav-item';a.href='#/app-'+app;a.setAttribute('data-integration',app);
		const ico=document.createElement('span');ico.className='nav-ico';ico.innerHTML=ICONS[app]||ICONS.pihole;
		const label=document.createElement('span');label.className='nav-label';label.textContent=INTEGRATIONS[app].label;
		a.append(ico,label);group.appendChild(a);
	}
	createPage(app){
		if(document.getElementById('app-'+app+'-page'))return;
		const page=document.createElement('div');
		page.id='app-'+app+'-page';page.className='page hidden';
		const h=document.createElement('h2');h.textContent=INTEGRATIONS[app].label;
		const content=document.createElement('div');content.id='app-'+app+'-content';
		page.append(h,content);
		document.querySelector('.app-body .content')?.appendChild(page);
	}
	async rpc(o,m,a={}){const [s,r]=await this.core.ubusCall(o,m,a,{timeout:30000});if(s!==0)throw new Error((r&&r.error)||o+'.'+m+' failed');return r||{};}
	async show(app){
		const page=document.getElementById('app-'+app+'-page');
		page?.classList.remove('hidden');
		const root=document.getElementById('app-'+app+'-content');
		if(!root)return;
		if(app==='pihole')await this.renderPihole(root);
		else if(app==='adguard-home')await this.renderAdguard(root);
		else if(app==='uptime-kuma')await this.renderUptimeKuma(root);
	}
	stat(n,label){const c=this.el('div',undefined,'dev-stat stat-card');c.append(this.el('strong',String(n),'dev-stat-n'),this.el('span',label,'dev-stat-l'));return c;}
	openLink(label,info,fallbackPort,path){
		const open=this.el('a',label,'action-btn');
		open.href='http://'+location.hostname+':'+((info&&info.published_ports&&info.published_ports[0])||fallbackPort)+(path||'');
		open.target='_blank';open.rel='noopener';
		return open;
	}
	// ---- Pi-hole -----------------------------------------------------------
	async renderPihole(root){
		root.replaceChildren(this.el('p','Loading Pi-hole statistics…','page-loading'));
		let summary=null,info=null;
		try{summary=await this.fetchApp('pihole','/admin/api.php?summary');}catch(e){}
		try{info=await this.rpc('moci-docker','app_info',{app:'pihole'});}catch(e){}
		root.replaceChildren();
		if(!summary){
			root.append(this.el('div',undefined,'wifi-empty stat-card'));
			root.firstChild.append(this.el('h3','Pi-hole is running, but its API did not respond'),
				this.el('p','This can happen while Pi-hole is still starting. Open the full Pi-hole admin below to manage it directly.','page-note'));
		}else{
			const grid=this.el('div',undefined,'dev-summary');
			grid.append(
				this.stat(this.fmt(summary.dns_queries_today),'DNS queries today'),
				this.stat(this.fmt(summary.ads_blocked_today),'Blocked today'),
				this.stat((summary.ads_percentage_today!=null?Number(summary.ads_percentage_today).toFixed(1):'—')+'%','Block rate'),
				this.stat(this.fmt(summary.domains_being_blocked),'Domains on blocklist')
			);
			root.append(grid);
			const enabled=summary.status==='enabled';
			root.append(this.blockingRow(enabled,async(next)=>{await this.rpc('moci-docker','pihole_blocking',{enable:next});},()=>this.renderPihole(root)));
		}
		this.dnsSection(root,'Pi-hole',info,80,'/admin/','OPEN FULL PI-HOLE ADMIN');
	}
	// ---- AdGuard Home ------------------------------------------------------
	async renderAdguard(root){
		root.replaceChildren(this.el('p','Loading AdGuard Home…','page-loading'));
		let summary=null,info=null,loginRequired=false;
		try{summary=await this.fetchApp('adguard-home','/control/stats');}
		catch(e){loginRequired=/login required/i.test(e.message);}
		try{info=await this.rpc('moci-docker','app_info',{app:'adguard-home'});}catch(e){}
		root.replaceChildren();
		if(loginRequired){
			root.append(this.adguardLoginForm(root));
		}else if(!summary){
			const card=this.el('div',undefined,'wifi-empty stat-card');
			card.append(this.el('h3','AdGuard Home is running, but its API did not respond'),
				this.el('p','It may still be starting. Finish the setup wizard in the full admin (set the DNS listen port to 53), then connect your login below to see live statistics here.','page-note'));
			root.append(card);
			root.append(this.adguardLoginForm(root));
		}else{
			const grid=this.el('div',undefined,'dev-summary');
			grid.append(
				this.stat(this.fmt(summary.dns_queries_today),'DNS queries · 24h'),
				this.stat(this.fmt(summary.ads_blocked_today),'Blocked · 24h'),
				this.stat((summary.ads_percentage_today!=null?Number(summary.ads_percentage_today).toFixed(1):'—')+'%','Block rate'),
				this.stat(this.fmt(summary.unique_clients),'Active clients')
			);
			root.append(grid);
			const enabled=summary.status==='enabled';
			root.append(this.blockingRow(enabled,async(next)=>{await this.rpc('moci-docker','adguard_blocking',{enable:next});},()=>this.renderAdguard(root)));
			if(summary.version)root.append(this.el('p','AdGuard Home '+summary.version+'  ·  average response '+this.ms(summary.avg_processing_time),'page-note'));
			const reconnect=this.el('button','Change AdGuard login','dev-action');reconnect.type='button';
			reconnect.addEventListener('click',()=>{root.replaceChildren(this.adguardLoginForm(root));});
			root.append(reconnect);
		}
		this.dnsSection(root,'AdGuard Home',info,3003,'/','OPEN FULL ADGUARD HOME ADMIN');
	}
	adguardLoginForm(root){
		const card=this.el('div',undefined,'wifi-form stat-card');
		card.append(this.el('h3','Connect your AdGuard Home login'),
			this.el('p','AdGuard Home uses the username and password you created in its setup wizard. Enter them once so Haven can show live blocking statistics and toggle protection. They are stored only on the router (never sent back to the browser) and are used solely to talk to your AdGuard Home container.','page-note'));
		const name=this.el('input');name.className='form-input';name.placeholder='Username';name.autocomplete='username';name.maxLength=100;
		const pass=this.el('input');pass.className='form-input';pass.type='password';pass.placeholder='Password';pass.autocomplete='current-password';pass.maxLength=200;
		const submit=this.el('button','CONNECT','action-btn');submit.type='button';
		const field=(label,input)=>{const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),input);return w;};
		card.append(field('Username',name),field('Password',pass),submit);
		submit.addEventListener('click',async()=>{
			if(!name.value.trim()||!pass.value){this.core.showToast('Enter your AdGuard Home username and password','error');return;}
			submit.disabled=true;
			try{
				await this.rpc('moci-docker','adguard_login',{name:name.value.trim(),password:pass.value});
				this.core.showToast('AdGuard Home connected','success');
				await this.renderAdguard(root);
			}catch(e){this.core.showToast('Could not connect: '+e.message,'error');submit.disabled=false;}
		});
		return card;
	}
	// ---- Uptime Kuma -------------------------------------------------------
	async renderUptimeKuma(root){
		root.replaceChildren(this.el('p','Loading Uptime Kuma…','page-loading'));
		let info=null;
		try{info=await this.rpc('moci-docker','app_info',{app:'uptime-kuma'});}catch(e){}
		root.replaceChildren();
		const card=this.el('div',undefined,'wifi-empty stat-card');
		card.append(this.el('h3','Uptime Kuma is running'),
			this.el('p','Uptime Kuma watches your services and devices and alerts you when something goes down. Create monitors and notification channels (Gotify, email, Telegram and more) in its dashboard. Open it below to set up your first monitor.','page-note'));
		root.append(card);
		root.append(this.el('h3','Open Uptime Kuma'));
		root.append(this.openLink('OPEN UPTIME KUMA DASHBOARD',info,3001,'/'));
		root.append(this.el('p','Tip: point monitors at your router services (for example http://'+location.hostname+':8080) and your published apps to get a single health view of your whole network.','page-note'));
	}
	// ---- shared helpers ----------------------------------------------------
	blockingRow(enabled,apply,reload){
		const row=this.el('div',undefined,'pihole-status-row');
		row.append(this.el('span',enabled?'Blocking is active':'Blocking is disabled','dev-badge '+(enabled?'static':'dynamic')));
		const toggle=this.el('button',enabled?'Disable blocking':'Enable blocking','dev-action');toggle.type='button';
		toggle.addEventListener('click',async()=>{
			toggle.disabled=true;
			try{await apply(!enabled);this.core.showToast(enabled?'Blocking disabled':'Blocking enabled','success');await reload();}
			catch(e){this.core.showToast('Could not change blocking: '+e.message,'error');toggle.disabled=false;}
		});
		row.append(toggle);
		return row;
	}
	dnsSection(root,label,info,fallbackPort,adminPath,openLabel){
		root.append(this.el('h3','Use '+label+' for network DNS'));
		root.append(this.el('p','Route every device’s DNS through '+label+' so blocking applies network-wide. The router’s dnsmasq will forward to the '+label+' container. Keep a fallback in mind: if '+label+' stops, DNS resolution stops too until you revert.','page-note'));
		const dnsRow=this.el('div',undefined,'pihole-dns-row');
		const useBtn=this.el('button','Use '+label+' as DNS','action-btn');useBtn.type='button';
		const revertBtn=this.el('button','Revert to default DNS','dev-action');revertBtn.type='button';
		useBtn.addEventListener('click',()=>this.setAppDns(label,info,true,useBtn));
		revertBtn.addEventListener('click',()=>this.setAppDns(label,info,false,revertBtn));
		dnsRow.append(useBtn,revertBtn);
		if(!info||!info.container_ip){dnsRow.append(this.el('span','Container address unavailable','page-note'));useBtn.disabled=true;}
		root.append(dnsRow);
		root.append(this.el('h3','Full admin'));
		root.append(this.openLink(openLabel,info,fallbackPort,adminPath));
	}
	async fetchApp(app,path){
		const r=await this.rpc('moci-docker','app_fetch',{app,path});
		// The adapter reports application errors as {error} with a zero ubus status.
		if(r&&r.error)throw new Error(r.error);
		try{return JSON.parse(r.body);}catch(e){throw new Error('Unexpected '+app+' response');}
	}
	async setAppDns(label,info,enable,btn){
		if(enable&&(!info||!info.container_ip)){this.core.showToast(label+' container address unavailable','error');return;}
		if(enable&&!window.confirm('Forward all network DNS to '+label+' ('+info.container_ip+')? If '+label+' stops, DNS will stop until you revert.'))return;
		btn.disabled=true;
		try{
			const dhcp=await this.rpc('uci','get',{config:'dhcp'});
			const values=dhcp.values||{};
			const section=Object.keys(values).find(k=>values[k]?.['.type']==='dnsmasq');
			if(!section)throw new Error('dnsmasq section not found');
			if(enable){await this.rpc('uci','set',{config:'dhcp',section,values:{server:[info.container_ip],noresolv:'1'}});}
			else{
				await this.rpc('uci','delete',{config:'dhcp',section,option:'server'}).catch(()=>{});
				await this.rpc('uci','set',{config:'dhcp',section,values:{noresolv:'0'}});
			}
			await this.rpc('uci','commit',{config:'dhcp'});
			await this.rpc('file','exec',{command:'/etc/init.d/dnsmasq',params:['reload']});
			this.core.showToast(enable?'Network DNS now uses '+label:'Reverted to default DNS','success');
		}catch(e){this.core.showToast('DNS change failed: '+e.message,'error');}
		finally{btn.disabled=false;}
	}
	fmt(n){const x=Number(n);if(!isFinite(x))return '—';return x.toLocaleString();}
	ms(s){const x=Number(s);if(!isFinite(x))return '—';return (x*1000).toFixed(1)+' ms';}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
}