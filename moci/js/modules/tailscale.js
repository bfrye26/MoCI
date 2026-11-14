// Tailscale VPN — zero-config mesh VPN. Reads `tailscale status --json`, shows the
// node + peers, and drives connect (tailscale up -> auth URL) / disconnect. The
// tailscale package ships with the firmware update.
export default class TailscaleModule{
	constructor(core){
		this.core=core;
		this.busy=false;
		this.core.registerRoute('/tailscale',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[],timeout=20000){
		const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout});
		if(s!==0)throw new Error('Command denied by router permissions ('+s+')');
		return r||{};
	}
	async show(){
		this.page=document.getElementById('tailscale-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#tailscale-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading Tailscale status…','page-loading'));
		try{
			const [present,status]=await Promise.all([
				this.exec('/usr/libexec/moci-service-inspect',['present']).catch(()=>({stdout:''})),
				this.exec('/usr/sbin/tailscale',['status','--json']).catch(()=>({code:1,stdout:''}))
			]);
			this.installed=String(present.stdout||'').split('\n').map(x=>x.trim()).includes('tailscale');
			this.state=null;
			if(status.code===0&&status.stdout){try{this.state=JSON.parse(status.stdout);}catch{}}
			this.render();
		}catch(e){
			this.root.replaceChildren(this.el('p','Unable to read Tailscale: '+e.message,'page-error'));
		}
	}
	render(){
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);
		root.append(this.el('p','Reach this network securely from anywhere with a Tailscale mesh VPN. Connect once, then this router and its LAN are reachable from your other Tailscale devices.','page-intro'));
		if(!this.installed){
			root.append(this.el('div','The tailscale package is not installed on this firmware yet. Install the latest Haven firmware update, then turn on Tailscale in Features.','addon-empty'));
			return;
		}
		const st=this.state||{};
		const backend=st.BackendState||'Unknown';
		const running=backend==='Running';
		const needsLogin=backend==='NeedsLogin'||backend==='NoState';
		const bar=this.el('div',undefined,'page-toolbar');
		const btn=this.el('button',running?'DISCONNECT':(needsLogin?'CONNECT / LOG IN':'START'),'action-btn'+(running?' danger':''));btn.type='button';
		btn.disabled=this.busy;
		btn.addEventListener('click',()=>running?this.down():this.up());
		const refresh=this.el('button','REFRESH','action-btn');refresh.type='button';
		refresh.addEventListener('click',()=>this.show());
		bar.append(btn,refresh);root.append(bar);
		const summary=this.el('div',undefined,'stat-grid');
		const stat=(n,label)=>{const c=this.el('div',undefined,'stat-card dev-stat');c.append(this.el('strong',n,'dev-stat-n'),this.el('span',label,'dev-stat-l'));return c;};
		summary.append(stat(backend,'State'));
		const self=st.Self||{};
		const ip=(self.TailscaleIPs||[])[0]||'—';
		summary.append(stat(ip,'Tailscale IP'),stat(String(Object.keys(st.Peer||{}).length),'Peers'));
		root.append(summary);
		const authURL=st.AuthURL||this._authURL;
		if(needsLogin&&authURL){
			const box=this.el('div',undefined,'addon-empty');
			box.innerHTML='To finish connecting, open this link and sign in:<br><a href="'+esc(authURL)+'" target="_blank" rel="noopener">'+esc(authURL)+'</a>';
			root.append(box);
		}
		if(self.HostName){
			root.append(this.el('h3','This node'));
			const p=this.el('p',undefined,'page-note');
			p.textContent=(self.HostName||'')+' · '+(self.DNSName||'')+' · '+(self.Online?'online':'offline');
			root.append(p);
		}
		const peers=Object.values(st.Peer||{});
		root.append(this.el('h3','Peers'));
		if(!peers.length){
			root.append(this.el('div','No peers yet. Install Tailscale on your other devices and sign in with the same account.','addon-empty'));
		}else{
			const table=this.el('table',undefined,'data-table');
			const rows=peers.map(p=>`<tr><td><strong>${esc(p.HostName||p.DNSName||'peer')}</strong></td>
				<td class="dev-mono">${esc((p.TailscaleIPs||[])[0]||'—')}</td>
				<td>${p.Online?this.core.renderBadge('success','ONLINE'):this.core.renderBadge('info','OFFLINE')}</td>
				<td>${esc(p.Os||'')}</td></tr>`).join('');
			table.innerHTML='<thead><tr><th>Device</th><th>Tailscale IP</th><th>State</th><th>OS</th></tr></thead><tbody>'+rows+'</tbody>';
			root.append(table);
		}
	}
	async up(){
		if(this.busy)return;this.busy=true;this.render();
		try{
			// tailscale up prints an auth URL then waits; capture the URL even if the
			// call times out — tailscaled keeps the login pending in the background.
			const r=await this.exec('/usr/sbin/tailscale',['up'],12000).catch(e=>({stdout:'',stderr:String(e.message||'')}));
			const out=String(r.stdout||'')+'\n'+String(r.stderr||'');
			const m=/https:\/\/login\.tailscale\.com\/\S+/.exec(out);
			if(m)this._authURL=m[0];
			this.core.showToast(m?'Open the login link to finish connecting':'Tailscale start requested','info');
		}catch(e){
			this.core.showToast('Could not start Tailscale: '+e.message,'error');
		}finally{
			this.busy=false;await this.show();
		}
	}
	async down(){
		if(this.busy)return;this.busy=true;this.render();
		try{
			await this.exec('/usr/sbin/tailscale',['down']);
			this.core.showToast('Tailscale disconnected','success');
		}catch(e){
			this.core.showToast('Could not stop Tailscale: '+e.message,'error');
		}finally{
			this.busy=false;await this.show();
		}
	}
}