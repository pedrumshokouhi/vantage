#!/usr/bin/env python3
"""Local test harness for the Cloudflare build (no Node/wrangler needed).

The real Worker (worker/worker.js) runs *inside the browser page*, loaded as an ES module by
dev/harness.js. This server only provides what the browser can't:
  /__sql     executes D1-style statements against a local SQLite file (same schema as D1)
  /__fetch   forwards the Worker's upstream requests (browsers can't bypass CORS)
  /__worker/ serves the Worker source; everything else serves public/ (with the harness injected)

    python3 dev/devserver.py [--port 8811] [--seed] [--reset]
"""
import argparse
import gzip
import hashlib
import json
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
WORKER = os.path.join(ROOT, "worker")
DATA = os.environ.get("VANTAGE_DEV_DATA", os.path.join(ROOT, ".devdata"))
DB = os.path.join(DATA, "dev.db")
DEV_SETUP_CODE = "DEV-SETUP-CODE"
LOCK = threading.Lock()
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".sql": "text/plain"}


def conn():
    c = sqlite3.connect(DB, timeout=30, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c


MIGRATIONS = ["ALTER TABLE series ADD COLUMN tried REAL"]  # keep in sync with deploy.py


def init(seed, reset):
    os.makedirs(DATA, exist_ok=True)
    if reset and os.path.exists(DB):
        os.remove(DB)
    c = conn()
    c.executescript(open(os.path.join(WORKER, "schema.sql")).read())
    for m in MIGRATIONS:
        try:
            c.execute(m)
        except sqlite3.OperationalError:
            pass  # already applied
    if not c.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        h = hashlib.sha256(DEV_SETUP_CODE.encode()).hexdigest()
        c.execute("INSERT OR REPLACE INTO kv VALUES ('setup_code_hash', ?, ?)", (json.dumps(h), time.time()))
    if seed:
        sql = os.path.join(ROOT, "private", "seed_live.sql")
        if os.path.exists(sql):
            c.executescript(open(sql).read())
            print("  seeded LIVE workspace from private/seed_live.sql")
    c.commit()
    c.close()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def route(self, method):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/__sql" and method == "POST":
            return self.sql()
        if u.path == "/__fetch":
            return self.forward(method, urllib.parse.parse_qs(u.query).get("u", [""])[0])
        if u.path.startswith("/__worker/"):
            return self.static(WORKER, u.path[len("/__worker/"):])
        if u.path == "/__harness.js":
            return self.static(os.path.join(ROOT, "dev"), "harness.js")
        path = u.path
        if path in ("/", "") or (not os.path.splitext(path)[1] and not path.startswith("/api/")):
            path = "/login.html" if path == "/login" else "/index.html"
        return self.static(PUBLIC, path.lstrip("/"), inject=path.endswith(".html"))

    def static(self, base, rel, inject=False):
        full = os.path.realpath(os.path.join(base, rel))
        if not full.startswith(os.path.realpath(base)) or not os.path.isfile(full):
            return self.send(404, "not found", "text/plain")
        data = open(full, "rb").read()
        if inject:
            data = data.replace(b"<head>", b'<head><script src="/__harness.js"></script>', 1)
        self.send(200, data, MIME.get(os.path.splitext(full)[1], "application/octet-stream"))

    def sql(self):
        req = json.loads(self.body() or b"{}")
        out = []
        with LOCK:
            c = conn()
            try:
                c.execute("BEGIN")
                for st in req.get("stmts", []):
                    params = [int(p) if isinstance(p, bool) else p for p in st.get("params", [])]
                    cur = c.execute(st["sql"], params)
                    rows = [dict(r) for r in cur.fetchall()] if cur.description else []
                    out.append({"results": rows, "success": True, "meta": {"changes": c.total_changes, "last_row_id": cur.lastrowid}})
                c.commit()
            except Exception as e:  # noqa: BLE001
                c.rollback()
                c.close()
                return self.send(400, {"error": "%s: %s" % (type(e).__name__, e)})
            c.close()
        self.send(200, out)

    def forward(self, method, url):
        if not url.startswith("https://"):
            return self.send(400, {"error": "https only"})
        fwd = json.loads(self.headers.get("X-Fwd") or "{}")
        headers = {k: v for k, v in fwd.items() if k.lower() in ("user-agent", "accept", "content-type")}
        headers.setdefault("User-Agent", "Mozilla/5.0 Vantage/2-dev")
        headers["Accept-Encoding"] = "gzip"
        data = self.body() if method == "POST" else None
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=40)
            raw, status, ctype = r.read(), r.status, r.headers.get("Content-Type", "application/octet-stream")
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
        except urllib.error.HTTPError as e:
            raw, status, ctype = e.read(), e.code, e.headers.get("Content-Type", "text/plain")
            if e.headers.get("Content-Encoding") == "gzip":
                try:
                    raw = gzip.decompress(raw)
                except OSError:
                    pass
        except Exception as e:  # noqa: BLE001
            return self.send(502, {"error": str(e)})
        self.send(status, raw, ctype)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8811)
    ap.add_argument("--seed", action="store_true", help="load private/seed_live.sql into LIVE")
    ap.add_argument("--reset", action="store_true", help="start from an empty database")
    a = ap.parse_args()
    init(a.seed, a.reset)
    print("\n  Vantage cloud · local harness on http://localhost:%d  (setup code: %s)\n" % (a.port, DEV_SETUP_CODE), flush=True)
    s = ThreadingHTTPServer(("127.0.0.1", a.port), H)
    s.daemon_threads = True
    s.serve_forever()


if __name__ == "__main__":
    main()
