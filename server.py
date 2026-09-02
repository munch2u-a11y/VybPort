"""Local-only VybPort prototype service.

It owns local registration/session state, social interactions, arena fixtures,
Git staging, and a provider-agnostic adapter for whichever coding-agent CLI the
person already runs. Nothing in this server opens a remote listener, publishes a
workspace, or reads outside this project.
"""
from __future__ import annotations

import base64
import errno
import hashlib
import json
import os
import re
import secrets
import shlex
import shutil
import sqlite3
import subprocess
import tempfile
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATABASE = DATA_DIR / "vybport.sqlite3"
HOST = os.environ.get("VYBPORT_HOST", "127.0.0.1")
PORT = int(os.environ.get("VYBPORT_PORT", "4173"))
HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,31}$")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,47}$")
# The one contract every arena entry is measured through, so no run gets a bespoke harness.
ARENA_ADAPTOR = "vybport.arena/1"
PREFLIGHT_TIMEOUT, SCORED_TIMEOUT = 60, 240
# Whoever runs this instance publishes the benchmarks. Set VYBPORT_OWNERS=handle,handle to be explicit;
# with nothing set, the first account created on the machine owns the arena.
# Only these get served as files. Everything else — the database, the source, dotfiles, directory
# listings — is not web-readable, whether or not the port is only on loopback.
STATIC_SUFFIXES = {".html", ".css", ".js", ".jpg", ".jpeg", ".png", ".webp", ".svg", ".ico", ".woff2"}
STATIC_DIRS = {"images", "skins"}
# Hardened mode for an instance other people can reach. Everything that runs a command is off.
PUBLIC_MODE = os.environ.get("VYBPORT_PUBLIC") == "1"
INVITE_CODE = os.environ.get("VYBPORT_INVITE", "").strip()
OWNER_HANDLES = {handle.strip().lower() for handle in os.environ.get("VYBPORT_OWNERS", "").split(",") if handle.strip()}
TARGET_RE = re.compile(r"^[a-z0-9][a-z0-9:_-]{1,95}$")


# A neighbourhood is a street with a shared rack layout: every garage on it fills the same bays,
# so two projects can be read module against module instead of README against README.
RACK_ROLES = {"memory", "interface", "logic", "effects", "tests", "config", "docs", "assets", "agents"}


def slot(key: str, label: str, role: str, hint: str) -> dict[str, str]:
    return {"key": key, "label": label, "role": role, "hint": hint}


