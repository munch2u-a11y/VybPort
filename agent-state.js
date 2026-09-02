/* One companion follows the user between VybPort rooms. Conversation bodies live on the
   server; localStorage only remembers which private agent thread is selected and whether
   its drawer was left open. */
(() => {
  const CONNECTION_KEY = "vybport.agent.connection";
  const LOCAL_CONNECTION_KEY = "vybport.garage.local-agent";
  const LEGACY_GARAGE_KEY = "vybport.garage.agent";
  const DOCK_KEY = "vybport.agent.dock";
  const valid = (value) => /^(?:local|mcp):\d+$/.test(String(value || ""));
  const validRemote = (value) => /^mcp:\d+$/.test(String(value || ""));
  const validLocal = (value) => /^local:\d+$/.test(String(value || ""));
  const read = (key) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

  function selected() {
    const current = read(CONNECTION_KEY);
    return validRemote(current) ? current : "";
  }

  function selectedLocal() {
    const current = read(LOCAL_CONNECTION_KEY);
    if (validLocal(current)) return current;
    const oldShared = read(CONNECTION_KEY);
    if (validLocal(oldShared)) return oldShared;
    const oldGarage = read(LEGACY_GARAGE_KEY);
    return validLocal(oldGarage) ? oldGarage : "";
  }

  function select(value) {
    if (!valid(value)) return "";
    write(value.startsWith("local:") ? LOCAL_CONNECTION_KEY : CONNECTION_KEY, value);
    write(LEGACY_GARAGE_KEY, value);
    return value;
  }

  function choose(choices, prefer = "mcp") {
    const preferredMemory = prefer === "local" ? selectedLocal() : selected();
    const alternateMemory = prefer === "local" ? selected() : "";
    return choices.find((choice) => choice.key === preferredMemory)
      || choices.find((choice) => choice.kind === prefer)
      || choices.find((choice) => choice.key === alternateMemory)
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

  window.VybAgentState = Object.freeze({ selected, selectedLocal, select, choose, setOpen, isOpen, key, parse });
})();
