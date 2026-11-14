// Native in-UI integrations for select running apps. Detects active managed apps
// that have an integration, adds a sidebar entry, and renders a live panel inside
// MoCI (no separate URL). App APIs are fetched through the restricted moci-docker
// app_fetch proxy, so HTTP app endpoints work from the HTTPS UI without CORS issues.
const ICONS={
	pihole:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/><path d="M9 12l2 2 4-4"/></svg>'
};
const INTEGRATIONS={pihole:{label:'Pi-hole'}};
export default class AppIntegrationsModule{
	constructor(core){
		this.core=core;this.active=[];
	}
	async init(){
		try{
			const [s,r]=await this.core.ubusCall('moci-docker','managed_stacks',{});
			if(s!==0)return;
			for(const stack of (r.managed_stacks||[])){
				if(INTEGRATIONS[stack.name]&&stack.running){
					this.active.push(stack.name);
					this.injectNav(stack.name);
					this.createPage(stack.name);
					this.core.registerRoute('/app-'+stack.name,()=>this.show(stack.name));
				}
			}
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
	}
	async renderPihole(root){
		root.replaceChildren(this.el('p','Loading Pi-hole statistics…','page-loading'));
		let summary=null,info=null;
		try{summary=await this.fetchPihole('/admin/api.php?summary');}catch(e){}
		try{info=await this.rpc('moci-docker','app_info',{app:'pihole'});}catch(e){}
		root.replaceChildren();
		if(!summary){
			root.append(this.el('div',undefined,'wifi-empty stat-card'));
			root.firstChild.append(this.el('h3','Pi-hole is running, but its API did not respond'),
				this.el('p','This can happen with Pi-hole v6 (which uses a different, authenticated API) or while it is still starting. Open the full Pi-hole admin below to manage it directly.','page-note'));
		}else{
			const grid=this.el('div',undefined,'dev-summary');
			const stat=(n,label)=>{const c=this.el('div',undefined,'dev-stat stat-card');c.append(this.el('strong',String(n),'dev-stat-n'),this.el('span',label,'dev-stat-l'));return c;};
			grid.append(
				stat(this.fmt(summary.dns_queries_today),'DNS queries today'),
				stat(this.fmt(summary.ads_blocked_today),'Blocked today'),
				stat((summary.ads_percentage_today!=null?Number(summary.ads_percentage_today).toFixed(1):'—')+'%','Block rate'),
				stat(this.fmt(summary.domains_being_blocked),'Domains on blocklist')
			);
			root.append(grid);
			const statusRow=this.el('div',undefined,'pihole-status-row');
			const enabled=summary.status==='enabled';
			statusRow.append(this.el('span',enabled?'Blocking is active':'Blocking is disabled','dev-badge '+(enabled?'static':'dynamic')));
			const toggle=this.el('button',enabled?'Disable blocking':'Enable blocking','dev-action');toggle.type='button';
			toggle.addEventListener('click',async()=>{
				toggle.disabled=true;
				try{await this.rpc('moci-docker','pihole_blocking',{enable:!enabled});this.core.showToast(enabled?'Blocking disabled':'Blocking enabled','success');await this.renderPihole(root);}
				catch(e){this.core.showToast('Could not change blocking: '+e.message,'error');toggle.disabled=false;}
			});
			statusRow.append(toggle);
			root.append(statusRow);
		}
		// Use as network DNS
		root.append(this.el('h3','Use Pi-hole for network DNS'));
		root.append(this.el('p','Route every device’s DNS through Pi-hole so blocking applies network-wide. The router’s dnsmasq will forward to the Pi-hole container. Keep a fallback in mind: if Pi-hole stops, DNS resolution stops too until you revert.','page-note'));
		const dnsRow=this.el('div',undefined,'pihole-dns-row');
		const useBtn=this.el('button','Use Pi-hole as DNS','action-btn');useBtn.type='button';
		const revertBtn=this.el('button','Revert to default DNS','dev-action');revertBtn.type='button';
		useBtn.addEventListener('click',()=>this.setPiholeDns(info,true,useBtn));
		revertBtn.addEventListener('click',()=>this.setPiholeDns(info,false,revertBtn));
		dnsRow.append(useBtn,revertBtn);
		if(!info||!info.container_ip){dnsRow.append(this.el('span','Container address unavailable','page-note'));useBtn.disabled=true;}
		root.append(dnsRow);
		// Open admin
		const open=this.el('a','OPEN FULL PI-HOLE ADMIN','action-btn');
		open.href='http://'+location.hostname+':'+((info&&info.published_ports&&info.published_ports[0])||80)+'/admin/';
		open.target='_blank';open.rel='noopener';
		root.append(this.el('h3','Full admin'));root.append(open);
	}
	async fetchPihole(path){
		const r=await this.rpc('moci-docker','app_fetch',{app:'pihole',path});
		try{return JSON.parse(r.body);}catch(e){throw new Error('Unexpected Pi-hole response');}
	}
	async setPiholeDns(info,enable,btn){
		if(enable&&(!info||!info.container_ip)){this.core.showToast('Pi-hole container address unavailable','error');return;}
		if(enable&&!window.confirm('Forward all network DNS to Pi-hole ('+info.container_ip+')? If Pi-hole stops, DNS will stop until you revert.'))return;
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
			this.core.showToast(enable?'Network DNS now uses Pi-hole':'Reverted to default DNS','success');
		}catch(e){this.core.showToast('DNS change failed: '+e.message,'error');}
		finally{btn.disabled=false;}
	}
	fmt(n){const x=Number(n);if(!isFinite(x))return '—';return x.toLocaleString();}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
}
