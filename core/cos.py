"""Chief of staff: intent routing + retrieval across every record, with answers
that keep retrieved facts, interpretation and missing information apart."""
import datetime as dt
import re
import time

from . import ai, db, engine, intel

SEARCH_KINDS = ("holding", "contact", "event", "decision", "note", "watch", "plan", "scenario", "investor")


def _tok(s):
    return [w for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if len(w) > 2]


def _flat(d):
    out = []
    for k, v in d.items():
        if k.startswith("_") or k == "id":
            continue
        if isinstance(v, str):
            out.append(v)
        elif isinstance(v, list):
            for x in v:
                out.append(x if isinstance(x, str) else " ".join(str(y) for y in (x.values() if isinstance(x, dict) else [x])))
        elif isinstance(v, dict):
            out.append(" ".join(str(y) for y in v.values()))
    return " ".join(out)


def label_of(kind, r):
    return r.get("title") or r.get("name") or r.get("ticker") or r.get("text", "")[:60] or kind


def search(space, q, limit=20):
    terms = set(_tok(q))
    hits = []
    if not terms:
        return hits
    for kind in SEARCH_KINDS:
        for r in db.list_records(space, kind):
            txt = _flat(r).lower()
            s = sum(txt.count(t) for t in terms)
            title = label_of(kind, r).lower()
            s += sum(3 for t in terms if t in title)
            if s:
                hits.append({"kind": kind, "id": r["id"], "label": label_of(kind, r), "score": s,
                             "snippet": _snip(_flat(r), terms)})
    for n in db.q("SELECT id, title, source, link, published, cluster FROM news WHERE published>? ORDER BY published DESC LIMIT 800",
                  (time.time() - 7 * 86400,)):
        tl = n["title"].lower()
        s = sum(2 for t in terms if re.search(r"\b%s" % re.escape(t), tl))
        if s >= 2 or (s and len(terms) == 1):
            hits.append({"kind": "news", "id": n["cluster"] or n["id"], "label": n["title"], "score": s * .8,
                         "snippet": "%s · %s" % (n["source"], time.strftime("%d %b %H:%M", time.localtime(n["published"]))), "link": n["link"]})
    hits.sort(key=lambda h: -h["score"])
    return hits[:limit]


def _snip(text, terms):
    tl = text.lower()
    for t in terms:
        i = tl.find(t)
        if i >= 0:
            return ("…" if i > 60 else "") + text[max(0, i - 60): i + 100].strip() + "…"
    return text[:140]


def _ref(kind, rid, text, label="retrieved", link=None):
    return {"text": text, "ref": {"kind": kind, "id": rid} if rid else None, "label": label, "link": link}


