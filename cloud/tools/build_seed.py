#!/usr/bin/env python3
"""Turn broker exports + contacts into a private seed for the LIVE workspace.

Reads RBC Direct Investing "Holdings Export" CSVs (any number of accounts), an
Apple/"MyContacts" CSV, and a few manual positions, then writes:

    private/seed_live.json   records (for local testing)
    private/seed_live.sql    INSERT OR IGNORE statements (for Cloudflare D1)

Record ids are deterministic, so re-running never duplicates anything and never
overwrites edits made in the app. The private/ folder is git-ignored and is
never uploaded as a web asset.
"""
import csv
import hashlib
import io
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "private")

# RBC symbol -> Yahoo symbol + overrides. Resolved and verified against Yahoo on 2026-09-25.
SYMBOLS = {
    "CVX": {"ticker": "CVX.NE", "name": "Chevron CDR (CAD-hedged)", "sector": "Energy", "country": "US",
            "deps": ["Crude oil price"], "note": "Canadian Depositary Receipt on Cboe Canada; CAD-hedged."},
    "LVMH": {"ticker": "LVMH.NE", "name": "LVMH CDR (CAD-hedged)", "sector": "Consumer Discretionary", "country": "FR",
             "deps": ["Luxury consumer demand", "China demand"], "note": "CDR on Cboe Canada; CAD-hedged."},
    "NET.UN": {"ticker": "NET-UN.V", "name": "Canadian Net REIT", "sector": "Real Estate", "country": "CA"},
    "PLZ.UN": {"ticker": "PLZ-UN.TO", "name": "Plaza Retail REIT", "sector": "Real Estate", "country": "CA"},
    "LMN": {"ticker": "LMN.V", "name": "Lumine Group", "sector": "Software", "country": "CA"},
    "P049485": {"ticker": "PRX.AS", "name": "Prosus N.V. (ordinary, Euronext)", "sector": "Communication", "country": "NL",
                "deps": ["Tencent stake", "China tech"], "note": "Broker symbol P049485; book cost shown as $0.01 (likely a corporate-action position with unknown cost)."},
    "PROSY": {"ticker": "PROSY", "sector": "Communication", "country": "NL", "deps": ["Tencent stake", "China tech"],
              "note": "ADR; 5 ADRs = 1 ordinary share."},
    "PROSF": {"ticker": "PROSF", "sector": "Communication", "country": "NL", "deps": ["Tencent stake", "China tech"]},
    "VPHIF": {"ticker": "VPHIF", "name": "Valeo Pharma (Class A)", "sector": "Health Care", "country": "CA",
              "note": "Trades near zero. Losses inside a TFSA are not tax-deductible."},
    "LQAVF": {"ticker": "LQAVF", "name": "Liquid Avatar Technologies", "sector": "Software", "country": "CA",
              "note": "Trades near zero. Losses inside a TFSA are not tax-deductible."},
    "GSAT": {"ticker": "GSAT", "sector": "Telecom", "country": "US"},
    "SNOW": {"ticker": "SNOW"}, "TSLA": {"ticker": "TSLA"}, "AMZN": {"ticker": "AMZN"}, "AAPL": {"ticker": "AAPL"},
    "SLB": {"ticker": "SLB", "sector": "Energy"}, "TTWO": {"ticker": "TTWO", "sector": "Communication"},
    "META": {"ticker": "META"}, "PLTR": {"ticker": "PLTR", "sector": "Software"}, "GOOG": {"ticker": "GOOG"},
    "NVDA": {"ticker": "NVDA"}, "AMD": {"ticker": "AMD"},
}
# Symbols that trade in USD but appear under "CAD Holdings" (RBC shows them converted to CAD).
USD_LISTED = {"SNOW", "TSLA", "AMZN", "PLTR", "GOOG", "NVDA", "AMD"}

MANUAL = [
    {"ticker": "JNRFX", "name": "Janus Henderson Research Fund (Class D)", "quantity": 420, "account": "Other",
     "sector": "US Equity (broad)", "country": "US", "sensitivities": {"rates": -0.6, "ai_capex": 0.5, "risk": 1.0},
     "deps": ["US large-cap growth", "Mega-cap tech"],
     "note": "US large-cap growth mutual fund (NAV, daily). Cost basis not provided; add it to see P/L.",
     "fund": {"cik": 277751, "series": "S000010470", "class": "C000083517"}},
]


