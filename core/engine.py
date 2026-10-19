"""Portfolio analytics, driver exposures, the consequence map and the scenario lab.

Labels used throughout (the UI renders each distinctly):
  fact        - reported by a source, with timestamp
  calculated  - arithmetic on your records and fetched prices/FX
  estimate    - hypothetical output of the built-in sensitivity model
  interpretation - economic reasoning from the knowledge base or Claude
"""
import bisect
import datetime as dt
import math
import re
import time

from . import db, feeds, kb


def base_ccy(space):
    return (db.get_setting(space, "base_currency") or "CAD").upper()


# ---------------------------------------------------------------------------
# Holding classification
# ---------------------------------------------------------------------------

def _preset(ticker):
    t = (ticker or "").upper()
    if t in kb.T:
        return kb.T[t]
    root = re.sub(r"\.(TO|V|NE|CN|U)$", "", t)
    root = root.replace(".UN", "").replace(".", "-")
    return kb.T.get(root)


def profile(h, quote=None):
    """Sector, market beta, driver sensitivities and their provenance for a holding."""
    pre = _preset(h.get("ticker"))
    sector = h.get("sector") or (pre or {}).get("sector")
    src = "your classification" if h.get("sector") else ("built-in ticker preset" if pre else None)
    if not sector and quote:
        qt = (quote.get("type") or "").upper()
        if qt == "CRYPTOCURRENCY":
            sector, src = "Crypto", "instrument type"
        elif qt == "ETF":
            sector, src = "Global Equity (broad)", "instrument type (ETF, assumed broad equity)"
    if not sector and (h.get("ticker") or "").upper() in ("CASH", "CAD", "USD"):
        sector, src = "Cash", "cash"
    if not sector:
        sector, src = "Unclassified", "no classification: set a sector for better analysis"
    beta, sens = kb.SECTORS.get(sector, kb.SECTORS["Unclassified"])
    s = dict(sens)
    if pre and pre.get("sector") == sector:
        s.update(pre.get("tweaks") or {})
    user = h.get("sensitivities") or {}
    for k, v in user.items():
        try:
            s[k] = float(v)
        except (TypeError, ValueError):
            pass
    country = h.get("country") or (pre or {}).get("country")
    if not country and quote:
        ex = quote.get("exchange") or ""
        country = next((c for k, c in kb.EXCHANGE_COUNTRY.items() if k.lower() in ex.lower()), None)
    if not country:
        t = (h.get("ticker") or "").upper()
        country = "CA" if t.endswith((".TO", ".V", ".NE")) else ("GLOBAL" if sector in ("Crypto", "Gold") else "US")
    deps = list(dict.fromkeys((pre or {}).get("deps", []) + (h.get("deps") or [])))
    return {"sector": sector, "sector_source": src, "beta": float(h.get("beta") or beta), "sens": s,
            "sens_source": "your overrides + " + (src or "") if user else src, "country": country, "deps": deps}


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------

def _close_on(series, ts):
    """Last close at or before ts. series: [[epoch, close], ...] sorted."""
    if not series:
        return None
    keys = [p[0] for p in series]
    i = bisect.bisect_right(keys, ts) - 1
    return series[i][1] if i >= 0 else None


def _fx_on(hist, day_iso):
    if not hist:
        return None
    keys = [p[0] for p in hist]
    i = bisect.bisect_right(keys, day_iso) - 1
    return hist[i][1] if i >= 0 else hist[0][1]


def _norm_ccy(ccy, price):
    if ccy == "GBP" and price is not None:
        return "GBP", price
    if ccy in ("GBX", "GBP."):
        return "GBP", price / 100.0 if price is not None else None
    return ccy, price


PERIODS = {"1d": 1, "1m": 30, "ytd": None, "1y": 365}


