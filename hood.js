/* Neighborhoods are streets. Every public surface — the wander feed, the arena, your garage —
   is scoped to exactly one of them, and this keeps track of which one you are standing on. */
const VybHood=(()=>{
const KEY='vybport.street';
const params=()=>new URLSearchParams(location.search);
const safe=v=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let cache=null;

function current(){return params().get('n')||(()=>{try{return localStorage.getItem(KEY)}catch{return null}})()||'memory-systems'}
function remember(slug){try{localStorage.setItem(KEY,slug)}catch{}}
function link(page,slug){return `./${page}?n=${encodeURIComponent(slug)}`}
async function list(force){if(cache&&!force)return cache;
 const response=await fetch('/api/neighborhoods',{headers:{'Content-Type':'application/json'}});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||'Could not load neighborhoods');
 cache=data.neighborhoods;return cache}

/* One switcher, dropped into whichever page needs it. Changing street reloads that page scoped to it. */
async function mountSwitcher(container,options={}){
 if(!container)return null;
 let hoods=[];try{hoods=await list()}catch{container.innerHTML='<span class="hood-offline">neighborhoods unavailable</span>';return null}
 const slug=options.slug||current(),active=hoods.find(item=>item.slug===slug)||hoods[0];
 if(!active)return null;
 remember(active.slug);
 container.classList.add('hood-switch');
 container.style.setProperty('--hood',active.hue);
 container.innerHTML=`<span class="eyebrow">Neighborhood</span>
  <div class="hood-pick">
   <select aria-label="Choose a neighborhood">${hoods.map(item=>`<option value="${safe(item.slug)}"${item.slug===active.slug?' selected':''}>${safe(item.name)}${item.mine?' · your garage':''} (${item.garages})</option>`).join('')}</select>
   <a class="hood-all" href="./neighborhoods.html">all streets →</a>
  </div>
  <p class="hood-tagline">${safe(active.tagline||'')}</p>`;
 container.querySelector('select').onchange=event=>{
  remember(event.target.value);
  if(options.onChange)options.onChange(event.target.value);
  else location.search=`?n=${encodeURIComponent(event.target.value)}`};
 return active}

/* The bays a street expects, merged with whatever a garage has actually mounted in them. */
function bays(hood,modules){
 const filled={};(modules||[]).forEach(module=>{filled[module.slot]=module});
 return (hood.slots||[]).map(slot=>{const module=filled[slot.key];
  return module
   ?{id:slot.key,slot:slot.label,name:module.name,role:slot.role,lang:module.lang||'—',status:module.status,
     files:module.weight||1,bytes:0,note:module.note,samples:module.note?[module.note]:[]}
   :{id:slot.key,slot:slot.label,name:'empty bay',role:slot.role,lang:'',status:'stable',files:0,bytes:0,
     empty:true,note:slot.hint,samples:slot.hint?[slot.hint]:[]}})}

return{current,remember,link,list,mountSwitcher,bays}})();
