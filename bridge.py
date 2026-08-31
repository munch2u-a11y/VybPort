"""VybPort's deliberately small, local-only Git bridge.

It serves this folder on 127.0.0.1 and exposes only Git status, staging,
unstaging, and local commits. It has no network/publish endpoint by design.
"""
from __future__ import annotations

import json
import subprocess
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
HOST, PORT = "127.0.0.1", 4173


def run_git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, text=True, capture_output=True, check=False
    )
    if result.returncode:
        raise ValueError(result.stderr.strip() or result.stdout.strip() or "Git operation failed.")
    return result.stdout.strip()


def validated_files(files: object) -> list[str]:
    if not isinstance(files, list) or not files:
        raise ValueError("Choose at least one workspace file.")
    checked: list[str] = []
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
        if not line:
            continue
        code, path = line[:2], line[3:]
        if " -> " in path:
            path = path.rsplit(" -> ", 1)[1]
        entries.append({"path": path, "status": code.strip() or "modified", "staged": code[0] not in {" ", "?"}})
    return {"branch": run_git("branch", "--show-current") or "detached HEAD", "files": entries}


def has_staged_changes() -> bool:
    result = subprocess.run(
        ["git", "diff", "--cached", "--quiet"], cwd=ROOT, text=True, capture_output=True, check=False
    )
    if result.returncode in (0, 1):
        return result.returncode == 1
    raise ValueError(result.stderr.strip() or "Could not inspect staged changes.")


class BridgeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format: str, *args):
        print("VybPort:", format % args)

    def json_response(self, status: HTTPStatus, payload: dict[str, object]):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path == "/api/git/status":
            try:
                self.json_response(HTTPStatus.OK, git_status())
            except ValueError as error:
                self.json_response(HTTPStatus.CONFLICT, {"error": str(error)})
            return
        super().do_GET()

    def do_POST(self):
        route = urlparse(self.path).path
        if route not in {"/api/git/stage", "/api/git/unstage", "/api/git/commit"}:
            self.json_response(HTTPStatus.NOT_FOUND, {"error": "Unknown local bridge action."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            if route == "/api/git/stage":
                run_git("add", "--", *validated_files(payload.get("files")))
                response = {"ok": True}
            elif route == "/api/git/unstage":
                run_git("restore", "--staged", "--", *validated_files(payload.get("files")))
                response = {"ok": True}
            else:
                message = payload.get("message")
                if not isinstance(message, str) or not message.strip() or len(message) > 140:
                    raise ValueError("Use a commit message between 1 and 140 characters.")
                if not has_staged_changes():
                    raise ValueError("There are no staged changes to commit.")
                run_git("commit", "-m", message.strip())
                response = {"commit": run_git("rev-parse", "--short", "HEAD")}
        except ValueError as error:
            self.json_response(HTTPStatus.CONFLICT, {"error": str(error)})
            return
        self.json_response(HTTPStatus.CREATED if route == "/api/git/commit" else HTTPStatus.OK, response)


if __name__ == "__main__":
    print(f"VybPort local bridge: http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), BridgeHandler).serve_forever()
