"""Built-in knowledge base: economic drivers, sector sensitivities, transmission
channels, event patterns, plan templates, historical episodes and scheduled
market events.

Everything here is *interpretation* (textbook mechanisms and rough
sensitivities), not live data. The UI labels it that way and every number can
be overridden per holding. Sensitivities are on a -1..+1 scale: the direction
and rough strength with which a holding tends to move when that driver rises.
"""
import datetime as dt
import re

FACTORS = {
    "rates": ("Interest rates", "Policy rates and long-term bond yields"),
    "inflation": ("Inflation", "Consumer price growth"),
    "oil": ("Energy prices", "Crude oil, natural gas and fuel"),
    "usd": ("US dollar", "Broad strength of the US dollar"),
    "cad": ("Canadian dollar", "CAD versus USD (up = stronger loonie)"),
    "consumer": ("Consumer spending", "Household demand for goods and services"),
    "ai_capex": ("AI & data-centre spend", "Hyperscaler and enterprise AI infrastructure investment"),
    "chips": ("Chip supply disruption", "Risk to advanced semiconductor supply (Taiwan, export controls)"),
    "china": ("China / Taiwan tension", "US-China geopolitical and trade friction"),
    "credit": ("Credit stress", "Wider credit spreads, defaults, tighter lending"),
    "housing": ("Housing activity", "Home sales, prices and mortgage origination"),
    "tariffs": ("Tariffs & trade barriers", "Trade-policy friction and input-cost pass-through"),
    "regulation": ("Big-tech regulation", "Antitrust, platform and AI rules"),
    "growth": ("Economic growth", "Real GDP and corporate earnings momentum"),
    "metals": ("Metals & materials", "Copper, iron ore, gold, lithium and other materials"),
    "risk": ("Risk appetite", "Investor willingness to pay up for growth and risk"),
    "defense": ("Defence spending", "Government military budgets"),
    "wages": ("Wage growth", "Tight labour markets and pay growth"),
}

def lower_label(f):
    """Factor label for use mid-sentence, keeping acronyms intact."""
    return re.sub(r"\b(ai|us)\b", lambda m: m.group(1).upper(), FACTORS[f][0].lower())


# ---------------------------------------------------------------------------
# Sectors: beta to the broad market, and sensitivities to each driver.
# ---------------------------------------------------------------------------
SECTORS = {
    "Semiconductors": (1.45, {"ai_capex": .9, "chips": -.7, "china": -.6, "rates": -.5, "growth": .5, "risk": .8, "tariffs": -.4}),
    "Software": (1.2, {"rates": -.7, "ai_capex": .4, "risk": .8, "regulation": -.3, "growth": .3}),
    "Technology": (1.15, {"rates": -.5, "ai_capex": .5, "consumer": .4, "china": -.4, "regulation": -.4, "risk": .7, "tariffs": -.4}),
    "Communication": (1.05, {"consumer": .5, "regulation": -.5, "rates": -.4, "risk": .6, "growth": .4, "ai_capex": .3}),
    "Consumer Discretionary": (1.15, {"consumer": .9, "rates": -.5, "oil": -.3, "tariffs": -.5, "growth": .6, "risk": .5}),
    "Consumer Staples": (.6, {"inflation": -.2, "consumer": .2, "rates": -.3, "risk": -.2, "tariffs": -.2}),
    "Energy": (1.0, {"oil": 1.0, "growth": .4, "risk": .2, "rates": .1}),
    "Pipelines": (.7, {"rates": -.5, "oil": .3, "growth": .2}),
    "Banks": (1.0, {"rates": .3, "credit": -.8, "housing": .5, "growth": .6, "risk": .4}),
    "Insurance": (.8, {"rates": .4, "credit": -.3, "growth": .2}),
    "Asset Managers": (1.3, {"risk": .8, "rates": -.4, "credit": -.5, "growth": .4}),
    "Payments": (1.0, {"consumer": .8, "growth": .5, "regulation": -.3, "risk": .5}),
    "Industrials": (1.05, {"growth": .8, "tariffs": -.4, "oil": -.2, "defense": .3, "rates": -.3, "risk": .5}),
    "Transportation": (1.0, {"growth": .6, "oil": -.4, "tariffs": -.4, "consumer": .3}),
    "Airlines": (1.3, {"oil": -.9, "consumer": .6, "growth": .5}),
    "Materials": (1.1, {"metals": 1.0, "growth": .7, "china": -.3, "usd": -.4}),
    "Gold": (.2, {"usd": -.5, "rates": -.4, "risk": -.4, "inflation": .4, "metals": .6}),
    "Utilities": (.5, {"rates": -.8, "inflation": -.2, "risk": -.2, "ai_capex": .2}),
    "Real Estate": (.9, {"rates": -.9, "credit": -.5, "housing": .4, "growth": .3}),
    "Telecom": (.5, {"rates": -.6, "risk": -.1, "regulation": -.2}),
    "Health Care": (.75, {"rates": -.2, "regulation": -.3, "risk": .1}),
    "Defense": (.8, {"defense": 1.0, "risk": -.1}),
    "US Equity (broad)": (1.0, {"risk": 1.0, "growth": .6, "rates": -.4, "ai_capex": .3}),
    "Canada Equity (broad)": (.9, {"risk": .8, "oil": .4, "housing": .3, "metals": .3, "credit": -.3, "growth": .5}),
    "Global Equity (broad)": (.95, {"risk": .9, "growth": .6, "usd": -.2}),
    "Bonds": (0.0, {"rates": -1.0, "inflation": -.5, "credit": -.3, "risk": -.3}),
    "Cash": (0.0, {"rates": .1}),
    "Crypto": (2.0, {"risk": 1.0, "rates": -.6, "usd": -.3}),
    "Unclassified": (1.0, {}),
}

