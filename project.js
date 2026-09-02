const toast = (message) => { const element = document.querySelector("#toast"); element.textContent = message; element.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove("show"), 2500); };
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
const target = "project:habitus";
async function api(path, options = {}) { const response = await fetch(path, { headers:{"Content-Type":"application/json"}, ...options }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "VybPort request failed."); return body; }
function renderSocial(data) { document.querySelector("#projectLike").innerHTML = `⚡ <span>${data.likes}</span> bolts`; document.querySelector("#comments").innerHTML = data.comments.map((comment) => `<article class="comment"><div class="avatar" style="--avatar:linear-gradient(145deg,#638f7b,#324d68)">${escapeHtml(comment.display_name[0].toUpperCase())}</div><div><b>${escapeHtml(comment.display_name)}</b><time>local note</time></div><p>${escapeHtml(comment.body)}</p></article>`).join("") || `<p class="stage-note">No public notes yet. Start the workbench conversation.</p>`; }
async function refreshSocial() { renderSocial(await api(`/api/social?target=${target}`)); }
document.querySelectorAll(".project-tabs button").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll(".project-tabs button").forEach((item) => item.classList.toggle("active", item === button)); document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== button.dataset.tab)); }));
document.querySelectorAll("[data-tab-jump]").forEach((button) => button.addEventListener("click", () => document.querySelector(`.project-tabs [data-tab="${button.dataset.tabJump}"]`).click()));
document.querySelector("#projectLike").addEventListener("click", async () => { try { renderSocial(await api("/api/social/like", {method:"POST",body:JSON.stringify({target})})); } catch (error) { toast(error.message); } });
document.querySelector("#commentForm").addEventListener("submit", async (event) => { event.preventDefault(); const input = document.querySelector("#commentText"); try { renderSocial(await api("/api/social/comment", {method:"POST",body:JSON.stringify({target,body:input.value})})); input.value = ""; toast("Posted to the workbench."); } catch (error) { toast(error.message); } });
const agentState = window.VybAgentState;
let projectAgentConnections = [], projectAgentHistoryRequest = 0, projectAgentSending = false, pinnedProjectModule = null;
const selectedProjectAgent = () => projectAgentConnections.find((item) => item.key === document.querySelector("#projectAgentSelect").value) || null;
const projectContext = () => ({ schema:"vybport.context/1", view:"public-project", project:{ slug:"habitus", name:"Habitus" }, module:pinnedProjectModule ? { name:pinnedProjectModule.name, role:pinnedProjectModule.role, language:pinnedProjectModule.lang } : null });

function renderProjectAgentHistory(messages = []) {
  const node = document.querySelector("#projectAgentMessages");
  if (!messages.length) {
    const selected = selectedProjectAgent();
    node.innerHTML = `<div class="agent-message system">${escapeHtml(selected?.kind === "mcp" ? "This agent profile’s private MCP inbox is ready." : "This terminal conversation follows you between VybPort rooms.")}</div>`;
    return;
  }
  node.innerHTML = messages.map((message) => `<div class="agent-message ${message.role === "user" ? "user" : "system"}">${escapeHtml(message.body)}</div>`).join("");
}

async function loadProjectAgentHistory({ scroll = false } = {}) {
  const selected = selectedProjectAgent();
  if (!selected) { renderProjectAgentHistory(); return; }
  const request = ++projectAgentHistoryRequest;
  const path = selected.kind === "mcp" ? `/api/agent-profiles/${selected.id}/messages` : `/api/agents/${selected.id}/history`;
  try {
    const data = await api(path);
    if (request !== projectAgentHistoryRequest || selected.key !== document.querySelector("#projectAgentSelect").value) return;
    renderProjectAgentHistory(data.messages || []);
    if (scroll) requestAnimationFrame(() => { const node = document.querySelector("#projectAgentMessages"); node.scrollTop = node.scrollHeight; });
  } catch (error) { renderProjectAgentHistory([{ role:"system", body:error.message }]); }
}

