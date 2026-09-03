/* Wander: a walk down one long row of garages. Nearest doors belong to people building what you build. */
const garages=[
 {id:'project:habitus',hood:'memory-systems',user:'nemo',mark:'HA',owner:'Nemo',handle:'@nemo',kind:'memory garage',hue:172,rig:'ring',display:'Developmental nursery',displayCopy:'Receipt-grounded embodied-agent curriculum.',post:'Route-safe reconstruction is now cleanly separated from the nursery. I am checking what changes when the evidence route becomes real runtime behavior, not only a graph property.',tags:['graph','receipts','episodic'],when:'12m',age:.2,repo:'nemo/habitus'},
 {id:'garage:patchbay',hood:'agent-systems',user:'rowanbuilds',mark:'PB',owner:'Rowan',handle:'@rowanbuilds',kind:'patchbay',hue:210,img:'./images/display-arm.jpg',display:'Disagreement trace finder',displayCopy:'Three coding agents, one acceptance contract.',post:'The valuable thing was not the successful patch. It was the disagreement trace that stopped us from merging a plausible regression.',tags:['coding-agents','traces','multi-agent'],when:'36m',age:.6,repo:'rowanbuilds/patchbay'},
 {id:'garage:orchid',hood:'memory-systems',user:'orchid',mark:'OS',owner:'Orchid Systems',handle:'@orchid',kind:'memory garage',hue:128,rig:'tower',display:'Benchmark drift ledger',displayCopy:'Versions, corpus shifts, and strict evidence recall.',post:'Looking for a compact run-manifest convention before we wire our next benchmark connector. How are you preserving a fair comparison across agent versions?',tags:['vector','semantic','long-context'],when:'4h',age:4,repo:'orchid/drift-ledger'},
 {id:'project:helix',hood:'memory-systems',user:'nemo',mark:'HΞ',owner:'Helix',handle:'@nemo',kind:'cognitive memory',hue:275,img:'./images/display-figure.jpg',display:'Inspectable cognitive memory',displayCopy:'Human-readable evidence routes and memory views.',post:'The current work is about making a local system easier to inspect while it acts — not pretending a pretty graph proves an ability.',tags:['graph','receipts','local-first'],when:'12h',age:12,repo:'nemo/helix'},
 {id:'garage:ink-input',hood:'agent-systems',user:'inkinput',mark:'II',owner:'Ink & Input',handle:'@inkinput',kind:'journal garage',hue:40,rig:'lattice',display:'Agent journal kit',displayCopy:'Private thought and narrated action, kept apart.',post:'Sharing the little boundary that has helped our long-running sessions stay readable: thought stays private, outside actions earn receipts.',tags:['traces','tool-use','local-models'],when:'yesterday',age:29,repo:'inkinput/journal-kit'},
 {id:'project:mrag',hood:'memory-systems',user:'nemo',mark:'mR',owner:'mRAG',handle:'@nemo',kind:'retrieval garage',hue:22,rig:'ring',display:'Fairer retrieval arena',displayCopy:'Local-first comparison with provenance and traces.',post:'A retrieval score alone still does not tell you whether a system found the right evidence. Posting the failure cases beside the run changes the conversation.',tags:['vector','semantic','receipts'],when:'2d',age:57,repo:'nemo/mrag'},
 {id:'garage:sable',hood:'agent-systems',user:'sablelab',mark:'SL',owner:'Sable Lab',handle:'@sablelab',kind:'local models',hue:322,img:'./images/display-rig.jpg',display:'Trace-light model bench',displayCopy:'Small models, visible tool paths, clean failures.',post:'We cut the dashboard down to the receipts that changed a decision. The smaller surface made it much easier to see when a run was merely eloquent.',tags:['local-models','evals','traces'],when:'4d',age:104,repo:'sablelab/trace-light'},
 {id:'garage:ava',hood:'memory-systems',user:'avaorchard',mark:'AO',owner:"Ava's Orchard",handle:'@avaorchard',kind:'semantic garden',hue:96,rig:'lattice',display:'Memory neighborhood map',displayCopy:'Associative paths with a bounded retrieval foreground.',post:'Testing whether proximity can introduce useful collaborators without turning the neighborhood into an engagement machine.',tags:['graph','semantic','episodic'],when:'6d',age:155,repo:'avaorchard/neighborhood'},
 {id:'garage:nightmarket',hood:'game-systems',user:'foxglove',mark:'NM',owner:'Foxglove',handle:'@foxglove',kind:'quest design',hue:22,rig:'lattice',display:'Favour-debt quest graph',displayCopy:'Every quest is a debt someone can call in.',post:'Rebuilt the quest graph so obligations persist between acts. The interesting failure was quests that resolved themselves off-screen.',tags:['quests','dialogue','procgen'],when:'2h',age:2,repo:'foxglove/nightmarket'},
 {id:'garage:tinhall',hood:'game-systems',user:'tinhall',mark:'TH',owner:'Tin Hall',handle:'@tinhall',kind:'combat feel',hue:355,rig:'ring',display:'Hitstop tuning bench',displayCopy:'Frame-level feedback you can A/B in place.',post:'Combat feel turned out to be mostly hitstop and camera. Shipping the tuning bench so other people can argue with my numbers.',tags:['combat','netcode','inventory'],when:'8h',age:8,repo:'tinhall/feel-bench'},
 {id:'garage:porchlight',hood:'social-apps',user:'porchlight',mark:'PL',owner:'Porchlight',handle:'@porchlight',kind:'small web',hue:205,rig:'tower',display:'Room-sized moderation',displayCopy:'Tools that assume a room, not a planet.',post:'Moderation for fifty people is a different problem than moderation for fifty million. Publishing the smaller set of tools.',tags:['moderation','small-web','privacy'],when:'yesterday',age:26,repo:'porchlight/rooms'},
 {id:'garage:quiet-works',hood:'memory-systems',user:'quietworks',mark:'QW',owner:'Quiet Works',handle:'@quietworks',kind:'slow garage',hue:196,rig:'tower',display:'Archive restoration kit',displayCopy:'Durable records for long-running local projects.',post:'Repaired an old working set and left the original history intact. The most useful part was being able to replay what actually happened.',tags:['local-first','episodic','receipts'],when:'9d',age:238,repo:'quietworks/restoration'}
];
/* Which street you are standing on, and what you are building on it. Overlap with your own tags
   decides how far down that street another builder stands. */
