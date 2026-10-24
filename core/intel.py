"""Briefing, calendar, relationships, priorities, radar, 'since last visit' and
the retrieval layer behind the chief of staff."""
import calendar as _cal
import datetime as dt
import hashlib
import json
import math
import re
import time
from collections import Counter, defaultdict

from . import db, engine, feeds, kb

DAY = 86400


def _now():
    return time.time()


def _norm(s):
    return re.sub(r"[^a-z0-9 ]", " ", (s or "").lower()).strip()


_CORP = re.compile(r"\b(inc|corp|corporation|co|ltd|limited|plc|group|holdings?|the|class [a-c]|common|shares|company|sa|ag|nv|lp|trust|etf|index|fund)\b")


def company_key(name):
    s = _CORP.sub(" ", _norm(name))
    return re.sub(r"\s+", " ", s).strip()


# ---------------------------------------------------------------------------
# Entity mentions (holdings, watchlist, contacts' organisations, interests)
# ---------------------------------------------------------------------------

GENERIC_WORDS = set("""canadian american royal national first general united international global bank energy digital advanced
applied natural resources financial capital group american canada toronto new york pacific atlantic north south east west
alphabet meta apple amazon""".split()) - {"alphabet", "meta", "apple", "amazon"}
GENERIC_ORGS = {"independent", "self employed", "self-employed", "freelance", "stealth", "retired", "none", "n a", "various", "consultant"}


def name_terms(name):
    """Distinctive lowercase phrases for a company name ('Canadian Natural Resources' -> the full phrase,
    'Shopify Inc.' -> 'shopify'). Avoids generic single words that would match unrelated news."""
    ck = company_key(name)
    if not ck or len(ck) < 3:
        return set()
    words = ck.split(" ")
    out = {ck} if len(ck) >= 4 else set()
    if len(words) > 1 and len(words[0]) >= 5 and words[0] not in GENERIC_WORDS:
        out.add(words[0])
    return out


def entities(space, port=None):
    port = port or engine.portfolio(space)
    ents = []
    for r in port["holdings"]:
        t = (r["ticker"] or "").split(".")[0].replace("-B", "").replace("-A", "")
        tick = {t} if len(t) >= 2 and t not in ("CASH",) and not t.startswith("^") else set()
        ents.append({"kind": "holding", "id": r["id"], "label": r["ticker"] or r["name"], "terms": name_terms(r["name"]),
                     "tickers": tick, "weight": r["weight"]})
    for w in db.list_records(space, "watch"):
        t = (w.get("ticker") or "").split(".")[0]
        ents.append({"kind": "watch", "id": w["id"], "label": w.get("ticker") or w.get("name"), "terms": name_terms(w.get("name") or ""),
                     "tickers": {t} if len(t) >= 2 else set(), "weight": .03})
    orgs = defaultdict(list)
    for c in db.list_records(space, "contact"):
        o = company_key(c.get("org") or "")
        if len(o) >= 4 and o not in GENERIC_ORGS:
            orgs[o].append(c)
    for o, cs in orgs.items():
        ents.append({"kind": "org", "id": cs[0]["id"], "label": cs[0].get("org"), "terms": {o}, "tickers": set(),
                     "contacts": [c["id"] for c in cs], "weight": .02})
    for kw in db.get_setting(space, "interests") or []:
        if len(kw) >= 2:
            ents.append({"kind": "interest", "id": kw, "label": kw, "terms": {kw.lower()} if len(kw) > 3 else set(),
                         "tickers": {kw} if len(kw) <= 3 else set(), "weight": .01})
    return ents


def mentions(text, ents):
    """Phrase terms match case-insensitively; tickers and short acronyms only as exact uppercase tokens."""
    t = " " + _norm(text) + " "
    raw = text or ""
    out = []
    for e in ents:
        hit = any(term and re.search(r"\b%s\b" % re.escape(term), t) for term in e["terms"])
        if not hit:
            hit = any(tk and re.search(r"(?<![A-Za-z0-9$])\$?%s(?![A-Za-z0-9])" % re.escape(tk), raw) for tk in e.get("tickers") or ())
        if hit:
            out.append(e)
    return out


# ---------------------------------------------------------------------------
# Morning briefing
# ---------------------------------------------------------------------------

def stories(space, hours=36, limit=40, port=None):
    port = port or engine.portfolio(space)
    ents = entities(space, port)
    rows = db.q("SELECT * FROM news WHERE published>? ORDER BY published DESC", (_now() - hours * 3600,))
    clusters = defaultdict(list)
    for r in rows:
        clusters[r["cluster"] or r["id"]].append(r)
    seen = {r["key"] for r in db.q("SELECT key FROM seen WHERE space=? AND key LIKE 'story:%'", (space,))}
    weights = db.get_setting(space, "topic_weights") or {}
    muted = [m.lower() for m in (db.get_setting(space, "muted") or [])]
    exp = port["exposures"]
    out = []
    for cid, items in clusters.items():
        items.sort(key=lambda r: r["published"])
        lead = max(items, key=lambda r: (r["feed"] in ("fed", "boc"), len(r["summary"] or ""), r["published"]))
        text = " ".join(i["title"] + " " + (i["summary"] or "") for i in items[:6])
        if any(m in text.lower() for m in muted):
            continue
        srcs = sorted({i["source"] for i in items})
        topic = Counter(i["topic"] for i in items).most_common(1)[0][0]
        shocks = engine.detect_shocks(text)
        rel_port = 0.0
        for s in shocks:
            for f, v in s["shock"]["impulse"].items():
                rel_port += abs(exp.get(f, {}).get("value", 0) * v)
        ment = mentions(text, ents)
        age_h = (_now() - items[-1]["published"]) / 3600
        why = []
        score = math.log2(1 + len(srcs)) * 1.2
        if len(srcs) > 1:
            why.append("covered by %d outlets" % len(srcs))
        score += 1.5 * math.exp(-age_h / 14)
        if rel_port > .05:
            score += min(3, rel_port * 6)
            why.append("touches drivers your portfolio is exposed to (%s)" % ", ".join(s["shock"]["label"].lower() for s in shocks[:2]))
        hold_m = [m for m in ment if m["kind"] in ("holding", "watch")]
        if hold_m:
            score += 2.5
            why.append("mentions " + ", ".join(sorted({m["label"] for m in hold_m})))
        org_m = [m for m in ment if m["kind"] == "org"]
        if org_m:
            score += 1.2
            why.append("involves an organisation in your network (%s)" % ", ".join(sorted({m["label"] for m in org_m})))
        int_m = [m for m in ment if m["kind"] == "interest"]
        if int_m:
            score += 1.0
            why.append("matches your interests (%s)" % ", ".join(sorted({m["label"] for m in int_m})))
        if lead["feed"] in ("fed", "boc"):
            score += 1.5
            why.append("official central-bank release")
        score *= float(weights.get(topic, 1.0))
        out.append({
            "id": cid, "title": lead["title"], "summary": lead["summary"], "topic": topic, "link": lead["link"],
            "source": lead["source"], "published": lead["published"], "first": items[0]["published"], "updated": items[-1]["published"],
            "sources": [{"source": i["source"], "title": i["title"], "link": i["link"], "published": i["published"]} for i in sorted(items, key=lambda x: -x["published"])[:8]],
            "n_sources": len(srcs), "n_items": len(items), "score": score, "why": why,
            "shocks": [{"label": s["shock"]["label"], "dir": s["dir"]} for s in shocks],
            "mentions": [{"kind": m["kind"], "label": m["label"], "id": m["id"]} for m in ment],
            "seen": ("story:" + cid) in seen, "official": lead["feed"] in ("fed", "boc"),
        })
    out.sort(key=lambda s: -s["score"])
    return out[:limit]


