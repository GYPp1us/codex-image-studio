"""Private, subscription-backed image workbench. No API-key fallback."""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import shutil
import signal
import sqlite3
import time
import uuid
import sys
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlsplit

import httpx

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field
from stitch_workflow import DEFAULT_STITCH_PROMPT, normalize_redraw_prompt
from cli_scheduler import CallPool

ROOT = Path(__file__).resolve().parent
DATA = Path(os.getenv("STUDIO_DATA", str(ROOT / "data"))).resolve()
CODEX_HOME = DATA / "codex"
CODEX_BIN = os.getenv("CODEX_BIN", "codex")
MODEL = "gpt-6.1-sol"
EFFORT = "xhigh"
IMAGE_REQUIREMENTS = "Image-generation request: GPT-Image-2.5 Sunburst (gpt-image-2.5-sunburst), requested reasoning effort max. Include this exact model and effort request in the prompt passed to the image-generation tool. If the tool exposes explicit model and reasoning parameters, use them; otherwise preserve this as a prompt-level request. Never claim the backend model or effort was verified unless actual tool metadata confirms it."
DEFAULT_CALL_PROMPT = """You are an image generation worker, not a coding task. Generate exactly ONE image using the built-in image_gen/imagegen tool.
Use the image prompt below verbatim as the creative brief. Do not rewrite it or add stylistic details.
Requested aspect ratio: {ratio}. Transparent background: {transparent}.
Reference images: {references}. Use only the explicitly attached references in this new session.
Image Studio automatically collects the image saved by the built-in tool under CODEX_HOME/generated_images for this session. Leave the output in its default location. DO NOT copy or move it. DO NOT run shell commands. After the tool finishes, report the generated image path. This is a preview request; no project asset needs copying.
Do not read auth files or credentials. Do not use an API key, paid API fallback, external image websites, SVG, canvas, Python drawing, or another model to simulate a successful generation.
If the built-in image-generation tool is unavailable or fails, report the error and stop. Never claim success without an actual generated image file.
Do not spawn subagents or ask questions.
BEGIN EXACT IMAGE PROMPT
{prompt}
END EXACT IMAGE PROMPT
"""
DEFAULT_CALL_PROMPT = IMAGE_REQUIREMENTS + "\n" + DEFAULT_CALL_PROMPT
DEFAULT_POLISH_PROMPT = DEFAULT_CALL_PROMPT.replace(
    "Use the image prompt below verbatim as the creative brief. Do not rewrite it or add stylistic details.",
    "Act as an art director. Treat the user's text as a creative brief, then design a complete image-generation prompt before invoking the tool. "
    "Make deliberate choices about composition, framing, subject hierarchy, perspective, lighting, palette, materials, visual style and suitable style tags. "
    "Fill missing details coherently without replacing the user's subject, requested text, identities, constraints or exclusions. "
    "Inspect and respect attached reference images. Avoid contradictory or gratuitous style tags. "
    "Use your enhanced prompt with the built-in image tool; do not pass the original text through unchanged. "
    "Briefly report the enhanced creative brief in your response so it remains available in the task log."
).replace("BEGIN EXACT IMAGE PROMPT", "BEGIN USER CREATIVE BRIEF").replace("END EXACT IMAGE PROMPT", "END USER CREATIVE BRIEF")
MAX_UPLOAD = 20 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 64_000_000
SESSION_AGE = 7 * 86400
PROCESSES: dict[str, asyncio.subprocess.Process] = {}
STOPPING: dict[int, asyncio.Task] = {}
JOB_TASKS: dict[str, asyncio.Task] = {}
CALL_POOL: CallPool | None = None
LOGIN: dict = {"running": False, "output": "", "url": "", "code": "", "mode": "browser"}
BACKGROUND: set[asyncio.Task] = set()
WAKE = asyncio.Event()
LOGIN_LOCK = asyncio.Lock()
LOGIN_FAILURES: dict[str, list[float]] = {}


def now():
    return time.time()


def uid():
    return uuid.uuid4().hex


def prompt_hash(text):
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


