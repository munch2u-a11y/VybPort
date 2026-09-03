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
    def log_message(self, *args) -> None:
        pass


class StarterStreetTests(unittest.TestCase):
    """The teaching street opens a garage that already shows the shape of the build."""

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.old = (server.DATABASE, server.DATA_DIR, server.PUBLIC_MODE, server.OWNER_HANDLES)
        server.DATA_DIR = Path(self.temp.name)
        server.DATABASE = server.DATA_DIR / "starter-test.sqlite3"
        server.PUBLIC_MODE = False
        server.OWNER_HANDLES = set()
        server.init_db()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.httpd.server_address[1]
        self.cookie = self.register("newbie")

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
        connection.close()
        return response.status, (json.loads(raw) if raw else None)

    def register(self, handle):
        self.request("POST", "/api/auth/register", {
            "handle": handle, "display_name": handle.title(), "password": "correct-horse", "bio": "",
        })
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request("POST", "/api/auth/login",
                           body=json.dumps({"handle": handle, "password": "correct-horse"}).encode(),
                           headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        response.read()
        cookie = response.getheader("set-cookie").split(";", 1)[0]
        connection.close()
        return cookie

    def open_garage(self, hood, **extra):
        payload = {"name": "First Rig", "neighborhood": hood, "tags": ["beginner"]}
        payload.update(extra)
        return self.request("POST", "/api/garages", payload, self.cookie)

    def test_the_street_exists_with_comparable_bays(self):
        status, data = self.request("GET", "/api/neighborhoods/night-courier")
        self.assertEqual(status, 200)
        hood = data["neighborhood"]
        self.assertEqual([slot["key"] for slot in hood["slots"]],
                         ["map", "dispatch", "route", "drive", "readout", "bench"])

    def test_opening_a_garage_fills_it_with_the_kit(self):
        status, data = self.open_garage("night-courier")
        self.assertEqual(status, 201)
        garage = data["garage"]
        self.assertEqual([module["slot"] for module in garage["modules"]],
                         ["map", "dispatch", "route", "drive", "readout", "bench"])
        self.assertEqual(garage["flagship"]["name"], "First Run")
        with server.db() as connection:
            flow = connection.execute("SELECT * FROM workflows WHERE project_id=?",
                                      (garage["flagship"]["id"],)).fetchone()
        self.assertEqual(flow["name"], "One night run")
        nodes = json.loads(flow["nodes"])
        self.assertEqual(nodes[0]["kind"], "intake")
        self.assertEqual(nodes[-1]["kind"], "output")
        # The loop has to close, or the workflow is a list rather than a run.
        edges = json.loads(flow["edges"])
        self.assertIn({"from": "fuel", "to": "pick", "label": "fuel left"}, edges)

    def test_the_kit_can_be_declined(self):
        status, data = self.open_garage("night-courier", starter=False)
        self.assertEqual(status, 201)
        self.assertEqual(data["garage"]["modules"], [])

    def test_other_streets_still_open_empty(self):
        status, data = self.open_garage("memory-systems")
        self.assertEqual(status, 201)
        self.assertEqual(data["garage"]["modules"], [])

    def test_the_street_has_a_benchmark_to_compare_against(self):
        status, data = self.request("GET", "/api/arena?neighborhood=night-courier")
        self.assertEqual(status, 200)
        self.assertEqual(data["benchmark"]["slug"], "courier-night-1")
        self.assertEqual(data["benchmark"]["adaptor"], server.ARENA_ADAPTOR)


if __name__ == "__main__":
    unittest.main()
