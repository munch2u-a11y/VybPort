const $=selector=>document.querySelector(selector);
const safe=value=>String(value??'').replace(/[&<>'"]/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[character]);
const toast=message=>{const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),2800)};
async function vybApi(path,options={}){const response=await fetch(path,{headers:{'Content-Type':'application/json'},...options});let data={};try{data=await response.json()}catch{}if(!response.ok)throw new Error(data.error||'VybPort request failed.');return data}

const agentState=window.VybAgentState;
let viewer=null,profile=null,targetHandle='',currentProfileHtml='';
let profileGarages=[],profileHoods=[];
let agentConnections=[],agentHistoryRequest=0,agentSending=false;

function requestedHandle(){return (new URLSearchParams(location.search).get('user')||'').trim().replace(/^@/,'').toLowerCase()}
function canvasUrl(){return `/profiles/${encodeURIComponent(targetHandle)}/canvas?v=${Date.now()}`}
function updateHtmlCount(){const bytes=new TextEncoder().encode($('#profileHtml').value).length,limit=profile?.limit||96*1024;$('#profileHtmlCount').textContent=`${(bytes/1024).toFixed(bytes<10240?1:0)} / ${Math.round(limit/1024)} KiB`;$('#profileHtmlCount').classList.toggle('over',bytes>limit)}
function setProfileFrame(){
 document.title=`${profile.display_name} · @${profile.handle} · VybPort`;$('#profileName').textContent=profile.display_name;$('#profileHandle').textContent=`@${profile.handle}`;$('#profileByline').textContent=`@${profile.handle}`;
 const owner=Boolean(viewer&&viewer.handle===profile.handle);
 $('#profileGarageLink').href=owner?'./garage.html':`./wander.html?builder=${encodeURIComponent(profile.handle)}`;$('#profileGarageLink').textContent=owner?'open my garage →':'find their garage →';
 const canvas=$('#profileCanvas');$('#profileCanvasLoading').classList.remove('ready');canvas.src=canvasUrl();canvas.title=`@${profile.handle}'s public VybPort page`;
 $('#profileSettingsToggle').hidden=!owner;$('#profileGaragesToggle').hidden=!owner;$('#profileNewGarage').hidden=!owner;$('#agentDockToggle').hidden=!viewer;
 $('#accountLink').textContent=viewer?viewer.display_name.slice(0,1).toUpperCase():'+';$('#accountLink').href=viewer?'./register.html':'./register.html';
 if(owner){currentProfileHtml=profile.html;$('#profileHtml').value=currentProfileHtml;$('#accountIdentity').textContent=`${viewer.display_name} · @${viewer.handle}`;updateHtmlCount()}
}

function missingProfile(message){
 targetHandle=requestedHandle()||'profile';$('#profileName').textContent='Profile unavailable';$('#profileHandle').textContent=`@${targetHandle}`;$('#profileByline').textContent=`@${targetHandle}`;
 $('#profileCanvasLoading').classList.add('ready');$('#profileCanvas').srcdoc=`<!doctype html><style>html,body{height:100%;margin:0;background:#080b0e;color:#8799a2;font:14px ui-monospace,monospace}body{display:grid;place-content:center;text-align:center}b{color:#d6e1e5}</style><p><b>@${safe(targetHandle)}</b><br>${safe(message)}</p>`
}

