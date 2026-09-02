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
document.querySelector("#connectAgent").addEventListener("click", () => toast("Agent pairing is ready for a local bridge connection."));
document.querySelector("#shareProfile").addEventListener("click", () => { navigator.clipboard?.writeText("https://vybport.local/@nemo"); toast("Profile link copied."); });
document.querySelector("#newGarage").addEventListener("click", () => toast("Garage creation would start with a local folder approval."));
document.querySelector("#composerButton").addEventListener("click", () => toast("A build composer would open here—capsules and verified runs only."));
document.querySelector("#watchRun").addEventListener("click", () => toast("Opening the live run trace for Habitus #018."));

const agentDock = document.querySelector("#agentDock");
const agentContext = document.querySelector("#agentContext");
const agentMessages = document.querySelector("#agentMessages");
function openAgentDock(project) { agentDock.classList.remove("hidden"); if (project) { const display = displays.find((item) => item.project === project); agentContext.innerHTML = `<span class="eyebrow">Pinned for your agent</span><b>${display.title}</b><p>${display.description}</p>`; } }
document.querySelector("#agentDockToggle").addEventListener("click", () => openAgentDock());
document.querySelector("#closeAgentDock").addEventListener("click", () => agentDock.classList.add("hidden"));
document.querySelector("#displayGrid").addEventListener("click", (event) => { const button = event.target.closest("button[data-display]"); if (!button) return; const display = displays.find((item) => item.project === button.dataset.display); if (button.dataset.displayAction === "agent") { openAgentDock(display.project); toast(`${display.project} is pinned for your own agent.`); } else { window.location.href = `./project.html?project=${encodeURIComponent(display.project.toLowerCase())}`; } });
async function vybApi(path, options = {}) { const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "VybPort request failed."); return data; }
async function refreshAgents() { try { const { user } = await vybApi("/api/auth/me"); const account = document.querySelector("#accountLink"); if (!user) { account.href = "./register.html"; account.textContent = "+"; return []; } account.href = "./index.html"; account.textContent = user.display_name.slice(0, 1).toUpperCase(); const { agents } = await vybApi("/api/agents"); const select = document.querySelector("#agentSelect"); select.innerHTML = `<option value="">Choose a linked session</option>${agents.map((agent) => `<option value="${agent.id}">${safe(agent.label)} · ${safe(agent.provider_label || agent.provider)}</option>`).join("")}`; document.querySelector("#agentConnection").innerHTML = agents.length ? `<i style="background:#58b777"></i> ${agents.length} linked terminal session${agents.length === 1 ? "" : "s"}` : `<i></i> terminal session not paired`; return agents; } catch { return []; } }
document.querySelector("#agentForm").addEventListener("submit", async (event) => { event.preventDefault(); const input = document.querySelector("#agentInput"), agentId = document.querySelector("#agentSelect").value, message = input.value.trim(); if (!message) return; if (!agentId) { toast("Choose or pair a local coding-agent session first."); return; } const packet = agentContext.innerText.replace(/\s+/g, " ").trim(); agentMessages.insertAdjacentHTML("beforeend", `<div class="agent-message user">${safe(message)}</div>`); try { const result = await vybApi(`/api/agents/${agentId}/message`, { method: "POST", body: JSON.stringify({ mode:"chat", message: `VybPort context packet:\n${packet}\n\nUser message:\n${message}` }) }); agentMessages.insertAdjacentHTML("beforeend", `<div class="agent-message system">${safe(result.reply)}</div>`); input.value = ""; } catch (error) { agentMessages.insertAdjacentHTML("beforeend", `<div class="agent-message system">${safe(error.message)}</div>`); } agentMessages.scrollTop = agentMessages.scrollHeight; });
async function agentProviders() { try { return (await vybApi("/api/agents/providers")).providers; } catch { return []; } }
function chooseProvider(options, question) { if (!options.length) { toast("No coding agent is available to link."); return null; } if (options.length === 1) return options[0]; const menu = options.map((item, index) => `${index + 1}. ${item.label}${item.binary && !item.detected ? " (not on PATH)" : ""}`).join("\n"); const picked = window.prompt(`${question}\n\n${menu}`, "1"); if (!picked) return null; const provider = options[Number(picked) - 1]; if (!provider) { toast("Pick one of the listed numbers."); return null; } return provider; }
document.querySelector("#pairAgent").addEventListener("click", async () => { const me = await vybApi("/api/auth/me"); if (!me.user) { location.href = "./register.html"; return; } const provider = chooseProvider(await agentProviders(), "Which coding agent is this session running in?"); if (!provider) return; const label = window.prompt(`Name this ${provider.label} session (for example, ${provider.label} · Habitus)`); if (!label) return; const thread_id = window.prompt(`Paste the exact ${provider.id_label} to link`); if (!thread_id) return; let command = ""; if (provider.needs_command) { command = window.prompt(`Command VybPort should run.\n{session}, {message} and {output} are filled in as whole arguments.`, "my-agent --resume {session} {message}") || ""; } try { await vybApi("/api/agents", { method:"POST", body:JSON.stringify({ provider: provider.key, label, thread_id, command }) }); await refreshAgents(); toast(`${label} linked.`); } catch (error) { toast(error.message); } });
document.querySelector("#startAgent").addEventListener("click", async () => { const me = await vybApi("/api/auth/me"); if (!me.user) { location.href = "./register.html"; return; } const provider = chooseProvider((await agentProviders()).filter((item) => item.starts && item.detected), "Which coding agent should VybPort open a session in?"); if (!provider) return; const packet = agentContext.innerText.replace(/\s+/g, " ").trim(); const input = document.querySelector("#agentInput"); const prompt = input.value.trim() || "Introduce yourself briefly and tell me how you can help inspect this VybPort item."; try { toast(`Opening a ${provider.label} session…`); const result = await vybApi("/api/agents/start", { method:"POST", body:JSON.stringify({ provider: provider.key, message:`VybPort context packet:\n${packet}\n\nUser message:\n${prompt}` }) }); await refreshAgents(); document.querySelector("#agentSelect").value = result.agent.id; agentMessages.insertAdjacentHTML("beforeend", `<div class="agent-message system">${safe(result.reply)}</div>`); input.value = ""; agentMessages.scrollTop = agentMessages.scrollHeight; toast(`${result.agent.label} linked.`); } catch (error) { agentMessages.insertAdjacentHTML("beforeend", `<div class="agent-message system">${safe(error.message)}</div>`); toast(error.message); } });

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

