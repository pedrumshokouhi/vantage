#!/usr/bin/env python3
"""Vantage: a private personal command center.

    python3 vantage.py                 # http://localhost:8790 (this machine only)
    python3 vantage.py --port 9000
    python3 vantage.py --host 0.0.0.0  # LAN; put HTTPS in front (Tailscale / Cloudflare Tunnel)
    python3 vantage.py --reset-password
"""
import argparse
import getpass
import os
import sys


def main():
    ap = argparse.ArgumentParser(description="Vantage personal command center")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--data", help="data directory (default: ./data next to this file)")
    ap.add_argument("--reset-password", action="store_true", help="set a new password from the terminal (also disables MFA)")
    a = ap.parse_args()
    if a.data:
        os.environ["VANTAGE_DATA"] = os.path.abspath(a.data)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from core import auth, db, server
    if a.reset_password:
        db.init()
        u = db.q1("SELECT * FROM users LIMIT 1")
        if not u:
            sys.exit("No account yet. Start the server and complete setup in the browser.")
        pw = getpass.getpass("New password for %s: " % u["username"])
        probs = auth.password_problems(pw, u["username"])
        if probs:
            sys.exit(" ".join(probs))
        if getpass.getpass("Repeat: ") != pw:
            sys.exit("Passwords did not match.")
        db.run("UPDATE users SET pw_hash=?, totp_enabled=0, totp_secret=NULL WHERE id=?", (auth.hash_password(pw), u["id"]))
        auth.end_all_sessions(u["id"])
        db.audit("password_reset_cli", u["username"])
        print("Password updated, MFA disabled, all sessions signed out.")
        return
    server.serve(a.host, a.port)


if __name__ == "__main__":
    main()
