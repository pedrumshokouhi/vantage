#!/usr/bin/env python3
"""Deploy Vantage to Cloudflare (Workers + static assets + D1 + Cron) using only the REST API.

    python3 deploy.py                       # production: vantage.pedrumshokouhi.com
    python3 deploy.py --seed                # also load private/seed_live.sql into the LIVE workspace (first deploy)
    python3 deploy.py --status              # show engine job health from D1 (no deploy)

Reads the API token from ~/.config/vantage/cf-token (never printed). Token permissions needed:
Account · Workers Scripts · Edit, Account · D1 · Edit, Zone · Workers Routes · Edit, Zone · DNS · Edit, Zone · Zone · Read.
"""
import argparse
import base64
import hashlib
import json
import mimetypes
import os
import pathlib
import secrets
import sys
import time
import urllib.error
import urllib.request

ACCT = "8c85545c53fd88976f069e1fb5a079a7"
ZONE_NAME = "pedrumshokouhi.com"
ROOT = pathlib.Path(__file__).resolve().parent
API = "https://api.cloudflare.com/client/v4"
TOKEN_FILE = pathlib.Path.home() / ".config" / "vantage" / "cf-token"
BOUND = "----vantageboundary7c1f"


def token():
    if not TOKEN_FILE.exists():
        sys.exit("No token at %s. Create one in the Cloudflare dashboard and save it there (see README)." % TOKEN_FILE)
    return TOKEN_FILE.read_text().strip()