let hood=null,myFocus=['memory','agents','local'],liveGarages=[],myGarage=null;
const steps=[
 {label:'next door',blurb:'your exact stack'},
 {label:'same block',blurb:'two shared interests'},
 {label:'two blocks over',blurb:'one shared interest'},
 {label:'across the district',blurb:'different stack, open door'}
];
const TRAY='vybport.street.tray';
let filter='all',radius='near',query='',badges=new Map(),pinned=null,lowBlock=0,highBlock=1,loading=false,edgeObserver,slotFrame,slotNodes=[],centreNode=null,wheelSettleTimer=0;
let tab='all',favorites=new Set(),friends=new Set(),asked=new Set(),favoriteGarages=[];
const $=s=>document.querySelector(s);
const safe=v=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const directBuilder=(new URLSearchParams(location.search).get('builder')||'').trim().replace(/^@/,'').toLowerCase();
const toast=t=>{const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2400)};
async function api(path,options={}){const response=await fetch(path,{headers:{'Content-Type':'application/json'},...options});const data=await response.json();if(!response.ok)throw new Error(data.error||'VybPort request failed');return data}
const agentState=window.VybAgentState;
let agentConnections=[],agentHistoryRequest=0,agentSending=false;

/* Proximity: shared build interests pull a garage closer to where you are standing. */
function shared(item){return item.tags.filter(tag=>myFocus.includes(tag))}
function step(item){const count=shared(item).length;return count>=3?0:count===2?1:count===1?2:3}
function withinRadius(item){const distance=step(item);return radius==='district'||(radius==='near'?distance<=2:distance<=1)}
function pool(){const local=hood?garages.filter(item=>item.hood===hood.slug):garages;return [...liveGarages,...local]}
/* Favorites and friends are not a property of the street you happen to be standing on, so those two
   tabs walk every street at once; only "all doors" is bounded by this neighborhood. */
function tabPool(){
 if(tab==='all')return pool();
 const seen=new Map();
 for(const item of [...liveGarages,...favoriteGarages,...garages])if(!seen.has(item.id))seen.set(item.id,item);
 return [...seen.values()]}
function activeGarages(){const needle=query.trim().toLowerCase(),searching=needle.length>0;
 /* Walking distance decides what is on the street; a garage you chose yourself is always in reach. */
 const kept=tabPool().filter(item=>tab==='favorites'?favorites.has(item.id)
  :tab==='friends'?(item.live&&friends.has(item.user))
  :(searching||withinRadius(item)));
 return kept.filter(item=>(filter==='all'||item.tags.includes(filter))&&`${item.owner} ${item.handle} ${item.kind} ${item.display} ${item.post} ${item.tags.join(' ')}`.toLowerCase().includes(needle))
  .sort((a,b)=>step(a)-step(b)||a.age-b.age)}
function orderForBlock(block){const items=activeGarages();if(!items.length)return[];const shift=((block%items.length)+items.length)%items.length;return[...items.slice(shift),...items.slice(0,shift)]}

/* Markup */
function ribbon(item){const badge=badges.get(item.id);return badge?`<span class="post-ribbon">${badge.placement===1?'1st':badge.placement===2?'2nd':'3rd'} · ${safe(badge.leaderboard)}</span>`:''}
function displayMarkup(item){const tip=safe(`${item.display} — ${item.displayCopy||item.kind}`);
 return item.img
 ?`<div class="bay-display photo" data-tip="${tip}"><img class="display-photo" src="${item.img}" alt="${safe(item.display)} on display" loading="lazy"></div>`
 :`<div class="bay-display" data-rig="${item.rig}" data-tip="${tip}"><span class="display-mark">${safe(item.mark)}</span></div>`}
/* Mounted modules read as a row of labelled units along the bay floor: the shape of the build is
   visible at a glance, and the name of any one of them follows the pointer. */
function moduleStrip(item){const modules=(item.modules||[]).slice(0,7);if(!modules.length)return '';
 return `<div class="bay-modules">${modules.map(module=>
  `<i data-tip="${safe(`${module.name||module.slot} · ${module.slot}${module.lang?' · '+module.lang:''}`)}" data-status="${safe(module.status||'')}"></i>`).join('')}</div>`}
