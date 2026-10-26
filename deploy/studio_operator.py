"""Studio operator: credentials arrive over stdin, never command arguments."""
import http.cookiejar
import json
import sys
import time
import urllib.request

credentials = json.load(sys.stdin)
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
base = "http://127.0.0.1:8788"
csrf = ""


def call(path, payload=None, method=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + path, data=data, headers={"Content-Type":"application/json", "X-CSRF-Token":csrf}, method=method)
    with opener.open(req, timeout=35) as response:
        return json.load(response)


csrf = call("/api/auth/login", credentials)["csrf"]
action = sys.argv[1] if len(sys.argv) > 1 else "status"
if action == "login":
    call("/api/setup/login", {"mode": "browser"})
    time.sleep(3)
elif action == "cancel":
    call("/api/setup/login/cancel", {})
elif action == "probe":
    print(json.dumps(call("/api/setup/probe", {})))
elif action == "smoke":
    recent = call("/api/jobs?limit=20")
    reference = next(a for j in recent["items"] for a in j["outputs"])
    print(json.dumps(call("/api/jobs", {"prompt":"Use the attached reference image only as a composition guide. A single matte terracotta-red circle centered on warm ivory paper, flat minimalist graphic design, no text, no extra objects.", "refs":[reference["id"]], "count":2, "ratio":"1:1", "max_attempts":1, "model":"gpt-6.1-sol", "effort":"xhigh"})))
elif action == "models":
    print(json.dumps(call("/api/models?refresh=true"), ensure_ascii=False))
elif action == "defaults":
    config = call("/api/state")
    config = {k:config[k] for k in ("concurrency","max_attempts","paused")}
    call("/api/settings", config | {"model":"gpt-6.1-sol","effort":"xhigh"}, "PATCH")
if action == "jobs":
    result = call("/api/jobs?limit=5")
elif action == "log":
    result = call("/api/jobs/" + sys.argv[2] + "/log")
else:
    result = call("/api/setup/status")
    if action != "login":
        result["login"] = {k: result["login"].get(k) for k in ("running", "mode")}
print(json.dumps(result, ensure_ascii=False))
