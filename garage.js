/* The garage is a review workshop, not an IDE: local agents edit; this room stages what both sides inspect. */
const $=selector=>document.querySelector(selector);
const safe=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const toast=text=>{const node=$('#toast');node.textContent=text;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),2800)};
async function api(path,options={}){const response=await fetch(path,{headers:{'Content-Type':'application/json'},...options});let data={};try{data=await response.json()}catch{}if(!response.ok)throw new Error(data.error||'VybPort request failed');return data}
const agentState=window.VybAgentState;

let hood=null,garage=null,mine=[],project=null,activeModule=null,comparison=null,workspaces=[],gitState=null,currentView='modules';
let linkedAgents=[],agentProfiles=[],localAgentProviders=[],localAgentBridge=false,activeAgentConnection='',agentHistory=[],agentHistoryPrimed=false,agentSending=false,agentUnread=0;
const fileLists=new Map();
const review={docs:{mine:null,compare:null},active:'mine',anchor:{mine:null,compare:null},range:{mine:null,compare:null},notes:new Map()};

const projectKey=(id,slot)=>`${id}:${slot}`;
const docKey=doc=>doc?`${doc.project}:${doc.slot}:${doc.path}`:'';
const moduleFor=(entry,slot)=>entry?.modules?.find(module=>module.slot===slot)||null;
const slotInfo=slot=>hood?.slots?.find(item=>item.key===slot)||{key:slot,label:slot,role:'logic',hint:''};
const formatBytes=bytes=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:bytes>=1024?`${Math.max(1,Math.round(bytes/1024))} KB`:`${bytes||0} B`;
const dialogOpen=node=>{if(!node.open)node.showModal()};

function agentChoices(){
 const profiles=agentProfiles.filter(item=>item.credential_status==='active'&&(item.scopes||[]).includes('session')).sort((a,b)=>Number(b.live)-Number(a.live));
 return [
  ...profiles.map(item=>({key:`mcp:${item.id}`,kind:'mcp',id:item.id,label:item.agent_name||item.label,name:item.label,live:Boolean(item.live),profile:item})),
  ...(localAgentBridge&&project?linkedAgents:[]).map(item=>({key:`local:${item.id}`,kind:'local',id:item.id,label:item.label,name:item.label,live:null,profile:item})),
 ]
}

function selectedAgentConnection(){return agentChoices().find(item=>item.key===activeAgentConnection)||null}

function setAgentUnread(value){
 agentUnread=Math.max(0,value);const badge=$('#garageAgentUnread');badge.textContent=agentUnread>99?'99+':agentUnread;badge.hidden=!agentUnread
}

function renderAgentConnections(){
 const choices=agentChoices(),profiles=choices.filter(item=>item.kind==='mcp'),locals=choices.filter(item=>item.kind==='local'),select=$('#garageAgentSelect');
 if(!choices.some(item=>item.key===activeAgentConnection)){
  const prefer=localAgentBridge&&project&&agentState.selectedLocal()?'local':'mcp';
  activeAgentConnection=agentState.choose(choices,prefer)?.key||''
 }
 if(activeAgentConnection)agentState.select(activeAgentConnection);
 select.innerHTML=`${profiles.length?`<optgroup label="Remote MCP agents">${profiles.map(item=>`<option value="${item.key}">${safe(item.label)}${item.live?' · online':' · inbox'}</option>`).join('')}</optgroup>`:''}${locals.length?`<optgroup label="Owner lift CLI">${locals.map(item=>`<option value="${item.key}">${safe(item.label)} · local</option>`).join('')}</optgroup>`:''}`||'<option value="">No agent connected</option>';
 select.value=activeAgentConnection;
 select.disabled=!choices.length;
 $('#garageAgentBubble').hidden=!garage||(!choices.length&&!(localAgentBridge&&project));
 if(!choices.length&&!(localAgentBridge&&project)&&!$('#garageAgentDock').hidden)closeGarageAgent();
 refreshAgentIdentity();refreshAgentContextCard()
}

function refreshAgentIdentity(){
 const selected=selectedAgentConnection(),bubble=$('#garageAgentBubble'),dots=[$('#garageAgentPresence'),$('#garageAgentDockPresence')];
 if(!selected){$('#garageAgentName').textContent='No connected agent';$('#garageAgentState').textContent=localAgentBridge&&project?'Open an owner lift CLI or connect MCP':'Connect an MCP agent from your profile';dots.forEach(dot=>dot.className='');return}
 $('#garageAgentName').textContent=selected.label;
 const state=selected.kind==='local'?'owner lift CLI · replies inline':selected.live?'online via MCP · inbox replies':'remote MCP inbox · waiting for check-in';
 $('#garageAgentState').textContent=state;const tone=selected.kind==='local'||selected.live===true?'live':'waiting';dots.forEach(dot=>dot.className=tone);
 bubble.title=`Open chat with ${selected.label}`
}

function reviewExcerpt(doc,range){
 if(!doc||!range)return '';
 const lines=String(doc.text||'').split('\n'),start=Math.max(1,range.start),end=Math.min(lines.length,range.end);
 return lines.slice(start-1,end).map((line,index)=>`${start+index}: ${line}`).join('\n').slice(0,480)
}

function currentAgentContext(){
 const view=$('#reviewDialog').open?'review':activeModule?'module':currentView==='workflow'?'workflow':'project';
 const context={schema:'vybport.garage-context/1',view};
 if(hood)context.neighborhood={slug:hood.slug,name:hood.name};
 if(garage)context.garage={id:garage.id,name:garage.name};
 if(project)context.project={id:project.id,name:project.name};
 if(activeModule)context.module={slot:activeModule.slot,name:activeModule.name,language:activeModule.lang||'',source:activeModule.source||''};
 if(comparison){const saved=garage?.bench.find(item=>item.id===comparison.project.id),module=moduleFor(saved,comparison.slot);if(saved&&module)context.locker_compare={project_id:saved.id,project_name:saved.name,origin:`@${saved.origin_handle}`,slot:module.slot,module_name:module.name,language:module.lang||''}}
 if(view==='review'){
  const doc=selectedDoc(),range=review.range[review.active];
  if(doc&&range)context.review={project:doc.project,slot:doc.slot,file:doc.path,line_start:range.start,line_end:range.end,side:review.active,selection_excerpt:reviewExcerpt(doc,range)};
  const otherSide=review.active==='mine'?'compare':'mine',other=review.docs[otherSide],otherRange=review.range[otherSide];
  if(context.review&&other)context.review.compare={project:other.project,slot:other.slot,file:other.path,line_start:otherRange?.start||1,line_end:otherRange?.end||1,origin:other.owner};
 }
 context.hint=view==='review'?'Use garage.review_context for the current file, exact range, and margin notes when MCP tools are available.':'This is the workshop view the user explicitly attached.';
 return context
}

function fitAgentContext(context,limit=1900){
 const copy=JSON.parse(JSON.stringify(context));
 if(JSON.stringify(copy).length<=limit)return copy;
 if(copy.review)delete copy.review.selection_excerpt;
 if(JSON.stringify(copy).length<=limit)return copy;
 delete copy.hint;return copy
}