/* Agent tokens. VybPort stops guessing at CLIs: any MCP agent connects through the profile instead. */
let mcpScopes = [];
async function loadTokens() {
  const list = document.querySelector("#mcpList");
  if (!list) return;
  try {
    const data = await vybApi("/api/agent-tokens");
    mcpScopes = data.scopes;
    if (!document.querySelector("#mcpScopes").children.length) {
      document.querySelector("#mcpScopes").innerHTML = data.scopes.map((scope) =>
        `<label><input type="checkbox" value="${safe(scope)}"${scope === "profile" || scope === "street" ? " checked" : ""}> ${safe(scope)}</label>`).join("");
    }
    list.innerHTML = data.tokens.map((token) => {
      const named = token.agent_name || token.label;
      const state = token.revoked_at ? "revoked" : token.live ? "live" : token.registered_at ? "idle" : "not connected yet";
      return `<div class="mcp-row${token.revoked_at ? " revoked" : ""}${token.live ? " live" : ""}">
        <div><b>${safe(named)}</b><span>${safe(state)}${token.agent_kind ? ` · ${safe(token.agent_kind)}` : ""} · ${token.scopes.join(" ")}${token.open_messages ? ` · ${token.open_messages} waiting` : ""}</span>
        ${token.cwd ? `<span class="mcp-cwd">${safe(token.cwd)}</span>` : ""}</div>
        ${token.revoked_at ? "<span>revoked</span>"
          : `<span class="mcp-acts">${token.scopes.includes("session") && token.registered_at ? `<button type="button" data-send="${token.id}">send</button>` : ""}<button type="button" data-revoke="${token.id}">revoke</button></span>`}</div>`;
    }).join("") || `<p class="mcp-note">No agent tokens yet.</p>`;
  } catch { list.innerHTML = `<p class="mcp-note">Sign in to mint an agent token.</p>`; }
}
document.querySelector("#mcpMint")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const scopes = [...document.querySelectorAll("#mcpScopes input:checked")].map((input) => input.value);
  try {
    const result = await vybApi("/api/agent-tokens", { method: "POST", body: JSON.stringify({ label: document.querySelector("#mcpLabel").value.trim(), scopes }) });
    const issued = document.querySelector("#mcpIssued");
    issued.hidden = false;
    issued.innerHTML = `<b>Copy this now — it is not stored anywhere you can read it again.</b><code>${safe(result.token)}</code>
      <small>Point your agent at <b>POST http://127.0.0.1:4173/mcp</b> with <b>Authorization: Bearer</b> that token. Sets: ${safe(result.scopes.join(", "))}.</small>`;
    document.querySelector("#mcpLabel").value = "";
    await loadTokens();
  } catch (error) { toast(error.message); }
});
document.querySelector("#mcpList")?.addEventListener("click", async (event) => {
  const send = event.target.dataset?.send;
  if (send) {
    const body = window.prompt("What should this agent go and do?");
    if (!body) return;
    try { const result = await vybApi(`/api/agent-tokens/${send}/send`, { method: "POST", body: JSON.stringify({ body }) });
      toast(result.note); await loadTokens(); } catch (error) { toast(error.message); }
    return;
  }
  const id = event.target.dataset?.revoke;
  if (!id) return;
  try { await vybApi("/api/agent-tokens/revoke", { method: "POST", body: JSON.stringify({ id: Number(id) }) }); await loadTokens(); toast("Token revoked."); }
  catch (error) { toast(error.message); }
});
loadTokens();
