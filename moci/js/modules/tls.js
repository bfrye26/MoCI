// HTTPS / TLS certificate management. Shows the live uhttpd certificate, offers
// Let's Encrypt via DNS-01 (native OpenWrt acme), and a reliable custom-cert install.
// Let's Encrypt needs a domain you own; a private IP cannot get a public cert.
const DNS_PROVIDERS=[['dns_cf','Cloudflare'],['dns_aws','Amazon Route 53'],['dns_gd','GoDaddy'],['dns_dp','DNSPod'],['dns_freedns','FreeDNS'],['dns_namecheap','Namecheap'],['dns_google','Google Cloud DNS']];
export default class TlsModule{
	constructor(core){
		this.core=core;this.busy=false;
		this.core.registerRoute('/tls',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async rpc(o,m,a={}){const [s,r]=await this.core.ubusCall(o,m,a,{timeout:60000});if(s!==0)throw new Error(o+'.'+m+' failed ('+s+')');return r||{};}
	async uci(m,a){return this.rpc('uci',m,a);}
	async exec(command,params){return this.rpc('file','exec',{command,params});}
	async show(){
		this.page=document.getElementById('tls-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#tls-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading the router certificate…','page-loading'));
		try{
			const cert=await this.exec('/usr/bin/openssl',['x509','-in','/etc/uhttpd.crt','-noout','-subject','-issuer','-enddate']).catch(()=>null);
			this.render(cert&&cert.code===0?cert.stdout:'');
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read the certificate: '+e.message,'page-error'));}
	}
	parseCert(text){
		const get=re=>{const m=String(text).match(re);return m?m[1].trim():'';};
		const subject=get(/subject\s*=\s*(.+)/),issuer=get(/issuer\s*=\s*(.+)/),enddate=get(/notAfter\s*=\s*(.+)/);
		let days=null;
		if(enddate){const d=new Date(enddate);if(!isNaN(d))days=Math.round((d-Date.now())/86400000);}
		const cn=s=>{const m=s.match(/CN\s*=\s*([^,\/]+)/);return m?m[1]:s;};
		return {subject:cn(subject),issuer:cn(issuer),enddate,days,selfSigned:subject&&subject===issuer};
	}
	render(certText){
		const root=this.root;root.replaceChildren();
		const info=this.parseCert(certText);

		// Current certificate
		const card=this.el('div',undefined,'tls-status stat-card');
		const head=this.el('div',undefined,'tls-status-head');
		const kind=info.selfSigned?'Self-signed':'CA-issued';
		head.append(this.el('strong','Current HTTPS certificate'),this.el('span',kind,'dev-badge '+(info.selfSigned?'dynamic':'static')));
		card.append(head);
		const facts=this.el('div',undefined,'wan-facts');
		const fact=(k,v)=>{const f=this.el('div',undefined,'wan-fact');f.append(this.el('span',k,'wan-fact-k'),this.el('span',v||'—','wan-fact-v'));return f;};
		facts.append(fact('Issued to',info.subject),fact('Issuer',info.issuer),
			fact('Expires',info.enddate?info.enddate:'—'),
			fact('Days remaining',info.days===null?'—':String(info.days)));
		card.append(facts);
		if(info.selfSigned){
			card.append(this.el('p','Browsers warn about self-signed certificates. To remove the warning, install a certificate for a domain you own — either automatically with Let’s Encrypt below, or by uploading one.','page-note'));
		}
		root.append(card);

		// Let's Encrypt
		root.append(this.el('h3','Let’s Encrypt (automatic)'));
		root.append(this.el('p','Let’s Encrypt issues free trusted certificates for a domain you own. Because the router sits behind NAT, validation uses DNS-01: you prove ownership through your DNS provider’s API. A private address like 192.168.50.1 cannot get a public certificate.','page-note'));
		const leForm=this.el('form',undefined,'tls-form stat-card');
		const domain=this.el('input');domain.className='form-input';domain.placeholder='router.example.com';domain.required=true;
		const provider=this.el('select');provider.className='form-input';
		for(const [val,label] of DNS_PROVIDERS){const o=this.el('option',label);o.value=val;provider.append(o);}
		const creds=this.el('textarea');creds.className='form-input';creds.rows=3;creds.placeholder='Provider API credentials, e.g.\nCF_Token="your-cloudflare-api-token"';
		const staging=this.el('input');staging.type='checkbox';staging.checked=true;
		const stagingLabel=this.el('label',undefined,'profiles-check');stagingLabel.append(staging,this.el('span','Use the staging (test) environment first — recommended'));
		leForm.append(this.field('Domain name',domain,'A DNS name you control, pointed at your home IP.'),this.field('DNS provider',provider),this.field('API credentials',creds,'Name="value" pairs for your provider’s DNS API.'),stagingLabel);
		const issue=this.el('button','CONFIGURE & ISSUE','action-btn');issue.type='submit';
		leForm.append(issue);
		leForm.addEventListener('submit',async e=>{e.preventDefault();if(this.busy)return;await this.issueLE({domain:domain.value.trim(),dns:provider.value,credentials:creds.value.trim(),staging:staging.checked},issue);});
		root.append(leForm);
		root.append(this.el('p','Automatic issuance uses the router’s ACME client and requires your DNS provider’s API script to be available. If your provider is unsupported here, obtain a Let’s Encrypt certificate elsewhere (e.g. certbot with DNS-01) and upload it below.','page-note'));

		// Custom certificate
		root.append(this.el('h3','Upload a certificate'));
		root.append(this.el('p','Paste a certificate and its private key (PEM). This works with a Let’s Encrypt certificate you obtained elsewhere, or any certificate for your domain. The web server restarts to apply it.','page-note'));
		const upForm=this.el('form',undefined,'tls-form stat-card');
		const certPem=this.el('textarea');certPem.className='form-input tls-pem';certPem.rows=5;certPem.placeholder='-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----';certPem.required=true;
		const keyPem=this.el('textarea');keyPem.className='form-input tls-pem';keyPem.rows=5;keyPem.placeholder='-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----';keyPem.required=true;
		upForm.append(this.field('Certificate (PEM)',certPem),this.field('Private key (PEM)',keyPem));
		const install=this.el('button','INSTALL CERTIFICATE','action-btn');install.type='submit';
		upForm.append(install);
		upForm.addEventListener('submit',async e=>{e.preventDefault();if(this.busy)return;await this.installCert(certPem.value.trim(),keyPem.value.trim(),install);});
		root.append(upForm);

		root.append(this.el('h3','Local-only network?'));
		root.append(this.el('p','If you don’t own a domain, a public Let’s Encrypt certificate isn’t possible. You can keep the self-signed certificate and trust it once in your browser, or create a small local certificate authority and install its root on your devices. The router stays fully functional either way — the warning is cosmetic.','page-note'));
	}
	field(label,input,hint){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),input);if(hint)w.append(this.el('small',hint,'wan-field-hint'));return w;}
	async issueLE({domain,dns,credentials,staging},btn){
		if(!domain||!domain.includes('.')){this.core.showToast('Enter a valid domain you own','error');return;}
		if(!credentials){this.core.showToast('Enter your DNS provider API credentials','error');return;}
		if(!window.confirm('Configure Let’s Encrypt for '+domain+' via DNS-01 and start issuance?'))return;
		this.busy=true;btn.disabled=true;btn.textContent='ISSUING…';
		try{
			const credLines=credentials.split('\n').map(l=>l.trim()).filter(Boolean);
			await this.uci('set',{config:'acme',section:'moci_le',values:{}}).catch(async()=>{await this.uci('add',{config:'acme',type:'cert',name:'moci_le'});});
			await this.uci('set',{config:'acme',section:'moci_le',values:{enabled:'1',staging:staging?'1':'0',domains:domain,validation_method:'dns',dns,credentials:credLines}});
			await this.uci('commit',{config:'acme'});
			const r=await this.exec('/etc/init.d/acme',['renew']);
			if(r.code===0){this.core.showToast('ACME renewal triggered. Check back shortly for the issued certificate.','success');}
			else{this.core.showToast('ACME reported an issue — verify the DNS API script and credentials. '+(r.stderr||r.stdout||'').slice(0,120),'info');}
			await this.show();
		}catch(e){this.core.showToast('Let’s Encrypt setup failed: '+e.message,'error');}
		finally{this.busy=false;btn.disabled=false;btn.textContent='CONFIGURE & ISSUE';}
	}
	async installCert(cert,key,btn){
		if(!/-----BEGIN CERTIFICATE-----/.test(cert)){this.core.showToast('The certificate must be PEM (BEGIN CERTIFICATE)','error');return;}
		if(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key)){this.core.showToast('The private key must be PEM (BEGIN … PRIVATE KEY)','error');return;}
		if(!window.confirm('Install this certificate and restart the web server? The HTTPS connection will briefly drop and your browser may ask you to trust the new certificate.'))return;
		this.busy=true;btn.disabled=true;
		try{
			await this.rpc('file','write',{path:'/etc/uhttpd.crt',data:cert+'\n'});
			await this.rpc('file','write',{path:'/etc/uhttpd.key',data:key+'\n'});
			await this.exec('/etc/init.d/uhttpd',['restart']);
			this.core.showToast('Certificate installed. Reconnect if the page dropped.','success');
			await this.show();
		}catch(e){this.core.showToast('Certificate install failed: '+e.message,'error');}
		finally{this.busy=false;btn.disabled=false;}
	}
}
