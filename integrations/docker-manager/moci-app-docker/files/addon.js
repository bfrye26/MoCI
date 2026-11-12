// Native Applications UI. All operations use authenticated OpenWrt ubus.
export default class ApplicationsAddon {
  constructor(core) {
    this.core = core;
    this.core.registerRoute('/docker', () => this.render());
    this.active = 'catalog';
    this.category = 'All';
    this.profile = 'all';
    this.core.registerExtension('dashboard:widget',{id:'docker-running-apps',render:wrapper=>{void this.renderDashboardWidget(wrapper);}});
  }
  async rpc(method, args={}) {
    const write = ['deploy','prepare_app','prepare_custom','install_catalog','stack_action','container_action','volume_action','network_action','image_action','set_deployments','stack_config'].includes(method);
    const [status, data] = await this.core.ubusCall('moci-docker', method, args, {timeout:write?240000:25000});
    if (status !== 0 || !data || data.error) throw new Error(data?.error || 'The requested operation failed');
    return data;
  }
  esc(x) { return this.core.escapeHtml(String(x ?? '')); }
  async render() {
    this.page = document.getElementById('addon-docker-page');
    if (!this.page) return;
    this.page.innerHTML = '<div class="page-header"><h1>Applications</h1></div><p>Connecting to Docker…</p>';
    try {
      const status = await this.rpc('status');
      this.readOnly = status.read_only !== false;
      this.page.innerHTML = `<div class="page-header"><h1>Applications</h1></div>
        <div class="docker-hero"><div><strong>Docker Engine</strong><p>${this.esc(status.available ? 'Version ' + status.version : 'Not running')}</p></div>
          <div class="docker-management-mode">
            <span>${this.readOnly?'Monitoring only · deployment approval required':'Approved managed operations enabled'}</span>
            <button type="button" class="action-btn" id="docker-mode-toggle">${this.readOnly?'Enable Docker management':'Disable Docker management'}</button>
          </div>
        </div>
        <nav class="docker-nav" aria-label="Application tools">
        ${[['catalog','App Store'],['containers','Containers'],['stacks','Compose Projects'],['managed_stacks','Managed Stacks'],['images','Images'],['volumes','Volumes'],['networks','Networks'],['storage','Storage'],['diagnostics','Diagnostics']].map(([id,name])=>`<button type="button" class="action-btn" data-view="${id}">${name}</button>`).join('')}
        </nav><section id="docker-content" aria-live="polite"></section>`;
      this.page.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>this.renderView(b.dataset.view)));
      this.page.querySelector('#docker-mode-toggle')?.addEventListener('click',async event=>{
        const button=event.currentTarget;
        const enable=this.readOnly;
        const phrase=enable?'ENABLE LOCAL DOCKER MANAGEMENT':'DISABLE';
        if(!window.confirm((enable?'Enable':'Disable')+' Docker management on this router? Docker management has root-equivalent access. Use only trusted administrator accounts and never expose this UI to WAN.'))return;
        const confirmation=window.prompt('Type '+phrase+' to confirm:','');
        if(confirmation!==phrase){if(confirmation!==null)this.core.showToast('Confirmation did not match','error');return;}
        button.disabled=true;
        try {
          await this.rpc('set_deployments',{enabled:enable,confirmation});
          this.core.showToast(enable?'Docker management enabled':'Docker management disabled','success');
          await this.render();
        }catch(error){
          this.core.showToast('Deployment mode change failed: '+error.message,'error');
          button.disabled=false;
        }
      });
      await this.renderView('catalog');
    } catch (e) {this.page.innerHTML = `<div class="page-header"><h1>Applications</h1></div><p role="alert">${this.esc(e.message)}</p>`;}
  }
  async renderView(view) {
    const root = this.page.querySelector('#docker-content');
    if (!root) return;
    this.active = view;
    root.textContent='Loading…';
    try {
      const result=await this.rpc(view);
      if(view==='catalog') return this.renderCatalog(root,result.catalog||[]);
      if(view==='diagnostics'){
        const checks=result.diagnostics||[];
        root.innerHTML='<div class="docker-intro"><h2>Docker Diagnostics</h2><p>Preflight checks for the runtime, Compose, LAN and deployment policies.</p></div>'+
          '<div class="docker-diagnostics">'+checks.map(check=>
          '<article class="docker-check"><span class="'+(check.ok?'docker-check-ok':'docker-check-fail')+'">'+(check.ok?'OK':'CHECK')+'</span><strong>'+this.esc(check.name)+'</strong><p>'+this.esc(check.detail)+'</p></article>').join('')+'</div>';
        return;
      }
      if(view==='managed_stacks') return this.renderManaged(root,result.managed_stacks||[]);
      const rows=result[view]||[];
      const data=rows.map(v=>typeof v==='string'?{Name:v}:v);
      if(!data.length){root.innerHTML='<p class="docker-empty">Nothing to display yet.</p>';return;}
      const keys=view==='containers'?['Names','Image','State','Status']:view==='stacks'?['Name','Containers']:view==='images'?['Tags','Size']:view==='volumes'?['Name','Driver']:view==='networks'?['Name','Driver']:['Mount','Total','Used','Free'];
      root.innerHTML=`<div class="docker-scroll"><table class="data-table"><thead><tr>${keys.map(k=>`<th>${k}</th>`).join('')}${['containers','volumes','networks','images'].includes(view)?'<th>Actions</th>':''}</tr></thead><tbody>
        ${data.map(item=>`<tr>${keys.map(k=>`<td>${this.esc(Array.isArray(item[k])?item[k].join(', '):item[k])}</td>`).join('')}${view==='containers'?`<td><button class="action-btn" data-log="${this.esc(item.Id)}">Logs</button><button class="action-btn" data-stats="${this.esc(item.Id)}">Statistics</button>${!this.readOnly&&item.Managed?['start','stop','restart','remove'].map(action=>`<button class="action-btn" data-container-action="${action}" data-id="${this.esc(item.Id)}">${action}</button>`).join(''):''} </td>`:view==='volumes'&&!this.readOnly?`<td>${String(item.Name||'').startsWith('moci-')?`<button class="action-btn" data-resource-action="volume_action" data-id="${this.esc(item.Name)}">Remove</button>`:'Protected'}</td>`:view==='networks'&&!this.readOnly?`<td>${String(item.Name||'').startsWith('moci-')?`<button class="action-btn" data-resource-action="network_action" data-id="${this.esc(item.Name)}">Remove</button>`:'Protected'}</td>`:view==='images'&&!this.readOnly?`<td><button class="action-btn" data-resource-action="image_action" data-id="${this.esc(item.Id)}">Remove unused</button></td>`:['volumes','networks','images'].includes(view)?'<td>Read only</td>':''}</tr>`).join('')}
        </tbody></table></div><pre class="docker-log" hidden></pre>`;
      if(!this.readOnly&&(view==='networks'||view==='volumes')){
        const create=document.createElement('button');
        create.type='button';create.className='action-btn';create.textContent=view==='volumes'?'Create managed volume':'Create isolated bridge network';
        root.insertBefore(create,root.firstChild);
        create.addEventListener('click',async()=>{
          const name=window.prompt('Enter a unique name starting with moci- (for example moci-office):');
          if(!name)return;
          if(!/^moci-[a-z][a-z0-9-]{1,40}$/.test(name)){
            this.core.showToast('Invalid managed resource name','error');return;
          }
          if(!window.confirm('Create managed '+view.slice(0,-1)+' '+name+'?'))return;
          create.disabled=true;
          try{
            await this.rpc(view==='volumes'?'volume_action':'network_action',{name,action:'create'});
            await this.renderView(view);
          }catch(e){this.core.showToast(e.message,'error');create.disabled=false;}
        });
      }
      root.querySelectorAll('[data-resource-action]').forEach(b=>b.addEventListener('click',async()=>{
        const method=b.dataset.resourceAction;
        const id=b.dataset.id;
        if(!window.confirm('Remove '+id+'? Docker will refuse removal if this resource is still in use. This operation cannot be undone.'))return;
        b.disabled=true;
        try{
          const args=method==='image_action'?{id,action:'remove'}:{name:id,action:'remove'};
          await this.rpc(method,args);
          this.core.showToast('Removed '+id,'success');
          await this.renderView(view);
        }catch(e){this.core.showToast(e.message,'error');b.disabled=false;}
      }));
      root.querySelectorAll('[data-container-action]').forEach(b=>b.addEventListener('click',async()=>{
        const id=b.dataset.id,action=b.dataset.containerAction;
        if(!window.confirm(action+' this MoCI-managed container?'))return;
        b.disabled=true;
        try {await this.rpc('container_action',{id,action});this.core.showToast('Container '+action+' requested','success');await this.renderView('containers');}
        catch(e){this.core.showToast(e.message,'error');b.disabled=false;}
      }));
      root.querySelectorAll('[data-stats]').forEach(b=>b.addEventListener('click',async()=>{
        const display=root.querySelector('.docker-log');
        display.hidden=false;display.textContent='Loading container statistics…';
        b.disabled=true;
        try{
          const report=(await this.rpc('container_stats',{id:b.dataset.stats})).stats;
          const mb=x=>(Number(x||0)/1048576).toFixed(1)+' MB';
          display.textContent=[
            'Container: '+b.dataset.stats.slice(0,12),
            'CPU: '+Number(report.cpu_percent||0).toFixed(2)+'%',
            'Memory: '+mb(report.memory_used)+' / '+mb(report.memory_limit)+' ('+report.memory_percent+'%)',
            'Network received: '+mb(report.network_rx),
            'Network transmitted: '+mb(report.network_tx)
          ].join('\n');
        }catch(error){display.textContent='Statistics unavailable: '+error.message;}
        finally{b.disabled=false;}
      }));
      root.querySelectorAll('[data-log]').forEach(b=>b.addEventListener('click',async()=>{
        const log=root.querySelector('.docker-log');log.hidden=false;log.textContent='Loading logs…';
        try{log.textContent=(await this.rpc('logs',{id:b.dataset.log})).logs||'No logs';}
        catch(e){log.textContent=e.message;}
      }));
    }catch(e){root.innerHTML=`<p role="alert">${this.esc(e.message)}</p>`;}
  }
  renderCatalog(root,apps) {
    apps=[...apps].sort((a,b)=>Number(b.reviewed_template)-Number(a.reviewed_template)||a.name.localeCompare(b.name));
    const categories=['All',...new Set(apps.map(a=>a.category))];
    const reviewedCount=apps.filter(a=>a.reviewed_template).length;
    const installedCount=apps.filter(a=>a.installed).length;
    root.innerHTML=`<div class="docker-intro"><h2>App Store</h2><div class="docker-store-summary"><span><strong>${apps.length}</strong> listed</span><span><strong>${reviewedCount}</strong> installation recipes</span><span><strong>${installedCount}</strong> installed</span></div><p>Browse the available apps or filter for an approved installation recipe. A reviewed recipe has not necessarily passed a live launch test. Apps that need advanced network or database configuration are marked separately.</p>${this.readOnly?'<p class="docker-note" role="status"><strong>Docker is running, but deployments are locked.</strong> The App Store needs an administrator to enable management and approve verified application images. Catalogue entries are not automatically approved one-click installers. No approval is bypassed automatically.</p>':''}</div>
      <div class="docker-filters" role="group" aria-label="Application profiles">
      ${[['all','All apps'],['office','Office LAN'],['home','Homelab'],['both','Office + Homelab']].map(([id,label])=>`<button type="button" class="action-btn" data-profile="${id}" aria-pressed="${this.profile===id}">${label}</button>`).join('')}
      </div>
      <details class="docker-category-filter"><summary>Browse by category · ${this.esc(this.category)}</summary><div class="docker-filters" role="group" aria-label="Application categories">
      ${categories.map(c=>`<button type="button" class="action-btn" data-category="${this.esc(c)}" aria-pressed="${this.category===c}">${this.esc(c)}</button>`).join('')}</div></details>
      <div class="docker-store-toolbar"><label class="docker-search-label" for="docker-app-search">Find an application<input id="docker-app-search" type="search" class="form-input" placeholder="Search app names, descriptions or categories" autocomplete="off" value="${this.esc(this.search||'')}"></label>
      <div class="docker-filters" role="group" aria-label="Installation readiness"><button class="action-btn" type="button" data-state="all">All installation types</button><button class="action-btn" type="button" data-state="reviewed">Reviewed templates</button><button class="action-btn" type="button" data-state="manual">Manual setup</button><button class="action-btn" type="button" data-state="installed">Installed</button></div></div>
      <p class="docker-result-count" aria-live="polite"></p>
      <div class="docker-app-grid">${apps.map(a=>`<article class="docker-app-card" data-app-name="${this.esc([a.name,a.id,a.description,a.category].join(' ').toLowerCase())}" data-app-state="${this.esc(a.setup_state||'manual')}" data-reviewed="${a.reviewed_template?'true':'false'}" data-app-category="${this.esc(a.category)}" data-app-profile="${this.esc(a.profile||'both')}"><small>${this.esc(a.category)} · ${this.esc(a.complexity||'review')} setup</small><h3>${this.esc(a.name)}</h3><span class="docker-app-state ${a.reviewed_template?'is-ready':'is-manual'}">${a.installed?'Installed':a.reviewed_template?'Recipe available':'Manual or guided setup'}</span><p>${this.esc(a.description)}</p>${a.risk&&a.risk!=='review'?`<p class="docker-app-warning">Attention: ${this.esc(a.risk.replaceAll('-',' '))}</p>`:''}<details class="docker-app-details"><summary>Installation details</summary><p>${this.esc(a.reason||'Review the application requirements before deployment')}</p>${a.template?`<p><strong>Reviewed image:</strong> ${this.esc(a.template.image_tag)}</p><p><strong>LAN ports:</strong> ${this.esc(a.template.ports?.join(', ')||'None')}</p><p><strong>Named volumes:</strong> ${this.esc(a.template.volumes?.join(', ')||'None')}</p><p>${this.esc(a.template.description||'')}</p>`:'<p>Consult the application documentation for ports, volumes, environment variables, databases and resource requirements. No one-click installer has been approved for this entry.</p>'}</details><footer><span>${a.installed?'Installed':a.ready?'Ready to install':a.can_prepare?'Prepare approved image':a.reviewed_template?'Requires management approval':'Manual setup required'}</span>${a.url?`<a class="action-btn" href="${this.esc(a.url)}" target="_blank" rel="noopener noreferrer">OPEN</a>`:''}<button type="button" class="action-btn docker-primary-action" data-install="${this.esc(a.id)}" data-repository="${this.esc(a.repository)}" data-risk="${this.esc(a.risk||'review')}" data-install-action="${a.installed?(a.reviewed_template?'update':'manage'):a.ready?'install':a.can_prepare?'prepare':'manual'}" data-can-prepare="${a.can_prepare?'true':'false'}" ${this.readOnly?'disabled title="Enable Docker management before installing applications"':''}>${a.installed?(a.reviewed_template?'Update':'Manage'):a.ready?'Install':a.can_prepare?'Install':'Guided setup'}</button></footer></article>`).join('')}</div>`;
    const updateFilters=()=>{
      let visible=0;
      root.querySelectorAll('[data-app-category]').forEach(card=>{
        const matchCategory=this.category==='All'||card.dataset.appCategory===this.category;
        const matchProfile=this.profile==='all'||card.dataset.appProfile===this.profile||card.dataset.appProfile==='both';
        const mode=this.setupFilter||'all';
        const matchState=mode==='all'||(mode==='reviewed'&&card.dataset.reviewed==='true')||(mode==='manual'&&card.dataset.reviewed!=='true')||(mode==='installed'&&card.dataset.appState==='installed');
        const matchSearch=!this.search||card.dataset.appName.includes(this.search.toLowerCase());
        card.hidden=!(matchCategory&&matchProfile&&matchState&&matchSearch);
        if(!card.hidden)visible++;
      });
      root.querySelector('.docker-result-count').textContent=`${visible} apps shown`;
      root.querySelectorAll('[data-profile]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.profile===this.profile)));
      root.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===this.category)));
      root.querySelectorAll('[data-state]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.state===(this.setupFilter||'all'))));
    };
    root.querySelectorAll('[data-category]').forEach(b=>b.addEventListener('click',()=>{this.category=b.dataset.category;updateFilters();}));
    root.querySelectorAll('[data-profile]').forEach(b=>b.addEventListener('click',()=>{this.profile=b.dataset.profile;updateFilters();}));
    root.querySelectorAll('[data-state]').forEach(b=>b.addEventListener('click',()=>{this.setupFilter=b.dataset.state;updateFilters();}));
    root.querySelector('#docker-app-search')?.addEventListener('input',e=>{this.search=e.target.value.trim();updateFilters();});
    updateFilters();
    root.querySelectorAll('[data-install]').forEach(b=>b.addEventListener('click',async()=>{
      if(b.dataset.installAction==='manage'){await this.renderView('managed_stacks');return;}
      if(b.dataset.installAction==='manual'){
        const repository=b.dataset.repository||'';
        const risk=b.dataset.risk||'review';
        if(!window.confirm('Open custom Compose setup for '+b.dataset.install+'? This application does not have a tested one-click template. Category risks: '+risk+'. Review its official installation requirements before deployment.'))return;
        await this.renderView('managed_stacks');
        const create=this.page.querySelector('#docker-create');
        create?.click();
        const name=this.page.querySelector('#docker-name');
        const tag=this.page.querySelector('#docker-image-tag');
        if(name)name.value=b.dataset.install.slice(0,40);
        if(tag)tag.placeholder=repository+':VERSION';
        const editor=this.page.querySelector('#docker-editor');
        if(editor){const hint=document.createElement('p');hint.className='docker-setup-notice';hint.textContent='Manual configuration: '+b.dataset.install+' ('+risk+'). A catalogue listing is not a safe installation template. Confirm dependencies, published ports, volumes and appropriate image tags from official documentation before deploying.';editor.prepend(hint);}
        this.core.showToast('Choose a supported version, verify required ports and volumes, then prepare its digest.','info');
        return;
      }
      const sensitive=b.dataset.risk==='sensitive-data';
      const warning=sensitive
        ?'SENSITIVE DATA APPLICATION: This can store private files, credentials or backups and might need extra setup. Install on your trusted LAN only. Continue with reviewed configuration for '+b.dataset.install+'?'
        :'Install approved app '+b.dataset.install+'? This will create persistent Docker data and publish the reviewed application port on your router LAN.';
      if(!window.confirm(warning))return;
      const needsPrepare=b.dataset.installAction==='prepare'||b.dataset.installAction==='update';
      const originalLabel=b.textContent;
      b.dataset.needsPrepare=needsPrepare?'true':'false';
      b.disabled=true;
      b.textContent=needsPrepare?'PREPARING…':'INSTALLING…';
      try{
        if(b.dataset.needsPrepare==='true'){
          await this.rpc('prepare_app',{id:b.dataset.install});
          b.dataset.needsPrepare='false';
          this.core.showToast('Image digest approved; deploying…','info');
        }
        const installed=await this.rpc('install_catalog',{id:b.dataset.install,...(sensitive?{confirmation:'INSTALL SENSITIVE APP'}:{})});
        this.core.showToast('Deployment completed','success');
        await this.renderView('managed_stacks');
        if(installed.initial_credentials){
          const info=installed.initial_credentials;
          const parent=this.page.querySelector('#docker-content');
          const box=document.createElement('section');box.className='docker-credential';
          const title=document.createElement('h3');title.textContent='Save your initial application credentials';
          const note=document.createElement('p');note.textContent='These credentials are shown only after a new install. Store them in your password manager before navigating away.';
          const user=document.createElement('p');user.textContent='Username: '+info.username;
          const input=document.createElement('input');
          input.type='text';input.value=info.password;input.readOnly=true;
          input.setAttribute('aria-label','Initial application password');
          input.addEventListener('click',()=>input.select());
          box.append(title,note,user,input);
          parent?.prepend(box);
        }
      }
      catch(e){this.core.showToast('Install failed: '+e.message,'error');b.disabled=false;b.textContent=originalLabel;}
    }));
  }
  stackStateLabel(state) {
    return ({running:'Running',stopped:'Stopped',unhealthy:'Unhealthy',partial:'Partially running',
      not_deployed:'Not deployed',unknown:'Status unavailable'})[state]||'Status unavailable';
  }
  stackStateClass(state) {
    return ['running','stopped','unhealthy','partial','not_deployed'].includes(state)?state:'unknown';
  }
  stackLaunchLink(stack) {
    if(stack.state!=='running'||!stack.url)return '';
    const verified=stack.url_kind==='reviewed';
    return `<a class="action-btn docker-open-app" href="${this.esc(stack.url)}" target="_blank" rel="noopener noreferrer" title="${verified?'Open reviewed application web address':'Open the published LAN HTTP port; this application may require HTTPS or a custom path'}">${verified?'Open App':'Open Web Port'}</a>`;
  }
  async renderDashboardWidget(wrapper) {
    if(!wrapper?.isConnected)return;
    wrapper.classList.add('docker-dashboard-widget');
    wrapper.innerHTML='<div class="docker-dashboard-heading"><h2>Running Applications</h2><a href="#/docker" class="action-btn">Manage Apps</a></div><p>Checking managed Docker containers…</p>';
    try {
      const result=await this.rpc('managed_stacks');
      if(!wrapper.isConnected)return;
      const stacks=(result.managed_stacks||[]).map(s=>typeof s==='string'?{name:s,state:'unknown'}:s);
      const running=stacks.filter(s=>s.state==='running');
      const needsAttention=stacks.filter(s=>['partial','unhealthy'].includes(s.state));
      wrapper.innerHTML=`<div class="docker-dashboard-heading"><h2>Running Applications <span class="docker-dashboard-count">${running.length}</span></h2><a href="#/docker" class="action-btn">Manage Apps</a></div>
        ${running.length?`<div class="docker-dashboard-grid">${running.map(s=>`<div class="docker-dashboard-entry"><strong>${this.esc(s.name)}</strong><span class="docker-stack-status docker-status-running">Running</span>${this.stackLaunchLink(s)}</div>`).join('')}</div>`:'<p>No managed applications currently running.</p>'}
        ${needsAttention.length?`<p class="docker-dashboard-warning">${needsAttention.length} application(s) need attention. See Managed Stacks for details.</p>`:''}`;
    }catch(error){
      if(wrapper.isConnected)wrapper.innerHTML=`<div class="docker-dashboard-heading"><h2>Running Applications</h2><a href="#/docker" class="action-btn">Manage Apps</a></div><p role="status">Docker status unavailable: ${this.esc(error.message)}</p>`;
    }
  }
  renderManaged(root,stacks) {
    const entries=stacks.map(stack=>typeof stack==='string'?{name:stack,state:'unknown'}:stack);
    root.innerHTML=`<div class="docker-intro"><h2>Managed Compose Stacks</h2><p>Monitor live container state, launch available web apps, and manage Docker Compose projects. Port links are only shown for running containers with a published router LAN address.</p></div>
      <div class="docker-stack-toolbar">
        ${this.readOnly?'<p class="docker-note">Monitoring is available. Enable Docker management to change containers or create stacks.</p>':'<button type="button" class="action-btn" id="docker-create">Create stack</button><div id="docker-editor"></div>'}
        <button type="button" class="action-btn" id="docker-refresh-managed">Refresh status</button>
      </div>
      <div class="docker-stack-list">${entries.map(s=>`<article class="docker-stack docker-stack-status-row">
        <div class="docker-stack-summary"><strong>${this.esc(s.name)}</strong>
          <span class="docker-stack-status docker-status-${this.stackStateClass(s.state)}">${this.stackStateLabel(s.state)}</span>
          ${Number.isInteger(s.total_containers)&&s.total_containers>0?`<small>${Number(s.running_containers||0)} of ${s.total_containers} containers running</small>`:''}
        </div>
        <div class="docker-stack-actions">
          ${this.stackLaunchLink(s)}
          ${this.readOnly?'':`<button class="action-btn" data-action="start" data-name="${this.esc(s.name)}">Start</button><button class="action-btn" data-action="stop" data-name="${this.esc(s.name)}">Stop</button><button class="action-btn" data-action="remove" data-name="${this.esc(s.name)}">Remove containers</button><button class="action-btn" data-export-stack="${this.esc(s.name)}">Export configuration</button>`}
        </div></article>`).join('')||'<p>No managed stacks yet.</p>'}</div>`;
    root.querySelector('#docker-refresh-managed')?.addEventListener('click',()=>this.renderView('managed_stacks'));
    root.querySelector('#docker-create')?.addEventListener('click',()=>this.showEditor(root));
    root.querySelectorAll('[data-export-stack]').forEach(button=>button.addEventListener('click',async()=>{
      const name=button.dataset.exportStack;
      if(!window.confirm('Export '+name+' Compose configuration? This JSON may contain environment secrets or initial application passwords. Store it securely.'))return;
      button.disabled=true;
      try{
        const result=await this.rpc('stack_config',{name});
        if(result.contains_secrets&&!window.confirm('This stack includes environment variables that may contain credentials. Continue with local JSON export?'))return;
        const text=JSON.stringify(result.config,null,2)+'\\n';
        const blob=new Blob([text],{type:'application/json'});
        const url=URL.createObjectURL(blob);
        try{
          const link=document.createElement('a');
          link.href=url;link.download='moci-stack-'+name+'.json';
          this.page.appendChild(link);
          link.click();
          link.remove();
        }finally{setTimeout(()=>URL.revokeObjectURL(url),5000);}
      }catch(error){this.core.showToast('Export failed: '+error.message,'error');}
      finally{button.disabled=false;}
    }));

    root.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',async()=>{
      if(!window.confirm(b.dataset.action+' '+b.dataset.name+'?'))return;
      b.disabled=true;
      try{await this.rpc('stack_action',{name:b.dataset.name,action:b.dataset.action});await this.renderView('managed_stacks');}
      catch(e){this.core.showToast(e.message,'error');b.disabled=false;}
    }));
  }

  showEditor(root) {
    const target=root.querySelector('#docker-editor');
    if(!target)return;
    target.innerHTML=`<div class="docker-compose">
      <h3>Create managed Docker stack</h3>
      <p>Approved images are pinned to immutable digests. Custom images use a restricted, administrator-approved public registry.</p>
      <label>Image to prepare (repository:tag)
        <input id="docker-image-tag" maxlength="150" placeholder="ghcr.io/vendor/app:v1.2.3">
      </label>
      <button id="docker-prepare" type="button" class="action-btn">Prepare custom image</button>
      <p id="docker-prepared-result" aria-live="polite"></p>
      <label>Stack name<input id="docker-name" maxlength="40" placeholder="service-name"></label>
      <section class="docker-quick-setup" aria-label="Guided container setup">
        <h4>Guided single-container setup</h4>
        <p>Enter only the mappings required by the application's official documentation. Published ports are LAN-only; persistent data uses named volumes.</p>
        <label>LAN TCP port mappings, one per line (host:container)
          <textarea id="docker-port-maps" rows="3" spellcheck="false" placeholder="8088:80"></textarea>
        </label>
        <label>Named persistent volumes, one per line (name:/container/path)
          <textarea id="docker-volume-maps" rows="3" spellcheck="false" placeholder="myapp-data:/app/data"></textarea>
        </label>
        <label>Environment variables, one per line (KEY=value). Do not use this form for sensitive credentials.
          <textarea id="docker-env-maps" rows="3" spellcheck="false" placeholder="APP_MODE=production"></textarea>
        </label>
        <label>Container UID:GID (default 65534:65534)
          <input id="docker-user" maxlength="11" placeholder="65534:65534" value="65534:65534">
        </label>
        <label class="docker-advanced-warning">
          <input type="checkbox" id="docker-writable">
          Allow a writable container filesystem for applications that require it
        </label>
        <label>Memory limit
          <select id="docker-memory-limit">
            <option value="256m">256 MB</option>
            <option value="512m" selected>512 MB</option>
            <option value="1g">1 GB</option>
            <option value="2g">2 GB</option>
            <option value="4g">4 GB</option>
          </select>
        </label>
        <button type="button" class="action-btn" id="docker-generate">Generate Compose configuration</button>
      </section>
      <details class="docker-advanced-json" open>
        <summary>Advanced Compose JSON editor</summary>
        <label>Validated Compose services JSON<textarea id="docker-spec" rows="10" spellcheck="false" placeholder='{"services":{"service":{"image":"repo@sha256:..."}}}'></textarea></label>
      </details>
      <button id="docker-deploy" type="button" class="action-btn">Deploy managed stack</button>
      <p>Compose allows up to eight unprivileged services, approved digests, named volumes and ports bound only to the router LAN or loopback.</p>
    </div>`;
    const lines=id=>target.querySelector(id).value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    target.querySelector('#docker-generate').addEventListener('click',()=>{
      try{
        const digest=target.querySelector('#docker-prepared-result').textContent.trim();
        if(!/^[A-Za-z0-9][A-Za-z0-9._/-]*@sha256:[a-f0-9]{64}$/.test(digest))
          throw new Error('Prepare an immutable image digest first.');
        const host=window.location.hostname;
        if(!/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(host))
          throw new Error('Open MoCI via its LAN IPv4 address before generating port mappings.');
        const ports=lines('#docker-port-maps');
        const volumes=lines('#docker-volume-maps');
        const envLines=lines('#docker-env-maps');
        if(ports.length>8||volumes.length>4||envLines.length>48)
          throw new Error('Too many ports, volumes or environment variables.');
        const mappedPorts=ports.map(p=>{
          if(!/^[0-9]{4,5}:[0-9]{1,5}$/.test(p))throw new Error('Port mapping must be host:container.');
          const [out,inside]=p.split(':').map(Number);
          if(out<1024||out>65535||inside<1||inside>65535)throw new Error('Invalid port number.');
          return host+':'+p;
        });
        for(const volume of volumes){
          if(!/^[a-z][a-z0-9_-]{0,39}:\/[A-Za-z0-9_./-]{1,120}$/.test(volume)||volume.includes('..'))
            throw new Error('Use named volumes such as app-data:/app/data, not host paths.');
        }
        const environment={};
        for(const line of envLines){
          const pos=line.indexOf('=');
          if(pos<1)throw new Error('Environment variables must be KEY=value.');
          const key=line.slice(0,pos);
          if(!/^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(key))
            throw new Error('Invalid environment variable name.');
          if(/password|secret|token|private|api_key/i.test(key))
            throw new Error('Credentials need a protected secret workflow; do not enter them here.');
          environment[key]=line.slice(pos+1);
        }
        const requestedUser=target.querySelector('#docker-user').value.trim()||'65534:65534';
        if(!/^[0-9]{1,5}:[0-9]{1,5}$/.test(requestedUser))
          throw new Error('Container user must be an explicit UID:GID.');
        const writable=target.querySelector('#docker-writable').checked;
        const service={image:digest,ports:mappedPorts,volumes,environment,
          mem_limit:target.querySelector('#docker-memory-limit').value};
        if(requestedUser!=='65534:65534')service.user=requestedUser;
        if(writable)service.read_only=false;
        target.querySelector('#docker-spec').value=JSON.stringify({services:{app:service}},null,2);
        this.core.showToast('Compose JSON generated. Review it before deploying.','success');
      }catch(error){this.core.showToast(error.message,'error');}
    });
    const prepareButton=target.querySelector('#docker-prepare');
    prepareButton.addEventListener('click',async()=>{
      const tag=target.querySelector('#docker-image-tag').value.trim();
      if(!tag||!window.confirm('Download and approve public Docker image '+tag+'? This image will become available for managed Compose stacks.'))return;
      prepareButton.disabled=true;prepareButton.textContent='PREPARING IMAGE…';
      try{
        const response=await this.rpc('prepare_custom',{image:tag});
        const result=target.querySelector('#docker-prepared-result');
        result.textContent=response.digest;
        const spec=target.querySelector('#docker-spec');
        if(!spec.value.trim()){
          spec.value=JSON.stringify({services:{app:{image:response.digest}}},null,2);
        }
        this.core.showToast('Image digest prepared','success');
      }catch(e){this.core.showToast('Image preparation failed: '+e.message,'error');}
      finally{prepareButton.disabled=false;prepareButton.textContent='Prepare custom image';}
    });
    target.querySelector('#docker-deploy').addEventListener('click',async()=>{
      const name=target.querySelector('#docker-name').value.trim(),spec=target.querySelector('#docker-spec').value;
      let configuration;
      try{configuration=JSON.parse(spec);}catch(e){this.core.showToast('Compose JSON is invalid','error');return;}
      const unsafe=Object.values(configuration.services||{}).some(service=>
        service?.read_only===false||(service?.user&&service.user!=='65534:65534'));
      if(!window.confirm('Deploy stack '+name+'?'+(unsafe?' ADVANCED MODE: the container can run under a different UID or write to its root filesystem.':'')))return;
      let confirmation='';
      if(unsafe){
        confirmation=window.prompt('Type ALLOW ADVANCED CONTAINER to authorize custom runtime permissions:','');
        if(confirmation!=='ALLOW ADVANCED CONTAINER'){this.core.showToast('Advanced deployment not confirmed','error');return;}
      }
      try{await this.rpc('deploy',{name,spec,confirmation});await this.renderView('managed_stacks');}
      catch(e){this.core.showToast(e.message,'error');}
    });
  }
}
