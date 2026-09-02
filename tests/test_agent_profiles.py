from __future__ import annotations

import base64
import hashlib
import http.client
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

import server


def ssh_ed25519_public_key(seed: int = 0) -> str:
    key_type = b"ssh-ed25519"
    key_bytes = bytes((seed + index) % 256 for index in range(32))
    blob = len(key_type).to_bytes(4, "big") + key_type + len(key_bytes).to_bytes(4, "big") + key_bytes
    return "ssh-ed25519 " + base64.b64encode(blob).decode("ascii") + " ignored-comment"


class QuietHandler(server.VybPortHandler):
    def log_message(self, format: str, *args) -> None:
        pass


class AgentProfileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.old_database = server.DATABASE
        self.old_data_dir = server.DATA_DIR
        self.old_public_mode = server.PUBLIC_MODE
        self.old_owner_handles = server.OWNER_HANDLES
        server.DATA_DIR = Path(self.temp.name)
        server.DATABASE = server.DATA_DIR / "vybport-test.sqlite3"
        server.PUBLIC_MODE = False
        server.OWNER_HANDLES = set()
        server.init_db()
        with server.db() as connection:
            self.alice_id = connection.execute(
                "INSERT INTO users(handle,display_name,password_hash,bio,created_at) VALUES(?,?,?,?,?)",
                ("alice", "Alice", server.password_hash("correct-horse"), "builder", int(time.time())),
            ).lastrowid
            self.bob_id = connection.execute(
                "INSERT INTO users(handle,display_name,password_hash,bio,created_at) VALUES(?,?,?,?,?)",
                ("bob", "Bob", server.password_hash("correct-horse"), "reviewer", int(time.time())),
            ).lastrowid

    def tearDown(self) -> None:
        server.DATABASE = self.old_database
        server.DATA_DIR = self.old_data_dir
        server.PUBLIC_MODE = self.old_public_mode
        server.OWNER_HANDLES = self.old_owner_handles
        self.temp.cleanup()

    def issue(self, **overrides):
        arguments = {
            "profile_slug": "bench-agent",
            "bio": "Reviews borrowed builds before checkout.",
            "public": True,
            "ssh_public_key": ssh_ed25519_public_key(),
            "lifetime_days": 30,
        }
        arguments.update(overrides)
        with server.db() as connection:
            token = server.issue_agent_token(
                connection, self.alice_id, "Bench Agent", ["profile", "street", "session"], **arguments
            )
            row = connection.execute("SELECT * FROM agent_tokens WHERE user_id=?", (self.alice_id,)).fetchone()
        return token, row

    def test_agent_secret_is_unique_hashed_expiring_and_ssh_bound(self) -> None:
        token, row = self.issue()
        self.assertTrue(token.startswith("vyb_agent_"))
        self.assertNotEqual(row["token_hash"], token)
        self.assertEqual(row["token_hash"], hashlib.sha256(token.encode()).hexdigest())
        self.assertEqual(row["token_hint"], token[-8:])
        self.assertEqual(row["profile_slug"], "bench-agent")
        self.assertTrue(row["public_id"].startswith("agt_"))
        self.assertEqual(row["ssh_key_type"], "ssh-ed25519")
        self.assertTrue(row["ssh_fingerprint"].startswith("SHA256:"))
        self.assertNotIn("ignored-comment", row["ssh_public_key"])
        self.assertGreater(row["expires_at"], int(time.time()) + 29 * 86400)

        with server.db() as connection, self.assertRaisesRegex(ValueError, "already bound"):
            server.issue_agent_token(
                connection, self.alice_id, "Copycat", ["profile"],
                profile_slug="copycat", ssh_public_key=ssh_ed25519_public_key(),
            )
        header_only = len(b"ssh-ed25519").to_bytes(4, "big") + b"ssh-ed25519"
        malformed = "ssh-ed25519 " + base64.b64encode(header_only).decode("ascii")
        with self.assertRaisesRegex(ValueError, "incomplete or malformed"):
            server.clean_ssh_public_key(malformed)

    def test_rotation_preserves_identity_and_invalidates_old_key(self) -> None:
        old_token, old_row = self.issue(ssh_public_key="")
        with server.db() as connection:
            self.assertIsNotNone(server.find_agent_identity(connection, old_token))
            with self.assertRaises(PermissionError):
                server.rotate_agent_token(connection, self.bob_id, old_row["id"])
            new_token, new_row = server.rotate_agent_token(connection, self.alice_id, old_row["id"], lifetime_days=7)
            self.assertIsNone(server.find_agent_identity(connection, old_token))
            identity = server.find_agent_identity(connection, new_token)
        self.assertIsNotNone(identity)
        self.assertNotEqual(old_token, new_token)
        self.assertEqual(old_row["public_id"], new_row["public_id"])
        self.assertEqual(old_row["profile_slug"], new_row["profile_slug"])

    def test_expired_and_revoked_keys_do_not_authenticate(self) -> None:
        token, row = self.issue(ssh_public_key="")
        with server.db() as connection:
            connection.execute("UPDATE agent_tokens SET expires_at=? WHERE id=?", (int(time.time()) - 1, row["id"]))
            self.assertIsNone(server.find_agent_identity(connection, token))
            connection.execute("UPDATE agent_tokens SET expires_at=?,revoked_at=? WHERE id=?",
                               (int(time.time()) + 86400, int(time.time()), row["id"]))
            self.assertIsNone(server.find_agent_identity(connection, token))

    def test_public_projection_does_not_expose_credential_or_working_directory(self) -> None:
        _, row = self.issue()
        with server.db() as connection:
            connection.execute("UPDATE agent_tokens SET cwd=? WHERE id=?", ("/private/client/repo", row["id"]))
            joined = connection.execute(
                """SELECT agent_tokens.*,users.handle,users.display_name FROM agent_tokens
                   JOIN users ON users.id=agent_tokens.user_id WHERE agent_tokens.id=?""", (row["id"],)
            ).fetchone()
        public = server.agent_profile_payload(joined)
        owner = server.agent_profile_payload(joined, owner_view=True)
        for private_field in ("scopes", "token_hint", "expires_at", "ssh_public_key", "cwd"):
            self.assertNotIn(private_field, public)
        self.assertEqual(owner["cwd"], "/private/client/repo")
        self.assertEqual(public["identity"], "@alice/bench-agent")

    def test_public_garage_projection_contains_only_the_flagship_display(self) -> None:
        flagship = {
            "id": 7, "name": "Shown build", "tagline": "the public face", "flagship": True,
            "kind": "own", "updated_at": 123, "origin_repo": "private/repo", "workspace_id": 9,
            "checkout_path": "/private/checkout", "test_command": "printenv", "test_result": "SECRET=x",
            "variants": [{"source": "/private/candidate"}],
            "modules": [{"id": 4, "garage_id": 2, "project_id": 7, "slot": "logic", "name": "core",
                         "lang": "Python", "note": "mounted", "status": "active", "weight": 1,
                         "source": "/private/core", "ref": "deadbeef"}],
            "workflow": {"name": "Public flow", "nodes": [], "edges": []},
        }
        garage = {
            "id": 2, "name": "Alice's garage", "tagline": "builds", "tags": ["agents"], "display": "rack",
            "updated_at": 123, "handle": "alice", "display_name": "Alice", "neighborhood": "agent-systems",
            "neighborhood_name": "AI agent systems", "hue": 265, "workspace_id": 9,
            "projects": [flagship, {"id": 8, "name": "Unpublished"}], "bench": [{"id": 10}],
            "flagship": flagship, "modules": flagship["modules"], "workflow": flagship["workflow"],
        }
        public = server.public_garage_payload(garage)
        self.assertEqual([project["id"] for project in public["projects"]], [7])
        for private_field in ("workspace_id", "bench"):
            self.assertNotIn(private_field, public)
        shown = public["flagship"]
        for private_field in ("origin_repo", "workspace_id", "checkout_path", "test_command", "test_result", "variants"):
            self.assertNotIn(private_field, shown)
        self.assertNotIn("source", shown["modules"][0])
        self.assertNotIn("ref", shown["modules"][0])

    def test_public_mode_hides_and_blocks_host_execution_tools(self) -> None:
        token, _ = self.issue(ssh_public_key="")
        ordinary = {tool["name"] for tool in server.mcp_tool_definitions(["garage", "arena"])}
        elevated = {tool["name"] for tool in server.mcp_tool_definitions(["garage", "arena", "host"])}
        self.assertNotIn("garage.test", ordinary)
        self.assertIn("garage.test", elevated)
        with server.db() as connection:
            identity = server.find_agent_identity(connection, token)
        handler = object.__new__(server.VybPortHandler)
        handler.acting_token = identity["token_id"]
        with self.assertRaisesRegex(ValueError, "explicit 'host' grant"):
            handler.mcp_call(identity, ["garage"], "garage.test", {"project": 1, "command": "false"})

        server.PUBLIC_MODE = True
        definitions = {tool["name"] for tool in server.mcp_tool_definitions(["garage", "arena", "host", "workspace"])}
        self.assertNotIn("garage.checkout", definitions)
        self.assertNotIn("garage.test", definitions)
        self.assertNotIn("arena.arena_preflight", definitions)
        self.assertEqual(server.usable_scopes(["profile", "host", "workspace"]), ["profile"])
        with self.assertRaisesRegex(ValueError, "disabled on a public"):
            handler.mcp_call(identity, ["garage"], "garage.test", {"project": 1, "command": "false"})

    def test_public_registration_cannot_win_owner_by_being_first(self) -> None:
        with server.db() as connection:
            alice = connection.execute("SELECT * FROM users WHERE id=?", (self.alice_id,)).fetchone()
        self.assertTrue(server.is_owner(alice))
        server.PUBLIC_MODE = True
        self.assertFalse(server.is_owner(alice))
        server.OWNER_HANDLES = {"alice"}
        self.assertTrue(server.is_owner(alice))


