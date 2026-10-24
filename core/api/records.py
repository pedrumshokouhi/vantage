"""Generic records API: list, read, create, update, delete, revisions."""
import json
import re
import threading
import time

from .. import db, feeds
from ..jobs import _13f, refresh_ics
from .common import KINDS, HTTPError, _num, get_or_404, route

DECISION_LOCKED = ("decision", "rationale", "assumptions", "alternatives", "expectations", "date", "title", "price_at_decision")


def _check_kind(kind):
    if kind not in KINDS:
        raise HTTPError(404, "Unknown record type")


def _sanitize(kind, d):
    if not isinstance(d, dict):
        raise HTTPError(400, "Expected an object")
    if len(json.dumps(d)) > 400000:
        raise HTTPError(413, "Record too large")
    if kind == "holding":
        if d.get("ticker"):
            d["ticker"] = str(d["ticker"]).strip().upper()
        for k in ("quantity", "cost", "manual_price", "cost_base_total", "target_weight", "beta"):
            if k in d and d[k] not in (None, ""):
                v = _num(d[k])
                if v is None:
                    raise HTTPError(400, "%s must be a number" % k)
                d[k] = v
    if kind == "ics_sub" and not re.match(r"^(https|webcal)://", d.get("url") or ""):
        raise HTTPError(400, "Calendar link must start with https:// or webcal://")
    if kind == "investor":
        try:
            d["cik"] = int(str(d.get("cik")).strip())
        except ValueError:
            raise HTTPError(400, "CIK must be a number")
    return d


@route("GET", "/api/r/(\\w+)")
def r_list(h, kind):
    _check_kind(kind)
    return {"items": db.list_records(h.space, kind)}


@route("GET", "/api/r/(\\w+)/([\\w]+)")
def r_get(h, kind, rid):
    _check_kind(kind)
    return get_or_404(h.space, rid, kind)


@route("GET", "/api/r/(\\w+)/([\\w]+)/revisions")
def r_revs(h, kind, rid):
    _check_kind(kind)
    get_or_404(h.space, rid, kind)
    return {"revisions": db.revisions(rid)}


@route("POST", "/api/r/(\\w+)")
def r_create(h, kind):
    _check_kind(kind)
    d = _sanitize(kind, h.body())
    if kind == "decision" and d.get("ticker") and not d.get("price_at_decision"):
        q = feeds.quotes([d["ticker"]]).get(d["ticker"])
        if q and q.get("price"):
            d["price_at_decision"] = q["price"]
            d["price_source"] = "Quote at time of recording (%s)" % time.strftime("%Y-%m-%d %H:%M")
    rec = db.create_record(h.space, kind, d)
    if kind == "ics_sub":
        threading.Thread(target=refresh_ics, args=(h.space,), daemon=True).start()
    if kind == "investor":
        threading.Thread(target=_13f, args=(d["cik"],), daemon=True).start()
    return rec


@route("PUT", "/api/r/(\\w+)/([\\w]+)")
def r_update(h, kind, rid):
    _check_kind(kind)
    # the kind must match the stored record: otherwise PUT /api/r/note/<decision id> would skip the decision lock
    cur = get_or_404(h.space, rid, kind)
    d = _sanitize(kind, h.body())
    merge = h.query.get("replace") != "1"
    if kind == "decision" and time.time() - cur["_created"] > 86400:
        # original reasoning is locked after 24h; only reviews/status/review_date may change
        changed = [k for k in DECISION_LOCKED if k in d and d[k] != cur.get(k)]
        if changed:
            raise HTTPError(409, "Original reasoning is locked after 24 hours so hindsight can't rewrite it. Add a review or an amendment instead.")
        if not merge:  # a full replace may not drop the locked fields either
            d.update({k: cur[k] for k in DECISION_LOCKED if k in cur})
    return db.update_record(h.space, rid, d, merge=merge)


@route("DELETE", "/api/r/(\\w+)/([\\w]+)")
def r_delete(h, kind, rid):
    _check_kind(kind)
    get_or_404(h.space, rid, kind)
    db.delete_record(h.space, rid)
    return {"ok": True}
