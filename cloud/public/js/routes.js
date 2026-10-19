/* Local API routes: each view asks for a URL; the answer is computed here from synced data. */
"use strict";
(function () {
  const H = V.handle, E = V.engine, I = V.intel, K = V.kb;
  const S = () => V.store;
  const DAY = 86400, now = () => Date.now() / 1000;
  const SEC_UA_NOTE = "SEC EDGAR via Vantage (polite, cached)";

  // ------------------------------------------------------------------ SEC helpers (browser parses; Worker proxies)
  const sec = {
    async tickers() {
      const d = await S().px("https://www.sec.gov/files/company_tickers.json", { ttl: 7 * DAY });
      const m = {}; for (const v of Object.values(d)) m[v.ticker.toUpperCase()] = { cik: v.cik_str, title: v.title };
      if (!I._secNames) I._secNames = new Set(Object.values(d).map((v) => I.companyKey(v.title)));
      return m;
    },
    async submissions(cik, ttl = 12 * 3600) { return S().px(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { ttl }); },
    url: (cik, acc, doc = "") => `https://www.sec.gov/Archives/edgar/data/${+cik}/${acc.replace(/-/g, "")}/${doc}`,
    async company(ticker) {
      const t = ticker.toUpperCase().replace(/\./g, "-");
      if (/\.(TO|V|NE|AS|PA)$/.test(ticker.toUpperCase()) || t === "CASH" || t.startsWith("^")) return null;
      const m = (await sec.tickers())[t];
      if (!m) return null;
      const d = await sec.submissions(m.cik);
      const r = d.filings.recent, rows = [];
      const ITEMS = { "1.01": "Material agreement", "1.03": "Bankruptcy", "2.01": "Acquisition/disposal", "2.02": "Earnings release", "2.05": "Restructuring", "2.06": "Impairment", "4.02": "Non-reliance on financials", "5.02": "Executive change", "5.07": "Shareholder vote", "7.01": "Reg FD disclosure", "8.01": "Other events" };
      const FORMS = new Set(["8-K", "10-Q", "10-K", "6-K", "20-F", "40-F", "DEF 14A", "S-1", "SC 13D", "SC 13D/A", "10-K/A"]);
      let insider = 0; const cutoff = V.iso(new Date(Date.now() - 90 * DAY * 1000));
      for (let i = 0; i < r.form.length; i++) {
        if (r.form[i] === "4" && r.filingDate[i] >= cutoff) insider++;
        if (FORMS.has(r.form[i]) && rows.length < 25) {
          const items = (r.items && r.items[i] ? r.items[i] : "").split(",").map((x) => x.trim()).filter(Boolean);
          rows.push({ form: r.form[i], filed: r.filingDate[i], period: r.reportDate[i], labels: items.map((x) => ITEMS[x]).filter(Boolean), desc: r.primaryDocDescription ? r.primaryDocDescription[i] : "", url: sec.url(m.cik, r.accessionNumber[i], r.primaryDocument[i]) });
        }
      }
      const out = { cik: m.cik, name: d.name, filings: rows, insider_form4_90d: insider, earnings_dates: rows.filter((f) => f.form === "8-K" && f.labels.includes("Earnings release")).map((f) => f.filed) };
      I._filings = I._filings || {}; I._filings[ticker.toUpperCase()] = out;
      return out;
    },
    async infotable(cik, acc) {
      const idx = await S().px(sec.url(cik, acc, "index.json"), { ttl: 365 * DAY });
      const files = idx.directory.item.map((i) => i.name).filter((n) => /\.xml$/i.test(n) && n.toLowerCase() !== "primary_doc.xml");
      if (!files.length) throw new Error("no information table");
      const xml = await S().px(sec.url(cik, acc, files[0]), { ttl: 365 * DAY, type: "text" });
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const agg = {};
      for (const el of doc.getElementsByTagNameNS("*", "infoTable")) {
        const g = (tag) => { const x = el.getElementsByTagNameNS("*", tag)[0]; return x ? x.textContent.trim() : ""; };
        const k = g("cusip") + "|" + g("putCall");
        const row = (agg[k] = agg[k] || { issuer: g("nameOfIssuer"), cls: g("titleOfClass"), cusip: g("cusip"), put_call: g("putCall") || null, value: 0, shares: 0 });
        row.value += +g("value") || 0; row.shares += +g("sshPrnamt") || 0;
      }
      return Object.values(agg).sort((a, b) => b.value - a.value);
    },
    async thirteenF(cik) {
      const d = await sec.submissions(cik);
      const r = d.filings.recent, hr = [];
      for (let i = 0; i < r.form.length; i++) if (r.form[i] === "13F-HR") hr.push({ acc: r.accessionNumber[i], filed: r.filingDate[i], period: r.reportDate[i] });
      if (!hr.length) return { cik, name: d.name, error: "No 13F-HR filings for this CIK." };
      const cur = await sec.infotable(cik, hr[0].acc), prev = hr[1] ? await sec.infotable(cik, hr[1].acc) : [];
      const pm = new Map(prev.map((x) => [x.cusip + "|" + x.put_call, x])), cm = new Map(cur.map((x) => [x.cusip + "|" + x.put_call, x]));
      const total = cur.reduce((a, x) => a + x.value, 0) || 1, changes = [];
      for (const [k, x] of cm) {
        const p = pm.get(k);
        let kind = "new", delta = null;
        if (p) { if (!p.shares) continue; delta = (x.shares - p.shares) / p.shares; kind = Math.abs(delta) < 0.02 ? "unchanged" : delta > 0 ? "increased" : "reduced"; }
        changes.push(Object.assign({}, x, { change: kind, share_delta: delta, weight: x.value / total, prev_value: p ? p.value : 0 }));
      }
      for (const [k, p] of pm) if (!cm.has(k)) changes.push(Object.assign({}, p, { change: "exited", share_delta: -1, weight: 0, shares: 0, value: 0, prev_value: p.value }));
      return { cik, name: d.name, current: hr[0], previous: hr[1] || null, total_value: total, positions: cur.length, changes, url: sec.url(cik, hr[0].acc), history: hr.slice(0, 8), fetched: now() };
    },
    // A fund's holdings come from its latest N-PORT report. The trust (cik) files one per series each quarter;
    // the 2 KB SGML header of each filing names its series, so the matching one is found without the
    // throttled legacy browse-edgar search. Headers are cached for good (filings never change), requests are
    // paced well under SEC's 10-per-second limit, and the filing's position is remembered for next quarter.
    async fundFiling(series, cik) {
      const r = (await sec.submissions(cik)).filings.recent, np = [];
      for (let i = 0; i < r.form.length; i++) if (r.form[i] === "NPORT-P") np.push({ acc: r.accessionNumber[i], filed: r.filingDate[i], period: r.reportDate[i] });
      const hintKey = "fundhint:" + series, hint = (await S().idb.get(hintKey)) || {};
      for (const p of [...new Set(np.map((x) => x.period))].sort().reverse().slice(0, 2)) {
        const batch = np.filter((x) => x.period === p);
        const known = batch.find((x) => x.acc === hint.acc);
        if (known) return Object.assign({ name: hint.name }, known);
        const order = batch.map((x, i) => [i, x]).sort((a, b) => (hint.pos == null ? 0 : Math.abs(a[0] - hint.pos) - Math.abs(b[0] - hint.pos)));
        for (const [i, x] of order) {
          const h = await S().px(sec.url(cik, x.acc, x.acc + ".hdr.sgml"), { ttl: 365 * DAY, type: "text" });
          if (h.includes("<SERIES-ID>" + series + "\n") || h.includes("<SERIES-ID>" + series + "\r")) {
            const name = ((h.match(/<SERIES-ID>S\d+\s*<SERIES-NAME>([^\n<]+)/) || h.match(/<SERIES-NAME>([^\n<]+)/) || [])[1] || "").trim();
            S().idb.set(hintKey, { acc: x.acc, pos: i, name });
            return Object.assign({ name }, x);
          }
          await new Promise((res) => setTimeout(res, 260));
        }
      }
      return null;
    },
    async fund(series, cik) {
      let xmlUrl = null, filed = null, name = null;
      if (cik) { const f = await sec.fundFiling(series, cik); if (f) { xmlUrl = sec.url(cik, f.acc, "primary_doc.xml"); filed = f.filed; name = f.name; } }
      if (!xmlUrl) { // no trust CIK on record: fall back to the legacy series search
        const atom = await S().px(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${series}&type=NPORT-P&dateb=&owner=include&count=5&output=atom`, { ttl: 7 * DAY, type: "text" });
        const href = (atom.match(/<filing-href>(.*?)<\/filing-href>/) || [])[1]; filed = (atom.match(/<filing-date>(.*?)<\/filing-date>/) || [])[1];
        if (!href) throw new Error("No N-PORT filings found");
        const idx = await S().px(href, { ttl: 30 * DAY, type: "text" });
        const xmlPath = (idx.match(/href="(\/Archives\/edgar\/data\/[^"]+primary_doc\.xml)"/) || [])[1];
        if (!xmlPath) throw new Error("N-PORT document not found");
        xmlUrl = "https://www.sec.gov" + xmlPath;
      }
      const xml = await S().px(xmlUrl, { ttl: 30 * DAY, type: "text" });
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const g = (el, tag) => { const x = el.getElementsByTagNameNS("*", tag)[0]; return x ? x.textContent.trim() : ""; };
      const holdings = [...doc.getElementsByTagNameNS("*", "invstOrSec")].map((el) => ({ name: g(el, "name"), title: g(el, "title"), cusip: g(el, "cusip"), pct: +g(el, "pctVal") / 100, value: +g(el, "valUSD") })).filter((x) => x.pct > 0).sort((a, b) => b.pct - a.pct);
      return { series, name, filed, period: (xml.match(/<repPdDate>(.*?)<\/repPdDate>/) || [])[1], holdings, url: xmlUrl };
    },
  };
  I.sec = sec;
  // SEC answers 403 to requests without a real contact email in the User-Agent (their fair-access policy)
  const secErr = (e) => {
    const m = String((e && e.message) || e);
    if (!/HTTP 403/.test(m)) return m;
    return (V.state.sec || S().settings.sec_contact || (V.state.settings || {}).sec_contact)
      ? "SEC is limiting requests from this address right now; it usually clears within about 10 minutes."
      : "SEC only answers requests that declare a contact email. Add yours in Settings → Integrations → SEC EDGAR contact (it is sent only to sec.gov, as SEC requires).";
  };
  I.secErr = secErr;

  // ------------------------------------------------------------------ onboarding & status
  function onboarding() {
    const st = S();
    const steps = [["holdings", "Add or import your holdings", st.records.holding.length > 0], ["thesis", "Write a thesis for your largest position", st.records.holding.some((h) => h.thesis && h.thesis.why)],
      ["contacts", "Import contacts", st.records.contact.length > 0], ["rate", "Rate your inner circle (Network → Rate people)", st.records.contact.some((c) => c.closeness)],
      ["calendar", "Subscribe your calendar (ICS link) or add events", st.records.ics_sub.length > 0 || st.records.event.length > 0],
      ["investors", "Follow investors' 13F filings", st.records.investor.length > 0], ["sec", "Add your email for SEC requests", !!(V.state.sec || (V.state.settings && V.state.settings.sec_contact))],
      ["ai", "Connect Claude (optional)", !!(V.state.ai && V.state.ai.ok)], ["mfa", "Turn on two-factor authentication", !!V.state.mfa]];
    return steps.map(([id, label, done]) => ({ id, label, done }));
  }
  function sources() {
    const st = S(), jobs = Object.fromEntries(st.jobs.map((j) => [j.name, j]));
    const news = Object.values(jobs).filter((j) => j.name.startsWith("news:"));
    return { news: { last_ok: Math.max(0, ...news.map((j) => j.last_ok || 0)), feeds_ok: news.filter((j) => !j.last_error).length, feeds_err: news.filter((j) => j.last_error).map((j) => j.name.slice(5)) },
      quotes: jobs.quotes || {}, boc: jobs.boc || {}, sec: jobs.sec || {}, engine: st.engine };
  }

  // ------------------------------------------------------------------ routes
  H("GET", "/api/home", () => {
    const port = E.portfolio(), st = S(), today = V.today();
    const cal = I.calendar(today, new Date(today.getTime() + 2 * DAY * 1000));
    const wk = I.weekAhead(), mem = I.memory(), stories = I.stories(30, 14, port);
    const tISO = V.iso(today);
    return {
      space: st.space, since: I.since(port), priorities: I.priorities(), macro: I.macro(),
      stories: stories.map((s, i) => (i < 8 ? Object.assign(s, { analysis: I.analyzeStory(s, port) }) : s)),
      portfolio: Object.assign({}, port, { movers: port.holdings.filter((r) => r.returns["1d"]).map((r) => ({ ticker: r.ticker || r.name, d1: r.returns["1d"].base, weight: r.weight, id: r.id })).sort((a, b) => Math.abs(b.d1) - Math.abs(a.d1)).slice(0, 6), hidden: port.hidden.slice(0, 2) }),
      today: cal.filter((e) => e.start.slice(0, 10) === tISO), tomorrow: cal.filter((e) => e.start.slice(0, 10) !== tISO).slice(0, 8),
      week: { busiest: wk.busiest, conflicts: wk.conflicts, prep: wk.prep.slice(0, 6), market: wk.market.slice(0, 6), days: wk.days.map((d) => ({ date: d.date, load: d.load, n: d.events.length, hours: d.hours })) },
      people: { lost_touch: mem.lost_touch.slice(0, 5), promises: mem.promises.slice(0, 5), milestones: mem.milestones.slice(0, 6), reasons: mem.reasons.slice(0, 4) },
      radar: st.alerts.slice(0, 8), second_look: st.alerts.filter((a) => a.kind === "second_look").slice(0, 4), world: I.world().slice(0, 4),
      sources: sources(), ai: V.state.ai, onboarding: st.space === "live" ? onboarding() : null,
    };
  });
  H("GET", "/api/briefing", ({ q }) => {
    const port = E.portfolio();
    let st = I.stories(Math.min(168, +(q.hours || 36)), 60, port);
    if (q.topic && q.topic !== "all") st = st.filter((s) => s.topic === q.topic);
    return { stories: st.map((s) => Object.assign(s, { analysis: I.analyzeStory(s, port), ai: (V.cache.ai || {})[s.id] })), macro: I.macro(), topics: ["geopolitics", "conflict", "macro", "markets", "business", "technology"], sources: sources() };
  });
  H("POST", "/api/seen", async ({ body }) => { for (const k of body.keys || []) S().seen.add(k); return V.net("/api/seen", { body }); });
  H("POST", "/api/visit", ({ body }) => V.net("/api/visit", { body: { value: (E._port || E.portfolio()).total } }));
  const findStory = (sid) => { const s = I.stories(168, 500).find((x) => x.id === sid); if (!s) throw new Error("Story no longer in the feed window"); return s; };
  H("POST", "/api/story/([\\w-]+)/ai", async (_, sid) => {
    const s = findStory(sid), port = E._port;
    const summ = { base: port.base, holdings: port.holdings.slice(0, 22).map((r) => ({ ticker: r.ticker, sector: r.sector, weight: +r.weight.toFixed(3), thesis: (r.thesis || {}).why })), plans: S().records.plan.map((p) => p.title) };
    const src = s.sources.map((x, i) => ({ n: i + 1, source: x.source, title: x.title, published: x.published }));
    const r = await V.net("/api/ai", { body: { json: true, effort: "medium", prompt: `Story cluster (reported facts): ${JSON.stringify({ title: s.title, summary: s.summary, sources: src })}\n\nMy portfolio (calculated): ${JSON.stringify(summ)}\nMy interests: ${JSON.stringify(S().settings.interests || [])}\n\nExplain in five parts. JSON keys: "happened" (2-3 sentences citing [src:n]), "matters", "people", "business", "markets", "mine" (name my holdings/plans or say no clear link), "watch" (3-5 items), "competing", "confidence".` } });
    const m = r.text.match(/\{[\s\S]*\}/); if (!m) throw new Error("The model did not return JSON.");
    const res = Object.assign(JSON.parse(m[0]), { model: r.model, ts: now() });
    (V.cache.ai = V.cache.ai || {})[sid] = res;
    return res;
  });
  H("POST", "/api/impact", ({ body }) => {
    E.portfolio();
    if (body.hotspot) { const h = K.HOTSPOTS.find((x) => x.id === body.hotspot); return E.impactMap(h.name + ": " + h.why.split(".")[0], h.why, null, h.impulse); }
    if (body.story_id) { const s = findStory(body.story_id); return E.impactMap(s.title, (s.summary || "") + " " + s.sources.slice(0, 5).map((x) => x.title).join(" "), s.id); }
    return E.impactMap(body.title || "", body.text || "", null);
  });
  H("POST", "/api/impact/ai", async ({ body }) => {
    const m = E.impactMap(body.title || "", body.text || "", body.story_id);
    const story = body.story_id ? findStory(body.story_id) : { title: m.title };
    const port = E._port;
    const r = await V.net("/api/ai", { body: { json: true, effort: "high", prompt: `Event: ${JSON.stringify({ title: story.title, summary: story.summary, sources: (story.sources || []).map((x, i) => ({ n: i + 1, source: x.source, title: x.title })) })}\nBuilt-in consequence map: ${JSON.stringify({ drivers: m.nodes.filter((n) => n.kind === "driver").map((n) => n.label), links: m.edges.slice(0, 40).map((e) => [e.from, e.to, e.sign]) })}\nMy holdings: ${JSON.stringify(port.holdings.slice(0, 25).map((r) => [r.ticker, r.sector, +r.weight.toFixed(3)]))}\n\nImprove the map for this event. JSON: {"edges":[{"from","to","sign","logic","evidence","uncertainty","horizon","offsets","threshold"}],"competing":"...","summary":"2 sentences on net effect on my holdings"}. Max 12 edges.` } });
    const mm = r.text.match(/\{[\s\S]*\}/); if (!mm) throw new Error("The model did not return JSON.");
    return Object.assign(JSON.parse(mm[0]), { model: r.model });
  });

  H("GET", "/api/portfolio", () => {
    const p = E.portfolio(), st = S();
    p.watch = st.records.watch.map((w) => { const q = st.quote(w.ticker), h = st.hist(w.ticker); return Object.assign({}, w, q ? { price: q.p, currency: q.c, name: w.name || q.n, d1: q.pc ? q.p / q.pc - 1 : null, y1: h && h.length ? q.p / (E.closeOn(h, now() - 365 * DAY) || h[0][1]) - 1 : null } : {}); });
    p.risk_change = I.riskChange();
    p.sectors_available = Object.keys(K.SECTORS).sort();
    p.factors = Object.fromEntries(Object.entries(K.FACTORS).map(([k, v]) => [k, { label: v[0], desc: v[1] }]));
    return p;
  });
  H("GET", "/api/analytics", () => { const a = E.analytics(); return Object.assign(a, { port: E._port }); });
  H("GET", "/api/holding/([\\w-]+)", async (_, hid) => {
    const st = S(), rec = st.records.holding.find((h) => h.id === hid);
    if (!rec) throw new Error("Holding not found");
    const port = E.portfolio(), row = port.holdings.find((r) => r.id === hid);
    const t = (rec.ticker || "").toUpperCase();
    if (t && t !== "CASH") await st.ensure(["h:" + t, "q:" + t]);
    let filings = null, note = null;
    if (/\.(TO|V|NE)$/.test(t)) note = "Canadian issuers file on SEDAR+, which has no free API. Add catalysts manually.";
    else if (t && t !== "CASH" && !rec.fund) { try { filings = await sec.company(t); } catch (e) { filings = { error: secErr(e) }; } }
    const ents = I.entities(port).filter((e) => e.kind === "holding" && e.id === hid);
    const news = ents.length ? st.news.filter((n) => I.mentions(n.title + " " + (n.summary || ""), ents).length).slice(0, 14) : [];
    const fm = E.factorModel(), fit = fm.rows.find((r) => r.id === hid);
    const revs = (await V.net(`/api/r/holding/${hid}/revisions`)).revisions;
    return { record: rec, row, series: st.hist(t), quote: st.quote(t) || {}, filings, filings_note: note, news, alerts: st.alerts.filter((a) => ((a.body || {}).ref || {}).id === hid),
      revisions: revs, factors: Object.fromEntries(Object.entries(K.FACTORS).map(([k, v]) => [k, v[0]])), sectors: Object.keys(K.SECTORS).sort(), fit, stat: E.FACTORS_STAT };
  });
  H("GET", "/api/fund/([\\w]+)", async (_, series) => {
    const rec = S().records.holding.find((h) => h.fund && h.fund.series === series);
    let f; try { f = await sec.fund(series, rec && rec.fund.cik); } catch (e) { throw new Error(secErr(e)); }
    const port = E._port || E.portfolio();
    const held = new Map(port.holdings.map((r) => [I.companyKey(r.name).split(" ")[0], r]));
    for (const x of f.holdings) { const k = I.companyKey(x.name).split(" ")[0]; const r = held.get(k); if (r && k.length >= 4) x.overlap = { ticker: r.ticker, id: r.id, weight: r.weight }; }
    return f;
  });
  H("POST", "/api/holding/([\\w-]+)/assess", async ({ body }, hid) => {
    const rec = S().records.holding.find((h) => h.id === hid), a = S().alerts.find((x) => x.id === body.alert);
    if (!rec || !a) throw new Error("Not found");
    const r = await V.net("/api/ai", { body: { json: true, effort: "high", prompt: `Holding: ${rec.ticker}\nMy recorded thesis: ${JSON.stringify(rec.thesis)}\nNew information (reported): ${JSON.stringify({ headline: a.body.latest, link: a.body.link })}\n\nDoes it support, weaken or not change my thesis? JSON: {"verdict":"supports|weakens|no change|unclear","reason":"...","what_changed":"You bought this partly because X. The latest information indicates Y.","what_to_check":["..."],"confidence":"low|medium|high"}` } });
    const m = r.text.match(/\{[\s\S]*\}/); if (!m) throw new Error("The model did not return JSON.");
    const res = JSON.parse(m[0]);
    a.body.ai = Object.assign(res, { model: r.model, ts: now() });
    a.body.assessment = `${(res.verdict || "?").toUpperCase()} (Claude, ${res.confidence || "?"} confidence): ${res.reason || ""}`;
    await V.net("/api/alerts/upsert", { body: { alerts: [{ key: a.key, kind: a.kind, title: a.title, body: a.body, relevance: a.relevance, impact: a.impact, urgency: a.urgency, confidence: a.confidence, group_key: a.group_key }] } });
    return a.body;
  });

  // ------------------------------------------------------------------ imports
  const SYMBOL_MAP = { CVX: "CVX.NE", LVMH: "LVMH.NE", "NET.UN": "NET-UN.V", "PLZ.UN": "PLZ-UN.TO", LMN: "LMN.V", P049485: "PRX.AS" };
  const USD_IN_CAD = new Set(["SNOW", "TSLA", "AMZN", "PLTR", "GOOG", "GOOGL", "NVDA", "AMD", "AAPL", "MSFT", "META"]);
  function csvRows(text) {
    const out = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; } else cell += c;
    }
    if (cell || row.length) { row.push(cell); out.push(row); }
    return out;
  }
  const num = (s) => { if (s == null) return null; s = String(s).replace(/[,$%]/g, "").trim(); if (!s || s === "N/A" || s === "-") return null; const v = +s; return isFinite(v) ? v : null; };
  async function resolveTicker(sym, name, ccy) {
    if (SYMBOL_MAP[sym]) return SYMBOL_MAP[sym];
    const cands = [];
    const root = sym.replace(/\.UN$/, "-UN").replace(/\./g, "-");
    if (/CDR/i.test(name || "")) cands.push(root + ".NE");
    cands.push(sym.replace(/\./g, "-"));
    if (ccy === "CAD") cands.push(root + ".TO", root + ".V", root + ".NE");
    for (const c of [...new Set(cands)]) {
      try { const d = await S().px(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(c)}?range=5d&interval=1d`, { ttl: DAY }); if (d.chart && d.chart.result) return c; } catch (e) { /* next */ }
    }
    return sym;
  }
  async function parseRbc(text) {
    const acct = text.match(/Account:\s*(\d+)\s*-\s*([A-Za-z ]+)/), asofM = text.match(/as of ([A-Za-z]{3} \d{1,2}, \d{4})/);
    const accountNo = acct ? acct[1].slice(-4) : "", account = acct ? acct[2].trim() : "Imported";
    const asof = asofM ? V.iso(new Date(asofM[1])) : null;
    const rows = csvRows(text), out = [];
    const hi = rows.findIndex((r) => r[1] === "Product" && r[2] === "Symbol");
    const ci = rows.findIndex((r) => r[0] === "Currency" && r[1] === "Cash");
    if (ci >= 0) for (const r of rows.slice(ci + 1, ci + 4)) if (["CAD", "USD"].includes(r[0]) && num(r[1])) out.push({ ticker: "CASH", name: `Cash (${r[0]})`, quantity: num(r[1]), currency: r[0], account, account_no: accountNo, source: "RBC export " + asof, _match: "CASH" + r[0] });
    if (hi < 0) return { account, accountNo, asof, holdings: out };
    const head = rows[hi];
    const col = (r, name) => r[head.indexOf(name)];
    for (const r of rows.slice(hi + 1)) {
      if (!r[2] || r.length < 10) { if (!r.join("").trim()) break; continue; }
      const sym = r[2].trim(), name = col(r, "Name"), ccy = col(r, "Currency");
      const ticker = await resolveTicker(sym, name, ccy);
      const rec = { ticker, quantity: num(col(r, "Quantity")), account, account_no: accountNo, broker_symbol: sym, broker_name: (name || "").replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
        broker_price: num(col(r, "Last Price")), broker_currency: ccy, broker_asof: asof, source: "RBC Direct Investing export " + asof, _match: sym };
      const book = num(col(r, "Total Book Cost")), avg = num(col(r, "Average Cost"));
      if (USD_IN_CAD.has(sym) && ccy === "CAD") rec.cost_base_total = book;
      else if (sym !== "P049485") { rec.cost = avg; if (ccy === "CAD") rec.cost_base_total = book; }
      const div = num(col(r, "Annual Dividend Amount $")), ex = col(r, "Dividend Ex Date");
      if (div && sym !== "NVDA") { rec.div_annual_broker = div; if (ex) { const d = new Date(ex); if (!isNaN(d)) rec.div_ex_date = V.iso(d); } }
      out.push(rec);
    }
    return { account, accountNo, asof, holdings: out };
  }
  H("POST", "/api/import/holdings", async ({ body }) => {
    const text = (body.csv || "").trim();
    const existing = S().records.holding;
    let parsed;
    if (/Holdings Export/.test(text) && /,Product,Symbol,/.test(text)) parsed = await parseRbc(text);
    else {
      const rows = csvRows(text).filter((r) => r.join("").trim());
      const head = rows[0].map((h) => h.trim().toLowerCase());
      const pick = (r, ...names) => { const i = head.findIndex((h) => names.some((n) => h === n || h.startsWith(n))); return i >= 0 ? r[i] : null; };
      parsed = { holdings: rows.slice(1).map((r) => {
        const q = num(pick(r, "quantity", "shares", "qty", "units")), t = (pick(r, "symbol", "ticker") || "").trim().toUpperCase();
        let cost = num(pick(r, "average cost", "avg cost", "cost per", "average price", "price paid", "acb per")); const total = num(pick(r, "book value", "book cost", "total cost", "cost basis", "acb"));
        if (cost == null && total != null && q) cost = total / q;
        return { ticker: t, quantity: q, cost, currency: (pick(r, "currency") || "").toUpperCase() || undefined, account: (pick(r, "account") || "").trim() || undefined, name: (pick(r, "name", "description", "security") || "").trim() || undefined, _match: t };
      }).filter((h) => h.ticker && h.quantity != null) };
    }
    const items = []; let added = 0, updated = 0;
    const seenIds = new Set();
    for (const h of parsed.holdings) {
      const match = existing.find((x) => (x.broker_symbol || x.ticker + (x.ticker === "CASH" ? x.currency : "")) === h._match && (x.account_no ? x.account_no === h.account_no : (x.account || "") === (h.account || "")));
      delete h._match;
      const clean = Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined && v !== null));
      if (match) { seenIds.add(match.id); items.push({ kind: "holding", id: match.id, data: Object.assign({}, match, clean) }); updated++; }
      else { items.push({ kind: "holding", data: clean }); added++; }
    }
    const gone = parsed.accountNo ? existing.filter((x) => x.account_no === parsed.accountNo && !seenIds.has(x.id)) : [];
    if (items.length) {
      for (const it of items) if (it.data) for (const k of Object.keys(it.data)) if (k.startsWith("_") || k === "id") delete it.data[k];
      await V.net("/api/bulk", { body: { items } });
      await S().boot(true);
    }
    return { added, updated, account: parsed.account, asof: parsed.asof, gone: gone.map((g) => ({ id: g.id, ticker: g.ticker })) };
  });
  H("POST", "/api/import/contacts", async ({ body }) => {
    const rows = csvRows((body.csv || "").replace(/^[\s\S]*?(?=(First Name|Name|Given Name|Prefix))/i, "")).filter((r) => r.join("").trim());
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const g = (r, ...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0 && (r[i] || "").trim()) return r[i].trim(); } return null; };
    const existing = new Set(S().records.contact.map((c) => (c.name || "").toLowerCase() + "|" + (c.phone || c.email || "")));
    const items = [];
    for (const r of rows.slice(1)) {
      const name = g(r, "name") || [g(r, "first name", "given name"), g(r, "middle name"), g(r, "last name", "family name")].filter(Boolean).join(" ") || g(r, "nickname");
      if (!name) continue;
      const phone = g(r, "mobile", "iphone", "phone 1 - value", "work", "home", "main", "other phone"), email = g(r, "email address", "e-mail 1 - value", "home email", "work email", "other email", "email");
      const key = name.toLowerCase() + "|" + (phone || email || "");
      if (existing.has(key)) continue; existing.add(key);
      let bday = g(r, "birthday"); if (bday && bday.startsWith("--")) bday = bday.slice(2);
      const org = g(r, "company", "organization", "organization 1 - name", "org");
      items.push({ kind: "contact", data: Object.fromEntries(Object.entries({ name, org, community: org, role: g(r, "position", "title", "organization 1 - title"), email, phone, birthday: bday, city: g(r, "city", "address 1 - city"), notes: g(r, "note", "notes") || "",
        linkedin: g(r, "url"), how_met: g(r, "connected on") ? "LinkedIn connection since " + g(r, "connected on") : null, source: "Contacts import " + V.iso(new Date()) }).filter(([, v]) => v)) });
    }
    for (let i = 0; i < items.length; i += 500) await V.net("/api/bulk", { body: { items: items.slice(i, i + 500) } });
    if (items.length) await S().boot(true);
    return { added: items.length, rows: rows.length - 1 };
  });

  // ------------------------------------------------------------------ scenario, filings, calendar, network, radar, journal, ask
  H("POST", "/api/scenario", ({ body }) => E.scenario(body.inputs || {}));
  H("GET", "/api/scenario/presets", () => ({ presets: E.PRESETS, factors: Object.fromEntries(Object.entries(K.FACTORS).map(([k, v]) => [k, v[0]])), holdings: S().records.holding.map((h) => ({ id: h.id, ticker: h.ticker || h.name })), saved: S().records.scenario }));
  H("GET", "/api/filings", async ({ q }) => {
    const port = E._port || E.portfolio();
    const held = new Map(port.holdings.map((r) => [I.companyKey(r.name), r.ticker]));
    const watch = new Set(S().records.watch.map((w) => I.companyKey(w.name || w.ticker)));
    const investors = [], pattern = {};
    for (const inv of S().records.investor) {
      let d;
      try { d = await sec.thirteenF(inv.cik); } catch (e) { d = { cik: inv.cik, name: inv.name, error: secErr(e) }; }
      d = Object.assign({ name: inv.name }, d, { record_id: inv.id });
      for (const ch of d.changes || []) {
        const k = I.companyKey(ch.issuer);
        ch.overlap = held.has(k) ? "holding" : [...held.keys()].some((h) => h.split(" ")[0].length >= 5 && k.startsWith(h.split(" ")[0])) ? "holding" : watch.has(k) ? "watchlist" : null;
        if (["new", "increased", "reduced", "exited"].includes(ch.change)) { const pk = ch.cusip + (ch.change === "new" || ch.change === "increased"); (pattern[pk] = pattern[pk] || { issuer: ch.issuer, who: [], buy: ch.change === "new" || ch.change === "increased" }).who.push(d.name); }
      }
      investors.push(d);
    }
    const company = [];
    for (const r of port.holdings.slice(0, 20)) { if (!r.ticker || r.fund) continue; try { const f = await sec.company(r.ticker); if (f) for (const x of f.filings.slice(0, 4)) company.push(Object.assign({ ticker: r.ticker }, x)); } catch (e) { /* skip */ } }
    company.sort((a, b) => (a.filed < b.filed ? 1 : -1));
    return { investors, patterns: Object.values(pattern).filter((p) => p.who.length >= 2).sort((a, b) => b.who.length - a.who.length).slice(0, 15), company: company.slice(0, 30),
      presets: [["Berkshire Hathaway", 1067983], ["Pershing Square", 1336528], ["Scion Asset Management", 1649339], ["Baupost Group", 1061768], ["Appaloosa", 1656456], ["Himalaya Capital", 1709323], ["Duquesne Family Office", 1536411], ["Bridgewater Associates", 1350694], ["Tiger Global", 1167483], ["Coatue Management", 1135730], ["Lone Pine Capital", 1061165], ["Third Point", 1040273], ["Greenlight Capital", 1079114], ["Viking Global", 1103804], ["Soros Fund Management", 1029160]].map(([name, cik]) => ({ name, cik })),
      sec_contact: !!(V.state.settings && V.state.settings.sec_contact),
      caveats: ["13F filings are due 45 days after quarter end, so holdings can be up to ~4.5 months old when you read them.", "They show long positions in US-listed equities and options only: no shorts, no cash, most non-US holdings excluded.", "Report period and filing date are shown separately. Treat changes as context, not a current trade signal.", "Overlap with your holdings is matched by issuer name and can miss share classes."] };
  });
  H("GET", "/api/calendar", async ({ q }) => {
    await I.icsEvents().catch(() => {});
    const start = V.parseDay(q.start || V.iso(new Date())), end = V.parseDay(q.end || V.iso(new Date(Date.now() + 42 * DAY * 1000)));
    return { events: I.calendar(start, end), subscriptions: S().records.ics_sub.map((s) => ({ id: s.id, name: s.name, error: s._status && !s._status.ok ? s._status.error : null, count: s._status ? s._status.count : 0, fetched: now() })), contacts: S().records.contact.filter((c) => c.closeness || S().records.contact.length < 400).map((c) => ({ id: c.id, name: c.name })) };
  });
  H("GET", "/api/week", () => I.weekAhead());
  H("GET", "/api/prep/(.+)", ({ }, eid) => { const b = I.prep(decodeURIComponent(eid)); if (!b) throw new Error("Event not found"); b.ai = (V.cache.prep || {})[eid]; return b; });
  H("POST", "/api/prep/(.+)/ai", async (_, eid) => {
    const b = I.prep(decodeURIComponent(eid));
    const r = await V.net("/api/ai", { body: { effort: "medium", prompt: `Prepare me for this event. Brief assembled from my records: ${JSON.stringify(b).slice(0, 40000)}\nReturn Markdown: **Objective**, **Talking points** (5 max, tied to records), **Questions to ask**, **Watch-outs**, **Missing information**.` } });
    const res = { text: r.text, model: r.model, ts: now() };
    (V.cache.prep = V.cache.prep || {})[eid] = res;
    return res;
  });
  H("GET", "/api/network", () => {
    const cs = S().records.contact.map((c) => Object.assign({}, c, { _last: (I.lastContact(c) || null) && V.iso(I.lastContact(c)), _next: (I.nextFollowup(c) || null) && V.iso(I.nextFollowup(c)), _cadence: I.cadence(c) }));
    return { contacts: cs, memory: I.memory() };
  });
  H("GET", "/api/who", ({ q }) => I.who(q.q || ""));
  H("POST", "/api/draft", async ({ body }) => {
    const base = I.draft(body.contact_id, body.purpose || "");
    if (!base) throw new Error("Contact not found");
    if (body.ai) {
      const c = S().records.contact.find((x) => x.id === body.contact_id);
      const r = await V.net("/api/ai", { body: { effort: "low", max_tokens: 2000, prompt: `Draft a short, warm, specific message from me to this contact. Contact: ${JSON.stringify({ name: c.name, role: c.role, org: c.org, city: c.city, interests: c.interests, notes: c.notes, how_met: c.how_met, interactions: c.interactions, commitments: c.commitments })}\nContext: ${JSON.stringify(base.basis)}\nPurpose: ${body.purpose || "reconnect"}\nPlain text, under 120 words, no clichés, no em dashes, sound like a real person. Don't invent shared history.` } });
      base.body = r.text; base.model = r.model;
    }
    return base;
  });
  H("GET", "/api/radar", async ({ q }) => {
    const r = await V.net("/api/alerts?status=" + (q.status || "open"));
    if ((q.status || "open") === "open") S().alerts = r.alerts;
    return Object.assign(r, { kinds: I.KIND_LABEL });
  });
  H("POST", "/api/radar/run", async () => ({ open: await I.autoRadar(true) }));
  H("POST", "/api/radar/([\\w]+)/feedback", async ({ body }, id) => V.net(`/api/alerts/${id}/feedback`, { body }));
  H("POST", "/api/radar/unmute", async () => V.net("/api/alerts/unmute", { body: {} }));
  H("GET", "/api/journal/([\\w-]+)/replay", async (_, id) => { const r = await I.replay(id); if (!r) throw new Error("Decision not found"); return r; });
  H("GET", "/api/search", ({ q }) => ({ results: I.search(q.q || "", 25) }));
  H("POST", "/api/ask", ({ body }) => I.ask((body.q || "").trim()));
  H("GET", "/api/ask/history", () => ({ history: S().settings.ask_history || [] }));
  H("POST", "/api/refresh", async ({ body }) => {
    const r = await V.net("/api/tick", { body: { jobs: body.jobs || null } });
    await S().refresh();
    E._fm = null; E.analytics();
    await I.autoRadar(true).catch(() => {});
    V.drawTape(); V.drawEngine();
    return r;
  });
  H("GET", "/api/world", () => ({ hotspots: I.world(), usgs: S().series.usgs, travel: S().series.travel }));
})();
