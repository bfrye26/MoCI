// Ad Blocking — native control for the adblock package. Shows status and blocked
// counts, toggles blocking, and lists the configured blocklist sources. adblock
// ships with the firmware update; until then this page explains how to enable it.
export default class AdblockModule{
	constructor(core){
		this.core=core;
		this.busy=false;
		this.core.registerRoute('/adblock',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){
		const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:30000});
		if(s!==0)throw new Error('Command denied by router permissions ('+s+')');
		return r||{};
	}
	async show(){
		this.page=document.getElementById('adblock-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#adblock-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading ad-blocker status…','page-loading'));
		try{
			const [present,cfg,status]=await Promise.all([
				this.exec('/usr/libexec/moci-service-inspect',['present']).catch(()=>({stdout:''})),
				this.core.uciGet('adblock').catch(()=>[1,{values:{}}]),
				this.exec('/etc/init.d/adblock',['status']).catch(()=>({code:1,stdout:''}))
			]);
			this.installed=String(present.stdout||'').split('\n').map(x=>x.trim()).includes('adblock');
			this.cfg=(cfg[0]===0&&cfg[1]?.values)?cfg[1].values:{};
			this.status=String(status.stdout||'');
			this.render();
		}catch(e){
			this.root.replaceChildren(this.el('p','Unable to read ad-blocker: '+e.message,'page-error'));
		}
	}
	global(){return this.cfg.global||{};}
	isEnabled(){return String(this.global().adb_enabled)==='1';}
	render(){
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);
		root.append(this.el('p','Network-wide DNS blocking of ads, trackers and malware. Blocking applies to every device that uses this router for DNS.','page-intro'));
		if(!this.installed){
			root.append(this.el('div','The adblock package is not installed on this firmware yet. Install the latest Haven firmware update, then turn on Ad Blocking in Features.','addon-empty'));
			return;
		}
		const bar=this.el('div',undefined,'page-toolbar');
		const on=this.isEnabled();
		const toggle=this.el('button',on?'TURN BLOCKING OFF':'TURN BLOCKING ON','action-btn'+(on?' danger':''));toggle.type='button';
		toggle.disabled=this.busy;
		toggle.addEventListener('click',()=>this.setEnabled(!on));
		const refresh=this.el('button','REFRESH','action-btn');refresh.type='button';
		refresh.addEventListener('click',()=>this.show());
		bar.append(toggle,refresh);root.append(bar);
		const running=/status\s*:\s*active/i.test(this.status)||/running/i.test(this.status);
		const summary=this.el('div',undefined,'stat-grid');
		const stat=(n,label)=>{const c=this.el('div',undefined,'stat-card dev-stat');c.append(this.el('strong',n,'dev-stat-n'),this.el('span',label,'dev-stat-l'));return c;};
		summary.append(stat(on?'ON':'OFF','Blocking'),stat(running?'Active':'Inactive','Service'));
		const count=/([\d.,]+)\s*(domains|blocked)/i.exec(this.status);
		if(count)summary.append(stat(count[1],'Domains in blocklist'));
		root.append(summary);
		root.append(this.el('h3','Status'));
		const pre=this.el('pre',undefined,'log-view');pre.textContent=this.status.trim()||'No status returned. Enable blocking and refresh.';
		root.append(pre);
		const sources=Object.entries(this.cfg).filter(([,v])=>v?.['.type']==='source');
		root.append(this.el('h3','Blocklist sources'));
		if(!sources.length){
			root.append(this.el('div','No sources configured. adblock uses its default source set; edit /etc/config/adblock to customise.','addon-empty'));
		}else{
			const table=this.el('table',undefined,'data-table');
			const rows=sources.map(([id,v])=>`<tr><td>${esc(id)}</td>
				<td>${String(v.enabled)==='1'?this.core.renderBadge('success','ENABLED'):this.core.renderBadge('info','DISABLED')}</td>
				<td class="dev-mono">${esc(v.adb_src||v.url||'—')}</td></tr>`).join('');
			table.innerHTML='<thead><tr><th>Source</th><th>State</th><th>URL</th></tr></thead><tbody>'+rows+'</tbody>';
			root.append(table);
		}
	}
	async setEnabled(on){
		if(this.busy)return;this.busy=true;this.render();
		try{
			await this.core.uciSet('adblock','global',{adb_enabled:on?'1':'0'});
			await this.core.uciCommit('adblock');
			await this.exec('/etc/init.d/adblock',[on?'start':'stop']).catch(()=>{});
			await this.exec('/etc/init.d/adblock',['reload']).catch(()=>{});
			this.core.showToast('Ad blocking '+(on?'enabled':'disabled'),'success');
		}catch(e){
			this.core.showToast('Could not update adblock: '+e.message,'error');
		}finally{
			this.busy=false;await this.show();
		}
	}
}