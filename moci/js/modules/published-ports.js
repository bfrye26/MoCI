// Published Ports — a first-class page hosting the UPnP / NAT-PMP workspace so it
// renders at full content width like the other modern-router pages, instead of a
// cramped tab inside the legacy Network workspace.
import UpnpModule from './upnp.js?v=1.0.0r2';
export default class PublishedPortsModule{
	constructor(core){
		this.core=core;
		this.upnp=new UpnpModule(core);
		this.core.registerRoute('/published-ports',()=>this.show());
	}
	async show(){
		const page=document.getElementById('published-ports-page');
		page?.classList.remove('hidden');
		const target=document.getElementById('published-ports-content');
		if(target)await this.upnp.load(target);
	}
}
