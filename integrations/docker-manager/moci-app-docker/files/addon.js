// Native Applications UI. All operations use authenticated OpenWrt ubus.
export default class ApplicationsAddon {
  constructor(core) {
    this.core = core;
    this.core.registerRoute('/docker', () => this.render());
    this.active = 'catalog';
    this.category = 'All';
    this.profile = 'all';
  }
  async rpc(method, args={}) {
    const write = ['deploy','prepare_app','install_catalog','stack_action','container_action'].includes(method);
    const [status, data] = await this.core.ubusCall('moci-docker', method, args, {timeout:write?150000:25000});
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
        <div class="docker-hero"><div><strong>Docker Engine</strong><p>${this.esc(status.available ? 'Version ' + status.version : 'Not running')}</p></div><span>${this.readOnly?'Monitoring only. Administrator approval required.':'Approved managed operations enabled'}</span></div>
        <nav class="docker-nav" aria-label="Application tools">
        ${[['catalog','App Store'],['containers','Containers'],['stacks','Compose Projects'],['managed_stacks','Managed Stacks'],['images','Images'],['volumes','Volumes'],['networks','Networks'],['storage','Storage'],['diagnostics','Diagnostics']].map(([id,name])=>`<button type="button" class="action-btn" data-view="${id}">${name}</button>`).join('')}
        </nav><section id="docker-content" aria-live="polite"></section>`;
      this.page.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>this.renderView(b.dataset.view)));
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
      root.innerHTML=`<div class="docker-scroll"><table class="data-table"><thead><tr>${keys.map(k=>`<th>${k}</th>`).join('')}${view==='containers'?'<th>Actions</th>':''}</tr></thead><tbody>
        ${data.map(item=>`<tr>${keys.map(k=>`<td>${this.esc(Array.isArray(item[k])?item[k].join(', '):item[k])}</td>`).join('')}${view==='containers'?`<td><button class="action-btn" data-log="${this.esc(item.Id)}">Logs</button>${!this.readOnly&&item.Managed?['start','stop','restart'].map(action=>`<button class="action-btn" data-container-action="${action}" data-id="${this.esc(item.Id)}">${action}</button>`).join(''):''} </td>`:''}</tr>`).join('')}
        </tbody></table></div><pre class="docker-log" hidden></pre>`;
      root.querySelectorAll('[data-container-action]').forEach(b=>b.addEventListener('click',async()=>{
        const id=b.dataset.id,action=b.dataset.containerAction;
        if(!window.confirm(action+' this MoCI-managed container?'))return;
        b.disabled=true;
        try {await this.rpc('container_action',{id,action});this.core.showToast('Container '+action+' requested','success');await this.renderView('containers');}
        catch(e){this.core.showToast(e.message,'error');b.disabled=false;}
      }));
      root.querySelectorAll('[data-log]').forEach(b=>b.addEventListener('click',async()=>{
        const log=root.querySelector('.docker-log');log.hidden=false;log.textContent='Loading logs…';
        try{log.textContent=(await this.rpc('logs',{id:b.dataset.log})).logs||'No logs';}
        catch(e){log.textContent=e.message;}
      }));
    }catch(e){root.innerHTML=`<p role="alert">${this.esc(e.message)}</p>`;}
  }
  renderCatalog(root,apps) {
    const categories=['All',...new Set(apps.map(a=>a.category))];
    root.innerHTML=`<div class="docker-intro"><h2>Applications</h2><p>Browse ${apps.length} self-hosted services for office networks and homelabs. Apps marked Setup required are not installable until reviewed templates, approved digests and authentication gates are ready.</p></div>
      <div class="docker-filters" role="group" aria-label="Application profiles">
      ${[['all','All apps'],['office','Office LAN'],['home','Homelab'],['both','Office + Homelab']].map(([id,label])=>`<button type="button" class="action-btn" data-profile="${id}" aria-pressed="${this.profile===id}">${label}</button>`).join('')}
      </div>
      <div class="docker-filters" role="group" aria-label="Application categories">
      ${categories.map(c=>`<button type="button" class="action-btn" data-category="${this.esc(c)}" aria-pressed="${this.category===c}">${this.esc(c)}</button>`).join('')}</div>
      <p class="docker-result-count" aria-live="polite"></p>
      <div class="docker-app-grid">${apps.map(a=>`<article class="docker-app-card" data-app-category="${this.esc(a.category)}" data-app-profile="${this.esc(a.profile||'both')}"><small>${this.esc(a.category)} · ${this.esc(a.complexity||'review')} setup</small><h3>${this.esc(a.name)}</h3><p>${this.esc(a.description)}</p>${a.risk&&a.risk!=='review'?`<p class="docker-app-warning">Attention: ${this.esc(a.risk.replaceAll('-',' '))}</p>`:''}<footer><span>${a.ready?'Approved':a.can_prepare?'Ready to prepare':'Setup required'}</span><button type="button" class="action-btn" data-install="${this.esc(a.id)}" ${a.ready||a.can_prepare?'':'disabled'}>${a.ready?'Install':a.can_prepare?'Prepare & install':'Install'}</button></footer></article>`).join('')}</div>`;
    const updateFilters=()=>{
      let visible=0;
      root.querySelectorAll('[data-app-category]').forEach(card=>{
        const matchCategory=this.category==='All'||card.dataset.appCategory===this.category;
        const matchProfile=this.profile==='all'||card.dataset.appProfile===this.profile||card.dataset.appProfile==='both';
        card.hidden=!(matchCategory&&matchProfile);
        if(!card.hidden)visible++;
      });
      root.querySelector('.docker-result-count').textContent=`${visible} apps shown`;
      root.querySelectorAll('[data-profile]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.profile===this.profile)));
      root.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===this.category)));
    };
    root.querySelectorAll('[data-category]').forEach(b=>b.addEventListener('click',()=>{this.category=b.dataset.category;updateFilters();}));
    root.querySelectorAll('[data-profile]').forEach(b=>b.addEventListener('click',()=>{this.profile=b.dataset.profile;updateFilters();}));
    updateFilters();
    root.querySelectorAll('[data-install]').forEach(b=>b.addEventListener('click',async()=>{
      if(!window.confirm('Install approved app '+b.dataset.install+'? This will create persistent Docker data and publish the reviewed application port on your router LAN.'))return;
      const needsPrepare=b.textContent.includes('Prepare');
      b.dataset.needsPrepare=needsPrepare?'true':'false';
      b.disabled=true;
      b.textContent=needsPrepare?'PREPARING…':'INSTALLING…';
      try{
        if(b.textContent.includes('Prepare')||b.dataset.needsPrepare==='true'){
          await this.rpc('prepare_app',{id:b.dataset.install});
          b.dataset.needsPrepare='false';
          this.core.showToast('Image digest approved; deploying…','info');
        }
        await this.rpc('install_catalog',{id:b.dataset.install});this.core.showToast('Deployment completed','success');await this.renderView('managed_stacks');
      }
      catch(e){this.core.showToast('Install failed: '+e.message,'error');b.disabled=false;b.textContent='RETRY INSTALL';}
    }));
  }
  renderManaged(root,names) {
    root.innerHTML=`<div class="docker-intro"><h2>Managed Compose Stacks</h2><p>Deploy only approved, pinned images. Host networking, arbitrary mounts and privileged containers are prohibited.</p></div>
      ${this.readOnly?'<p class="docker-note">Deployment controls are disabled until non-root permissions are verified on OpenWrt.</p>':'<button type="button" class="action-btn" id="docker-create">Create stack</button><div id="docker-editor"></div>'}
      <div class="docker-stack-list">${names.map(n=>`<article class="docker-stack"><strong>${this.esc(n)}</strong> ${this.readOnly?'':`<button class="action-btn" data-action="start" data-name="${this.esc(n)}">Start</button><button class="action-btn" data-action="stop" data-name="${this.esc(n)}">Stop</button><button class="action-btn" data-action="remove" data-name="${this.esc(n)}">Remove containers</button>`}</article>`).join('')||'<p>No managed stacks yet.</p>'}</div>`;
    root.querySelector('#docker-create')?.addEventListener('click',()=>this.showEditor(root));
    root.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',async()=>{
      if(!window.confirm(b.dataset.action+' '+b.dataset.name+'?'))return;
      try{await this.rpc('stack_action',{name:b.dataset.name,action:b.dataset.action});await this.renderView('managed_stacks');}
      catch(e){this.core.showToast(e.message,'error');}
    }));
  }
  showEditor(root) {
    const target=root.querySelector('#docker-editor');
    if(!target)return;
    target.innerHTML=`<div class="docker-compose"><label>Stack name<input id="docker-name" maxlength="40" placeholder="service-name"></label><label>Compose services JSON<textarea id="docker-spec" rows="10" spellcheck="false" placeholder='{"services":{"service":{"image":"repo@sha256:..."}}}'></textarea></label><button id="docker-deploy" class="action-btn">Deploy reviewed stack</button></div>`;
    target.querySelector('#docker-deploy').addEventListener('click',async()=>{
      const name=target.querySelector('#docker-name').value.trim(),spec=target.querySelector('#docker-spec').value;
      if(!window.confirm('Deploy stack '+name+'?'))return;
      try{await this.rpc('deploy',{name,spec});await this.renderView('managed_stacks');}
      catch(e){this.core.showToast(e.message,'error');}
    });
  }
}
