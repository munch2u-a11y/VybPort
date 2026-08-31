const garages = [
  { id: "helix", name: "Helix", tag: "HΞ", color: "#4b755a", tint: "#e2f0e4", description: "Cognitive architecture & action path", agents: ["H", "C", "G"], status: "2 agents awake" },
  { id: "mrag", name: "mRAG", tag: "mR", color: "#406d93", tint: "#e3eff8", description: "Local retrieval & evidence systems", agents: ["M", "Q"], status: "run queued" },
  { id: "fpamb", name: "FP-AMB", tag: "FP", color: "#9a6742", tint: "#f7eadf", description: "First-person agent memory bench", agents: ["F", "A", "C"], status: "3 fresh traces" },
  { id: "habitus", name: "Habitus", tag: "HA", color: "#705aa2", tint: "#eee8f8", description: "Embodied developmental systems", agents: ["H", "N"], status: "curriculum passed" }
];

const feed = [
  { type: "run", author: "Nemo", handle: "@nemo · Habitus", initials: "N", avatar: "linear-gradient(145deg,#e8a17c,#a94f43)", time: "12m", title: "Route-safe Habitus cleared its third recall run", text: "The nursery and imported Helix history are now separated cleanly. Next I’m looking at what changes when evidence routing becomes a real runtime behaviour, not just a graph property.", attachment: { icon: "↗", title: "Memory recall · run #018", sub: "71.2% evidence recall · 3/5 complete", tint: "#e9e3f6", color: "#705aa2" }, reactions: ["♡ 14", "◌ 6", "↗ Remix"] },
  { type: "release", author: "Mira Chen", handle: "@miraflow · Garden Agent", initials: "MC", avatar: "linear-gradient(145deg,#89b8a1,#31736a)", time: "38m", title: "Released a tiny receipt checker for local tool agents", text: "It only does one thing: turns claimed writes into a read-back checklist. Works with Claude Code, Codex, and a plain shell runner. Curious where it breaks for you all.", attachment: { icon: "⌘", title: "receipt-checker v0.1", sub: "Capsule · 14 files · MIT", tint: "#e0f1e7", color: "#28704f" }, reactions: ["♡ 31", "◌ 11", "↗ Borrow wrench"] },
  { type: "question", author: "Orchid Systems", handle: "@orchid · Memory garage", initials: "OS", avatar: "linear-gradient(145deg,#b58bdf,#604292)", time: "1h", title: "How are people handling benchmark drift across agent versions?", text: "We have a system that looks better on the headline score but worse on strict evidence recall. Looking for a compact run-manifest convention before we build our own arena connector.", reactions: ["♡ 8", "◌ 19 replies", "↗ Follow thread"] },
  { type: "run", author: "Rowan", handle: "@rowanbuilds · Patchbay", initials: "R", avatar: "linear-gradient(145deg,#e4af64,#af643b)", time: "2h", title: "A local coding swarm found a regression before merge", text: "Same task, three agents, one shared acceptance contract. The interesting thing is not the success rate—it’s the disagreement trace that found the bug.", attachment: { icon: "✓", title: "Patch reliability · replay", sub: "Verified local run · 4 agents", tint: "#fff0cd", color: "#9a6742" }, reactions: ["♡ 46", "◌ 9", "↗ Watch replay"] }
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
      <footer class="feed-foot">${item.reactions.map((reaction, index) => `<button data-action="${index === 2 ? "remix" : "react"}">${reaction}</button>`).join("")}</footer>
    </article>`).join("");
}

function renderNeighbors() {
  document.querySelector("#neighborList").innerHTML = neighbors.map(([initials, name, description, tag], index) => `<div class="neighbor"><div class="avatar" style="background:${["#b26774","#4c876a","#8b6ab2","#567d9e"][index]}">${initials}</div><div><b>${name}</b><span>${description}</span></div><em class="tag">${tag}</em></div>`).join("");
}

function renderDisplays() {
  document.querySelector("#displayGrid").innerHTML = displays.map((display) => `<article class="display-card" style="--display-bg:${display.bg};--display-border:${display.border};--display-accent:${display.accent};--display-muted:${display.muted};--display-text:${display.text}"><span class="display-kicker">${display.label} · ${display.project}</span><h3>${display.title}</h3><p>${display.description}</p><footer><button class="mini-button" data-display="${display.project}" data-display-action="inspect">Inspect</button><button class="mini-button primary" data-display="${display.project}" data-display-action="agent">Give to agent</button></footer></article>`).join("");
}

function toast(message) { const element = document.querySelector("#toast"); element.textContent = message; element.classList.add("show"); window.clearTimeout(toast.timeout); toast.timeout = window.setTimeout(() => element.classList.remove("show"), 2700); }

garageGrid.addEventListener("click", (event) => { const card = event.target.closest("[data-garage]"); if (!card) return; selectedGarage = card.dataset.garage; renderGarages(); toast(`${garages.find((garage) => garage.id === selectedGarage).name} is on the lift.`); });
garageGrid.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") event.target.click(); });