function garageHref(garage){return `./garage.html?n=${encodeURIComponent(garage.neighborhood)}`}
function renderProfileGarages(){
 const grid=$('#profileGarageGrid'),hoodBySlug=new Map(profileHoods.map(item=>[item.slug,item])),owned=new Set(profileGarages.map(item=>item.neighborhood)),available=profileHoods.filter(item=>!owned.has(item.slug));
 $('#profileGarageCount').textContent=String(profileGarages.length);
 const cards=profileGarages.map(garage=>{const street=hoodBySlug.get(garage.neighborhood),total=street?.slots?.length||Math.max(garage.modules?.length||0,1),mounted=garage.modules?.length||0,projects=garage.projects?.length||0;
  return `<a class="profile-garage-card" style="--hood:${garage.hue}" href="${garageHref(garage)}"><span>${safe(garage.neighborhood_name)}</span><b>${safe(garage.name)}</b><p>${safe(garage.tagline||'A private staging workshop.')}</p><div>${Array.from({length:total},(_,index)=>`<i${index<mounted?' class="on"':''}></i>`).join('')}</div><footer><small>${projects} project${projects===1?'':'s'} · ${mounted}/${total} bays</small><em>open →</em></footer></a>`}).join('');
 const open=`<a class="profile-garage-card open" href="./garage.html?new=1"><span>Another neighborhood</span><b>＋ Open a garage</b><p>${available.length?`${available.length} street${available.length===1?'':'s'} still available.`:'You already have a workshop on every street.'}</p><footer><small>Choose the street first</small><em>continue →</em></footer></a>`;
 grid.innerHTML=cards+open;
 let remembered='';try{remembered=localStorage.getItem('vybport.street')||''}catch{}
 const preferred=profileGarages.find(item=>item.neighborhood===remembered)||profileGarages[0];
 $('#profileGarageLink').href=preferred?garageHref(preferred):'./garage.html?new=1';$('#profileGarageLink').textContent=preferred?'open my garage →':'open my first garage →';
 $('#profileNewGarage').textContent=profileGarages.length?'＋ open new':'＋ open first'
}
async function loadProfileGarages(){
 try{const [garageData,hoodData]=await Promise.all([vybApi('/api/garages?mine=1'),vybApi('/api/neighborhoods')]);profileGarages=garageData.garages||[];profileHoods=hoodData.neighborhoods||[];renderProfileGarages()}
 catch(error){$('#profileGarageGrid').innerHTML=`<p class="profile-garage-empty">${safe(error.message)}</p>`}
}

async function loadProfile(){
 try{viewer=(await vybApi('/api/auth/me')).user}catch{viewer=null}
 targetHandle=requestedHandle()||viewer?.handle||'nemo';
 try{profile=(await vybApi(`/api/profiles/${encodeURIComponent(targetHandle)}/page`)).profile}
 catch(error){
  if(!requestedHandle()&&!viewer){
   try{const publicGarages=(await vybApi('/api/garages')).garages||[],fallback=publicGarages[0]?.handle;if(fallback){targetHandle=fallback;profile=(await vybApi(`/api/profiles/${encodeURIComponent(fallback)}/page`)).profile}}
   catch{}
  }
  if(!profile){missingProfile(error.message);return}
 }
 setProfileFrame();
 if(viewer){await refreshAgents();if(viewer.handle===targetHandle)await Promise.all([loadTokens(),loadProfileGarages()])}
 const params=new URLSearchParams(location.search);if(viewer&&(agentState.isOpen()||params.get('agent')==='open'))openAgentDock();if(viewer?.handle===targetHandle&&params.get('settings'))openSettings(params.get('settings'))
}

$('#profileCanvas').addEventListener('load',()=>$('#profileCanvasLoading').classList.add('ready'));
$('#shareProfile').onclick=async()=>{const link=new URL('./index.html',location.href);link.searchParams.set('user',targetHandle);try{await navigator.clipboard.writeText(link.href);toast('Profile link copied.')}catch{toast(link.href)}};
$('#profileGaragesToggle').onclick=()=>{const dialog=$('#profileGarageDialog');if(!dialog.open)dialog.showModal();$('#profileGaragesToggle').setAttribute('aria-expanded','true')};
$('#profileGarageDialog').addEventListener('close',()=>$('#profileGaragesToggle').setAttribute('aria-expanded','false'));

function openSettings(tab='page'){$('#profileSettingsDialog').showModal();selectSettingsTab(['page','agents','account'].includes(tab)?tab:'page')}
function selectSettingsTab(tab){document.querySelectorAll('[data-settings-tab]').forEach(button=>button.classList.toggle('active',button.dataset.settingsTab===tab));document.querySelectorAll('[data-settings-panel]').forEach(panel=>{const active=panel.dataset.settingsPanel===tab;panel.hidden=!active;panel.classList.toggle('active',active)});if(tab==='agents')loadTokens()}
$('#profileSettingsToggle').onclick=()=>openSettings('page');
document.querySelector('.settings-tabs').onclick=event=>{const button=event.target.closest('[data-settings-tab]');if(button)selectSettingsTab(button.dataset.settingsTab)};

