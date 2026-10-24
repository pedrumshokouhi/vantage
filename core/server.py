"""HTTP server: static shell + JSON API. Python standard library only."""
import csv
import datetime as dt
import io
import json
import mimetypes
import os
import re
import threading
import time
import traceback
import urllib.parse
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import ai, auth, cos, db, demo, engine, feeds, intel, kb

STATIC = os.path.join(db.ROOT, "static")
COOKIE = "vantage_session"
KINDS = {"holding", "contact", "event", "decision", "note", "watch", "plan", "scenario", "investor", "ics_sub"}
SETTING_KEYS = {"base_currency", "interests", "objectives", "constraints", "max_position", "max_sector", "benchmark",
                "topic_weights", "muted", "muted_kinds", "kind_weights", "home_mode", "timezones", "voice", "audio_rate", "risk_tolerance"}
LIVE_ONLY_KEYS = {"anthropic_key", "anthropic_model", "sec_contact"}
MAX_BODY = 8 * 1024 * 1024

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
       "base-uri 'none'; form-action 'self'; object-src 'none'")


class HTTPError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


ROUTES = []


def route(method, pattern, auth_required=True):
    rx = re.compile("^" + pattern + "$")

    def deco(fn):
        ROUTES.append((method, rx, fn, auth_required))
        return fn
    return deco


