"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const values = new Map();
global.window = global;
global.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
};

require("../agent-state.js");

const state = global.VybAgentState;
const choices = [
  { key:"mcp:8", kind:"mcp" },
  { key:"local:3", kind:"local" },
];

assert.equal(state.choose(choices).key, "mcp:8", "the roaming companion should favor the user's MCP session");
assert.equal(state.choose(choices, "local").key, "local:3", "the Garage lift may favor its owner-only CLI session");
values.set("vybport.garage.agent", "mcp:8");
assert.equal(state.choose(choices, "local").key, "local:3", "a stale page-local choice must not hide the lift CLI transcript");
values.delete("vybport.garage.agent");
assert.equal(state.select("mcp:8"), "mcp:8");
assert.equal(state.selected(), "mcp:8");
assert.equal(state.choose(choices).key, "mcp:8", "an explicit choice must survive page navigation");
assert.equal(state.select("local:3"), "local:3");
assert.equal(state.selectedLocal(), "local:3");
assert.equal(state.selected(), "mcp:8", "choosing a lift CLI must not replace the roaming MCP agent");
assert.deepEqual(state.parse("local:3"), { kind:"local", id:3, key:"local:3" });
assert.equal(state.select("not-an-agent"), "", "malformed connection keys are never stored");

state.setOpen(true);
assert.equal(state.isOpen(), true);
state.setOpen(false);
assert.equal(state.isOpen(), false);

for (const [page, script] of [["index.html", "app.js"], ["garage.html", "garage.js"], ["wander.html", "wander.js"], ["project.html", "project.js"]]) {
  const html = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
  assert.ok(html.includes("./agent-state.js"), `${page} must load the shared companion state`);
  assert.ok(html.indexOf("./agent-state.js") < html.indexOf(`./${script}`), `${page} must load companion state before its controller`);
}

for (const script of ["app.js", "wander.js", "project.js"]) {
  const source = fs.readFileSync(path.join(__dirname, "..", script), "utf8");
  assert.ok(!source.includes("/api/agents"), `${script} must use only the roaming MCP inbox`);
}
const garageHtml = fs.readFileSync(path.join(__dirname, "..", "garage.html"), "utf8");
const garageSource = fs.readFileSync(path.join(__dirname, "..", "garage.js"), "utf8");
const rackSource = fs.readFileSync(path.join(__dirname, "..", "rack.js"), "utf8");
assert.ok(garageHtml.includes('id="garageCliBridge"'), "the owner CLI control belongs inside the Garage lift");
assert.ok(garageSource.includes("currentAgentContext()") && garageSource.includes("/api/agents/start"), "Garage CLI launches must carry lift context");
assert.ok(garageHtml.includes('id="moduleLoaderDialog"') && garageHtml.includes('id="baySelection"'), "empty and selected bays need direct project-level controls");
assert.ok(rackSource.includes("addEventListener('dblclick'") && rackSource.includes("application/x-vyb-module"), "rack modules must open on double click and move by drag/drop");
assert.ok(garageSource.includes("/module-candidates") && garageSource.includes("/module-layout"), "Garage must load empty bays and persist module moves");
assert.ok(garageSource.includes("application/x-vyb-locker-module"), "locker modules must drag into adjacent comparison");

const profileHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const profileSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
assert.ok(profileHtml.includes('id="profileCanvas"') && profileHtml.includes('sandbox="allow-scripts"'), "the public profile must be an isolated user-authored canvas");
assert.ok(profileHtml.includes('id="profileSettingsDialog"') && !profileHtml.includes('id="garageGrid"'), "project organization belongs in Garage, outside the public profile");
assert.ok(profileSource.includes("/api/profile/page") && profileSource.includes("'appearance'"), "owners and appearance-scoped agents must be able to update the public page");

const wanderHtml = fs.readFileSync(path.join(__dirname, "..", "wander.html"), "utf8");
const wanderSource = fs.readFileSync(path.join(__dirname, "..", "wander.js"), "utf8");
assert.ok(wanderHtml.includes('id="streetPrev"') && wanderHtml.includes('id="streetNext"'), "Wander must expose visible street controls");
assert.ok(wanderSource.includes("addEventListener('wheel'") && wanderSource.includes("addEventListener('pointermove'"), "Wander must support wheel and grab-to-drag movement");
assert.ok(wanderSource.includes("walkStreet(event.key==='ArrowLeft'?-1:1)"), "Wander must support keyboard arrow movement");
assert.ok(wanderSource.includes("directBuilder") && profileSource.includes("owner?'./garage.html'"), "profile frame garage links must open the owner's lift or locate a visitor's garage");

console.log("agent companion state persists selection and drawer continuity");
