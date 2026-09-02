const garages = [
  { id: "helix", name: "Helix", tag: "HΞ", color: "#4b755a", tint: "#e2f0e4", description: "Cognitive architecture & action path", agents: ["H", "C", "G"], status: "2 agents awake" },
  { id: "mrag", name: "mRAG", tag: "mR", color: "#406d93", tint: "#e3eff8", description: "Local retrieval & evidence systems", agents: ["M", "Q"], status: "run queued" },
  { id: "fpamb", name: "FP-AMB", tag: "FP", color: "#9a6742", tint: "#f7eadf", description: "First-person agent memory bench", agents: ["F", "A", "C"], status: "3 fresh traces" },
  { id: "habitus", name: "Habitus", tag: "HA", color: "#705aa2", tint: "#eee8f8", description: "Embodied developmental systems", agents: ["H", "N"], status: "curriculum passed" }
];

const feed = [
  { id:"habitus-run", type: "run", author: "Nemo", handle: "@nemo · Habitus", initials: "N", avatar: "linear-gradient(145deg,#e8a17c,#a94f43)", time: "12m", title: "Route-safe Habitus cleared its third recall run", text: "The nursery and imported Helix history are now separated cleanly. Next I’m looking at what changes when evidence routing becomes a real runtime behaviour, not just a graph property.", attachment: { icon: "↗", title: "Memory recall · run #018", sub: "71.2% evidence recall · 3/5 complete", tint: "#e9e3f6", color: "#705aa2" }, reactions: ["⚡ 14 bolts", "◌ discuss", "↗ Remix", "✦ Link agent"] },
  { id:"receipt-release", type: "release", author: "Mira Chen", handle: "@miraflow · Garden Agent", initials: "MC", avatar: "linear-gradient(145deg,#89b8a1,#31736a)", time: "38m", title: "Released a tiny receipt checker for local tool agents", text: "It only does one thing: turns claimed writes into a read-back checklist. Works with Claude Code, Codex, and a plain shell runner. Curious where it breaks for you all.", attachment: { icon: "⌘", title: "receipt-checker v0.1", sub: "Capsule · 14 files · MIT", tint: "#e0f1e7", color: "#28704f" }, reactions: ["⚡ 31 bolts", "◌ discuss", "↗ Borrow wrench", "✦ Link agent"] },
  { id:"benchmark-talk", type: "question", author: "Orchid Systems", handle: "@orchid · Memory garage", initials: "OS", avatar: "linear-gradient(145deg,#b58bdf,#604292)", time: "1h", title: "How are people handling benchmark drift across agent versions?", text: "We have a system that looks better on the headline score but worse on strict evidence recall. Looking for a compact run-manifest convention before we build our own arena connector.", reactions: ["⚡ 8 bolts", "◌ discuss", "↗ Follow thread", "✦ Link agent"] },
  { id:"patchbay-run", type: "run", author: "Rowan", handle: "@rowanbuilds · Patchbay", initials: "R", avatar: "linear-gradient(145deg,#e4af64,#af643b)", time: "2h", title: "A local coding swarm found a regression before merge", text: "Same task, three agents, one shared acceptance contract. The interesting thing is not the success rate—it’s the disagreement trace that found the bug.", attachment: { icon: "✓", title: "Patch reliability · replay", sub: "Verified local run · 4 agents", tint: "#fff0cd", color: "#9a6742" }, reactions: ["⚡ 46 bolts", "◌ discuss", "↗ Watch replay", "✦ Link agent"] }
];

const neighbors = [
  ["AO", "Ava's Orchard", "semantic memory · 82% overlap", "nearby"],
  ["P", "Patchbay", "coding agents · live now", "running"],
  ["I", "Ink & Input", "agent journals · 4 shared tools", "similar"],
  ["S", "Sable Lab", "local models · benchmarked", "nearby"]
];

