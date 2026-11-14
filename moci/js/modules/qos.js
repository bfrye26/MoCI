// Traffic & QoS — live interface throughput plus SQM smart queue management.
// SQM (cake / fq_codel) fights bufferbloat so gaming and video calls stay responsive
// even while the link is busy. Traffic is read from /proc/net/dev; SQM is UCI-owned.
export default class QosModule{
	constructor(core){
		this.core=core;this.busy=false;this._timer=null;this._prev=null;
		this.core.registerRoute('/qos',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async rpc(o,m,a={}){const [s,r]=await this.core.ubusCall(o,m,a,{timeout:30000});if(s!==0)throw new Error(o+'.'+m+' failed ('+s+')');return r||{};}
	async uci(m,a){return this.rpc('uci',m,a);}
	async show(){
		this.page=document.getElementById('qos-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#qos-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading traffic and queue settings…','page-loading'));
		try{
			const [sqm,net,svc]=await Promise.all([
				this.uci('get',{config:'sqm'}).catch(()=>({values:{}})),
				this.uci('get',{config:'network'}).catch(()=>({values:{}})),
				this.core.ubusCall('service','list',{verbose:true},{timeout:8000}).catch(()=>[1,{}])
			]);
			this.sqm=sqm.values||{};
			this.wanDevice=(net.values?.wan||{}).device||'eth1';
			this.queue=Object.entries(this.sqm).find(([,v])=>v?.['.type']==='queue')||null;
			const inst=(svc[0]===0&&svc[1]?.sqm?.instances)?Object.values(svc[1].sqm.instances):[];
			this.sqmRunning=inst.some(i=>i?.running===true);
			this.render();
			this.startTraffic();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read QoS: '+e.message,'page-error'));}
	}
	stopTraffic(){if(this._timer){clearInterval(this._timer);this._timer=null;}}
	startTraffic(){
		this.stopTraffic();this._prev=null;
		const tick=async()=>{
			if(!this.page||this.page.classList.contains('hidden')){this.stopTraffic();return;}
			try{
				const r=await this.rpc('file','read',{path:'/proc/net/dev'});
				const now=this.parseDev(r.data||'');
				if(this._prev){this.renderRates(now,this._prev);}
				this._prev={t:Date.now(),stats:now};
			}catch(e){/* transient read errors are non-fatal */}
		};
		tick();
		this._timer=setInterval(tick,3000);
	}
	parseDev(text){
		const out={};
		for(const line of String(text).split('\n')){
			const m=line.match(/^\s*([\w.-]+):\s*(.*)$/);if(!m)continue;
			const nums=m[2].trim().split(/\s+/).map(Number);
			if(nums.length<16)continue;
			out[m[1]]={rx:nums[0],tx:nums[8]};
		}
		return out;
	}
	fmtRate(bps){
		if(bps>=1e9)return (bps/1e9).toFixed(2)+' Gbps';
		if(bps>=1e6)return (bps/1e6).toFixed(2)+' Mbps';
		if(bps>=1e3)return (bps/1e3).toFixed(1)+' kbps';
		return Math.round(bps)+' bps';
	}
	renderRates(now,prev){
		const dt=(Date.now()-prev.t)/1000;if(dt<=0)return;
		const rate=(iface,dir)=>{
			const a=prev.stats[iface],b=now[iface];if(!a||!b)return 0;
			return Math.max(0,(b[dir]-a[dir])*8/dt);
		};
		const set=(id,val)=>{const e=this.root.querySelector('#'+id);if(e)e.textContent=this.fmtRate(val);};
		set('qos-wan-down',rate(this.wanDevice,'rx'));
		set('qos-wan-up',rate(this.wanDevice,'tx'));
		set('qos-lan-down',rate('br-lan','tx'));
		set('qos-lan-up',rate('br-lan','rx'));
	}
	render(){
		const root=this.root;root.replaceChildren();
		// Live traffic
		root.append(this.el('h3','Live traffic'));
		const grid=this.el('div',undefined,'qos-traffic');
		const card=(label,downId,upId)=>{
			const c=this.el('div',undefined,'qos-traffic-card stat-card');
			c.append(this.el('span',label,'dev-stat-l'));
			const row=this.el('div',undefined,'qos-rate-row');
			const down=this.el('div',undefined,'qos-rate');down.append(this.el('span','↓','qos-arrow down'),this.el('strong','—','qos-rate-v'));down.lastChild.id=downId;
			const up=this.el('div',undefined,'qos-rate');up.append(this.el('span','↑','qos-arrow up'),this.el('strong','—','qos-rate-v'));up.lastChild.id=upId;
			row.append(down,up);c.append(row);
			return c;
		};
		grid.append(card('Internet (WAN)','qos-wan-down','qos-wan-up'),card('Local network (LAN)','qos-lan-down','qos-lan-up'));
		root.append(grid);

		// QoS / SQM
		root.append(this.el('h3','Smart Queue Management (QoS)'));
		const status=this.el('div',undefined,'page-toolbar');
		status.innerHTML=this.core.renderBadge(this.sqmRunning?'success':'info',this.sqmRunning?'SQM SERVICE RUNNING':'SQM SERVICE STOPPED');
		root.append(status);
		root.append(this.el('p','SQM keeps latency low under load by managing the queue ahead of your modem — it prevents the “bufferbloat” lag that hits games and video calls when someone downloads or streams. Set the limits slightly below your real line speed. The SQM service can also be turned on/off from Features.','page-note'));
		const q=this.queue?this.queue[1]:null;
		const form=this.el('form',undefined,'qos-form stat-card');
		const enabled=this.el('input');enabled.type='checkbox';enabled.checked=q?q.enabled==='1':false;
		const enLabel=this.el('label',undefined,'profiles-check');enLabel.append(enabled,this.el('span','Enable Smart Queue Management'));
		const down=this.el('input');down.type='number';down.min='1';down.className='form-input';down.value=q&&q.download?Math.round(q.download/1000):'';down.placeholder='e.g. 100';
		const up=this.el('input');up.type='number';up.min='1';up.className='form-input';up.value=q&&q.upload?Math.round(q.upload/1000):'';up.placeholder='e.g. 20';
		const qdisc=this.el('select');qdisc.className='form-input';
		for(const [val,label] of [['cake','CAKE (recommended — best for latency)'],['fq_codel','FQ-CoDel (lighter)']]){
			const o=this.el('option',label);o.value=val;qdisc.append(o);
		}
		qdisc.value=q?.qdisc||'cake';
		form.append(enLabel,this.field('Download limit (Mbps)',down,'Your real download speed minus ~5%.'),
			this.field('Upload limit (Mbps)',up,'Your real upload speed minus ~5%.'),this.field('Queue discipline',qdisc));
		const save=this.el('button','SAVE & APPLY QoS','action-btn');save.type='submit';
		form.append(save);
		form.addEventListener('submit',async e=>{
			e.preventDefault();if(this.busy)return;
			await this.saveQos({enabled:enabled.checked,download:down.value,upload:up.value,qdisc:qdisc.value},save);
		});
		root.append(form);
		root.append(this.el('p','CAKE automatically shares bandwidth fairly between devices and prioritizes latency-sensitive flows, so a busy download won’t make a video call stutter. For per-device rules, reserve the device a static IP under Devices first.','page-note'));
	}
	field(label,input,hint){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),input);if(hint)w.append(this.el('small',hint,'wan-field-hint'));return w;}
	async saveQos({enabled,download,upload,qdisc},save){
		const dl=Number(download),ul=Number(upload);
		if(enabled&&(!Number.isFinite(dl)||dl<=0||!Number.isFinite(ul)||ul<=0)){
			this.core.showToast('Enter download and upload limits in Mbps','error');return;
		}
		if(enabled&&!window.confirm('Enable QoS at '+dl+' Mbps down / '+ul+' Mbps up? This reshapes the WAN queue.'))return;
		this.busy=true;save.disabled=true;
		try{
			let section=this.queue?this.queue[0]:null;
			if(!section){const r=await this.uci('add',{config:'sqm',type:'queue'});section=r.section;}
			const values={interface:this.wanDevice,enabled:enabled?'1':'0',qdisc,script:qdisc==='cake'?'piece_of_cake.qos':'simple.qos'};
			if(enabled){values.download=String(Math.round(dl*1000));values.upload=String(Math.round(ul*1000));}
			await this.uci('set',{config:'sqm',section,values});
			await this.uci('commit',{config:'sqm'});
			await this.rpc('file','exec',{command:'/etc/init.d/sqm',params:['restart']});
			this.core.showToast(enabled?'QoS enabled':'QoS disabled','success');
			await this.show();
		}catch(e){this.core.showToast('QoS change failed: '+e.message,'error');}
		finally{this.busy=false;save.disabled=false;}
	}
}