def portfolio(space, force=False):
    base = base_ccy(space)
    holdings = db.list_records(space, "holding")
    tickers = [h["ticker"] for h in holdings if h.get("ticker") and h["ticker"].upper() not in ("CASH",)]
    bench_cfg = db.get_setting(space, "benchmark") or [{"ticker": "^GSPC", "w": .6}, {"ticker": "^GSPTSE", "w": .4}]
    qts = feeds.quotes(tickers + [b["ticker"] for b in bench_cfg], force=force)
    fx = feeds.fx_table()
    now = time.time()
    today = dt.date.today()
    ystart = time.mktime(dt.date(today.year, 1, 1).timetuple())
    rows, gaps = [], []
    total = 0.0
    for h in holdings:
        t = (h.get("ticker") or "").upper()
        q = qts.get(h.get("ticker")) if t and t != "CASH" else None
        price = (q or {}).get("price")
        price_src = "quote"
        if price is None and h.get("manual_price") is not None:
            price, price_src = float(h["manual_price"]), "manual"
        if t == "CASH":
            price, price_src = 1.0, "cash"
        ccy = (h.get("currency") or (q or {}).get("currency") or base).upper()
        ccy, price = _norm_ccy(ccy, price)
        qty = float(h.get("quantity") or 0)
        vloc = qty * price if price is not None else None
        vbase = feeds.convert(vloc, ccy, base, fx) if vloc is not None else None
        prof = profile(h, q)
        cost = h.get("cost")
        cost_loc = qty * float(cost) if cost not in (None, "") else None
        if h.get("cost_base_total") not in (None, ""):
            cost_base, cost_note = float(h["cost_base_total"]), "cost in %s as entered" % base
        elif cost_loc is not None:
            cost_base = feeds.convert(cost_loc, ccy, base, fx)
            cost_note = "converted at today's FX (purchase FX not entered)" if ccy != base else ""
        else:
            cost_base, cost_note = None, "no cost basis"
        series = (q or {}).get("series") or []
        rets = {}
        fxh = feeds.fx_history(ccy) if ccy != "CAD" else None
        bfxh = feeds.fx_history(base) if base != "CAD" else None

        def fx_rate(day_iso):
            a = _fx_on(fxh, day_iso) if fxh else 1.0
            b = _fx_on(bfxh, day_iso) if bfxh else 1.0
            return a / b if a and b else None
        for p, days in PERIODS.items():
            if not series or price is None or price_src != "quote":
                continue
            if p == "1d":
                p0 = q.get("prev_close")
                t0 = series[-2][0] if len(series) > 1 else None
            else:
                t0 = ystart if p == "ytd" else now - days * 86400
                p0 = _close_on(series, t0) or (series[0][1] if p == "1y" else None)
            if not p0:
                continue
            rl = price / p0 - 1
            rb, fxe = rl, 0.0
            if ccy != base and t0:
                d0 = dt.date.fromtimestamp(t0).isoformat()
                f0, f1 = fx_rate(d0), fx_rate(today.isoformat())
                if f0 and f1:
                    rb = (1 + rl) * (f1 / f0) - 1
                    fxe = rb - rl
            rets[p] = {"local": rl, "base": rb, "fx": fxe}
        if price is None:
            gaps.append({"id": h["id"], "ticker": t or h.get("name"), "issue": "no price (quote failed and no manual price)"})
        if prof["sector"] == "Unclassified":
            gaps.append({"id": h["id"], "ticker": t or h.get("name"), "issue": "unclassified: driver exposures unknown"})
        row = {
            "id": h["id"], "ticker": t, "name": h.get("name") or (q or {}).get("name") or t, "account": h.get("account") or "Unassigned",
            "quantity": qty, "price": price, "price_src": price_src, "currency": ccy, "value_local": vloc, "value": vbase,
            "cost_base": cost_base, "cost_note": cost_note, "pl": (vbase - cost_base) if (vbase is not None and cost_base) else None,
            "returns": rets, "market_time": (q or {}).get("market_time"), "fetched": (q or {}).get("fetched"),
            "exchange": (q or {}).get("exchange"), "thesis": h.get("thesis") or {}, "target_weight": h.get("target_weight"),
            **prof,
        }
        rows.append(row)
        total += vbase or 0
    for r in rows:
        r["weight"] = (r["value"] or 0) / total if total else 0
    rows.sort(key=lambda r: -(r["value"] or 0))

    def group(key):
        g = {}
        for r in rows:
            g[r[key]] = g.get(r[key], 0) + r["weight"]
        return sorted(({"name": k, "weight": v} for k, v in g.items()), key=lambda x: -x["weight"])

    hhi = sum(r["weight"] ** 2 for r in rows)
    exposures = {}
    for f in kb.FACTORS:
        contrib = [(r["ticker"] or r["name"], r["weight"] * r["sens"].get(f, 0)) for r in rows if r["sens"].get(f)]
        e = sum(c for _, c in contrib)
        exposures[f] = {"value": e, "contributors": sorted(contrib, key=lambda x: -abs(x[1]))[:6]}
    ccy_mix = group("currency")
    port_rets = {}
    for p in PERIODS:
        num = den = 0.0
        fxn = 0.0
        for r in rows:
            rr = r["returns"].get(p)
            if rr and r["value"]:
                start_val = r["value"] / (1 + rr["base"])
                num += r["value"] - start_val
                den += start_val
                fxn += start_val * rr["fx"]
        if den:
            port_rets[p] = {"base": num / den, "fx": fxn / den, "coverage": den}
    bench = benchmark(bench_cfg, qts, base, fx)
    limits = {"max_position": db.get_setting(space, "max_position") or .15,
              "max_sector": db.get_setting(space, "max_sector") or .35}
    breaches = []
    for r in rows:
        if r["weight"] > limits["max_position"] and r["sector"] not in ("Cash", "Global Equity (broad)", "US Equity (broad)", "Canada Equity (broad)"):
            breaches.append({"kind": "position", "name": r["ticker"] or r["name"], "weight": r["weight"], "limit": limits["max_position"]})
    for g in group("sector"):
        if g["weight"] > limits["max_sector"] and g["name"] not in ("Cash", "Global Equity (broad)", "US Equity (broad)", "Canada Equity (broad)", "Bonds"):
            breaches.append({"kind": "sector", "name": g["name"], "weight": g["weight"], "limit": limits["max_sector"]})
    return {
        "base": base, "total": total, "holdings": rows, "count": len(rows),
        "by_sector": group("sector"), "by_country": group("country"), "by_currency": ccy_mix, "by_account": group("account"),
        "top1": rows[0]["weight"] if rows else 0, "top5": sum(r["weight"] for r in rows[:5]),
        "effective_n": (1 / hhi) if hhi else 0, "exposures": exposures, "hidden": hidden_exposures(rows, exposures),
        "returns": port_rets, "benchmark": bench, "limits": limits, "breaches": breaches, "gaps": gaps,
        "fx": {k: v for k, v in fx.items() if k in ("USD", "EUR", "GBP", "JPY")},
        "series": value_series(rows, qts, base, bench),
        "asof": max([r["fetched"] or 0 for r in rows] or [0]),
        "notes": ["Performance uses current quantities throughout (transactions are not modelled).",
                  "Index benchmarks are price returns and exclude dividends.",
                  "FX from Bank of Canada daily rates; quotes from Yahoo Finance (unofficial, may be delayed)."],
    }