# Ticker presets: sector + optional tweaks on top of the sector defaults + dependencies.
# Dependencies are qualitative, widely reported business facts (label: reference note).
T = {}


def _p(tickers, sector, tweaks=None, deps=None, country="US"):
    for t in tickers.split():
        T[t] = {"sector": sector, "tweaks": tweaks or {}, "deps": deps or [], "country": country}


_p("NVDA", "Semiconductors", {"ai_capex": 1.0}, ["TSMC manufacturing", "Hyperscaler capex", "China export rules"])
_p("AMD AVGO QCOM MU INTC", "Semiconductors", {}, ["TSMC manufacturing", "Hyperscaler capex"])
_p("TSM", "Semiconductors", {"chips": -1.0, "china": -.9, "ai_capex": .8}, ["Taiwan", "Apple & Nvidia as customers"], "TW")
_p("ASML", "Semiconductors", {"china": -.7}, ["Chip-fab capex", "Export controls"], "NL")
_p("AAPL", "Technology", {"china": -.6, "consumer": .6, "tariffs": -.6}, ["China/India assembly", "TSMC manufacturing", "US consumer"])
_p("MSFT", "Software", {"ai_capex": .6, "regulation": -.3}, ["Enterprise IT budgets", "AI infrastructure"])
_p("GOOGL GOOG", "Communication", {"regulation": -.7, "ai_capex": .5}, ["Digital advertising", "Antitrust outcomes"])
_p("META", "Communication", {"regulation": -.6, "ai_capex": .5, "consumer": .5}, ["Digital advertising", "AI infrastructure"])
_p("AMZN", "Consumer Discretionary", {"ai_capex": .5, "consumer": .8}, ["US consumer", "Cloud (AWS) demand"])
_p("TSLA", "Consumer Discretionary", {"rates": -.8, "china": -.4, "risk": 1.0}, ["Auto credit", "China market"])
_p("NFLX DIS SPOT", "Communication", {"consumer": .7}, ["Consumer subscriptions"])
_p("CRM ADBE NOW ORCL SNOW PLTR DDOG CRWD", "Software", {}, ["Enterprise IT budgets"])
_p("SHOP", "Software", {"consumer": .7, "risk": 1.0}, ["Merchant sales volume", "US consumer"], "CA")
_p("V MA PYPL AXP", "Payments", {}, ["Consumer spending volume"])
_p("JPM BAC WFC C GS MS", "Banks", {}, ["US credit cycle"])
_p("RY TD BNS BMO CM NA", "Banks", {"housing": .7}, ["Canadian housing & mortgages", "Canadian credit cycle"], "CA")
_p("MFC SLF GWO IFC", "Insurance", {}, [], "CA")
_p("BRK-B BRK-A", "Insurance", {"growth": .5, "risk": .4}, ["US economy (diversified)"])
_p("BN BAM", "Asset Managers", {"rates": -.6}, ["Private-market fundraising", "Real assets"], "CA")
_p("BX KKR APO", "Asset Managers", {}, ["Private-market fundraising"])
_p("XOM CVX COP OXY", "Energy", {}, ["Crude oil price"])
_p("CNQ SU CVE IMO TOU", "Energy", {}, ["Crude oil price", "WCS differential"], "CA")
_p("ENB TRP PPL", "Pipelines", {}, ["Throughput contracts", "Interest rates"], "CA")
_p("CNR CP", "Transportation", {}, ["North American trade volumes", "Commodity shipments"], "CA")
_p("UNP CSX", "Transportation", {}, ["US freight volumes"])
_p("WCN", "Industrials", {"growth": .3}, ["Municipal waste contracts"], "CA")
_p("CAT DE GE HON", "Industrials", {}, ["Global capex cycle"])
_p("LMT RTX NOC GD", "Defense", {}, ["US defence budget"])
_p("CSU", "Software", {"rates": -.4}, ["Acquisition pipeline"], "CA")
_p("ATD", "Consumer Staples", {"oil": .2}, ["Fuel margins", "Convenience traffic"], "CA")
_p("DOL L MRU", "Consumer Staples", {}, ["Canadian consumer"], "CA")
_p("COST WMT PG KO PEP", "Consumer Staples", {}, ["US consumer"])
_p("HD LOW", "Consumer Discretionary", {"housing": .8}, ["Housing turnover"])
_p("NKE SBUX MCD", "Consumer Discretionary", {"china": -.3}, ["Consumer spending"])
_p("BCE T RCI-B TU VZ", "Telecom", {}, ["Subscriber pricing"])
_p("FTS EMA H", "Utilities", {}, ["Rate-base growth"], "CA")
_p("NEE DUK SO", "Utilities", {}, ["Rate-base growth", "Power demand"])
_p("LLY NVO UNH JNJ PFE MRK ABBV", "Health Care", {}, ["Drug pricing policy"])
_p("NTR", "Materials", {}, ["Crop prices"], "CA")
_p("TECK FCX", "Materials", {"china": -.5}, ["Copper price", "China demand"])
_p("ABX AEM WPM FNV GOLD NEM", "Gold", {}, ["Gold price"])
_p("SPY VOO IVV VTI QQQ XUS VFV ZSP XSP", "US Equity (broad)", {}, ["US large caps"])
_p("QQQ", "US Equity (broad)", {"rates": -.6, "ai_capex": .6, "risk": 1.1}, ["Mega-cap tech"])
_p("XIU XIC ZCN VCN HXT", "Canada Equity (broad)", {}, ["Canadian banks & energy"], "CA")
_p("XEQT VEQT VT ACWI XAW VXC", "Global Equity (broad)", {}, ["Global equities"], "GLOBAL")
_p("XBB ZAG VAB AGG BND TLT IEF", "Bonds", {}, ["Interest rates"])
_p("GLD IAU CGL", "Gold", {"metals": .3}, ["Gold price"])
_p("BTC-USD ETH-USD IBIT FBTC", "Crypto", {}, ["Crypto risk appetite"])
_p("CASH PSA CSAV", "Cash", {}, ["Short-term rates"], "CA")

