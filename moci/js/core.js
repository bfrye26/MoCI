// Bump on every frontend release so browsers fetch fresh modules instead of a
// stale cached bundle. Kept in sync with the query strings in index.html.
const ASSET_VER = '1.0.0r4';

export class OpenWrtCore {
	constructor() {
		this.sessionId = sessionStorage.getItem('ubus_session');
		// Remove legacy persisted credentials and tokens on load.
		localStorage.removeItem('saved_credentials');
		localStorage.removeItem('ubus_session');
		this.features = {};
		this.modules = new Map();
		this.routes = new Map();
		this.currentRoute = null;
		this.extensionPoints = new Map();
		this.addons = new Map();
		this.addonManifests = new Map();
		this.addonRouteMap = new Map();
		this.helpOpen = this.getSavedHelpOpen();
		this.appearanceThemes = new Set(['obsidian', 'cloud', 'ocean', 'terminal', 'amethyst', 'copper']);
		this.applyTheme(this.getSavedTheme());
	}

	getSavedTheme() {
		try {
			const stored = localStorage.getItem('moci_appearance_theme');
			return this.appearanceThemes.has(stored) ? stored : 'obsidian';
		} catch {
			return 'obsidian';
		}
	}

	getSavedHelpOpen() {
		try { return localStorage.getItem('moci_help_open') === '1'; } catch { return false; }
	}

	applyTheme(theme) {
		const next = this.appearanceThemes.has(theme) ? theme : 'obsidian';
		document.documentElement.dataset.theme = next;
		document.documentElement.style.colorScheme = next === 'cloud' ? 'light' : 'dark';
		const select = document.getElementById('moci-theme-select');
		if (select) select.value = next;
		const meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.content = ({
			obsidian: '#0b0d12', cloud: '#f5f7fa', ocean: '#09192f',
			terminal: '#10191a', amethyst: '#171321', copper: '#121519'
		})[next];
		return next;
	}

	setTheme(theme) {
		const next = this.applyTheme(theme);
		try { localStorage.setItem('moci_appearance_theme', next); } catch {}
	}

	registerRoute(path, handler) {
		this.routes.set(path, handler);
	}

	navigate(path) {
		window.location.hash = path;
	}

	getModuleForRoute(basePath) {
		const routeModuleMap = {
			dashboard: 'dashboard',
			wan: 'wan',
			'published-ports': 'published-ports',
			devices: 'devices',
			wifi: 'wifi',
			qos: 'qos',
			tls: 'tls',
			networks: 'networks',
			network: 'network',
			system: 'system',
			advanced: 'advanced',
			profiles: 'profiles',
			schedules: 'schedules',
			'wifi-profiles': 'wifi-profiles',
			'ethernet-profiles': 'ethernet-profiles',
			'vpn-policies': 'vpn-policies',
			addons: 'addons',
			features: 'features',
			bandwidth: 'bandwidth',
			multiwan: 'multiwan',
			adblock: 'adblock',
			tailscale: 'tailscale',
			terminal: 'terminal',
			statistics: 'statistics',
			nas: 'nas'
		};
		if (routeModuleMap[basePath]) return routeModuleMap[basePath];
		const addonId = this.addonRouteMap.get(basePath);
		if (addonId) return `addon:${addonId}`;
		return null;
	}

	async handleRouteChange() {
		if (!this.sessionId) return;
		this.refreshHelp();

		const hash = window.location.hash.slice(1) || '/dashboard';
		const [basePath, ...subPaths] = hash.split('/').filter(Boolean);
		const fullPath = `/${basePath}${subPaths.length ? '/' + subPaths.join('/') : ''}`;

		document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
		const navLinks = [...document.querySelectorAll('.sidebar-nav a.nav-item')];
		navLinks.forEach(link => link.classList.remove('active'));

		// Highlight the most specific sidebar entry matching the current path.
		const currentPath = `/${basePath}${subPaths.length ? '/' + subPaths.join('/') : ''}`;
		let activeLink = null;
		let bestLen = 0;
		for (const link of navLinks) {
			const href = (link.getAttribute('href') || '').replace(/^#/, '');
			if (!href) continue;
			if (currentPath === href || currentPath.startsWith(href + '/')) {
				if (href.length > bestLen) { bestLen = href.length; activeLink = link; }
			}
		}
		if (!activeLink) {
			activeLink = navLinks.find(l => (l.getAttribute('href') || '').startsWith(`#/${basePath}`)) || null;
		}
		if (activeLink) activeLink.classList.add('active');

		// Close the mobile drawer after navigating.
		document.getElementById('app-shell')?.classList.remove('sidebar-open');
		document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'false');

		if (basePath === 'dashboard') {
			this.startPolling();
		} else {
			this.stopPolling();
		}

		const moduleName = this.getModuleForRoute(basePath);
		if (moduleName) {
			await this.loadModule(moduleName);
		}

		try {
			for (const [routePath, handler] of this.routes) {
				if (fullPath === routePath || fullPath.startsWith(routePath + '/')) {
					await handler(fullPath, subPaths);
					const addonPage = document.getElementById(`addon-${basePath}-page`);
					if (addonPage) addonPage.classList.remove('hidden');
					this.currentRoute = fullPath;
					return;
				}
			}

			const pageElement =
				document.getElementById(`${basePath}-page`) || document.getElementById(`addon-${basePath}-page`);
			if (pageElement) {
				pageElement.classList.remove('hidden');
				this.currentRoute = fullPath;
			}
		} catch (err) {
			console.error('Route handler error:', err);
			this.showToast('Failed to load page', 'error');
		}
	}

	applyFeatureFlags() {
		document.querySelectorAll('[data-feature]').forEach(element => {
			const feature = element.getAttribute('data-feature');
			const enabled = this.isFeatureEnabled(feature);
			// Nav entries toggle both ways so a feature switch shows/hides them live.
			// Tab panels and pages keep their routing/sub-tab visibility: only hide
			// them when disabled, never force-show (that would reveal inactive tabs).
			if (element.classList.contains('nav-item')) {
				element.classList.toggle('hidden', !enabled);
			} else if (!enabled) {
				element.classList.add('hidden');
			}
		});
	}

	async initSession() {
		await this.loadFeatures();
		await this.loadAddonManifests();
		await this.loadModules();
		await this.loadAddons();
		this.applyFeatureFlags();
		this.showMainView();
		this.startApplication();
	}

	async init() {
		if (this.sessionId) {
			const valid = await this.validateSession();
			if (valid) {
				await this.initSession();
				return;
			}
		}

		this.showLoginView();
	}

	async loadFeatures() {
		try {
			const [status, result] = await this.uciGet('moci', 'features');

			if (status === 0 && result && result.values) {
				this.features = result.values;
			} else {
				this.features = this.getDefaultFeatures();
			}
		} catch (err) {
			console.error('Feature config not found, using defaults:', err);
			this.features = this.getDefaultFeatures();
		}
	}

	getDefaultFeatures() {
		return {
			dashboard: '1',
			network: '1',
			wireless: '1',
			firewall: '1',
			dhcp: '1',
			dns: '1',
			wireguard: '1',
			qos: '1',
			ddns: '1',
			diagnostics: '1',
			system: '1',
			backup: '1',
			packages: '1',
			services: '1',
			ssh_keys: '1',
			storage: '1',
			leds: '1',
			firmware: '1',
			addons: '1',
			sqm: '0',
			bandwidth: '0',
			multiwan: '0',
			adblock: '0',
			tailscale: '0',
			terminal: '0',
			statistics: '0',
			nas: '0'
		};
	}

	isFeatureEnabled(feature) {
		return this.features[feature] === '1';
	}

