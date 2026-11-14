export default class SystemModule {
	constructor(core) {
		this.core = core;
		this.subTabs = null;
		this.cleanups = [];
		this.cronRaw = '';
		this.sshKeysRaw = '';
		this.firmwareFile = null;
		this.servicePending = new Map();
		this.serviceFeedback = new Map();
		this.serviceBootNames = null;
		this.serviceContext = null;

		this.core.registerRoute('/system', (path, subPaths) => {
			const pageElement = document.getElementById('system-page');
			if (pageElement) pageElement.classList.remove('hidden');

			if (!this.subTabs) {
				this.subTabs = this.core.setupSubTabs('system-page', {
					general: () => this.loadGeneral(),
					admin: () => this.loadAdmin(),
					logs: () => this.loadLogs(),
					backup: () => this.loadBackup(),
					software: () => this.loadPackages(),
					startup: () => this.loadStartup(),
					cron: () => this.loadCron(),
					'ssh-keys': () => this.loadSSHKeys(),
					mounts: () => this.loadMounts(),
					led: () => this.loadLED(),
					upgrade: () => this.loadUpgrade()
				});
				this.subTabs.attachListeners();
				this.setupHandlers();
			}

			const tab = subPaths[0] || 'general';
			this.subTabs.showSubTab(tab);
		});
	}

	setupHandlers() {
		const buttons = {
			'save-general-btn': () => this.saveGeneral(),
			'change-password-btn': () => this.changePassword(),
			'backup-btn': () => this.createBackup(),
			'reset-btn': () => this.factoryReset(),
			'add-cron-btn': () => {
				this.core.resetModal('cron-modal');
				this.core.openModal('cron-modal');
			},
			'add-ssh-key-btn': () => {
				this.core.resetModal('ssh-key-modal');
				document.getElementById('parsed-keys-preview').style.display = 'none';
				document.getElementById('save-ssh-keys-btn').style.display = 'none';
				this.core.openModal('ssh-key-modal');
			},
			'parse-keys-btn': () => this.parseSSHKeyInput(),
			'refresh-syslog-btn': () => this.loadLog('syslog'),
			'refresh-klog-btn': () => this.loadLog('klog'),
			'refresh-startup-btn': () => {this.serviceBootNames=null;this.serviceContext=null;return this.loadStartup();}
		};

		for (const [id, handler] of Object.entries(buttons)) {
			document.getElementById(id)?.addEventListener('click', handler);
		}

		for (const kind of ['syslog', 'klog']) {
			document.getElementById(`${kind}-filter`)?.addEventListener('input', () => this.renderLog(kind));
		}

		this.core.setupModal({
			modalId: 'cron-modal',
			closeBtnId: 'close-cron-modal',
			cancelBtnId: 'cancel-cron-btn',
			saveBtnId: 'save-cron-btn',
			saveHandler: () => this.saveCronEntry()
		});

		this.core.setupModal({
			modalId: 'ssh-key-modal',
			closeBtnId: 'close-ssh-key-modal',
			cancelBtnId: 'cancel-ssh-key-btn',
			saveBtnId: 'save-ssh-keys-btn',
			saveHandler: () => this.saveSSHKeys()
		});

		const delegations = {
			'cron-table': { edit: id => this.editCronEntry(id), delete: id => this.deleteCronEntry(id) },
			'ssh-keys-table': { delete: id => this.deleteSSHKey(id) },
			'services-table': { toggle: id => this.toggleService(id), inspect: id => this.inspectService(id) }
		};

		for (const [tableId, handlers] of Object.entries(delegations)) {
			const cleanup = this.core.delegateActions(tableId, handlers);
			if (cleanup) this.cleanups.push(cleanup);
		}

		this.setupFirmwareUpload();
	}

	cleanup() {
		if (this.subTabs) {
			this.subTabs.cleanup();
			this.subTabs = null;
		}
		this.cleanups.filter(Boolean).forEach(fn => {
			fn();
		});
		this.cleanups = [];
	}

	async loadGeneral() {
		if (!this.core.isFeatureEnabled('system')) return;
		try {
			const [status, boardInfo] = await this.core.ubusCall('system', 'board', {});
			if (status === 0 && boardInfo) {
				const hostname = document.getElementById('system-hostname');
				if (hostname) hostname.value = boardInfo.hostname || '';
			}
			const [us, ur] = await this.core.uciGet('system', '@system[0]');
			if (us === 0 && ur?.values) {
				await this.loadTimezones(ur.values.zonename || 'UTC', ur.values.timezone || 'UTC0');
			} else {
				await this.loadTimezones('UTC', 'UTC0');
			}
		} catch (error) {
			console.warn('Could not read system settings:', error);
			await this.loadTimezones('UTC', 'UTC0');
		}
	}

	async loadTimezones(currentName = 'UTC', currentPosix = 'UTC0') {
		const select = document.getElementById('system-timezone');
		if (!select) return;
		// LuCI ships the authoritative IANA -> POSIX timezone mapping for OpenWrt.
		// Preserve the current selection when the LuCI RPC is unavailable.
		const zones = new Map([[currentName, currentPosix]]);
		try {
			const [status, available] = await this.core.ubusCall('luci', 'getTimezones', {});
			if (status === 0 && available && typeof available === 'object') {
				for (const [name, details] of Object.entries(available)) {
					if (typeof details?.tzstring === 'string' && details.tzstring.length > 0) {
						zones.set(name, details.tzstring);
					}
				}
			}
		} catch (error) {
			console.warn('Timezone catalogue unavailable; keeping existing timezone:', error);
		}
		this.timezoneOffsets = zones;
		select.replaceChildren();
		for (const name of [...zones.keys()].sort((a, b) => a.localeCompare(b))) {
			const option = document.createElement('option');
			option.value = name;
			option.textContent = name.replaceAll('_', ' ');
			select.appendChild(option);
		}
		select.value = currentName;
	}

	async saveGeneral() {
		const hostname = document.getElementById('system-hostname')?.value.trim();
		const timezone = document.getElementById('system-timezone')?.value;
		if (!hostname) {
			this.core.showToast('Hostname is required', 'error');
			return;
		}
		const posix = this.timezoneOffsets?.get(timezone);
		if (!timezone || !posix) {
			this.core.showToast('Select a valid timezone', 'error');
			return;
		}
		try {
			const [setStatus] = await this.core.uciSet('system', '@system[0]', {
				hostname, zonename: timezone, timezone: posix
			});
			if (setStatus !== 0) throw new Error('UCI settings were rejected');
			const [commitStatus] = await this.core.uciCommit('system');
			if (commitStatus !== 0) throw new Error('UCI commit failed');
			try { await this.core.serviceReload('system'); }
			catch (error) { console.warn('Settings saved; service reload unavailable:', error); }
			this.core.showToast('System settings saved', 'success');
		} catch (error) {
			console.error('Failed to save system settings:', error);
			this.core.showToast('Failed to save settings', 'error');
		}
	}

	async loadAdmin() {}

	async loadLogs() {
		await Promise.all([this.loadLog('syslog'), this.loadLog('klog')]);
	}

	async loadLog(kind) {
		const commands = {
			syslog: { command: '/sbin/logread', params: [] },
			klog: { command: '/bin/dmesg', params: [] }
		};
		const output = document.getElementById(`${kind}-output`);
		if (!output) return;
		output.innerHTML = '<div class="log-line">Loading...</div>';
		try {
			const [s, r] = await this.core.ubusCall('file', 'exec', commands[kind], { timeout: 15000 });
			if (s !== 0 || !r || (r.code && r.code !== 0)) throw new Error('Command failed');
			if (!this._logLines) this._logLines = {};
			this._logLines[kind] = (r.stdout || '').split('\n').filter(l => l.trim());
			this.renderLog(kind);
			output.scrollTop = output.scrollHeight;
		} catch {
			output.innerHTML = '<div class="log-line error">Failed to load log</div>';
		}
	}

	renderLog(kind) {
		const output = document.getElementById(`${kind}-output`);
		if (!output || !this._logLines?.[kind]) return;
		const query = (document.getElementById(`${kind}-filter`)?.value || '').toLowerCase();
		const lines = this._logLines[kind].filter(l => !query || l.toLowerCase().includes(query));
		this.core.renderLogLines(output, lines, query ? 'No matching log entries' : 'No logs available');
	}

	async changePassword() {
		const newPw = document.getElementById('new-password').value;
		const confirmPw = document.getElementById('confirm-password').value;
		if (!newPw) {
			this.core.showToast('Password is required', 'error');
			return;
		}
		if (newPw !== confirmPw) {
			this.core.showToast('Passwords do not match', 'error');
			return;
		}
		try {
			const [status, result] = await this.core.ubusCall('moci', 'setPassword', {
				username: 'root',
				password: newPw
			});
			if (status !== 0 || !result?.result) throw new Error('setPassword failed');
			document.getElementById('new-password').value = '';
			document.getElementById('confirm-password').value = '';
			this.core.showToast('Password changed', 'success');
		} catch {
			this.core.showToast('Failed to change password', 'error');
		}
	}

	async loadBackup() {}

	async createBackup() {
		try {
			const [s] = await this.core.ubusCall(
				'file',
				'exec',
				{ command: '/sbin/sysupgrade', params: ['--create-backup', '/tmp/backup.tar.gz'] },
				{ timeout: 30000 }
			);
			if (s !== 0) throw new Error('Backup failed');

			const [rs, rr] = await this.core.ubusCall('file', 'read', {
				path: '/tmp/backup.tar.gz',
				base64: true
			});
			if (rs !== 0 || !rr?.data) throw new Error('Failed to read backup');

			const binary = atob(rr.data);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

			const blob = new Blob([bytes], { type: 'application/gzip' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
			a.click();
			URL.revokeObjectURL(url);
			this.core.showToast('Backup created', 'success');
		} catch {
			this.core.showToast('Failed to create backup', 'error');
		} finally {
			try {
				await this.core.ubusCall('file', 'exec', { command: '/bin/rm', params: ['-f', '/tmp/backup.tar.gz'] });
			} catch {}
		}
	}

	async factoryReset() {
		if (!confirm('This will erase all settings and restore factory defaults. Continue?')) return;
		if (!confirm('This action cannot be undone. Are you absolutely sure?')) return;
		try {
			await this.core.ubusCall('file', 'exec', { command: '/sbin/firstboot', params: ['-y'] });
			this.core.showToast('Factory reset initiated, rebooting...', 'success');
			setTimeout(async () => {
				try {
					await this.core.ubusCall('system', 'reboot', {});
					setTimeout(() => this.core.logout(), 2000);
				} catch {}
			}, 2000);
		} catch {
			this.core.showToast('Failed to initiate factory reset', 'error');
		}
	}

	async rebootSystem() {
		if (!confirm('Reboot the system?')) return;
		try {
			await this.core.ubusCall('system', 'reboot', {});
			this.core.showToast('System is rebooting...', 'success');
			setTimeout(() => this.core.logout(), 2000);
		} catch {
			this.core.showToast('Failed to reboot', 'error');
		}
	}


	async packageCommand(action,packageName='') {
		if(!['list-all-installed','search-general','install-general','remove-general'].includes(action))
			throw new Error('Unsupported package operation');
		if(action!=='list-all-installed'&&!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,99}$/.test(packageName))
			throw new Error('Invalid package name or search term');
		const args=[action];
		if(packageName)args.push(packageName);
		const [status,result]=await this.core.ubusCall('file','exec',{
			command:'/usr/libexec/moci-pkg-call',params:args
		},{timeout:120000});
		if(status!==0||!result||result.code!==0)
			throw new Error((result?.stderr||'Package operation failed').slice(0,250));
		return String(result.stdout||'');
	}

	async loadPackages() {
		const tab=document.getElementById('tab-software');
		const table=document.querySelector('#packages-table tbody');
		if(!tab||!table)return;
		let toolbar=tab.querySelector('#moci-package-toolbar');
		if(!toolbar){
			toolbar=document.createElement('div');
			toolbar.id='moci-package-toolbar';
			toolbar.className='package-toolbar';
			const label=document.createElement('label');
			label.textContent='Search signed OpenWrt package repositories';
			const input=document.createElement('input');
			input.id='moci-package-input';
			input.type='search';
			input.maxLength=100;
			input.placeholder='Package name, e.g. htop';
			input.autocomplete='off';
			label.appendChild(input);
			const search=document.createElement('button');
			search.type='button';search.className='action-btn';search.textContent='SEARCH';
			const add=document.createElement('button');
			add.type='button';add.className='action-btn';add.textContent='INSTALL';
			const refresh=document.createElement('button');
			refresh.type='button';refresh.className='action-btn';refresh.textContent='REFRESH INSTALLED';
			const results=document.createElement('pre');
			results.id='moci-package-results';
			results.className='package-search-results';
			results.hidden=true;
			const run=async(action)=>{
				const name=input.value.trim();
				if(!name){
					this.core.showToast('Enter a package name or search term','error');
					return;
				}
				if(action==='install-general'&&!window.confirm('Install signed repository package '+name+'? This may add dependencies and services to your router.'))return;
				if(action==='install-general'&&window.prompt('Type INSTALL '+name+' to confirm:','')!=='INSTALL '+name)return;
				search.disabled=true;add.disabled=true;
				try{
					const output=await this.packageCommand(action,name);
					results.hidden=false;
					results.textContent=output.trim()||'Operation completed.';
					this.core.showToast(action==='install-general'?'Package installed':'Search completed','success');
					if(action==='install-general')await this.loadPackages();
				}catch(error){this.core.showToast(error.message,'error');}
				finally{search.disabled=false;add.disabled=false;}
			};
			search.addEventListener('click',()=>run('search-general'));
			add.addEventListener('click',()=>run('install-general'));
			refresh.addEventListener('click',()=>this.loadPackages());
			input.addEventListener('keydown',event=>{
				if(event.key==='Enter'){event.preventDefault();run('search-general');}
			});
			toolbar.append(label,search,add,refresh,results);
			const card=table.closest('.stat-card');
			card?.insertBefore(toolbar,table);
		}
		table.replaceChildren();
		const loading=document.createElement('tr');
		const cell=document.createElement('td');
		cell.colSpan=3;cell.textContent='Loading installed packages…';
		loading.appendChild(cell);table.appendChild(loading);
		try{
			const output=await this.packageCommand('list-all-installed');
			const packages=output.split(/\r?\n/).filter(Boolean).map(line=>{
				const [name,version]=line.split('\t');
				return {name,version:version||'unknown'};
			}).filter(p=>/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,99}$/.test(p.name));
			packages.sort((a,b)=>a.name.localeCompare(b.name));
			table.replaceChildren();
			if(!packages.length){
				const row=document.createElement('tr');
				const empty=document.createElement('td');
				empty.colSpan=3;empty.textContent='No installed packages found.';
				row.appendChild(empty);table.appendChild(row);return;
			}
			const nonremovable=/^(apk|base-files|kernel|busybox|procd|ubus|ubusd|rpcd|uhttpd|uhttpd-mod-ubus|moci|netifd|firewall4|dnsmasq|dnsmasq-full|dropbear|libc|opkg|fstools|block-mount)$/;
			for(const pkg of packages.slice(0,1000)){
				const row=document.createElement('tr');
				for(const value of [pkg.name,pkg.version]){
					const td=document.createElement('td');td.textContent=value;row.appendChild(td);
				}
				const actions=document.createElement('td');
				if(nonremovable.test(pkg.name)||/^(libubus|libuci|libubox|kmod-)/.test(pkg.name)){
					actions.textContent='Protected';
				}else{
					const remove=document.createElement('button');
					remove.type='button';remove.className='action-btn danger';remove.textContent='REMOVE';
					remove.addEventListener('click',async()=>{
						if(!window.confirm('Remove '+pkg.name+'? Dependencies and active services may be affected. Create a backup first.'))return;
						if(window.prompt('Type REMOVE '+pkg.name+' to confirm:','')!=='REMOVE '+pkg.name)return;
						remove.disabled=true;
						try{
							await this.packageCommand('remove-general',pkg.name);
							this.core.showToast(pkg.name+' removed','success');
							await this.loadPackages();
						}catch(error){this.core.showToast(error.message,'error');remove.disabled=false;}
					});
					actions.append(remove);
				}
				row.appendChild(actions);table.appendChild(row);
			}
			if(packages.length>1000){
				const row=document.createElement('tr'),td=document.createElement('td');
				td.colSpan=3;td.textContent='Showing the first 1,000 of '+packages.length+' installed packages.';
				row.appendChild(td);table.appendChild(row);
			}
		}catch(error){
			table.replaceChildren();
			const row=document.createElement('tr'),td=document.createElement('td');
			td.colSpan=3;td.textContent='Package database unavailable: '+error.message;
			row.appendChild(td);table.appendChild(row);
		}
	}

	serviceIsOneShot(name) {
		return new Set(['acme','firewall','urandom_seed','system','packet_steering','ucitrack','sqm','luci_statistics','nut-cgi']).has(name);
	}

	serviceIsRunning(info) {
		// An instance being present means it is registered with procd, not
		// necessarily that its process is running. Use the verbose status.
		const instances=info?.instances;
		if(!instances||typeof instances!=='object')return false;
		return Object.values(instances).some(instance=>instance?.running===true);
	}

	serviceAutostart(info,name) {
		if(this.serviceBootNames instanceof Set)return this.serviceBootNames.has(name)?'ENABLED':'DISABLED';
		if(typeof info?.autostart==='boolean')return info.autostart?'ENABLED':'DISABLED';
		return 'UNKNOWN';
	}

	async loadBootServiceNames(force=false){
		if(!force && this.serviceBootNames!==null)return;
		try{
			const [status,result]=await this.core.ubusCall('file','exec',{
				command:'/usr/libexec/moci-service-inspect',params:['list']
			},{timeout:10000});
			if(status!==0 || result?.code!==0 || typeof result?.stdout!=='string')
				throw new Error('Service boot-status helper is not available');
			this.serviceBootNames=new Set(result.stdout.split(/\r?\n/).filter(n=>/^[A-Za-z0-9_-]{1,64}$/.test(n)));
		}catch{
			this.serviceBootNames=false;
		}
	}

	async loadServiceContext(force=false){
		if(!force && this.serviceContext!==null && this.serviceContext!==undefined)return this.serviceContext;
		let values={BANIP_ENABLED:'unknown',BANIP_STATE:'unknown',NUT_DRIVER_CONFIGURED:'unknown'};
		try{
			const [status,result]=await this.core.ubusCall('file','exec',{
				command:'/usr/libexec/moci-service-inspect',params:['summary']
			},{timeout:15000});
			if(status!==0||result?.code!==0||typeof result?.stdout!=='string')
				throw new Error('Unavailable service summary');
			for(const line of result.stdout.split(/\r?\n/)){
				const match=/^(BANIP_ENABLED|BANIP_STATE|NUT_DRIVER_CONFIGURED)=(yes|no|active|inactive|disabled|unavailable|unknown)$/.exec(line);
				if(match)values[match[1]]=match[2];
			}
		}catch(error){console.warn('Service application summary unavailable:',error);}
		this.serviceContext=values;
		return values;
	}

	serviceNeedsSetup(name){
		return (name==='nut-server' && this.serviceContext?.NUT_DRIVER_CONFIGURED==='no') ||
			(name==='banip' && this.serviceContext?.BANIP_ENABLED==='no');
	}

	serviceDisplay(name,running,pending,feedback){
		if(pending)return {variant:'info',label:pending.action==='stop'?'STOPPING…':'STARTING…'};
		if(running)return {variant:'success',label:'RUNNING'};
		if(name==='urandom_seed')return feedback?.kind==='completed'
			?{variant:'success',label:'COMPLETED'}
			:{variant:'info',label:'BOOT TASK',hint:'Short-lived random seed initialization; no daemon is expected'};
		if(name==='banip'){
			if(this.serviceContext?.BANIP_STATE==='active')return {variant:'success',label:'ACTIVE'};
			if(this.serviceContext?.BANIP_ENABLED==='no')return {
				variant:'info',label:'APP DISABLED',hint:'Enable BanIP and configure blocklists before starting'};
		}
		if(name==='nut-server' && this.serviceContext?.NUT_DRIVER_CONFIGURED==='no')return {
			variant:'info',label:'SETUP NEEDED',hint:'No UPS driver is configured for this router'};
		if(feedback?.kind==='failed')return {
			variant:'error',label:'FAILED',hint:'Start/stop returned an error. Open Details'};
		if(feedback?.kind==='completed')return {variant:'success',label:'COMPLETED'};
		if(feedback && feedback.expected!==running)return {
			variant:'info',label:'UNCONFIRMED',hint:'No persistent process confirmed. Open Details'};
		if(name==='banip')return {variant:'info',label:'INACTIVE',
			hint:'Check Details for the BanIP firewall application status'};
		if(this.serviceIsOneShot(name))return {variant:'info',label:'ON DEMAND'};
		return {variant:'error',label:'STOPPED'};
	}

	serviceHint(name){
		const hints={
			'ddns':'Dynamic DNS needs at least one enabled, configured provider before it can run.',
			'gpio_switch':'GPIO switch controls require supported physical GPIO hardware; this VM may not provide it.',
			'irqbalance':'IRQ balancing may exit when no eligible interrupts or CPU topology is available.',
			'miniupnpd':'Check Network > UPnP & Port Mapping. Enabled UCI settings do not prove the daemon started.',
			'moci-wifi-scheduler':'Wi-Fi scheduling needs a configured wireless interface.',
			'banip':'BanIP manages nftables rules, not just a daemon. Check its application status, enable it and select blocklist feeds before starting.',
			'nut-server':'NUT Server needs an actual UPS driver and a configured device. The VirtualBox VM may have no UPS to serve.',
			'urandom_seed':'urandom_seed is a boot-time random seeding task. Exiting after it runs is expected.',
			'acme':'ACME is an on-demand certificate task, not a continuously running daemon.',
			'firewall':'Firewall rule application is not a persistent daemon.'
		};
		return hints[name]||'A successful init command does not guarantee a persistent daemon. Inspect the service and logs for details.';
	}


	async serviceSnapshot(name=null) {
		const args={verbose:true};
		if(name)args.name=name;
		const [status,result]=await this.core.ubusCall('service','list',args,{timeout:10000});
		if(status!==0||!result||typeof result!=='object')
			throw new Error('OpenWrt procd service status is unavailable (ubus '+status+')');
		return result;
	}

	async loadStartup() {
		await this.core.loadResource('services-table',4,'services',async()=>{
			await Promise.all([this.loadBootServiceNames(),this.loadServiceContext()]);
			const result=await this.serviceSnapshot();
			const services=Object.entries(result).map(([name,info])=>({
				name,info,running:this.serviceIsRunning(info),pending:this.servicePending.get(name),
				feedback:this.serviceFeedback.get(name)
			})).sort((a,b)=>a.name.localeCompare(b.name));
			this.core.renderTable('#services-table',services,4,'No procd services found',service=>{
				const {name,running,pending,feedback}=service;
				if(feedback && feedback.expected===running && feedback.kind!=='completed' && feedback.kind!=='failed')this.serviceFeedback.delete(name);
				const view=this.serviceDisplay(name,running,pending,feedback);
				const badge=this.core.renderBadge(view.variant,view.label);
				const advice=view.hint?
					`<small class="service-status-note">${this.core.escapeHtml(view.hint)}</small>`:
					(!running && ['ddns','miniupnpd'].includes(name)?
					`<small class="service-status-note">${this.core.escapeHtml(this.serviceHint(name))}</small>`:'');
				const setupRequired=this.serviceNeedsSetup(name);
				const operation=pending?(pending.action==='stop'?'STOPPING…':'STARTING…'):
				(name==='banip' && this.serviceContext?.BANIP_STATE==='active'?'STOP':running?'STOP':this.serviceIsOneShot(name)?'RUN':'START');
				return `<tr>
					<td>${this.core.escapeHtml(name)}</td>
					<td>${badge}${advice}</td>
					<td>${this.core.escapeHtml(this.serviceAutostart(service.info,name))}</td>
					<td><div class="action-buttons">
						${setupRequired?'':`<button class="action-btn" type="button" data-action="toggle"
							data-id="${this.core.escapeHtml(name)}" ${pending?'disabled aria-busy="true"':''}
							style="font-size:11px;padding:4px 8px">${operation}</button>`}
						<button class="action-btn" type="button" data-action="inspect"
							data-id="${this.core.escapeHtml(name)}" style="font-size:11px;padding:4px 8px">DETAILS</button>
					</div></td>
				</tr>`;
			});
		});
	}

	async inspectService(name) {
		if(!/^[A-Za-z0-9_-]{1,64}$/.test(name))return;
		const table=document.getElementById('services-table');
		const button=[...(table?.querySelectorAll('[data-action="inspect"]')||[])].find(b=>b.dataset.id===name);
		const row=button?.closest('tr');
		if(!row)return;
		const next=row.nextElementSibling;
		if(next?.classList.contains('service-inspection-row')){
			next.remove();return;
		}
		const details=document.createElement('tr');
		details.className='service-inspection-row';
		const cell=document.createElement('td');cell.colSpan=4;
		const title=document.createElement('strong');title.textContent='Diagnostics: '+name;
		const output=document.createElement('pre');
		output.textContent='Checking init status and recent logs…';
		cell.append(title,output);details.append(cell);
		row.insertAdjacentElement('afterend',details);
		try{
			const [status,result]=await this.core.ubusCall('file','exec',{
				command:'/usr/libexec/moci-service-inspect',params:['inspect',name]
			},{timeout:18000});
			if(status!==0 || result?.code!==0)
				throw new Error('Diagnostic helper unavailable or denied. Update the MoCI service helper and RPC permissions.');
			const logs=String(result.stdout||'').slice(0,4200);
			output.textContent=this.serviceHint(name)+'\n\n'+(logs||'No service diagnostics returned.');
		}catch(error){
			output.textContent=this.serviceHint(name)+'\n\nDiagnostics unavailable: '+String(error.message||error);
		}
	}

	async waitForApplicationState(name,expected) {
		if(name!=='banip')return false;
		for(let attempt=0;attempt<5;attempt++){
			const context=await this.loadServiceContext(true);
			if((context.BANIP_STATE==='active')===expected)return true;
			if(attempt<4)await new Promise(resolve=>setTimeout(resolve,1200));
		}
		return false;
	}

	async waitForServiceState(name,expected) {
		// A successful init script is not proof the daemon started. Confirm via
		// procd's verbose process state with a bounded retry window.
		for(let attempt=0;attempt<8;attempt++){
			try {
				const snapshot=await this.serviceSnapshot(name);
				if(!expected && !snapshot[name])return true;
				if(snapshot[name] && this.serviceIsRunning(snapshot[name])===expected)return true;
			} catch(error) {
				if(attempt===7)throw error;
			}
			if(attempt<7)await new Promise(resolve=>setTimeout(resolve,1500));
		}
		return false;
	}

	async toggleService(name) {
		if(!/^[a-zA-Z0-9_-]{1,64}$/.test(name)){
			this.core.showToast('Invalid service name','error');return;
		}
		if(this.servicePending.has(name))return;
		let action=null;
		try {
			if(name==='banip'||name==='nut-server')await this.loadServiceContext(true);
			if(this.serviceNeedsSetup(name)){
				this.core.showToast(name+': '+this.serviceHint(name),'info');
				return;
			}
			const snapshot=await this.serviceSnapshot(name);
			if(!snapshot[name])throw new Error('Service is no longer registered with procd');
			const running=this.serviceIsRunning(snapshot[name]);
			action=name==='banip' && this.serviceContext?.BANIP_STATE==='active'?'stop':running?'stop':'start';
			const critical=new Set(['network','firewall','rpcd','uhttpd','dropbear','dnsmasq','odhcpd','dockerd','ubus','system']);
			if(action==='stop' && critical.has(name) &&
				!window.confirm('Stopping '+name+' may disconnect the router, SSH or internet. Continue?'))return;
			this.serviceFeedback.delete(name);
			this.servicePending.set(name,{action});
			await this.loadStartup();
			const [status,result]=await this.core.ubusCall('file','exec',{
				command:'/etc/init.d/'+name,params:[action]
			},{timeout:30000});
			if(status!==0)throw new Error('OpenWrt rejected '+action+' ('+status+'). Check administrator permissions.');
			if(!result || result.code!==0){
				const reason=String(result?.stderr||result?.stdout||'').trim().slice(0,240);
				throw new Error(reason||'Init script returned '+String(result?.code??'no exit code'));
			}
			if(action==='start' && this.serviceIsOneShot(name)){
				this.serviceFeedback.set(name,{expected:true,kind:'completed',message:'Init command completed. This job has no persistent procd process.'});
				this.core.showToast(name+': init command completed (no daemon expected)','success');
				return;
			}
			const verified=name==='banip'
				?await this.waitForApplicationState('banip',action==='start')
				:await this.waitForServiceState(name,action==='start');
			if(verified){
				this.core.showToast('Service '+name+' '+(action==='start'?'started':'stopped')+' and verified','success');
			}else{
				const message='Init script returned successfully, but no running procd process was confirmed. '+this.serviceHint(name);
				this.serviceFeedback.set(name,{expected:action==='start',message});
				this.core.showToast(name+': status unconfirmed. Check System Logs.','info');
			}
		}catch(error){
			const message=String(error?.message||'Unknown service control error').slice(0,260);
			if(action)this.serviceFeedback.set(name,{expected:action==='start',message,kind:'failed'});
			this.core.showToast('Service '+name+': '+message,'error');
		}finally{
			this.servicePending.delete(name);
			try{await this.loadStartup();}catch(error){console.warn('Could not refresh service status:',error);}
		}
	}

	async loadCron() {
		await this.core.loadResource('cron-table', 4, null, async () => {
			try {
				const [s, r] = await this.core.ubusCall('file', 'read', { path: '/etc/crontabs/root' });
				this.cronRaw = s === 0 && r?.data ? r.data : '';
			} catch {
				this.cronRaw = '';
			}

			const entries = this.parseCron(this.cronRaw);
			this.core.renderTable(
				'#cron-table',
				entries,
				4,
				'No scheduled tasks',
				(e, i) => `<tr>
				<td>${this.core.escapeHtml(e.schedule)}</td>
				<td>${this.core.escapeHtml(e.command)}</td>
				<td>${e.enabled ? this.core.renderBadge('success', 'ENABLED') : this.core.renderBadge('error', 'DISABLED')}</td>
				<td>${this.core.renderActionButtons(String(i))}</td>
			</tr>`
			);
		});
	}

	parseCron(data) {
		const result = [];
		data.split('\n').forEach((line, rawIndex) => {
			if (!line.trim()) return;
			const enabled = !line.trim().startsWith('#');
			const clean = line.replace(/^#\s*/, '').trim();
			const parts = clean.split(/\s+/);
			if (parts.length < 6) return;
			result.push({
				schedule: parts.slice(0, 5).join(' '),
				command: parts.slice(5).join(' '),
				enabled,
				minute: parts[0],
				hour: parts[1],
				day: parts[2],
				month: parts[3],
				weekday: parts[4],
				rawIndex
			});
		});
		return result;
	}

	editCronEntry(index) {
		const entries = this.parseCron(this.cronRaw);
		const entry = entries[parseInt(index)];
		if (!entry) return;
		document.getElementById('edit-cron-index').value = index;
		document.getElementById('edit-cron-minute').value = entry.minute;
		document.getElementById('edit-cron-hour').value = entry.hour;
		document.getElementById('edit-cron-day').value = entry.day;
		document.getElementById('edit-cron-month').value = entry.month;
		document.getElementById('edit-cron-weekday').value = entry.weekday;
		document.getElementById('edit-cron-command').value = entry.command;
		document.getElementById('edit-cron-enabled').checked = entry.enabled;
		this.core.openModal('cron-modal');
	}

	async saveCronEntry() {
		const index = document.getElementById('edit-cron-index').value;
		const minute = document.getElementById('edit-cron-minute').value || '*';
		const hour = document.getElementById('edit-cron-hour').value || '*';
		const day = document.getElementById('edit-cron-day').value || '*';
		const month = document.getElementById('edit-cron-month').value || '*';
		const weekday = document.getElementById('edit-cron-weekday').value || '*';
		const command = document.getElementById('edit-cron-command').value.trim();
		const enabled = document.getElementById('edit-cron-enabled').checked;

		if (!command) {
			this.core.showToast('Command is required', 'error');
			return;
		}

		const newLine = `${enabled ? '' : '# '}${minute} ${hour} ${day} ${month} ${weekday} ${command}`;
		const lines = this.cronRaw.split('\n');
		const entries = this.parseCron(this.cronRaw);

		if (index !== '') {
			const entry = entries[parseInt(index)];
			if (entry) lines[entry.rawIndex] = newLine;
		} else {
			if (lines.length && lines[lines.length - 1] === '') lines.pop();
			lines.push(newLine);
		}

		try {
			await this.core.ubusCall('file', 'write', {
				path: '/etc/crontabs/root',
				data: lines.join('\n') + (this.cronRaw.endsWith('\n') ? '' : '\n')
			});
			this.core.closeModal('cron-modal');
			this.core.showToast('Cron entry saved', 'success');
			this.loadCron();
		} catch {
			this.core.showToast('Failed to save cron entry', 'error');
		}
	}

	async deleteCronEntry(index) {
		if (!confirm('Delete this scheduled task?')) return;
		const entries = this.parseCron(this.cronRaw);
		const entry = entries[parseInt(index)];
		if (!entry) return;
		const lines = this.cronRaw.split('\n');
		lines.splice(entry.rawIndex, 1);
		try {
			await this.core.ubusCall('file', 'write', {
				path: '/etc/crontabs/root',
				data: lines.join('\n') + (this.cronRaw.endsWith('\n') ? '' : '\n')
			});
			this.core.showToast('Task deleted', 'success');
			this.loadCron();
		} catch {
			this.core.showToast('Failed to delete task', 'error');
		}
	}

	async loadSSHKeys() {
		await this.core.loadResource('ssh-keys-table', 4, 'ssh_keys', async () => {
			try {
				const [s, r] = await this.core.ubusCall('file', 'read', { path: '/etc/dropbear/authorized_keys' });
				this.sshKeysRaw = s === 0 && r?.data ? r.data : '';
			} catch {
				this.sshKeysRaw = '';
			}

			const keys = this.parseSSHKeys(this.sshKeysRaw);
			this.core.renderTable(
				'#ssh-keys-table',
				keys,
				4,
				'No SSH keys',
				(k, i) => `<tr>
				<td>${this.core.escapeHtml(k.type)}</td>
				<td>${this.core.escapeHtml(k.key.substring(0, 30))}...</td>
				<td>${this.core.escapeHtml(k.comment || 'N/A')}</td>
				<td>
					<div class="action-buttons">
						<button class="btn-icon btn-delete" data-action="delete" data-id="${i}">
							<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
						</button>
					</div>
				</td>
			</tr>`
			);
		});
	}

	parseSSHKeys(data) {
		const result = [];
		data.split('\n').forEach((line, rawIndex) => {
			if (!line.trim() || line.startsWith('#')) return;
			const parts = line.trim().split(/\s+/);
			if (!parts[1]) return;
			result.push({
				type: parts[0] || 'unknown',
				key: parts[1],
				comment: parts.slice(2).join(' '),
				rawIndex
			});
		});
		return result;
	}

	parseSSHKeyInput() {
		const textarea = document.getElementById('ssh-key-paste-area');
		const raw = textarea?.value || '';
		const keys = this.parseSSHKeys(raw);

		const preview = document.getElementById('parsed-keys-preview');
		const list = document.getElementById('parsed-keys-list');
		const saveBtn = document.getElementById('save-ssh-keys-btn');

		if (keys.length === 0) {
			this.core.showToast('No valid keys found', 'error');
			return;
		}

		list.innerHTML = keys
			.map(
				(k, i) =>
					`<div style="padding:8px;border-bottom:1px solid var(--slate-border);display:flex;align-items:center;gap:8px">
			<input type="checkbox" id="key-select-${i}" checked />
			<div>
				<div style="font-weight:600;font-size:12px">${this.core.escapeHtml(k.type)} ${this.core.escapeHtml(k.comment || 'No comment')}</div>
				<div style="font-size:11px;color:var(--steel-muted)">${this.core.escapeHtml(k.key.substring(0, 40))}...</div>
			</div>
		</div>`
			)
			.join('');

		preview.style.display = 'block';
		saveBtn.style.display = 'inline-block';
		this._parsedKeys = keys;
	}

	async saveSSHKeys() {
		const keys = this._parsedKeys || [];
		const selected = keys.filter((_, i) => document.getElementById(`key-select-${i}`)?.checked);

		if (selected.length === 0) {
			this.core.showToast('No keys selected', 'error');
			return;
		}

		const newLines = selected.map(k => `${k.type} ${k.key}${k.comment ? ' ' + k.comment : ''}`);
		const existing = this.sshKeysRaw.trim();
		const combined = existing ? existing + '\n' + newLines.join('\n') + '\n' : newLines.join('\n') + '\n';

		try {
			await this.core.ubusCall('file', 'write', {
				path: '/etc/dropbear/authorized_keys',
				data: combined
			});
			this.core.closeModal('ssh-key-modal');
			this.core.showToast(`${selected.length} key(s) added`, 'success');
			this.loadSSHKeys();
		} catch {
			this.core.showToast('Failed to save SSH keys', 'error');
		}
	}

	async deleteSSHKey(index) {
		if (!confirm('Remove this SSH key?')) return;
		const keys = this.parseSSHKeys(this.sshKeysRaw);
		const entry = keys[parseInt(index)];
		if (!entry) return;
		const lines = this.sshKeysRaw.split('\n');
		lines.splice(entry.rawIndex, 1);
		const newContent = lines.join('\n') + (this.sshKeysRaw.endsWith('\n') ? '' : '\n');
		try {
			await this.core.ubusCall('file', 'write', {
				path: '/etc/dropbear/authorized_keys',
				data: newContent
			});
			this.core.showToast('SSH key removed', 'success');
			this.loadSSHKeys();
		} catch {
			this.core.showToast('Failed to remove SSH key', 'error');
		}
	}

	async loadMounts() {
		await this.core.loadResource('mounts-table', 6, 'storage', async () => {
			const [s, r] = await this.core.ubusCall('file', 'exec', { command: '/bin/df', params: ['-h'] });
			if (s !== 0 || !r?.stdout) throw new Error('No data');

			const mounts = r.stdout
				.split('\n')
				.slice(1)
				.filter(l => l.trim())
				.map(line => {
					const parts = line.trim().split(/\s+/);
					return {
						device: parts[0],
						size: parts[1],
						used: parts[2],
						available: parts[3],
						usePercent: parts[4],
						mountPoint: parts[5]
					};
				});

			const charts = document.getElementById('storage-charts');
			if (charts) {
				charts.innerHTML = mounts
					.filter(m => m.mountPoint !== '/dev')
					.map(
						m => `<div style="padding:12px;background:var(--slate-bg);border-radius:6px">
					<div style="font-weight:600;font-size:12px;margin-bottom:8px">${this.core.escapeHtml(m.mountPoint)}</div>
					<div class="progress-bar" style="margin-bottom:8px">
						<div class="progress-fill" style="width:${this.core.escapeHtml(m.usePercent)}"></div>
					</div>
					<div style="font-size:11px;color:var(--steel-muted)">${this.core.escapeHtml(m.used)} / ${this.core.escapeHtml(m.size)} (${this.core.escapeHtml(m.usePercent)})</div>
				</div>`
					)
					.join('');
			}

			this.core.renderTable(
				'#mounts-table',
				mounts,
				6,
				'No mount points',
				m => `<tr>
				<td>${this.core.escapeHtml(m.device)}</td>
				<td>${this.core.escapeHtml(m.mountPoint)}</td>
				<td>N/A</td>
				<td>${this.core.escapeHtml(m.size)}</td>
				<td>${this.core.escapeHtml(m.used)}</td>
				<td>${this.core.escapeHtml(m.available)}</td>
			</tr>`
			);
		});
	}

	async loadLED() {
		await this.core.loadResource('led-table', 3, 'leds', async () => {
			const [status, result] = await this.core.uciGet('system');
			if (status !== 0 || !result?.values) throw new Error('No data');

			const leds = this.core.filterUciSections(result.values, 'led');
			this.core.renderTable(
				'#led-table',
				leds,
				3,
				'No LEDs configured',
				l => `<tr>
				<td>${this.core.escapeHtml(l.sysfs || l.section)}</td>
				<td>${this.core.escapeHtml(l.trigger || 'default-on')}</td>
				<td>${this.core.renderBadge('info', 'CONFIGURED')}</td>
			</tr>`
			);
		});
	}

	setupFirmwareUpload() {
		const fileInput = document.getElementById('firmware-file');
		const uploadArea = document.getElementById('file-upload-area');
		const validateBtn = document.getElementById('validate-firmware-btn');
		const flashBtn = document.getElementById('flash-firmware-btn');

		if (!fileInput || !uploadArea) return;

		uploadArea.addEventListener('click', () => fileInput.click());

		uploadArea.addEventListener('dragover', e => {
			e.preventDefault();
			uploadArea.style.borderColor = 'var(--starship-steel)';
		});

		uploadArea.addEventListener('dragleave', () => {
			uploadArea.style.borderColor = 'var(--slate-border)';
		});

		uploadArea.addEventListener('drop', e => {
			e.preventDefault();
			uploadArea.style.borderColor = 'var(--slate-border)';
			if (e.dataTransfer.files.length) this.handleFirmwareFile(e.dataTransfer.files[0]);
		});

		fileInput.addEventListener('change', () => {
			if (fileInput.files.length) this.handleFirmwareFile(fileInput.files[0]);
		});

		const sigInput = document.getElementById('firmware-sig-file');
		sigInput?.addEventListener('change', () => {
			this.firmwareSigFile = sigInput.files.length ? sigInput.files[0] : null;
			this.firmwareValidatedFile = null;
			const flashBtn2 = document.getElementById('flash-firmware-btn');
			if (flashBtn2) flashBtn2.disabled = true;
			const sigName = document.getElementById('firmware-sig-name');
			if (sigName) sigName.textContent = this.firmwareSigFile ? this.firmwareSigFile.name : 'No signature selected (image will be treated as unsigned).';
		});

		validateBtn?.addEventListener('click', () => this.validateFirmware());
		flashBtn?.addEventListener('click', () => this.flashFirmware());
	}

	handleFirmwareFile(file) {
		if (this.firmwareBusy) return;
		this.firmwareValidatedFile = null;
		const flashBtn = document.getElementById('flash-firmware-btn');
		if (flashBtn) flashBtn.disabled = true;
		if (!file?.size || !/\.(bin|img|img\.gz|itb|trx)$/i.test(file.name)) {
			this.firmwareFile = null;
			const validateBtn = document.getElementById('validate-firmware-btn');
			if (validateBtn) validateBtn.disabled = true;
			this.core.showToast('Select a firmware image (.bin, .img or .img.gz), not an installer ISO.', 'error');
			return;
		}
		this.firmwareFile = file;
		const uploadText = document.getElementById('file-upload-text');
		const info = document.getElementById('firmware-info');
		const details = document.getElementById('firmware-details');
		const validateBtn = document.getElementById('validate-firmware-btn');

		if (uploadText) uploadText.textContent = file.name;
		if (info) info.style.display = 'block';
		if (details) {
			details.textContent = `File: ${file.name}\nSize: ${this.core.formatBytes(file.size)}\nType: ${file.type || 'application/octet-stream'}`;
		}
		if (validateBtn) validateBtn.disabled = false;
	}

	async uploadFileChunked(file, path) {
		if (!file) throw new Error('No file selected');
		const CHUNK_SIZE = 65536;
		const reader = new FileReader();

		const readChunk = blob =>
			new Promise((resolve, reject) => {
				reader.onload = () => resolve(reader.result);
				reader.onerror = reject;
				reader.readAsArrayBuffer(blob);
			});

		const total = file.size;
		let offset = 0;

		while (offset < total) {
			const chunk = file.slice(offset, offset + CHUNK_SIZE);
			const buffer = await readChunk(chunk);
			const bytes = new Uint8Array(buffer);
			const parts = [];
			const batchSize = 8192;
			for (let i = 0; i < bytes.length; i += batchSize) {
				parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + batchSize)));
			}
			const b64 = btoa(parts.join(''));

			const [status] = await this.core.ubusCall(
				'file',
				'write',
				{
					path,
					data: b64,
					base64: true,
					...(offset > 0 ? { append: true } : {})
				},
				{ timeout: 30000 }
			);
			if (status !== 0) throw new Error('Firmware upload chunk rejected');
			offset += CHUNK_SIZE;
		}
	}

	async uploadFirmwareChunked() {
		await this.uploadFileChunked(this.firmwareFile, '/tmp/firmware.bin');
	}

	async validateFirmware() {
		if (this.firmwareBusy || !this.firmwareFile) return;
		this.firmwareBusy = true;
		this.firmwareValidatedFile = null;
		const statusEl = document.getElementById('upgrade-status');
		const progress = document.getElementById('upgrade-progress');
		const flashBtn = document.getElementById('flash-firmware-btn');
		const validateBtn = document.getElementById('validate-firmware-btn');
		if (flashBtn) flashBtn.disabled = true;
		if (validateBtn) validateBtn.disabled = true;

		if (progress) progress.style.display = 'block';
		if (statusEl) statusEl.textContent = 'Uploading firmware...';

		try {
			await this.uploadFirmwareChunked();
			if (statusEl) statusEl.textContent = 'Checking firmware signature...';

			// Verify the detached usign signature when one is supplied. A bad
			// signature blocks installation; an unsigned image requires an extra
			// explicit confirmation at flash time.
			this.firmwareUnsigned = false;
			let verify = { verified: false, reason: 'unsigned' };
			if (this.firmwareSigFile) {
				await this.uploadFileChunked(this.firmwareSigFile, '/tmp/firmware.bin.sig');
				const [vs, vr] = await this.core.ubusCall('file', 'exec',
					{ command: '/usr/libexec/moci-verify-image', params: ['/tmp/firmware.bin', '/tmp/firmware.bin.sig'] },
					{ timeout: 30000 });
				try { verify = JSON.parse(vr?.stdout || '{}'); } catch { verify = { verified: false, reason: 'invalid signature' }; }
				if (vs !== 0) verify = { verified: false, reason: 'verification failed' };
			} else {
				const [vs, vr] = await this.core.ubusCall('file', 'exec',
					{ command: '/usr/libexec/moci-verify-image', params: ['/tmp/firmware.bin'] },
					{ timeout: 30000 });
				try { verify = JSON.parse(vr?.stdout || '{}'); } catch { verify = { verified: false, reason: 'unsigned' }; }
			}
			if (this.firmwareSigFile && !verify.verified) {
				if (statusEl) statusEl.textContent = 'Signature check failed: ' + (verify.reason || 'invalid signature') + '. Installation blocked.';
				this.core.showToast('Firmware signature is invalid — installation blocked', 'error');
				await this.core.ubusCall('file', 'exec', { command: '/bin/rm', params: ['-f', '/tmp/firmware.bin'] });
				await this.core.ubusCall('file', 'exec', { command: '/bin/rm', params: ['-f', '/tmp/firmware.bin.sig'] }).catch(() => {});
				return;
			}
			this.firmwareUnsigned = !verify.verified;

			if (statusEl) statusEl.textContent = 'Validating firmware...';
			const [s, r] = await this.core.ubusCall(
				'file',
				'exec',
				{ command: '/sbin/sysupgrade', params: ['--test', '/tmp/firmware.bin'] },
				{ timeout: 30000 }
			);

			if (s !== 0 || r?.code !== 0) {
				const err = r?.stderr || r?.stdout || 'Validation failed';
				if (statusEl) statusEl.textContent = 'Validation failed: ' + err;
				this.core.showToast('Firmware validation failed', 'error');
				await this.core.ubusCall('file', 'exec', { command: '/bin/rm', params: ['-f', '/tmp/firmware.bin'] });
				return;
			}

			const sigNote = verify.verified ? 'Signature verified. ' : (this.firmwareUnsigned ? 'Unsigned image — extra confirmation required. ' : '');
			if (statusEl) statusEl.textContent = sigNote + 'Firmware validated successfully. Ready to flash.';
			this.firmwareValidatedFile = this.firmwareFile;
			if (flashBtn) flashBtn.disabled = false;
			this.core.showToast(verify.verified ? 'Firmware validated and signature verified' : 'Firmware validated', 'success');
		} catch {
			if (statusEl) statusEl.textContent = 'Upload or validation failed';
			this.core.showToast('Firmware validation failed', 'error');
			try {
				await this.core.ubusCall('file', 'exec', { command: '/bin/rm', params: ['-f', '/tmp/firmware.bin'] });
			} catch {}
		} finally {
			this.firmwareBusy = false;
			if (validateBtn) validateBtn.disabled = !this.firmwareFile;
		}
	}

	async flashFirmware() {
		if (this.firmwareBusy || !this.firmwareFile || this.firmwareValidatedFile !== this.firmwareFile) {
			this.core.showToast('Validate the selected firmware image before flashing.', 'error');
			return;
		}
		if (this.firmwareUnsigned && !confirm('This image has no valid Haven signature. Only continue if you built it yourself and trust it. Flash unsigned firmware?')) return;
		if (!confirm('Flash firmware now? The device will reboot.')) return;
		if (!confirm('This will replace the firmware. Proceed?')) return;
		this.firmwareBusy = true;
		this.firmwareValidatedFile = null;
		const flashBtn = document.getElementById('flash-firmware-btn');
		if (flashBtn) flashBtn.disabled = true;

		const statusEl = document.getElementById('upgrade-status');
		const keepSettings = document.getElementById('keep-settings')?.checked;
		const params = keepSettings ? ['/tmp/firmware.bin'] : ['-n', '/tmp/firmware.bin'];

		if (statusEl) statusEl.textContent = 'Flashing firmware... Do not power off the device.';

		try {
			const [status, result] = await this.core.ubusCall(
				'file',
				'exec',
				{ command: '/sbin/sysupgrade', params },
				{ timeout: 120000, retries: 0 }
			);
			if (status !== 0 || result?.code !== 0) {
				if (statusEl) statusEl.textContent = 'Firmware upgrade command failed. Check router logs before retrying.';
				this.core.showToast('Firmware upgrade command failed', 'error');
				return;
			}
			if (statusEl) statusEl.textContent = 'Upgrade command accepted. Wait for reboot, then verify the installed firmware.';
			this.core.showToast('Upgrade started. Verify firmware after reboot.', 'info');
		} catch {
			if (statusEl) statusEl.textContent = 'Connection lost during upgrade. The outcome is unverified. Wait for the router to return and check its firmware before retrying.';
		} finally {
			this.firmwareBusy = false;
		}
	}

	async loadUpgrade() {
		const root = document.getElementById('upgrade-current-version');
		if (!root) return;
		root.replaceChildren();
		const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
		let version = 'unknown', status = '';
		try {
			const [s, r] = await this.core.ubusCall('file', 'read', { path: '/etc/moci-release' }, { timeout: 10000 });
			if (s === 0 && r?.data) {
				const mv = r.data.match(/MOCI_VERSION=(.+)/); if (mv) version = mv[1].trim();
				const ms = r.data.match(/MOCI_STATUS=(.+)/); if (ms) status = ms[1].trim();
			}
		} catch {}
		root.append(el('div', 'INSTALLED FIRMWARE', 'section-title'));
		const row = el('div', undefined, 'dev-res-actions');
		row.append(el('strong', 'Haven ' + version, 'dev-name'), el('span', status || 'release', 'dev-badge static'));
		root.append(row);
		root.append(el('p', 'Updates are signed and opt-in — nothing installs automatically. Download the latest release image and its .sig signature, then use the manual upgrade below: Haven verifies the signature before installing (Install now), or you can close this page and update later. A bad signature blocks installation; an unsigned image needs an extra confirmation.', 'page-note'));
		const links = el('div', undefined, 'dev-modal-actions');
		const rel = el('a', 'LATEST RELEASES', 'action-btn'); rel.href = 'https://github.com/bfrye26/MoCI/releases'; rel.target = '_blank'; rel.rel = 'noopener';
		const asu = el('a', 'ONLINE UPDATE (LuCI)', 'action-btn'); asu.href = '/cgi-bin/luci/admin/system/attendedsysupgrade'; asu.target = '_blank'; asu.rel = 'noopener';
		links.append(rel, asu);
		root.append(links);
	}
}