EXCHANGE_COUNTRY = {"TOR": "CA", "Toronto": "CA", "TSX": "CA", "NEO": "CA", "VAN": "CA", "CNQ": "CA",
                    "LSE": "GB", "London": "GB", "Paris": "FR", "XETRA": "DE", "Frankfurt": "DE",
                    "Tokyo": "JP", "Hong Kong": "HK", "Amsterdam": "NL"}

# ---------------------------------------------------------------------------
# Transmission channels between drivers (first-order economic mechanisms).
# (from, to, sign, strength 0-1, horizon, logic, evidence, uncertainty, offsets, threshold)
# ---------------------------------------------------------------------------
EDGES = [
    ("oil", "inflation", 1, .55, "1-6 months",
     "Fuel is a direct CPI component and an input to freight, airfares and food distribution.",
     "Energy is roughly 7-8% of the Canadian and US CPI baskets; gasoline moves show up in the next monthly CPI print.",
     "medium", "Demand destruction and a strong currency can blunt pass-through.",
     "Prices would need to stay elevated for months, not days, and reach pump prices."),
    ("oil", "consumer", -1, .35, "1-6 months",
     "Higher fuel bills act like a tax on households, leaving less for discretionary spending.",
     "Textbook income effect; strongest for lower-income and car-dependent households.",
     "medium", "Energy-sector employment and royalties offset part of this in producer regions like Alberta.",
     "A sustained move in gasoline prices large enough to show up in retail sales data."),
    ("oil", "cad", 1, .4, "weeks",
     "Canada is a large net energy exporter, so higher oil tends to support the loonie.",
     "A long-run positive correlation between crude and CAD, weaker since 2015 as rate differentials gained importance.",
     "high", "Interest-rate differentials versus the US often dominate the oil link.",
     "Oil moves large enough to change Canada's terms of trade, without an offsetting rate-differential move."),
    ("oil", "growth", -1, .25, "3-12 months",
     "For energy importers, higher oil transfers income abroad and weighs on growth.",
     "Several US recessions were preceded by oil spikes (1973, 1979, 1990, 2008).",
     "high", "Net exporters (Canada, US shale) partly benefit.",
     "A spike that persists more than a quarter and coincides with other headwinds."),
    ("inflation", "rates", 1, .6, "3-12 months",
     "Central banks lift or hold policy rates when inflation runs above their 2% targets.",
     "The Fed and Bank of Canada both target 2% inflation; 2022-23 hikes followed the inflation surge.",
     "low", "Central banks look through one-off supply shocks if expectations stay anchored.",
     "Core (not only headline) inflation would need to stay above target for several months."),
    ("tariffs", "inflation", 1, .4, "3-12 months",
     "Import taxes raise the cost of goods, and part of that is passed on to consumers.",
     "Studies of the 2018-19 US tariffs found near-complete pass-through to import prices.",
     "medium", "Currency moves and supplier price cuts absorb part of the cost.",
     "Tariffs that are implemented (not only threatened) and broad enough to reach consumer goods."),
    ("tariffs", "growth", -1, .4, "6-18 months",
     "Trade barriers disrupt supply chains, delay investment and reduce export demand.",
     "Business-investment surveys weaken during trade-policy uncertainty.",
     "medium", "Reshoring investment and trade diversion can partly offset.",
     "Barriers that persist long enough to change sourcing and hiring decisions."),
    ("rates", "housing", -1, .7, "3-12 months",
     "Higher mortgage rates reduce affordability, home sales and eventually prices.",
     "Canadian and US home sales fell sharply during the 2022-23 tightening cycle.",
     "low", "Supply shortages and immigration can support prices despite higher rates.",
     "Five-year fixed or variable mortgage rates rising enough to change qualification (stress-test) outcomes."),
    ("rates", "risk", -1, .6, "immediate-6 months",
     "Higher discount rates reduce the present value of distant profits, compressing valuation multiples.",
     "Long-duration growth stocks fell hardest in 2022 as yields rose.",
     "medium", "Strong earnings growth can outrun multiple compression.",
     "Real (inflation-adjusted) yields rising, not only nominal yields."),
    ("rates", "credit", 1, .45, "6-18 months",
     "Refinancing at higher rates strains weaker borrowers and raises default rates.",
     "Default cycles typically lag tightening cycles by one to two years.",
     "medium", "Long-dated fixed-rate debt delays the impact.",
     "Rates staying high through a refinancing wall of maturing debt."),
    ("rates", "consumer", -1, .4, "6-18 months",
     "Higher borrowing costs raise debt payments and encourage saving over spending.",
     "Canada is especially sensitive given high household debt and 5-year mortgage renewals.",
     "medium", "Savers earn more interest income, partly offsetting.",
     "Mortgage renewals at materially higher rates across a large share of households."),
    ("rates", "usd", 1, .4, "weeks-months",
     "Higher US yields relative to other countries attract capital into US dollars.",
     "Rate differentials are one of the most reliable short-term currency drivers.",
     "medium", "Risk-off episodes can move the dollar independently.",
     "US yields rising relative to Canadian and other yields, not all rates together."),
    ("usd", "cad", -1, .5, "immediate",
     "A broadly stronger US dollar usually means a weaker Canadian dollar against it.",
     "USD/CAD is quoted directly against the dollar, so broad USD moves transmit mechanically.",
     "low", "Oil strength can offset.", "A broad dollar move, not a USD/CAD-specific one."),
    ("china", "chips", 1, .7, "immediate-years",
     "Advanced chips are concentrated in Taiwan; tension raises the perceived risk to that supply.",
     "TSMC manufactures the large majority of the world's most advanced logic chips.",
     "high", "New fabs in the US, Japan and Europe slowly diversify supply.",
     "Actual disruption (blockade, sanctions, export bans), not rhetoric alone."),
    ("china", "tariffs", 1, .5, "weeks-months",
     "Geopolitical friction tends to show up as tariffs, export controls and sanctions.",
     "US-China trade actions since 2018 have followed diplomatic escalations.",
     "medium", "Negotiated truces can reverse quickly.", "Formal policy action, not only statements."),
    ("chips", "ai_capex", -1, .4, "months",
     "Supply shortages cap how much AI infrastructure can be built, even if demand stays strong.",
     "GPU supply constraints limited deployments in 2023-24.",
     "high", "Shortages raise pricing power for chip designers that do get supply.",
     "A supply shock at leading-edge foundries or packaging capacity."),
    ("growth", "oil", 1, .45, "months", "Stronger activity raises energy demand.",
     "Oil demand tracks global industrial production.", "medium", "OPEC+ supply decisions dominate at times.",
     "A growth change broad enough to move global demand forecasts."),
    ("growth", "metals", 1, .6, "months", "Industrial metals are used in construction and manufacturing.",
     "Copper is often called a barometer of global growth.", "medium", "China-specific stimulus can dominate.",
     "Growth changes concentrated in China or in construction/manufacturing."),
    ("growth", "consumer", 1, .6, "months", "Jobs and incomes drive household spending.",
     "Consumption is roughly 55-70% of GDP in Canada and the US.", "low", "Excess savings can smooth spending.",
     "Employment changing, not only sentiment."),
    ("growth", "credit", -1, .5, "6-12 months", "Slower growth weakens cash flows and raises defaults.",
     "Credit spreads widen in recessions.", "low", "Central-bank easing can cushion.",
     "A slowdown deep enough to lift unemployment."),
    ("growth", "rates", 1, .35, "3-12 months", "Weaker growth usually leads central banks to cut.",
     "Policy rates were cut in every modern recession.", "medium", "Sticky inflation can prevent cuts.",
     "Growth weakening while inflation is near target."),
    ("wages", "inflation", 1, .4, "6-18 months", "Rising labour costs feed into service prices.",
     "Services inflation correlates with wage growth.", "medium", "Productivity gains offset.",
     "Wage growth sustained above productivity plus 2%."),
    ("wages", "consumer", 1, .4, "months", "Higher pay supports spending.", "Income effect.", "low",
     "Offset if inflation outpaces wages.", "Real (inflation-adjusted) wage gains."),
    ("credit", "growth", -1, .5, "6-18 months", "Tighter lending restricts investment and hiring.",
     "Senior loan officer surveys lead activity.", "medium", "Fiscal support can offset.",
     "Lending standards tightening broadly across banks."),
    ("credit", "risk", -1, .6, "immediate", "Credit stress makes investors demand more compensation for risk.",
     "Equity drawdowns coincide with spread widening.", "low", "Policy backstops (2020) can reverse quickly.",
     "Spreads widening outside a single sector."),
    ("defense", "growth", 1, .1, "years", "Higher military budgets add to industrial demand.",
     "Fiscal multiplier effects.", "high", "Crowding out other spending.", "Budget appropriations actually passed."),
    ("housing", "consumer", 1, .3, "months", "Home equity and turnover drive furniture, renovation and durable spending.",
     "Wealth effect and housing-linked purchases.", "medium", "Rent relief for non-owners.",
     "Sustained price or volume changes."),
    ("regulation", "risk", -1, .15, "months", "Regulatory uncertainty lowers multiples for the affected companies.",
     "Antitrust cases have created multi-year overhangs.", "high", "Rulings often take years.",
     "Remedies that change business models (divestitures, default-placement bans)."),
    ("ai_capex", "growth", 1, .2, "quarters", "Data-centre construction and equipment orders add to investment.",
     "AI infrastructure spending has been a notable share of recent US business investment growth.",
     "medium", "Could reverse sharply if returns disappoint.", "Capex guidance from the largest cloud providers."),
]

