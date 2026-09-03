/* VybPort remote. A phone cannot hold two files side by side, so the workstation's compare becomes a
   switch between two readings of the same bay, and the composer stays on screen everywhere: the
   point of the phone is to keep talking to the session already running on the workstation. Nothing
   here is a second API — every call is one the desktop rooms already make. */
const $ = (selector) => document.querySelector(selector);
const safe = (value) => String(value).replace(/[&<>'"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
const agentState = window.VybAgentState;
const toast = (text) => { const node = $("#toast"); node.textContent = text; node.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 2600); };

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "VybPort request failed.");
  return data;
}

const S = { view: "agent", connections: [], garages: [], garage: null, project: null,
            module: null, file: null, level: "modules", locker: [], compare: { side: "mine", mine: [], theirs: [], file: "" },
            sending: false, poll: 0 };

/* ---- session ------------------------------------------------------------------------------- */
async function boot() {
  let me = null;
  try { me = (await api("/api/auth/me")).user; } catch {}
  $("#gate").hidden = Boolean(me);
  $("#app").hidden = !me;
  if (!me) return;
  await loadConnections();
  await loadGarages();
  render();
  startPolling();
}
$("#gateForm").onsubmit = async (event) => {
  event.preventDefault();
  $("#gateNote").textContent = "";
  try {
    await api("/api/auth/login", { method: "POST", body: JSON.stringify({
      handle: $("#gateHandle").value.trim(), password: $("#gatePassword").value }) });
    boot();
  } catch (error) { $("#gateNote").textContent = error.message; }
};

/* ---- the agent already running on the workstation -------------------------------------------- */
async function loadConnections() {
  const [locals, profiles] = await Promise.all([
    api("/api/agents").then((data) => data.agents || []).catch(() => []),
    api("/api/agent-profiles").then((data) => data.agent_profiles || []).catch(() => []),
  ]);
  /* A profile can only hold a conversation if its credential is live and carries the session scope. */
  S.connections = [
    ...profiles.filter((item) => item.credential_status === "active" && (item.scopes || []).includes("session"))
      .map((item) => ({ kind: "mcp", id: item.id, key: agentState.key("mcp", item.id), label: item.label, detail: item.identity || "MCP agent profile" })),
    ...locals.map((item) => ({ kind: "local", id: item.id, key: agentState.key("local", item.id), label: item.label, detail: item.provider_label || "terminal session" })),
  ];
  const select = $("#connSelect");
  select.innerHTML = S.connections.length
    ? S.connections.map((item) => `<option value="${item.key}">${safe(item.label)} · ${safe(item.detail)}</option>`).join("")
    : `<option value="">No connected agent</option>`;
  const remembered = agentState.selected() || agentState.selectedLocal();
  if (remembered && S.connections.some((item) => item.key === remembered)) select.value = remembered;
  await loadThread();
}
const connection = () => S.connections.find((item) => item.key === $("#connSelect").value) || null;

async function loadThread({ scroll = true } = {}) {
  const active = connection(), thread = $("#thread");
  $("#connNote").textContent = !S.connections.length
    ? "No agent is connected to this account yet. Mint an MCP profile or link a terminal session from the desktop, then it appears here."
    : active?.kind === "mcp"
      ? "This profile has a private MCP inbox. What you send waits there until the agent checks in."
      : "This terminal session answers inline, on the machine it is running on.";
  if (!active) { thread.innerHTML = `<div class="m-empty">Nothing connected.</div>`; return; }
  const path = active.kind === "mcp" ? `/api/agent-profiles/${active.id}/messages` : `/api/agents/${active.id}/history`;
  try {
    const messages = (await api(path)).messages || [];
    thread.innerHTML = messages.length
      ? messages.map((message) => `<div class="m-msg ${message.role === "user" ? "user" : "system"}">${safe(message.body)}</div>`).join("")
      : `<div class="m-empty">Nothing said yet. Whatever you are looking at rides along with your first message.</div>`;
    if (scroll) $(".m-main").scrollTop = $(".m-main").scrollHeight;
  } catch (error) { thread.innerHTML = `<div class="m-empty">${safe(error.message)}</div>`; }
}
$("#connSelect").onchange = () => { agentState.select($("#connSelect").value); loadThread(); };

