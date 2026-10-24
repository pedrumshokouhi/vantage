"""Settings, status, refresh, export/import, backups and the demo reset."""
import os
import re
import time

from .. import ai, db, demo, engine, feeds, intel, kb
from ..jobs import refresh_filings, refresh_ics
from .briefing import _sources_summary
from .common import KINDS, LIVE_ONLY_KEYS, SETTING_KEYS, HTTPError, route
from .records import _sanitize


@route("GET", "/api/settings")
def settings(h):
    s = db.all_settings(h.space)
    out = {k: v for k, v in s.items() if k in SETTING_KEYS}
    live = db.all_settings("live")
    out["sec_contact"] = live.get("sec_contact") or ""
    out["anthropic_model"] = live.get("anthropic_model") or ai.DEFAULT_MODEL
    out["anthropic_key_set"] = bool(live.get("anthropic_key"))
    out["plan_templates"] = list(kb.PLAN_TEMPLATES)
    return out


@route("POST", "/api/settings")
def save_settings(h):
    d = h.body()
    for k, v in d.items():
        if k in SETTING_KEYS:
            db.set_setting(h.space, k, v)
        elif k in LIVE_ONLY_KEYS:
            if v is not None and not isinstance(v, str):
                raise HTTPError(400, "%s must be text" % k)
            if k == "anthropic_key" and v and not v.startswith("sk-"):
                raise HTTPError(400, "That doesn't look like an Anthropic API key.")
            db.set_setting("live", k, (v or "").strip() or None)
        else:
            raise HTTPError(400, "Unknown setting: %s" % k)
    return {"ok": True}


@route("GET", "/api/status")
def status(h):
    src = db.sources()
    return {"sources": src, "ai": ai.status(), "backups": db.list_backups()[:10],
            "counts": {k: len(db.list_records(h.space, k)) for k in sorted(KINDS)},
            "news_items": db.q1("SELECT COUNT(*) n FROM news")["n"], "db_path": db.DB_PATH, "data_dir": db.DATA_DIR}


@route("POST", "/api/refresh")
def refresh(h):
    what = h.body().get("what") or "all"
    if what in ("all", "news"):
        feeds.refresh_news()
    if what in ("all", "quotes"):
        engine.portfolio(h.space, force=True)
        feeds.quotes([t for t, _ in feeds.MARKET_TICKERS], force=True)
    if what in ("all", "macro"):
        feeds.refresh_boc(force=True)
    if what in ("all", "calendar"):
        refresh_ics(h.space)
    if what in ("all", "filings"):
        refresh_filings(h.space, force=True)
    intel.run_radar(h.space)
    return {"ok": True, "sources": _sources_summary()}


@route("GET", "/api/export")
def export(h):
    sp = h.space
    data = {"vantage_export": 1, "space": sp, "exported": time.time(),
            "settings": {k: v for k, v in db.all_settings(sp).items() if k in SETTING_KEYS},
            "records": {k: db.list_records(sp, k) for k in sorted(KINDS)},
            "revisions": {r["id"]: db.revisions(r["id"]) for k in ("decision", "holding") for r in db.list_records(sp, k)}}
    fn = "vantage-%s-%s.json" % (sp, time.strftime("%Y%m%d-%H%M"))
    return 200, data, {"Content-Disposition": 'attachment; filename="%s"' % fn}


@route("POST", "/api/import")
def import_json(h):
    d = h.body()
    if d.get("vantage_export") != 1:
        raise HTTPError(400, "Not a Vantage export file")
    records = d.get("records") or {}
    if not isinstance(records, dict) or not all(isinstance(v, list) for v in records.values()):
        raise HTTPError(400, "records must map each kind to a list")
    db.backup("pre-import")
    n, skipped = 0, 0
    for kind, items in records.items():
        if kind not in KINDS:
            continue
        for it in items:
            if not isinstance(it, dict):
                skipped += 1
                continue
            rid = it.get("id")
            if rid is not None and (not isinstance(rid, str) or not re.fullmatch(r"\w{1,64}", rid)):
                skipped += 1
                continue
            if rid and db.q1("SELECT id FROM records WHERE id=?", (rid,)):
                skipped += 1
                continue
            try:
                data = _sanitize(kind, dict(it))
            except HTTPError:
                skipped += 1
                continue
            ts = it.get("_created")
            db.create_record(h.space, kind, data, rid=rid, ts=ts if isinstance(ts, (int, float)) else None)
            n += 1
    for k, v in (d.get("settings") or {}).items():
        if k in SETTING_KEYS:
            db.set_setting(h.space, k, v)
    return {"imported": n, "skipped": skipped}


@route("POST", "/api/backup")
def backup(h):
    p = db.backup("manual")
    return {"file": os.path.basename(p), "backups": db.list_backups()[:10]}


@route("POST", "/api/demo/reset")
def demo_reset(h):
    db.wipe_space("demo")
    demo.seed()
    return {"ok": True}