def benchmark(cfg, qts, base, fx):
    out = []
    for b in cfg:
        q = qts.get(b["ticker"])
        if not q or not q.get("series"):
            out.append({"ticker": b["ticker"], "w": b["w"], "error": "unavailable"})
            continue
        s = q["series"]
        now = time.time()
        today = dt.date.today()
        rets = {}
        ccy = q["currency"]
        for p, days in PERIODS.items():
            if p == "1d":
                p0, t0 = q.get("prev_close"), s[-2][0] if len(s) > 1 else now
            else:
                t0 = time.mktime(dt.date(today.year, 1, 1).timetuple()) if p == "ytd" else now - days * 86400
                p0 = _close_on(s, t0) or (s[0][1] if p == "1y" else None)
            if not p0:
                continue
            rl = q["price"] / p0 - 1
            rb = rl
            if ccy != base:
                h1, h2 = feeds.fx_history(ccy), feeds.fx_history(base)
                d0 = dt.date.fromtimestamp(t0).isoformat()
                f0 = (_fx_on(h1, d0) if h1 else 1) / (_fx_on(h2, d0) if h2 else 1)
                f1 = (_fx_on(h1, today.isoformat()) if h1 else 1) / (_fx_on(h2, today.isoformat()) if h2 else 1)
                rb = (1 + rl) * f1 / f0 - 1
            rets[p] = {"local": rl, "base": rb}
        out.append({"ticker": b["ticker"], "name": q["name"], "w": b["w"], "currency": ccy, "returns": rets})
    blend = {}
    for p in PERIODS:
        parts = [(b["w"], b["returns"][p]["base"]) for b in out if b.get("returns", {}).get(p)]
        if parts:
            wsum = sum(w for w, _ in parts)
            blend[p] = sum(w * r for w, r in parts) / wsum
    return {"parts": out, "blend": blend}


