/* A garage belongs to one street. This page is whichever of yours sits on the street you picked. */
const $=s=>document.querySelector(s);
const safe=v=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const toast=t=>{const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2600)};
async function api(path,options={}){const r=await fetch(path,{headers:{'Content-Type':'application/json'},...options});const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d}
let hood=null,garage=null,mine=[],status=null,workspaces=[],project=null;

function renderHeader(){
 $('#garageName').textContent=garage?garage.name:`No garage on ${hood.name}`;
 $('#garageTagline').textContent=garage
  ?(garage.tagline||`Your build on ${hood.name}.`)
  :`You have not opened one here yet. Every builder keeps one garage per street.`;
 $('#garageTags').innerHTML=(garage?garage.tags:[]).map(tag=>`<span>${safe(tag)}</span>`).join('');
 $('#garageJump').innerHTML=mine.length
  ?mine.map(item=>`<a href="${VybHood.link('garage.html',item.neighborhood)}"${item.neighborhood===hood.slug?' class="here"':''} style="--hood:${item.hue}">
     <b>${safe(item.name)}</b><span>${safe(item.neighborhood_name)}</span></a>`).join('')
  :'<p class="jump-empty">None yet. Opening one here is the first.</p>';
 /* One project is the flagship; the tabs are the staging area for the rest. */
 $('#stageStrip').hidden=!garage;
 $('#flowBoard').hidden=!garage;
 if(garage){
  if(!project||!garage.projects.some(item=>item.id===project.id))project=garage.flagship||garage.projects[0];
  else project=garage.projects.find(item=>item.id===project.id);
  $('#projectTabs').innerHTML=garage.projects.map(item=>`<div class="project-tab${item.id===project.id?' current':''}${item.flagship?' flagship':''}" data-project="${item.id}">
    <button type="button" data-open="${item.id}"><b>${safe(item.name)}</b><span>${item.modules.length} of ${hood.slots.length} bays${item.tagline?' · '+safe(item.tagline):''}</span></button>
    ${item.flagship?'<i class="flag">on display</i>':`<button type="button" class="make-flag" data-flag="${item.id}">put on display</button>`}
   </div>`).join('')}

 /* The bench: other people's builds, borrowed onto this street's bays so they line up with yours. */
 $('#bench').hidden=!garage||!garage.bench.length;
 if(garage)$('#benchList').innerHTML=garage.bench.map(item=>`<div class="bench-item" data-bench="${item.id}">
   <div><b>${safe(item.name)}</b><span>from @${safe(item.origin_handle)} · ${item.modules.length} of ${hood.slots.length} bays${item.tested_at?' · tested':''}</span></div>
   <div class="bench-acts"><button type="button" data-compare="${item.id}">compare</button><button type="button" data-open-bench="${item.id}">open</button></div>
  </div>`).join('');
 $('#openGarage').hidden=!!garage;
 $('#bayBoard').hidden=!garage;
 $('#editBays').hidden=!garage;
 $('#updateGarage').hidden=!garage;
 $('#workspacePick').hidden=!garage;
 $('#openTitle').textContent=`Open one on ${hood.name}`;
 $('#bayTitle').textContent=`${hood.name} bays`;
 $('#bayNote').textContent=`${hood.tagline||''} Every garage here mounts the same bays, so any two builds can be read module against module.`.trim();
 $('#openTags').innerHTML=(hood.tags||[]).map(tag=>`<label><input type="checkbox" value="${safe(tag)}"> ${safe(tag)}</label>`).join('')
  ||'<span class="jump-empty">This street suggests no tags yet.</span>'}

function renderRack(){
 if(!garage||!project)return;
 renderFlow();
 VybRack.render($('#garageRack'),{modules:VybHood.bays(hood,project.modules),links:[]},{
  layout:hood.layout,
  onAgent:module=>{location.href=`./index.html?agentTarget=garage:${encodeURIComponent(hood.slug)}:${encodeURIComponent(module.id)}`},
  onSelect:module=>renderVariants(module)})}

