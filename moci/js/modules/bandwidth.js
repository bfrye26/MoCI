// Bandwidth Monitor — per-device traffic accounting from nlbwmon. Reads the live
// accounting database via the read-only nlbwmon-action helper (JSON), aggregates
// by device, and shows top talkers, totals and a protocol breakdown.
const normMac=v=>String(v||'').trim().toLowerCase();
export default class BandwidthModule{
	constructor(core){
		this.core=core;
		this.core.registerRoute('/bandwidth',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){
		const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:30000});
		if(s!==0)throw new Error('Command denied by router permissions ('+s+')');
		return r||{};
	}
	async show(){
		this.page=document.getElementById('bandwidth-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#bandwidth-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading traffic accounting…','page-loading'));
		try{
			const [dl,oui]=await Promise.all([
				this.exec('/usr/libexec/nlbwmon-action',['download','-f','json']),
				import('./oui-data.js?v=1.0.0r4').then(m=>m.default).catch(()=>({}))
			]);
			this.oui=oui||{};
			if(dl.code!==0)throw new Error(String(dl.stderr||'nlbwmon is not running. Turn on Bandwidth Monitor in Features.'));
			this.rows=this.parse(String(dl.stdout||''));
			this.render();
		}catch(e){
			this.root.replaceChildren(this.el('p','Unable to read bandwidth data: '+e.message,'page-error'));
		}
	}
	parse(text){
		let obj;try{obj=JSON.parse(text);}catch{throw new Error('nlbwmon returned no data. Enable it in Features and give it a moment to collect traffic.');}
		const cols=obj.columns||[];const idx={};cols.forEach((c,i)=>idx[c]=i);
		const byDev=new Map();const byProto=new Map();
		let totRx=0,totTx=0;
		for(const row of (obj.data||[])){
			const mac=normMac(row[idx.mac]);const ip=String(row[idx.ip]||'');
			const rx=Number(row[idx.rx_bytes])||0;const tx=Number(row[idx.tx_bytes])||0;
			const conns=Number(row[idx.conns])||0;const l7=row[idx.layer7]||'Other';
			// Skip the router's own zero-MAC interface rows for the per-device list.
			if(mac&&mac!=='00:00:00:00:00:00'){
				const key=mac+'|'+ip;
				const d=byDev.get(key)||{mac,ip,rx:0,tx:0,conns:0};
				d.rx+=rx;d.tx+=tx;d.conns+=conns;byDev.set(key,d);
			}
			totRx+=rx;totTx+=tx;
			byProto.set(l7,(byProto.get(l7)||0)+rx+tx);
		}
		const devices=[...byDev.values()].sort((a,b)=>(b.rx+b.tx)-(a.rx+a.tx));
		const protos=[...byProto.entries()].map(([name,bytes])=>({name,bytes})).sort((a,b)=>b.bytes-a.bytes);
		return {devices,protos,totRx,totTx};
	}
	vendor(mac){
		const p=normMac(mac).split(':').slice(0,3).join(':');
		const first=parseInt(p.split(':')[0],16);
		if(Number.isFinite(first)&&(first&0x02))return 'Private / randomized MAC';
		return this.oui[p]||'Unknown vendor';
	}
	render(){
		const {devices,protos,totRx,totTx}=this.rows;
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);const fb=b=>this.core.formatBytes(b);
		const bar=this.el('div',undefined,'page-toolbar');
		const refresh=this.el('button','REFRESH','action-btn');refresh.type='button';
		refresh.addEventListener('click',()=>this.show());
		bar.append(refresh);root.append(bar);
		const summary=this.el('div',undefined,'dev-summary');
		const stat=(n,label)=>{const c=this.el('div',undefined,'dev-stat stat-card');c.append(this.el('strong',n,'dev-stat-n'),this.el('span',label,'dev-stat-l'));return c;};
		summary.append(stat(fb(totRx),'Downloaded'),stat(fb(totTx),'Uploaded'),stat(String(devices.length),'Devices seen'));
		root.append(summary);
		root.append(this.el('h3','Top devices by traffic'));
		root.append(this.el('p','Accounting since nlbwmon started (resets on reboot / commit). Values are cumulative, not live speed.','page-note'));
		const table=this.el('table',undefined,'data-table');
		const top=devices.slice(0,50);
		const body=top.length?top.map(d=>`<tr>
			<td><span class="dev-name">${esc(this.vendor(d.mac))}</span><span class="dev-mono dev-res-meta">${esc(d.mac)}</span></td>
			<td class="dev-mono">${esc(d.ip)}</td>
			<td>${esc(fb(d.rx))}</td><td>${esc(fb(d.tx))}</td>
			<td><strong>${esc(fb(d.rx+d.tx))}</strong></td><td>${d.conns}</td></tr>`).join('')
			:'<tr><td colspan="6" class="page-note">No traffic recorded yet</td></tr>';
		table.innerHTML='<thead><tr><th>Device</th><th>IP</th><th>Download</th><th>Upload</th><th>Total</th><th>Connections</th></tr></thead><tbody>'+body+'</tbody>';
		root.append(table);
		root.append(this.el('h3','Traffic by protocol'));
		const max=protos[0]?.bytes||1;
		const list=this.el('div',undefined,'bw-proto-list');
		for(const p of protos.slice(0,12)){
			const row=this.el('div',undefined,'bw-proto-row');
			const pct=Math.max(2,Math.round(p.bytes/max*100));
			row.innerHTML=`<span class="bw-proto-name">${esc(p.name)}</span>
				<span class="bw-proto-bar"><span style="width:${pct}%"></span></span>
				<span class="bw-proto-bytes">${esc(fb(p.bytes))}</span>`;
			list.append(row);
		}
		root.append(list);
	}
}