def num(s):
    if s is None:
        return None
    s = str(s).replace(",", "").replace("$", "").replace("%", "").strip()
    if s in ("", "N/A", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def rid(prefix, *parts):
    return prefix + "_" + hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:12]


def parse_rbc(path):
    text = open(path, encoding="utf-8-sig", errors="replace").read()
    m = re.search(r"Account:\s*(\d+)\s*-\s*([A-Za-z ]+)", text)
    acct_no, acct_type = (m.group(1), m.group(2).strip()) if m else ("?", "Account")
    asof = re.search(r"as of ([A-Za-z]{3} \d{1,2}, \d{4})", text)
    asof = time.strftime("%Y-%m-%d", time.strptime(asof.group(1), "%b %d, %Y")) if asof else None
    lines = text.splitlines()
    out, cash = [], []
    # cash balances block
    for i, ln in enumerate(lines):
        if ln.startswith("Currency,Cash,Investments"):
            for row in csv.reader(lines[i + 1:i + 4]):
                if len(row) >= 2 and row[0] in ("CAD", "USD") and num(row[1]):
                    cash.append((row[0], num(row[1])))
    # holdings block
    start = next(i for i, ln in enumerate(lines) if ln.startswith(",Product,Symbol"))
    body = []
    for ln in lines[start:]:
        if not ln.strip():
            break
        body.append(ln)
    for r in csv.DictReader(io.StringIO("\n".join(body))):
        sym = (r.get("Symbol") or "").strip()
        if not sym:
            continue
        qty = num(r.get("Quantity"))
        listed_ccy = (r.get("Currency") or "").strip()
        book = num(r.get("Total Book Cost"))
        avg = num(r.get("Average Cost"))
        meta = dict(SYMBOLS.get(sym, {"ticker": sym}))
        rec = {"ticker": meta.pop("ticker"), "quantity": qty, "account": acct_type,
               "account_no": acct_no[-4:], "broker_symbol": sym,
               "broker_name": (r.get("Name") or "").strip().title(),
               "broker_price": num(r.get("Last Price")), "broker_currency": listed_ccy, "broker_asof": asof,
               "source": "RBC Direct Investing export %s" % (asof or "")}
        if sym in USD_LISTED and listed_ccy == "CAD":
            rec["cost_base_total"] = book          # book cost already in CAD
            rec["cost_note"] = "Book cost in CAD from RBC (includes FX at purchase)."
        elif sym == "P049485":
            rec["cost_note"] = meta.get("note")
        else:
            rec["cost"] = avg                      # per unit, in the listed currency
            if listed_ccy == "CAD":
                rec["cost_base_total"] = book
        div = num(r.get("Annual Dividend Amount $"))
        if div and sym not in ("NVDA",):          # RBC's NVDA figure is not per-share; use market data instead
            rec["div_annual_broker"] = div
            ex = (r.get("Dividend Ex Date") or "").strip()
            if ex:
                try:
                    rec["div_ex_date"] = time.strftime("%Y-%m-%d", time.strptime(ex, "%b %d, %Y"))
                except ValueError:
                    pass
        rec.update(meta)
        out.append(rec)
    for ccy, amt in cash:
        out.append({"ticker": "CASH", "name": "Cash (%s)" % ccy, "quantity": amt, "currency": ccy,
                    "account": acct_type, "account_no": acct_no[-4:], "source": "RBC export %s" % (asof or "")})
    return out


