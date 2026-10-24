"""Backend tests: auth, persistence, feeds parsing and the HTTP API, standard library only.

    python3 -m unittest discover -s tests

Every test runs against a throwaway data directory, and outbound HTTP is stubbed to fail,
so nothing touches the network or your real database.
"""
import datetime as dt
import gzip
import http.client
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = tempfile.mkdtemp(prefix="vantage-test-")
os.environ["VANTAGE_DATA"] = DATA
sys.path.insert(0, ROOT)

from core import auth, db, engine, feeds, intel, server  # noqa: E402

_urlopen = feeds.urllib.request.urlopen


def _offline(*a, **k):
    raise OSError("network disabled in tests")


feeds.urllib.request.urlopen = _offline
PASSWORD = "Correct-horse-battery-9"


def reset_db():
    db.close()
    for f in os.listdir(DATA):
        p = os.path.join(DATA, f)
        try:
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
        except FileNotFoundError:
            pass  # a -wal/-shm file SQLite removed itself when a request thread closed its connection
    db.init()


def tearDownModule():
    shutil.rmtree(DATA, ignore_errors=True)


# ---------------------------------------------------------------------------
# auth
# ---------------------------------------------------------------------------

class AuthTests(unittest.TestCase):
    def setUp(self):
        reset_db()

    def test_password_roundtrip(self):
        h = auth.hash_password(PASSWORD)
        self.assertTrue(auth.verify_password(PASSWORD, h))
        self.assertFalse(auth.verify_password(PASSWORD + "x", h))
        self.assertFalse(auth.verify_password(PASSWORD, "garbage"))

    def test_totp_code_works_once(self):
        secret = auth.new_totp_secret()
        code = auth.totp_at(secret, int(time.time() // 30))
        self.assertTrue(auth.verify_totp(secret, code))
        self.assertFalse(auth.verify_totp(secret, code), "a seen code must not be accepted again")
        older = auth.totp_at(secret, int(time.time() // 30) - 1)
        self.assertFalse(auth.verify_totp(secret, older), "an earlier step must not be accepted after a later one")

    def test_totp_rejects_wrong_codes(self):
        secret = auth.new_totp_secret()
        self.assertFalse(auth.verify_totp(secret, "000000" if auth.totp_at(secret, int(time.time() // 30)) != "000000" else "111111"))
        self.assertFalse(auth.verify_totp(secret, "12345"))
        self.assertFalse(auth.verify_totp(None, "123456"))

    def test_lockout_counts_long_usernames(self):
        name = "x" * 200
        for _ in range(6):
            auth.record_attempt("10.0.0.%d" % _, name, False)  # distinct IPs: only the username counter can trip
        self.assertGreater(auth.lockout_remaining("10.9.9.9", name), 0)

    def test_setup_code_required(self):
        code = auth.setup_code()
        self.assertEqual(auth.create_user("pedrum", PASSWORD, "WRONG"), "Setup code is incorrect.")
        self.assertIsNone(auth.create_user("pedrum", PASSWORD, code))
        self.assertTrue(auth.has_user())
        self.assertIsNone(auth.setup_code())


# ---------------------------------------------------------------------------
# persistence
# ---------------------------------------------------------------------------

class DbTests(unittest.TestCase):
    def setUp(self):
        reset_db()

    def test_update_merges_and_logs_revisions(self):
        r = db.create_record("live", "note", {"title": "a", "text": "b"})
        db.update_record("live", r["id"], {"text": "c"})
        cur = db.get_record("live", r["id"])
        self.assertEqual((cur["title"], cur["text"]), ("a", "c"))
        self.assertEqual([x["action"] for x in db.revisions(r["id"])], ["create", "update"])

    def test_get_record_filters_space_and_kind(self):
        r = db.create_record("live", "note", {"title": "a"})
        self.assertIsNone(db.get_record("demo", r["id"]))
        self.assertIsNone(db.get_record("live", r["id"], "decision"))
        self.assertIsNotNone(db.get_record("live", r["id"], "note"))

    def test_concurrent_merges_keep_every_field(self):
        r = db.create_record("live", "note", {})

        def put(i):
            db.update_record("live", r["id"], {"f%d" % i: i})
        ts = [threading.Thread(target=put, args=(i,)) for i in range(20)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        cur = db.get_record("live", r["id"])
        self.assertEqual(sorted(k for k in cur if k.startswith("f")), sorted("f%d" % i for i in range(20)))

    def test_migration_upgrades_old_sessions_table(self):
        db.close()
        os.remove(db.DB_PATH)
        c = sqlite3.connect(db.DB_PATH)
        c.execute("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER, created REAL, last_seen REAL, "
                  "expires REAL, ip TEXT, ua TEXT, space TEXT DEFAULT 'live', mfa_pending INTEGER DEFAULT 0)")
        c.commit()
        c.close()
        db.init()
        db.init()  # idempotent
        cols = [r["name"] for r in db.q("PRAGMA table_info(sessions)")]
        self.assertIn("remember", cols)


# ---------------------------------------------------------------------------
# feeds + calendar parsing
# ---------------------------------------------------------------------------

def _ics(rrule, start="20260131T090000Z"):
    return "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:x\r\nDTSTART:%s\r\n%sEND:VEVENT\r\nEND:VCALENDAR\r\n" % (
        start, ("RRULE:%s\r\n" % rrule) if rrule else "")


class CalendarTests(unittest.TestCase):
    def expand(self, rrule, start):
        s0 = dt.datetime(2026, 1, 31, 9, tzinfo=dt.timezone.utc)
        return [s for s, _ in feeds._expand(start, None, False, rrule, s0 - dt.timedelta(days=1), s0 + dt.timedelta(days=400))]

    def test_monthly_on_the_31st_skips_short_months(self):
        got = self.expand("FREQ=MONTHLY;COUNT=4", "2026-01-31T09:00:00+00:00")
        self.assertEqual([g[:10] for g in got], ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"])

    def test_yearly_feb_29_only_in_leap_years(self):
        s0 = dt.datetime(2024, 2, 29, tzinfo=dt.timezone.utc)
        got = list(feeds._expand("2024-02-29", None, True, "FREQ=YEARLY", s0, s0 + dt.timedelta(days=365 * 5)))
        self.assertEqual([g for g, _ in got], ["2024-02-29", "2028-02-29"])

    def test_malformed_rrule_keeps_first_occurrence(self):
        self.assertEqual(len(self.expand("FREQ=WEEKLY;COUNT=abc", "2026-01-31T09:00:00+00:00")), 1)

    def test_user_monthly_event_clamps_without_drift(self):
        ev = {"start": "2026-01-31", "all_day": True, "recur": "monthly"}
        got = [d for d, _ in intel._expand_user_event(ev, dt.date(2026, 1, 1), dt.date(2026, 4, 30))]
        self.assertEqual(got, ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"])

    def test_malformed_user_event_is_skipped(self):
        self.assertEqual(intel._expand_user_event({"start": "not a date"}, dt.date(2026, 1, 1), dt.date(2026, 2, 1)), [])


class UrlGuardTests(unittest.TestCase):
    def test_private_and_local_hosts_are_refused(self):
        for url in ("https://127.0.0.1/cal.ics", "https://localhost/cal.ics", "https://10.1.2.3/x", "https://192.168.1.1/x",
                    "https://169.254.169.254/latest", "https://[::1]/x", "ftp://example.com/x"):
            with self.assertRaises(feeds.BlockedURL, msg=url):
                feeds.check_public(url)

    def test_public_ip_is_allowed(self):
        feeds.check_public("https://8.8.8.8/cal.ics")

    def test_fetch_ics_never_reaches_a_private_host(self):
        with self.assertRaises(feeds.BlockedURL):
            feeds.fetch_ics("webcal://127.0.0.1:1/cal.ics")


class AlertTests(unittest.TestCase):
    def setUp(self):
        reset_db()

    def fire(self):
        intel._alert("live", "k1", "price", "t", {}, .5, .5, .5, .5)
        return db.q1("SELECT status, updated FROM alerts WHERE key='k1'")

    def test_stale_alert_reopens_when_it_fires_again(self):
        self.fire()
        db.run("UPDATE alerts SET status='stale'")
        self.assertEqual(self.fire()["status"], "open")

    def test_snooze_holds_then_expires(self):
        self.fire()
        db.run("UPDATE alerts SET status='snoozed', updated=?", (time.time() - 60,))
        self.assertEqual(self.fire()["status"], "snoozed", "still snoozed within the window")
        db.run("UPDATE alerts SET updated=?", (time.time() - intel.SNOOZE - 60,))
        self.assertEqual(self.fire()["status"], "open")

    def test_dismissed_stays_dismissed(self):
        self.fire()
        db.run("UPDATE alerts SET status='dismissed'")
        self.assertEqual(self.fire()["status"], "dismissed")


class PortfolioScopeTests(unittest.TestCase):
    def setUp(self):
        reset_db()

    def test_portfolio_is_built_once_per_request(self):
        calls = []
        real = engine._portfolio
        engine._portfolio = lambda space, force=False: calls.append(space) or {"space": space}
        try:
            with engine.request_scope():
                engine.portfolio("live")
                engine.portfolio("live")
                engine.portfolio("demo")
                engine.portfolio("live", force=True)
            engine.portfolio("live")
        finally:
            engine._portfolio = real
        self.assertEqual(calls, ["live", "demo", "live", "live"])


class _Bomb(BaseHTTPRequestHandler):
    payload = gzip.compress(b"\0" * (4 * 1024 * 1024))

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(self.payload)))
        self.end_headers()
        self.wfile.write(self.payload)

    def log_message(self, *a):
        pass


class HttpGetTests(unittest.TestCase):
    def test_decompressed_size_is_capped(self):
        os.environ["no_proxy"] = os.environ["NO_PROXY"] = "127.0.0.1"
        srv = ThreadingHTTPServer(("127.0.0.1", 0), _Bomb)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        feeds.urllib.request.urlopen = _urlopen
        try:
            url = "http://127.0.0.1:%d/" % srv.server_address[1]
            with self.assertRaises(feeds.ResponseTooLarge):
                feeds.http_get(url, limit=1024 * 1024)
            self.assertEqual(len(feeds.http_get(url, limit=8 * 1024 * 1024)), 4 * 1024 * 1024)
        finally:
            feeds.urllib.request.urlopen = _offline
            srv.shutdown()


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------

class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.httpd.daemon_threads = True
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.port = cls.httpd.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def setUp(self):
        reset_db()
        self.cookie = None
        code = auth.setup_code()
        self.assertIsNone(auth.create_user("pedrum", PASSWORD, code))

    # -- helpers
    def call(self, method, path, body=None, raw=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"X-Vantage": "1", "Content-Type": "application/json"}
        if self.cookie:
            h["Cookie"] = self.cookie
        h.update(headers or {})
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        out = r.read()
        sc = r.getheader("Set-Cookie")
        if sc:
            self.cookie = sc.split(";")[0]
        c.close()
        return r.status, (json.loads(out) if out else None)

    def login(self, remember=False):
        st, out = self.call("POST", "/api/login", {"username": "pedrum", "password": PASSWORD, "remember": remember})
        self.assertEqual(st, 200, out)
        return out

    # -- request parsing
    def test_non_object_body_is_400(self):
        self.login()
        for raw in (b"[1,2]", b'"x"', b"3", b"{bad"):
            st, out = self.call("POST", "/api/settings", raw=raw)
            self.assertEqual(st, 400, (raw, out))

    def test_negative_content_length_is_400(self):
        st, _ = self.call("POST", "/api/login", raw=b"", headers={"Content-Length": "-1"})
        self.assertEqual(st, 400)

    def test_non_string_credentials_are_400(self):
        st, _ = self.call("POST", "/api/login", {"username": 5, "password": PASSWORD})
        self.assertEqual(st, 400)

    def test_bad_query_number_is_400(self):
        self.login()
        st, _ = self.call("GET", "/api/briefing?hours=abc")
        self.assertEqual(st, 400)

    def test_bad_scenario_input_is_400(self):
        self.login()
        st, _ = self.call("POST", "/api/scenario", {"inputs": {"rates": "lots"}})
        self.assertEqual(st, 400)

    def test_csrf_header_required(self):
        st, _ = self.call("POST", "/api/login", {"username": "pedrum", "password": PASSWORD}, headers={"X-Vantage": "0"})
        self.assertEqual(st, 403)

    # -- auth flow
    def test_login_and_logout(self):
        self.assertEqual(self.call("GET", "/api/r/note")[0], 401)
        self.login()
        self.assertEqual(self.call("GET", "/api/r/note")[0], 200)
        self.call("POST", "/api/logout")
        self.assertEqual(self.call("GET", "/api/r/note")[0], 401)

    def test_wrong_password_locks_out(self):
        for _ in range(5):
            st, _ = self.call("POST", "/api/login", {"username": "pedrum", "password": "nope"})
            self.assertEqual(st, 401)
        st, _ = self.call("POST", "/api/login", {"username": "pedrum", "password": PASSWORD})
        self.assertEqual(st, 429)

    def test_mfa_flow_keeps_remember_me_on_the_session(self):
        secret = auth.new_totp_secret()
        db.run("UPDATE users SET totp_secret=?, totp_enabled=1", (secret,))
        out = self.login(remember=True)
        self.assertTrue(out["mfa"])
        self.assertEqual(self.call("GET", "/api/r/note")[0], 401, "MFA-pending sessions are not signed in")
        self.assertEqual(db.q("SELECT key FROM settings WHERE space='_auth' AND key LIKE 'remember:%'"), [])
        st, _ = self.call("POST", "/api/mfa", {"code": auth.totp_at(secret, int(time.time() // 30))})
        self.assertEqual(st, 200)
        s = db.q1("SELECT * FROM sessions WHERE mfa_pending=0")
        self.assertGreater(s["expires"] - s["created"], auth.SHORT_TTL, "remember me survives the MFA step")
        self.assertEqual(self.call("GET", "/api/r/note")[0], 200)

    # -- records
    def test_record_crud(self):
        self.login()
        st, rec = self.call("POST", "/api/r/note", {"title": "hello"})
        self.assertEqual(st, 200)
        st, got = self.call("GET", "/api/r/note/" + rec["id"])
        self.assertEqual(got["title"], "hello")
        self.assertEqual(self.call("PUT", "/api/r/note/" + rec["id"], {"text": "x"})[1]["text"], "x")
        self.assertEqual(self.call("DELETE", "/api/r/note/" + rec["id"])[0], 200)
        self.assertEqual(self.call("GET", "/api/r/note/" + rec["id"])[0], 404)

    def test_url_kind_must_match_the_record(self):
        self.login()
        _, rec = self.call("POST", "/api/r/note", {"title": "n"})
        for method, path in (("GET", "/api/r/contact/%s"), ("GET", "/api/r/contact/%s/revisions"),
                             ("PUT", "/api/r/contact/%s"), ("DELETE", "/api/r/contact/%s")):
            st, _ = self.call(method, path % rec["id"], {} if method == "PUT" else None)
            self.assertEqual(st, 404, (method, path))

    def _old_decision(self):
        _, rec = self.call("POST", "/api/r/decision", {"title": "Buy X", "rationale": "cheap", "decision": "buy"})
        db.run("UPDATE records SET created=? WHERE id=?", (time.time() - 2 * 86400, rec["id"]))
        return rec["id"]

    def test_decision_lock(self):
        self.login()
        did = self._old_decision()
        self.assertEqual(self.call("PUT", "/api/r/decision/" + did, {"rationale": "hindsight"})[0], 409)
        self.assertEqual(self.call("PUT", "/api/r/note/" + did, {"rationale": "hindsight"})[0], 404, "kind swap can't skip the lock")
        st, out = self.call("PUT", "/api/r/decision/%s?replace=1" % did, {"reviews": [{"note": "ok"}]})
        self.assertEqual(st, 200)
        self.assertEqual((out["rationale"], out["title"]), ("cheap", "Buy X"), "a full replace keeps the locked fields")
        self.assertEqual(out["reviews"], [{"note": "ok"}])

    # -- import
    def test_import_validates_and_counts(self):
        self.login()
        body = {"vantage_export": 1, "records": {
            "note": [{"id": "not_1", "title": "ok"}, "junk", {"id": "bad id!", "title": "x"}],
            "holding": [{"ticker": "abc", "quantity": "lots"}, {"ticker": "xyz", "quantity": "3"}],
        }}
        st, out = self.call("POST", "/api/import", body)
        self.assertEqual(st, 200, out)
        self.assertEqual(out, {"imported": 2, "skipped": 3})
        h = db.list_records("live", "holding")
        self.assertEqual((h[0]["ticker"], h[0]["quantity"]), ("XYZ", 3.0))
        st, _ = self.call("POST", "/api/import", {"vantage_export": 1, "records": {"note": "nope"}})
        self.assertEqual(st, 400)


if __name__ == "__main__":
    unittest.main()
