"""Sign-in, MFA, sessions and workspace switching."""
import json
import time
import urllib.parse

from .. import ai, auth, db, demo
from .common import HTTPError, need, route, text


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