	getModuleMap() {
		return {
			dashboard: './modules/dashboard.js',
			wan: './modules/wan.js',
			'published-ports': './modules/published-ports.js',
			devices: './modules/devices.js',
			wifi: './modules/wifi.js',
			qos: './modules/qos.js',
			tls: './modules/tls.js',
			networks: './modules/networks.js',
			'app-integrations': './modules/app-integrations.js',
			network: './modules/network.js',
			system: './modules/system.js',
			advanced: './modules/advanced.js',
			profiles: './modules/profiles.js',
			schedules: './modules/wifi-schedules.js',
			'wifi-profiles': './modules/wifi-profiles.js',
			'ethernet-profiles': './modules/ethernet-profiles.js',
			'vpn-policies': './modules/vpn-policies.js',
			addons: './modules/addons.js',
			features: './modules/features.js',
			bandwidth: './modules/bandwidth.js',
			multiwan: './modules/multiwan.js',
			adblock: './modules/adblock.js',
			tailscale: './modules/tailscale.js',
			terminal: './modules/terminal.js',
			statistics: './modules/statistics.js',
			nas: './modules/nas.js'
		};
	}

	async loadModule(name) {
		if (name?.startsWith('addon:')) {
			return this.loadAddon(name.substring(6));
		}

		if (this.modules.has(name)) return this.modules.get(name);

		if (!this.shouldLoadModule(name)) return null;

		const moduleMap = this.getModuleMap();
		const path = moduleMap[name];

		if (!path) return null;

		try {
			const module = await import(path + '?v=' + ASSET_VER);
			const instance = new module.default(this);
			this.modules.set(name, instance);
			return instance;
		} catch (err) {
			console.error(`Failed to load module ${name}:`, err);
			return null;
		}
	}

	async loadModules() {
		await this.loadModule('dashboard');
		const integrations = await this.loadModule('app-integrations');
		if (integrations && typeof integrations.init === 'function') {
			await integrations.init();
		}
	}

	shouldLoadModule(moduleName) {
		const moduleFeatures = {
			dashboard: ['dashboard'],
			wan: ['network'],
			'published-ports': ['network'],
			devices: ['dhcp'],
			wifi: ['wireless'],
			qos: ['qos'],
			tls: ['system'],
			networks: ['firewall'],
			'app-integrations': ['addons'],
			network: ['network', 'wireless', 'firewall', 'dhcp', 'dns', 'diagnostics', 'wireguard', 'qos', 'ddns'],
			system: ['system', 'backup', 'packages', 'services', 'ssh_keys', 'storage', 'leds', 'firmware'],
			advanced: ['system'],
			profiles: ['firewall'],
			schedules: ['wireless'],
			'wifi-profiles': ['wireless'],
			'ethernet-profiles': ['network'],
			'vpn-policies': ['wireguard'],
			addons: ['addons'],
			features: ['system'],
			bandwidth: ['bandwidth'],
			multiwan: ['multiwan'],
			adblock: ['adblock'],
			tailscale: ['tailscale'],
			terminal: ['terminal'],
			statistics: ['statistics'],
			nas: ['nas']
		};

		const features = moduleFeatures[moduleName] || [];
		return features.some(f => this.isFeatureEnabled(f));
	}

	startApplication() {
		if (!this._applicationStarted) {
			this.attachEventListeners();
			window.addEventListener('hashchange', () => this.handleRouteChange());
			this._applicationStarted = true;
		}

		if (!window.location.hash) {
			this.navigate('/dashboard');
		} else {
			this.handleRouteChange();
		}

		if (this.modules.has('dashboard')) {
			this.startPolling();
		}
	}