STARTER_NEIGHBORHOODS = [
    ("memory-systems", "AI memory systems", "Recall, evidence, and what a system can prove it remembers.", 172, "brain", [
        slot("ingest", "Ingest", "logic", "How material enters the system"),
        slot("index", "Index", "memory", "How it is organised for lookup"),
        slot("retrieval", "Retrieval", "memory", "How a question finds an answer"),
        slot("evaluation", "Evaluation", "tests", "How recall is measured"),
        slot("storage", "Storage", "memory", "Where it durably lives"),
        slot("interface", "Interface", "interface", "How a person or agent reads it"),
    ], ["graph", "vector", "episodic", "semantic", "receipts", "local-first", "long-context"]),
    ("agent-systems", "AI agent systems", "Planners, tool use, and agents that leave a trace.", 265, "console", [
        slot("planner", "Planner", "logic", "How work is decided"),
        slot("tools", "Tools", "agents", "What it can reach for"),
        slot("memory", "Memory", "memory", "What it carries between turns"),
        slot("runtime", "Runtime", "logic", "How a turn actually executes"),
        slot("evaluation", "Evaluation", "tests", "How behaviour is checked"),
        slot("interface", "Interface", "interface", "How a person steers it"),
    ], ["multi-agent", "tool-use", "coding-agents", "traces", "sandboxing", "local-models", "evals"]),
    ("game-systems", "Game & RPG systems", "Worlds, quests, combat, and the systems underneath them.", 22, "rack", [
        slot("world", "World", "logic", "Space, levels, simulation"),
        slot("entities", "Entities", "logic", "Actors, items, components"),
        slot("quests", "Quests", "logic", "Objectives, dialogue, progression"),
        slot("combat", "Combat", "effects", "Encounters and feel"),
        slot("ui", "UI", "interface", "HUD, menus, input"),
        slot("assets", "Assets", "assets", "Art, audio, data tables"),
    ], ["quests", "combat", "procgen", "dialogue", "inventory", "netcode", "pixel-art", "3d"]),
    ("social-apps", "Social & community apps", "Feeds, identity, and keeping a room worth being in.", 205, "board", [
        slot("identity", "Identity", "logic", "Accounts, profiles, trust"),
        slot("feed", "Feed", "logic", "What surfaces and why"),
        slot("moderation", "Moderation", "tests", "How the room stays liveable"),
        slot("notifications", "Notifications", "effects", "How people are pulled back"),
        slot("interface", "Interface", "interface", "The client itself"),
        slot("storage", "Storage", "memory", "Where posts and graph live"),
    ], ["federation", "moderation", "ranking", "mobile", "realtime", "privacy", "small-web"]),
    ("ops-systems", "Marketing & office systems", "Intake, workflow, and the reporting someone actually reads.", 128, "board", [
        slot("intake", "Intake", "logic", "How work arrives"),
        slot("workflow", "Workflow", "logic", "How it moves through stages"),
        slot("integrations", "Integrations", "agents", "What it talks to"),
        slot("reporting", "Reporting", "tests", "What gets measured"),
        slot("interface", "Interface", "interface", "The console people use"),
        slot("storage", "Storage", "memory", "Records and history"),
    ], ["crm", "automation", "analytics", "email", "scheduling", "self-hosted", "no-code"]),
]


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    DATA_DIR.mkdir(mode=0o700, exist_ok=True)
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY, handle TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
                bio TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
                expires_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS agents (
                id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, provider TEXT NOT NULL,
                label TEXT NOT NULL, thread_id TEXT NOT NULL, created_at INTEGER NOT NULL,
                UNIQUE(user_id, provider, thread_id), FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS likes (
                user_id INTEGER NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL,
                PRIMARY KEY(user_id, target), FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY, target TEXT NOT NULL, user_id INTEGER NOT NULL,
                body TEXT NOT NULL, via TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS arena_runs (
                slug TEXT PRIMARY KEY, title TEXT NOT NULL, system_name TEXT NOT NULL,
                suite TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL,
                phase TEXT NOT NULL, updated_at INTEGER NOT NULL, public INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS daily_badges (
                day TEXT NOT NULL, target TEXT NOT NULL, leaderboard TEXT NOT NULL,
                placement INTEGER NOT NULL CHECK(placement BETWEEN 1 AND 3),
                PRIMARY KEY(day, target, leaderboard)
            );
            CREATE TABLE IF NOT EXISTS agent_tokens (
                id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, label TEXT NOT NULL,
                token_hash TEXT UNIQUE NOT NULL, scopes TEXT NOT NULL, created_at INTEGER NOT NULL,
                last_used_at INTEGER, revoked_at INTEGER,
                agent_name TEXT NOT NULL DEFAULT '', agent_kind TEXT NOT NULL DEFAULT '',
                agent_version TEXT NOT NULL DEFAULT '', cwd TEXT NOT NULL DEFAULT '',
                registered_at INTEGER, heartbeat_at INTEGER,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS agent_messages (
                id INTEGER PRIMARY KEY, token_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
                kind TEXT NOT NULL DEFAULT 'task', body TEXT NOT NULL, context TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL, delivered_at INTEGER, reply TEXT, replied_at INTEGER,
                FOREIGN KEY(token_id) REFERENCES agent_tokens(id)
            );
            CREATE TABLE IF NOT EXISTS workspaces (
                id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, label TEXT NOT NULL, path TEXT NOT NULL,
                created_at INTEGER NOT NULL, scanned_at INTEGER,
                UNIQUE(user_id, path), FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS garage_snapshots (
                id INTEGER PRIMARY KEY, garage_id INTEGER NOT NULL, workspace_id INTEGER,
                taken_at INTEGER NOT NULL, summary TEXT NOT NULL DEFAULT '',
                modules TEXT NOT NULL, links TEXT NOT NULL DEFAULT '[]',
                FOREIGN KEY(garage_id) REFERENCES garages(id)
            );
            CREATE TABLE IF NOT EXISTS neighborhoods (
                id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
                tagline TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', hue INTEGER NOT NULL DEFAULT 200,
                slots TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', layout TEXT NOT NULL DEFAULT 'rack',
                created_by INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS garages (
                id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, neighborhood_id INTEGER NOT NULL,
                name TEXT NOT NULL, tagline TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
                display TEXT NOT NULL DEFAULT '', workspace_id INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                UNIQUE(user_id, neighborhood_id),
                FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(neighborhood_id) REFERENCES neighborhoods(id)
            );
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY, garage_id INTEGER NOT NULL, name TEXT NOT NULL,
                tagline TEXT NOT NULL DEFAULT '', flagship INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL DEFAULT 'own', origin_handle TEXT NOT NULL DEFAULT '',
                origin_project INTEGER, origin_repo TEXT NOT NULL DEFAULT '',
                test_command TEXT NOT NULL DEFAULT '', test_result TEXT NOT NULL DEFAULT '', tested_at INTEGER,
                checkout_path TEXT NOT NULL DEFAULT '',
                workspace_id INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                FOREIGN KEY(garage_id) REFERENCES garages(id)
            );
            CREATE TABLE IF NOT EXISTS module_variants (
                id INTEGER PRIMARY KEY, garage_id INTEGER NOT NULL, project_id INTEGER, slot TEXT NOT NULL,
                label TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '',
                lang TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active', weight INTEGER NOT NULL DEFAULT 1,
                active INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
                FOREIGN KEY(garage_id) REFERENCES garages(id)
            );
            CREATE TABLE IF NOT EXISTS focus (
                user_id INTEGER PRIMARY KEY, label TEXT NOT NULL DEFAULT '', context TEXT NOT NULL DEFAULT '{}',
                note TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS workflows (
                project_id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Workflow',
                notes TEXT NOT NULL DEFAULT '', nodes TEXT NOT NULL DEFAULT '[]', edges TEXT NOT NULL DEFAULT '[]',
                updated_at INTEGER NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id)
            );
            CREATE TABLE IF NOT EXISTS garage_modules (
                id INTEGER PRIMARY KEY, garage_id INTEGER NOT NULL, project_id INTEGER, slot TEXT NOT NULL,
                name TEXT NOT NULL, lang TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active', weight INTEGER NOT NULL DEFAULT 1,
                UNIQUE(project_id, slot), FOREIGN KEY(garage_id) REFERENCES garages(id)
            );
            CREATE TABLE IF NOT EXISTS benchmarks (
                id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
                neighborhood_id INTEGER NOT NULL DEFAULT 1,
                summary TEXT NOT NULL DEFAULT '', metric TEXT NOT NULL DEFAULT 'score',
                adaptor TEXT NOT NULL, score_max REAL NOT NULL DEFAULT 100,
                cadence TEXT NOT NULL DEFAULT 'manual', capabilities TEXT NOT NULL DEFAULT '[]',
                sample_fixture TEXT NOT NULL, scored_fixture TEXT NOT NULL,
                opened_at INTEGER NOT NULL, closed_at INTEGER, created_by INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS arena_entries (
                id INTEGER PRIMARY KEY, benchmark_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
                system_name TEXT NOT NULL, command TEXT NOT NULL, score REAL,
                detail TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, created_at INTEGER NOT NULL,
                FOREIGN KEY(benchmark_id) REFERENCES benchmarks(id), FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS arena_tickets (
                user_id INTEGER NOT NULL, neighborhood_id INTEGER NOT NULL, day TEXT NOT NULL,
                benchmark_id INTEGER NOT NULL, entry_id INTEGER, spent_at INTEGER NOT NULL,
                PRIMARY KEY(user_id, neighborhood_id, day), FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE INDEX IF NOT EXISTS arena_entries_board ON arena_entries(benchmark_id, score DESC);
            """
        )
        connection.execute(
            """INSERT OR IGNORE INTO arena_runs(slug,title,system_name,suite,status,progress,phase,updated_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            ("fp-amb-local-001", "Action-memory reliability", "FP-AMB", "FP-AMB candidate fixture", "running", 62, "replaying held-out action traces", int(time.time())),
        )
        connection.execute(
            """INSERT OR IGNORE INTO arena_runs(slug,title,system_name,suite,status,progress,phase,updated_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            ("habitus-curriculum-048", "Developmental curriculum", "Habitus", "receipt-backed curriculum", "verified", 100, "artifact read-back complete", int(time.time()) - 7200),
        )
        for slug, name, tagline, hue, layout, slots, tags in STARTER_NEIGHBORHOODS:
            connection.execute(
                """INSERT OR IGNORE INTO neighborhoods(slug,name,tagline,summary,hue,slots,tags,layout,created_by,created_at)
                   VALUES(?,?,?,?,?,?,?,?,0,?)""",
                (slug, name, tagline, tagline, hue, json.dumps(slots), json.dumps(tags), layout, int(time.time())),
            )
        connection.execute(
            """INSERT OR IGNORE INTO benchmarks(slug,title,neighborhood_id,summary,metric,adaptor,score_max,cadence,capabilities,sample_fixture,scored_fixture,opened_at,closed_at,created_by)
               VALUES(?,?,(SELECT id FROM neighborhoods WHERE slug='memory-systems'),?,?,?,?,?,?,?,?,?,NULL,0)""",
            ("fp-amb-s1", "FP-AMB · action-memory reliability",
             "Replay held-out action traces and report how much of the evidence route the system actually recovers.",
             "evidence recall", ARENA_ADAPTOR, 100.0, "weekly",
             json.dumps(["evidence-route", "trace-log"]),
             json.dumps({"fixture": "fp-amb-sample", "cases": [{"id": "s1", "trace": ["LOOK", "DO"]}]}),
             json.dumps({"fixture": "fp-amb-held-out", "cases": [{"id": "h1", "trace": ["LOOK", "DO", "SPEAK"]}, {"id": "h2", "trace": ["DO", "SPEAK"]}]}),
             int(time.time())),
        )
        today = time.strftime("%Y-%m-%d", time.gmtime())
        connection.executemany(
            "INSERT OR IGNORE INTO daily_badges(day,target,leaderboard,placement) VALUES(?,?,?,?)",
            [
                (today, "project:habitus", "Evidence relay", 2),
                (today, "project:helix", "Workbench signal", 1),
                (today, "project:mrag", "Retrieval circuit", 3),
                (today, "garage:patchbay", "Workbench signal", 2),
                (today, "garage:orchid", "Retrieval circuit", 1),
            ],
        )


        # Agents linked before providers were pluggable have no command template of their own.
        if "command" not in {row["name"] for row in connection.execute("PRAGMA table_info(agents)")}:
            connection.execute("ALTER TABLE agents ADD COLUMN command TEXT NOT NULL DEFAULT ''")
        for table, column, definition in (
            ("agent_tokens", "agent_name", "TEXT NOT NULL DEFAULT ''"), ("agent_tokens", "agent_kind", "TEXT NOT NULL DEFAULT ''"),
            ("agent_tokens", "agent_version", "TEXT NOT NULL DEFAULT ''"), ("agent_tokens", "cwd", "TEXT NOT NULL DEFAULT ''"),
            ("agent_tokens", "registered_at", "INTEGER"), ("agent_tokens", "heartbeat_at", "INTEGER"),
            ("neighborhoods", "layout", "TEXT NOT NULL DEFAULT 'rack'"), ("garages", "workspace_id", "INTEGER"),
            ("comments", "via", "TEXT NOT NULL DEFAULT ''"),
            ("garage_modules", "source", "TEXT NOT NULL DEFAULT ''"), ("garage_modules", "ref", "TEXT NOT NULL DEFAULT ''"),
            ("garage_modules", "project_id", "INTEGER"), ("module_variants", "project_id", "INTEGER"),
            ("garage_snapshots", "project_id", "INTEGER"),
            ("projects", "kind", "TEXT NOT NULL DEFAULT 'own'"), ("projects", "origin_handle", "TEXT NOT NULL DEFAULT ''"),
            ("projects", "origin_project", "INTEGER"), ("projects", "origin_repo", "TEXT NOT NULL DEFAULT ''"),
            ("projects", "test_command", "TEXT NOT NULL DEFAULT ''"), ("projects", "test_result", "TEXT NOT NULL DEFAULT ''"),
            ("projects", "tested_at", "INTEGER"), ("projects", "checkout_path", "TEXT NOT NULL DEFAULT ''"),
        ):
            if column not in {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}:
                connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        # garage_modules was created when a garage held exactly one set of bays, so it carries
        # UNIQUE(garage_id, slot). A garage now stages several projects that each fill the same bays,
        # and ALTER TABLE cannot drop a constraint — so rebuild the table when the old one is there.
        existing = connection.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='garage_modules'").fetchone()
        if existing and "UNIQUE(garage_id, slot)" in existing["sql"]:
            connection.execute("ALTER TABLE garage_modules RENAME TO garage_modules_single_project")
            connection.execute(
                """CREATE TABLE garage_modules (
                    id INTEGER PRIMARY KEY, garage_id INTEGER NOT NULL, project_id INTEGER, slot TEXT NOT NULL,
                    name TEXT NOT NULL, lang TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'active', weight INTEGER NOT NULL DEFAULT 1,
                    UNIQUE(project_id, slot), FOREIGN KEY(garage_id) REFERENCES garages(id))""")
            columns = [row["name"] for row in connection.execute("PRAGMA table_info(garage_modules_single_project)")]
            shared = ",".join(column for column in columns if column != "id")
            connection.execute(f"INSERT INTO garage_modules({shared}) SELECT {shared} FROM garage_modules_single_project")
            connection.execute("DROP TABLE garage_modules_single_project")

        # A garage used to show one thing. It now stages several projects with one flagship, so give
        # each existing garage a first project and move what it was already showing into it.
        for garage in connection.execute("SELECT id,name,tagline,workspace_id FROM garages").fetchall():
            if connection.execute("SELECT 1 FROM projects WHERE garage_id=?", (garage["id"],)).fetchone():
                continue
            now = int(time.time())
            cursor = connection.execute(
                "INSERT INTO projects(garage_id,name,tagline,flagship,workspace_id,created_at,updated_at) VALUES(?,?,?,1,?,?,?)",
                (garage["id"], garage["name"], garage["tagline"], garage["workspace_id"], now, now))
            for table in ("garage_modules", "module_variants"):
                connection.execute(f"UPDATE {table} SET project_id=? WHERE garage_id=? AND project_id IS NULL",
                                   (cursor.lastrowid, garage["id"]))
        # Benchmarks and tickets predating neighbourhoods all belong to the first street.
        if "neighborhood_id" not in {row["name"] for row in connection.execute("PRAGMA table_info(benchmarks)")}:
            connection.execute("ALTER TABLE benchmarks ADD COLUMN neighborhood_id INTEGER NOT NULL DEFAULT 1")
        if "neighborhood_id" not in {row["name"] for row in connection.execute("PRAGMA table_info(arena_tickets)")}:
            connection.execute("ALTER TABLE arena_tickets RENAME TO arena_tickets_single_street")
            connection.execute(
                """CREATE TABLE arena_tickets (
                    user_id INTEGER NOT NULL, neighborhood_id INTEGER NOT NULL, day TEXT NOT NULL,
                    benchmark_id INTEGER NOT NULL, entry_id INTEGER, spent_at INTEGER NOT NULL,
                    PRIMARY KEY(user_id, neighborhood_id, day), FOREIGN KEY(user_id) REFERENCES users(id))"""
            )
            connection.execute(
                """INSERT INTO arena_tickets(user_id,neighborhood_id,day,benchmark_id,entry_id,spent_at)
                   SELECT user_id,1,day,benchmark_id,entry_id,spent_at FROM arena_tickets_single_street"""
            )
            connection.execute("DROP TABLE arena_tickets_single_street")


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return base64.b64encode(salt + digest).decode()


def password_matches(password: str, encoded: str) -> bool:
    try:
        raw = base64.b64decode(encoded.encode())
        return secrets.compare_digest(raw[16:], hashlib.pbkdf2_hmac("sha256", password.encode(), raw[:16], 200_000))
    except ValueError:
        return False


def user_payload(row: sqlite3.Row) -> dict[str, object]:
    return {"id": row["id"], "handle": row["handle"], "display_name": row["display_name"], "bio": row["bio"]}


def run_git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, check=False)
    if result.returncode:
        raise ValueError(result.stderr.strip() or result.stdout.strip() or "Git operation failed.")
    return result.stdout.rstrip("\n")


def run_git_in(base: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=base, text=True, capture_output=True, check=False)
    if result.returncode:
        raise ValueError(result.stderr.strip() or "Git operation failed.")
    return result.stdout.rstrip("\n")


def path_history(base: Path, source: str, limit: int = 12) -> list[dict[str, str]]:
    """Commits that touched one module's folder, so a bay can be swapped back to an earlier one."""
    target = (base / source).resolve() if source else base
    if base != target and base not in target.parents:
        raise ValueError("That path is outside the paired workspace.")
    if not (base / ".git").exists():
        return []
    raw = run_git_in(base, "log", "-n", str(max(1, min(40, limit))), "--format=%h\x1f%s\x1f%cr", "--", str(target.relative_to(base)) or ".")
    entries = []
    for line in raw.splitlines():
        parts = line.split("\x1f")
        if len(parts) == 3:
            entries.append({"ref": parts[0], "subject": parts[1][:90], "when": parts[2]})
    return entries


TEXT_VIEW_LIMIT = 200_000


def workspace_tree(base: Path, source: str, limit: int = 200) -> list[dict[str, object]]:
    """The files behind one bay, so clicking a module reaches actual code rather than a label."""
    target = (base / source).resolve() if source else base
    if base != target and base not in target.parents:
        raise ValueError("That path is outside the paired workspace.")
    if target.is_file():
        return [{"path": str(target.relative_to(base)), "bytes": target.stat().st_size, "dir": False}]
    if not target.is_dir():
        raise ValueError("No such file or folder in the paired workspace.")
    entries = []
    for path in sorted(target.rglob("*")):
        if len(entries) >= limit:
            break
        relative = path.relative_to(base)
        if any(part in SKIP_DIRS or part.startswith(".") for part in relative.parts):
            continue
        if path.is_file() and not path.is_symlink():
            entries.append({"path": str(relative), "bytes": path.stat().st_size,
                            "lang": LANGUAGES.get(path.suffix.lower(), ""), "dir": False})
    return entries


def read_workspace_file(base: Path, source: str) -> dict[str, object]:
    """Read-only. The site is where you look and talk; edits happen in the person's own tools."""
    target = (base / source).resolve()
    if base not in target.parents or not target.is_file() or target.is_symlink():
        raise ValueError("That file is not inside the paired workspace.")
    if any(part in SKIP_DIRS or part.startswith(".") for part in target.relative_to(base).parts):
        raise ValueError("That path is not readable from here.")
    size = target.stat().st_size
    if target.suffix.lower() not in TEXT_SUFFIXES:
        return {"path": source, "bytes": size, "binary": True, "text": "", "truncated": False}
    text = target.read_text(encoding="utf-8", errors="replace")
    return {"path": source, "bytes": size, "binary": False, "lang": LANGUAGES.get(target.suffix.lower(), ""),
            "lines": text.count("\n") + 1, "truncated": size > TEXT_VIEW_LIMIT, "text": text[:TEXT_VIEW_LIMIT]}


def validated_files(files: object) -> list[str]:
    if not isinstance(files, list) or not files:
        raise ValueError("Choose at least one workspace file.")
    checked = []
    for file in files:
        if not isinstance(file, str) or not file or file.startswith("-"):
            raise ValueError("Invalid workspace file.")
        resolved = (ROOT / file).resolve()
        if ROOT not in resolved.parents or ".git" in resolved.parts or not resolved.is_file():
            raise ValueError("A selected file is outside the approved workspace.")
        checked.append(str(resolved.relative_to(ROOT)))
    return checked


def git_status() -> dict[str, object]:
    entries = []
    for line in run_git("status", "--porcelain=v1").splitlines():
        code, path = line[:2], line[3:]
        entries.append({"path": path.rsplit(" -> ", 1)[-1], "status": code.strip() or "modified", "staged": code[0] not in {" ", "?"}})
    return {"branch": run_git("branch", "--show-current") or "detached HEAD", "files": entries}


def has_staged_changes() -> bool:
    result = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT, capture_output=True, check=False)
    if result.returncode in (0, 1):
        return result.returncode == 1
    raise ValueError("Could not inspect staged changes.")


def thread_id_from_events(output: str) -> str | None:
    """Extract a persisted Codex thread identifier from its JSONL event stream."""
    def walk(value: object) -> str | None:
        if isinstance(value, dict):
            if isinstance(value.get("thread_id"), str):
                return value["thread_id"]
            for child in value.values():
                found = walk(child)
                if found:
                    return found
        elif isinstance(value, list):
            for child in value:
                found = walk(child)
                if found:
                    return found
        return None
    for line in output.splitlines():
        try:
            found = walk(json.loads(line))
        except json.JSONDecodeError:
            continue
        if found:
            return found
    return None


def read_last_message(output_path: Path) -> str:
    return output_path.read_text(encoding="utf-8").strip() if output_path.exists() else ""


def claude_result(stdout: str) -> tuple[str | None, str]:
    """Claude Code print mode answers with one JSON object holding the session id and final text."""
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return None, stdout.strip()
    if payload.get("is_error"):
        raise ValueError(str(payload.get("result") or "Claude Code reported an error.").strip())
    session = payload.get("session_id")
    return (session if isinstance(session, str) else None), str(payload.get("result") or "").strip()


# Every entry is one coding-agent CLI. `start` opens a fresh session and reports its id back;
# `resume` continues one; `queue` hands over a message without waiting for the reply. A provider
# without `start` can still be linked to a session the person opened in their own terminal.
PROVIDERS: dict[str, dict[str, object]] = {
    "codex": {
        "label": "Codex CLI",
        "binary": "codex",
        "hint": "OpenAI Codex CLI. VybPort can open a thread for you, and can queue messages into a running one.",
        "id_label": "thread id",
        "start": lambda message, output: ["codex", "exec", "--json", "--output-last-message", str(output), message],
        "resume": lambda session, message, output: ["codex", "exec", "resume", "--output-last-message", str(output), session, message],
        "queue": lambda session, message: ["codex", "queue", "--thread", session, "--message", message],
        "read": lambda stdout, output: (thread_id_from_events(stdout), read_last_message(output)),
    },
    "claude": {
        "label": "Claude Code",
        "binary": "claude",
        "hint": "Anthropic Claude Code in print mode. VybPort can open a session for you and resume it by id.",
        "id_label": "session id",
        "start": lambda message, output: ["claude", "-p", "--output-format", "json", message],
        "resume": lambda session, message, output: ["claude", "-p", "--output-format", "json", "--resume", session, message],
        "queue": None,
        "read": lambda stdout, output: claude_result(stdout),
    },
    "custom": {
        "label": "Any other coding agent",
        "binary": None,
        "hint": "Give VybPort the exact command your CLI takes — Gemini, Cursor, aider, opencode, a shell script of your own. "
                "{session}, {message} and {output} are filled in as whole arguments; nothing is passed through a shell.",
        "id_label": "session id",
        "start": None,
        "resume": None,
        "queue": None,
        "read": lambda stdout, output: (None, read_last_message(output) or stdout.strip()),
    },
}


def provider_spec(key: object) -> tuple[str, dict[str, object]]:
    if not isinstance(key, str) or key not in PROVIDERS:
        raise ValueError(f"Pick a supported coding agent: {', '.join(PROVIDERS)}.")
    return key, PROVIDERS[key]


def installed(spec: dict[str, object]) -> bool:
    binary = spec["binary"]
    return bool(binary) and shutil.which(str(binary)) is not None


def default_provider() -> str:
    for key, spec in PROVIDERS.items():
        if spec["start"] and installed(spec):
            return key
    raise ValueError("No supported coding-agent CLI was found on this machine's PATH.")


def expand_command(template: object, fills: dict[str, str], required: str) -> list[str]:
    """Turn a stored command template into argv. Values land as whole items and never touch a shell."""
    placeholder = "{" + required + "}"
    if not isinstance(template, str) or not template.strip():
        raise ValueError(f"Add the command to run, including a {placeholder} placeholder.")
    if placeholder not in template:
        raise ValueError(f"The command needs a {placeholder} placeholder so VybPort knows where that value goes.")
    if len(template) > 400:
        raise ValueError("Keep the command under 400 characters.")
    try:
        tokens = shlex.split(template.strip())
    except ValueError as error:
        raise ValueError("That command could not be parsed — check the quoting.") from error
    if not tokens:
        raise ValueError(f"Add the command to run, including a {placeholder} placeholder.")
    if not shutil.which(tokens[0]):
        raise ValueError(f"'{tokens[0]}' is not on this machine's PATH.")
    pattern = re.compile(r"\{(" + "|".join(fills) + r")\}")
    return [pattern.sub(lambda found: fills[found.group(1)], token) for token in tokens]


def custom_command(template: object, session: str, message: str, output: Path) -> list[str]:
    return expand_command(template, {"session": session, "message": message, "output": str(output)}, "message")


def agent_turn(key: str, spec: dict[str, object], session: str, message: str, template: str) -> tuple[str | None, str]:
    """One request/response turn with a local coding agent, whoever supplies it."""
    with tempfile.NamedTemporaryFile(prefix=f"vybport-{key}-", suffix=".txt", dir=DATA_DIR, delete=False) as handle:
        output_path = Path(handle.name)
    try:
        if key == "custom":
            command = custom_command(template, session, message, output_path)
        elif session:
            command = spec["resume"](session, message, output_path)
        elif spec["start"]:
            command = spec["start"](message, output_path)
        else:
            raise ValueError(f"{spec['label']} cannot open a session from here — link one you already have running.")
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=180, check=False)
        if result.returncode:
            raise ValueError(result.stderr.strip() or f"{spec['label']} did not return a response. Check the linked session and local sign-in.")
        return spec["read"](result.stdout, output_path)
    finally:
        output_path.unlink(missing_ok=True)


# A directory is read as a set of modules, not a file tree. Directory names decide the role wherever
# they say something ("memory", "effects", "backend"); otherwise the dominant file type does.
ROLE_HINTS = [
    ("memory", ("memory", "store", "storage", "db", "database", "data", "persist", "cache", "recall", "vector")),
    ("interface", ("ui", "web", "www", "frontend", "front-end", "client", "views", "view", "components", "pages", "templates", "screens")),
    ("effects", ("fx", "effects", "render", "renderer", "shader", "shaders", "anim", "animation", "audio", "sound", "visual", "graphics")),
    ("logic", ("server", "api", "backend", "back-end", "service", "services", "core", "engine", "domain", "src", "lib", "internal", "pkg")),
    ("agents", ("agent", "agents", "prompt", "prompts", "skills", "tools", "adapters", "bridge")),
    ("tests", ("test", "tests", "spec", "specs", "__tests__", "bench", "benchmarks", "e2e", "fixtures")),
    ("docs", ("doc", "docs", "documentation", "notes", "journal", "adr")),
    ("config", ("config", "conf", "settings", "scripts", "build", "ci", "infra", "deploy", ".github", "migrations")),
    ("assets", ("asset", "assets", "images", "img", "static", "public", "media", "fonts", "icons", "skins")),
]
LANGUAGES = {
    ".py": "Python", ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript",
    ".ts": "TypeScript", ".tsx": "TypeScript", ".html": "HTML", ".css": "CSS", ".scss": "CSS",
    ".json": "JSON", ".md": "Markdown", ".sql": "SQL", ".sh": "Shell", ".rs": "Rust", ".go": "Go",
    ".java": "Java", ".rb": "Ruby", ".c": "C", ".h": "C", ".cpp": "C++", ".toml": "Config", ".yml": "Config",
    ".yaml": "Config", ".svg": "Vector", ".png": "Image", ".jpg": "Image", ".jpeg": "Image", ".webp": "Image",
    ".woff2": "Font", ".ipynb": "Notebook", ".vue": "Vue", ".svelte": "Svelte",
}
ROLE_BY_LANGUAGE = {"HTML": "interface", "CSS": "interface", "Vue": "interface", "Svelte": "interface",
                    "JavaScript": "interface", "TypeScript": "interface", "Image": "assets", "Vector": "assets",
                    "Font": "assets", "Markdown": "docs", "Config": "config", "JSON": "config", "SQL": "memory"}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".next", ".cache", "target", "data", ".idea", ".vscode"}
TEXT_SUFFIXES = {".py", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".html", ".css", ".scss", ".json", ".md", ".sql", ".sh", ".toml", ".yml", ".yaml", ".vue", ".svelte", ".txt"}


def module_role(name: str, languages: dict[str, int]) -> str:
    lowered = name.lower().strip("._-")
    for role, hints in ROLE_HINTS:
        if lowered in hints or any(lowered.startswith(hint) or hint in lowered.split("_") for hint in hints):
            return role
    dominant = max(languages, key=lambda key: languages[key]) if languages else ""
    return ROLE_BY_LANGUAGE.get(dominant, "logic")


def module_key(relative: Path) -> str:
    """A folder is a module. So is a family of loose files sharing a stem: wander.html/.css/.js is one thing."""
    if len(relative.parts) > 1:
        return relative.parts[0]
    stem = relative.stem
    head = re.split(r"[-_.]", stem)[0]
    return head if len(head) >= 3 else stem


def dominant_language(languages: dict[str, int]) -> str:
    """A folder of logs and lockfiles is still a Python folder — unknown types never win the vote."""
    known = {name: count for name, count in languages.items() if name != "Other"}
    pool = known or languages
    return max(pool, key=lambda name: pool[name]) if pool else "Other"


def scan_rack(base: Path, budget: int = 900) -> dict[str, object]:
    """Group a workspace into modules a person can look at, with the references between them as cables."""
    groups: dict[str, dict[str, object]] = {}
    seen = 0
    for path in sorted(base.rglob("*")):
        if seen >= budget:
            break
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(base)
        if any(part in SKIP_DIRS or (part.startswith(".") and part != ".github") for part in relative.parts):
            continue
        seen += 1
        key = module_key(relative)
        group = groups.setdefault(key, {"files": 0, "bytes": 0, "languages": {}, "paths": [], "touched": 0})
        language = LANGUAGES.get(path.suffix.lower(), "Other")
        stat = path.stat()
        group["files"] += 1
        group["bytes"] += stat.st_size
        group["touched"] = max(group["touched"], int(stat.st_mtime))
        group["languages"][language] = group["languages"].get(language, 0) + 1
        group["paths"].append(str(relative))
    # Single loose files that share nothing with anything else are one shelf of odds and ends.
    strays = [key for key, group in groups.items()
              if group["files"] == 1 and "/" not in group["paths"][0] and group["bytes"] < 6_000]
    if len(strays) > 1:
        merged = groups.setdefault("misc", {"files": 0, "bytes": 0, "languages": {}, "paths": [], "touched": 0})
        for key in strays:
            group = groups.pop(key)
            merged["files"] += group["files"]
            merged["bytes"] += group["bytes"]
            merged["touched"] = max(merged["touched"], group["touched"])
            merged["paths"] += group["paths"]
            for language, count in group["languages"].items():
                merged["languages"][language] = merged["languages"].get(language, 0) + count
    now = time.time()
    modules = []
    for key, group in groups.items():
        languages = group["languages"]
        age = (now - group["touched"]) / 86400
        modules.append({
            "id": key, "name": "odds and ends" if key == "misc" else key.replace("-", " ").replace("_", " "),
            "role": module_role(key, languages),
            "lang": dominant_language(languages),
            "files": group["files"], "bytes": group["bytes"], "samples": sorted(group["paths"])[:10],
            "languages": sorted(languages.items(), key=lambda item: -item[1])[:3],
            "status": "hot" if age < 1 else "active" if age < 7 else "stable",
        })
    modules.sort(key=lambda module: (module["id"] == "misc", -module["files"], module["name"]))
    return {"modules": modules, "links": rack_links(base, groups)}


def rack_links(base: Path, groups: dict[str, dict[str, object]]) -> list[dict[str, object]]:
    """A cable is drawn where one module's source actually names another's."""
    others = [key for key in groups if key != "misc"]
    patterns = {key: re.compile(r"[\"\'/`\s(=]" + re.escape(key) + r"[-_/\"\'`.\s)]") for key in others}
    counts: dict[tuple[str, str], int] = {}
    for key, group in groups.items():
        for sample in group["paths"][:40]:
            path = base / sample
            if path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")[:64_000]
            except OSError:
                continue
            for other, pattern in patterns.items():
                if other != key and pattern.search(text):
                    counts[(key, other)] = counts.get((key, other), 0) + 1
    return [{"from": pair[0], "to": pair[1], "weight": weight}
            for pair, weight in sorted(counts.items(), key=lambda item: -item[1])[:28]]


def is_owner(user: sqlite3.Row) -> bool:
    return user["handle"].lower() in OWNER_HANDLES if OWNER_HANDLES else user["id"] == 1


def utc_day(when: float | None = None) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(when))


def next_ticket_reset() -> int:
    """Tickets refill at 00:00 UTC, so everyone's day starts at the same instant."""
    now = time.gmtime()
    return int(time.time()) + ((23 - now.tm_hour) * 3600 + (59 - now.tm_min) * 60 + (60 - now.tm_sec))


def run_adaptor(command: str, fixture: str, timeout: int) -> tuple[float | None, dict[str, object], str]:
    """Run one entry through the standard adaptor and read back its single JSON response."""
    with tempfile.NamedTemporaryFile("w", prefix="vybport-fixture-", suffix=".json", dir=DATA_DIR, delete=False, encoding="utf-8") as handle:
        fixture_path = Path(handle.name)
        handle.write(fixture)
    with tempfile.NamedTemporaryFile(prefix="vybport-result-", suffix=".json", dir=DATA_DIR, delete=False) as handle:
        output_path = Path(handle.name)
    try:
        argv = expand_command(command, {"fixture": str(fixture_path), "output": str(output_path)}, "fixture")
        try:
            result = subprocess.run(argv, cwd=ROOT, text=True, capture_output=True, timeout=timeout, check=False)
        except subprocess.TimeoutExpired:
            return None, {}, f"The entry did not finish inside {timeout}s."
        if result.returncode:
            return None, {}, (result.stderr.strip() or result.stdout.strip() or "The entry exited with an error.")[:400]
        raw = read_last_message(output_path) or result.stdout.strip()
        if not raw:
            return None, {}, "The entry produced no adaptor response on {output} or stdout."
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return None, {}, "The adaptor response was not valid JSON."
        if not isinstance(payload, dict):
            return None, {}, "The adaptor response must be a single JSON object."
        if payload.get("adaptor") != ARENA_ADAPTOR:
            return None, {}, f"The response declared adaptor {payload.get('adaptor')!r}; this arena scores {ARENA_ADAPTOR}."
        score = payload.get("score")
        if not isinstance(score, (int, float)) or isinstance(score, bool) or score != score or score in (float("inf"), float("-inf")):
            return None, {}, "The response needs a finite numeric 'score'."
        detail = payload.get("detail")
        return float(score), (detail if isinstance(detail, dict) else {}), ""
    finally:
        fixture_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)


def preflight(benchmark: sqlite3.Row, system: str, capabilities: object, command: object) -> tuple[bool, list[dict[str, object]]]:
    """Everything that must hold before a ticket is worth spending. Runs against the public sample only."""
    checks: list[dict[str, object]] = []

    def record(key: str, label: str, ok: bool, note: str) -> bool:
        checks.append({"key": key, "label": label, "ok": ok, "note": note})
        return ok

    if not record("system", "System is named", bool(1 <= len(system) <= 60), system or "Name the build you are entering."):
        return False, checks
    declared = [item for item in capabilities if isinstance(item, str)] if isinstance(capabilities, list) else []
    required = json.loads(benchmark["capabilities"])
    missing = [item for item in required if item not in declared]
    if not record("capabilities", "Declares the capabilities this benchmark exercises", not missing,
                  "missing: " + ", ".join(missing) if missing else ", ".join(required) or "none required"):
        return False, checks
    try:
        expand_command(command, {"fixture": "probe", "output": "probe"}, "fixture")
        record("command", f"Run command resolves and takes {{fixture}}", True, str(command))
    except ValueError as error:
        record("command", "Run command resolves and takes {fixture}", False, str(error))
        return False, checks
    score, _, problem = run_adaptor(str(command), benchmark["sample_fixture"], PREFLIGHT_TIMEOUT)
    if not record("sample", "Completes the public sample fixture", problem == "", problem or f"finished inside {PREFLIGHT_TIMEOUT}s"):
        return False, checks
    in_range = score is not None and 0 <= score <= benchmark["score_max"]
    record("response", f"Returns a {ARENA_ADAPTOR} score within 0–{benchmark['score_max']:g}", in_range,
           f"sample score {score:g}" if in_range else f"score {score} is outside 0–{benchmark['score_max']:g}")
    return all(check["ok"] for check in checks), checks


def leaderboard(connection: sqlite3.Connection, benchmark_id: int, limit: int = 100) -> list[dict[str, object]]:
    """One row per builder: their best scored attempt in this benchmark period."""
    # One MAX aggregate only, so the bare columns come from the attempt that actually set the best score.
    # Ties go to whoever reached the score first, then to the lower entry id — never to insertion order.
    rows = connection.execute(
        """SELECT users.handle, users.display_name, arena_entries.user_id AS user_id,
                  arena_entries.system_name, arena_entries.created_at AS achieved_at,
                  arena_entries.id AS entry_id, MAX(arena_entries.score) AS score
           FROM arena_entries JOIN users ON users.id=arena_entries.user_id
           WHERE arena_entries.benchmark_id=? AND arena_entries.status='scored'
           GROUP BY arena_entries.user_id
           ORDER BY score DESC, achieved_at ASC, entry_id ASC LIMIT ?""",
        (benchmark_id, limit),
    ).fetchall()
    attempts = dict(connection.execute(
        "SELECT user_id, COUNT(*) FROM arena_entries WHERE benchmark_id=? GROUP BY user_id", (benchmark_id,)).fetchall())
    return [dict(row) | {"place": index + 1, "attempts": attempts.get(row["user_id"], 0)} for index, row in enumerate(rows)]


# Folders you have deliberately paired. Local-only server or not, the scan never leaves these roots.
WORKSPACE_ROOTS = [Path(item).expanduser().resolve()
                   for item in os.environ.get("VYBPORT_WORKSPACE_ROOTS", str(Path.home())).split(os.pathsep) if item.strip()]
# How a street draws its rack. Bay order is fixed per street, so the same bay sits in the same place
# in every garage on it — assets are always bottom-right on a game street, whoever's garage it is.
LAYOUTS = {"rack": "Mounted bays in shelves of four.",
           "brain": "A core with its bays arranged around it.",
           "board": "One wide row per bay, read top to bottom.",
           "console": "Instrument panels stacked in two columns."}


def paired_path(raw: object) -> Path:
    candidate = Path(str(raw or "").strip()).expanduser()
    if not candidate.is_absolute():
        raise ValueError("Give the absolute path of the folder you want to pair.")
    candidate = candidate.resolve()
    if not candidate.is_dir():
        raise ValueError("That folder does not exist.")
    if not any(candidate == root or root in candidate.parents for root in WORKSPACE_ROOTS):
        allowed = ", ".join(str(root) for root in WORKSPACE_ROOTS)
        raise ValueError(f"Workspaces can only be paired under: {allowed}. Set VYBPORT_WORKSPACE_ROOTS to change that.")
    return candidate


def fit_to_bays(slots: list[dict[str, object]], scan: dict[str, object]) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """Drop a scanned folder onto a street's rack: name matches first, then whole groups by role.

    This is what makes 'update' work on a messy workspace — the street decides the bays, the scan
    decides what goes in them, and whatever still does not fit is named rather than silently dropped.
    A bay can hold a group: six interface modules become one bay that says so.
    """
    modules = sorted(scan.get("modules", []), key=lambda module: -module["files"])
    taken: set[str] = set()
    placed: list[dict[str, object]] = []

    def mount(slot: dict[str, object], group: list[dict[str, object]]) -> None:
        for module in group:
            taken.add(module["id"])
        lead, files = group[0], sum(module["files"] for module in group)
        names = ", ".join(module["id"] for module in group[:3])
        extra = f" +{len(group) - 3} more" if len(group) > 3 else ""
        placed.append({"slot": slot["key"], "name": lead["name"], "lang": lead["lang"], "status": lead["status"],
                       "weight": max(1, min(9, 1 + files // 4)),
                       "note": f"{names}{extra} · {files} file{'' if files == 1 else 's'}"})

    for slot in slots:
        words = {str(slot["key"]).lower(), str(slot["label"]).lower()}
        match = next((module for module in modules if module["id"] not in taken and module["id"].lower() in words), None)
        if match:
            mount(slot, [match])
    for slot in slots:
        if any(item["slot"] == slot["key"] for item in placed):
            continue
        group = [module for module in modules if module["id"] not in taken and module["role"] == slot["role"]]
        if group:
            mount(slot, group)
    unplaced = [{"id": module["id"], "name": module["name"], "role": module["role"], "lang": module["lang"], "files": module["files"]}
                for module in modules if module["id"] not in taken]
    return placed, unplaced


def take_snapshot(connection: sqlite3.Connection, garage: sqlite3.Row, project: sqlite3.Row, slots: list[dict[str, object]],
                  base: Path, workspace_id: int | None) -> dict[str, object]:
    """One update = one snapshot laid over the last, the way a commit lies over its parent."""
    scan = scan_rack(base)
    placed, unplaced = fit_to_bays(slots, scan)
    connection.execute("DELETE FROM garage_modules WHERE project_id=?", (project["id"],))
    for module in placed:
        connection.execute(
            """INSERT INTO garage_modules(garage_id,project_id,slot,name,lang,note,source,status,weight) VALUES(?,?,?,?,?,?,?,?,?)""",
            (garage["id"], project["id"], module["slot"], module["name"][:60], module["lang"][:24], module["note"][:160],
             module.get("source", ""), module["status"], module["weight"]))
    summary = f"{project['name']} · {len(placed)} of {len(slots)} bays from {base.name} · {len(scan['modules'])} modules seen"
    connection.execute(
        "INSERT INTO garage_snapshots(garage_id,project_id,workspace_id,taken_at,summary,modules,links) VALUES(?,?,?,?,?,?,?)",
        (garage["id"], project["id"], workspace_id, int(time.time()), summary, json.dumps(placed), json.dumps(scan["links"])))
    connection.execute("UPDATE projects SET updated_at=?, workspace_id=COALESCE(?,workspace_id) WHERE id=?",
                       (int(time.time()), workspace_id, project["id"]))
    connection.execute("UPDATE garages SET updated_at=? WHERE id=?", (int(time.time()), garage["id"]))
    if workspace_id:
        connection.execute("UPDATE workspaces SET scanned_at=? WHERE id=?", (int(time.time()), workspace_id))
    return {"summary": summary, "placed": placed, "unplaced": unplaced, "links": scan["links"], "root": base.name}


def garage_workspace(connection: sqlite3.Connection, garage: sqlite3.Row, requested: object,
                     project: sqlite3.Row | None = None) -> tuple[Path, int | None]:
    """Which folder a project is staged from: the one asked for, else the one it is paired to."""
    workspace_id = requested if isinstance(requested, int) else ((project["workspace_id"] if project else None) or garage["workspace_id"])
    if workspace_id:
        row = connection.execute("SELECT * FROM workspaces WHERE id=? AND user_id=?", (workspace_id, garage["user_id"])).fetchone()
        if not row:
            raise ValueError("That workspace is not paired to this profile.")
        return paired_path(row["path"]), row["id"]
    return ROOT, None


# VybPort speaks MCP so any agent can work through a profile with its own token, instead of VybPort
# reaching out to each agent's CLI. Tools are grouped into sets; a token carries the sets it may call.
MCP_VERSION = "2024-11-05"
TOOL_SETS: dict[str, dict[str, object]] = {
    "profile": {"summary": "Who the token belongs to and where they build.", "tools": {
        "whoami": {"description": "The profile this token acts for, and the neighborhoods they keep a garage on.", "schema": {}},
        "list_my_garages": {"description": "Every garage this profile keeps, one per neighborhood, with its mounted bays.", "schema": {}},
    }},
    "street": {"summary": "Read any neighborhood and the garages on it.", "tools": {
        "list_neighborhoods": {"description": "Every street, its shared bay layout, and how many garages sit on it.", "schema": {}},
        "read_neighborhood": {"description": "One street: its bays, its tags, its garage count.",
                              "schema": {"slug": {"type": "string", "description": "neighborhood slug"}}, "required": ["slug"]},
        "read_garage": {"description": "One builder's garage on a street: its bays, its tags, when it was last rebuilt.",
                        "schema": {"handle": {"type": "string"}, "neighborhood": {"type": "string"}}, "required": ["handle", "neighborhood"]},
        "recent": {"description": "What changed lately on a street, most recently updated first.",
                   "schema": {"slug": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["slug"]},
        "walk_street": {"description": "The garages on a street, nearest first by shared tags with the given focus.",
                        "schema": {"slug": {"type": "string"}, "focus": {"type": "array", "items": {"type": "string"}, "description": "tags to sort proximity against"}}, "required": ["slug"]},
    }},
    "garage": {"summary": "Open and maintain this profile's own garages.", "tools": {
        "open_garage": {"description": "Open this profile's garage on a street. One per neighborhood.",
                        "schema": {"neighborhood": {"type": "string"}, "name": {"type": "string"}, "tagline": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}}, "required": ["neighborhood", "name"]},
        "list_projects": {"description": "What this garage is staging, and which one is the flagship.",
                          "schema": {"neighborhood": {"type": "string"}}, "required": ["neighborhood"]},
        "new_project": {"description": "Put another project on this garage's rack.",
                        "schema": {"neighborhood": {"type": "string"}, "name": {"type": "string"}, "tagline": {"type": "string"}},
                        "required": ["neighborhood", "name"]},
        "set_flagship": {"description": "Choose which project a visitor sees first.",
                         "schema": {"neighborhood": {"type": "string"}, "project": {"type": "integer"}},
                         "required": ["neighborhood", "project"]},
        "add_variant": {"description": "Offer a bay another candidate — a different folder, file or commit — and optionally mount it.",
                        "schema": {"neighborhood": {"type": "string"}, "project": {"type": "integer"}, "slot": {"type": "string"},
                                   "label": {"type": "string"}, "source": {"type": "string"}, "ref": {"type": "string"},
                                   "lang": {"type": "string"}, "note": {"type": "string"}, "mount": {"type": "boolean"}},
                        "required": ["neighborhood", "slot", "label"]},
        "borrow": {"description": "Copy another builder's published build onto your bench on that street, bays and workflow intact.",
                   "schema": {"neighborhood": {"type": "string"}, "project": {"type": "integer", "description": "their project id"}},
                   "required": ["neighborhood", "project"]},
        "compare": {"description": "Your flagship against something on your bench, bay for bay.",
                    "schema": {"neighborhood": {"type": "string"}, "project": {"type": "integer"}}, "required": ["neighborhood", "project"]},
        "checkout": {"description": "Write a bench build into a working folder under the paired workspace so you can actually work on it.",
                     "schema": {"project": {"type": "integer"}}, "required": ["project"]},
        "test": {"description": "Run this project's test command in its workspace and record the result on the bench. {dir} is the folder.",
                 "schema": {"project": {"type": "integer"}, "command": {"type": "string", "description": "e.g. python3 -m pytest {dir}"}},
                 "required": ["project"]},
        "mount_variant": {"description": "Swap a bay over to one of its candidates.",
                          "schema": {"variant": {"type": "integer"}}, "required": ["variant"]},
        "set_workflow": {"description": "Draw how this project actually runs. Steps auto-arrange unless you give column/row.",
                         "schema": {"neighborhood": {"type": "string"}, "project": {"type": "integer"}, "name": {"type": "string"},
                                    "notes": {"type": "string"},
                                    "nodes": {"type": "array", "items": {"type": "object"},
                                              "description": "[{id,label,kind,note,column,row}] kind: intake|process|decision|store|agent|output|external"},
                                    "edges": {"type": "array", "items": {"type": "object"}, "description": "[{from,to,label,kind}] kind: flow|branch"}},
                         "required": ["neighborhood", "nodes"]},
        "set_bays": {"description": "Replace what is mounted in this garage's bays. Bay keys must be ones the street defines.",
                     "schema": {"neighborhood": {"type": "string"}, "modules": {"type": "array", "items": {"type": "object"}, "description": "[{slot,name,lang,note,status,weight}]"}}, "required": ["neighborhood", "modules"]},
    }},
    "social": {"summary": "Read and join the public conversation on any garage, project, or arena floor.", "tools": {
        "read": {"description": "Bolts and public notes on one target, e.g. garage:handle:street or arena:slug.",
                 "schema": {"target": {"type": "string"}}, "required": ["target"]},
        "comment": {"description": "Leave a public note on a target. It is posted for this profile and marked as written by this agent.",
                    "schema": {"target": {"type": "string"}, "body": {"type": "string"}}, "required": ["target", "body"]},
        "bolt": {"description": "Toggle this profile's bolt on a target.",
                 "schema": {"target": {"type": "string"}}, "required": ["target"]},
    }},
    "arena": {"summary": "The neighborhood's open benchmark, its board, and this profile's daily ticket.", "tools": {
        "leaderboard": {"description": "Slice the board: the top N, one exact place, or the places around one.",
                        "schema": {"neighborhood": {"type": "string"}, "top": {"type": "integer", "description": "how many from the top"},
                                   "place": {"type": "integer", "description": "one exact placing"},
                                   "around": {"type": "integer", "description": "centre on this place and show its neighbours"}},
                        "required": ["neighborhood"]},
        "read_arena": {"description": "The open benchmark on a street, the top 100, the reigning podium, and your ticket.",
                       "schema": {"neighborhood": {"type": "string"}}, "required": ["neighborhood"]},
        "arena_preflight": {"description": "Check an entry against the standard adaptor. Never spends a ticket.",
                            "schema": {"neighborhood": {"type": "string"}, "system": {"type": "string"}, "command": {"type": "string"}, "capabilities": {"type": "array", "items": {"type": "string"}}}, "required": ["neighborhood", "system", "command"]},
    }},
    "session": {"summary": "Register this agent on the profile and pick up what the site sends it.", "tools": {
        "register": {"description": "Announce this agent so it appears as a live session on the profile. Call once at startup.",
                     "schema": {"name": {"type": "string", "description": "what to call this agent on the profile"},
                                "kind": {"type": "string", "description": "e.g. claude-code, codex, cursor"},
                                "version": {"type": "string"}, "cwd": {"type": "string", "description": "folder this session is working in"}},
                     "required": ["name"]},
        "heartbeat": {"description": "Say the session is still alive. The profile marks it live for ten minutes after.", "schema": {}},
        "focus": {"description": "What the person is looking at on the site right now — garage, project, bay, file, and any note they left with it.", "schema": {}},
        "inbox": {"description": "Anything the person queued for this agent since it last looked. Marks them delivered.", "schema": {}},
        "reply": {"description": "Post a result back against one queued item, so it shows on the profile.",
                  "schema": {"id": {"type": "integer"}, "text": {"type": "string"}}, "required": ["id", "text"]},
    }},
    "workspace": {"summary": "The local workspace: read its shape, stage it, commit it. Never pushes to a remote.", "tools": {
        "read_rack": {"description": "A paired workspace as modules and the references between them.",
                      "schema": {"workspace": {"type": "integer", "description": "paired workspace id; omit for the server's own folder"},
                                 "path": {"type": "string", "description": "optional subfolder"}}},
        "read_file": {"description": "Read one file out of a paired workspace, the same one the person is looking at.",
                      "schema": {"workspace": {"type": "integer"}, "path": {"type": "string"}}, "required": ["path"]},
        "list_files": {"description": "The files behind one bay, or under any path in a paired workspace.",
                       "schema": {"workspace": {"type": "integer"}, "source": {"type": "string"}}},
        "list_workspaces": {"description": "The folders this profile has paired.", "schema": {}},
        "update_garage": {"description": "Re-scan a paired folder and lay it over this garage's bays as a new snapshot.",
                          "schema": {"neighborhood": {"type": "string"}, "workspace": {"type": "integer"}}, "required": ["neighborhood"]},
        "git_status": {"description": "Branch and working-tree state for the approved workspace.", "schema": {}},
        "stage_files": {"description": "Stage paths inside the approved workspace.",
                        "schema": {"files": {"type": "array", "items": {"type": "string"}}}, "required": ["files"]},
        "commit_staged": {"description": "Make a local commit from what is staged. This never reaches a remote.",
                          "schema": {"message": {"type": "string"}}, "required": ["message"]},
    }},
}
MCP_SCOPES = list(TOOL_SETS)


UNSAFE_SCOPES = {"workspace"}


def usable_scopes(scopes: list[str]) -> list[str]:
    return [scope for scope in scopes if not (PUBLIC_MODE and scope in UNSAFE_SCOPES)]


def mcp_tool_definitions(scopes: list[str]) -> list[dict[str, object]]:
    tools = []
    for scope in scopes:
        for name, spec in TOOL_SETS.get(scope, {}).get("tools", {}).items():
            tools.append({"name": f"{scope}.{name}", "description": spec["description"],
                          "inputSchema": {"type": "object", "properties": spec.get("schema", {}),
                                          "required": spec.get("required", [])}})
    return tools


def issue_agent_token(connection: sqlite3.Connection, user_id: int, label: str, scopes: list[str]) -> str:
    token = "vyb_" + secrets.token_urlsafe(32)
    connection.execute(
        "INSERT INTO agent_tokens(user_id,label,token_hash,scopes,created_at) VALUES(?,?,?,?,?)",
        (user_id, label, hashlib.sha256(token.encode()).hexdigest(), json.dumps(scopes), int(time.time())))
    return token


def neighborhood_payload(row: sqlite3.Row, garages: int = 0, mine: bool = False) -> dict[str, object]:
    return {"id": row["id"], "slug": row["slug"], "name": row["name"], "tagline": row["tagline"],
            "summary": row["summary"], "hue": row["hue"], "layout": row["layout"], "slots": json.loads(row["slots"]),
            "tags": json.loads(row["tags"]), "garages": garages, "mine": mine,
            "created_by": row["created_by"], "created_at": row["created_at"]}


def garage_payload(row: sqlite3.Row, projects: list[dict[str, object]]) -> dict[str, object]:
    """A garage stages projects. `modules` mirrors the flagship, so anything reading a garage
    from outside sees what a visitor would see without knowing about the staging underneath."""
    own = [project for project in projects if project["kind"] == "own"]
    flagship = next((project for project in own if project["flagship"]), own[0] if own else None)
    return {"id": row["id"], "name": row["name"], "tagline": row["tagline"], "tags": json.loads(row["tags"]),
            "display": row["display"], "updated_at": row["updated_at"], "workspace_id": row["workspace_id"],
            "handle": row["handle"], "display_name": row["display_name"],
            "neighborhood": row["neighborhood_slug"], "neighborhood_name": row["neighborhood_name"],
            "hue": row["hue"], "projects": own, "bench": [project for project in projects if project["kind"] == "borrowed"],
            "flagship": flagship,
            "modules": flagship["modules"] if flagship else [],
            "workflow": flagship["workflow"] if flagship else None}


WORKFLOW_KINDS = {"intake", "process", "decision", "store", "agent", "output", "external"}


def workflow_payload(row: sqlite3.Row | None) -> dict[str, object] | None:
    if not row:
        return None
    return {"name": row["name"], "notes": row["notes"], "nodes": json.loads(row["nodes"]),
            "edges": json.loads(row["edges"]), "updated_at": row["updated_at"]}


def mount_variant(connection: sqlite3.Connection, garage_id: int, variant: sqlite3.Row) -> None:
    """Swap a bay over to one of its candidates — another folder, another commit. One at a time."""
    connection.execute("UPDATE module_variants SET active=0 WHERE project_id=? AND slot=?", (variant["project_id"], variant["slot"]))
    connection.execute("UPDATE module_variants SET active=1 WHERE id=?", (variant["id"],))
    connection.execute("DELETE FROM garage_modules WHERE project_id=? AND slot=?", (variant["project_id"], variant["slot"]))
    connection.execute(
        """INSERT INTO garage_modules(garage_id,project_id,slot,name,lang,note,source,ref,status,weight)
           VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (garage_id, variant["project_id"], variant["slot"], variant["label"], variant["lang"], variant["note"],
         variant["source"], variant["ref"], variant["status"], variant["weight"]))
    connection.execute("UPDATE projects SET updated_at=? WHERE id=?", (int(time.time()), variant["project_id"]))
    connection.execute("UPDATE garages SET updated_at=? WHERE id=?", (int(time.time()), garage_id))


def borrow_project(connection: sqlite3.Connection, garage: sqlite3.Row, source: sqlite3.Row, hood: sqlite3.Row) -> int:
    """Copy someone's published build onto your bench: their bays, their wiring, their workflow.

    VybPort holds what they chose to show, not their source tree — so a borrowed build carries the
    structure and a pointer to where the real code lives. Fetching that is the agent's job.
    """
    now = int(time.time())
    cursor = connection.execute(
        """INSERT INTO projects(garage_id,name,tagline,flagship,kind,origin_handle,origin_project,origin_repo,created_at,updated_at)
           VALUES(?,?,?,0,'borrowed',?,?,?,?,?)""",
        (garage["id"], source["name"], source["tagline"], source["handle"], source["id"], source["origin_repo"] or "", now, now))
    project_id = cursor.lastrowid
    for module in connection.execute("SELECT * FROM garage_modules WHERE project_id=?", (source["id"],)):
        connection.execute(
            """INSERT INTO garage_modules(garage_id,project_id,slot,name,lang,note,source,ref,status,weight)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (garage["id"], project_id, module["slot"], module["name"], module["lang"], module["note"],
             module["source"], module["ref"], module["status"], module["weight"]))
    flow = connection.execute("SELECT * FROM workflows WHERE project_id=?", (source["id"],)).fetchone()
    if flow:
        connection.execute("INSERT INTO workflows(project_id,name,notes,nodes,edges,updated_at) VALUES(?,?,?,?,?,?)",
                           (project_id, flow["name"], flow["notes"], flow["nodes"], flow["edges"], now))
    connection.execute("UPDATE garages SET updated_at=? WHERE id=?", (now, garage["id"]))
    return project_id


def compare_projects(connection: sqlite3.Connection, hood: sqlite3.Row, mine: dict[str, object] | None,
                     theirs: dict[str, object]) -> list[dict[str, object]]:
    """Bay for bay. Everyone on a street mounts the same bays, which is the whole point of a street."""
    def by_slot(project):
        return {module["slot"]: module for module in (project or {}).get("modules", [])}
    ours, others = by_slot(mine), by_slot(theirs)
    rows = []
    for slot in json.loads(hood["slots"]):
        left, right = ours.get(slot["key"]), others.get(slot["key"])
        rows.append({"bay": slot["label"], "slot": slot["key"], "role": slot["role"],
                     "yours": {"name": left["name"], "lang": left["lang"], "note": left["note"]} if left else None,
                     "theirs": {"name": right["name"], "lang": right["lang"], "note": right["note"]} if right else None,
                     "verdict": "both" if left and right else "only theirs" if right else "only yours" if left else "neither"})
    return rows


def checkout_manifest(project: sqlite3.Row, modules: list[sqlite3.Row], flow: sqlite3.Row | None) -> str:
    lines = [f"# {project['name']}", "", f"Borrowed from @{project['origin_handle']} via VybPort.",
             f"Original repo: {project['origin_repo'] or 'not published'}", "",
             "VybPort copies the published structure, not the source. Fetch the real code from the repo above.", "", "## Bays", ""]
    for module in modules:
        lines.append(f"- **{module['slot']}** — {module['name']} ({module['lang'] or 'n/a'})"
                     + (f" · `{module['source']}`" if module["source"] else "")
                     + (f" @ {module['ref']}" if module["ref"] else "")
                     + (f"\n  {module['note']}" if module["note"] else ""))
    if flow:
        lines += ["", "## Workflow", "", f"**{flow['name']}**", ""]
        for node in json.loads(flow["nodes"]):
            lines.append(f"- [{node['kind']}] {node['label']}" + (f" — {node['note']}" if node.get("note") else ""))
    return "\n".join(lines) + "\n"


def current_project(connection: sqlite3.Connection, garage: sqlite3.Row, requested: object = None) -> sqlite3.Row:
    """Which project is being staged: the one asked for, else the flagship, else a first one."""
    if isinstance(requested, int):
        row = connection.execute("SELECT * FROM projects WHERE id=? AND garage_id=?", (requested, garage["id"])).fetchone()
        if not row:
            raise ValueError("That project is not in this garage.")
        return row
    row = connection.execute("SELECT * FROM projects WHERE garage_id=? AND kind='own' ORDER BY flagship DESC, id LIMIT 1", (garage["id"],)).fetchone()
    if row:
        return row
    now = int(time.time())
    cursor = connection.execute(
        "INSERT INTO projects(garage_id,name,tagline,flagship,workspace_id,created_at,updated_at) VALUES(?,?,?,1,?,?,?)",
        (garage["id"], garage["name"], garage["tagline"], garage["workspace_id"], now, now))
    return connection.execute("SELECT * FROM projects WHERE id=?", (cursor.lastrowid,)).fetchone()


def clean_workflow(nodes: object, edges: object) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """A workflow is a small graph. A person adds steps in order; an agent can place every node itself."""
    if not isinstance(nodes, list) or len(nodes) > 40:
        raise ValueError("A workflow holds up to 40 steps.")
    cleaned, seen = [], set()
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            raise ValueError("Each step must be an object.")
        key = re.sub(r"[^a-z0-9]+", "-", str(node.get("id") or node.get("label", "")).lower()).strip("-") or f"step{index + 1}"
        while key in seen:
            key += "x"
        seen.add(key)
        cleaned.append({
            "id": key, "label": str(node.get("label", key))[:48],
            "kind": node.get("kind") if node.get("kind") in WORKFLOW_KINDS else "process",
            "note": str(node.get("note", ""))[:120],
            "column": int(node["column"]) if isinstance(node.get("column"), (int, float)) else None,
            "row": int(node["row"]) if isinstance(node.get("row"), (int, float)) else None,
        })
    keys = {node["id"] for node in cleaned}
    wires = []
    if isinstance(edges, list):
        for edge in edges[:80]:
            if not isinstance(edge, dict):
                continue
            source, sink = str(edge.get("from", "")), str(edge.get("to", ""))
            if source in keys and sink in keys and source != sink:
                wires.append({"from": source, "to": sink, "label": str(edge.get("label", ""))[:32],
                              "kind": "branch" if edge.get("kind") == "branch" else "flow"})
    return cleaned, wires


def load_projects(connection: sqlite3.Connection, garage_ids: list[int]) -> dict[int, list[dict[str, object]]]:
    """A garage stages several projects. One is the flagship — the one a visitor sees first."""
    if not garage_ids:
        return {}
    marks = ",".join("?" * len(garage_ids))
    rows = connection.execute(
        f"SELECT * FROM projects WHERE garage_id IN ({marks}) ORDER BY kind, flagship DESC, updated_at DESC", tuple(garage_ids)).fetchall()
    if not rows:
        return {}
    ids = tuple(row["id"] for row in rows)
    project_marks = ",".join("?" * len(rows))
    modules: dict[int, list[sqlite3.Row]] = {}
    variants: dict[int, list[dict[str, object]]] = {}
    flows: dict[int, sqlite3.Row] = {}
    for module in connection.execute(f"SELECT * FROM garage_modules WHERE project_id IN ({project_marks}) ORDER BY id", ids):
        modules.setdefault(module["project_id"], []).append(module)
    for variant in connection.execute(f"SELECT * FROM module_variants WHERE project_id IN ({project_marks}) ORDER BY slot, id", ids):
        variants.setdefault(variant["project_id"], []).append(dict(variant) | {"active": bool(variant["active"])})
    for flow in connection.execute(f"SELECT * FROM workflows WHERE project_id IN ({project_marks})", ids):
        flows[flow["project_id"]] = flow
    grouped: dict[int, list[dict[str, object]]] = {}
    for row in rows:
        grouped.setdefault(row["garage_id"], []).append({
            "id": row["id"], "name": row["name"], "tagline": row["tagline"], "flagship": bool(row["flagship"]),
            "kind": row["kind"], "origin_handle": row["origin_handle"], "origin_project": row["origin_project"],
            "origin_repo": row["origin_repo"], "test_command": row["test_command"], "test_result": row["test_result"],
            "tested_at": row["tested_at"], "checkout_path": row["checkout_path"],
            "workspace_id": row["workspace_id"], "updated_at": row["updated_at"],
            "modules": [dict(module) for module in modules.get(row["id"], [])],
            "variants": variants.get(row["id"], []), "workflow": workflow_payload(flows.get(row["id"]))})
    return grouped


def load_garages(connection: sqlite3.Connection, where: str, params: tuple) -> list[dict[str, object]]:
    rows = connection.execute(
        f"""SELECT garages.*, users.handle, users.display_name,
                   neighborhoods.slug AS neighborhood_slug, neighborhoods.name AS neighborhood_name, neighborhoods.hue
            FROM garages JOIN users ON users.id=garages.user_id
            JOIN neighborhoods ON neighborhoods.id=garages.neighborhood_id
            WHERE {where} ORDER BY garages.updated_at DESC""", params).fetchall()
    if not rows:
        return []
    projects = load_projects(connection, [row["id"] for row in rows])
    return [garage_payload(row, projects.get(row["id"], [])) for row in rows]


def open_neighborhood(connection: sqlite3.Connection, slug: object) -> sqlite3.Row:
    row = connection.execute("SELECT * FROM neighborhoods WHERE slug=?", (str(slug or "").strip().lower(),)).fetchone()
    if not row:
        raise ValueError("That neighborhood does not exist.")
    return row


def benchmark_payload(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"], "slug": row["slug"], "title": row["title"], "summary": row["summary"],
        "metric": row["metric"], "adaptor": row["adaptor"], "score_max": row["score_max"],
        "cadence": row["cadence"], "capabilities": json.loads(row["capabilities"]),
        "sample_fixture": row["sample_fixture"], "opened_at": row["opened_at"], "closed_at": row["closed_at"],
    }


class VybPortHandler(SimpleHTTPRequestHandler):
    acting_token: int | None = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format: str, *args) -> None:
        print("VybPort:", format % args)

    def json_response(self, status: HTTPStatus, payload: dict[str, object], cookie: str | None = None) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def payload(self) -> dict[str, object]:
        length = int(self.headers.get("Content-Length", "0"))
        try:
            value = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as error:
            raise ValueError("Request body must be JSON.") from error
        if not isinstance(value, dict):
            raise ValueError("Request body must be an object.")
        return value

    def session_user(self) -> sqlite3.Row | None:
        token = next((part.split("=", 1)[1] for part in self.headers.get("Cookie", "").split(";") if part.strip().startswith("vybport_session=")), None)
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with db() as connection:
            row = connection.execute(
                """SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id
                   WHERE sessions.token_hash=? AND sessions.expires_at>?""", (token_hash, int(time.time()))
            ).fetchone()
        return row

    def require_user(self) -> sqlite3.Row:
        user = self.session_user()
        if not user:
            raise PermissionError("Create a local account or log in first.")
        return user

    def target(self, value: object) -> str:
        if not isinstance(value, str) or not TARGET_RE.fullmatch(value):
            raise ValueError("Invalid public item.")
        return value

    def issue_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        with db() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at<?", (int(time.time()),))
            connection.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time()) + 60 * 60 * 24 * 14))
        return f"vybport_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={60 * 60 * 24 * 14}"

    def rpc_response(self, request_id: object, result: object = None, error: dict[str, object] | None = None) -> None:
        body = {"jsonrpc": "2.0", "id": request_id}
        body["error" if error else "result"] = error or result
        self.json_response(HTTPStatus.OK, body)

    def handle_mcp(self) -> None:
        """One JSON-RPC endpoint. Any agent that speaks MCP works through a profile token; VybPort
        never has to know what that agent is."""
        request_id = None
        try:
            request = self.payload()
            request_id = request.get("id")
            method, params = request.get("method"), request.get("params") or {}
            if method == "initialize":
                self.rpc_response(request_id, {
                    "protocolVersion": MCP_VERSION, "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "vybport", "version": "1"},
                    "instructions": "Tools are grouped into sets; this token carries only the sets it was minted with. "
                                    "Nothing here reaches a remote: workspace commits stay local."})
                return
            if method in {"notifications/initialized", "ping"}:
                self.rpc_response(request_id, {})
                return
            user, scopes = self.token_user()
            if method == "tools/list":
                tools = [{"name": "directory", "description": "Every tool set on this server and which ones this token holds.",
                          "inputSchema": {"type": "object", "properties": {}, "required": []}}] + mcp_tool_definitions(scopes)
                self.rpc_response(request_id, {"tools": tools})
                return
            if method == "tools/call":
                name = str(params.get("name", ""))
                arguments = params.get("arguments") or {}
                if not isinstance(arguments, dict):
                    raise ValueError("arguments must be an object.")
                result = self.mcp_call(user, scopes, name, arguments)
                self.rpc_response(request_id, {"content": [{"type": "text", "text": json.dumps(result, indent=2)}], "isError": False})
                return
            self.rpc_response(request_id, error={"code": -32601, "message": f"Unknown method '{method}'."})
        except PermissionError as error:
            self.rpc_response(request_id, error={"code": -32001, "message": str(error)})
        except (ValueError, subprocess.TimeoutExpired) as error:
            self.rpc_response(request_id, {"content": [{"type": "text", "text": str(error)}], "isError": True})

    def token_user(self) -> tuple[sqlite3.Row, list[str]]:
        """A bearer token stands in for a profile. It carries only the tool sets it was minted with."""
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            raise PermissionError("Send this profile's agent token as a Bearer credential.")
        digest = hashlib.sha256(header[7:].strip().encode()).hexdigest()
        with db() as connection:
            row = connection.execute(
                """SELECT agent_tokens.id AS token_id, agent_tokens.scopes, users.* FROM agent_tokens
                   JOIN users ON users.id=agent_tokens.user_id
                   WHERE agent_tokens.token_hash=? AND agent_tokens.revoked_at IS NULL""", (digest,)).fetchone()
            if not row:
                raise PermissionError("That agent token is not valid on this profile.")
            connection.execute("UPDATE agent_tokens SET last_used_at=? WHERE id=?", (int(time.time()), row["token_id"]))
        self.acting_token = row["token_id"]
        return row, usable_scopes(json.loads(row["scopes"]))

    def mcp_call(self, user: sqlite3.Row, scopes: list[str], name: str, arguments: dict[str, object]) -> object:
        if name in {"directory", "mcp.directory"}:
            return {"held": scopes, "sets": [
                {"scope": scope, "summary": spec["summary"], "held": scope in scopes,
                 "tools": [f"{scope}.{tool}" for tool in spec["tools"]]} for scope, spec in TOOL_SETS.items()],
                "note": "Sets you do not hold need a new token from the person's profile."}
        scope, _, tool = name.partition(".")
        if scope not in scopes or tool not in TOOL_SETS.get(scope, {}).get("tools", {}):
            raise ValueError(f"This token cannot call '{name}'. It carries: {', '.join(scopes) or 'nothing'}.")
        with db() as connection:
            if name == "profile.whoami":
                garages = load_garages(connection, "garages.user_id=?", (user["id"],))
                return {"handle": user["handle"], "display_name": user["display_name"], "bio": user["bio"],
                        "owner": is_owner(user), "scopes": scopes,
                        "neighborhoods": [garage["neighborhood"] for garage in garages]}
            if name == "profile.list_my_garages":
                return {"garages": load_garages(connection, "garages.user_id=?", (user["id"],))}
            if name == "street.list_neighborhoods":
                counts = dict(connection.execute("SELECT neighborhood_id, COUNT(*) FROM garages GROUP BY neighborhood_id").fetchall())
                rows = connection.execute("SELECT * FROM neighborhoods ORDER BY name").fetchall()
                return {"neighborhoods": [neighborhood_payload(row, counts.get(row["id"], 0)) for row in rows]}
            if name == "street.read_neighborhood":
                hood = open_neighborhood(connection, arguments.get("slug"))
                count = connection.execute("SELECT COUNT(*) FROM garages WHERE neighborhood_id=?", (hood["id"],)).fetchone()[0]
                return {"neighborhood": neighborhood_payload(hood, count)}
            if name == "street.walk_street":
                hood = open_neighborhood(connection, arguments.get("slug"))
                focus = [str(tag) for tag in arguments.get("focus", [])] or json.loads(hood["tags"])[:3]
                garages = load_garages(connection, "garages.neighborhood_id=?", (hood["id"],))
                for garage in garages:
                    garage["shared"] = [tag for tag in garage["tags"] if tag in focus]
                    garage["distance"] = len(focus) - len(garage["shared"])
                garages.sort(key=lambda garage: (garage["distance"], -garage["updated_at"]))
                return {"neighborhood": hood["slug"], "focus": focus, "garages": garages}
            if name == "street.read_garage":
                hood = open_neighborhood(connection, arguments.get("neighborhood"))
                garages = load_garages(connection, "neighborhoods.id=? AND users.handle=?", (hood["id"], str(arguments.get("handle", "")).lower()))
                if not garages:
                    raise ValueError(f"No garage for @{arguments.get('handle')} on {hood['name']}.")
                garage = garages[0]
                snapshots = connection.execute(
                    "SELECT taken_at,summary FROM garage_snapshots WHERE garage_id=? ORDER BY id DESC LIMIT 5", (garage["id"],)).fetchall()
                target = f"garage:{garage['handle']}:{hood['slug']}"
                return {"garage": garage, "bays": json.loads(hood["slots"]), "layout": hood["layout"],
                        "recent_updates": [dict(row) for row in snapshots], "social_target": target,
                        "social": self.social(target, connection, user)}
            if name == "street.recent":
                hood = open_neighborhood(connection, arguments.get("slug"))
                limit = arguments.get("limit") if isinstance(arguments.get("limit"), int) else 10
                garages = load_garages(connection, "garages.neighborhood_id=?", (hood["id"],))[:max(1, min(50, limit))]
                return {"neighborhood": hood["slug"], "garages": [
                    {"handle": garage["handle"], "name": garage["name"], "tagline": garage["tagline"],
                     "updated_at": garage["updated_at"], "tags": garage["tags"],
                     "bays_filled": len(garage["modules"]), "bays_total": len(json.loads(hood["slots"])),
                     "social_target": f"garage:{garage['handle']}:{hood['slug']}"} for garage in garages]}
            if name == "social.read":
                return self.social(self.target(arguments.get("target")))
            if name == "social.comment":
                target = self.target(arguments.get("target"))
                body = str(arguments.get("body", "")).strip()
                if not 1 <= len(body) <= 2000:
                    raise ValueError("Notes must be between 1 and 2000 characters.")
                agent = connection.execute("SELECT agent_name FROM agent_tokens WHERE id=?", (self.acting_token,)).fetchone()
                connection.execute("INSERT INTO comments(target,user_id,body,via,created_at) VALUES(?,?,?,?,?)",
                                   (target, user["id"], body, (agent["agent_name"] if agent else "") or "agent", int(time.time())))
                return self.social(target, connection, user)
            if name == "social.bolt":
                target = self.target(arguments.get("target"))
                if connection.execute("SELECT 1 FROM likes WHERE user_id=? AND target=?", (user["id"], target)).fetchone():
                    connection.execute("DELETE FROM likes WHERE user_id=? AND target=?", (user["id"], target))
                else:
                    connection.execute("INSERT INTO likes(user_id,target,created_at) VALUES(?,?,?)", (user["id"], target, int(time.time())))
                return self.social(target, connection, user)
            if name == "arena.leaderboard":
                hood = open_neighborhood(connection, arguments.get("neighborhood"))
                current = connection.execute("SELECT * FROM benchmarks WHERE neighborhood_id=? AND closed_at IS NULL ORDER BY opened_at DESC", (hood["id"],)).fetchone()
                if not current:
                    return {"neighborhood": hood["slug"], "benchmark": None, "rows": [],
                            "note": f"No benchmark is open on {hood['name']}."}
                board = leaderboard(connection, current["id"])
                place, around, top = arguments.get("place"), arguments.get("around"), arguments.get("top")
                if isinstance(place, int):
                    rows = [row for row in board if row["place"] == place]
                    note = f"place {place}" if rows else f"There is no {place}th place — the board has {len(board)}."
                elif isinstance(around, int):
                    rows = [row for row in board if abs(row["place"] - around) <= 2]
                    note = f"places around {around}"
                else:
                    rows = board[:max(1, min(100, top if isinstance(top, int) else 3))]
                    note = f"top {len(rows)}"
                return {"neighborhood": hood["slug"], "benchmark": current["title"], "metric": current["metric"],
                        "board_size": len(board), "showing": note, "rows": rows}
            if name == "garage.open_garage":
                hood = open_neighborhood(connection, arguments.get("neighborhood"))
                now = int(time.time())
                try:
                    cursor = connection.execute(
                        """INSERT INTO garages(user_id,neighborhood_id,name,tagline,tags,display,created_at,updated_at)
                           VALUES(?,?,?,?,?,'',?,?)""",
                        (user["id"], hood["id"], str(arguments.get("name", "")).strip()[:60],
                         str(arguments.get("tagline", "")).strip()[:140],
                         json.dumps([str(tag)[:24] for tag in arguments.get("tags", [])][:8]), now, now))
                except sqlite3.IntegrityError:
                    raise ValueError(f"This profile already has a garage on {hood['name']}.") from None
                return {"garage": load_garages(connection, "garages.id=?", (cursor.lastrowid,))[0]}
            if name == "garage.list_projects":
                hood = open_neighborhood(connection, arguments.get("neighborhood"))
                garages = load_garages(connection, "garages.user_id=? AND garages.neighborhood_id=?", (user["id"], hood["id"]))
                if not garages:
                    raise ValueError(f"This profile has no garage on {hood['name']} yet.")
                return {"projects": garages[0]["projects"], "flagship": (garages[0]["flagship"] or {}).get("id")}
            if name in {"garage.new_project", "garage.set_flagship", "garage.add_variant", "garage.set_workflow"}:
                hood = open_neighborhood(connection, arguments.get("neighborhood"))
                garage = connection.execute("SELECT * FROM garages WHERE user_id=? AND neighborhood_id=?", (user["id"], hood["id"])).fetchone()
                if not garage:
                    raise ValueError(f"This profile has no garage on {hood['name']} yet.")
                if name == "garage.new_project":
                    now = int(time.time())
                    first = not connection.execute("SELECT 1 FROM projects WHERE garage_id=?", (garage["id"],)).fetchone()
                    connection.execute(
                        "INSERT INTO projects(garage_id,name,tagline,flagship,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                        (garage["id"], str(arguments.get("name", ""))[:60], str(arguments.get("tagline", ""))[:140], 1 if first else 0, now, now))
                elif name == "garage.set_flagship":
                    project = current_project(connection, garage, arguments.get("project"))
                    connection.execute("UPDATE projects SET flagship=0 WHERE garage_id=?", (garage["id"],))
                    connection.execute("UPDATE projects SET flagship=1 WHERE id=?", (project["id"],))
                elif name == "garage.add_variant":
                    project = current_project(connection, garage, arguments.get("project"))
                    slot = str(arguments.get("slot", ""))
                    if slot not in {item["key"] for item in json.loads(hood["slots"])}:
                        raise ValueError(f"'{slot}' is not a bay on {hood['name']}.")
                    cursor = connection.execute(
                        """INSERT INTO module_variants(garage_id,project_id,slot,label,source,ref,lang,note,status,weight,active,created_at)
                           VALUES(?,?,?,?,?,?,?,?,?,?,0,?)""",
                        (garage["id"], project["id"], slot, str(arguments.get("label", ""))[:60], str(arguments.get("source", ""))[:200],
                         str(arguments.get("ref", ""))[:40], str(arguments.get("lang", ""))[:24], str(arguments.get("note", ""))[:160],
                         "active", 3, int(time.time())))
                    if arguments.get("mount", True):
                        mount_variant(connection, garage["id"], connection.execute("SELECT * FROM module_variants WHERE id=?", (cursor.lastrowid,)).fetchone())
                else:
                    project = current_project(connection, garage, arguments.get("project"))
                    nodes, edges = clean_workflow(arguments.get("nodes"), arguments.get("edges"))
                    connection.execute(
                        """INSERT INTO workflows(project_id,name,notes,nodes,edges,updated_at) VALUES(?,?,?,?,?,?)
                           ON CONFLICT(project_id) DO UPDATE SET name=excluded.name, notes=excluded.notes,
                           nodes=excluded.nodes, edges=excluded.edges, updated_at=excluded.updated_at""",
                        (project["id"], str(arguments.get("name", "Workflow"))[:60], str(arguments.get("notes", ""))[:400],
                         json.dumps(nodes), json.dumps(edges), int(time.time())))
                connection.execute("UPDATE garages SET updated_at=? WHERE id=?", (int(time.time()), garage["id"]))
                return {"garage": load_garages(connection, "garages.id=?", (garage["id"],))[0]}
            if name in {"garage.borrow", "garage.compare"}:
                hood = open_neighborhood(connection, arguments.get("neighborhood"))
                garage = connection.execute("SELECT * FROM garages WHERE user_id=? AND neighborhood_id=?", (user["id"], hood["id"])).fetchone()
                if not garage:
                    raise ValueError(f"This profile has no garage on {hood['name']} yet.")
                if name == "garage.borrow":
                    source = connection.execute(
                        """SELECT projects.*, users.handle FROM projects JOIN garages ON garages.id=projects.garage_id
                           JOIN users ON users.id=garages.user_id
                           WHERE projects.id=? AND garages.neighborhood_id=? AND projects.kind='own'""",
                        (arguments.get("project"), hood["id"])).fetchone()
                    if not source:
                        raise ValueError("That build is not on this street.")
                    if source["garage_id"] == garage["id"]:
                        raise ValueError("That one is already yours.")
                    project_id = borrow_project(connection, garage, source, hood)
                    return {"borrowed": project_id, "from": source["handle"],
                            "note": "Structure copied, source not. The repo pointer is on the project; fetch the code yourself.",
                            "garage": load_garages(connection, "garages.id=?", (garage["id"],))[0]}
                projects = load_projects(connection, [garage["id"]]).get(garage["id"], [])
                theirs = next((project for project in projects if project["id"] == arguments.get("project")), None)
                if not theirs:
                    raise ValueError("Nothing on this garage with that id.")
                mine = next((project for project in projects if project["kind"] == "own" and project["flagship"]), None)
                return {"yours": (mine or {}).get("name"), "theirs": theirs["name"],
                        "bays": compare_projects(connection, hood, mine, theirs)}
            if name in {"garage.checkout", "garage.test"}:
                project = connection.execute(
                    """SELECT projects.* FROM projects JOIN garages ON garages.id=projects.garage_id
                       WHERE projects.id=? AND garages.user_id=?""", (arguments.get("project"), user["id"])).fetchone()
                if not project:
                    raise ValueError("That project is not on this profile.")
                garage = connection.execute("SELECT * FROM garages WHERE id=?", (project["garage_id"],)).fetchone()
                base, _ = garage_workspace(connection, garage, None, project)
                if name == "garage.checkout":
                    modules = connection.execute("SELECT * FROM garage_modules WHERE project_id=? ORDER BY id", (project["id"],)).fetchall()
                    flow = connection.execute("SELECT * FROM workflows WHERE project_id=?", (project["id"],)).fetchone()
                    slug = re.sub(r"[^a-z0-9]+", "-", f"{project['origin_handle'] or 'mine'}-{project['name']}".lower()).strip("-")
                    folder = base / "vybport-bench" / slug
                    folder.mkdir(parents=True, exist_ok=True)
                    (folder / "BORROWED.md").write_text(checkout_manifest(project, modules, flow), encoding="utf-8")
                    connection.execute("UPDATE projects SET checkout_path=? WHERE id=?", (str(folder), project["id"]))
                    return {"path": str(folder), "wrote": "BORROWED.md",
                            "note": "Work in this folder. Your own tools edit it; VybPort only staged the structure."}
                command = str(arguments.get("command", project["test_command"])).strip()
                if not command:
                    raise ValueError("Give the command that tests this build. {dir} expands to the workspace folder.")
                argv = expand_command(command, {"dir": str(base), "output": str(base)}, "dir")
                started = time.time()
                try:
                    result = subprocess.run(argv, cwd=base, text=True, capture_output=True, timeout=180, check=False)
                    outcome = f"exit {result.returncode} in {time.time() - started:.1f}s\n{(result.stdout or result.stderr or '').strip()[-1400:]}"
                except subprocess.TimeoutExpired:
                    outcome = "timed out after 180s"
                connection.execute("UPDATE projects SET test_command=?, test_result=?, tested_at=? WHERE id=?",
                                   (command, outcome, int(time.time()), project["id"]))
                return {"command": command, "result": outcome}
            if name == "garage.mount_variant":
                variant = connection.execute(
                    """SELECT module_variants.* FROM module_variants JOIN garages ON garages.id=module_variants.garage_id
                       WHERE module_variants.id=? AND garages.user_id=?""", (arguments.get("variant"), user["id"])).fetchone()
                if not variant:
                    raise ValueError("That variant is not on this profile.")
                mount_variant(connection, variant["garage_id"], variant)
                return {"garage": load_garages(connection, "garages.id=?", (variant["garage_id"],))[0]}
            if name == "garage.set_bays":
                hood = open_neighborhood(connection, arguments.get("neighborhood"))
                garage = connection.execute("SELECT * FROM garages WHERE user_id=? AND neighborhood_id=?", (user["id"], hood["id"])).fetchone()
                if not garage:
                    raise ValueError(f"This profile has no garage on {hood['name']} yet.")
                allowed = {item["key"] for item in json.loads(hood["slots"])}
                modules = arguments.get("modules")
                if not isinstance(modules, list):
                    raise ValueError("modules must be a list of {slot,name,...} objects.")
                project = current_project(connection, garage, arguments.get("project"))
                connection.execute("DELETE FROM garage_modules WHERE project_id=?", (project["id"],))
                for module in modules:
                    if not isinstance(module, dict) or module.get("slot") not in allowed:
                        raise ValueError(f"'{(module or {}).get('slot')}' is not a bay on {hood['name']}. Bays: {', '.join(sorted(allowed))}.")
                    if not str(module.get("name", "")).strip():
                        continue
                    connection.execute(
                        """INSERT INTO garage_modules(garage_id,project_id,slot,name,lang,note,status,weight) VALUES(?,?,?,?,?,?,?,?)""",
                        (garage["id"], project["id"], module["slot"], str(module["name"]).strip()[:60], str(module.get("lang", "")).strip()[:24],
                         str(module.get("note", "")).strip()[:160],
                         module.get("status") if module.get("status") in {"hot", "active", "stable"} else "active",
                         max(1, min(9, int(module.get("weight", 1)) if isinstance(module.get("weight"), (int, float)) else 1))))
                connection.execute("UPDATE projects SET updated_at=? WHERE id=?", (int(time.time()), project["id"]))
                connection.execute("UPDATE garages SET updated_at=? WHERE id=?", (int(time.time()), garage["id"]))
                return {"garage": load_garages(connection, "garages.id=?", (garage["id"],))[0]}
            if name == "session.register":
                connection.execute(
                    """UPDATE agent_tokens SET agent_name=?, agent_kind=?, agent_version=?, cwd=?,
                       registered_at=COALESCE(registered_at,?), heartbeat_at=? WHERE id=?""",
                    (str(arguments.get("name", "")).strip()[:60] or "unnamed agent", str(arguments.get("kind", "")).strip()[:40],
                     str(arguments.get("version", "")).strip()[:40], str(arguments.get("cwd", "")).strip()[:200],
                     int(time.time()), int(time.time()), self.acting_token))
                return {"registered": True, "profile": user["handle"],
                        "note": "You now appear as a live session on this profile. Call session.inbox to pick up work."}
            if name == "session.focus":
                row = connection.execute("SELECT * FROM focus WHERE user_id=?", (user["id"],)).fetchone()
                if not row:
                    return {"focus": None, "note": "They have not opened anything on the site yet."}
                return {"label": row["label"], "context": json.loads(row["context"]), "note": row["note"],
                        "updated_at": row["updated_at"],
                        "hint": "This is the thing they are looking at. Read it before answering questions about 'this'."}
            if name == "session.heartbeat":
                connection.execute("UPDATE agent_tokens SET heartbeat_at=? WHERE id=?", (int(time.time()), self.acting_token))
                return {"alive": True, "at": int(time.time())}
            if name == "session.inbox":
                rows = connection.execute(
                    "SELECT id,kind,body,context,created_at FROM agent_messages WHERE token_id=? AND delivered_at IS NULL ORDER BY id",
                    (self.acting_token,)).fetchall()
                connection.execute("UPDATE agent_messages SET delivered_at=? WHERE token_id=? AND delivered_at IS NULL",
                                   (int(time.time()), self.acting_token))
                return {"messages": [dict(row) for row in rows],
                        "note": "MCP is client-initiated, so this is a queue you drain rather than a push. Poll it, or call it when you are idle."}
            if name == "session.reply":
                changed = connection.execute(
                    "UPDATE agent_messages SET reply=?, replied_at=? WHERE id=? AND token_id=?",
                    (str(arguments.get("text", ""))[:4000], int(time.time()), arguments.get("id"), self.acting_token)).rowcount
                if not changed:
                    raise ValueError("No queued item with that id belongs to this session.")
                return {"replied": arguments.get("id")}
            if name == "workspace.list_workspaces":
                rows = connection.execute("SELECT id,label,path,scanned_at FROM workspaces WHERE user_id=? ORDER BY id", (user["id"],)).fetchall()
                return {"workspaces": [dict(row) for row in rows]}
            if name == "workspace.update_garage":
                hood = open_neighborhood(connection, arguments.get("neighborhood"))
                garage = connection.execute("SELECT * FROM garages WHERE user_id=? AND neighborhood_id=?", (user["id"], hood["id"])).fetchone()
                if not garage:
                    raise ValueError(f"This profile has no garage on {hood['name']} yet.")
                project = current_project(connection, garage, arguments.get("project"))
                base, workspace_id = garage_workspace(connection, garage, arguments.get("workspace"), project)
                result = take_snapshot(connection, garage, project, json.loads(hood["slots"]), base, workspace_id)
                return {"garage": load_garages(connection, "garages.id=?", (garage["id"],))[0], **result}
            if name == "arena.read_arena":
                hood = open_neighborhood(connection, arguments.get("neighborhood"))
                current = connection.execute("SELECT * FROM benchmarks WHERE neighborhood_id=? AND closed_at IS NULL ORDER BY opened_at DESC", (hood["id"],)).fetchone()
                spent = connection.execute("SELECT * FROM arena_tickets WHERE user_id=? AND neighborhood_id=? AND day=?", (user["id"], hood["id"], utc_day())).fetchone()
                previous = connection.execute("SELECT * FROM benchmarks WHERE neighborhood_id=? AND closed_at IS NOT NULL ORDER BY closed_at DESC", (hood["id"],)).fetchone()
                return {"neighborhood": hood["slug"], "adaptor": ARENA_ADAPTOR, "resets_at": next_ticket_reset(),
                        "benchmark": benchmark_payload(current) if current else None,
                        "board": leaderboard(connection, current["id"]) if current else [],
                        "podium": leaderboard(connection, previous["id"], 3) if previous else [],
                        "ticket_available": spent is None}
            if name == "arena.arena_preflight":
                hood = open_neighborhood(connection, arguments.get("neighborhood"))
                benchmark = connection.execute("SELECT * FROM benchmarks WHERE neighborhood_id=? AND closed_at IS NULL ORDER BY opened_at DESC", (hood["id"],)).fetchone()
                if not benchmark:
                    raise ValueError(f"No benchmark is open on {hood['name']}.")
                eligible, checks = preflight(benchmark, str(arguments.get("system", "")).strip(),
                                             arguments.get("capabilities", []), str(arguments.get("command", "")).strip())
                return {"eligible": eligible, "checks": checks, "ticket_spent": False,
                        "note": "Preflight never spends a ticket. Spending one is a deliberate step a person takes on the arena page."}
        if name == "workspace.read_rack":
            root = ROOT
            if isinstance(arguments.get("workspace"), int):
                with db() as connection:
                    row = connection.execute("SELECT * FROM workspaces WHERE id=? AND user_id=?", (arguments["workspace"], user["id"])).fetchone()
                if not row:
                    raise ValueError("That workspace is not paired to this profile.")
                root = paired_path(row["path"])
            requested = str(arguments.get("path", "") or "")
            base = (root / requested).resolve() if requested else root
            if base != root and (root not in base.parents or ".git" in base.parts):
                raise ValueError("That path is outside the paired workspace.")
            if not base.is_dir():
                raise ValueError("No such workspace folder.")
            return {"root": base.name, **scan_rack(base)}
        if name in {"workspace.read_file", "workspace.list_files"}:
            root = ROOT
            if isinstance(arguments.get("workspace"), int):
                with db() as connection:
                    row = connection.execute("SELECT * FROM workspaces WHERE id=? AND user_id=?", (arguments["workspace"], user["id"])).fetchone()
                if not row:
                    raise ValueError("That workspace is not paired to this profile.")
                root = paired_path(row["path"])
            if name == "workspace.read_file":
                return read_workspace_file(root, str(arguments.get("path", "")))
            return {"root": root.name, "files": workspace_tree(root, str(arguments.get("source", "")))}
        if name == "workspace.git_status":
            return git_status()
        if name == "workspace.stage_files":
            files = validated_files(arguments.get("files"))
            run_git("add", "--", *files)
            return {"staged": files, **git_status()}
        if name == "workspace.commit_staged":
            message = str(arguments.get("message", "")).strip()
            if not 1 <= len(message) <= 140:
                raise ValueError("Commit messages must be between 1 and 140 characters.")
            if not has_staged_changes():
                raise ValueError("Nothing is staged.")
            run_git("commit", "-m", message)
            return {"commit": run_git("rev-parse", "--short", "HEAD"), "pushed": False,
                    "note": "Local commit only. This bridge has no path to a remote."}
        raise ValueError(f"'{name}' is not implemented.")

    def close_benchmark(self, connection: sqlite3.Connection, row: sqlite3.Row) -> list[dict[str, object]]:
        """Ends the period and hands the top three a ribbon they carry into the next one."""
        podium = leaderboard(connection, row["id"], 3)
        connection.execute("UPDATE benchmarks SET closed_at=? WHERE id=?", (int(time.time()), row["id"]))
        connection.executemany(
            "INSERT OR IGNORE INTO daily_badges(day,target,leaderboard,placement) VALUES(?,?,?,?)",
            [(utc_day(), f"garage:{entry['handle']}", row["title"][:60], entry["place"]) for entry in podium],
        )
        return podium

    def social(self, target: str, connection: sqlite3.Connection | None = None, user: sqlite3.Row | None = None) -> dict[str, object]:
        """Pass the open connection when the caller has just written: a second one cannot see
        an uncommitted insert, so the reply would come back missing the thing it just added."""
        if connection is not None:
            return self.social_rows(connection, target, user)
        user = user or self.session_user()
        with db() as connection:
            return self.social_rows(connection, target, user)

    def social_rows(self, connection: sqlite3.Connection, target: str, user: sqlite3.Row | None) -> dict[str, object]:
        likes = connection.execute("SELECT COUNT(*) FROM likes WHERE target=?", (target,)).fetchone()[0]
        liked = bool(user and connection.execute("SELECT 1 FROM likes WHERE target=? AND user_id=?", (target, user["id"])).fetchone())
        rows = connection.execute(
            """SELECT comments.id,comments.body,comments.via,comments.created_at,users.handle,users.display_name
               FROM comments JOIN users ON users.id=comments.user_id WHERE target=?
               ORDER BY comments.id DESC LIMIT 100""", (target,)
        ).fetchall()
        return {"target": target, "likes": likes, "liked": liked, "comments": [dict(row) for row in rows]}

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/auth/me":
            user = self.session_user()
            self.json_response(HTTPStatus.OK, {"user": user_payload(user) if user else None})
            return
        if parsed.path == "/api/git/status":
            try:
                self.json_response(HTTPStatus.OK, git_status())
            except ValueError as error:
                self.json_response(HTTPStatus.CONFLICT, {"error": str(error)})
            return
        if parsed.path == "/api/arena/runs":
            with db() as connection:
                rows = connection.execute("SELECT * FROM arena_runs WHERE public=1 ORDER BY status='running' DESC, updated_at DESC").fetchall()
            self.json_response(HTTPStatus.OK, {"runs": [dict(row) for row in rows]})
            return
        if parsed.path == "/api/instance":
            self.json_response(HTTPStatus.OK, {"public": PUBLIC_MODE, "invite_required": bool(INVITE_CODE),
                                               "local_features": not PUBLIC_MODE})
            return
        if parsed.path == "/api/mcp/catalog":
            self.json_response(HTTPStatus.OK, {
                "server": "vybport", "protocol": MCP_VERSION, "endpoint": "/mcp",
                "auth": "Authorization: Bearer <profile agent token>",
                "sets": [{"scope": scope, "summary": spec["summary"],
                          "tools": [{"name": f"{scope}.{name}", "description": tool["description"],
                                     "arguments": sorted(tool.get("schema", {})), "required": tool.get("required", [])}
                                    for name, tool in spec["tools"].items()]}
                         for scope, spec in TOOL_SETS.items()]})
            return
        if parsed.path.startswith("/api/garages/") and parsed.path.rsplit("/", 1)[-1] in {"tree", "file"}:
            try:
                user = self.require_user()
                parts, query = parsed.path.split("/"), parse_qs(parsed.query)
                garage_id, want = int(parts[3]), parts[4]
                with db() as connection:
                    garage = connection.execute("SELECT * FROM garages WHERE id=? AND user_id=?", (garage_id, user["id"])).fetchone()
                    if not garage:
                        raise PermissionError("That garage is not yours.")
                    project = current_project(connection, garage, int(query["project"][0]) if query.get("project") else None)
                    base, _ = garage_workspace(connection, garage, None, project)
                source = query.get("source", query.get("path", [""]))[0]
                self.json_response(HTTPStatus.OK, {"root": base.name, **(
                    {"files": workspace_tree(base, source)} if want == "tree" else read_workspace_file(base, source))})
            except PermissionError as error:
                self.json_response(HTTPStatus.UNAUTHORIZED, {"error": str(error)})
            except (ValueError, OSError) as error:
                self.json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if parsed.path == "/api/focus":
            try:
                user = self.require_user()
                with db() as connection:
                    row = connection.execute("SELECT * FROM focus WHERE user_id=?", (user["id"],)).fetchone()
                self.json_response(HTTPStatus.OK, {"focus": (dict(row) | {"context": json.loads(row["context"])}) if row else None})
            except PermissionError as error:
                self.json_response(HTTPStatus.UNAUTHORIZED, {"error": str(error)})
            return
        if parsed.path.startswith("/api/garages/") and parsed.path.endswith("/compare"):
            try:
                user = self.require_user()
                garage_id = int(parsed.path.split("/")[3])
                against = int(parse_qs(parsed.query).get("project", ["0"])[0])
                with db() as connection:
                    garage = connection.execute("SELECT * FROM garages WHERE id=? AND user_id=?", (garage_id, user["id"])).fetchone()
                    if not garage:
                        raise PermissionError("That garage is not yours.")
                    hood = connection.execute("SELECT * FROM neighborhoods WHERE id=?", (garage["neighborhood_id"],)).fetchone()
                    projects = load_projects(connection, [garage_id]).get(garage_id, [])
                    theirs = next((project for project in projects if project["id"] == against), None)
                    mine = next((project for project in projects if project["kind"] == "own" and project["flagship"]), None)
                    if not theirs:
                        raise ValueError("Nothing on the bench with that id.")
                    rows = compare_projects(connection, hood, mine, theirs)
                self.json_response(HTTPStatus.OK, {"bays": rows, "yours": (mine or {}).get("name"), "theirs": theirs["name"],
                                                   "origin": theirs["origin_handle"]})
            except PermissionError as error:
                self.json_response(HTTPStatus.UNAUTHORIZED, {"error": str(error)})
            except ValueError as error:
                self.json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if parsed.path.startswith("/api/garages/") and parsed.path.endswith("/history"):
            try:
                user = self.require_user()
                garage_id = int(parsed.path.split("/")[3])
                source = parse_qs(parsed.query).get("source", [""])[0]
                with db() as connection:
                    garage = connection.execute("SELECT * FROM garages WHERE id=? AND user_id=?", (garage_id, user["id"])).fetchone()
                    if not garage:
                        raise PermissionError("That garage is not yours.")
                    base, _ = garage_workspace(connection, garage, None)
                self.json_response(HTTPStatus.OK, {"source": source, "commits": path_history(base, source)})
            except PermissionError as error:
                self.json_response(HTTPStatus.UNAUTHORIZED, {"error": str(error)})
            except ValueError as error:
                self.json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if parsed.path == "/api/workspaces":
            try:
                user = self.require_user()
                with db() as connection:
                    rows = connection.execute("SELECT id,label,path,scanned_at FROM workspaces WHERE user_id=? ORDER BY id", (user["id"],)).fetchall()
                self.json_response(HTTPStatus.OK, {"roots": [str(root) for root in WORKSPACE_ROOTS],
                                                   "workspaces": [dict(row) for row in rows]})
            except PermissionError as error:
                self.json_response(HTTPStatus.UNAUTHORIZED, {"error": str(error)})
            return
        if parsed.path == "/api/layouts":
            self.json_response(HTTPStatus.OK, {"layouts": [{"key": key, "summary": summary} for key, summary in LAYOUTS.items()]})
            return
        if parsed.path == "/api/agent-tokens":
            try:
                user = self.require_user()
                with db() as connection:
                    rows = connection.execute(
                        """SELECT id,label,scopes,created_at,last_used_at,revoked_at,agent_name,agent_kind,
                                  agent_version,cwd,registered_at,heartbeat_at FROM agent_tokens
                           WHERE user_id=? ORDER BY id DESC""", (user["id"],)).fetchall()
                    queued = dict(connection.execute(
                        """SELECT token_id, COUNT(*) FROM agent_messages WHERE user_id=? AND replied_at IS NULL
                           GROUP BY token_id""", (user["id"],)).fetchall())
                now = int(time.time())
                self.json_response(HTTPStatus.OK, {"scopes": MCP_SCOPES, "tokens": [
                    dict(row) | {"scopes": json.loads(row["scopes"]), "open_messages": queued.get(row["id"], 0),
                                 "live": bool(row["heartbeat_at"] and now - row["heartbeat_at"] < 600)}
                    for row in rows]})
            except PermissionError as error:
                self.json_response(HTTPStatus.UNAUTHORIZED, {"error": str(error)})
            return
        if parsed.path == "/api/neighborhoods":
            user = self.session_user()
            with db() as connection:
                counts = dict(connection.execute("SELECT neighborhood_id, COUNT(*) FROM garages GROUP BY neighborhood_id").fetchall())
                mine = {row[0] for row in connection.execute("SELECT neighborhood_id FROM garages WHERE user_id=?", (user["id"],))} if user else set()
                rows = connection.execute("SELECT * FROM neighborhoods ORDER BY created_by, name").fetchall()
            self.json_response(HTTPStatus.OK, {"neighborhoods": [
                neighborhood_payload(row, counts.get(row["id"], 0), row["id"] in mine) for row in rows]})
            return
        if parsed.path.startswith("/api/neighborhoods/"):
            slug = parsed.path.rsplit("/", 1)[-1]
            with db() as connection:
                row = connection.execute("SELECT * FROM neighborhoods WHERE slug=?", (slug,)).fetchone()
                if not row:
                    self.json_response(HTTPStatus.NOT_FOUND, {"error": "No such neighborhood."})
                    return
                count = connection.execute("SELECT COUNT(*) FROM garages WHERE neighborhood_id=?", (row["id"],)).fetchone()[0]
            self.json_response(HTTPStatus.OK, {"neighborhood": neighborhood_payload(row, count)})
            return
        if parsed.path == "/api/garages":
            query = parse_qs(parsed.query)
            user = self.session_user()
            with db() as connection:
                if query.get("mine"):
                    if not user:
                        self.json_response(HTTPStatus.OK, {"garages": []})
                        return
                    garages = load_garages(connection, "garages.user_id=?", (user["id"],))
                elif query.get("neighborhood"):
                    garages = load_garages(connection, "neighborhoods.slug=?", (query["neighborhood"][0],))
                else:
                    garages = load_garages(connection, "1=1", ())
            self.json_response(HTTPStatus.OK, {"garages": garages})
            return
        if parsed.path == "/api/project/rack":
            requested = parse_qs(parsed.query).get("path", [""])[0]
            base = (ROOT / requested).resolve() if requested else ROOT
            if base != ROOT and (ROOT not in base.parents or ".git" in base.parts):
                self.json_response(HTTPStatus.BAD_REQUEST, {"error": "That path is outside the approved workspace."})
                return
            if not base.is_dir():
                self.json_response(HTTPStatus.NOT_FOUND, {"error": "No such workspace folder."})
                return
            payload = scan_rack(base)
            self.json_response(HTTPStatus.OK, {"root": base.name, "path": requested, **payload})
            return
        if parsed.path == "/api/arena":
            user = self.session_user()
            requested = parse_qs(parsed.query).get("neighborhood", [""])[0]
            with db() as connection:
                hood = connection.execute("SELECT * FROM neighborhoods WHERE slug=?", (requested,)).fetchone() \
                    or connection.execute("SELECT * FROM neighborhoods ORDER BY id LIMIT 1").fetchone()
                if not hood:
                    self.json_response(HTTPStatus.OK, {"adaptor": ARENA_ADAPTOR, "neighborhood": None, "benchmark": None, "board": [], "previous": None, "you": None, "ticket": None, "resets_at": next_ticket_reset(), "day": utc_day()})
                    return
                current = connection.execute("SELECT * FROM benchmarks WHERE neighborhood_id=? AND closed_at IS NULL ORDER BY opened_at DESC", (hood["id"],)).fetchone()
                previous = connection.execute("SELECT * FROM benchmarks WHERE neighborhood_id=? AND closed_at IS NOT NULL ORDER BY closed_at DESC", (hood["id"],)).fetchone()
                payload: dict[str, object] = {
                    "adaptor": ARENA_ADAPTOR, "resets_at": next_ticket_reset(), "day": utc_day(),
                    "neighborhood": neighborhood_payload(hood),
                    "benchmark": benchmark_payload(current) if current else None,
                    "board": leaderboard(connection, current["id"]) if current else [],
                    "previous": ({"benchmark": benchmark_payload(previous), "podium": leaderboard(connection, previous["id"], 3)} if previous else None),
                    "you": None, "ticket": None,
                }
                if user:
                    spent = connection.execute("SELECT * FROM arena_tickets WHERE user_id=? AND neighborhood_id=? AND day=?", (user["id"], hood["id"], utc_day())).fetchone()
                    entry = connection.execute("SELECT id,system_name,score,status,detail,created_at FROM arena_entries WHERE id=?", (spent["entry_id"],)).fetchone() if spent and spent["entry_id"] else None
                    payload["you"] = {"handle": user["handle"], "display_name": user["display_name"], "owner": is_owner(user)}
                    payload["ticket"] = {"available": spent is None, "spent_at": spent["spent_at"] if spent else None, "entry": dict(entry) if entry else None}
            self.json_response(HTTPStatus.OK, payload)
            return
        if parsed.path == "/api/badges":
            requested_day = parse_qs(parsed.query).get("day", [time.strftime("%Y-%m-%d", time.gmtime())])[0]
            if not isinstance(requested_day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", requested_day):
                self.json_response(HTTPStatus.BAD_REQUEST, {"error": "Use a YYYY-MM-DD badge day."})
                return
            with db() as connection:
                rows = connection.execute("SELECT day,target,leaderboard,placement FROM daily_badges WHERE day=? ORDER BY leaderboard,placement", (requested_day,)).fetchall()
            self.json_response(HTTPStatus.OK, {"day": requested_day, "badges": [dict(row) for row in rows]})
            return
        if parsed.path == "/api/agents/providers":
            self.json_response(HTTPStatus.OK, {"providers": [
                {"key": key, "label": spec["label"], "hint": spec["hint"], "id_label": spec["id_label"],
                 "binary": spec["binary"], "detected": installed(spec), "starts": spec["start"] is not None,
                 "queues": spec["queue"] is not None, "needs_command": key == "custom"}
                for key, spec in PROVIDERS.items()]})
            return
        if parsed.path == "/api/agents":
            try:
                user = self.require_user()
                with db() as connection:
                    rows = connection.execute("SELECT id,provider,label,thread_id,command,created_at FROM agents WHERE user_id=? ORDER BY id DESC", (user["id"],)).fetchall()
                self.json_response(HTTPStatus.OK, {"agents": [dict(row) | {"provider_label": str(PROVIDERS.get(row["provider"], {}).get("label", row["provider"]))} for row in rows]})
            except PermissionError as error:
                self.json_response(HTTPStatus.UNAUTHORIZED, {"error": str(error)})
            return
        if parsed.path == "/api/social":
            try:
                target = self.target(parse_qs(parsed.query).get("target", [None])[0])
                self.json_response(HTTPStatus.OK, self.social(target))
            except ValueError as error:
                self.json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        self.serve_static(parsed.path)

    def serve_static(self, path: str) -> None:
        """Serve the front end and nothing else. SimpleHTTPRequestHandler would happily hand out
        data/vybport.sqlite3 and server.py, so the allowlist runs before it does."""
        target = "/index.html" if path in {"/", ""} else path
        candidate = (ROOT / target.lstrip("/")).resolve()
        allowed = (
            ROOT in candidate.parents
            and candidate.is_file()
            and candidate.suffix.lower() in STATIC_SUFFIXES
            and not any(part.startswith(".") for part in candidate.relative_to(ROOT).parts)
            and (candidate.parent == ROOT or candidate.relative_to(ROOT).parts[0] in STATIC_DIRS)
        )
        if not allowed:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        self.path = "/" + str(candidate.relative_to(ROOT))
        super().do_GET()

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        if route == "/mcp":
            self.handle_mcp()
            return
        try:
            payload = self.payload()
            if PUBLIC_MODE and (route.startswith("/api/git/") or route in {"/api/agents/start", "/api/arena/attempt", "/api/arena/preflight"}
                                or re.fullmatch(r"/api/agents/\d+/message", route) or re.fullmatch(r"/api/garages/\d+/update", route)
                                or route == "/api/workspaces"):
                raise ValueError("This is a public VybPort instance. Anything that runs a command on the host is turned off here — "
                                 "run your own copy locally for the workspace, agent and arena-entry features.")
            if route == "/api/auth/register":
                if INVITE_CODE and str(payload.get("invite", "")).strip() != INVITE_CODE:
                    raise ValueError("This instance is invite-only. Ask whoever sent you the link for the code.")
                handle = str(payload.get("handle", "")).strip().lower()
                name = str(payload.get("display_name", "")).strip()
                password = payload.get("password")
                bio = str(payload.get("bio", "")).strip()[:280]
                if not HANDLE_RE.fullmatch(handle):
                    raise ValueError("Use a 3–32 character lowercase handle: letters, numbers, and hyphens.")
                if not 2 <= len(name) <= 60 or not isinstance(password, str) or len(password) < 8:
                    raise ValueError("Use a display name and a password of at least 8 characters.")
                with db() as connection:
                    try:
                        cursor = connection.execute("INSERT INTO users(handle,display_name,password_hash,bio,created_at) VALUES(?,?,?,?,?)", (handle, name, password_hash(password), bio, int(time.time())))
                    except sqlite3.IntegrityError as error:
                        raise ValueError("That VybPort handle is already taken on this local prototype.") from error
                    row = connection.execute("SELECT * FROM users WHERE id=?", (cursor.lastrowid,)).fetchone()
                self.json_response(HTTPStatus.CREATED, {"user": user_payload(row)}, self.issue_session(row["id"]))
                return
            if route == "/api/auth/login":
                handle, password = str(payload.get("handle", "")).lower(), payload.get("password")
                with db() as connection:
                    row = connection.execute("SELECT * FROM users WHERE handle=?", (handle,)).fetchone()
                if not row or not isinstance(password, str) or not password_matches(password, row["password_hash"]):
                    raise PermissionError("Incorrect handle or password.")
                self.json_response(HTTPStatus.OK, {"user": user_payload(row)}, self.issue_session(row["id"]))
                return
            if route == "/api/auth/logout":
                user = self.require_user()
                with db() as connection:
                    connection.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
                self.json_response(HTTPStatus.OK, {"ok": True}, "vybport_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
                return
            if route in {"/api/git/stage", "/api/git/unstage", "/api/git/commit"}:
                if route == "/api/git/stage":
                    run_git("add", "--", *validated_files(payload.get("files")))
                    response = {"ok": True}
                elif route == "/api/git/unstage":
                    run_git("restore", "--staged", "--", *validated_files(payload.get("files")))
                    response = {"ok": True}
                else:
                    message = payload.get("message")
                    if not isinstance(message, str) or not 1 <= len(message.strip()) <= 140:
                        raise ValueError("Use a commit message between 1 and 140 characters.")
                    if not has_staged_changes():
                        raise ValueError("There are no staged changes to commit.")
                    run_git("commit", "-m", message.strip())
                    response = {"commit": run_git("rev-parse", "--short", "HEAD")}
                self.json_response(HTTPStatus.CREATED if route == "/api/git/commit" else HTTPStatus.OK, response)
                return
            if route == "/api/agents":
                user = self.require_user()
                provider, spec = provider_spec(payload.get("provider"))
                label, thread_id = str(payload.get("label", "")).strip(), str(payload.get("thread_id", "")).strip()
                command = str(payload.get("command", "")).strip() if provider == "custom" else ""
                if not 1 <= len(label) <= 60 or not 1 <= len(thread_id) <= 120:
                    raise ValueError(f"Name the session and paste its exact {spec['id_label']}.")
                if PUBLIC_MODE:
                    raise ValueError("Agent sessions are a local feature. Run your own copy to link one.")
                if provider == "custom":
                    custom_command(command, thread_id, "probe", DATA_DIR / "probe")
                elif not installed(spec):
                    raise ValueError(f"{spec['label']} is not on this machine's PATH, so VybPort cannot reach that session.")
                with db() as connection:
                    try:
                        cursor = connection.execute("INSERT INTO agents(user_id,provider,label,thread_id,command,created_at) VALUES(?,?,?,?,?,?)", (user["id"], provider, label, thread_id, command, int(time.time())))
                    except sqlite3.IntegrityError as error:
                        raise ValueError(f"That {spec['label']} session is already linked to this account.") from error
                    agent = connection.execute("SELECT id,provider,label,thread_id FROM agents WHERE id=?", (cursor.lastrowid,)).fetchone()
                self.json_response(HTTPStatus.CREATED, {"agent": dict(agent)})
                return
            if route == "/api/agents/start":
                user = self.require_user()
                provider, spec = provider_spec(payload.get("provider") or default_provider())
                initial_message = payload.get("message")
                if not isinstance(initial_message, str) or not 1 <= len(initial_message.strip()) <= 6000:
                    raise ValueError("Start the local agent chat with a message between 1 and 6000 characters.")
                if not spec["start"]:
                    raise ValueError(f"VybPort cannot open a {spec['label']} session for you — link one you already have running.")
                if not installed(spec):
                    raise ValueError(f"{spec['label']} is not on this machine's PATH.")
                thread_id, reply = agent_turn(provider, spec, "", initial_message.strip(), "")
                if not thread_id:
                    raise ValueError(f"{spec['label']} answered but did not return a resumable session id, so VybPort did not link it.")
                with db() as connection:
                    cursor = connection.execute("INSERT INTO agents(user_id,provider,label,thread_id,command,created_at) VALUES(?,?,?,?,?,?)", (user["id"], provider, f"{spec['label']} · VybPort chat", thread_id, "", int(time.time())))
                    agent = connection.execute("SELECT id,provider,label,thread_id FROM agents WHERE id=?", (cursor.lastrowid,)).fetchone()
                self.json_response(HTTPStatus.CREATED, {"agent": dict(agent), "reply": reply or f"{spec['label']} started the session without a final text response."})
                return
            if route.startswith("/api/agents/") and route.endswith("/message"):
                user = self.require_user()
                agent_id = int(route.split("/")[3])
                message = payload.get("message")
                if not isinstance(message, str) or not 1 <= len(message.strip()) <= 6000:
                    raise ValueError("Agent messages must be between 1 and 6000 characters.")
                with db() as connection:
                    agent = connection.execute("SELECT * FROM agents WHERE id=? AND user_id=?", (agent_id, user["id"])).fetchone()
                if not agent:
                    raise PermissionError("That linked agent is not available to this account.")
                provider, spec = provider_spec(agent["provider"])
                mode = payload.get("mode", "chat")
                if mode not in {"chat", "queue"}:
                    raise ValueError("Unsupported local agent delivery mode.")
                if mode == "queue":
                    if not spec["queue"]:
                        raise ValueError(f"{spec['label']} has no queue command, so VybPort waits for the reply instead.")
                    result = subprocess.run(spec["queue"](agent["thread_id"], message.strip()), cwd=ROOT, text=True, capture_output=True, timeout=20, check=False)
                    if result.returncode:
                        raise ValueError(result.stderr.strip() or f"{spec['label']} did not accept the message. Check that the session is active and local.")
                    self.json_response(HTTPStatus.OK, {"delivered": True, "mode": "queue", "agent": {"id": agent["id"], "label": agent["label"], "provider": provider}})
                    return
                _, reply = agent_turn(provider, spec, agent["thread_id"], message.strip(), agent["command"])
                self.json_response(HTTPStatus.OK, {"delivered": True, "mode": "chat", "reply": reply or f"{spec['label']} completed the turn without a final text response.", "agent": {"id": agent["id"], "label": agent["label"], "provider": provider}})
                return
            if route == "/api/agent-tokens":
                user = self.require_user()
                label = str(payload.get("label", "")).strip()
                scopes = [scope for scope in payload.get("scopes", []) if scope in MCP_SCOPES] if isinstance(payload.get("scopes"), list) else []
                if not 1 <= len(label) <= 60:
                    raise ValueError("Name the agent this token is for.")
                if not scopes:
                    raise ValueError(f"Pick at least one tool set: {', '.join(MCP_SCOPES)}.")
                with db() as connection:
                    token = issue_agent_token(connection, user["id"], label, scopes)
                # Shown once. Only its hash is kept, so a lost token is replaced rather than recovered.
                self.json_response(HTTPStatus.CREATED, {"token": token, "label": label, "scopes": scopes,
                                                        "endpoint": "/mcp", "protocol": MCP_VERSION})
                return
            if route == "/api/workspaces":
                user = self.require_user()
                base = paired_path(payload.get("path"))
                label = str(payload.get("label", "")).strip()[:60] or base.name
                with db() as connection:
                    try:
                        cursor = connection.execute("INSERT INTO workspaces(user_id,label,path,created_at) VALUES(?,?,?,?)",
                                                    (user["id"], label, str(base), int(time.time())))
                    except sqlite3.IntegrityError:
                        raise ValueError("That folder is already paired.") from None
                    row = connection.execute("SELECT id,label,path,scanned_at FROM workspaces WHERE id=?", (cursor.lastrowid,)).fetchone()
                self.json_response(HTTPStatus.CREATED, {"workspace": dict(row)})
                return
            if route == "/api/workspaces/unpair":
                user = self.require_user()
                with db() as connection:
                    connection.execute("UPDATE garages SET workspace_id=NULL WHERE workspace_id=? AND user_id=?", (payload.get("id"), user["id"]))
                    changed = connection.execute("DELETE FROM workspaces WHERE id=? AND user_id=?", (payload.get("id"), user["id"])).rowcount
                if not changed:
                    raise ValueError("That workspace is not paired to this profile.")
                self.json_response(HTTPStatus.OK, {"unpaired": payload.get("id")})
                return
            if route == "/api/focus":
                user = self.require_user()
                context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
                with db() as connection:
                    connection.execute(
                        """INSERT INTO focus(user_id,label,context,note,updated_at) VALUES(?,?,?,?,?)
                           ON CONFLICT(user_id) DO UPDATE SET label=excluded.label, context=excluded.context,
                           note=excluded.note, updated_at=excluded.updated_at""",
                        (user["id"], str(payload.get("label", ""))[:140], json.dumps(context)[:4000],
                         str(payload.get("note", ""))[:2000], int(time.time())))
                self.json_response(HTTPStatus.OK, {"focus": {"label": payload.get("label", ""), "context": context}})
                return
            if re.fullmatch(r"/api/garages/\d+/borrow", route):
                user = self.require_user()
                garage_id = int(route.split("/")[3])
                with db() as connection:
                    garage = connection.execute("SELECT * FROM garages WHERE id=? AND user_id=?", (garage_id, user["id"])).fetchone()
                    if not garage:
                        raise PermissionError("That garage is not yours.")
                    hood = connection.execute("SELECT * FROM neighborhoods WHERE id=?", (garage["neighborhood_id"],)).fetchone()
                    source = connection.execute(
                        """SELECT projects.*, users.handle FROM projects
                           JOIN garages ON garages.id=projects.garage_id JOIN users ON users.id=garages.user_id
                           WHERE projects.id=? AND garages.neighborhood_id=? AND projects.kind='own'""",
                        (payload.get("project"), garage["neighborhood_id"])).fetchone()
                    if not source:
                        raise ValueError("That build is not on this street, so its bays would not line up with yours.")
                    if source["garage_id"] == garage_id:
                        raise ValueError("That one is already yours.")
                    project_id = borrow_project(connection, garage, source, hood)
                    garages = load_garages(connection, "garages.id=?", (garage_id,))
                self.json_response(HTTPStatus.CREATED, {"garage": garages[0], "project": project_id,
                                                        "note": "On your bench. VybPort copied the published structure; the source lives wherever they keep it."})
                return
            if re.fullmatch(r"/api/projects/\d+/test", route):
                user = self.require_user()
                project_id = int(route.split("/")[3])
                with db() as connection:
                    project = connection.execute(
                        """SELECT projects.*, garages.user_id AS owner FROM projects JOIN garages ON garages.id=projects.garage_id
                           WHERE projects.id=? AND garages.user_id=?""", (project_id, user["id"])).fetchone()
                    if not project:
                        raise PermissionError("That project is not yours.")
                    command = str(payload.get("command", project["test_command"])).strip()
                    garage = connection.execute("SELECT * FROM garages WHERE id=?", (project["garage_id"],)).fetchone()
                    base, _ = garage_workspace(connection, garage, payload.get("workspace"), project)
                if not command:
                    raise ValueError("Give the command that tests this build.")
                argv = expand_command(command, {"dir": str(base), "output": str(base)}, "dir")
                started = time.time()
                try:
                    result = subprocess.run(argv, cwd=base, text=True, capture_output=True, timeout=180, check=False)
                    tail = (result.stdout or result.stderr or "").strip()[-1400:]
                    outcome = f"exit {result.returncode} in {time.time() - started:.1f}s\n{tail}"
                except subprocess.TimeoutExpired:
                    outcome = "timed out after 180s"
                with db() as connection:
                    connection.execute("UPDATE projects SET test_command=?, test_result=?, tested_at=? WHERE id=?",
                                       (command, outcome, int(time.time()), project_id))
                    garages = load_garages(connection, "garages.id=?", (project["garage_id"],))
                self.json_response(HTTPStatus.OK, {"garage": garages[0], "result": outcome, "command": command})
                return
            if re.fullmatch(r"/api/projects/\d+/checkout", route):
                user = self.require_user()
                project_id = int(route.split("/")[3])
                with db() as connection:
                    project = connection.execute(
                        """SELECT projects.* FROM projects JOIN garages ON garages.id=projects.garage_id
                           WHERE projects.id=? AND garages.user_id=?""", (project_id, user["id"])).fetchone()
                    if not project:
                        raise PermissionError("That project is not yours.")
                    garage = connection.execute("SELECT * FROM garages WHERE id=?", (project["garage_id"],)).fetchone()
                    base, _ = garage_workspace(connection, garage, payload.get("workspace"), project)
                    modules = connection.execute("SELECT * FROM garage_modules WHERE project_id=? ORDER BY id", (project_id,)).fetchall()
                    flow = connection.execute("SELECT * FROM workflows WHERE project_id=?", (project_id,)).fetchone()
                slug = re.sub(r"[^a-z0-9]+", "-", f"{project['origin_handle'] or 'mine'}-{project['name']}".lower()).strip("-")
                folder = base / "vybport-bench" / slug
                folder.mkdir(parents=True, exist_ok=True)
                (folder / "BORROWED.md").write_text(checkout_manifest(project, modules, flow), encoding="utf-8")
                with db() as connection:
                    connection.execute("UPDATE projects SET checkout_path=? WHERE id=?", (str(folder), project_id))
                    garages = load_garages(connection, "garages.id=?", (project["garage_id"],))
                self.json_response(HTTPStatus.OK, {"garage": garages[0], "path": str(folder),
                                                   "note": "A working folder with the structure and a pointer to the source. Point your agent at it."})
                return
            if re.fullmatch(r"/api/garages/\d+/projects", route):
                user = self.require_user()
                garage_id = int(route.split("/")[3])
                name = str(payload.get("name", "")).strip()[:60]
                if not name:
                    raise ValueError("Name the project you are putting on the rack.")
                with db() as connection:
                    garage = connection.execute("SELECT * FROM garages WHERE id=? AND user_id=?", (garage_id, user["id"])).fetchone()
                    if not garage:
                        raise PermissionError("That garage is not yours.")
                    now = int(time.time())
                    first = not connection.execute("SELECT 1 FROM projects WHERE garage_id=?", (garage_id,)).fetchone()
                    cursor = connection.execute(
                        "INSERT INTO projects(garage_id,name,tagline,flagship,workspace_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                        (garage_id, name, str(payload.get("tagline", "")).strip()[:140], 1 if first else 0,
                         payload.get("workspace") if isinstance(payload.get("workspace"), int) else None, now, now))
                    garages = load_garages(connection, "garages.id=?", (garage_id,))
                self.json_response(HTTPStatus.CREATED, {"garage": garages[0], "project": cursor.lastrowid})
                return
            if re.fullmatch(r"/api/projects/\d+/flagship", route):
                user = self.require_user()
                project_id = int(route.split("/")[3])
                with db() as connection:
                    project = connection.execute(
                        """SELECT projects.* FROM projects JOIN garages ON garages.id=projects.garage_id
                           WHERE projects.id=? AND garages.user_id=?""", (project_id, user["id"])).fetchone()
                    if not project:
                        raise PermissionError("That project is not yours.")
                    if project["kind"] != "own":
                        raise ValueError("A borrowed build sits on the bench. Only your own work goes on display.")
                    connection.execute("UPDATE projects SET flagship=0 WHERE garage_id=?", (project["garage_id"],))
                    connection.execute("UPDATE projects SET flagship=1 WHERE id=?", (project_id,))
                    connection.execute("UPDATE garages SET updated_at=? WHERE id=?", (int(time.time()), project["garage_id"]))
                    garages = load_garages(connection, "garages.id=?", (project["garage_id"],))
                self.json_response(HTTPStatus.OK, {"garage": garages[0], "flagship": project_id})
                return
            if re.fullmatch(r"/api/projects/\d+/remove", route):
                user = self.require_user()
                project_id = int(route.split("/")[3])
                with db() as connection:
                    project = connection.execute(
                        """SELECT projects.* FROM projects JOIN garages ON garages.id=projects.garage_id
                           WHERE projects.id=? AND garages.user_id=?""", (project_id, user["id"])).fetchone()
                    if not project:
                        raise PermissionError("That project is not yours.")
                    if connection.execute("SELECT COUNT(*) FROM projects WHERE garage_id=?", (project["garage_id"],)).fetchone()[0] < 2:
                        raise ValueError("A garage keeps at least one project on the rack.")
                    for table in ("garage_modules", "module_variants"):
                        connection.execute(f"DELETE FROM {table} WHERE project_id=?", (project_id,))
                    connection.execute("DELETE FROM workflows WHERE project_id=?", (project_id,))
                    connection.execute("DELETE FROM projects WHERE id=?", (project_id,))
                    if project["flagship"]:
                        remaining = connection.execute("SELECT id FROM projects WHERE garage_id=? ORDER BY updated_at DESC LIMIT 1", (project["garage_id"],)).fetchone()
                        connection.execute("UPDATE projects SET flagship=1 WHERE id=?", (remaining["id"],))
                    garages = load_garages(connection, "garages.id=?", (project["garage_id"],))
                self.json_response(HTTPStatus.OK, {"garage": garages[0]})
                return
            if re.fullmatch(r"/api/garages/\d+/variants", route):
                user = self.require_user()
                garage_id = int(route.split("/")[3])
                with db() as connection:
                    garage = connection.execute("SELECT * FROM garages WHERE id=? AND user_id=?", (garage_id, user["id"])).fetchone()
                    if not garage:
                        raise PermissionError("That garage is not yours.")
                    hood = connection.execute("SELECT * FROM neighborhoods WHERE id=?", (garage["neighborhood_id"],)).fetchone()
                    project = current_project(connection, garage, payload.get("project"))
                    slot = str(payload.get("slot", ""))
                    if slot not in {item["key"] for item in json.loads(hood["slots"])}:
                        raise ValueError(f"'{slot}' is not a bay on {hood['name']}.")
                    label = str(payload.get("label", "")).strip()[:60]
                    if not label:
                        raise ValueError("Name this variant — a folder, a file, or a commit.")
                    cursor = connection.execute(
                        """INSERT INTO module_variants(garage_id,project_id,slot,label,source,ref,lang,note,status,weight,active,created_at)
                           VALUES(?,?,?,?,?,?,?,?,?,?,0,?)""",
                        (garage_id, project["id"], slot, label, str(payload.get("source", "")).strip()[:200], str(payload.get("ref", "")).strip()[:40],
                         str(payload.get("lang", "")).strip()[:24], str(payload.get("note", "")).strip()[:160],
                         payload.get("status") if payload.get("status") in {"hot", "active", "stable"} else "active",
                         max(1, min(9, int(payload.get("weight", 3)) if isinstance(payload.get("weight"), (int, float)) else 3)),
                         int(time.time())))
                    if payload.get("mount", True):
                        mount_variant(connection, garage_id, connection.execute("SELECT * FROM module_variants WHERE id=?", (cursor.lastrowid,)).fetchone())
                    garages = load_garages(connection, "garages.id=?", (garage_id,))
                self.json_response(HTTPStatus.CREATED, {"garage": garages[0], "variant": cursor.lastrowid})
                return
            if re.fullmatch(r"/api/variants/\d+/mount", route):
                user = self.require_user()
                variant_id = int(route.split("/")[3])
                with db() as connection:
                    variant = connection.execute(
                        """SELECT module_variants.* FROM module_variants JOIN garages ON garages.id=module_variants.garage_id
                           WHERE module_variants.id=? AND garages.user_id=?""", (variant_id, user["id"])).fetchone()
                    if not variant:
                        raise PermissionError("That variant is not yours.")
                    mount_variant(connection, variant["garage_id"], variant)
                    garages = load_garages(connection, "garages.id=?", (variant["garage_id"],))
                self.json_response(HTTPStatus.OK, {"garage": garages[0], "mounted": variant_id})
                return
            if re.fullmatch(r"/api/garages/\d+/workflow", route):
                user = self.require_user()
                garage_id = int(route.split("/")[3])
                nodes, edges = clean_workflow(payload.get("nodes"), payload.get("edges"))
                with db() as connection:
                    garage = connection.execute("SELECT * FROM garages WHERE id=? AND user_id=?", (garage_id, user["id"])).fetchone()
                    if not garage:
                        raise PermissionError("That garage is not yours.")
                    project = current_project(connection, garage, payload.get("project"))
                    connection.execute(
                        """INSERT INTO workflows(project_id,name,notes,nodes,edges,updated_at) VALUES(?,?,?,?,?,?)
                           ON CONFLICT(project_id) DO UPDATE SET name=excluded.name, notes=excluded.notes,
                           nodes=excluded.nodes, edges=excluded.edges, updated_at=excluded.updated_at""",
                        (project["id"], str(payload.get("name", "Workflow"))[:60], str(payload.get("notes", ""))[:400],
                         json.dumps(nodes), json.dumps(edges), int(time.time())))
                    garages = load_garages(connection, "garages.id=?", (garage_id,))
                self.json_response(HTTPStatus.OK, {"garage": garages[0]})
                return
            if re.fullmatch(r"/api/garages/\d+/update", route):
                user = self.require_user()
                garage_id = int(route.split("/")[3])
                with db() as connection:
                    garage = connection.execute("SELECT * FROM garages WHERE id=? AND user_id=?", (garage_id, user["id"])).fetchone()
                    if not garage:
                        raise PermissionError("That garage is not yours.")
                    hood = connection.execute("SELECT * FROM neighborhoods WHERE id=?", (garage["neighborhood_id"],)).fetchone()
                    project = current_project(connection, garage, payload.get("project"))
                    base, workspace_id = garage_workspace(connection, garage, payload.get("workspace"), project)
                    result = take_snapshot(connection, garage, project, json.loads(hood["slots"]), base, workspace_id)
                    history = connection.execute(
                        "SELECT id,taken_at,summary FROM garage_snapshots WHERE garage_id=? ORDER BY id DESC LIMIT 8", (garage_id,)).fetchall()
                    garages = load_garages(connection, "garages.id=?", (garage_id,))
                self.json_response(HTTPStatus.OK, {"garage": garages[0], "history": [dict(row) for row in history], **result})
                return
            if re.fullmatch(r"/api/agent-tokens/\d+/send", route):
                user = self.require_user()
                token_id = int(route.split("/")[3])
                body = str(payload.get("body", "")).strip()
                if not 1 <= len(body) <= 4000:
                    raise ValueError("Say something between 1 and 4000 characters.")
                with db() as connection:
                    token = connection.execute("SELECT * FROM agent_tokens WHERE id=? AND user_id=? AND revoked_at IS NULL", (token_id, user["id"])).fetchone()
                    if not token:
                        raise PermissionError("That agent session is not on this profile.")
                    if "session" not in json.loads(token["scopes"]):
                        raise ValueError("That token was minted without the 'session' set, so it cannot receive work.")
                    cursor = connection.execute(
                        "INSERT INTO agent_messages(token_id,user_id,kind,body,context,created_at) VALUES(?,?,?,?,?,?)",
                        (token_id, user["id"], str(payload.get("kind", "task"))[:24], body, str(payload.get("context", ""))[:2000], int(time.time())))
                self.json_response(HTTPStatus.CREATED, {"queued": cursor.lastrowid,
                                                        "note": "Waiting for that session to call session.inbox."})
                return
            if route == "/api/agent-tokens/revoke":
                user = self.require_user()
                token_id = payload.get("id")
                if not isinstance(token_id, int):
                    raise ValueError("Which token should be revoked?")
                with db() as connection:
                    changed = connection.execute("UPDATE agent_tokens SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL",
                                                 (int(time.time()), token_id, user["id"])).rowcount
                if not changed:
                    raise ValueError("That token is already revoked, or is not yours.")
                self.json_response(HTTPStatus.OK, {"revoked": token_id})
                return
            if route == "/api/neighborhoods":
                user = self.require_user()
                slug, name = str(payload.get("slug", "")).strip().lower(), str(payload.get("name", "")).strip()
                if not SLUG_RE.fullmatch(slug) or not 1 <= len(name) <= 60:
                    raise ValueError("Give the neighborhood a lowercase slug and a name.")
                slots = payload.get("slots")
                if not isinstance(slots, list) or not 2 <= len(slots) <= 10:
                    raise ValueError("A neighborhood needs between 2 and 10 shared bays.")
                cleaned = []
                for item in slots:
                    label = str((item or {}).get("label", "")).strip() if isinstance(item, dict) else str(item).strip()
                    if not 1 <= len(label) <= 32:
                        raise ValueError("Every bay needs a label of 32 characters or less.")
                    key = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-") or f"bay{len(cleaned) + 1}"
                    role = str((item or {}).get("role", "logic")) if isinstance(item, dict) else "logic"
                    cleaned.append(slot(key, label, role if role in RACK_ROLES else "logic",
                                        str((item or {}).get("hint", "")).strip()[:120] if isinstance(item, dict) else ""))
                if len({item["key"] for item in cleaned}) != len(cleaned):
                    raise ValueError("Two bays cannot share a name.")
                tags = [str(tag).strip().lower()[:24] for tag in payload.get("tags", []) if str(tag).strip()][:12] if isinstance(payload.get("tags"), list) else []
                hue = payload.get("hue", 200)
                hue = int(hue) % 360 if isinstance(hue, (int, float)) and not isinstance(hue, bool) else 200
                with db() as connection:
                    try:
                        cursor = connection.execute(
                            """INSERT INTO neighborhoods(slug,name,tagline,summary,hue,slots,tags,layout,created_by,created_at)
                               VALUES(?,?,?,?,?,?,?,?,?,?)""",
                            (slug, name, str(payload.get("tagline", "")).strip()[:140], str(payload.get("summary", "")).strip()[:600],
                             hue, json.dumps(cleaned), json.dumps(tags),
                             payload.get("layout") if payload.get("layout") in LAYOUTS else "rack",
                             user["id"], int(time.time())))
                    except sqlite3.IntegrityError:
                        raise ValueError("That neighborhood slug is taken.") from None
                    row = connection.execute("SELECT * FROM neighborhoods WHERE id=?", (cursor.lastrowid,)).fetchone()
                self.json_response(HTTPStatus.CREATED, {"neighborhood": neighborhood_payload(row)})
                return
            if route == "/api/garages":
                user = self.require_user()
                name = str(payload.get("name", "")).strip()
                if not 1 <= len(name) <= 60:
                    raise ValueError("Name the garage you are opening.")
                tags = [str(tag).strip().lower()[:24] for tag in payload.get("tags", []) if str(tag).strip()][:8] if isinstance(payload.get("tags"), list) else []
                with db() as connection:
                    hood = open_neighborhood(connection, payload.get("neighborhood"))
                    now = int(time.time())
                    try:
                        cursor = connection.execute(
                            """INSERT INTO garages(user_id,neighborhood_id,name,tagline,tags,display,created_at,updated_at)
                               VALUES(?,?,?,?,?,?,?,?)""",
                            (user["id"], hood["id"], name, str(payload.get("tagline", "")).strip()[:140],
                             json.dumps(tags), str(payload.get("display", "")).strip()[:200], now, now))
                    except sqlite3.IntegrityError:
                        raise ValueError(f"You already have a garage on {hood['name']}. Open its door instead.") from None
                    garages = load_garages(connection, "garages.id=?", (cursor.lastrowid,))
                self.json_response(HTTPStatus.CREATED, {"garage": garages[0]})
                return
            if re.fullmatch(r"/api/garages/\d+/modules", route):
                user = self.require_user()
                garage_id = int(route.split("/")[3])
                modules = payload.get("modules")
                if not isinstance(modules, list) or len(modules) > 12:
                    raise ValueError("Send the bays you are filling, up to twelve.")
                with db() as connection:
                    garage = connection.execute("SELECT * FROM garages WHERE id=? AND user_id=?", (garage_id, user["id"])).fetchone()
                    if not garage:
                        raise PermissionError("That garage is not yours.")
                    hood = connection.execute("SELECT * FROM neighborhoods WHERE id=?", (garage["neighborhood_id"],)).fetchone()
                    allowed = {item["key"] for item in json.loads(hood["slots"])}
                    project = current_project(connection, garage, payload.get("project"))
                    connection.execute("DELETE FROM garage_modules WHERE project_id=?", (project["id"],))
                    for module in modules:
                        if not isinstance(module, dict) or module.get("slot") not in allowed:
                            raise ValueError(f"'{(module or {}).get('slot')}' is not a bay on {hood['name']}.")
                        if not str(module.get("name", "")).strip():
                            continue
                        connection.execute(
                            """INSERT INTO garage_modules(garage_id,project_id,slot,name,lang,note,status,weight)
                               VALUES(?,?,?,?,?,?,?,?)""",
                            (garage_id, project["id"], module["slot"], str(module["name"]).strip()[:60], str(module.get("lang", "")).strip()[:24],
                             str(module.get("note", "")).strip()[:160],
                             module.get("status") if module.get("status") in {"hot", "active", "stable"} else "active",
                             max(1, min(9, int(module.get("weight", 1)) if isinstance(module.get("weight"), (int, float)) else 1))))
                    connection.execute("UPDATE garages SET updated_at=? WHERE id=?", (int(time.time()), garage_id))
                    garages = load_garages(connection, "garages.id=?", (garage_id,))
                self.json_response(HTTPStatus.OK, {"garage": garages[0]})
                return
            if route in {"/api/arena/preflight", "/api/arena/attempt"}:
                user = self.require_user()
                system = str(payload.get("system", "")).strip()
                capabilities, command = payload.get("capabilities", []), str(payload.get("command", "")).strip()
                with db() as connection:
                    hood = open_neighborhood(connection, payload.get("neighborhood"))
                    benchmark = connection.execute("SELECT * FROM benchmarks WHERE neighborhood_id=? AND closed_at IS NULL ORDER BY opened_at DESC", (hood["id"],)).fetchone()
                if not benchmark:
                    raise ValueError(f"No benchmark is open on {hood['name']} right now.")
                if route == "/api/arena/preflight":
                    eligible, checks = preflight(benchmark, system, capabilities, command)
                    self.json_response(HTTPStatus.OK, {"eligible": eligible, "checks": checks, "spent": False})
                    return
                with db() as connection:
                    if connection.execute("SELECT 1 FROM arena_tickets WHERE user_id=? AND neighborhood_id=? AND day=?", (user["id"], hood["id"], utc_day())).fetchone():
                        raise ValueError(f"Today's {hood['name']} ticket is already spent. A new one arrives at 00:00 UTC.")
                # Nothing is charged until the entry has proved it runs under the standard adaptor.
                eligible, checks = preflight(benchmark, system, capabilities, command)
                if not eligible:
                    self.json_response(HTTPStatus.OK, {"eligible": False, "checks": checks, "spent": False,
                                                       "message": "Preflight failed, so your ticket is untouched. Fix the entry and try again."})
                    return
                with db() as connection:
                    try:
                        connection.execute("INSERT INTO arena_tickets(user_id,neighborhood_id,day,benchmark_id,entry_id,spent_at) VALUES(?,?,?,?,NULL,?)", (user["id"], hood["id"], utc_day(), benchmark["id"], int(time.time())))
                    except sqlite3.IntegrityError:
                        raise ValueError("Today's ticket for this neighborhood is already spent.") from None
                score, detail, problem = run_adaptor(command, benchmark["scored_fixture"], SCORED_TIMEOUT)
                scored = problem == "" and score is not None and 0 <= score <= benchmark["score_max"]
                if not scored and not problem:
                    problem = f"The scored run returned {score}, outside 0–{benchmark['score_max']:g}."
                with db() as connection:
                    cursor = connection.execute(
                        """INSERT INTO arena_entries(benchmark_id,user_id,system_name,command,score,detail,status,created_at)
                           VALUES(?,?,?,?,?,?,?,?)""",
                        (benchmark["id"], user["id"], system, command, score if scored else None,
                         json.dumps(detail) if scored else problem, "scored" if scored else "failed", int(time.time())))
                    connection.execute("UPDATE arena_tickets SET entry_id=? WHERE user_id=? AND neighborhood_id=? AND day=?", (cursor.lastrowid, user["id"], hood["id"], utc_day()))
                    board = leaderboard(connection, benchmark["id"])
                place = next((row["place"] for row in board if row["handle"] == user["handle"]), None)
                self.json_response(HTTPStatus.CREATED, {
                    "eligible": True, "checks": checks, "spent": True, "status": "scored" if scored else "failed",
                    "score": score if scored else None, "detail": detail if scored else problem, "place": place, "board": board,
                    "message": f"Scored {score:g} {benchmark['metric']}." if scored else f"Ticket spent: the held-out run failed after a clean preflight. {problem}"})
                return
            if route == "/api/arena/benchmark":
                user = self.require_user()
                if not is_owner(user):
                    raise PermissionError("Only this instance's owners publish benchmarks.")
                slug, title = str(payload.get("slug", "")).strip().lower(), str(payload.get("title", "")).strip()
                if not SLUG_RE.fullmatch(slug) or not 1 <= len(title) <= 120:
                    raise ValueError("Give the benchmark a lowercase slug and a title.")
                capabilities = [str(item).strip() for item in payload.get("capabilities", []) if str(item).strip()] if isinstance(payload.get("capabilities"), list) else []
                fixtures = {}
                for key in ("sample_fixture", "scored_fixture"):
                    raw = payload.get(key)
                    text = raw if isinstance(raw, str) else json.dumps(raw)
                    try:
                        json.loads(text)
                    except (json.JSONDecodeError, TypeError):
                        raise ValueError(f"The {key.replace('_', ' ')} must be valid JSON.") from None
                    fixtures[key] = text
                score_max = payload.get("score_max", 100)
                if not isinstance(score_max, (int, float)) or isinstance(score_max, bool) or not 0 < score_max <= 1_000_000:
                    raise ValueError("Set a positive score ceiling.")
                cadence = str(payload.get("cadence", "manual")).strip().lower()
                if cadence not in {"daily", "weekly", "manual"}:
                    raise ValueError("Cadence is daily, weekly, or manual.")
                with db() as connection:
                    hood = open_neighborhood(connection, payload.get("neighborhood"))
                    open_row = connection.execute("SELECT * FROM benchmarks WHERE neighborhood_id=? AND closed_at IS NULL ORDER BY opened_at DESC", (hood["id"],)).fetchone()
                    if open_row:
                        self.close_benchmark(connection, open_row)
                    try:
                        cursor = connection.execute(
                            """INSERT INTO benchmarks(slug,title,neighborhood_id,summary,metric,adaptor,score_max,cadence,capabilities,sample_fixture,scored_fixture,opened_at,closed_at,created_by)
                               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)""",
                            (slug, title, hood["id"], str(payload.get("summary", "")).strip()[:600], str(payload.get("metric", "score")).strip()[:40] or "score",
                             ARENA_ADAPTOR, float(score_max), cadence, json.dumps(capabilities),
                             fixtures["sample_fixture"], fixtures["scored_fixture"], int(time.time()), user["id"]))
                    except sqlite3.IntegrityError:
                        raise ValueError("That benchmark slug already exists.") from None
                    row = connection.execute("SELECT * FROM benchmarks WHERE id=?", (cursor.lastrowid,)).fetchone()
                self.json_response(HTTPStatus.CREATED, {"benchmark": benchmark_payload(row)})
                return
            if route == "/api/arena/benchmark/close":
                user = self.require_user()
                if not is_owner(user):
                    raise PermissionError("Only this instance's owners close benchmarks.")
                with db() as connection:
                    hood = open_neighborhood(connection, payload.get("neighborhood"))
                    open_row = connection.execute("SELECT * FROM benchmarks WHERE neighborhood_id=? AND closed_at IS NULL ORDER BY opened_at DESC", (hood["id"],)).fetchone()
                    if not open_row:
                        raise ValueError(f"No benchmark is open on {hood['name']}.")
                    podium = self.close_benchmark(connection, open_row)
                self.json_response(HTTPStatus.OK, {"closed": open_row["slug"], "podium": podium})
                return
            if route == "/api/social/like":
                user, target = self.require_user(), self.target(payload.get("target"))
                with db() as connection:
                    existing = connection.execute("SELECT 1 FROM likes WHERE user_id=? AND target=?", (user["id"], target)).fetchone()
                    if existing: connection.execute("DELETE FROM likes WHERE user_id=? AND target=?", (user["id"], target))
                    else: connection.execute("INSERT INTO likes(user_id,target,created_at) VALUES(?,?,?)", (user["id"], target, int(time.time())))
                self.json_response(HTTPStatus.OK, self.social(target))
                return
            if route == "/api/social/comment":
                user, target, body = self.require_user(), self.target(payload.get("target")), payload.get("body")
                if not isinstance(body, str) or not 1 <= len(body.strip()) <= 2000:
                    raise ValueError("Comments must be between 1 and 2000 characters.")
                with db() as connection:
                    connection.execute("INSERT INTO comments(target,user_id,body,created_at) VALUES(?,?,?,?)", (target, user["id"], body.strip(), int(time.time())))
                self.json_response(HTTPStatus.CREATED, self.social(target))
                return
            raise ValueError("Unknown local VybPort action.")
        except PermissionError as error:
            self.json_response(HTTPStatus.UNAUTHORIZED, {"error": str(error)})
        except (ValueError, subprocess.TimeoutExpired) as error:
            self.json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})


def run() -> None:
    init_db()
    # Bind before announcing anything: a failed start should not print a URL that is not serving.
    try:
        server = ThreadingHTTPServer((HOST, PORT), VybPortHandler)
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
        print(f"Port {PORT} is already in use — something else is bound to it, most likely an older VybPort.")
        print(f"  find it:  ss -ltnp | grep :{PORT}")
        print("  a suspended process ignores SIGTERM until it is resumed, so use:  kill -CONT <pid>; kill <pid>")
        print(f"  or run this one elsewhere:  VYBPORT_PORT={PORT + 1} python3 server.py")
        raise SystemExit(1) from None
    if PUBLIC_MODE:
        print("VybPort PUBLIC mode: git bridge, workspace tools, agent sessions and arena entries are off.")
        print(f"Registration is {'invite-only' if INVITE_CODE else 'OPEN — set VYBPORT_INVITE to gate it'}.")
    print(f"VybPort service: http://{HOST}:{PORT}" + ("" if HOST != "0.0.0.0" else "  (reachable off this machine)"))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nVybPort stopped.")
        server.server_close()


if __name__ == "__main__":
    run()
