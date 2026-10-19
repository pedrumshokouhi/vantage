/* Briefing, calendar, relationships, radar, world status, chief of staff — computed in the browser
   from synced data, exposed as local API routes so views stay simple. */
"use strict";
(function () {
  const I = (V.intel = {});
  const K = V.kb, E = V.engine;
  const S = () => V.store;
  const DAY = 86400;
  const now = () => Date.now() / 1000;
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const CORP = /\b(inc|corp|corporation|co|ltd|limited|plc|group|holdings?|the|class [a-c]|common|shares|company|sa|se|ag|nv|n v|lp|trust|etf|index|fund|cdr|cad hedged|reg s|adr|sponsored)\b/g;
  I.companyKey = (name) => norm(name).replace(CORP, " ").replace(/\s+/g, " ").trim();
  const GENERIC = new Set("canadian american royal national first general united international global bank energy digital advanced applied natural resources financial capital group canada toronto new york pacific atlantic north south east west research".split(" "));
  const GENERIC_ORGS = new Set(["independent", "self employed", "freelance", "stealth", "retired", "none", "various", "lawyer", "friend", "family"]);
  // phone address books use the company field for notes ("Real Estate", "Physio", "Ontario"): words and places
  // like these are never treated as an organisation when looking for reasons to reconnect
  const NOT_ORG_WORDS = new Set(("real estate history manager teacher physio accountant lawyer trainer personal designer graphic babysitter band rock show tv videos youtube " +
    "class supplier suplier industry music family friend school university college hospital church gym restaurant bar club hotel student consultant consulting " +
    "sales marketing finance doctor dentist nurse driver neighbour neighbor voisin girl guy boy gf bf wife husband mom dad cousin uncle aunt boss coach tutor " +
    "canada ontario quebec montreal toronto vancouver ottawa calgary edmonton winnipeg halifax laval richmond dubai qatar london paris miami vegas guatemala mexico " +
    "new york usa us uk france europe asia africa").split(" "));
  const looksLikeOrg = (raw) => {
    const s = (raw || "").trim(), k = I.companyKey(s);
    if (k.length < 3 || GENERIC_ORGS.has(k) || !/^[A-Z0-9]/.test(s) || /[@#]|\p{Extended_Pictographic}/u.test(s) || s.split(/\s+/).length > 4) return false;
    return !k.split(" ").every((w) => NOT_ORG_WORDS.has(w));
  };
  const iso = (d) => V.iso(d);
  const parseDay = (s) => V.parseDay(s);

  // ------------------------------------------------------------------ entities & mentions
  function nameTerms(name) {
    const ck = I.companyKey(name);
    if (!ck || ck.length < 3) return new Set();
    const w = ck.split(" "), out = new Set(ck.length >= 4 ? [ck] : []);
    if (w.length > 1 && w[0].length >= 5 && !GENERIC.has(w[0])) out.add(w[0]);
    return out;
  }
  I.entities = function (port) {
    port = port || E._port || E.portfolio();
    const ents = [];
    for (const r of port.holdings) {
      if (!r.ticker || r.ticker === "CASH") continue;
      const t = r.ticker.split(".")[0].replace(/-(B|A|UN)$/, "");
      ents.push({ kind: "holding", id: r.id, label: r.ticker, terms: nameTerms(r.name), tickers: new Set(t.length >= 2 && !t.startsWith("^") ? [t] : []), weight: r.weight });
    }
    for (const w of S().records.watch) { const t = (w.ticker || "").split(".")[0]; ents.push({ kind: "watch", id: w.id, label: w.ticker || w.name, terms: nameTerms(w.name || ""), tickers: new Set(t.length >= 2 ? [t] : []), weight: 0.03 }); }
    const orgs = {};
    for (const c of S().records.contact) { const o = I.companyKey(c.org); if (o.length >= 4 && !GENERIC_ORGS.has(o)) (orgs[o] = orgs[o] || []).push(c); }
    for (const [o, cs] of Object.entries(orgs)) if (cs.length <= 60) ents.push({ kind: "org", id: cs[0].id, label: cs[0].org, terms: new Set([o]), tickers: new Set(), contacts: cs.map((c) => c.id), weight: 0.02 });
    for (const kw of S().settings.interests || []) if (kw.length >= 2) ents.push({ kind: "interest", id: kw, label: kw, terms: new Set(kw.length > 3 ? [kw.toLowerCase()] : []), tickers: new Set(kw.length <= 3 ? [kw] : []), weight: 0.01 });
    return ents;
  };
  const rxCache = new Map();
  const rx = (src, flags) => { const k = src + "/" + flags; if (!rxCache.has(k)) rxCache.set(k, new RegExp(src, flags)); return rxCache.get(k); };
  const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  I.mentions = function (text, ents) {
    const t = " " + norm(text) + " ", raw = text || "";
    return ents.filter((e) => [...e.terms].some((term) => term && rx("\\b" + escRx(term) + "\\b", "").test(t)) ||
      [...(e.tickers || [])].some((tk) => tk && rx("(?<![A-Za-z0-9$])\\$?" + escRx(tk) + "(?![A-Za-z0-9])", "").test(raw)));
  };

  // ------------------------------------------------------------------ news clustering & ranking
  const STOP = new Set(("a an the and or of to in on for with at by from as is are was were be been being it its this that these those after before over under into about amid against between says said say will would could may might new more most up down out than then just not no yes how why what who when where which while all any some our your their his her they them we you i he she has have had do does did can us uk year years week day today live update updates latest report reports first two three one per vs via video watch").split(" "));
  function tokens(title) {
    const out = new Set();
    for (let w of (title || "").toLowerCase().match(/[a-z0-9$%']+/g) || []) {
      w = w.replace(/^'+|'+$/g, "");
      if (w.length < 3 || STOP.has(w)) continue;
      if (w.endsWith("s") && w.length > 4 && !w.endsWith("ss")) w = w.slice(0, -1);
      out.add(w);
    }
    return out;
  }
  const TOPIC_RULES = [
    ["conflict", /\b(war|missile|strike[sd]?|airstrike|troops|invasion|ceasefire|drone attack|shelling|militants?|hostages?|military|gaza|ukraine|israel|iran|hezbollah|houthi|nato|hormuz)\b/i],
    ["macro", /\b(inflation|cpi|interest rates?|rate cut|rate hike|central bank|federal reserve|fed\b|bank of canada|gdp|unemployment|jobs report|payrolls|recession|treasury yields?|bond yields?|tariffs?|economy)\b/i],
    ["markets", /\b(stocks?|shares|s&p|nasdaq|dow|tsx|earnings|ipo|investors?|oil prices?|bitcoin|crypto|bonds?|dollar|yen|euro|gold)\b/i],
    ["technology", /\b(ai|artificial intelligence|openai|anthropic|nvidia|chips?|semiconductors?|apple|google|microsoft|meta|software|cyber|data cent(er|re)s?|robot|quantum)\b/i],
    ["geopolitics", /\b(election|president|prime minister|sanctions?|diplomat|summit|china|russia|taiwan|eu\b|parliament|minister)\b/i],
  ];
  const topicOf = (text, def) => { for (const [t, r] of TOPIC_RULES) if (r.test(text)) return t; return def; };
  I.clusters = function (hours = 72) {
    const key = hours + ":" + S().news.length;
    if (I._cl && I._cl.key === key) return I._cl.data;
    const rows = S().news.filter((n) => n.published > now() - hours * 3600).sort((a, b) => a.published - b.published);
    const clusters = [];
    for (const r of rows) {
      const tk = tokens(r.title);
      let best = null, bestS = 0;
      for (const c of clusters) {
        let inter = 0; for (const w of tk) if (c.tk.has(w)) inter++;
        if (inter < 2) continue;
        const s = inter / Math.max(1, Math.min(tk.size, c.tk.size)), j = inter / Math.max(1, new Set([...tk, ...c.tk]).size);
        const sc = Math.max(j * 1.6, inter >= 3 ? s : 0);
        if (sc > bestS) { best = c; bestS = sc; }
      }
      if (best && bestS >= 0.55) { best.items.push(r); for (const w of tk) best.tk.add(w); }
      else clusters.push({ id: r.id, tk: new Set(tk), items: [r] });
    }
    I._cl = { key, data: clusters };
    return clusters;
  };
  I.stories = function (hours = 36, limit = 40, port) {
    port = port || E._port || E.portfolio();
    const ents = I.entities(port), exp = port.exposures;
    const weights = S().settings.topic_weights || {}, muted = (S().settings.muted || []).map((m) => m.toLowerCase());
    const out = [];
    for (const c of I.clusters(Math.max(hours, 72))) {
      const items = c.items.filter((i) => i.published > now() - hours * 3600);
      if (!items.length) continue;
      const lead = items.reduce((a, r) => ((r.feed === "fed" || r.feed === "boc") > (a.feed === "fed" || a.feed === "boc") || (r.summary || "").length > (a.summary || "").length ? r : a), items[0]);
      const text = items.slice(0, 6).map((i) => i.title + " " + (i.summary || "")).join(" ");
      if (muted.some((m) => text.toLowerCase().includes(m))) continue;
      const srcs = [...new Set(items.map((i) => i.source))];
      const topic = topicOf(text, lead.topic);
      const shocks = E.detectShocks(text);
      let relPort = 0; for (const s of shocks) for (const [f, v] of Object.entries(s.shock.impulse)) relPort += Math.abs(((exp[f] || {}).value || 0) * v);
      const ment = I.mentions(text, ents);
      const ageH = (now() - items[items.length - 1].published) / 3600;
      const why = [];
      let score = Math.log2(1 + srcs.length) * 1.2;
      if (srcs.length > 1) why.push(`covered by ${srcs.length} outlets`);
      score += 1.5 * Math.exp(-ageH / 14);
      if (relPort > 0.05) { score += Math.min(3, relPort * 6); why.push("touches drivers your portfolio is exposed to (" + shocks.slice(0, 2).map((s) => s.shock.label.toLowerCase()).join(", ") + ")"); }
      const hm = ment.filter((m) => m.kind === "holding" || m.kind === "watch");
      if (hm.length) { score += 2.5; why.push("mentions " + [...new Set(hm.map((m) => m.label))].join(", ")); }
      const om = ment.filter((m) => m.kind === "org");
      if (om.length) { score += 1.2; why.push("involves an organisation in your network (" + [...new Set(om.map((m) => m.label))].slice(0, 3).join(", ") + ")"); }
      const im = ment.filter((m) => m.kind === "interest");
      if (im.length) { score += 1.0; why.push("matches your interests (" + [...new Set(im.map((m) => m.label))].join(", ") + ")"); }
      if (lead.feed === "fed" || lead.feed === "boc") { score += 1.5; why.push("official central-bank release"); }
      const hs = K.HOTSPOTS.find((h) => rx("\\b(" + h.name.split(/[ &]+/).filter((w) => w.length > 4).map(escRx).join("|") + ")\\b", "i").test(text));
      if (hs) { const st = I.hotspotStatus(hs); if (st.score >= 50) { score += 1.2; why.push(`${hs.name} is ${st.status.toLowerCase()} on your world tracker`); } }
      score *= +(weights[topic] || 1);
      out.push({ id: c.id, title: lead.title, summary: lead.summary, topic, link: lead.link, source: lead.source, published: lead.published, first: items[0].published, updated: items[items.length - 1].published,
        sources: items.slice().sort((a, b) => b.published - a.published).slice(0, 8).map((i) => ({ source: i.source, title: i.title, link: i.link, published: i.published })),
        n_sources: srcs.length, n_items: items.length, score, why, shocks: shocks.map((s) => ({ label: s.shock.label, dir: s.dir })),
        mentions: ment.map((m) => ({ kind: m.kind, label: m.label, id: m.id })), seen: S().seen.has("story:" + c.id), official: lead.feed === "fed" || lead.feed === "boc", hotspot: hs ? hs.id : null });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  };
  I.analyzeStory = function (s, port) {
    port = port || E._port;
    const shocks = E.detectShocks(s.title + " " + (s.summary || ""));
    const parts = { happened: { label: "fact", text: s.summary || s.title, src: s.source + ", " + new Date(s.published * 1000).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) } };
    if (shocks.length) {
      const sh = shocks[0].shock, d = shocks[0].dir;
      parts.matters = { label: "interpretation", text: `Reads as: ${sh.label}${d > 0 ? "" : " (easing direction)"}. ${sh.markets}` };
      parts.effects = { label: "interpretation", people: sh.people, business: sh.business, markets: sh.markets };
      parts.watch = { label: "forecast", items: sh.watch, counter: sh.counter };
      const imp = {}; for (const x of shocks) for (const [f, v] of Object.entries(x.shock.impulse)) imp[f] = (imp[f] || 0) + v * x.dir;
      const hits = port.holdings.map((r) => [r.ticker || r.name, Object.entries(imp).reduce((a, [f, v]) => a + (r.sens[f] || 0) * v, 0), r.weight]).filter((x) => Math.abs(x[1]) >= 0.25)
        .sort((a, b) => Math.abs(b[1]) * (b[2] + 0.01) - Math.abs(a[1]) * (a[2] + 0.01));
      parts.mine = { label: "calculated", items: hits.slice(0, 6).map(([ticker, tilt, weight]) => ({ ticker, tilt, weight })), text: hits.length ? "" : "No holdings with a meaningful sensitivity to this development." };
    } else {
      parts.matters = { label: "interpretation", text: "No known economic transmission pattern detected. It may still matter for reasons the built-in model doesn't cover; ask Claude for a deeper read." };
      parts.mine = { label: "calculated", items: [], text: "No mapped driver exposure." };
    }
    const direct = (s.mentions || []).filter((m) => ["holding", "watch", "org"].includes(m.kind));
    if (direct.length) parts.mine.direct = direct;
    return parts;
  };

  // ------------------------------------------------------------------ macro strip ("so what" for today)
  I.macro = function () {
    const st = S(), last = (k) => { const s = st.boc(k); return s && s.length ? { value: s[s.length - 1][1], date: s[s.length - 1][0], prev: s.length > 1 ? s[s.length - 2][1] : null, m1: s.length > 22 ? s[s.length - 23][1] : null } : null; };
    const policy = last("V39079"), usdcad = last("FXUSDCAD"), cpi = last("STATIC_TOTALCPICHANGE"), trim = last("CPI_TRIM"), y10 = last("BD.CDN.10YR.DQ.YLD"), prime = last("V80691311"), mort = last("V80691335");
    const markets = [["^GSPC", "S&P 500"], ["^GSPTSE", "S&P/TSX"], ["^IXIC", "Nasdaq"], ["^VIX", "VIX"], ["^TNX", "US 10Y"], ["CL=F", "WTI"], ["BZ=F", "Brent"], ["GC=F", "Gold"], ["DX-Y.NYB", "US dollar"], ["BTC-USD", "Bitcoin"]]
      .map(([t, label]) => { const q = st.quote(t); if (!q || q.p == null) return null; const h = st.hist(t) || []; return { ticker: t, label, price: q.p, change: q.pc ? q.p / q.pc - 1 : null, currency: q.c, time: q.t, spark: h.slice(-30).map((x) => x[1]) }; }).filter(Boolean);
    const practical = [];
    const primeV = prime ? prime.value : policy ? policy.value + 2.2 : null;
    if (primeV != null) practical.push({ label: "calculated", title: `Borrowing: prime is ${primeV.toFixed(2)}%`, text: `A $500,000 variable mortgage at prime − 0.5 costs about $${Math.round(500000 * (primeV - 0.5) / 100 / 12).toLocaleString()}/month in interest alone.`, src: "Bank of Canada Valet" + (prime ? " (" + prime.date + ")" : " (policy + 2.20)") });
    if (cpi && policy) { const real = policy.value - cpi.value; practical.push({ label: "calculated", title: `Real policy rate: ${real >= 0 ? "+" : ""}${real.toFixed(2)}%`, text: real > 0 ? "Cash savings roughly keep pace with prices; policy is restrictive." : "Cash loses purchasing power after inflation; policy is still supportive.", src: `BoC ${policy.value.toFixed(2)}% (${policy.date}) − CPI ${cpi.value.toFixed(1)}% (${cpi.date})` }); }
    if (usdcad) practical.push({ label: "calculated", title: `US$100 costs C$${(100 * usdcad.value).toFixed(2)}`, text: usdcad.m1 ? `The loonie is ${usdcad.value > usdcad.m1 ? "weaker" : "stronger"} by ${V.pct(Math.abs(usdcad.value / usdcad.m1 - 1), 1, false)} over the month, which moves the CAD value of every US holding.` : "", src: "Bank of Canada daily rate (" + usdcad.date + ")" });
    const wti = st.quote("CL=F");
    if (wti && usdcad) practical.push({ label: "calculated", title: `WTI $${wti.p.toFixed(2)} ≈ ${(wti.p / 158.987 * usdcad.value * 100).toFixed(1)}¢ CAD per litre of crude`, text: "Every US$10/bbl move shifts Canadian pump prices by roughly 9¢/L before taxes, usually within two weeks.", src: "Calculated from WTI and USD/CAD" });
    return { boc: { policy, usdcad, cpi, cpi_trim: trim, y10, prime, mort }, markets, practical, fetched: (st.series.boc || {}).f, sources: ["Bank of Canada Valet API", "Yahoo Finance (unofficial, delayed)"] };
  };

  // ------------------------------------------------------------------ world status
  I.hotspotStatus = function (h) {
    const st = S(), comp = {}, facts = [];
    const pw = st.series.pw;
    if (pw && h.ports && h.ports.length) {
      const port = h.ports[0], rows = (pw.daily || {})[port] || [], avg = (pw.avg || {})[port];
      if (rows.length >= 7 && avg && avg.total) {
        const l7 = rows.slice(-7).reduce((a, r) => a + (r[1] || 0), 0) / 7, ratio = l7 / avg.total;
        comp.shipping = Math.max(0, Math.min(1, (1 - ratio) / 0.8));
        facts.push({ k: "shipping", text: `${port}: ${l7.toFixed(1)} transits/day over the last 7 days vs a normal ${avg.total.toFixed(1)} (${Math.round(ratio * 100)}% of normal)`, asof: rows[rows.length - 1][0], ratio, l7, avg: avg.total, tankers7: rows.slice(-7).reduce((a, r) => a + (r[2] || 0), 0) / 7, avgTank: avg.tanker });
      }
    }
    const g = st.series["g:" + h.id];
    if (g && g.vol && g.vol.length > 20) {
      const v = g.vol.map((x) => x[1]), base = v.slice(-31, -3), last = v.slice(-3);
      const m = base.reduce((a, b) => a + b, 0) / base.length, sd = Math.sqrt(base.reduce((a, b) => a + (b - m) ** 2, 0) / base.length) || 1;
      const lm = last.reduce((a, b) => a + b, 0) / last.length, z = (lm - m) / sd;
      const m90 = v.reduce((a, b) => a + b, 0) / v.length;
      comp.attention = Math.max(0, Math.min(1, 0.5 * (z / 4) + 0.5 * Math.min(1, lm / Math.max(1, m90 * 3))));
      facts.push({ k: "attention", text: `News attention: ${Math.round(lm)} articles/day (last 3 days) vs ${Math.round(m)} the prior 4 weeks (${z >= 0 ? "+" : ""}${z.toFixed(1)}σ)`, z, lm, m });
    }
    const f = st.series["f:" + h.id];
    if (f && f.pts && f.pts.length >= 6) {
      const pts = f.pts, cur = pts[pts.length - 1];
      const hist = pts.filter((p) => p[0] < cur[0] - 3600 && p[0] > cur[0] - 14 * DAY).map((p) => p[1]).sort((a, b) => a - b);
      if (hist.length >= 5) {
        const med = hist[Math.floor(hist.length / 2)], ratio = med ? cur[1] / med : 1;
        comp.flights = Math.max(0, Math.min(1, (1 - ratio) / 0.7));
        facts.push({ k: "flights", text: `${cur[1]} aircraft tracked in the area now vs a median of ${med} over the past two weeks`, ratio, cur: cur[1], med, asof: cur[0] });
      } else facts.push({ k: "flights", text: `${cur[1]} aircraft tracked in the area now (baseline still building)`, cur: cur[1], asof: cur[0] });
    }
    const tr = st.series.travel;
    if (tr && tr.levels) {
      const lv = h.countries.map((c) => tr.levels[c]).filter(Boolean);
      if (lv.length) {
        const mx = Math.max(...lv.map((x) => x[0]));
        comp.advisory = mx / 3;
        const worst = lv.filter((x) => x[0] === mx).map((x) => x[2]);
        facts.push({ k: "advisory", text: `Canada advises: "${K.ADVISORY[mx]}" for ${worst.slice(0, 3).join(", ")}`, level: mx });
      }
    }
    // Weighted blend. Missing components count as neutral (0.3) so one source can't max out the score;
    // a chokepoint running below ~15% of normal is critical on its own.
    const W = { shipping: 0.35, attention: 0.25, flights: 0.15, advisory: 0.25 };
    let num = 0, den = 0;
    for (const [k, w] of Object.entries(W)) { if (comp[k] != null) { num += w * comp[k]; den += w; } else num += w * 0.3; }
    let score = den ? Math.round(num * 100) : null;
    if (score != null && comp.shipping != null && comp.shipping >= 0.85) score = Math.max(score, 80);
    const status = score == null ? "No data" : score >= 75 ? "Critical" : score >= 50 ? "Elevated" : score >= 25 ? "Watch" : "Calm";
    return { id: h.id, score, status, comp, facts, coverage: den, limited: den < 0.5 };
  };
  I.world = function () {
    const port = E._port || E.portfolio();
    return K.HOTSPOTS.map((h) => {
      const st = I.hotspotStatus(h);
      const tilt = port.holdings.map((r) => [r, Object.entries(h.impulse).reduce((a, [f, v]) => a + (r.sens[f] || 0) * v, 0)]).filter(([, x]) => Math.abs(x) >= 0.2).sort((a, b) => Math.abs(b[1]) * b[0].weight - Math.abs(a[1]) * a[0].weight);
      return Object.assign({}, h, st, { exposure: tilt.slice(0, 6).map(([r, x]) => ({ ticker: r.ticker, id: r.id, tilt: x, weight: r.weight })), net: tilt.reduce((a, [r, x]) => a + r.weight * x, 0) });
    }).sort((a, b) => (b.score || 0) - (a.score || 0));
  };

  // ------------------------------------------------------------------ calendar
  function expandUser(e, start, end) {
    const s = e.start; if (!s) return [];
    const rec = e.recur || "none", out = [];
    let cur = parseDay(s);
    let dur = null;
    if (e.end && !e.all_day && s.length > 10) dur = new Date(e.end) - new Date(s);
    for (let i = 0; i < 800 && cur <= end; i++) {
      if (cur >= start) {
        if (e.all_day || s.length <= 10) out.push([iso(cur), null]);
        else { const st = new Date(s); const d = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), st.getHours(), st.getMinutes()); out.push([d.toISOString(), dur ? new Date(d.getTime() + dur).toISOString() : null]); }
      }
      if (rec === "none") break;
      cur = new Date(cur);
      if (rec === "daily") cur.setDate(cur.getDate() + 1); else if (rec === "weekly") cur.setDate(cur.getDate() + 7);
      else if (rec === "monthly") cur.setMonth(cur.getMonth() + 1); else if (rec === "yearly") cur.setFullYear(cur.getFullYear() + 1); else break;
    }
    return out;
  }
  function nextBirthday(b, start, end) {
    const m = String(b || "").match(/(\d{1,2})-(\d{1,2})$/); if (!m) return [];
    const out = [];
    for (const y of [start.getFullYear(), start.getFullYear() + 1]) { const d = new Date(y, +m[1] - 1, +m[2]); if (d >= start && d <= end) out.push(d); }
    return out;
  }
  I.lastContact = (c) => { const ds = (c.interactions || []).map((i) => i.date).filter(Boolean); if (c.last_contact) ds.push(c.last_contact); return ds.length ? parseDay(ds.sort().pop()) : null; };
  I.cadence = (c) => c.cadence_days ? +c.cadence_days : { 5: 30, 4: 45, 3: 90, 2: 180, 1: 365 }[+c.closeness || 0] || null;
  I.nextFollowup = (c) => { if (c.next_followup) return parseDay(c.next_followup); const lc = I.lastContact(c), cd = I.cadence(c); if (!lc || !cd) return null; const d = new Date(lc); d.setDate(d.getDate() + cd); return d; };
  I.icsEvents = async function () {
    const out = [];
    for (const sub of S().records.ics_sub) {
      try {
        const txt = await S().px(sub.url.replace(/^webcal:/, "https:"), { ttl: 1800, type: "text" });
        for (const e of parseIcs(txt)) out.push(Object.assign(e, { sub }));
        sub._status = { ok: true, count: out.length };
      } catch (e) { sub._status = { ok: false, error: e.message }; }
    }
    I._ics = out;
    return out;
  };
  function parseIcs(text) {
    text = text.replace(/\r?\n[ \t]/g, "");
    const evs = []; let cur = null;
    for (const line of text.split(/\r?\n/)) {
      if (line === "BEGIN:VEVENT") cur = {};
      else if (line === "END:VEVENT" && cur) { evs.push(cur); cur = null; }
      else if (cur && line.includes(":")) { const i = line.indexOf(":"); const head = line.slice(0, i), val = line.slice(i + 1); const [name, ...params] = head.split(";"); if (!cur[name.toUpperCase()]) cur[name.toUpperCase()] = [val, params.join(";")]; }
    }
    const unesc = (s) => (s || "").replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";");
    const dt = ([v, p]) => {
      if (/VALUE=DATE/.test(p) || /^\d{8}$/.test(v)) return [`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, true];
      const m = v.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/); if (!m) return [null, false];
      const isoS = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? "Z" : ""}`;
      return [new Date(isoS).toISOString(), false];
    };
    const out = [], lo = new Date(Date.now() - 14 * DAY * 1000), hi = new Date(Date.now() + 120 * DAY * 1000);
    for (const e of evs) {
      if (!e.DTSTART) continue;
      const [s, allDay] = dt(e.DTSTART); if (!s) continue;
      const en = e.DTEND ? dt(e.DTEND)[0] : null;
      const base = { title: unesc((e.SUMMARY || ["(no title)"])[0]), location: unesc((e.LOCATION || [""])[0]), notes: unesc((e.DESCRIPTION || [""])[0]).slice(0, 1000), all_day: allDay };
      const rr = e.RRULE ? Object.fromEntries(e.RRULE[0].split(";").map((x) => x.split("="))) : null;
      let d0 = new Date(s), n = 0;
      const dur = en ? new Date(en) - d0 : 0;
      const count = rr && rr.COUNT ? +rr.COUNT : null, until = rr && rr.UNTIL ? new Date(rr.UNTIL.slice(0, 4) + "-" + rr.UNTIL.slice(4, 6) + "-" + rr.UNTIL.slice(6, 8)) : null;
      for (let i = 0; i < 1000; i++) {
        if (count != null && n >= count) break; if (until && d0 > until) break; if (d0 > hi) break;
        if (d0 >= lo) out.push(Object.assign({}, base, { start: allDay ? iso(d0) : d0.toISOString(), end: dur ? new Date(d0.getTime() + dur).toISOString() : null }));
        n++;
        if (!rr) break;
        const iv = +(rr.INTERVAL || 1);
        d0 = new Date(d0);
        if (rr.FREQ === "DAILY") d0.setDate(d0.getDate() + iv); else if (rr.FREQ === "WEEKLY") d0.setDate(d0.getDate() + 7 * iv);
        else if (rr.FREQ === "MONTHLY") d0.setMonth(d0.getMonth() + iv); else if (rr.FREQ === "YEARLY") d0.setFullYear(d0.getFullYear() + iv); else break;
      }
    }
    return out;
  }
  I.calendar = function (start, end) {
    const st = S(), ev = [];
    for (const e of st.records.event) for (const [s, en] of expandUser(e, start, end))
      ev.push({ id: e.id + ":" + s.slice(0, 10), rid: e.id, title: e.title, start: s, end: en, all_day: !!(e.all_day || e.start.length <= 10), category: e.category || "personal",
        location: e.location, people: e.people || [], source: "you", importance: +(e.importance || 2), notes: e.notes, prep: e.prep || [], ref: { kind: "event", id: e.id } });
    for (const x of I._ics || []) { const d = parseDay(x.start); if (d >= start && d <= end) ev.push({ id: "ics:" + x.sub.id + ":" + x.start, title: x.title, start: x.start, end: x.end, all_day: x.all_day, category: x.sub.category || "professional", location: x.location, notes: x.notes, source: "calendar: " + (x.sub.name || "subscribed"), importance: 2, readonly: true }); }
    for (const c of st.records.contact) {
      if (c.birthday) for (const d of nextBirthday(c.birthday, start, end)) ev.push({ id: "bday:" + c.id + ":" + iso(d), title: `${c.name}'s birthday`, start: iso(d), all_day: true, category: "birthday", source: "contacts", importance: 1 + Math.min(2, Math.floor((+c.closeness || 2) / 2)), people: [c.id], ref: { kind: "contact", id: c.id }, readonly: true });
      for (const m of c.milestones || []) if (m.date) for (const d of m.yearly ? nextBirthday(m.date, start, end) : [parseDay(m.date)]) if (d >= start && d <= end) ev.push({ id: "ms:" + c.id + ":" + iso(d), title: `${c.name}: ${m.title}`, start: iso(d), all_day: true, category: "milestone", source: "contacts", importance: 2, people: [c.id], ref: { kind: "contact", id: c.id }, readonly: true });
      for (const cm of c.commitments || []) if (cm.due && !cm.done) { const d = parseDay(cm.due); if (d >= start && d <= end) ev.push({ id: "cm:" + c.id + ":" + (cm.text || "").slice(0, 10), title: `Promise to ${c.name}: ${cm.text}`, start: cm.due, all_day: true, category: "follow-up", source: "contacts", importance: 3, people: [c.id], ref: { kind: "contact", id: c.id }, readonly: true }); }
      const nf = I.nextFollowup(c);
      if (nf && nf >= start && nf <= end) ev.push({ id: "fu:" + c.id, title: `Reconnect with ${c.name}`, start: iso(nf), all_day: true, category: "follow-up", source: "relationship cadence", importance: 1, people: [c.id], ref: { kind: "contact", id: c.id }, readonly: true });
    }
    for (const m of K.computedEvents(start, end)) ev.push({ id: "mk:" + m.date + ":" + m.title.slice(0, 12), title: m.title, start: m.date, all_day: true, category: m.category, source: "computed schedule", importance: m.importance, notes: m.note, url: m.url, readonly: true });
    for (const d of st.records.decision) if (d.review_date) { const rd = parseDay(d.review_date); if (rd >= start && rd <= end) ev.push({ id: "dr:" + d.id, title: "Review decision: " + d.title, start: d.review_date, all_day: true, category: "decision", source: "journal", importance: 2, ref: { kind: "decision", id: d.id }, readonly: true }); }
    const port = E._port || E.portfolio();
    for (const h of st.records.holding) {
      for (const cat of h.catalysts || []) if (cat.date) { const cd = parseDay(cat.date); if (cd >= start && cd <= end) ev.push({ id: "cat:" + h.id + ":" + cat.date, title: `${h.ticker}: ${cat.title}`, start: cat.date, all_day: true, category: "market", source: "your catalysts", importance: 3, ref: { kind: "holding", id: h.id }, readonly: true }); }
      if (h.div_ex_date) { const d = parseDay(h.div_ex_date); if (d >= start && d <= end) { const r = port.holdings.find((x) => x.id === h.id); ev.push({ id: "div:" + h.id, title: `${h.ticker} ex-dividend${r && r.div_ps ? ` (≈${V.money(r.div_ps / 4 * r.quantity, r.currency)} a quarter)` : ""}`, start: h.div_ex_date, all_day: true, category: "dividend", source: "broker export", importance: 1, ref: { kind: "holding", id: h.id }, readonly: true }); } }
      const fl = I._filings && I._filings[(h.ticker || "").toUpperCase()];
      if (fl && fl.earnings_dates && fl.earnings_dates.length) {
        let nx = parseDay(fl.earnings_dates[0]); while (nx < new Date(start.getTime() - 10 * DAY * 1000)) nx = new Date(nx.getTime() + 91 * DAY * 1000);
        if (nx >= new Date(start.getTime() - 3 * DAY * 1000) && nx <= end) ev.push({ id: "earn:" + h.id, title: `${h.ticker} earnings (estimated ± 2 weeks)`, start: iso(nx), all_day: true, category: "market", source: "estimated from SEC 8-K cadence", importance: 3, estimated: true, notes: "Last earnings 8-K (item 2.02) filed " + fl.earnings_dates[0] + ". Next estimated at +91 days.", ref: { kind: "holding", id: h.id }, readonly: true });
      }
    }
    return ev.sort((a, b) => (a.start.slice(0, 10) < b.start.slice(0, 10) ? -1 : a.start.slice(0, 10) > b.start.slice(0, 10) ? 1 : (a.all_day ? 0 : 1) - (b.all_day ? 0 : 1) || (a.start < b.start ? -1 : 1)));
  };
  I.weekAhead = function () {
    const today = V.today(), end = new Date(today.getTime() + 7 * DAY * 1000);
    const evs = I.calendar(today, end);
    const days = [];
    for (let i = 0; i < 8; i++) {
      const d = new Date(today.getTime() + i * DAY * 1000), ds = iso(d);
      const de = evs.filter((e) => e.start.slice(0, 10) === ds && !(e.category === "birthday" && !S().records.contact.find((c) => c.id === (e.people || [])[0] && c.closeness)));
      const timed = de.filter((e) => !e.all_day);
      let hours = 0; const spans = [];
      for (const e of timed) { const s = new Date(e.start), en = e.end ? new Date(e.end) : new Date(s.getTime() + 3600e3); hours += (en - s) / 3600e3; spans.push([s, en, e]); }
      spans.sort((a, b) => a[0] - b[0]);
      const conflicts = [];
      for (let a = 0; a < spans.length; a++) for (let b = a + 1; b < spans.length; b++) if (spans[b][0] < spans[a][1]) conflicts.push([spans[a][2].title, spans[b][2].title]);
      const travel = de.some((e) => e.category === "travel");
      days.push({ date: ds, events: de, hours: Math.round(hours * 10) / 10, load: Math.min(1, hours / 7 + timed.length * 0.06 + (travel ? 0.35 : 0)), conflicts, market: de.filter((e) => ["market", "filing"].includes(e.category)), travel });
    }
    const prep = [];
    for (const e of evs) {
      const d = parseDay(e.start); let lead = null, what;
      if (e.category === "birthday") { const c = S().records.contact.find((x) => x.id === (e.people || [])[0]); if (!c || !(+c.closeness >= 3)) continue; lead = 7; what = "Plan something thoughtful for " + e.title.replace("'s birthday", ""); }
      else if ((e.people || []).length && ["professional", "personal"].includes(e.category) && !e.all_day) { lead = 1; what = "Prepare for: " + e.title; }
      else if (e.category === "travel") { lead = 2; what = `Travel prep: ${e.title} (documents, currency, who to see there)`; }
      else if (e.category === "market" && e.ref && e.ref.kind === "holding") { lead = 1; what = "Re-read your thesis before " + e.title; }
      else if (e.category === "decision") { lead = 0; what = e.title; }
      if (lead == null) continue;
      const due = new Date(d.getTime() - lead * DAY * 1000);
      prep.push({ event: e, due: iso(due < today ? today : due), overdue: due < today, what });
    }
    prep.sort((a, b) => (a.due < b.due ? -1 : 1));
    const busiest = days.reduce((a, d) => (d.load > a.load ? d : a), days[0]);
    return { days, prep, busiest: busiest && busiest.load > 0.4 ? busiest.date : null, conflicts: days.reduce((a, d) => a + d.conflicts.length, 0), market: days.flatMap((d) => d.market) };
  };
  I.prep = function (eventId) {
    const today = V.today();
    const evs = I.calendar(new Date(today.getTime() - 60 * DAY * 1000), new Date(today.getTime() + 120 * DAY * 1000));
    const e = evs.find((x) => x.id === eventId || x.rid === eventId); if (!e) return null;
    const contacts = new Map(S().records.contact.map((c) => [c.id, c]));
    const people = (e.people || []).map((p) => contacts.get(p)).filter(Boolean);
    const text = (e.title || "") + " " + (e.notes || "");
    if (!people.length) for (const c of S().records.contact) { const parts = (c.name || "").split(" "); if (parts.length >= 2 && text.includes(parts[0]) && text.includes(parts[parts.length - 1])) people.push(c); }
    const news = [];
    for (const p of people) { const org = I.companyKey(p.org); if (org.length >= 4 && !GENERIC_ORGS.has(org)) for (const n of S().news.filter((n) => norm(n.title).includes(org)).slice(0, 4)) news.push(Object.assign({}, n, { why: `mentions ${p.org} (${p.name}'s organisation)` })); }
    const points = [];
    for (const p of people) {
      for (const c of (p.commitments || []).filter((c) => !c.done)) points.push({ text: "Close the loop on your promise: " + c.text, basis: "your commitments to " + p.name, label: "retrieved" });
      if ((p.interests || []).length) points.push({ text: "Shared interests to draw on: " + p.interests.slice(0, 4).join(", "), basis: "contact profile", label: "retrieved" });
      const last = (p.interactions || []).slice(-1)[0]; if (last) points.push({ text: `Pick up from ${last.date}: ${(last.notes || "").slice(0, 160)}`, basis: "last interaction", label: "retrieved" });
      if (p.org) points.push({ text: `Ask how ${p.org} is thinking about the next 12 months, and what would make this relationship useful for them.`, basis: "suggested", label: "interpretation" });
    }
    for (const n of news.slice(0, 2)) points.push({ text: "Recent news to acknowledge: " + n.title, basis: n.source, label: "fact" });
    const d = parseDay(e.start), dd = (n) => iso(new Date(d.getTime() + n * DAY * 1000));
    const checklist = e.category === "birthday" ? [{ when: dd(-10), task: "Decide on a gift or plan (use their interests)" }, { when: dd(-5), task: "Order or book anything with lead time" }, { when: dd(0), task: "Send a personal note in the morning" }]
      : e.category === "travel" ? [{ when: dd(-7), task: "See who you know there (Network → city)" }, { when: dd(-2), task: "Documents, currency, itinerary" }, { when: dd(-1), task: "Confirm meetings and addresses" }]
      : [{ when: dd(-1), task: "Read this brief and your last notes" }, { when: dd(-1), task: "Decide the one outcome you want" }, { when: dd(0), task: "After: log the interaction and any promises" }];
    const missing = [];
    if (!people.length) missing.push("No contacts linked: link attendees to pull in notes and history.");
    for (const p of people) if (!(p.interactions || []).length) missing.push("No logged interactions with " + p.name + ".");
    const past = evs.filter((x) => x.id !== e.id && (x.people || []).some((p) => people.some((q) => q.id === p)) && x.start < e.start).slice(-5);
    return { event: e, people: people.map((p) => ({ id: p.id, name: p.name, role: p.role, org: p.org, notes: p.notes, how_met: p.how_met, interactions: (p.interactions || []).slice(-4), commitments: p.commitments || [] })),
      news: news.slice(0, 6), holdings: I.mentions(text, I.entities().filter((x) => x.kind === "holding")).map((m) => ({ label: m.label, id: m.id })), past, points, checklist, missing };
  };

  // ------------------------------------------------------------------ relationships
  const SYN = { startup: ["founder", "co-founder", "cofounder", "startup", "start-up", "entrepreneur", "ceo"], founder: ["founder", "co-founder", "entrepreneur"],
    invest: ["investor", "vc", "venture", "partner", "angel", "fund", "capital", "private equity"], vc: ["venture", "vc", "investor", "partner", "principal"],
    consult: ["consultant", "consulting", "mckinsey", "bain", "bcg", "deloitte", "pwc", "kpmg", "ey"], product: ["product manager", "pm", "product"],
    engineer: ["engineer", "cto", "developer"], hire: ["recruiter", "talent", "hiring"], ai: ["ai", "machine learning", "ml"], law: ["lawyer", "legal", "counsel", "attorney"],
    finance: ["finance", "banking", "investment", "trader", "hedge fund", "asset management"], health: ["health", "doctor", "medical", "pharma"], apple: ["apple"] };
  const ctext = (c) => [c.name, c.role, c.org, c.industry, c.city, c.country, c.notes, c.how_met, c.community, ...(c.tags || []), ...(c.interests || []), ...(c.experience || []), ...(c.interactions || []).map((i) => i.notes)].filter(Boolean).join(" ").toLowerCase();
  I.who = function (q) {
    const contacts = S().records.contact, byId = new Map(contacts.map((c) => [c.id, c]));
    const ql = q.toLowerCase();
    const cm = q.match(/\b(?:in|visiting|around|based in|lives? in|trip to|travell?ing to)\s+([A-Z][a-zA-Z.\-]+(?:\s+[A-Z][a-zA-Z.\-]+)?)/);
    const city = cm ? cm[1].toLowerCase() : null;
    const om = q.match(/(?:introduce me to|intro to|get into|works? at|at|inside)\s+([A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*)*)/);
    const org = om ? om[1].toLowerCase() : null;
    const terms = new Set();
    for (const [k, syns] of Object.entries(SYN)) if (ql.includes(k) || syns.some((s) => s.length > 3 && ql.includes(s))) syns.forEach((s) => terms.add(s));
    const stop = new Set("who do i know someone could help me understand with experience building particular industry my network a an the in to of for".split(" "));
    const words = (ql.match(/[a-z][a-z\-]+/g) || []).filter((w) => !stop.has(w) && w.length > 2);
    const results = [];
    for (const c of contacts) {
      const txt = ctext(c); let score = 0; const reasons = [];
      if (city && ((c.city || "") + " " + (c.country || "")).toLowerCase().includes(city)) { score += 3; reasons.push("based in " + c.city); }
      if (org) { if ((c.org || "").toLowerCase().includes(org)) { score += 4; reasons.push("works at / tagged " + c.org); } else if (txt.includes(org)) { score += 1.5; reasons.push("notes mention " + org); } }
      for (const t of terms) if (rx("\\b" + escRx(t) + "\\b", "").test(txt)) { score += 1.2; reasons.push(`matches “${t}”`); if (reasons.length > 5) break; }
      for (const w of words) if (w !== city && w !== org && rx("\\b" + escRx(w), "").test(txt)) { score += 0.6; if (!reasons.some((r) => r.includes(w))) reasons.push(`mentions “${w}”`); }
      if (score > 0) { score *= 1 + 0.08 * (+c.closeness || 1); results.push({ id: c.id, name: c.name, role: c.role, org: c.org, city: c.city, closeness: c.closeness, score, reasons: reasons.slice(0, 5) }); }
    }
    results.sort((a, b) => b.score - a.score);
    const paths = [];
    if (org) {
      const adj = new Map();
      for (const c of contacts) for (const l of c.connections || []) if (byId.has(l.id)) { (adj.get(c.id) || adj.set(c.id, []).get(c.id)).push([l.id, !!l.verified]); (adj.get(l.id) || adj.set(l.id, []).get(l.id)).push([c.id, !!l.verified]); }
      const targets = new Set(contacts.filter((c) => (c.org || "").toLowerCase().includes(org)).map((c) => c.id));
      for (const id of targets) paths.push({ path: [{ id: "me", name: "You" }, { id, name: byId.get(id).name }], verified: true, note: "direct contact" });
      for (const c of contacts) if (!targets.has(c.id)) for (const [nb, ver] of adj.get(c.id) || []) if (targets.has(nb)) paths.push({ path: [{ id: "me", name: "You" }, { id: c.id, name: c.name }, { id: nb, name: byId.get(nb).name }], verified: ver, note: `${c.name} knows ${byId.get(nb).name} at ${byId.get(nb).org}` + (ver ? "" : " (unverified)") });
      for (const c of contacts) if (!targets.has(c.id) && ctext(c).includes(org) && !paths.some((p) => p.path[1].id === c.id)) paths.push({ path: [{ id: "me", name: "You" }, { id: c.id, name: c.name }, { id: null, name: org.replace(/\b\w/g, (m) => m.toUpperCase()) }], verified: false, note: `${c.name}'s notes mention ${org}: possible route, unverified` });
    }
    return { q, parsed: { city, org, terms: [...terms].sort().slice(0, 10) }, results: results.slice(0, 18), paths: paths.slice(0, 10), empty_reason: results.length || paths.length ? null : "No contacts match. Add roles, organisations, cities and notes to make this sharper." };
  };
  I.memory = function () {
    const today = V.today(), contacts = S().records.contact;
    const out = { lost_touch: [], promises: [], milestones: [], reasons: [] };
    for (const c of contacts) {
      const lc = I.lastContact(c), cd = I.cadence(c);
      if (cd && lc) { const gap = Math.round((today - lc) / 864e5); if (gap > cd) out.lost_touch.push({ id: c.id, name: c.name, org: c.org, days: gap, cadence: cd, closeness: c.closeness, overdue: gap - cd }); }
      else if (+c.closeness >= 3 && !lc) out.lost_touch.push({ id: c.id, name: c.name, org: c.org, days: null, cadence: cd, closeness: c.closeness, overdue: 0, note: "no interaction logged yet" });
      for (const cm of c.commitments || []) if (!cm.done) { const due = cm.due ? parseDay(cm.due) : null; out.promises.push({ id: c.id, name: c.name, text: cm.text, due: cm.due, overdue: !!(due && due < today), made: cm.made }); }
      if (c.birthday && (+c.closeness >= 2 || contacts.length < 300)) for (const d of nextBirthday(c.birthday, today, new Date(today.getTime() + 30 * DAY * 1000))) out.milestones.push({ id: c.id, name: c.name, what: "Birthday", date: iso(d), days: Math.round((d - today) / 864e5), rated: !!c.closeness });
      for (const m of c.milestones || []) if (m.date) for (const d of m.yearly ? nextBirthday(m.date, today, new Date(today.getTime() + 45 * DAY * 1000)) : [parseDay(m.date)]) if (d >= today && d <= new Date(today.getTime() + 45 * DAY * 1000)) out.milestones.push({ id: c.id, name: c.name, what: m.title, date: iso(d), days: Math.round((d - today) / 864e5) });
    }
    // all upcoming birthdays (for large, unrated address books show them but de-emphasised)
    if (contacts.length >= 300) for (const c of contacts) if (c.birthday && !(+c.closeness >= 2)) for (const d of nextBirthday(c.birthday, today, new Date(today.getTime() + 14 * DAY * 1000))) out.milestones.push({ id: c.id, name: c.name, what: "Birthday", date: iso(d), days: Math.round((d - today) / 864e5), rated: false });
    out.lost_touch.sort((a, b) => (+b.closeness || 0) - (+a.closeness || 0) || b.overdue - a.overdue);
    out.promises.sort((a, b) => (a.overdue === b.overdue ? ((a.due || "9") < (b.due || "9") ? -1 : 1) : a.overdue ? -1 : 1));
    out.milestones.sort((a, b) => a.days - b.days);
    const news = S().news.filter((n) => n.published > now() - 3 * DAY);
    const seenOrg = new Set();
    const listed = I._secNames || null; // company names from SEC's ticker file, once it has been loaded
    for (const c of contacts) {
      const org = I.companyKey(c.org);
      if (!looksLikeOrg(c.org) || seenOrg.has(org)) continue;
      const n = news.find((x) => {
        const t = norm(x.title), m = rx("\\b" + escRx(org) + "\\b", "").exec(t);
        if (!m) return false;
        // a one-word name as a headline's first word is capitalised anyway ("History shows…"): only trust it for a known company
        if (m.index === 0 && !org.includes(" ") && !listed && I.sec && !I._secLoading) I._secLoading = I.sec.tickers().catch(() => null); // ready next time
        return !(m.index === 0 && !org.includes(" ") && !(listed && listed.has(org)));
      });
      if (n) { seenOrg.add(org); out.reasons.push({ id: c.id, name: c.name, kind: "news", text: `${c.org} is in the news: “${n.title}”`, link: n.link, src: n.source }); }
    }
    const trips = I.calendar(today, new Date(today.getTime() + 45 * DAY * 1000)).filter((e) => e.category === "travel");
    for (const t of trips) { const dest = norm((t.location || "") + " " + t.title); for (const c of contacts) { const city = norm(c.city); if (city.length >= 3 && rx("\\b" + escRx(city) + "\\b", "").test(dest)) out.reasons.push({ id: c.id, name: c.name, kind: "trip", group: "trip:" + t.id, text: `You're going to ${c.city} on ${t.start.slice(0, 10)}; ${c.name} is based there.` }); } }
    return out;
  };
  I.draft = function (contactId, purpose) {
    const c = S().records.contact.find((x) => x.id === contactId); if (!c) return null;
    const first = (c.name || "").split(" ")[0] || "there", lc = I.lastContact(c);
    const hooks = I.memory().reasons.filter((r) => r.id === contactId).map((r) => r.text);
    const open = (c.commitments || []).filter((x) => !x.done);
    const lines = [`Hi ${first},`, ""];
    lines.push(lc && (V.today() - lc) / 864e5 > 60 ? `It's been a while since ${lc.toLocaleDateString(undefined, { month: "long" })}, and you've been on my mind.` : "Hope you're doing well.");
    if (hooks.length) lines.push(hooks[0].replace("You're going", "I'm going") + (hooks[0].endsWith(".") ? "" : "."));
    if (open.length) lines.push(`I also still owe you something: ${open[0].text}. Here's where that stands: [add update].`);
    if ((c.interests || []).length) lines.push(`I came across something on ${c.interests[0]} that made me think of you: [add link or thought].`);
    if (purpose) lines.push(purpose);
    lines.push("", "Would love to catch up properly. Any chance for a coffee or a quick call in the next couple of weeks?", "", "Best,");
    return { to: c.name, email: c.email, phone: c.phone, body: lines.join("\n"), basis: hooks.concat(open.map((x) => x.text)), note: "Draft only. Nothing is sent: copy it, edit it, and send it yourself." };
  };

  // ------------------------------------------------------------------ radar (app-side signals)
  I.computeAlerts = function () {
    const port = E._port || E.portfolio(), out = [], today = V.today(), st = S();
    const add = (key, kind, title, body, rel, imp, urg, conf, group) => out.push({ key, kind, title, body, relevance: rel, impact: imp, urgency: urg, confidence: conf, group_key: group || key });
    const stories = I.stories(72, 150, port), ents = I.entities(port);
    for (const r of port.holdings) {
      const th = r.thesis || {};
      if (!th.why) { if (r.weight >= 0.05) add("nothesis:" + r.id, "second_look", `${r.ticker || r.name} is ${Math.round(r.weight * 100)}% of your portfolio with no written thesis`, { why: "Large positions without a recorded reason are hard to review honestly later.", evidence: [`Weight ${(r.weight * 100).toFixed(1)}% (calculated from live quotes)`], action: "Write why you own it, what you expect and what would prove you wrong.", ref: { kind: "holding", id: r.id } }, 0.9, 0.6, 0.3, 1); continue; }
      const terms = (th.indicators || []).map((t) => t.toLowerCase()).filter((t) => t.length > 2);
      const ent = ents.filter((e) => e.kind === "holding" && e.id === r.id);
      for (const s of stories) {
        const txt = norm(s.title + " " + (s.summary || ""));
        const nm = ent.length ? I.mentions(s.title + " " + (s.summary || ""), ent) : [];
        const ind = terms.filter((t) => txt.includes(t));
        const wrong = [...new Set(((th.wrong_if || "").toLowerCase().match(/[a-z]{5,}/g) || []).filter((w) => txt.includes(w) && !["would", "their", "there", "which", "about", "these", "those", "because", "could", "should", "company", "market", "price", "prices"].includes(w)))];
        if (!nm.length && ind.length < 2) continue;
        add(`thesis:${r.id}:${s.id}`, "thesis", "New evidence to weigh against your " + (r.ticker || r.name) + " thesis",
          { why: `You bought ${r.ticker || r.name} partly because: “${th.why.slice(0, 220)}”.`, latest: `Latest: “${s.title}” (${s.source}, ${new Date(s.published * 1000).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}).`,
            evidence: (nm.length ? ["Mentions the company"] : []).concat(ind.length ? ["Matches your indicators: " + ind.join(", ")] : [], wrong.length ? ["Touches your 'wrong if' condition: " + wrong.slice(0, 4).join(", ")] : []),
            wrong_if: th.wrong_if, link: s.link, action: "Read it and record whether it supports, weakens or doesn't change the thesis.", assessment: "Unassessed keyword match. Use ‘Assess with Claude’ for a reasoned read.", ref: { kind: "holding", id: r.id }, story: s.id },
          0.95, Math.min(1, 0.3 + r.weight * 4), 0.5, Math.min(0.9, 0.35 + 0.15 * ind.length + 0.15 * (wrong.length > 0)), "thesis:" + r.id);
      }
      const m1 = (r.returns["1m"] || {}).local;
      if (m1 != null && Math.abs(m1) >= 0.12 && !stories.some((s) => s.mentions.some((m) => m.id === r.id)))
        add(`quiet:${r.id}:${iso(today).slice(0, 7)}`, "second_look", `${r.ticker} is ${V.pct(m1, 0)} over a month with no matching coverage in your feeds`, { why: "A large move without visible news can mean information you haven't seen (sector rotation, a filing, analyst action).", evidence: [`1-month change ${V.pct(m1)} (calculated)`, "No story in the last 72h mentions it"], action: "Check filings and sector peers.", ref: { kind: "holding", id: r.id } }, 0.8, Math.min(1, Math.abs(m1) * 3 * (r.weight * 4 + 0.2)), 0.4, 0.7);
      if (r.pl_pct != null && r.pl_pct < -0.9 && r.account === "TFSA") add(`tfsa-loss:${r.id}`, "second_look", `${r.ticker} is down ${Math.round(-r.pl_pct * 100)}% inside your TFSA`, { why: "Capital losses inside a TFSA can't be claimed against gains, so a near-zero position there has no tax value; it only occupies contribution room.", evidence: [`Book cost ${V.money(r.cost_base, port.base)} · value ${V.money(r.value, port.base)}`], action: "Decide whether to keep it for optionality or clean it up.", ref: { kind: "holding", id: r.id } }, 0.7, 0.3, 0.2, 0.95);
    }
    for (const b of port.breaches) add(`breach:${b.kind}:${b.name}`, "exposure", `${b.kind === "position" ? "Position" : "Sector"} ${b.name} is ${Math.round(b.weight * 100)}% of the portfolio (limit ${Math.round(b.limit * 100)}%)`, { why: "You set this limit in Settings.", evidence: ["Weight calculated from live quotes and FX"], action: "Decide whether to trim, rebalance, or update the limit." }, 1, 0.7, 0.4, 1);
    for (const hx of port.hidden.slice(0, 4)) if (hx.weight >= 0.25) add("hidden:" + (hx.factor || hx.label) + ":" + hx.type, "exposure", "Hidden exposure: " + hx.headline, { why: "Seemingly different holdings share an underlying driver, so they may fall together.", evidence: hx.holdings.slice(0, 7).map((h) => `${h.ticker} (${h.sector}${h.sens != null ? `, sensitivity ${h.sens > 0 ? "+" : ""}${h.sens.toFixed(1)}` : ""})`), gaps: hx.gaps, action: "Open Portfolio → Exposure.", go: "portfolio/exposure" }, 0.85, Math.min(1, hx.weight), 0.2, hx.type === "statistical" ? 0.8 : 0.6);
    const usdTfsa = port.holdings.filter((r) => r.account === "TFSA" && r.currency === "USD" && r.income > 0);
    if (usdTfsa.length) { const inc = usdTfsa.reduce((a, r) => a + r.income, 0); add("tfsa-withholding", "second_look", `US dividends in your TFSA lose 15% to US withholding tax (≈${V.money(inc * 0.15, port.base)}/yr)`, { why: "The Canada-US tax treaty exempts US dividends in RRSPs, not TFSAs. The 15% withheld in a TFSA can't be recovered.", evidence: usdTfsa.map((r) => `${r.ticker}: ≈${V.money(r.income, port.base)}/yr in dividends`), action: "Consider which account holds your US dividend payers (check with a tax professional)." }, 0.8, Math.min(1, inc * 0.15 / 200), 0.2, 0.9); }
    const mem = I.memory();
    for (const x of mem.lost_touch.slice(0, 6)) if (+x.closeness >= 4 && x.days) add(`touch:${x.id}:${iso(today).slice(0, 7)}`, "relationship", `You haven't been in touch with ${x.name} for ${x.days} days`, { why: `Your cadence for this closeness is every ${x.cadence} days.`, evidence: [`Last logged interaction ${x.days} days ago`], action: "Draft a note.", ref: { kind: "contact", id: x.id } }, 0.8, 0.5, 0.5, 0.9);
    for (const p of mem.promises) if (p.overdue) add(`promise:${p.id}:${(p.text || "").slice(0, 20)}`, "relationship", `Overdue promise to ${p.name}: ${p.text}`, { why: "You recorded this commitment.", evidence: ["Due " + p.due], action: "Do it, or send a quick update.", ref: { kind: "contact", id: p.id } }, 1, 0.6, 0.9, 1);
    for (const m of mem.milestones) if (m.days <= 10 && m.rated !== false) add(`ms:${m.id}:${m.date}`, "relationship", `${m.name}: ${m.what} in ${m.days} days`, { why: "Early enough to plan something thoughtful.", evidence: ["Date " + m.date], ref: { kind: "contact", id: m.id } }, 0.8, 0.4, m.days <= 3 ? 0.8 : 0.5, 1);
    for (const r of mem.reasons.slice(0, 8)) add(`reason:${r.id}:${r.kind}`, "relationship", r.text, { why: "A natural reason to reach out.", evidence: [r.src || "calendar"], link: r.link, ref: { kind: "contact", id: r.id } }, 0.7, 0.35, 0.4, 0.75, r.group);
    const wk = I.weekAhead();
    for (const p of wk.prep) if (p.due <= iso(new Date(today.getTime() + DAY * 1000))) add("prep:" + p.event.id, "calendar", p.what, { why: "Preparation is due " + (p.overdue ? "now" : p.due) + ".", evidence: [p.event.start.slice(0, 16).replace("T", " ")], action: "Open preparation mode.", event: p.event.id }, 0.85, 0.5, 0.9, 1);
    for (const d of wk.days) for (const [a, b] of d.conflicts) add(`conflict:${d.date}:${a}:${b}`, "calendar", `Conflict on ${parseDay(d.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${a} overlaps ${b}`, { why: "Two timed events overlap.", evidence: [d.date], action: "Reschedule one." }, 1, 0.5, 0.8, 1);
    for (const dcs of st.records.decision) if (dcs.review_date && dcs.review_date <= iso(today) && !(dcs.reviews || []).length) add("review:" + dcs.id, "decision", "Time to review: " + dcs.title, { why: `You set a review date of ${dcs.review_date}.`, action: "Open decision replay.", ref: { kind: "decision", id: dcs.id } }, 0.9, 0.5, 0.7, 1);
    for (const s of stories.slice(0, 30)) {
      if (s.n_sources < 3 || !s.shocks.length || s.mentions.some((m) => m.kind === "holding")) continue;
      const sh = E.detectShocks(s.title + " " + (s.summary || ""));
      const big = []; for (const x of sh) for (const f of Object.keys(x.shock.impulse)) { const e = (port.exposures[f] || {}).value || 0; if (Math.abs(e) >= 0.25) big.push([f, e]); }
      if (big.length) { const [f, e] = big[0]; add("indirect:" + s.id, "second_look", `Indirect exposure: “${s.title}”`, { why: `None of your holdings are named, but your portfolio's net sensitivity to ${K.fl(f)} is ${e > 0 ? "+" : ""}${e.toFixed(2)}.`, evidence: [`Covered by ${s.n_sources} outlets`, "Top contributors: " + port.exposures[f].contributors.slice(0, 4).map(([t, c]) => `${t} ${c > 0 ? "+" : ""}${c.toFixed(2)}`).join(", ")], action: "Open ‘How does this affect me?’", story: s.id, link: s.link }, 0.75, Math.min(1, Math.abs(e) * 1.5), 0.5, 0.55, "story:" + s.id); }
    }
    for (const w of I.world()) if (w.score >= 50 && Math.abs(w.net) >= 0.03) add(`world:${w.id}:${iso(today)}`, "world", `${w.name} is ${w.status.toLowerCase()} and your portfolio leans ${w.net > 0 ? "positive" : "negative"} on it`, { why: w.facts.map((f) => f.text).slice(0, 2).join(". ") + ".", evidence: w.exposure.slice(0, 5).map((x) => `${x.ticker} tilt ${x.tilt > 0 ? "+" : ""}${x.tilt.toFixed(2)} (${(x.weight * 100).toFixed(1)}%)`), action: "Open the World tracker.", go: "world/" + w.id }, 0.85, Math.min(1, Math.abs(w.net) * 4), 0.6, 0.7);
    return out;
  };
  I.autoRadar = async function (force) {
    const key = "vt_radar_" + V.state.space;
    try { if (!force && Date.now() - +(localStorage.getItem(key) || 0) < 10 * 60e3) return; localStorage.setItem(key, Date.now()); } catch (e) { /* ignore */ }
    const t0 = now();
    const alerts = I.computeAlerts();
    await V.net("/api/alerts/upsert", { body: { alerts, stale_before: t0 - 1 } });
    const r = await V.net("/api/alerts");
    S().alerts = r.alerts;
    V.drawEngine && V.drawEngine();
    return r.alerts.length;
  };
  I.priorities = function () {
    const al = S().alerts, picks = [], kinds = {};
    for (const a of al) {
      if ((kinds[a.kind] || 0) >= 1 && al.length > 3) continue;
      kinds[a.kind] = (kinds[a.kind] || 0) + 1;
      const b = a.body || {};
      picks.push({ title: a.title, why: b.why, action: b.action, kind: KIND_LABEL[a.kind] || a.kind, scores: { relevance: a.relevance, impact: a.impact, urgency: a.urgency, confidence: a.confidence }, alert: a.id, ref: b.ref, event: b.event, story: b.story, go: b.go });
      if (picks.length === 3) break;
    }
    return picks;
  };
  const KIND_LABEL = (I.KIND_LABEL = { thesis: "Thesis monitor", price: "Price move", exposure: "Exposure", filing: "Filing", relationship: "Relationship", calendar: "Calendar", decision: "Decision review", second_look: "Second look", investor: "Investor filings", world: "World", market: "Markets", macro: "Macro" });

  I.since = function (port) {
    const s = S().settings, since = s.last_visit;
    if (!since) return { first: true };
    const out = { since, first: false };
    out.stories = new Set(S().news.filter((n) => n.published > since).map((n) => n.id)).size;
    out.alerts = S().alerts.filter((a) => a.created > since).slice(0, 8).map((a) => ({ id: a.id, title: a.title, kind: a.kind }));
    if (s.last_visit_value && port.total) out.value = { from: s.last_visit_value, to: port.total, delta: port.total - s.last_visit_value, pct: port.total / s.last_visit_value - 1 };
    out.movers = port.holdings.map((r) => { const h = S().hist(r.ticker); const p0 = h ? E.closeOn(h, since) : null; return p0 && r.price && r.price_src === "quote" ? { ticker: r.ticker, change: r.price / p0 - 1 } : null; }).filter((m) => m && Math.abs(m.change) >= 0.02).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 6);
    const newRec = {}; for (const [k, list] of Object.entries(S().records)) { const n = list.filter((r) => r._created > since).length; if (n) newRec[k] = n; }
    out.new_records = Object.entries(newRec).map(([kind, n]) => ({ kind, n }));
    return out;
  };
  I.riskChange = function (days = 30) {
    const snaps = S().snapshots.filter((s) => s.total);
    if (snaps.length < 2) return { available: false, note: `Vantage stores a portfolio snapshot every day. Comparisons need two days of history; ${snaps.length} so far.` };
    const target = iso(new Date(Date.now() - days * DAY * 1000));
    const old = snaps.find((s) => s.day >= target) || snaps[0], cur = snaps[snaps.length - 1];
    const w = (s) => { const v = s.values || {}; const tot = Object.values(v).reduce((a, x) => a + x, 0) || 1; return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x / tot])); };
    const a = w(old), b = w(cur);
    const wd = [...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => ({ name: k, from: a[k] || 0, to: b[k] || 0, delta: (b[k] || 0) - (a[k] || 0) })).filter((x) => Math.abs(x.delta) >= 0.01).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return { available: true, from: old.day, to: cur.day, value: [old.total, cur.total], weights: wd.slice(0, 8), note: `Compared with the snapshot from ${old.day} (closest to ${days} days ago).` };
  };
  I.replay = async function (did) {
    const d = S().records.decision.find((x) => x.id === did); if (!d) return null;
    const revs = (await V.net(`/api/r/decision/${did}/revisions`)).revisions;
    const original = revs.length ? revs[0].data : d, origTs = revs.length ? revs[0].ts : d._created;
    const amendments = revs.slice(1).filter((r) => r.action === "update").map((r) => ({ ts: r.ts, fields: Object.keys(r.data).filter((k) => JSON.stringify(r.data[k]) !== JSON.stringify(original[k])) }));
    const after = {}, t = (d.ticker || "").toUpperCase();
    if (t) {
      await S().ensure(["h:" + t, "q:" + t]);
      const q = S().quote(t), h = S().hist(t);
      if (q && q.p) { const p0 = d.price_at_decision || (h ? E.closeOn(h, origTs) : null); if (p0) after.price = { ticker: t, then: p0, now: q.p, change: q.p / p0 - 1, currency: q.c, label: "calculated from quote history" }; }
      const term = t.split(".")[0].toLowerCase();
      after.news = S().news.filter((n) => n.published > origTs && (norm(n.title).includes(term) || (q && norm(n.title).includes(I.companyKey(q.n).split(" ")[0])))).slice(0, 8);
    }
    const st = {}; for (const rv of d.reviews || []) Object.assign(st, rv.assumptions || {});
    const assumptions = (original.assumptions || []).map((a, i) => ({ text: typeof a === "string" ? a : a.text, confidence: typeof a === "string" ? null : a.confidence, status: st[i] || "unresolved" }));
    const tally = {}; for (const a of assumptions) tally[a.status] = (tally[a.status] || 0) + 1;
    return { decision: d, original, recorded: origTs, amendments, after, reviews: d.reviews || [], assumptions, tally };
  };

  // ------------------------------------------------------------------ search & chief of staff
  const SEARCH_KINDS = ["holding", "contact", "event", "decision", "note", "watch", "plan", "scenario", "investor"];
  const flat = (r) => Object.entries(r).filter(([k]) => !k.startsWith("_") && k !== "id").map(([, v]) => typeof v === "string" ? v : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? Object.values(x).join(" ") : "")).join(" ") : v && typeof v === "object" ? Object.values(v).join(" ") : "").join(" ");
  const labelOf = (r) => r.title || r.name || r.ticker || (r.text || "").slice(0, 60) || "record";
  I.search = function (q, limit = 20) {
    const terms = [...new Set((q.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2))];
    if (!terms.length) return [];
    const hits = [];
    for (const kind of SEARCH_KINDS) for (const r of S().records[kind]) {
      const txt = flat(r).toLowerCase(), title = labelOf(r).toLowerCase();
      let s = terms.reduce((a, t) => a + (txt.split(t).length - 1), 0) + terms.reduce((a, t) => a + (title.includes(t) ? 3 : 0), 0);
      if (s) { const i = txt.indexOf(terms[0]); hits.push({ kind, id: r.id, label: labelOf(r), score: s, snippet: flat(r).slice(Math.max(0, i - 50), i + 90) }); }
    }
    for (const n of S().news) { const tl = n.title.toLowerCase(); const s = terms.reduce((a, t) => a + (rx("\\b" + escRx(t), "").test(tl) ? 2 : 0), 0); if (s >= 2 || (s && terms.length === 1)) hits.push({ kind: "news", id: n.id, label: n.title, score: s * 0.8, snippet: n.source + " · " + V.time(n.published), link: n.link }); }
    for (const h of K.HOTSPOTS) if (terms.some((t) => h.name.toLowerCase().includes(t) || h.id.includes(t))) hits.push({ kind: "hotspot", id: h.id, label: "World: " + h.name, score: 5, snippet: h.region });
    for (const ind of Object.values(K.IND)) if (terms.every((t) => ind.name.toLowerCase().includes(t) || ind.id.includes(t))) hits.push({ kind: "indicator", id: ind.id, label: ind.name, score: 6, snippet: ind.desc.slice(0, 80) });
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  };
  const ref = (kind, id, text, label = "retrieved", link) => ({ text, ref: kind && id ? { kind, id } : null, label, link });
  I.ask = async function (q) {
    const ql = q.toLowerCase(), port = E._port || E.portfolio();
    const blocks = [], missing = [], actions = [];
    let intent = "search";
    if (/overlook|blind spot|missing|not seeing|what am i/.test(ql)) {
      intent = "overlook";
      const sl = S().alerts.filter((a) => a.kind === "second_look");
      blocks.push({ type: "retrieved", title: "Flagged for a second look", items: sl.slice(0, 5).map((a) => ref("alert", a.id, `${a.title} — ${(a.body || {}).why || ""}`)).concat(sl.length ? [] : [ref(null, null, "Nothing flagged right now.")]) });
      const wk = I.weekAhead();
      blocks.push({ type: "retrieved", title: "Preparation due this week", items: wk.prep.slice(0, 5).map((p) => ref("event", null, `${p.what} (due ${p.due})`)).concat(wk.conflicts ? [ref(null, null, wk.conflicts + " calendar conflict(s) this week.")] : []) });
      const mem = I.memory();
      blocks.push({ type: "retrieved", title: "People", items: mem.promises.slice(0, 4).map((p) => ref("contact", p.id, `Promise to ${p.name}: ${p.text}${p.overdue ? " (overdue)" : ""}`)).concat(mem.lost_touch.slice(0, 3).map((x) => ref("contact", x.id, `${x.name}: no contact in ${x.days || "?"} days`)))
        .concat(mem.milestones.filter((m) => m.days <= 7).slice(0, 4).map((m) => ref("contact", m.id, `${m.name}: ${m.what.toLowerCase()} ${m.days === 0 ? "today" : m.days === 1 ? "tomorrow" : "in " + m.days + " days"} (${m.date})`))) });
      const w = I.world().filter((x) => x.score >= 50);
      if (w.length) blocks.push({ type: "interpretation", title: "World situations touching your money", items: w.slice(0, 3).map((x) => ref("hotspot", x.id, `${x.name}: ${x.status} (${x.score}/100). Net portfolio lean ${x.net > 0 ? "positive" : "negative"}.`, "interpretation")) });
      if (port.hidden.length) blocks.push({ type: "interpretation", title: "Concentration you might not see", items: port.hidden.slice(0, 3).map((h) => ref(null, null, h.headline, "interpretation")) });
    } else if (/risk/.test(ql) && /chang|since|month|week|differ/.test(ql)) {
      intent = "risk";
      const rc = I.riskChange(/week/.test(ql) ? 7 : 30);
      if (!rc.available) missing.push(rc.note);
      else { blocks.push({ type: "retrieved", title: `What changed (${rc.from} → ${rc.to})`, items: [ref(null, null, `Portfolio value ${V.money(rc.value[0], port.base, 0)} → ${V.money(rc.value[1], port.base, 0)}`, "calculated")].concat(rc.weights.map((w) => ref(null, null, `${w.name} weight ${(w.from * 100).toFixed(1)}% → ${(w.to * 100).toFixed(1)}%`, "calculated"))) }); missing.push(rc.note); }
      const rk = E._risk;
      if (rk) blocks.push({ type: "retrieved", title: "Current risk (last 12 months of prices)", items: [ref(null, null, `Volatility ${(rk.vol * 100).toFixed(1)}%/yr · 1-in-20 bad day ≈ ${V.money(rk.var1d, port.base, 0)} · beta to S&P ${rk.beta != null ? rk.beta.toFixed(2) : "—"}`, "statistical")].concat(rk.contrib.slice(0, 4).map((c) => ref("holding", c.id, `${c.ticker}: ${(c.rc * 100).toFixed(0)}% of portfolio risk from ${(c.weight * 100).toFixed(1)}% of value`, "statistical"))) });
    } else if (/prepar|prep me|brief me/.test(ql)) {
      intent = "prep";
      const today = V.today();
      let evs = I.calendar(today, new Date(today.getTime() + 14 * DAY * 1000)).filter((e) => !e.all_day && ["professional", "personal"].includes(e.category));
      evs = evs.filter((e) => (e.people || []).length).concat(evs.filter((e) => !(e.people || []).length));
      if (/tomorrow/.test(ql)) { const tm = iso(new Date(today.getTime() + DAY * 1000)); evs = evs.filter((e) => e.start.slice(0, 10) === tm).concat(evs); }
      if (!evs.length) missing.push("No upcoming timed meetings in the next two weeks.");
      else {
        const e = evs[0], b = I.prep(e.id);
        blocks.push({ type: "retrieved", title: `Next meeting: ${e.title} (${new Date(e.start).toLocaleString()})`, items: b.people.map((p) => ref("contact", p.id, `${p.name} — ${[p.role, p.org].filter(Boolean).join(", ")}. ${(p.notes || "").slice(0, 160)}`)).concat(b.news.slice(0, 3).map((n) => ref(null, null, n.title, "fact", n.link))) });
        blocks.push({ type: "interpretation", title: "Suggested discussion points", items: b.points.slice(0, 6).map((p) => ref(null, null, p.text, p.label)) });
        missing.push(...b.missing);
        actions.push({ type: "open_prep", event: e.id, label: "Open full preparation mode" });
      }
    } else if (/challeng|assumption|thesis|wrong/.test(ql)) {
      intent = "challenge";
      const al = S().alerts.filter((a) => a.kind === "thesis");
      blocks.push({ type: "retrieved", title: "Recent evidence touching your theses", items: al.slice(0, 6).map((a) => ref("holding", (a.body.ref || {}).id, `${a.body.why || ""} ${a.body.latest || ""}`)).concat(al.length ? [] : [ref(null, null, "No recent stories matched your theses' companies or indicators.")]) });
      const no = port.holdings.filter((r) => !(r.thesis || {}).why && r.ticker !== "CASH");
      if (no.length) missing.push("No written thesis for: " + no.slice(0, 10).map((r) => r.ticker || r.name).join(", ") + ". The monitor can't check what isn't recorded.");
    } else if (/reconnect|catch up|trip|travel|visit/.test(ql)) {
      intent = "reconnect";
      const mem = I.memory();
      blocks.push({ type: "retrieved", title: "People where you're going", items: mem.reasons.filter((r) => r.kind === "trip").map((r) => ref("contact", r.id, r.text)).concat(mem.reasons.some((r) => r.kind === "trip") ? [] : [ref(null, null, "No upcoming travel events match a contact's city. Add a travel event with a location.")]) });
      blocks.push({ type: "retrieved", title: "Lapsed relationships", items: mem.lost_touch.slice(0, 6).map((x) => ref("contact", x.id, `${x.name} (${x.org || ""}): ${x.days ? x.days + " days since last contact" : "never logged"}`)) });
    } else if (/^who (do i know|in my network)|who could|who might/.test(ql)) {
      intent = "who";
      const w = I.who(q);
      blocks.push({ type: "retrieved", title: "People who match", items: w.results.slice(0, 8).map((r) => ref("contact", r.id, `${r.name} — ${[r.role, r.org].filter(Boolean).join(", ")} (${r.reasons.join("; ")})`)).concat(w.results.length ? [] : [ref(null, null, w.empty_reason || "No matches.")]) });
      if (w.paths.length) blocks.push({ type: "retrieved", title: "Known connection paths", items: w.paths.slice(0, 6).map((p) => ref(null, null, p.path.map((n) => n.name).join(" → ") + (p.verified ? "" : "  (unverified)"))) });
    }
    const hits = I.search(q);
    if (intent === "search" || !blocks.length) { blocks.push({ type: "retrieved", title: "Matching records", items: hits.slice(0, 10).map((h) => ref(h.kind, h.id, `${h.label} — ${h.snippet || ""}`, h.kind === "news" ? "fact" : "retrieved", h.link)) }); if (!hits.length) missing.push("No records matched. Try different words, or add the information to Vantage."); }
    let ai = null, aiErr = null;
    if (V.state.ai && V.state.ai.ok) {
      try {
        const ctx = { blocks, missing, portfolio: { base: port.base, total: Math.round(port.total), top: port.holdings.slice(0, 18).map((r) => [r.ticker, +r.weight.toFixed(3), r.sector]), hidden: port.hidden.slice(0, 4).map((h) => h.headline) } };
        ai = (await V.net("/api/ai", { body: { prompt: `Question: ${q}\n\nRecords retrieved from my Vantage data (cite them):\n${JSON.stringify(ctx).slice(0, 60000)}\n\nAnswer in Markdown with three sections: **What the records show** (retrieved, cited), **Interpretation**, **Missing or uncertain**. End with up to three next actions.`, effort: "medium" } })).text;
      } catch (e) { aiErr = e.message; }
    }
    const hist = ([{ q, ts: now(), intent }].concat(S().settings.ask_history || [])).slice(0, 30);
    S().settings.ask_history = hist; V.net("/api/settings", { body: { ask_history: hist } }).catch(() => {});
    return { q, intent, blocks, missing, actions, ai, ai_error: aiErr, ts: now() };
  };
})();
