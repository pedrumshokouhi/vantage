"""Authentication: PBKDF2 passwords, hashed session tokens, TOTP MFA, lockouts.

Design notes
- Passwords: PBKDF2-HMAC-SHA256, 600k iterations, per-user 16-byte salt.
- Sessions: 256-bit random token in an HttpOnly SameSite=Strict cookie; only its
  SHA-256 lives in the database, so a stolen DB file cannot be replayed.
- MFA: RFC 6238 TOTP (30 s, 6 digits, +/-1 step) plus ten single-use recovery codes. An accepted
  code's time step is remembered, so a code that was seen once can't be replayed (RFC 6238 s5.2).
- Brute force: failures per IP and per username back off exponentially.
- First run: an account can only be created with the one-time setup code the
  server prints to its console, so exposing the port early cannot be hijacked.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import struct
import time

from . import db

ITER = 600_000
IDLE_TIMEOUT = 8 * 3600
SHORT_TTL = 12 * 3600
LONG_TTL = 30 * 86400
SETUP_FILE = os.path.join(db.DATA_DIR, "setup-code.txt")


# ---------- passwords ----------

def hash_password(pw):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, ITER)
    return "pbkdf2_sha256$%d$%s$%s" % (ITER, base64.b64encode(salt).decode(), base64.b64encode(dk).decode())


def verify_password(pw, stored):
    try:
        algo, it, salt, dk = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", pw.encode(), base64.b64decode(salt), int(it))
        return hmac.compare_digest(calc, base64.b64decode(dk))
    except Exception:
        return False


_DUMMY = None


def dummy_verify(pw):
    """Spend the same time as a real check so usernames can't be probed by timing."""
    global _DUMMY
    if _DUMMY is None:
        _DUMMY = hash_password("not-a-real-password")
    verify_password(pw, _DUMMY)


def password_problems(pw, username=""):
    probs = []
    if len(pw) < 12:
        probs.append("Use at least 12 characters.")
    if username and username.lower() in pw.lower():
        probs.append("Don't include your username.")
    classes = sum([any(c.islower() for c in pw), any(c.isupper() for c in pw),
                   any(c.isdigit() for c in pw), any(not c.isalnum() for c in pw)])
    if len(pw) < 16 and classes < 3:
        probs.append("Mix upper/lower case, digits and symbols, or use a 16+ character passphrase.")
    if pw.lower() in ("password1234", "123456789012", "qwertyuiopas"):
        probs.append("That password is too common.")
    return probs


# ---------- setup ----------

def has_user():
    return db.q1("SELECT id FROM users LIMIT 1") is not None


def setup_code():
    """Return the current one-time setup code, creating it if needed."""
    if has_user():
        return None
    if os.path.exists(SETUP_FILE):
        with open(SETUP_FILE) as f:
            return f.read().strip()
    code = "-".join(secrets.token_hex(3).upper() for _ in range(3))
    with open(SETUP_FILE, "w") as f:
        f.write(code)
    os.chmod(SETUP_FILE, 0o600)
    return code


def create_user(username, pw, code):
    expected = setup_code()
    if not expected or not hmac.compare_digest(code.strip().upper(), expected):
        return "Setup code is incorrect."
    if has_user():
        return "An account already exists."
    if not (3 <= len(username) <= 32) or not username.replace("_", "").replace(".", "").isalnum():
        return "Username: 3-32 letters, digits, dots or underscores."
    probs = password_problems(pw, username)
    if probs:
        return " ".join(probs)
    db.run("INSERT INTO users (username, pw_hash, created) VALUES (?,?,?)",
           (username.lower(), hash_password(pw), time.time()))
    try:
        os.remove(SETUP_FILE)
    except OSError:
        pass
    db.audit("setup", "account created: " + username.lower())
    return None


# ---------- rate limiting ----------

def _attempt_key(username):
    # stored and queried in the same form, so an over-long username can't dodge its own counter
    return username.lower()[:64]


def lockout_remaining(ip, username):
    now = time.time()
    window = now - 3600
    user = _attempt_key(username)
    fails_ip = db.q1("SELECT COUNT(*) n FROM login_attempts WHERE ip=? AND ok=0 AND ts>?", (ip, window))["n"]
    fails_user = db.q1("SELECT COUNT(*) n FROM login_attempts WHERE username=? AND ok=0 AND ts>?",
                       (user, window))["n"]
    n = max(fails_ip, fails_user)
    if n < 5:
        return 0
    last = db.q1("SELECT MAX(ts) t FROM login_attempts WHERE (ip=? OR username=?) AND ok=0",
                 (ip, user))["t"] or 0
    wait = min(2 ** (n - 4), 900)
    return max(0, int(last + wait - now))