@contextmanager
def db():
    conn = sqlite3.connect(DATA / "studio.sqlite3", timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def query(sql, args=(), one=False):
    with db() as c:
        rows = c.execute(sql, args).fetchall()
    return (dict(rows[0]) if rows else None) if one else [dict(r) for r in rows]


def write(sql, args=()):
    with db() as c:
        return c.execute(sql, args).rowcount


def setting(key, default=None):
    row = query("SELECT value FROM settings WHERE key=?", (key,), True)
    return json.loads(row["value"]) if row else default


def set_setting(key, value):
    write("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))


def initialize():
    for name in ("assets", "thumbs", "jobs", "codex"):
        (DATA / name).mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(DATA, 0o700)
    with db() as c:
        c.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT UNIQUE,password TEXT,created REAL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,csrf TEXT,created REAL,expires REAL);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,sha TEXT UNIQUE,path TEXT,kind TEXT,name TEXT,tags TEXT DEFAULT '',favorite INTEGER DEFAULT 0,width INTEGER,height INTEGER,bytes INTEGER,created REAL,job_id TEXT);
        CREATE TABLE IF NOT EXISTS prompts(id TEXT PRIMARY KEY,text TEXT UNIQUE,title TEXT,favorite INTEGER DEFAULT 0,created REAL,updated REAL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,batch_id TEXT,prompt TEXT,refs TEXT,options TEXT,status TEXT,attempt INTEGER DEFAULT 0,max_attempts INTEGER,created REAL,started REAL,finished REAL,error TEXT DEFAULT '',outputs TEXT DEFAULT '[]',thread_id TEXT DEFAULT '');
        CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status,created);
        CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT,number INTEGER,status TEXT,started REAL,finished REAL,error TEXT DEFAULT '');
        CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,name TEXT,prompt TEXT,created REAL,updated REAL);
        CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY,text TEXT,title TEXT,favorite INTEGER DEFAULT 0,created REAL,updated REAL,refs TEXT NOT NULL DEFAULT '[]',options TEXT NOT NULL DEFAULT '{}');
        """)
        prompt_columns = {r[1] for r in c.execute("PRAGMA table_info(prompts)")}
        new_prompt_refs = "refs" not in prompt_columns
        if new_prompt_refs:
            c.execute("ALTER TABLE prompts ADD COLUMN refs TEXT NOT NULL DEFAULT '[]'")
        if "options" not in prompt_columns:
            c.execute("ALTER TABLE prompts ADD COLUMN options TEXT NOT NULL DEFAULT '{}'")
        if "collection_id" not in {r[1] for r in c.execute("PRAGMA table_info(jobs)")}:
            c.execute("ALTER TABLE jobs ADD COLUMN collection_id TEXT NOT NULL DEFAULT ''")
        if "template_id" not in {r[1] for r in c.execute("PRAGMA table_info(jobs)")}:
            c.execute("ALTER TABLE jobs ADD COLUMN template_id TEXT NOT NULL DEFAULT ''")
        for name, definition in (("stage", "TEXT NOT NULL DEFAULT ''"), ("stage_source", "TEXT NOT NULL DEFAULT ''"), ("stage_updated", "REAL NOT NULL DEFAULT 0")):
            if name not in {r[1] for r in c.execute("PRAGMA table_info(jobs)")}:
                c.execute(f"ALTER TABLE jobs ADD COLUMN {name} {definition}")
        if "progress_detail" not in {r[1] for r in c.execute("PRAGMA table_info(jobs)")}:
            c.execute("ALTER TABLE jobs ADD COLUMN progress_detail TEXT NOT NULL DEFAULT '{}'")
        c.execute("CREATE INDEX IF NOT EXISTS jobs_collection ON jobs(collection_id,created)")
        for table in ("assets", "collections"):
            if "deleted" not in {r[1] for r in c.execute(f"PRAGMA table_info({table})")}:
                c.execute(f"ALTER TABLE {table} ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0")
        if new_prompt_refs:
            for saved in c.execute("SELECT id,text FROM prompts").fetchall():
                latest = c.execute("SELECT refs,options FROM jobs WHERE prompt=? ORDER BY created DESC LIMIT 1", (saved["text"],)).fetchone()
                if latest:
                    c.execute("UPDATE prompts SET refs=?,options=? WHERE id=?", (latest["refs"], latest["options"], saved["id"]))
        if not c.execute("SELECT 1 FROM settings WHERE key='templates_migrated'").fetchone():
            c.execute("INSERT OR IGNORE INTO templates(id,text,title,favorite,created,updated,refs,options) SELECT id,text,title,favorite,created,updated,refs,options FROM prompts")
            c.execute("INSERT INTO settings VALUES ('templates_migrated','true')")
        # Previous requests without explicit template membership stay independent by batch.
        for job in c.execute("SELECT id,batch_id,prompt,template_id,collection_id,created FROM jobs").fetchall():
            cid = 'tpl-' + job['template_id'] if job['template_id'] else 'request-' + job['batch_id']
            if job['collection_id'] != cid:
                c.execute("UPDATE jobs SET collection_id=? WHERE id=?", (cid, job["id"]))
                template = c.execute("SELECT title FROM templates WHERE id=?", (job['template_id'],)).fetchone() if job['template_id'] else None
                name = template['title'] if template else job['prompt'][:48]
                c.execute("INSERT INTO collections(id,name,prompt,created,updated) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated=MAX(collections.updated,excluded.updated),created=MIN(collections.created,excluded.created)", (cid, name, job['prompt'], job['created'], job['created']))
        c.execute("DELETE FROM collections WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.collection_id=collections.id)")
        c.execute("DELETE FROM sessions WHERE expires<?", (now(),))
        saved_redraw=c.execute("SELECT value FROM settings WHERE key='stitch_prompt'").fetchone()
        if saved_redraw:
            previous=json.loads(saved_redraw[0]);normalized=normalize_redraw_prompt(previous)
            if normalized!=previous:c.execute("UPDATE settings SET value=? WHERE key='stitch_prompt'",(json.dumps(normalized),))
        c.execute("UPDATE jobs SET status='failed',error='服务重启中断了这次生成，请重试。',finished=? WHERE status IN ('running','retrying')", (now(),))
        c.execute("UPDATE attempts SET status='interrupted',finished=? WHERE status='running'", (now(),))
    config = CODEX_HOME / "config.toml"
    if not config.exists():
        config.write_text('model = "gpt-6.1-sol"\nmodel_reasoning_effort = "xhigh"\ncli_auth_credentials_store = "file"\n[features]\nimage_generation = true\n', encoding="utf-8")
        os.chmod(config, 0o600)


def password_hash(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return salt.hex() + ":" + digest.hex()


def password_matches(password, encoded):
    try:
        salt, digest = encoded.split(":")
        check = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
        return hmac.compare_digest(check.hex(), digest)
    except (ValueError, TypeError):
        return False


def require_user(request: Request):
    token = request.cookies.get("studio_session", "")
    session = query("SELECT * FROM sessions WHERE token=? AND expires>?", (hashlib.sha256(token.encode()).hexdigest(), now()), True)
    if not session:
        raise HTTPException(401, "请先登录工作台")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if not hmac.compare_digest(request.headers.get("x-csrf-token", ""), session["csrf"]):
            raise HTTPException(403, "登录状态已更新，请刷新页面后再试")
    return session


def login_response(request):
    token, csrf = secrets.token_urlsafe(40), secrets.token_urlsafe(24)
    write("INSERT INTO sessions VALUES (?,?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), csrf, now(), now() + SESSION_AGE))
    response = JSONResponse({"ok": True, "csrf": csrf})
    response.set_cookie("studio_session", token, httponly=True, secure=request.url.scheme == "https", samesite="strict", max_age=SESSION_AGE, path="/")
    return response


def codex_env():
    env = {k: v for k, v in os.environ.items() if k not in {"OPENAI_API_KEY", "STUDIO_SETUP_TOKEN", "STUDIO_SETUP_TOKEN_FILE", "CODEX_ACCESS_TOKEN"}}
    env.update(CODEX_HOME=str(CODEX_HOME), HOME=str(DATA), NO_COLOR="1", TERM="dumb", STUDIO_STITCH_PYTHON=sys.executable, STUDIO_STITCH_ENGINE=str(ROOT/"stitch_engine.py"), OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1")
    return env


async def command(*args, timeout=15, max_chars=16000):
    try:
        p = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=codex_env(), start_new_session=os.name != "nt")
    except FileNotFoundError:
        return 127, "Codex CLI 尚未安装"
    try:
        out, _ = await asyncio.wait_for(p.communicate(), timeout)
        return p.returncode, out.decode(errors="replace")[:max_chars]
    except asyncio.TimeoutError:
        await stop_process(p)
        return 124, "命令超时，请稍后重试"


async def _stop_process(p):
    if p.returncode is not None:
        return
    try:
        if os.name != "nt":
            os.killpg(p.pid, signal.SIGTERM)
        else:
            p.terminate()
        await asyncio.wait_for(p.wait(), 5)
    except (ProcessLookupError, asyncio.TimeoutError):
        with contextlib.suppress(ProcessLookupError):
            if os.name != "nt":
                os.killpg(p.pid, signal.SIGKILL)
            else:
                p.kill()
        await p.wait()


async def stop_process(p):
    # Cancellation, shutdown and worker cleanup can target the same process together.
    # Send one termination sequence and retain its task until the process has exited.
    task=STOPPING.get(p.pid)
    if task is None:
        task=asyncio.create_task(_stop_process(p));STOPPING[p.pid]=task
        def finished(done):
            if STOPPING.get(p.pid) is done:STOPPING.pop(p.pid,None)
        task.add_done_callback(finished)
    await asyncio.shield(task)


async def retire_process(key):
    process=PROCESSES.get(key)
    if process is None:return
    cleanup=asyncio.create_task(stop_process(process));interrupted=False
    try:
        while not cleanup.done():
            try:await asyncio.shield(cleanup)
            except asyncio.CancelledError:interrupted=True
        await cleanup
    finally:
        if PROCESSES.get(key) is process:PROCESSES.pop(key,None)
    if interrupted:raise asyncio.CancelledError()


def job_processes(jid):
    return [p for key,p in list(PROCESSES.items()) if key==jid or key.startswith(jid+':')]


@asynccontextmanager
async def cli_slot(jid, label):
    if CALL_POOL is None:raise RuntimeError('CLI 调度器尚未启动')
    async with CALL_POOL.slot(jid,label) as token:
        key=f'{jid}:cli:{token}'
        try:
            if job_cancelled(jid):raise asyncio.CancelledError()
            yield key
        finally:
            await retire_process(key)


def spawn(coro):
    task = asyncio.create_task(coro)
    BACKGROUND.add(task)
    task.add_done_callback(BACKGROUND.discard)
    return task


@asynccontextmanager
async def lifespan(app):
    global CALL_POOL
    initialize()
    CALL_POOL=CallPool(lambda:setting('concurrency',2),lambda:setting('paused',False))
    JOB_TASKS.clear()
    task = spawn(scheduler())
    yield
    task.cancel()
    CALL_POOL.close()
    for bg in list(BACKGROUND):
        bg.cancel()
    await asyncio.gather(*(stop_process(p) for p in list(PROCESSES.values())), return_exceptions=True)
    await asyncio.gather(*list(BACKGROUND), return_exceptions=True)
    JOB_TASKS.clear();CALL_POOL=None


app = FastAPI(title="Image Studio", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def security(request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
            return JSONResponse({"detail": "跨站请求已拒绝"}, status_code=403)
        length = request.headers.get("content-length", "0")
        if not length.isdigit() or int(length) > MAX_UPLOAD + 1024 * 1024:
            return JSONResponse({"detail": "上传内容过大，单张图片上限 20 MB"}, status_code=413)
    response = await call_next(request)
    response.headers.update({"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin", "Content-Security-Policy": "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"})
    if request.url.path.startswith(("/api/", "/media/")):
        response.headers["Cache-Control"] = "no-store"
    return response


class Credentials(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=10, max_length=256)
    setup_token: str = ""


@app.api_route("/api/health", methods=["GET", "HEAD"])
def health():
    return {"ok": True, "app": "Image Studio"}


@app.get("/api/auth/state")
def auth_state(request: Request):
    user = query("SELECT username FROM users WHERE id=1", one=True)
    try:
        session = require_user(request)
    except HTTPException:
        session = None
    return {"initialized": bool(user), "authenticated": bool(session), "username": user["username"] if user and session else "", "csrf": session["csrf"] if session else ""}


def rate_limit(request):
    ip = request.client.host if request.client else "unknown"
    attempts = [t for t in LOGIN_FAILURES.get(ip, []) if t > now() - 900]
    LOGIN_FAILURES[ip] = attempts
    if len(attempts) >= 10:
        raise HTTPException(429, "尝试次数过多，请 15 分钟后重试")
    return attempts


@app.post("/api/auth/setup")
def setup(body: Credentials, request: Request):
    attempts = rate_limit(request)
    token_file = os.getenv("STUDIO_SETUP_TOKEN_FILE")
    expected = Path(token_file).read_text().strip() if token_file and Path(token_file).exists() else os.getenv("STUDIO_SETUP_TOKEN", "")
    if not expected or not hmac.compare_digest(body.setup_token, expected):
        attempts.append(now())
        raise HTTPException(403, "初始化密钥不正确")
    try:
        write("INSERT INTO users VALUES (1,?,?,?)", (body.username.strip(), password_hash(body.password), now()))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "工作台已初始化，请直接登录")
    return login_response(request)


@app.post("/api/auth/login")
def login(body: Credentials, request: Request):
    attempts = rate_limit(request)
    user = query("SELECT * FROM users WHERE id=1", one=True)
    encoded = user["password"] if user else password_hash("dummy-password-not-an-account")
    valid = password_matches(body.password, encoded)
    if not user or not hmac.compare_digest(body.username.strip(), user["username"]) or not valid:
        attempts.append(now())
        raise HTTPException(401, "用户名或密码不正确")
    return login_response(request)


@app.post("/api/auth/logout")
def logout(session=Depends(require_user)):
    write("DELETE FROM sessions WHERE token=?", (session["token"],))
    response = JSONResponse({"ok": True})
    response.delete_cookie("studio_session", path="/")
    return response


@app.post("/api/auth/password")
def change_password(body: dict, request: Request, session=Depends(require_user)):
    user = query("SELECT * FROM users WHERE id=1", one=True)
    if not password_matches(str(body.get("current", "")), user["password"]):
        raise HTTPException(400, "当前密码不正确")
    password = str(body.get("password", ""))
    if not 10 <= len(password) <= 256:
        raise HTTPException(400, "新密码需要 10–256 个字符")
    write("UPDATE users SET password=? WHERE id=1", (password_hash(password),))
    write("DELETE FROM sessions")
    return login_response(request)


@app.get("/api/state")
def state(session=Depends(require_user)):
    return {"model": setting("model", MODEL), "effort": setting("effort", EFFORT), "concurrency": setting("concurrency", 2), "max_attempts": setting("max_attempts", 3), "paused": setting("paused", False), "onboarded": setting("onboarded", False), "calls":CALL_POOL.snapshot() if CALL_POOL else {"active":0,"waiting":0}, "counts": query("SELECT status,COUNT(*) AS count FROM jobs GROUP BY status"), "reference_count": query("SELECT COUNT(*) AS n FROM assets WHERE kind='reference'", one=True)["n"]}


@app.get("/api/account")
def account(session=Depends(require_user)):
    user = query("SELECT username,created FROM users WHERE id=1", one=True)
    return user | {"session_count": query("SELECT COUNT(*) AS n FROM sessions WHERE expires>?", (now(),), True)["n"]}


class AccountInput(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    current_password: str = Field(min_length=1, max_length=256)


@app.patch("/api/account")
def update_account(body: AccountInput, request: Request, session=Depends(require_user)):
    user = query("SELECT * FROM users WHERE id=1", one=True)
    if not password_matches(body.current_password, user["password"]):
        raise HTTPException(400, "当前密码不正确")
    username = body.username.strip()
    if len(username) < 2:
        raise HTTPException(400, "用户名至少需要 2 个字符")
    write("UPDATE users SET username=? WHERE id=1", (username,))
    write("DELETE FROM sessions")
    return login_response(request)


@app.post("/api/account/revoke-sessions")
def revoke_sessions(session=Depends(require_user)):
    count = write("DELETE FROM sessions WHERE token!=?", (session["token"],))
    return {"ok": True, "revoked": count}


@app.get("/api/call-settings")
def call_settings(session=Depends(require_user)):
    return {"call_prompt": setting("call_prompt", DEFAULT_CALL_PROMPT), "default_call_prompt": DEFAULT_CALL_PROMPT, "polish_prompt": setting("polish_prompt", DEFAULT_POLISH_PROMPT), "default_polish_prompt": DEFAULT_POLISH_PROMPT, "stitch_prompt": setting("stitch_prompt", DEFAULT_STITCH_PROMPT), "default_stitch_prompt": DEFAULT_STITCH_PROMPT, "variables": ["{prompt}", "{ratio}", "{size}", "{transparent}", "{references}"]}


def model_catalog():
    return setting("model_catalog", [{"id": MODEL, "name": "GPT-6.1 Sol", "efforts": ["low", "medium", "high", "xhigh", "max"], "default_effort": "low"}])


def validate_model_choice(model, effort):
    item = next((m for m in model_catalog() if m["id"] == model), None)
    if not item:
        raise HTTPException(400, "模型不在当前 CLI 目录中，请刷新模型列表后选择")
    if effort not in item["efforts"]:
        raise HTTPException(400, "该模型不支持此思考强度，可选：" + ", ".join(item["efforts"]))


@app.get("/api/models")
async def models(refresh: bool = False, session=Depends(require_user)):
    cached = setting("model_catalog_time", 0)
    error = ""
    if refresh or now() - cached > 3600:
        code, output = await command(CODEX_BIN, "debug", "models", timeout=25, max_chars=4_000_000)
        try:
            if code != 0:
                raise ValueError("CLI 模型目录暂时不可用")
            raw, _ = json.JSONDecoder().raw_decode(output[output.index("{"):])
            result = []
            for m in raw.get("models", []):
                if m.get("visibility") != "list" or not re.fullmatch(r"gpt-[A-Za-z0-9._-]+", m.get("slug", "")):
                    continue
                efforts = [r["effort"] for r in m.get("supported_reasoning_levels", []) if r.get("effort") in ("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra")]
                if efforts:
                    result.append({"id": m["slug"], "name": m.get("display_name", m["slug"]), "efforts": efforts, "default_effort": m.get("default_reasoning_level", efforts[0])})
            if result:
                set_setting("model_catalog", result)
                set_setting("model_catalog_time", now())
            else:
                raise ValueError("CLI 没有返回可选模型")
        except (ValueError, KeyError, TypeError) as exc:
            error = str(exc)
    return {"items": model_catalog(), "model": setting("model", MODEL), "effort": setting("effort", EFFORT), "error": error, "note": "模型目录不是账号权限保证，实际访问以任务执行结果为准。"}


class Settings(BaseModel):
    concurrency: int = Field(default=2, ge=1, le=4)
    max_attempts: int = Field(default=3, ge=1, le=5)
    paused: bool = False
    model: str | None = Field(default=None, max_length=100)
    effort: str | None = Field(default=None, max_length=20)
    call_prompt: str | None = Field(default=None, min_length=20, max_length=24000)
    polish_prompt: str | None = Field(default=None, min_length=20, max_length=24000)
    stitch_prompt: str | None = Field(default=None, min_length=20, max_length=24000)


@app.patch("/api/settings")
def settings(body: Settings, session=Depends(require_user)):
    validate_model_choice(body.model or setting("model", MODEL), body.effort or setting("effort", EFFORT))
    for template in (body.call_prompt, body.polish_prompt, body.stitch_prompt):
        if template is not None and "{prompt}" not in template:
            raise HTTPException(400, "调用提示词必须包含 {prompt} 变量")
    for key, value in body.model_dump(exclude_none=True).items():
        if key=='stitch_prompt':value=normalize_redraw_prompt(value)
        set_setting(key, value)
    WAKE.set()
    if CALL_POOL:CALL_POOL.notify()
    return {"ok": True}


@app.post("/api/setup/finish")
def finish_setup(session=Depends(require_user)):
    set_setting("onboarded", True)
    return {"ok": True}


@app.get("/api/setup/status")
async def setup_status(session=Depends(require_user)):
    version_code, version = await command(CODEX_BIN, "--version", timeout=10)
    code, output = await command(CODEX_BIN, "login", "status", timeout=10) if version_code == 0 else (127, "尚未安装")
    authenticated = code == 0 and "api key" not in output.lower()
    return {"installed": version_code == 0, "version": version.strip(), "authenticated": authenticated, "auth_message": output.strip(), "login": LOGIN, "probe": setting("probe", None), "model": setting("model", MODEL), "effort": setting("effort", EFFORT)}


async def collect_login(p):
    raw = ""
    try:
        async def consume():
            nonlocal raw
            while chunk := await p.stdout.read(1024):
                raw += chunk.decode(errors="replace")
                clean = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", raw)[-8000:]
                urls = re.findall(r"https://auth\.openai\.com/[^\s<>]+", clean)
                codes = re.findall(r"\b[A-Z0-9]{4,6}-[A-Z0-9]{4,6}\b", clean)
                LOGIN.update(output=clean, url=urls[0] if urls else "", code=codes[0] if codes else "")
            await p.wait()
        await asyncio.wait_for(consume(), 600)
    except asyncio.TimeoutError:
        LOGIN["output"] += "\n登录已超时，请重新开始。"
        await stop_process(p)
    finally:
        await stop_process(p)
        if PROCESSES.get("login") is p:
            LOGIN["running"] = False
            PROCESSES.pop("login", None)


class LoginInput(BaseModel):
    mode: Literal["browser", "device"] = "browser"


@app.post("/api/setup/login")
async def start_login(body: LoginInput = LoginInput(), session=Depends(require_user)):
    async with LOGIN_LOCK:
        if LOGIN["running"]:
            if LOGIN["mode"] == body.mode:
                return LOGIN
            if previous := PROCESSES.get("login"):
                await stop_process(previous)
        try:
            args = [CODEX_BIN, "login"] + (["--device-auth"] if body.mode == "device" else [])
            env = codex_env() | {"BROWSER": "/bin/true"}
            p = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=env, start_new_session=os.name != "nt")
        except FileNotFoundError:
            raise HTTPException(400, "服务器尚未安装 Codex CLI")
        LOGIN.update(running=True, output="正在创建官方登录链接…" if body.mode == "browser" else "正在申请设备登录码…", url="", code="", mode=body.mode)
        PROCESSES["login"] = p
        spawn(collect_login(p))
        return LOGIN


class LoginCallback(BaseModel):
    url: str = Field(min_length=10, max_length=12000)


@app.post("/api/setup/callback")
async def login_callback(body: LoginCallback, session=Depends(require_user)):
    if not LOGIN["running"] or LOGIN["mode"] != "browser" or not LOGIN["url"]:
        raise HTTPException(409, "请先发起一次浏览器链接登录")
    parts = urlsplit(body.url.strip())
    try:
        valid = parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1") and parts.port == 1455 and parts.path == "/auth/callback" and not parts.username and not parts.password
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(400, "请粘贴官方授权后跳转到的完整 http://localhost:1455/auth/callback?... 地址")
    values = parse_qs(parts.query)
    expected_state = parse_qs(urlsplit(LOGIN["url"]).query).get("state", [""])[0]
    actual_state = values.get("state", [""])[0]
    if not expected_state or not hmac.compare_digest(actual_state, expected_state) or not values.get("code"):
        raise HTTPException(400, "回调与当前登录请求不匹配，或缺少授权码。请使用本次登录生成的链接。")
    # Only relay to the official CLI's fixed loopback callback. Never fetch a user-supplied host.
    try:
        async with httpx.AsyncClient(trust_env=False, follow_redirects=False, timeout=30) as client:
            response = await client.get("http://127.0.0.1:1455/auth/callback", params={k: v[0] for k, v in values.items()})
        if response.status_code >= 400:
            raise HTTPException(400, "Codex 未接受此次回调。授权码可能已过期，请重新获取登录链接。")
    except httpx.RequestError:
        raise HTTPException(409, "CLI 登录回调已关闭，请重新开始链接登录")
    return {"ok": True, "message": "回调已提交，请等待登录状态更新。"}


@app.post("/api/setup/login/cancel")
async def cancel_login(session=Depends(require_user)):
    if p := PROCESSES.get("login"):
        await stop_process(p)
    return {"ok": True}


def serialize_asset(a):
    if not a:
        return None
    return {k: v for k, v in a.items() if k not in ("path", "sha")} | {"url": f"/media/{a['id']}", "thumbnail": f"/media/{a['id']}?thumbnail=1"}


def store_image(content: bytes, name: str, kind="reference", job_id=None, pixel_limit=36_000_000):
    try:
        with Image.open(io.BytesIO(content)) as original:
            original.verify()
        with Image.open(io.BytesIO(content)) as original:
            if original.width * original.height > pixel_limit:
                raise ValueError("图片超过允许像素上限")
            im = ImageOps.exif_transpose(original)
            if im.width * im.height > pixel_limit:
                raise ValueError("图片超过允许像素上限")
            im = im.convert("RGBA" if "A" in im.getbands() or "transparency" in im.info else "RGB")
            width, height = im.size
            cleaned = io.BytesIO()
            im.save(cleaned, "PNG")
            data = cleaned.getvalue()
            sha = hashlib.sha256(data).hexdigest()
            existing = query("SELECT * FROM assets WHERE sha=?", (sha,), True)
            if existing:
                if existing.get("deleted"):
                    write("UPDATE assets SET deleted=0 WHERE id=?", (existing["id"],))
                    existing["deleted"] = 0
                if kind == "reference":
                    write("UPDATE assets SET kind='reference' WHERE id=?", (existing["id"],))
                    existing["kind"] = "reference"
                return serialize_asset(existing), True
            aid = uid()
            path = DATA / "assets" / f"{aid}.png"
            path.write_bytes(data)
            im.thumbnail((480, 480))
            im.save(DATA / "thumbs" / f"{aid}.webp", "WEBP", quality=82)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, "无法读取图片，请使用 PNG、JPEG 或 WebP，且不超过 3600 万像素。") from exc
    write("INSERT INTO assets(id,sha,path,kind,name,width,height,bytes,created,job_id) VALUES (?,?,?,?,?,?,?,?,?,?)", (aid, sha, str(path), kind, name[:160], width, height, len(data), now(), job_id))
    return serialize_asset(query("SELECT * FROM assets WHERE id=?", (aid,), True)), False


@app.post("/api/assets")
async def upload_asset(file: UploadFile = File(...), session=Depends(require_user)):
    content = await file.read(MAX_UPLOAD + 1)
    await file.close()
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, "单张参考图不能超过 20 MB")
    asset, cached = await asyncio.to_thread(store_image, content, Path(file.filename or "参考图").name)
    return {"asset": asset, "cached": cached}


@app.get("/api/assets")
def list_assets(kind: str = "reference", search: str = "", favorite: bool = False, deleted: bool = False, limit: int = 100, offset: int = 0, session=Depends(require_user)):
    clauses, args = ["deleted=?"], [int(deleted)]
    if kind in ("reference", "generated"):
        clauses.append("kind=?")
        args.append(kind)
    if search:
        clauses.append("(name LIKE ? OR tags LIKE ?)")
        args += [f"%{search[:100]}%"] * 2
    if favorite:
        clauses.append("favorite=1")
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    rows = query("SELECT * FROM assets" + where + " ORDER BY created DESC LIMIT ? OFFSET ?", (*args, max(1, min(limit, 200)), max(0, offset)))
    total = query("SELECT COUNT(*) AS n FROM assets" + where, args, True)["n"]
    return {"items": [serialize_asset(a) for a in rows], "total": total}


@app.patch("/api/assets/{aid}")
def edit_asset(aid: str, body: dict, session=Depends(require_user)):
    a = query("SELECT * FROM assets WHERE id=?", (aid,), True)
    if not a:
        raise HTTPException(404, "图片不存在")
    for key in ("name", "tags", "favorite", "kind"):
        if key in body:
            value = int(bool(body[key])) if key == "favorite" else str(body[key])[:200]
            if key == "kind" and value not in ("reference", "generated"):
                raise HTTPException(400, "图片类型不正确")
            write(f"UPDATE assets SET {key}=? WHERE id=?", (value, aid))
    return serialize_asset(query("SELECT * FROM assets WHERE id=?", (aid,), True))


@app.delete("/api/assets/{aid}")
def delete_asset(aid: str, session=Depends(require_user)):
    a = query("SELECT * FROM assets WHERE id=?", (aid,), True)
    if not a:
        raise HTTPException(404, "图片不存在")
    write("UPDATE assets SET deleted=1 WHERE id=?", (aid,))
    return {"ok": True}


@app.post("/api/assets/{aid}/restore")
def restore_asset(aid: str, session=Depends(require_user)):
    if not write("UPDATE assets SET deleted=0 WHERE id=?", (aid,)):
        raise HTTPException(404, "图片不存在")
    return {"ok": True}


@app.get("/media/{aid}")
def media(aid: str, thumbnail: bool = False, download: bool = False, session=Depends(require_user)):
    a = query("SELECT * FROM assets WHERE id=?", (aid,), True)
    if not a:
        raise HTTPException(404, "图片不存在")
    path = DATA / "thumbs" / f"{a['id']}.webp" if thumbnail else Path(a["path"])
    return FileResponse(path, media_type="image/webp" if thumbnail else "image/png", filename=(Path(a["name"]).stem + ".png") if download else None)


class PromptInput(BaseModel):
    text: str = Field(default="", max_length=24000)
    title: str = Field(default="", max_length=100)
    refs: list[str] = Field(default_factory=list, max_length=8)
    options: dict = Field(default_factory=dict)


def cache_prompt(text, title="", refs=None, options=None):
    pid = uid()
    write("INSERT INTO templates(id,text,title,created,updated,refs,options) VALUES (?,?,?,?,?,?,?)", (pid, text, title or text[:48] or "参考图模板", now(), now(), json.dumps(refs or []), json.dumps(options or {})))
    return query("SELECT * FROM templates WHERE id=?", (pid,), True)


def serialize_prompt(saved):
    saved["refs"] = json.loads(saved["refs"])
    saved["options"] = json.loads(saved["options"])
    saved["references"] = [serialize_asset(a) for aid in saved["refs"] if (a := query("SELECT * FROM assets WHERE id=?", (aid,), True))]
    return saved


@app.get("/api/templates")
@app.get("/api/prompts")
def list_prompts(search: str = "", session=Depends(require_user)):
    return [serialize_prompt(p) for p in query("SELECT * FROM templates WHERE text LIKE ? OR title LIKE ? ORDER BY favorite DESC,updated DESC LIMIT 100", (f"%{search[:100]}%", f"%{search[:100]}%"))]


@app.post("/api/templates")
@app.post("/api/prompts")
def save_prompt(body: PromptInput, session=Depends(require_user)):
    if not body.text.strip() and not body.refs:
        raise HTTPException(400, "模板至少需要正文或一张参考图")
    refs = list(dict.fromkeys(body.refs))
    for aid in refs:
        if not query("SELECT id FROM assets WHERE id=?", (aid,), True):
            raise HTTPException(400, "参考图不存在")
    options = {k: body.options[k] for k in ("ratio", "transparent", "model", "effort", "polish", "size", "stitch") if k in body.options}
    return serialize_prompt(cache_prompt(body.text.strip(), body.title, refs, options))


@app.get("/api/templates/{pid}")
def get_template(pid: str, session=Depends(require_user)):
    saved = query("SELECT * FROM templates WHERE id=?", (pid,), True)
    if not saved:
        raise HTTPException(404, "模板不存在")
    return serialize_prompt(saved)


@app.put("/api/templates/{pid}")
def update_template(pid: str, body: PromptInput, session=Depends(require_user)):
    previous = query("SELECT * FROM templates WHERE id=?", (pid,), True)
    if not previous:
        raise HTTPException(404, "模板不存在")
    if not body.text.strip() and not body.refs:
        raise HTTPException(400, "模板至少需要正文或一张参考图")
    refs = list(dict.fromkeys(body.refs))
    for aid in refs:
        if not query("SELECT id FROM assets WHERE id=?", (aid,), True):
            raise HTTPException(400, "参考图不存在")
    options = {k:body.options[k] for k in ("ratio", "transparent", "model", "effort", "polish", "size", "stitch") if k in body.options}
    title = body.title.strip() or body.text.strip()[:48] or "参考图模板"
    write("UPDATE templates SET text=?,title=?,refs=?,options=?,updated=? WHERE id=?", (body.text.strip(),title,json.dumps(refs),json.dumps(options),now(),pid))
    write("UPDATE collections SET name=? WHERE id=? AND name=?", (title,'tpl-'+pid,previous['title']))
    return get_template(pid, session)


@app.patch("/api/templates/{pid}")
@app.patch("/api/prompts/{pid}")
def edit_prompt(pid: str, body: dict, session=Depends(require_user)):
    if "favorite" in body:
        write("UPDATE templates SET favorite=? WHERE id=?", (int(bool(body["favorite"])), pid))
    if "title" in body:
        previous = query("SELECT title FROM templates WHERE id=?", (pid,), True)
        title = str(body["title"]).strip()[:100]
        if previous and title:
            write("UPDATE templates SET title=? WHERE id=?", (title,pid))
            write("UPDATE collections SET name=? WHERE id=? AND name=?", (title,'tpl-'+pid,previous['title']))
    return {"ok": True}


@app.delete("/api/templates/{pid}")
@app.delete("/api/prompts/{pid}")
def delete_prompt(pid: str, session=Depends(require_user)):
    write("DELETE FROM templates WHERE id=?", (pid,))
    return {"ok": True}


class JobInput(BaseModel):
    prompt: str = Field(min_length=1, max_length=24000)
    refs: list[str] = Field(default_factory=list, max_length=8)
    count: int = Field(default=1, ge=1, le=20)
    ratio: str = "1:1"
    transparent: bool = False
    polish: bool = False
    size: Literal["auto", "1024", "2048", "4096"] = "auto"
    stitch: Literal[0,4,9,16] = 0
    source_asset_id: str | None = Field(default=None, max_length=64)
    max_attempts: int | None = Field(default=None, ge=1, le=5)
    model: str | None = Field(default=None, max_length=100)
    effort: str | None = Field(default=None, max_length=20)
    template_id: str | None = Field(default=None, max_length=64)


def serialize_job(j):
    j = dict(j)
    j["refs"] = json.loads(j["refs"])
    j["options"] = json.loads(j["options"])
    j["model"] = j["options"].get("model", MODEL)
    j["effort"] = j["options"].get("effort", EFFORT)
    j["template_title"] = j["options"].get("template_title", "")
    j["output_ids"] = json.loads(j["outputs"])
    j["outputs"] = [serialize_asset(a) for aid in j["output_ids"] if (a := query("SELECT * FROM assets WHERE id=? AND deleted=0", (aid,), True))]
    j["references"] = [serialize_asset(a) for aid in j["refs"] if (a := query("SELECT * FROM assets WHERE id=?", (aid,), True))]
    j["progress"] = job_progress(j)
    return j


STAGES = {"sending": "正在传递", "thinking": "主模型正在思考", "generating": "等待生图返回", "receiving": "正在回传"}


def job_progress(job):
    status = job["status"]
    options=job.get("options",{})
    if isinstance(options,str):options=json.loads(options)
    if options.get("stitch"):
        from stitch_engine import PHASES, LABELS
        value=json.loads(job.get("progress_detail") or '{}')
        value={"stage":"base","label":LABELS[0],"fraction":0,"step":1,"total":len(PHASES),"source":"server",**value}
        value["indeterminate"]=bool(value.get("waiting"));value["factor"]=options['stitch'];value["stitch"]=True
        if status=='succeeded':value.update(fraction=1,label='超分已完成',step=len(PHASES),waiting=False,indeterminate=False)
        elif status in ('failed','cancelled','queued','retrying'):
            value['label']={'failed':'超分失败，可从检查点重试','cancelled':'已取消','queued':'超分等待调度','retrying':'等待重试'}[status]
            value.update(waiting=False,indeterminate=False)
        value['percent']=max(0,min(100,round(value['fraction']*100)))
        return value
    terminal = {"queued": "等待调度", "retrying": "等待重试", "succeeded": "已完成", "failed": "生成失败", "cancelled": "已取消"}
    if status != "running":
        return {"stage": status, "label": terminal.get(status, status), "step": 4 if status == "succeeded" else 0, "total": 4, "indeterminate": False, "source": "server", "updated": job.get("stage_updated") or job.get("created",0)}
    stage = job.get("stage") or "sending"
    if stage=='call_wait':
        return {"stage":stage,"label":"调度已暂停" if setting('paused',False) else "等待并发名额","step":0,"total":4,"indeterminate":False,"source":"server","updated":job.get('stage_updated',0)}
    if stage not in STAGES: stage = "sending"
    return {"stage": stage, "label": STAGES[stage], "step": list(STAGES).index(stage)+1, "total": 4, "indeterminate": True, "source": job.get("stage_source") or "server", "updated": job.get("stage_updated") or job.get("started",0)}


def set_job_stage(jid, stage, source="server"):
    if stage not in STAGES: return
    current = query("SELECT stage,status FROM jobs WHERE id=?",(jid,),True)
    if not current or current["status"] != "running": return
    order = list(STAGES)
    if current["stage"] in order and order.index(current["stage"]) >= order.index(stage): return
    write("UPDATE jobs SET stage=?,stage_source=?,stage_updated=? WHERE id=? AND status='running'",(stage,source,now(),jid))


def stage_from_event(event):
    """CLI events and explicit worker reports; no elapsed-time based guesswork."""
    kind = event.get("type", "")
    if kind in ("thread.started", "turn.started"): return "thinking", "cli"
    if kind == "turn.completed": return "receiving", "cli"
    item = event.get("item") or {}
    if not isinstance(item,dict): return None
    tool = str(item.get("tool") or item.get("name") or "")
    if item.get("type") == "image_generation" or (item.get("type") in ("mcp_tool_call","tool_call") and re.search(r"image_?gen",tool,re.I)):
        return ("receiving" if kind == "item.completed" else "generating"), "cli"
    if item.get("type") == "agent_message":
        text = item.get("text", "").strip()
        if text == "[STUDIO_STAGE:image_generation]": return "generating", "worker"
        if text == "[STUDIO_STAGE:receiving]": return "receiving", "worker"
    return None


def create_jobs(body):
    if not body.prompt.strip():
        raise HTTPException(400, "提示词不能为空")
    model = body.model or setting("model", MODEL)
    effort = body.effort or setting("effort", EFFORT)
    validate_model_choice(model, effort)
    if body.ratio not in ("1:1", "3:2", "2:3", "16:9", "9:16", "auto"):
        raise HTTPException(400, "画幅不支持")
    refs = list(dict.fromkeys(body.refs))
    if body.source_asset_id and not body.stitch:
        raise HTTPException(400, "发送现有图片到超分时必须选择倍率")
    if body.source_asset_id:
        source=query('SELECT * FROM assets WHERE id=?',(body.source_asset_id,),True)
        if not source:raise HTTPException(400,'超分原图不存在')
        from stitch_engine import layout, StitchError
        try:layout(source['width'],source['height'],body.stitch)
        except StitchError as error:raise HTTPException(400,str(error)) from error
        if body.source_asset_id not in refs:refs.append(body.source_asset_id)
        if len(refs)>8:raise HTTPException(400,'每次最多使用 8 张参考图')
    for aid in refs:
        if not query("SELECT id FROM assets WHERE id=?", (aid,), True):
            raise HTTPException(400, "参考图不存在，请重新选择")
    if query("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running','retrying')", one=True)["n"] + body.count > 100:
        raise HTTPException(429, "队列最多容纳 100 个任务，请等待部分任务完成")
    template = query("SELECT id,title FROM templates WHERE id=?", (body.template_id,), True) if body.template_id else None
    if body.template_id and not template:
        raise HTTPException(400, "模板已删除，请移除模板标签后独立提交")
    options = {"ratio": body.ratio, "transparent": body.transparent, "model": model, "effort": effort, "polish": body.polish, "size": body.size, "call_prompt": setting("polish_prompt", DEFAULT_POLISH_PROMPT) if body.polish else setting("call_prompt", DEFAULT_CALL_PROMPT), "image_requirements": IMAGE_REQUIREMENTS, "template_title": template['title'] if template else ''}
    options.update(stitch=body.stitch,source_asset_id=body.source_asset_id,stitch_prompt=normalize_redraw_prompt(setting('stitch_prompt',DEFAULT_STITCH_PROMPT)) if body.stitch else '',redraw_call_prompt=setting('call_prompt',DEFAULT_CALL_PROMPT) if body.stitch else '')
    batch, ids = uid(), []
    collection_id = 'tpl-' + template['id'] if template else 'request-' + batch
    with db() as c:
        c.execute("INSERT INTO collections(id,name,prompt,created,updated) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,deleted=0", (collection_id, template['title'] if template else body.prompt.strip()[:48], body.prompt.strip(), now(), now()))
        for _ in range(body.count):
            jid = uid()
            ids.append(jid)
            c.execute("INSERT INTO jobs(id,batch_id,prompt,refs,options,status,max_attempts,created,collection_id,template_id) VALUES (?,?,?,?,?,'queued',?,?,?,?)", (jid, batch, body.prompt.strip(), json.dumps(refs), json.dumps(options), body.max_attempts or setting("max_attempts", 3), now(), collection_id, template['id'] if template else ''))
    WAKE.set()
    return {"ids": ids, "batch_id": batch, "collection_id": collection_id}


@app.post("/api/jobs")
async def add_jobs(body: JobInput, session=Depends(require_user)):
    code, status = await command(CODEX_BIN, "login", "status", timeout=10)
    if code != 0 or "api key" in status.lower():
        raise HTTPException(409, "请先在连接设置中完成 ChatGPT 订阅登录")
    return create_jobs(body)


class UpscaleInput(BaseModel):
    factor: Literal[4,9,16] = 4
    model: str | None = Field(default=None,max_length=100)
    effort: str | None = Field(default=None,max_length=20)


@app.post('/api/assets/{aid}/upscale')
async def upscale_asset(aid: str, body: UpscaleInput, session=Depends(require_user)):
    asset=query('SELECT * FROM assets WHERE id=?',(aid,),True)
    if not asset:raise HTTPException(404,'原图不存在')
    origin=query('SELECT * FROM jobs WHERE id=?',(asset['job_id'],),True) if asset['job_id'] else None
    options=json.loads(origin['options']) if origin else {}
    template=origin.get('template_id') if origin else None
    if template and not query('SELECT id FROM templates WHERE id=?',(template,),True):template=None
    request=JobInput(prompt=origin['prompt'] if origin else f"严格保留参考图的构图和内容，增强原有细节。{asset['name']}",refs=[aid],stitch=body.factor,source_asset_id=aid,model=body.model or options.get('model') or setting('model',MODEL),effort=body.effort or options.get('effort') or setting('effort',EFFORT),template_id=template,transparent=options.get('transparent',False))
    return await add_jobs(request,session)


@app.get('/api/jobs/{jid}/stitch/{artifact}')
def stitch_artifact(jid: str, artifact: str, session=Depends(require_user)):
    files={'preview':'preview.png','overview':'overview.png','inspection':'inspection.png','candidate':'candidate.png','base':'base.png','report':'diagnostics/quality.json'}
    if not re.fullmatch('[a-f0-9]{32}',jid) or artifact not in files:raise HTTPException(404)
    path=DATA/'jobs'/jid/'stitch'/files[artifact]
    if not path.is_file():raise HTTPException(404,'工作文件尚未生成')
    return FileResponse(path,headers={'Cache-Control':'no-store'})


@app.post("/api/setup/probe")
async def probe(session=Depends(require_user)):
    body = JobInput(prompt="A single small matte black circle centered on a plain white background. Minimal geometric illustration, no text.", max_attempts=1)
    result = await add_jobs(body, session)
    set_setting("probe", result["ids"][0])
    return result


@app.get("/api/jobs")
def list_jobs(status: str = "", collection: str = "", limit: int = 50, offset: int = 0, session=Depends(require_user)):
    clauses, args = [], []
    if status:
        clauses.append("status=?")
        args.append(status)
    if collection:
        clauses.append("collection_id=?")
        args.append(collection)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    return {"items": [serialize_job(j) for j in query("SELECT * FROM jobs" + where + " ORDER BY created DESC LIMIT ? OFFSET ?", (*args, max(1, min(limit, 100)), max(0, offset)))], "total": query("SELECT COUNT(*) AS n FROM jobs" + where, args, True)["n"]}


@app.get("/api/collections")
def collections(search: str = "", deleted: bool = False, limit: int = 50, offset: int = 0, session=Depends(require_user)):
    rows = query("SELECT * FROM collections WHERE deleted=? AND (name LIKE ? OR prompt LIKE ?) ORDER BY updated DESC LIMIT ? OFFSET ?", (int(deleted), f"%{search[:100]}%", f"%{search[:100]}%", max(1, min(limit, 100)), max(0, offset)))
    for group in rows:
        group['template_id'] = group['id'][4:] if group['id'].startswith('tpl-') else ''
        group['kind'] = 'template' if group['template_id'] else 'request'
        jobs = query("SELECT status,outputs FROM jobs WHERE collection_id=? ORDER BY created DESC", (group["id"],))
        image_ids = list(dict.fromkeys(aid for job in jobs for aid in json.loads(job["outputs"]) if query("SELECT id FROM assets WHERE id=? AND deleted=0", (aid,), True)))
        group.update(job_count=len(jobs), image_count=len(image_ids), active=sum(j["status"] in ("running", "queued", "retrying") for j in jobs), failed=sum(j["status"] == "failed" for j in jobs))
        group["covers"] = [serialize_asset(a) for aid in image_ids[:3] if (a := query("SELECT * FROM assets WHERE id=?", (aid,), True))]
    total = query("SELECT COUNT(*) AS n FROM collections WHERE deleted=? AND (name LIKE ? OR prompt LIKE ?)", (int(deleted), f"%{search[:100]}%", f"%{search[:100]}%"), True)["n"]
    return {"items": rows, "total": total}


class CollectionInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@app.delete("/api/collections/{cid}")
def delete_collection(cid: str, session=Depends(require_user)):
    if not write("UPDATE collections SET deleted=1 WHERE id=?", (cid,)):
        raise HTTPException(404, "列表不存在")
    return {"ok": True}


@app.post("/api/collections/{cid}/restore")
def restore_collection(cid: str, session=Depends(require_user)):
    if not write("UPDATE collections SET deleted=0 WHERE id=?", (cid,)):
        raise HTTPException(404, "列表不存在")
    return {"ok": True}


@app.patch("/api/collections/{cid}")
def rename_collection(cid: str, body: CollectionInput, session=Depends(require_user)):
    if not body.name.strip():
        raise HTTPException(400, "列表名称不能为空")
    if not write("UPDATE collections SET name=? WHERE id=?", (body.name.strip(), cid)):
        raise HTTPException(404, "列表不存在")
    return {"ok": True}


@app.get("/api/jobs/{jid}")
def get_job(jid: str, session=Depends(require_user)):
    j = query("SELECT * FROM jobs WHERE id=?", (jid,), True)
    if not j:
        raise HTTPException(404, "任务不存在")
    instruction = ""
    request_file = DATA / "jobs" / j["id"] / "request.json"
    if request_file.is_file():
        with contextlib.suppress(OSError, ValueError):
            instruction = json.loads(request_file.read_text(encoding="utf-8")).get("worker_instruction", "")
    return serialize_job(j) | {"attempts": query("SELECT * FROM attempts WHERE job_id=? ORDER BY number", (jid,)), "call_instruction": instruction}


@app.get("/api/jobs/{jid}/log")
def get_log(jid: str, session=Depends(require_user)):
    if not re.fullmatch("[a-f0-9]{32}", jid):
        raise HTTPException(404)
    path = DATA / "jobs" / jid / "events.jsonl"
    if not path.exists():
        return {"text": "任务尚未开始"}
    with path.open("rb") as f:
        f.seek(max(0, path.stat().st_size - 32000))
        text = f.read().decode(errors="replace")
    # Avoid exposing credentials accidentally echoed by a tool.
    text = re.sub(r"(?:sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)", "[REDACTED]", text)
    return {"text": text}


@app.post("/api/jobs/{jid}/retry")
async def retry_job(jid: str, session=Depends(require_user)):
    j = query("SELECT * FROM jobs WHERE id=?", (jid,), True)
    if not j:
        raise HTTPException(404, "任务不存在")
    if j["status"] not in ("failed", "cancelled"):
        raise HTTPException(409, "只有失败或取消的任务可以重试；再次抽卡请使用重新生成")
    write("UPDATE jobs SET status='queued',attempt=0,error='',started=NULL,finished=NULL,stage='',stage_source='',stage_updated=0,progress_detail='{}' WHERE id=?", (jid,))
    WAKE.set()
    return {"ok": True}


@app.post("/api/jobs/{jid}/cancel")
async def cancel_job(jid: str, session=Depends(require_user)):
    changed = write("UPDATE jobs SET status='cancelled',finished=?,error='已手动取消' WHERE id=? AND status IN ('queued','running','retrying')", (now(), jid))
    if not changed:
        raise HTTPException(409, "任务已经结束")
    if CALL_POOL:CALL_POOL.cancel_owner(jid)
    task=JOB_TASKS.get(jid)
    if task and not task.done():task.cancel()
    await asyncio.gather(*(stop_process(p) for p in job_processes(jid)),return_exceptions=True)
    if task:await asyncio.gather(task,return_exceptions=True)
    return {"ok": True}


async def scheduler():
    running=JOB_TASKS
    try:
        while True:
            for jid,task in list(running.items()):
                if task.done():running.pop(jid,None)
            if CALL_POOL:CALL_POOL.refresh()
            if not setting("paused", False):
                slots = max(0, setting("concurrency", 2) - len(running))
                for j in query("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT ?", (slots,)):
                    if write("UPDATE jobs SET status='running',started=? WHERE id=? AND status='queued'", (now(), j["id"])):
                        running[j["id"]] = spawn(run_job(j["id"]))
            WAKE.clear()
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(WAKE.wait(), 1)
    finally:
        for task in running.values():
            task.cancel()


def job_cancelled(jid):
    row = query("SELECT status FROM jobs WHERE id=?", (jid,), True)
    return not row or row["status"] == "cancelled"


def make_instruction(j, directory):
    opts = json.loads(j["options"])
    template = opts.get("call_prompt", DEFAULT_CALL_PROMPT)
    image_requirements = opts.get("image_requirements", IMAGE_REQUIREMENTS)
    if image_requirements not in template:
        template = image_requirements + "\n" + template
    template = "Progress reporting: Immediately before invoking the image-generation tool, send one separate commentary message containing exactly [STUDIO_STAGE:image_generation]. Only after that tool returns, send one separate commentary message containing exactly [STUDIO_STAGE:receiving]. These are UI stage reports, not tool output or a claim of success. Never send a stage marker before its corresponding transition.\n" + template
    size = opts.get("size", "auto")
    resolution = "automatic native resolution" if size == "auto" else f"{size} pixels on the long edge, preserving the requested aspect ratio; use native generation, never shell resizing or upscaling"
    if "{size}" not in template:
        template = "Requested image size: {size}. If the tool cannot honor this resolution, report the actual native resolution.\n" + template
    values = {"ratio": opts["ratio"], "size": resolution, "transparent": str(opts["transparent"]), "references": ", ".join(f"reference-{i + 1}.png" for i, _ in enumerate(json.loads(j["refs"]))) or "none"}
    for key, value in values.items():
        template = template.replace("{" + key + "}", value)
    return template.replace("{prompt}", j["prompt"])


def find_generated_image(jid, directory):
    """Collect only this exact CLI thread's files, never a global latest-image glob."""
    j = query("SELECT thread_id FROM jobs WHERE id=?", (jid,), True)
    thread_id = j["thread_id"] if j else ""
    if re.fullmatch(r"[A-Za-z0-9_-]{10,100}", thread_id):
        base = (CODEX_HOME / "generated_images").resolve()
        folder = (base / thread_id).resolve()
        if folder.is_relative_to(base) and folder.is_dir():
            candidates = [p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp") and p.resolve().is_relative_to(folder)]
            if candidates:
                return max(candidates, key=lambda p: p.stat().st_mtime_ns)
    # Compatibility with CLI versions that can write a requested workspace output directly.
    output = directory / "output.png"
    return output if output.is_file() and not output.is_symlink() else None


def record_generated_image(jid, source):
    set_job_stage(jid, "receiving")
    result, _ = store_image(source.read_bytes(), f"生成作品-{jid[:8]}.png", "generated", jid)
    write("UPDATE jobs SET status='succeeded',outputs=?,finished=?,error='' WHERE id=? AND status!='cancelled'", (json.dumps([result["id"]]), now(), jid))
    write("UPDATE attempts SET status='succeeded',finished=?,error='' WHERE job_id=? AND number=(SELECT attempt FROM jobs WHERE id=?) AND status IN ('running','failed')", (now(), jid, jid))
    return result


async def run_job(jid):
    j = query("SELECT * FROM jobs WHERE id=?", (jid,), True)
    options = json.loads(j["options"])
    if options.get('stitch'):
        from stitch_workflow import run
        await run(sys.modules[__name__],jid)
        return
    model, effort = options.get("model", MODEL), options.get("effort", EFFORT)
    directory = DATA / "jobs" / jid
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    # A private worker directory prevents project instructions and other jobs' artifacts entering context.
    (directory / "AGENTS.md").write_text("This is an isolated image worker workspace. Follow only the current request. Do not inspect other jobs or account credentials.\n", encoding="utf-8")
    try:
        for attempt in range(1, j["max_attempts"] + 1):
            if job_cancelled(jid):
                return
            output = directory / "output.png"
            output.unlink(missing_ok=True)
            write("UPDATE jobs SET status='running',attempt=?,error='',stage='sending',stage_source='server',stage_updated=? WHERE id=? AND status!='cancelled'", (attempt, now(), jid))
            write("INSERT INTO attempts(job_id,number,status,started) VALUES (?,?,'running',?)", (jid, attempt, now()))
            args = [CODEX_BIN, "exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--sandbox", "workspace-write", "-C", str(directory), "-m", model, "-c", f'model_reasoning_effort="{effort}"', "-c", 'cli_auth_credentials_store="file"', "--enable", "image_generation"]
            for index, aid in enumerate(json.loads(j["refs"])):
                asset = query("SELECT * FROM assets WHERE id=?", (aid,), True)
                if asset:
                    ref = directory / f"reference-{index + 1}.png"
                    shutil.copyfile(asset["path"], ref)
                    args += ["-i", str(ref)]
            args += ["-"]
            instruction = make_instruction(j, directory)
            (directory / "request.json").write_text(json.dumps({"job_id":jid,"kind":"image","model": model, "effort": effort, "prompt": j["prompt"], "refs": json.loads(j["refs"]), "options": options, "worker_instruction": instruction}, ensure_ascii=False, indent=2), encoding="utf-8")
            error = ""
            final_text = ""
            try:
                write("UPDATE jobs SET stage='call_wait',stage_updated=? WHERE id=? AND status='running'", (now(),jid))
                async with cli_slot(jid,"普通生图") as process_key:
                    set_job_stage(jid,"sending")
                    p = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=codex_env(), start_new_session=os.name != "nt", limit=16 * 1024 * 1024)
                    PROCESSES[process_key] = p
                    p.stdin.write(instruction.encode())
                    await p.stdin.drain()
                    p.stdin.close()
                    async def consume():
                        nonlocal final_text, error
                        with (directory / "events.jsonl").open("a", encoding="utf-8") as log:
                            log.write(json.dumps({"studio_attempt": attempt, "time": now()}) + "\n")
                            while line := await p.stdout.readline():
                                text = line.decode(errors="replace")
                                log.write(text)
                                log.flush()
                                try:
                                    event = json.loads(text)
                                    transition = stage_from_event(event)
                                    if transition: set_job_stage(jid, *transition)
                                    if event.get("type") == "thread.started":
                                        write("UPDATE jobs SET thread_id=? WHERE id=?", (event.get("thread_id", ""), jid))
                                    item = event.get("item", {})
                                    if item.get("type") == "agent_message" and not re.fullmatch(r"\[STUDIO_STAGE:[a-z_]+\]",item.get("text", "").strip()):
                                        final_text = item.get("text", "")[-6000:]
                                    if event.get("type") in ("error", "turn.failed"):
                                        error = str(event.get("message") or event.get("error") or text)[-2000:]
                                except (ValueError, AttributeError):
                                    pass
                            await p.wait()
                    await asyncio.wait_for(consume(), timeout=900)
                if job_cancelled(jid):
                    return
                if p.returncode != 0:
                    error = error or final_text or f"Codex 退出，状态码 {p.returncode}，请查看任务日志。"
                generated = find_generated_image(jid, directory)
                if not generated:
                    error = error or final_text or "Codex 没有返回图片。请确认当前 CLI / 账号可使用内置生图工具。"
                if not error:
                    await asyncio.to_thread(record_generated_image, jid, generated)
                    return
            except asyncio.TimeoutError:
                error = "单次生成超过 15 分钟，已终止后台进程。"
            except (OSError, HTTPException, RuntimeError) as exc:
                error = str(getattr(exc, "detail", exc))[-2000:]
            finally:
                if p := PROCESSES.pop(jid, None):
                    await stop_process(p)
            if job_cancelled(jid):
                return
            write("UPDATE attempts SET status='failed',error=?,finished=? WHERE job_id=? AND number=? AND status='running'", (error, now(), jid, attempt))
            # Permanent authentication, capability and policy failures should not consume repeated attempts.
            permanent = bool(re.search(r"not (?:available|supported)|unavailable|no.*image.*tool|unauthorized|authentication|401|403|登录|工具不可用|不支持|not logged|usage limit|quota|moderation|policy", error, re.I))
            if attempt >= j["max_attempts"] or permanent:
                write("UPDATE jobs SET status='failed',error=?,finished=? WHERE id=? AND status!='cancelled'", (error, now(), jid))
                return
            write("UPDATE jobs SET status='retrying',error=? WHERE id=? AND status!='cancelled'", (error, jid))
            for _ in range(min(60, 5 * 2 ** (attempt - 1))):
                if job_cancelled(jid):
                    return
                await asyncio.sleep(1)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        write("UPDATE jobs SET status='failed',error=?,finished=? WHERE id=? AND status!='cancelled'", (f"任务执行异常：{type(exc).__name__}: {exc}"[:2000], now(), jid))
    finally:
        if p := PROCESSES.pop(jid, None):
            await stop_process(p)
        for reference in directory.glob("reference-*.png"):
            reference.unlink(missing_ok=True)
        final = query("SELECT status FROM jobs WHERE id=?", (jid,), True)
        if final and final["status"] == "succeeded":
            (directory / "output.png").unlink(missing_ok=True)
        if job_cancelled(jid):
            write("UPDATE attempts SET status='cancelled',finished=? WHERE job_id=? AND status='running'", (now(), jid))
        WAKE.set()


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.api_route("/sw.js", methods=["GET", "HEAD"])
def service_worker():
    return FileResponse(ROOT / "static" / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


@app.api_route("/downloads/image-studio.apk", methods=["GET", "HEAD"])
def android_download():
    package = ROOT / "downloads" / "image-studio.apk"
    if not package.is_file():
        raise HTTPException(404, "Android 安装包尚未部署")
    return FileResponse(package, media_type="application/vnd.android.package-archive", filename="image-studio.apk", headers={"Cache-Control": "no-cache"})


@app.api_route("/", methods=["GET", "HEAD"])
def index():
    return FileResponse(ROOT / "static" / "index.html", headers={"Cache-Control": "no-cache"})
