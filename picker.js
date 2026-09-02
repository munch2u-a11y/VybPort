/* Folder picker. Browsers never hand a page an absolute path — showDirectoryPicker and
   webkitdirectory both give a name and nothing more — so the listing comes from the local
   service, bounded to the same roots that pairing allows. */
const VybPicker=(()=>{
const safe=v=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let panel=null,resolveWith=null,here='';

function shell(){
 if(panel)return panel;
 panel=document.createElement('div');
 panel.className='picker';panel.hidden=true;
 panel.innerHTML=`<div class="picker-panel" role="dialog" aria-modal="true" aria-label="Choose a folder">
   <header><div><span class="eyebrow">Choose a folder</span><b class="picker-here"></b></div>
    <button type="button" class="picker-close" aria-label="Cancel">×</button></header>
   <div class="picker-crumbs"></div>
   <div class="picker-list"></div>
   <footer><span class="picker-note"></span>
    <button type="button" class="button ghost picker-cancel">Cancel</button>
    <button type="button" class="button solid picker-take">Use this folder</button></footer>
  </div>`;
 document.body.appendChild(panel);
 const shut=value=>{panel.hidden=true;if(resolveWith){resolveWith(value);resolveWith=null}};
 panel.querySelector('.picker-close').onclick=()=>shut(null);
 panel.querySelector('.picker-cancel').onclick=()=>shut(null);
 panel.querySelector('.picker-take').onclick=()=>shut(here);
 panel.onclick=event=>{if(event.target===panel)shut(null)};
 addEventListener('keydown',event=>{if(!panel.hidden&&event.key==='Escape')shut(null)});
 panel.querySelector('.picker-list').onclick=event=>{
  const row=event.target.closest('[data-go]');if(row)show(row.dataset.go)};
 panel.querySelector('.picker-crumbs').onclick=event=>{
  const crumb=event.target.closest('[data-go]');if(crumb)show(crumb.dataset.go)};
 return panel}

async function show(path){
 const box=shell();
 try{
  const response=await fetch(`/api/browse${path?`?path=${encodeURIComponent(path)}`:''}`,{headers:{'Content-Type':'application/json'}});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Could not read that folder');
  here=data.here;
  box.querySelector('.picker-here').textContent=data.here;
  const root=data.roots[0]||'';
  const rest=data.here.startsWith(root)?data.here.slice(root.length).split('/').filter(Boolean):[];
  let walk=root;
  box.querySelector('.picker-crumbs').innerHTML=[`<button type="button" data-go="${safe(root)}">${safe(root)}</button>`]
   .concat(rest.map(part=>{walk+='/'+part;return `<button type="button" data-go="${safe(walk)}">${safe(part)}</button>`})).join('<i>/</i>');
  box.querySelector('.picker-list').innerHTML=data.folders.length
   ?data.folders.map(folder=>`<button type="button" data-go="${safe(folder.path)}" class="${folder.repo?'repo':''}">
      <span class="picker-icon">${folder.repo?'◆':'▸'}</span><b>${safe(folder.name)}</b>
      <i>${folder.repo?'git repo':''}${folder.marks.length?' · '+safe(folder.marks.join(', ')):''}</i></button>`).join('')
   :'<p class="picker-empty">No sub-folders here. Use this one, or step back up.</p>';
  box.querySelector('.picker-note').textContent=data.parent?'':'this is as far up as pairing allows';
  box.hidden=false}
 catch(error){box.querySelector('.picker-list').innerHTML=`<p class="picker-empty">${safe(error.message)}</p>`;box.hidden=false}}

/* Resolves to an absolute path, or null if they backed out. */
function pick(start){return new Promise(resolve=>{resolveWith=resolve;show(start||'')})}
return{pick}})();