# ---------------------------------------------------------------------------
# Event patterns: map news language onto driver impulses.
# direction: +1 means the headline implies the driver rises. `neg` regex flips it.
# ---------------------------------------------------------------------------
SHOCKS = [
    {"id": "energy", "label": "Energy supply / oil price move",
     "rx": r"\b(oil|crude|opec\+?|brent|wti|refiner(y|ies)|pipeline|natural gas|lng|gasoline|fuel prices?|strait of hormuz|red sea|energy supply)\b",
     "impulse": {"oil": 1}, "neg": r"\b(oil|crude|gas|fuel)\b.{0,40}\b(fall|falls|fell|drop|drops|slump|plunge|tumble|lower|cheaper|glut|slide)",
     "people": "Fuel, heating and travel costs move first; food and delivery prices follow with a lag.",
     "business": "Transport-heavy businesses (airlines, logistics, retailers) see margin pressure; producers see windfalls.",
     "markets": "Energy equities and the Canadian dollar tend to rise with oil; airlines and consumer names tend to lag.",
     "watch": ["WTI and Brent over the next two weeks", "OPEC+ statements", "Next CPI energy component", "Gasoline prices"],
     "counter": "Short-lived supply scares often reverse within weeks; demand weakness can dominate supply risk."},
    {"id": "hawkish", "label": "Higher-for-longer interest rates",
     "rx": r"\b(rate hikes?|raises? (interest )?rates?|hawkish|higher for longer|tighten(ing)?|yields? (jump|surge|climb|rise|soar)|holds? rates?|keeps? rates? (unchanged|steady))\b",
     "impulse": {"rates": 1},
     "people": "Variable-rate mortgages, lines of credit and car loans stay expensive; savings accounts pay more.",
     "business": "Borrowing costs weigh on expansion plans; leveraged companies feel it at refinancing.",
     "markets": "Long-duration growth stocks, REITs and utilities are most sensitive; banks' margins can benefit.",
     "watch": ["Next central-bank decision", "2-year and 10-year yields", "Core inflation prints", "Mortgage rate sheets"],
     "counter": "Markets may already price the path; a 'hold' can be dovish relative to expectations."},
    {"id": "dovish", "label": "Rate cuts / easing",
     "rx": r"\b(rate cuts?|cuts? (interest )?rates?|dovish|eas(e|es|ing) (policy|rates)|lower(s|ed)? rates?|yields? (fall|drop|slide|tumble))\b",
     "impulse": {"rates": -1},
     "people": "Variable-rate borrowers get relief; savings yields fall.",
     "business": "Cheaper financing supports investment and refinancing.",
     "markets": "Growth stocks, real estate and small caps usually benefit; bank margins can compress.",
     "watch": ["Forward guidance language", "Bond yields", "Housing activity", "Currency reaction"],
     "counter": "Cuts driven by a weakening economy can coincide with falling earnings, hurting stocks anyway."},
    {"id": "inflation", "label": "Inflation surprise",
     "rx": r"\b(inflation|cpi|consumer prices?|price pressures?|pce)\b",
     "impulse": {"inflation": 1}, "neg": r"\b(inflation|cpi|prices?)\b.{0,40}\b(cool|cools|cooled|ease|eases|eased|slow|slows|slowed|fall|falls|fell|lower|below)",
     "people": "Purchasing power erodes when prices outpace pay; fixed-income savers lose real value.",
     "business": "Companies with pricing power protect margins; others get squeezed between costs and customers.",
     "markets": "Hot prints push yields up and pressure valuations; cool prints do the opposite.",
     "watch": ["Core and trimmed-mean measures", "Services inflation", "Wage growth", "Central-bank reaction"],
     "counter": "One month is noise; the trend across three to six months matters more."},
    {"id": "jobs", "label": "Labour market signal",
     "rx": r"\b(jobs report|payrolls|unemployment|jobless|hiring|layoffs?|labou?r market|employment)\b",
     "impulse": {"growth": 1, "wages": .6}, "neg": r"\b(layoffs?|job cuts|unemployment (rises|rose|jumps|climbs)|jobless claims (rise|jump)|weak hiring|slump)",
     "people": "Job security and bargaining power for raises shift with the labour market.",
     "business": "Tight markets raise wage costs; slack markets ease them but signal weaker demand.",
     "markets": "Strong jobs can be 'bad news' if it delays rate cuts.",
     "watch": ["Unemployment rate trend", "Wage growth", "Job openings", "Next central-bank meeting"],
     "counter": "Headline job numbers are revised substantially; look at three-month averages."},
    {"id": "tariffs", "label": "Trade barriers / tariffs",
     "rx": r"\b(tariffs?|trade war|export controls?|import (tax|duties)|duties|trade deal|sanctions?|usmca|cusma)\b",
     "impulse": {"tariffs": 1}, "neg": r"\b(lift(s|ed)?|remov(e|es|ed)|pause[sd]?|exempt(ion|s)?|trade deal|truce|roll(s|ed)? back)\b",
     "people": "Imported goods, cars and electronics can get more expensive; export-sector jobs are exposed.",
     "business": "Importers face cost pressure; exporters face retaliation; supply chains reroute.",
     "markets": "Cross-border manufacturers, autos, railroads and the Canadian dollar are sensitive.",
     "watch": ["Implementation dates", "Retaliation announcements", "Exemptions", "Import price indices"],
     "counter": "Threatened tariffs are often negotiated down before taking effect."},
    {"id": "taiwan", "label": "China / Taiwan tension",
     "rx": r"\b(taiwan|south china sea|beijing|xi jinping|chinese military|pla\b|us-china|china.{0,20}(tension|drills|warn))\b",
     "impulse": {"china": 1},
     "people": "Electronics availability and prices could be affected if supply chains are disrupted.",
     "business": "Companies relying on Taiwanese chips or Chinese assembly face supply risk.",
     "markets": "Semiconductors, Apple-style hardware supply chains and Asian equities are most exposed.",
     "watch": ["Military exercises", "Export-control announcements", "TSMC commentary", "Shipping insurance rates"],
     "counter": "Rhetoric has escalated many times without disruption; markets often fade these scares."},
    {"id": "ai", "label": "AI investment cycle",
     "rx": r"\b(ai\b|artificial intelligence|data cent(er|re)s?|gpus?|nvidia|openai|anthropic|hyperscalers?|capex|large language models?|compute)\b",
     "impulse": {"ai_capex": 1}, "neg": r"\b(ai bubble|cut(s|ting)? (ai )?spending|capex cuts?|slow(s|ing)? (ai )?spending|pullback|overbuil)",
     "people": "AI tools change job tasks; electricity demand from data centres can affect power prices.",
     "business": "Chip makers, cloud providers, utilities and data-centre landlords see demand; others see cost and disruption.",
     "markets": "Semiconductors and mega-cap tech drive index returns, increasing concentration risk.",
     "watch": ["Hyperscaler capex guidance", "GPU lead times", "AI revenue disclosures", "Power-grid constraints"],
     "counter": "Capex booms can overshoot; returns on AI spending are still being established."},
    {"id": "conflict", "label": "Armed conflict / security shock",
     "rx": r"\b(war|missiles?|airstrikes?|invasion|troops|military (strike|operation)|attack(s|ed)?|drone strikes?|escalat(e|ion)|shelling)\b",
     "impulse": {"risk": -1, "defense": .7}, "neg": r"\b(ceasefire|peace (deal|talks|agreement)|truce|de-escalat)",
     "people": "Humanitarian costs come first; for everyone else, energy, food and travel can be disrupted.",
     "business": "Defence contractors see demand; companies with regional exposure face disruption.",
     "markets": "Safe havens (US dollar, gold, Treasuries) typically rise; risk assets dip, often briefly.",
     "watch": ["Energy and shipping routes", "Sanctions", "Defence budgets", "Refugee and supply-chain effects"],
     "counter": "Historically, market impact from conflicts has often faded within weeks unless energy supply is hit."},
    {"id": "middle_east", "label": "Middle East energy-route risk",
     "rx": r"\b(iran|israel|gaza|hezbollah|houthis?|saudi|persian gulf|strait of hormuz|red sea|yemen|lebanon)\b",
     "impulse": {"oil": .7, "risk": -.5},
     "people": "Energy and shipping-cost risk.", "business": "Shipping reroutes lengthen supply chains.",
     "markets": "Oil risk premium; defence and energy up, airlines down.",
     "watch": ["Brent risk premium", "Tanker rates", "Shipping through key straits"],
     "counter": "Oil markets often price a premium that fades without actual supply loss."},
    {"id": "banking", "label": "Credit / banking stress",
     "rx": r"\b(bank (failure|run|collapse)|credit (crunch|stress|spreads?)|defaults?|bankrupt(cy)?|private credit|downgrade[sd]?|liquidity crisis|delinquenc(y|ies))\b",
     "impulse": {"credit": 1},
     "people": "Loans get harder to obtain; deposits above insurance limits carry risk.",
     "business": "Refinancing gets harder, especially for smaller or leveraged firms.",
     "markets": "Banks, private-credit managers and high-yield bonds are most sensitive.",
     "watch": ["Credit spreads", "Bank deposit flows", "Central-bank liquidity facilities"],
     "counter": "Isolated failures are not systemic; watch whether stress spreads across institutions."},
    {"id": "housing", "label": "Housing market signal",
     "rx": r"\b(housing|home (sales|prices)|mortgages?|real estate|rents?|home ?builders?|condo)\b",
     "impulse": {"housing": 1}, "neg": r"\b(fall|falls|fell|drop|drops|slump|decline|cool|cools|slow|slows|weak)",
     "people": "Affordability for buyers and renewal costs for owners.",
     "business": "Banks, builders, home-improvement retailers and furniture makers are exposed.",
     "markets": "Canadian banks and REITs, US home builders.",
     "watch": ["Mortgage rates", "Home sales and listings", "Mortgage delinquencies"],
     "counter": "Regional divergence is large; national averages hide local conditions."},
    {"id": "regulation", "label": "Tech regulation / antitrust",
     "rx": r"\b(antitrust|monopoly|doj|ftc|competition bureau|european commission|digital markets act|dma|fined?|lawsuit|regulators?)\b",
     "impulse": {"regulation": 1},
     "people": "Can change default apps, pricing and privacy protections.",
     "business": "Platforms may lose bundling or default placement advantages.",
     "markets": "Mega-cap platforms face multi-year overhangs; smaller rivals may benefit.",
     "watch": ["Court rulings", "Remedy proposals", "Appeals timelines"],
     "counter": "Remedies are usually narrower than headlines suggest and take years."},
    {"id": "slowdown", "label": "Growth slowdown / recession risk",
     "rx": r"\b(recession|slowdown|contraction|gdp (shrinks|contracts|falls|slows)|economy (shrinks|slows|contracts)|stagflation|downturn)\b",
     "impulse": {"growth": -1},
     "people": "Job security weakens and hiring slows; rate relief may follow.",
     "business": "Revenue growth slows, especially for cyclical and discretionary companies.",
     "markets": "Defensives, bonds and quality outperform; cyclicals and small caps lag.",
     "watch": ["Unemployment claims", "Earnings revisions", "Yield curve", "Central-bank tone"],
     "counter": "Recession calls are frequently wrong; soft landings have happened (1995, 2023)."},
    {"id": "china_demand", "label": "China economy / stimulus",
     "rx": r"\b(china('s)? (economy|stimulus|growth|exports|property)|pboc|yuan|evergrande|chinese (consumers|demand))\b",
     "impulse": {"metals": .8, "growth": .4}, "neg": r"\b(slow|slows|slump|weak|deflation|contract|falls?)",
     "people": "Affects prices of manufactured goods and commodity-linked jobs.",
     "business": "Miners, luxury brands and industrial exporters depend on Chinese demand.",
     "markets": "Copper, iron ore, Canadian and Australian materials stocks.",
     "watch": ["Credit growth", "Property sales", "Commodity imports"],
     "counter": "Stimulus announcements have often disappointed in execution."},
    {"id": "fx_cad", "label": "Canadian dollar move",
     "rx": r"\b(loonie|canadian dollar|usd/cad|cad\b)",
     "impulse": {"cad": 1}, "neg": r"\b(weak|weaker|weakens|falls?|fell|slides?|drops?|lower|slump)",
     "people": "A weaker loonie makes US travel and imported goods pricier; a stronger one does the opposite.",
     "business": "Exporters benefit from a weaker CAD; importers are squeezed.",
     "markets": "Changes the CAD value of every US-dollar holding, before any change in the stock itself.",
     "watch": ["Oil", "BoC-Fed rate gap", "Trade policy"], "counter": "Currency moves often mean-revert."},
    {"id": "defense", "label": "Defence spending",
     "rx": r"\b(defen[cs]e (budget|spending)|nato (target|spending)|military spending|arms (deal|sales))\b",
     "impulse": {"defense": 1}, "people": "Public budgets shift toward defence.",
     "business": "Aerospace and defence contractors gain order visibility.", "markets": "Defence stocks.",
     "watch": ["Budget appropriations", "Contract awards"], "counter": "Pledges often exceed actual appropriations."},
    {"id": "crypto", "label": "Crypto market move",
     "rx": r"\b(bitcoin|crypto(currency)?|ethereum|stablecoins?|btc)\b",
     "impulse": {"risk": .4}, "neg": r"\b(crash|plunge|falls?|slump|hack|collapse)",
     "people": "Direct wealth effect for holders.", "business": "Crypto-linked businesses.",
     "markets": "A barometer of speculative appetite.", "watch": ["ETF flows", "Regulatory actions"],
     "counter": "Crypto moves are often idiosyncratic."},
]