/* Every bay can hold more than one candidate — another folder, another commit — with one mounted. */
function renderVariants(module){
 const detail=$('#garageRack').querySelector('.rack-detail');
 if(!detail||detail.hidden)return;
 const options=(project.variants||[]).filter(item=>item.slot===module.id);
 const mounted=project.modules.find(item=>item.slot===module.id);
 detail.insertAdjacentHTML('beforeend',`<div class="variant-tray">
   <span class="eyebrow">Swap this bay</span>
   <div class="variant-list">${options.length?options.map(item=>`<button type="button" class="variant${item.active?' on':''}" data-mount="${item.id}">
      <b>${safe(item.label)}</b><span>${safe(item.ref||item.source||'no source linked')}</span></button>`).join('')
     :'<p class="jump-empty">Only what is mounted. Link another folder, file or commit below.</p>'}</div>
   <form class="variant-add" data-slot="${safe(module.id)}">
    <input name="label" placeholder="what to call it" autocomplete="off" required>
    <input name="source" placeholder="subfolder or file" autocomplete="off" value="${safe(mounted&&mounted.source||'')}">
    <input name="ref" placeholder="commit / branch" autocomplete="off">
    <button class="button ghost" type="submit">Link</button>
   </form>
   <button type="button" class="text-button" data-history="${safe(mounted&&mounted.source||'')}">Pull recent commits for this path →</button>
   <div class="commit-list"></div>
   <div class="code-zone">
    <div class="code-head"><span class="eyebrow">What is actually in there</span>
     <button type="button" class="text-button" data-files="${safe(mounted&&mounted.source||'')}">Open the files →</button>
     <button type="button" class="text-button ping" data-show="${safe(module.id)}">✦ show my agent this</button></div>
    <div class="file-list"></div><div class="code-view"></div>
   </div></div>`)}

/* Read-only on purpose. The site is where you look and talk; commits happen in your own tools. */
async function openFiles(holder,source){
 try{const result=await api(`/api/garages/${garage.id}/tree?project=${project.id}&source=${encodeURIComponent(source)}`);
  holder.querySelector('.file-list').innerHTML=result.files.length
   ?result.files.map(file=>`<button type="button" class="file" data-open-file="${safe(file.path)}"><code>${safe(file.path)}</code><i>${file.lang||''} ${Math.max(1,Math.round(file.bytes/1024))}KB</i></button>`).join('')
   :'<p class="jump-empty">Nothing at that path in the paired workspace.</p>'}
 catch(error){toast(error.message)}}
async function openFile(holder,path){
 try{const file=await api(`/api/garages/${garage.id}/file?project=${project.id}&source=${encodeURIComponent(path)}`);
  holder.querySelector('.code-view').innerHTML=file.binary
   ?`<p class="jump-empty">${safe(file.path)} is not text.</p>`
   :`<div class="code-bar"><code>${safe(file.path)}</code><span>${safe(file.lang||'')} · ${file.lines} lines${file.truncated?' · truncated':''}</span>
      <button type="button" class="text-button ping" data-show-file="${safe(file.path)}">✦ show my agent this file</button></div>
     <pre class="code"><code>${safe(file.text)}</code></pre>`;
  focusOn(`${project.name} · ${path}`,{garage:garage.id,neighborhood:hood.slug,project:project.id,file:path})}
 catch(error){toast(error.message)}}
/* Whatever is open here is what the agent gets when it asks what I am looking at. */
async function focusOn(label,context,note){try{await api('/api/focus',{method:'POST',body:JSON.stringify({label,context,note:note||''})})}catch{}}

function renderFlow(){
 const flow=project&&project.workflow;
 $('#flowTitle').textContent=flow&&flow.name?flow.name:'Workflow';
 VybFlow.render($('#flowView'),flow||{nodes:[],edges:[]},{onSelect:node=>node&&toast(`${node.label}${node.note?' — '+node.note:''}`)})}