def req(method, path, data=None, headers=None, raw=False, auth=None, soft=False):
    h = {"Authorization": "Bearer " + (auth or token())}
    h.update(headers or {})
    if isinstance(data, (dict, list)):
        data = json.dumps(data).encode()
        h.setdefault("Content-Type", "application/json")
    r = urllib.request.Request(API + path if path.startswith("/") else path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            body = resp.read()
            return body if raw else json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if soft:
            try:
                return json.loads(body)
            except ValueError:
                return {"success": False, "errors": [body[:300]]}
        raise SystemExit("HTTP %s on %s %s\n%s" % (e.code, method, path.split("?")[0], body[:1500]))


def d1(db, sql, params=None):
    res = req("POST", f"/accounts/{ACCT}/d1/database/{db}/query", {"sql": sql, "params": params or []})
    if not res.get("success"):
        raise SystemExit("D1 error: %s" % res.get("errors"))
    return res["result"]


MIGRATIONS = ["ALTER TABLE series ADD COLUMN tried REAL"]  # keep in sync with dev/devserver.py


def ensure_db(name):
    res = req("GET", f"/accounts/{ACCT}/d1/database?name={name}")
    for db in res.get("result") or []:
        if db["name"] == name:
            return db["uuid"]
    res = req("POST", f"/accounts/{ACCT}/d1/database", {"name": name})
    print("created D1 database", name)
    return res["result"]["uuid"]


def chunks_of_sql(text, limit=90000):
    stmts = [s.strip() for s in text.split(";\n") if s.strip()]
    buf, size = [], 0
    for s in stmts:
        s = s.rstrip(";") + ";"
        if buf and size + len(s) > limit:
            yield "\n".join(buf)
            buf, size = [], 0
        buf.append(s)
        size += len(s)
    if buf:
        yield "\n".join(buf)


def upload_assets(script):
    pub = ROOT / "public"
    files = {}
    for p in sorted(pub.rglob("*")):
        if p.is_file() and not p.name.startswith("."):
            rel = "/" + str(p.relative_to(pub))
            data = p.read_bytes()
            files[rel] = {"hash": hashlib.sha256(data).hexdigest()[:32], "size": len(data), "_data": data}
    manifest = {k: {"hash": v["hash"], "size": v["size"]} for k, v in files.items()}
    res = req("POST", f"/accounts/{ACCT}/workers/scripts/{script}/assets-upload-session", {"manifest": manifest})
    jwt, buckets = res["result"]["jwt"], res["result"].get("buckets") or []
    completion = jwt if not buckets else None
    by_hash = {v["hash"]: (k, v["_data"]) for k, v in files.items()}
    for bucket in buckets:
        parts = []
        for h in bucket:
            path, data = by_hash[h]
            ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
            parts.append(f"--{BOUND}\r\nContent-Disposition: form-data; name=\"{h}\"; filename=\"{h}\"\r\nContent-Type: {ctype}\r\n\r\n{base64.b64encode(data).decode()}\r\n")
        body = ("".join(parts) + f"--{BOUND}--\r\n").encode()
        r = req("POST", f"/accounts/{ACCT}/workers/assets/upload?base64=true", body, {"Content-Type": f"multipart/form-data; boundary={BOUND}"}, auth=jwt)
        if r.get("result") and r["result"].get("jwt"):
            completion = r["result"]["jwt"]
    print("assets: %d files (%d uploaded)" % (len(files), sum(len(b) for b in buckets)))
    return completion


def put_worker(script, db_id, assets_jwt):
    modules = sorted(p.relative_to(ROOT / "worker").as_posix() for p in (ROOT / "worker").rglob("*.js"))
    metadata = {
        "main_module": "worker.js", "compatibility_date": "2026-09-01",
        "bindings": [{"name": "ASSETS", "type": "assets"}, {"name": "DB", "type": "d1", "id": db_id}],
        "assets": {"jwt": assets_jwt, "config": {"run_worker_first": True, "html_handling": "none", "not_found_handling": "none"}},
        "observability": {"enabled": True},
    }
    parts = [f"--{BOUND}\r\nContent-Disposition: form-data; name=\"metadata\"; filename=\"metadata.json\"\r\nContent-Type: application/json\r\n\r\n{json.dumps(metadata)}\r\n"]
    for m in modules:
        src = (ROOT / "worker" / m).read_text()
        parts.append(f"--{BOUND}\r\nContent-Disposition: form-data; name=\"{m}\"; filename=\"{m}\"\r\nContent-Type: application/javascript+module\r\n\r\n{src}\r\n")
    body = ("".join(parts) + f"--{BOUND}--\r\n").encode()
    res = req("PUT", f"/accounts/{ACCT}/workers/scripts/{script}", body, {"Content-Type": f"multipart/form-data; boundary={BOUND}"})
    print("worker uploaded:", res["result"].get("id"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="vantage")
    ap.add_argument("--domain", default="vantage.pedrumshokouhi.com")
    ap.add_argument("--seed", action="store_true")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--workers-dev", action="store_true", help="also enable the *.workers.dev address")
    a = ap.parse_args()
    db = ensure_db(a.name)
    if a.status:
        for r in d1(db, "SELECT name, last_run, last_ok, last_error, runs, note FROM jobs ORDER BY name")[0]["results"]:
            print("%-22s runs=%-4s ok=%s err=%s  %s" % (r["name"], r["runs"], time.strftime("%H:%M", time.localtime(r["last_ok"])) if r["last_ok"] else "-", (r["last_error"] or "")[:60],
                                                        r["note"] or ""))
        users = d1(db, "SELECT COUNT(*) n FROM users")[0]["results"][0]["n"]
        print("users:", users, "· records:", d1(db, "SELECT space, kind, COUNT(*) n FROM records WHERE deleted=0 GROUP BY space, kind")[0]["results"])
        return
    for chunk in chunks_of_sql((ROOT / "worker" / "schema.sql").read_text()):
        d1(db, chunk)
    for m in MIGRATIONS:  # columns added after a database was first created
        res = req("POST", f"/accounts/{ACCT}/d1/database/{db}/query", {"sql": m, "params": []}, soft=True)
        if res and not res.get("success") and "duplicate column" not in json.dumps(res.get("errors")):
            raise SystemExit("migration failed: %s" % res.get("errors"))
    print("schema applied")
    users = d1(db, "SELECT COUNT(*) n FROM users")[0]["results"][0]["n"]
    code = None
    if not users:
        code = "-".join(secrets.token_hex(3).upper() for _ in range(3))
        d1(db, "INSERT OR REPLACE INTO kv (k, v, updated) VALUES ('setup_code_hash', ?, ?)", [json.dumps(hashlib.sha256(code.encode()).hexdigest()), time.time()])
    if a.seed:
        n = d1(db, "SELECT COUNT(*) n FROM records WHERE space='live'")[0]["results"][0]["n"]
        if n:
            print("LIVE already has %d records; seed skipped" % n)
        else:
            sql = (ROOT / "private" / "seed_live.sql").read_text()
            k = 0
            for chunk in chunks_of_sql(sql):
                d1(db, chunk)
                k += 1
            print("seeded LIVE workspace (%d batches)" % k)
    jwt = upload_assets(a.name)
    put_worker(a.name, db, jwt)
    req("PUT", f"/accounts/{ACCT}/workers/scripts/{a.name}/schedules", [{"cron": "*/5 * * * *"}])
    print("cron: every 5 minutes")
    req("POST", f"/accounts/{ACCT}/workers/scripts/{a.name}/subdomain", {"enabled": bool(a.workers_dev), "previews_enabled": False})
    if a.domain:
        zones = req("GET", f"/zones?name={ZONE_NAME}")["result"]
        if not zones:
            raise SystemExit("zone %s not visible to this token" % ZONE_NAME)
        req("PUT", f"/accounts/{ACCT}/workers/domains", {"environment": "production", "hostname": a.domain, "service": a.name, "zone_id": zones[0]["id"]})
        print("custom domain: https://%s" % a.domain)
    if code:
        path = TOKEN_FILE.parent / "setup-code.txt"
        path.write_text(code + "\n")
        os.chmod(path, 0o600)
        print("\nONE-TIME SETUP CODE: %s  (also saved to %s)" % (code, path))
    print("done")


if __name__ == "__main__":
    main()