	getHelpContent() {
		const hash=(window.location.hash||'#/dashboard').slice(2).split('/');
		const section=hash[0]||'dashboard';
		const tab=hash[1]||'';
		const titles={
			dashboard:'Dashboard',network:'Network',system:'System',addons:'Add-ons',docker:'App Store',
			advanced:'Advanced Config',profiles:'Security Profiles','vpn-policies':'VPN & Failover',
			'wifi-profiles':'Wi-Fi Passwords','ethernet-profiles':'Ethernet','schedules':'Wi-Fi Schedules',
			devices:'Devices',wan:'Internet (WAN)','published-ports':'Published Ports',wifi:'Wi-Fi',qos:'Traffic & QoS',tls:'HTTPS / Certificate',networks:'Guest & IoT Networks'
		};
		const topics={
			dashboard:['Overview','A live picture of your router: internet status, CPU, memory and interface traffic. The bandwidth graph updates every few seconds.','WAN “online” depends on a working upstream route and DNS — if they disagree, check routes and DNS.','Keep the administration interface off the WAN.'],
			network:['Network','Interfaces, bridges, DHCP, DNS, firewall and routing — the paths traffic takes through your router.','Keep one known-good management address before editing a LAN bridge or VLAN.','Back up settings before changing DHCP, routing or firewall.'],
			system:['System','Clock, services, packages, SSH keys, backups, firmware upgrades and storage.','Create a backup before upgrading firmware or changing storage.','Only install packages from a trusted source that matches your architecture.'],
			addons:['Add-ons','Add-ons extend MoCI and can request sensitive access to OpenWrt configuration and services.','Review an add-on’s permissions and origin before installing.','Remove add-ons you no longer use.'],
			docker:['App Store','One-click applications run on Docker Engine with automatic LAN-only firewall rules. The Docker socket is root-equivalent.','Use reviewed, digest-pinned images and keep data on persistent named volumes.','Apps are published to the LAN only — never expose admin ports to the WAN.'],
			advanced:['Advanced Config','A raw editor for service-specific OpenWrt UCI sections. Connectivity-sensitive edits apply with a timed rollback you must confirm.','Some services need a restart to activate a committed setting.','This is the power-user escape hatch — prefer the guided pages when they cover your task.'],
			profiles:['Security Profiles','A profile is an isolated network segment with its own permissions. It controls internet access, DNS, and which other profiles a device can reach.','Assign devices to a profile by Wi-Fi password, Ethernet port, or inbound VPN under “Points of entry”.','Presets: Admin (full access), Children (filtered DNS + curfew), Guest (isolated), Smart Devices (limited internet).'],
			'vpn-policies':['VPN & Failover','Route a profile’s traffic out through a WireGuard tunnel, or run a WireGuard server so your devices can reach home from anywhere.','A profile routed through a VPN keeps its DNS inside the tunnel; if the tunnel drops, traffic stops rather than leaking over the WAN.','Chain two tunnels to separate identity from destination.'],
			'wifi-profiles':['Wi-Fi Passwords','One Wi-Fi network, many passwords. The password a device uses decides its security profile — devices share the airwaves and nothing else.','Each password maps to a profile (and its own VLAN). Keep the Admin password private.','Password changes take effect when devices reconnect.'],
			'ethernet-profiles':['Ethernet','Assign a physical router port to a security profile. A device plugged into that port joins the profile’s isolated network automatically.','MoCI creates the interface, DHCP pool and firewall zone for the port.','Use this for wired devices you want isolated, like a guest desktop or IoT gear.'],
			schedules:['Wi-Fi Schedules','Turn Wi-Fi off on a schedule (a “blackout”), or set per-profile internet curfews. Wired devices stay connected during a Wi-Fi blackout.','Overnight windows (e.g. 23:00–06:00) are supported.','Schedules run on the router, so they hold even if the app is closed.'],
			devices:['Devices','Every device holding a DHCP lease, plus your static reservations. A reservation ties a MAC address to a fixed IP so it never changes.','Make a device static before pointing a port forward or a DNS name at it.','A reservation takes effect when the device reconnects or renews its lease.'],
			wan:['Internet (WAN)','How the router reaches the internet: DHCP (automatic), a static IP from your ISP, or PPPoE (username & password).','Changing the connection type briefly interrupts the link and applies with a safety rollback.','Most cable/fiber modems use DHCP; many DSL lines use PPPoE.'],
			'published-ports':['Published Ports','Let trusted LAN devices request incoming ports via UPnP / NAT-PMP, and review active mappings.','Secure mode is enforced: a device may only forward ports to itself.','UPnP is separate from the Docker App Store’s LAN-only access and never exposes the router admin.'],
			wifi:['Wi-Fi','Create and manage wireless networks (SSIDs) on each radio. Choose the security, band and which network the SSID bridges into.','Assign a guest or IoT SSID to an isolated profile so those devices stay away from your main computers.','WPA3-Personal is the strongest option for modern devices; use WPA2/WPA3 mixed for older clients.'],
			qos:['Traffic & QoS','Live throughput for the Internet and local network, plus Smart Queue Management to keep latency low under load.','Set SQM limits just below your real line speed; CAKE then shares bandwidth fairly and protects games and video calls from lag.','A device you want to prioritize should have a static IP (see Devices).'],
			tls:['HTTPS / Certificate','The certificate that secures the router’s web interface. A self-signed certificate works but makes browsers warn.','Let’s Encrypt gives a free trusted certificate for a domain you own, validated via DNS-01 (your DNS provider’s API).','No domain? Upload a certificate you obtained elsewhere, or trust the self-signed one once — the warning is cosmetic.'],
			networks:['Guest & IoT Networks','Isolated network segments for guests and smart-home devices. Each gets its own subnet, DHCP and firewall zone.','Devices on a segment can reach the internet (if allowed) but not your main computers — ideal for IoT gadgets and guest Wi-Fi.','Assign a segment to a Wi-Fi network or an Ethernet port after creating it.']
		};
		const [description,...items]=topics[section]||topics.advanced;
		const hints={
			interfaces:'WAN & interfaces bind IP addresses to devices and set how the router reaches the internet (DHCP, static, PPPoE).',
			upnp:'Published Ports lets LAN devices open inbound ports via UPnP/NAT-PMP. Manual rules always win; router-served ports are refused.',
			firewall:'Firewall zones control forwarding, masquerading and traffic rules between network segments.',
			wireless:'Wireless radios, channels and encryption. Per-password isolation depends on driver and hostapd support.',
			vpn:'WireGuard tunnels need addresses, keys, allowed IPs and routes.',
			dhcp:'DHCP hands out addresses; reservations must not conflict with static addresses. DNS settings affect every client.',
			dns:'DNS forwarding affects name resolution and privacy for LAN clients.',
			routes:'Static routes steer specific subnets through a chosen gateway or interface.',
			ddns:'Dynamic DNS keeps a hostname pointed at your changing home IP.',
			qos:'QoS prioritizes traffic classes so latency-sensitive apps stay responsive.',
			diagnostics:'Ping, traceroute and DNS lookups to test connectivity from the router.',
			mounts:'Use persistent filesystems for Docker volumes and shared data.',
			upgrade:'Verify firmware checksums and preserve a recovery image before flashing.',
			backup:'Generate a configuration backup before major changes; restore returns the router to a saved state.'
		};
		if(tab&&hints[tab])items.unshift(hints[tab]);
		return {title:titles[section]||(section.charAt(0).toUpperCase()+section.slice(1)),description,items};
	}
	refreshHelp() {
		if(!this.helpOpen)return;
		const details=this.getHelpContent();
		const title=document.getElementById('moci-help-title');
		const description=document.getElementById('moci-help-description');
		const list=document.getElementById('moci-help-topics');
		if(title)title.textContent=details.title;
		if(description)description.textContent=details.description;
		if(list) {
			list.replaceChildren();
			for(const item of details.items) {
				const li=document.createElement('li');
				li.textContent=item;
				list.appendChild(li);
			}
		}
		const fields=document.getElementById('moci-help-fields');
		if(fields) {
			const guide=this.getFieldHelp();
			fields.replaceChildren();
			const entries=Object.entries(guide);
			fields.classList.toggle('hidden',!entries.length);
			if(entries.length) {
				const h=document.createElement('h4');
				h.textContent='Field guide';
				fields.appendChild(h);
				const dl=document.createElement('dl');
				for(const [name,explain] of entries) {
					const dt=document.createElement('dt');dt.textContent=name;
					const dd=document.createElement('dd');dd.textContent=explain;
					dl.append(dt,dd);
				}
				fields.appendChild(dl);
			}
		}
	}
	getFieldHelp() {
		const section=(window.location.hash||'#/dashboard').slice(2).split('/')[0]||'dashboard';
		const guides={
			wan:{'Connection type':'How the router reaches the internet: DHCP (automatic), static IP, or PPPoE (username & password from your ISP).','IPv4 address / gateway':'Only for a static connection. The gateway is your ISP’s next-hop address.','DNS servers':'Resolvers the router uses. Leave automatic unless you run your own (e.g. Pi-hole/AdGuard).'},
			profiles:{'Name':'A short lowercase label for the segment (e.g. guest, kids, iot).','DNS':'Which resolver devices in this profile use — system, a custom resolver, or one reached through a VPN.','Outbound':'Whether traffic leaves directly over the WAN or through a WireGuard tunnel.','LAN access':'Which other profiles/devices this segment may reach. Isolated by default.','WAN access':'Whether this segment may reach the internet at all.','Quiet hours':'Time windows when internet access is blocked for this profile.'},
			devices:{'Hostname':'The name the device reports via DHCP. May be blank for some devices.','Vendor':'Identified from the MAC address prefix (OUI). Helps recognise phones, laptops and IoT gear.','Make static':'Reserve a fixed IP for this MAC so forwards and DNS names never break.','Profile':'The security profile this device is assigned to (via its Wi-Fi password, port, or reservation).'},
			'vpn-policies':{'Tunnel':'A WireGuard interface. Outbound policies route a profile through it.','Kill-switch':'If the tunnel has no recent handshake, traffic stops instead of leaking over the WAN.','Last handshake':'How long ago the tunnel last exchanged keys. “Not responding” means it is down.','Chain':'Send traffic through one tunnel, then a second, to separate identity from destination.'},
			'published-ports':{'Secure mode':'A device may only forward ports to itself — never to another host or the router.','Delegation':'Let a trusted device open its own ports on demand. Off by default; leases expire automatically.','Automatic mappings':'Ports opened by UPnP/NAT-PMP. Read-only; manual rules always win.'},
			networks:{'Segment type':'Guest, Smart Home/IoT, Kids, or fully isolated. Sets the default internet policy.','Gateway IPv4':'The .1 address of a private /24 subnet not already in use.','Allow internet':'Devices stay isolated from your main LAN either way; this only controls internet reach.'}
		};
		return guides[section]||{};
	}
	setHelpOpen(open) {
		this.helpOpen=Boolean(open);
		try{localStorage.setItem('moci_help_open',this.helpOpen?'1':'0');}catch{}
		const panel=document.getElementById('moci-help-panel');
		const toggle=document.getElementById('moci-help-toggle');
		panel?.classList.toggle('hidden',!this.helpOpen);
		if(toggle)toggle.setAttribute('aria-expanded',String(this.helpOpen));
		document.body.classList.toggle('help-mode',this.helpOpen);
		this.refreshHelp();
	}
	attachEventListeners() {
		document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
		document.getElementById('moci-help-toggle')?.addEventListener('click', () => this.setHelpOpen(!this.helpOpen));
		document.getElementById('moci-help-close')?.addEventListener('click', () => this.setHelpOpen(false));
		this.applyTheme(this.getSavedTheme());
		document.getElementById('moci-theme-select')?.addEventListener('change', event => {
			this.setTheme(event.target.value);
		});
		this.initSidebar();
		this.initNavGroups();
		this.initSearch();
		this.setHelpOpen(this.helpOpen);
		document.addEventListener('keydown', event => {
			if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
				event.preventDefault();
				this.openPalette();
			}
		});
	}

	initNavGroups() {
		let collapsed = new Set();
		try { collapsed = new Set(JSON.parse(localStorage.getItem('moci_nav_collapsed') || '[]')); } catch {}
		const save = () => { try { localStorage.setItem('moci_nav_collapsed', JSON.stringify([...collapsed])); } catch {} };
		document.querySelectorAll('.sidebar-nav .nav-group').forEach(group => {
			const label = group.querySelector('.nav-group-label');
			if (!label || label.dataset.collapseInit) return;
			label.dataset.collapseInit = '1';
			const name = label.textContent.trim();
			label.setAttribute('role', 'button');
			label.setAttribute('tabindex', '0');
			const caret = document.createElement('span');
			caret.className = 'nav-group-caret';
			caret.setAttribute('aria-hidden', 'true');
			label.appendChild(caret);
			const apply = () => {
				const isCollapsed = collapsed.has(name);
				group.classList.toggle('collapsed', isCollapsed);
				label.setAttribute('aria-expanded', String(!isCollapsed));
			};
			const toggle = () => {
				if (collapsed.has(name)) collapsed.delete(name); else collapsed.add(name);
				save(); apply();
			};
			label.addEventListener('click', toggle);
			label.addEventListener('keydown', event => {
				if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
			});
			apply();
		});
	}

	openPalette() {
		const input = document.getElementById('moci-search');
		if (!input) return;
		input.focus();
		input.select();
		this.renderSearch();
	}

	initSidebar() {
		const shell = document.getElementById('app-shell');
		if (!shell) return;
		const collapseBtn = document.getElementById('sidebar-collapse');
		const menuToggle = document.getElementById('menu-toggle');
		const scrim = document.getElementById('sidebar-scrim');
		try {
			if (localStorage.getItem('moci_sidebar_collapsed') === '1') shell.classList.add('sidebar-collapsed');
		} catch {}
		collapseBtn?.addEventListener('click', () => {
			shell.classList.toggle('sidebar-collapsed');
			try {
				localStorage.setItem('moci_sidebar_collapsed', shell.classList.contains('sidebar-collapsed') ? '1' : '0');
			} catch {}
			window.dispatchEvent(new Event('resize'));
		});
		const closeDrawer = () => {
			shell.classList.remove('sidebar-open');
			menuToggle?.setAttribute('aria-expanded', 'false');
		};
		menuToggle?.addEventListener('click', () => {
			const open = shell.classList.toggle('sidebar-open');
			menuToggle.setAttribute('aria-expanded', String(open));
		});
		scrim?.addEventListener('click', closeDrawer);
		document.addEventListener('keydown', event => {
			if (event.key === 'Escape') { closeDrawer(); this.closeSearch(); }
		});
		window.addEventListener('resize', () => { if (window.innerWidth > 900) closeDrawer(); });
	}

	buildSearchIndex() {
		const items = [];
		document.querySelectorAll('.sidebar-nav a.nav-item').forEach(link => {
			if (link.classList.contains('hidden')) return;
			const label = link.querySelector('.nav-label')?.textContent?.trim() || link.textContent.trim();
			const group = link.closest('.nav-group')?.querySelector('.nav-group-label')?.textContent?.trim() || 'Overview';
			const icon = link.querySelector('.nav-ico')?.innerHTML || '';
			items.push({ path: (link.getAttribute('href') || '').replace(/^#/, ''), label, group, icon, keywords: `${label} ${group}` });
		});
		const extra = [
			['/network/wireless', 'Wireless Radios', 'Network'],
			['/network/dns', 'DNS & Hosts', 'Network'],
			['/network/ddns', 'Dynamic DNS', 'Network'],
			['/network/qos', 'QoS', 'Network'],
			['/network/routes', 'Static Routes', 'Network'],
			['/network/diagnostics', 'Diagnostics (ping / traceroute)', 'Network'],
			['/advanced/group/network', 'Network Services (UCI)', 'Advanced'],
			['/advanced/group/routing', 'Routing & Failover (UCI)', 'Advanced'],
			['/advanced/group/security', 'Security Services (UCI)', 'Advanced'],
			['/advanced/group/monitoring', 'Monitoring (UCI)', 'Advanced'],
			['/advanced/group/services', 'Storage & Services (UCI)', 'Advanced'],
			['/advanced/group/system', 'System Tools (UCI)', 'Advanced'],
			['/system/backup', 'Backup & Reset', 'System'],
			['/system/upgrade', 'Firmware Upgrade', 'System'],
			['/system/software', 'Packages', 'System'],
			['/system/startup', 'Startup Services', 'System'],
			['/system/ssh-keys', 'SSH Keys', 'System'],
			['/system/mounts', 'Storage & Mounts', 'System']
		];
		for (const [path, label, group] of extra) items.push({ path, label, group, icon: '', keywords: `${label} ${group}` });
		return items;
	}

	renderSearch() {
		const input = document.getElementById('moci-search');
		const results = document.getElementById('search-results');
		if (!input || !results) return;
		const query = input.value.trim().toLowerCase();
		results.replaceChildren();
		this._searchKbd = -1;
		const index = this.buildSearchIndex();
		// With no query (e.g. Ctrl+K) show the full command list, palette-style.
		const matches = (query
			? index.filter(it => it.label.toLowerCase().includes(query) || it.keywords.toLowerCase().includes(query))
			: index).slice(0, query ? 9 : 14);
		if (!matches.length) {
			const empty = document.createElement('div');
			empty.className = 'search-empty';
			empty.textContent = 'No matching settings or pages.';
			results.appendChild(empty);
			results.classList.remove('hidden');
			return;
		}
		for (const it of matches) {
			const a = document.createElement('a');
			a.className = 'search-result';
			a.href = `#${it.path}`;
			const ico = document.createElement('span');
			ico.className = 'nav-ico';
			ico.innerHTML = it.icon;
			const label = document.createElement('span');
			label.textContent = it.label;
			const group = document.createElement('small');
			group.textContent = it.group;
			a.append(ico, label, group);
			a.addEventListener('click', () => this.closeSearch());
			results.appendChild(a);
		}
		results.classList.remove('hidden');
	}

	initSearch() {
		const input = document.getElementById('moci-search');
		const results = document.getElementById('search-results');
		if (!input || !results) return;
		input.addEventListener('input', () => this.renderSearch());
		input.addEventListener('focus', () => this.renderSearch());
		input.addEventListener('keydown', event => {
			const items = [...results.querySelectorAll('.search-result')];
			let kbd = this._searchKbd ?? -1;
			if (event.key === 'ArrowDown') { event.preventDefault(); kbd = Math.min(kbd + 1, items.length - 1); this._searchKbd = kbd; this.markSearchKbd(items, kbd); }
			else if (event.key === 'ArrowUp') { event.preventDefault(); kbd = Math.max(kbd - 1, 0); this._searchKbd = kbd; this.markSearchKbd(items, kbd); }
			else if (event.key === 'Enter') {
				event.preventDefault();
				const target = items[kbd] || items[0];
				if (target) { this.navigate(target.getAttribute('href').slice(1)); this.closeSearch(); input.blur(); }
			} else if (event.key === 'Escape') { this.closeSearch(); input.blur(); }
		});
		document.addEventListener('click', event => {
			if (!event.target.closest('.topbar-search')) this.closeSearch();
		});
	}

	markSearchKbd(items, kbd) {
		items.forEach((el, i) => el.classList.toggle('kbd-active', i === kbd));
		items[kbd]?.scrollIntoView({ block: 'nearest' });
	}

	closeSearch() {
		document.getElementById('search-results')?.classList.add('hidden');
		const input = document.getElementById('moci-search');
		if (input) input.value = '';
	}

	startPolling() {
		if (this.pollInterval) clearInterval(this.pollInterval);
		if (this._visibilityHandler) {
			document.removeEventListener('visibilitychange', this._visibilityHandler);
		}

		this.pollInterval = setInterval(() => {
			if (document.hidden) return;
			if (this.modules.has('dashboard')) {
				this.modules.get('dashboard').update();
			}
		}, 3000);

		this._visibilityHandler = () => {
			if (!document.hidden && this.modules.has('dashboard')) {
				this.modules.get('dashboard').update();
			}
		};
		document.addEventListener('visibilitychange', this._visibilityHandler);
	}

	stopPolling() {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
		if (this._visibilityHandler) {
			document.removeEventListener('visibilitychange', this._visibilityHandler);
			this._visibilityHandler = null;
		}
	}

	async login(username, password) {
		let response;
		try {
			response = await fetch('/ubus', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'call',
					params: [
						'00000000000000000000000000000000',
						'session',
						'login',
						{ username, password }
					]
				})
			});
		} catch (error) {
			console.error('MoCI cannot reach authenticated /ubus endpoint:', error);
			throw new Error('Cannot connect to /ubus. Check uhttpd, the HTTPS certificate, and any HTTP-to-HTTPS redirect. LuCI is available at /cgi-bin/luci/.');
		}
		if (!response.ok) {
			throw new Error(`/ubus returned HTTP ${response.status}. Check uhttpd-mod-ubus and the router web server settings.`);
		}
		let data;
		try {
			data = await response.json();
		} catch {
			throw new Error('The /ubus endpoint returned a non-JSON response. Confirm the ubus_prefix is /ubus and uhttpd-mod-ubus is installed.');
		}
		if (!Array.isArray(data.result) || data.result[0] !== 0 || !data.result[1]?.ubus_rpc_session) {
			throw new Error('The router rejected the login. Check the username, password and rpcd session permissions.');
		}
		this.sessionId = data.result[1].ubus_rpc_session;
		sessionStorage.setItem('ubus_session', this.sessionId);
		try {
			await this.initSession();
		} catch (error) {
			console.error('MoCI authenticated but failed to initialize:', error);
			throw new Error('Authentication succeeded, but MoCI did not finish loading: ' + error.message);
		}
	}

	async validateSession() {
		try {
			const [status] = await this.ubusCall('session', 'access', {});
			return status === 0;
		} catch {
			return false;
		}
	}

	async logout() {
		try {
			await this.ubusCall('session', 'destroy', {});
		} catch {}

		this.stopPolling();
		sessionStorage.removeItem('ubus_session');
		this.sessionId = null;
		this.showLoginView();
	}

	showLoginView() {
		window.location.hash = '';
		document.getElementById('login-view').classList.remove('hidden');
		document.getElementById('main-view').classList.add('hidden');

		const loginForm = document.getElementById('login-form');
		const passwordField = document.getElementById('password');
		if (passwordField) passwordField.value = '';

		loginForm.onsubmit = async e => {
			e.preventDefault();
			const username = document.getElementById('username').value;
			const password = document.getElementById('password').value;

			try {
				await this.login(username, password);
			} catch (err) {
				console.error('Login error:', err);
				this.showToast('MoCI: ' + err.message, 'error');
			}
		};
	}

	showMainView() {
		document.getElementById('login-view').classList.add('hidden');
		document.getElementById('main-view').classList.remove('hidden');
	}

	async checkSessionAfterDenied(requestSession) {
		if (!requestSession || requestSession !== this.sessionId) return;
		if (this._sessionCheck?.id === requestSession) return this._sessionCheck.promise;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 4000);
		const promise = (async () => {
			try {
				// An individual ACL denial does not prove that login expired.
				const response = await fetch('/ubus', {
					method:'POST',headers:{'Content-Type':'application/json'},
					signal:controller.signal,
					body:JSON.stringify({jsonrpc:'2.0',id:Math.random(),method:'call',
						params:[requestSession,'session','access',{}]})
				});
				const data = response.ok ? await response.json() : null;
				const expired = response.status === 401 || [4,6].includes(data?.result?.[0]) || data?.error?.code === -32002;
				if (expired && this.sessionId === requestSession) {
					this.stopPolling();
					sessionStorage.removeItem('ubus_session');
					this.sessionId = null;
					this.showLoginView();
					this.showToast('Your router session has expired. Please log in again.', 'info');
				}
			} catch {
				// Router unavailability is not proof that login expired.
			} finally { clearTimeout(timer); }
		})();
		this._sessionCheck = {id:requestSession,promise};
		try { await promise; }
		finally { if (this._sessionCheck?.promise === promise) this._sessionCheck = null; }
	}

	async ubusCall(object, method, params = {}, { timeout = 10000, retries = 0 } = {}) {
		let lastError;
		for (let attempt = 0; attempt <= retries; attempt++) {
			const requestSession = this.sessionId;
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeout);
			try {
				const response = await fetch('/ubus', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					signal: controller.signal,
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: Math.random(),
						method: 'call',
						params: [requestSession || '00000000000000000000000000000000', object, method, params]
					})
				});
				clearTimeout(timer);
				const data = await response.json();
				if (object !== 'session' && (data.result?.[0] === 6 || data.error?.code === -32002)) {
					await this.checkSessionAfterDenied(requestSession);
				}
				if (data.error) throw new Error(data.error.message || `${object}.${method} failed`);
				return data.result;
			} catch (err) {
				clearTimeout(timer);
				lastError =
					err.name === 'AbortError' ? new Error(`${object}.${method} timed out after ${timeout}ms`) : err;
				if (attempt < retries) {
					await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
				}
			}
		}
		throw lastError;
	}

	uciGet(config, section = null) {
		const params = { config };
		if (section) params.section = section;
		return this.ubusCall('uci', 'get', params, { retries: 2 });
	}

	uciSet(config, section, values) {
		return this.uciWrite('set', { config, section, values });
	}

	uciAdd(config, type, name = null) {
		const params = { config, type };
		if (name) params.name = name;
		return this.uciWrite('add', params);
	}

	uciDelete(config, section, option = null) {
		const params = { config, section };
		if (option) params.option = option;
		return this.uciWrite('delete', params);
	}

	uciCommit(config) {
		return this.uciWrite('commit', { config });
	}

	async uciWrite(method, params) {
		if (this._uciApplyPending && !['apply', 'confirm', 'revert'].includes(method)) {
			throw new Error('Finish confirming the pending network change before saving again');
		}
		const result = await this.ubusCall('uci', method, params);
		if (!Array.isArray(result) || result[0] !== 0) {
			throw new Error(`OpenWrt rejected uci.${method} (status ${result?.[0] ?? 'missing'})`);
		}
		return result;
	}

	async uciApplyConfig(config) {
		if (!['network', 'firewall', 'wireless'].includes(config)) return this.uciCommit(config);
		if (this._uciApplyPending) throw new Error('A network change is already awaiting confirmation');
		this._uciApplyPending = true;
		let applied = false;
		try {
			// rpcd applies all changes in this session. Do not include edits from another form.
			const [status, data] = await this.ubusCall('uci', 'changes', {});
			if (status !== 0 || !data?.changes) throw new Error('Cannot inspect pending configuration changes');
			const pending = Object.entries(data.changes).filter(([, changes]) => changes.length);
			if (pending.some(([name]) => name !== config)) {
				throw new Error('Other configuration changes are pending. Review them before applying this form');
			}
			if (!pending.length) return;
			// Never commit first: rpcd must snapshot the previous persistent configuration.
			await this.uciWrite('apply', {rollback: true, timeout: 60});
			applied = true;
			const deadline = Date.now() + 50000;
			this.showToast('Applying settings. Confirm connectivity within 60 seconds or OpenWrt will roll them back.', 'info');
			await new Promise(resolve => setTimeout(resolve, 2500));
			const [reachable] = await this.ubusCall('system', 'info', {}, {timeout: 5000});
			if (reachable !== 0) throw new Error('Router connectivity could not be verified');
			if (!window.confirm('The router answered after applying the change. Check that your connection works. Keep these settings?\n\nCancel, or leave this unanswered, to let OpenWrt restore the previous settings after 60 seconds.')) {
				throw new Error('Settings left unconfirmed');
			}
			if (Date.now() >= deadline) throw new Error('Confirmation window expired');
			await this.uciWrite('confirm', {});
		} catch (error) {
			let recovery = '';
			if (applied) {
				try {
					// rpcd rollback restores both files and the pre-apply staging delta.
					// Discard that delta too, so a later save cannot reapply a cancelled edit.
					const [status] = await this.ubusCall('uci', 'rollback', {}, {timeout: 5000});
					if (status !== 0 && status !== 4) throw new Error('Rollback was not acknowledged');
					await this.uciWrite('revert', {config});
					recovery = 'Previous settings restored and staged edits discarded.';
				} catch {
					recovery = 'Unconfirmed applied changes will time out. Reconnect and review staged edits before saving again.';
				}
			}
			this.showToast(`${error.message}. ${recovery}`.trim(), 'error');
			throw error;
		} finally {
			this._uciApplyPending = false;
		}
	}

	serviceReload(service) {
		return this.ubusCall('file', 'exec', {
			command: `/etc/init.d/${service}`,
			params: ['reload']
		});
	}

	openModal(modalId) {
		document.getElementById(modalId)?.classList.remove('hidden');
	}

	closeModal(modalId) {
		document.getElementById(modalId)?.classList.add('hidden');
	}

	setupModal(options) {
		const { modalId, openBtnId, closeBtnId, cancelBtnId, saveBtnId, saveHandler } = options;

		if (openBtnId) {
			document.getElementById(openBtnId)?.addEventListener('click', () => this.openModal(modalId));
		}
		if (closeBtnId) {
			document.getElementById(closeBtnId)?.addEventListener('click', () => this.closeModal(modalId));
		}
		if (cancelBtnId) {
			document.getElementById(cancelBtnId)?.addEventListener('click', () => this.closeModal(modalId));
		}
		if (saveBtnId && saveHandler) {
			document.getElementById(saveBtnId)?.addEventListener('click', saveHandler);
		}
	}

	renderEmptyTable(tbody, colspan, message) {
		tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center; color: var(--steel-muted);">${message}</td></tr>`;
	}

	renderBadge(type, text) {
		return `<span class="badge badge-${type}">${text}</span>`;
	}

	renderStatusBadge(condition, trueText = 'ENABLED', falseText = 'DISABLED') {
		return condition ? this.renderBadge('success', trueText) : this.renderBadge('error', falseText);
	}

	renderActionButtons(id) {
		const eid = this.escapeHtml(id);
		return `<button class="action-btn-sm" data-action="edit" data-id="${eid}">EDIT</button><button class="action-btn-sm danger" data-action="delete" data-id="${eid}">DELETE</button>`;
	}

	showToast(message, type = 'info') {
		const toast = document.createElement('div');
		toast.className = `toast toast-${type}`;
		toast.textContent = message;
		document.body.appendChild(toast);

		setTimeout(() => toast.classList.add('show'), 100);
		setTimeout(() => {
			toast.classList.remove('show');
			setTimeout(() => toast.remove(), 300);
		}, 3000);
	}

	formatBytes(bytes) {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	formatUptime(seconds) {
		const days = Math.floor(seconds / 86400);
		const hours = Math.floor((seconds % 86400) / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		return `${days}d ${hours}h ${minutes}m`;
	}

	formatMemory(mem) {
		const totalBytes = Math.max(1,Number(mem.total)||1);
		// "available" excludes reclaimable cache; free alone exaggerates RAM pressure.
		const availableBytes = Math.max(0,Math.min(totalBytes,Number(mem.available ?? mem.free ?? 0)));
		const total = Math.round(totalBytes / 1024 / 1024);
		const used = Math.round((totalBytes - availableBytes) / 1024 / 1024);
		const percent = Math.round((1 - availableBytes / totalBytes) * 100);
		return `${used}MB / ${total}MB (${percent}%)`;
	}

	formatRate(kbps) {
		const mbps = kbps / 1000;
		if (mbps < 0.01) return '0 Mbps';
		if (mbps < 1) return `${mbps.toFixed(2)} Mbps`;
		return `${mbps.toFixed(1)} Mbps`;
	}

	escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	setupSubTabs(pageId, loadHandlers) {
		const listeners = [];

		const showSubTab = tab => {
			document.querySelectorAll(`#${pageId} .tab-content`).forEach(content => {
				content.classList.add('hidden');
			});
			document.querySelectorAll(`#${pageId} .tab-btn`).forEach(btn => {
				btn.classList.remove('active');
			});

			const tabContent = document.getElementById(`tab-${tab}`);
			if (tabContent) tabContent.classList.remove('hidden');

			const tabBtn = document.querySelector(`#${pageId} .tab-btn[data-tab="${tab}"]`);
			if (tabBtn) tabBtn.classList.add('active');

			if (loadHandlers[tab]) {
				loadHandlers[tab]();
			}
		};

		const attachListeners = () => {
			document.querySelectorAll(`#${pageId} .tab-btn`).forEach(btn => {
				const handler = e => {
					const tab = e.target.getAttribute('data-tab');
					const basePath = pageId.replace('-page', '');
					this.navigate(`/${basePath}/${tab}`);
				};
				btn.addEventListener('click', handler);
				listeners.push({ element: btn, handler });
			});
		};

		const cleanup = () => {
			listeners.forEach(({ element, handler }) => {
				element.removeEventListener('click', handler);
			});
			listeners.length = 0;
		};

		return { showSubTab, attachListeners, cleanup };
	}

	showSkeleton(elementId) {
		const element = document.getElementById(elementId);
		if (!element) return;
		element.classList.add('loading-skeleton');
	}

	hideSkeleton(elementId) {
		const element = document.getElementById(elementId);
		if (!element) return;
		element.classList.remove('loading-skeleton');
	}

	async loadResource(tableId, colspan, feature, fetcher) {
		if (feature && !this.isFeatureEnabled(feature)) return;
		this.showSkeleton(tableId);
		try {
			await fetcher();
		} catch (err) {
			console.error(`Failed to load ${tableId}:`, err);
			const tbody = document.querySelector(`#${tableId} tbody`);
			if (tbody) this.renderEmptyTable(tbody, colspan, 'Failed to load data');
		} finally {
			this.hideSkeleton(tableId);
		}
	}

	delegateActions(containerId, handlers) {
		const container = document.getElementById(containerId);
		if (!container) return null;
		const handler = e => {
			const button = e.target.closest('[data-action]');
			if (!button) return;
			const action = button.getAttribute('data-action');
			const id = button.getAttribute('data-id');
			if (handlers[action]) handlers[action](id);
		};
		container.addEventListener('click', handler);
		return () => container.removeEventListener('click', handler);
	}

	registerExtension(pointName, contribution) {
		if (!this.extensionPoints.has(pointName)) {
			this.extensionPoints.set(pointName, []);
		}
		this.extensionPoints.get(pointName).push(contribution);
	}

	getExtensions(pointName) {
		return this.extensionPoints.get(pointName) || [];
	}

	async pkgCall(action, ...args) {
		const params = [action, ...args.filter(a => a !== undefined).map(String)];
		const [status, out] = await this.ubusCall(
			'file',
			'exec',
			{
				command: '/usr/libexec/moci-pkg-call',
				params
			},
			{ timeout: 120000 }
		);
		if (status !== 0) throw new Error(`moci-pkg-call ${action} denied`);
		if (out?.code && out.code !== 0) throw new Error(out.stderr?.trim() || `moci-pkg-call ${action} failed`);
		return out?.stdout || '';
	}

	async listPresentAddons() {
		const out = await this.pkgCall('list-present');
		return out
			.split('\n')
			.map(l => l.trim())
			.filter(id => /^[a-zA-Z0-9_-]+$/.test(id));
	}

	async listInstalledPackages() {
		try {
			const out = await this.pkgCall('list-installed');
			return new Set(
				out
					.split('\n')
					.map(l => l.trim().split(/\s+/)[0])
					.filter(Boolean)
			);
		} catch {
			return new Set();
		}
	}

	async loadAddonManifests() {
		if (!this.isFeatureEnabled('addons')) return;
		let ids;
		try {
			ids = await this.listPresentAddons();
		} catch (err) {
			console.warn('Failed to enumerate addons:', err);
			return;
		}
		for (const id of ids) {
			try {
				const resp = await fetch(`/moci/js/addons/${id}/manifest.json`);
				if (!resp.ok) continue;
				const manifest = await resp.json();
				this.addonManifests.set(id, manifest);
				const addonBase = manifest.nav?.route?.split('/').filter(Boolean)[0];
				if (addonBase) this.addonRouteMap.set(addonBase, id);
			} catch (err) {
				console.warn('Failed to load addon manifest:', id, err);
			}
		}
	}

	async loadAddon(id) {
		if (this.addons.has(id)) return this.addons.get(id);
		if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
		try {
			const module = await import(`./addons/${id}/addon.js`);
			const instance = new module.default(this);
			if (typeof instance.init === 'function') await instance.init();
			this.addons.set(id, instance);
			if (typeof instance.getExtensions === 'function') {
				const extensions = instance.getExtensions();
				for (const [pointName, contribution] of Object.entries(extensions)) {
					this.registerExtension(pointName, { ...contribution, _addonId: id });
				}
			}
			return instance;
		} catch (err) {
			console.error(`Failed to load addon ${id}:`, err);
			return null;
		}
	}

	async loadAddons() {
		for (const [id, manifest] of this.addonManifests) {
			try {
				const instance = await this.loadAddon(id);
				if (!instance) continue;
				this.injectAddonCSS(id, manifest);
				this.injectAddonNav(id, manifest);
				this.createAddonPage(id, manifest);
			} catch (error) {
				// A malformed add-on must not make a successful login appear to fail.
				console.warn('MoCI skipped add-on initialization:', id, error);
			}
		}
	}

	injectAddonCSS(id, manifest) {
		if (!manifest.css) return;
		if (/(?:^|\/)\.\.(?:\/|$)/.test(manifest.css) || manifest.css.startsWith('/') || manifest.css.includes('\\'))
			return;
		if (document.querySelector(`link[data-addon="${id}"]`)) return;
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = `/moci/js/addons/${id}/${manifest.css}`;
		link.setAttribute('data-addon', id);
		document.head.appendChild(link);
	}

	injectAddonNav(id, manifest) {
		if (!manifest.nav || manifest.nav.placement === 'none') return;
		if (document.querySelector(`a[data-addon="${id}"]`)) return;

		const sidebarNav = document.querySelector('.sidebar-nav');
		if (!sidebarNav) return;

		const link = document.createElement('a');
		link.href = `#${manifest.nav.route}`;
		link.className = 'nav-item';
		link.setAttribute('data-addon', id);
		const ico = document.createElement('span');
		ico.className = 'nav-ico';
		ico.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/></svg>';
		const label = document.createElement('span');
		label.className = 'nav-label';
		label.textContent = manifest.nav.label;
		link.append(ico, label);

		let group = document.getElementById('apps-nav-group');
		if (!group) {
			group = document.createElement('div');
			group.className = 'nav-group';
			group.id = 'apps-nav-group';
			const heading = document.createElement('span');
			heading.className = 'nav-group-label';
			heading.textContent = 'Apps';
			group.appendChild(heading);
			sidebarNav.appendChild(group);
		}
		group.appendChild(link);
		group.classList.remove('hidden');
	}

	createAddonPage(id, manifest) {
		if (!manifest.nav || manifest.nav.placement === 'none') return;
		const pageId = `addon-${id}-page`;
		if (document.getElementById(pageId)) return;
		const page = document.createElement('div');
		page.id = pageId;
		page.className = 'page hidden';
		document.querySelector('.content')?.appendChild(page);
	}

	removeAddon(id) {
		const instance = this.addons.get(id);
		if (instance?.cleanup) instance.cleanup();
		this.addons.delete(id);
		const manifest = this.addonManifests.get(id);
		if (manifest) {
			const addonBase = manifest.nav?.route?.split('/').filter(Boolean)[0];
			if (addonBase) this.addonRouteMap.delete(addonBase);
		}
		this.addonManifests.delete(id);
		document.querySelector(`a[data-addon="${id}"]`)?.remove();
		document.getElementById(`addon-${id}-page`)?.remove();
		document.querySelector(`link[data-addon="${id}"]`)?.remove();
		for (const [key, contribs] of this.extensionPoints) {
			this.extensionPoints.set(
				key,
				contribs.filter(c => c._addonId !== id)
			);
		}
	}

	renderTable(tableSelector, items, colspan, emptyMsg, rowFn) {
		const tbody = document.querySelector(`${tableSelector} tbody`);
		if (!tbody) return;
		if (items.length === 0) {
			this.renderEmptyTable(tbody, colspan, emptyMsg);
			return;
		}
		tbody.innerHTML = items.map(rowFn).join('');
	}

	renderLogLines(element, lines, emptyMsg = 'No logs available') {
		if (!element) return;
		if (!lines.length) {
			element.innerHTML = `<div class="log-line">${this.escapeHtml(emptyMsg)}</div>`;
			return;
		}
		element.innerHTML = lines
			.map(line => {
				let className = 'log-line';
				const lower = line.toLowerCase();
				if (lower.includes('error') || lower.includes('fail')) className += ' error';
				else if (lower.includes('warn')) className += ' warn';
				return `<div class="${className}">${this.escapeHtml(line)}</div>`;
			})
			.join('');
	}

	createCombobox(container, { placeholder = '', onChange } = {}) {
		const el = typeof container === 'string' ? document.getElementById(container) : container;
		if (!el) return null;
		el.classList.add('combobox');
		el.innerHTML = `
			<div class="combobox-control">
				<input type="text" class="combobox-input" placeholder="${this.escapeHtml(placeholder)}" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" />
			</div>
			<ul class="combobox-menu hidden" role="listbox"></ul>`;
		const control = el.querySelector('.combobox-control');
		const input = el.querySelector('.combobox-input');
		const menu = el.querySelector('.combobox-menu');

		let options = [];
		let selected = [];
		let active = 0;
		let open = false;

		const filtered = () => {
			const q = input.value.trim().toLowerCase();
			return options.filter(o => !selected.includes(o) && o.toLowerCase().includes(q));
		};

		const renderChips = () => {
			control.querySelectorAll('.combobox-chip').forEach(c => c.remove());
			selected.forEach(val => {
				const chip = document.createElement('span');
				chip.className = 'combobox-chip';
				chip.innerHTML = `${this.escapeHtml(val)} <button type="button" aria-label="Remove ${this.escapeHtml(val)}">&times;</button>`;
				chip.querySelector('button').addEventListener('click', e => {
					e.stopPropagation();
					remove(val);
				});
				control.insertBefore(chip, input);
			});
			input.placeholder = selected.length ? '' : placeholder;
		};

		const renderMenu = () => {
			const opts = filtered();
			if (active >= opts.length) active = opts.length - 1;
			if (active < 0) active = 0;
			menu.innerHTML = opts.length
				? opts
						.map(
							(o, i) =>
								`<li class="combobox-option${i === active ? ' is-active' : ''}" role="option" aria-selected="${i === active}" data-value="${this.escapeHtml(o)}">${this.escapeHtml(o)}</li>`
						)
						.join('')
				: '<li class="combobox-empty">No matches</li>';
		};

		const openMenu = () => {
			open = true;
			control.classList.add('is-open');
			menu.classList.remove('hidden');
			input.setAttribute('aria-expanded', 'true');
			renderMenu();
		};
		const closeMenu = () => {
			open = false;
			control.classList.remove('is-open');
			menu.classList.add('hidden');
			input.setAttribute('aria-expanded', 'false');
		};

		const add = val => {
			if (!options.includes(val) || selected.includes(val)) return;
			selected.push(val);
			input.value = '';
			active = 0;
			renderChips();
			renderMenu();
			input.focus();
			if (onChange) onChange([...selected]);
		};
		const remove = val => {
			selected = selected.filter(s => s !== val);
			renderChips();
			renderMenu();
			if (onChange) onChange([...selected]);
		};

		control.addEventListener('mousedown', e => {
			if (e.target === input) return;
			e.preventDefault();
			input.focus();
			openMenu();
		});
		input.addEventListener('focus', openMenu);
		input.addEventListener('input', () => {
			active = 0;
			if (!open) openMenu();
			else renderMenu();
		});
		input.addEventListener('keydown', e => {
			const opts = filtered();
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				active = Math.min(active + 1, opts.length - 1);
				renderMenu();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				active = Math.max(active - 1, 0);
				renderMenu();
			} else if (e.key === 'Enter') {
				e.preventDefault();
				if (opts[active]) add(opts[active]);
			} else if (e.key === 'Escape') {
				closeMenu();
			} else if (e.key === 'Backspace' && !input.value && selected.length) {
				remove(selected[selected.length - 1]);
			}
		});
		menu.addEventListener('mousedown', e => {
			const li = e.target.closest('.combobox-option');
			if (!li) return;
			e.preventDefault();
			add(li.dataset.value);
		});
		document.addEventListener('mousedown', e => {
			if (open && !el.contains(e.target)) closeMenu();
		});

		return {
			setOptions(arr) {
				options = Array.isArray(arr) ? [...arr] : [];
				if (open) renderMenu();
			},
			setSelected(arr) {
				selected = Array.isArray(arr) ? [...arr] : [];
				input.value = '';
				renderChips();
				if (open) renderMenu();
			},
			getSelected: () => [...selected]
		};
	}

	filterUciSections(config, type) {
		return Object.entries(config)
			.filter(([, v]) => v['.type'] === type)
			.map(([k, v]) => ({ section: k, ...v }));
	}

	getFormValues(fieldMap) {
		const values = {};
		for (const [elementId, uciKey] of Object.entries(fieldMap)) {
			const el = document.getElementById(elementId);
			if (!el) continue;
			const formVal = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
			if (Array.isArray(uciKey)) {
				for (const key of uciKey) values[key] = formVal;
			} else {
				values[uciKey] = formVal;
			}
		}
		return values;
	}

	setFormValues(fieldMap, data) {
		for (const [elementId, uciKey] of Object.entries(fieldMap)) {
			const el = document.getElementById(elementId);
			if (!el) continue;
			let val;
			if (Array.isArray(uciKey)) {
				for (const key of uciKey) {
					if (data[key] !== undefined && data[key] !== '') {
						val = data[key];
						break;
					}
				}
			} else {
				val = data[uciKey];
			}
			if (el.type === 'checkbox') {
				el.checked = val === true || val === 1 || val === '1';
			} else {
				el.value = Array.isArray(val) ? val.join(', ') : val || '';
			}
		}
	}

	async uciEdit(config, id, fieldMap, modalId, sectionIdField) {
		try {
			const [status, result] = await this.uciGet(config, id);
			if (status !== 0 || !result?.values) throw new Error('Not found');
			if (sectionIdField) document.getElementById(sectionIdField).value = id;
			this.setFormValues(fieldMap, result.values);
			this.openModal(modalId);
		} catch {
			this.showToast('Failed to load config', 'error');
		}
	}

	async uciSave({
		config,
		uciType,
		modalId,
		sectionIdField,
		fieldMap,
		defaults,
		reloadFn,
		successMsg,
		sectionNameField
	}) {
		const section = sectionIdField ? document.getElementById(sectionIdField)?.value : '';
		const values = { ...this.getFormValues(fieldMap), ...defaults };
		try {
			if (section) {
				await this.uciSet(config, section, values);
			} else {
				const name = sectionNameField ? document.getElementById(sectionNameField)?.value || null : null;
				const [, res] = await this.uciAdd(config, uciType, name);
				if (!res?.section) throw new Error('Failed to create section');
				await this.uciSet(config, res.section, values);
			}
			await this.uciApplyConfig(config);
			this.closeModal(modalId);
			this.showToast(successMsg || 'Saved', 'success');
			if (reloadFn) await reloadFn();
		} catch {
			this.showToast('Failed to save', 'error');
		}
	}

	async uciDeleteEntry(config, id, confirmMsg, reloadFn) {
		if (!confirm(confirmMsg)) return;
		try {
			await this.uciDelete(config, id);
			await this.uciApplyConfig(config);
			this.showToast('Deleted', 'success');
			if (reloadFn) await reloadFn();
		} catch {
			this.showToast('Failed to delete', 'error');
		}
	}

	spliceFileLines(raw, dataFilter, index, newLine) {
		const lines = raw.split('\n');
		const dataIndices = lines.map((l, i) => (dataFilter(l) ? i : -1)).filter(i => i >= 0);
		if (index !== '' && index !== undefined) {
			const origIdx = dataIndices[parseInt(index)];
			if (origIdx !== undefined) {
				if (newLine === null) {
					lines.splice(origIdx, 1);
				} else {
					lines[origIdx] = newLine;
				}
			}
		} else if (newLine !== null) {
			if (lines.length && lines[lines.length - 1] === '') lines.pop();
			lines.push(newLine);
		}
		const result = lines.join('\n');
		return result.endsWith('\n') ? result : result + '\n';
	}

	resetModal(modalId) {
		const modal = document.getElementById(modalId);
		if (!modal) return;
		modal.querySelectorAll('input[type="hidden"]').forEach(el => {
			el.value = '';
		});
		modal.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]), textarea').forEach(el => {
			el.value = el.defaultValue || '';
		});
		modal.querySelectorAll('select').forEach(el => {
			const defaultOpt = [...el.options].findIndex(o => o.defaultSelected);
			el.selectedIndex = defaultOpt >= 0 ? defaultOpt : 0;
		});
		modal.querySelectorAll('input[type="checkbox"]').forEach(el => {
			el.checked = el.defaultChecked;
		});
	}
}