/* The editor is just the street's bays with a name box under each one. */
function renderEditor(){
 const filled={};(project.modules||[]).forEach(module=>{filled[module.slot]=module});
 $('#bayFields').innerHTML=hood.slots.map(slot=>{const module=filled[slot.key]||{};
  return `<fieldset class="bay-field" data-slot="${safe(slot.key)}" style="--tone:var(--role-${safe(slot.role)})">
   <legend><i></i>${safe(slot.label)}</legend>
   <p>${safe(slot.hint||'')}</p>
   <label><span>What is mounted here</span><input data-field="name" value="${safe(module.name||'')}" placeholder="leave empty to keep the bay clear" autocomplete="off"></label>
   <div class="bay-row">
    <label><span>Language</span><input data-field="lang" value="${safe(module.lang||'')}" placeholder="Python" autocomplete="off"></label>
    <label><span>State</span><select data-field="status">${['hot','active','stable'].map(state=>`<option value="${state}"${module.status===state?' selected':''}>${state}</option>`).join('')}</select></label>
    <label><span>Weight</span><input data-field="weight" type="number" min="1" max="9" value="${module.weight||3}"></label>
   </div>
   <label><span>One line for a visitor</span><input data-field="note" value="${safe(module.note||'')}" placeholder="what this part actually does" autocomplete="off"></label>
  </fieldset>`}).join('')}

async function load(){
 const active=await VybHood.mountSwitcher($('#hoodSwitcher'),{onChange:slug=>{location.search=`?n=${encodeURIComponent(slug)}`}});
 if(!active){toast('The local VybPort service is not answering.');return}
 hood=(await api(`/api/neighborhoods/${encodeURIComponent(active.slug)}`)).neighborhood;
 try{mine=(await api('/api/garages?mine=1')).garages}catch{mine=[]}
 garage=mine.find(item=>item.neighborhood===hood.slug)||null;
 renderHeader();renderRack();await loadWorkspaces()}

$('#openForm').onsubmit=async event=>{event.preventDefault();
 try{const {user}=await api('/api/auth/me');if(!user){location.href='./register.html';return}
  const result=await api('/api/garages',{method:'POST',body:JSON.stringify({neighborhood:hood.slug,
   name:$('#openName').value.trim(),tagline:$('#openTagline').value.trim(),
   tags:[...document.querySelectorAll('#openTags input:checked')].map(input=>input.value)})});
  garage=result.garage;mine=(await api('/api/garages?mine=1')).garages;
  renderHeader();renderRack();toast(`${garage.name} is open on ${hood.name}.`)}
 catch(error){toast(error.message)}};

/* Pairing a folder, then rebuilding the rack from it. The workspace can be a mess; the rack is not. */
function renderWorkspaces(){
 const pick=$('#workspacePick');
 pick.innerHTML=workspaces.length
  ?workspaces.map(item=>`<option value="${item.id}"${garage&&garage.workspace_id===item.id?' selected':''}>${safe(item.label)}</option>`).join('')
  :'<option value="">no folder paired yet</option>';
 $('#pairList').innerHTML=workspaces.length?workspaces.map(item=>`<div class="pair-row">
   <div><b>${safe(item.label)}</b><span>${safe(item.path)}</span></div>
   <button type="button" data-unpair="${item.id}">unpair</button></div>`).join('')
  :'<p class="jump-empty">Nothing paired yet.</p>'}
async function loadWorkspaces(){try{const data=await api('/api/workspaces');workspaces=data.workspaces;
 $('#pairRoots').textContent=`Pairing a folder lets a garage rebuild itself from it — the local mess stays local, the rack is what people see. Allowed under: ${data.roots.join(', ')}.`}
 catch{workspaces=[]}renderWorkspaces()}