function savedSlots(item){const saved=item.live&&myGarage?.bench?.find(project=>project.origin_project===item.projectId);return saved?(saved.modules||[]).map(module=>module.slot):[]}
function unitMarkup(item,block,number){const distance=step(item),overlap=shared(item),saved=savedSlots(item),cloned=item.live?saved.length>0:tray().includes(item.id);
 return `<article class="garage-unit" data-id="${item.id}" data-block="${block}" style="--hue:${item.hue}">
 <div class="unit-body">
  <a class="unit-enter" href="./index.html?user=${encodeURIComponent(item.user)}" aria-label="Enter ${safe(item.owner)}'s garage">
   <div class="unit-facade">
    <span class="unit-number">No. ${String(number).padStart(2,'0')}</span>
    <span class="unit-sign">${safe(item.owner)}</span>
    <div class="unit-bay">
     <i class="bay-shutter"></i>
     <div class="bay-room"><i class="bay-lamp"></i><i class="bay-glow"></i>${displayMarkup(item)}<i class="bay-plinth"></i>${moduleStrip(item)}</div>
     <i class="bay-lip"></i><i class="bay-glass"></i>
    </div>
    <span class="unit-enter-hint">Enter garage →</span>
   </div>
   <div class="unit-plate"><b>On display · ${safe(item.display)}</b><span>${safe(item.handle)} · ${safe(item.kind)} · door open ${safe(item.when)}</span></div>
  </a>
  <span class="unit-prox" data-step="${distance}"><b>${safe(steps[distance].label)}</b> · ${overlap.length?'shares '+safe(overlap.join(', ')):'no shared tags yet'}</span>
  <i class="unit-spill"></i><i class="unit-fog"></i>
 </div>
 <div class="unit-post">
  <p class="post-copy">${safe(item.post)}</p>
  <footer class="post-actions">
   <div>
    <button data-like="${item.id}" class="bolt">⚡ bolt</button>
    <button data-comment="${item.id}">◌ note</button>
    <button data-activity="${item.id}" class="activity-toggle">▤ recent</button>
    <button data-favorite="${item.id}" class="favorite${favorites.has(item.id)?' done':''}">${favorites.has(item.id)?'★ favorited':'☆ favorite'}</button>
    ${item.live?`<button data-friend="${item.id}" class="friend${friends.has(item.user)?' done':''}"${friends.has(item.user)||asked.has(item.user)?' disabled':''}>${friends.has(item.user)?'◈ friends':asked.has(item.user)?'◇ asked':'＋ friend'}</button>`:''}
    <button data-clone="${item.id}" class="clone${cloned?' done':''}">${item.live?(cloned?`✓ ${saved.length} in locker`:'⑂ save modules'):(cloned?'✓ saved':'⑂ save '+safe(item.repo))}</button>
    <button data-pin="${item.id}">✦ hand to agent</button>
   </div>${ribbon(item)}
  </footer>
  <div class="post-open">
   <a href="./index.html?user=${encodeURIComponent(item.user)}">Enter ${safe(item.owner)}'s garage →</a>
   <span class="quiet">${safe(item.handle)}</span>
  </div>
 </div></article>`}
/* Walking distance used to hang over the row on its own sign. Sideways there is no room for one,
   so each garage wears its own on the plate under the door. */
function blockMarkup(block){const items=orderForBlock(block),size=activeGarages().length;
 return items.map((item,index)=>unitMarkup(item,block,block*size+index+1)).join('')}

/* You walk the row sideways. One garage is in the slot in front of you, two fall back on either
   side, and the rest keep going past the edges of the frame. Everything is driven off --slot: the
   signed distance from the middle of the track, measured in garages, which the CSS turns into
   position, scale, turn and light. Measuring the untransformed pitch from the track's own layout
   (not from a transformed rect) keeps this a plain readout instead of a feedback loop. */
function updateSlots(){slotFrame=0;const feed=$('#streetFeed');if(!feed||!slotNodes.length)return;
 const box=feed.getBoundingClientRect(),mid=box.left+box.width/2,pitch=slotNodes[0].offsetWidth||1;
 let closest=null,closestGap=Infinity;
 for(const node of slotNodes){
  /* offsetLeft is the untransformed layout position, so the transform this drives cannot feed back. */
  const centre=node.offsetLeft+node.offsetWidth/2-feed.scrollLeft-(box.width/2),gap=centre/pitch,away=Math.min(Math.abs(gap),3);
  if(away>=3&&Math.abs(gap)>4.5){node.style.visibility='hidden';continue}
  node.style.visibility='';
  node.style.setProperty('--slot',gap.toFixed(3));
  node.style.setProperty('--away',away.toFixed(3));
  node.style.zIndex=Math.round(400-away*40);
  if(Math.abs(gap)<closestGap){closestGap=Math.abs(gap);closest=node}}
 if(closest!==centreNode){
  centreNode?.classList.remove('is-centre');
  centreNode?.querySelector('.post-activity')?.remove();
  centreNode=closest;centreNode?.classList.add('is-centre')}
 updateStreetControls()}
function queueDepths(){if(!slotFrame)slotFrame=requestAnimationFrame(updateSlots)}
function collectDepthNodes(){slotNodes=[...$('#streetFeed').querySelectorAll('.garage-unit')];centreNode=null;queueDepths()}
function updateStreetControls(){const index=slotNodes.indexOf(centreNode),empty=index<0;
 $('#streetPrev').disabled=empty||index===0;$('#streetNext').disabled=empty}