def value_series(rows, qts, base, bench):
    """Weekly portfolio value (current quantities) vs blended benchmark, both indexed to 100."""
    priced = [r for r in rows if r["price_src"] == "quote" and qts.get(r["ticker"]) and qts[r["ticker"]].get("series")]
    if not priced:
        return None
    ref = max(priced, key=lambda r: len(qts[r["ticker"]]["series"]))
    days = [p[0] for p in qts[ref["ticker"]]["series"]][::5]
    if not days:
        return None
    static = sum(r["value"] or 0 for r in rows if r not in priced)
    pts = []
    for ts in days:
        d_iso = dt.date.fromtimestamp(ts).isoformat()
        v = static
        for r in priced:
            c = _close_on(qts[r["ticker"]]["series"], ts)
            if c is None:
                c = qts[r["ticker"]]["series"][0][1]
            ccy, c = _norm_ccy(r["currency"], c)
            f = 1.0
            if ccy != base:
                h1, h2 = feeds.fx_history(ccy), feeds.fx_history(base)
                a = _fx_on(h1, d_iso) if h1 else 1.0
                b = _fx_on(h2, d_iso) if h2 else 1.0
                f = (a / b) if (a and b) else 1.0
            v += r["quantity"] * c * f
        bv = 0.0
        bw = 0.0
        for b in bench["parts"]:
            q = qts.get(b["ticker"])
            if not q or not q.get("series"):
                continue
            c0 = q["series"][0][1]
            c = _close_on(q["series"], ts) or c0
            bv += b["w"] * c / c0
            bw += b["w"]
        pts.append([ts, v, (bv / bw) if bw else None])
    v0 = pts[0][1] or 1
    return [[t, v / v0 * 100, (b * 100 if b else None)] for t, v, b in pts]


def hidden_exposures(rows, exposures):
    """Holdings that look different but lean on the same underlying driver or dependency."""
    out = []
    for f, e in exposures.items():
        if f in ("growth", "risk"):
            continue  # every equity leans on these; that's market beta, not a hidden exposure
        members = [r for r in rows if abs(r["sens"].get(f, 0)) >= .45 and r["weight"] > 0.005]
        if len(members) < 2:
            continue
        sign_groups = {}
        for r in members:
            sign_groups.setdefault(1 if r["sens"][f] > 0 else -1, []).append(r)
        for sign, grp in sign_groups.items():
            sectors = sorted({r["sector"] for r in grp})
            w = sum(r["weight"] for r in grp)
            if len(grp) >= 2 and len(sectors) >= 2 and w >= .12:
                label = kb.FACTORS[f][0]
                out.append({
                    "type": "driver", "factor": f, "label": label, "direction": sign, "weight": w,
                    "holdings": [{"ticker": r["ticker"] or r["name"], "sector": r["sector"], "sens": r["sens"][f],
                                  "weight": r["weight"], "src": r["sens_source"]} for r in sorted(grp, key=lambda x: -x["weight"])],
                    "headline": "%d holdings across %d sectors (%.0f%% of portfolio) all %s %s" % (
                        len(grp), len(sectors), w * 100, "benefit from rising" if sign > 0 else "are hurt by rising", label.lower()),
                    "gaps": [r["ticker"] for r in grp if "default" in (r["sens_source"] or "") or r["sector"] == "Unclassified"],
                })
    deps = {}
    for r in rows:
        for d in r["deps"]:
            deps.setdefault(d.lower(), (d, []))[1].append(r)
    for key, (label, grp) in deps.items():
        if len(grp) >= 2:
            w = sum(r["weight"] for r in grp)
            out.append({"type": "dependency", "label": label, "weight": w,
                        "holdings": [{"ticker": r["ticker"] or r["name"], "sector": r["sector"], "weight": r["weight"]} for r in grp],
                        "headline": "%d holdings (%.0f%%) share a dependency on %s" % (len(grp), w * 100, label),
                        "gaps": ["Dependencies come from built-in reference notes and your own tags; verify against filings."]})
    usd = sum(r["weight"] for r in rows if r["currency"] == "USD")
    if usd > .4:
        out.append({"type": "currency", "label": "US dollar", "weight": usd,
                    "holdings": [{"ticker": r["ticker"], "sector": r["sector"], "weight": r["weight"]} for r in rows if r["currency"] == "USD"][:10],
                    "headline": "%.0f%% of the portfolio is priced in US dollars: a stronger loonie lowers its value in your base currency" % (usd * 100),
                    "gaps": []})
    out.sort(key=lambda x: -x["weight"])
    return out