$('#pairForm').onsubmit=async event=>{event.preventDefault();
 try{await api('/api/workspaces',{method:'POST',body:JSON.stringify({path:$('#pairPath').value.trim(),label:$('#pairLabel').value.trim()})});
  $('#pairPath').value='';$('#pairLabel').value='';await loadWorkspaces();toast('Folder paired.')}
 catch(error){toast(error.message)}};
$('#pairList').onclick=async event=>{const id=event.target.dataset.unpair;if(!id)return;
 try{await api('/api/workspaces/unpair',{method:'POST',body:JSON.stringify({id:Number(id)})});await loadWorkspaces();toast('Unpaired.')}
 catch(error){toast(error.message)}};
$('#updateGarage').onclick=async()=>{const button=$('#updateGarage');
 const workspace=Number($('#workspacePick').value)||null;
 button.disabled=true;button.textContent='Scanning the folder…';
 try{const result=await api(`/api/garages/${garage.id}/update`,{method:'POST',body:JSON.stringify({workspace,project:project.id})});
  garage=result.garage;renderRack();
  $('#updateNote').textContent=`${result.summary}${result.unplaced.length?` · not on this street's rack: ${result.unplaced.map(item=>item.id).join(', ')}`:' · everything found a bay'}`;
  $('#snapshotStrip').innerHTML=result.history.map((snap,index)=>`<span${index?'':' class="latest"'}>${new Date(snap.taken_at*1000).toLocaleString()} · ${safe(snap.summary)}</span>`).join('');
  toast('Rack rebuilt from the workspace.')}
 catch(error){toast(error.message)}
 finally{button.disabled=false;button.textContent='↻ Update from workspace'}};

/* Staging actions: pick a project, promote one to flagship, swap a bay, draw the workflow. */
/* Opening a bench item: its rack, the bay-by-bay diff, the thread, a checkout and a test run. */
async function openBench(id){const item=garage.bench.find(entry=>entry.id===id);if(!item)return;
 const detail=$('#benchDetail');detail.hidden=false;
 detail.innerHTML=`<div class="bench-head"><div><span class="eyebrow">Borrowed from @${safe(item.origin_handle)}</span><h3>${safe(item.name)}</h3>
   <p>${safe(item.tagline||'')}</p></div>
   <div class="bay-actions"><button class="button ghost" data-checkout="${item.id}">Check out to workspace</button></div></div>
  ${item.checkout_path?`<p class="bench-path">working folder · ${safe(item.checkout_path)}</p>`:''}
  <div id="benchRack"></div>
  <form class="bench-test" data-test="${item.id}"><label><span>Test command · {dir} is the workspace</span>
    <input name="command" value="${safe(item.test_command||'')}" placeholder="python3 -m pytest {dir}" autocomplete="off"></label>
    <button class="button solid" type="submit">Run it here</button></form>
  ${item.test_result?`<pre class="bench-result">${safe(item.test_result)}</pre>`:''}
  <div class="bench-talk"><span class="eyebrow">Notes on this borrow</span><div id="benchNotes"></div>
   <form class="bench-note" data-target="borrow:${item.id}"><input name="body" placeholder="what is worth taking from this?" autocomplete="off" required><button class="button ghost" type="submit">Post</button></form></div>`;
 VybRack.render($('#benchRack'),{modules:VybHood.bays(hood,item.modules),links:[]},{layout:hood.layout,compact:true});
 try{const social=await api(`/api/social?target=borrow:${item.id}`);
  $('#benchNotes').innerHTML=social.comments.map(note=>`<p class="bench-note-row"><b>${safe(note.display_name)}</b>${note.via?` <i>via ${safe(note.via)}</i>`:''} ${safe(note.body)}</p>`).join('')||'<p class="jump-empty">No notes yet.</p>'}catch{}}