document.querySelector("#filterButton").addEventListener("click", () => document.querySelector("#filterMenu").classList.toggle("hidden"));
document.querySelector("#filterMenu").addEventListener("click", (event) => { if (!event.target.dataset.filter) return; currentFilter = event.target.dataset.filter; document.querySelectorAll("#filterMenu button").forEach((button) => button.classList.toggle("selected", button === event.target)); document.querySelector("#filterButton").innerHTML = `${event.target.textContent} <span>⌄</span>`; document.querySelector("#filterMenu").classList.add("hidden"); renderFeed(); });
feedList.addEventListener("click", (event) => { const button = event.target.closest("button"); if (!button) return; toast(button.dataset.action === "remix" ? "Capsule added to your remix queue." : "Reaction saved to your activity."); });

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
document.querySelector("#displayGrid").addEventListener("click", (event) => { const button = event.target.closest("button[data-display]"); if (!button) return; const display = displays.find((item) => item.project === button.dataset.display); if (button.dataset.displayAction === "agent") { openAgentDock(display.project); toast(`${display.project} is pinned for your own agent.`); } else { selectedGarage = display.project.toLowerCase() === "mrag" ? "mrag" : display.project.toLowerCase(); renderGarages(); document.querySelector("#garages").scrollIntoView({ behavior:"smooth" }); toast(`Opened ${display.project}'s garage.`); } });
document.querySelector("#agentForm").addEventListener("submit", (event) => { event.preventDefault(); const input = document.querySelector("#agentInput"); const message = input.value.trim(); if (!message) return; agentMessages.insertAdjacentHTML("beforeend", `<div class="agent-message user">${safe(message)}</div><div class="agent-message system">This message is ready, but no terminal agent is paired yet. Pair your own session before VybPort delivers it.</div>`); input.value = ""; agentMessages.scrollTop = agentMessages.scrollHeight; });
document.querySelector("#pairAgent").addEventListener("click", () => toast("Terminal pairing will use a local, user-authorized VybPort connector—not a hosted agent."));

const stageState = document.querySelector("#stageState");
const stageFiles = document.querySelector("#stageFiles");
const stageAll = document.querySelector("#stageAll");
const commitStage = document.querySelector("#commitStage");
let gitStatus = null;

function safe(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]); }
function setBridgeState(label, type) { stageState.className = `stage-state ${type || ""}`; stageState.innerHTML = `<i></i><span>${safe(label)}</span>`; }
function renderStage() {
  if (!gitStatus) return;
  const files = gitStatus.files || [];
  stageFiles.innerHTML = files.length ? files.map((file) => `<label class="stage-file"><input type="checkbox" data-path="${safe(file.path)}" ${file.staged ? "checked" : ""} /><span>${safe(file.path)}</span><em class="file-status ${file.staged ? "staged" : ""}">${file.staged ? "staged" : safe(file.status)}</em></label>`).join("") : `<p class="stage-placeholder">Working tree is clean. Your next capsule starts from a calm floor.</p>`;
  const staged = files.filter((file) => file.staged).length;
  stageAll.disabled = !files.length;
  commitStage.disabled = !staged;
  setBridgeState(`${gitStatus.branch} · ${staged ? `${staged} staged` : "nothing staged"}`, "ready");
}
async function bridge(path, options) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Local bridge request failed.");
  return body;
}
async function refreshGitStatus() {
  try { gitStatus = await bridge("/api/git/status"); renderStage(); }
  catch (error) { gitStatus = null; stageFiles.innerHTML = `<p class="stage-placeholder">Start <code>python3 bridge.py</code> to inspect this workspace’s real Git changes.</p>`; stageAll.disabled = true; commitStage.disabled = true; setBridgeState("Local bridge unavailable", "error"); }
}
stageFiles.addEventListener("change", async (event) => {
  const checkbox = event.target.closest("input[data-path]"); if (!checkbox) return;
  try { await bridge(checkbox.checked ? "/api/git/stage" : "/api/git/unstage", { method:"POST", body: JSON.stringify({ files:[checkbox.dataset.path] }) }); await refreshGitStatus(); toast(checkbox.checked ? "File staged locally." : "File removed from staging."); }
  catch (error) { toast(error.message); await refreshGitStatus(); }
});
document.querySelector("#refreshStage").addEventListener("click", refreshGitStatus);
stageAll.addEventListener("click", async () => { try { await bridge("/api/git/stage", { method:"POST", body: JSON.stringify({ files:gitStatus.files.map((file) => file.path) }) }); await refreshGitStatus(); toast("All workspace changes staged."); } catch (error) { toast(error.message); } });
const commitDialog = document.querySelector("#commitDialog");
commitStage.addEventListener("click", () => { commitDialog.classList.remove("hidden"); document.querySelector("#commitMessage").focus(); });
document.querySelector("#closeCommit").addEventListener("click", () => commitDialog.classList.add("hidden"));
commitDialog.addEventListener("click", (event) => { if (event.target === commitDialog) commitDialog.classList.add("hidden"); });
document.querySelector("#commitForm").addEventListener("submit", async (event) => { event.preventDefault(); const message = document.querySelector("#commitMessage").value.trim(); if (!message) return; try { const result = await bridge("/api/git/commit", { method:"POST", body: JSON.stringify({ message }) }); commitDialog.classList.add("hidden"); event.target.reset(); await refreshGitStatus(); toast(`Commit ${result.commit} created locally.`); } catch (error) { toast(error.message); } });

renderGarages(); renderFeed(); renderNeighbors(); renderDisplays(); refreshGitStatus();