# ---------------------------------------------------------------------------
# Consequence map ("How does this affect me?")
# ---------------------------------------------------------------------------

def detect_shocks(text):
    t = " " + (text or "").lower() + " "
    found = []
    for s in kb.SHOCKS:
        hits = re.findall(s["rx"], t)
        if not hits:
            continue
        direction = 1
        if s.get("neg") and re.search(s["neg"], t):
            direction = -1
        terms = sorted({(h if isinstance(h, str) else h[0]) for h in hits if h})
        found.append({"shock": s, "dir": direction, "terms": terms[:5], "n": len(hits)})
    found.sort(key=lambda x: -x["n"])
    return found[:3]


def _edge_lookup():
    return {(e[0], e[1]): e for e in kb.EDGES}


def propagate(impulses, hops=1, floor=.12):
    """First- and second-order driver moves from direct impulses."""
    direct = dict(impulses)
    total = dict(impulses)
    paths = []
    frontier = dict(impulses)
    for _ in range(hops):
        nxt = {}
        for (a, b), e in _edge_lookup().items():
            if a in frontier:
                v = frontier[a] * e[2] * e[3]
                if abs(v) >= floor and b not in direct:
                    nxt[b] = nxt.get(b, 0) + v
                    paths.append((a, b, v, e))
        for k, v in nxt.items():
            total[k] = max(-1.2, min(1.2, total.get(k, 0) + v))
        frontier = nxt
    return direct, total, paths


