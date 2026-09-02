/* One companion follows the user between VybPort rooms. Conversation bodies live on the
   server; localStorage only remembers which private agent thread is selected and whether
   its drawer was left open. */
(() => {
  const CONNECTION_KEY = "vybport.agent.connection";
  const LEGACY_GARAGE_KEY = "vybport.garage.agent";
  const DOCK_KEY = "vybport.agent.dock";
  const valid = (value) => /^(?:local|mcp):\d+$/.test(String(value || ""));
  const read = (key) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

  function selected() {
    const current = read(CONNECTION_KEY);
    return valid(current) ? current : "";
  }

  function select(value) {
    if (!valid(value)) return "";
    write(CONNECTION_KEY, value);
    write(LEGACY_GARAGE_KEY, value);
    return value;
  }

  function choose(choices, prefer = "local") {
    const remembered = selected();
    return choices.find((choice) => choice.key === remembered)
      || choices.find((choice) => choice.kind === prefer)
      || choices.find((choice) => choice.key === read(LEGACY_GARAGE_KEY))
      || choices[0]
      || null;
  }

  function setOpen(open) { write(DOCK_KEY, open ? "open" : "closed"); }
  function isOpen() { return read(DOCK_KEY) === "open"; }
  function key(kind, id) { return `${kind}:${Number(id)}`; }
  function parse(value) {
    if (!valid(value)) return null;
    const [kind, id] = value.split(":");
    return { kind, id: Number(id), key: value };
  }

  window.VybAgentState = Object.freeze({ selected, select, choose, setOpen, isOpen, key, parse });
})();
