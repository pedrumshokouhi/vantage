"""Chief of staff, search, radar and the decision journal."""
import time

from .. import cos, db, intel
from .common import HTTPError, route


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
