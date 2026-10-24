"""External data: news RSS, market quotes, Bank of Canada macro/FX, SEC EDGAR, ICS calendars.

Every fetch records its outcome in `sources` so the UI can show freshness and
failures honestly. Nothing here ever invents a value: if a fetch fails, the
last good value is returned with its original timestamp, or None.
"""
import datetime as dt
import email.utils
import hashlib
import html
import ipaddress
import json
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from concurrent.futures import ThreadPoolExecutor

from . import db

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Vantage/1.0"
MAX_RESPONSE = 32 * 1024 * 1024  # SEC submissions are the largest legitimate payloads, at a few MB


class ResponseTooLarge(ValueError):
    pass


class BlockedURL(ValueError):
    pass


def check_public(url):
    """Refuse a URL whose host resolves to a loopback, private, link-local or otherwise non-public address,
    so a user-supplied link (a calendar subscription) can't make the server read its own LAN."""
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise BlockedURL("only http(s) links can be fetched")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise BlockedURL("can't resolve %s (%s)" % (u.hostname, e.strerror))
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if not ip.is_global or ip.is_multicast:
            raise BlockedURL("%s points at a private or local address (%s)" % (u.hostname, ip))


class _PublicRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_public(newurl)  # a redirect may not hop to a private address either
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_public_opener = urllib.request.build_opener(_PublicRedirects)


