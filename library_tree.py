"""User-owned folders. A job's recipe and an artwork's location have separate lifetimes."""
import json
import time
import uuid
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

INBOX = "untemplated"
ANCESTORS = """WITH RECURSIVE path(id,parent_id,name,template_id,deleted,depth) AS (
    SELECT id,parent_id,name,template_id,deleted,0 FROM folders WHERE id=?
    UNION ALL SELECT f.id,f.parent_id,f.name,f.template_id,f.deleted,p.depth+1
    FROM folders f JOIN path p ON f.id=p.parent_id)"""


def initialize(c):
    c.execute("""CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES folders(id),
        name TEXT NOT NULL,template_id TEXT UNIQUE,created REAL NOT NULL,deleted INTEGER NOT NULL DEFAULT 0)""")
    c.execute("CREATE INDEX IF NOT EXISTS folders_parent ON folders(parent_id,deleted,created DESC,id)")
    c.execute("""CREATE TABLE IF NOT EXISTS library_operations(id TEXT PRIMARY KEY,request TEXT NOT NULL,
        result TEXT NOT NULL,undo TEXT,created REAL NOT NULL)""")
    c.execute("CREATE TABLE IF NOT EXISTS generation_receipts(id TEXT PRIMARY KEY,request TEXT NOT NULL,result TEXT NOT NULL)")
    columns = {r[1] for r in c.execute("PRAGMA table_info(assets)")}
    if "folder_id" not in columns:
        c.execute("ALTER TABLE assets ADD COLUMN folder_id TEXT")
        c.execute("ALTER TABLE assets ADD COLUMN origin_template_id TEXT NOT NULL DEFAULT ''")
    c.execute("CREATE INDEX IF NOT EXISTS artwork_folder ON assets(folder_id,deleted,created DESC,id)")
    c.execute("CREATE INDEX IF NOT EXISTS artwork_origin ON assets(origin_template_id,deleted,created DESC,id)")
    if not c.execute("SELECT 1 FROM settings WHERE key='library_migrated'").fetchone():
        c.execute("""INSERT INTO folders(id,name,template_id,created,deleted)
            SELECT g.id,CASE WHEN g.id='untemplated' AND g.name='无模板' THEN '待整理' ELSE g.name END,
            t.id,g.created,g.deleted FROM collections g LEFT JOIN templates t ON g.id='tpl-'||t.id
            WHERE g.id!='system-probe'""")
        c.execute("""INSERT OR IGNORE INTO folders(id,name,template_id,created)
            SELECT 'tpl-'||id,title,id,created FROM templates""")
        c.execute("INSERT OR IGNORE INTO folders(id,name,created) VALUES (?,'待整理',0)", (INBOX,))
        # Historic outputs can refer to an already-uploaded asset with no job_id.
        c.execute("""WITH outputs AS (SELECT j.id,j.created,o.value AS aid FROM jobs j,json_each(j.outputs) o
            WHERE j.collection_id!='system-probe') UPDATE assets SET job_id=(SELECT id FROM outputs
            WHERE aid=assets.id ORDER BY created,id LIMIT 1) WHERE job_id IS NULL AND id IN (SELECT aid FROM outputs)""")
        c.execute("""UPDATE assets SET folder_id=COALESCE((SELECT f.id FROM jobs j JOIN folders f
            ON f.id=j.collection_id WHERE j.id=assets.job_id),'untemplated'),
            origin_template_id=COALESCE((SELECT template_id FROM jobs WHERE id=assets.job_id),'')
            WHERE (kind='generated' OR job_id IS NOT NULL) AND NOT EXISTS
            (SELECT 1 FROM jobs WHERE id=assets.job_id AND collection_id='system-probe')""")
        c.execute("INSERT INTO settings VALUES ('library_migrated','true')")
    c.execute("""CREATE TRIGGER IF NOT EXISTS folder_new_template AFTER INSERT ON templates
        WHEN NOT EXISTS(SELECT 1 FROM folders WHERE template_id=NEW.id)
        BEGIN INSERT INTO folders(id,name,template_id,created) VALUES ('tpl-'||NEW.id,NEW.title,NEW.id,NEW.created)
        ON CONFLICT(id) DO UPDATE SET template_id=NEW.id; END""")
    c.execute("""CREATE TRIGGER IF NOT EXISTS folder_rename_template AFTER UPDATE OF title ON templates
        BEGIN UPDATE folders SET name=NEW.title WHERE template_id=NEW.id AND name=OLD.title; END""")
    c.execute("""CREATE TRIGGER IF NOT EXISTS folder_remove_template AFTER DELETE ON templates
        BEGIN UPDATE folders SET template_id=NULL WHERE template_id=OLD.id; END""")
    c.execute("""CREATE TRIGGER IF NOT EXISTS folder_collection_visibility AFTER UPDATE OF deleted ON collections
        WHEN OLD.deleted!=NEW.deleted BEGIN UPDATE folders SET deleted=NEW.deleted WHERE id=NEW.id; END""")
    c.execute("""CREATE TRIGGER IF NOT EXISTS folder_collection_name AFTER UPDATE OF name ON collections
        BEGIN UPDATE folders SET name=NEW.name WHERE id=NEW.id; END""")
    c.execute("""CREATE TRIGGER IF NOT EXISTS folder_new_asset AFTER INSERT ON assets
        WHEN NEW.folder_id IS NULL AND NEW.kind='generated' AND NOT EXISTS
        (SELECT 1 FROM jobs WHERE id=NEW.job_id AND collection_id='system-probe')
        BEGIN UPDATE assets SET folder_id=COALESCE((SELECT f.id FROM jobs j JOIN folders f ON
        f.id=json_extract(j.options,'$.folder_id') AND f.deleted=0 WHERE j.id=NEW.job_id),
        (SELECT f.id FROM jobs j JOIN folders f ON f.template_id=j.template_id AND f.deleted=0 WHERE j.id=NEW.job_id),
        'untemplated'),origin_template_id=COALESCE((SELECT template_id FROM jobs WHERE id=NEW.job_id),'')
        WHERE id=NEW.id; END""")
    c.execute("""CREATE TRIGGER IF NOT EXISTS folder_existing_output AFTER UPDATE OF outputs ON jobs
        WHEN NEW.collection_id!='system-probe' AND NEW.outputs!='[]' BEGIN UPDATE assets SET
        folder_id=COALESCE((SELECT id FROM folders WHERE id=json_extract(NEW.options,'$.folder_id') AND deleted=0),
        (SELECT id FROM folders WHERE template_id=NEW.template_id AND deleted=0),'untemplated'),
        origin_template_id=COALESCE(NEW.template_id,''),job_id=COALESCE(job_id,NEW.id)
        WHERE folder_id IS NULL AND id IN (SELECT value FROM json_each(NEW.outputs)); END""")


