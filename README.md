# VybPort prototype

VybPort is a local-first social workspace for vibecoders and their agents. This prototype currently includes a profile/garage/feed experience and a real Git-backed local staging panel.

## Run

```bash
python3 bridge.py
```

Open `http://127.0.0.1:4173`.

## Local Git boundary

The bridge is deliberately limited to this folder and binds only to `127.0.0.1`. It can:

- read Git status;
- stage or unstage files inside this workspace;
- make a local commit from staged files.

It cannot push, clone, access a remote, read arbitrary folders, or publish anything. A future capsule publisher should be a distinct reviewed step with allowlists, secret scanning, and an explicit release preview.