def impact_map(space, title, text="", story_id=None, extra_impulses=None):
    shocks = detect_shocks(title + " " + text)
    impulses = {}
    for s in shocks:
        for f, v in s["shock"]["impulse"].items():
            impulses[f] = impulses.get(f, 0) + v * s["dir"] * (1 if s is shocks[0] else .6)
    for f, v in (extra_impulses or {}).items():
        impulses[f] = v
    impulses = {k: max(-1.2, min(1.2, v)) for k, v in impulses.items()}
    direct, total, paths = propagate(impulses)
    port = portfolio(space)
    plans = db.list_records(space, "plan")
    nodes, edges = [], []
    nodes.append({"id": "ev", "layer": 0, "label": title[:90], "kind": "event"})
    for f, v in total.items():
        nodes.append({"id": "f:" + f, "layer": 1 if f in direct else 2, "label": kb.FACTORS[f][0], "kind": "driver",
                      "value": v, "desc": kb.FACTORS[f][1]})
    for s in shocks:
        sh = s["shock"]
        for f, v in sh["impulse"].items():
            if f not in direct:
                continue
            edges.append({"from": "ev", "to": "f:" + f, "sign": 1 if v * s["dir"] > 0 else -1, "strength": min(1, abs(v)),
                          "type": "interpretation", "horizon": "immediate",
                          "logic": "The story's language (%s) matches the pattern '%s', which implies %s %s." % (
                              ", ".join('"%s"' % x for x in s["terms"][:3]), sh["label"], kb.lower_label(f),
                              "rising" if v * s["dir"] > 0 else "falling"),
                          "evidence": "Pattern match on headline/summary text. Direction inferred from wording; verify against the source.",
                          "uncertainty": "medium" if s["n"] > 1 else "high",
                          "offsets": sh["counter"], "threshold": "; ".join(sh["watch"][:2]),
                          "watch": sh["watch"]})
    for a, b, v, e in paths:
        edges.append({"from": "f:" + a, "to": "f:" + b, "sign": 1 if v > 0 else -1, "strength": abs(v), "type": "interpretation",
                      "horizon": e[4], "logic": e[5], "evidence": e[6], "uncertainty": e[7], "offsets": e[8], "threshold": e[9]})
    # sectors present in portfolio (or top generic ones if no holdings)
    sector_names = sorted({r["sector"] for r in port["holdings"]}) or ["US Equity (broad)", "Energy", "Banks", "Technology", "Consumer Discretionary"]
    sector_scores = {}
    for sname in sector_names:
        beta, sens = kb.SECTORS.get(sname, (1, {}))
        sc = sum(sens.get(f, 0) * v for f, v in total.items())
        if abs(sc) < .08:
            continue
        sector_scores[sname] = sc
        nodes.append({"id": "s:" + sname, "layer": 3, "label": sname, "kind": "industry", "value": sc})
        for f, v in total.items():
            sv = sens.get(f, 0)
            if abs(sv * v) >= .08:
                edges.append({"from": "f:" + f, "to": "s:" + sname, "sign": 1 if sv * v > 0 else -1, "strength": min(1, abs(sv * v)),
                              "type": "estimate", "horizon": "varies",
                              "logic": "%s tends to %s when %s %s (built-in sensitivity %+.1f)." % (
                                  sname, "gain" if sv > 0 else "suffer", kb.lower_label(f), "rises", sv),
                              "evidence": "Rough sector sensitivity from the knowledge base (editable per holding). Not a forecast.",
                              "uncertainty": "medium", "offsets": "Company-specific factors often dominate sector tendencies.",
                              "threshold": "The %s move would need to be large and persistent relative to what markets already expect." % kb.lower_label(f)})
    impacts = []
    for r in port["holdings"]:
        contrib = [(f, r["sens"].get(f, 0) * v) for f, v in total.items() if r["sens"].get(f)]
        sc = sum(c for _, c in contrib)
        if abs(sc) < .08 or r["sector"] not in sector_scores:
            continue
        impacts.append((r, sc, contrib))
    impacts.sort(key=lambda x: -abs(x[1]) * (x[0]["weight"] + .02))
    for r, sc, contrib in impacts[:10]:
        hid = "h:" + r["id"]
        nodes.append({"id": hid, "layer": 4, "label": r["ticker"] or r["name"], "kind": "holding", "value": sc,
                      "weight": r["weight"], "ref": {"kind": "holding", "id": r["id"]}})
        top = sorted(contrib, key=lambda x: -abs(x[1]))[:3]
        th = (r.get("thesis") or {}).get("why")
        edges.append({"from": "s:" + r["sector"], "to": hid, "sign": 1 if sc > 0 else -1, "strength": min(1, abs(sc)),
                      "type": "calculated", "horizon": "varies",
                      "logic": "%s (%.1f%% of your portfolio): net tilt %+.2f from %s." % (
                          r["ticker"] or r["name"], r["weight"] * 100, sc,
                          ", ".join("%s %+.2f" % (kb.lower_label(f), c) for f, c in top)),
                      "evidence": "Your position weight x sensitivities (%s)." % (r["sens_source"] or "defaults") + (
                          " Your thesis: “%s”" % th[:160] if th else ""),
                      "uncertainty": "medium" if "preset" in (r["sens_source"] or "") or "overrides" in (r["sens_source"] or "") else "high",
                      "offsets": "Hedges within the business (pricing power, currency, diversification) are not modelled.",
                      "threshold": "For this to matter to the position, the driver move must be large enough to change earnings expectations or the valuation multiple."})
    for p in plans:
        pf = p.get("factors") or kb.PLAN_TEMPLATES.get(p.get("template") or "", {})
        contrib = [(f, pf.get(f, 0) * v) for f, v in total.items() if pf.get(f)]
        sc = sum(c for _, c in contrib)
        if abs(sc) < .08:
            continue
        pid = "p:" + p["id"]
        nodes.append({"id": pid, "layer": 4, "label": p.get("title", "Plan"), "kind": "plan", "value": sc,
                      "ref": {"kind": "plan", "id": p["id"]}})
        for f, c in contrib:
            if abs(c) >= .08:
                edges.append({"from": "f:" + f, "to": pid, "sign": 1 if c > 0 else -1, "strength": min(1, abs(c)),
                              "type": "interpretation", "horizon": p.get("horizon") or "your plan's timeline",
                              "logic": "Your plan “%s” is %s by %s %s." % (
                                  p.get("title"), "helped" if c > 0 else "hurt", kb.lower_label(f),
                                  "rising" if total[f] > 0 else "falling"),
                              "evidence": "Plan-to-driver mapping (%s)." % ("your settings" if p.get("factors") else "template"),
                              "uncertainty": "medium", "offsets": "Depends on your timing and alternatives.",
                              "threshold": "Only matters if the move persists into the window when you act on the plan."})
    port_effect = sum(r["weight"] * sc for r, sc, _ in impacts)
    gains = [r["ticker"] for r, sc, _ in impacts if sc > 0][:4]
    losses = [r["ticker"] for r, sc, _ in impacts if sc < 0][:4]
    offsets = []
    if gains and losses:
        offsets.append("Partly offsetting inside your portfolio: %s lean positive while %s lean negative." % (
            ", ".join(gains), ", ".join(losses)))
    for s in shocks:
        offsets.append(s["shock"]["counter"])
    eps = [e for e in kb.EPISODES if set(e["applies"]) & set(k for k, v in direct.items() if abs(v) > .3)][:2]
    return {
        "title": title, "story_id": story_id, "nodes": nodes, "edges": edges,
        "shocks": [{"label": s["shock"]["label"], "dir": s["dir"], "terms": s["terms"], "people": s["shock"]["people"],
                    "business": s["shock"]["business"], "markets": s["shock"]["markets"], "watch": s["shock"]["watch"]} for s in shocks],
        "portfolio_tilt": port_effect,
        "tilt_label": _tilt_label(port_effect),
        "offsets": offsets, "episodes": eps, "base": port["base"],
        "method": "Built-in transmission model: pattern match -> driver impulses -> one hop of economic channels -> your sensitivities. "
                  "Interpretation, not a forecast.",
        "empty": not shocks,
    }