# Plans: personal goals mapped to drivers (sign = how the plan fares when the driver rises).
PLAN_TEMPLATES = {
    "Buy a home": {"rates": -1, "housing": -.5},
    "Renew or hold a variable-rate mortgage": {"rates": -1},
    "Job search in venture, tech or finance": {"risk": .9, "ai_capex": .5, "rates": -.5, "growth": .5},
    "Raise capital / start a company": {"risk": 1, "rates": -.7, "credit": -.4},
    "Travel to the US or abroad (spending in foreign currency)": {"cad": 1},
    "Grow long-term retirement savings": {"risk": .7, "growth": .5},
    "Keep an emergency fund in cash": {"rates": .5, "inflation": -.5},
    "Buy a car": {"rates": -.6, "tariffs": -.5},
}

# Historical reference episodes (approximate, widely reported figures; verify before relying on them).
EPISODES = [
    {"id": "2022", "title": "2022 inflation and rate shock",
     "applies": ["rates", "inflation"], "text": "US CPI peaked near 9% and the Fed raised rates from ~0% to over 4% within the year. "
     "S&P 500 fell about 19% and the Nasdaq about 33% for the calendar year; aggregate bonds lost roughly 13%. "
     "Energy was the best-performing sector (up roughly 60%). USD/CAD rose from about 1.26 to 1.35."},
    {"id": "2020", "title": "2020 pandemic crash",
     "applies": ["growth", "risk", "oil"], "text": "The S&P 500 fell about 34% between 19 Feb and 23 Mar 2020, then regained its high by August "
     "as central banks cut to zero and governments spent heavily. WTI futures briefly traded below zero in April."},
    {"id": "2008", "title": "2008 global financial crisis",
     "applies": ["credit", "growth", "risk", "housing"], "text": "The S&P 500 fell about 57% peak-to-trough (Oct 2007 to Mar 2009). "
     "The TSX fell about 35% in 2008. USD/CAD went from roughly parity to about 1.30. Canadian banks cut no dividends; many US banks needed support."},
    {"id": "2014", "title": "2014-16 oil collapse",
     "applies": ["oil", "cad"], "text": "WTI fell from about US$107 (June 2014) to about US$26 (Feb 2016). The Canadian dollar fell from about "
     "94 to under 70 US cents. Canadian energy equities fell sharply while US consumers benefited from cheaper fuel."},
    {"id": "2000", "title": "2000-02 dot-com unwind",
     "applies": ["risk", "ai_capex"], "text": "The Nasdaq fell about 78% from its March 2000 peak to October 2002 as tech capex and valuations reset. "
     "Profitable companies recovered; many unprofitable ones did not survive."},
    {"id": "2013", "title": "2013 taper tantrum",
     "applies": ["rates"], "text": "The US 10-year yield rose from about 1.6% in May to about 3.0% by September 2013 after the Fed signalled "
     "slower bond purchases. Rate-sensitive sectors and emerging markets sold off."},
]

