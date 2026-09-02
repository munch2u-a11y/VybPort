from __future__ import annotations

import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

import server


class QuietHandler(server.VybPortHandler):
    def log_message(self, *args) -> None:  # keep the suite's output readable
        pass


class FriendsAndFavoritesTests(unittest.TestCase):
    """Friend requests are directional until answered; favorites are a private, per-person list."""

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.old = (server.DATABASE, server.DATA_DIR, server.PUBLIC_MODE, server.OWNER_HANDLES)
        server.DATA_DIR = Path(self.temp.name)
        server.DATABASE = server.DATA_DIR / "friends-test.sqlite3"
        server.PUBLIC_MODE = False
        server.OWNER_HANDLES = set()
        server.init_db()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.httpd.server_address[1]
        self.alice = self.register("alice")
        self.bob = self.register("bob")

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server.DATABASE, server.DATA_DIR, server.PUBLIC_MODE, server.OWNER_HANDLES = self.old
        self.temp.cleanup()

    def request(self, method: str, path: str, body=None, cookie: str | None = None):
        encoded = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"} if body is not None else {}
        if cookie:
            headers["Cookie"] = cookie
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request(method, path, body=encoded, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        connection.close()
        return response.status, (json.loads(raw) if raw else None)

    def register(self, handle: str) -> str:
        status, _ = self.request("POST", "/api/auth/register", {
            "handle": handle, "display_name": handle.title(), "password": "correct-horse", "bio": "",
        })
        self.assertEqual(status, 201)
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request("POST", "/api/auth/login",
                           body=json.dumps({"handle": handle, "password": "correct-horse"}).encode(),
                           headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        response.read()
        cookie = response.getheader("set-cookie").split(";", 1)[0]
        connection.close()
        return cookie

    def handles(self, group) -> list[str]:
        return sorted(person["handle"] for person in group)

    # --- friendships ----------------------------------------------------------------------------
    def test_request_is_one_sided_until_answered(self):
        status, data = self.request("POST", "/api/friends", {"handle": "bob"}, self.alice)
        self.assertEqual(status, 200)
        self.assertEqual(self.handles(data["outgoing"]), ["bob"])
        self.assertEqual(data["friends"], [])
        _, bobs = self.request("GET", "/api/friends", None, self.bob)
        self.assertEqual(self.handles(bobs["incoming"]), ["alice"])
        self.assertEqual(bobs["friends"], [])

    def test_accepting_makes_the_pair_friends_both_ways(self):
        self.request("POST", "/api/friends", {"handle": "bob"}, self.alice)
        status, data = self.request("POST", "/api/friends/respond", {"handle": "alice", "accept": True}, self.bob)
        self.assertEqual(status, 200)
        self.assertEqual(self.handles(data["friends"]), ["alice"])
        self.assertEqual(data["incoming"], [])
        _, alices = self.request("GET", "/api/friends", None, self.alice)
        self.assertEqual(self.handles(alices["friends"]), ["bob"])
        self.assertEqual(alices["outgoing"], [])

    def test_asking_back_counts_as_accepting(self):
        self.request("POST", "/api/friends", {"handle": "bob"}, self.alice)
        _, data = self.request("POST", "/api/friends", {"handle": "alice"}, self.bob)
        self.assertEqual(self.handles(data["friends"]), ["alice"])
        self.assertEqual(data["incoming"], [])
        self.assertEqual(data["outgoing"], [])

    def test_declining_clears_the_request(self):
        self.request("POST", "/api/friends", {"handle": "bob"}, self.alice)
        _, data = self.request("POST", "/api/friends/respond", {"handle": "alice", "accept": False}, self.bob)
        self.assertEqual(data, {"friends": [], "incoming": [], "outgoing": []})
        _, alices = self.request("GET", "/api/friends", None, self.alice)
        self.assertEqual(alices["outgoing"], [])

    def test_removing_a_friend_clears_both_directions(self):
        self.request("POST", "/api/friends", {"handle": "bob"}, self.alice)
        self.request("POST", "/api/friends/respond", {"handle": "alice", "accept": True}, self.bob)
        _, data = self.request("POST", "/api/friends/remove", {"handle": "bob"}, self.alice)
        self.assertEqual(data["friends"], [])
        _, bobs = self.request("GET", "/api/friends", None, self.bob)
        self.assertEqual(bobs["friends"], [])

    def test_the_handle_may_carry_the_at_sign_the_street_shows(self):
        status, data = self.request("POST", "/api/friends", {"handle": "@bob"}, self.alice)
        self.assertEqual(status, 200)
        self.assertEqual(self.handles(data["outgoing"]), ["bob"])

    def test_you_cannot_friend_yourself_or_a_stranger(self):
        status, data = self.request("POST", "/api/friends", {"handle": "alice"}, self.alice)
        self.assertEqual(status, 400)
        self.assertIn("your own", data["error"])
        status, data = self.request("POST", "/api/friends", {"handle": "nobody"}, self.alice)
        self.assertEqual(status, 400)
        self.assertIn("@nobody", data["error"])

    def test_responding_to_nothing_is_refused(self):
        status, data = self.request("POST", "/api/friends/respond", {"handle": "bob", "accept": True}, self.alice)
        self.assertEqual(status, 400)
        self.assertIn("not asked", data["error"])

    def test_friends_need_a_session(self):
        status, data = self.request("GET", "/api/friends")
        self.assertEqual((status, data), (200, {"friends": [], "incoming": [], "outgoing": []}))
        status, _ = self.request("POST", "/api/friends", {"handle": "bob"})
        self.assertEqual(status, 401)

    # --- favorites ------------------------------------------------------------------------------
    def test_favorite_toggles_and_stays_private_to_one_person(self):
        target = "garage:bob:memory-systems"
        status, data = self.request("POST", "/api/favorites",
                                    {"target": target, "label": "Bob Lab", "handle": "@bob",
                                     "neighborhood": "memory-systems"}, self.alice)
        self.assertEqual(status, 200)
        self.assertTrue(data["favorited"])
        self.assertEqual([row["target"] for row in data["favorites"]], [target])
        self.assertEqual(data["favorites"][0]["handle"], "bob")  # the @ is not stored

        _, bobs = self.request("GET", "/api/favorites", None, self.bob)
        self.assertEqual(bobs["favorites"], [])

        _, again = self.request("POST", "/api/favorites", {"target": target}, self.alice)
        self.assertFalse(again["favorited"])
        self.assertEqual(again["favorites"], [])

    def test_favorites_reject_a_malformed_target_and_need_a_session(self):
        status, _ = self.request("POST", "/api/favorites", {"target": "not a target"}, self.alice)
        self.assertEqual(status, 400)
        status, data = self.request("GET", "/api/favorites")
        self.assertEqual((status, data), (200, {"favorites": []}))
        status, _ = self.request("POST", "/api/favorites", {"target": "garage:bob:memory-systems"})
        self.assertEqual(status, 401)


if __name__ == "__main__":
    unittest.main()