function updateProjectAgentIdentity() {
  const selected = selectedProjectAgent();
  document.querySelector("#projectAgentName").textContent = selected?.label || "Your agent";
  document.querySelector("#projectAgentState").innerHTML = selected ? `<i style="background:#58b777"></i> ${escapeHtml(selected.detail)}` : "<i></i> no agent connected";
}

async function loadProjectAgents() {
  try {
    const [localResult, profileResult] = await Promise.all([api("/api/agents"), api("/api/agent-profiles")]);
    const locals = (localResult.agents || []).map((item) => ({ key:agentState.key("local", item.id), kind:"local", id:item.id, label:item.label, detail:item.provider_label || item.provider }));
    const profiles = (profileResult.agent_profiles || []).filter((item) => item.credential_status === "active" && (item.scopes || []).includes("session"))
      .map((item) => ({ key:agentState.key("mcp", item.id), kind:"mcp", id:item.id, label:item.agent_name || item.label, detail:item.live ? "online via MCP" : "MCP inbox" }));
    projectAgentConnections = [...profiles, ...locals];
    const selected = agentState.choose(projectAgentConnections, "local"), select = document.querySelector("#projectAgentSelect");
    select.innerHTML = `${profiles.length ? `<optgroup label="MCP agent profiles">${profiles.map((item) => `<option value="${item.key}">${escapeHtml(item.label)} · ${escapeHtml(item.detail)}</option>`).join("")}</optgroup>` : ""}${locals.length ? `<optgroup label="Linked terminal sessions">${locals.map((item) => `<option value="${item.key}">${escapeHtml(item.label)} · ${escapeHtml(item.detail)}</option>`).join("")}</optgroup>` : ""}` || `<option value="">No connected agent</option>`;
    select.value = selected?.key || "";
    if (selected) agentState.select(selected.key);
    updateProjectAgentIdentity();
    await loadProjectAgentHistory();
  } catch { projectAgentConnections = []; updateProjectAgentIdentity(); renderProjectAgentHistory(); }
}

function openProjectAgent(module = null) {
  if (module) {
    pinnedProjectModule = module;
    document.querySelector("#projectAgentContext").innerHTML = `<span class="eyebrow">Pinned module</span><b>Habitus · ${escapeHtml(module.name)}</b><p>${escapeHtml(module.role)} · ${escapeHtml(module.lang || "mixed")} · inspect this public capsule only.</p>`;
  }
  document.querySelector("#projectAgentDock").classList.remove("hidden");
  agentState.setOpen(true);
  loadProjectAgentHistory({ scroll:true });
}

function closeProjectAgent() { document.querySelector("#projectAgentDock").classList.add("hidden"); agentState.setOpen(false); }
document.querySelectorAll("#openAgent,#pinProject,#pinInside").forEach((button) => button.addEventListener("click", () => openProjectAgent()));
document.querySelector("#closeAgent").addEventListener("click", closeProjectAgent);
document.querySelector("#projectAgentSelect").addEventListener("change", async (event) => { agentState.select(event.target.value); updateProjectAgentIdentity(); await loadProjectAgentHistory({ scroll:true }); });
document.querySelector("#pairFromProject").addEventListener("click", () => { location.href = "./index.html?agent=open&agentTarget=project:habitus"; });
document.querySelector("#projectAgentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (projectAgentSending) return;
  const selected = selectedProjectAgent(), input = document.querySelector("#projectAgentInput"), message = input.value.trim();
  if (!message) return;
  if (!selected) { toast("Connect an agent from your profile first."); return; }
  projectAgentSending = true;
  document.querySelector("#projectAgentMessages").insertAdjacentHTML("beforeend", `<div class="agent-message user">${escapeHtml(message)}</div>`);
  try {
    if (selected.kind === "mcp") await api(`/api/agent-profiles/${selected.id}/send`, { method:"POST", body:JSON.stringify({ kind:"review", body:message, context:projectContext() }) });
    else await api(`/api/agents/${selected.id}/message`, { method:"POST", body:JSON.stringify({ mode:"chat", message, context:projectContext() }) });
    input.value = "";
    await loadProjectAgentHistory({ scroll:true });
    toast(selected.kind === "mcp" ? "Sent to the agent inbox." : "Your linked terminal agent replied.");
  } catch (error) { await loadProjectAgentHistory({ scroll:true }); toast(error.message); }
  finally { projectAgentSending = false; }
});
document.querySelectorAll("#cloneCapsule,#cloneInside").forEach((button) => button.addEventListener("click", () => toast("Capsule selected—your local bridge will choose a workspace next.")));
document.querySelector("#arenaLaunch").addEventListener("click", () => { document.querySelector('.project-tabs [data-tab="evidence"]').click(); toast("Review the run contract before entering the arena."); });
document.querySelector("#watchEvidence").addEventListener("click", () => toast("Run trace viewer would open with receipts and read-backs.")); document.querySelector("#prepareRun").addEventListener("click", () => toast("Arena setup begins with an explicit benchmark contract."));
refreshSocial().catch((error) => toast(error.message));