async function showCompare(id){try{const data=await api(`/api/garages/${garage.id}/compare?project=${id}`);
 const detail=$('#benchDetail');detail.hidden=false;
 detail.innerHTML=`<div class="bench-head"><div><span class="eyebrow">Bay for bay</span><h3>${safe(data.yours||'your flagship')} vs ${safe(data.theirs)}</h3></div>
   <button class="button ghost" data-open-bench="${id}">Open the borrow</button></div>
  <table class="compare"><thead><tr><th>Bay</th><th>Yours</th><th>@${safe(data.origin)}</th></tr></thead><tbody>
  ${data.bays.map(bay=>`<tr class="v-${bay.verdict.replace(' ','-')}"><th>${safe(bay.bay)}</th>
    <td>${bay.yours?`<b>${safe(bay.yours.name)}</b><span>${safe(bay.yours.lang||'')} ${safe(bay.yours.note||'')}</span>`:'<em>empty</em>'}</td>
    <td>${bay.theirs?`<b>${safe(bay.theirs.name)}</b><span>${safe(bay.theirs.lang||'')} ${safe(bay.theirs.note||'')}</span>`:'<em>empty</em>'}</td></tr>`).join('')}
  </tbody></table>`}catch(error){toast(error.message)}}

$('#benchList').onclick=event=>{const button=event.target.closest('button');if(!button)return;
 if(button.dataset.compare)showCompare(Number(button.dataset.compare));
 if(button.dataset.openBench)openBench(Number(button.dataset.openBench))};
$('#benchDetail').addEventListener('click',async event=>{const button=event.target.closest('button');if(!button)return;
 if(button.dataset.openBench){openBench(Number(button.dataset.openBench));return}
 if(button.dataset.checkout)try{const result=await api(`/api/projects/${button.dataset.checkout}/checkout`,{method:'POST',body:'{}'});
  garage=result.garage;renderHeader();toast(`Checked out to ${result.path}`);openBench(Number(button.dataset.checkout))}catch(error){toast(error.message)}});
$('#benchDetail').addEventListener('submit',async event=>{event.preventDefault();
 const form=event.target,values=Object.fromEntries(new FormData(form));
 if(form.dataset.test){const button=form.querySelector('button');button.disabled=true;button.textContent='Running…';
  try{const result=await api(`/api/projects/${form.dataset.test}/test`,{method:'POST',body:JSON.stringify(values)});
   garage=result.garage;renderHeader();openBench(Number(form.dataset.test));toast('Test run recorded.')}
  catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='Run it here'}return}
 if(form.dataset.target)try{await api('/api/social/comment',{method:'POST',body:JSON.stringify({target:form.dataset.target,body:values.body})});
  openBench(Number(form.dataset.target.split(':')[1]));toast('Note posted.')}catch(error){toast(error.message)}});

$('#projectTabs').onclick=async event=>{const button=event.target.closest('button');if(!button)return;
 if(button.dataset.open){project=garage.projects.find(item=>item.id===Number(button.dataset.open));renderHeader();renderRack();return}
 if(button.dataset.flag)try{const result=await api(`/api/projects/${button.dataset.flag}/flagship`,{method:'POST',body:'{}'});
  garage=result.garage;renderHeader();renderRack();toast('That is what visitors see first now.')}catch(error){toast(error.message)}};
$('#newProject').onclick=async()=>{const name=window.prompt('Name the project you are staging');if(!name)return;
 try{const result=await api(`/api/garages/${garage.id}/projects`,{method:'POST',body:JSON.stringify({name})});
  garage=result.garage;project=garage.projects.find(item=>item.id===result.project);renderHeader();renderRack();toast(`${name} is on the rack.`)}
 catch(error){toast(error.message)}};