def _tilt_label(x):
    a = abs(x)
    if a < .02:
        return "negligible"
    s = "small" if a < .08 else ("moderate" if a < .2 else "large")
    return "%s %s tilt" % (s, "positive" if x > 0 else "negative")


# ---------------------------------------------------------------------------
# Scenario lab
# ---------------------------------------------------------------------------

UNITS = {"rates": ("bp", 100.0), "inflation": ("pp", 1.5), "oil": ("%", 30.0), "growth": ("pp GDP", 1.5)}
K = {"rates": 6.0, "default": 7.0}

PRESETS = [
    {"id": "higher", "name": "Rates stay elevated", "inputs": {"rates": 75, "market": -5},
     "desc": "Policy rates stay higher through the next year instead of the cuts markets expect."},
    {"id": "inflation", "name": "Inflation re-accelerates", "inputs": {"inflation": 2, "rates": 100, "oil": 20, "market": -8}},
    {"id": "cad", "name": "Canadian dollar weakens 10%", "inputs": {"cad": -10}},
    {"id": "growth", "name": "Growth slows sharply", "inputs": {"growth": -2, "rates": -100, "oil": -25, "market": -15}},
    {"id": "oil", "name": "Oil spike (+50%)", "inputs": {"oil": 50, "inflation": 1, "market": -4}},
    {"id": "ai", "name": "AI capex pullback", "inputs": {"factors": {"ai_capex": -1.5, "risk": -.5}, "market": -10}},
    {"id": "taiwan", "name": "Taiwan supply disruption", "inputs": {"factors": {"chips": 2, "china": 2, "risk": -1}, "market": -15}},
]


