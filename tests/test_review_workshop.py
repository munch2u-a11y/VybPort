from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path

import server


class ReviewWorkshopTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_database, self.old_data_dir = server.DATABASE, server.DATA_DIR
        self.old_roots, self.old_public = server.WORKSPACE_ROOTS, server.PUBLIC_MODE
        server.DATA_DIR = self.root / "data"
        server.DATABASE = server.DATA_DIR / "review.sqlite3"
        server.WORKSPACE_ROOTS = [self.root]
        server.PUBLIC_MODE = False
        self.alice_space, self.bob_space = self.root / "alice-work", self.root / "bob-work"
        (self.alice_space / "src").mkdir(parents=True)
        self.bob_space.mkdir()
        (self.alice_space / "src" / "core.py").write_text(
            "def recall(query):\n    candidates = search(query)\n    return candidates[0]\n", encoding="utf-8"
        )
        (self.alice_space / "src" / "secret.py").write_text(
            "credential = 'vyb_agent_" + "A" * 32 + "'\n", encoding="utf-8"
        )
        (self.alice_space / "evaluate.py").write_text("def score(items):\n    return len(items)\n", encoding="utf-8")
        server.init_db()
        now = int(time.time())
        with server.db() as connection:
            self.hood = connection.execute("SELECT * FROM neighborhoods WHERE slug='memory-systems'").fetchone()
            self.alice_id = connection.execute(
                "INSERT INTO users(handle,display_name,password_hash,bio,created_at) VALUES(?,?,?,?,?)",
                ("alice", "Alice", server.password_hash("correct-horse"), "", now),
            ).lastrowid
            self.bob_id = connection.execute(
                "INSERT INTO users(handle,display_name,password_hash,bio,created_at) VALUES(?,?,?,?,?)",
                ("bob", "Bob", server.password_hash("correct-horse"), "", now),
            ).lastrowid
            self.alice_workspace = connection.execute(
                "INSERT INTO workspaces(user_id,label,path,created_at) VALUES(?,?,?,?)",
                (self.alice_id, "Alice work", str(self.alice_space), now),
            ).lastrowid
            self.bob_workspace = connection.execute(
                "INSERT INTO workspaces(user_id,label,path,created_at) VALUES(?,?,?,?)",
                (self.bob_id, "Bob work", str(self.bob_space), now),
            ).lastrowid
            self.alice_garage = connection.execute(
                """INSERT INTO garages(user_id,neighborhood_id,name,tagline,tags,display,workspace_id,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (self.alice_id, self.hood["id"], "Alice Lab", "retrieval work", '["semantic"]', "", self.alice_workspace, now, now),
            ).lastrowid
            self.bob_garage = connection.execute(
                """INSERT INTO garages(user_id,neighborhood_id,name,tagline,tags,display,workspace_id,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (self.bob_id, self.hood["id"], "Bob Lab", "review work", '["semantic"]', "", self.bob_workspace, now, now),
            ).lastrowid
            self.alice_project = connection.execute(
                """INSERT INTO projects(garage_id,name,tagline,flagship,kind,workspace_id,created_at,updated_at)
                   VALUES(?,?,?,1,'own',?,?,?)""",
                (self.alice_garage, "Recall Engine", "bounded retrieval", self.alice_workspace, now, now),
            ).lastrowid
            self.bob_project = connection.execute(
                """INSERT INTO projects(garage_id,name,tagline,flagship,kind,workspace_id,created_at,updated_at)
                   VALUES(?,?,?,1,'own',?,?,?)""",
                (self.bob_garage, "Review Rig", "comparison", self.bob_workspace, now, now),
            ).lastrowid
            connection.execute(
                """INSERT INTO garage_modules(garage_id,project_id,slot,name,lang,note,source,ref,status,weight)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (self.alice_garage, self.alice_project, "retrieval", "Retriever", "Python", "find evidence", "src", "main", "active", 4),
            )
            connection.execute(
                """INSERT INTO garage_modules(garage_id,project_id,slot,name,lang,note,source,ref,status,weight)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (self.alice_garage, self.alice_project, "evaluation", "Evaluator", "Python", "score recall", "evaluate.py", "main", "active", 2),
            )

    def tearDown(self) -> None:
        server.DATABASE, server.DATA_DIR = self.old_database, self.old_data_dir
        server.WORKSPACE_ROOTS, server.PUBLIC_MODE = self.old_roots, self.old_public
        self.temp.cleanup()

    def rows(self, connection):
        garage = connection.execute("SELECT * FROM garages WHERE id=?", (self.alice_garage,)).fetchone()
        project = connection.execute("SELECT * FROM projects WHERE id=?", (self.alice_project,)).fetchone()
        return garage, project

    def publish_core(self) -> None:
        with server.db() as connection:
            garage, project = self.rows(connection)
            server.publish_module_files(connection, garage, project, "retrieval", ["src/core.py"])

    def borrow_retrieval(self) -> int:
        self.publish_core()
        with server.db() as connection:
            garage = connection.execute("SELECT * FROM garages WHERE id=?", (self.bob_garage,)).fetchone()
            source = connection.execute(
                """SELECT projects.*,users.handle FROM projects JOIN garages ON garages.id=projects.garage_id
                   JOIN users ON users.id=garages.user_id WHERE projects.id=?""", (self.alice_project,)
            ).fetchone()
            hood = connection.execute("SELECT * FROM neighborhoods WHERE id=?", (self.hood["id"],)).fetchone()
            return int(server.borrow_project(connection, garage, source, hood, ["retrieval"])["project"])

    def test_public_snapshot_is_exact_metadata_only_and_rejects_obvious_credentials(self) -> None:
        with server.db() as connection:
            garage, project = self.rows(connection)
            published = server.publish_module_files(connection, garage, project, "retrieval", ["src/core.py"])
            self.assertEqual([item["path"] for item in published], ["src/core.py"])
            self.assertNotIn("content", published[0])
            loaded = server.load_garages(connection, "garages.id=?", (self.alice_garage,))[0]
            public = server.public_garage_payload(loaded)
            self.assertEqual(public["flagship"]["published_files"]["retrieval"][0]["path"], "src/core.py")
            self.assertNotIn("text", public["flagship"]["published_files"]["retrieval"][0])
            with self.assertRaisesRegex(ValueError, "credential"):
                server.publish_module_files(connection, garage, project, "retrieval", ["src/secret.py"])

    def test_selected_modules_merge_into_locker_without_private_paths_and_snapshots_stay_frozen(self) -> None:
        borrowed_id = self.borrow_retrieval()
        with server.db() as connection:
            loaded = server.load_garages(connection, "garages.id=?", (self.bob_garage,))[0]
            saved = loaded["bench"][0]
            self.assertEqual(saved["id"], borrowed_id)
            self.assertEqual([module["slot"] for module in saved["modules"]], ["retrieval"])
            self.assertEqual(saved["modules"][0]["source"], "")
            self.assertEqual(saved["modules"][0]["ref"], "")
            frozen = server.project_review_file(connection, self.bob_id, borrowed_id, "retrieval", "src/core.py")
            self.assertIn("return candidates[0]", frozen["text"])
        (self.alice_space / "src" / "core.py").write_text("def recall(query):\n    return []\n", encoding="utf-8")
        with server.db() as connection:
            frozen = server.project_review_file(connection, self.bob_id, borrowed_id, "retrieval", "src/core.py")
            self.assertIn("return candidates[0]", frozen["text"])
            with self.assertRaises(PermissionError):
                server.project_review_file(connection, self.alice_id, borrowed_id, "retrieval", "src/core.py")
            garage = connection.execute("SELECT * FROM garages WHERE id=?", (self.bob_garage,)).fetchone()
            source = connection.execute(
                """SELECT projects.*,users.handle FROM projects JOIN garages ON garages.id=projects.garage_id
                   JOIN users ON users.id=garages.user_id WHERE projects.id=?""", (self.alice_project,)
            ).fetchone()
            hood = connection.execute("SELECT * FROM neighborhoods WHERE id=?", (self.hood["id"],)).fetchone()
            second = server.borrow_project(connection, garage, source, hood, ["evaluation"])
            self.assertEqual(second["project"], borrowed_id)
            modules = connection.execute("SELECT slot FROM garage_modules WHERE project_id=? ORDER BY slot", (borrowed_id,)).fetchall()
            self.assertEqual([row["slot"] for row in modules], ["evaluation", "retrieval"])

    def test_non_flagship_project_cannot_be_saved_by_guessing_its_id(self) -> None:
        with server.db() as connection:
            now = int(time.time())
            hidden = connection.execute(
                """INSERT INTO projects(garage_id,name,tagline,flagship,kind,workspace_id,created_at,updated_at)
                   VALUES(?,?,?,0,'own',?,?,?)""",
                (self.alice_garage, "Private draft", "not displayed", self.alice_workspace, now, now),
            ).lastrowid
            connection.execute(
                """INSERT INTO garage_modules(garage_id,project_id,slot,name,lang,note,source,status,weight)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (self.alice_garage, hidden, "retrieval", "Hidden retriever", "Python", "draft", "src", "active", 1),
            )
            source = connection.execute(
                """SELECT projects.*,users.handle FROM projects JOIN garages ON garages.id=projects.garage_id
                   JOIN users ON users.id=garages.user_id WHERE projects.id=?""", (hidden,)
            ).fetchone()
            destination = connection.execute("SELECT * FROM garages WHERE id=?", (self.bob_garage,)).fetchone()
            hood = connection.execute("SELECT * FROM neighborhoods WHERE id=?", (self.hood["id"],)).fetchone()
            with self.assertRaisesRegex(ValueError, "current public display"):
                server.borrow_project(connection, destination, source, hood, ["retrieval"])

    def test_notes_are_shared_with_agent_context_and_detect_live_file_changes(self) -> None:
        with server.db() as connection:
            alice = connection.execute("SELECT * FROM users WHERE id=?", (self.alice_id,)).fetchone()
            note = server.add_review_note(
                connection, alice, self.alice_project, "retrieval", "src/core.py", 2, 3, "Check the empty-result behavior.", "@alice",
            )
            self.assertEqual((note["line_start"], note["line_end"]), (2, 3))
            connection.execute(
                "INSERT INTO focus(user_id,label,context,note,updated_at) VALUES(?,?,?,?,?)",
                (self.alice_id, "review", json.dumps({"project": self.alice_project, "slot": "retrieval", "file": "src/core.py", "line_start": 2, "line_end": 3}), "", int(time.time())),
            )
            token = server.issue_agent_token(
                connection, self.alice_id, "Review Agent", ["garage", "session"], profile_slug="review-agent"
            )
            identity = server.find_agent_identity(connection, token)
        handler = object.__new__(server.VybPortHandler)
        handler.acting_token = identity["token_id"]
        context = handler.mcp_call(identity, ["garage", "session"], "garage.review_context", {})
        self.assertEqual(context["selection"], {"line_start": 2, "line_end": 3})
        self.assertIn("Check the empty-result behavior", context["notes"][0]["body"])
        added = handler.mcp_call(identity, ["garage", "session"], "garage.add_review_note", {
            "project": self.alice_project, "slot": "retrieval", "path": "src/core.py",
            "line_start": 1, "line_end": 1, "body": "Agent checked the entry point.",
        })
        self.assertIn("@alice/review-agent", added["note"]["via"])
        (self.alice_space / "src" / "core.py").write_text("def recall(query):\n    return search(query)\n", encoding="utf-8")
        with server.db() as connection:
            current = server.project_review_file(connection, self.alice_id, self.alice_project, "retrieval", "src/core.py")
            notes = server.review_notes(connection, self.alice_id, self.alice_project, "retrieval", "src/core.py", current["sha256"])
        self.assertTrue(all(note["stale"] for note in notes))


if __name__ == "__main__":
    unittest.main()