# Scheduled central-bank decision dates (announcement day). Published schedules;
# confirm at the official source links before acting.
CENTRAL_BANK_2026 = {
    "Federal Reserve (FOMC)": ("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
                               ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16",
                                "2026-10-28", "2026-12-09"]),
    "Bank of Canada": ("https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/",
                       ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-10", "2026-07-15", "2026-09-02",
                        "2026-10-28", "2026-12-09"]),
}


def computed_market_events(start, end):
    """Deterministic calendar events: 13F deadlines, options expirations, RRSP deadline, TFSA room."""
    out = []
    d = start
    while d <= end:
        # third Friday = monthly options expiry; quarterly months get "quarterly expiration"
        if d.weekday() == 4 and 15 <= d.day <= 21:
            q = d.month in (3, 6, 9, 12)
            out.append({"date": d.isoformat(), "title": ("Quarterly" if q else "Monthly") + " options expiration",
                        "category": "market", "importance": 2 if q else 1,
                        "note": "Computed: third Friday of the month. Can add intraday volatility."})
        d += dt.timedelta(days=1)
    for y in (start.year, start.year + 1):
        for qe in (dt.date(y, 3, 31), dt.date(y, 6, 30), dt.date(y, 9, 30), dt.date(y, 12, 31)):
            due = qe + dt.timedelta(days=45)
            while due.weekday() >= 5:
                due += dt.timedelta(days=1)
            if start <= due <= end:
                out.append({"date": due.isoformat(), "title": "13F filing deadline (Q%d %d holdings)" % ((qe.month // 3), y),
                            "category": "filing", "importance": 2,
                            "note": "Computed: 45 days after quarter end (next business day). Institutional holdings as of %s become public around now." % qe.isoformat()})
        rrsp = dt.date(y, 3, 1)
        if dt.date(y, 2, 29 if y % 4 == 0 else 28) and start <= rrsp <= end:
            out.append({"date": rrsp.isoformat(), "title": "RRSP contribution deadline (approx.)", "category": "financial",
                        "importance": 2, "note": "Normally 60 days after year end; confirm the exact date with CRA."})
        jan1 = dt.date(y, 1, 1)
        if start <= jan1 <= end:
            out.append({"date": jan1.isoformat(), "title": "New TFSA contribution room", "category": "financial",
                        "importance": 1, "note": "Annual TFSA room is added on 1 January."})
    for bank, (url, dates) in CENTRAL_BANK_2026.items():
        for ds in dates:
            dd = dt.date.fromisoformat(ds)
            if start <= dd <= end:
                out.append({"date": ds, "title": "%s rate decision" % bank, "category": "market", "importance": 3,
                            "note": "Published schedule (built in). Confirm: %s" % url, "url": url})
    return out