function centreStreetNode(node,behavior='smooth'){const feed=$('#streetFeed');if(!node||!feed)return;
 const left=node.offsetLeft+node.offsetWidth/2-feed.clientWidth/2;
 feed.scrollTo({left:Math.max(0,left),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':behavior})}
function walkStreet(direction){if(!slotNodes.length)return;updateSlots();let index=slotNodes.indexOf(centreNode);
 if(direction>0&&index>=slotNodes.length-1){extendDown();index=slotNodes.indexOf(centreNode)}
 centreStreetNode(slotNodes[index+direction])}
function settleStreet(){const feed=$('#streetFeed');feed.classList.remove('is-steering');updateSlots();centreStreetNode(centreNode)}

/* The street keeps going: add a block ahead, retire one behind so the walk stays cheap. */
function observeStreetEdges(){edgeObserver?.disconnect();const sentinel=$('#bottomStreetSentinel');if(!sentinel)return;
 edgeObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting)extendDown()}),{root:$('#streetFeed'),rootMargin:'0px 900px'});
 edgeObserver.observe(sentinel)}
function extendDown(){if(loading||!activeGarages().length)return;loading=true;
 const sentinel=$('#bottomStreetSentinel');sentinel.insertAdjacentHTML('beforebegin',blockMarkup(++highBlock));
 trimBehind();collectDepthNodes();observeStreetEdges();loading=false}
function trimBehind(){const feed=$('#streetFeed');if(highBlock-lowBlock<5)return;
 const stale=[...feed.querySelectorAll(`[data-block="${lowBlock}"]`)];lowBlock++;if(!stale.length)return;
 const before=feed.scrollWidth;stale.forEach(node=>node.remove());
 feed.scrollLeft-=before-feed.scrollWidth}
function resetStreet(){lowBlock=0;highBlock=1;const feed=$('#streetFeed'),items=activeGarages();
 feed.innerHTML=items.length?`${blockMarkup(0)}${blockMarkup(1)}<i class="street-sentinel" id="bottomStreetSentinel"></i>`:`<div class="street-empty">${tab==='favorites'?'No favorites yet. Star a garage from any street and it waits for you here.'
  :tab==='friends'?'No friends on VybPort yet. Ask someone from their garage and they will appear here once they agree.'
  :'Nothing open at this walking distance. Widen the radius, or search — every garage stays reachable by name.'}</div>`;
 /* Open the walk already standing in the row rather than at the end of it, so there are doors on
    both sides of you from the first frame. */
 const third=feed.children[2];
 feed.scrollLeft=third?third.offsetLeft+third.offsetWidth/2-feed.clientWidth/2:0;
 updatePosition();collectDepthNodes();if(items.length)observeStreetEdges()}
function updatePosition(){const items=activeGarages(),close=items.filter(item=>step(item)<=1).length,name=hood?hood.name:'this neighborhood';
 if(tab==='favorites'){$('#streetPosition').textContent=`Your favorites · ${items.length} garage${items.length===1?'':'s'} kept across every street.`;return}
 if(tab==='friends'){$('#streetPosition').textContent=`Your friends · ${items.length} garage${items.length===1?'':'s'} · friends are mutual, so both of you agreed to this.`;return}
 $('#streetPosition').textContent=query?`Searching ${name} · ${items.length} garage${items.length===1?'':'s'} answer to “${query}”.`
  :`${name} · ${items.length} open doors · ${close} on your block (${myFocus.join(', ')}) · quiet garages stay findable by search, friends, or a direct link.`}

/* Real garages on this street, shaped like the ones the street already knows how to draw. */
function fromGarage(row){const modules=row.modules||[],flagship=row.flagship||{};
 return {id:`garage:${row.handle}:${row.neighborhood}`,user:row.handle,mark:row.name.slice(0,2).toUpperCase(),
  owner:row.name,handle:`@${row.handle}`,kind:row.neighborhood_name,hue:row.hue,rig:'lattice',
  display:modules.length?(hood&&hood.slug===row.neighborhood?`${modules.length} of ${hood.slots.length} bays mounted`:`${modules.length} bays mounted`):'bays still empty',
  displayCopy:row.tagline||'',post:row.tagline||`${row.display_name} keeps a garage on ${row.neighborhood_name}.`,
  tags:row.tags||[],when:'live',age:.1,repo:`${row.handle}/${row.name.toLowerCase().replace(/\s+/g,'-')}`,
  live:true,projectId:flagship.id,modules,publishedFiles:flagship.published_files||{}}}