def path_to(c, fid):
    if not fid:
        return []
    rows = [dict(r) for r in c.execute(ANCESTORS + " SELECT * FROM path ORDER BY depth DESC", (fid,))]
    if not rows or any(r["deleted"] for r in rows):
        raise HTTPException(404, "文件夹已删除或不存在，请重新选择位置")
    return rows


def scope(path):
    return next((f for f in reversed(path) if f["template_id"]), None)


def same_scope(c, sources, target):
    target_scope = scope(target)
    for fid in set(sources):
        origin = scope(path_to(c, fid))
        if origin and (not target_scope or target_scope["id"] != origin["id"]):
            raise HTTPException(409, f"请先移出模板「{origin['name']}」")


def generation_folder(c, explicit, template):
    if explicit:
        return path_to(c, explicit)[-1]["id"]
    if template:
        row = c.execute("SELECT id FROM folders WHERE template_id=?", (template,)).fetchone()
        if row:
            return path_to(c, row["id"])[-1]["id"]
    return INBOX


def children(c, parent, offset, limit, search=""):
    args = (parent,) if not search else (f"%{search[:100]}%",)
    predicate = "deleted=0 AND parent_id IS ?" if not search else "deleted=0 AND name LIKE ?"
    if search:
        predicate += """ AND id IN (WITH RECURSIVE live(id) AS (SELECT id FROM folders
            WHERE parent_id IS NULL AND deleted=0 UNION ALL SELECT f.id FROM folders f
            JOIN live l ON l.id=f.parent_id WHERE f.deleted=0) SELECT id FROM live)"""
    total = c.execute("SELECT COUNT(*) FROM folders WHERE " + predicate, args).fetchone()[0]
    items = [dict(r) for r in c.execute("SELECT * FROM folders WHERE " + predicate +
        " ORDER BY created DESC,id LIMIT ? OFFSET ?", (*args, limit, offset))]
    if not items:
        return items, total
    tree = """WITH RECURSIVE tree(root,id) AS (
        SELECT value,value FROM json_each(?) UNION ALL SELECT tree.root,f.id FROM folders f
        JOIN tree ON f.parent_id=tree.id WHERE f.deleted=0) """
    keys = (json.dumps([r["id"] for r in items]),)
    counts = {r[0]: r[1] for r in c.execute(tree + """SELECT tree.root,COUNT(a.id)
        FROM tree JOIN assets a ON a.folder_id=tree.id AND a.deleted=0 GROUP BY tree.root""", keys)}
    covers = {}
    for r in c.execute(tree + """, ranked AS (SELECT tree.root,a.id,ROW_NUMBER() OVER
        (PARTITION BY tree.root ORDER BY a.created DESC,a.id) AS rank FROM tree JOIN assets a
        ON a.folder_id=tree.id AND a.deleted=0) SELECT root,id FROM ranked WHERE rank<=3 ORDER BY root,rank""", keys):
        covers.setdefault(r[0], []).append(r[1])
    for row in items:
        row["image_count"] = counts.get(row["id"], 0)
        row["covers"] = covers.get(row["id"], [])
        if search:
            row["path"] = path_to(c, row["id"])
    return items, total


