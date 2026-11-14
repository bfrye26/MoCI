// NAS / File Sharing — block-mount drives + Samba shares. Lists detected drives and
// mounted filesystems, manages Samba shares, and toggles the file-sharing service.
// New shares default to read-only and no guest access (opt-in to widen).
export default class NasModule{
	constructor(core){
		this.core=core;
		this.busy=false;
		this.core.registerRoute('/nas',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){
		const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:20000});
		if(s!==0)throw new Error('Command denied by router permissions ('+s+')');
		return r||{};
	}
	async show(){
		this.page=document.getElementById('nas-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#nas-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading drives and shares…','page-loading'));
		try{
			const [block,mounts,cfg,svc]=await Promise.all([
				this.exec('/sbin/block',['info']).catch(()=>({stdout:''})),
				this.core.ubusCall('file','read',{path:'/proc/mounts'},{timeout:10000}).catch(()=>[1,{data:''}]),
				this.core.uciGet('samba4').catch(()=>[1,{values:{}}]),
				this.core.ubusCall('service','list',{verbose:true},{timeout:10000}).catch(()=>[1,{}])
			]);
			this.drives=this.parseBlock(String(block.stdout||''));
			this.mounts=String((mounts[0]===0&&mounts[1]?.data)?mounts[1].data:'');
			this.cfg=(cfg[0]===0&&cfg[1]?.values)?cfg[1].values:{};
			const inst=(svc[0]===0&&svc[1]?.samba4?.instances)?Object.values(svc[1].samba4.instances):[];
			this.running=inst.some(i=>i?.running===true);
			this.render();
		}catch(e){
			this.root.replaceChildren(this.el('p','Unable to read storage: '+e.message,'page-error'));
		}
	}
	parseBlock(text){
		const out=[];
		for(const line of text.split('\n')){
			const m=/^(\S+):\s*(.*)$/.exec(line.trim());
			if(!m)continue;
			const attrs={};
			for(const kv of m[2].matchAll(/(\w+)="([^"]*)"/g))attrs[kv[1]]=kv[2];
			out.push({device:m[1],...attrs});
		}
		return out;
	}
	shares(){return Object.entries(this.cfg).filter(([,v])=>v?.['.type']==='sambashare');}
	render(){
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);
		root.append(this.el('p','Share USB drives and folders with your network over SMB. Plug in a drive, then create a share pointing at its mount path.','page-intro'));
		const bar=this.el('div',undefined,'page-toolbar');
		const toggle=this.el('button',this.running?'STOP FILE SHARING':'START FILE SHARING','action-btn'+(this.running?' danger':''));toggle.type='button';
		toggle.disabled=this.busy;toggle.addEventListener('click',()=>this.toggleService());
		const refresh=this.el('button','REFRESH','action-btn');refresh.type='button';refresh.addEventListener('click',()=>this.show());
		bar.append(toggle,refresh);root.append(bar);
		root.append(this.el('h3','Detected drives'));
		if(!this.drives.length){
			root.append(this.el('div','No drives detected. Plug in a USB drive and refresh.','addon-empty'));
		}else{
			const table=this.el('table',undefined,'data-table');
			const rows=this.drives.map(d=>`<tr><td class="dev-mono">${esc(d.device)}</td>
				<td>${esc(d.LABEL||'—')}</td><td>${esc(d.TYPE||'—')}</td>
				<td class="dev-mono">${esc(d.MOUNT||'not mounted')}</td></tr>`).join('');
			table.innerHTML='<thead><tr><th>Device</th><th>Label</th><th>Filesystem</th><th>Mounted at</th></tr></thead><tbody>'+rows+'</tbody>';
			root.append(table);
		}
		root.append(this.el('h3','Shared folders'));
		const shares=this.shares();
		if(!shares.length){
			root.append(this.el('div','No shares yet. Create one below.','addon-empty'));
		}else{
			const table=this.el('table',undefined,'data-table');
			const rows=shares.map(([id,v])=>`<tr><td><strong>${esc(v.name||id)}</strong></td>
				<td class="dev-mono">${esc(v.path||'—')}</td>
				<td>${String(v.read_only)==='yes'?this.core.renderBadge('info','READ-ONLY'):this.core.renderBadge('success','READ/WRITE')}</td>
				<td>${String(v.guest_ok)==='yes'?this.core.renderBadge('info','GUEST'):this.core.renderBadge('success','AUTH')}</td>
				<td><button class="action-btn-sm danger" data-action="remove" data-id="${esc(id)}">REMOVE</button></td></tr>`).join('');
			table.innerHTML='<thead><tr><th>Name</th><th>Path</th><th>Access</th><th>Guest</th><th></th></tr></thead><tbody>'+rows+'</tbody>';
			root.append(table);
			if(this._nasCleanup)this._nasCleanup();
			this._nasCleanup=this.core.delegateActions('nas-page',{remove:id=>this.removeShare(id)});
		}
		root.append(this.el('h3','Add a share'));
		const form=this.el('form',undefined,'dev-form stat-card');
		const name=this.input('nas-name','share','text');
		const path=this.input('nas-path','/mnt/sda1','text');
		const ro=this.checkbox('nas-ro',true);
		const guest=this.checkbox('nas-guest',false);
		form.append(this.field('Share name',name),this.field('Folder path',path),
			this.field('Read-only',ro),this.field('Allow guest (no password)',guest));
		const add=this.el('button','ADD SHARE','action-btn');add.type='submit';form.append(add);
		form.addEventListener('submit',async e=>{
			e.preventDefault();if(this.busy)return;
			await this.addShare({name:name.value.trim(),path:path.value.trim(),read_only:ro.checked,guest_ok:guest.checked},add);
		});
		root.append(form);
		root.append(this.el('p','New shares are read-only and require a Samba user by default. Enable guest or write access only for folders you intend to expose.','page-note'));
	}
	input(id,val,type){const i=this.el('input');i.id=id;i.type=type||'text';i.value=val??'';i.className='form-input';i.autocomplete='off';return i;}
	checkbox(id,checked){const i=this.el('input');i.id=id;i.type='checkbox';i.checked=!!checked;return i;}
	field(label,input){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),input);return w;}
	async toggleService(){
		if(this.busy)return;this.busy=true;this.render();
		try{
			await this.exec('/etc/init.d/samba4',[this.running?'stop':'start']);
			this.core.showToast('File sharing '+(this.running?'stopped':'started'),'success');
		}catch(e){this.core.showToast('Could not change file sharing: '+e.message,'error');}
		finally{this.busy=false;await this.show();}
	}
	async addShare(v,btn){
		if(!/^[a-zA-Z0-9_-]{1,32}$/.test(v.name)){this.core.showToast('Share name: letters, digits, - and _ only','error');return;}
		if(!v.path.startsWith('/')){this.core.showToast('Enter an absolute folder path','error');return;}
		this.busy=true;btn.disabled=true;
		try{
			await this.core.uciAdd('samba4','sambashare',v.name);
			await this.core.uciSet('samba4',v.name,{name:v.name,path:v.path,read_only:v.read_only?'yes':'no',guest_ok:v.guest_ok?'yes':'no',create_mask:'0666',dir_mask:'0777'});
			await this.core.uciCommit('samba4');
			await this.exec('/etc/init.d/samba4',['restart']).catch(()=>{});
			this.core.showToast('Share '+v.name+' added','success');
		}catch(e){this.core.showToast('Could not add share: '+e.message,'error');}
		finally{this.busy=false;await this.show();}
	}
	async removeShare(id){
		if(!window.confirm('Remove share '+id+'?'))return;
		try{
			await this.core.uciDelete('samba4',id);
			await this.core.uciCommit('samba4');
			await this.exec('/etc/init.d/samba4',['restart']).catch(()=>{});
			this.core.showToast('Share removed','success');
		}catch(e){this.core.showToast('Could not remove share: '+e.message,'error');}
		await this.show();
	}
}