def analyze_story(space, s, port):
    """Five-part structured explanation. Each part carries its epistemic label."""
    shocks = engine.detect_shocks(s["title"] + " " + (s.get("summary") or ""))
    parts = {"happened": {"label": "fact", "text": s.get("summary") or s["title"],
                          "src": "%s, %s" % (s["source"], time.strftime("%d %b %H:%M", time.localtime(s["published"])))}}
    if shocks:
        sh = shocks[0]["shock"]
        d = shocks[0]["dir"]
        parts["matters"] = {"label": "interpretation", "text": "Reads as: %s%s. %s" % (
            sh["label"], "" if d > 0 else " (easing direction)", sh["markets"])}
        parts["effects"] = {"label": "interpretation", "people": sh["people"], "business": sh["business"], "markets": sh["markets"]}
        parts["watch"] = {"label": "forecast", "items": sh["watch"], "counter": sh["counter"]}
        imp = {}
        for x in shocks:
            for f, v in x["shock"]["impulse"].items():
                imp[f] = imp.get(f, 0) + v * x["dir"]
        hits = []
        for r in port["holdings"]:
            sc = sum(r["sens"].get(f, 0) * v for f, v in imp.items())
            if abs(sc) >= .25:
                hits.append((r["ticker"] or r["name"], sc, r["weight"]))
        hits.sort(key=lambda x: -abs(x[1]) * (x[2] + .01))
        parts["mine"] = {"label": "calculated", "items": [{"ticker": t, "tilt": sc, "weight": w} for t, sc, w in hits[:5]],
                         "text": "No holdings with a meaningful sensitivity to this development." if not hits else ""}
    else:
        parts["matters"] = {"label": "interpretation",
                            "text": "No known economic transmission pattern detected in this story. "
                                    "It may matter for reasons the built-in model does not cover; ask Claude for a deeper read."}
        parts["mine"] = {"label": "calculated", "items": [], "text": "No mapped driver exposure."}
    direct = [m for m in s.get("mentions", []) if m["kind"] in ("holding", "watch", "org")]
    if direct:
        parts["mine"]["direct"] = direct
    return parts


def macro(space):
    boc = feeds.refresh_boc() or {}
    se = boc.get("series") or {}
    mk = feeds.quotes([t for t, _ in feeds.MARKET_TICKERS])

    def last(k):
        s = se.get(k) or []
        return {"value": s[-1][1], "date": s[-1][0], "prev": s[-2][1] if len(s) > 1 else None,
                "m1": s[-22][1] if len(s) > 22 else None} if s else None
    policy = last("V39079")
    usdcad = last("FXUSDCAD")
    cpi = last("STATIC_TOTALCPICHANGE")
    trim = last("CPI_TRIM")
    y10 = last("BD.CDN.10YR.DQ.YLD")
    markets = []
    for t, label in feeds.MARKET_TICKERS:
        q = mk.get(t)
        if q and q.get("price") is not None:
            ch = (q["price"] / q["prev_close"] - 1) if q.get("prev_close") else None
            markets.append({"ticker": t, "label": label, "price": q["price"], "change": ch, "currency": q["currency"],
                            "time": q.get("market_time"), "spark": [p[1] for p in q["series"][-30:]]})
    practical = []
    if policy:
        prime = policy["value"] + 2.2
        practical.append({"label": "calculated", "title": "Borrowing: Canadian prime rate is about %.2f%%" % prime,
                          "text": "Big-bank prime has sat 2.20 points above the BoC target rate since 2022. "
                                  "A $500k variable mortgage at prime minus 0.5 costs about $%s/month in interest alone." % format(round(500000 * (prime - .5) / 100 / 12), ","),
                          "src": "Bank of Canada Valet (%s)" % policy["date"]})
    if cpi and policy:
        real = policy["value"] - cpi["value"]
        practical.append({"label": "calculated", "title": "Real policy rate: %+.2f%%" % real,
                          "text": "Policy rate minus headline inflation. %s" % (
                              "Positive means cash savings roughly keep pace with prices; the policy stance is restrictive." if real > 0
                              else "Negative means cash loses purchasing power; policy is still supportive."),
                          "src": "BoC target %.2f%% (%s), CPI %.1f%% y/y (%s)" % (policy["value"], policy["date"], cpi["value"], cpi["date"])})
    if usdcad:
        practical.append({"label": "calculated", "title": "Purchasing power: US$100 costs C$%.2f" % (100 * usdcad["value"]),
                          "text": "%s over the past month. That flows straight into cross-border shopping, travel and the CAD value of US holdings." % (
                              "The loonie is %s by %.1f%%" % ("weaker" if usdcad["m1"] and usdcad["value"] > usdcad["m1"] else "stronger",
                                                           abs(usdcad["value"] / usdcad["m1"] - 1) * 100) if usdcad["m1"] else "Month-ago rate unavailable"),
                          "src": "Bank of Canada daily rate (%s)" % usdcad["date"]})
    return {"boc": {"policy": policy, "usdcad": usdcad, "cpi": cpi, "cpi_trim": trim, "y10": y10},
            "markets": markets, "practical": practical, "fetched": boc.get("fetched"),
            "sources": ["Bank of Canada Valet API", "Yahoo Finance (unofficial, delayed)"]}


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------

def _d(s):
    return dt.date.fromisoformat(s[:10])


def _add_months(d, n):
    """Same day n months later, clamped to the month's last day (Jan 31 -> Feb 28 -> Mar 31, no drift)."""
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return d.replace(year=y, month=m, day=min(d.day, _cal.monthrange(y, m)[1]))


def _expand_user_event(e, start, end):
    s = e.get("start")
    if not s:
        return []
    rec = e.get("recur") or "none"
    all_day = bool(e.get("all_day")) or len(s) <= 10
    try:
        first = _d(s)
        st0 = None if all_day else dt.datetime.fromisoformat(s)
    except (TypeError, ValueError):
        return []  # one malformed event shouldn't take the whole calendar down
    out = []
    dur = None
    if e.get("end") and not all_day:
        try:
            dur = dt.datetime.fromisoformat(e["end"]) - st0
        except (TypeError, ValueError):
            dur = None
    cur = first
    for i in range(800):
        if rec == "monthly":
            cur = _add_months(first, i)
        elif rec == "yearly":
            cur = _add_months(first, 12 * i)
        if cur > end:
            break
        if cur >= start:
            if all_day:
                out.append((cur.isoformat(), None))
            else:
                st = st0.replace(year=cur.year, month=cur.month, day=cur.day)
                out.append((st.isoformat(), (st + dur).isoformat() if dur else None))
        if rec == "none":
            break
        if rec == "daily":
            cur += dt.timedelta(days=1)
        elif rec == "weekly":
            cur += dt.timedelta(days=7)
        elif rec not in ("monthly", "yearly"):
            break
    return out


def _next_birthday(b, start, end):
    try:
        mm, dd = (int(x) for x in b[-5:].split("-"))
    except (ValueError, AttributeError):
        return []
    out = []
    for y in (start.year, start.year + 1):
        try:
            d = dt.date(y, mm, dd)
        except ValueError:
            d = dt.date(y, mm, 28)
        if start <= d <= end:
            out.append(d)
    return out