def scenario(space, inputs):
    port = portfolio(space)
    base = port["base"]
    u = {}
    for f, (unit, scale) in UNITS.items():
        if inputs.get(f):
            u[f] = float(inputs[f]) / scale
    for f, v in (inputs.get("factors") or {}).items():
        if f in kb.FACTORS:
            u[f] = u.get(f, 0) + float(v)
    second = []
    if inputs.get("second_order", True) and u:
        direct, total, paths = propagate(u, floor=.1)
        second = [{"from": kb.FACTORS[a][0], "to": kb.FACTORS[b][0], "value": v, "logic": e[5]} for a, b, v, e in paths]
        u = total
    mkt = float(inputs.get("market") or 0)
    cad = float(inputs.get("cad") or 0) / 100.0
    shock_id = inputs.get("holding")
    shock_pct = float(inputs.get("holding_pct") or 0) / 100.0
    rows = []
    tot_est = tot_calc = 0.0
    for r in port["holdings"]:
        if not r["value"]:
            continue
        parts = []
        est = 0.0
        if mkt:
            v = r["beta"] * mkt / 100.0
            parts.append({"driver": "Market move x beta %.2f" % r["beta"], "pct": v, "label": "estimate"})
            est += v
        for f, uv in u.items():
            s = r["sens"].get(f, 0)
            if not s or f == "risk" and mkt:
                continue
            v = s * uv * K.get(f, K["default"]) / 100.0
            if abs(v) > .0005:
                parts.append({"driver": kb.FACTORS[f][0], "pct": v, "label": "estimate"})
                est += v
        if cad and r["sens"].get("cad"):
            v = r["sens"]["cad"] * (cad * 10) * K["default"] / 100.0
            parts.append({"driver": "CAD sensitivity of the business", "pct": v, "label": "estimate"})
            est += v
        calc = 0.0
        if shock_id and r["id"] == shock_id:
            calc += shock_pct
            est = 0.0
            parts = [{"driver": "Your assumed price move", "pct": shock_pct, "label": "calculated"}]
        tr = 0.0
        if cad and r["currency"] != base:
            # CAD moves c vs USD: a foreign asset's CAD value scales by 1/(1+c); a CAD asset's value in another base scales by (1+c).
            # Non-USD foreign currencies are assumed to move with the USD (stated in limitations).
            tr = (1 / (1 + cad) - 1) if base == "CAD" else (cad if r["currency"] == "CAD" else 0.0)
        if tr:
            parts.append({"driver": "Currency translation (%s to %s)" % (r["currency"], base), "pct": tr, "label": "calculated"})
            calc = (1 + calc) * (1 + tr) - 1
        total_pct = (1 + est) * (1 + calc) - 1
        rows.append({"id": r["id"], "ticker": r["ticker"] or r["name"], "sector": r["sector"], "weight": r["weight"],
                     "value": r["value"], "est_pct": est, "calc_pct": calc, "pct": total_pct,
                     "low": (1 + est * .5) * (1 + calc) - 1 if est >= 0 else (1 + est * 1.5) * (1 + calc) - 1,
                     "high": (1 + est * 1.5) * (1 + calc) - 1 if est >= 0 else (1 + est * .5) * (1 + calc) - 1,
                     "delta": r["value"] * total_pct, "parts": parts, "sens_source": r["sens_source"]})
        tot_est += r["value"] * est
        tot_calc += r["value"] * total_pct
    rows.sort(key=lambda x: x["delta"])
    total = port["total"] or 1
    lo = sum(x["value"] * x["low"] for x in rows)
    hi = sum(x["value"] * x["high"] for x in rows)
    active = [f for f, v in u.items() if abs(v) > .2] + (["cad"] if cad else []) + (["risk"] if mkt else [])
    eps = [e for e in kb.EPISODES if set(e["applies"]) & set(active)][:3]
    return {
        "base": base, "total": port["total"], "delta": tot_calc, "pct": tot_calc / total, "low": lo / total, "high": hi / total,
        "rows": rows, "drivers": {kb.FACTORS[f][0]: v for f, v in u.items()}, "second_order": second, "episodes": eps,
        "limitations": [
            "Driver effects are hypothetical estimates from rough sector sensitivities (range shown = 0.5x to 1.5x).",
            "Currency translation and single-holding moves are calculated exactly from your inputs.",
            "Correlations between drivers beyond one hop, valuation starting points and company specifics are not modelled.",
            "Historical episodes are context, not predictions: each had different starting conditions.",
        ],
    }