function blankStarter(){return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>@${targetHandle}</title>
  <style>
    html,body { min-height:100%; margin:0; background:#0a0a0a; color:#f4f4f4; }
    body { font-family:ui-monospace,monospace; }
  </style>
</head>
<body>
  <!-- This entire canvas is yours. -->
</body>
</html>`}
$('#profileHtml').addEventListener('input',updateHtmlCount);
$('#blankProfilePage').onclick=()=>{$('#profileHtml').value=blankStarter();updateHtmlCount();$('#profileHtml').focus()};
$('#reloadProfilePage').onclick=()=>{$('#profileHtml').value=currentProfileHtml;updateHtmlCount();toast('Unpublished edits discarded.')};
$('#profilePageForm').onsubmit=async event=>{event.preventDefault();try{const result=await vybApi('/api/profile/page',{method:'POST',body:JSON.stringify({html:$('#profileHtml').value})});profile=result.profile;currentProfileHtml=profile.html;updateHtmlCount();$('#profileCanvasLoading').classList.remove('ready');$('#profileCanvas').src=canvasUrl();toast('Public page published inside its sandbox.')}catch(error){toast(error.message)}};
$('#logoutAccount').onclick=async()=>{try{await vybApi('/api/auth/logout',{method:'POST',body:'{}'});agentState.setOpen(false);location.href=`./index.html?user=${encodeURIComponent(targetHandle)}`}catch(error){toast(error.message)}};

function selectedAgentConnection(){return agentConnections.find(item=>item.key===$('#agentSelect').value)||null}
function profileAgentContext(){return {schema:'vybport.context/1',view:'profile',target:`@${targetHandle}`,summary:`Viewing @${targetHandle}'s sandboxed public profile page.`}}
function renderProfileAgentHistory(messages=[]){
 if(!messages.length){$('#agentMessages').innerHTML='<div class="agent-message system">This agent identity has a private MCP inbox. Messages stay queued until your coding-agent session checks in.</div>';return}
 $('#agentMessages').innerHTML=messages.map(message=>`<div class="agent-message ${message.role==='user'?'user':'system'}">${safe(message.body)}</div>`).join('')
}
async function loadProfileAgentHistory({scroll=false}={}){const selected=selectedAgentConnection();if(!selected){renderProfileAgentHistory();return}const request=++agentHistoryRequest;try{const data=await vybApi(`/api/agent-profiles/${selected.id}/messages`);if(request!==agentHistoryRequest||selected.key!==$('#agentSelect').value)return;renderProfileAgentHistory(data.messages||[]);if(scroll)requestAnimationFrame(()=>{$('#agentMessages').scrollTop=$('#agentMessages').scrollHeight})}catch(error){renderProfileAgentHistory([{role:'system',body:error.message}])}}
async function refreshAgents(){
 try{const data=await vybApi('/api/agent-profiles');const profiles=(data.agent_profiles||[]).filter(item=>item.credential_status==='active'&&(item.scopes||[]).includes('session')).map(item=>({key:agentState.key('mcp',item.id),kind:'mcp',id:item.id,label:item.agent_name||item.label,detail:item.live?'online via MCP':'MCP inbox',live:Boolean(item.live)}));agentConnections=profiles;const selected=agentState.choose(agentConnections,'mcp');$('#agentSelect').innerHTML=profiles.length?profiles.map(item=>`<option value="${item.key}">${safe(item.label)} · ${safe(item.detail)}</option>`).join(''):'<option value="">No session-enabled agent yet</option>';$('#agentSelect').value=selected?.key||'';if(selected)agentState.select(selected.key);renderAgentConnection();await loadProfileAgentHistory();return profiles}
 catch{agentConnections=[];renderAgentConnection();renderProfileAgentHistory();return[]}
}
function renderAgentConnection(){const selected=selectedAgentConnection();$('#agentConnection').innerHTML=selected?`<i style="background:${selected.live?'#58b777':'#d0a14f'}"></i> ${safe(selected.label)} · ${safe(selected.detail)}`:'<i></i> no agent connected'}
async function openAgentDock(){
 if(!viewer){location.href='./register.html';return}
 if(!agentConnections.length){openSettings('agents');toast('Create a session-enabled MCP identity first.');return}
 $('#agentDock').classList.remove('hidden');agentState.setOpen(true);$('#agentContext').innerHTML=`<span class="eyebrow">Current context</span><b>@${safe(targetHandle)} · public profile canvas</b><p>This goes to your own selected agent identity.</p>`;await loadProfileAgentHistory({scroll:true})
}
$('#agentDockToggle').onclick=openAgentDock;$('#closeAgentDock').onclick=()=>{$('#agentDock').classList.add('hidden');agentState.setOpen(false)};
$('#agentSelect').onchange=async event=>{agentState.select(event.target.value);renderAgentConnection();await loadProfileAgentHistory({scroll:true})};
$('#agentForm').onsubmit=async event=>{event.preventDefault();if(agentSending)return;const selected=selectedAgentConnection(),input=$('#agentInput'),body=input.value.trim();if(!body)return;if(!selected){toast('Choose or create an agent identity first.');return}agentSending=true;try{await vybApi(`/api/agent-profiles/${selected.id}/send`,{method:'POST',body:JSON.stringify({kind:'task',body,context:profileAgentContext()})});input.value='';await loadProfileAgentHistory({scroll:true});toast(selected.live?'Sent to your agent inbox.':'Queued until your agent checks in.')}catch(error){toast(error.message)}finally{agentSending=false}};

const agentDate=stamp=>stamp?new Date(stamp*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'never';
function showAgentCredential(result){const issued=$('#mcpIssued'),endpoint=`${location.origin}${result.endpoint}`;issued.hidden=false;issued.innerHTML=`<b>Copy this API key now — VybPort stores only its hash.</b><code>${safe(result.token)}</code><small><b>${safe(result.agent_profile.identity)}</b> · expires ${safe(agentDate(result.agent_profile.expires_at))}<br>Endpoint: <b>${safe(endpoint)}</b><br>Header: <b>Authorization: Bearer &lt;this key&gt;</b><br>Put it in the agent's MCP config or secret store, never a chat prompt.</small><span class="mcp-issued-actions"><button type="button" data-copy-key>Copy key</button><button type="button" data-clear-key>Clear from screen</button></span>`}
async function loadTokens(){
 if(!viewer||viewer.handle!==targetHandle)return;const list=$('#mcpList');
 try{const data=await vybApi('/api/agent-profiles');if(!$('#mcpScopes').children.length)$('#mcpScopes').innerHTML=data.scopes.map(scope=>`<label title="${scope==='appearance'?'May replace only the sandboxed public HTML page.':scope==='host'?'Extra consent for host writes and commands.':''}"><input type="checkbox" value="${safe(scope)}"${['profile','street','session','appearance'].includes(scope)?' checked':''}> ${safe(scope==='host'?'host access':scope)}</label>`).join('');list.innerHTML=(data.agent_profiles||[]).map(agent=>{const state=agent.credential_status==='revoked'?'revoked':agent.credential_status==='expired'?'key expired':agent.live?'live':agent.registered_at?'idle':'not connected yet';return `<div class="mcp-row${agent.credential_status==='revoked'?' revoked':''}${agent.live?' live':''}"><div><b>${safe(agent.name)} <small>${safe(agent.identity)}</small></b><span>${safe(state)}${agent.agent_kind?` · ${safe(agent.agent_kind)}`:''}</span><span>${safe(agent.scopes.join(' · '))} · key …${safe(agent.token_hint||'legacy')} · expires ${safe(agentDate(agent.expires_at))}</span>${agent.ssh?`<span class="mcp-cwd">SSH ${safe(agent.ssh.fingerprint)}</span>`:''}</div><span class="mcp-acts">${agent.credential_status==='active'&&agent.scopes.includes('session')?`<button type="button" data-send="${agent.id}">chat</button>`:''}<button type="button" data-visibility="${agent.id}" data-public="${agent.public?'1':'0'}">${agent.public?'make private':'make public'}</button>${agent.credential_status!=='revoked'?`<button type="button" data-rotate="${agent.id}">rotate key</button><button type="button" data-revoke="${agent.id}">revoke</button>`:''}</span></div>`}).join('')||'<p class="mcp-note">No agent identities yet.</p>'}
 catch{list.innerHTML='<p class="mcp-note">Sign in to manage agent identities.</p>'}
}
$('#mcpMint').onsubmit=async event=>{event.preventDefault();const scopes=[...document.querySelectorAll('#mcpScopes input:checked')].map(input=>input.value);try{const result=await vybApi('/api/agent-profiles',{method:'POST',body:JSON.stringify({label:$('#mcpLabel').value.trim(),slug:$('#mcpSlug').value.trim(),bio:$('#mcpBio').value.trim(),ssh_public_key:$('#mcpSshKey').value.trim(),lifetime_days:Number($('#mcpLifetime').value),public:$('#mcpPublic').checked,scopes})});showAgentCredential(result);event.target.reset();await Promise.all([loadTokens(),refreshAgents()]);toast('Agent identity created. Copy its key now.')}catch(error){toast(error.message)}};
$('#mcpList').onclick=async event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.send){agentState.select(agentState.key('mcp',button.dataset.send));await refreshAgents();$('#profileSettingsDialog').close();openAgentDock();return}if(button.dataset.rotate){if(!confirm("Rotate this agent's API key? The old key will stop working immediately."))return;try{const result=await vybApi(`/api/agent-profiles/${button.dataset.rotate}/rotate`,{method:'POST',body:'{}'});showAgentCredential(result);await Promise.all([loadTokens(),refreshAgents()]);toast('Agent API key rotated.')}catch(error){toast(error.message)}return}if(button.dataset.visibility){try{await vybApi(`/api/agent-profiles/${button.dataset.visibility}/update`,{method:'POST',body:JSON.stringify({public:button.dataset.public!=='1'})});await loadTokens();toast(button.dataset.public==='1'?'Agent identity is private.':'Agent identity is public.')}catch(error){toast(error.message)}return}if(button.dataset.revoke){if(!confirm("Revoke this agent's API access? Its attributed history will remain."))return;try{await vybApi(`/api/agent-profiles/${button.dataset.revoke}/revoke`,{method:'POST',body:'{}'});await Promise.all([loadTokens(),refreshAgents()]);toast('Agent API access revoked.')}catch(error){toast(error.message)}}};
$('#mcpIssued').onclick=async event=>{if(event.target.closest('[data-clear-key]')){event.currentTarget.hidden=true;event.currentTarget.replaceChildren();return}if(!event.target.closest('[data-copy-key]'))return;const key=event.currentTarget.querySelector('code')?.textContent||'';try{await navigator.clipboard.writeText(key);toast('Agent API key copied.')}catch{toast('Copy was blocked; select the key manually.')}};

setInterval(()=>{if(viewer&&!$('#agentDock').classList.contains('hidden'))loadProfileAgentHistory()},5000);
loadProfile().catch(error=>missingProfile(error.message));

/* Friends. Requests are directional until answered, so incoming asks are shown apart from the list. */
async function loadFriends() {
  const list = document.querySelector("#friendsList");
  if (!list) return;
  let data;
  try { data = await vybApi("/api/friends"); } catch { return; }
  const person = (row, extra = "") =>
    `<div class="friend-row"><div class="avatar tiny">${safe(row.display_name[0].toUpperCase())}</div>
     <div><b>${safe(row.display_name)}</b><span>@${safe(row.handle)}</span></div>${extra}</div>`;
  document.querySelector("#friendsCount").textContent = data.friends.length;
  document.querySelector("#friendRequests").innerHTML = [
    ...data.incoming.map((row) => person(row,
      `<div class="friend-actions"><button class="button solid" data-accept="${safe(row.handle)}">Accept</button>
       <button class="text-button" data-decline="${safe(row.handle)}">Decline</button></div>`)),
    ...data.outgoing.map((row) => person(row, `<span class="friend-pending">asked</span>`)),
  ].join("");
  list.innerHTML = data.friends.length
    ? data.friends.map((row) => person(row, `<button class="text-button" data-unfriend="${safe(row.handle)}">remove</button>`)).join("")
    : `<p class="stage-note">Nobody yet. Open a garage out on the street and ask.</p>`;
}
document.querySelector("#friendRequests")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  const accept = button?.dataset.accept, decline = button?.dataset.decline;
  if (!accept && !decline) return;
  try {
    await vybApi("/api/friends/respond", { method:"POST", body:JSON.stringify({ handle: accept || decline, accept: Boolean(accept) }) });
    toast(accept ? `You and @${accept} are friends.` : `Declined @${decline}.`);
    loadFriends();
  } catch (error) { toast(error.message); }
});
document.querySelector("#friendsList")?.addEventListener("click", async (event) => {
  const handle = event.target.closest("button")?.dataset.unfriend;
  if (!handle) return;
  try { await vybApi("/api/friends/remove", { method:"POST", body:JSON.stringify({ handle }) }); toast(`Removed @${handle}.`); loadFriends(); }
  catch (error) { toast(error.message); }
});