class Operation(BaseModel):
    operation_id: str = Field(min_length=8, max_length=100)
    action: Literal["create", "move", "relocate", "detach", "dissolve", "rename", "recipe", "unrecipe", "undo"]
    folder: str | None = None
    target: str | None = None
    name: str = Field(default="", max_length=100)
    assets: list[str] = Field(default_factory=list, max_length=5000)
    expected: dict[str, str] = Field(default_factory=dict)
    original: str = ""
    text: str = Field(default="", max_length=24000)
    refs: list[str] = Field(default_factory=list, max_length=8)
    options: dict = Field(default_factory=dict)


def positions(c, ids):
    ids = list(dict.fromkeys(ids))
    result = dict(c.execute("""SELECT id,folder_id FROM assets WHERE deleted=0 AND folder_id IS NOT NULL
        AND id IN (SELECT value FROM json_each(?))""", (json.dumps(ids),)))
    if len(result) != len(ids):
        raise HTTPException(409, "有作品已删除或不在作品库，请重新选择")
    return result


def move_assets(c, ids, target):
    c.execute("UPDATE assets SET folder_id=? WHERE id IN (SELECT value FROM json_each(?))", (target, json.dumps(list(ids))))


def undo_move(c, original):
    record = c.execute("SELECT undo FROM library_operations WHERE id=?", (original,)).fetchone()
    if not record or not record[0]:
        raise HTTPException(409, "这次操作已撤销或无法撤销")
    info = json.loads(record[0])
    target = info["target"]
    path_to(c, target)
    previous = info["positions"]
    if any(fid != target for fid in positions(c, previous).values()):
        raise HTTPException(409, "有作品已再次移动，请在当前位置整理")
    for fid in set(previous.values()):
        path_to(c, fid)
    if info["created"]:
        count = c.execute("SELECT COUNT(*) FROM assets WHERE folder_id=?", (target,)).fetchone()[0]
        changed = c.execute("""SELECT 1 FROM folders WHERE parent_id=? OR
            (id=? AND (template_id IS NOT NULL OR parent_id IS NOT ? OR name!=?))""",
            (target, target, info["parent"], info["name"])).fetchone()
        if count != len(previous) or changed:
            raise HTTPException(409, "新文件夹已被修改，请保留其当前内容")
    c.executemany("UPDATE assets SET folder_id=? WHERE id=?", ((fid, aid) for aid, fid in previous.items()))
    if info["created"]:
        c.execute("DELETE FROM folders WHERE id=?", (target,))
    c.execute("UPDATE library_operations SET undo=NULL WHERE id=?", (original,))


