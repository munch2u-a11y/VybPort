from __future__ import annotations

import http.client
import json
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

import server


class QuietHandler(server.VybPortHandler):
    def log_message(self, *args) -> None:
        pass


class PairingTests(unittest.TestCase):
    """A pairing code is a live key to the account, so it is short-lived and spent on first use."""

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.old = (server.DATABASE, server.DATA_DIR, server.PUBLIC_MODE, server.OWNER_HANDLES)
        server.DATA_DIR = Path(self.temp.name)
        server.DATABASE = server.DATA_DIR / "pair-test.sqlite3"
        server.PUBLIC_MODE = False
        server.OWNER_HANDLES = set()
        server.init_db()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.httpd.server_address[1]
        self.cookie = self.register("owner")

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server.DATABASE, server.DATA_DIR, server.PUBLIC_MODE, server.OWNER_HANDLES = self.old
        self.temp.cleanup()

    def request(self, method, path, body=None, cookie=None):
        encoded = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"} if body is not None else {}
        if cookie:
            headers["Cookie"] = cookie
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request(method, path, body=encoded, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        header = {key.lower(): value for key, value in response.getheaders()}
        connection.close()
        return response.status, header, (json.loads(raw) if raw else None)

    def register(self, handle):
        status, header, _ = self.request("POST", "/api/auth/register", {
            "handle": handle, "display_name": handle.title(), "password": "correct-horse", "bio": "",
        })
        self.assertEqual(status, 201)
        return header["set-cookie"].split(";", 1)[0]

    def mint(self):
        status, _, data = self.request("POST", "/api/pair", {}, self.cookie)
        self.assertEqual(status, 200)
        return data

    def test_minting_needs_a_session(self):
        status, _, _ = self.request("POST", "/api/pair", {})
        self.assertEqual(status, 401)

    def test_the_code_carries_a_reachable_address_and_a_token(self):
        data = self.mint()
        self.assertIn("/mobile.html#p=", data["url"])
        self.assertTrue(data["svg"].startswith("<svg"))
        self.assertEqual(data["expires_in"], server.PAIR_TTL)
        # Loopback-bound servers say so, rather than handing out an address no phone can dial.
        self.assertIs(data["reachable"], server.HOST not in ("127.0.0.1", "localhost", "::1"))

    def test_scanning_signs_a_second_device_in(self):
        token = self.mint()["url"].split("#p=")[1]
        status, header, data = self.request("POST", "/api/auth/pair", {"token": token})
        self.assertEqual(status, 200)
        self.assertEqual(data["user"]["handle"], "owner")
        phone = header["set-cookie"].split(";", 1)[0]
        self.assertNotEqual(phone, self.cookie)
        _, _, me = self.request("GET", "/api/auth/me", None, phone)
        self.assertEqual(me["user"]["handle"], "owner")

    def test_a_code_is_spent_on_first_use(self):
        token = self.mint()["url"].split("#p=")[1]
        self.assertEqual(self.request("POST", "/api/auth/pair", {"token": token})[0], 200)
        status, _, data = self.request("POST", "/api/auth/pair", {"token": token})
        self.assertEqual(status, 400)
        self.assertIn("already been used", data["error"])

    def test_an_expired_code_is_refused(self):
        token = self.mint()["url"].split("#p=")[1]
        with server.db() as connection:
            connection.execute("UPDATE pair_tokens SET expires_at=?", (int(time.time()) - 1,))
        status, _, data = self.request("POST", "/api/auth/pair", {"token": token})
        self.assertEqual(status, 400)
        self.assertIn("expired", data["error"])

    def test_a_made_up_code_is_refused(self):
        for token in ["", "not-a-token", "x" * 64]:
            self.assertEqual(self.request("POST", "/api/auth/pair", {"token": token})[0], 400)

    def test_the_token_is_never_stored_in_the_clear(self):
        token = self.mint()["url"].split("#p=")[1]
        with server.db() as connection:
            rows = connection.execute("SELECT token_hash FROM pair_tokens").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertNotEqual(rows[0]["token_hash"], token)
        self.assertEqual(len(rows[0]["token_hash"]), 64)

    def test_pairing_against_a_foreign_address_is_refused(self):
        status, _, data = self.request("POST", "/api/pair", {"address": "203.0.113.9"}, self.cookie)
        self.assertEqual(status, 400)
        self.assertIn("actually answers", data["error"])


if __name__ == "__main__":
    unittest.main()