/* The rack is scanned from the local workspace when the bridge is up; a stored manifest stands in otherwise. */
const DEMO_RACK = { root: "habitus", modules: [
  { id:"memory", name:"memory", role:"memory", lang:"Python", files:14, bytes:186000, status:"hot", languages:[["Python",14]], samples:["memory/route_store.py","memory/receipts.py","memory/recall.py"] },
  { id:"nursery", name:"nursery", role:"logic", lang:"Python", files:9, bytes:121000, status:"active", languages:[["Python",9]], samples:["nursery/curriculum.py","nursery/trajectory.py"] },
  { id:"effects", name:"effects", role:"effects", lang:"Python", files:5, bytes:44000, status:"active", languages:[["Python",5]], samples:["effects/render.py","effects/timeline.py"] },
  { id:"api", name:"api", role:"logic", lang:"Python", files:6, bytes:58000, status:"hot", languages:[["Python",6]], samples:["api/server.py","api/routes.py"] },
  { id:"web", name:"web", role:"interface", lang:"JavaScript", files:11, bytes:97000, status:"hot", languages:[["JavaScript",7],["CSS",3]], samples:["web/app.js","web/rack.css","web/index.html"] },
  { id:"tests", name:"tests", role:"tests", lang:"Python", files:12, bytes:73000, status:"active", languages:[["Python",12]], samples:["tests/test_recall.py","tests/test_curriculum.py"] },
  { id:"agents", name:"agents", role:"agents", lang:"Python", files:4, bytes:31000, status:"stable", languages:[["Python",4]], samples:["agents/adaptor.py","agents/prompts.py"] },
  { id:"docs", name:"docs", role:"docs", lang:"Markdown", files:6, bytes:28000, status:"stable", languages:[["Markdown",6]], samples:["docs/CAPSULE_MANIFEST.md"] }],
 links: [ {from:"nursery",to:"memory",weight:6},{from:"api",to:"memory",weight:4},{from:"api",to:"nursery",weight:3},
  {from:"web",to:"api",weight:5},{from:"effects",to:"web",weight:2},{from:"tests",to:"memory",weight:4},
  {from:"tests",to:"nursery",weight:3},{from:"agents",to:"api",weight:2},{from:"docs",to:"memory",weight:1} ] };

function renderLegend(modules) {
  const seen = [...new Set(modules.map((module) => module.role))];
  document.querySelector("#rackLegend").innerHTML = seen.map((role) =>
    `<span style="--tone:var(--role-${role})"><i></i>${escapeHtml(VybRack.ROLE_LABEL[role] || role)}</span>`).join("");
}

async function loadRack() {
  const mount = document.querySelector("#projectRack"), origin = document.querySelector("#rackOrigin");
  let data = DEMO_RACK, note = "stored manifest · this builder's workspace is not on your machine";
  try { const scan = await api("/api/project/rack"); if (scan.modules.length) { data = scan; note = `scanned live from ./${scan.root} · ${scan.modules.length} modules, ${scan.links.length} references`; } }
  catch { /* no local bridge: the stored manifest is what a visitor sees anyway */ }
  origin.textContent = note;
  renderLegend(data.modules);
  VybRack.render(mount, data, {
    onAgent: (module) => openProjectAgent(module),
  });
}
loadRack();
loadProjectAgents().then(() => { if (agentState.isOpen()) openProjectAgent(); });