def http_get(url, headers=None, timeout=15, limit=MAX_RESPONSE, public_only=False):
    """GET with a hard size cap on both the wire bytes and the decompressed body, so a huge or
    gzip-bomb response (calendar links are user-supplied) can't exhaust memory. public_only refuses
    hosts on loopback/private networks, including after redirects."""
    h = {"User-Agent": BROWSER_UA, "Accept-Encoding": "gzip"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h)
    if public_only:
        check_public(url)
    with (_public_opener.open if public_only else urllib.request.urlopen)(req, timeout=timeout) as r:
        raw = r.read(limit + 1)
        if len(raw) > limit:
            raise ResponseTooLarge("response larger than %d MB" % (limit // 2 ** 20))
        if r.headers.get("Content-Encoding") == "gzip":
            d = zlib.decompressobj(16 + zlib.MAX_WBITS)
            raw = d.decompress(raw, limit + 1)
            if len(raw) > limit or d.unconsumed_tail:
                raise ResponseTooLarge("decompressed response larger than %d MB" % (limit // 2 ** 20))
        return raw


def http_json(url, headers=None, timeout=15):
    return json.loads(http_get(url, headers, timeout).decode("utf-8"))


# =====================================================================
# NEWS
# =====================================================================

FEEDS = [
    # id, name, url, default topic, publisher kind
    ("bbc-world", "BBC News", "https://feeds.bbci.co.uk/news/world/rss.xml", "geopolitics", "press"),
    ("guardian-world", "The Guardian", "https://www.theguardian.com/world/rss", "geopolitics", "press"),
    ("aljazeera", "Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", "geopolitics", "press"),
    ("bbc-business", "BBC News", "https://feeds.bbci.co.uk/news/business/rss.xml", "business", "press"),
    ("nyt-business", "New York Times", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "business", "press"),
    ("nyt-economy", "New York Times", "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml", "macro", "press"),
    ("nyt-tech", "New York Times", "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", "technology", "press"),
    ("cnbc-top", "CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html", "markets", "press"),
    ("marketwatch", "MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories", "markets", "press"),
    ("cbc-business", "CBC News", "https://www.cbc.ca/webfeed/rss/rss-business", "business", "press"),
    ("fed", "Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml", "macro", "official"),
    ("boc", "Bank of Canada", "https://www.bankofcanada.ca/content_type/press-releases/feed/", "macro", "official"),
    ("ars", "Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "technology", "press"),
    ("techcrunch", "TechCrunch", "https://techcrunch.com/feed/", "technology", "press"),
    ("hn", "Hacker News", "https://hnrss.org/frontpage", "technology", "community"),
]

TOPIC_RULES = [
    ("conflict", r"\b(war|missile|strike[sd]?|airstrike|troops|invasion|ceasefire|drone attack|shelling|militants?|hostages?|military|gaza|ukraine|israel|iran|hezbollah|houthi|nato)\b"),
    ("macro", r"\b(inflation|cpi|interest rates?|rate cut|rate hike|central bank|federal reserve|fed\b|bank of canada|gdp|unemployment|jobs report|payrolls|recession|treasury yields?|bond yields?|tariffs?|economy)\b"),
    ("markets", r"\b(stocks?|shares|s&p|nasdaq|dow|tsx|earnings|ipo|investors?|oil prices?|bitcoin|crypto|bonds?|dollar|yen|euro|gold)\b"),
    ("technology", r"\b(ai|artificial intelligence|openai|anthropic|nvidia|chips?|semiconductors?|apple|google|microsoft|meta|software|cyber|data cent(er|re)s?|robot|quantum)\b"),
    ("geopolitics", r"\b(election|president|prime minister|sanctions?|diplomat|summit|china|russia|taiwan|eu\b|parliament|minister)\b"),
]

STOP = set("""a an the and or of to in on for with at by from as is are was were be been being it its this that these those
after before over under into about amid against between says said say will would could may might new more most up down out
than then just not no yes how why what who when where which while all any some our your their his her they them we you i
he she has have had do does did can us uk us's year years week day today live update updates latest report reports amid
first two three one per vs via video watch""".split())


def _strip(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def _parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        return email.utils.parsedate_to_datetime(s).timestamp()
    except (TypeError, ValueError):
        pass
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def tokens(title):
    words = re.findall(r"[a-z0-9$%']+", title.lower())
    out = set()
    for w in words:
        w = w.strip("'")
        if len(w) < 3 or w in STOP:
            continue
        if w.endswith("s") and len(w) > 4 and not w.endswith("ss"):
            w = w[:-1]
        out.add(w)
    return out


def classify_topic(text, default):
    t = text.lower()
    for topic, rx in TOPIC_RULES:
        if re.search(rx, t):
            return topic
    return default


def parse_feed(raw):
    root = ET.fromstring(raw)
    items = []
    for it in root.iter():
        tag = it.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        d = {}
        for ch in it:
            ct = ch.tag.split("}")[-1]
            if ct == "title":
                d["title"] = _strip(ch.text)
            elif ct == "link" and not d.get("link"):
                if ch.get("rel") in (None, "alternate"):
                    d["link"] = (ch.get("href") or ch.text or "").strip()
            elif ct in ("description", "summary") and "summary" not in d:
                d["summary"] = _strip(ch.text)[:600]
            elif ct in ("pubDate", "published", "updated", "date") and "published" not in d:
                d["published"] = _parse_date(ch.text)
        if d.get("title") and d.get("link"):
            items.append(d)
    return items


def refresh_news():
    now = time.time()
    total = 0

    def one(feed):
        fid, name, url, topic, kind = feed
        try:
            items = parse_feed(http_get(url, timeout=12))
            db.source_ok("news:" + fid, len(items), name)
            return feed, items
        except Exception as e:  # noqa: BLE001
            db.source_err("news:" + fid, e)
            return feed, []
        finally:
            db.close()  # pool threads are discarded after this refresh

    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(one, FEEDS))
    for (fid, name, url, topic, kind), items in results:
        for d in items[:40]:
            nid = hashlib.sha1(d["link"].encode()).hexdigest()[:16]
            pub = d.get("published") or now
            if pub > now + 3600:
                pub = now
            if db.q1("SELECT id FROM news WHERE id=?", (nid,)):
                continue
            t = classify_topic(d["title"] + " " + d.get("summary", ""), topic)
            db.run("INSERT INTO news VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (nid, name, fid, t, d["title"], d["link"], d.get("summary", ""), pub, now, None))
            total += 1
    db.run("DELETE FROM news WHERE published<?", (now - 14 * 86400,))
    cluster_news()
    db.source_ok("news", db.q1("SELECT COUNT(*) n FROM news")["n"], "%d feeds" % len(FEEDS))
    return total


def cluster_news(hours=72):
    """Group repeated coverage of the same development (greedy title-token overlap)."""
    rows = db.q("SELECT id, title, summary, published FROM news WHERE published>? ORDER BY published",
                (time.time() - hours * 3600,))
    clusters = []  # (id, tokenset)
    assign = {}
    for r in rows:
        tk = tokens(r["title"])
        best, best_s = None, 0.0
        for cid, ctk in clusters:
            inter = len(tk & ctk)
            if inter < 2:
                continue
            s = inter / max(1, min(len(tk), len(ctk)))
            j = inter / max(1, len(tk | ctk))
            score = max(j * 1.6, s if inter >= 3 else 0)
            if score > best_s:
                best, best_s = cid, score
        if best and best_s >= 0.55:
            assign[r["id"]] = best
            for i, (cid, ctk) in enumerate(clusters):
                if cid == best:
                    clusters[i] = (cid, ctk | tk)
        else:
            clusters.append((r["id"], set(tk)))
            assign[r["id"]] = r["id"]
    with db._write_lock:
        c = db.conn()
        for nid, cid in assign.items():
            c.execute("UPDATE news SET cluster=? WHERE id=?", (cid, nid))
        c.commit()


# =====================================================================
# QUOTES (Yahoo Finance public chart endpoint, unofficial and delayed)
# =====================================================================

MARKET_TICKERS = [
    ("^GSPC", "S&P 500"), ("^IXIC", "Nasdaq"), ("^GSPTSE", "S&P/TSX"), ("^VIX", "VIX"),
    ("^TNX", "US 10Y yield"), ("CL=F", "WTI crude"), ("GC=F", "Gold"), ("DX-Y.NYB", "US dollar index"),
    ("BTC-USD", "Bitcoin"),
]


def fetch_quote(ticker):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%s?range=1y&interval=1d&includePrePost=false" % \
          urllib.parse.quote(ticker)
    d = http_json(url, timeout=12)
    res = (d.get("chart") or {}).get("result")
    if not res:
        err = ((d.get("chart") or {}).get("error") or {}).get("description", "no data")
        raise ValueError(err)
    r = res[0]
    m = r["meta"]
    ts = r.get("timestamp") or []
    closes = ((r.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    series = [[t, round(c, 4)] for t, c in zip(ts, closes) if c is not None]
    prev = series[-2][1] if len(series) >= 2 else m.get("chartPreviousClose")
    return {
        "ticker": ticker, "name": m.get("longName") or m.get("shortName") or ticker,
        "currency": (m.get("currency") or "USD").upper(), "exchange": m.get("fullExchangeName") or m.get("exchangeName"),
        "type": m.get("instrumentType"), "price": m.get("regularMarketPrice"), "prev_close": prev,
        "market_time": m.get("regularMarketTime"), "series": series, "fetched": time.time(),
        "source": "Yahoo Finance chart API (unofficial, may be delayed)",
    }


_bg = {"running": set()}
_bg_lock = threading.Lock()


def _refresh_quotes(todo):
    def one(t):
        try:
            return t, fetch_quote(t), None
        except Exception as e:  # noqa: BLE001
            return t, None, e
    ok = 0
    with ThreadPoolExecutor(8) as ex:
        for t, q, err in ex.map(one, todo):
            if q:
                db.cache_put("px:" + t, q)
                ok += 1
            else:
                db.source_err("quote:" + t, err)
    if ok:
        db.source_ok("quotes", ok, "Yahoo Finance (unofficial, delayed)")
    elif todo:
        db.source_err("quotes", "no quotes refreshed (%d requested)" % len(todo))
    return ok


def quotes(tickers, max_age=600, force=False):
    """Return {ticker: quote|None}. Never blocks on a stale-but-present quote: stale entries are
    served immediately (with their own timestamps) and refreshed in the background. Only
    tickers with no data at all, or an explicit force, are fetched inline."""
    out, missing, stale = {}, [], []
    for t in set(x for x in tickers if x):
        data, fetched = db.cache_get("px:" + t)
        out[t] = data
        if data is None or force:
            missing.append(t)
        elif time.time() - (fetched or 0) > max_age:
            stale.append(t)
    if missing:
        _refresh_quotes(missing)
        for t in missing:
            out[t] = db.cache_get("px:" + t)[0]
    if stale:
        with _bg_lock:
            todo = [t for t in stale if t not in _bg["running"]]
            _bg["running"].update(todo)
        if todo:
            def run():
                try:
                    _refresh_quotes(todo)
                finally:
                    db.close()
                    with _bg_lock:
                        _bg["running"].difference_update(todo)
            threading.Thread(target=run, daemon=True).start()
    return out


# =====================================================================
# BANK OF CANADA (official Valet API): FX + policy rate + yields + CPI
# =====================================================================

BOC_SERIES = {
    "FXUSDCAD": "USD/CAD", "FXEURCAD": "EUR/CAD", "FXGBPCAD": "GBP/CAD", "FXJPYCAD": "JPY/CAD",
    "FXCHFCAD": "CHF/CAD", "FXAUDCAD": "AUD/CAD", "FXCNYCAD": "CNY/CAD", "FXHKDCAD": "HKD/CAD",
    "V39079": "BoC target overnight rate", "BD.CDN.10YR.DQ.YLD": "Canada 10Y yield",
    "STATIC_TOTALCPICHANGE": "Canada CPI y/y", "CPI_TRIM": "Canada CPI-trim y/y",
}


def refresh_boc(force=False):
    data, fetched = db.cache_get("boc")
    if data and not force and time.time() - fetched < 6 * 3600:
        return data
    try:
        names = ",".join(BOC_SERIES)
        d = http_json("https://www.bankofcanada.ca/valet/observations/%s/json?recent_weeks=60" % names, timeout=20)
        series = {k: [] for k in BOC_SERIES}
        for ob in d.get("observations", []):
            for k in BOC_SERIES:
                if k in ob and ob[k].get("v") not in (None, ""):
                    series[k].append([ob["d"], float(ob[k]["v"])])
        for k in series:
            series[k].sort()
        # CPI is monthly; recent_weeks may clip it, so fetch 14 recent obs separately
        for k in ("STATIC_TOTALCPICHANGE", "CPI_TRIM"):
            dd = http_json("https://www.bankofcanada.ca/valet/observations/%s/json?recent=14" % k, timeout=15)
            series[k] = sorted([o["d"], float(o[k]["v"])] for o in dd.get("observations", []) if o.get(k, {}).get("v"))
        data = {"series": series, "fetched": time.time(), "source": "Bank of Canada Valet API"}
        db.cache_put("boc", data)
        db.source_ok("boc", len(series), "Bank of Canada Valet API")
    except Exception as e:  # noqa: BLE001
        db.source_err("boc", e)
    return data


def fx_table():
    """Latest CAD per unit of each currency, from the Bank of Canada."""
    boc = refresh_boc() or {}
    t = {"CAD": 1.0}
    for k, s in (boc.get("series") or {}).items():
        if k.startswith("FX") and s:
            t[k[2:5]] = s[-1][1]
    return t


def fx_history(ccy):
    if ccy == "CAD":
        return None
    boc = db.cache_get("boc")[0] or {}
    return (boc.get("series") or {}).get("FX%sCAD" % ccy)


def convert(amount, ccy, base, table=None):
    if amount is None:
        return None
    ccy = (ccy or base).upper()
    if ccy == base:
        return amount
    table = table or fx_table()
    if ccy not in table or base not in table:
        return None
    return amount * table[ccy] / table[base]


# =====================================================================
# SEC EDGAR
# =====================================================================

def sec_headers():
    # SEC asks automated clients to declare a contact email in the User-Agent. Until you add yours in
    # Settings, a clearly-marked placeholder is used (the UI flags this as an open setup step).
    contact = db.get_setting("live", "sec_contact") or "vantage-selfhosted@example.com"
    return {"User-Agent": "Vantage personal research tool %s" % contact.strip()}


_sec_lock = threading.Lock()
_sec_state = {"last": 0.0, "blocked_until": 0.0}


def sec_get(url, timeout=20):
    """Polite, serialised SEC access: <= ~5 requests/second, and a 10-minute
    back-off whenever EDGAR signals throttling (403/429/503)."""
    if time.time() < _sec_state["blocked_until"]:
        raise RuntimeError("SEC EDGAR is throttling requests; pausing until %s" %
                           time.strftime("%H:%M", time.localtime(_sec_state["blocked_until"])))
    with _sec_lock:
        wait = _sec_state["last"] + 0.2 - time.time()
        if wait > 0:
            time.sleep(wait)
        try:
            return http_get(url, headers=sec_headers(), timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code in (403, 429, 503):
                _sec_state["blocked_until"] = time.time() + 600
            raise
        except OSError:
            _sec_state["blocked_until"] = time.time() + 120
            raise
        finally:
            _sec_state["last"] = time.time()


def sec_json(url, ttl=None):
    key = "sec:" + url
    data, fetched = db.cache_get(key)
    if data is not None and ttl is not None and time.time() - fetched < ttl:
        return data
    try:
        data = json.loads(sec_get(url).decode("utf-8"))
        db.cache_put(key, data)
        db.source_ok("sec", 1, "SEC EDGAR")
        return data
    except Exception as e:  # noqa: BLE001
        db.source_err("sec", e)
        if data is not None:
            return data
        raise


def ticker_map():
    data = sec_json("https://www.sec.gov/files/company_tickers.json", ttl=7 * 86400)
    return {v["ticker"].upper(): {"cik": int(v["cik_str"]), "title": v["title"]} for v in data.values()}


def submissions(cik, ttl=12 * 3600):
    d = sec_json("https://data.sec.gov/submissions/CIK%010d.json" % int(cik), ttl=ttl)
    rec = d["filings"]["recent"]
    rows = []
    for i in range(len(rec["form"])):
        rows.append({
            "form": rec["form"][i], "filed": rec["filingDate"][i], "period": rec["reportDate"][i],
            "accession": rec["accessionNumber"][i], "doc": rec["primaryDocument"][i],
            "items": (rec.get("items") or [""] * len(rec["form"]))[i],
            "desc": (rec.get("primaryDocDescription") or [""] * len(rec["form"]))[i],
        })
    return {"name": d.get("name"), "cik": int(cik), "tickers": d.get("tickers") or [], "filings": rows}


def filing_url(cik, accession, doc=""):
    return "https://www.sec.gov/Archives/edgar/data/%d/%s/%s" % (int(cik), accession.replace("-", ""), doc)


def infotable(cik, accession):
    key = "13f:%s" % accession
    data, _ = db.cache_get(key)
    if data is not None:
        return data
    idx = sec_json(filing_url(cik, accession, "index.json"))
    files = [i["name"] for i in idx["directory"]["item"]]
    xmls = [f for f in files if f.lower().endswith(".xml") and f.lower() != "primary_doc.xml"]
    if not xmls:
        raise ValueError("no information table in filing")
    raw = sec_get(filing_url(cik, accession, xmls[0]), timeout=30)
    root = ET.fromstring(raw)
    agg = {}
    for el in root.iter():
        if el.tag.split("}")[-1] != "infoTable":
            continue
        f = {}
        for ch in el.iter():
            f[ch.tag.split("}")[-1]] = (ch.text or "").strip()
        k = (f.get("cusip", ""), f.get("putCall", ""))
        row = agg.setdefault(k, {"issuer": f.get("nameOfIssuer"), "class": f.get("titleOfClass"),
                                 "cusip": f.get("cusip"), "put_call": f.get("putCall") or None,
                                 "value": 0.0, "shares": 0.0, "share_type": f.get("sshPrnamtType")})
        try:
            row["value"] += float(f.get("value") or 0)
            row["shares"] += float(f.get("sshPrnamt") or 0)
        except ValueError:
            pass
    rows = sorted(agg.values(), key=lambda r: -r["value"])
    db.cache_put(key, rows)
    return rows


def thirteen_f(cik):
    """Latest two original 13F-HR filings for a filer, diffed."""
    sub = submissions(cik)
    hr = [f for f in sub["filings"] if f["form"] == "13F-HR"]
    amendments = [f for f in sub["filings"] if f["form"] == "13F-HR/A"][:3]
    if not hr:
        return {"name": sub["name"], "cik": int(cik), "error": "No 13F-HR filings found for this CIK."}
    cur = hr[0]
    prev = hr[1] if len(hr) > 1 else None
    cur_rows = infotable(cik, cur["accession"])
    prev_rows = infotable(cik, prev["accession"]) if prev else []
    pmap = {(r["cusip"], r["put_call"]): r for r in prev_rows}
    cmap = {(r["cusip"], r["put_call"]): r for r in cur_rows}
    total = sum(r["value"] for r in cur_rows) or 1
    changes = []
    for k, r in cmap.items():
        p = pmap.get(k)
        if not p:
            kind = "new"
            delta = None
        else:
            if p["shares"] == 0:
                continue
            delta = (r["shares"] - p["shares"]) / p["shares"]
            if abs(delta) < 0.02:
                kind = "unchanged"
            else:
                kind = "increased" if delta > 0 else "reduced"
        changes.append(dict(r, change=kind, share_delta=delta, weight=r["value"] / total,
                            prev_shares=p["shares"] if p else 0))
    for k, p in pmap.items():
        if k not in cmap:
            changes.append(dict(p, change="exited", share_delta=-1.0, weight=0, prev_shares=p["shares"], shares=0,
                                value=0, prev_value=p["value"]))
    return {
        "name": sub["name"], "cik": int(cik), "current": cur, "previous": prev, "amendments": amendments,
        "total_value": total, "positions": len(cur_rows), "changes": changes,
        "url": filing_url(cik, cur["accession"]),
        "history": [{"period": f["period"], "filed": f["filed"]} for f in hr[:8]],
    }


ITEM_8K = {
    "1.01": "Material agreement", "1.02": "Agreement terminated", "1.03": "Bankruptcy", "2.01": "Acquisition/disposal",
    "2.02": "Earnings release", "2.03": "New debt obligation", "2.05": "Restructuring costs", "2.06": "Impairment",
    "3.01": "Listing notice", "4.01": "Auditor change", "4.02": "Non-reliance on financials", "5.01": "Change in control",
    "5.02": "Executive/director change", "5.03": "Bylaws amended", "5.07": "Shareholder vote", "7.01": "Reg FD disclosure",
    "8.01": "Other events", "9.01": "Exhibits",
}
MATERIAL_FORMS = ("8-K", "10-Q", "10-K", "6-K", "20-F", "40-F", "DEF 14A", "S-1", "SC 13D", "SC 13D/A", "10-K/A")


def company_filings(ticker):
    """Recent material SEC filings for a US-listed ticker. Returns None if not an SEC registrant."""
    t = ticker.upper().replace(".", "-")
    try:
        m = ticker_map().get(t)
    except Exception:  # noqa: BLE001
        return None
    if not m:
        return None
    sub = submissions(m["cik"])
    rows = []
    for f in sub["filings"]:
        if f["form"] in MATERIAL_FORMS:
            items = [i.strip() for i in (f["items"] or "").split(",") if i.strip()]
            labels = [ITEM_8K[i] for i in items if i in ITEM_8K and i != "9.01"]
            rows.append(dict(f, labels=labels, url=filing_url(m["cik"], f["accession"], f["doc"])))
        if len(rows) >= 25:
            break
    insider = sum(1 for f in sub["filings"][:200] if f["form"] == "4" and f["filed"] >= (dt.date.today() - dt.timedelta(days=90)).isoformat())
    earnings = [f["filed"] for f in rows if f["form"] == "8-K" and "Earnings release" in f["labels"]]
    return {"cik": m["cik"], "name": sub["name"], "filings": rows, "insider_form4_90d": insider, "earnings_dates": earnings}


# =====================================================================
# ICS CALENDARS
# =====================================================================

def _ics_dt(val, params):
    val = val.strip()
    if "VALUE=DATE" in params or re.fullmatch(r"\d{8}", val):
        d = dt.datetime.strptime(val[:8], "%Y%m%d")
        return d.strftime("%Y-%m-%d"), True
    tz = None
    m = re.search(r"TZID=([^;:]+)", params)
    if val.endswith("Z"):
        d = dt.datetime.strptime(val, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
    else:
        d = dt.datetime.strptime(val[:15], "%Y%m%dT%H%M%S")
        if m and ZoneInfo:
            try:
                tz = ZoneInfo(m.group(1).strip('"'))
                d = d.replace(tzinfo=tz)
            except Exception:  # noqa: BLE001
                d = d.astimezone()
        else:
            d = d.astimezone()
    return d.astimezone(dt.timezone.utc).isoformat(), False


def parse_ics(text, window_days=120):
    text = re.sub(r"\r?\n[ \t]", "", text)
    events = []
    cur = None
    for line in text.splitlines():
        if line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT" and cur is not None:
            events.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            head, val = line.split(":", 1)
            name, _, params = head.partition(";")
            cur.setdefault(name.upper(), (val, params))
    out = []
    now = dt.datetime.now(dt.timezone.utc)
    lo, hi = now - dt.timedelta(days=14), now + dt.timedelta(days=window_days)
    for e in events:
        if "DTSTART" not in e:
            continue
        try:
            start, allday = _ics_dt(*e["DTSTART"])
            end = _ics_dt(*e["DTEND"])[0] if "DTEND" in e else None
        except ValueError:
            continue
        base = {
            "title": _ics_unescape(e.get("SUMMARY", ("(no title)", ""))[0]),
            "location": _ics_unescape(e.get("LOCATION", ("", ""))[0]),
            "notes": _ics_unescape(e.get("DESCRIPTION", ("", ""))[0])[:1000],
            "all_day": allday, "uid": e.get("UID", ("", ""))[0],
        }
        rrule = e.get("RRULE", ("", ""))[0]
        for s, en in _expand(start, end, allday, rrule, lo, hi):
            out.append(dict(base, start=s, end=en))
    return out


def _ics_unescape(s):
    return s.replace("\\n", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def _expand(start, end, allday, rrule, lo, hi):
    def parse(s):
        if allday:
            return dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc)
        return dt.datetime.fromisoformat(s)
    s0 = parse(start)
    dur = (parse(end) - s0) if end else None
    fmt = (lambda d: d.strftime("%Y-%m-%d")) if allday else (lambda d: d.isoformat())
    if not rrule:
        if lo <= s0 <= hi:
            yield fmt(s0), fmt(s0 + dur) if dur else None
        return
    r = dict(p.split("=", 1) for p in rrule.split(";") if "=" in p)
    freq = r.get("FREQ", "")
    try:
        interval = max(1, int(r.get("INTERVAL", "1") or 1))
        count = int(r["COUNT"]) if "COUNT" in r else None
    except ValueError:  # malformed rule: show the first occurrence rather than failing the whole calendar
        interval, count, freq = 1, 1, ""
    until = None
    if "UNTIL" in r:
        try:
            until = dt.datetime.strptime(r["UNTIL"][:8], "%Y%m%d").replace(tzinfo=dt.timezone.utc) + dt.timedelta(days=1)
        except ValueError:
            pass
    step = {"DAILY": dt.timedelta(days=interval), "WEEKLY": dt.timedelta(weeks=interval)}.get(freq)
    months = {"MONTHLY": interval, "YEARLY": 12 * interval}.get(freq)
    if not step and not months:
        if lo <= s0 <= hi:
            yield fmt(s0), fmt(s0 + dur) if dur else None
        return
    n = 0
    for k in range(2000):
        if count is not None and n >= count:
            break
        if step:
            cur = s0 + k * step
        else:
            # count months from the first occurrence: a date that doesn't exist that month (the 31st, Feb 29)
            # is skipped as RFC 5545 says, and later months keep the original day instead of drifting
            m = s0.month - 1 + k * months
            try:
                cur = s0.replace(year=s0.year + m // 12, month=m % 12 + 1)
            except ValueError:
                continue
        if (until and cur > until) or cur > hi:
            break
        if cur >= lo:
            yield fmt(cur), fmt(cur + dur) if dur else None
        n += 1


def fetch_ics(url):
    url = re.sub(r"^webcal://", "https://", url.strip())
    raw = http_get(url, timeout=20, public_only=True).decode("utf-8", "replace")
    if "BEGIN:VCALENDAR" not in raw:
        raise ValueError("URL did not return an iCalendar file")
    return parse_ics(raw)