/* What the phone is looking at, in the shape the desktop rooms already send. */
function context() {
  return { schema: "vybport.context/1", view: "mobile",
    garage: S.garage ? { id: S.garage.id, name: S.garage.name, neighborhood: S.garage.neighborhood } : null,
    project: S.project ? { id: S.project.id, name: S.project.name } : null,
    module: S.module ? { slot: S.module.slot, name: S.module.name } : null,
    file: S.file ? { path: S.file.path } : null };
}
function contextLabel() {
  const parts = [S.project?.name, S.module?.name || S.module?.slot, S.file?.path].filter(Boolean);
  return parts.join(" · ");
}
function renderContext() {
  const label = contextLabel();
  $("#contextBar").hidden = !label;
  $("#contextText").textContent = label;
}
$("#clearContext").onclick = () => { S.module = null; S.file = null; renderContext(); };

$("#compose").onsubmit = async (event) => {
  event.preventDefault();
  const input = $("#composeInput"), message = input.value.trim(), active = connection();
  if (!message || S.sending) return;
  if (!active) { toast("Connect an agent first."); return; }
  S.sending = true; $("#send").disabled = true;
  $("#thread").insertAdjacentHTML("beforeend", `<div class="m-msg user pending">${safe(message)}</div>`);
  $(".m-main").scrollTop = $(".m-main").scrollHeight;
  try {
    if (active.kind === "mcp") {
      await api(`/api/agent-profiles/${active.id}/send`, { method: "POST", body: JSON.stringify({ kind: "task", body: message, context: context() }) });
      toast("Queued in that agent's inbox.");
    } else {
      await api(`/api/agents/${active.id}/message`, { method: "POST", body: JSON.stringify({ mode: "chat", message, context: context() }) });
    }
    input.value = ""; input.style.height = "auto";
    await loadThread();
  } catch (error) { toast(error.message); $("#thread").querySelector(".pending")?.remove(); }
  finally { S.sending = false; $("#send").disabled = false; }
};
$("#composeInput").addEventListener("input", (event) => {
  event.target.style.height = "auto";
  event.target.style.height = `${Math.min(event.target.scrollHeight, window.innerHeight * 0.34)}px`;
});
/* Enter sends; Shift+Enter and the on-screen return key still make a new line. */
$("#composeInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !matchMedia("(pointer: coarse)").matches) {
    event.preventDefault(); $("#compose").requestSubmit();
  }
});

/* An MCP reply lands whenever that agent next checks in, so the thread is re-read while you watch it. */
function startPolling() {
  clearInterval(S.poll);
  S.poll = setInterval(() => {
    if (document.hidden || S.view !== "agent" || S.sending) return;
    loadThread({ scroll: false });
  }, 6000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.view === "agent") loadThread({ scroll: false }); });

/* ---- garage --------------------------------------------------------------------------------- */
async function loadGarages() {
  try { S.garages = (await api("/api/garages?mine=1")).garages || []; } catch { S.garages = []; }
  $("#garageSelect").innerHTML = S.garages.map((garage) =>
    `<option value="${garage.id}">${safe(garage.name)} · ${safe(garage.neighborhood_name)}</option>`).join("")
    || `<option value="">No garage yet</option>`;
  selectGarage(S.garages[0] || null);
}
function selectGarage(garage) {
  S.garage = garage;
  S.locker = (garage?.bench || []).filter((project) => (project.modules || []).length);
  const projects = garage?.projects || (garage?.flagship ? [garage.flagship] : []);
  $("#projectSelect").innerHTML = projects.map((project) =>
    `<option value="${project.id}">${safe(project.name)}${project.flagship ? " · on the lift" : ""}</option>`).join("")
    || `<option value="">No project yet</option>`;
  selectProject(projects.find((project) => project.flagship) || projects[0] || null);
}
function selectProject(project) {
  S.project = project; S.module = null; S.file = null; S.level = "modules";
  renderGarage(); renderComparePickers(); renderContext();
}
$("#garageSelect").onchange = (event) => selectGarage(S.garages.find((garage) => String(garage.id) === event.target.value) || null);
$("#projectSelect").onchange = (event) => {
  const projects = S.garage?.projects || [];
  selectProject(projects.find((project) => String(project.id) === event.target.value) || null);
};

const modulesOf = (project) => (project?.modules || []).slice();

