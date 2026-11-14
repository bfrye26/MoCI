// Statistics / Graphs — collectd metrics rendered from the RRD archives. Lists the
// available RRD files, lets you pick a metric and timespan, and draws an SVG line
// chart from `rrdtool fetch`. Read-only.
export default class StatisticsModule{
	constructor(core){
		this.core=core;
		this.span='3h';
		this.core.registerRoute('/statistics',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){
		const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:20000});
		if(s!==0)throw new Error('Command denied by router permissions ('+s+')');
		return r||{};
	}
	async show(){
		this.page=document.getElementById('statistics-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#statistics-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Discovering collected metrics…','page-loading'));
		try{
			const r=await this.exec('/usr/bin/find',['/tmp/rrd','-name','*.rrd']);
			this.files=String(r.stdout||'').split('\n').map(x=>x.trim()).filter(Boolean).sort();
			if(!this.files.length){
				this.root.replaceChildren(this.el('div','No statistics yet. Turn on Statistics in Features and give collectd a minute to record data.','addon-empty'));
				return;
			}
			if(!this.selected||!this.files.includes(this.selected))this.selected=this.pickDefault();
			this.render();
			await this.draw();
		}catch(e){
			this.root.replaceChildren(this.el('p','Unable to read statistics: '+e.message,'page-error'));
		}
	}
	pickDefault(){
		const pref=[/load\/load\.rrd$/,/cpu-0\/percent-idle\.rrd$/,/memory\/memory-used\.rrd$/,/interface-.*if_octets\.rrd$/];
		for(const re of pref){const f=this.files.find(x=>re.test(x));if(f)return f;}
		return this.files[0];
	}
	label(file){
		// /tmp/rrd/<host>/<plugin>/<metric>.rrd -> "plugin / metric"
		const parts=file.split('/');
		const metric=(parts[parts.length-1]||'').replace(/\.rrd$/,'');
		const plugin=parts[parts.length-2]||'';
		return plugin+' / '+metric;
	}
	render(){
		const root=this.root;root.replaceChildren();
		root.append(this.el('p','Historical system metrics recorded by collectd. Pick a metric and a time range.','page-intro'));
		const bar=this.el('div',undefined,'page-toolbar');
		const metricSel=this.el('select',undefined,'stat-select');
		for(const f of this.files){const o=this.el('option',this.label(f));o.value=f;if(f===this.selected)o.selected=true;metricSel.append(o);}
		metricSel.addEventListener('change',()=>{this.selected=metricSel.value;this.draw();});
		const spanSel=this.el('select',undefined,'stat-select');
		for(const [v,l] of [['1h','Last hour'],['3h','Last 3 hours'],['12h','Last 12 hours'],['24h','Last day'],['7d','Last week']]){
			const o=this.el('option',l);o.value=v;if(v===this.span)o.selected=true;spanSel.append(o);
		}
		spanSel.addEventListener('change',()=>{this.span=spanSel.value;this.draw();});
		const refresh=this.el('button','REFRESH','action-btn');refresh.type='button';
		refresh.addEventListener('click',()=>this.show());
		bar.append(metricSel,spanSel,refresh);root.append(bar);
		this.chart=this.el('div',undefined,'stat-chart');
		root.append(this.chart);
	}
	async draw(){
		if(!this.chart)return;
		this.chart.replaceChildren(this.el('p','Loading graph…','page-loading'));
		try{
			const r=await this.exec('/usr/bin/rrdtool',['fetch',this.selected,'AVERAGE','-s','-'+this.span]);
			if(r.code!==0)throw new Error(String(r.stderr||'rrdtool fetch failed'));
			const pts=this.parse(String(r.stdout||''));
			this.chart.replaceChildren(this.svg(pts));
		}catch(e){
			this.chart.replaceChildren(this.el('p','Could not draw graph: '+e.message,'page-error'));
		}
	}
	parse(text){
		const pts=[];
		for(const line of text.split('\n')){
			const m=/^(\d+):\s*(.+)$/.exec(line.trim());
			if(!m)continue;
			const t=Number(m[1]);
			const vals=m[2].trim().split(/\s+/).map(Number).filter(v=>Number.isFinite(v));
			if(!vals.length)continue;
			// Most metrics have one DS; if several, sum them (e.g. rx+tx octets).
			const v=vals.reduce((a,b)=>a+b,0);
			pts.push({t,v});
		}
		return pts;
	}
	svg(pts){
		const NS='http://www.w3.org/2000/svg';
		const W=760,H=260,P=46;
		const svg=document.createElementNS(NS,'svg');
		svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('class','stat-svg');
		const mk=(tag,attrs)=>{const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
		if(pts.length<2){
			const t=mk('text',{x:W/2,y:H/2,'text-anchor':'middle',fill:'currentColor','font-size':'13'});
			t.textContent='Not enough data points in this range yet.';svg.append(t);return svg;
		}
		const ts=pts.map(p=>p.t),vs=pts.map(p=>p.v);
		const t0=Math.min(...ts),t1=Math.max(...ts);
		let v0=Math.min(...vs),v1=Math.max(...vs);
		if(v0===v1){v0-=1;v1+=1;}
		const pad=(v1-v0)*0.08;v0-=pad;v1+=pad;
		const X=t=>P+(t-t0)/Math.max(1,(t1-t0))*(W-P-14);
		const Y=v=>H-30-(v-v0)/(v1-v0)*(H-30-16);
		// gridlines + y labels
		for(let i=0;i<=4;i++){
			const v=v0+(v1-v0)*i/4;const y=Y(v);
			svg.append(mk('line',{x1:P,y1:y,x2:W-14,y2:y,stroke:'currentColor','stroke-opacity':'0.12'}));
			const lbl=mk('text',{x:P-8,y:y+4,'text-anchor':'end',fill:'currentColor','font-size':'10','fill-opacity':'0.7'});
			lbl.textContent=this.fmt(v);svg.append(lbl);
		}
		const d=pts.map((p,i)=>(i?'L':'M')+X(p.t).toFixed(1)+' '+Y(p.v).toFixed(1)).join(' ');
		svg.append(mk('path',{d,fill:'none',stroke:'var(--primary-accent)','stroke-width':'2'}));
		const area=d+' L'+X(t1).toFixed(1)+' '+(H-30)+' L'+X(t0).toFixed(1)+' '+(H-30)+' Z';
		svg.append(mk('path',{d:area,fill:'var(--primary-accent)','fill-opacity':'0.12',stroke:'none'}));
		const fmtT=t=>{const d=new Date(t*1000);return (this.span==='7d')?(d.getMonth()+1)+'/'+d.getDate():String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};
		for(const t of [t0,(t0+t1)/2,t1]){
			const lbl=mk('text',{x:X(t),y:H-8,'text-anchor':'middle',fill:'currentColor','font-size':'10','fill-opacity':'0.7'});
			lbl.textContent=fmtT(t);svg.append(lbl);
		}
		return svg;
	}
	fmt(v){
		const a=Math.abs(v);
		if(a>=1e9)return (v/1e9).toFixed(1)+'G';
		if(a>=1e6)return (v/1e6).toFixed(1)+'M';
		if(a>=1e3)return (v/1e3).toFixed(1)+'k';
		if(a>=10)return v.toFixed(0);
		return v.toFixed(2);
	}
}