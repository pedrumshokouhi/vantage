"""Background refreshers: calendar subscriptions, SEC filings and 13F summaries, and the minute loop."""
import datetime as dt
import time
import traceback

from . import db, engine, feeds, intel


def _13f(cik, force=False):
    data, fetched = db.cache_get("13f:summary:%s" % cik)
    ttl = 15 * 60 if (data or {}).get("error") else 12 * 3600  # retry failures soon, successes twice a day
    if data is not None and not force and time.time() - fetched < ttl:
        return data
    try:
        data = feeds.thirteen_f(cik)
        data["fetched"] = time.time()
    except Exception as e:  # noqa: BLE001
        if data is not None:
            data["stale_error"] = str(e)
            return data
        data = {"cik": cik, "error": str(e)}
    db.cache_put("13f:summary:%s" % cik, data)
    return data


def refresh_ics(space):
    for s in db.list_records(space, "ics_sub"):
        try:
            evs = feeds.fetch_ics(s["url"])
            db.cache_put("ics:" + s["id"], evs)
            db.source_ok("ics:" + s["id"], len(evs), s.get("name"))
        except Exception as e:  # noqa: BLE001
            db.source_err("ics:" + s["id"], e)


def refresh_filings(space, force=False):
    for r in db.list_records(space, "holding"):
        t = r.get("ticker") or ""
        if not t or t == "CASH" or t.endswith((".TO", ".V", ".NE")) or t.startswith("^") or "-USD" in t:
            continue
        data, fetched = db.cache_get("filings:" + t)
        if data is not None and not force and time.time() - fetched < 12 * 3600:
            continue
        try:
            fl = feeds.company_filings(t)
            db.cache_put("filings:" + t, fl or {"none": True})
        except Exception as e:  # noqa: BLE001
            db.source_err("sec", e)
        time.sleep(.2)
    for inv in db.list_records(space, "investor"):
        _13f(inv["cik"], force=force)
        time.sleep(.2)


def _tick_space(sp, now, last):
    if now - last.get("q" + sp, 0) > 10 * 60:
        port = engine.portfolio(sp)
        feeds.quotes([t for t, _ in feeds.MARKET_TICKERS])
        intel.snapshot(sp, port)
        last["q" + sp] = now
    if now - last.get("ics" + sp, 0) > 30 * 60:
        refresh_ics(sp)
        last["ics" + sp] = now
    if now - last.get("f" + sp, 0) > 6 * 3600:
        refresh_filings(sp)
        last["f" + sp] = now
    if now - last.get("r" + sp, 0) > 15 * 60:
        intel.run_radar(sp)
        last["r" + sp] = now


def worker():
    last = {}
    time.sleep(2)
    while True:
        try:
            now = time.time()
            if now - last.get("news", 0) > 15 * 60:
                feeds.refresh_news()
                last["news"] = now
            feeds.refresh_boc()
            for sp in db.SPACES:
                with engine.request_scope():  # one portfolio per space per pass, shared by the snapshot and radar
                    _tick_space(sp, now, last)
            day = dt.date.today().isoformat()
            if last.get("backup") != day:
                if not any(day.replace("-", "") in b["file"] for b in db.list_backups()):
                    db.backup("daily")
                last["backup"] = day
            db.run("DELETE FROM sessions WHERE expires<?", (now,))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        time.sleep(60)
