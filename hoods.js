/* Every street, what it expects on a rack, and the form for opening a new one. */
const $=s=>document.querySelector(s);
const safe=v=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const toast=t=>{const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2600)};
async function api(path,options={}){const r=await fetch(path,{headers:{'Content-Type':'application/json'},...options});const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d}
const ROLES=['memory','interface','logic','effects','tests','assets','agents','config','docs'];

function card(hood){
 return `<article class="hood-card" style="--hood:${hood.hue}">
  <header><h2>${safe(hood.name)}</h2><span class="count">${hood.garages} garage${hood.garages===1?'':'s'}${hood.mine?' · yours':''}</span></header>
  <p>${safe(hood.tagline||'No description yet.')}</p>
  <div class="hood-bays">${hood.slots.map(slot=>`<span style="--role:var(--role-${safe(slot.role)})"><i></i>${safe(slot.label)}</span>`).join('')}</div>
  <div class="hood-tags">${hood.tags.map(tag=>`<span>#${safe(tag)}</span>`).join('')}</div>
  <footer>
   <a class="primary" href="${VybHood.link('wander.html',hood.slug)}">Walk this street →</a>
   <a href="${VybHood.link('garage.html',hood.slug)}">${hood.mine?'Your garage':'Open a garage'}</a>
   <a href="${VybHood.link('arena.html',hood.slug)}">Arena</a>
  </footer></article>`}

async function load(){try{const hoods=await VybHood.list(true);
 $('#hoodsList').innerHTML=hoods.map(card).join('')}
 catch(error){$('#hoodsList').innerHTML=`<p class="jump-empty">${safe(error.message)}</p>`}}

/* A street is defined by its bays, so opening one is mostly deciding what everybody here will fill. */
function slotRow(label='',role='logic',hint=''){
 return `<div class="slot-row">
  <input data-slot="label" value="${safe(label)}" placeholder="Retrieval" autocomplete="off">
  <select data-slot="role">${ROLES.map(item=>`<option value="${item}"${item===role?' selected':''}>${item}</option>`).join('')}</select>
  <input data-slot="hint" value="${safe(hint)}" placeholder="what this bay is for" autocomplete="off">
  <button type="button" data-remove>remove</button></div>`}

$('#toggleNew').onclick=()=>{const form=$('#hoodForm');form.hidden=!form.hidden;
 if(!form.hidden&&!$('#slotRows').children.length){
  $('#slotRows').innerHTML=[slotRow('Core','logic','the heart of the build'),slotRow('Interface','interface','how a person uses it'),
   slotRow('Storage','memory','where state lives'),slotRow('Evaluation','tests','how it is checked')].join('')}
 $('#toggleNew').textContent=form.hidden?'Start one':'Never mind'};
$('#addSlot').onclick=()=>{$('#slotRows').insertAdjacentHTML('beforeend',slotRow())};
$('#slotRows').onclick=event=>{if(event.target.dataset.remove!==undefined)event.target.closest('.slot-row').remove()};

$('#hoodForm').onsubmit=async event=>{event.preventDefault();
 const slots=[...document.querySelectorAll('.slot-row')].map(row=>({
  label:row.querySelector('[data-slot=label]').value.trim(),
  role:row.querySelector('[data-slot=role]').value,
  hint:row.querySelector('[data-slot=hint]').value.trim()})).filter(slot=>slot.label);
 try{const {user}=await api('/api/auth/me');if(!user){location.href='./register.html';return}
  const result=await api('/api/neighborhoods',{method:'POST',body:JSON.stringify({
   slug:$('#hSlug').value.trim().toLowerCase(),name:$('#hName').value.trim(),
   tagline:$('#hTagline').value.trim(),hue:Number($('#hHue').value)||200,
   tags:$('#hTags').value.split(',').map(tag=>tag.trim()).filter(Boolean),slots})});
  $('#hoodForm').hidden=true;$('#toggleNew').textContent='Start one';
  await load();toast(`${result.neighborhood.name} is open. Yours is the first garage.`);
  location.href=VybHood.link('garage.html',result.neighborhood.slug)}
 catch(error){toast(error.message)}};

load();