def record_attempt(ip, username, ok):
    user = _attempt_key(username)
    db.run("INSERT INTO login_attempts VALUES (?,?,?,?)", (time.time(), ip, user, 1 if ok else 0))
    if ok:
        db.run("DELETE FROM login_attempts WHERE (ip=? OR username=?) AND ok=0", (ip, user))
    db.run("DELETE FROM login_attempts WHERE ts<?", (time.time() - 30 * 86400,))


# ---------- sessions ----------

def _h(token):
    return hashlib.sha256(token.encode()).hexdigest()


def new_session(user_id, ip, ua, remember, mfa_pending=False):
    token = secrets.token_urlsafe(32)
    now = time.time()
    ttl = LONG_TTL if remember else SHORT_TTL
    if mfa_pending:
        ttl = 300
    prev = db.q1("SELECT space FROM sessions WHERE user_id=? ORDER BY last_seen DESC LIMIT 1", (user_id,))
    db.run("INSERT INTO sessions (token_hash, user_id, created, last_seen, expires, ip, ua, space, mfa_pending, remember) "
           "VALUES (?,?,?,?,?,?,?,?,?,?)",
           (_h(token), user_id, now, now, now + ttl, ip, ua[:200], (prev or {}).get("space", "live"),
            1 if mfa_pending else 0, 1 if remember else 0))
    return token, ttl


def get_session(token):
    if not token:
        return None
    s = db.q1("SELECT * FROM sessions WHERE token_hash=?", (_h(token),))
    now = time.time()
    if not s:
        return None
    if s["expires"] < now or (now - s["last_seen"] > IDLE_TIMEOUT and s["expires"] - s["created"] <= SHORT_TTL):
        db.run("DELETE FROM sessions WHERE token_hash=?", (s["token_hash"],))
        return None
    if now - s["last_seen"] > 60:
        db.run("UPDATE sessions SET last_seen=? WHERE token_hash=?", (now, s["token_hash"]))
    return s


def set_space(token, space):
    db.run("UPDATE sessions SET space=? WHERE token_hash=?", (space, _h(token)))


def end_session(token):
    db.run("DELETE FROM sessions WHERE token_hash=?", (_h(token),))


def end_all_sessions(user_id, keep_token=None):
    if keep_token:
        db.run("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (user_id, _h(keep_token)))
    else:
        db.run("DELETE FROM sessions WHERE user_id=?", (user_id,))


def list_sessions(user_id, current_token):
    out = []
    for s in db.q("SELECT * FROM sessions WHERE user_id=? AND mfa_pending=0 ORDER BY last_seen DESC", (user_id,)):
        out.append({"created": s["created"], "last_seen": s["last_seen"], "ip": s["ip"], "ua": s["ua"],
                    "current": s["token_hash"] == _h(current_token or "")})
    return out


# ---------- TOTP ----------

def new_totp_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_at(secret, counter):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = mac[-1] & 0x0F
    code = (struct.unpack(">I", mac[o:o + 4])[0] & 0x7FFFFFFF) % 1000000
    return "%06d" % code


def _totp_step(secret, code):
    """The time step the code matches (current +/-1), or None."""
    code = "".join(ch for ch in str(code) if ch.isdigit())
    if len(code) != 6 or not secret:
        return None
    step = int(time.time() // 30)
    for d in (-1, 0, 1):
        if hmac.compare_digest(totp_at(secret, step + d), code):
            return step + d
    return None


def verify_totp(secret, code):
    """Check a code and burn its time step: each code (and any earlier one) works at most once."""
    step = _totp_step(secret, code)
    if step is None:
        return False
    with db._write_lock:
        last = db.get_setting("_auth", "totp_last_step") or 0
        if step <= last:
            return False
        db.set_setting("_auth", "totp_last_step", step)
    return True


def new_recovery_codes():
    codes = ["%s-%s" % (secrets.token_hex(2), secrets.token_hex(2)) for _ in range(10)]
    return codes, [hashlib.sha256(c.encode()).hexdigest() for c in codes]


def use_recovery_code(user, code):
    h = hashlib.sha256(code.strip().lower().encode()).hexdigest()
    stored = json.loads(user.get("recovery") or "[]")
    if h in stored:
        stored.remove(h)
        db.run("UPDATE users SET recovery=? WHERE id=?", (json.dumps(stored), user["id"]))
        db.audit("mfa", "recovery code used (%d left)" % len(stored))
        return True
    return False