/* Taking VybPort to the phone. The QR carries a single-use pairing code so the phone does not have
   to be typed into; the written link deliberately does not, because a link that signs anyone in is
   not something to leave sitting in an inbox. */
let pairTimer = 0;
async function loadPairing() {
  const url = document.querySelector("#pairUrl");
  if (!url) return;
  let data;
  try { data = await vybApi("/api/pair"); } catch { return; }
  if (!(data.addresses || []).length) { url.textContent = "No network address found on this machine."; return; }
  url.textContent = data.url;
  document.querySelector("#pairMail").href =
    `mailto:?subject=${encodeURIComponent("VybPort on my phone")}&body=${encodeURIComponent(data.url + "\n\nSame network as the workstation, then sign in.")}`;
  document.querySelector("#pairNote").textContent = data.reachable
    ? "Your phone has to be on the same network as this machine."
    : "This server is listening on loopback only, so nothing off this machine can reach that address yet. Restart it with VYBPORT_HOST=0.0.0.0 to put it on your network.";
}
async function mintPairingCode() {
  const holder = document.querySelector("#pairQr");
  holder.innerHTML = `<p class="pair-wait">Minting…</p>`;
  try {
    const data = await vybApi("/api/pair", { method:"POST", body:JSON.stringify({}) });
    let left = data.expires_in;
    holder.innerHTML = `${data.svg}<span class="pair-clock" id="pairClock"></span>`;
    clearInterval(pairTimer);
    pairTimer = setInterval(() => {
      const clock = document.querySelector("#pairClock");
      if (!clock) { clearInterval(pairTimer); return; }
      if (left <= 0) {
        clearInterval(pairTimer);
        holder.innerHTML = `<button class="button ghost" id="pairAgain" type="button">Code expired — make another</button>`;
        return;
      }
      clock.textContent = `expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      left -= 1;
    }, 1000);
  } catch (error) { holder.innerHTML = `<p class="pair-wait">${safe(error.message)}</p>`; }
}
document.querySelector("#pairQr")?.addEventListener("click", (event) => {
  if (event.target.closest("#pairShow, #pairAgain")) mintPairingCode();
});
document.querySelector("#pairCopy")?.addEventListener("click", async () => {
  const text = document.querySelector("#pairUrl").textContent;
  try { await navigator.clipboard.writeText(text); toast("Link copied."); }
  catch { toast(text); }
});
loadFriends();
loadPairing();
