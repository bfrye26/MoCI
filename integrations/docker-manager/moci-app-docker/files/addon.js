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
    const write = ['deploy','prepare_app','prepare_custom','install_catalog','stack_action','container_action','volume_action','network_action','image_action','set_deployments'].includes(method);
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
            <span>${this.readOnly?'Monitoring only':'Approved managed operations enabled'}</span>
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
        ${data.map(item=>`<tr>${keys.map(k=>`<td>${this.esc(Array.isArray(item[k])?item[k].join(', '):item[k])}</td>`).join('')}${view==='containers'?`<td><button class="action-btn" data-log="${this.esc(item.Id)}">Logs</button>${!this.readOnly&&item.Managed?['start','stop','restart','remove'].map(action=>`<button class="action-btn" data-container-action="${action}" data-id="${this.esc(item.Id)}">${action}</button>`).join(''):''} </td>`:view==='volumes'&&!this.readOnly?`<td>${String(item.Name||'').startsWith('moci-')?`<button class="action-btn" data-resource-action="volume_action" data-id="${this.esc(item.Name)}">Remove</button>`:'Protected'}</td>`:view==='networks'&&!this.readOnly?`<td>${String(item.Name||'').startsWith('moci-')?`<button class="action-btn" data-resource-action="network_action" data-id="${this.esc(item.Name)}">Remove</button>`:'Protected'}</td>`:view==='images'&&!this.readOnly?`<td><button class="action-btn" data-resource-action="image_action" data-id="${this.esc(item.Id)}">Remove unused</button></td>`:['volumes','networks','images'].includes(view)?'<td>Read only</td>':''}</tr>`).join('')}
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
      root.querySelectorAll('[data-log]').forEach(b=>b.addEventListener('click',async()=>{
        const log=root.querySelector('.docker-log');log.hidden=false;log.textContent='Loading logs…';
        try{log.textContent=(await this.rpc('logs',{id:b.dataset.log})).logs||'No logs';}
        catch(e){log.textContent=e.message;}
      }));
    }catch(e){root.innerHTML=`<p role="alert">${this.esc(e.message)}</p>`;}
  }
  renderCatalog(root,apps) {
    const categories=['All',...new Set(apps.map(a=>a.category))];
    root.innerHTML=`<div class="docker-intro"><h2>Applications</h2><p>Browse ${apps.length} self-hosted services for office networks and homelabs. Reviewed templates support guided installation. Other listings open a Compose setup wizard so users can configure ports, volumes and verified image versions.</p></div>
      <div class="docker-filters" role="group" aria-label="Application profiles">
      ${[['all','All apps'],['office','Office LAN'],['home','Homelab'],['both','Office + Homelab']].map(([id,label])=>`<button type="button" class="action-btn" data-profile="${id}" aria-pressed="${this.profile===id}">${label}</button>`).join('')}
      </div>
      <div class="docker-filters" role="group" aria-label="Application categories">
      ${categories.map(c=>`<button type="button" class="action-btn" data-category="${this.esc(c)}" aria-pressed="${this.category===c}">${this.esc(c)}</button>`).join('')}</div>
      <p class="docker-result-count" aria-live="polite"></p>
      <div class="docker-app-grid">${apps.map(a=>`<article class="docker-app-card" data-app-category="${this.esc(a.category)}" data-app-profile="${this.esc(a.profile||'both')}"><small>${this.esc(a.category)} · ${this.esc(a.complexity||'review')} setup</small><h3>${this.esc(a.name)}</h3><p>${this.esc(a.description)}</p>${a.risk&&a.risk!=='review'?`<p class="docker-app-warning">Attention: ${this.esc(a.risk.replaceAll('-',' '))}</p>`:''}<footer><span>${a.installed?'Installed':a.ready?'Approved':a.can_prepare?'Ready to prepare':'Manual setup'}</span>${a.url?`<a class="action-btn" href="${this.esc(a.url)}" target="_blank" rel="noopener noreferrer">OPEN</a>`:''}<button type="button" class="action-btn" data-install="${this.esc(a.id)}" data-repository="${this.esc(a.repository)}" data-risk="${this.esc(a.risk||'review')}">${a.installed?'Update / reinstall':a.ready?'Install':a.can_prepare?'Prepare & install':'Configure'}</button></footer></article>`).join('')}</div>`;
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
      if(b.textContent==='Configure'){
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
        this.core.showToast('Choose a supported version, verify required ports and volumes, then prepare its digest.','info');
        return;
      }
      if(!window.confirm('Install approved app '+b.dataset.install+'? This will create persistent Docker data and publish the reviewed application port on your router LAN.'))return;
      const needsPrepare=b.textContent.includes('Prepare')||b.textContent.includes('Update');
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
    target.innerHTML=`<div class="docker-compose">
      <h3>Create managed Docker stack</h3>
      <p>Approved images are pinned to immutable digests. Custom images use a restricted, administrator-approved public registry.</p>
      <label>Image to prepare (repository:tag)
        <input id="docker-image-tag" maxlength="150" placeholder="ghcr.io/vendor/app:v1.2.3">
      </label>
      <button id="docker-prepare" type="button" class="action-btn">Prepare custom image</button>
      <p id="docker-prepared-result" aria-live="polite"></p>
      <label>Stack name<input id="docker-name" maxlength="40" placeholder="service-name"></label>
      <label>Compose services JSON<textarea id="docker-spec" rows="10" spellcheck="false" placeholder='{"services":{"service":{"image":"repo@sha256:..."}}}'></textarea></label>
      <button id="docker-deploy" type="button" class="action-btn">Deploy managed stack</button>
      <p>Compose allows up to eight unprivileged services, approved digests, named volumes and ports bound only to the router LAN or loopback.</p>
    </div>`;
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
      if(!window.confirm('Deploy stack '+name+'?'))return;
      try{await this.rpc('deploy',{name,spec});await this.renderView('managed_stacks');}
      catch(e){this.core.showToast(e.message,'error');}
    });
  }
}