def parse_contacts(path):
    rows = list(csv.DictReader(open(path, encoding="utf-8-sig", errors="replace")))
    out = []
    for r in rows:
        g = {k: (v or "").strip() for k, v in r.items()}
        name = " ".join(x for x in (g.get("First Name"), g.get("Middle Name"), g.get("Last Name")) if x) or g.get("Nickname")
        if not name:
            continue
        org = g.get("Organization") or None
        if org and re.fullmatch(r"(?i)mba mcgill|mcgill mba", org):
            org = "McGill MBA"
        phones = [g[k] for k in ("Mobile", "iPhone", "Work", "Home", "Main", "Other Phone") if g.get(k)]
        emails = [g[k] for k in ("Home Email", "Work Email", "Other Email") if g.get(k)]
        bday = g.get("Birthday") or None
        if bday and bday.startswith("--"):
            bday = bday[2:]
        addr = g.get("Home Address") or g.get("Work Address") or g.get("Other Address") or ""
        city = None
        parts = [p.strip() for p in addr.split(",")]
        if len(parts) >= 2:
            city = parts[1] if not re.search(r"\d", parts[1]) else None
        rec = {"name": name, "org": org, "community": org, "role": g.get("Title") or None,
               "email": emails[0] if emails else None, "emails": emails[1:] or None,
               "phone": phones[0] if phones else None, "phones": phones[1:] or None,
               "birthday": bday, "city": city, "notes": g.get("Note") or "",
               "closeness": None, "influence": None, "prominence": None,
               "source": "Contacts export 2026-09-25"}
        out.append({k: v for k, v in rec.items() if v not in (None, "", [])})
    return out


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


def main(argv):
    holdings_files = [a for a in argv if "Holdings" in os.path.basename(a)]
    contacts_files = [a for a in argv if "Contacts" in os.path.basename(a)]
    now = time.time()
    records = []
    for f in holdings_files:
        for h in parse_rbc(f):
            key = (h.get("account_no"), h.get("broker_symbol") or h["ticker"] + h.get("currency", ""))
            records.append(("holding", rid("hol", *key), h))
    for h in MANUAL:
        records.append(("holding", rid("hol", "manual", h["ticker"]), h))
    for f in contacts_files:
        seen = set()
        for c in parse_contacts(f):
            k = (c["name"].lower(), c.get("phone") or c.get("email") or "")
            if k in seen:
                continue
            seen.add(k)
            records.append(("contact", rid("con", *k), c))
    settings = {
        "base_currency": "CAD",
        "interests": ["AI", "venture capital", "semiconductors", "Strait of Hormuz", "oil", "Canadian housing", "interest rates"],
        "objectives": "Grow long-term wealth across TFSA and RRSP; understand what moves my holdings.",
        "constraints": "",
        "max_position": 0.15, "max_sector": 0.35,
        "benchmark": [{"ticker": "^GSPC", "w": 0.6}, {"ticker": "^GSPTSE", "w": 0.4}],
        "timezones": ["America/Toronto", "America/New_York", "Europe/London", "Asia/Dubai"],
    }
    os.makedirs(OUT, exist_ok=True)
    os.chmod(OUT, 0o700)
    with open(os.path.join(OUT, "seed_live.json"), "w") as f:
        json.dump({"records": [{"kind": k, "id": i, "data": d} for k, i, d in records], "settings": settings}, f, indent=1)
    stmts = []
    for kind, i, d in records:
        body = json.dumps(d, separators=(",", ":"), ensure_ascii=False)
        stmts.append("INSERT OR IGNORE INTO records (id, space, kind, data, created, updated, deleted) VALUES (%s,'live',%s,%s,%d,%d,0);"
                     % (sql_str(i), sql_str(kind), sql_str(body), now, now))
        if kind == "holding":
            stmts.append("INSERT INTO revisions (record_id, ts, action, data) SELECT %s,%d,'create',%s WHERE NOT EXISTS (SELECT 1 FROM revisions WHERE record_id=%s);"
                         % (sql_str(i), now, sql_str(body), sql_str(i)))
    for k, v in settings.items():
        stmts.append("INSERT OR IGNORE INTO settings (space, key, value) VALUES ('live',%s,%s);" % (sql_str(k), sql_str(json.dumps(v))))
    with open(os.path.join(OUT, "seed_live.sql"), "w") as f:
        f.write("\n".join(stmts) + "\n")
    for p in ("seed_live.json", "seed_live.sql"):
        os.chmod(os.path.join(OUT, p), 0o600)
    hold = [d for k, _, d in records if k == "holding"]
    print("holdings: %d (%s)" % (len(hold), ", ".join(sorted({h["account"] for h in hold}))))
    print("contacts: %d (with org/tag: %d, with birthday: %d)" % (
        sum(1 for k, _, _ in records if k == "contact"),
        sum(1 for k, _, d in records if k == "contact" and d.get("org")),
        sum(1 for k, _, d in records if k == "contact" and d.get("birthday"))))
    print("statements: %d" % len(stmts))


if __name__ == "__main__":
    main(sys.argv[1:])
