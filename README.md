# VybPort prototype

VybPort is a local-first social review workspace for vibecoders and their agents. This prototype includes local accounts, focused garage/project review rooms, a module locker, line-anchored review notes, a Wander street of public garages, a ticketed benchmark arena, a Git-backed staging panel, and a bridge to whichever coding-agent CLI you already run.

No dependencies — Python 3.11+ standard library only, SQLite for storage, no build step, no npm.

## Run

```bash
git clone <this repo> && cd garageyard
python3 server.py
```

Open `http://127.0.0.1:4173` and create a local account. Everything lives in `data/vybport.sqlite3`, which is gitignored; delete it to start clean.

Useful environment variables:

| variable | what it does |
| --- | --- |
| `VYBPORT_HOST` / `VYBPORT_PORT` | where to bind (defaults `127.0.0.1:4173`) |
| `VYBPORT_OWNERS` | comma-separated handles allowed to publish arena benchmarks (default: the first account) |
| `VYBPORT_WORKSPACE_ROOTS` | colon-separated roots under which folders may be paired (default `$HOME`) |
| `VYBPORT_PUBLIC` | `1` turns off everything that runs a command on the host — see "Letting other people try it" |
| `VYBPORT_INVITE` | require this code to register |
| `VYBPORT_SECURE_COOKIES` | `1` marks login cookies `Secure` even outside public mode (public mode does this automatically) |
| `VYBPORT_ALLOWED_ORIGINS` | comma-separated browser origins allowed to call `/mcp` (defaults to the two loopback origins on the configured port) |

## Contributing

It is a prototype and the shape is still moving, so open an issue before a large change. Two things worth knowing:

- **Local-first is the point.** Nothing may reach a remote on the user's behalf, and the Git bridge commits locally only. If a change would send code or credentials anywhere, it needs a much louder design conversation first.
- **The server runs commands people supply** (arena entries, agent adaptors, project tests). That is deliberate for a tool you run on your own machine and switched off in `VYBPORT_PUBLIC` mode. Keep new command paths behind that flag.

Licensed under Apache 2.0 — see `LICENSE`.

## Letting other people try it

Two ways, and they are very different.

**Send them the repo (safest).** Nothing here is a secret — `data/` is gitignored, so no database, sessions or tokens ship. They clone, run `python3 server.py`, and get their own local instance with every feature on. Nothing of yours is exposed at all.

**Host an instance they can reach.** Only in public mode:

```bash
VYBPORT_PUBLIC=1 VYBPORT_INVITE=some-code VYBPORT_OWNERS=yourhandle VYBPORT_HOST=0.0.0.0 python3 server.py
```

Public mode turns off everything that runs a command on, reads a paired workspace from, or writes a checkout to the host — the Git bridge, workspace pairing and garage updates, direct CLI sessions, arena entries, local snapshot publishing, and the MCP tools `garage.checkout`, `garage.test`, `garage.publish_files`, and `arena.arena_preflight`. The `workspace` and `host` MCP grants are stripped from every agent credential. What is left is what you would want strangers to see: accounts, neighborhoods, garages and their deliberately published snapshots, wander, comments and bolts, and the arena as a read-only board.

`VYBPORT_INVITE` gates registration to people you gave the code to. Without it, registration is open.

Public mode also marks session cookies `Secure` and does not grant owner powers to the first person who registers. Set `VYBPORT_OWNERS` explicitly before launch. The first-account owner convenience remains available only on a local instance.

Run it on a machine you do not care about, behind TLS. Even in public mode the service holds real accounts, and it has no rate limiting.

## Local Git boundary

The bridge is deliberately limited to this folder and binds only to `127.0.0.1`. It can:

- read Git status;
- stage or unstage files inside this workspace;
- make a local commit from staged files.

The Git bridge cannot push, clone, access a remote, read arbitrary folders, or publish anything. Module publishing is a separate reviewed action: the owner checks an exact file list, confirms it, and VybPort copies only those bounded text files into an immutable snapshot. A small credential-pattern refusal rail catches obvious mistakes, but it is not a secret-scanning certificate; the human file review remains authoritative.

## Neighborhoods

A neighborhood is a street with a shared rack layout, not a topic tag. Everyone on a street mounts the same bays, so two garages can be read module against module. You keep **one garage per neighborhood**, and your profile is the hub that jumps between them. Each street carries its own wander feed, its own arena, and its own tag vocabulary — proximity in the feed is overlap between your tags and theirs *on that street*, so graph people stand next to graph people and vector people are a block over.

Five streets ship seeded (AI memory systems, AI agent systems, Game & RPG systems, Social & community apps, Marketing & office systems). Anyone signed in can open another from `/neighborhoods.html`, defining its bays as they go.

## Garages stage projects

Think GitHub crossed with Instagram: the point is what you put out, not how you build it. VybPort does not want to be your build tool — you already have a workspace and a setup. It is the staging area between that mess and what people see.

A garage stages as many **projects** as you like; one is the **flagship**, the one a visitor meets first. Inside a project, each of the street's bays holds one **module** — and a bay can have several candidates linked to it: another subfolder, another file, another commit. Swapping which one is mounted is a presentation decision, not a build one. If the paired workspace is a git repo, VybPort lists the commits that touched a module's path so a bay can be pinned to an earlier one.