class Handler(BaseHTTPRequestHandler):
    server_version = "Vantage"
    sys_version = ""

    def log_message(self, fmt, *args):
        if os.environ.get("VANTAGE_LOG"):
            super().log_message(fmt, *args)

    # ---------- helpers ----------
    def ip(self):
        return self.client_address[0]

    def secure(self):
        return self.headers.get("X-Forwarded-Proto") == "https"

    def token(self):
        c = cookies.SimpleCookie(self.headers.get("Cookie") or "")
        return c[COOKIE].value if COOKIE in c else None

    def body(self):
        """The request's JSON object ({} when empty). Anything else is a 400, never a 500."""
        if getattr(self, "_body", None) is not None:
            return self._body
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise HTTPError(400, "Bad Content-Length")
        if n < 0:
            raise HTTPError(400, "Bad Content-Length")  # read(-1) would block until the client hangs up
        if n > MAX_BODY:
            raise HTTPError(413, "Request too large")
        raw = self.rfile.read(n) if n else b""
        d = {}
        if raw:
            try:
                d = json.loads(raw.decode("utf-8"))
            except ValueError:
                raise HTTPError(400, "Invalid JSON")
        if not isinstance(d, dict):
            raise HTTPError(400, "Expected a JSON object")
        self._body = d
        return d

    def send(self, code, payload, ctype="application/json; charset=utf-8", extra=None):
        data = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Content-Security-Policy", CSP)
        if self.secure():
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        if ctype.startswith("application/json") or ctype.startswith("text/html"):
            self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            if isinstance(v, list):
                for x in v:
                    self.send_header(k, x)
            else:
                self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def set_cookie(self, token, ttl):
        attrs = "%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d" % (COOKIE, token, ttl)
        if self.secure():
            attrs += "; Secure"
        return attrs

    def clear_cookie(self):
        return "%s=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" % COOKIE

    # ---------- dispatch ----------
    def do_GET(self):
        self.dispatch("GET")

    def do_HEAD(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def dispatch(self, method):
        u = urllib.parse.urlparse(self.path)
        path = u.path
        self.query = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        self._body = None
        try:
            if not path.startswith("/api/"):
                return self.static(path)
            if method != "GET":
                # CSRF defence: same-origin custom header + Origin check (cookie is also SameSite=Strict)
                if self.headers.get("X-Vantage") != "1":
                    raise HTTPError(403, "Missing request header")
                origin = self.headers.get("Origin")
                if origin and urllib.parse.urlparse(origin).netloc != self.headers.get("Host"):
                    raise HTTPError(403, "Cross-origin request blocked")
            for m, rx, fn, need in ROUTES:
                if m != method:
                    continue
                mt = rx.match(path)
                if not mt:
                    continue
                self.sess = None
                if need:
                    s = auth.get_session(self.token())
                    if not s or s["mfa_pending"]:
                        raise HTTPError(401, "Not signed in")
                    self.sess = s
                    self.space = s["space"]
                result = fn(self, *mt.groups())
                if isinstance(result, tuple):
                    return self.send(result[0], result[1], extra=result[2] if len(result) > 2 else None)
                return self.send(200, result if result is not None else {"ok": True})
            raise HTTPError(404, "Not found")
        except HTTPError as e:
            self.send(e.code, {"error": e.msg})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self.send(500, {"error": "Server error: %s" % type(e).__name__})
        finally:
            db.close()

    def static(self, path):
        if path in ("/", "") or not os.path.splitext(path)[1]:
            path = "/index.html"
        full = os.path.realpath(os.path.join(STATIC, path.lstrip("/")))
        if not full.startswith(os.path.realpath(STATIC) + os.sep) or not os.path.isfile(full):
            return self.send(404, b"Not found", "text/plain")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            data = f.read()
        self.send(200, data, ctype, {"Cache-Control": "no-cache"})


def need(d, *keys):
    for k in keys:
        if d.get(k) in (None, ""):
            raise HTTPError(400, "Missing field: %s" % k)


def text(d, key, limit=None):
    """A string field from a request body ("" when absent); a non-string is a 400, not a crash."""
    v = d.get(key)
    if v is None:
        return ""
    if not isinstance(v, str):
        raise HTTPError(400, "%s must be text" % key)
    return v[:limit] if limit else v


def int_param(h, key, default):
    try:
        return int(h.query.get(key) or default)
    except ValueError:
        raise HTTPError(400, "%s must be a whole number" % key)


def get_or_404(space, rid, kind=None):
    r = db.get_record(space, rid, kind)
    if not r:
        raise HTTPError(404, "Record not found")
    return r


# =====================================================================
# Auth routes
# =====================================================================

@route("GET", "/api/state", False)
def state(h):
    setup = not auth.has_user()
    s = auth.get_session(h.token())
    out = {"setup_needed": setup, "authed": bool(s and not s["mfa_pending"]), "mfa_pending": bool(s and s["mfa_pending"])}
    if setup:
        auth.setup_code()  # ensure it exists (it's printed on the server console)
    if out["authed"]:
        u = db.q1("SELECT username, totp_enabled, prev_login, prev_login_ip, created FROM users WHERE id=?", (s["user_id"],))
        out.update({"user": u["username"], "mfa": bool(u["totp_enabled"]), "space": s["space"],
                    "prev_login": u["prev_login"], "prev_login_ip": u["prev_login_ip"], "ai": ai.status()})
    return out


@route("POST", "/api/setup", False)
def setup(h):
    d = h.body()
    need(d, "code", "username", "password")
    if auth.lockout_remaining(h.ip(), "setup"):
        raise HTTPError(429, "Too many attempts. Wait and try again.")
    err = auth.create_user(text(d, "username").strip(), text(d, "password"), text(d, "code"))
    if err:
        auth.record_attempt(h.ip(), "setup", False)
        raise HTTPError(400, err)
    demo.seed()
    return {"ok": True}


@route("POST", "/api/login", False)
def login(h):
    d = h.body()
    user_name = text(d, "username", 64).strip().lower()
    password = text(d, "password")
    wait = auth.lockout_remaining(h.ip(), user_name)
    if wait:
        raise HTTPError(429, "Too many failed attempts. Try again in %d seconds." % wait)
    u = db.q1("SELECT * FROM users WHERE username=?", (user_name,))
    if not u:
        auth.dummy_verify(password)
        auth.record_attempt(h.ip(), user_name, False)
        raise HTTPError(401, "Incorrect username or password.")
    if not auth.verify_password(password, u["pw_hash"]):
        auth.record_attempt(h.ip(), user_name, False)
        db.audit("login_failed", "%s from %s" % (user_name, h.ip()))
        raise HTTPError(401, "Incorrect username or password.")
    auth.record_attempt(h.ip(), user_name, True)
    remember = bool(d.get("remember"))
    token, ttl = auth.new_session(u["id"], h.ip(), h.headers.get("User-Agent") or "", remember, mfa_pending=bool(u["totp_enabled"]))
    if not u["totp_enabled"]:
        _mark_login(u, h.ip())
    return 200, {"ok": True, "mfa": bool(u["totp_enabled"])}, {"Set-Cookie": h.set_cookie(token, ttl)}


def _mark_login(u, ip):
    db.run("UPDATE users SET prev_login=last_login, prev_login_ip=last_login_ip, last_login=?, last_login_ip=? WHERE id=?",
           (time.time(), ip, u["id"]))
    db.audit("login", "%s from %s" % (u["username"], ip))


@route("POST", "/api/mfa", False)
def mfa(h):
    tok = h.token()
    s = auth.get_session(tok)
    if not s or not s["mfa_pending"]:
        raise HTTPError(401, "Sign in first.")
    u = db.q1("SELECT * FROM users WHERE id=?", (s["user_id"],))
    wait = auth.lockout_remaining(h.ip(), u["username"] + ":mfa")
    if wait:
        raise HTTPError(429, "Too many attempts. Try again in %d seconds." % wait)
    code = text(h.body(), "code", 64).strip()
    ok = auth.verify_totp(u["totp_secret"], code) or ("-" in code and auth.use_recovery_code(u, code))
    auth.record_attempt(h.ip(), u["username"] + ":mfa", ok)
    if not ok:
        raise HTTPError(401, "That code didn't work.")
    auth.end_session(tok)
    token, ttl = auth.new_session(u["id"], h.ip(), h.headers.get("User-Agent") or "", bool(s["remember"]))
    _mark_login(u, h.ip())
    return 200, {"ok": True}, {"Set-Cookie": h.set_cookie(token, ttl)}


@route("POST", "/api/logout", False)
def logout(h):
    if h.token():
        auth.end_session(h.token())
    return 200, {"ok": True}, {"Set-Cookie": h.clear_cookie()}


@route("POST", "/api/password")
def change_password(h):
    d = h.body()
    u = db.q1("SELECT * FROM users WHERE id=?", (h.sess["user_id"],))
    if not auth.verify_password(text(d, "current"), u["pw_hash"]):
        raise HTTPError(401, "Current password is incorrect.")
    new = text(d, "new")
    probs = auth.password_problems(new, u["username"])
    if probs:
        raise HTTPError(400, " ".join(probs))
    db.run("UPDATE users SET pw_hash=? WHERE id=?", (auth.hash_password(new), u["id"]))
    auth.end_all_sessions(u["id"], keep_token=h.token())
    db.audit("password_changed", u["username"])
    return {"ok": True}


@route("POST", "/api/mfa/setup")
def mfa_setup(h):
    u = db.q1("SELECT * FROM users WHERE id=?", (h.sess["user_id"],))
    secret = auth.new_totp_secret()
    db.set_setting("_auth", "pending_totp", secret)
    uri = "otpauth://totp/Vantage:%s?secret=%s&issuer=Vantage&digits=6&period=30" % (urllib.parse.quote(u["username"]), secret)
    return {"secret": secret, "uri": uri}


@route("POST", "/api/mfa/enable")
def mfa_enable(h):
    secret = db.get_setting("_auth", "pending_totp")
    if not secret or not auth.verify_totp(secret, text(h.body(), "code", 64)):
        raise HTTPError(400, "Code didn't match. Check your authenticator's clock and try again.")
    codes, hashes = auth.new_recovery_codes()
    db.run("UPDATE users SET totp_secret=?, totp_enabled=1, recovery=? WHERE id=?", (secret, json.dumps(hashes), h.sess["user_id"]))
    db.set_setting("_auth", "pending_totp", None)
    db.audit("mfa_enabled", "")
    return {"ok": True, "recovery": codes}


@route("POST", "/api/mfa/disable")
def mfa_disable(h):
    u = db.q1("SELECT * FROM users WHERE id=?", (h.sess["user_id"],))
    if not auth.verify_password(text(h.body(), "password"), u["pw_hash"]):
        raise HTTPError(401, "Password is incorrect.")
    db.run("UPDATE users SET totp_enabled=0, totp_secret=NULL, recovery='[]' WHERE id=?", (u["id"],))
    db.audit("mfa_disabled", "")
    return {"ok": True}


@route("GET", "/api/sessions")
def sessions(h):
    return {"sessions": auth.list_sessions(h.sess["user_id"], h.token()),
            "audit": db.q("SELECT * FROM audit ORDER BY ts DESC LIMIT 30")}


@route("POST", "/api/sessions/revoke")
def revoke(h):
    auth.end_all_sessions(h.sess["user_id"], keep_token=h.token())
    db.audit("sessions_revoked", "")
    return {"ok": True}


@route("POST", "/api/space")
def set_space(h):
    sp = h.body().get("space")
    if sp not in db.SPACES:
        raise HTTPError(400, "Unknown space")
    auth.set_space(h.token(), sp)
    return {"ok": True, "space": sp}


# =====================================================================
# Home + briefing
# =====================================================================

def _story_payload(space, s, port, analyze=True):
    if analyze:
        s["analysis"] = intel.analyze_story(space, s, port)
        cached, _ = db.cache_get("ai:story:%s:%s" % (space, s["id"]))
        if cached:
            s["ai"] = cached
    return s


@route("GET", "/api/home")
def home(h):
    sp = h.space
    port = engine.portfolio(sp)
    since = db.get_setting(sp, "last_visit")
    al = intel.alerts(sp)
    st = intel.stories(sp, hours=30, limit=14, port=port)
    today = dt.date.today()
    cal = intel.calendar(sp, today, today + dt.timedelta(days=1))
    wk = intel.week_ahead(sp)
    mem = intel.relationship_memory(sp, port)
    return {
        "space": sp, "since": intel.since_last_visit(sp, since, port), "priorities": intel.priorities(sp, port, al),
        "stories": [_story_payload(sp, s, port) for s in st[:8]] + st[8:], "macro": intel.macro(sp),
        "portfolio": {k: port[k] for k in ("base", "total", "returns", "benchmark", "top1", "top5", "effective_n", "count", "breaches", "gaps", "asof", "by_sector")}
        | {"movers": sorted([{"ticker": r["ticker"] or r["name"], "d1": r["returns"].get("1d", {}).get("base"), "weight": r["weight"], "id": r["id"]}
                             for r in port["holdings"] if r["returns"].get("1d")], key=lambda x: -abs(x["d1"] or 0))[:6],
           "hidden": port["hidden"][:2], "series": port["series"]},
        "today": [e for e in cal if e["start"][:10] == today.isoformat()], "tomorrow": [e for e in cal if e["start"][:10] != today.isoformat()],
        "week": {"busiest": wk["busiest"], "conflicts": wk["conflicts"], "prep": wk["prep"][:6], "market": wk["market"][:6],
                 "days": [{"date": d["date"], "load": d["load"], "n": len(d["events"]), "hours": d["hours"]} for d in wk["days"]]},
        "people": {"lost_touch": mem["lost_touch"][:5], "promises": mem["promises"][:5], "milestones": mem["milestones"][:5], "reasons": mem["reasons"][:4]},
        "radar": al[:8], "second_look": [a for a in al if a["kind"] == "second_look"][:4],
        "sources": _sources_summary(), "ai": ai.status(), "onboarding": _onboarding(sp) if sp == "live" else None,
    }


def _onboarding(sp):
    steps = [
        ("holdings", "Add or import your holdings", bool(db.list_records(sp, "holding"))),
        ("thesis", "Write a thesis for your largest position", any((x.get("thesis") or {}).get("why") for x in db.list_records(sp, "holding"))),
        ("contacts", "Import contacts (LinkedIn or Google CSV)", bool(db.list_records(sp, "contact"))),
        ("calendar", "Subscribe your calendar (ICS link) or add events", bool(db.list_records(sp, "ics_sub") or db.list_records(sp, "event"))),
        ("interests", "Set your interests and objectives", bool(db.get_setting(sp, "interests"))),
        ("investors", "Follow investors' 13F filings", bool(db.list_records(sp, "investor"))),
        ("sec", "Add a contact email for SEC EDGAR requests", bool(db.get_setting("live", "sec_contact"))),
        ("ai", "Connect Claude (optional)", ai.status()["ok"]),
        ("mfa", "Turn on two-factor authentication", bool(db.q1("SELECT totp_enabled FROM users LIMIT 1")["totp_enabled"])),
    ]
    return [{"id": a, "label": b, "done": c} for a, b, c in steps]


def _sources_summary():
    src = db.sources()
    news_ok = [v for k, v in src.items() if k.startswith("news:") and v.get("last_ok")]
    news_err = [k[5:] for k, v in src.items() if k.startswith("news:") and v.get("last_error")]
    def g(k):
        v = src.get(k) or {}
        return {"last_ok": v.get("last_ok"), "last_error": v.get("last_error"), "items": v.get("items")}
    return {"news": dict(g("news"), feeds_ok=len(news_ok), feeds_err=news_err), "quotes": g("quotes"), "boc": g("boc"), "sec": g("sec"),
            "ai": ai.status()}


@route("POST", "/api/visit")
def visit(h):
    last = db.get_setting(h.space, "last_visit") or 0
    if time.time() - last < 15 * 60:
        return {"ok": True, "unchanged": True}  # quick reloads don't reset "since your last visit"
    port = engine.portfolio(h.space)
    db.set_setting(h.space, "last_visit", time.time())
    if port["total"]:
        db.set_setting(h.space, "last_visit_value", port["total"])
    return {"ok": True}


@route("GET", "/api/briefing")
def briefing(h):
    sp = h.space
    port = engine.portfolio(sp)
    hours = max(1, min(168, int_param(h, "hours", 36)))
    st = intel.stories(sp, hours=hours, limit=60, port=port)
    topic = h.query.get("topic")
    if topic and topic != "all":
        st = [s for s in st if s["topic"] == topic]
    return {"stories": [_story_payload(sp, s, port) for s in st], "macro": intel.macro(sp),
            "topics": ["geopolitics", "conflict", "macro", "markets", "business", "technology"], "sources": _sources_summary()}


@route("POST", "/api/seen")
def seen(h):
    keys = h.body().get("keys") or []
    if not isinstance(keys, list):
        raise HTTPError(400, "keys must be a list")
    for k in keys[:200]:
        db.run("INSERT OR REPLACE INTO seen VALUES (?,?,?)", (h.space, str(k)[:100], time.time()))
    return {"ok": True}


def _find_story(space, sid):
    port = engine.portfolio(space)
    for s in intel.stories(space, hours=168, limit=400, port=port):
        if s["id"] == sid:
            return s, port
    raise HTTPError(404, "Story no longer in the feed window")


@route("POST", "/api/story/([\\w]+)/ai")
def story_ai(h, sid):
    s, port = _find_story(h.space, sid)
    summ = {"base": port["base"], "holdings": [{"ticker": r["ticker"], "sector": r["sector"], "weight": round(r["weight"], 3),
                                                "thesis": (r.get("thesis") or {}).get("why")} for r in port["holdings"][:20]],
            "plans": [p.get("title") for p in db.list_records(h.space, "plan")]}
    src = [{"n": i + 1, "source": x["source"], "title": x["title"], "published": x["published"]} for i, x in enumerate(s["sources"])]
    try:
        res = ai.analyze_story({"title": s["title"], "summary": s["summary"], "sources": src}, summ, db.get_setting(h.space, "interests") or [])
    except ai.AIUnavailable as e:
        raise HTTPError(503, str(e))
    res["model"] = ai.model()
    res["ts"] = time.time()
    db.cache_put("ai:story:%s:%s" % (h.space, sid), res)
    return res


@route("POST", "/api/impact")
def impact(h):
    d = h.body()
    if d.get("story_id"):
        s, _ = _find_story(h.space, d["story_id"])
        title, text = s["title"], s.get("summary") or ""
        text += " " + " ".join(x["title"] for x in s["sources"][:5])
    else:
        need(d, "title")
        title, text = d["title"], d.get("text") or ""
    m = engine.impact_map(h.space, title, text, d.get("story_id"), d.get("impulses"))
    cached, _ = db.cache_get("ai:impact:%s:%s" % (h.space, d.get("story_id") or title[:40]))
    if cached:
        m["ai"] = cached
    return m


@route("POST", "/api/impact/ai")
def impact_ai(h):
    d = h.body()
    m = engine.impact_map(h.space, d.get("title") or "", d.get("text") or "", d.get("story_id"))
    story = {"title": m["title"]}
    if d.get("story_id"):
        s, _ = _find_story(h.space, d["story_id"])
        story = {"title": s["title"], "summary": s["summary"], "sources": [{"n": i + 1, "source": x["source"], "title": x["title"]} for i, x in enumerate(s["sources"])]}
    port = engine.portfolio(h.space)
    graph = {"drivers": [n["label"] for n in m["nodes"] if n["kind"] == "driver"],
             "links": [(e["from"], e["to"], e["sign"]) for e in m["edges"]][:40]}
    try:
        res = ai.deepen_impact(story, graph, [(r["ticker"], r["sector"], round(r["weight"], 3)) for r in port["holdings"][:25]])
    except ai.AIUnavailable as e:
        raise HTTPError(503, str(e))
    res["model"] = ai.model()
    db.cache_put("ai:impact:%s:%s" % (h.space, d.get("story_id") or (d.get("title") or "")[:40]), res)
    return res


# =====================================================================
# Portfolio
# =====================================================================

@route("GET", "/api/portfolio")
def portfolio(h):
    p = engine.portfolio(h.space, force=h.query.get("force") == "1")
    p["watch"] = db.list_records(h.space, "watch")
    wq = feeds.quotes([w["ticker"] for w in p["watch"] if w.get("ticker")])
    for w in p["watch"]:
        q = wq.get(w.get("ticker"))
        if q:
            w["price"], w["currency"], w["name"] = q["price"], q["currency"], w.get("name") or q["name"]
            w["d1"] = (q["price"] / q["prev_close"] - 1) if q.get("prev_close") else None
            s = q.get("series") or []
            w["y1"] = (q["price"] / s[0][1] - 1) if s else None
    p["risk_change"] = intel.risk_change(h.space)
    p["sectors_available"] = sorted(kb.SECTORS)
    p["factors"] = {k: {"label": v[0], "desc": v[1]} for k, v in kb.FACTORS.items()}
    return p


@route("GET", "/api/holding/([\\w]+)")
def holding(h, hid):
    rec = get_or_404(h.space, hid)
    port = engine.portfolio(h.space)
    row = next((r for r in port["holdings"] if r["id"] == hid), None)
    q = feeds.quotes([rec["ticker"]]).get(rec["ticker"]) if rec.get("ticker") and rec["ticker"] != "CASH" else None
    fl, fetched = db.cache_get("filings:" + (rec.get("ticker") or ""))
    if fl is None and rec.get("ticker") and not rec["ticker"].endswith((".TO", ".V", ".NE")) and rec["ticker"] != "CASH":
        try:
            fl = feeds.company_filings(rec["ticker"])
            db.cache_put("filings:" + rec["ticker"], fl or {"none": True})
        except Exception as e:  # noqa: BLE001
            fl = {"error": str(e)}
    ents = [e for e in intel.entities(h.space, port) if e["kind"] == "holding" and e["id"] == hid]
    news = []
    for n in db.q("SELECT * FROM news WHERE published>? ORDER BY published DESC", (time.time() - 7 * 86400,)):
        if ents and intel.mentions(n["title"] + " " + (n["summary"] or ""), ents):
            news.append({k: n[k] for k in ("title", "link", "source", "published", "cluster")})
    al = [a for a in intel.alerts(h.space, limit=200) if (a["body"].get("ref") or {}).get("id") == hid]
    return {"record": rec, "row": row, "series": (q or {}).get("series"), "quote": {k: v for k, v in (q or {}).items() if k != "series"},
            "filings": fl, "filings_note": "Canadian issuers file on SEDAR+, which has no free API; add catalysts manually." if (rec.get("ticker") or "").endswith((".TO", ".V", ".NE")) else None,
            "news": news[:12], "alerts": al, "revisions": db.revisions(hid), "factors": {k: v[0] for k, v in kb.FACTORS.items()},
            "sectors": sorted(kb.SECTORS)}


@route("POST", "/api/holding/([\\w]+)/assess")
def holding_assess(h, hid):
    d = h.body()
    rec = get_or_404(h.space, hid)
    a = db.q1("SELECT * FROM alerts WHERE id=? AND space=?", (d.get("alert"), h.space))
    if not a:
        raise HTTPError(404, "Alert not found")
    body = json.loads(a["body"])
    try:
        res = ai.assess_thesis({"ticker": rec.get("ticker")}, rec.get("thesis"), {"headline": body.get("latest"), "link": body.get("link")})
    except ai.AIUnavailable as e:
        raise HTTPError(503, str(e))
    body["ai"] = dict(res, model=ai.model(), ts=time.time())
    body["assessment"] = "%s (Claude, %s confidence): %s" % (res.get("verdict", "?").title(), res.get("confidence", "?"), res.get("reason", ""))
    db.run("UPDATE alerts SET body=? WHERE id=?", (json.dumps(body), a["id"]))
    return body


def _num(x):
    if x is None:
        return None
    s = str(x).replace(",", "").replace("$", "").strip()
    if s in ("", "-", "--"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


@route("POST", "/api/import/holdings")
def import_holdings(h):
    d = h.body()
    text = d.get("csv") or ""
    rows = list(csv.DictReader(io.StringIO(text.strip())))
    if not rows:
        raise HTTPError(400, "No rows found. The first line must be a header row.")
    def pick(r, *names):
        for k in r:
            kl = (k or "").strip().lower()
            if any(kl == n or kl.startswith(n) for n in names):
                return r[k]
        return None
    added, skipped = 0, []
    for r in rows:
        t = (pick(r, "symbol", "ticker") or "").strip().upper()
        q = _num(pick(r, "quantity", "shares", "qty", "units"))
        if not t or q is None:
            skipped.append(t or "(blank)")
            continue
        cost = _num(pick(r, "average cost", "avg cost", "cost per", "average price", "price paid", "cost basis per", "book cost per", "acb per"))
        total = _num(pick(r, "book value", "book cost", "total cost", "cost basis", "acb"))
        if cost is None and total is not None and q:
            cost = total / q
        rec = {"ticker": t, "quantity": q, "cost": cost, "currency": (pick(r, "currency") or "").strip().upper() or None,
               "account": (pick(r, "account") or "").strip() or None, "name": (pick(r, "name", "description", "security") or "").strip() or None}
        existing = next((x for x in db.list_records(h.space, "holding") if x.get("ticker") == t and (x.get("account") or None) == rec["account"]), None)
        if existing and d.get("mode") == "merge":
            db.update_record(h.space, existing["id"], {k: v for k, v in rec.items() if v is not None})
        else:
            db.create_record(h.space, "holding", {k: v for k, v in rec.items() if v is not None})
        added += 1
    return {"added": added, "skipped": skipped}


@route("POST", "/api/scenario")
def scenario(h):
    inputs = h.body().get("inputs") or {}
    if not isinstance(inputs, dict) or not isinstance(inputs.get("factors") or {}, dict):
        raise HTTPError(400, "inputs must be an object")
    try:
        return engine.scenario(h.space, inputs)
    except (TypeError, ValueError):
        raise HTTPError(400, "Scenario inputs must be numbers")


@route("GET", "/api/scenario/presets")
def presets(h):
    return {"presets": engine.PRESETS, "factors": {k: v[0] for k, v in kb.FACTORS.items()},
            "holdings": [{"id": r["id"], "ticker": r.get("ticker") or r.get("name")} for r in db.list_records(h.space, "holding")],
            "saved": db.list_records(h.space, "scenario")}


# =====================================================================
# Filings
# =====================================================================

def _13f(cik, force=False):
    data, fetched = db.cache_get("13f:summary:%s" % cik)
    ttl = 15 * 60 if (data or {}).get("error") else 12 * 3600  # retry failures soon, successes twice a day
    if data is not None and not force and time.time() - fetched < ttl:
        return data
    try:
        data = feeds.thirteen_f(cik)
        data["fetched"] = time.time()
    except Exception as e:  # noqa: BLE001
        if data is not None:
            data["stale_error"] = str(e)
            return data
        data = {"cik": cik, "error": str(e)}
    db.cache_put("13f:summary:%s" % cik, data)
    return data


@route("GET", "/api/filings")
def filings(h):
    port = engine.portfolio(h.space)
    held = {intel.company_key(r["name"]): r["ticker"] for r in port["holdings"]}
    watch = {intel.company_key(w.get("name") or w.get("ticker") or ""): w.get("ticker") for w in db.list_records(h.space, "watch")}
    out = []
    pattern = {}
    for inv in db.list_records(h.space, "investor"):
        d = _13f(inv["cik"], force=h.query.get("force") == "1")
        d = dict(d)
        d["record_id"] = inv["id"]
        d.setdefault("name", inv.get("name"))
        for ch in d.get("changes", []):
            k = intel.company_key(ch["issuer"])
            ch["overlap"] = "holding" if k in held else ("watchlist" if k in watch else None)
            if ch["change"] in ("new", "increased", "reduced", "exited"):
                pattern.setdefault((ch["cusip"], ch["change"] in ("new", "increased")), {"issuer": ch["issuer"], "who": [], "buy": ch["change"] in ("new", "increased")})["who"].append(d.get("name"))
        out.append(d)
    patterns = [v for v in pattern.values() if len(v["who"]) >= 2]
    patterns.sort(key=lambda v: -len(v["who"]))
    hold_filings = []
    for r in port["holdings"]:
        fl, _ = db.cache_get("filings:" + (r["ticker"] or ""))
        if fl and fl.get("filings"):
            for f in fl["filings"][:5]:
                hold_filings.append(dict(f, ticker=r["ticker"]))
    hold_filings.sort(key=lambda f: f["filed"], reverse=True)
    return {"investors": out, "patterns": patterns[:15], "company": hold_filings[:30],
            "presets": [{"name": "Berkshire Hathaway", "cik": 1067983}, {"name": "Pershing Square", "cik": 1336528}, {"name": "Scion Asset Management", "cik": 1649339},
                        {"name": "Baupost Group", "cik": 1061768}, {"name": "Appaloosa", "cik": 1656456}, {"name": "Himalaya Capital", "cik": 1709323},
                        {"name": "Duquesne Family Office", "cik": 1536411}, {"name": "Bridgewater Associates", "cik": 1350694}, {"name": "Tiger Global", "cik": 1167483},
                        {"name": "Coatue Management", "cik": 1135730}, {"name": "Lone Pine Capital", "cik": 1061165}, {"name": "Third Point", "cik": 1040273},
                        {"name": "Greenlight Capital", "cik": 1079114}, {"name": "Viking Global", "cik": 1103804}, {"name": "Soros Fund Management", "cik": 1029160}],
            "sec_contact": bool(db.get_setting("live", "sec_contact")),
            "caveats": ["13F filings are due 45 days after quarter end, so holdings can be up to ~4.5 months old when you read them.",
                        "They show long positions in US-listed equities and options only: no shorts, no cash, no most non-US holdings.",
                        "Report period (holdings date) and filing date are shown separately. Treat changes as context, not as a current trade signal.",
                        "Overlap with your holdings is matched by issuer name and may miss or mis-match share classes."]}


# =====================================================================
# Calendar
# =====================================================================

@route("GET", "/api/calendar")
def calendar(h):
    try:
        start = dt.date.fromisoformat(h.query.get("start") or dt.date.today().isoformat())
        end = dt.date.fromisoformat(h.query.get("end") or (start + dt.timedelta(days=42)).isoformat())
    except ValueError:
        raise HTTPError(400, "Bad date")
    if (end - start).days > 400:
        raise HTTPError(400, "Range too large")
    subs = db.list_records(h.space, "ics_sub")
    status = []
    for s in subs:
        data, fetched = db.cache_get("ics:" + s["id"])
        src = db.sources().get("ics:" + s["id"]) or {}
        status.append({"id": s["id"], "name": s.get("name"), "fetched": fetched, "error": src.get("last_error"), "count": len(data or [])})
    return {"events": intel.calendar(h.space, start, end), "subscriptions": status,
            "contacts": [{"id": c["id"], "name": c.get("name")} for c in db.list_records(h.space, "contact")]}


@route("GET", "/api/week")
def week(h):
    return intel.week_ahead(h.space)


@route("GET", "/api/prep/(.+)")
def prep(h, eid):
    b = intel.prep_brief(h.space, urllib.parse.unquote(eid))
    if not b:
        raise HTTPError(404, "Event not found")
    cached, _ = db.cache_get("ai:prep:%s:%s" % (h.space, eid))
    b["ai"] = cached
    return b


@route("POST", "/api/prep/(.+)/ai")
def prep_ai(h, eid):
    b = intel.prep_brief(h.space, urllib.parse.unquote(eid))
    if not b:
        raise HTTPError(404, "Event not found")
    try:
        txt = ai.prep(b)
    except ai.AIUnavailable as e:
        raise HTTPError(503, str(e))
    res = {"text": txt, "model": ai.model(), "ts": time.time()}
    db.cache_put("ai:prep:%s:%s" % (h.space, eid), res)
    return res


@route("POST", "/api/ics/test")
def ics_test(h):
    url = (h.body().get("url") or "").strip()
    if not re.match(r"^(https|webcal)://", url):
        raise HTTPError(400, "Use an https:// or webcal:// calendar link.")
    try:
        evs = feeds.fetch_ics(url)
    except Exception as e:  # noqa: BLE001
        raise HTTPError(400, "Couldn't read that calendar: %s" % e)
    return {"count": len(evs), "sample": evs[:5]}


def refresh_ics(space):
    for s in db.list_records(space, "ics_sub"):
        try:
            evs = feeds.fetch_ics(s["url"])
            db.cache_put("ics:" + s["id"], evs)
            db.source_ok("ics:" + s["id"], len(evs), s.get("name"))
        except Exception as e:  # noqa: BLE001
            db.source_err("ics:" + s["id"], e)


# =====================================================================
# Network
# =====================================================================

@route("GET", "/api/network")
def network(h):
    cs = db.list_records(h.space, "contact")
    for c in cs:
        lc = intel.last_contact(c)
        c["_last"] = lc.isoformat() if lc else None
        nf = intel.next_followup(c)
        c["_next"] = nf.isoformat() if nf else None
        c["_cadence"] = intel.cadence(c)
    return {"contacts": cs, "memory": intel.relationship_memory(h.space)}


@route("GET", "/api/who")
def who(h):
    return intel.who(h.space, h.query.get("q") or "")


@route("POST", "/api/draft")
def draft(h):
    d = h.body()
    need(d, "contact_id")
    base = intel.draft_message(h.space, d["contact_id"], d.get("purpose") or "")
    if not base:
        raise HTTPError(404, "Contact not found")
    if d.get("ai"):
        c = db.get_record(h.space, d["contact_id"])
        try:
            base["body"] = ai.draft({k: c.get(k) for k in ("name", "role", "org", "city", "interests", "notes", "how_met", "interactions", "commitments")},
                                    base["basis"], d.get("purpose"))
            base["model"] = ai.model()
        except ai.AIUnavailable as e:
            raise HTTPError(503, str(e))
    return base


@route("POST", "/api/import/contacts")
def import_contacts(h):
    text = h.body().get("csv") or ""
    lines = text.strip().splitlines()
    # LinkedIn exports start with a "Notes:" preamble before the header row
    for i, ln in enumerate(lines[:10]):
        if "First Name" in ln or ln.lower().startswith(("name", "first name", "given name")):
            lines = lines[i:]
            break
    rows = list(csv.DictReader(io.StringIO("\n".join(lines))))
    existing = {(c.get("name") or "").lower() for c in db.list_records(h.space, "contact")}
    added = 0
    for r in rows:
        g = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
        name = g.get("name") or " ".join(x for x in (g.get("first name") or g.get("given name"), g.get("last name") or g.get("family name")) if x)
        if not name or name.lower() in existing:
            continue
        rec = {"name": name, "org": g.get("company") or g.get("organization 1 - name") or g.get("organization") or g.get("org"),
               "role": g.get("position") or g.get("organization 1 - title") or g.get("title") or g.get("role"),
               "email": g.get("email address") or g.get("e-mail 1 - value") or g.get("email"),
               "city": g.get("city") or g.get("address 1 - city"), "birthday": g.get("birthday") or None,
               "linkedin": g.get("url"), "closeness": 2, "influence": 2, "prominence": 1,
               "how_met": ("LinkedIn connection since %s" % g["connected on"]) if g.get("connected on") else None,
               "notes": g.get("notes") or ""}
        db.create_record(h.space, "contact", {k: v for k, v in rec.items() if v not in (None, "")})
        existing.add(name.lower())
        added += 1
    return {"added": added, "rows": len(rows)}


# =====================================================================
# Chief of staff, search, radar, journal
# =====================================================================

@route("POST", "/api/ask")
def ask(h):
    q = (h.body().get("q") or "").strip()
    if not q:
        raise HTTPError(400, "Ask something")
    res = cos.answer(h.space, q)
    hist = db.get_setting(h.space, "ask_history") or []
    hist = ([{"q": q, "ts": time.time(), "intent": res["intent"]}] + hist)[:30]
    db.set_setting(h.space, "ask_history", hist)
    return res


@route("GET", "/api/ask/history")
def ask_history(h):
    return {"history": db.get_setting(h.space, "ask_history") or []}


@route("GET", "/api/search")
def search(h):
    return {"results": cos.search(h.space, h.query.get("q") or "", 25)}


@route("GET", "/api/radar")
def radar(h):
    status = h.query.get("status") or "open"
    return {"alerts": intel.alerts(h.space, status, 100), "weights": db.get_setting(h.space, "kind_weights") or {},
            "muted": db.get_setting(h.space, "muted_kinds") or [], "kinds": intel.KIND_LABEL}


@route("POST", "/api/radar/run")
def radar_run(h):
    n = intel.run_radar(h.space)
    return {"open": n}


@route("POST", "/api/radar/([\\w]+)/feedback")
def radar_fb(h, aid):
    fb = h.body().get("fb")
    if fb not in ("useful", "noise", "mute", "done", "dismiss", "snooze"):
        raise HTTPError(400, "Unknown feedback")
    intel.alert_feedback(h.space, aid, fb)
    return {"ok": True}


@route("POST", "/api/radar/unmute")
def radar_unmute(h):
    db.set_setting(h.space, "muted_kinds", [])
    db.set_setting(h.space, "kind_weights", {})
    return {"ok": True}


@route("GET", "/api/journal/([\\w]+)/replay")
def replay(h, did):
    r = intel.replay(h.space, did)
    if not r:
        raise HTTPError(404, "Decision not found")
    return r


# =====================================================================
# Generic records
# =====================================================================

DECISION_LOCKED = ("decision", "rationale", "assumptions", "alternatives", "expectations", "date", "title", "price_at_decision")


def _check_kind(kind):
    if kind not in KINDS:
        raise HTTPError(404, "Unknown record type")


def _sanitize(kind, d):
    if not isinstance(d, dict):
        raise HTTPError(400, "Expected an object")
    if len(json.dumps(d)) > 400000:
        raise HTTPError(413, "Record too large")
    if kind == "holding":
        if d.get("ticker"):
            d["ticker"] = str(d["ticker"]).strip().upper()
        for k in ("quantity", "cost", "manual_price", "cost_base_total", "target_weight", "beta"):
            if k in d and d[k] not in (None, ""):
                v = _num(d[k])
                if v is None:
                    raise HTTPError(400, "%s must be a number" % k)
                d[k] = v
    if kind == "ics_sub" and not re.match(r"^(https|webcal)://", d.get("url") or ""):
        raise HTTPError(400, "Calendar link must start with https:// or webcal://")
    if kind == "investor":
        try:
            d["cik"] = int(str(d.get("cik")).strip())
        except ValueError:
            raise HTTPError(400, "CIK must be a number")
    return d


@route("GET", "/api/r/(\\w+)")
def r_list(h, kind):
    _check_kind(kind)
    return {"items": db.list_records(h.space, kind)}


@route("GET", "/api/r/(\\w+)/([\\w]+)")
def r_get(h, kind, rid):
    _check_kind(kind)
    return get_or_404(h.space, rid, kind)


@route("GET", "/api/r/(\\w+)/([\\w]+)/revisions")
def r_revs(h, kind, rid):
    _check_kind(kind)
    get_or_404(h.space, rid, kind)
    return {"revisions": db.revisions(rid)}


@route("POST", "/api/r/(\\w+)")
def r_create(h, kind):
    _check_kind(kind)
    d = _sanitize(kind, h.body())
    if kind == "decision" and d.get("ticker") and not d.get("price_at_decision"):
        q = feeds.quotes([d["ticker"]]).get(d["ticker"])
        if q and q.get("price"):
            d["price_at_decision"] = q["price"]
            d["price_source"] = "Quote at time of recording (%s)" % time.strftime("%Y-%m-%d %H:%M")
    rec = db.create_record(h.space, kind, d)
    if kind == "ics_sub":
        threading.Thread(target=refresh_ics, args=(h.space,), daemon=True).start()
    if kind == "investor":
        threading.Thread(target=_13f, args=(d["cik"],), daemon=True).start()
    return rec


@route("PUT", "/api/r/(\\w+)/([\\w]+)")
def r_update(h, kind, rid):
    _check_kind(kind)
    # the kind must match the stored record: otherwise PUT /api/r/note/<decision id> would skip the decision lock
    cur = get_or_404(h.space, rid, kind)
    d = _sanitize(kind, h.body())
    merge = h.query.get("replace") != "1"
    if kind == "decision" and time.time() - cur["_created"] > 86400:
        # original reasoning is locked after 24h; only reviews/status/review_date may change
        changed = [k for k in DECISION_LOCKED if k in d and d[k] != cur.get(k)]
        if changed:
            raise HTTPError(409, "Original reasoning is locked after 24 hours so hindsight can't rewrite it. Add a review or an amendment instead.")
        if not merge:  # a full replace may not drop the locked fields either
            d.update({k: cur[k] for k in DECISION_LOCKED if k in cur})
    return db.update_record(h.space, rid, d, merge=merge)


@route("DELETE", "/api/r/(\\w+)/([\\w]+)")
def r_delete(h, kind, rid):
    _check_kind(kind)
    get_or_404(h.space, rid, kind)
    db.delete_record(h.space, rid)
    return {"ok": True}


# =====================================================================
# Settings, status, data
# =====================================================================

@route("GET", "/api/settings")
def settings(h):
    s = db.all_settings(h.space)
    out = {k: v for k, v in s.items() if k in SETTING_KEYS}
    live = db.all_settings("live")
    out["sec_contact"] = live.get("sec_contact") or ""
    out["anthropic_model"] = live.get("anthropic_model") or ai.DEFAULT_MODEL
    out["anthropic_key_set"] = bool(live.get("anthropic_key"))
    out["plan_templates"] = list(kb.PLAN_TEMPLATES)
    return out


@route("POST", "/api/settings")
def save_settings(h):
    d = h.body()
    for k, v in d.items():
        if k in SETTING_KEYS:
            db.set_setting(h.space, k, v)
        elif k in LIVE_ONLY_KEYS:
            if v is not None and not isinstance(v, str):
                raise HTTPError(400, "%s must be text" % k)
            if k == "anthropic_key" and v and not v.startswith("sk-"):
                raise HTTPError(400, "That doesn't look like an Anthropic API key.")
            db.set_setting("live", k, (v or "").strip() or None)
        else:
            raise HTTPError(400, "Unknown setting: %s" % k)
    return {"ok": True}


@route("GET", "/api/status")
def status(h):
    src = db.sources()
    return {"sources": src, "ai": ai.status(), "backups": db.list_backups()[:10],
            "counts": {k: len(db.list_records(h.space, k)) for k in sorted(KINDS)},
            "news_items": db.q1("SELECT COUNT(*) n FROM news")["n"], "db_path": db.DB_PATH, "data_dir": db.DATA_DIR}


@route("POST", "/api/refresh")
def refresh(h):
    what = h.body().get("what") or "all"
    if what in ("all", "news"):
        feeds.refresh_news()
    if what in ("all", "quotes"):
        engine.portfolio(h.space, force=True)
        feeds.quotes([t for t, _ in feeds.MARKET_TICKERS], force=True)
    if what in ("all", "macro"):
        feeds.refresh_boc(force=True)
    if what in ("all", "calendar"):
        refresh_ics(h.space)
    if what in ("all", "filings"):
        refresh_filings(h.space, force=True)
    intel.run_radar(h.space)
    return {"ok": True, "sources": _sources_summary()}


@route("GET", "/api/export")
def export(h):
    sp = h.space
    data = {"vantage_export": 1, "space": sp, "exported": time.time(),
            "settings": {k: v for k, v in db.all_settings(sp).items() if k in SETTING_KEYS},
            "records": {k: db.list_records(sp, k) for k in sorted(KINDS)},
            "revisions": {r["id"]: db.revisions(r["id"]) for k in ("decision", "holding") for r in db.list_records(sp, k)}}
    fn = "vantage-%s-%s.json" % (sp, time.strftime("%Y%m%d-%H%M"))
    return 200, data, {"Content-Disposition": 'attachment; filename="%s"' % fn}


@route("POST", "/api/import")
def import_json(h):
    d = h.body()
    if d.get("vantage_export") != 1:
        raise HTTPError(400, "Not a Vantage export file")
    records = d.get("records") or {}
    if not isinstance(records, dict) or not all(isinstance(v, list) for v in records.values()):
        raise HTTPError(400, "records must map each kind to a list")
    db.backup("pre-import")
    n, skipped = 0, 0
    for kind, items in records.items():
        if kind not in KINDS:
            continue
        for it in items:
            if not isinstance(it, dict):
                skipped += 1
                continue
            rid = it.get("id")
            if rid is not None and (not isinstance(rid, str) or not re.fullmatch(r"\w{1,64}", rid)):
                skipped += 1
                continue
            if rid and db.q1("SELECT id FROM records WHERE id=?", (rid,)):
                skipped += 1
                continue
            try:
                data = _sanitize(kind, dict(it))
            except HTTPError:
                skipped += 1
                continue
            ts = it.get("_created")
            db.create_record(h.space, kind, data, rid=rid, ts=ts if isinstance(ts, (int, float)) else None)
            n += 1
    for k, v in (d.get("settings") or {}).items():
        if k in SETTING_KEYS:
            db.set_setting(h.space, k, v)
    return {"imported": n, "skipped": skipped}


@route("POST", "/api/backup")
def backup(h):
    p = db.backup("manual")
    return {"file": os.path.basename(p), "backups": db.list_backups()[:10]}


@route("POST", "/api/demo/reset")
def demo_reset(h):
    db.wipe_space("demo")
    demo.seed()
    return {"ok": True}


# =====================================================================
# Background worker
# =====================================================================

def refresh_filings(space, force=False):
    for r in db.list_records(space, "holding"):
        t = r.get("ticker") or ""
        if not t or t == "CASH" or t.endswith((".TO", ".V", ".NE")) or t.startswith("^") or "-USD" in t:
            continue
        data, fetched = db.cache_get("filings:" + t)
        if data is not None and not force and time.time() - fetched < 12 * 3600:
            continue
        try:
            fl = feeds.company_filings(t)
            db.cache_put("filings:" + t, fl or {"none": True})
        except Exception as e:  # noqa: BLE001
            db.source_err("sec", e)
        time.sleep(.2)
    for inv in db.list_records(space, "investor"):
        _13f(inv["cik"], force=force)
        time.sleep(.2)


def worker():
    last = {}
    time.sleep(2)
    while True:
        try:
            now = time.time()
            if now - last.get("news", 0) > 15 * 60:
                feeds.refresh_news()
                last["news"] = now
            feeds.refresh_boc()
            for sp in db.SPACES:
                if now - last.get("q" + sp, 0) > 10 * 60:
                    port = engine.portfolio(sp)
                    feeds.quotes([t for t, _ in feeds.MARKET_TICKERS])
                    intel.snapshot(sp, port)
                    last["q" + sp] = now
                if now - last.get("ics" + sp, 0) > 30 * 60:
                    refresh_ics(sp)
                    last["ics" + sp] = now
                if now - last.get("f" + sp, 0) > 6 * 3600:
                    refresh_filings(sp)
                    last["f" + sp] = now
                if now - last.get("r" + sp, 0) > 15 * 60:
                    intel.run_radar(sp)
                    last["r" + sp] = now
            day = dt.date.today().isoformat()
            if last.get("backup") != day:
                if not any(day.replace("-", "") in b["file"] for b in db.list_backups()):
                    db.backup("daily")
                last["backup"] = day
            db.run("DELETE FROM sessions WHERE expires<?", (now,))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        time.sleep(60)


def serve(host="127.0.0.1", port=8790):
    db.init()
    code = auth.setup_code()
    if not db.q1("SELECT id FROM records WHERE space='demo' LIMIT 1") and auth.has_user():
        demo.seed()
    threading.Thread(target=worker, daemon=True).start()
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    print("\n  VANTAGE  ·  personal command center")
    print("  Listening on http://%s:%d" % ("localhost" if host in ("127.0.0.1", "localhost") else host, port))
    if code:
        print("\n  First-run setup code: %s" % code)
        print("  (also stored in %s until setup completes)" % auth.SETUP_FILE)
    if host not in ("127.0.0.1", "localhost", "::1"):
        print("\n  WARNING: listening beyond this machine. Put it behind HTTPS (e.g. Tailscale or Cloudflare Tunnel);")
        print("  cookies get the Secure flag when X-Forwarded-Proto: https is set by the proxy.")
    print()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