async function loadStreet(){
 let builderHood='';
 if(directBuilder)try{const all=(await api('/api/garages')).garages||[];builderHood=all.find(item=>item.handle===directBuilder)?.neighborhood||''}catch{}
 const active=await VybHood.mountSwitcher($('#hoodSwitcher'),{slug:builderHood||undefined,onChange:slug=>{location.search=`?n=${encodeURIComponent(slug)}`}});
 if(!active)return;
 hood=(await api(`/api/neighborhoods/${encodeURIComponent(active.slug)}`)).neighborhood;
 /* Your own tags on this street set the walking distance; the street's own tags stand in if you have no garage here. */
 try{myGarage=(await api('/api/garages?mine=1')).garages.find(item=>item.neighborhood===hood.slug)||null;
  if(myGarage&&myGarage.tags.length)myFocus=myGarage.tags}catch{myGarage=null}
 if(myFocus.length===0||!hood.tags.some(tag=>myFocus.includes(tag)))myFocus=hood.tags.slice(0,3);
 try{liveGarages=(await api(`/api/garages?neighborhood=${encodeURIComponent(hood.slug)}`)).garages.map(fromGarage)}catch{liveGarages=[]}
 document.querySelectorAll('[data-filter]').forEach(button=>button.remove());
 const holder=document.querySelector('.street-control-group>div');
 holder.innerHTML=`<button data-filter="all" class="active">All</button>`+
  hood.tags.slice(0,5).map(tag=>`<button data-filter="${safe(tag)}">${safe(tag)}</button>`).join('');
 $('#wanderSearch').placeholder=`Find a garage on ${hood.name}`;
 if(directBuilder){query=directBuilder;$('#wanderSearch').value=`@${directBuilder}`}
 resetStreet();updateTray()}

/* Things you can carry away: a clone, a note, a bolt, or the whole garage handed to your own agent. */
function tray(){try{return JSON.parse(localStorage.getItem(TRAY))||[]}catch{return[]}}
function updateTray(){const live=(myGarage?.bench||[]).reduce((sum,project)=>sum+(project.modules||[]).length,0),count=tray().length+live;$('#trayCount').textContent=`${count} saved`}
function pickerMarkup(item){const already=new Set(savedSlots(item));return `<div class="module-picker" data-picker="${safe(item.id)}">
 <header><div><span>Choose what enters your locker</span><b>${safe(item.owner)} · ${item.modules.length} modules</b></div><button data-cancel-save="${safe(item.id)}">×</button></header>
 <div class="module-picker-list">${item.modules.map(module=>{const files=item.publishedFiles?.[module.slot]||[];return `<label><input type="checkbox" value="${safe(module.slot)}"${already.size?already.has(module.slot)?' checked':'':' checked'}><i></i><span><b>${safe(module.name)}</b><small>${safe(module.lang||'mixed')} · ${files.length?`${files.length} shared code file${files.length===1?'':'s'}`:'design only'}</small></span></label>`}).join('')}</div>
 <footer><p>Only owner-selected snapshots come with a module. No live workspace access.</p><button data-save-modules="${safe(item.id)}">Save selection to locker</button></footer>
 </div>`}
async function clone(item,button){
 /* Live garages expose an exact module picker. Demo cards remain lightweight local bookmarks. */
 if(item.live&&item.projectId){
  if(!myGarage){toast(`Open your own garage on ${hood.name} first — the locker lives there.`);return}
  if(item.projectId===myGarage.flagship?.id){toast('That display is already yours. Open it in your garage workshop.');return}
  if(!item.modules.length){toast('This display has no mounted modules to save yet.');return}
  const post=button.closest('.unit-post'),old=post.querySelector('.module-picker');if(old){old.remove();return}
  post.querySelectorAll('.module-picker').forEach(node=>node.remove());button.closest('.post-actions').insertAdjacentHTML('beforebegin',pickerMarkup(item));return}
 const list=tray();if(list.includes(item.id)){toast(`${item.repo} is already saved.`);return}
 list.push(item.id);try{localStorage.setItem(TRAY,JSON.stringify(list))}catch{}
 button.classList.add('done');button.textContent='✓ saved';updateTray();toast(`Saved ${item.repo}. Live modules go into your review locker.`)}
async function saveModules(item,article){const picker=article.querySelector('.module-picker'),slots=[...picker.querySelectorAll('input:checked')].map(input=>input.value);if(!slots.length){toast('Choose at least one module.');return}const button=picker.querySelector('[data-save-modules]');button.disabled=true;button.textContent='Saving…';
 try{const result=await api(`/api/garages/${myGarage.id}/borrow`,{method:'POST',body:JSON.stringify({project:item.projectId,slots})});myGarage=result.garage;picker.remove();const trigger=article.querySelector('[data-clone]'),count=savedSlots(item).length;trigger.classList.add('done');trigger.textContent=`✓ ${count} in locker`;updateTray();toast(`${slots.length} module${slots.length===1?'':'s'} saved. ${result.saved_files||0} reviewed code file${result.saved_files===1?'':'s'} came with them.`)}
 catch(error){button.disabled=false;button.textContent='Save selection to locker';toast(error.message)}}
/* Keeping a garage is private and needs no one's agreement, so it answers immediately. Asking to be
   someone's friend does need their agreement, so the button only reports that the ask went out. */
async function favorite(item,button){
 try{const result=await api('/api/favorites',{method:'POST',body:JSON.stringify(
   {target:item.id,label:item.owner,handle:item.handle,neighborhood:hood?.slug||''})});
  favorites=new Set(result.favorites.map(row=>row.target));
  button.classList.toggle('done',result.favorited);
  button.textContent=result.favorited?'★ favorited':'☆ favorite';
  toast(result.favorited?`${item.owner} is on your favorites tab.`:`${item.owner} is off your favorites.`);
  if(tab==='favorites')resetStreet()}
 catch(error){toast(error.message)}}