def mutate(c, op):
    now = time.time()
    name = op.name.strip()
    target = op.target or None
    if op.action in ("create", "rename") and not name:
        raise HTTPException(400, "请输入文件夹名称")
    if op.action == "undo":
        undo_move(c, op.original)
        return {"ok": True}, None
    if op.action in ("create", "move"):
        parent = target
        dest = path_to(c, target)
        previous = positions(c, op.assets)
        if any(previous.get(aid) != fid for aid, fid in op.expected.items()):
            raise HTTPException(409, "有作品的位置已变化，请刷新后再试")
        same_scope(c, previous.values(), dest)
        if op.action == "create":
            target = uuid.uuid4().hex
            c.execute("INSERT INTO folders(id,parent_id,name,created) VALUES (?,?,?,?)", (target, parent, name, now))
        elif not target or not previous:
            raise HTTPException(400, "请选择作品和目标文件夹")
        move_assets(c, previous, target)
        return {"folder": target, "count": len(previous)}, {"target": target, "positions": previous,
            "created": op.action == "create", "parent": parent, "name": name}
    trail = path_to(c, op.folder)
    if not trail or op.folder == INBOX:
        raise HTTPException(409, "系统目录不支持此操作")
    folder = trail[-1]
    if op.action in ("relocate", "detach"):
        dest = path_to(c, target)
        if any(f["id"] == op.folder for f in dest):
            raise HTTPException(409, "不能移动到自身或子文件夹")
        if op.action == "detach":
            owner = scope(trail[:-1])
            if not owner or target != owner["parent_id"]:
                raise HTTPException(409, "移出目标已变化，请重新确认上级位置")
        else:
            same_scope(c, [folder["parent_id"]], dest)
        c.execute("UPDATE folders SET parent_id=? WHERE id=?", (target, op.folder))
    elif op.action == "rename":
        c.execute("UPDATE folders SET name=? WHERE id=?", (name, op.folder))
    elif op.action == "dissolve":
        if folder["template_id"]:
            raise HTTPException(409, "先将模板转回普通文件夹")
        c.execute("UPDATE assets SET folder_id=? WHERE folder_id=?", (folder["parent_id"] or INBOX, op.folder))
        c.execute("UPDATE folders SET parent_id=? WHERE parent_id=?", (folder["parent_id"], op.folder))
        c.execute("DELETE FROM folders WHERE id=?", (op.folder,))
    elif op.action == "unrecipe":
        c.execute("DELETE FROM templates WHERE id=?", (folder["template_id"],))
    elif op.action == "recipe":
        refs = list(dict.fromkeys(op.refs))
        if not op.text.strip() and not refs:
            raise HTTPException(400, "模板至少需要正文或一张参考图")
        if c.execute("SELECT COUNT(*) FROM assets WHERE id IN (SELECT value FROM json_each(?))",
                     (json.dumps(refs),)).fetchone()[0] != len(refs):
            raise HTTPException(400, "模板参考图不存在")
        pid = folder["template_id"] or uuid.uuid4().hex
        c.execute("UPDATE folders SET template_id=? WHERE id=?", (pid, op.folder))
        options = {k:v for k,v in op.options.items() if k in ("ratio","transparent","model","effort","polish","size","stitch")}
        c.execute("""INSERT INTO templates(id,title,text,refs,options,created,updated) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET text=excluded.text,refs=excluded.refs,options=excluded.options,
            updated=excluded.updated""", (pid,folder["name"],op.text.strip(),json.dumps(refs),json.dumps(options),now,now))
        return {"folder": op.folder, "template_id": pid}, None
    return {"folder": op.folder, "parent": folder["parent_id"]}, None


