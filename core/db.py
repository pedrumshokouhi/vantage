"""Persistence layer: one SQLite file, WAL mode, append-only revision log.

Every user record lives in `records` (kind + JSON body) and every write also
lands in `revisions`, so nothing is ever silently overwritten: the decision
journal's replay, exports and audits all read from that history.
"""
import json
import os
import sqlite3
import threading
import time
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("VANTAGE_DATA", os.path.join(ROOT, "data"))
DB_PATH = os.path.join(DATA_DIR, "vantage.db")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")

SPACES = ("live", "demo")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pw_hash TEXT NOT NULL,
  totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, recovery TEXT DEFAULT '[]',
  created REAL, last_login REAL, last_login_ip TEXT, prev_login REAL, prev_login_ip TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER, created REAL, last_seen REAL,
  expires REAL, ip TEXT, ua TEXT, space TEXT DEFAULT 'live', mfa_pending INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS login_attempts (ts REAL, ip TEXT, username TEXT, ok INTEGER);
CREATE TABLE IF NOT EXISTS audit (ts REAL, event TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS settings (space TEXT, key TEXT, value TEXT, PRIMARY KEY (space, key));
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, space TEXT, kind TEXT, data TEXT, created REAL, updated REAL, deleted INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS records_kind ON records(space, kind, deleted);
CREATE TABLE IF NOT EXISTS revisions (
  rid INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT, ts REAL, action TEXT, data TEXT
);
CREATE INDEX IF NOT EXISTS revisions_rec ON revisions(record_id);
CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, data TEXT, fetched REAL);
CREATE TABLE IF NOT EXISTS sources (
  name TEXT PRIMARY KEY, last_ok REAL, last_try REAL, last_error TEXT, items INTEGER DEFAULT 0, note TEXT
);
CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY, source TEXT, feed TEXT, topic TEXT, title TEXT, link TEXT,
  summary TEXT, published REAL, fetched REAL, cluster TEXT
);
CREATE INDEX IF NOT EXISTS news_pub ON news(published);
CREATE TABLE IF NOT EXISTS seen (space TEXT, key TEXT, ts REAL, PRIMARY KEY (space, key));
CREATE TABLE IF NOT EXISTS snapshots (
  space TEXT, day TEXT, ts REAL, data TEXT, PRIMARY KEY (space, day)
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, space TEXT, key TEXT, kind TEXT, title TEXT, body TEXT,
  relevance REAL, impact REAL, urgency REAL, confidence REAL, score REAL,
  created REAL, updated REAL, status TEXT DEFAULT 'open', feedback TEXT, group_key TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS alerts_key ON alerts(space, key);
"""

_local = threading.local()
_write_lock = threading.RLock()


def init():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    try:
        os.chmod(DATA_DIR, 0o700)
    except OSError:
        pass
    c = conn()
    c.executescript(SCHEMA)
    c.commit()
    try:
        os.chmod(DB_PATH, 0o600)
    except OSError:
        pass


def conn():
    c = getattr(_local, "c", None)
    if c is None:
        c = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.execute("PRAGMA foreign_keys=ON")
        _local.c = c
    return c


def q(sql, args=()):
    return [dict(r) for r in conn().execute(sql, args).fetchall()]


def q1(sql, args=()):
    r = conn().execute(sql, args).fetchone()
    return dict(r) if r else None


def run(sql, args=()):
    with _write_lock:
        c = conn()
        cur = c.execute(sql, args)
        c.commit()
        return cur


def audit(event, detail=""):
    run("INSERT INTO audit VALUES (?,?,?)", (time.time(), event, detail[:500]))


# ---------- settings ----------

def get_setting(space, key, default=None):
    r = q1("SELECT value FROM settings WHERE space=? AND key=?", (space, key))
    if not r:
        return default
    try:
        return json.loads(r["value"])
    except ValueError:
        return default


def set_setting(space, key, value):
    run("INSERT OR REPLACE INTO settings VALUES (?,?,?)", (space, key, json.dumps(value)))


def all_settings(space):
    out = {}
    for r in q("SELECT key, value FROM settings WHERE space=?", (space,)):
        try:
            out[r["key"]] = json.loads(r["value"])
        except ValueError:
            pass
    return out


# ---------- records ----------

def _row(r):
    d = json.loads(r["data"])
    d["id"] = r["id"]
    d["_kind"] = r["kind"]
    d["_created"] = r["created"]
    d["_updated"] = r["updated"]
    return d


def list_records(space, kind):
    return [_row(r) for r in q(
        "SELECT * FROM records WHERE space=? AND kind=? AND deleted=0 ORDER BY created", (space, kind))]


def get_record(space, rid):
    r = q1("SELECT * FROM records WHERE space=? AND id=? AND deleted=0", (space, rid))
    return _row(r) if r else None


def _clean(data):
    return {k: v for k, v in data.items() if not k.startswith("_") and k != "id"}


def create_record(space, kind, data, rid=None, ts=None):
    rid = rid or (kind[:3] + "_" + uuid.uuid4().hex[:10])
    now = ts or time.time()
    body = json.dumps(_clean(data))
    with _write_lock:
        c = conn()
        c.execute("INSERT INTO records VALUES (?,?,?,?,?,?,0)", (rid, space, kind, body, now, now))
        c.execute("INSERT INTO revisions (record_id, ts, action, data) VALUES (?,?,?,?)", (rid, now, "create", body))
        c.commit()
    return get_record(space, rid)


def update_record(space, rid, data, merge=True):
    cur = get_record(space, rid)
    if not cur:
        return None
    new = _clean(cur) if merge else {}
    new.update(_clean(data))
    body = json.dumps(new)
    now = time.time()
    with _write_lock:
        c = conn()
        c.execute("UPDATE records SET data=?, updated=? WHERE id=? AND space=?", (body, now, rid, space))
        c.execute("INSERT INTO revisions (record_id, ts, action, data) VALUES (?,?,?,?)", (rid, now, "update", body))
        c.commit()
    return get_record(space, rid)


def delete_record(space, rid):
    now = time.time()
    with _write_lock:
        c = conn()
        c.execute("UPDATE records SET deleted=1, updated=? WHERE id=? AND space=?", (now, rid, space))
        c.execute("INSERT INTO revisions (record_id, ts, action, data) VALUES (?,?,?,?)", (rid, now, "delete", "{}"))
        c.commit()


def revisions(rid):
    out = []
    for r in q("SELECT * FROM revisions WHERE record_id=? ORDER BY rid", (rid,)):
        out.append({"ts": r["ts"], "action": r["action"], "data": json.loads(r["data"] or "{}")})
    return out


def wipe_space(space):
    with _write_lock:
        c = conn()
        ids = [r[0] for r in c.execute("SELECT id FROM records WHERE space=?", (space,))]
        for i in ids:
            c.execute("DELETE FROM revisions WHERE record_id=?", (i,))
        for t in ("records", "settings", "seen", "snapshots", "alerts"):
            c.execute("DELETE FROM %s WHERE space=?" % t, (space,))
        c.commit()


# ---------- cache + source status ----------

def cache_get(key, max_age=None):
    r = q1("SELECT * FROM cache WHERE key=?", (key,))
    if not r:
        return None, None
    if max_age is not None and time.time() - r["fetched"] > max_age:
        return json.loads(r["data"]), r["fetched"]  # stale value still returned; caller decides
    return json.loads(r["data"]), r["fetched"]


def cache_put(key, data):
    run("INSERT OR REPLACE INTO cache VALUES (?,?,?)", (key, json.dumps(data), time.time()))


def source_ok(name, items=0, note=None):
    now = time.time()
    run("INSERT INTO sources (name, last_ok, last_try, last_error, items, note) VALUES (?,?,?,?,?,?) "
        "ON CONFLICT(name) DO UPDATE SET last_ok=?, last_try=?, last_error=NULL, items=?, note=COALESCE(?, note)",
        (name, now, now, None, items, note, now, now, items, note))


def source_err(name, err):
    now = time.time()
    run("INSERT INTO sources (name, last_try, last_error) VALUES (?,?,?) "
        "ON CONFLICT(name) DO UPDATE SET last_try=?, last_error=?", (name, now, str(err)[:300], now, str(err)[:300]))


def sources():
    return {r["name"]: r for r in q("SELECT * FROM sources")}


# ---------- backups ----------

def backup(label="auto"):
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = os.path.join(BACKUP_DIR, "vantage-%s-%s.db" % (stamp, label))
    with _write_lock:
        dst = sqlite3.connect(path)
        conn().backup(dst)
        dst.close()
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    files = sorted(f for f in os.listdir(BACKUP_DIR) if f.endswith(".db"))
    for old in files[:-20]:
        os.remove(os.path.join(BACKUP_DIR, old))
    return path


def list_backups():
    out = []
    for f in sorted(os.listdir(BACKUP_DIR), reverse=True):
        if f.endswith(".db"):
            p = os.path.join(BACKUP_DIR, f)
            out.append({"file": f, "size": os.path.getsize(p), "ts": os.path.getmtime(p)})
    return out
