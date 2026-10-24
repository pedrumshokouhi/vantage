"""Portfolio, holdings, CSV import, scenarios and SEC filings."""
import csv
import io
import json
import time

from .. import ai, db, engine, feeds, intel, kb
from ..jobs import _13f
from .common import HTTPError, _num, get_or_404, route


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