## The saved locker

A garage is a workshop, not only a display case. In Wander, open a live garage's module picker and save only the modules you want. They land in a persistent locker grouped by their source project and ranked by overlap with the project currently on your lift. Repeat saves merge into the same locker project instead of producing duplicates.

Pull a saved module beside one of yours to compare their metadata and owner-selected files side by side. A checkout writes `BORROWED.md` plus any saved review snapshot under `review-snapshot/<bay>/`; it is deliberately not presented as a full repository clone. Fetch the original repository separately when its owner publishes one.

VybPort never reads through a borrow into its owner's workspace. It copies module metadata without the owner's local `source` or `ref`, plus only immutable code snapshots that owner explicitly published. Later edits in their workspace cannot silently change the version already in your locker.

## Seeing the code, and the agent seeing what you see

The garage keeps one project visually dominant. Click a bay to step into that module; its local files replace the rack instead of extending one long dashboard. Pull a locker module beside it, then click either file to open the themed review window. Code remains read-only, but lines can be selected with click and Shift-click, annotated, edited, resolved, and compared side by side.

Press **Update agent view** to record the exact project, module, file, line range, and optional comparison as your **focus**. `garage.review_context` gives the connected agent the same numbered excerpt and private margin thread; `garage.add_review_note` lets that agent answer in the same margin under its own `@owner/agent` identity. The review window polls for new notes, and notes are marked stale when a live local file no longer matches the hash they were written against.

Once a terminal session or MCP agent profile is connected, a small agent bubble appears in the garage. Its drawer stays usable beside the code-review window, keeps a private VybPort transcript, and attaches the visible project, module, locker comparison, or selected line range to the next message. Linked terminal sessions answer inline. MCP profiles use their existing inbox, so the drawer reports **queued**, **delivered**, and **replied** separately and raises an unread badge when a later reply arrives.

## Workflows

Every project can carry a workflow: steps and the pipes between them, drawn as shop equipment. A person adds steps in order and the layout arranges itself. An agent can place every unit (`column`/`row`), choose each kind (`intake`, `process`, `decision`, `store`, `agent`, `output`, `external`) and label every pipe, including `branch` pipes for the paths off a decision.

## Paired workspaces

Your local folder can be a mess. The garage is the tidy view of it.

Pair a folder (`Pair this folder` on the garage page, or `POST /api/workspaces`), then press **Update from workspace**. VybPort scans the folder, fits what it finds onto the street's bays, and stores it as a snapshot laid over the previous one — the way a commit lies over its parent. Whatever has no bay on that street is listed by name rather than dropped, so a mismatch is visible instead of silent.

Pairing is bounded to `$HOME` by default. Widen or narrow it:

```bash
VYBPORT_WORKSPACE_ROOTS=/home/you/code:/srv/projects python3 server.py
```

## Street layouts

Each neighborhood picks how its rack is drawn — `rack` (shelves of four), `brain` (a lit core with bays branching off it), `console` (stacked instrument panels), `board` (one wide row per bay). Bay *order* is the street's, so a given bay lands in the same place in every garage on it: assets are always bottom-right on a game street, whoever's garage it is. `GET /api/layouts` lists them; the neighborhood form picks one.

## Agent access: one MCP endpoint, one sub-profile per agent

VybPort does not try to know what coding agent you run. It exposes a stateless [Streamable HTTP MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) endpoint at **`/mcp`** (JSON-RPC 2.0, protocol `2025-11-25`; JSON responses, no SSE stream). From **Your agent**, create a distinct agent sub-profile, choose its tool sets and lifetime, then put its one-time API key in that agent's MCP configuration or secret store—not in a chat prompt:

```
Authorization: Bearer vyb_agent_…
```

The client sends `Accept: application/json, text/event-stream`, authenticates initialization with the same bearer key, and sends the negotiated `MCP-Protocol-Version` on later requests. `GET /mcp` returns `405` because this stateless implementation does not offer a server-initiated SSE stream. Browser-origin requests are accepted only from `VYBPORT_ALLOWED_ORIGINS`; non-browser coding-agent clients normally omit `Origin`.

The agent acts as `@your-handle/agent-handle`, linked to but distinct from the human account. It cannot log into the website or mint more credentials. Each identity has its own random API key, scopes, expiry, last-use time, queue, activity attribution, visibility, and revoke/rotate boundary. Rotation keeps the agent profile and its history but invalidates the old key immediately. Up to 25 active agent identities may be attached to one account; keys default to 90 days and may last at most one year.

An optional OpenSSH **public key** can be bound to the identity, and VybPort displays its SHA-256 fingerprint. This is not the MCP credential and the prototype does not run an SSH server: SSH uses a public/private keypair, not an “SSH token.” Generate and keep the private key in the user's own agent environment; paste only the `.pub` line into VybPort. VybPort rejects private keys and never stores one.

Tools are grouped into sets, and a token carries only the sets you tick when minting it:

| set | what it reaches |
| --- | --- |
| `profile` | who the token acts for, which streets they build on |
| `street` | list/read neighborhoods, walk a street sorted by shared tags |
| `garage` | open this profile's garage, use its locker, read shared review context, and exchange line notes |
| `arena` | read the open benchmark and board, run a free preflight |
| `session` | register this agent on the profile, heartbeat, drain the queue the person sends it |
| `social` | read bolts and notes on anything, leave a note (marked as written by the agent), bolt |
| `host` | an additional consent gate for `garage.checkout`, `garage.test`, `garage.publish_files`, and `arena.arena_preflight`; it grants no tools by itself |
| `workspace` | list paired folders, read a rack, update a garage from a folder, `git status`, stage, commit — **never pushes to a remote** |

Anything a person can do on the site, an agent can do through these sets: walk a street, open someone's garage by handle, read what changed there recently, leave a note, or slice the arena board (`top`, an exact `place`, or the places `around` one). A `directory` tool is callable by every token, so an agent can find out what exists and what its own token is missing without being told out of band.

Holding `garage` or `arena` alone is deliberately not permission to execute a command, write a checkout, or publish local files. Host-touching tools require both their ordinary set and the separately selected `host` grant; `VYBPORT_PUBLIC=1` removes that grant and those tools regardless of what is stored on an older credential.

Sessions register themselves: the agent calls `session.register` on startup and appears through its own sub-profile as a live session with its runtime name and kind. The working folder remains owner-only. The person can then send it work from the site, which the agent picks up with `session.inbox` and answers with `session.reply`. MCP is client-initiated, so that is a queue the agent drains rather than a push — the tool result says as much.

`GET /api/mcp/catalog` is the public directory of every currently enabled set and tool, so an agent can discover what exists before it holds a key. API keys are shown once; VybPort stores only a SHA-256 hash and an eight-character hint. The owner-only `GET /api/agent-profiles` lists credential state, while `GET /api/profiles/<handle>/agents` exposes only public agent-profile fields — never scopes, key material, expiry, or working directories.

Spending an arena ticket is deliberately **not** an agent tool. An agent can preflight as often as it likes, but burning the day's ticket stays a person's click.

## Own-agent chat (the other direction)

After creating a local VybPort account, open **Your agent** and either start a session in a detected CLI or link one you already have running. `GET /api/agents/providers` reports which agents this machine actually has on `PATH`.

- **Codex CLI** — `codex exec` to open a thread, `codex exec resume` to continue, `codex queue` to hand over a message without waiting.
- **Claude Code** — `claude -p --output-format json`, resumed by session id.
- **Any other coding agent** — you supply the command your CLI takes. `{session}`, `{message}` and `{output}` are substituted as whole argv items; nothing is passed through a shell.

VybPort sends the linked session only your message and the context card shown in the chat drawer. In a garage that card can include private owner-side project identifiers and a short excerpt of the lines you selected; it does not attach an entire file or paired workspace automatically.

## Project rack

A project is shown as the modules it is made of, not a file tree: each one is mounted in a bay, coloured by what it does (memory, interface, backend logic, effects, tests, assets, agent tooling, config, notes), and cabled to whatever it actually references. Hovering a module lights only its own cables; opening one lists its files and hands it to your agent, which is what reading the source is for.

`GET /api/project/rack?path=<subfolder>` builds that view from a real directory, bounded to this workspace:

- **Modules** are top-level folders, plus families of loose files that share a stem (`wander.html` + `wander.css` + `wander.js` is one module), plus any substantial single file on its own.
- **Role** comes from the folder or stem name where it says something (`memory/`, `effects/`, `backend/`), otherwise from the dominant file type.
- **Cables** are drawn where one module's source textually names another. This finds real references and misses indirect ones — a backend that only defines HTTP routes will not appear wired to the pages that call them.

Pages without access to a local workspace fall back to a stored manifest, which is what a visitor to someone else's profile sees.

## Arena

One benchmark is open at a time, published by whoever runs the instance. Every account gets **one ticket per UTC day**, and a ticket only buys a scored run once the entry has passed preflight — so nothing is charged for a build that could not have been measured fairly in the first place.

Entries are measured through a single contract, `vybport.arena/1`: VybPort hands your run command a fixture path and an output path, and the command writes back one JSON object with an `adaptor` id, a finite `score`, and an optional `detail`.

- **Preflight** (free, unlimited) checks the name, the declared capabilities, that the command resolves on `PATH`, and that it completes the *public sample fixture* with a valid in-range response.
- **Spending the ticket** re-runs preflight, then runs the *held-out fixture*. If the held-out run fails after a clean preflight, the ticket stays spent.
- The board ranks each builder's best scored attempt, top 100. Ties go to whoever reached the score first.
- Closing a period awards its top three a ribbon and keeps them on the podium for the whole of the next period.

Set the owners who may publish and close benchmarks:

```bash
VYBPORT_OWNERS=yourhandle,cohandle python3 server.py
```

With nothing set, the first account created on a local instance owns the arena. A public-mode instance has no implicit owner; set `VYBPORT_OWNERS` explicitly.
