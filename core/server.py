"""HTTP server: static shell + JSON API. Python standard library only."""
import json
import mimetypes
import os
import threading
import traceback
import urllib.parse
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import api, auth, db, demo, engine  # noqa: F401  (importing api registers every route)
from .api.common import ROUTES, HTTPError
from .jobs import worker

STATIC = os.path.join(db.ROOT, "static")
COOKIE = "vantage_session"
MAX_BODY = 8 * 1024 * 1024

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
       "base-uri 'none'; form-action 'self'; object-src 'none'")


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
                with engine.request_scope():
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