function refreshAgentContextCard(){
 const context=currentAgentContext(),title=[context.project?.name,context.module?.name].filter(Boolean).join(' · ')||garage?.name||'Garage overview';
 let detail=context.locker_compare?`Comparing with ${context.locker_compare.module_name} from ${context.locker_compare.origin}.`:context.module?`${slotInfo(context.module.slot).label} module is open.`:context.view==='workflow'?'Project workflow is open.':'Project-level workshop view.';
 let range='';if(context.review)range=`${context.review.file} · L${context.review.line_start}${context.review.line_end===context.review.line_start?'':`–${context.review.line_end}`}`;
 $('#garageAgentContextTitle').textContent=title;$('#garageAgentContextDetail').textContent=detail;$('#garageAgentContextRange').textContent=range;
 document.querySelector('[data-agent-prompt="compare"]').disabled=!context.locker_compare;renderLocalAgentBridge()
}

function selectedLocalProvider(){return localAgentProviders.find(item=>item.key===$('#garageCliProvider').value)||null}

function syncGarageCliLinkForm(){
 const provider=selectedLocalProvider();if(!provider)return;
 $('#garageCliIdLabel').textContent=provider.id_label;$('#garageCliCommandWrap').hidden=!provider.needs_command;
 $('#garageCliThread').placeholder=`Paste the exact ${provider.id_label} from your terminal`;
 $('#garageCliHint').textContent=provider.hint
}

function renderLocalAgentBridge(){
 const shell=$('#garageCliBridge');if(!shell)return;
 shell.hidden=!localAgentBridge;if(!localAgentBridge)return;
 const ready=Boolean(garage&&project),startable=localAgentProviders.filter(item=>item.starts&&item.detected);
 $('#garageCliSummary').textContent=ready?'owner only · lift ready':'owner only · lift empty';
 $('#garageCliNote').textContent=ready
  ?`Runs only on this host as its owner. Every turn is attached to ${project.name} and the module, file, or line range you open.`
  :'Put one of your projects on the lift before opening or attaching a host CLI session.';
 const startButtons=startable.map(item=>`<button type="button" data-cli-start="${safe(item.key)}"${ready?'':' disabled'}>Open ${safe(item.label)} on lift</button>`).join('');
 const linkable=localAgentProviders.some(item=>item.needs_command||item.detected);
 $('#garageCliButtons').innerHTML=`${startButtons}${linkable?`<button class="link" type="button" data-cli-link${ready?'':' disabled'}>Attach running session…</button>`:''}`||'<small>No supported host CLI is available on this machine.</small>';
 if(!ready)$('#garageCliLinkForm').hidden=true
}

function openGarageCliLink(){
 if(!project){toast('Put a project on the lift first.');return}
 const choices=localAgentProviders.filter(item=>item.needs_command||item.detected);
 if(!choices.length){toast('No host CLI is available to attach.');return}
 $('#garageCliProvider').innerHTML=choices.map(item=>`<option value="${safe(item.key)}">${safe(item.label)}</option>`).join('');
 syncGarageCliLinkForm();$('#garageCliBridge').open=true;$('#garageCliLinkForm').hidden=false;$('#garageCliLabel').focus()
}

async function startGarageCli(providerKey){
 if(!localAgentBridge||!project){toast('The owner CLI opens only with a project on the lift.');return}
 const provider=localAgentProviders.find(item=>item.key===providerKey);if(!provider)return;
 const input=$('#garageAgentInput'),written=input.value.trim();
 const message=written||`Join me at the ${project.name} lift. Start by inspecting the attached project context and tell me what you would open first.`;
 $('#garageCliNote').textContent=`Opening ${provider.label} against ${project.name}…`;
 $('#garageCliButtons').querySelectorAll('button').forEach(button=>button.disabled=true);
 try{
  const result=await api('/api/agents/start',{method:'POST',body:JSON.stringify({provider:provider.key,message,context:fitAgentContext(currentAgentContext())})});
  activeAgentConnection=agentState.select(agentState.key('local',result.agent.id));if(written)input.value='';
  await loadGarageAgents();await openGarageAgent();toast(`${result.agent.label} is attached to the lift.`)
 }catch(error){toast(error.message)}finally{renderLocalAgentBridge()}
}

async function linkGarageCli(event){
 event.preventDefault();if(!localAgentBridge||!project){toast('Put a project on the lift first.');return}
 const provider=$('#garageCliProvider').value,label=$('#garageCliLabel').value.trim(),thread_id=$('#garageCliThread').value.trim(),command=$('#garageCliCommand').value.trim();
 try{
  const result=await api('/api/agents',{method:'POST',body:JSON.stringify({provider,label,thread_id,command,context:fitAgentContext(currentAgentContext())})});
  activeAgentConnection=agentState.select(agentState.key('local',result.agent.id));
  $('#garageCliLinkForm').hidden=true;$('#garageCliLabel').value='';$('#garageCliThread').value='';$('#garageCliCommand').value='';
  await loadGarageAgents();await openGarageAgent();toast(`${result.agent.label} is attached to the lift.`)
 }catch(error){toast(error.message)}
}

