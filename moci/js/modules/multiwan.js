// Multi-WAN / Failover — mwan3 status and policy overview. Reads the live
// `mwan3 status` report plus the mwan3 UCI config (interfaces / policies / rules).
export default class MultiwanModule{
	constructor(core){
		this.core=core;
		this.core.registerRoute('/multiwan',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){
		const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:20000});
		if(s!==0)throw new Error('Command denied by router permissions ('+s+')');
		return r||{};
	}
	async show(){
		this.page=document.getElementById('multiwan-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#multiwan-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading Multi-WAN status…','page-loading'));
		try{
			const [status,cfg]=await Promise.all([
				this.exec('/usr/sbin/mwan3',['status']).catch(()=>({code:1,stdout:''})),
				this.core.uciGet('mwan3').catch(()=>[1,{values:{}}])
			]);
			this.cfg=(cfg[0]===0&&cfg[1]?.values)?cfg[1].values:{};
			this.status=this.parseStatus(String(status.stdout||''));
			this.render(status.code===0);
		}catch(e){
			this.root.replaceChildren(this.el('p','Unable to read Multi-WAN status: '+e.message,'page-error'));
		}
	}
	parseStatus(text){
		const interfaces=[];const policies=[];
		let section='';let current=null;
		for(const line of text.split('\n')){
			const t=line.trim();
			if(/^Interface status:/i.test(t)){section='iface';continue;}
			if(/^Current ipv4 policies:/i.test(t)){section='pol';continue;}
			if(/^Current ipv6 policies:/i.test(t)){section='pol6';continue;}
			if(/^Local rules:/i.test(t)||/^Rule/i.test(t)){section='rules';continue;}
			if(section==='iface'){
				const m=/^interface\s+(\S+)\s+is\s+(\w+)/i.exec(t);
				if(m)interfaces.push({name:m[1],state:m[2].toLowerCase(),detail:t});
			}else if(section==='pol'||section==='pol6'){
				if(/:$/.test(t)&&!/\(/.test(t)){current={name:t.replace(/:$/,''),members:[],ipv6:section==='pol6'};policies.push(current);}
				else if(current&&t){current.members.push(t);}
			}
		}
		return {interfaces,policies};
	}
	render(hasStatus){
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);
		const bar=this.el('div',undefined,'page-toolbar');
		const refresh=this.el('button','REFRESH','action-btn');refresh.type='button';
		refresh.addEventListener('click',()=>this.show());
		bar.append(refresh);root.append(bar);
		root.append(this.el('p','Load-balance and fail over across multiple WAN uplinks. Interfaces are tracked and traffic follows the policies below. Configure interfaces and policies in /etc/config/mwan3 (Advanced Config) or LuCI.','page-intro'));
		if(!hasStatus){
			root.append(this.el('div','mwan3 is not running. Turn on Multi-WAN in Features, then add at least two WAN interfaces.','addon-empty'));
		}
		root.append(this.el('h3','WAN interfaces'));
		const {interfaces,policies}=this.status;
		if(!interfaces.length){
			root.append(this.el('div','No tracked interfaces reported yet.','addon-empty'));
		}else{
			const grid=this.el('div',undefined,'stat-grid');
			for(const i of interfaces){
				const online=i.state==='online';
				const card=this.el('div',undefined,'stat-card dev-stat');
				card.append(this.el('strong',i.name,'dev-stat-n'));
				const badge=this.core.renderBadge(online?'success':(i.state==='offline'?'error':'info'),i.state.toUpperCase());
				const wrap=this.el('div');wrap.innerHTML=badge;card.append(wrap);
				grid.append(card);
			}
			root.append(grid);
		}
		root.append(this.el('h3','Policies'));
		if(!policies.length){
			root.append(this.el('div','No policies reported.','addon-empty'));
		}else{
			const table=this.el('table',undefined,'data-table');
			const rows=policies.map(p=>`<tr><td><strong>${esc(p.name)}</strong>${p.ipv6?' <span class="dev-badge dynamic">IPv6</span>':''}</td>
				<td>${p.members.map(m=>esc(m)).join('<br>')||'—'}</td></tr>`).join('');
			table.innerHTML='<thead><tr><th>Policy</th><th>Members / weight</th></tr></thead><tbody>'+rows+'</tbody>';
			root.append(table);
		}
		const rules=Object.entries(this.cfg).filter(([,v])=>v?.['.type']==='rule');
		if(rules.length){
			root.append(this.el('h3','Rules'));
			const table=this.el('table',undefined,'data-table');
			const rows=rules.map(([id,v])=>`<tr><td>${esc(id)}</td><td class="dev-mono">${esc(v.src_ip||'any')} → ${esc(v.dest_ip||'any')}</td>
				<td>${esc(v.use_policy||'—')}</td></tr>`).join('');
			table.innerHTML='<thead><tr><th>Rule</th><th>Match</th><th>Policy</th></tr></thead><tbody>'+rows+'</tbody>';
			root.append(table);
		}
	}
}