async function befriend(item,button){
 button.disabled=true;
 try{const result=await api('/api/friends',{method:'POST',body:JSON.stringify({handle:item.user})});
  friends=new Set(result.friends.map(row=>row.handle));
  if(friends.has(item.user)){button.textContent='◈ friends';button.classList.add('done');toast(`You and ${item.owner} are friends.`)}
  else{asked.add(item.user);button.textContent='◇ asked';toast(`Asked ${item.owner} to be friends.`)}}
 catch(error){button.disabled=false;toast(error.message)}}

/* The garage's own thread, read without leaving the row. */
async function toggleActivity(item,button){
 const post=button.closest('.unit-post'),open=post.querySelector('.post-activity');
 if(open){open.remove();button.textContent='▤ recent';button.classList.remove('active');return}
 button.textContent='▤ hide';button.classList.add('active');
 const panel=document.createElement('div');panel.className='post-activity';
 panel.innerHTML='<p class="activity-note">Reading this garage’s thread…</p>';post.appendChild(panel);
 try{const social=await api(`/api/social?target=${encodeURIComponent(item.id)}`);
  const rows=[`<article class="activity-row own"><header><b>${safe(item.owner)}</b><time>${safe(item.when)}</time></header><p>${safe(item.post)}</p></article>`]
   .concat((social.comments||[]).map(comment=>
    `<article class="activity-row"><header><b>${safe(comment.display_name)}</b><time>note</time></header><p>${safe(comment.body)}</p></article>`));
  panel.innerHTML=`${rows.join('')}<p class="activity-note">${social.likes} bolt${social.likes===1?'':'s'} · ${(social.comments||[]).length} note${(social.comments||[]).length===1?'':'s'} on this garage.</p>`}
 catch(error){panel.innerHTML=`<p class="activity-note">${safe(error.message)}</p>`}}
function pin(item){pinned=item;openDock();
 $('#agentContext').innerHTML=`<span class="eyebrow">Pinned context</span><b>${safe(item.owner)} · ${safe(item.display)}</b><p>${safe(item.post)}</p>`;
 $('#wanderAgentInput').focus()}

/* The roaming companion is always the user's own remote MCP session. Host CLIs never walk the street. */
function selectedWanderAgent(){return agentConnections.find(item=>item.key===$('#wanderAgentSelect').value)||null}
function wanderAgentContext(){return{schema:'vybport.context/1',view:'wander',neighborhood:hood?.slug||'',pinned:pinned?{target:pinned.id,owner:pinned.owner,display:pinned.display,post:pinned.post}:null}}
function renderWanderAgentHistory(messages=[]){
 const node=$('#agentMessages');
 if(!messages.length){node.innerHTML='<div class="sidecar-message system">This agent profile has a private MCP inbox. Messages wait here until your own coding session checks in.</div>';return}
 node.innerHTML=messages.map(message=>`<div class="sidecar-message ${message.role==='user'?'user':'system'}">${safe(message.body)}</div>`).join('')
}
async function loadWanderAgentHistory({scroll=false}={}){
 const selected=selectedWanderAgent();if(!selected){renderWanderAgentHistory();return}
 const request=++agentHistoryRequest,path=`/api/agent-profiles/${selected.id}/messages`;
 try{const data=await api(path);if(request!==agentHistoryRequest||selected.key!==$('#wanderAgentSelect').value)return;renderWanderAgentHistory(data.messages||[]);if(scroll)requestAnimationFrame(()=>{$('#agentMessages').scrollTop=$('#agentMessages').scrollHeight})}
 catch(error){renderWanderAgentHistory([{role:'system',body:error.message}])}
}
/* The site queues context; the user's session pulls it through its own scoped MCP credential. */
async function loadKept(){
 try{const [fav,pals]=await Promise.all([api('/api/favorites'),api('/api/friends')]);
  favorites=new Set(fav.favorites.map(row=>row.target));
  friends=new Set(pals.friends.map(row=>row.handle));
  asked=new Set(pals.outgoing.map(row=>row.handle));
  /* A favorite kept on another street still has to be findable from this one. */
  const elsewhere=[...new Set(fav.favorites.map(row=>row.neighborhood).filter(slug=>slug&&slug!==hood?.slug))];
  const fetched=await Promise.all(elsewhere.map(slug=>
   api(`/api/garages?neighborhood=${encodeURIComponent(slug)}`).then(data=>data.garages.map(fromGarage)).catch(()=>[])));
  favoriteGarages=fetched.flat();
  resetStreet()}
 catch{}}
async function loadBadges(){try{const result=await api('/api/badges');badges=new Map(result.badges.map(badge=>[badge.target,badge]));resetStreet()}catch{}}
async function loadAgents(){try{const {user}=await api('/api/auth/me');
 if(!user){agentConnections=[];$('#agentState').textContent='Create a local account to walk with an agent.';renderWanderAgentHistory();return}
 $('#agentAccountLink').textContent=`Signed in as ${user.display_name}`;$('#agentAccountLink').href='./index.html';
 const profileResult=await api('/api/agent-profiles');
 const profiles=(profileResult.agent_profiles||[]).filter(item=>item.credential_status==='active'&&(item.scopes||[]).includes('session')).map(item=>({key:agentState.key('mcp',item.id),kind:'mcp',id:item.id,label:item.agent_name||item.label,detail:item.live?'online via MCP':'MCP inbox'}));
 agentConnections=profiles;const selected=agentState.choose(agentConnections,'mcp'),select=$('#wanderAgentSelect');
 select.innerHTML=profiles.length?`<optgroup label="Remote MCP agents">${profiles.map(item=>`<option value="${item.key}">${safe(item.label)} · ${safe(item.detail)}</option>`).join('')}</optgroup>`:'<option value="">Connect an MCP agent from your profile</option>';
 select.value=selected?.key||'';if(selected)agentState.select(selected.key);
 $('#agentState').textContent=selected?`${selected.label} · ${selected.detail}. Its MCP inbox follows you between rooms.`:'No remote agent connected yet — create an MCP profile from your profile page.';
 await loadWanderAgentHistory()}
 catch{agentConnections=[];$('#agentState').textContent='Remote agent inbox unavailable.';renderWanderAgentHistory()}}
