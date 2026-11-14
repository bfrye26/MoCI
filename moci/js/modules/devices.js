// Devices — connected clients and static DHCP reservations. Live leases come from
// moci.getDHCPLeases; reservations are dhcp 'host' sections. Reservation edits are
// low-risk (no management path change) so they commit and reload dnsmasq directly.
const MAC=/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const IPV4=/^(\d{1,3}\.){3}\d{1,3}$/;
const validIP=v=>IPV4.test(v)&&v.split('.').every(n=>Number(n)<=255);
const normMac=v=>String(v||'').trim().toLowerCase();
// Compact OUI (MAC prefix) table for recognising common home/office device makers.
// Not exhaustive — unknown prefixes fall back to "Unknown vendor".
const OUI={
'00:1a:11':'Google','3c:5a:b4':'Google','f4:f5:d8':'Google','54:60:09':'Google','a4:77:33':'Google',
'00:17:c4':'Quanta','00:26:bb':'Apple','00:1c:b3':'Apple','00:23:12':'Apple','00:25:00':'Apple','3c:07:54':'Apple',
'40:6c:8f':'Apple','58:55:ca':'Apple','70:56:81':'Apple','7c:6d:62':'Apple','88:66:a5':'Apple','a4:5e:60':'Apple',
'ac:bc:32':'Apple','b8:e8:56':'Apple','d0:23:db':'Apple','f0:18:98':'Apple','14:98:77':'Apple','28:cf:e9':'Apple',
'34:36:3b':'Apple','48:60:bc':'Apple','60:03:08':'Apple','78:31:c1':'Apple','98:01:a7':'Apple','c8:69:cd':'Apple',
'00:1d:25':'Samsung','00:21:19':'Samsung','08:08:c2':'Samsung','10:1d:c0':'Samsung','18:67:b0':'Samsung',
'24:4b:81':'Samsung','30:cd:a7':'Samsung','5c:0a:5b':'Samsung','84:25:db':'Samsung','a0:0b:ba':'Samsung',
'cc:07:ab':'Samsung','e8:50:8b':'Samsung','f0:25:b7':'Samsung','04:18:0f':'Samsung','5c:49:7d':'Samsung',
'00:1b:21':'Intel','00:1e:64':'Intel','00:24:d7':'Intel','3c:97:0e':'Intel','5c:51:4f':'Intel','80:86:f2':'Intel',
'8c:ec:4b':'Intel','a0:36:9f':'Intel','b4:96:91':'Intel','f8:63:3f':'Intel','00:23:ae':'Intel','9c:b6:d0':'Intel',
'00:14:22':'Dell','00:1e:c9':'Dell','00:21:9b':'Dell','00:26:b9':'Dell','18:03:73':'Dell','24:b6:fd':'Dell',
'34:17:eb':'Dell','5c:f9:dd':'Dell','b0:83:fe':'Dell','d4:be:d9':'Dell','f8:db:88':'Dell',
'00:1a:4b':'HP','00:21:5a':'HP','00:26:55':'HP','10:60:4b':'HP','3c:d9:2b':'HP','64:51:06':'HP','9c:b6:54':'HP',
'00:16:35':'HP','00:1f:29':'HP','00:23:7d':'HP','00:0c:29':'VMware','00:50:56':'VMware','00:05:69':'VMware',
'00:1c:42':'Parallels','08:00:27':'VirtualBox','52:54:00':'QEMU/KVM',
'00:15:5d':'Microsoft','00:12:5a':'Microsoft','00:1d:d8':'Microsoft','7c:1e:52':'Microsoft','dc:b4:c4':'Microsoft',
'00:0d:3a':'Microsoft','28:18:78':'Microsoft','60:45:bd':'Microsoft','98:5f:d3':'Microsoft',
'00:1e:c2':'Amazon','0c:47:c9':'Amazon','18:74:2e':'Amazon','34:d2:70':'Amazon','40:b4:cd':'Amazon',
'44:65:0d':'Amazon','50:dc:e7':'Amazon','68:37:e9':'Amazon','74:75:48':'Amazon','84:d6:d0':'Amazon',
'a0:02:dc':'Amazon','ac:63:be':'Amazon','f0:27:2d':'Amazon','fc:65:de':'Amazon',
'00:1a:2b':'Xiaomi','28:6c:07':'Xiaomi','34:ce:00':'Xiaomi','50:8f:4c':'Xiaomi','64:09:80':'Xiaomi',
'74:23:44':'Xiaomi','7c:1d:d9':'Xiaomi','98:fa:e3':'Xiaomi','f8:a4:5f':'Xiaomi','04:cf:8c':'Xiaomi',
'00:1e:10':'Huawei','00:25:9e':'Huawei','04:02:1f':'Huawei','20:08:ed':'Huawei','48:46:fb':'Huawei',
'5c:4c:a9':'Huawei','70:72:3c':'Huawei','88:28:b3':'Huawei','ac:e2:15':'Huawei','d4:6e:5c':'Huawei',
'00:1f:3f':'TP-Link','14:cc:20':'TP-Link','50:c7:bf':'TP-Link','60:e3:27':'TP-Link','90:f6:52':'TP-Link',
'b0:be:76':'TP-Link','c0:25:e9':'TP-Link','f4:f2:6d':'TP-Link',
'00:14:6c':'Netgear','00:1e:2a':'Netgear','00:26:f2':'Netgear','20:4e:7f':'Netgear','30:46:9a':'Netgear',
'84:1b:5e':'Netgear','a0:40:a0':'Netgear','c4:04:15':'Netgear',
'00:1d:60':'Asus','04:d4:c4':'Asus','10:bf:48':'Asus','2c:56:dc':'Asus','38:2c:4a':'Asus','54:04:a6':'Asus',
'ac:22:0b':'Asus','d8:50:e6':'Asus','f4:6d:04':'Asus',
'b8:27:eb':'Raspberry Pi','dc:a6:32':'Raspberry Pi','e4:5f:01':'Raspberry Pi','28:cd:c1':'Raspberry Pi',
'24:0a:c4':'Espressif','30:ae:a4':'Espressif','5c:cf:7f':'Espressif','84:0d:8e':'Espressif','a4:cf:12':'Espressif',
'cc:50:e3':'Espressif','ec:fa:bc':'Espressif','00:17:88':'Philips Hue','00:21:2e':'Sony','fc:f1:52':'Sony',
'00:04:20':'Logitech','00:1f:20':'Logitech','44:73:d6':'Logitech','c4:7c:8d':'Logitech'
};
const vendorForMac=mac=>{const p=normMac(mac).split(':').slice(0,3).join(':');return OUI[p]||'Unknown vendor';};
export default class DevicesModule{
	constructor(core){
		this.core=core;this.busy=false;
		this.core.registerRoute('/devices',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async rpc(o,m,a={}){const [s,r]=await this.core.ubusCall(o,m,a,{timeout:30000});if(s!==0)throw new Error(o+'.'+m+' failed ('+s+')');return r||{};}
	async uci(m,a){return this.rpc('uci',m,a);}
	async show(){
		this.page=document.getElementById('devices-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#devices-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Discovering devices on your network…','page-loading'));
		try{
			const [leases,dhcp,network,firewall,arp]=await Promise.all([
				this.rpc('moci','getDHCPLeases').catch(()=>({dhcp_leases:[]})),
				this.uci('get',{config:'dhcp'}),
				this.uci('get',{config:'network'}).catch(()=>({values:{}})),
				this.uci('get',{config:'firewall'}).catch(()=>({values:{}})),
				this.rpc('file','read',{path:'/proc/net/arp'}).catch(()=>({data:''}))
			]);
			this.leases=Array.isArray(leases.dhcp_leases)?leases.dhcp_leases:[];
			this.dhcp=dhcp.values||{};
			this.network=network.values||{};
			this.firewall=firewall.values||{};
			this.reservations=Object.entries(this.dhcp).filter(([,v])=>v?.['.type']==='host');
			this.connected=this.buildConnected(arp.data);
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read devices: '+e.message,'page-error'));}
	}
	resForMac(mac){return this.reservations.find(([,v])=>normMac(v.mac)===normMac(mac));}
	// Every device seen on the LAN (ARP table), not just ones this router gave a
	// DHCP lease to — other DHCP servers (e.g. a mesh system) may serve clients.
	buildConnected(arpData){
		const leaseByMac=new Map(this.leases.map(l=>[normMac(l.macaddr),l]));
		const resByMac=new Map(this.reservations.map(([id,v])=>[normMac(v.mac),{id,...v}]));
		const clean=h=>(h&&h!=='*')?h:'';
		const seen=new Set();const out=[];
		const push=(ip,mac)=>{
			const key=normMac(mac);if(seen.has(key))return;seen.add(key);
			const lease=leaseByMac.get(key);const res=resByMac.get(key);
			out.push({ipaddr:ip,macaddr:mac,
				hostname:clean(lease?.hostname)||clean(res?.name)||'',
				expires:lease?lease.expires:0,hasLease:!!lease,isStatic:!!res});
		};
		for(const line of String(arpData||'').split('\n').slice(1)){
			const p=line.trim().split(/\s+/);
			if(p.length<6)continue;
			const [ip,,flags,mac,,device]=p;
			if(flags==='0x0'||device!=='br-lan')continue;
			if(!validIP(ip)||!MAC.test(mac))continue;
			push(ip,mac);
		}
		for(const l of this.leases){if(validIP(l.ipaddr)&&MAC.test(l.macaddr))push(l.ipaddr,l.macaddr);}
		const ipNum=ip=>ip.split('.').reduce((a,o)=>a*256+Number(o),0);
		out.sort((a,b)=>ipNum(a.ipaddr)-ipNum(b.ipaddr));
		return out;
	}
	profileForIp(ip){
		if(!validIP(ip))return '—';
		const octets=ip.split('.').map(Number);
		for(const [name,v] of Object.entries(this.network)){
			if(v?.['.type']!=='interface'||!v.ipaddr)continue;
			const net=String(v.ipaddr).split('.').map(Number);
			const mask=String(v.netmask||'255.255.255.0').split('.').map(Number);
			if(net.length!==4||mask.length!==4)continue;
			const inSubnet=octets.every((o,i)=>(o&mask[i])===(net[i]&mask[i]));
			if(!inSubnet)continue;
			if(['lan','wan','wan6','loopback'].includes(name))return name==='lan'?'Main LAN':name.toUpperCase();
			for(const z of Object.values(this.firewall)){
				if(z?.['.type']!=='zone')continue;
				const nets=Array.isArray(z.network)?z.network:String(z.network||'').split(/\s+/);
				if(nets.includes(name)&&String(z.name||'').startsWith('moci_'))return z.name.replace(/^moci_/,'');
			}
			return name;
		}
		return '—';
	}
	async commitReload(){
		await this.uci('commit',{config:'dhcp'});
		try{await this.rpc('file','exec',{command:'/etc/init.d/dnsmasq',params:['reload']});}
		catch(e){this.core.showToast('Saved, but dnsmasq reload may be needed: '+e.message,'info');}
	}
	render(){
		const root=this.root;root.replaceChildren();
		const resByMac=new Map(this.reservations.map(([id,v])=>[normMac(v.mac),{id,...v}]));

		// Summary
		const summary=this.el('div',undefined,'dev-summary');
		const stat=(n,label)=>{const c=this.el('div',undefined,'dev-stat stat-card');c.append(this.el('strong',String(n),'dev-stat-n'),this.el('span',label,'dev-stat-l'));return c;};
		summary.append(stat(this.connected.length,'Connected now'),stat(this.reservations.length,'Static reservations'));
		root.append(summary);

		// Connected devices
		root.append(this.el('h3','Connected devices'));
		root.append(this.el('p','Every device seen on your LAN, whether or not this router handed out its address (another DHCP server, e.g. a mesh system, may serve some). Make a device’s address static so it never changes — useful for servers, printers and port forwarding.','page-note'));
		const table=this.el('table',undefined,'data-table dev-table');
		const thead=this.el('thead');const hr=this.el('tr');
		for(const h of ['Device','Vendor','IP address','Profile','Lease','Type',''])hr.append(this.el('th',h));
		thead.append(hr);table.append(thead);
		const tbody=this.el('tbody');
		if(!this.connected.length){
			const tr=this.el('tr');const td=this.el('td','No devices are currently connected.','page-note');td.colSpan=7;tr.append(td);tbody.append(tr);
		}
		for(const dev of this.connected){
			const tr=this.el('tr');
			const name=dev.hostname||'Unknown device';
			const res=resByMac.get(normMac(dev.macaddr));
			const nameCell=this.el('td');nameCell.append(this.el('span',name,'dev-name'),this.el('span',dev.macaddr,'dev-mono dev-res-meta'));
			const profile=this.profileForIp(dev.ipaddr);
			tr.append(nameCell,this.el('td',vendorForMac(dev.macaddr)),this.el('td',dev.ipaddr,'dev-mono'),
				this.el('td',profile),this.el('td',dev.expires>0?this.fmtLease(dev.expires):'—'));
			const typeCell=this.el('td');
			const typeLabel=dev.isStatic?'Static':(dev.hasLease?'DHCP':'Other');
			typeCell.append(this.el('span',typeLabel,'dev-badge '+(dev.isStatic?'static':'dynamic')));
			tr.append(typeCell);
			const act=this.el('td');
			if(res){
				const b=this.el('button','Reserved','dev-action');b.type='button';b.disabled=true;act.append(b);
			}else{
				const b=this.el('button','Make static','dev-action');b.type='button';
				b.addEventListener('click',()=>this.makeStatic(dev));
				act.append(b);
			}
			const perm=this.el('button','Permissions','dev-action');perm.type='button';
			perm.addEventListener('click',()=>this.showPermissions(dev,profile));
			act.append(perm);
			tr.append(act);tbody.append(tr);
		}
		table.append(tbody);root.append(table);

		// Static reservations
		root.append(this.el('h3','Static IP reservations'));
		if(!this.reservations.length){
			root.append(this.el('p','No static reservations yet. Use “Make static” above, or add one manually below.','page-note'));
		}else{
			const list=this.el('div',undefined,'dev-res-list');
			for(const [id,v] of this.reservations){
				const card=this.el('div',undefined,'dev-res-card stat-card');
				const info=this.el('div',undefined,'dev-res-info');
				info.append(this.el('strong',v.name||'(unnamed)','dev-name'),
					this.el('span',(v.ip||'—')+'  ·  '+(v.mac||'—'),'dev-mono dev-res-meta'));
				const online=this.connected.some(d=>normMac(d.macaddr)===normMac(v.mac));
				const actions=this.el('div',undefined,'dev-res-actions');
				actions.append(this.el('span',online?'Online':'Offline','dev-badge '+(online?'static':'dynamic')));
				const edit=this.el('button','Edit','dev-action');edit.type='button';
				edit.addEventListener('click',()=>this.editReservation(id,v));
				const del=this.el('button','Remove','dev-action danger');del.type='button';
				del.addEventListener('click',()=>this.removeReservation(id,v));
				actions.append(edit,del);
				card.append(info,actions);list.append(card);
			}
			root.append(list);
		}

		// Add reservation form
		root.append(this.el('h3','Add a reservation'));
		const form=this.el('form',undefined,'dev-form stat-card');
		const name=this.input('dev-name','Living-room TV','text');
		const mac=this.input('dev-mac','aa:bb:cc:dd:ee:ff','text');
		const ip=this.input('dev-ip','192.168.50.50','text');
		form.append(this.field('Device name',name),this.field('MAC address',mac),this.field('Static IPv4',ip));
		const add=this.el('button','ADD RESERVATION','action-btn');add.type='submit';
		form.append(add);
		form.addEventListener('submit',async e=>{
			e.preventDefault();if(this.busy)return;
			await this.saveReservation(null,{name:name.value.trim(),mac:normMac(mac.value),ip:ip.value.trim()},add);
		});
		root.append(form);
		root.append(this.el('p','A reservation ties a MAC address to a fixed IP. The device receives that address the next time it reconnects or renews its lease.','page-note'));
	}
	fmtLease(sec){
		if(sec>=3600)return Math.floor(sec/3600)+'h '+Math.floor((sec%3600)/60)+'m';
		if(sec>=60)return Math.floor(sec/60)+'m';
		return sec+'s';
	}
	showPermissions(lease,profile){
		document.querySelector('.dev-modal-overlay')?.remove();
		const overlay=this.el('div',undefined,'dev-modal-overlay');
		const card=this.el('div',undefined,'dev-modal stat-card');
		const head=this.el('div',undefined,'dev-modal-head');
		head.append(this.el('h3',lease.hostname||'Device permissions'));
		const close=this.el('button','CLOSE','dev-action');close.type='button';
		close.addEventListener('click',()=>overlay.remove());
		head.append(close);
		const meta=this.el('p',vendorForMac(lease.macaddr)+'  ·  '+lease.ipaddr+'  ·  profile: '+profile,'page-note');
		const note=this.el('p','Permissions are opt-in and off by default. Delegate an inbound port to this device, or publish a DNS name for it. Profile-wide internet, DNS and LAN access are managed on the Security Profiles page.','page-note');
		const actions=this.el('div',undefined,'dev-modal-actions');
		const port=this.el('button','Delegate a port','action-btn');port.type='button';
		port.addEventListener('click',()=>{overlay.remove();this.core.navigate('/published-ports');});
		const dns=this.el('button','Publish a DNS name','action-btn');dns.type='button';
		dns.addEventListener('click',()=>{overlay.remove();this.core.navigate('/network/dns');});
		const prof=this.el('button','Manage profile access','action-btn');prof.type='button';
		prof.addEventListener('click',()=>{overlay.remove();this.core.navigate('/profiles');});
		actions.append(port,dns,prof);
		card.append(head,meta,note,actions);
		overlay.append(card);
		overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
		document.body.append(overlay);
	}
	input(id,ph,type){const i=this.el('input');i.id=id;i.type=type;i.placeholder=ph;i.className='form-input';i.autocomplete='off';return i;}
	field(label,input){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),input);return w;}
	validate(name,mac,ip,excludeId){
		if(!MAC.test(mac)){this.core.showToast('Enter a valid MAC address (aa:bb:cc:dd:ee:ff)','error');return false;}
		if(!validIP(ip)){this.core.showToast('Enter a valid IPv4 address','error');return false;}
		for(const [id,v] of this.reservations){
			if(id===excludeId)continue;
			if(normMac(v.mac)===mac){this.core.showToast('That MAC already has a reservation','error');return false;}
			if(v.ip===ip){this.core.showToast('That IP is already reserved for another device','error');return false;}
		}
		return true;
	}
	async makeStatic(lease){
		const name=lease.hostname||('device-'+lease.ipaddr.split('.').pop());
		await this.saveReservation(null,{name,mac:normMac(lease.macaddr),ip:lease.ipaddr},null,true);
	}
	async editReservation(id,v){
		const name=window.prompt('Device name',v.name||'');if(name===null)return;
		const ip=window.prompt('Static IPv4 address',v.ip||'');if(ip===null)return;
		await this.saveReservation(id,{name:name.trim(),mac:normMac(v.mac),ip:ip.trim()},null);
	}
	async removeReservation(id,v){
		if(!window.confirm('Remove the static reservation for '+(v.name||v.mac)+' ('+v.ip+')? The device will fall back to a dynamic address.'))return;
		this.busy=true;
		try{
			await this.uci('delete',{config:'dhcp',section:id});
			await this.commitReload();
			this.core.showToast('Reservation removed','success');
			await this.show();
		}catch(e){this.core.showToast('Could not remove reservation: '+e.message,'error');}
		finally{this.busy=false;}
	}
	async saveReservation(id,{name,mac,ip},btn,fromLease=false){
		if(!this.validate(name,mac,ip,id))return;
		if(!fromLease&&!window.confirm('Reserve '+ip+' for '+(name||mac)+'?'))return;
		this.busy=true;if(btn){btn.disabled=true;}
		try{
			let section=id;
			if(!section){const r=await this.uci('add',{config:'dhcp',type:'host'});section=r.section;}
			await this.uci('set',{config:'dhcp',section,values:{name:name||mac,mac,ip}});
			await this.commitReload();
			this.core.showToast(id?'Reservation updated':'Static reservation added','success');
			await this.show();
		}catch(e){this.core.showToast('Could not save reservation: '+e.message,'error');}
		finally{this.busy=false;if(btn)btn.disabled=false;}
	}
}