class LegacyAgentTokenMigrationTests(unittest.TestCase):
    def test_old_token_rows_gain_stable_profiles_and_keep_authenticating(self) -> None:
        old_database, old_data_dir = server.DATABASE, server.DATA_DIR
        with tempfile.TemporaryDirectory() as folder:
            try:
                server.DATA_DIR = Path(folder)
                server.DATABASE = server.DATA_DIR / "legacy.sqlite3"
                raw_token = "vyb_" + "a" * 43
                connection = sqlite3.connect(server.DATABASE)
                connection.executescript(
                    """CREATE TABLE users (
                           id INTEGER PRIMARY KEY, handle TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
                           password_hash TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
                       CREATE TABLE agent_tokens (
                           id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, label TEXT NOT NULL,
                           token_hash TEXT UNIQUE NOT NULL, scopes TEXT NOT NULL, created_at INTEGER NOT NULL,
                           last_used_at INTEGER, revoked_at INTEGER,
                           agent_name TEXT NOT NULL DEFAULT '', agent_kind TEXT NOT NULL DEFAULT '',
                           agent_version TEXT NOT NULL DEFAULT '', cwd TEXT NOT NULL DEFAULT '',
                           registered_at INTEGER, heartbeat_at INTEGER);
                    """
                )
                connection.execute(
                    "INSERT INTO users(handle,display_name,password_hash,bio,created_at) VALUES(?,?,?,?,?)",
                    ("legacy", "Legacy", "unused", "", int(time.time())),
                )
                connection.execute(
                    "INSERT INTO agent_tokens(user_id,label,token_hash,scopes,created_at) VALUES(?,?,?,?,?)",
                    (1, "Old Agent", hashlib.sha256(raw_token.encode()).hexdigest(), '["profile"]', int(time.time())),
                )
                connection.commit()
                connection.close()

                server.init_db()
                with server.db() as connection:
                    row = connection.execute("SELECT * FROM agent_tokens WHERE id=1").fetchone()
                    identity = server.find_agent_identity(connection, raw_token)
                self.assertTrue(row["public_id"].startswith("agt_"))
                self.assertEqual(row["profile_slug"], "old-agent")
                self.assertGreater(row["expires_at"], int(time.time()))
                self.assertEqual(identity["agent_slug"], "old-agent")
            finally:
                server.DATABASE, server.DATA_DIR = old_database, old_data_dir


