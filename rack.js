/* Draws a workspace as a rack of mounted modules with the references between them as cables.
   Nothing here reads source: it takes the shape a scan produced and makes it something you can look at. */
const VybRack=(()=>{
const ROLE_LABEL={memory:'memory system',interface:'interface',logic:'backend logic',effects:'effects',tests:'test bay',config:'config & build',docs:'notes',assets:'assets',agents:'agent tooling'};
const safe=v=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const size=bytes=>bytes>=1048576?`${(bytes/1048576).toFixed(1)}MB`:bytes>=1024?`${Math.round(bytes/1024)}KB`:`${bytes}B`;

/* One small diagram per kind of module, so the shape of a thing is legible before its name is. */
const GLYPHS={
 memory:'<svg viewBox="0 0 100 60"><g stroke-width="2" fill="none"><rect x="18" y="10" width="64" height="11" rx="2" stroke/><rect x="18" y="25" width="64" height="11" rx="2" stroke/><rect x="18" y="40" width="64" height="11" rx="2" stroke/></g><circle cx="28" cy="15.5" r="2.5" fill/><circle cx="28" cy="30.5" r="2.5" fill/><circle cx="28" cy="45.5" r="2.5" fill/><path d="M72 15.5v30" stroke stroke-width="2" fill="none" opacity=".55"/></svg>',
 interface:'<svg viewBox="0 0 100 60"><rect x="16" y="9" width="68" height="42" rx="3" stroke stroke-width="2" fill="none"/><path d="M16 20h68" stroke stroke-width="2" fill="none"/><circle cx="23" cy="14.5" r="2" fill/><rect x="24" y="27" width="24" height="4" rx="2" fill opacity=".8"/><rect x="24" y="35" width="38" height="4" rx="2" fill opacity=".45"/><rect x="56" y="26" width="20" height="15" rx="2" stroke stroke-width="1.6" fill="none" opacity=".7"/></svg>',
 logic:'<svg viewBox="0 0 100 60"><circle cx="34" cy="30" r="13" stroke stroke-width="2" fill="none"/><circle cx="34" cy="30" r="4" fill/><circle cx="70" cy="19" r="7" stroke stroke-width="2" fill="none"/><circle cx="70" cy="43" r="7" stroke stroke-width="2" fill="none"/><path d="M47 26l16-5M47 34l16 5" stroke stroke-width="2" fill="none"/></svg>',
 effects:'<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="6" fill/><g stroke stroke-width="2" fill="none" opacity=".85"><path d="M50 12v-6M50 54v-6M32 30h-6M74 30h6M37 17l-4-4M63 43l4 4M63 17l4-4M37 43l-4 4"/></g><circle cx="50" cy="30" r="16" stroke stroke-width="1.4" fill="none" opacity=".5"/><circle cx="50" cy="30" r="23" stroke stroke-width="1" fill="none" opacity=".25"/></svg>',
 tests:'<svg viewBox="0 0 100 60"><g stroke stroke-width="2" fill="none"><path d="M22 30l6 6 11-13"/><path d="M22 46l6 6 11-13"/><path d="M22 14l6 6 11-13"/></g><rect x="52" y="9" width="30" height="5" rx="2" fill opacity=".75"/><rect x="52" y="26" width="30" height="5" rx="2" fill opacity=".55"/><rect x="52" y="43" width="18" height="5" rx="2" fill opacity=".35"/></svg>',
 config:'<svg viewBox="0 0 100 60"><g stroke stroke-width="2" fill="none"><path d="M20 18h60M20 30h60M20 42h60"/></g><circle cx="38" cy="18" r="5" fill/><circle cx="62" cy="30" r="5" fill/><circle cx="30" cy="42" r="5" fill/></svg>',
 docs:'<svg viewBox="0 0 100 60"><rect x="26" y="8" width="48" height="44" rx="3" stroke stroke-width="2" fill="none"/><g fill opacity=".7"><rect x="34" y="18" width="32" height="3" rx="1.5"/><rect x="34" y="26" width="32" height="3" rx="1.5"/><rect x="34" y="34" width="22" height="3" rx="1.5"/></g></svg>',
 assets:'<svg viewBox="0 0 100 60"><rect x="20" y="10" width="60" height="40" rx="3" stroke stroke-width="2" fill="none"/><circle cx="36" cy="23" r="4" fill/><path d="M24 46l16-16 12 11 9-7 15 12" stroke stroke-width="2" fill="none"/></svg>',
 agents:'<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="9" stroke stroke-width="2" fill="none"/><circle cx="50" cy="30" r="3" fill/><g fill opacity=".9"><circle cx="24" cy="16" r="4"/><circle cx="78" cy="20" r="4"/><circle cx="30" cy="46" r="4"/><circle cx="72" cy="45" r="4"/></g><g stroke stroke-width="1.6" fill="none" opacity=".6"><path d="M41 26l-13-7M59 27l15-5M43 36l-11 7M58 35l11 7"/></g></svg>'};
/* Where the role alone would say too little — half a web project is "interface" — the language decides. */
const LANG_GLYPHS={
 JavaScript:'<svg viewBox="0 0 100 60"><g stroke stroke-width="2.4" fill="none" stroke-linecap="round"><path d="M42 12c-7 0-9 4-9 9s0 9-7 9c7 0 7 4 7 9s2 9 9 9"/><path d="M58 12c7 0 9 4 9 9s0 9 7 9c-7 0-7 4-7 9s-2 9-9 9"/></g><circle cx="50" cy="30" r="3.5" fill/></svg>',
 CSS:'<svg viewBox="0 0 100 60"><g stroke stroke-width="2" fill="none"><path d="M50 9l27 9.5-27 9.5-27-9.5z"/><path d="M23 30l27 9.5L77 30"/><path d="M23 41l27 9.5L77 41"/></g><circle cx="50" cy="18.5" r="2.6" fill/></svg>',
 Python:'<svg viewBox="0 0 100 60"><g stroke stroke-width="2" fill="none"><rect x="22" y="12" width="26" height="16" rx="6"/><rect x="52" y="32" width="26" height="16" rx="6"/><path d="M35 28v6h30v-2"/></g><circle cx="29" cy="20" r="2.4" fill/><circle cx="71" cy="40" r="2.4" fill/></svg>'};
LANG_GLYPHS.TypeScript=LANG_GLYPHS.JavaScript;
const glyph=(role,lang)=>((role==='interface'||role==='logic')&&LANG_GLYPHS[lang])||GLYPHS[role]||GLYPHS.logic;

function podMarkup(module,largest){
 const share=Math.max(6,Math.round(module.files/largest*100));
 /* A street's bay label sits above whatever is mounted in it, so two garages read line for line. */
 const head=module.slot?`<span class="pod-slot">${safe(module.slot)}</span>`:'';
 const meta=module.empty
  ?`<div class="pod-meta"><span>nothing mounted</span></div>`
  :`<div class="pod-meta">${module.lang?`<span class="pod-lang">${safe(module.lang)}</span>`:''}${module.bytes?`<span>${module.files} file${module.files===1?'':'s'}</span><span>${size(module.bytes)}</span>`:`<span>${safe(module.status||'active')}</span>`}</div>`;
 return `<button class="pod${module.empty?' empty':''}" type="button" data-id="${safe(module.id)}" data-role="${safe(module.role)}" data-status="${safe(module.status||'stable')}" aria-expanded="false">
  <i class="pod-clamp top"></i>
  ${head}
  <header><span class="pod-role">${safe(ROLE_LABEL[module.role]||module.role)}</span><i class="pod-led"></i></header>
  <div class="pod-glyph">${glyph(module.role,module.lang)}</div>
  <h3>${safe(module.name)}</h3>
  ${meta}
  <div class="pod-gauge"><i style="width:${module.empty?0:share}%"></i></div>
  <i class="pod-clamp bottom"></i><i class="pod-port left"></i><i class="pod-port right"></i>
 </button>`}

/* Cables are measured from where the pods actually landed, then redrawn whenever the shelf reflows. */
function drawCables(rack){
 const svg=rack.querySelector('.rack-cables'),frame=rack.querySelector('.rack-frame');
 if(!svg||!frame)return;
 const base=frame.getBoundingClientRect(),ports={};
 rack.querySelectorAll('.pod').forEach(pod=>{const box=pod.getBoundingClientRect();
  ports[pod.dataset.id]={left:box.left-base.left,right:box.right-base.left,top:box.top-base.top,bottom:box.bottom-base.top,
   midX:box.left-base.left+box.width/2,midY:box.top-base.top+box.height/2}});
 svg.setAttribute('viewBox',`0 0 ${base.width} ${base.height}`);
 svg.innerHTML=(rack.cables||[]).map((cable,index)=>{
  const from=ports[cable.from],to=ports[cable.to];
  if(!from||!to)return '';
  const drop=6+index%3*7;
  let path;
  if(Math.abs(from.midY-to.midY)<20){
   // Same shelf: a slack loop from one side port to the next, sagging the way a real cable would.
   const [a,b]=from.midX<to.midX?[from,to]:[to,from],reach=Math.max(20,(b.left-a.right)*.45);
   path=`M${a.right} ${a.midY} C${a.right+reach} ${a.midY+drop} ${b.left-reach} ${b.midY+drop} ${b.left} ${b.midY}`}
  else{
   // Different shelves: down out of the lower edge and up into the one below.
   const [a,b]=from.midY<to.midY?[from,to]:[to,from],span=Math.max(24,(b.top-a.bottom)*.55);
   path=`M${a.midX} ${a.bottom} C${a.midX} ${a.bottom+span+drop} ${b.midX} ${b.top-span-drop} ${b.midX} ${b.top}`}
  const tone=`var(--role-${cable.role||'logic'})`;
  return `<g class="cable" data-from="${safe(cable.from)}" data-to="${safe(cable.to)}">
   <path d="${path}" stroke="${tone}" stroke-width="${Math.min(6,2.5+cable.weight*.5)}" opacity=".16"/>
   <path class="cable-core" d="${path}" stroke="${tone}" stroke-width="1.6" opacity=".85"/></g>`}).join('')}

function detailMarkup(module,cables){
 const wired=cables.filter(cable=>cable.from===module.id||cable.to===module.id)
  .map(cable=>cable.from===module.id?`→ ${cable.to}`:`← ${cable.from}`);
 return `<div class="detail-head"><h3>${safe(module.name)}</h3><span class="pod-role">${safe(ROLE_LABEL[module.role]||module.role)}</span></div>
  <div class="detail-stats"><span>${safe(module.lang)}</span><span>${module.files} files</span><span>${size(module.bytes)}</span><span>${safe(module.status||'stable')}</span>
   ${(module.languages||[]).map(([name,count])=>`<span>${safe(name)} ×${count}</span>`).join('')}</div>
  <p class="detail-wires">${wired.length?`Wired to <b>${safe(wired.join('  '))}</b>`:'No references to other modules were found in this one.'}</p>
  <div class="detail-files">${(module.samples||[]).map(file=>`<span>${safe(file)}</span>`).join('')||'<span>no sample paths</span>'}</div>
  <div class="detail-actions"><button class="button solid" data-rack-agent="${safe(module.id)}">✦ Send this module to my agent</button></div>`}

function render(container,data,options={}){
 const modules=(data&&data.modules)||[];
 const roleOf={};modules.forEach(module=>{roleOf[module.id]=module.role});
 const cables=((data&&data.links)||[]).map(link=>({...link,role:roleOf[link.from]||'logic'}));
 container.classList.add('rack');
 if(options.compact)container.classList.add('compact');
 /* The street decides the arrangement, so a given bay sits in the same place in every garage on it. */
 container.dataset.layout=options.layout||'rack';
 if(!modules.length){container.innerHTML='<div class="rack-frame"><p class="rack-empty">Nothing is mounted on this rack yet.</p></div>';return}
 const byLayout={rack:4,console:2,board:1,brain:modules.length||1};
 const perShelf=options.perShelf||byLayout[options.layout]||(options.compact?3:4);
 const largest=Math.max(1,...modules.map(module=>module.files));
 const shelves=[];for(let index=0;index<modules.length;index+=perShelf)shelves.push(modules.slice(index,index+perShelf));
 container.innerHTML=`<div class="rack-frame">
   <i class="rack-rail top"></i><i class="rack-spine"></i>
   <svg class="rack-cables" aria-hidden="true"></svg>
   <div class="rack-shelves">${shelves.map(shelf=>`<div class="rack-shelf">${shelf.map(module=>podMarkup(module,largest)).join('')}</div>`).join('')}</div>
   <i class="rack-rail bottom"></i>
  </div>${options.compact||options.detail===false?'':'<aside class="rack-detail" hidden></aside>'}`;
 container.cables=cables;
 const redraw=()=>drawCables(container);
 requestAnimationFrame(redraw);
 if(container.rackObserver)container.rackObserver.disconnect();
 container.rackObserver=new ResizeObserver(redraw);
 container.rackObserver.observe(container.querySelector('.rack-frame'));

 const focus=id=>{
  if(!id){delete container.dataset.focus;container.querySelectorAll('[data-active]').forEach(node=>node.removeAttribute('data-active'));return}
  container.dataset.focus=id;
  const touching=new Set([id]);
  container.querySelectorAll('.cable').forEach(cable=>{
   const on=cable.dataset.from===id||cable.dataset.to===id;
   on?cable.setAttribute('data-active',''):cable.removeAttribute('data-active');
   if(on){touching.add(cable.dataset.from);touching.add(cable.dataset.to)}});
  container.querySelectorAll('.pod').forEach(pod=>touching.has(pod.dataset.id)?pod.setAttribute('data-active',''):pod.removeAttribute('data-active'))};

 container.querySelectorAll('.pod').forEach(pod=>{
  pod.addEventListener('mouseenter',()=>focus(pod.dataset.id));
  pod.addEventListener('focus',()=>focus(pod.dataset.id));
  pod.addEventListener('mouseleave',()=>focus(null));
  pod.addEventListener('blur',()=>focus(null));
  pod.addEventListener('click',()=>{
   const module=modules.find(item=>item.id===pod.dataset.id);
   const detail=container.querySelector('.rack-detail');
   if(!detail){if(options.onSelect)options.onSelect(module);return}
   const open=pod.getAttribute('aria-expanded')==='true';
   container.querySelectorAll('.pod').forEach(other=>other.setAttribute('aria-expanded','false'));
   if(open){detail.hidden=true;return}
   pod.setAttribute('aria-expanded','true');
   detail.innerHTML=detailMarkup(module,cables);detail.hidden=false;
   detail.querySelector('[data-rack-agent]').onclick=()=>options.onAgent&&options.onAgent(module);
   /* After the drawer exists and is filled — anything onSelect appends would otherwise be wiped. */
   if(options.onSelect)options.onSelect(module)})});
 return{redraw}}

return{render,ROLE_LABEL}})();