function openDock(){$('#agentSidecar').hidden=false;agentState.setOpen(true);loadWanderAgentHistory({scroll:true})}
function closeDock(){$('#agentSidecar').hidden=true;agentState.setOpen(false)}

$('#wanderSearch').oninput=event=>{query=event.target.value;resetStreet()};
document.querySelector('.wander-controls').onclick=event=>{const button=event.target.closest('button');if(!button)return;
 if(button.dataset.filter){filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(other=>other.classList.toggle('active',other===button))}
 if(button.dataset.radius){radius=button.dataset.radius;document.querySelectorAll('[data-radius]').forEach(other=>other.classList.toggle('active',other===button))}
 resetStreet();scrollTo({top:0,behavior:'instant'})};
$('#streetFeed').onclick=async event=>{const button=event.target.closest('button');if(!button)return;
 const id=button.dataset.like||button.dataset.comment||button.dataset.pin||button.dataset.clone||button.dataset.saveModules||button.dataset.cancelSave||button.dataset.activity||button.dataset.favorite||button.dataset.friend;
 const item=pool().find(value=>value.id===id);if(!item)return;
 if(button.dataset.cancelSave){button.closest('.module-picker')?.remove();return}
 if(button.dataset.saveModules){saveModules(item,button.closest('.garage-unit'));return}
 if(button.dataset.activity){toggleActivity(item,button);return}
 if(button.dataset.favorite){favorite(item,button);return}
 if(button.dataset.friend){befriend(item,button);return}
 if(button.dataset.pin){pin(item);return}
 if(button.dataset.clone){clone(item,button);return}
 if(button.dataset.comment){const body=window.prompt(`Leave ${item.owner} a useful public note`);if(!body)return;
  try{await api('/api/social/comment',{method:'POST',body:JSON.stringify({target:item.id,body})});toast('Your note is now on that garage’s public thread.')}catch(error){toast(error.message)}return}
 if(button.dataset.like)try{const social=await api('/api/social/like',{method:'POST',body:JSON.stringify({target:item.id})});button.textContent=`⚡ ${social.likes} bolts`}catch(error){toast(error.message)}};
$('#agentDockToggle').onclick=()=>{$('#agentSidecar').hidden?openDock():closeDock()};
$('#agentDockClose').onclick=closeDock;
$('#wanderAgentForm').onsubmit=async event=>{event.preventDefault();
 if(agentSending)return;const input=$('#wanderAgentInput'),selected=selectedWanderAgent(),message=input.value.trim();if(!message)return;
 if(!selected){toast('Choose or connect an agent first.');return}agentSending=true;agentState.setOpen(true);
 $('#agentMessages').insertAdjacentHTML('beforeend',`<div class="sidecar-message user">${safe(message)}</div>`);
 try{await api(`/api/agent-profiles/${selected.id}/send`,{method:'POST',body:JSON.stringify({kind:'task',body:message,context:wanderAgentContext()})});
  input.value='';await loadWanderAgentHistory({scroll:true});toast('Sent to your agent\'s MCP inbox.')}
 catch(error){await loadWanderAgentHistory({scroll:true});$('#agentMessages').insertAdjacentHTML('beforeend',`<div class="sidecar-message system">${safe(error.message)}</div>`)}
 finally{agentSending=false}};
$('#wanderAgentSelect').onchange=async event=>{agentState.select(event.target.value);const selected=selectedWanderAgent();$('#agentState').textContent=selected?`${selected.label} · ${selected.detail}. Its MCP inbox follows you between rooms.`:'Connect an MCP agent from your profile.';await loadWanderAgentHistory({scroll:true})};

const streetFeed=$('#streetFeed');
streetFeed.addEventListener('scroll',queueDepths,{passive:true});
addEventListener('resize',queueDepths);

/* A mouse wheel naturally speaks vertically, so turn it into a walk while the pointer is over the
   street. Nested activity/file lists keep their own vertical wheel. At a hard edge the event falls
   through to the page, so the street never becomes a scroll trap. */