class AgentProfileHttpTests(unittest.TestCase):
    MCP_HEADERS = {"Accept": "application/json, text/event-stream"}

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.old_database = server.DATABASE
        self.old_data_dir = server.DATA_DIR
        self.old_public_mode = server.PUBLIC_MODE
        self.old_owner_handles = server.OWNER_HANDLES
        server.DATA_DIR = Path(self.temp.name)
        server.DATABASE = server.DATA_DIR / "vybport-http-test.sqlite3"
        server.PUBLIC_MODE = False
        server.OWNER_HANDLES = set()
        server.init_db()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.httpd.server_address[1]

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server.DATABASE = self.old_database
        server.DATA_DIR = self.old_data_dir
        server.PUBLIC_MODE = self.old_public_mode
        server.OWNER_HANDLES = self.old_owner_handles
        self.temp.cleanup()

    def request(self, method: str, path: str, body=None, headers=None):
        encoded = json.dumps(body).encode() if body is not None else None
        request_headers = {"Content-Type": "application/json"} if body is not None else {}
        request_headers.update(headers or {})
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request(method, path, body=encoded, headers=request_headers)
        response = connection.getresponse()
        raw = response.read()
        data = json.loads(raw) if raw else None
        header_map = {key.lower(): value for key, value in response.getheaders()}
        connection.close()
        return response.status, header_map, data

    def register(self, handle: str):
        status, headers, payload = self.request("POST", "/api/auth/register", {
            "handle": handle, "display_name": handle.title(), "password": "correct-horse", "bio": "",
        })
        self.assertEqual(status, 201)
        return headers["set-cookie"].split(";", 1)[0]

    def create_agent(self, cookie: str, **overrides):
        payload = {
            "label": "Review Bot", "slug": "review-bot", "bio": "Checks work on my bench.",
            "public": True, "lifetime_days": 30,
            "scopes": ["profile", "garage", "arena", "session", "social"],
            "ssh_public_key": ssh_ed25519_public_key(5),
        }
        payload.update(overrides)
        return self.request("POST", "/api/agent-profiles", payload, {"Cookie": cookie})

    def mcp_whoami(self, token: str):
        return self.request("POST", "/mcp", {
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "profile.whoami", "arguments": {}},
        }, self.MCP_HEADERS | {"Authorization": f"Bearer {token}"})

    def test_create_publish_rotate_and_enforce_parent_ownership(self) -> None:
        alice_cookie = self.register("alice")
        status, _, created = self.create_agent(alice_cookie)
        self.assertEqual(status, 201)
        token = created["token"]
        profile = created["agent_profile"]
        self.assertEqual(profile["identity"], "@alice/review-bot")

        status, _, whoami = self.mcp_whoami(token)
        self.assertEqual(status, 200)
        content = json.loads(whoami["result"]["content"][0]["text"])
        self.assertEqual(content["acting_as"]["identity"], "@alice/review-bot")

        target = "garage:alice:agent-systems"
        status, _, comment = self.request("POST", "/mcp", {
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": "social.comment", "arguments": {"target": target, "body": "Reviewed by agent."}},
        }, self.MCP_HEADERS | {"Authorization": f"Bearer {token}"})
        self.assertEqual(status, 200)
        self.assertFalse(comment["result"]["isError"])
        _, _, social = self.request("GET", f"/api/social?target={target}")
        self.assertEqual(social["comments"][0]["via"], "@alice/review-bot")

        status, _, public = self.request("GET", "/api/profiles/alice/agents")
        self.assertEqual(status, 200)
        self.assertEqual(public["agent_profiles"][0]["identity"], "@alice/review-bot")
        self.assertNotIn("scopes", public["agent_profiles"][0])
        self.assertNotIn("id", public["agent_profiles"][0])

        status, _, _ = self.request(
            "POST", f"/api/agent-profiles/{profile['id']}/update", {"public": False}, {"Cookie": alice_cookie}
        )
        self.assertEqual(status, 200)
        self.assertEqual(self.request("GET", "/api/profiles/alice/agents")[2]["agent_profiles"], [])
        self.request("POST", f"/api/agent-profiles/{profile['id']}/update", {"public": True}, {"Cookie": alice_cookie})

        status, _, rotated = self.request(
            "POST", f"/api/agent-profiles/{profile['id']}/rotate", {}, {"Cookie": alice_cookie}
        )
        self.assertEqual(status, 200)
        self.assertNotEqual(rotated["token"], token)
        self.assertIn("error", self.mcp_whoami(token)[2])
        self.assertIn("result", self.mcp_whoami(rotated["token"])[2])

        bob_cookie = self.register("bob")
        status, _, _ = self.request(
            "POST", f"/api/agent-profiles/{profile['id']}/rotate", {}, {"Cookie": bob_cookie}
        )
        self.assertEqual(status, 401)

        server.PUBLIC_MODE = True
        status, _, blocked = self.request("POST", "/mcp", {
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {"name": "garage.test", "arguments": {"project": 1, "command": "false"}},
        }, self.MCP_HEADERS | {"Authorization": f"Bearer {rotated['token']}"})
        self.assertEqual(status, 200)
        self.assertTrue(blocked["result"]["isError"])
        self.assertIn("disabled on a public", blocked["result"]["content"][0]["text"])

    def test_streamable_http_transport_guards(self) -> None:
        cookie = self.register("alice")
        status, _, created = self.create_agent(cookie, ssh_public_key="")
        self.assertEqual(status, 201)
        token = created["token"]
        initialize = {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": server.MCP_VERSION, "capabilities": {},
                       "clientInfo": {"name": "test", "version": "1"}},
        }

        status, _, _ = self.request("POST", "/mcp", initialize, {"Authorization": f"Bearer {token}"})
        self.assertEqual(status, 406)
        status, headers, denied = self.request("POST", "/mcp", initialize, self.MCP_HEADERS)
        self.assertEqual(status, 401)
        self.assertIn("www-authenticate", headers)
        self.assertIn("error", denied)
        status, _, _ = self.request(
            "POST", "/mcp", initialize,
            self.MCP_HEADERS | {"Authorization": f"Bearer {token}", "Origin": "https://evil.example"},
        )
        self.assertEqual(status, 403)

        status, _, initialized = self.request(
            "POST", "/mcp", initialize, self.MCP_HEADERS | {"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(initialized["result"]["protocolVersion"], server.MCP_VERSION)
        status, _, body = self.request("POST", "/mcp", {
            "jsonrpc": "2.0", "method": "notifications/initialized", "params": {},
        }, self.MCP_HEADERS | {"Authorization": f"Bearer {token}",
                               "MCP-Protocol-Version": server.MCP_VERSION})
        self.assertEqual(status, 202)
        self.assertIsNone(body)
        status, headers, body = self.request("GET", "/mcp")
        self.assertEqual(status, 405)
        self.assertEqual(headers["allow"], "POST")
        self.assertIsNone(body)


if __name__ == "__main__":
    unittest.main()
