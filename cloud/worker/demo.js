// Demonstration workspace (space = "demo"). Real tickers so live prices flow; every quantity,
// person, event and decision is fictional and watermarked in the UI.

const D = 86400;
const iso = (days) => { const d = new Date(Date.now() + days * D * 1000); return d.toISOString().slice(0, 10); };
const at = (days, hh, mm = 0) => { const d = new Date(Date.now() + days * D * 1000); d.setUTCHours(hh + 4, mm, 0, 0); return d.toISOString(); };

export function demoSeed() {
  const now = Date.now() / 1000;
  const recs = [];
  const add = (kind, data, ageDays = 0, id) => recs.push({ kind, data, created: now - ageDays * D, id });
  const H = [
    ["SHOP.TO", 120, 95, "TFSA", { why: "Commerce operating system for independent brands; GMV growth above 20% with expanding margins.",
                                  expect: "Revenue growth >20% for 3 years; FCF margin rising toward high teens.", wrong_if: "GMV growth below 15%, take rate stalls, enterprise wins slow.",
                                  indicators: ["GMV", "take rate", "merchant", "enterprise", "margin"], horizon: "3-5 years", conviction: 4 }],
    ["RY.TO", 150, 140, "RRSP", { why: "Best-in-class Canadian bank; durable deposits and wealth management growth.", expect: "High-single-digit EPS growth, rising dividend.",
                                 wrong_if: "Mortgage credit losses spike as renewals reset higher.",
                                 indicators: ["provisions", "credit losses", "mortgage", "renewal"], horizon: "5+ years", conviction: 4 }],
    ["CNQ.TO", 400, 42, "Taxable", { why: "Long-life, low-decline oil sands assets fund buybacks and dividends.", expect: "Returns above 10% with WTI above $65.",
                                    wrong_if: "Oil below $55 for a year or production caps.", indicators: ["oil", "emissions cap", "opec"], horizon: "3+ years", conviction: 3 }],
    ["NVDA", 90, 110, "RRSP", { why: "Default platform for AI compute; CUDA and networking moat.", expect: "Data-centre revenue compounds while hyperscalers expand capex.",
                               wrong_if: "Hyperscaler capex falls, custom chips take share, export controls bite.",
                               indicators: ["capex", "data center", "export controls", "custom chips"], horizon: "2-4 years", conviction: 4 }],
    ["AAPL", 60, 180, "Taxable", { why: "2B+ device installed base monetised through services.", expect: "Services growth offsets flat hardware.",
                                  wrong_if: "App Store fees forced down or China sales keep shrinking.", indicators: ["app store", "services", "china"], horizon: "5 years", conviction: 3 }],
    ["TSM", 70, 150, "RRSP", { why: "Sole supplier at the leading edge for AI accelerators.", expect: "Advanced-node share keeps rising.",
                              wrong_if: "Escalation around Taiwan or margin dilution from overseas fabs.", indicators: ["taiwan", "margins", "arizona"], horizon: "3-5 years", conviction: 3 }],
    ["XEQT.TO", 800, 30, "TFSA", { why: "Core global equity at low cost.", expect: "Market returns.", wrong_if: "N/A: core holding.", indicators: [], horizon: "20+ years", conviction: 5 }],
    ["AC.TO", 300, 18, "Taxable", { why: "Travel recovery and fleet renewal; cheap vs earnings.", expect: "Re-rating as margins normalise.", wrong_if: "Fuel costs spike or travel demand weakens.",
                                   indicators: ["fuel", "jet fuel", "strike", "hormuz"], horizon: "1-2 years", conviction: 2 }],
    ["BRK-B", 30, 400, "Taxable", null], ["MSFT", 25, 380, "RRSP", null], ["ENB.TO", 300, 50, "TFSA", null],
  ];
  for (const [t, q, c, a, th] of H) {
    const d = { ticker: t, quantity: q, cost: c, account: a };
    if (t === "AC.TO") { d.sector = "Airlines"; d.deps = ["Jet fuel prices", "Consumer travel demand"]; }
    if (t === "XEQT.TO") d.sector = "Global Equity (broad)";
    if (th) d.thesis = th;
    if (t === "SHOP.TO") d.catalysts = [{ date: iso(33), title: "Q3 results (demo date)" }];
    add("holding", d, 200);
  }
  add("holding", { ticker: "CASH", name: "High-interest savings", quantity: 15000, currency: "CAD", account: "Cash" });
  for (const [t, r] of [["ASML", "Lithography monopoly; wait for a better entry"], ["COST", "Quality compounder, expensive"], ["BN.TO", "Private markets if rates fall"]]) {
    add("watch", { ticker: t, reason: r });
  }
  const C = [
    ["Maya Okafor", "Partner", "Northstar Ventures", "Venture capital", "Toronto", 5, 4, 3, "MBA classmate", ["founder", "investor"], ["climate", "fintech", "running"], iso(5).slice(5), 12],
    ["Daniel Reyes", "Head of Product", "Shopify", "Technology", "Ottawa", 4, 3, 2, "Collision 2024", ["product"], ["commerce", "design"], iso(13).slice(5), 40],
    ["Priya Raman", "Principal", "Sequoia Capital", "Venture capital", "San Francisco", 3, 4, 4, "Intro from Maya", ["investor"], ["AI", "developer tools"], null, 75],
    ["Tom Becker", "Engagement Manager", "McKinsey & Company", "Consulting", "New York", 3, 3, 2, "Case competition judge", ["consultant"], ["healthcare"], null, 120],
    ["Lena Fischer", "Founder & CEO", "Kiln Robotics", "Robotics", "Montreal", 4, 2, 1, "First company", ["founder", "startup", "engineer"], ["robotics"], null, 20],
    ["Omar Haddad", "Portfolio Manager", "Brookfield", "Asset management", "Toronto", 3, 4, 3, "Family friend", ["investor", "finance"], ["infrastructure"], null, 200],
    ["Grace Liu", "Senior Engineer", "NVIDIA", "Semiconductors", "Santa Clara", 2, 2, 1, "Roommate's sister", ["engineer"], ["AI"], null, 400],
    ["Samuel Adeyemi", "Associate", "a16z", "Venture capital", "New York", 3, 3, 3, "Podcast swap", ["investor", "vc"], ["crypto"], null, 30],
    ["Isabelle Martin", "Director, Strategy", "Royal Bank of Canada", "Banking", "Toronto", 4, 3, 2, "MBA classmate", ["finance"], ["tennis"], iso(9).slice(5), 15],
    ["Sofia Alvarez", "Mentor; former COO", "Wealthsimple", "Fintech", "Toronto", 5, 4, 3, "Early employee at her company", ["operator", "founder"], ["fintech"], iso(21).slice(5), 8],
    ["Hannah Cho", "Product Lead", "Anthropic", "AI", "San Francisco", 3, 3, 3, "Hackathon teammate", ["product", "ai"], ["AI safety"], null, 55],
    ["Rahul Mehta", "Analyst", "Pershing Square", "Hedge fund", "New York", 2, 2, 2, "Investment club", ["investor"], ["value investing"], null, 310],
  ];
  const ids = [];
  C.forEach((c, i) => {
    const id = "con_demo" + String(i).padStart(3, "0");
    ids.push(id);
    const [name, role, org, industry, city, closeness, influence, prominence, how_met, experience, interests, birthday, last] = c;
    add("contact", { name, role, org, industry, city, closeness, influence, prominence, how_met, experience, interests, birthday,
      interactions: [{ date: iso(-last), type: last % 2 ? "coffee" : "call", notes: "Caught up on work and plans." }], notes: "" }, 0, id);
  });
  const byName = (n) => ids[C.findIndex((c) => c[0] === n)];
  const patch = (n, p) => Object.assign(recs.find((r) => r.id === byName(n)).data, p);
  patch("Maya Okafor", { notes: "Invests seed-stage climate and fintech. Offered intros to her LPs and to Priya at Sequoia.",
    connections: [{ id: byName("Priya Raman"), verified: true }, { id: byName("Isabelle Martin"), verified: true }, { id: byName("Omar Haddad"), verified: false }],
    commitments: [{ text: "Send her my thesis memo on Canadian fintech", due: iso(-4), made: iso(-20) }] });
  patch("Priya Raman", { introduced_by: byName("Maya Okafor"), connections: [{ id: byName("Samuel Adeyemi"), verified: true }, { id: byName("Hannah Cho"), verified: false }],
    commitments: [{ text: "Share three Canadian AI startups worth meeting", due: iso(6), made: iso(-10) }] });
  patch("Lena Fischer", { notes: "Raising a Series A in Q1; asked me to review her deck.", commitments: [{ text: "Feedback on Series A deck", due: iso(3), made: iso(-6) }] });
  patch("Sofia Alvarez", { commitments: [{ text: "Update her on the job search", due: iso(10), made: iso(-30) }] });
  const E = [
    { title: "Coffee with Maya Okafor", start: at(1, 10), end: at(1, 11), category: "professional", people: [byName("Maya Okafor")], location: "Toronto" },
    { title: "Portfolio review block", start: at(1, 14), end: at(1, 15, 30), category: "financial" },
    { title: "Call with Priya Raman (Sequoia)", start: at(3, 13), end: at(3, 13, 45), category: "professional", people: [byName("Priya Raman")] },
    { title: "Dentist", start: at(3, 13, 30), end: at(3, 14, 30), category: "personal" },
    { title: "Trip to New York", start: iso(8), end: iso(11), all_day: true, category: "travel", location: "New York" },
    { title: "Isabelle & Luc's wedding", start: iso(22), all_day: true, category: "personal", people: [byName("Isabelle Martin")], importance: 3 },
    { title: "Run club", start: at(-6, 7), end: at(-6, 8), category: "personal", recur: "weekly" },
  ];
  E.forEach((e) => add("event", e));
  add("decision", { title: "Buy NVIDIA at ~US$110", category: "investment", date: iso(-200), ticker: "NVDA", price_at_decision: 110,
    decision: "Buy 90 shares of NVDA in the RRSP.", rationale: "AI compute demand is early; CUDA lock-in slows share loss to custom chips.",
    assumptions: [{ text: "Hyperscaler capex keeps growing through next year", confidence: 70 }, { text: "Custom chips stay below 20% of accelerator spend", confidence: 60 },
                  { text: "Export controls don't cut revenue by more than 10%", confidence: 55 }],
    alternatives: "Buy TSM instead; buy SMH ETF.", expectations: "Outperform the Nasdaq over 2 years.", review_date: iso(-5) }, 200);
  add("plan", { title: "Buy a home in Toronto", template: "Buy a home", horizon: "2027" });
  add("plan", { title: "Land a venture or product role", template: "Job search in venture, tech or finance", horizon: "next 6 months" });
  add("plan", { title: "New York trip spending", template: "Travel to the US or abroad (spending in foreign currency)", horizon: "2 weeks" });
  for (const [name, cik] of [["Berkshire Hathaway", 1067983], ["Pershing Square", 1336528], ["Himalaya Capital", 1709323]]) add("investor", { name, cik });
  add("scenario", { name: "Hormuz stays shut", inputs: { oil: 40, inflation: 1, rates: 50, market: -8 }, note: "Revisit weekly while transits stay near zero." });
  add("note", { title: "Why I'm overweight Canada", text: "Home bias is partly deliberate: CAD liabilities (future home).", tags: ["portfolio"] });
  const settings = { base_currency: "CAD", interests: ["AI", "venture capital", "semiconductors", "Canadian housing", "Shopify"],
    max_position: 0.15, max_sector: 0.35, benchmark: [{ ticker: "^GSPC", w: 0.6 }, { ticker: "^GSPTSE", w: 0.4 }] };
  return { records: recs, settings };
}