def answer(space, q):
    ql = q.lower()
    port = engine.portfolio(space)
    blocks, missing, actions = [], [], []
    intent = "search"
    if re.search(r"overlook|blind spot|missing|not seeing|what am i", ql):
        intent = "overlook"
        al = intel.alerts(space)
        sl = [a for a in al if a["kind"] == "second_look"]
        blocks.append({"type": "retrieved", "title": "Flagged for a second look", "items": [
            _ref("alert", a["id"], "%s — %s" % (a["title"], a["body"].get("why", ""))) for a in sl[:5]] or [
            _ref(None, None, "Nothing flagged as a second look right now.")]})
        wk = intel.week_ahead(space)
        items = [_ref("event", None, "%s (due %s)" % (p["what"], p["due"])) for p in wk["prep"][:5]]
        if wk["conflicts"]:
            items.append(_ref(None, None, "%d calendar conflict(s) this week." % wk["conflicts"]))
        blocks.append({"type": "retrieved", "title": "Preparation due this week", "items": items or [_ref(None, None, "No preparation tasks due.")]})
        mem = intel.relationship_memory(space)
        items = [_ref("contact", p["id"], "Promise to %s: %s%s" % (p["name"], p["text"], " (overdue)" if p["overdue"] else "")) for p in mem["promises"][:4]]
        items += [_ref("contact", x["id"], "%s: no contact in %s days" % (x["name"], x["days"] or "?")) for x in mem["lost_touch"][:3]]
        blocks.append({"type": "retrieved", "title": "People", "items": items or [_ref(None, None, "No open promises or lapsed relationships.")]})
        if port["hidden"]:
            blocks.append({"type": "interpretation", "title": "Concentration you might not see", "items": [
                _ref(None, None, h["headline"], "interpretation") for h in port["hidden"][:3]]})
    elif re.search(r"risk", ql) and re.search(r"chang|since|month|week|differ", ql):
        intent = "risk"
        days = 7 if "week" in ql else 30
        rc = intel.risk_change(space, days)
        if not rc["available"]:
            missing.append(rc["note"])
        else:
            items = [_ref(None, None, "Portfolio value %s %.0f → %.0f" % (port["base"], rc["value"][0], rc["value"][1]), "calculated"),
                     _ref(None, None, "Largest position %.1f%% → %.1f%%; effective number of positions %.1f → %.1f" % (
                         rc["top1"][0] * 100, rc["top1"][1] * 100, rc["effective_n"][0], rc["effective_n"][1]), "calculated")]
            items += [_ref(None, None, "%s sensitivity %+.2f → %+.2f" % (d["factor"], d["from"], d["to"]), "calculated") for d in rc["drivers"][:5]]
            items += [_ref(None, None, "%s weight %.1f%% → %.1f%%" % (w["name"], w["from"] * 100, w["to"] * 100), "calculated") for w in rc["weights"][:5]]
            blocks.append({"type": "retrieved", "title": "What changed (%s → %s)" % (rc["from"], rc["to"]), "items": items})
            missing.append(rc["note"])
            missing.append("Weight changes come from price moves and any edits you made; transactions are not tracked separately.")
    elif re.search(r"prepar|prep me|brief me", ql):
        intent = "prep"
        today = dt.date.today()
        target = today + dt.timedelta(days=1) if "tomorrow" in ql else None
        evs = [e for e in intel.calendar(space, today, today + dt.timedelta(days=14)) if not e["all_day"] and e["category"] in ("professional", "personal")]
        evs = [e for e in evs if e.get("people")] + [e for e in evs if not e.get("people")]
        if target:
            evs = [e for e in evs if e["start"][:10] == target.isoformat()] or evs
        if not evs:
            missing.append("No upcoming timed meetings found in the next two weeks.")
        else:
            e = evs[0]
            b = intel.prep_brief(space, e["id"])
            blocks.append({"type": "retrieved", "title": "Next meeting: %s (%s)" % (e["title"], e["start"][:16].replace("T", " ")),
                           "items": [_ref("contact", p["id"], "%s — %s at %s. %s" % (p["name"], p.get("role") or "", p.get("org") or "", (p.get("notes") or "")[:160])) for p in b["people"]]
                           + [_ref("news", None, n["title"], "fact", n["link"]) for n in b["news"][:3]]})
            blocks.append({"type": "interpretation", "title": "Suggested discussion points", "items": [_ref(None, None, p["text"], p["label"]) for p in b["points"][:6]]})
            missing += b["missing"]
            actions.append({"type": "open_prep", "event": e["id"], "label": "Open full preparation mode"})
    elif re.search(r"challeng|assumption|thesis|wrong", ql):
        intent = "challenge"
        al = [a for a in intel.alerts(space) if a["kind"] == "thesis"]
        items = [_ref("holding", (a["body"].get("ref") or {}).get("id"), "%s %s" % (a["body"].get("why", ""), a["body"].get("latest", ""))) for a in al[:6]]
        blocks.append({"type": "retrieved", "title": "Recent evidence touching your theses", "items": items or [_ref(None, None, "No recent stories matched your theses' companies or indicators.")]})
        nothesis = [r for r in port["holdings"] if not (r.get("thesis") or {}).get("why")]
        if nothesis:
            missing.append("No written thesis for: " + ", ".join((r["ticker"] or r["name"]) for r in nothesis[:8]) + ". The monitor can't check what isn't recorded.")
        missing.append("Keyword matches are unassessed; open each alert and use ‘Assess with Claude’ for a reasoned verdict.")
    elif re.search(r"reconnect|catch up|trip|travel|visit", ql):
        intent = "reconnect"
        mem = intel.relationship_memory(space)
        items = [_ref("contact", r["id"], r["text"]) for r in mem["reasons"] if r["kind"] == "trip"]
        blocks.append({"type": "retrieved", "title": "People where you're going", "items": items or [_ref(None, None, "No upcoming travel events that match a contact's city. Add a travel event with a location.")]})
        items = [_ref("contact", x["id"], "%s (%s): %s" % (x["name"], x.get("org") or "", ("%d days since last contact" % x["days"]) if x["days"] else "never logged")) for x in mem["lost_touch"][:6]]
        blocks.append({"type": "retrieved", "title": "Lapsed relationships", "items": items or [_ref(None, None, "Everyone is within cadence.")]})
        items = [_ref("contact", r["id"], r["text"], "fact", r.get("link")) for r in mem["reasons"] if r["kind"] == "news"][:4]
        if items:
            blocks.append({"type": "retrieved", "title": "Natural reasons to reach out", "items": items})
    elif re.search(r"^who (do i know|in my network)|who could|who might", ql):
        intent = "who"
        w = intel.who(space, q)
        blocks.append({"type": "retrieved", "title": "People who match", "items": [
            _ref("contact", r["id"], "%s — %s, %s (%s)" % (r["name"], r.get("role") or "", r.get("org") or "", "; ".join(r["reasons"]))) for r in w["results"][:8]]
            or [_ref(None, None, w.get("empty_reason") or "No matches.")]})
        if w["paths"]:
            blocks.append({"type": "retrieved", "title": "Known connection paths", "items": [
                _ref(None, None, " → ".join(n["name"] for n in p["path"]) + ("" if p["verified"] else "  (unverified)")) for p in w["paths"][:6]]})
    hits = search(space, q)
    if intent == "search" or not blocks:
        blocks.append({"type": "retrieved", "title": "Matching records", "items": [
            _ref(h["kind"], h["id"], "%s — %s" % (h["label"], h.get("snippet", "")), "fact" if h["kind"] == "news" else "retrieved", h.get("link")) for h in hits[:10]]
            or [_ref(None, None, "Nothing in your records matches that.")]})
        if not hits:
            missing.append("No records matched. Try different words, or add the information to Vantage.")
    ai_text, ai_err = None, None
    if ai.status()["ok"]:
        try:
            ctx = {"blocks": blocks, "missing": missing, "search": hits[:12],
                   "portfolio": {"base": port["base"], "total": port["total"], "top": [(r["ticker"], round(r["weight"], 3), r["sector"]) for r in port["holdings"][:15]],
                                 "hidden": [h["headline"] for h in port["hidden"][:4]]}}
            ai_text = ai.ask(q, ctx)
        except ai.AIUnavailable as e:
            ai_err = str(e)
    return {"q": q, "intent": intent, "blocks": blocks, "missing": missing, "actions": actions, "ai": ai_text, "ai_error": ai_err,
            "ai_status": ai.status(), "ts": time.time()}
