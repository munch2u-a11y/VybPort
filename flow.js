/* Workflow visualiser. A person adds steps in order and it arranges itself; an agent can place
   every node and label every pipe. Drawn as shop equipment: plates, lamps, and conduit between them. */
const VybFlow=(()=>{
const KINDS={
 intake:{label:'intake',glyph:'<svg viewBox="0 0 40 32"><path d="M6 6h28l-7 12H13z" stroke stroke-width="2" fill="none"/><path d="M18 18v8m4-8v8" stroke stroke-width="2"/></svg>'},
 process:{label:'process',glyph:'<svg viewBox="0 0 40 32"><rect x="8" y="8" width="24" height="17" rx="2" stroke stroke-width="2" fill="none"/><circle cx="20" cy="16.5" r="4" stroke stroke-width="2" fill="none"/><path d="M20 4v4M20 25v4" stroke stroke-width="2"/></svg>'},
 decision:{label:'decision',glyph:'<svg viewBox="0 0 40 32"><path d="M20 5l13 11-13 11L7 16z" stroke stroke-width="2" fill="none"/><path d="M20 12v9" stroke stroke-width="2"/></svg>'},
 store:{label:'store',glyph:'<svg viewBox="0 0 40 32"><ellipse cx="20" cy="9" rx="12" ry="4.5" stroke stroke-width="2" fill="none"/><path d="M8 9v14c0 2.5 5.4 4.5 12 4.5s12-2 12-4.5V9" stroke stroke-width="2" fill="none"/><path d="M8 17c0 2.5 5.4 4.5 12 4.5s12-2 12-4.5" stroke stroke-width="1.5" fill="none" opacity=".6"/></svg>'},
 agent:{label:'agent',glyph:'<svg viewBox="0 0 40 32"><rect x="7" y="7" width="26" height="18" rx="2" stroke stroke-width="2" fill="none"/><path d="M12 13h6M12 18h11" stroke stroke-width="2"/><circle cx="27" cy="13" r="2" fill/></svg>'},
 output:{label:'output',glyph:'<svg viewBox="0 0 40 32"><path d="M8 8h24v9l-8 10H16L8 17z" stroke stroke-width="2" fill="none"/><path d="M20 12v9" stroke stroke-width="2"/><path d="M16 17l4 4 4-4" stroke stroke-width="2" fill="none"/></svg>'},
 external:{label:'external',glyph:'<svg viewBox="0 0 40 32"><circle cx="20" cy="16" r="10" stroke stroke-width="2" fill="none"/><path d="M10 16h20M20 6c4 4 4 16 0 20M20 6c-4 4-4 16 0 20" stroke stroke-width="1.6" fill="none"/></svg>'}};
const safe=v=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

/* Longest path from a root sets the column. Anything the author placed by hand wins. */
function arrange(nodes,edges){
 const depth={},rows={};
 nodes.forEach(node=>{depth[node.id]=0});
 for(let pass=0;pass<nodes.length;pass++){let moved=false;
  edges.forEach(edge=>{if(depth[edge.to]<depth[edge.from]+1){depth[edge.to]=depth[edge.from]+1;moved=true}});
  if(!moved)break}
 return nodes.map(node=>{
  const column=Number.isInteger(node.column)?node.column:depth[node.id];
  const row=Number.isInteger(node.row)?node.row:(rows[column]=(rows[column]??-1)+1);
  return {...node,column,row}})}

function render(container,flow,options={}){
 const nodes=(flow&&flow.nodes)||[],edges=(flow&&flow.edges)||[];
 container.classList.add('flow');
 if(!nodes.length){container.innerHTML='<div class="flow-frame"><p class="flow-empty">No workflow drawn yet. Add the first step and the rest arranges itself.</p></div>';return}
 const placed=arrange(nodes,edges);
 const columns=Math.max(...placed.map(node=>node.column))+1;
 const lanes=Math.max(...placed.map(node=>node.row))+1;
 const W=186,H=104,GX=64,GY=26;
 const width=columns*W+(columns-1)*GX,height=lanes*H+(lanes-1)*GY;
 const at={};placed.forEach(node=>{at[node.id]={x:node.column*(W+GX),y:node.row*(H+GY)}});
 const pipes=edges.map((edge,index)=>{
  const a=at[edge.from],b=at[edge.to];if(!a||!b)return '';
  const x1=a.x+W,y1=a.y+H/2,x2=b.x,y2=b.y+H/2;
  const mid=x2>x1?x1+(x2-x1)/2:x1+GX/2;
  const path=`M${x1} ${y1} H${mid} V${y2} H${x2}`;
  const label=edge.label?`<text x="${mid}" y="${(y1+y2)/2-7}" class="pipe-label" text-anchor="middle">${safe(edge.label)}</text>`:'';
  return `<g class="pipe ${edge.kind==='branch'?'branch':''}" data-from="${safe(edge.from)}" data-to="${safe(edge.to)}">
    <path class="pipe-case" d="${path}"/><path class="pipe-bore" d="${path}"/><path class="pipe-core" d="${path}" style="animation-delay:${index*-0.4}s"/>
    <circle class="pipe-flange" cx="${x1}" cy="${y1}" r="4"/><circle class="pipe-flange" cx="${x2}" cy="${y2}" r="4"/>${label}</g>`}).join('');
 container.innerHTML=`<div class="flow-frame">
   <i class="flow-tape top"></i>
   <div class="flow-stage" style="width:${width}px;height:${height}px">
    <svg class="flow-pipes" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${pipes}</svg>
    ${placed.map(node=>`<button type="button" class="unit" data-id="${safe(node.id)}" data-kind="${safe(node.kind)}"
      style="left:${at[node.id].x}px;top:${at[node.id].y}px;width:${W}px;height:${H}px">
      <i class="rivet tl"></i><i class="rivet tr"></i><i class="rivet bl"></i><i class="rivet br"></i>
      <header><span class="unit-kind">${safe((KINDS[node.kind]||KINDS.process).label)}</span><i class="unit-lamp"></i></header>
      <div class="unit-face"><span class="unit-glyph">${(KINDS[node.kind]||KINDS.process).glyph}</span><b>${safe(node.label)}</b></div>
      ${node.note?`<small>${safe(node.note)}</small>`:''}
     </button>`).join('')}
   </div>
   <i class="flow-tape bottom"></i>
  </div>`;
 container.querySelectorAll('.unit').forEach(unit=>{
  const lift=on=>{container.querySelectorAll('.pipe').forEach(pipe=>{
    const touching=pipe.dataset.from===unit.dataset.id||pipe.dataset.to===unit.dataset.id;
    pipe.classList.toggle('lit',on&&touching)});
   container.classList.toggle('focused',on)};
  unit.addEventListener('mouseenter',()=>lift(true));
  unit.addEventListener('mouseleave',()=>lift(false));
  unit.addEventListener('click',()=>options.onSelect&&options.onSelect(nodes.find(node=>node.id===unit.dataset.id)))})}

return{render,KINDS:Object.keys(KINDS)}})();