$('#garageRack').addEventListener('click',async event=>{
 const mount=event.target.closest('[data-mount]');
 if(mount)try{const result=await api(`/api/variants/${mount.dataset.mount}/mount`,{method:'POST',body:'{}'});
  garage=result.garage;renderHeader();renderRack();toast('Bay swapped.')}catch(error){toast(error.message)}
 const files=event.target.closest('[data-files]');
 if(files)openFiles(files.closest('.code-zone'),files.dataset.files);
 const openOne=event.target.closest('[data-open-file]');
 if(openOne)openFile(openOne.closest('.code-zone'),openOne.dataset.openFile);
 const show=event.target.closest('[data-show]');
 if(show){const note=window.prompt('Anything to tell your agent about this?')||'';
  await focusOn(`${project.name} · ${show.dataset.show} bay`,{garage:garage.id,neighborhood:hood.slug,project:project.id,bay:show.dataset.show},note);
  toast('Your agent can see this now — ask it about “this”.')}
 const showFile=event.target.closest('[data-show-file]');
 if(showFile){const note=window.prompt('Anything to tell your agent about this file?')||'';
  await focusOn(`${project.name} · ${showFile.dataset.showFile}`,{garage:garage.id,neighborhood:hood.slug,project:project.id,file:showFile.dataset.showFile},note);
  toast('Sent. Your agent sees the same file.')}
 const history=event.target.closest('[data-history]');
 if(history)try{const result=await api(`/api/garages/${garage.id}/history?source=${encodeURIComponent(history.dataset.history)}`);
  const list=history.parentElement.querySelector('.commit-list');
  list.innerHTML=result.commits.length?result.commits.map(commit=>`<button type="button" class="commit" data-commit="${safe(commit.ref)}" data-source="${safe(result.source)}">
    <code>${safe(commit.ref)}</code><span>${safe(commit.subject)}</span><i>${safe(commit.when)}</i></button>`).join('')
   :'<p class="jump-empty">No commit history for that path in the paired workspace.</p>'}
 catch(error){toast(error.message)}
 const commit=event.target.closest('[data-commit]');
 if(commit){const tray=commit.closest('.variant-tray'),slot=tray.querySelector('.variant-add').dataset.slot;
  try{const result=await api(`/api/garages/${garage.id}/variants`,{method:'POST',body:JSON.stringify({project:project.id,slot,
    label:`${commit.dataset.source||slot} @ ${commit.dataset.commit}`,source:commit.dataset.source,ref:commit.dataset.commit,mount:true})});
   garage=result.garage;renderHeader();renderRack();toast(`Bay pinned to ${commit.dataset.commit}.`)}catch(error){toast(error.message)}}});
$('#garageRack').addEventListener('submit',async event=>{const form=event.target.closest('.variant-add');if(!form)return;
 event.preventDefault();const values=Object.fromEntries(new FormData(form));
 try{const result=await api(`/api/garages/${garage.id}/variants`,{method:'POST',body:JSON.stringify({project:project.id,slot:form.dataset.slot,...values,mount:true})});
  garage=result.garage;renderHeader();renderRack();toast('Linked and mounted.')}catch(error){toast(error.message)}});

/* The simple half of the workflow editor: a list of steps, each pointing at the one before it. */
function stepRow(node={},index=0){
 return `<div class="flow-step">
  <input data-step="label" value="${safe(node.label||'')}" placeholder="step ${index+1}" autocomplete="off">
  <select data-step="kind">${VybFlow.KINDS.map(kind=>`<option value="${kind}"${node.kind===kind?' selected':''}>${kind}</option>`).join('')}</select>
  <input data-step="note" value="${safe(node.note||'')}" placeholder="one line about it" autocomplete="off">
  <button type="button" data-drop>remove</button></div>`}
$('#editFlow').onclick=()=>{const flow=(project&&project.workflow)||{nodes:[],edges:[]};
 $('#flowName').value=flow.name||'';
 $('#flowSteps').innerHTML=(flow.nodes.length?flow.nodes:[{},{},{}]).map(stepRow).join('');
 $('#flowEditor').hidden=false};
