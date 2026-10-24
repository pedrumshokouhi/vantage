"""Home, briefing, stories and the consequence map."""
import datetime as dt
import time

from .. import ai, db, engine, intel
from .common import HTTPError, int_param, need, route


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
