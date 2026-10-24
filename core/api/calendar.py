"""Calendar, week ahead, meeting prep and calendar subscriptions."""
import datetime as dt
import re
import time
import urllib.parse

from .. import ai, db, feeds, intel
from .common import HTTPError, route


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