function renderGarage() {
  const list = $("#garageList");
  if (S.level === "modules") {
    const modules = modulesOf(S.project);
    list.innerHTML = modules.length ? modules.map((module) => `
      <button class="m-row" data-slot="${safe(module.slot)}">
        <i></i><div><b>${safe(module.name || module.slot)}</b>
        <small>${safe(module.slot)}${module.lang ? ` · ${safe(module.lang)}` : ""}${module.status ? ` · ${safe(module.status)}` : ""}</small></div>
        <span class="chev">›</span></button>`).join("")
      : `<div class="m-empty">No bays mounted on this project yet.</div>`;
  } else if (S.level === "files") {
    list.innerHTML = (S.files || []).length ? S.files.map((file) => `
      <button class="m-row" data-file="${safe(file.path)}">
        <i></i><div><b>${safe(file.path.split("/").pop())}</b><small>${safe(file.path)}</small></div>
        <span class="chev">›</span></button>`).join("")
      : `<div class="m-empty">Nothing readable in this bay. It may not be pointed at a local folder yet.</div>`;
  } else {
    list.innerHTML = `<div class="m-code">${codeMarkup(S.file?.text || "")}</div>`;
  }
  $("#back").hidden = S.level === "modules";
  $("#topTitle").textContent = S.level === "modules" ? (S.project?.name || "Garage")
    : S.level === "files" ? (S.module?.name || S.module?.slot || "Bay") : (S.file?.path.split("/").pop() || "File");
  $("#topKicker").textContent = S.level === "modules" ? "Project" : S.level === "files" ? "Bay" : "Reading";
}
function codeMarkup(text, marks = null) {
  return String(text).split("\n").map((line, index) => {
    const mark = marks ? marks[index] || "" : "";
    return `<div class="m-line ${mark}"><span>${index + 1}</span><code>${safe(line) || "&nbsp;"}</code></div>`;
  }).join("");
}
$("#garageList").onclick = async (event) => {
  const row = event.target.closest("[data-slot],[data-file]");
  if (!row) return;
  if (row.dataset.slot) {
    S.module = modulesOf(S.project).find((module) => module.slot === row.dataset.slot) || null;
    S.files = []; S.level = "files"; renderGarage(); renderContext();
    try {
      const data = await api(`/api/garages/${S.garage.id}/tree?project=${S.project.id}&source=${encodeURIComponent(S.module.source || "")}`);
      S.files = data.files || [];
    } catch (error) { toast(error.message); }
    renderGarage();
  } else {
    try {
      const data = await api(`/api/garages/${S.garage.id}/file?project=${S.project.id}&source=${encodeURIComponent(row.dataset.file)}`);
      S.file = { path: row.dataset.file, text: data.text || "" };
      S.level = "code"; renderGarage(); renderContext();
      /* Tell the workstation what the phone is reading, so the agent's view follows you. */
      api("/api/focus", { method: "POST", body: JSON.stringify({ context: context() }) }).catch(() => {});
      $(".m-main").scrollTop = 0;
    } catch (error) { toast(error.message); }
  }
};
$("#back").onclick = () => {
  S.level = S.level === "code" ? "files" : "modules";
  if (S.level === "files") S.file = null; else S.module = null;
  renderGarage(); renderContext();
};