def register(app, studio):
    @app.get("/api/library/origins")
    def origins(session=Depends(studio.require_user)):
        return studio.query("""SELECT id,MAX(title) AS title FROM (
            SELECT id,title FROM templates UNION ALL SELECT a.origin_template_id AS id,
            COALESCE(MAX(json_extract(j.options,'$.template_title')),a.origin_template_id) AS title
            FROM assets a LEFT JOIN jobs j ON j.id=a.job_id WHERE a.origin_template_id!=''
            AND a.deleted=0 GROUP BY a.origin_template_id) GROUP BY id ORDER BY title,id""")

    @app.get("/api/library")
    def browse(folder: str = "", view: Literal["folder","all","origin","inbox"] = "folder", origin: str = "",
               part: Literal["both","folders","assets"] = "both", search: str = "", folder_offset: int = 0,
               asset_offset: int = 0, limit: int = 30, session=Depends(studio.require_user)):
        size = max(1, min(limit, 80))
        with studio.db() as c:
            c.execute("BEGIN")
            trail = path_to(c, folder) if view == "folder" else []
            result = {"path": trail}
            if part != "assets":
                result["folders"], result["folder_total"] = children(c, folder or None, max(0, folder_offset), size, search)
            if part != "folders":
                where = ["a.deleted=0", "a.folder_id IS NOT NULL"]
                args = []
                if view in ("folder","inbox"):
                    where.append("a.folder_id=?")
                    args.append(folder if view == "folder" else INBOX)
                else:
                    where.append("""a.folder_id IN (WITH RECURSIVE live(id) AS (SELECT id FROM folders
                        WHERE parent_id IS NULL AND deleted=0 UNION ALL SELECT f.id FROM folders f
                        JOIN live l ON l.id=f.parent_id WHERE f.deleted=0) SELECT id FROM live)""")
                if view == "origin":
                    where.append("a.origin_template_id=?")
                    args.append(origin)
                cond = " FROM assets a WHERE " + " AND ".join(where)
                result["asset_total"] = c.execute("SELECT COUNT(*)" + cond, args).fetchone()[0]
                rows = c.execute("""SELECT a.*,(SELECT options FROM jobs j WHERE j.id=a.job_id) AS job_options"""
                    + cond + " ORDER BY a.created DESC,a.id LIMIT ? OFFSET ?", (*args,size,max(0,asset_offset)))
                result["assets"] = [studio.serialize_asset(dict(row)) for row in rows]
            return result

    @app.get("/api/library/operations/{oid}")
    def receipt(oid: str, session=Depends(studio.require_user)):
        row = studio.query("SELECT result FROM library_operations WHERE id=?", (oid,), True)
        if not row:
            raise HTTPException(404, "尚无这次操作的回执")
        return json.loads(row["result"])

    @app.post("/api/library/operations")
    def change(op: Operation, session=Depends(studio.require_user)):
        payload = json.dumps(op.model_dump(), sort_keys=True)
        with studio.db() as c:
            c.execute("BEGIN IMMEDIATE")
            old = c.execute("SELECT request,result FROM library_operations WHERE id=?", (op.operation_id,)).fetchone()
            if old:
                if old["request"] != payload:
                    raise HTTPException(409, "操作编号已用于另一项更改")
                return json.loads(old["result"])
            result, undo = mutate(c, op)
            result.update(operation_id=op.operation_id, can_undo=bool(undo))
            c.execute("INSERT INTO library_operations VALUES (?,?,?,?,?)",
                (op.operation_id,payload,json.dumps(result),json.dumps(undo) if undo else None,time.time()))
            return result