streetFeed.addEventListener('wheel',event=>{
 if(event.ctrlKey||event.metaKey||event.target.closest('.post-activity,.module-picker-list'))return;
 const raw=Math.abs(event.deltaY)>=Math.abs(event.deltaX)?event.deltaY:event.deltaX;
 if(!raw)return;
 if(raw>0&&streetFeed.scrollLeft+streetFeed.clientWidth>=streetFeed.scrollWidth-3)extendDown();
 const canMove=raw<0?streetFeed.scrollLeft>1:streetFeed.scrollLeft+streetFeed.clientWidth<streetFeed.scrollWidth-1;
 if(!canMove)return;
 event.preventDefault();streetFeed.classList.add('is-steering');
 let distance=raw*(event.deltaMode===1?32:event.deltaMode===2?streetFeed.clientWidth:1);
 const pitch=slotNodes[0]?.offsetWidth||0;
 if(event.deltaMode!==0||Math.abs(raw)>=40)distance=Math.sign(distance)*Math.max(Math.abs(distance),pitch*.58);
 streetFeed.scrollLeft+=distance;clearTimeout(wheelSettleTimer);
 wheelSettleTimer=setTimeout(settleStreet,150)
},{passive:false});

/* Grab any non-control part of a garage and pull the street. A real drag suppresses the link click;
   an ordinary click still walks to or enters the garage exactly as before. */
const streetDrag={pointerId:null,startX:0,startScroll:0,startNode:null,moved:false,suppressClick:false};
streetFeed.addEventListener('dragstart',event=>event.preventDefault());
streetFeed.addEventListener('pointerdown',event=>{
 if(event.button!==0||event.pointerType==='touch'||event.target.closest('button,input,textarea,select'))return;
 clearTimeout(wheelSettleTimer);streetFeed.classList.remove('is-steering');updateSlots();
 streetDrag.pointerId=event.pointerId;streetDrag.startX=event.clientX;streetDrag.startScroll=streetFeed.scrollLeft;streetDrag.startNode=centreNode;streetDrag.moved=false;
 streetFeed.setPointerCapture?.(event.pointerId)});
streetFeed.addEventListener('pointermove',event=>{
 if(event.pointerId!==streetDrag.pointerId)return;const distance=event.clientX-streetDrag.startX;
 if(!streetDrag.moved&&Math.abs(distance)<6)return;
 if(!streetDrag.moved){streetDrag.moved=true;streetFeed.classList.add('is-steering','is-dragging');streetTip.hidden=true}
 event.preventDefault();streetFeed.scrollLeft=streetDrag.startScroll-distance});
function finishStreetDrag(event,cancelled=false){if(event.pointerId!==streetDrag.pointerId)return;
 const moved=streetDrag.moved,travel=event.clientX-streetDrag.startX,startNode=streetDrag.startNode;
 streetDrag.pointerId=null;streetDrag.moved=false;streetDrag.startNode=null;
 if(streetFeed.hasPointerCapture?.(event.pointerId))streetFeed.releasePointerCapture(event.pointerId);
 streetFeed.classList.remove('is-dragging','is-steering');
 if(moved&&!cancelled){
  streetDrag.suppressClick=true;updateSlots();let target=centreNode;
  /* A clear pull should feel like turning one page, not springing back because it stopped a few
     pixels before the browser's geometric halfway point. Longer pulls still land on their nearest. */
  if(target===startNode&&Math.abs(travel)>36){const index=slotNodes.indexOf(startNode);target=slotNodes[index+(travel<0?1:-1)]||target}
  centreStreetNode(target)
 }}
streetFeed.addEventListener('pointerup',event=>finishStreetDrag(event));
streetFeed.addEventListener('pointercancel',event=>finishStreetDrag(event,true));
streetFeed.addEventListener('click',event=>{if(!streetDrag.suppressClick)return;streetDrag.suppressClick=false;event.preventDefault();event.stopImmediatePropagation()},true);
streetFeed.addEventListener('keydown',event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();walkStreet(event.key==='ArrowLeft'?-1:1)});
$('#streetPrev').onclick=()=>walkStreet(-1);
$('#streetNext').onclick=()=>walkStreet(1);

/* The name of whatever is under the pointer, at the pointer. */
const streetTip=document.createElement('div');streetTip.className='street-tip';streetTip.hidden=true;
document.body.appendChild(streetTip);
$('#streetFeed').addEventListener('pointermove',event=>{
 const host=event.target.closest('[data-tip]'),unit=event.target.closest('.garage-unit');
 if(!host||!unit?.classList.contains('is-centre')){streetTip.hidden=true;return}
 streetTip.textContent=host.dataset.tip;streetTip.hidden=false;
 const flip=event.clientX>innerWidth-260;
 streetTip.style.transform=`translate(${flip?event.clientX-streetTip.offsetWidth-16:event.clientX+16}px,${event.clientY+18}px)`});
$('#streetFeed').addEventListener('pointerleave',()=>{streetTip.hidden=true});

/* Clicking a garage further down the row walks to it rather than opening it. */
$('#streetFeed').addEventListener('click',event=>{
 const unit=event.target.closest('.garage-unit');
 if(!unit||unit.classList.contains('is-centre'))return;
 event.preventDefault();streetTip.hidden=true;
 centreStreetNode(unit)});
if(innerWidth<=860&&!agentState.isOpen())$('#agentSidecar').hidden=true;else if(agentState.isOpen())openDock();
$('#streetTabs').onclick=event=>{const button=event.target.closest('button');if(!button)return;
 tab=button.dataset.tab;
 document.querySelectorAll('#streetTabs button').forEach(other=>other.classList.toggle('active',other===button));
 resetStreet()};
updateTray();resetStreet();loadStreet().then(loadKept).catch(()=>{});loadBadges();loadAgents();