/* ---- compare -------------------------------------------------------------------------------- */
function renderComparePickers() {
  $("#mineSelect").innerHTML = modulesOf(S.project).map((module) =>
    `<option value="${safe(module.slot)}">${safe(module.name || module.slot)}</option>`).join("")
    || `<option value="">No bays to compare</option>`;
  const saved = S.locker.flatMap((project) => (project.modules || []).map((module) =>
    ({ project, module })));
  $("#theirsSelect").innerHTML = saved.map(({ project, module }) =>
    `<option value="${project.id}:${safe(module.slot)}">${safe(project.name)} · ${safe(module.name || module.slot)}</option>`).join("")
    || `<option value="">Locker is empty</option>`;
}
async function loadCompare() {
  const mineSlot = $("#mineSelect").value, theirs = $("#theirsSelect").value;
  if (!mineSlot || !theirs) { $("#compareCode").innerHTML = `<div class="m-empty">Save a neighbour's module from the street, then it can be read against yours here.</div>`; $("#swap").hidden = true; $("#fileRow").hidden = true; return; }
  const [projectId, slot] = theirs.split(":");
  const mine = modulesOf(S.project).find((module) => module.slot === mineSlot);
  try {
    const [mineTree, theirFiles] = await Promise.all([
      api(`/api/garages/${S.garage.id}/tree?project=${S.project.id}&source=${encodeURIComponent(mine?.source || "")}`).then((data) => data.files || []).catch(() => []),
      api(`/api/locker/${projectId}/files?slot=${encodeURIComponent(slot)}`).then((data) => data.files || []).catch(() => []),
    ]);
    S.compare = { ...S.compare, mine: mineTree, theirs: theirFiles, projectId, slot, mineSlot };
    /* Files are matched by name, because two people solving the same bay rarely agree on a folder. */
    const names = [...new Set([...mineTree, ...theirFiles].map((file) => file.path.split("/").pop()))];
    $("#fileSelect").innerHTML = names.map((name) => `<option value="${safe(name)}">${safe(name)}</option>`).join("")
      || `<option value="">Nothing published on either side</option>`;
    $("#fileRow").hidden = !names.length;
    $("#swap").hidden = !names.length;
    await showCompareFile();
  } catch (error) { toast(error.message); }
}
async function readSide(side) {
  const name = $("#fileSelect").value;
  const list = side === "mine" ? S.compare.mine : S.compare.theirs;
  const hit = (list || []).find((file) => file.path.split("/").pop() === name);
  if (!hit) return null;
  if (side === "mine") {
    const data = await api(`/api/garages/${S.garage.id}/file?project=${S.project.id}&source=${encodeURIComponent(hit.path)}`);
    return { path: hit.path, text: data.text || "" };
  }
  const data = await api(`/api/locker/${S.compare.projectId}/files?slot=${encodeURIComponent(S.compare.slot)}&path=${encodeURIComponent(hit.path)}`);
  return { path: hit.path, text: (data.file || {}).text || "" };
}
async function showCompareFile() {
  const target = $("#compareCode");
  target.innerHTML = `<div class="m-empty">Reading…</div>`;
  try {
    const side = S.compare.side;
    if (side === "drift") {
      const [mine, theirs] = await Promise.all([readSide("mine"), readSide("theirs")]);
      if (!mine || !theirs) { target.innerHTML = `<div class="m-empty">That file only exists on one side.</div>`; return; }
      /* Not a real diff: it marks lines that do not appear anywhere on the other side, which is
         enough to find where two takes on the same bay actually parted company. */
      const theirLines = new Set(theirs.text.split("\n").map((line) => line.trim()));
      const marks = mine.text.split("\n").map((line) => (line.trim() && !theirLines.has(line.trim()) ? "add" : ""));
      target.innerHTML = codeMarkup(mine.text, marks);
      return;
    }
    const doc = await readSide(side);
    target.innerHTML = doc ? codeMarkup(doc.text) : `<div class="m-empty">Nothing published under that name on this side.</div>`;
    if (doc && side === "mine") { S.file = doc; renderContext(); }
  } catch (error) { target.innerHTML = `<div class="m-empty">${safe(error.message)}</div>`; }
}
$("#mineSelect").onchange = loadCompare;
$("#theirsSelect").onchange = loadCompare;
$("#fileSelect").onchange = showCompareFile;
$("#swap").onclick = (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  S.compare.side = button.dataset.side;
  document.querySelectorAll("#swap button").forEach((other) => other.classList.toggle("active", other === button));
  showCompareFile();
};

/* ---- shell ---------------------------------------------------------------------------------- */
function render() {
  $("#viewAgent").hidden = S.view !== "agent";
  $("#viewGarage").hidden = S.view !== "garage";
  $("#viewCompare").hidden = S.view !== "compare";
  document.querySelectorAll("#tabs button").forEach((button) => button.classList.toggle("active", button.dataset.view === S.view));
  if (S.view === "agent") { $("#topKicker").textContent = "Remote"; $("#topTitle").textContent = connection()?.label || "Your agent"; $("#back").hidden = true; }
  if (S.view === "garage") renderGarage();
  if (S.view === "compare") { $("#topKicker").textContent = "Compare"; $("#topTitle").textContent = "Bay against bay"; $("#back").hidden = true; }
  renderContext();
}
$("#tabs").onclick = (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  S.view = button.dataset.view;
  render();
  if (S.view === "compare") loadCompare();
  if (S.view === "agent") loadThread();
  $(".m-main").scrollTop = 0;
};
$("#refresh").onclick = async () => { await loadConnections(); await loadGarages(); render(); toast("Reloaded."); };

boot();