def calendar(space, start, end, port=None):
    ev = []
    for e in db.list_records(space, "event"):
        for s, en in _expand_user_event(e, start, end):
            ev.append({"id": e["id"] + ":" + s[:10], "rid": e["id"], "title": e.get("title"), "start": s, "end": en,
                       "all_day": bool(e.get("all_day") or len(s) <= 10), "category": e.get("category") or "personal",
                       "location": e.get("location"), "people": e.get("people") or [], "source": "you",
                       "importance": int(e.get("importance") or 2), "notes": e.get("notes"), "tz": e.get("tz"),
                       "prep": e.get("prep") or [], "ref": {"kind": "event", "id": e["id"]}})
    for sub in db.list_records(space, "ics_sub"):
        data, fetched = db.cache_get("ics:" + sub["id"])
        for i, x in enumerate(data or []):
            d = _d(x["start"])
            if start <= d <= end:
                ev.append({"id": "ics:%s:%d" % (sub["id"], i), "title": x["title"], "start": x["start"], "end": x.get("end"),
                           "all_day": x["all_day"], "category": sub.get("category") or "professional", "location": x.get("location"),
                           "notes": x.get("notes"), "source": "calendar: " + (sub.get("name") or "subscribed"), "importance": 2,
                           "readonly": True})
    for c in db.list_records(space, "contact"):
        if c.get("birthday"):
            for d in _next_birthday(c["birthday"], start, end):
                ev.append({"id": "bday:%s:%s" % (c["id"], d), "title": "%s's birthday" % c.get("name"), "start": d.isoformat(),
                           "all_day": True, "category": "birthday", "source": "contacts", "importance": 1 + min(2, int(c.get("closeness") or 2) // 2),
                           "people": [c["id"]], "ref": {"kind": "contact", "id": c["id"]}, "readonly": True})
        for m in c.get("milestones") or []:
            if m.get("date"):
                ds = [_d(m["date"])] if not m.get("yearly") else _next_birthday(m["date"], start, end)
                for d in ds:
                    if start <= d <= end:
                        ev.append({"id": "ms:%s:%s" % (c["id"], d), "title": "%s: %s" % (c.get("name"), m.get("title")),
                                   "start": d.isoformat(), "all_day": True, "category": "milestone", "source": "contacts",
                                   "importance": 2, "people": [c["id"]], "ref": {"kind": "contact", "id": c["id"]}, "readonly": True})
        for cm in c.get("commitments") or []:
            if cm.get("due") and not cm.get("done"):
                d = _d(cm["due"])
                if start <= d <= end:
                    ev.append({"id": "cm:%s:%s" % (c["id"], cm.get("text", "")[:10]), "title": "Promise to %s: %s" % (c.get("name"), cm.get("text")),
                               "start": d.isoformat(), "all_day": True, "category": "follow-up", "source": "contacts",
                               "importance": 3, "people": [c["id"]], "ref": {"kind": "contact", "id": c["id"]}, "readonly": True})
        nf = next_followup(c)
        if nf and start <= nf <= end:
            ev.append({"id": "fu:%s" % c["id"], "title": "Reconnect with %s" % c.get("name"), "start": nf.isoformat(), "all_day": True,
                       "category": "follow-up", "source": "relationship cadence", "importance": 1, "people": [c["id"]],
                       "ref": {"kind": "contact", "id": c["id"]}, "readonly": True})
    for m in kb.computed_market_events(start, end):
        ev.append({"id": "mk:%s:%s" % (m["date"], m["title"][:12]), "title": m["title"], "start": m["date"], "all_day": True,
                   "category": m["category"], "source": "computed schedule", "importance": m["importance"], "notes": m["note"],
                   "url": m.get("url"), "readonly": True})
    for d in db.list_records(space, "decision"):
        if d.get("review_date"):
            rd = _d(d["review_date"])
            if start <= rd <= end:
                ev.append({"id": "dr:" + d["id"], "title": "Review decision: " + (d.get("title") or ""), "start": rd.isoformat(),
                           "all_day": True, "category": "decision", "source": "journal", "importance": 2,
                           "ref": {"kind": "decision", "id": d["id"]}, "readonly": True})
    holdings = db.list_records(space, "holding")
    for h in holdings:
        for cat in h.get("catalysts") or []:
            if cat.get("date"):
                cd = _d(cat["date"])
                if start <= cd <= end:
                    ev.append({"id": "cat:%s:%s" % (h["id"], cat["date"]), "title": "%s: %s" % (h.get("ticker"), cat.get("title")),
                               "start": cat["date"], "all_day": True, "category": "market", "source": "your catalysts",
                               "importance": 3, "ref": {"kind": "holding", "id": h["id"]}, "readonly": True})
        fl, _ = db.cache_get("filings:" + (h.get("ticker") or ""))
        if fl and fl.get("earnings_dates"):
            last = _d(fl["earnings_dates"][0])
            nxt = last + dt.timedelta(days=91)
            while nxt < start - dt.timedelta(days=10):
                nxt += dt.timedelta(days=91)
            if start - dt.timedelta(days=3) <= nxt <= end:
                ev.append({"id": "earn:" + h["id"], "title": "%s earnings (estimated ± 2 weeks)" % h.get("ticker"),
                           "start": nxt.isoformat(), "all_day": True, "category": "market", "source": "estimated from SEC 8-K cadence",
                           "importance": 3, "estimated": True,
                           "notes": "Last earnings 8-K (item 2.02) filed %s. Next date estimated at +91 days; confirm with investor relations." % fl["earnings_dates"][0],
                           "ref": {"kind": "holding", "id": h["id"]}, "readonly": True})
    ev.sort(key=lambda x: (x["start"][:10], 0 if x["all_day"] else 1, x["start"]))
    return ev


def cadence(c):
    if c.get("cadence_days"):
        return int(c["cadence_days"])
    return {5: 30, 4: 45, 3: 90, 2: 180, 1: 365}.get(int(c.get("closeness") or 2), 180)


def next_followup(c):
    if c.get("next_followup"):
        try:
            return _d(c["next_followup"])
        except ValueError:
            return None
    lc = last_contact(c)
    if lc:
        return lc + dt.timedelta(days=cadence(c))
    return None


def last_contact(c):
    dates = [i.get("date") for i in (c.get("interactions") or []) if i.get("date")]
    if c.get("last_contact"):
        dates.append(c["last_contact"])
    if not dates:
        return None
    try:
        return max(_d(x) for x in dates)
    except ValueError:
        return None


def _parse_dt(s):
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.astimezone()
        return d.astimezone()
    except ValueError:
        return None


def week_ahead(space):
    today = dt.date.today()
    end = today + dt.timedelta(days=7)
    evs = calendar(space, today, end)
    days = []
    for i in range(8):
        d = today + dt.timedelta(days=i)
        de = [e for e in evs if e["start"][:10] == d.isoformat()]
        timed = [e for e in de if not e["all_day"]]
        hours = 0.0
        spans = []
        for e in timed:
            s = _parse_dt(e["start"])
            en = _parse_dt(e["end"]) if e.get("end") else (s + dt.timedelta(hours=1) if s else None)
            if s and en:
                hours += (en - s).total_seconds() / 3600
                spans.append((s, en, e))
        conflicts = []
        spans.sort(key=lambda x: x[0])
        for a in range(len(spans)):
            for b in range(a + 1, len(spans)):
                if spans[b][0] < spans[a][1]:
                    conflicts.append([spans[a][2]["title"], spans[b][2]["title"]])
        travel = any(e["category"] == "travel" for e in de)
        load = min(1.0, hours / 7 + len(timed) * .06 + (.35 if travel else 0))
        days.append({"date": d.isoformat(), "events": de, "hours": round(hours, 1), "load": load, "conflicts": conflicts,
                     "market": [e for e in de if e["category"] in ("market", "filing")], "travel": travel})
    prep = []
    for e in evs:
        d = _d(e["start"])
        lead = None
        if e["category"] == "birthday":
            lead, what = 7, "Plan something thoughtful for %s" % e["title"].replace("'s birthday", "")
        elif e.get("people") and e["category"] in ("professional", "personal") and not e["all_day"]:
            lead, what = 1, "Prepare for: %s" % e["title"]
        elif e["category"] == "travel":
            lead, what = 2, "Travel prep: %s (documents, currency, who to see there)" % e["title"]
        elif e["category"] == "market" and e.get("ref", {}).get("kind") == "holding":
            lead, what = 1, "Re-read your thesis before %s" % e["title"]
        elif e["category"] == "decision":
            lead, what = 0, e["title"]
        if lead is None:
            continue
        due = d - dt.timedelta(days=lead)
        prep.append({"event": e, "due": max(due, today).isoformat(), "overdue": due < today, "what": what})
    for e in calendar(space, end, today + dt.timedelta(days=21)):
        if e["category"] == "birthday" and int(e.get("importance") or 1) >= 2:
            due = _d(e["start"]) - dt.timedelta(days=10)
            if due <= end:
                prep.append({"event": e, "due": max(due, today).isoformat(), "overdue": False,
                             "what": "Early heads-up: %s is coming %s" % (e["title"], _d(e["start"]).strftime("%a %d %b"))})
    prep.sort(key=lambda p: p["due"])
    busiest = max(days, key=lambda d: d["load"]) if days else None
    return {"days": days, "prep": prep, "busiest": busiest["date"] if busiest and busiest["load"] > .4 else None,
            "conflicts": sum(len(d["conflicts"]) for d in days),
            "market": [e for d in days for e in d["market"]]}


def prep_brief(space, event_id):
    """Everything to walk into an event prepared."""
    today = dt.date.today()
    evs = calendar(space, today - dt.timedelta(days=60), today + dt.timedelta(days=90))
    e = next((x for x in evs if x["id"] == event_id or x.get("rid") == event_id), None)
    if not e:
        return None
    contacts = {c["id"]: c for c in db.list_records(space, "contact")}
    people = [contacts[p] for p in e.get("people") or [] if p in contacts]
    text = (e.get("title") or "") + " " + (e.get("notes") or "")
    for c in contacts.values():
        if c not in people and c.get("name") and re.search(r"\b%s\b" % re.escape(c["name"].split()[0]), text) and \
                (len(c["name"].split()) < 2 or c["name"].split()[-1] in text):
            people.append(c)
    port = engine.portfolio(space)
    ents = entities(space, port)
    related_news = []
    for p in people:
        org = company_key(p.get("org") or "")
        if len(org) >= 4:
            for n in db.q("SELECT title, link, source, published FROM news WHERE lower(title) LIKE ? ORDER BY published DESC LIMIT 4",
                          ("%" + org + "%",)):
                related_news.append(dict(n, why="mentions %s (%s's organisation)" % (p.get("org"), p.get("name"))))
    holding_m = mentions(text, [x for x in ents if x["kind"] in ("holding", "watch")])
    past = []
    for x in evs:
        if x["id"] != e["id"] and set(x.get("people") or []) & set(p["id"] for p in people) and x["start"] < e["start"]:
            past.append({"title": x["title"], "start": x["start"]})
    points = []
    for p in people:
        open_c = [c for c in p.get("commitments") or [] if not c.get("done")]
        for c in open_c:
            points.append({"text": "Close the loop on your promise: %s" % c.get("text"), "basis": "your commitments to %s" % p["name"], "label": "retrieved"})
        if p.get("interests"):
            points.append({"text": "Shared interests to draw on: %s" % ", ".join(p["interests"][:4]), "basis": "contact profile", "label": "retrieved"})
        last = (p.get("interactions") or [])[-1:] or []
        for i in last:
            points.append({"text": "Pick up from %s: %s" % (i.get("date"), (i.get("notes") or "")[:160]), "basis": "last interaction", "label": "retrieved"})
        if p.get("org"):
            points.append({"text": "Ask how %s is thinking about the next 12 months, and what would make this relationship useful for them." % p["org"],
                           "basis": "suggested", "label": "interpretation"})
    for n in related_news[:2]:
        points.append({"text": "Recent news to acknowledge: %s" % n["title"], "basis": "%s, %s" % (n["source"], time.strftime("%d %b", time.localtime(n["published"]))), "label": "fact"})
    d = _d(e["start"])
    checklist = []
    if e["category"] == "birthday":
        checklist = [{"when": (d - dt.timedelta(days=10)).isoformat(), "task": "Decide on a gift or plan (use their interests)"},
                     {"when": (d - dt.timedelta(days=5)).isoformat(), "task": "Order or book anything that needs lead time"},
                     {"when": d.isoformat(), "task": "Send a personal note in the morning"}]
    elif e["category"] == "travel":
        checklist = [{"when": (d - dt.timedelta(days=7)).isoformat(), "task": "See who you know in the destination (Network → city filter)"},
                     {"when": (d - dt.timedelta(days=2)).isoformat(), "task": "Documents, currency, itinerary"},
                     {"when": (d - dt.timedelta(days=1)).isoformat(), "task": "Confirm meetings and addresses"}]
    else:
        checklist = [{"when": (d - dt.timedelta(days=1)).isoformat(), "task": "Read this brief and your last notes"},
                     {"when": (d - dt.timedelta(days=1)).isoformat(), "task": "Decide the one outcome you want from this"},
                     {"when": d.isoformat(), "task": "After: log the interaction and any promises made"}]
    missing = []
    if not people:
        missing.append("No contacts linked to this event: link attendees to pull in notes and history.")
    for p in people:
        if not p.get("interactions"):
            missing.append("No logged interactions with %s." % p["name"])
    return {"event": e, "people": [{"id": p["id"], "name": p.get("name"), "role": p.get("role"), "org": p.get("org"),
                                    "notes": p.get("notes"), "how_met": p.get("how_met"),
                                    "interactions": (p.get("interactions") or [])[-4:], "commitments": p.get("commitments") or []} for p in people],
            "news": related_news[:6], "holdings": [{"label": m["label"], "id": m["id"]} for m in holding_m], "past": past[-5:],
            "points": points, "checklist": checklist, "missing": missing}


# ---------------------------------------------------------------------------
# Relationships
# ---------------------------------------------------------------------------

SYN = {
    "startup": ["founder", "co-founder", "cofounder", "startup", "start-up", "entrepreneur", "built a company", "ceo"],
    "founder": ["founder", "co-founder", "cofounder", "entrepreneur"],
    "invest": ["investor", "vc", "venture", "partner", "angel", "fund", "capital", "private equity", "pe"],
    "vc": ["venture", "vc", "investor", "partner", "principal"],
    "consult": ["consultant", "consulting", "mckinsey", "bain", "bcg", "deloitte", "advisor"],
    "product": ["product manager", "pm", "product", "head of product"],
    "engineer": ["engineer", "cto", "developer", "technical"],
    "hire": ["recruiter", "talent", "hiring", "head of people"],
    "ai": ["ai", "machine learning", "ml", "llm"],
    "health": ["health", "healthcare", "biotech", "medical", "pharma"],
    "finance": ["finance", "banking", "investment banking", "trader", "hedge fund", "asset management"],
    "real estate": ["real estate", "property", "reit", "developer"],
    "law": ["lawyer", "legal", "counsel", "attorney"],
}


def contact_text(c):
    parts = [c.get(k) or "" for k in ("name", "role", "org", "industry", "city", "country", "notes", "how_met", "community")]
    parts += c.get("tags") or []
    parts += c.get("interests") or []
    parts += c.get("experience") or []
    parts += [i.get("notes") or "" for i in c.get("interactions") or []]
    return " ".join(parts).lower()


def who(space, q):
    contacts = db.list_records(space, "contact")
    byid = {c["id"]: c for c in contacts}
    ql = q.lower()
    city = None
    m = re.search(r"\b(?:in|visiting|around|based in|lives? in|trip to|travell?ing to)\s+([A-Z][a-zA-Z\.\-]+(?:\s+[A-Z][a-zA-Z\.\-]+)?)", q)
    if m:
        city = m.group(1).lower()
    org = None
    m2 = re.search(r"(?:introduce me to|intro to|get into|works? at|at|inside)\s+([A-Z][\w&\.\-]*(?:\s+[A-Z][\w&\.\-]*)*)", q)
    if m2:
        org = m2.group(1).lower()
    terms = set()
    for k, syns in SYN.items():
        if k in ql or any(s in ql for s in syns if len(s) > 3):
            terms.update(syns)
    stop = set("who do i know someone could help me understand with experience building particular industry my network a an the in to of for".split())
    words = [w for w in re.findall(r"[a-z][a-z\-]+", ql) if w not in stop and len(w) > 2]
    results = []
    for c in contacts:
        txt = contact_text(c)
        score, reasons = 0.0, []
        if city:
            cc = " ".join([(c.get("city") or ""), (c.get("country") or "")]).lower()
            if city in cc:
                score += 3
                reasons.append("based in %s" % c.get("city"))
        if org:
            if org in (c.get("org") or "").lower():
                score += 4
                reasons.append("works at %s" % c.get("org"))
            elif org in txt:
                score += 1.5
                reasons.append("notes mention %s" % org)
        for t in terms:
            if re.search(r"\b%s\b" % re.escape(t), txt):
                score += 1.2
                reasons.append("matches “%s”" % t)
                if len(reasons) > 5:
                    break
        for w in words:
            if w not in (city or "") and w not in (org or "") and re.search(r"\b%s" % re.escape(w), txt):
                score += .6
                if not any(w in r for r in reasons):
                    reasons.append("mentions “%s”" % w)
        if score > 0:
            score *= 1 + .08 * int(c.get("closeness") or 2)
            results.append({"id": c["id"], "name": c.get("name"), "role": c.get("role"), "org": c.get("org"), "city": c.get("city"),
                            "closeness": c.get("closeness"), "score": score, "reasons": reasons[:5]})
    results.sort(key=lambda r: -r["score"])
    paths = []
    if org:
        adj = defaultdict(list)
        for c in contacts:
            for link in c.get("connections") or []:
                if link.get("id") in byid:
                    adj[c["id"]].append((link["id"], bool(link.get("verified"))))
                    adj[link["id"]].append((c["id"], bool(link.get("verified"))))
        targets = {c["id"] for c in contacts if org in (c.get("org") or "").lower()}
        for c in contacts:
            if c["id"] in targets:
                paths.append({"path": [{"id": "me", "name": "You"}, {"id": c["id"], "name": c["name"]}], "verified": True,
                              "note": "direct contact"})
        for c in contacts:
            if c["id"] in targets:
                continue
            for nb, ver in adj[c["id"]]:
                if nb in targets:
                    paths.append({"path": [{"id": "me", "name": "You"}, {"id": c["id"], "name": c["name"]},
                                           {"id": nb, "name": byid[nb]["name"]}], "verified": ver,
                                  "note": "%s knows %s at %s" % (c["name"], byid[nb]["name"], byid[nb].get("org")) + ("" if ver else " (unverified)")})
        for c in contacts:
            if c["id"] not in targets and org in contact_text(c) and not any(p["path"][1]["id"] == c["id"] for p in paths):
                paths.append({"path": [{"id": "me", "name": "You"}, {"id": c["id"], "name": c["name"]}, {"id": None, "name": org.title()}],
                              "verified": False, "note": "%s's notes mention %s: possible route, unverified" % (c["name"], org.title())})
    return {"q": q, "parsed": {"city": city, "org": org, "terms": sorted(terms)[:10]}, "results": results[:15], "paths": paths[:10],
            "empty_reason": None if results or paths else "No contacts match. Add roles, industries, cities and notes to contacts to make this sharper."}


def relationship_memory(space, port=None):
    today = dt.date.today()
    contacts = db.list_records(space, "contact")
    out = {"lost_touch": [], "promises": [], "milestones": [], "reasons": []}
    for c in contacts:
        lc = last_contact(c)
        cad = cadence(c)
        if lc:
            gap = (today - lc).days
            if gap > cad:
                out["lost_touch"].append({"id": c["id"], "name": c.get("name"), "org": c.get("org"), "days": gap, "cadence": cad,
                                          "closeness": c.get("closeness"), "overdue": gap - cad})
        elif int(c.get("closeness") or 0) >= 3:
            out["lost_touch"].append({"id": c["id"], "name": c.get("name"), "org": c.get("org"), "days": None, "cadence": cad,
                                      "closeness": c.get("closeness"), "overdue": 0, "note": "no interaction logged yet"})
        for cm in c.get("commitments") or []:
            if not cm.get("done"):
                due = _d(cm["due"]) if cm.get("due") else None
                out["promises"].append({"id": c["id"], "name": c.get("name"), "text": cm.get("text"), "due": cm.get("due"),
                                        "overdue": bool(due and due < today), "made": cm.get("made")})
        if c.get("birthday"):
            for d in _next_birthday(c["birthday"], today, today + dt.timedelta(days=30)):
                out["milestones"].append({"id": c["id"], "name": c.get("name"), "what": "Birthday", "date": d.isoformat(), "days": (d - today).days})
        for m in c.get("milestones") or []:
            if m.get("date"):
                ds = _next_birthday(m["date"], today, today + dt.timedelta(days=45)) if m.get("yearly") else [_d(m["date"])]
                for d in ds:
                    if today <= d <= today + dt.timedelta(days=45):
                        out["milestones"].append({"id": c["id"], "name": c.get("name"), "what": m.get("title"), "date": d.isoformat(), "days": (d - today).days})
    out["lost_touch"].sort(key=lambda x: (-(int(x.get("closeness") or 0)), -(x["overdue"] or 0)))
    out["promises"].sort(key=lambda x: (not x["overdue"], x["due"] or "9999"))
    out["milestones"].sort(key=lambda x: x["days"])
    # reasons to reconnect: their organisation in the news, upcoming trip to their city
    news = db.q("SELECT id, title, link, source, published FROM news WHERE published>? ORDER BY published DESC", (_now() - 3 * DAY,))
    for c in contacts:
        org = company_key(c.get("org") or "")
        if len(org) >= 4:
            for n in news:
                if org not in GENERIC_ORGS and re.search(r"\b%s\b" % re.escape(org), _norm(n["title"])):
                    out["reasons"].append({"id": c["id"], "name": c.get("name"), "kind": "news",
                                           "text": "%s is in the news: “%s”" % (c.get("org"), n["title"]),
                                           "link": n["link"], "src": "%s, %s" % (n["source"], time.strftime("%d %b", time.localtime(n["published"])))})
                    break
    trips = [e for e in calendar(space, today, today + dt.timedelta(days=45)) if e["category"] == "travel"]
    for t in trips:
        dest = _norm((t.get("location") or "") + " " + (t.get("title") or ""))
        for c in contacts:
            city = _norm(c.get("city") or "")
            if len(city) >= 3 and re.search(r"\b%s\b" % re.escape(city), dest):
                out["reasons"].append({"id": c["id"], "name": c.get("name"), "kind": "trip", "group": "trip:" + t["id"],
                                       "text": "You're going to %s on %s; %s is based there." % (c.get("city"), t["start"][:10], c.get("name"))})
    return out


def draft_message(space, contact_id, purpose=""):
    c = db.get_record(space, contact_id)
    if not c:
        return None
    first = (c.get("name") or "").split(" ")[0] or "there"
    lc = last_contact(c)
    hooks = []
    mem = relationship_memory(space)
    for r in mem["reasons"]:
        if r["id"] == contact_id:
            hooks.append(r["text"])
    open_c = [x for x in c.get("commitments") or [] if not x.get("done")]
    lines = ["Hi %s," % first, ""]
    if lc and (dt.date.today() - lc).days > 60:
        lines.append("It's been a while since %s, and you've been on my mind." % lc.strftime("%B"))
    else:
        lines.append("Hope you're doing well.")
    if hooks:
        lines.append(hooks[0].replace("You're going", "I'm going") + ("" if hooks[0].endswith(".") else "."))
    if open_c:
        lines.append("I also still owe you something: %s. Here's where that stands: [add update]." % open_c[0].get("text"))
    if c.get("interests"):
        lines.append("I came across something on %s that made me think of you: [add link or thought]." % c["interests"][0])
    if purpose:
        lines.append(purpose)
    lines += ["", "Would love to catch up properly. Any chance for a coffee or a quick call in the next couple of weeks?", "", "Best,"]
    return {"to": c.get("name"), "email": c.get("email"), "body": "\n".join(lines), "basis": hooks + [x.get("text") for x in open_c],
            "note": "Draft only. Nothing is sent: copy it, edit it, and send it yourself."}


# ---------------------------------------------------------------------------
# Radar
# ---------------------------------------------------------------------------

SNOOZE = 3 * DAY

KIND_LABEL = {"thesis": "Thesis monitor", "price": "Price move", "exposure": "Exposure", "filing": "Filing", "relationship": "Relationship",
              "calendar": "Calendar", "decision": "Decision review", "second_look": "Second look", "investor": "Investor filings"}


def _alert(space, key, kind, title, body, rel, imp, urg, conf, group=None):
    kw = db.get_setting(space, "kind_weights") or {}
    muted = db.get_setting(space, "muted_kinds") or []
    if kind in muted:
        return
    score = (.35 * rel + .3 * imp + .2 * urg + .15 * conf) * float(kw.get(kind, 1.0))
    ex = db.q1("SELECT id, status FROM alerts WHERE space=? AND key=?", (space, key))
    now = _now()
    if ex:
        # A signal that fires again comes back: a stale one at once, a snoozed one once its snooze has run out.
        # A snoozed row keeps its `updated` (the moment it was snoozed) so the snooze can expire; dismissed stays dismissed.
        db.run("UPDATE alerts SET title=?, body=?, relevance=?, impact=?, urgency=?, confidence=?, score=?, "
               "status=CASE WHEN status='stale' OR (status='snoozed' AND updated<?) THEN 'open' ELSE status END, "
               "updated=CASE WHEN status='snoozed' AND updated>=? THEN updated ELSE ? END WHERE id=?",
               (title, json.dumps(body), rel, imp, urg, conf, score, now - SNOOZE, now - SNOOZE, now, ex["id"]))
    else:
        db.run("INSERT INTO alerts (id, space, key, kind, title, body, relevance, impact, urgency, confidence, score, created, updated, status, group_key) "
               "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               ("al_" + hashlib.sha1((space + key).encode()).hexdigest()[:14], space, key, kind, title, json.dumps(body), rel, imp, urg, conf, score, now, now, "open", group or key))


def run_radar(space):
    port = engine.portfolio(space)
    today = dt.date.today()
    st = stories(space, hours=72, limit=120, port=port)
    intel_ents = entities(space, port)
    # thesis monitor
    for r in port["holdings"]:
        th = r.get("thesis") or {}
        if not th.get("why"):
            if r["weight"] >= .05:
                _alert(space, "nothesis:" + r["id"], "second_look", "%s is %.0f%% of your portfolio with no written thesis" % (r["ticker"] or r["name"], r["weight"] * 100),
                       {"why": "Large positions without a recorded reason are hard to review honestly later.",
                        "evidence": ["Weight %.1f%% (calculated from live quote)" % (r["weight"] * 100)], "action": "Write why you own it, what you expect and what would prove you wrong.",
                        "ref": {"kind": "holding", "id": r["id"]}}, .9, .6, .3, 1.0)
            continue
        terms = {t.lower() for t in (th.get("indicators") or []) if len(t) > 2}
        ent = [e for e in intel_ents if e["kind"] == "holding" and e["id"] == r["id"]]
        for s in st:
            txt = _norm(s["title"] + " " + (s.get("summary") or ""))
            nm = mentions(s["title"] + " " + (s.get("summary") or ""), ent) if ent else []
            ind = [t for t in terms if t in txt]
            wrong = [w for w in re.findall(r"[a-z]{5,}", (th.get("wrong_if") or "").lower()) if w in txt and w not in kb_stop]
            if not nm and not (ind and len(ind) >= 2):
                continue
            conf = .35 + .15 * len(ind) + .15 * bool(wrong)
            _alert(space, "thesis:%s:%s" % (r["id"], s["id"]), "thesis",
                   "New evidence to weigh against your %s thesis" % (r["ticker"] or r["name"]),
                   {"why": "You bought %s partly because: “%s”." % (r["ticker"] or r["name"], th["why"][:220]),
                    "latest": "Latest: “%s” (%s, %s)." % (s["title"], s["source"], time.strftime("%d %b %H:%M", time.localtime(s["published"]))),
                    "evidence": ([("Mentions the company" if nm else "")] if nm else []) + (["Matches your indicators: " + ", ".join(ind)] if ind else []) +
                                (["Touches your 'what would prove me wrong' condition: " + ", ".join(sorted(set(wrong))[:4])] if wrong else []),
                    "wrong_if": th.get("wrong_if"), "link": s["link"],
                    "action": "Read it and record whether it supports, weakens or doesn't change the thesis.",
                    "assessment": "Unassessed: keyword match only. Use ‘Assess with Claude’ for a reasoned read.",
                    "ref": {"kind": "holding", "id": r["id"]}, "story": s["id"]},
                   .95, min(1, .3 + r["weight"] * 4), .5, min(.9, conf), group="thesis:" + r["id"])
    # price moves
    for r in port["holdings"]:
        d1 = r["returns"].get("1d", {}).get("local")
        if d1 is not None and abs(d1) >= .05:
            _alert(space, "px:%s:%s" % (r["id"], today), "price", "%s moved %+.1f%% today" % (r["ticker"], d1 * 100),
                   {"why": "Daily moves above 5% often reflect new information.", "evidence": ["Last %s, previous close from quote series (%s)" % (r["price"], "Yahoo, delayed")],
                    "action": "Check for news or filings before reacting.", "ref": {"kind": "holding", "id": r["id"]}},
                   .9, min(1, abs(d1) * 5 * (r["weight"] * 5 + .2)), .8, .95)
        m1 = r["returns"].get("1m", {}).get("local")
        if m1 is not None and abs(m1) >= .12:
            named = any(any(m["id"] == r["id"] for m in s["mentions"]) for s in st)
            if not named:
                _alert(space, "quiet:%s:%s" % (r["id"], today.isocalendar()[1]), "second_look",
                       "%s is %+.0f%% over a month with no matching coverage in your feeds" % (r["ticker"], m1 * 100),
                       {"why": "A large move without visible news can mean information you haven't seen (sector rotation, a filing, analyst action).",
                        "evidence": ["1-month price change %+.1f%% (calculated)" % (m1 * 100), "No story in the last 72h mentions it"],
                        "action": "Check filings and sector peers.", "ref": {"kind": "holding", "id": r["id"]}},
                       .8, min(1, abs(m1) * 3 * (r["weight"] * 4 + .2)), .4, .7)
    # exposure
    for b in port["breaches"]:
        _alert(space, "breach:%s:%s" % (b["kind"], b["name"]), "exposure",
               "%s %s is %.0f%% of the portfolio (your limit: %.0f%%)" % (b["kind"].title(), b["name"], b["weight"] * 100, b["limit"] * 100),
               {"why": "You set this limit in Settings.", "evidence": ["Weight calculated from live quotes and FX"], "action": "Decide whether to trim, rebalance, or update the limit."},
               1.0, .7, .4, 1.0)
    for hx in port["hidden"][:3]:
        if hx["weight"] >= .25:
            _alert(space, "hidden:%s" % (hx.get("factor") or hx["label"]), "exposure", "Hidden exposure: " + hx["headline"],
                   {"why": "Seemingly different holdings share one underlying driver, so they may fall together.",
                    "evidence": ["%s (%s, sensitivity %s)" % (h["ticker"], h["sector"], "%+.1f" % h["sens"] if "sens" in h else "shared") for h in hx["holdings"][:6]],
                    "gaps": hx["gaps"], "action": "Open Portfolio → Exposures to see the full breakdown."},
                   .85, min(1, hx["weight"]), .2, .6)
    # relationships
    mem = relationship_memory(space, port)
    for x in mem["lost_touch"][:6]:
        if int(x.get("closeness") or 0) >= 4 and x.get("days"):
            _alert(space, "touch:%s:%s" % (x["id"], today.isocalendar()[1]), "relationship",
                   "You haven't been in touch with %s for %d days" % (x["name"], x["days"]),
                   {"why": "Your cadence for this closeness level is every %d days." % x["cadence"], "evidence": ["Last logged interaction %d days ago" % x["days"]],
                    "action": "Draft a note.", "ref": {"kind": "contact", "id": x["id"]}},
                   .8, .5, .5, .9)
    for p in mem["promises"]:
        if p["overdue"]:
            _alert(space, "promise:%s:%s" % (p["id"], p["text"][:20]), "relationship", "Overdue promise to %s: %s" % (p["name"], p["text"]),
                   {"why": "You recorded this commitment.", "evidence": ["Due %s" % p["due"]], "action": "Do it, or send a quick update.",
                    "ref": {"kind": "contact", "id": p["id"]}}, 1.0, .6, .9, 1.0)
    for m in mem["milestones"]:
        if m["days"] <= 10:
            _alert(space, "ms:%s:%s" % (m["id"], m["date"]), "relationship", "%s: %s in %d days" % (m["name"], m["what"], m["days"]),
                   {"why": "Early enough to plan something thoughtful.", "evidence": ["Date %s" % m["date"]], "ref": {"kind": "contact", "id": m["id"]}},
                   .8, .4, .8 if m["days"] <= 3 else .5, 1.0)
    for r in mem["reasons"][:8]:
        _alert(space, "reason:%s:%s" % (r["id"], r["kind"]), "relationship", r["text"],
               {"why": "A natural reason to reach out.", "evidence": [r.get("src") or "calendar"], "link": r.get("link"),
                "ref": {"kind": "contact", "id": r["id"]}}, .7, .35, .4, .75, group=r.get("group"))
    # calendar
    wk = week_ahead(space)
    for p in wk["prep"]:
        if p["due"] <= (today + dt.timedelta(days=1)).isoformat() and not p["event"].get("prep"):
            _alert(space, "prep:%s" % p["event"]["id"], "calendar", p["what"],
                   {"why": "Preparation is due %s." % ("now" if p["overdue"] else p["due"]), "evidence": [p["event"]["start"][:16].replace("T", " ")],
                    "action": "Open preparation mode.", "event": p["event"]["id"]}, .85, .5, .9, 1.0)
    for d in wk["days"]:
        for a, b in d["conflicts"]:
            nice = dt.date.fromisoformat(d["date"]).strftime("%a %d %b")
            _alert(space, "conflict:%s:%s:%s" % (d["date"], a, b), "calendar", "Conflict on %s: %s overlaps %s" % (nice, a, b),
                   {"why": "Two timed events overlap.", "evidence": [d["date"]], "action": "Reschedule one."}, 1.0, .5, .8, 1.0)
    # decisions
    for dcs in db.list_records(space, "decision"):
        if dcs.get("review_date") and dcs["review_date"] <= today.isoformat() and not dcs.get("reviews"):
            _alert(space, "review:" + dcs["id"], "decision", "Time to review: %s" % dcs.get("title"),
                   {"why": "You set a review date of %s." % dcs["review_date"], "action": "Open decision replay.", "ref": {"kind": "decision", "id": dcs["id"]}},
                   .9, .5, .7, 1.0)
    # second look: widely covered development hitting a large exposure with no direct mention
    for s in st[:30]:
        if s["n_sources"] >= 3 and s["shocks"] and not any(m["kind"] == "holding" for m in s["mentions"]):
            sh = engine.detect_shocks(s["title"] + " " + (s.get("summary") or ""))
            big = []
            for x in sh:
                for f, v in x["shock"]["impulse"].items():
                    e = port["exposures"].get(f, {}).get("value", 0)
                    if abs(e) >= .25:
                        big.append((f, e))
            if big:
                f, e = big[0]
                _alert(space, "indirect:" + s["id"], "second_look", "Indirect exposure: “%s”" % s["title"],
                       {"why": "None of your holdings are named, but your portfolio's net sensitivity to %s is %+.2f." % (kb.lower_label(f), e),
                        "evidence": ["Covered by %d outlets" % s["n_sources"], "Top contributors: " + ", ".join("%s %+.2f" % c for c in port["exposures"][f]["contributors"][:4])],
                        "action": "Open ‘How does this affect me?’ on the story.", "story": s["id"], "link": s["link"]},
                       .75, min(1, abs(e) * 1.5), .5, .55, group="story:" + s["id"])
    # investor filings overlap
    for inv in db.list_records(space, "investor"):
        data, _ = db.cache_get("13f:summary:%s" % inv.get("cik"))
        if not data or data.get("error"):
            continue
        held = {company_key(r["name"]) for r in port["holdings"]}
        for ch in data.get("changes", []):
            if ch["change"] in ("new", "exited", "increased", "reduced") and company_key(ch["issuer"]) in held:
                _alert(space, "13f:%s:%s:%s" % (inv["cik"], data["current"]["accession"], ch["cusip"]), "investor",
                       "%s %s %s (which you hold)" % (data["name"].title(), {"new": "opened", "exited": "exited", "increased": "added to", "reduced": "trimmed"}[ch["change"]], ch["issuer"].title()),
                       {"why": "Overlap between a followed investor's disclosed changes and your holdings (matched by issuer name).",
                        "evidence": ["13F for period %s, filed %s" % (data["current"]["period"], data["current"]["filed"])],
                        "caveat": "13F data is up to 45 days old at filing and shows long US-listed positions only. Not a current trade signal.",
                        "link": data.get("url")}, .8, .35, .2, .7)
    db.run("UPDATE alerts SET status='stale' WHERE space=? AND status='open' AND updated<?", (space, _now() - 3 * DAY))
    return db.q1("SELECT COUNT(*) n FROM alerts WHERE space=? AND status='open'", (space,))["n"]


kb_stop = set("would their there which about these those because could should company market price prices".split())


def alerts(space, status="open", limit=60):
    rows = db.q("SELECT * FROM alerts WHERE space=? AND status=? ORDER BY score DESC LIMIT ?", (space, status, limit))
    groups = {}
    out = []
    for r in rows:
        r["body"] = json.loads(r["body"] or "{}")
        r["kind_label"] = KIND_LABEL.get(r["kind"], r["kind"])
        g = r["group_key"]
        if g in groups:
            groups[g]["grouped"].append({"id": r["id"], "title": r["title"]})
            continue
        r["grouped"] = []
        groups[g] = r
        out.append(r)
    return out


def alert_feedback(space, aid, fb):
    a = db.q1("SELECT * FROM alerts WHERE id=? AND space=?", (aid, space))
    if not a:
        return
    kw = db.get_setting(space, "kind_weights") or {}
    w = float(kw.get(a["kind"], 1.0))
    if fb == "useful":
        w = min(1.6, w * 1.1)
    elif fb == "noise":
        w = max(.3, w * .8)
        db.run("UPDATE alerts SET status='dismissed' WHERE id=?", (aid,))
    elif fb == "mute":
        muted = db.get_setting(space, "muted_kinds") or []
        if a["kind"] not in muted:
            muted.append(a["kind"])
        db.set_setting(space, "muted_kinds", muted)
        db.run("UPDATE alerts SET status='dismissed' WHERE space=? AND kind=?", (space, a["kind"]))
    elif fb in ("done", "dismiss"):
        db.run("UPDATE alerts SET status='dismissed' WHERE id=?", (aid,))
    elif fb == "snooze":
        db.run("UPDATE alerts SET status='snoozed', updated=? WHERE id=?", (_now(), aid))
    kw[a["kind"]] = w
    db.set_setting(space, "kind_weights", kw)
    db.run("UPDATE alerts SET feedback=? WHERE id=?", (fb, aid))


# ---------------------------------------------------------------------------
# Priorities, snapshots, since-last-visit
# ---------------------------------------------------------------------------

def priorities(space, port=None, al=None):
    al = al if al is not None else alerts(space)
    picks, kinds = [], Counter()
    for a in al:
        if kinds[a["kind"]] >= 1 and len(al) > 3:
            continue
        kinds[a["kind"]] += 1
        picks.append({"title": a["title"], "why": a["body"].get("why"), "action": a["body"].get("action"), "kind": a["kind_label"],
                      "scores": {"relevance": a["relevance"], "impact": a["impact"], "urgency": a["urgency"], "confidence": a["confidence"]},
                      "alert": a["id"], "ref": a["body"].get("ref"), "event": a["body"].get("event"), "story": a["body"].get("story")})
        if len(picks) == 3:
            break
    return picks


def snapshot(space, port=None):
    port = port or engine.portfolio(space)
    if not port["holdings"]:
        return
    day = dt.date.today().isoformat()
    data = {"total": port["total"], "base": port["base"], "top1": port["top1"], "top5": port["top5"], "effective_n": port["effective_n"],
            "exposures": {k: v["value"] for k, v in port["exposures"].items()},
            "sectors": {s["name"]: s["weight"] for s in port["by_sector"]},
            "weights": {(r["ticker"] or r["name"]): r["weight"] for r in port["holdings"]}}
    db.run("INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)", (space, day, _now(), json.dumps(data)))


def risk_change(space, days=30):
    snaps = db.q("SELECT * FROM snapshots WHERE space=? ORDER BY day", (space,))
    if len(snaps) < 2:
        return {"available": False, "note": "Vantage records a daily snapshot of your portfolio. Risk comparisons need at least two days of history; %d so far." % len(snaps)}
    target = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    old = next((s for s in snaps if s["day"] >= target), snaps[0])
    new = snaps[-1]
    a, b = json.loads(old["data"]), json.loads(new["data"])
    diffs = []
    for f in kb.FACTORS:
        d = b["exposures"].get(f, 0) - a["exposures"].get(f, 0)
        if abs(d) >= .03:
            diffs.append({"factor": kb.FACTORS[f][0], "from": a["exposures"].get(f, 0), "to": b["exposures"].get(f, 0), "delta": d})
    diffs.sort(key=lambda x: -abs(x["delta"]))
    wdiff = []
    for k in set(a["weights"]) | set(b["weights"]):
        d = b["weights"].get(k, 0) - a["weights"].get(k, 0)
        if abs(d) >= .01:
            wdiff.append({"name": k, "from": a["weights"].get(k, 0), "to": b["weights"].get(k, 0), "delta": d})
    wdiff.sort(key=lambda x: -abs(x["delta"]))
    return {"available": True, "from": old["day"], "to": new["day"], "value": [a["total"], b["total"]],
            "top1": [a["top1"], b["top1"]], "effective_n": [a["effective_n"], b["effective_n"]], "drivers": diffs[:8], "weights": wdiff[:8],
            "note": "Compared against the snapshot from %s (closest available to %d days ago)." % (old["day"], days)}


def since_last_visit(space, since, port):
    if not since:
        return {"first": True}
    out = {"since": since, "first": False}
    out["stories"] = db.q1("SELECT COUNT(DISTINCT cluster) n FROM news WHERE published>?", (since,))["n"]
    out["alerts"] = [{"id": a["id"], "title": a["title"], "kind": a["kind"]} for a in
                     db.q("SELECT id, title, kind FROM alerts WHERE space=? AND status='open' AND created>? ORDER BY score DESC LIMIT 8", (space, since))]
    prev_total = db.get_setting(space, "last_visit_value")
    if prev_total and port["total"]:
        out["value"] = {"from": prev_total, "to": port["total"], "delta": port["total"] - prev_total, "pct": port["total"] / prev_total - 1}
    movers = []
    for r in port["holdings"]:
        s = (db.cache_get("px:" + (r["ticker"] or ""))[0] or {}).get("series") or []
        p0 = engine._close_on(s, since)
        if p0 and r["price"] and r["price_src"] == "quote":
            ch = r["price"] / p0 - 1
            if abs(ch) >= .02:
                movers.append({"ticker": r["ticker"], "change": ch})
    out["movers"] = sorted(movers, key=lambda m: -abs(m["change"]))[:6]
    out["new_records"] = db.q("SELECT kind, COUNT(*) n FROM records WHERE space=? AND created>? AND deleted=0 GROUP BY kind", (space, since))
    return out


# ---------------------------------------------------------------------------
# Journal replay
# ---------------------------------------------------------------------------

def replay(space, did):
    d = db.get_record(space, did)
    if not d:
        return None
    revs = db.revisions(did)
    original = revs[0]["data"] if revs else d
    orig_ts = revs[0]["ts"] if revs else d["_created"]
    amendments = [{"ts": r["ts"], "fields": sorted(k for k in r["data"] if r["data"].get(k) != original.get(k))} for r in revs[1:] if r["action"] == "update"]
    after = {}
    t = (d.get("ticker") or "").strip()
    if t:
        q = feeds.quotes([t]).get(t)
        if q and q.get("price"):
            p0 = d.get("price_at_decision") or engine._close_on(q.get("series") or [], orig_ts)
            if p0:
                after["price"] = {"ticker": t, "then": p0, "now": q["price"], "change": q["price"] / p0 - 1, "currency": q["currency"],
                                  "label": "calculated from quote history"}
        terms = [company_key(q["name"]).split(" ")[0]] if q else []
        terms.append(t.split(".")[0].lower())
        news = []
        for term in terms:
            if len(term) >= 3:
                news += db.q("SELECT title, link, source, published FROM news WHERE published>? AND lower(title) LIKE ? ORDER BY published DESC LIMIT 6",
                             (orig_ts, "%" + term + "%"))
        after["news"] = news[:8]
    reviews = d.get("reviews") or []
    status = {}
    for rv in reviews:
        for k, v in (rv.get("assumptions") or {}).items():
            status[k] = v
    assumptions = []
    for i, a in enumerate(original.get("assumptions") or []):
        txt = a if isinstance(a, str) else a.get("text")
        assumptions.append({"text": txt, "confidence": None if isinstance(a, str) else a.get("confidence"), "status": status.get(str(i), "unresolved")})
    return {"decision": d, "original": original, "recorded": orig_ts, "amendments": amendments, "after": after, "reviews": reviews,
            "assumptions": assumptions,
            "tally": Counter(a["status"] for a in assumptions)}