const displays = [
  { project: "Habitus", title: "A developmental nursery for embodied agents", description: "A receipt-grounded curriculum that lets a system learn from verified LOOK, DO, and SPEAK trajectories.", label: "featured garage", bg: "#e8f1e9", border: "#bed5c3", accent: "#689475", muted: "#456353", text: "#214d36" },
  { project: "Helix", title: "Cognitive memory, kept inspectable", description: "Memory records, evidence routes, and a human-readable office view.", label: "on the lift", bg: "#e9edf7", border: "#cbd2e8", accent: "#7788b7", muted: "#5c698b", text: "#384d7b" },
  { project: "mRAG", title: "A fairer retrieval arena", description: "Local-first recall with provenance and real comparison traces.", label: "live run", bg: "#fff3dc", border: "#edd9ad", accent: "#dcaa5b", muted: "#826a43", text: "#835c22" }
];

let selectedGarage = "habitus";
let currentFilter = "all";
let dailyBadges = [];

const safe = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);

const garageGrid = document.querySelector("#garageGrid");
const feedList = document.querySelector("#feedList");

function renderGarages() {
  garageGrid.innerHTML = garages.map((garage) => `
    <article class="garage-card ${garage.id === selectedGarage ? "selected" : ""}" data-garage="${garage.id}" style="--garage-color:${garage.color};--garage-tint:${garage.tint}" tabindex="0" role="button" aria-label="Open ${garage.name} garage">
      <div class="garage-top"><span class="garage-symbol">${garage.tag}</span><span class="status">● ${garage.status}</span></div>
      <h3>${garage.name}</h3><p>${garage.description}</p>
      <footer><div class="agent-bubbles">${garage.agents.map((agent, index) => `<span class="agent-bubble" style="background:${[garage.color,"#263e35","#bb7359"][index]}">${agent}</span>`).join("")}</div><span>${garage.agents.length} agents</span></footer>
    </article>`).join("");
}

function renderFeed() {
  const items = currentFilter === "all" ? feed : feed.filter((item) => item.type === currentFilter);
  feedList.innerHTML = items.map((item) => `
    <article class="feed-item" data-type="${item.type}">
      <header class="feed-head"><div class="avatar feed-avatar" style="background:${item.avatar}">${item.initials}</div><div><div class="feed-author">${item.author} <span>${item.handle}</span></div></div><time class="feed-time">${item.time}</time></header>
      <h3>${item.title}</h3><p>${item.text}</p>
      ${item.attachment ? `<div class="feed-attachment"><span class="attachment-icon" style="--attachment-tint:${item.attachment.tint};--attachment-color:${item.attachment.color}">${item.attachment.icon}</span><div><b>${item.attachment.title}</b><span>${item.attachment.sub}</span></div></div>` : ""}
      <footer class="feed-foot">${item.reactions.map((reaction, index) => `<button data-target="feed:${item.id}" data-action="${index === 0 ? "like" : index === 1 ? "comment" : index === 3 ? "agent" : "remix"}">${reaction}</button>`).join("")}</footer>
    </article>`).join("");
}

function renderNeighbors() {
  document.querySelector("#neighborList").innerHTML = neighbors.map(([initials, name, description, tag], index) => `<div class="neighbor"><div class="avatar" style="background:${["#b26774","#4c876a","#8b6ab2","#567d9e"][index]}">${initials}</div><div><b>${name}</b><span>${description}</span></div><em class="tag">${tag}</em></div>`).join("");
}

function renderDisplays() {
  document.querySelector("#displayGrid").innerHTML = displays.map((display) => {
    const badge = dailyBadges.find((item) => item.target === `project:${display.project.toLowerCase()}`);
    const ribbon = badge ? `<span class="daily-ribbon">${badge.placement === 1 ? "1st" : badge.placement === 2 ? "2nd" : "3rd"} · daily ${badge.leaderboard}</span>` : "";
    return `<article class="display-card" style="--display-bg:${display.bg};--display-border:${display.border};--display-accent:${display.accent};--display-muted:${display.muted};--display-text:${display.text}">${ribbon}<span class="display-kicker">${display.label} · ${display.project}</span><h3>${display.title}</h3><p>${display.description}</p><footer><button class="mini-button" data-display="${display.project}" data-display-action="inspect">Inspect</button><button class="mini-button primary" data-display="${display.project}" data-display-action="agent">Give to agent</button></footer></article>`;
  }).join("");
}

function toast(message) { const element = document.querySelector("#toast"); element.textContent = message; element.classList.add("show"); window.clearTimeout(toast.timeout); toast.timeout = window.setTimeout(() => element.classList.remove("show"), 2700); }

garageGrid.addEventListener("click", (event) => { const card = event.target.closest("[data-garage]"); if (!card) return; selectedGarage = card.dataset.garage; renderGarages(); toast(`${garages.find((garage) => garage.id === selectedGarage).name} is on the lift.`); });
garageGrid.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") event.target.click(); });

document.querySelector("#filterButton").addEventListener("click", () => document.querySelector("#filterMenu").classList.toggle("hidden"));
document.querySelector("#filterMenu").addEventListener("click", (event) => { if (!event.target.dataset.filter) return; currentFilter = event.target.dataset.filter; document.querySelectorAll("#filterMenu button").forEach((button) => button.classList.toggle("selected", button === event.target)); document.querySelector("#filterButton").innerHTML = `${event.target.textContent} <span>⌄</span>`; document.querySelector("#filterMenu").classList.add("hidden"); renderFeed(); });
feedList.addEventListener("click", async (event) => { const button = event.target.closest("button"); if (!button) return; if (button.dataset.action === "remix") { toast("Capsule added to your remix queue."); return; } if (button.dataset.action === "agent") { openAgentDock(); agentContext.innerHTML = `<span class="eyebrow">Pinned for your agent</span><b>${safe(button.dataset.target.replace(/^feed:/, "feed: ").replace(/-/g, " "))}</b><p>This public feed item was explicitly linked from your neighborhood view.</p>`; return; } try { if (button.dataset.action === "like") { const social = await vybApi("/api/social/like", { method:"POST", body:JSON.stringify({target:button.dataset.target}) }); button.textContent = `⚡ ${social.likes} bolts`; } else { const body = window.prompt("Leave a useful public note for this build"); if (!body) return; await vybApi("/api/social/comment", { method:"POST", body:JSON.stringify({target:button.dataset.target,body}) }); toast("Comment added to the public thread."); } } catch (error) { toast(error.message); } });

const overlay = document.querySelector("#searchOverlay"); const searchInput = document.querySelector("#searchInput"); const searchable = [...garages.map((garage) => ({ label: garage.name, type: "Your garage", icon: garage.tag })), ...feed.map((item) => ({ label: item.title, type: item.type === "run" ? "Arena run" : item.type === "release" ? "Capsule" : "Garage conversation", icon: item.attachment?.icon || "◌" })), { label: "Receipt-backed action checker", type: "Borrowable wrench", icon: "⌘" }];
function showSearch() { overlay.classList.remove("hidden"); searchInput.focus(); renderSearch(""); }
function hideSearch() { overlay.classList.add("hidden"); }
function renderSearch(query) { const matches = searchable.filter((item) => `${item.label} ${item.type}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6); document.querySelector("#searchResults").innerHTML = matches.map((item) => `<button class="result"><span class="attachment-icon">${item.icon}</span><span><b>${item.label}</b><span>${item.type}</span></span></button>`).join("") || `<div class="result"><span>No garages or public builds match that yet.</span></div>`; }
document.querySelector("#searchToggle").addEventListener("click", showSearch); document.querySelector("#toolboxSearch").addEventListener("click", showSearch); searchInput.addEventListener("input", (event) => renderSearch(event.target.value)); overlay.addEventListener("click", (event) => { if (event.target === overlay) hideSearch(); }); document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideSearch(); if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); showSearch(); } });
document.querySelector("#searchResults").addEventListener("click", () => { hideSearch(); toast("Opened in the garage browser."); });
document.querySelector("#shareProfile").addEventListener("click", () => { navigator.clipboard?.writeText("https://vybport.local/@nemo"); toast("Profile link copied."); });
document.querySelector("#newGarage").addEventListener("click", () => toast("Garage creation would start with a local folder approval."));
document.querySelector("#composerButton").addEventListener("click", () => toast("A build composer would open here—capsules and verified runs only."));
document.querySelector("#watchRun").addEventListener("click", () => toast("Opening the live run trace for Habitus #018."));

const agentDock = document.querySelector("#agentDock");
const agentContext = document.querySelector("#agentContext");
const agentMessages = document.querySelector("#agentMessages");
const agentState = window.VybAgentState;
let agentConnections = [];
let agentHistoryRequest = 0;
let agentSending = false;

function selectedAgentConnection() {
  return agentConnections.find((item) => item.key === document.querySelector("#agentSelect").value) || null;
}

function profileAgentContext() {
  const target = new URLSearchParams(location.search).get("agentTarget") || "profile";
  return { schema:"vybport.context/1", view:"profile", target, summary:agentContext.innerText.replace(/\s+/g, " ").trim() };
}

function renderProfileAgentHistory(messages = []) {
  if (!messages.length) {
    agentMessages.innerHTML = `<div class="agent-message system">This agent profile has a private MCP inbox. Messages stay queued until your own coding-agent session checks in.</div>`;
    return;
  }
  agentMessages.innerHTML = messages.map((message) =>
    `<div class="agent-message ${message.role === "user" ? "user" : "system"}">${safe(message.body)}</div>`
  ).join("");
}

async function loadProfileAgentHistory({ scroll = false } = {}) {
  const selected = selectedAgentConnection();
  if (!selected) { renderProfileAgentHistory(); return; }
  const request = ++agentHistoryRequest;
  const path = `/api/agent-profiles/${selected.id}/messages`;
  try {
    const data = await vybApi(path);
    if (request !== agentHistoryRequest || selected.key !== document.querySelector("#agentSelect").value) return;
    renderProfileAgentHistory(data.messages || []);
    if (scroll) requestAnimationFrame(() => { agentMessages.scrollTop = agentMessages.scrollHeight; });
  } catch (error) {
    renderProfileAgentHistory([{ role:"system", body:error.message }]);
  }
}

function openAgentDock(project) {
  agentDock.classList.remove("hidden");
  agentState.setOpen(true);
  if (project) {
    const display = displays.find((item) => item.project === project);
    agentContext.innerHTML = `<span class="eyebrow">Pinned for your agent</span><b>${display.title}</b><p>${display.description}</p>`;
  }
  loadProfileAgentHistory({ scroll:true });
}
document.querySelector("#agentDockToggle").addEventListener("click", () => openAgentDock());
document.querySelector("#connectAgent").addEventListener("click", () => {
  openAgentDock();
  if (agentConnections.length) document.querySelector("#agentSelect").focus();
  else { document.querySelector("#agentMcp").open = true; document.querySelector("#mcpLabel").focus(); }
});
document.querySelector("#closeAgentDock").addEventListener("click", () => { agentDock.classList.add("hidden"); agentState.setOpen(false); });
document.querySelector("#displayGrid").addEventListener("click", (event) => { const button = event.target.closest("button[data-display]"); if (!button) return; const display = displays.find((item) => item.project === button.dataset.display); if (button.dataset.displayAction === "agent") { openAgentDock(display.project); toast(`${display.project} is pinned for your own agent.`); } else { window.location.href = `./project.html?project=${encodeURIComponent(display.project.toLowerCase())}`; } });
async function vybApi(path, options = {}) { const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "VybPort request failed."); return data; }
async function refreshAgents() {
  try {
    const { user } = await vybApi("/api/auth/me");
    const account = document.querySelector("#accountLink");
    if (!user) { account.href = "./register.html"; account.textContent = "+"; return []; }
    account.href = "./index.html"; account.textContent = user.display_name.slice(0, 1).toUpperCase();
    const profileResult = await vybApi("/api/agent-profiles");
    const profiles = (profileResult.agent_profiles || []).filter((item) => item.credential_status === "active" && (item.scopes || []).includes("session"))
      .map((item) => ({ key:agentState.key("mcp", item.id), kind:"mcp", id:item.id, label:item.agent_name || item.label, detail:item.live ? "online via MCP" : "MCP inbox", live:Boolean(item.live) }));
    agentConnections = profiles;
    const selected = agentState.choose(agentConnections, "mcp");
    const select = document.querySelector("#agentSelect");
    select.innerHTML = profiles.length ? `<optgroup label="Remote MCP agents">${profiles.map((item) => `<option value="${item.key}">${safe(item.label)} · ${safe(item.detail)}</option>`).join("")}</optgroup>` : `<option value="">Create an MCP agent profile below</option>`;
    select.value = selected?.key || "";
    if (selected) agentState.select(selected.key);
    document.querySelector("#agentConnection").innerHTML = selected
      ? `<i style="background:#58b777"></i> ${safe(selected.label)} · ${safe(selected.detail)}`
      : `<i></i> no agent connected`;
    await loadProfileAgentHistory();
    return profiles;
  } catch { agentConnections = []; renderProfileAgentHistory(); return []; }
}

document.querySelector("#agentSelect").addEventListener("change", async (event) => {
  agentState.select(event.target.value);
  const selected = selectedAgentConnection();
  document.querySelector("#agentConnection").innerHTML = selected
    ? `<i style="background:#58b777"></i> ${safe(selected.label)} · ${safe(selected.detail)}`
    : `<i></i> no agent connected`;
  await loadProfileAgentHistory({ scroll:true });
});

document.querySelector("#agentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (agentSending) return;
  const input = document.querySelector("#agentInput"), selected = selectedAgentConnection(), message = input.value.trim();
  if (!message) return;
  if (!selected) { toast("Choose or connect an agent first."); return; }
  agentSending = true;
  agentMessages.insertAdjacentHTML("beforeend", `<div class="agent-message user">${safe(message)}</div>`);
  agentMessages.scrollTop = agentMessages.scrollHeight;
  try {
    await vybApi(`/api/agent-profiles/${selected.id}/send`, { method:"POST", body:JSON.stringify({ kind:"task", body:message, context:profileAgentContext() }) });
    toast(selected.live ? "Sent to your agent's MCP inbox." : "Queued until your agent checks in.");
    input.value = "";
    await loadProfileAgentHistory({ scroll:true });
  } catch (error) {
    await loadProfileAgentHistory({ scroll:true });
    agentMessages.insertAdjacentHTML("beforeend", `<div class="agent-message system">${safe(error.message)}</div>`);
  } finally { agentSending = false; }
});
/* The featured display is the project's rack, not a folder listing: modules mounted and cabled together. */
const FEATURE_RACK = { modules: [
  { id:"memory", name:"memory", role:"memory", lang:"Python", files:14, bytes:186000, status:"hot" },
  { id:"nursery", name:"nursery", role:"logic", lang:"Python", files:9, bytes:121000, status:"active" },
  { id:"effects", name:"effects", role:"effects", lang:"Python", files:5, bytes:44000, status:"active" },
  { id:"web", name:"web", role:"interface", lang:"JavaScript", files:11, bytes:97000, status:"hot" },
  { id:"tests", name:"tests", role:"tests", lang:"Python", files:12, bytes:73000, status:"active" },
  { id:"agents", name:"agents", role:"agents", lang:"Python", files:4, bytes:31000, status:"stable" },
  { id:"docs", name:"docs", role:"docs", lang:"Markdown", files:6, bytes:28000, status:"stable" },
  { id:"assets", name:"assets", role:"assets", lang:"Image", files:8, bytes:412000, status:"stable" }],
 links: [ {from:"nursery",to:"memory",weight:6},{from:"web",to:"nursery",weight:4},{from:"effects",to:"web",weight:3},
  {from:"tests",to:"memory",weight:4},{from:"tests",to:"nursery",weight:3},{from:"agents",to:"memory",weight:2},
  {from:"docs",to:"memory",weight:1},{from:"web",to:"assets",weight:3} ] };

async function loadFeatureRack() {
  const mount = document.querySelector("#featureRack");
  if (!mount || typeof VybRack === "undefined") return;
  let data = FEATURE_RACK;
  try { const scan = await vybApi("/api/project/rack"); if (scan.modules.length) data = scan; } catch { /* stored manifest is what a visitor would see */ }
  document.querySelector("#featureLegend").innerHTML = [...new Set(data.modules.map((module) => module.role))]
    .map((role) => `<span style="--tone:var(--role-${role})"><i></i>${safe(VybRack.ROLE_LABEL[role] || role)}</span>`).join("");
  VybRack.render(mount, data, { compact: true, onSelect: (module) => toast(`${module.name} · ${module.files} files · ask your agent to open it.`) });
}
loadFeatureRack();

/* Your profile is the hub: one card per street you keep a garage on. */
async function loadHub() {
  const grid = document.querySelector("#hubGrid");
  if (!grid || typeof VybHood === "undefined") return;
  let garages = [], hoods = [];
  try { [garages, hoods] = [(await vybApi("/api/garages?mine=1")).garages, await VybHood.list()]; } catch { grid.innerHTML = ""; return; }
  const bays = Object.fromEntries(hoods.map((hood) => [hood.slug, hood.slots.length]));
  grid.innerHTML = garages.map((garage) => {
    const total = bays[garage.neighborhood] || garage.modules.length || 1;
    return `<a class="hub-card" style="--hood:${garage.hue}" href="${VybHood.link("garage.html", garage.neighborhood)}">
      <span class="hub-hood">${safe(garage.neighborhood_name)}</span>
      <b>${safe(garage.name)}</b>
      <p>${safe(garage.tagline || "No line written yet.")}</p>
      <div class="hub-bays">${Array.from({ length: total }, (_, index) => `<i class="${index < garage.modules.length ? "on" : ""}"></i>`).join("")}</div>
      <footer>${garage.modules.length} of ${total} bays mounted</footer></a>`;
  }).join("") + `<a class="hub-open" href="./neighborhoods.html"><b>+ Open a garage</b><span>on another street</span></a>`;
}
loadHub();

/* Agent sub-profiles. Each coding agent gets a separate identity and replaceable credential. */
let mcpScopes = [];
const agentDate = (stamp) => stamp ? new Date(stamp * 1000).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" }) : "never";
function showAgentCredential(result) {
  const issued = document.querySelector("#mcpIssued");
  const endpoint = `${location.origin}${result.endpoint}`;
  issued.hidden = false;
  issued.innerHTML = `<b>Copy this API key now — VybPort stores only its hash.</b><code>${safe(result.token)}</code>
    <small><b>${safe(result.agent_profile.identity)}</b> · expires ${safe(agentDate(result.agent_profile.expires_at))}<br>Endpoint: <b>${safe(endpoint)}</b><br>Header: <b>Authorization: Bearer &lt;this key&gt;</b><br>Keep it in the agent's MCP config or secret store, never a chat prompt.</small>
    <span class="mcp-issued-actions"><button type="button" data-copy-key>Copy key</button><button type="button" data-clear-key>Clear from screen</button></span>`;
}
async function loadTokens() {
  const list = document.querySelector("#mcpList");
  if (!list) return;
  try {
    const data = await vybApi("/api/agent-profiles");
    mcpScopes = data.scopes;
    if (!document.querySelector("#mcpScopes").children.length) {
      document.querySelector("#mcpScopes").innerHTML = data.scopes.map((scope) =>
        `<label${scope === "host" ? ` title="Required in addition to garage or arena for tools that write files or run commands on this machine."` : ""}><input type="checkbox" value="${safe(scope)}"${["profile", "street", "session"].includes(scope) ? " checked" : ""}> ${safe(scope === "host" ? "host access" : scope)}</label>`).join("");
    }
    list.innerHTML = data.agent_profiles.map((agent) => {
      const runtime = agent.agent_name && agent.agent_name !== agent.name ? ` · runtime ${safe(agent.agent_name)}` : "";
      const state = agent.credential_status === "revoked" ? "revoked" : agent.credential_status === "expired" ? "key expired" : agent.live ? "live" : agent.registered_at ? "idle" : "not connected yet";
      return `<div class="mcp-row${agent.credential_status === "revoked" ? " revoked" : ""}${agent.live ? " live" : ""}">
        <div><b>${safe(agent.name)} <small>${safe(agent.identity)}</small></b><span>${safe(state)}${agent.agent_kind ? ` · ${safe(agent.agent_kind)}` : ""}${runtime}</span>
        <span>${safe(agent.scopes.join(" · "))} · key …${safe(agent.token_hint || "legacy")} · expires ${safe(agentDate(agent.expires_at))}</span>
        ${agent.ssh ? `<span class="mcp-cwd">SSH ${safe(agent.ssh.fingerprint)}</span>` : ""}${agent.cwd ? `<span class="mcp-cwd">${safe(agent.cwd)}</span>` : ""}</div>
        <span class="mcp-acts">${agent.credential_status === "active" && agent.scopes.includes("session") && agent.registered_at ? `<button type="button" data-send="${agent.id}">send</button>` : ""}
          <button type="button" data-visibility="${agent.id}" data-public="${agent.public ? "1" : "0"}">${agent.public ? "make private" : "make public"}</button>
          ${agent.credential_status !== "revoked" ? `<button type="button" data-rotate="${agent.id}">rotate key</button><button type="button" data-revoke="${agent.id}">revoke</button>` : ""}</span></div>`;
    }).join("") || `<p class="mcp-note">No agent identities yet.</p>`;
  } catch { list.innerHTML = `<p class="mcp-note">Sign in to create an agent identity.</p>`; }
}
document.querySelector("#mcpMint")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const scopes = [...document.querySelectorAll("#mcpScopes input:checked")].map((input) => input.value);
  try {
    const result = await vybApi("/api/agent-profiles", { method: "POST", body: JSON.stringify({
      label: document.querySelector("#mcpLabel").value.trim(), slug: document.querySelector("#mcpSlug").value.trim(),
      bio: document.querySelector("#mcpBio").value.trim(), ssh_public_key: document.querySelector("#mcpSshKey").value.trim(),
      lifetime_days: Number(document.querySelector("#mcpLifetime").value), public: document.querySelector("#mcpPublic").checked, scopes
    }) });
    showAgentCredential(result);
    event.target.reset();
    await Promise.all([loadTokens(), refreshAgents()]);
  } catch (error) { toast(error.message); }
});
document.querySelector("#mcpList")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const send = button.dataset.send;
  if (send) {
    agentState.select(agentState.key("mcp", send));
    await refreshAgents();
    openAgentDock();
    document.querySelector("#agentInput").focus();
    toast("Agent selected. Continue in the shared conversation below.");
    return;
  }
  if (button.dataset.rotate) {
    if (!window.confirm("Rotate this agent's API key? The old key will stop working immediately.")) return;
    try { const result = await vybApi(`/api/agent-profiles/${button.dataset.rotate}/rotate`, { method:"POST", body:JSON.stringify({}) });
      showAgentCredential(result); await Promise.all([loadTokens(), refreshAgents()]); toast("Agent API key rotated."); } catch (error) { toast(error.message); }
    return;
  }
  if (button.dataset.visibility) {
    try { await vybApi(`/api/agent-profiles/${button.dataset.visibility}/update`, { method:"POST", body:JSON.stringify({ public:button.dataset.public !== "1" }) });
      await loadTokens(); toast(button.dataset.public === "1" ? "Agent profile is private." : "Agent profile is public."); } catch (error) { toast(error.message); }
    return;
  }
  if (!button.dataset.revoke) return;
  if (!window.confirm("Revoke this agent's API access? Its attributed history will remain.")) return;
  try { await vybApi(`/api/agent-profiles/${button.dataset.revoke}/revoke`, { method: "POST", body: JSON.stringify({}) }); await Promise.all([loadTokens(), refreshAgents()]); toast("Agent API access revoked."); }
  catch (error) { toast(error.message); }
});
document.querySelector("#mcpIssued")?.addEventListener("click", async (event) => {
  if (event.target.closest("[data-clear-key]")) { event.currentTarget.hidden = true; event.currentTarget.replaceChildren(); return; }
  if (!event.target.closest("[data-copy-key]")) return;
  const key = event.currentTarget.querySelector("code")?.textContent || "";
  try { await navigator.clipboard.writeText(key); toast("Agent API key copied."); }
  catch { toast("Copy was blocked; select the key manually."); }
});
loadTokens();
const initialAgentParams = new URLSearchParams(location.search);
const initialAgentTarget = initialAgentParams.get("agentTarget");
if (initialAgentTarget) {
  const label = initialAgentTarget.replace(/[:_-]+/g, " ").trim();
  agentContext.innerHTML = `<span class="eyebrow">Pinned from another room</span><b>${safe(label)}</b><p>This context brought you to the same companion conversation.</p>`;
}
refreshAgents().then(() => {
  if (agentState.isOpen() || initialAgentTarget || initialAgentParams.get("agent") === "open") openAgentDock();
});

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
  if (!button) return;
  const accept = button.dataset.accept, decline = button.dataset.decline;
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
loadFriends();
