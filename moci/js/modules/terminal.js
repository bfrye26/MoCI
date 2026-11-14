// Web Terminal — ttyd browser terminal for live diagnostics (run htop, logread,
// etc.). LAN-only by default. This is a root shell: the page warns clearly and the
// add-on ships OFF. The terminal is embedded via iframe with an open-in-new-tab
// fallback (useful when the UI is served over HTTPS and ttyd is plain HTTP).
export default class TerminalModule{
	constructor(core){
		this.core=core;
		this.busy=false;
		this.core.registerRoute('/terminal',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){
		const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:20000});
		if(s!==0)throw new Error('Command denied by router permissions ('+s+')');
		return r||{};
	}
	async show(){
		this.page=document.getElementById('terminal-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#terminal-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Preparing web terminal…','page-loading'));
		try{
			const [present,cfg,svc]=await Promise.all([
				this.exec('/usr/libexec/moci-service-inspect',['present']).catch(()=>({stdout:''})),
				this.core.uciGet('ttyd').catch(()=>[1,{values:{}}]),
				this.core.ubusCall('service','list',{verbose:true},{timeout:10000}).catch(()=>[1,{}])
			]);
			this.installed=String(present.stdout||'').split('\n').map(x=>x.trim()).includes('ttyd');
			this.cfg=(cfg[0]===0&&cfg[1]?.values)?cfg[1].values:{};
			const inst=(svc[0]===0&&svc[1]?.ttyd?.instances)?Object.values(svc[1].ttyd.instances):[];
			this.running=inst.some(i=>i?.running===true);
			this.render();
		}catch(e){
			this.root.replaceChildren(this.el('p','Unable to prepare terminal: '+e.message,'page-error'));
		}
	}
	general(){return this.cfg.general||this.cfg['@ttyd[0]']||{};}
	render(){
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);
		root.append(this.el('p','A browser terminal on the router for live troubleshooting — run htop, logread, ping and more. It is a root shell, restricted to your LAN, and off by default.','page-intro'));
		if(!this.installed){
			root.append(this.el('div','The ttyd package is not installed on this firmware yet. Install the latest Haven firmware update, then turn on Web Terminal in Features.','addon-empty'));
			return;
		}
		const warn=this.el('div',undefined,'addon-permission-warning');
		warn.textContent='Security: this terminal runs as root. Anyone who can reach it has full control of the router. Keep it LAN-only and turn it off when you are done.';
		root.append(warn);
		const g=this.general();
		const port=String(g.port||'7681');
		const url='http://'+location.hostname+':'+port+'/';
		const bar=this.el('div',undefined,'page-toolbar');
		if(this.running){
			const open=this.el('a','OPEN IN NEW TAB','action-btn');open.href=url;open.target='_blank';open.rel='noopener';
			bar.append(open);
		}else{
			const start=this.el('button','START TERMINAL SERVICE','action-btn');start.type='button';start.disabled=this.busy;
			start.addEventListener('click',()=>this.start());
			bar.append(start);
		}
		const refresh=this.el('button','REFRESH','action-btn');refresh.type='button';
		refresh.addEventListener('click',()=>this.show());
		bar.append(refresh);root.append(bar);
		if(this.running){
			const frame=this.el('iframe',undefined,'terminal-frame');
			frame.src=url;frame.setAttribute('title','Router web terminal');
			root.append(frame);
			root.append(this.el('p','Tip: type htop for a live process view. If the frame is blank (HTTPS page / HTTP terminal), use “Open in new tab”.','page-note'));
		}else{
			root.append(this.el('div','The terminal service is not running. Start it above (or turn on Web Terminal in Features).','addon-empty'));
		}
		root.append(this.el('h3','Settings'));
		const form=this.el('form',undefined,'dev-form stat-card');
		const portInput=this.input('term-port',port,'number');
		const iface=this.input('term-iface',String(g.interface||'lan'),'text');
		form.append(this.field('Port',portInput),this.field('Listen interface (lan = LAN only)',iface));
		const save=this.el('button','SAVE & RESTART','action-btn');save.type='submit';
		form.append(save);
		form.addEventListener('submit',async e=>{
			e.preventDefault();if(this.busy)return;
			await this.save(portInput.value.trim(),iface.value.trim(),save);
		});
		root.append(form);
	}
	input(id,val,type){const i=this.el('input');i.id=id;i.type=type||'text';i.value=val??'';i.className='form-input';i.autocomplete='off';return i;}
	field(label,input){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),input);return w;}
	async start(){
		if(this.busy)return;this.busy=true;this.render();
		try{
			await this.exec('/etc/init.d/ttyd',['enable']).catch(()=>{});
			await this.exec('/etc/init.d/ttyd',['start']);
			this.core.showToast('Terminal service started','success');
		}catch(e){this.core.showToast('Could not start ttyd: '+e.message,'error');}
		finally{this.busy=false;await this.show();}
	}
	async save(port,iface,btn){
		if(!/^\d{2,5}$/.test(port)||Number(port)<1||Number(port)>65535){this.core.showToast('Enter a valid port (1-65535)','error');return;}
		if(!/^[a-z0-9_-]*$/i.test(iface)){this.core.showToast('Invalid interface name','error');return;}
		this.busy=true;btn.disabled=true;
		try{
			const section=this.cfg.general?'general':(this.cfg['@ttyd[0]']?'@ttyd[0]':null);
			if(!section){await this.core.uciAdd('ttyd','ttyd','general');}
			await this.core.uciSet('ttyd',section||'general',{port,interface:iface||'lan'});
			await this.core.uciCommit('ttyd');
			await this.exec('/etc/init.d/ttyd',['restart']).catch(()=>{});
			this.core.showToast('Terminal settings saved','success');
		}catch(e){this.core.showToast('Could not save: '+e.message,'error');}
		finally{this.busy=false;await this.show();}
	}
}