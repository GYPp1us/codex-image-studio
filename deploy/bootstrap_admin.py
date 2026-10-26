"""Run once on LA as root; prints the generated password only to the operator."""
import json
import secrets
from pathlib import Path
from urllib.request import Request, urlopen

base = "http://127.0.0.1:8788"
with urlopen(base + "/api/auth/state") as response:
    state = json.load(response)
if state["initialized"]:
    print(json.dumps({"initialized": True}))
else:
    password = secrets.token_urlsafe(18)
    payload = {"username": "admin", "password": password, "setup_token": Path("/var/lib/image-studio/setup-token").read_text().strip()}
    request = Request(base + "/api/auth/setup", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(request) as response:
        json.load(response)
    print(json.dumps({"username": "admin", "initial_password": password}))