const agentTime=value=>value?new Date(value*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';
const agentStatus=value=>({sending:'sending',queued:'waiting for agent',delivered:'delivered',replied:'replied',failed:'failed',complete:''}[value]??value??'');

function agentMessageMarkup(message){
 if(message.typing)return '<article class="garage-agent-message agent typing" aria-label="Agent is working"><div><span>●</span> <span>●</span> <span>●</span></div><footer>working in linked session</footer></article>';
 const role=['user','agent','system'].includes(message.role)?message.role:'system',status=agentStatus(message.status),classes=[role,message.status==='failed'?'failed':'',['sending','queued','delivered'].includes(message.status)&&role==='user'?'pending':''].filter(Boolean).join(' ');
 const who=role==='user'?'you':role==='agent'?(selectedAgentConnection()?.label||'agent'):'VybPort';
 return `<article class="garage-agent-message ${classes}"><div>${safe(message.body)}</div><footer><span>${safe(who)}</span>${agentTime(message.created_at)?`<span>${safe(agentTime(message.created_at))}</span>`:''}${status?`<span>${safe(status)}</span>`:''}</footer></article>`
}

function renderAgentHistory({scroll=false,typing=false}={}){
 const node=$('#garageAgentMessages'),nearBottom=node.scrollHeight-node.scrollTop-node.clientHeight<80;
 if(!agentHistory.length&&!typing){const selected=selectedAgentConnection(),copy=selected?.kind==='mcp'?'Messages enter this agent profile’s private MCP inbox. “Queued” means it has not called session.inbox yet.':'This private log resumes the linked terminal session and stores replies in your VybPort account.';node.innerHTML=`<div class="garage-chat-empty"><span>✦</span><b>Ready at the workbench</b><p>${safe(copy)}</p></div>`}
 else node.innerHTML=agentHistory.map(agentMessageMarkup).join('')+(typing?agentMessageMarkup({typing:true}):'');
 if(scroll||nearBottom)requestAnimationFrame(()=>{node.scrollTop=node.scrollHeight})
}

async function loadGarageAgentHistory({quiet=false,notify=true,scroll=false}={}){
 const selected=selectedAgentConnection();if(!selected){agentHistory=[];renderAgentHistory();return}
 const key=selected.key;
 try{
  const path=selected.kind==='mcp'?`/api/agent-profiles/${selected.id}/messages`:`/api/agents/${selected.id}/history`,data=await api(path);
  if(key!==activeAgentConnection)return;
  const next=data.messages||[],known=new Set(agentHistory.map(item=>String(item.id))),fresh=agentHistoryPrimed?next.filter(item=>item.role==='agent'&&!known.has(String(item.id))).length:0;
  agentHistory=next;if(fresh&&notify&&$('#garageAgentDock').hidden)setAgentUnread(agentUnread+fresh);agentHistoryPrimed=true;renderAgentHistory({scroll:scroll||fresh>0})
 }catch(error){if(!quiet){agentHistory=[{id:'history-error',role:'system',body:error.message,status:'failed'}];renderAgentHistory({scroll:true})}}
}

async function loadGarageAgents(){
 const remembered=agentState.selectedLocal()||agentState.selected();
 const [me,profileResult]=await Promise.all([api('/api/auth/me').catch(()=>({user:null})),api('/api/agent-profiles').catch(()=>({agent_profiles:[]}))]);
 localAgentBridge=Boolean(me.user?.local_agent_bridge);agentProfiles=profileResult.agent_profiles||[];
 if(localAgentBridge){
  const [localResult,providerResult]=await Promise.all([api('/api/agents').catch(()=>({agents:[]})),api('/api/agents/providers').catch(()=>({providers:[]}))]);
  linkedAgents=localResult.agents||[];localAgentProviders=providerResult.providers||[]
 }else{linkedAgents=[];localAgentProviders=[]}
 renderAgentConnections();
 if(activeAgentConnection)await loadGarageAgentHistory({quiet:true,notify:false});
 if(!remembered&&selectedAgentConnection()?.kind==='local'&&agentHistory.length)agentState.setOpen(true)
}

async function openGarageAgent(){
 if(!selectedAgentConnection()&&!(localAgentBridge&&project)){location.href='./index.html?agent=open';return}
 agentState.setOpen(true);
 $('#garageAgentDock').hidden=false;document.body.classList.add('agent-chat-open');$('#garageAgentBubble').setAttribute('aria-expanded','true');setAgentUnread(0);refreshAgentIdentity();refreshAgentContextCard();await loadGarageAgentHistory({quiet:true,notify:false,scroll:true});$('#garageAgentInput').focus()
}

function closeGarageAgent(){
 agentState.setOpen(false);
 $('#garageAgentDock').hidden=true;document.body.classList.remove('agent-chat-open');$('#garageAgentBubble').setAttribute('aria-expanded','false')
}

function promptStarter(kind){
 const context=currentAgentContext();
 if(kind==='compare')return context.locker_compare?`Compare my ${context.module?.name||'active module'} with ${context.locker_compare.module_name} from ${context.locker_compare.origin}. Go file by file, call out meaningful differences, and recommend what is worth testing or borrowing.`:'';
 if(kind==='test')return `Inspect ${context.project?.name||'this project'}${context.module?` with focus on ${context.module.name}`:''}. Run the most relevant existing test, then report the exact command, result, and any failure evidence. Do not change files unless I ask.`;
 if(context.review)return `Review the selected lines in ${context.review.file}. Check correctness, edge cases, and how they compare with the adjacent locker file if one is open. Reference exact lines in your answer.`;
 return `Review ${context.module?.name||context.project?.name||'what is on the lift'}. Tell me the highest-risk issue, why it matters, and the next concrete check you would run.`
}

async function sendGarageAgent(event){
 event.preventDefault();if(agentSending)return;
 const selected=selectedAgentConnection(),input=$('#garageAgentInput'),body=input.value.trim();
 if(!selected||!body)return;
 const context=fitAgentContext(currentAgentContext()),delivery=$('#garageAgentDelivery'),button=$('#garageAgentSend');
 agentSending=true;button.disabled=true;input.disabled=true;
 const optimistic={id:`pending-${Date.now()}`,role:'user',body,status:selected.kind==='mcp'?'queued':'sending',created_at:Math.floor(Date.now()/1000)};
 agentHistory=[...agentHistory,optimistic];renderAgentHistory({scroll:true,typing:selected.kind==='local'});
 try{
  if(selected.kind==='mcp'){
   await api(`/api/agent-profiles/${selected.id}/send`,{method:'POST',body:JSON.stringify({kind:context.locker_compare?'compare':context.view==='review'?'review':'task',body,context})});
   input.value='';delivery.className='waiting';delivery.textContent='Queued · waiting for session.inbox';toast(selected.live?'Sent to the agent inbox.':'Queued safely. The agent will receive it when it checks in.')
  }else{
   delivery.className='waiting';delivery.textContent='Agent is working in the linked session…';
   await api(`/api/agents/${selected.id}/message`,{method:'POST',body:JSON.stringify({mode:'chat',message:body,context})});
   input.value='';delivery.className='';delivery.textContent='Reply received from linked session';toast('Your agent replied in the garage.')
  }
  await loadGarageAgentHistory({quiet:false,notify:false,scroll:true})
 }catch(error){
  delivery.className='error';delivery.textContent='Delivery failed — message kept for retry';toast(error.message);
  await loadGarageAgentHistory({quiet:true,notify:false,scroll:true})
 }finally{agentSending=false;button.disabled=false;input.disabled=false;input.focus()}
}

function syncUrl(){
 const params=new URLSearchParams(location.search);if(hood)params.set('n',hood.slug);
 if(project)params.set('project',project.id);else params.delete('project');
 if(activeModule)params.set('module',activeModule.slot);else params.delete('module');
 history.replaceState(null,'',`${location.pathname}?${params}`)
}

function overlapScore(saved){
 let score=0;const ours=new Map((project?.modules||[]).map(module=>[module.slot,module]));
 for(const module of saved.modules||[]){const own=ours.get(module.slot);if(!own)continue;score+=4;
  if(own.lang&&module.lang&&own.lang.toLowerCase()===module.lang.toLowerCase())score+=3;
  const words=new Set(`${own.name} ${own.note}`.toLowerCase().split(/[^a-z0-9]+/).filter(word=>word.length>2));
  score+=`${module.name} ${module.note}`.toLowerCase().split(/[^a-z0-9]+/).filter(word=>words.has(word)).length}
 return score
}

function refreshGarage(next,{keepModule=true}={}){
 const projectId=project?.id,slot=keepModule?activeModule?.slot:null;
 garage=next;project=garage.projects.find(item=>item.id===projectId)||garage.flagship||garage.projects[0]||null;
 activeModule=slot?moduleFor(project,slot):null;
 if(comparison&&!garage.bench.some(item=>item.id===comparison.project.id))comparison=null;
 fileLists.clear();renderStudio()
}

function renderStudio(){
 const hasGarage=Boolean(garage);$('#garageStudio').hidden=!hasGarage;$('#openGarage').hidden=hasGarage;
 if(!hasGarage){$('#openTitle').textContent=`Open a workshop on ${hood.name}`;$('#openTags').innerHTML=(hood.tags||[]).map(tag=>`<label><input type="checkbox" value="${safe(tag)}"> ${safe(tag)}</label>`).join('');return}
 if(!project||!garage.projects.some(item=>item.id===project.id))project=garage.flagship||garage.projects[0]||null;
 $('#garageName').textContent=garage.name;$('#garageTagline').textContent=garage.tagline||`A staging workshop on ${hood.name}.`;
 $('#garageTags').innerHTML=(garage.tags||[]).map(tag=>`<span>${safe(tag)}</span>`).join('');
 $('#wanderLink').href=VybHood.link('wander.html',hood.slug);
 $('#projectList').innerHTML=garage.projects.map(item=>`<button class="project-card${item.id===project?.id?' active':''}" data-project="${item.id}">
   <i class="project-light"></i><span><b>${safe(item.name)}</b><small>${safe(item.tagline||`${item.modules.length} mounted modules`)}</small></span>
   <em>${item.flagship?'display':item.modules.length}</em></button>`).join('')||'<p class="empty-copy">Stage your first project.</p>';
 $('#garageJump').innerHTML=mine.map(item=>`<a href="${VybHood.link('garage.html',item.neighborhood)}"${item.id===garage.id?' class="here"':''} style="--hood:${item.hue}"><b>${safe(item.name)}</b><span>${safe(item.neighborhood_name)}</span></a>`).join('');
 renderProject();renderLocker();renderWorkspaces();renderBayEditor();renderFlowEditor();if(localAgentBridge)renderAgentConnections();else refreshAgentContextCard();syncUrl()
}

function renderProject(){
 if(!project)return;
 $('#projectName').textContent=activeModule?activeModule.name:project.name;
 $('#projectTagline').textContent=activeModule?(activeModule.note||slotInfo(activeModule.slot).hint||'Mounted module'):project.tagline||'A project staged for inspection.';
 $('#workbenchKicker').textContent=activeModule?`${slotInfo(activeModule.slot).label} bay · inside module`:'On the lift';
 $('#moduleBack').hidden=!activeModule;$('#projectFlag').textContent=project.flagship?'● visitor display':'';$('#makeFlagship').hidden=project.flagship;
 document.querySelectorAll('.workbench-tabs button').forEach(button=>button.classList.toggle('active',button.dataset.view===currentView));
 $('#projectOverview').hidden=currentView!=='modules'||Boolean(activeModule);$('#moduleRoom').hidden=currentView!=='modules'||!activeModule;$('#workflowRoom').hidden=currentView!=='workflow';
 $('#bayCount').textContent=`${project.modules.length} / ${hood.slots.length} mounted`;
 VybRack.render($('#garageRack'),{modules:VybHood.bays(hood,project.modules),links:[]},{layout:hood.layout,detail:false,onSelect:item=>{if(!item.empty)enterModule(item.id)}});
 VybFlow.render($('#flowView'),project.workflow||{nodes:[],edges:[]},{onSelect:node=>node&&toast(`${node.label}${node.note?' — '+node.note:''}`)});
 if(activeModule)renderModuleRoom();refreshAgentContextCard()
}

async function enterModule(slot){
 activeModule=moduleFor(project,slot);if(!activeModule)return;
 currentView='modules';syncUrl();renderProject();renderLocker();
 await loadOwnFiles(project,activeModule)
}

function ownModuleMarkup(module,files,loading=false){
 const shared=new Set((project.published_files?.[module.slot]||[]).map(file=>file.path));
 return `<header class="module-side-head"><div><span class="bay-badge">${safe(slotInfo(module.slot).label)}</span><h3>${safe(module.name)}</h3><p>${safe(module.note||slotInfo(module.slot).hint||'')}</p></div><span class="source-badge">live local</span></header>
  <div class="module-facts"><span>${safe(module.lang||'mixed')}</span><span>${safe(module.source||'workspace root')}</span><button class="text-button" data-share-module="${safe(module.slot)}">✦ point agent here</button></div>
  <div class="file-toolbar"><div><b>Files in this module</b><span>${shared.size} shared in public snapshot</span></div><button class="button publish-button" data-publish="${safe(module.slot)}"${loading||!files.length?' disabled':''}>Publish selected snapshot</button></div>
  <div class="module-files ${loading?'loading':''}">${loading?'<p class="empty-copy">Opening the module…</p>':files.length?files.map(file=>`<div class="module-file${shared.has(file.path)?' shared':''}">
    <button data-own-file="${safe(file.path)}"><code>${safe(file.path)}</code><span>${safe(file.lang||'text')} · ${formatBytes(file.bytes)}</span></button>
    <label title="Include in the next reviewed public snapshot"><input type="checkbox" data-publish-file value="${safe(file.path)}"${shared.has(file.path)?' checked':''}><i>${shared.has(file.path)?'shared':'select'}</i></label>
   </div>`).join(''):'<p class="empty-copy">No readable files were found at this module source. Pair or rescan the correct workspace in Manage workshop.</p>'}</div>
  <p class="publish-boundary">Publishing copies only the checked text files after confirmation. It never exposes the paired folder or follows future edits.</p>`
}

function compareModuleMarkup(saved,module){
 const files=saved.locker_files?.[module.slot]||[];
 return `<header class="module-side-head"><div><span class="bay-badge">${safe(slotInfo(module.slot).label)}</span><h3>${safe(module.name)}</h3><p>${safe(module.note||'Saved neighbor module')}</p></div><button class="remove-compare" data-close-compare title="Close comparison">×</button></header>
  <div class="module-facts"><span>from @${safe(saved.origin_handle)}</span><span>saved snapshot</span><button class="text-button" data-checkout="${saved.id}">check out locally</button></div>
  <div class="file-toolbar"><div><b>Locker files</b><span>${files.length?`${files.length} owner-selected file${files.length===1?'':'s'}`:'design metadata only'}</span></div></div>
  <div class="module-files">${files.length?files.map(file=>`<div class="module-file locker-file"><button data-locker-file="${safe(file.path)}"><code>${safe(file.path)}</code><span>${safe(file.lang||'text')} · ${formatBytes(file.bytes)}</span></button><i>locked</i></div>`).join(''):
   '<p class="empty-copy">The owner shared the module design but no code snapshot. You can still compare its role, language, and workflow.</p>'}</div>
  <p class="publish-boundary">This is the immutable version you saved. It cannot read the neighbor’s live workspace.</p>`
}

function renderModuleRoom(){
 if(!activeModule)return;const key=projectKey(project.id,activeModule.slot),files=fileLists.get(key)||[];
 $('#mineModule').innerHTML=ownModuleMarkup(activeModule,files,!fileLists.has(key));
 const valid=comparison&&garage.bench.find(item=>item.id===comparison.project.id);comparison=valid?comparison:null;
 $('#compareModule').hidden=!comparison;$('#modulePair').classList.toggle('comparing',Boolean(comparison));
 if(comparison){const saved=garage.bench.find(item=>item.id===comparison.project.id),module=moduleFor(saved,comparison.slot);if(module)$('#compareModule').innerHTML=compareModuleMarkup(saved,module)}
}

async function loadOwnFiles(targetProject,module){
 const key=projectKey(targetProject.id,module.slot);if(fileLists.has(key)){renderModuleRoom();return}
 try{const data=await api(`/api/garages/${garage.id}/tree?project=${targetProject.id}&source=${encodeURIComponent(module.source||'')}`);fileLists.set(key,data.files||[])}
 catch(error){fileLists.set(key,[]);toast(error.message)}
 if(project.id===targetProject.id&&activeModule?.slot===module.slot)renderModuleRoom()
}

function renderLocker(){
 if(!garage)return;const needle=$('#lockerSearch').value.trim().toLowerCase();
 const saved=[...garage.bench].filter(item=>`${item.name} ${item.origin_handle} ${(item.modules||[]).map(module=>`${module.name} ${module.lang} ${module.note}`).join(' ')}`.toLowerCase().includes(needle)).sort((a,b)=>overlapScore(b)-overlapScore(a)||b.updated_at-a.updated_at);
 const count=garage.bench.reduce((sum,item)=>sum+(item.modules||[]).length,0);$('#lockerCount').textContent=count;
 $('#lockerList').innerHTML=saved.length?saved.map(item=>{const score=overlapScore(item);return `<article class="locker-project${comparison?.project.id===item.id?' active':''}">
   <header><div><span class="locker-overlap">${score?`${score} overlap`:'different angle'}</span><h3>${safe(item.name)}</h3><p>from @${safe(item.origin_handle)}</p></div><button data-checkout="${item.id}" title="Write saved snapshot into your paired workspace">⇩</button></header>
   <div class="locker-modules">${(item.modules||[]).map(module=>{const files=item.locker_files?.[module.slot]||[],aligned=moduleFor(project,module.slot);return `<button data-pull-module="${item.id}:${safe(module.slot)}" class="locker-module${comparison?.project.id===item.id&&comparison.slot===module.slot?' selected':''}">
     <i style="--tone:var(--role-${safe(slotInfo(module.slot).role)})"></i><span><b>${safe(module.name)}</b><small>${safe(slotInfo(module.slot).label)} · ${safe(module.lang||'mixed')}</small></span><em>${files.length?`${files.length} files`:'design'}</em>${aligned?'<strong>lines up</strong>':''}</button>`}).join('')}</div>
  </article>`}).join(''):`<div class="locker-empty"><span>▤</span><b>${needle?'No saved module matches.':'Your locker is empty.'}</b><p>${needle?'Try another filter.':'Wander the neighborhood and save the modules you want to inspect.'}</p><a href="${VybHood.link('wander.html',hood.slug)}">wander for modules →</a></div>`
}

async function pullModule(projectId,slot){
 const saved=garage.bench.find(item=>item.id===projectId),module=moduleFor(saved,slot);if(!saved||!module)return;
 comparison={project:saved,slot};
 if(!activeModule){activeModule=moduleFor(project,slot)||project.modules[0]||null;currentView='modules'}
 renderProject();renderLocker();refreshAgentContextCard();syncUrl();
 if(activeModule)await loadOwnFiles(project,activeModule)
}

function bestLockerFile(saved,slot,ownFile){
 const files=saved.locker_files?.[slot]||[];if(!files.length)return null;
 return files.find(file=>file.path===ownFile.path)||files.find(file=>file.path.split('/').pop()===ownFile.path.split('/').pop())||files.find(file=>file.lang&&file.lang===ownFile.lang)||files[0]
}
function bestOwnFile(files,lockerFile){
 return files.find(file=>file.path===lockerFile.path)||files.find(file=>file.path.split('/').pop()===lockerFile.path.split('/').pop())||files.find(file=>file.lang&&file.lang===lockerFile.lang)||files[0]
}

async function fetchOwnFile(path){return api(`/api/garages/${garage.id}/file?project=${project.id}&source=${encodeURIComponent(path)}`)}
async function fetchLockerFile(saved,slot,path){return (await api(`/api/locker/${saved.id}/files?slot=${encodeURIComponent(slot)}&path=${encodeURIComponent(path)}`)).file}
function normalizeDoc(file,entry,module){return {...file,project:entry.id,project_name:entry.name,slot:module.slot,owner:entry.kind==='borrowed'?`@${entry.origin_handle}`:'you',module_name:module.name,snapshot:entry.kind==='borrowed'||file.snapshot}}

async function openOwnReview(path){
 try{const own=normalizeDoc(await fetchOwnFile(path),project,activeModule);if(own.binary){toast('That file is binary, so it has no line review view.');return}
  review.docs={mine:own,compare:null};review.active='mine';
  if(comparison){const saved=garage.bench.find(item=>item.id===comparison.project.id),module=moduleFor(saved,comparison.slot),candidate=bestLockerFile(saved,comparison.slot,own);
   if(candidate)review.docs.compare=normalizeDoc(await fetchLockerFile(saved,module.slot,candidate.path),saved,module)}
  openReviewDialog()
 }catch(error){toast(error.message)}
}

async function openLockerReview(path){
 try{const saved=garage.bench.find(item=>item.id===comparison?.project.id),module=moduleFor(saved,comparison?.slot);if(!saved||!module)return;
  const locker=normalizeDoc(await fetchLockerFile(saved,module.slot,path),saved,module);let own=null;
  if(activeModule){const key=projectKey(project.id,activeModule.slot);if(!fileLists.has(key))await loadOwnFiles(project,activeModule);const candidate=bestOwnFile(fileLists.get(key)||[],locker);if(candidate)own=normalizeDoc(await fetchOwnFile(candidate.path),project,activeModule)}
  review.docs=own?{mine:own,compare:locker}:{mine:locker,compare:null};review.active=own?'compare':'mine';openReviewDialog()
 }catch(error){toast(error.message)}
}

function codeMarkup(doc,side){
 const lines=String(doc.text||'').split('\n');return lines.map((line,index)=>`<button class="review-line" data-line="${index+1}" data-side="${side}" type="button"><span>${index+1}</span><code>${line?safe(line):' '}</code></button>`).join('')
}

function renderDocument(side,doc){
 const prefix=side==='mine'?'mine':'compare';if(!doc)return;
 $(`#${prefix}DocOwner`).textContent=doc.snapshot?`${doc.owner} · saved snapshot`:'you · live workspace';
 $(`#${prefix}DocName`).textContent=doc.module_name;$(`#${prefix}DocMeta`).textContent=`${doc.lang||'text'} · ${doc.lines} lines`;
 $(`#${prefix}Code`).innerHTML=codeMarkup(doc,side)
}

function openReviewDialog(){
 review.anchor={mine:null,compare:null};review.range={mine:null,compare:null};review.notes.clear();
 renderDocument('mine',review.docs.mine);$('#compareDocument').hidden=!review.docs.compare;if(review.docs.compare)renderDocument('compare',review.docs.compare);
 $('#reviewDocuments').classList.toggle('split',Boolean(review.docs.compare));
 $('#reviewTitle').textContent=review.docs.compare?`${review.docs.mine.module_name} ↔ ${review.docs.compare.module_name}`:review.docs.mine.module_name;
 $('#reviewPath').textContent=review.docs.compare?`${review.docs.mine.path}  /  ${review.docs.compare.path}`:review.docs.mine.path;
 $('#reviewNoteBody').value='';const dialog=$('#reviewDialog');if(!dialog.open)dialog.show();selectLine(review.active,1,false);loadReviewNotes(review.active);refreshAgentContextCard()
}

function selectedDoc(){return review.docs[review.active]}
function selectLine(side,line,extend){
 if(!review.docs[side])return;review.active=side;
 if(extend&&review.anchor[side])review.range[side]={start:Math.min(review.anchor[side],line),end:Math.max(review.anchor[side],line)};
 else{review.anchor[side]=line;review.range[side]={start:line,end:line}}
 document.querySelectorAll('.review-line').forEach(node=>{const range=review.range[node.dataset.side],number=Number(node.dataset.line);node.classList.toggle('selected',Boolean(range&&number>=range.start&&number<=range.end));node.classList.toggle('active-side',node.dataset.side===review.active)});
 const range=review.range[side],doc=review.docs[side];$('#selectionReadout').textContent=`${doc.path} · L${range.start}${range.end===range.start?'':`–${range.end}`}`;$('#noteRange').textContent=`Note on L${range.start}${range.end===range.start?'':`–${range.end}`} · ${doc.path}`;
 $('#noteHeading').textContent=`${doc.module_name} margin`;loadReviewNotes(side);refreshAgentContextCard()
}

async function loadReviewNotes(side,quiet=false){
 const doc=review.docs[side];if(!doc)return;
 try{const data=await api(`/api/reviews?project=${doc.project}&slot=${encodeURIComponent(doc.slot)}&path=${encodeURIComponent(doc.path)}`);review.notes.set(docKey(doc),data.notes||[]);if(review.active===side)renderReviewNotes();markNotedLines()}
 catch(error){if(!quiet)toast(error.message)}
}

function renderReviewNotes(){
 const doc=selectedDoc(),notes=review.notes.get(docKey(doc))||[];
 $('#reviewNoteList').innerHTML=notes.length?notes.map(note=>`<article class="review-note${note.resolved?' resolved':''}${note.stale?' stale':''}" data-note="${note.id}">
   <button class="note-jump" data-note-range="${note.line_start}:${note.line_end}"><span>L${note.line_start}${note.line_end===note.line_start?'':`–${note.line_end}`}</span><i>${safe(note.via||'reviewer')}</i></button>
   <p>${safe(note.body)}</p><footer>${note.stale?'<em>file changed since note</em>':''}<button data-edit-note="${note.id}">edit</button><button data-resolve-note="${note.id}" data-resolved="${note.resolved?'1':'0'}">${note.resolved?'reopen':'resolve'}</button></footer>
  </article>`).join(''):'<p class="empty-copy">No margin notes on this file yet.</p>'
}

function markNotedLines(){
 for(const side of ['mine','compare']){const doc=review.docs[side];if(!doc)continue;const notes=(review.notes.get(docKey(doc))||[]).filter(note=>!note.resolved);
  document.querySelectorAll(`.review-line[data-side="${side}"]`).forEach(node=>{const line=Number(node.dataset.line);node.classList.toggle('noted',notes.some(note=>line>=note.line_start&&line<=note.line_end))})}
}

async function shareReview(){
 const primary=selectedDoc(),range=review.range[review.active]||{start:1,end:1},other=review.active==='mine'?review.docs.compare:review.docs.mine;
 const context={view:'review',garage:garage.id,neighborhood:hood.slug,project:primary.project,slot:primary.slot,file:primary.path,line_start:range.start,line_end:range.end};
 if(other){const otherSide=review.active==='mine'?'compare':'mine',otherRange=review.range[otherSide]||{start:1,end:1};context.compare={project:other.project,slot:other.slot,file:other.path,line_start:otherRange.start,line_end:otherRange.end,origin:other.owner}}
 try{await api('/api/focus',{method:'POST',body:JSON.stringify({label:`Review · ${primary.module_name} · ${primary.path} · L${range.start}-${range.end}`,context,note:'Use garage.review_context to read this exact range and its margin notes.'})});
  const button=$('#shareReview');button.classList.add('shared');button.textContent='✓ Agent view updated';setTimeout(()=>{button.classList.remove('shared');button.textContent='✦ Update agent view'},1800);toast('Your agent now sees this exact file and line range.')
 }catch(error){toast(error.message)}
}

async function publishSelected(slot){
 const files=[...$('#mineModule').querySelectorAll('[data-publish-file]:checked')].map(input=>input.value);if(!files.length){toast('Check the exact files you want in the public snapshot.');return}
 const shown=files.length<=8?files.join('\n'):`${files.slice(0,8).join('\n')}\n…and ${files.length-8} more`;
 if(!confirm(`Publish a frozen review snapshot of exactly these ${files.length} file${files.length===1?'':'s'}?\n\n${shown}\n\nUnselected files and future local edits stay private.`))return;
 try{const result=await api(`/api/projects/${project.id}/modules/${encodeURIComponent(slot)}/publish`,{method:'POST',body:JSON.stringify({files,confirmed:true})});refreshGarage(result.garage);toast(`${result.published_files.length} reviewed file${result.published_files.length===1?'':'s'} published.`)}
 catch(error){toast(error.message)}
}

async function focusModule(slot){
 try{await api('/api/focus',{method:'POST',body:JSON.stringify({label:`${project.name} · ${slotInfo(slot).label} module`,context:{view:'module',garage:garage.id,neighborhood:hood.slug,project:project.id,slot},note:'The user is inspecting this module in the VybPort review workshop.'})});toast('Your agent now sees this module as the active context.');await openGarageAgent()}
 catch(error){toast(error.message)}
}

function renderWorkspaces(){
 const pick=$('#workspacePick');pick.innerHTML=workspaces.length?workspaces.map(item=>`<option value="${item.id}"${project?.workspace_id===item.id||(!project?.workspace_id&&garage?.workspace_id===item.id)?' selected':''}>${safe(item.label)}</option>`).join(''):'<option value="">no folder paired</option>';
 $('#pairList').innerHTML=workspaces.length?workspaces.map(item=>`<div class="pair-row"><div><b>${safe(item.label)}</b><span>${safe(item.path)}</span></div><button type="button" data-unpair="${item.id}">unpair</button></div>`).join(''):'<p class="empty-copy">No local folder paired yet.</p>'
}
async function loadWorkspaces(){try{workspaces=(await api('/api/workspaces')).workspaces||[]}catch{workspaces=[]}renderWorkspaces()}

function renderBayEditor(){
 if(!project)return;const filled=new Map(project.modules.map(module=>[module.slot,module]));
 $('#bayFields').innerHTML=hood.slots.map(slot=>{const module=filled.get(slot.key)||{};return `<fieldset class="bay-field" data-slot="${safe(slot.key)}" style="--tone:var(--role-${safe(slot.role)})"><legend><i></i>${safe(slot.label)}</legend><p>${safe(slot.hint||'')}</p>
   <label><span>Mounted name</span><input data-field="name" value="${safe(module.name||'')}" placeholder="leave empty to clear"></label>
   <div class="bay-row"><label><span>Language</span><input data-field="lang" value="${safe(module.lang||'')}" placeholder="Python"></label><label><span>State</span><select data-field="status">${['hot','active','stable'].map(state=>`<option${module.status===state?' selected':''}>${state}</option>`).join('')}</select></label></div>
   <label><span>Review note</span><input data-field="note" value="${safe(module.note||'')}" placeholder="what this part does"></label></fieldset>`}).join('')
}

function stepRow(node={},index=0){return `<div class="flow-step"><input data-step="label" value="${safe(node.label||'')}" placeholder="step ${index+1}"><select data-step="kind">${VybFlow.KINDS.map(kind=>`<option value="${kind}"${node.kind===kind?' selected':''}>${kind}</option>`).join('')}</select><input data-step="note" value="${safe(node.note||'')}" placeholder="one line"><button type="button" data-drop>×</button></div>`}
function renderFlowEditor(){const flow=project?.workflow||{nodes:[]};$('#flowName').value=flow.name||'';$('#flowSteps').innerHTML=(flow.nodes.length?flow.nodes:[{},{},{}]).map(stepRow).join('')}

function renderGit(){
 if(!gitState)return;$('#stageRows').innerHTML=gitState.files.length?gitState.files.map(file=>`<label class="stage-row"><input type="checkbox" data-file="${safe(file.path)}" ${file.staged?'checked':''}><span>${safe(file.path)}</span><i>${safe(file.staged?'staged':file.status)}</i></label>`).join(''):'<p class="manage-fineprint">Clean workspace.</p>';
 const staged=gitState.files.filter(file=>file.staged).length;$('#stageStatus').className='stage-state ready';$('#stageStatus').innerHTML=`<i></i><span>${safe(gitState.branch)} · ${staged} staged</span>`;$('#stageEverything').disabled=!gitState.files.length;$('#openCommit').disabled=!staged
}
async function refreshGit(){try{gitState=await api('/api/git/status');renderGit()}catch{$('#stageStatus').className='stage-state error';$('#stageStatus').innerHTML='<i></i><span>local Git unavailable</span>'}}

async function checkoutSaved(id){
 try{const result=await api(`/api/projects/${id}/checkout`,{method:'POST',body:'{}'});refreshGarage(result.garage);toast(`Saved snapshot checked out to ${result.path}`)}catch(error){toast(error.message)}
}

async function load(){
 const active=await VybHood.mountSwitcher($('#hoodSwitcher'),{onChange:slug=>{location.search=`?n=${encodeURIComponent(slug)}`}});if(!active){toast('The local VybPort service is not answering.');return}
 hood=(await api(`/api/neighborhoods/${encodeURIComponent(active.slug)}`)).neighborhood;
 try{mine=(await api('/api/garages?mine=1')).garages}catch{mine=[]}
 garage=mine.find(item=>item.neighborhood===hood.slug)||null;
 if(garage){const params=new URLSearchParams(location.search),wanted=Number(params.get('project'));project=garage.projects.find(item=>item.id===wanted)||garage.flagship||garage.projects[0];const slot=params.get('module');activeModule=moduleFor(project,slot)}
 renderStudio();await Promise.all([loadWorkspaces(),loadGarageAgents()]);if(activeModule)await loadOwnFiles(project,activeModule);refreshGit();
 const params=new URLSearchParams(location.search);if(activeAgentConnection&&(agentState.isOpen()||params.get('agent')==='open'))await openGarageAgent()
}

$('#openForm').onsubmit=async event=>{event.preventDefault();try{const {user}=await api('/api/auth/me');if(!user){location.href='./register.html';return}const result=await api('/api/garages',{method:'POST',body:JSON.stringify({neighborhood:hood.slug,name:$('#openName').value.trim(),tagline:$('#openTagline').value.trim(),tags:[...document.querySelectorAll('#openTags input:checked')].map(input=>input.value)})});mine=(await api('/api/garages?mine=1')).garages;garage=result.garage;project=garage.flagship||garage.projects[0];renderStudio();toast(`${garage.name} is open.`)}catch(error){toast(error.message)}};

$('#projectList').onclick=event=>{const button=event.target.closest('[data-project]');if(!button)return;project=garage.projects.find(item=>item.id===Number(button.dataset.project));activeModule=null;comparison=null;currentView='modules';renderStudio()};
$('#newProject').onclick=()=>{dialogOpen($('#newProjectDialog'));$('#newProjectName').focus()};
$('#newProjectForm').onsubmit=async event=>{event.preventDefault();try{const result=await api(`/api/garages/${garage.id}/projects`,{method:'POST',body:JSON.stringify({name:$('#newProjectName').value.trim(),tagline:$('#newProjectTagline').value.trim()})});$('#newProjectDialog').close();project={id:result.project};refreshGarage(result.garage,{keepModule:false});toast('New project is on the lift.')}catch(error){toast(error.message)}};
$('#makeFlagship').onclick=async()=>{try{const result=await api(`/api/projects/${project.id}/flagship`,{method:'POST',body:'{}'});refreshGarage(result.garage);toast('Visitors will now see this project first.')}catch(error){toast(error.message)}};
$('#moduleBack').onclick=()=>{activeModule=null;comparison=null;renderProject();renderLocker();syncUrl()};
document.querySelector('.workbench-tabs').onclick=event=>{const button=event.target.closest('[data-view]');if(!button)return;currentView=button.dataset.view;if(currentView==='workflow')activeModule=null;renderProject();syncUrl()};
$('#lockerSearch').oninput=renderLocker;
$('#lockerList').onclick=event=>{const pull=event.target.closest('[data-pull-module]'),checkout=event.target.closest('[data-checkout]');if(checkout){checkoutSaved(Number(checkout.dataset.checkout));return}if(pull){const [id,slot]=pull.dataset.pullModule.split(':');pullModule(Number(id),slot)}};
$('#modulePair').onclick=async event=>{const own=event.target.closest('[data-own-file]'),locker=event.target.closest('[data-locker-file]'),publish=event.target.closest('[data-publish]'),share=event.target.closest('[data-share-module]'),checkout=event.target.closest('[data-checkout]');
 if(own){openOwnReview(own.dataset.ownFile);return}if(locker){openLockerReview(locker.dataset.lockerFile);return}if(publish){publishSelected(publish.dataset.publish);return}if(share){focusModule(share.dataset.shareModule);return}if(checkout){checkoutSaved(Number(checkout.dataset.checkout));return}if(event.target.closest('[data-close-compare]')){comparison=null;renderModuleRoom();renderLocker();refreshAgentContextCard()}};

$('#reviewDocuments').onclick=event=>{const line=event.target.closest('[data-line]');if(line)selectLine(line.dataset.side,Number(line.dataset.line),event.shiftKey)};
$('#shareReview').onclick=shareReview;
$('#reviewNoteForm').onsubmit=async event=>{event.preventDefault();const doc=selectedDoc(),range=review.range[review.active];if(!doc||!range){toast('Select a line range first.');return}try{await api('/api/reviews',{method:'POST',body:JSON.stringify({project:doc.project,slot:doc.slot,path:doc.path,line_start:range.start,line_end:range.end,body:$('#reviewNoteBody').value.trim()})});$('#reviewNoteBody').value='';await loadReviewNotes(review.active);toast('Note added to the shared margin.')}catch(error){toast(error.message)}};
$('#reviewNoteList').onclick=async event=>{const jump=event.target.closest('[data-note-range]'),resolve=event.target.closest('[data-resolve-note]'),edit=event.target.closest('[data-edit-note]');if(jump){const [start,end]=jump.dataset.noteRange.split(':').map(Number);review.anchor[review.active]=start;review.range[review.active]={start,end};selectLine(review.active,end,true);document.querySelector(`.review-line[data-side="${review.active}"][data-line="${start}"]`)?.scrollIntoView({block:'center'});return}if(resolve)try{await api(`/api/reviews/${resolve.dataset.resolveNote}/resolve`,{method:'POST',body:JSON.stringify({resolved:resolve.dataset.resolved!=='1'})});loadReviewNotes(review.active)}catch(error){toast(error.message)}if(edit){const notes=review.notes.get(docKey(selectedDoc()))||[],note=notes.find(item=>item.id===Number(edit.dataset.editNote)),body=prompt('Edit review note',note?.body||'');if(body===null)return;try{await api(`/api/reviews/${edit.dataset.editNote}/update`,{method:'POST',body:JSON.stringify({body})});loadReviewNotes(review.active)}catch(error){toast(error.message)}}};

$('#manageGarage').onclick=()=>{renderBayEditor();renderFlowEditor();renderWorkspaces();dialogOpen($('#manageDialog'))};
$('#browseFolder').onclick=async()=>{const chosen=await VybPicker.pick($('#pairPath').value.trim());if(!chosen)return;$('#pairPath').value=chosen;if(!$('#pairLabel').value.trim())$('#pairLabel').value=chosen.split('/').filter(Boolean).pop()||''};
$('#pairForm').onsubmit=async event=>{event.preventDefault();try{await api('/api/workspaces',{method:'POST',body:JSON.stringify({path:$('#pairPath').value.trim(),label:$('#pairLabel').value.trim()})});$('#pairPath').value='';$('#pairLabel').value='';await loadWorkspaces();toast('Folder paired.')}catch(error){toast(error.message)}};
$('#pairList').onclick=async event=>{const button=event.target.closest('[data-unpair]');if(!button)return;try{await api('/api/workspaces/unpair',{method:'POST',body:JSON.stringify({id:Number(button.dataset.unpair)})});await loadWorkspaces();toast('Folder unpaired.')}catch(error){toast(error.message)}};
$('#updateGarage').onclick=async()=>{const button=$('#updateGarage');button.disabled=true;button.textContent='Scanning…';try{const result=await api(`/api/garages/${garage.id}/update`,{method:'POST',body:JSON.stringify({workspace:Number($('#workspacePick').value)||null,project:project.id})});$('#updateNote').textContent=result.summary+(result.unplaced?.length?` · ${result.unplaced.length} unplaced`:' · every detected module was placed');refreshGarage(result.garage);toast('Active project rescanned.')}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='↻ Scan active project'}};
$('#bayForm').onsubmit=async event=>{event.preventDefault();const modules=[...document.querySelectorAll('.bay-field')].map(field=>({slot:field.dataset.slot,name:field.querySelector('[data-field=name]').value.trim(),lang:field.querySelector('[data-field=lang]').value.trim(),note:field.querySelector('[data-field=note]').value.trim(),status:field.querySelector('[data-field=status]').value,weight:3})).filter(module=>module.name);try{const result=await api(`/api/garages/${garage.id}/modules`,{method:'POST',body:JSON.stringify({project:project.id,modules})});refreshGarage(result.garage);toast('Module map saved.')}catch(error){toast(error.message)}};
$('#addStep').onclick=()=>{$('#flowSteps').insertAdjacentHTML('beforeend',stepRow({},$('#flowSteps').children.length))};
$('#flowSteps').onclick=event=>{if(event.target.hasAttribute('data-drop'))event.target.closest('.flow-step').remove()};
$('#flowEditor').onsubmit=async event=>{event.preventDefault();const nodes=[...document.querySelectorAll('.flow-step')].map(row=>({label:row.querySelector('[data-step=label]').value.trim(),kind:row.querySelector('[data-step=kind]').value,note:row.querySelector('[data-step=note]').value.trim()})).filter(node=>node.label);const id=value=>value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');const edges=nodes.slice(1).map((node,index)=>({from:id(nodes[index].label),to:id(node.label)}));try{const result=await api(`/api/garages/${garage.id}/workflow`,{method:'POST',body:JSON.stringify({project:project.id,name:$('#flowName').value.trim()||'Workflow',nodes,edges})});refreshGarage(result.garage);toast('Workflow saved.')}catch(error){toast(error.message)}};
$('#refreshGit').onclick=refreshGit;
$('#stageEverything').onclick=async()=>{try{await api('/api/git/stage',{method:'POST',body:JSON.stringify({files:gitState.files.map(file=>file.path)})});await refreshGit();toast('All changes staged.')}catch(error){toast(error.message)}};
$('#stageRows').onchange=async event=>{if(!event.target.dataset.file)return;try{await api(event.target.checked?'/api/git/stage':'/api/git/unstage',{method:'POST',body:JSON.stringify({files:[event.target.dataset.file]})});refreshGit()}catch(error){toast(error.message)}};
$('#openCommit').onclick=async()=>{const message=prompt('Local commit message');if(!message)return;try{const result=await api('/api/git/commit',{method:'POST',body:JSON.stringify({message})});refreshGit();toast(`Committed ${result.commit}`)}catch(error){toast(error.message)}};

$('#garageAgentBubble').onclick=openGarageAgent;
$('#garageAgentTopToggle').onclick=openGarageAgent;
$('#closeGarageAgent').onclick=closeGarageAgent;
$('#garageAgentSelect').onchange=async event=>{activeAgentConnection=agentState.select(event.target.value);agentHistory=[];agentHistoryPrimed=false;setAgentUnread(0);refreshAgentIdentity();renderAgentHistory();await loadGarageAgentHistory({quiet:false,notify:false,scroll:true})};
$('#garageCliButtons').onclick=event=>{const start=event.target.closest('[data-cli-start]'),link=event.target.closest('[data-cli-link]');if(start&&!start.disabled)startGarageCli(start.dataset.cliStart);else if(link&&!link.disabled)openGarageCliLink()};
$('#garageCliProvider').onchange=syncGarageCliLinkForm;
$('#cancelGarageCliLink').onclick=()=>{$('#garageCliLinkForm').hidden=true};
$('#garageCliLinkForm').onsubmit=linkGarageCli;
$('#refreshAgentContext').onclick=()=>{refreshAgentContextCard();toast('The current workshop view will travel with your next message.')};
document.querySelector('.garage-agent-prompts').onclick=event=>{const button=event.target.closest('[data-agent-prompt]');if(!button||button.disabled)return;$('#garageAgentInput').value=promptStarter(button.dataset.agentPrompt);$('#garageAgentInput').focus()};
$('#garageAgentForm').onsubmit=sendGarageAgent;
$('#reviewDialog').addEventListener('close',refreshAgentContextCard);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#garageAgentDock').hidden){event.preventDefault();event.stopPropagation();closeGarageAgent()}},{capture:true});

setInterval(()=>{if($('#reviewDialog').open)loadReviewNotes(review.active,true)},5000);
setInterval(()=>{const selected=selectedAgentConnection();if(selected&&(selected.kind==='mcp'||!$('#garageAgentDock').hidden)&&!agentSending)loadGarageAgentHistory({quiet:true,notify:true})},4500);
load().catch(error=>toast(error.message));