$('#cancelFlow').onclick=()=>{$('#flowEditor').hidden=true};
$('#addStep').onclick=()=>{$('#flowSteps').insertAdjacentHTML('beforeend',stepRow({},$('#flowSteps').children.length))};
$('#flowSteps').onclick=event=>{if(event.target.dataset.drop!==undefined)event.target.closest('.flow-step').remove()};
$('#flowEditor').onsubmit=async event=>{event.preventDefault();
 const nodes=[...document.querySelectorAll('.flow-step')].map(row=>({
  label:row.querySelector('[data-step=label]').value.trim(),
  kind:row.querySelector('[data-step=kind]').value,
  note:row.querySelector('[data-step=note]').value.trim()})).filter(node=>node.label);
 const edges=nodes.slice(1).map((node,index)=>({from:nodes[index].label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),
  to:node.label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}));
 try{const result=await api(`/api/garages/${garage.id}/workflow`,{method:'POST',body:JSON.stringify({project:project.id,name:$('#flowName').value.trim()||'Workflow',nodes,edges})});
  garage=result.garage;$('#flowEditor').hidden=true;renderHeader();renderRack();toast('Workflow saved.')}
 catch(error){toast(error.message)}};

$('#editBays').onclick=()=>{renderEditor();$('#bayEditor').hidden=false;$('#bayEditor').scrollIntoView({behavior:'smooth',block:'nearest'})};
$('#cancelBays').onclick=()=>{$('#bayEditor').hidden=true};
$('#bayForm').onsubmit=async event=>{event.preventDefault();
 const modules=[...document.querySelectorAll('.bay-field')].map(field=>({
  slot:field.dataset.slot,
  name:field.querySelector('[data-field=name]').value.trim(),
  lang:field.querySelector('[data-field=lang]').value.trim(),
  note:field.querySelector('[data-field=note]').value.trim(),
  status:field.querySelector('[data-field=status]').value,
  weight:Number(field.querySelector('[data-field=weight]').value)||1})).filter(module=>module.name);
 try{const result=await api(`/api/garages/${garage.id}/modules`,{method:'POST',body:JSON.stringify({project:project.id,modules})});
  garage=result.garage;$('#bayEditor').hidden=true;renderRack();toast('Rack updated.')}
 catch(error){toast(error.message)}};

/* The local Git checkpoint panel is unchanged: it is about your workspace, not your street. */
function renderStage(){const rows=$('#stageRows');
 rows.innerHTML=status.files.length?status.files.map(file=>`<label class="stage-row"><input type="checkbox" data-file="${safe(file.path)}" ${file.staged?'checked':''}><span>${safe(file.path)}</span><i>${safe(file.staged?'staged':file.status)}</i></label>`).join(''):'<p class="stage-note">Clean workspace. Your next change starts here.</p>';
 const staged=status.files.filter(file=>file.staged).length;
 $('#stageStatus').className='stage-state ready';
 $('#stageStatus').innerHTML=`<i></i><span>${safe(status.branch)} · ${staged?`${staged} staged`:'nothing staged'}</span>`;
 $('#stageEverything').disabled=!status.files.length;$('#openCommit').disabled=!staged}
async function refresh(){try{status=await api('/api/git/status');renderStage()}
 catch{$('#stageStatus').className='stage-state error';$('#stageStatus').innerHTML='<i></i><span>Local service unavailable</span>'}}
$('#refreshGit').onclick=refresh;
$('#stageEverything').onclick=async()=>{try{await api('/api/git/stage',{method:'POST',body:JSON.stringify({files:status.files.map(file=>file.path)})});refresh();toast('All changes staged.')}catch(error){toast(error.message)}};
$('#stageRows').onchange=async event=>{if(!event.target.dataset.file)return;
 try{await api(event.target.checked?'/api/git/stage':'/api/git/unstage',{method:'POST',body:JSON.stringify({files:[event.target.dataset.file]})});refresh()}catch(error){toast(error.message)}};
$('#openCommit').onclick=async()=>{const message=prompt('Local commit message');if(!message)return;
 try{const result=await api('/api/git/commit',{method:'POST',body:JSON.stringify({message})});refresh();toast(`Committed ${result.commit}`)}catch(error){toast(error.message)}};

load().catch(error=>toast(error.message));refresh();
