/* Knowledge base: drivers, sector sensitivities, transmission channels, event patterns, indicator
   explanations ("so what?"), hotspots and scheduled events. All of it is labelled interpretation in the UI. */
"use strict";
(function () {
  const K = (V.kb = {});

  K.FACTORS = {
    rates: ["Interest rates", "Policy rates and long-term bond yields"], inflation: ["Inflation", "Consumer price growth"],
    oil: ["Energy prices", "Crude oil, natural gas and fuel"], usd: ["US dollar", "Broad strength of the US dollar"],
    cad: ["Canadian dollar", "CAD versus USD (up = stronger loonie)"], consumer: ["Consumer spending", "Household demand"],
    ai_capex: ["AI & data-centre spend", "Hyperscaler and enterprise AI infrastructure investment"],
    chips: ["Chip supply disruption", "Risk to advanced semiconductor supply (Taiwan, export controls)"],
    china: ["China / Taiwan tension", "US-China geopolitical and trade friction"], credit: ["Credit stress", "Wider spreads, defaults, tighter lending"],
    housing: ["Housing activity", "Home sales, prices and mortgage origination"], tariffs: ["Tariffs & trade barriers", "Trade-policy friction and shipping costs"],
    regulation: ["Big-tech regulation", "Antitrust, platform and AI rules"], growth: ["Economic growth", "Real GDP and earnings momentum"],
    metals: ["Metals & materials", "Copper, iron ore, gold, lithium"], risk: ["Risk appetite", "Willingness to pay up for growth and risk"],
    defense: ["Defence spending", "Government military budgets"], wages: ["Wage growth", "Tight labour markets and pay growth"],
  };
  K.fl = (f) => K.FACTORS[f][0].toLowerCase().replace(/\b(ai|us)\b/g, (m) => m.toUpperCase());

  K.SECTORS = {
    "Semiconductors": [1.45, { ai_capex: .9, chips: -.7, china: -.6, rates: -.5, growth: .5, risk: .8, tariffs: -.4 }],
    "Software": [1.2, { rates: -.7, ai_capex: .4, risk: .8, regulation: -.3, growth: .3 }],
    "Technology": [1.15, { rates: -.5, ai_capex: .5, consumer: .4, china: -.4, regulation: -.4, risk: .7, tariffs: -.4 }],
    "Communication": [1.05, { consumer: .5, regulation: -.5, rates: -.4, risk: .6, growth: .4, ai_capex: .3 }],
    "Consumer Discretionary": [1.15, { consumer: .9, rates: -.5, oil: -.3, tariffs: -.5, growth: .6, risk: .5 }],
    "Consumer Staples": [.6, { inflation: -.2, consumer: .2, rates: -.3, risk: -.2, tariffs: -.2 }],
    "Energy": [1.0, { oil: 1.0, growth: .4, risk: .2, rates: .1 }], "Pipelines": [.7, { rates: -.5, oil: .3, growth: .2 }],
    "Banks": [1.0, { rates: .3, credit: -.8, housing: .5, growth: .6, risk: .4 }], "Insurance": [.8, { rates: .4, credit: -.3, growth: .2 }],
    "Asset Managers": [1.3, { risk: .8, rates: -.4, credit: -.5, growth: .4 }], "Payments": [1.0, { consumer: .8, growth: .5, regulation: -.3, risk: .5 }],
    "Industrials": [1.05, { growth: .8, tariffs: -.4, oil: -.2, defense: .3, rates: -.3, risk: .5 }], "Transportation": [1.0, { growth: .6, oil: -.4, tariffs: -.4, consumer: .3 }],
    "Airlines": [1.3, { oil: -.9, consumer: .6, growth: .5 }], "Materials": [1.1, { metals: 1.0, growth: .7, china: -.3, usd: -.4 }],
    "Gold": [.2, { usd: -.5, rates: -.4, risk: -.4, inflation: .4, metals: .6 }], "Utilities": [.5, { rates: -.8, inflation: -.2, risk: -.2, ai_capex: .2 }],
    "Real Estate": [.9, { rates: -.9, credit: -.5, housing: .4, growth: .3 }], "Telecom": [.5, { rates: -.6, risk: -.1, regulation: -.2 }],
    "Health Care": [.75, { rates: -.2, regulation: -.3, risk: .1 }], "Defense": [.8, { defense: 1.0, risk: -.1 }],
    "US Equity (broad)": [1.0, { risk: 1.0, growth: .6, rates: -.4, ai_capex: .3 }], "Canada Equity (broad)": [.9, { risk: .8, oil: .4, housing: .3, metals: .3, credit: -.3, growth: .5 }],
    "Global Equity (broad)": [.95, { risk: .9, growth: .6, usd: -.2 }], "Bonds": [0, { rates: -1.0, inflation: -.5, credit: -.3, risk: -.3 }],
    "Cash": [0, { rates: .1 }], "Crypto": [2.0, { risk: 1.0, rates: -.6, usd: -.3 }], "Unclassified": [1.0, {}],
  };

  const T = (K.PRESETS = {});
  const p = (tickers, sector, tweaks = {}, deps = [], country = "US") => tickers.split(" ").forEach((t) => (T[t] = { sector, tweaks, deps, country }));
  p("NVDA", "Semiconductors", { ai_capex: 1.0 }, ["TSMC manufacturing", "Hyperscaler capex", "China export rules"]);
  p("AMD AVGO QCOM MU INTC", "Semiconductors", { ai_capex: .8 }, ["TSMC manufacturing", "Hyperscaler capex"]);
  p("TSM", "Semiconductors", { chips: -1.0, china: -.9, ai_capex: .8 }, ["Taiwan", "Apple & Nvidia as customers"], "TW");
  p("ASML", "Semiconductors", { china: -.7 }, ["Chip-fab capex", "Export controls"], "NL");
  p("AAPL", "Technology", { china: -.6, consumer: .6, tariffs: -.6 }, ["China/India assembly", "TSMC manufacturing", "US consumer"]);
  p("MSFT", "Software", { ai_capex: .6, regulation: -.3 }, ["Enterprise IT budgets", "AI infrastructure"]);
  p("GOOGL GOOG", "Communication", { regulation: -.7, ai_capex: .5 }, ["Digital advertising", "Antitrust outcomes", "AI infrastructure"]);
  p("META", "Communication", { regulation: -.6, ai_capex: .5, consumer: .5 }, ["Digital advertising", "AI infrastructure"]);
  p("AMZN", "Consumer Discretionary", { ai_capex: .5, consumer: .8 }, ["US consumer", "Cloud (AWS) demand", "AI infrastructure"]);
  p("TSLA", "Consumer Discretionary", { rates: -.8, china: -.4, risk: 1.0 }, ["Auto credit", "China market"]);
  p("NFLX DIS SPOT", "Communication", { consumer: .7 }, ["Consumer subscriptions"]);
  p("TTWO EA", "Communication", { consumer: .7, risk: .6 }, ["Consumer entertainment spending"]);
  p("CRM ADBE NOW ORCL DDOG CRWD", "Software", {}, ["Enterprise IT budgets"]);
  p("SNOW", "Software", { ai_capex: .5, risk: 1.0 }, ["Enterprise data budgets", "AI infrastructure"]);
  p("PLTR", "Software", { ai_capex: .6, defense: .5, risk: 1.2 }, ["US government contracts", "Enterprise AI adoption"]);
  p("SHOP", "Software", { consumer: .7, risk: 1.0 }, ["Merchant sales volume", "US consumer"], "CA");
  p("LMN CSU TOI", "Software", { rates: -.4 }, ["Acquisition pipeline"], "CA");
  p("V MA PYPL AXP", "Payments", {}, ["Consumer spending volume"]);
  p("JPM BAC WFC C GS MS", "Banks", {}, ["US credit cycle"]);
  p("RY TD BNS BMO CM NA", "Banks", { housing: .7 }, ["Canadian housing & mortgages"], "CA");
  p("BRK-B BRK-A", "Insurance", { growth: .5, risk: .4 }, ["US economy (diversified)"]);
  p("BN BAM", "Asset Managers", { rates: -.6 }, ["Private-market fundraising"], "CA");
  p("XOM CVX COP OXY", "Energy", {}, ["Crude oil price"]);
  p("SLB HAL BKR", "Energy", { oil: .8, growth: .3 }, ["Oil & gas drilling budgets"]);
  p("CNQ SU CVE IMO TOU", "Energy", {}, ["Crude oil price", "WCS differential"], "CA");
  p("ENB TRP PPL", "Pipelines", {}, ["Throughput contracts", "Interest rates"], "CA");
  p("CNR CP", "Transportation", {}, ["North American trade volumes"], "CA");
  p("AC", "Airlines", {}, ["Jet fuel prices", "Consumer travel demand"], "CA");
  p("LVMH MC", "Consumer Discretionary", { china: -.5, consumer: .8, tariffs: -.4 }, ["Luxury consumer demand", "China demand"], "FR");
  p("PROSY PROSF PRX", "Communication", { china: -.7, regulation: -.4 }, ["Tencent stake", "China tech"], "NL");
  p("GSAT IRDM", "Telecom", { risk: .8 }, ["Satellite spectrum partnerships"]);
  p("NET-UN PLZ-UN", "Real Estate", {}, ["Canadian retail & net-lease tenants", "Interest rates"], "CA");
  p("VPHIF VPH", "Health Care", { risk: 1.2 }, [], "CA");
  p("LQAVF", "Software", { risk: 1.2 }, [], "CA");
  p("LMT RTX NOC GD", "Defense", {}, ["US defence budget"]);
  p("COST WMT PG KO PEP", "Consumer Staples", {}, ["US consumer"]);
  p("FTS EMA H", "Utilities", {}, ["Rate-base growth"], "CA");
  p("SPY VOO IVV VTI XUS VFV ZSP XSP", "US Equity (broad)", {}, ["US large caps"]);
  p("QQQ", "US Equity (broad)", { rates: -.6, ai_capex: .6, risk: 1.1 }, ["Mega-cap tech"]);
  p("XIU XIC ZCN VCN HXT", "Canada Equity (broad)", {}, ["Canadian banks & energy"], "CA");
  p("XEQT VEQT VT ACWI XAW VXC", "Global Equity (broad)", {}, ["Global equities"], "GLOBAL");
  p("XBB ZAG VAB AGG BND TLT IEF", "Bonds", {}, ["Interest rates"]);
  p("GLD IAU CGL", "Gold", { metals: .3 }, ["Gold price"]);
  p("BTC-USD ETH-USD IBIT FBTC", "Crypto", {}, ["Crypto risk appetite"]);

  K.preset = function (ticker) {
    const t = (ticker || "").toUpperCase();
    if (T[t]) return T[t];
    const root = t.replace(/\.(TO|V|NE|CN|U|AS|PA|L)$/, "").replace(/\.UN$/, "-UN").replace(/\./g, "-");
    return T[root] || null;
  };

  // Transmission channels (from, to, sign, strength, horizon, logic, evidence, uncertainty, offsets, threshold)
  K.EDGES = [
    ["oil", "inflation", 1, .55, "1-6 months", "Fuel is a direct CPI component and an input to freight, airfares and food distribution.", "Energy is roughly 7-8% of the Canadian and US CPI baskets; gasoline moves show up in the next CPI print.", "medium", "Demand destruction and a strong currency can blunt pass-through.", "Prices would need to stay elevated for months and reach pump prices."],
    ["oil", "consumer", -1, .35, "1-6 months", "Higher fuel bills act like a tax on households.", "Income effect; strongest for car-dependent households.", "medium", "Energy-sector jobs and royalties offset part of this in producer regions.", "A sustained move large enough to show in retail sales."],
    ["oil", "cad", 1, .4, "weeks", "Canada is a large net energy exporter, so higher oil tends to support the loonie.", "Long-run positive correlation, weaker since 2015 as rate differentials gained importance.", "high", "Rate differentials versus the US often dominate.", "An oil move large enough to change Canada's terms of trade."],
    ["oil", "growth", -1, .25, "3-12 months", "For energy importers, higher oil transfers income abroad and weighs on growth.", "Several recessions were preceded by oil spikes (1973, 1979, 1990, 2008).", "high", "Net exporters partly benefit.", "A spike that persists more than a quarter."],
    ["inflation", "rates", 1, .6, "3-12 months", "Central banks lift or hold rates when inflation runs above their 2% targets.", "Both the Fed and the Bank of Canada target 2% inflation.", "low", "They look through one-off supply shocks if expectations stay anchored.", "Core inflation staying above target for several months."],
    ["tariffs", "inflation", 1, .4, "3-12 months", "Import taxes and shipping detours raise the cost of goods.", "Studies of the 2018-19 US tariffs found near-complete pass-through to import prices.", "medium", "Currency moves and supplier margins absorb part.", "Barriers implemented, broad enough to reach consumer goods."],
    ["tariffs", "growth", -1, .4, "6-18 months", "Trade barriers disrupt supply chains, delay investment and reduce exports.", "Business investment weakens during trade-policy uncertainty.", "medium", "Reshoring investment partly offsets.", "Barriers persist long enough to change sourcing and hiring."],
    ["rates", "housing", -1, .7, "3-12 months", "Higher mortgage rates reduce affordability, sales and eventually prices.", "Canadian and US home sales fell sharply in the 2022-23 tightening.", "low", "Supply shortages can support prices.", "Mortgage rates rising enough to change stress-test outcomes."],
    ["rates", "risk", -1, .6, "immediate-6 months", "Higher discount rates reduce the present value of distant profits, compressing valuation multiples.", "Long-duration growth stocks fell hardest in 2022 as yields rose.", "medium", "Strong earnings growth can outrun multiple compression.", "Real (inflation-adjusted) yields rising, not only nominal."],
    ["rates", "credit", 1, .45, "6-18 months", "Refinancing at higher rates strains weaker borrowers.", "Default cycles lag tightening cycles by one to two years.", "medium", "Long-dated fixed-rate debt delays the impact.", "Rates staying high through a refinancing wall."],
    ["rates", "consumer", -1, .4, "6-18 months", "Higher borrowing costs raise debt payments and reward saving over spending.", "Canada is sensitive given high household debt and 5-year mortgage renewals.", "medium", "Savers earn more interest.", "Renewals at much higher rates across many households."],
    ["rates", "usd", 1, .4, "weeks-months", "Higher US yields relative to others attract capital into US dollars.", "Rate differentials are a reliable short-term currency driver.", "medium", "Risk-off episodes can move the dollar independently.", "US yields rising relative to other yields."],
    ["usd", "cad", -1, .5, "immediate", "A broadly stronger US dollar usually means a weaker loonie against it.", "USD/CAD is quoted directly against the dollar.", "low", "Oil strength can offset.", "A broad dollar move."],
    ["china", "chips", 1, .7, "immediate-years", "Advanced chips are concentrated in Taiwan; tension raises perceived supply risk.", "TSMC makes the large majority of the most advanced logic chips.", "high", "New fabs in the US, Japan and Europe slowly diversify supply.", "Actual disruption (blockade, sanctions, export bans)."],
    ["china", "tariffs", 1, .5, "weeks-months", "Geopolitical friction tends to show up as tariffs, export controls and sanctions.", "US-China trade actions since 2018 followed escalations.", "medium", "Truces can reverse quickly.", "Formal policy action."],
    ["chips", "ai_capex", -1, .4, "months", "Supply shortages cap how much AI infrastructure can be built.", "GPU constraints limited deployments in 2023-24.", "high", "Shortages raise pricing power for designers that do get supply.", "A supply shock at leading-edge foundries or packaging."],
    ["growth", "oil", 1, .45, "months", "Stronger activity raises energy demand.", "Oil demand tracks global industrial production.", "medium", "OPEC+ decisions dominate at times.", "A growth change broad enough to move demand forecasts."],
    ["growth", "metals", 1, .6, "months", "Industrial metals are used in construction and manufacturing.", "Copper is called a barometer of global growth.", "medium", "China-specific stimulus can dominate.", "Growth changes concentrated in China or manufacturing."],
    ["growth", "consumer", 1, .6, "months", "Jobs and incomes drive household spending.", "Consumption is 55-70% of GDP in Canada and the US.", "low", "Savings can smooth spending.", "Employment changing, not only sentiment."],
    ["growth", "credit", -1, .5, "6-12 months", "Slower growth weakens cash flows and raises defaults.", "Credit spreads widen in recessions.", "low", "Central-bank easing cushions.", "A slowdown deep enough to lift unemployment."],
    ["wages", "inflation", 1, .4, "6-18 months", "Rising labour costs feed into service prices.", "Services inflation correlates with wage growth.", "medium", "Productivity gains offset.", "Wage growth above productivity plus 2%."],
    ["credit", "growth", -1, .5, "6-18 months", "Tighter lending restricts investment and hiring.", "Loan-officer surveys lead activity.", "medium", "Fiscal support can offset.", "Standards tightening broadly."],
    ["credit", "risk", -1, .6, "immediate", "Credit stress makes investors demand more compensation for risk.", "Equity drawdowns coincide with spread widening.", "low", "Policy backstops can reverse it quickly.", "Spreads widening outside a single sector."],
    ["housing", "consumer", 1, .3, "months", "Home equity and turnover drive renovation and durable spending.", "Wealth effect.", "medium", "Relief for renters.", "Sustained price or volume changes."],
    ["ai_capex", "growth", 1, .2, "quarters", "Data-centre construction and equipment orders add to investment.", "AI infrastructure has been a notable share of recent US business-investment growth.", "medium", "Could reverse if returns disappoint.", "Capex guidance from the largest cloud providers."],
  ];

  K.SHOCKS = [
    { id: "energy", label: "Energy supply / oil price move", rx: /\b(oil|crude|opec\+?|brent|wti|refiner(y|ies)|pipeline|natural gas|lng|gasoline|fuel prices?|strait of hormuz|hormuz|tanker|red sea|energy supply)\b/i, impulse: { oil: 1 },
      neg: /\b(oil|crude|gas|fuel)\b.{0,40}\b(fall|falls|fell|drop|drops|slump|plunge|tumble|lower|cheaper|glut|slide)/i,
      people: "Fuel, heating and travel costs move first; food and delivery prices follow.", business: "Transport-heavy businesses see margin pressure; producers see windfalls.",
      markets: "Energy equities and the Canadian dollar tend to rise with oil; airlines and consumer names lag.", watch: ["WTI and Brent over two weeks", "OPEC+ statements", "Hormuz transits", "Next CPI energy component"],
      counter: "Supply scares often reverse within weeks; demand weakness can dominate." },
    { id: "hawkish", label: "Higher-for-longer interest rates", rx: /\b(rate hikes?|raises? (interest )?rates?|hawkish|higher for longer|tighten(ing)?|yields? (jump|surge|climb|rise|soar)|holds? rates?|keeps? rates? (unchanged|steady))\b/i, impulse: { rates: 1 },
      people: "Variable-rate debt stays expensive; savings pay more.", business: "Borrowing costs weigh on expansion; leveraged firms feel it at refinancing.",
      markets: "Long-duration growth stocks, REITs and utilities are most sensitive; bank margins can benefit.", watch: ["Next central-bank decision", "2- and 10-year yields", "Core inflation"], counter: "Markets may already price the path." },
    { id: "dovish", label: "Rate cuts / easing", rx: /\b(rate cuts?|cuts? (interest )?rates?|dovish|eas(e|es|ing) (policy|rates)|lower(s|ed)? rates?|yields? (fall|drop|slide|tumble))\b/i, impulse: { rates: -1 },
      people: "Variable-rate borrowers get relief; savings yields fall.", business: "Cheaper financing supports investment.", markets: "Growth stocks, real estate and small caps usually benefit.",
      watch: ["Forward guidance", "Bond yields", "Housing activity"], counter: "Cuts driven by a weakening economy can coincide with falling earnings." },
    { id: "inflation", label: "Inflation surprise", rx: /\b(inflation|cpi|consumer prices?|price pressures?|pce)\b/i, impulse: { inflation: 1 },
      neg: /\b(inflation|cpi|prices?)\b.{0,40}\b(cool|cools|cooled|ease|eases|eased|slow|slows|slowed|fall|falls|fell|lower|below)/i,
      people: "Purchasing power erodes when prices outpace pay.", business: "Pricing power protects margins; others get squeezed.", markets: "Hot prints push yields up and pressure valuations.",
      watch: ["Core and trimmed-mean measures", "Services inflation", "Wage growth"], counter: "One month is noise; the three-to-six-month trend matters." },
    { id: "jobs", label: "Labour market signal", rx: /\b(jobs report|payrolls|unemployment|jobless|hiring|layoffs?|labou?r market|employment)\b/i, impulse: { growth: 1, wages: .6 },
      neg: /\b(layoffs?|job cuts|unemployment (rises|rose|jumps|climbs)|jobless claims (rise|jump)|weak hiring|slump)/i,
      people: "Job security and bargaining power shift.", business: "Tight markets raise wage costs.", markets: "Strong jobs can delay rate cuts.", watch: ["Unemployment trend", "Wage growth"], counter: "Headline numbers are revised heavily." },
    { id: "tariffs", label: "Trade barriers / tariffs", rx: /\b(tariffs?|trade war|export controls?|import (tax|duties)|duties|trade deal|sanctions?|usmca|cusma)\b/i, impulse: { tariffs: 1 },
      neg: /\b(lift(s|ed)?|remov(e|es|ed)|pause[sd]?|exempt(ion|s)?|trade deal|truce|roll(s|ed)? back)\b/i,
      people: "Imported goods, cars and electronics can get pricier.", business: "Importers face cost pressure; supply chains reroute.", markets: "Cross-border manufacturers, autos, railroads and the loonie are sensitive.",
      watch: ["Implementation dates", "Retaliation", "Exemptions"], counter: "Threatened tariffs are often negotiated down." },
    { id: "taiwan", label: "China / Taiwan tension", rx: /\b(taiwan|south china sea|beijing|xi jinping|chinese military|pla\b|us-china)\b/i, impulse: { china: 1 },
      people: "Electronics availability could be affected.", business: "Firms relying on Taiwanese chips face supply risk.", markets: "Semiconductors and hardware supply chains are exposed.",
      watch: ["Military exercises", "Export controls", "TSMC commentary"], counter: "Rhetoric has escalated many times without disruption." },
    { id: "ai", label: "AI investment cycle", rx: /\b(ai|artificial intelligence|data cent(er|re)s?|gpus?|nvidia|openai|anthropic|hyperscalers?|capex|large language models?|compute)\b/i, impulse: { ai_capex: 1 },
      neg: /\b(ai bubble|cut(s|ting)? (ai )?spending|capex cuts?|pullback|overbuil)/i,
      people: "AI tools change job tasks; data centres raise power demand.", business: "Chip makers, clouds, utilities see demand.", markets: "Semis and mega-cap tech drive index returns, increasing concentration.",
      watch: ["Hyperscaler capex guidance", "GPU lead times", "AI revenue disclosures"], counter: "Capex booms can overshoot." },
    { id: "conflict", label: "Armed conflict / security shock", rx: /\b(war|missiles?|airstrikes?|invasion|troops|military (strike|operation)|attack(s|ed)?|drone strikes?|escalat(e|ion)|shelling|blockade)\b/i, impulse: { risk: -1, defense: .7 },
      neg: /\b(ceasefire|peace (deal|talks|agreement)|truce|de-escalat)/i,
      people: "Humanitarian costs first; energy, food and travel can be disrupted.", business: "Defence contractors see demand; regional firms face disruption.",
      markets: "Safe havens (US dollar, gold, Treasuries) typically rise; risk assets dip, often briefly.", watch: ["Energy and shipping routes", "Sanctions", "Airspace closures"],
      counter: "Market impact from conflicts often fades within weeks unless energy supply is hit." },
    { id: "middle_east", label: "Middle East energy-route risk", rx: /\b(iran|israel|gaza|hezbollah|houthis?|saudi|persian gulf|gulf of oman|strait of hormuz|red sea|yemen|lebanon|qatar)\b/i, impulse: { oil: .7, risk: -.5 },
      people: "Energy and shipping-cost risk.", business: "Shipping reroutes lengthen supply chains.", markets: "Oil risk premium; defence and energy up, airlines down.",
      watch: ["Brent risk premium", "Tanker rates", "Transits through Hormuz and Bab el-Mandeb"], counter: "Premiums fade without actual supply loss." },
    { id: "banking", label: "Credit / banking stress", rx: /\b(bank (failure|run|collapse)|credit (crunch|stress|spreads?)|defaults?|bankrupt(cy)?|private credit|downgrade[sd]?|liquidity crisis|delinquenc(y|ies))\b/i, impulse: { credit: 1 },
      people: "Loans get harder to obtain.", business: "Refinancing gets harder for leveraged firms.", markets: "Banks, private credit and high yield are most sensitive.", watch: ["Credit spreads", "Deposit flows"], counter: "Isolated failures aren't systemic." },
    { id: "housing", label: "Housing market signal", rx: /\b(housing|home (sales|prices)|mortgages?|real estate|rents?|home ?builders?|condo)\b/i, impulse: { housing: 1 },
      neg: /\b(fall|falls|fell|drop|drops|slump|decline|cool|cools|slow|slows|weak)/i,
      people: "Affordability and renewal costs.", business: "Banks, builders and home-improvement retailers.", markets: "Canadian banks and REITs.", watch: ["Mortgage rates", "Sales and listings"], counter: "Regional divergence is large." },
    { id: "regulation", label: "Tech regulation / antitrust", rx: /\b(antitrust|monopoly|doj|ftc|competition bureau|european commission|digital markets act|dma|fined?|lawsuit|regulators?)\b/i, impulse: { regulation: 1 },
      people: "Can change default apps, prices and privacy.", business: "Platforms may lose bundling advantages.", markets: "Mega-cap platforms face overhangs.", watch: ["Rulings", "Remedies"], counter: "Remedies are usually narrower than headlines." },
    { id: "slowdown", label: "Growth slowdown / recession risk", rx: /\b(recession|slowdown|contraction|gdp (shrinks|contracts|falls|slows)|economy (shrinks|slows|contracts)|stagflation|downturn)\b/i, impulse: { growth: -1 },
      people: "Job security weakens; rate relief may follow.", business: "Revenue growth slows for cyclicals.", markets: "Defensives and bonds outperform.", watch: ["Unemployment claims", "Earnings revisions", "Yield curve"], counter: "Recession calls are often wrong." },
    { id: "china_demand", label: "China economy / stimulus", rx: /\b(china('s)? (economy|stimulus|growth|exports|property)|pboc|yuan|chinese (consumers|demand))\b/i, impulse: { metals: .8, growth: .4 },
      neg: /\b(slow|slows|slump|weak|deflation|contract|falls?)/i, people: "Prices of manufactured goods.", business: "Miners, luxury brands and exporters depend on China.", markets: "Copper, materials, luxury.", watch: ["Credit growth", "Property sales"], counter: "Stimulus often disappoints." },
    { id: "fx_cad", label: "Canadian dollar move", rx: /\b(loonie|canadian dollar|usd\/cad)\b/i, impulse: { cad: 1 }, neg: /\b(weak|weaker|weakens|falls?|fell|slides?|drops?|lower|slump)/i,
      people: "A weaker loonie makes US travel and imports pricier.", business: "Exporters benefit from a weaker CAD.", markets: "Changes the CAD value of every US-dollar holding.", watch: ["Oil", "BoC–Fed rate gap"], counter: "Currency moves often mean-revert." },
    { id: "defense", label: "Defence spending", rx: /\b(defen[cs]e (budget|spending)|nato (target|spending)|military spending|arms (deal|sales))\b/i, impulse: { defense: 1 },
      people: "Public budgets shift toward defence.", business: "Contractors gain order visibility.", markets: "Defence stocks.", watch: ["Appropriations"], counter: "Pledges exceed appropriations." },
  ];

  K.PLAN_TEMPLATES = {
    "Buy a home": { rates: -1, housing: -.5 }, "Renew or hold a variable-rate mortgage": { rates: -1 },
    "Job search in venture, tech or finance": { risk: .9, ai_capex: .5, rates: -.5, growth: .5 }, "Raise capital / start a company": { risk: 1, rates: -.7, credit: -.4 },
    "Travel to the US or abroad (spending in foreign currency)": { cad: 1 }, "Grow long-term retirement savings": { risk: .7, growth: .5 },
    "Keep an emergency fund in cash": { rates: .5, inflation: -.5 }, "Buy a car": { rates: -.6, tariffs: -.5, oil: -.3 },
  };

  K.EPISODES = [
    { id: "2022", title: "2022 inflation and rate shock", applies: ["rates", "inflation"], moves: { market: -0.194, rates: 2.36, oil: 0.067, usd: 0.08 },
      text: "US CPI peaked near 9% and the Fed raised rates from ~0% to over 4%. S&P 500 about −19%, Nasdaq about −33% for the year; aggregate bonds about −13%. Energy was the best sector (about +60%). USD/CAD rose from about 1.26 to 1.35." },
    { id: "2020", title: "2020 pandemic crash", applies: ["growth", "risk", "oil"], moves: { market: -0.34, rates: -1.2, oil: -0.6, usd: 0.05 },
      text: "The S&P 500 fell about 34% between 19 Feb and 23 Mar 2020, then regained its high by August. WTI futures briefly traded below zero in April." },
    { id: "2008", title: "2008 global financial crisis", applies: ["credit", "growth", "risk", "housing"], moves: { market: -0.5, rates: -1.8, oil: -0.7, usd: 0.15 },
      text: "The S&P 500 fell about 57% peak to trough (Oct 2007 to Mar 2009). USD/CAD went from about parity to 1.30." },
    { id: "2014", title: "2014-16 oil collapse", applies: ["oil", "cad"], moves: { market: -0.1, rates: -0.5, oil: -0.7, usd: 0.2 },
      text: "WTI fell from about US$107 (June 2014) to about US$26 (Feb 2016). The loonie fell from about 94 to under 70 US cents." },
    { id: "2000", title: "2000-02 dot-com unwind", applies: ["risk", "ai_capex"], moves: { market: -0.49, rates: -2.5, oil: 0, usd: 0 },
      text: "The Nasdaq fell about 78% from March 2000 to October 2002 as tech capex and valuations reset." },
    { id: "2013", title: "2013 taper tantrum", applies: ["rates"], moves: { market: -0.05, rates: 1.3, oil: 0.05, usd: 0.03 },
      text: "The US 10-year yield rose from about 1.6% in May to about 3.0% by September 2013 after the Fed signalled slower bond purchases." },
  ];

  K.CENTRAL_BANK_2026 = {
    "Federal Reserve (FOMC)": ["https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"]],
    "Bank of Canada": ["https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/", ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-10", "2026-07-15", "2026-09-02", "2026-10-28", "2026-12-09"]],
  };
  K.computedEvents = function (start, end) {
    const out = [];
    const iso = (d) => V.iso(d);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 5 && d.getDate() >= 15 && d.getDate() <= 21) {
        const q = [2, 5, 8, 11].includes(d.getMonth());
        out.push({ date: iso(d), title: (q ? "Quarterly" : "Monthly") + " options expiration", category: "market", importance: q ? 2 : 1, note: "Computed: third Friday. Can add intraday volatility." });
      }
      // the big monthly macro releases, placed on their usual day (agencies occasionally shift them)
      if (d.getDay() === 5 && d.getDate() <= 7 && d.getMonth() !== 0) out.push({ date: iso(d), title: "US jobs report (usual timing)", category: "market", importance: 2, note: "BLS usually publishes the Employment Situation on the first Friday of the month (January's often moves to the second). Moves yields, the US dollar and rate-cut odds. Confirm at bls.gov/schedule.", url: "https://www.bls.gov/schedule/news_release/empsit.htm" });
      if (d.getDay() === 2 && d.getDate() >= 15 && d.getDate() <= 21) out.push({ date: iso(d), title: "Canada CPI (usual timing)", category: "market", importance: 2, note: "Statistics Canada usually releases CPI on the third Tuesday of the month. Feeds straight into Bank of Canada expectations and the loonie. Confirm on the StatCan release calendar.", url: "https://www150.statcan.gc.ca/n1/dai-quo/cal2-eng.htm" });
    }
    for (const y of [start.getFullYear(), start.getFullYear() + 1]) {
      for (const qe of [[2, 31], [5, 30], [8, 30], [11, 31]]) {
        const due = new Date(y, qe[0], qe[1]); due.setDate(due.getDate() + 45);
        while (due.getDay() === 0 || due.getDay() === 6) due.setDate(due.getDate() + 1);
        if (due >= start && due <= end) out.push({ date: iso(due), title: `13F filing deadline (Q${Math.floor(qe[0] / 3) + 1} ${y} holdings)`, category: "filing", importance: 2, note: "Computed: 45 days after quarter end. Institutional holdings become public around now." });
      }
      const rrsp = new Date(y, 2, 1);
      if (rrsp >= start && rrsp <= end) out.push({ date: iso(rrsp), title: "RRSP contribution deadline (approx.)", category: "financial", importance: 2, note: "Normally 60 days after year end; confirm with CRA." });
      const jan1 = new Date(y, 0, 1);
      if (jan1 >= start && jan1 <= end) out.push({ date: iso(jan1), title: "New TFSA contribution room", category: "financial", importance: 1, note: "Annual TFSA room is added on 1 January." });
    }
    for (const [bank, [url, dates]] of Object.entries(K.CENTRAL_BANK_2026)) for (const ds of dates) { const dd = V.parseDay(ds); if (dd >= start && dd <= end) out.push({ date: ds, title: bank + " rate decision", category: "market", importance: 3, note: "Published schedule (built in). Confirm at the source.", url }); }
    return out;
  };

  // ------------------------------------------------------------------ indicators ("so what?")
  // src: ["yahoo", ticker] | ["boc", series] | ["calc", fn] | ["bls", series]; long: weekly history ticker or boc series for decades of context.
  const I = (K.IND = {});
  const ind = (id, o) => (I[id] = Object.assign({ id }, o));
  ind("boc_policy", { name: "Bank of Canada policy rate", group: "rates", src: ["boc", "V39079"], unit: "%", dec: 2, factor: "rates", dir: 1,
    desc: "The overnight rate the Bank of Canada targets. It anchors variable mortgages, lines of credit, and savings rates in Canada.",
    up: { people: "Variable-rate mortgage and HELOC payments rise within days; high-interest savings pay more.", business: "Bank borrowing gets more expensive; leveraged and small firms feel it first.", markets: "The loonie tends to firm; REITs, utilities and long-duration growth stocks usually fall; bank margins can widen." },
    down: { people: "Variable payments fall; savings yields drop; home buying picks up.", business: "Cheaper credit supports hiring and investment.", markets: "The loonie tends to soften; REITs, utilities and growth stocks usually benefit." } });
  ind("ca_prime", { name: "Canadian prime rate", group: "rates", src: ["boc", "V80691311"], unit: "%", dec: 2, factor: "rates", dir: 1,
    desc: "The big banks' base lending rate. Variable mortgages and lines of credit are priced as prime plus or minus a spread. It has sat 2.20 points above the policy rate since 2022.",
    up: { people: "Every $100,000 of variable-rate debt costs about $100 a year more for each 0.10-point rise.", business: "Floating-rate business loans reprice immediately.", markets: "Mirrors the policy rate." },
    down: { people: "Variable borrowers save immediately.", business: "Floating-rate borrowers get relief.", markets: "Mirrors the policy rate." } });
  ind("ca_mort5", { name: "5-year conventional mortgage (posted)", group: "rates", src: ["boc", "V80691335"], unit: "%", dec: 2, factor: "housing", dir: -1,
    desc: "The banks' posted 5-year fixed rate (actual offered rates are usually lower). Fixed rates follow the 5-year Government of Canada bond yield plus a spread.",
    up: { people: "Renewals and new mortgages get pricier; the stress test gets harder to pass.", business: "Builders and realtors see fewer transactions.", markets: "Pressure on Canadian banks' mortgage volumes and on REITs." },
    down: { people: "Affordability improves; renewals get cheaper.", business: "Housing turnover and related spending recover.", markets: "Supports banks' volumes, builders and REITs." } });
  ind("ca_2y", { name: "Canada 2-year yield", group: "rates", src: ["boc", "BD.CDN.2YR.DQ.YLD"], unit: "%", dec: 2, factor: "rates", dir: 1,
    desc: "What markets expect the Bank of Canada to do over the next two years. It moves before the Bank does.",
    up: { people: "Signals fewer or later rate cuts.", business: "Short-term borrowing costs stay high.", markets: "CAD firms; rate-sensitive stocks soften." }, down: { people: "Signals cuts ahead.", business: "Relief ahead for borrowers.", markets: "CAD softens; rate-sensitive stocks lift." } });
  ind("ca_5y", { name: "Canada 5-year yield", group: "rates", src: ["boc", "BD.CDN.5YR.DQ.YLD"], unit: "%", dec: 2, factor: "rates", dir: 1,
    desc: "The benchmark lenders use to price 5-year fixed mortgages (plus a spread of roughly 1-2 points).",
    up: { people: "Fixed mortgage rates usually follow within weeks.", business: "Longer-term financing costs rise.", markets: "Pressure on REITs, utilities and pipelines." }, down: { people: "Fixed rates usually fall within weeks.", business: "Cheaper long-term financing.", markets: "Supports rate-sensitive sectors." } });
  ind("ca_10y", { name: "Canada 10-year yield", group: "rates", src: ["boc", "BD.CDN.10YR.DQ.YLD"], unit: "%", dec: 2, factor: "rates", dir: 1,
    desc: "Long-term Canadian borrowing cost; closely tied to the US 10-year.", up: { people: "Long-term borrowing costs rise.", business: "Capital projects face higher hurdle rates.", markets: "Valuations of long-duration assets compress." }, down: { people: "Long-term borrowing gets cheaper.", business: "Projects pencil out more easily.", markets: "Long-duration assets re-rate higher." } });
  ind("us_3m", { name: "US 3-month T-bill", group: "rates", src: ["yahoo", "^IRX"], unit: "%", dec: 2, factor: "rates", dir: 1, long: "^IRX",
    desc: "The yield on 13-week Treasury bills, a close read on where the Fed's policy rate will be over the next quarter.",
    up: { people: "US money-market funds pay more.", business: "Short-term US funding costs rise.", markets: "Cash competes harder with stocks." }, down: { people: "Money-market yields fall.", business: "Cheaper short-term funding.", markets: "Cash becomes less attractive versus risk assets." } });
  ind("us_2y", { name: "US 2-year yield", group: "rates", src: ["yahoo", "2YY=F"], unit: "%", dec: 2, factor: "rates", dir: 1,
    desc: "Market expectation for the Fed over two years (shown via the CBOT 2-year yield futures contract).", up: { people: "Fewer Fed cuts priced.", business: "Tighter conditions.", markets: "Dollar tends to rise; growth stocks soften." }, down: { people: "More cuts priced.", business: "Easier conditions ahead.", markets: "Dollar tends to soften; growth stocks lift." } });
  ind("us_10y", { name: "US 10-year Treasury yield", group: "rates", src: ["yahoo", "^TNX"], unit: "%", dec: 2, factor: "rates", dir: 1, long: "^TNX",
    desc: "The most important price in world finance: it sets US mortgage rates and the discount rate investors use to value stocks everywhere.",
    up: { people: "US mortgage rates rise; Canadian fixed rates often follow.", business: "Higher hurdle rates for investment.", markets: "Long-duration growth stocks and real estate usually fall; the US dollar tends to strengthen." },
    down: { people: "Mortgage rates ease.", business: "Investment pencils out more easily.", markets: "Growth stocks and real estate usually benefit; the dollar tends to soften." } });
  ind("us_30y", { name: "US 30-year yield", group: "rates", src: ["yahoo", "^TYX"], unit: "%", dec: 2, factor: "rates", dir: 1, long: "^TYX",
    desc: "The long end of the curve, sensitive to inflation expectations and government debt supply.", up: { people: "Long-term borrowing costs rise.", business: "Pension and insurer liabilities shrink.", markets: "Pressure on long bonds and utilities." }, down: { people: "Long-term rates ease.", business: "Pension liabilities grow.", markets: "Long bonds rally." } });
  ind("us_curve", { name: "US yield curve (10y − 2y)", group: "rates", src: ["calc", "curve_us"], unit: " pts", dec: 2, factor: "growth", dir: 1,
    desc: "The gap between long and short yields. Below zero (inverted) means markets expect rates to fall, usually because they expect a slowdown. Inversions have preceded US recessions since the late 1960s, with long and variable lags.",
    up: { people: "Steepening after an inversion often coincides with the start of rate cuts.", business: "Banks earn more on the spread between deposits and loans.", markets: "Bank margins improve; cyclicals often lead." },
    down: { people: "Deeper inversion is a louder recession warning.", business: "Banks' lending margins get squeezed.", markets: "Defensive sectors tend to outperform." } });
  ind("ca_curve", { name: "Canada yield curve (10y − 2y)", group: "rates", src: ["calc", "curve_ca"], unit: " pts", dec: 2, factor: "growth", dir: 1,
    desc: "The Canadian version of the recession signal.", up: { people: "Often coincides with Bank of Canada cuts.", business: "Better bank lending margins.", markets: "Canadian banks tend to benefit." }, down: { people: "Recession warning.", business: "Squeezed bank margins.", markets: "Defensives outperform." } });

  ind("wti", { name: "WTI crude oil", group: "energy", src: ["yahoo", "CL=F"], unit: "$/bbl", dec: 2, pre: "$", factor: "oil", dir: 1, long: "CL=F",
    desc: "The US crude benchmark (front-month futures). Canadian heavy crude (WCS) trades at a discount to it.",
    up: { people: "Pump prices rise: every US$10/bbl adds roughly 9 cents a litre in Canada before tax. Heating and airfares follow.", business: "Airlines, logistics and chemicals see margin pressure; producers and oil-service firms see windfalls.", markets: "Energy stocks and the loonie tend to rise; inflation expectations and yields drift up; airlines and consumer names lag." },
    down: { people: "Cheaper fuel frees up household budgets.", business: "Transport-heavy businesses get relief; producers cut capex.", markets: "Energy stocks and the loonie soften; inflation cools, which can pull yields down." } });
  ind("brent", { name: "Brent crude oil", group: "energy", src: ["yahoo", "BZ=F"], unit: "$/bbl", dec: 2, pre: "$", factor: "oil", dir: 1, long: "BZ=F",
    desc: "The global benchmark priced off North Sea crude. Middle East disruptions (Hormuz, Red Sea) show up here first.",
    up: { people: "Global fuel and freight costs rise.", business: "Importing economies (Europe, Asia) feel it most.", markets: "Energy equities up; inflation-sensitive assets down." }, down: { people: "Relief at the pump globally.", business: "Lower input costs.", markets: "Energy equities down; bonds often rally." } });
  ind("brent_wti", { name: "Brent − WTI spread", group: "energy", src: ["calc", "brent_wti"], unit: "$/bbl", dec: 2, pre: "$", factor: "oil", dir: 1,
    desc: "How much more global crude costs than US crude. A widening spread signals stress outside North America (Middle East supply, shipping).",
    up: { people: "Fuel costs rise faster abroad than in North America.", business: "US refiners and exporters gain an edge.", markets: "Signals global supply stress." }, down: { people: "Global and US fuel converge.", business: "Export advantage narrows.", markets: "Global supply fears easing." } });
  ind("natgas", { name: "US natural gas (Henry Hub)", group: "energy", src: ["yahoo", "NG=F"], unit: "$/MMBtu", dec: 3, pre: "$", factor: "oil", dir: 1, long: "NG=F",
    desc: "Fuels heating and a large share of electricity. LNG exports link it to global prices.", up: { people: "Heating and power bills rise.", business: "Fertilizer, chemicals and utilities pay more.", markets: "Gas producers benefit." }, down: { people: "Cheaper heating and power.", business: "Lower input costs.", markets: "Gas producers suffer." } });
  ind("rbob", { name: "Gasoline futures (RBOB)", group: "energy", src: ["yahoo", "RB=F"], unit: "$/gal", dec: 3, pre: "$", factor: "oil", dir: 1,
    desc: "Wholesale gasoline. Pump prices follow within one to two weeks.", up: { people: "Pump prices rise shortly.", business: "Delivery costs rise.", markets: "Refiners' margins can widen." }, down: { people: "Pump prices ease.", business: "Delivery costs fall.", markets: "Refiners' margins can narrow." } });
  ind("crack", { name: "Refining margin (3-2-1 crack)", group: "energy", src: ["calc", "crack"], unit: "$/bbl", dec: 2, pre: "$", factor: "oil", dir: 1,
    desc: "Profit from turning 3 barrels of crude into 2 of gasoline and 1 of diesel. When it's high, pump prices rise faster than crude.",
    up: { people: "Pump prices outrun crude.", business: "Refiners earn more.", markets: "Refiners outperform producers." }, down: { people: "Pump prices lag crude.", business: "Refiners' margins shrink.", markets: "Producers outperform refiners." } });

  ind("sp500", { name: "S&P 500", group: "markets", src: ["yahoo", "^GSPC"], unit: "", dec: 0, factor: "risk", dir: 1, long: "^GSPC", desc: "The 500 largest US companies.", up: { people: "Retirement and investment accounts rise.", business: "Easier to raise equity capital.", markets: "Risk appetite improving." }, down: { people: "Paper wealth falls.", business: "Harder to raise capital.", markets: "Risk appetite fading." } });
  ind("tsx", { name: "S&P/TSX Composite", group: "markets", src: ["yahoo", "^GSPTSE"], unit: "", dec: 0, factor: "risk", dir: 1, long: "^GSPTSE", desc: "Canada's broad index: heavy in banks, energy and materials.", up: { people: "Canadian portfolios rise.", business: "Easier capital raising.", markets: "Often tracks oil and bank earnings." }, down: { people: "Canadian portfolios fall.", business: "Tighter capital.", markets: "Often tracks oil and credit worries." } });
  ind("nasdaq", { name: "Nasdaq Composite", group: "markets", src: ["yahoo", "^IXIC"], unit: "", dec: 0, factor: "ai_capex", dir: 1, long: "^IXIC", desc: "Tech-heavy US index; most sensitive to rates and the AI cycle.", up: { people: "Tech-heavy portfolios rise.", business: "Tech firms can raise capital cheaply.", markets: "Growth leadership." }, down: { people: "Tech-heavy portfolios fall.", business: "Tech hiring slows.", markets: "Rotation away from growth." } });
  ind("vix", { name: "VIX (fear gauge)", group: "markets", src: ["yahoo", "^VIX"], unit: "", dec: 2, factor: "risk", dir: -1, long: "^VIX", desc: "Expected S&P 500 volatility over 30 days, from options prices. Under 15 is calm; above 30 is stress.", up: { people: "Bigger daily swings in your accounts.", business: "IPOs and deals get postponed.", markets: "Investors pay up for protection; risk assets usually falling." }, down: { people: "Calmer markets.", business: "Deal windows open.", markets: "Complacency can build." } });
  ind("dxy", { name: "US dollar index", group: "markets", src: ["yahoo", "DX-Y.NYB"], unit: "", dec: 2, factor: "usd", dir: 1, long: "DX-Y.NYB", desc: "The US dollar against six major currencies.", up: { people: "US travel and goods cost more for Canadians.", business: "US multinationals' foreign earnings shrink.", markets: "Pressure on commodities and emerging markets." }, down: { people: "US goods cheaper for Canadians.", business: "Foreign earnings translate higher.", markets: "Commodities and EM tend to benefit." } });
  ind("cadusd", { name: "Canadian dollar (US cents)", group: "markets", src: ["yahoo", "CADUSD=X"], unit: "", dec: 4, factor: "cad", dir: 1, long: "CADUSD=X", desc: "How many US dollars one Canadian dollar buys.",
    up: { people: "Cross-border shopping and US travel get cheaper.", business: "Exporters earn fewer CAD per US dollar sold.", markets: "Your US-dollar holdings are worth less in CAD." }, down: { people: "US travel and imports get pricier.", business: "Exporters and tourism benefit.", markets: "Your US-dollar holdings are worth more in CAD." } });
  ind("gold", { name: "Gold", group: "markets", src: ["yahoo", "GC=F"], unit: "$/oz", dec: 0, pre: "$", factor: "metals", dir: 1, long: "GC=F", desc: "The classic safe haven and inflation hedge; also bought by central banks.", up: { people: "Signals fear or inflation worry.", business: "Miners' margins widen.", markets: "Often rises when real rates fall or risk rises." }, down: { people: "Signals calm or rising real rates.", business: "Miners' margins shrink.", markets: "Real yields rising or risk appetite strong." } });
  ind("copper", { name: "Copper", group: "markets", src: ["yahoo", "HG=F"], unit: "$/lb", dec: 3, pre: "$", factor: "metals", dir: 1, long: "HG=F", desc: "'Dr. Copper': used in construction, power grids, EVs and data centres, so it reads the global cycle.", up: { people: "Signals stronger growth.", business: "Higher input costs for builders; miners benefit.", markets: "Cyclicals and materials tend to lead." }, down: { people: "Signals slowing growth.", business: "Cheaper inputs.", markets: "Growth worries." } });
  ind("btc", { name: "Bitcoin", group: "markets", src: ["yahoo", "BTC-USD"], unit: "", dec: 0, pre: "$", factor: "risk", dir: 1, desc: "A barometer of speculative appetite.", up: { people: "Speculative wealth rises.", business: "Crypto-linked firms benefit.", markets: "Risk appetite high." }, down: { people: "Speculative wealth falls.", business: "Crypto firms suffer.", markets: "Risk appetite fading." } });
  ind("ca_cpi", { name: "Canada CPI inflation (y/y)", group: "macro", src: ["boc", "STATIC_TOTALCPICHANGE"], unit: "%", dec: 1, factor: "inflation", dir: 1, desc: "Year-over-year change in Canada's consumer price index. The Bank of Canada targets 2% (1-3% band).",
    up: { people: "Your dollar buys less; wage raises matter more.", business: "Pricing power separates winners from losers.", markets: "Rate cuts get pushed out; yields rise." }, down: { people: "Purchasing power recovers.", business: "Input-cost relief.", markets: "Room for rate cuts; yields fall." } });
  ind("ca_trim", { name: "Canada CPI-trim (core)", group: "macro", src: ["boc", "CPI_TRIM"], unit: "%", dec: 1, factor: "inflation", dir: 1, desc: "The Bank of Canada's preferred core measure: it strips out the most extreme price moves each month.", up: { people: "Underlying inflation is sticky.", business: "Wage pressure persists.", markets: "The Bank stays cautious." }, down: { people: "Underlying pressure easing.", business: "Cost pressure fading.", markets: "Cuts become more likely." } });

  K.IND_GROUPS = { rates: ["boc_policy", "ca_prime", "ca_mort5", "ca_2y", "ca_5y", "ca_10y", "us_3m", "us_2y", "us_10y", "us_30y", "us_curve", "ca_curve"],
    energy: ["wti", "brent", "brent_wti", "natgas", "rbob", "crack"], markets: ["sp500", "tsx", "nasdaq", "vix", "dxy", "cadusd", "gold", "copper", "btc"], macro: ["ca_cpi", "ca_trim"] };
  K.tickerIndicator = (t) => { t = (t || "").toUpperCase(); const f = Object.values(I).find((x) => x.src[0] === "yahoo" && x.src[1] === t); return f ? f.id : null; };
  K.FACTOR_TICKERS = ["^GSPC", "^TNX", "CL=F", "DX-Y.NYB", "^IXIC", "^GSPTSE", "CADUSD=X", "^VIX", "GC=F", "BZ=F", "2YY=F", "^IRX", "^TYX", "NG=F", "RB=F", "HO=F", "HG=F", "BTC-USD", "XLE"];

  // ------------------------------------------------------------------ hotspots
  K.HOTSPOTS = [
    { id: "hormuz", name: "Strait of Hormuz", region: "Persian Gulf", ll: [26.6, 56.3], countries: ["IR", "OM", "AE", "QA", "KW", "BH", "SA", "IQ"], ports: ["Strait of Hormuz"], air: true,
      why: "Roughly a fifth of the world's oil consumption (about 20 million barrels a day in 2024, per the US EIA) and a large share of global LNG, mostly Qatari, pass through this 21-mile-wide strait. There is limited pipeline capacity to bypass it.",
      watch: ["Daily tanker transits vs normal", "Brent risk premium and Brent−WTI spread", "Flights over the Gulf (airspace closures)", "Insurance and tanker rates", "Statements from Iran, Gulf states and the US Navy"],
      impulse: { oil: 1, inflation: .4, risk: -.4 }, gdelt: "hormuz" },
    { id: "redsea", name: "Red Sea & Bab el-Mandeb", region: "Yemen · Horn of Africa", ll: [12.6, 43.4], countries: ["YE", "ER", "DJ", "SA", "EG", "SO"], ports: ["Bab el-Mandeb Strait", "Cape of Good Hope"], air: true,
      why: "The southern gate to the Suez route between Asia and Europe, which before the 2023–24 Houthi attacks carried roughly 12% of global trade. When ships avoid it they sail around the Cape of Good Hope, adding 10–14 days.",
      watch: ["Bab el-Mandeb transits vs normal", "Cape of Good Hope transits (rerouting)", "Container freight rates", "Attacks on shipping"], impulse: { tariffs: .4, inflation: .25, oil: .3 } },
    { id: "suez", name: "Suez Canal", region: "Egypt", ll: [30.5, 32.3], countries: ["EG"], ports: ["Suez Canal"],
      why: "The shortest sea link between Asia and Europe. Disruptions reroute ships around Africa and raise freight costs for European importers.", watch: ["Transits vs normal", "Egyptian canal revenue", "Freight rates"], impulse: { tariffs: .3, inflation: .2 } },
    { id: "taiwan", name: "Taiwan Strait", region: "China · Taiwan", ll: [24.5, 119.5], countries: ["TW", "CN"], ports: ["Taiwan Strait"], air: true,
      why: "A large share of global container shipping passes through it, and Taiwan (TSMC) makes the large majority of the world's most advanced chips. Any blockade would hit AI, phones and cars everywhere.",
      watch: ["PLA exercises and aircraft incursions", "Export-control announcements", "Shipping transits", "TSMC commentary"], impulse: { china: 1, chips: .8, risk: -.6 } },
    { id: "ukraine", name: "Ukraine & Black Sea", region: "Eastern Europe", ll: [48.5, 34.0], countries: ["UA", "RU", "MD", "BY", "TR"], ports: ["Bosporus Strait", "Kerch Strait"], air: true,
      why: "Ukraine and Russia are major exporters of wheat, corn, sunflower oil and fertilizer; Russia is a top exporter of oil, gas and metals. The Bosporus carries Russia's Black Sea oil exports.",
      watch: ["Black Sea shipping", "Energy infrastructure strikes", "Sanctions and price caps", "Grain prices"], impulse: { oil: .3, risk: -.3, defense: .6, inflation: .1 } },
    { id: "levant", name: "Israel, Gaza & Lebanon", region: "Eastern Mediterranean", ll: [32.4, 35.1], countries: ["IL", "PS", "LB", "SY", "JO"], air: true,
      why: "Risk of wider regional escalation involving Iran, which feeds straight into the oil risk premium and Gulf shipping.", watch: ["Escalation involving Iran", "Airspace closures", "Oil risk premium"], impulse: { oil: .4, risk: -.3, defense: .4 } },
    { id: "scs", name: "South China Sea", region: "Southeast Asia", ll: [13.0, 114.0], countries: ["PH", "VN", "CN", "MY"], ports: ["Luzon Strait"],
      why: "Roughly $3 trillion of trade a year crosses it (CSIS estimate). Confrontations between China and the Philippines are the main flashpoint.", watch: ["Coast-guard confrontations", "US-Philippines exercises"], impulse: { china: .6, risk: -.2 } },
    { id: "korea", name: "Korean Peninsula", region: "Northeast Asia", ll: [38.3, 127.2], countries: ["KP", "KR"], ports: ["Korea Strait"], air: true,
      why: "South Korea makes most of the world's memory chips (Samsung, SK Hynix). Missile tests and escalation move Asian markets.", watch: ["Missile tests", "Memory-chip prices"], impulse: { chips: .4, risk: -.3 } },
    { id: "panama", name: "Panama Canal", region: "Central America", ll: [9.1, -79.7], countries: ["PA"], ports: ["Panama Canal"],
      why: "A key link between Asia and the US East Coast. Droughts in 2023–24 forced draft limits and fewer daily transits.", watch: ["Daily transits vs normal", "Gatun Lake water levels"], impulse: { tariffs: .15, inflation: .05 } },
    { id: "malacca", name: "Strait of Malacca", region: "Singapore · Malaysia · Indonesia", ll: [2.5, 101.3], countries: ["MY", "SG", "ID"], ports: ["Malacca Strait"],
      why: "The shortest sea route between the Indian Ocean and the Pacific, carrying about 23 million barrels of oil a day (EIA) plus much of Asia's manufactured trade.", watch: ["Transits vs normal", "Piracy incidents"], impulse: { oil: .3, chips: .2 } },
  ];
  K.ADVISORY = ["Take normal security precautions", "Exercise a high degree of caution", "Avoid non-essential travel", "Avoid all travel"];
})();
