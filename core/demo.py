"""Demonstration workspace. Lives only in the 'demo' space, is watermarked in the
UI, and never mixes with your live records. Tickers are real (so live prices and
filings flow), but every quantity, person, event and decision here is fictional."""
import datetime as dt
import time

from . import db

DAY = 86400


def _d(days):
    return (dt.date.today() + dt.timedelta(days=days)).isoformat()


def _t(days, hh, mm=0):
    d = dt.datetime.combine(dt.date.today() + dt.timedelta(days=days), dt.time(hh, mm)).astimezone()
    return d.isoformat()


def seed():
    if db.q1("SELECT id FROM records WHERE space='demo' LIMIT 1"):
        return False
    S = "demo"
    now = time.time()
    for k, v in {"base_currency": "CAD", "interests": ["AI", "venture capital", "semiconductors", "Canadian housing", "Shopify"],
                 "objectives": "Grow long-term wealth for a home purchase in ~2 years and retirement; tolerate volatility but avoid single-name blowups.",
                 "constraints": "No single stock above 15%; keep 6 months of expenses in cash.", "max_position": .15, "max_sector": .35,
                 "benchmark": [{"ticker": "^GSPC", "w": .6}, {"ticker": "^GSPTSE", "w": .4}]}.items():
        db.set_setting(S, k, v)
    H = [
        ("SHOP.TO", 120, 95, "TFSA", {"why": "Commerce operating system for independent brands; I expect GMV growth above 20% with expanding margins as it scales payments and enterprise.",
                                    "expect": "Revenue growth >20% for 3 years; free-cash-flow margin rising toward the high teens.",
                                    "wrong_if": "GMV growth falls below 15% or take rate stalls; enterprise wins slow; margin expansion reverses.",
                                    "indicators": ["GMV", "take rate", "merchant", "enterprise", "margin"], "horizon": "3-5 years", "conviction": 4}),
        ("RY.TO", 150, 140, "RRSP", {"why": "Best-in-class Canadian bank with durable deposit franchise and wealth management growth.",
                                   "expect": "High-single-digit EPS growth, steady dividend increases.", "wrong_if": "Mortgage credit losses spike as renewals reset at higher rates.",
                                   "indicators": ["provisions", "credit losses", "mortgage", "renewal"], "horizon": "5+ years", "conviction": 4}),
        ("CNQ.TO", 400, 42, "Taxable", {"why": "Long-life, low-decline oil sands assets generate free cash flow across the cycle; buybacks and dividends.",
                                      "expect": "Returns >10% with oil above $65 WTI.", "wrong_if": "Oil below $55 for a year, or the federal emissions cap forces production cuts.",
                                      "indicators": ["oil", "emissions cap", "wcs", "opec"], "horizon": "3+ years", "conviction": 3}),
        ("ENB.TO", 300, 50, "TFSA", {"why": "Regulated-like pipeline cash flows fund a growing dividend.", "expect": "Dividend growth 3-5% a year.",
                                    "wrong_if": "Payout coverage weakens or rates stay high enough to pressure the valuation.",
                                    "indicators": ["distributable cash flow", "rates"], "horizon": "5+ years", "conviction": 3}),
        ("NVDA", 90, 110, "RRSP", {"why": "The default platform for AI compute; CUDA software moat plus networking make it more than a chip company.",
                                  "expect": "Data-centre revenue keeps compounding while hyperscalers expand capex.",
                                  "wrong_if": "Hyperscaler capex guidance falls, custom chips take share, or export controls cut China materially.",
                                  "indicators": ["capex", "data center", "export controls", "custom chips", "blackwell"], "horizon": "2-4 years", "conviction": 4}),
        ("AAPL", 60, 180, "Taxable", {"why": "Installed base of 2B+ devices monetised through services.", "expect": "Services growth offsets flat hardware.",
                                     "wrong_if": "App Store fees are forced down materially or China sales keep shrinking.",
                                     "indicators": ["app store", "services", "china"], "horizon": "5 years", "conviction": 3}),
        ("MSFT", 25, 380, "RRSP", None),
        ("TSM", 70, 150, "RRSP", {"why": "Sole supplier at the leading edge for AI accelerators and iPhone chips.", "expect": "Advanced-node revenue share keeps rising.",
                                 "wrong_if": "Military escalation around Taiwan, or overseas fabs dilute margins more than expected.",
                                 "indicators": ["taiwan", "margins", "arizona"], "horizon": "3-5 years", "conviction": 3}),
        ("BRK-B", 30, 400, "Taxable", None),
        ("XEQT.TO", 800, 30, "TFSA",
         {"why": "Core global equity exposure at low cost.", "expect": "Market returns.", "wrong_if": "N/A: core holding.", "indicators": [], "horizon": "20+ years", "conviction": 5}),
        ("AC.TO", 300, 18, "Taxable", {"why": "Travel recovery and fleet renewal; cheap relative to earnings.", "expect": "Re-rating as margins normalise.",
                                      "wrong_if": "Fuel costs spike or consumer travel demand weakens.",
                                      "indicators": ["fuel", "jet fuel", "travel demand", "strike"], "horizon": "1-2 years", "conviction": 2}),
    ]
    for tkr, qty, cost, acct, th in H:
        rec = {"ticker": tkr, "quantity": qty, "cost": cost, "account": acct}
        if tkr == "AC.TO":
            rec["sector"] = "Airlines"
            rec["deps"] = ["Jet fuel prices", "Consumer travel demand"]
        if tkr == "XEQT.TO":
            rec["sector"] = "Global Equity (broad)"
        if th:
            rec["thesis"] = th
        if tkr == "SHOP.TO":
            rec["catalysts"] = [{"date": _d(33), "title": "Q3 results (demo date)"}]
        db.create_record(S, "holding", rec, ts=now - 200 * DAY)
    db.create_record(S, "holding", {"ticker": "CASH", "name": "High-interest savings", "quantity": 15000, "currency": "CAD", "account": "Cash"})
    for t, reason in (("ASML", "Lithography monopoly; wait for a better entry"), ("COST", "Quality compounder, too expensive today"),
                      ("BN.TO", "Private-markets exposure if rates fall")):
        db.create_record(S, "watch", {"ticker": t, "reason": reason})
    C = [
        ("c1", "Maya Okafor", "Partner", "Northstar Ventures", "Venture capital", "Toronto", 5, 4, 3, "MBA classmate", None, ["founder", "investor"], ["climate", "fintech", "running"],
         _d(5 - 365 * 34), 12),
        ("c2", "Daniel Reyes", "Head of Product", "Shopify", "Technology", "Ottawa", 4, 3, 2, "Met at Collision conference 2024", "c1", ["product", "operator"], ["commerce", "design"],
         _d(13 - 365 * 31), 40),
        ("c3", "Priya Raman", "Principal", "Sequoia Capital", "Venture capital", "San Francisco", 3, 4, 4, "Intro from Maya", "c1", ["investor"], ["AI", "developer tools"], None, 75),
        ("c4", "Tom Becker", "Engagement Manager", "McKinsey & Company", "Consulting", "New York", 3, 3, 2, "Case competition judge", None, ["consultant"], ["healthcare", "squash"], None, 120),
        ("c5", "Lena Fischer", "Founder & CEO", "Kiln Robotics", "Robotics", "Montreal", 4, 2, 1, "Worked together at my first company", None, ["founder", "startup", "engineer"],
         ["robotics", "climbing"], None, 20),
        ("c6", "Omar Haddad", "Portfolio Manager", "Brookfield", "Asset management", "Toronto", 3, 4, 3, "Family friend", None, ["investor", "finance"], ["infrastructure", "real estate"], None, 200),
        ("c7", "Grace Liu", "Senior Software Engineer", "NVIDIA", "Semiconductors", "Santa Clara", 2, 2, 1, "University roommate's sister", None, ["engineer"], ["AI", "chess"], None, 400),
        ("c8", "Samuel Adeyemi", "Associate", "a16z", "Venture capital", "New York", 3, 3, 3, "Podcast guest swap", "c3", ["investor", "vc"], ["crypto", "consumer"], None, 30),
        ("c9", "Isabelle Martin", "Director, Strategy", "Royal Bank of Canada", "Banking", "Toronto", 4, 3, 2, "MBA classmate", "c1", ["finance"], ["wine", "tennis"], _d(9 - 365 * 30), 15),
        ("c10", "Jonah Weiss", "Angel investor", "Independent", "Venture capital", "New York", 2, 3, 3, "Invested in my first company", None, ["investor", "founder", "angel"],
         ["media", "sports"], None, 260),
        ("c11", "Aisha Karim", "Recruiter", "Citadel", "Hedge fund", "New York", 2, 3, 2, "Career fair", None, ["hire", "talent"], [], None, 50),
        ("c12", "Marco Bellini", "CFO", "Kiln Robotics", "Robotics", "Montreal", 2, 2, 1, "Via Lena", "c5", ["finance", "operator"], ["F1"], None, 90),
        ("c13", "Hannah Cho", "Product Lead", "Anthropic", "AI", "San Francisco", 3, 3, 3, "Hackathon teammate", None, ["product", "ai"], ["AI safety", "hiking"], None, 55),
        ("c14", "Ethan Moore", "Mortgage specialist", "TD Bank", "Banking", "Toronto", 2, 1, 1, "Referred by Isabelle", "c9", ["finance"], ["real estate"], None, 150),
        ("c15", "Sofia Alvarez", "Mentor; former COO", "Wealthsimple", "Fintech", "Toronto", 5, 4, 3, "Early employee at her company", None, ["operator", "founder", "startup"],
         ["fintech", "cooking"], _d(21 - 365 * 45), 8),
        ("c16", "Rahul Mehta", "Analyst", "Pershing Square", "Hedge fund", "New York", 2, 2, 2, "Investment club", None, ["investor", "finance"], ["value investing"], None, 310),
    ]
    ids = {}
    for key, name, role, org, ind, city, clos, infl, prom, how, intro, exp, ints, bday, last_days in C:
        rec = {"name": name, "role": role, "org": org, "industry": ind, "city": city, "closeness": clos, "influence": infl, "prominence": prom,
               "how_met": how, "experience": exp, "interests": ints, "birthday": bday,
               "notes": "", "interactions": [{"date": _d(-last_days), "type": "coffee" if last_days % 2 else "call", "notes": "Caught up on work and plans."}]}
        r = db.create_record(S, "contact", rec)
        ids[key] = r["id"]
    def upd(k, **kw):
        cur = db.get_record(S, ids[k])
        cur.update(kw)
        db.update_record(S, ids[k], cur)
    upd("c1", introduced_by=None, notes="Invests seed-stage climate and fintech. Offered to introduce me to her LPs and to Priya at Sequoia. Loves trail running.",
        connections=[{"id": ids["c3"], "verified": True}, {"id": ids["c9"], "verified": True}, {"id": ids["c6"], "verified": False}],
        commitments=[{"text": "Send her my thesis memo on Canadian fintech", "due": _d(-4), "made": _d(-20)}],
        interactions=[{"date": _d(-40), "type": "dinner", "notes": "Talked about her new fund. She asked for my memo on Canadian fintech."},
                      {"date": _d(-12), "type": "text", "notes": "Congratulated her on the fund close."}])
    upd("c2", introduced_by=ids["c1"], connections=[{"id": ids["c5"], "verified": False}], notes="Runs a product org of ~80. Said Shopify is hiring senior PMs with founder backgrounds.")
    upd("c3", introduced_by=ids["c1"], connections=[{"id": ids["c8"], "verified": True}, {"id": ids["c13"], "verified": False}],
        notes="Focus on AI infrastructure and developer tools. Asked what I think about vertical AI in Canada.",
        commitments=[{"text": "Share list of three Canadian AI startups worth meeting", "due": _d(6), "made": _d(-10)}])
    upd("c4", connections=[{"id": ids["c11"], "verified": False}], notes="Could explain McKinsey's hiring process for experienced hires.")
    upd("c5", connections=[{"id": ids["c12"], "verified": True}, {"id": ids["c2"], "verified": False}],
        notes="Building warehouse robotics. Raising a Series A in Q1. Asked me to look at her pitch deck.",
        commitments=[{"text": "Give feedback on Series A deck", "due": _d(3), "made": _d(-6)}],
        milestones=[{"title": "Kiln Robotics 5-year anniversary", "date": _d(18)}])
    upd("c6", notes="Knows infrastructure and real-assets investing inside out. Good person to understand how private markets react to higher rates.")
    upd("c7", notes="Works on inference software. Very technical; knows the internal view on AI demand.")
    upd("c8", connections=[{"id": ids["c10"], "verified": True}], notes="Covers consumer and crypto at a16z.")
    upd("c9", connections=[{"id": ids["c14"], "verified": True}], notes="Strategy at RBC; sharp on Canadian housing and mortgage renewals.")
    upd("c10", notes="Early backer. Generous with intros in New York media and sports.")
    upd("c11", notes="Recruits for Citadel's investing roles.")
    upd("c13", notes="PM on developer platform. Good read on how AI labs think about enterprise adoption.")
    upd("c15", notes="Mentor. Built and scaled a fintech ops team. Best person to pressure-test career decisions.",
        commitments=[{"text": "Update her on the job search", "due": _d(10), "made": _d(-30)}])
    E = [
        {"title": "Coffee with Maya Okafor", "start": _t(1, 10), "end": _t(1, 11), "category": "professional", "people": [ids["c1"]], "location": "Toronto"},
        {"title": "Portfolio review block", "start": _t(1, 14), "end": _t(1, 15, 30), "category": "financial"},
        {"title": "Call with Priya Raman (Sequoia)", "start": _t(3, 13), "end": _t(3, 13, 45), "category": "professional", "people": [ids["c3"]]},
        {"title": "Dentist", "start": _t(3, 13, 30), "end": _t(3, 14, 30), "category": "personal"},
        {"title": "Trip to New York", "start": _d(8), "end": _d(11), "all_day": True, "category": "travel", "location": "New York"},
        {"title": "Isabelle & Luc's wedding", "start": _d(22), "all_day": True, "category": "personal", "people": [ids["c9"]], "importance": 3},
        {"title": "Run club", "start": _t(-6, 7), "end": _t(-6, 8), "category": "personal", "recur": "weekly"},
        {"title": "Kiln Robotics deck review", "start": _t(2, 16), "end": _t(2, 17), "category": "professional", "people": [ids["c5"]]},
    ]
    for e in E:
        db.create_record(S, "event", e)
    db.create_record(S, "decision", {
        "title": "Buy NVIDIA at ~US$110", "category": "investment", "date": _d(-200), "ticker": "NVDA", "price_at_decision": 110,
        "decision": "Buy 90 shares of NVDA in the RRSP.",
        "rationale": "AI compute demand is early; CUDA lock-in means share losses to custom chips will be slow.",
        "assumptions": [{"text": "Hyperscaler capex keeps growing through next year", "confidence": 70},
                        {"text": "Custom chips (TPU, Trainium) stay below 20% of accelerator spend", "confidence": 60},
                        {"text": "Export controls don't cut total revenue by more than 10%", "confidence": 55}],
        "alternatives": "Buy TSM instead (less valuation risk, more geopolitical risk); buy SMH ETF.",
        "expectations": "Stock outperforms the Nasdaq over 2 years.", "review_date": _d(-5)}, ts=now - 200 * DAY)
    db.create_record(S, "decision", {
        "title": "Focus job search on venture and product roles", "category": "career", "date": _d(-35),
        "decision": "Prioritise VC associate/principal and senior PM roles over consulting for the next 3 months.",
        "rationale": "Founder background is most valued there; consulting would reset my trajectory.",
        "assumptions": [{"text": "At least 3 VC firms in Toronto/NYC are hiring this year", "confidence": 60},
                        {"text": "My network can produce 10 warm intros within 6 weeks", "confidence": 70}],
        "alternatives": "Consulting (McKinsey experienced-hire), corporate development.",
        "expectations": "Two final-round processes by the review date.", "review_date": _d(55)}, ts=now - 35 * DAY)
    db.create_record(S, "plan", {"title": "Buy a home in Toronto", "template": "Buy a home", "horizon": "2027"})
    db.create_record(S, "plan", {"title": "Land a venture or product role", "template": "Job search in venture, tech or finance", "horizon": "next 6 months"})
    db.create_record(S, "plan", {"title": "New York trip spending", "template": "Travel to the US or abroad (spending in foreign currency)", "horizon": "next 2 weeks"})
    for name, cik in (("Berkshire Hathaway", 1067983), ("Pershing Square", 1336528), ("Himalaya Capital", 1709323)):
        db.create_record(S, "investor", {"name": name, "cik": cik})
    db.create_record(S, "scenario", {"name": "Rates stay elevated", "inputs": {"rates": 75, "market": -5}, "note": "Saved to revisit after the October BoC decision."})
    db.create_record(S, "note",
                     {"title": "Why I'm overweight Canada", "text": "Home bias is partly deliberate: CAD liabilities (future home). Revisit if the CAD falls another 5%.", "tags": ["portfolio"]})
    return True
