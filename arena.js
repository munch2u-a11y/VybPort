/* Arena: the owners publish the benchmark, everyone else gets one ticket a day to spend on it. */
let state={},preflightPass=false,clockTimer;
const $=s=>document.querySelector(s);
const safe=v=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const toast=text=>{const el=$('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2600)};
async function api(path,options={}){const response=await fetch(path,{headers:{'Content-Type':'application/json'},...options});const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');return data}
const clean=value=>Number(value).toLocaleString(undefined,{maximumFractionDigits:2});
const ago=seconds=>{const days=Math.floor((Date.now()/1000-seconds)/86400);return days>1?`${days} days ago`:days===1?'yesterday':'today'};

/* Tickets refill at 00:00 UTC, so the countdown is the same clock for everyone on the board. */
function startClock(resetsAt){clearInterval(clockTimer);const tick=()=>{
 const left=Math.max(0,resetsAt-Math.floor(Date.now()/1000));
 $('#ticketClock').textContent=[Math.floor(left/3600),Math.floor(left/60)%60,left%60].map(part=>String(part).padStart(2,'0')).join(':');
 if(!left){clearInterval(clockTimer);load()}};tick();clockTimer=setInterval(tick,1000)}

function renderPodium(){const previous=state.previous;const section=$('#podium');
 if(!previous||!previous.podium.length){section.hidden=true;return}
 section.hidden=false;
 section.innerHTML=`<div class="podium-head"><b>Holding the floor</b><span>top 3 · ${safe(previous.benchmark.title)}</span></div>
  <div class="podium-row">${previous.podium.map(entry=>`
   <a class="podium-slot" data-place="${entry.place}" href="./index.html?user=${encodeURIComponent(entry.handle)}">
    <span class="podium-place">${entry.place===1?'① champion':entry.place===2?'② runner-up':'③ third'}</span>
    <b>${safe(entry.display_name)}</b>
    <small>@${safe(entry.handle)} · ${safe(entry.system_name)}</small>
    <span class="podium-score">${clean(entry.score)}<span> ${safe(previous.benchmark.metric)}</span></span>
   </a>`).join('')}</div>`}

function renderHero(){const benchmark=state.benchmark;
 if(!benchmark){$('#heroPeriod').textContent='no benchmark open';$('#heroTitle').textContent='The floor is between periods';
  $('#heroSummary').textContent=`No benchmark is open on ${state.neighborhood?state.neighborhood.name:'this street'} yet. Each neighborhood runs its own, and each gives you a ticket a day.`;
  $('#heroRules').innerHTML='';$('#entryCard').hidden=true;return}
 $('#entryCard').hidden=false;
 $('#heroPeriod').textContent=`${benchmark.cadence} period · opened ${ago(benchmark.opened_at)}`;
 $('#heroTitle').textContent=benchmark.title;
 $('#heroSummary').textContent=benchmark.summary||'No summary was published for this period.';
 $('#heroRules').innerHTML=[`<span>${safe(benchmark.metric)} · 0–${clean(benchmark.score_max)}</span>`,
  `<span>${safe(benchmark.adaptor)}</span>`,'<span>held-out fixture</span>',
  ...benchmark.capabilities.map(item=>`<span class="cap">${safe(item)}</span>`)].join('');
 $('#adaptorName').textContent=state.adaptor;
 $('#capabilityList').innerHTML=benchmark.capabilities.length
  ?benchmark.capabilities.map(item=>`<label><input type="checkbox" value="${safe(item)}"> ${safe(item)}</label>`).join('')
  :'<span class="stage-note">This benchmark requires no declared capabilities.</span>'}

function renderTicket(){const ticket=state.ticket,box=$('#ticket');
 startClock(state.resets_at);
 if(!ticket){box.classList.remove('spent');$('#ticketState').textContent='Sign in to collect';
  $('#ticketNote').innerHTML='Every account gets <b>one ticket a day</b>, reset at 00:00 UTC. <a href="./register.html">Create a local account →</a>';return}
 if(ticket.available){box.classList.remove('spent');$('#ticketState').textContent='1 ticket ready';
  $('#ticketNote').textContent='Preflight as many times as you like. The ticket is only spent once every check passes.';return}
 box.classList.add('spent');$('#ticketState').textContent='Spent for today';
 const entry=ticket.entry;
 $('#ticketNote').textContent=entry
  ?(entry.status==='scored'?`${entry.system_name} scored ${clean(entry.score)} on today's run.`:`${entry.system_name} passed preflight but the held-out run failed.`)
  :'Today’s ticket is used.'}

function renderBoard(){const board=state.board||[],list=$('#board'),metric=state.benchmark?state.benchmark.metric:'score';
 $('#boardCount').textContent=board.length?`${board.length} of 100 places taken`:'';
 list.innerHTML=board.length?board.map(entry=>`<li data-place="${entry.place}">
   <span class="place">${entry.place}</span>
   <span class="who"><b>${safe(entry.display_name)}</b><a href="./index.html?user=${encodeURIComponent(entry.handle)}">@${safe(entry.handle)}</a></span>
   <span class="system">${safe(entry.system_name)}</span>
   <span class="score">${clean(entry.score)}<small>${safe(metric)} · ${entry.attempts} run${entry.attempts===1?'':'s'}</small></span>
  </li>`).join(''):'<p class="board-empty">No scored entries yet this period. The first clean run takes the top of the board.</p>'}

function renderChecks(checks){$('#checkList').innerHTML=(checks||[]).map(check=>`<li class="${check.ok?'ok':'bad'}">
  <i>${check.ok?'✓':'✕'}</i><span><b>${safe(check.label)}</b><small>${safe(check.note)}</small></span></li>`).join('')}
function say(message,good){const box=$('#entryResult');box.textContent=message||'';box.className=`entry-result ${good?'good':'bad'}`}

function entryPayload(){return{system:$('#entrySystem').value.trim(),command:$('#entryCommand').value.trim(),
 capabilities:[...document.querySelectorAll('#capabilityList input:checked')].map(input=>input.value)}}

let hoodSlug=VybHood.current();
async function load(){
 const active=await VybHood.mountSwitcher($('#hoodSwitcher'),{slug:hoodSlug,onChange:slug=>{location.search=`?n=${encodeURIComponent(slug)}`}});
 if(active)hoodSlug=active.slug;
 try{state=await api(`/api/arena?neighborhood=${encodeURIComponent(hoodSlug)}`)}catch(error){toast(error.message);return}
 renderPodium();renderHero();renderTicket();renderBoard();
 $('#ownerConsole').hidden=!(state.you&&state.you.owner);
 if(state.benchmark){$('#talkTitle').textContent=`Notes on ${state.benchmark.title}`;refreshSocial()}
 $('#spendTicket').disabled=!preflightPass||!(state.ticket&&state.ticket.available)}

$('#entryForm').onsubmit=async event=>{event.preventDefault();
 const button=$('#runPreflight');button.disabled=true;button.textContent='Running the sample fixture…';
 try{const result=await api('/api/arena/preflight',{method:'POST',body:JSON.stringify({...entryPayload(),neighborhood:hoodSlug})});
  renderChecks(result.checks);preflightPass=result.eligible;
  $('#spendTicket').disabled=!result.eligible||!(state.ticket&&state.ticket.available);
  const holdsTicket=state.ticket&&state.ticket.available;
  say(result.eligible
   ?(holdsTicket?'Preflight clean. Your ticket is still unspent — spend it when you are ready for the held-out fixture.'
    :'Preflight clean. Today’s ticket is already spent, so this was a free rehearsal — come back after the reset.')
   :'Preflight failed. Nothing was charged. Fix the entry and run it again.',result.eligible)}
 catch(error){say(error.message,false);preflightPass=false;$('#spendTicket').disabled=true}
 finally{button.disabled=false;button.textContent='Run preflight · free'}};

$('#spendTicket').onclick=async()=>{
 if(!window.confirm('This spends today’s ticket and runs your entry against the held-out fixture. Continue?'))return;
 const button=$('#spendTicket');button.disabled=true;button.textContent='Running the held-out fixture…';
 try{const result=await api('/api/arena/attempt',{method:'POST',body:JSON.stringify({...entryPayload(),neighborhood:hoodSlug})});
  renderChecks(result.checks);
  if(!result.spent){preflightPass=false;say(result.message,false)}
  else say(result.status==='scored'?`${result.message} You are ${result.place===1?'top of the board':`in place ${result.place}`}.`:result.message,result.status==='scored');
  await load()}
 catch(error){say(error.message,false);await load()}
 finally{button.textContent='Spend ticket & score →'}};

$('#toggleAdaptor').onclick=()=>{const body=$('#adaptorBody');body.hidden=!body.hidden;
 $('#toggleAdaptor').textContent=body.hidden?'How entries are scored':'Hide the contract'};

/* Owner console */
$('#benchmarkForm').onsubmit=async event=>{event.preventDefault();
 if(!window.confirm('Publishing closes the open period, awards its top three, and starts a new board. Continue?'))return;
 try{await api('/api/arena/benchmark',{method:'POST',body:JSON.stringify({
   slug:$('#bmSlug').value.trim(),title:$('#bmTitle').value.trim(),summary:$('#bmSummary').value.trim(),
   metric:$('#bmMetric').value.trim()||'score',score_max:Number($('#bmMax').value),cadence:$('#bmCadence').value,
   neighborhood:hoodSlug,capabilities:$('#bmCapabilities').value.split(',').map(item=>item.trim()).filter(Boolean),
   sample_fixture:$('#bmSample').value,scored_fixture:$('#bmScored').value})});
  $('#bmSlug').value='';$('#bmTitle').value='';preflightPass=false;renderChecks([]);say('',true);
  await load();toast('New period open. The old top three keep the floor.')}
 catch(error){toast(error.message)}};
$('#closePeriod').onclick=async()=>{
 if(!window.confirm('Close the current period? Its top three get the ribbon and the board freezes.'))return;
 try{const result=await api('/api/arena/benchmark/close',{method:'POST',body:JSON.stringify({neighborhood:hoodSlug})});
  await load();toast(`Closed ${result.closed} · ${result.podium.length} on the podium.`)}
 catch(error){toast(error.message)}};

/* Floor talk stays attached to whichever period is open. */
function talkTarget(){return state.benchmark?`arena:${state.benchmark.slug}`:`arena:${hoodSlug}`}
function renderSocial(data){$('#likeRun').innerHTML=`⚡ <span>${data.likes}</span> bolts`;
 $('#likeRun').classList.toggle('liked',data.liked);
 $('#arenaComments').innerHTML=data.comments.map(note=>`<article class="comment"><div class="avatar">${safe(note.display_name[0].toUpperCase())}</div><div><b>${safe(note.display_name)}</b><time>local note</time></div><p>${safe(note.body)}</p></article>`).join('')||'<p class="stage-note">No public notes yet. Be the first to leave a useful observation.</p>'}
async function refreshSocial(){try{renderSocial(await api(`/api/social?target=${talkTarget()}`))}catch(error){toast(error.message)}}
$('#likeRun').onclick=async()=>{try{renderSocial(await api('/api/social/like',{method:'POST',body:JSON.stringify({target:talkTarget()})}))}catch(error){toast(error.message)}};
$('#arenaCommentForm').onsubmit=async event=>{event.preventDefault();const input=$('#arenaComment');
 try{renderSocial(await api('/api/social/comment',{method:'POST',body:JSON.stringify({target:talkTarget(),body:input.value})}));input.value='';toast('Note added to the floor.')}
 catch(error){toast(error.message)}};

load();
