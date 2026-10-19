/* Portfolio analytics, exposures, consequence map, scenario lab and statistical models.
   Labels: fact · calculated (arithmetic on your data) · estimate (rough model) · statistical (fitted
   on price history; association, not causation) · interpretation. */
"use strict";
(function () {
  const E = (V.engine = {});
  const K = V.kb;
  const S = () => V.store;
  const DAY = 86400;
  const now = () => Date.now() / 1000;
  const dayKey = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

  E.base = () => ((S().settings.base_currency || "CAD") + "").toUpperCase();

  function closeOn(series, ts) {
    if (!series || !series.length) return null;
    let lo = 0, hi = series.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (series[mid][0] <= ts) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans >= 0 ? series[ans][1] : null;
  }
  E.closeOn = closeOn;
  function fxOn(hist, iso) {
    if (!hist || !hist.length) return null;
    let lo = 0, hi = hist.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (hist[mid][0] <= iso) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return hist[ans][1];
  }
  E.fxOn = fxOn;
  E.convert = (amount, ccy, base, table) => {
    if (amount == null) return null;
    ccy = (ccy || base).toUpperCase();
    if (ccy === base) return amount;
    table = table || S().fxTable();
    if (!table[ccy] || !table[base]) return null;
    return (amount * table[ccy]) / table[base];
  };
  const fxRate = (ccy, base, iso) => {
    const a = ccy === "CAD" ? 1 : fxOn(S().fxHist(ccy), iso), b = base === "CAD" ? 1 : fxOn(S().fxHist(base), iso);
    return a && b ? a / b : null;
  };

  // ------------------------------------------------------------------ classification
  E.profile = function (h, q) {
    const pre = K.preset(h.ticker);
    let sector = h.sector || (pre && pre.sector), src = h.sector ? "your classification" : pre ? "built-in ticker preset" : null;
    if (!sector && q) {
      const ty = (q.ty || "").toUpperCase();
      if (ty === "CRYPTOCURRENCY") { sector = "Crypto"; src = "instrument type"; }
      else if (ty === "ETF" || ty === "MUTUALFUND") { sector = "Global Equity (broad)"; src = "instrument type (fund, assumed broad equity)"; }
    }
    if (!sector && (h.ticker || "").toUpperCase() === "CASH") { sector = "Cash"; src = "cash"; }
    if (!sector) { sector = "Unclassified"; src = "no classification: set a sector for better analysis"; }
    const [beta, sens0] = K.SECTORS[sector] || K.SECTORS.Unclassified;
    const sens = Object.assign({}, sens0);
    if (pre && pre.sector === sector) Object.assign(sens, pre.tweaks || {});
    const user = h.sensitivities || {};
    for (const [k, v] of Object.entries(user)) if (isFinite(+v)) sens[k] = +v;
    let country = h.country || (pre && pre.country);
    const t = (h.ticker || "").toUpperCase();
    if (!country) country = /\.(TO|V|NE|CN)$/.test(t) ? "CA" : /\.(AS)$/.test(t) ? "NL" : /\.(PA)$/.test(t) ? "FR" : sector === "Crypto" || sector === "Gold" ? "GLOBAL" : "US";
    const deps = [...new Set([...((pre && pre.deps) || []), ...(h.deps || [])])];
    return { sector, sector_source: src, beta: +(h.beta || beta), sens, sens_source: Object.keys(user).length ? "your overrides + " + src : src, country, deps };
  };

  // ------------------------------------------------------------------ portfolio
  const PERIODS = { "1d": 1, "1m": 30, ytd: null, "1y": 365 };
  E.portfolio = function () {
    const st = S(), base = E.base(), fx = st.fxTable(), t0 = now();
    const ystart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
    const rows = [], gaps = [];
    let total = 0;
    for (const h of st.records.holding) {
      const t = (h.ticker || "").toUpperCase();
      const q = t && t !== "CASH" ? st.quote(t) : null;
      const hist = t && t !== "CASH" ? st.hist(t) : null;
      let price = null, priceSrc = null, asof = null, ccy;
      const qAge = q && q.t ? t0 - q.t : null;
      const qStale = q && (qAge == null || qAge > 10 * DAY) && !(hist && hist.length > 5);
      if (t === "CASH") { price = 1; priceSrc = "cash"; }
      else if (q && q.p != null && !(qStale && h.broker_price != null)) { price = q.p; priceSrc = qStale ? "stale quote" : "quote"; asof = q.t || q.fetched; }
      else if (h.manual_price != null) { price = +h.manual_price; priceSrc = "manual"; }
      else if (h.broker_price != null) { price = +h.broker_price; priceSrc = "broker"; asof = h.broker_asof ? Date.parse(h.broker_asof) / 1000 : null; }
      ccy = ((t === "CASH" ? h.currency : priceSrc === "broker" ? h.broker_currency || (q && q.c) : h.currency || (q && q.c)) || h.broker_currency || base).toUpperCase();
      if (ccy === "GBP" && q && q.c === "GBp") { price = price / 100; }
      const qty = +h.quantity || 0;
      const vloc = price != null ? qty * price : null;
      const vbase = vloc != null ? E.convert(vloc, ccy, base, fx) : null;
      const prof = E.profile(h, q);
      let costBase = null, costNote = h.cost_note || "";
      if (h.cost_base_total != null) { costBase = +h.cost_base_total; costNote = costNote || "cost in " + base + " as entered"; }
      else if (h.cost != null && h.cost !== "") { const costCcy = (h.broker_currency && priceSrc !== "broker" && h.broker_currency !== ccy ? h.broker_currency : ccy); costBase = E.convert(qty * +h.cost, costCcy, base, fx); if (costCcy !== base) costNote = costNote || "converted at today's FX (purchase FX unknown)"; }
      const rets = {};
      if (price != null && (priceSrc === "quote" || priceSrc === "stale quote") && hist && hist.length > 1) {
        for (const [p, days] of Object.entries(PERIODS)) {
          let p0, ts0;
          if (p === "1d") { p0 = q && q.pc != null ? q.pc : hist[hist.length - 2][1]; ts0 = hist[hist.length - 2][0]; }
          else { ts0 = p === "ytd" ? ystart : t0 - days * DAY; p0 = closeOn(hist, ts0) || (p === "1y" ? hist[0][1] : null); }
          if (!p0) continue;
          const rl = price / p0 - 1;
          let rb = rl, fe = 0;
          if (ccy !== base) { const f0 = fxRate(ccy, base, dayKey(ts0)), f1 = fxRate(ccy, base, dayKey(t0)); if (f0 && f1) { rb = (1 + rl) * (f1 / f0) - 1; fe = rb - rl; } }
          rets[p] = { local: rl, base: rb, fx: fe };
        }
      }
      // dividends: trailing 12 months from market data, else broker-reported
      const dv = t ? st.div(t).filter((x) => x[0] > t0 - 365 * DAY) : [];
      let divPS = dv.reduce((a, x) => a + x[1], 0), divSrc = dv.length ? "market data (trailing 12 months)" : null;
      if (!divPS && h.div_annual_broker) { divPS = +h.div_annual_broker; divSrc = "broker-reported annual amount"; }
      const paid = divPS ? E.convert(divPS * qty, ccy === "CAD" && h.broker_currency === "CAD" ? "CAD" : ccy, base, fx) : 0;
      // a mutual fund paying once or twice a year is distributing realised capital gains, not a yield:
      // the price drops by the same amount, so it is shown separately and kept out of income
      const isFund = (st.series["h:" + t] || {}).ty === "MUTUALFUND" || (q && q.ty === "MUTUALFUND") || !!h.fund;
      const distribution = isFund && dv.length > 0 && dv.length <= 2 ? paid : 0, income = paid - distribution;
      // next ex-date: the broker's date when it is still ahead, else projected from the payment rhythm
      let divNext = null;
      if (h.div_ex_date && Date.parse(h.div_ex_date) / 1000 >= t0 - DAY) divNext = { d: h.div_ex_date, est: false };
      else {
        const all = t ? st.div(t) : [];
        if (all.length >= 3) {
          const gaps = all.slice(1).map((x, i) => x[0] - all[i][0]).sort((a, b) => a - b), g = gaps[gaps.length >> 1], last = all[all.length - 1][0];
          if (g > 20 * DAY && g < 400 * DAY && t0 - last < 1.5 * g) { let nx = last + g; while (nx < t0) nx += g; divNext = { d: V.iso(new Date(nx * 1000)), est: true }; }
        }
      }
      if (price == null) gaps.push({ id: h.id, ticker: t || h.name, issue: "no price (no quote, manual or broker price)" });
      else if (priceSrc === "stale quote") gaps.push({ id: h.id, ticker: t, issue: "quote looks stale" });
      if (prof.sector === "Unclassified") gaps.push({ id: h.id, ticker: t || h.name, issue: "unclassified: driver exposures unknown" });
      rows.push(Object.assign({
        id: h.id, ticker: t, name: h.name || (q && q.n) || h.broker_name || t, account: h.account || "Unassigned", quantity: qty, price, price_src: priceSrc, price_asof: asof,
        currency: ccy, value_local: vloc, value: vbase, cost_base: costBase, cost_note: costNote, pl: vbase != null && costBase ? vbase - costBase : null,
        pl_pct: vbase != null && costBase ? vbase / costBase - 1 : null, returns: rets, thesis: h.thesis || {}, target_weight: h.target_weight, note: h.note,
        income, distribution, div_ps: divPS, div_src: divSrc, div_ex: h.div_ex_date, div_next: divNext, div_last: t && st.div(t).length ? st.div(t)[st.div(t).length - 1] : null, fund: h.fund, broker_symbol: h.broker_symbol,
      }, prof));
      total += vbase || 0;
    }
    for (const r of rows) r.weight = total ? (r.value || 0) / total : 0;
    rows.sort((a, b) => (b.value || 0) - (a.value || 0));
    const group = (key) => {
      const g = {};
      for (const r of rows) g[r[key]] = (g[r[key]] || 0) + r.weight;
      return Object.entries(g).map(([name, weight]) => ({ name, weight })).sort((a, b) => b.weight - a.weight);
    };
    const hhi = rows.reduce((a, r) => a + r.weight ** 2, 0);
    const exposures = {};
    for (const f of Object.keys(K.FACTORS)) {
      const contrib = rows.filter((r) => r.sens[f]).map((r) => [r.ticker || r.name, r.weight * r.sens[f]]);
      exposures[f] = { value: contrib.reduce((a, c) => a + c[1], 0), contributors: contrib.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8) };
    }
    const portRets = {};
    for (const p of Object.keys(PERIODS)) {
      let num = 0, den = 0, fxn = 0;
      for (const r of rows) { const rr = r.returns[p]; if (rr && r.value) { const sv = r.value / (1 + rr.base); num += r.value - sv; den += sv; fxn += sv * rr.fx; } }
      if (den) portRets[p] = { base: num / den, fx: fxn / den, coverage: den / (total || 1) };
    }
    const benchCfg = st.settings.benchmark || [{ ticker: "^GSPC", w: 0.6 }, { ticker: "^GSPTSE", w: 0.4 }];
    const bench = benchmark(benchCfg, base);
    const limits = { max_position: st.settings.max_position || 0.15, max_sector: st.settings.max_sector || 0.35 };
    const broad = new Set(["Cash", "Global Equity (broad)", "US Equity (broad)", "Canada Equity (broad)", "Bonds"]);
    const breaches = [];
    for (const r of rows) if (r.weight > limits.max_position && !broad.has(r.sector)) breaches.push({ kind: "position", name: r.ticker || r.name, weight: r.weight, limit: limits.max_position });
    for (const g of group("sector")) if (g.weight > limits.max_sector && !broad.has(g.name)) breaches.push({ kind: "sector", name: g.name, weight: g.weight, limit: limits.max_sector });
    const cost = rows.reduce((a, r) => a + (r.cost_base || 0), 0), costCovered = rows.filter((r) => r.cost_base).reduce((a, r) => a + (r.value || 0), 0);
    const income = rows.reduce((a, r) => a + (r.income || 0), 0), distributions = rows.reduce((a, r) => a + (r.distribution || 0), 0);
    const out = {
      base, total, holdings: rows, count: rows.length, by_sector: group("sector"), by_country: group("country"), by_currency: group("currency"), by_account: group("account"),
      top1: rows[0] ? rows[0].weight : 0, top5: rows.slice(0, 5).reduce((a, r) => a + r.weight, 0), effective_n: hhi ? 1 / hhi : 0,
      exposures, hidden: hiddenExposures(rows, exposures), returns: portRets, benchmark: bench, limits, breaches, gaps, fx,
      series: valueSeries(rows, base, bench), asof: Math.max(0, ...rows.map((r) => r.price_asof || 0)),
      pl: rows.reduce((a, r) => a + (r.pl || 0), 0), cost, cost_coverage: total ? costCovered / total : 0, income, distributions, yield: total ? income / total : 0,
      accounts: accountSummary(rows, total),
      notes: ["Performance uses current quantities throughout (trades aren't modelled).", "Index benchmarks are price returns (no dividends).", "FX from Bank of Canada daily rates; quotes from Yahoo Finance (unofficial, may be delayed)."],
    };
    E._port = out;
    return out;
  };
  function accountSummary(rows, total) {
    const a = {};
    for (const r of rows) { const k = r.account; a[k] = a[k] || { name: k, value: 0, cost: 0, pl: 0, n: 0, known: 0, income: 0, dist: 0 }; a[k].dist += r.distribution || 0; a[k].value += r.value || 0; a[k].cost += r.cost_base || 0; a[k].pl += r.pl || 0; a[k].n++; if (r.pl != null) a[k].known++; a[k].income += r.income || 0; }
    return Object.values(a).map((x) => Object.assign(x, { weight: total ? x.value / total : 0 })).sort((x, y) => y.value - x.value);
  }
  function benchmark(cfg, base) {
    const st = S(), parts = [], t0 = now();
    for (const b of cfg) {
      const h = st.hist(b.ticker), q = st.quote(b.ticker);
      if (!h || !q) { parts.push({ ticker: b.ticker, w: b.w, error: "unavailable" }); continue; }
      const rets = {};
      for (const [p, days] of Object.entries(PERIODS)) {
        let p0, ts0;
        if (p === "1d") { p0 = q.pc; ts0 = h.length > 1 ? h[h.length - 2][0] : t0; }
        else { ts0 = p === "ytd" ? new Date(new Date().getFullYear(), 0, 1).getTime() / 1000 : t0 - days * DAY; p0 = closeOn(h, ts0) || (p === "1y" ? h[0][1] : null); }
        if (!p0) continue;
        const rl = q.p / p0 - 1; let rb = rl;
        const ccy = q.c || "USD";
        if (ccy !== base) { const f0 = fxRate(ccy, base, dayKey(ts0)), f1 = fxRate(ccy, base, dayKey(t0)); if (f0 && f1) rb = (1 + rl) * f1 / f0 - 1; }
        rets[p] = { local: rl, base: rb };
      }
      parts.push({ ticker: b.ticker, name: q.n, w: b.w, currency: q.c, returns: rets });
    }
    const blend = {};
    for (const p of Object.keys(PERIODS)) {
      const ps = parts.filter((x) => x.returns && x.returns[p]).map((x) => [x.w, x.returns[p].base]);
      if (ps.length) { const ws = ps.reduce((a, x) => a + x[0], 0); blend[p] = ps.reduce((a, x) => a + x[0] * x[1], 0) / ws; }
    }
    return { parts, blend };
  }
  function valueSeries(rows, base, bench) {
    const st = S();
    const priced = rows.filter((r) => (r.price_src === "quote" || r.price_src === "stale quote") && st.hist(r.ticker));
    if (!priced.length) return null;
    const ref = priced.reduce((a, r) => (st.hist(r.ticker).length > st.hist(a.ticker).length ? r : a), priced[0]);
    const t1 = now(), t0 = t1 - 365 * DAY;
    const days = st.hist(ref.ticker).map((p) => p[0]).filter((t) => t >= t0).filter((_, i, a) => i % 3 === 0 || i === a.length - 1);
    const staticV = rows.filter((r) => !priced.includes(r)).reduce((a, r) => a + (r.value || 0), 0);
    const pts = days.map((ts) => {
      const iso = dayKey(ts);
      let v = staticV;
      for (const r of priced) {
        const h = st.hist(r.ticker); let c = closeOn(h, ts); if (c == null) c = h[0][1];
        const f = r.currency === base ? 1 : fxRate(r.currency, base, iso) || 1;
        v += r.quantity * c * f;
      }
      let bv = 0, bw = 0;
      for (const b of bench.parts) { const h = st.hist(b.ticker); if (!h) continue; const c0 = closeOn(h, t0) || h[0][1]; const c = closeOn(h, ts) || c0; bv += b.w * c / c0; bw += b.w; }
      return [ts, v, bw ? bv / bw : null];
    });
    const v0 = pts[0][1] || 1;
    return pts.map(([t, v, b]) => [t, (v / v0) * 100, b ? b * 100 : null, v]);
  }
  function hiddenExposures(rows, exposures) {
    const out = [];
    for (const [f] of Object.entries(exposures)) {
      if (f === "growth" || f === "risk") continue;
      const members = rows.filter((r) => Math.abs(r.sens[f] || 0) >= 0.45 && r.weight > 0.005);
      for (const sign of [1, -1]) {
        const grp = members.filter((r) => Math.sign(r.sens[f]) === sign);
        const sectors = new Set(grp.map((r) => r.sector));
        const w = grp.reduce((a, r) => a + r.weight, 0);
        if (grp.length >= 2 && sectors.size >= 2 && w >= 0.12) out.push({ type: "driver", factor: f, label: K.FACTORS[f][0], direction: sign, weight: w,
          holdings: grp.sort((a, b) => b.weight - a.weight).map((r) => ({ ticker: r.ticker || r.name, sector: r.sector, sens: r.sens[f], weight: r.weight, src: r.sens_source })),
          headline: `${grp.length} holdings across ${sectors.size} sectors (${Math.round(w * 100)}% of portfolio) all ${sign > 0 ? "benefit from rising" : "are hurt by rising"} ${K.fl(f)}`,
          gaps: grp.filter((r) => (r.sens_source || "").includes("default") || r.sector === "Unclassified").map((r) => r.ticker) });
      }
    }
    const deps = {};
    for (const r of rows) for (const d of r.deps) (deps[d.toLowerCase()] = deps[d.toLowerCase()] || [d, []])[1].push(r);
    for (const [, [label, grp]] of Object.entries(deps)) if (grp.length >= 2) {
      const w = grp.reduce((a, r) => a + r.weight, 0);
      out.push({ type: "dependency", label, weight: w, holdings: grp.map((r) => ({ ticker: r.ticker || r.name, sector: r.sector, weight: r.weight })),
        headline: `${grp.length} holdings (${Math.round(w * 100)}%) share a dependency on ${label}`, gaps: ["Dependencies come from built-in reference notes and your tags; verify against filings."] });
    }
    const usd = rows.filter((r) => r.currency === "USD").reduce((a, r) => a + r.weight, 0);
    if (usd > 0.4) out.push({ type: "currency", label: "US dollar", weight: usd, holdings: rows.filter((r) => r.currency === "USD").slice(0, 12).map((r) => ({ ticker: r.ticker, sector: r.sector, weight: r.weight })),
      headline: `${Math.round(usd * 100)}% of the portfolio is priced in US dollars: a stronger loonie lowers its value in your base currency`, gaps: [] });
    // statistical: holdings that actually move together (from price history)
    const cl = E.clusters ? E.clusters() : [];
    for (const c of cl) if (c.weight >= 0.15 && c.members.length >= 3) out.push({ type: "statistical", label: "moves together", weight: c.weight, holdings: c.members.map((m) => ({ ticker: m.ticker, sector: m.sector, weight: m.weight })),
      headline: `${c.members.length} holdings (${Math.round(c.weight * 100)}%) have moved together over the past year (average correlation ${c.avg.toFixed(2)})`, gaps: ["Correlation from daily returns over the last year; it describes co-movement, not cause."] });
    return out.sort((a, b) => b.weight - a.weight);
  }

  // ------------------------------------------------------------------ statistics
  function alignedReturns(tickers, lookback = 400) {
    const st = S(), t0 = now() - lookback * DAY;
    const maps = tickers.map((t) => { const h = st.hist(t); const m = new Map(); if (h) for (const [ts, c] of h) if (ts >= t0) m.set(dayKey(ts), c); return m; });
    let dates = null;
    for (const m of maps) { const ks = new Set(m.keys()); dates = dates ? new Set([...dates].filter((d) => ks.has(d))) : ks; }
    dates = [...(dates || [])].sort();
    return { dates, prices: maps.map((m) => dates.map((d) => m.get(d))) };
  }
  function solve(A, b) { // Gaussian elimination with partial pivoting
    const n = A.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  function invert(A) { const n = A.length; return A.map((_, j) => solve(A, A.map((_, i) => (i === j ? 1 : 0)))).reduce((acc, col, j) => { col && col.forEach((v, i) => ((acc[i] = acc[i] || [])[j] = v)); return acc; }, []); }
  E.ols = function (y, X) {
    const n = y.length, k = X[0].length + 1;
    const Z = X.map((r) => [1, ...r]);
    const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => Z.reduce((a, r) => a + r[i] * r[j], 0)));
    const Xty = Array.from({ length: k }, (_, i) => Z.reduce((a, r, t) => a + r[i] * y[t], 0));
    const b = solve(XtX, Xty); if (!b) return null;
    const res = y.map((v, t) => v - Z[t].reduce((a, x, i) => a + x * b[i], 0));
    const sse = res.reduce((a, e) => a + e * e, 0), my = y.reduce((a, v) => a + v, 0) / n, sst = y.reduce((a, v) => a + (v - my) ** 2, 0);
    const s2 = sse / Math.max(1, n - k), inv = invert(XtX);
    const se = inv ? inv.map((r, i) => Math.sqrt(Math.max(0, r[i] * s2))) : b.map(() => NaN);
    return { b, se, t: b.map((v, i) => v / se[i]), r2: sst ? 1 - sse / sst : 0, n, resid_vol: Math.sqrt(s2) };
  };
  E.FACTORS_STAT = [
    { id: "mkt", label: "S&P 500", unit: "per +1% S&P 500", scale: 0.01, driver: "market" },
    { id: "tech", label: "Tech tilt (Nasdaq − S&P)", unit: "per +1% Nasdaq vs S&P", scale: 0.01, driver: "tech" },
    { id: "rates", label: "US 10-year yield", unit: "per +10 bp", scale: 0.1, driver: "rates" },
    { id: "oil", label: "WTI crude", unit: "per +10% oil", scale: 0.1, driver: "oil" },
    { id: "usd", label: "US dollar index", unit: "per +1% USD", scale: 0.01, driver: "usd" },
  ];
  E.factorModel = function () {
    if (E._fm && E._fm.at > now() - 600) return E._fm;
    const st = S(), port = E._port || E.portfolio();
    const F = ["^GSPC", "^IXIC", "^TNX", "CL=F", "DX-Y.NYB"];
    const out = { at: now(), rows: [], ok: false };
    for (const r of port.holdings) {
      if (!r.ticker || r.ticker === "CASH" || !st.hist(r.ticker)) continue;
      const { prices } = alignedReturns([r.ticker, ...F], 380);
      const n = prices[0].length;
      if (n < 120) { out.rows.push({ ticker: r.ticker, id: r.id, weight: r.weight, insufficient: n }); continue; }
      const y = [], X = [];
      for (let i = 1; i < n; i++) {
        const ret = (j) => prices[j][i] / prices[j][i - 1] - 1;
        const yy = ret(0); if (!isFinite(yy) || Math.abs(yy) > 0.6) continue;
        const mkt = ret(1), tech = ret(2) - mkt, rates = prices[3][i] - prices[3][i - 1], oil = ret(4), usd = ret(5);
        if (![mkt, tech, rates, oil, usd].every(isFinite) || Math.abs(oil) > 0.5) continue;
        y.push(yy); X.push([mkt, tech, rates, oil, usd]);
      }
      // a quote that almost never changes (a halted or defunct listing at $0.0001) has no usable returns
      const moves = y.filter((v) => v !== 0).length;
      if (moves < 30) { out.rows.push({ ticker: r.ticker, id: r.id, weight: r.weight, illiquid: moves }); continue; }
      const fit = E.ols(y, X);
      if (!fit) continue;
      out.rows.push({ ticker: r.ticker, id: r.id, weight: r.weight, sector: r.sector, n: fit.n, r2: fit.r2, alpha: fit.b[0] * 252, resid: fit.resid_vol * Math.sqrt(252),
        betas: Object.fromEntries(E.FACTORS_STAT.map((f, i) => [f.id, { b: fit.b[i + 1], t: fit.t[i + 1], per: fit.b[i + 1] * f.scale }])) });
    }
    const fitted = out.rows.filter((r) => r.betas);
    const w = fitted.reduce((a, r) => a + r.weight, 0);
    out.coverage = w;
    out.portfolio = Object.fromEntries(E.FACTORS_STAT.map((f) => [f.id, fitted.reduce((a, r) => a + r.weight * r.betas[f.id].per, 0) / (w || 1)]));
    out.ok = fitted.length > 0;
    E._fm = out;
    return out;
  };
  E.risk = function () {
    const st = S(), port = E._port || E.portfolio(), base = port.base;
    // dates are intersected across holdings, so one symbol with a short history (e.g. a CDR Yahoo only
    // quotes today) would starve every other one: those are left out and listed as not covered
    const invested = port.holdings.filter((r) => r.ticker && r.ticker !== "CASH");
    const hs = invested.filter((r) => (st.hist(r.ticker) || []).length >= 120 && (r.price_src === "quote" || r.price_src === "stale quote"));
    const missing = invested.filter((r) => !hs.includes(r)).map((r) => r.ticker);
    if (hs.length < 2) return null;
    const { dates, prices } = alignedReturns(hs.map((r) => r.ticker), 380);
    if (dates.length < 60) return null;
    const fxs = hs.map((r) => (r.currency === base ? null : r.currency));
    const R = hs.map((r, j) => {
      const out = [];
      for (let i = 1; i < dates.length; i++) {
        let v = prices[j][i] / prices[j][i - 1] - 1;
        if (fxs[j]) { const f0 = fxRate(fxs[j], base, dates[i - 1]), f1 = fxRate(fxs[j], base, dates[i]); if (f0 && f1) v = (1 + v) * f1 / f0 - 1; }
        out.push(Math.abs(v) > 0.6 ? 0 : v);
      }
      return out;
    });
    const covered = hs.reduce((a, r) => a + r.weight, 0);
    const w = hs.map((r) => r.weight / covered);
    const T = R[0].length;
    const pr = Array.from({ length: T }, (_, i) => R.reduce((a, col, j) => a + w[j] * col[i], 0));
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const mu = R.map(mean);
    const cov = R.map((a, i) => R.map((b, j) => a.reduce((s, x, t) => s + (x - mu[i]) * (b[t] - mu[j]), 0) / (T - 1)));
    const sigma2 = w.reduce((s, wi, i) => s + wi * cov[i].reduce((t, c, j) => t + c * w[j], 0), 0);
    const vol = Math.sqrt(sigma2 * 252);
    const contrib = hs.map((r, i) => ({ ticker: r.ticker, id: r.id, weight: r.weight, rc: (w[i] * cov[i].reduce((t, c, j) => t + c * w[j], 0)) / sigma2, vol: Math.sqrt(cov[i][i] * 252) }))
      .sort((a, b) => b.rc - a.rc);
    const sorted = [...pr].sort((a, b) => a - b);
    const q05 = sorted[Math.floor(0.05 * sorted.length)];
    const m21 = []; for (let i = 21; i <= pr.length; i++) m21.push(pr.slice(i - 21, i).reduce((a, x) => a * (1 + x), 1) - 1);
    const m21s = [...m21].sort((a, b) => a - b), q05m = m21s[Math.floor(0.05 * m21s.length)];
    let peak = 1, lvl = 1, mdd = 0; for (const x of pr) { lvl *= 1 + x; peak = Math.max(peak, lvl); mdd = Math.min(mdd, lvl / peak - 1); }
    const spx = alignedReturns(["^GSPC", ...hs.map((r) => r.ticker)], 380);
    let beta = null;
    if (spx.dates.length === dates.length) {
      const m = spx.prices[0].slice(1).map((p, i) => p / spx.prices[0][i] - 1);
      const mm = mean(m), mp = mean(pr);
      beta = m.reduce((a, x, i) => a + (x - mm) * (pr[i] - mp), 0) / m.reduce((a, x) => a + (x - mm) ** 2, 0);
    }
    const corr = cov.map((row, i) => row.map((c, j) => c / Math.sqrt(cov[i][i] * cov[j][j])));
    const value = port.total * covered;
    return { tickers: hs.map((r) => r.ticker), ids: hs.map((r) => r.id), sectors: hs.map((r) => r.sector), weights: hs.map((r) => r.weight), corr, vol, beta, mdd, coverage: covered,
      var1d: -q05 * value, var1m: -q05m * value, var1d_pct: -q05, var1m_pct: -q05m, contrib, days: T, from: dates[0], to: dates[dates.length - 1],
      worst: Math.min(...pr), best: Math.max(...pr), series: pr, missing };
  };
  E.clusters = function () {
    const rk = E._risk || null; if (!rk) return [];
    const n = rk.tickers.length; let groups = rk.tickers.map((_, i) => [i]);
    const avgc = (a, b) => { let s = 0, c = 0; for (const i of a) for (const j of b) { s += rk.corr[i][j]; c++; } return s / c; };
    while (groups.length > 1) {
      let best = null;
      for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) { const c = avgc(groups[i], groups[j]); if (!best || c > best[0]) best = [c, i, j]; }
      if (!best || best[0] < 0.6) break;
      groups[best[1]] = groups[best[1]].concat(groups[best[2]]); groups.splice(best[2], 1);
    }
    return groups.filter((g) => g.length >= 2).map((g) => {
      let s = 0, c = 0; for (const i of g) for (const j of g) if (i < j) { s += rk.corr[i][j]; c++; }
      return { members: g.map((i) => ({ ticker: rk.tickers[i], sector: rk.sectors[i], weight: rk.weights[i] })), weight: g.reduce((a, i) => a + rk.weights[i], 0), avg: c ? s / c : 1 };
    }).sort((a, b) => b.weight - a.weight);
  };
  E.analytics = function () { E._risk = E.risk(); E.portfolio(); return { risk: E._risk, factors: E.factorModel(), clusters: E.clusters() }; };

  // ------------------------------------------------------------------ consequence map
  E.detectShocks = function (text) {
    const t = " " + (text || "").toLowerCase() + " ";
    const found = [];
    for (const s of K.SHOCKS) {
      const rx = new RegExp(s.rx.source, "gi");
      const hits = t.match(rx);
      if (!hits) continue;
      const dir = s.neg && s.neg.test(t) ? -1 : 1;
      found.push({ shock: s, dir, terms: [...new Set(hits.map((h) => h.trim()))].slice(0, 5), n: hits.length });
    }
    return found.sort((a, b) => b.n - a.n).slice(0, 3);
  };
  E.propagate = function (impulses, floor = 0.12) {
    const direct = Object.assign({}, impulses), total = Object.assign({}, impulses), paths = [];
    const nxt = {};
    for (const e of K.EDGES) {
      const [a, b, sign, strength] = e;
      if (a in direct) { const v = direct[a] * sign * strength; if (Math.abs(v) >= floor && !(b in direct)) { nxt[b] = (nxt[b] || 0) + v; paths.push([a, b, v, e]); } }
    }
    for (const [k, v] of Object.entries(nxt)) total[k] = Math.max(-1.2, Math.min(1.2, (total[k] || 0) + v));
    return { direct, total, paths };
  };
  E.impactMap = function (title, text, storyId, extra) {
    const shocks = E.detectShocks(title + " " + (text || ""));
    let impulses = {};
    shocks.forEach((s, i) => { for (const [f, v] of Object.entries(s.shock.impulse)) impulses[f] = (impulses[f] || 0) + v * s.dir * (i === 0 ? 1 : 0.6); });
    if (extra) Object.assign(impulses, extra);
    for (const k in impulses) impulses[k] = Math.max(-1.2, Math.min(1.2, impulses[k]));
    const { direct, total, paths } = E.propagate(impulses);
    const port = E._port || E.portfolio();
    const nodes = [{ id: "ev", layer: 0, label: title.slice(0, 90), kind: "event" }], edges = [];
    for (const [f, v] of Object.entries(total)) nodes.push({ id: "f:" + f, layer: f in direct ? 1 : 2, label: K.FACTORS[f][0], kind: "driver", value: v, desc: K.FACTORS[f][1] });
    for (const s of shocks) for (const [f, v] of Object.entries(s.shock.impulse)) {
      if (!(f in direct)) continue;
      edges.push({ from: "ev", to: "f:" + f, sign: v * s.dir > 0 ? 1 : -1, strength: Math.min(1, Math.abs(v)), type: "interpretation", horizon: "immediate",
        logic: `The story's language (${s.terms.slice(0, 3).map((x) => `"${x}"`).join(", ")}) matches '${s.shock.label}', which implies ${K.fl(f)} ${v * s.dir > 0 ? "rising" : "falling"}.`,
        evidence: "Pattern match on headline and summary. Direction inferred from wording; verify against the source.", uncertainty: s.n > 1 ? "medium" : "high",
        offsets: s.shock.counter, threshold: s.shock.watch.slice(0, 2).join("; "), watch: s.shock.watch });
    }
    if (extra && !shocks.length) for (const [f, v] of Object.entries(extra)) edges.push({ from: "ev", to: "f:" + f, sign: v > 0 ? 1 : -1, strength: Math.min(1, Math.abs(v)), type: "interpretation", horizon: "immediate",
      logic: `This situation mainly works through ${K.fl(f)}.`, evidence: "Hotspot profile in the knowledge base.", uncertainty: "medium", offsets: "Markets often price only part of a disruption until it persists.", threshold: "A sustained disruption, not a headline." });
    for (const [a, b, v, e] of paths) edges.push({ from: "f:" + a, to: "f:" + b, sign: v > 0 ? 1 : -1, strength: Math.abs(v), type: "interpretation", horizon: e[4], logic: e[5], evidence: e[6], uncertainty: e[7], offsets: e[8], threshold: e[9] });
    const sectorNames = [...new Set(port.holdings.map((r) => r.sector))];
    const sectorScores = {};
    for (const sname of sectorNames.length ? sectorNames : ["US Equity (broad)", "Energy", "Banks", "Technology"]) {
      const sens = (K.SECTORS[sname] || [1, {}])[1];
      const sc = Object.entries(total).reduce((a, [f, v]) => a + (sens[f] || 0) * v, 0);
      if (Math.abs(sc) < 0.08) continue;
      sectorScores[sname] = sc;
      nodes.push({ id: "s:" + sname, layer: 3, label: sname, kind: "industry", value: sc });
      for (const [f, v] of Object.entries(total)) {
        const sv = sens[f] || 0;
        if (Math.abs(sv * v) >= 0.08) edges.push({ from: "f:" + f, to: "s:" + sname, sign: sv * v > 0 ? 1 : -1, strength: Math.min(1, Math.abs(sv * v)), type: "estimate", horizon: "varies",
          logic: `${sname} tends to ${sv > 0 ? "gain" : "suffer"} when ${K.fl(f)} rises (built-in sensitivity ${sv > 0 ? "+" : ""}${sv.toFixed(1)}).`,
          evidence: "Rough sector sensitivity (editable per holding). Not a forecast.", uncertainty: "medium", offsets: "Company specifics often dominate.", threshold: `The ${K.fl(f)} move must be large and persistent relative to expectations.` });
      }
    }
    const impacts = port.holdings.map((r) => {
      const contrib = Object.entries(total).filter(([f]) => r.sens[f]).map(([f, v]) => [f, r.sens[f] * v]);
      return [r, contrib.reduce((a, c) => a + c[1], 0), contrib];
    }).filter(([r, sc]) => Math.abs(sc) >= 0.08 && r.sector in sectorScores).sort((a, b) => Math.abs(b[1]) * (b[0].weight + 0.02) - Math.abs(a[1]) * (a[0].weight + 0.02));
    for (const [r, sc, contrib] of impacts.slice(0, 11)) {
      const hid = "h:" + r.id;
      nodes.push({ id: hid, layer: 4, label: r.ticker || r.name, kind: "holding", value: sc, weight: r.weight, ref: { kind: "holding", id: r.id } });
      const top = contrib.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
      edges.push({ from: "s:" + r.sector, to: hid, sign: sc > 0 ? 1 : -1, strength: Math.min(1, Math.abs(sc)), type: "calculated", horizon: "varies",
        logic: `${r.ticker || r.name} (${(r.weight * 100).toFixed(1)}% of your portfolio): net tilt ${sc > 0 ? "+" : ""}${sc.toFixed(2)} from ${top.map(([f, c]) => `${K.fl(f)} ${c > 0 ? "+" : ""}${c.toFixed(2)}`).join(", ")}.`,
        evidence: `Your position weight × sensitivities (${r.sens_source || "defaults"}).` + (r.thesis && r.thesis.why ? ` Your thesis: “${r.thesis.why.slice(0, 160)}”` : ""),
        uncertainty: /preset|override/.test(r.sens_source || "") ? "medium" : "high", offsets: "Business-level hedges (pricing power, currency) aren't modelled.",
        threshold: "Only matters if the move changes earnings expectations or the valuation multiple." });
    }
    for (const p of S().records.plan) {
      const pf = p.factors || K.PLAN_TEMPLATES[p.template] || {};
      const contrib = Object.entries(total).filter(([f]) => pf[f]).map(([f, v]) => [f, pf[f] * v]);
      const sc = contrib.reduce((a, c) => a + c[1], 0);
      if (Math.abs(sc) < 0.08) continue;
      const pid = "p:" + p.id;
      nodes.push({ id: pid, layer: 4, label: p.title || "Plan", kind: "plan", value: sc, ref: { kind: "plan", id: p.id } });
      for (const [f, c] of contrib) if (Math.abs(c) >= 0.08) edges.push({ from: "f:" + f, to: pid, sign: c > 0 ? 1 : -1, strength: Math.min(1, Math.abs(c)), type: "interpretation", horizon: p.horizon || "your timeline",
        logic: `Your plan “${p.title}” is ${c > 0 ? "helped" : "hurt"} by ${K.fl(f)} ${total[f] > 0 ? "rising" : "falling"}.`, evidence: "Plan-to-driver mapping.", uncertainty: "medium", offsets: "Depends on timing.", threshold: "Only matters if the move persists into your plan's window." });
    }
    const tilt = impacts.reduce((a, [r, sc]) => a + r.weight * sc, 0);
    const gains = impacts.filter((x) => x[1] > 0).map((x) => x[0].ticker).slice(0, 4), losses = impacts.filter((x) => x[1] < 0).map((x) => x[0].ticker).slice(0, 4);
    const offsets = [];
    if (gains.length && losses.length) offsets.push(`Partly offsetting inside your portfolio: ${gains.join(", ")} lean positive while ${losses.join(", ")} lean negative.`);
    for (const s of shocks) offsets.push(s.shock.counter);
    const eps = K.EPISODES.filter((e) => e.applies.some((a) => Math.abs(direct[a] || 0) > 0.3)).slice(0, 2);
    // empirical check from fitted betas, where the driver has a market proxy
    const fm = E._fm; let empirical = null;
    if (fm && fm.ok) {
      const mv = { oil: (total.oil || 0) * 0.1, rates: (total.rates || 0) * 0.5, usd: (total.usd || 0) * 0.02 };
      const est = (fm.portfolio.oil || 0) * (mv.oil / 0.1) + (fm.portfolio.rates || 0) * (mv.rates / 0.1) + (fm.portfolio.usd || 0) * (mv.usd / 0.01);
      empirical = { pct: est, note: "Using betas fitted on the last year of daily prices, for a move of roughly +10% oil / +50 bp yields / +2% USD per unit of pressure." };
    }
    return { title, story_id: storyId, nodes, edges, shocks: shocks.map((s) => ({ label: s.shock.label, dir: s.dir, terms: s.terms, people: s.shock.people, business: s.shock.business, markets: s.shock.markets, watch: s.shock.watch })),
      portfolio_tilt: tilt, tilt_label: tiltLabel(tilt), offsets, episodes: eps, base: port.base, empirical,
      method: "Built-in transmission model: pattern match → driver impulses → one hop of economic channels → your sensitivities. Interpretation, not a forecast.", empty: !shocks.length && !extra };
  };
  function tiltLabel(x) { const a = Math.abs(x); if (a < 0.02) return "negligible"; return `${a < 0.08 ? "small" : a < 0.2 ? "moderate" : "large"} ${x > 0 ? "positive" : "negative"} tilt`; }

  // ------------------------------------------------------------------ scenario lab
  const UNITS = { rates: 100, inflation: 1.5, oil: 30, growth: 1.5 };
  const KMULT = { rates: 6, default: 7 };
  E.PRESETS = [
    { id: "hormuz", name: "Hormuz stays shut", inputs: { oil: 40, inflation: 1, rates: 50, market: -8 }, desc: "Oil supply shock from a prolonged closure: higher oil, stickier inflation, rates stay up." },
    { id: "higher", name: "Rates stay elevated", inputs: { rates: 75, market: -5 } },
    { id: "inflation", name: "Inflation re-accelerates", inputs: { inflation: 2, rates: 100, oil: 20, market: -8 } },
    { id: "cad", name: "Canadian dollar −10%", inputs: { cad: -10 } },
    { id: "growth", name: "Growth slows sharply", inputs: { growth: -2, rates: -100, oil: -25, market: -15 } },
    { id: "ai", name: "AI capex pullback", inputs: { factors: { ai_capex: -1.5, risk: -0.5 }, market: -10, tech: -8 } },
    { id: "taiwan", name: "Taiwan supply disruption", inputs: { factors: { chips: 2, china: 2, risk: -1 }, market: -15, tech: -10 } },
    { id: "crash", name: "2022 replay", inputs: { market: -19, rates: 236, oil: 7, usd: 8, tech: -14 } },
  ];
  E.scenario = function (inputs) {
    const port = E._port || E.portfolio(), base = port.base;
    const model = inputs.model || "kb";
    let u = {};
    for (const [f, sc] of Object.entries(UNITS)) if (inputs[f]) u[f] = +inputs[f] / sc;
    for (const [f, v] of Object.entries(inputs.factors || {})) if (K.FACTORS[f]) u[f] = (u[f] || 0) + +v;
    let second = [];
    if (inputs.second_order !== false && Object.keys(u).length && model === "kb") {
      const pr = E.propagate(u, 0.1);
      second = pr.paths.map(([a, b, v, e]) => ({ from: K.FACTORS[a][0], to: K.FACTORS[b][0], value: v, logic: e[5] }));
      u = pr.total;
    }
    const mkt = +inputs.market || 0, tech = +inputs.tech || 0, cad = (+inputs.cad || 0) / 100, usdMove = +inputs.usd || 0;
    const fm = model === "empirical" ? E.factorModel() : null;
    const rows = [];
    let totDelta = 0;
    for (const r of port.holdings) {
      if (!r.value) continue;
      let est = 0, parts = [];
      if (model === "empirical") {
        const f = fm && fm.rows.find((x) => x.id === r.id && x.betas);
        if (f) {
          const add = (label, pct) => { if (Math.abs(pct) > 0.0005) { parts.push({ driver: label, pct, label: "statistical" }); est += pct; } };
          add("S&P 500 move × fitted beta", f.betas.mkt.b * mkt / 100);
          add("Tech tilt × fitted beta", f.betas.tech.b * tech / 100);
          add("10-year yield change × fitted beta", f.betas.rates.b * (+inputs.rates || 0) / 100);
          add("Oil move × fitted beta", f.betas.oil.b * (+inputs.oil || 0) / 100);
          add("US dollar move × fitted beta", f.betas.usd.b * usdMove / 100);
        } else if (r.sector !== "Cash") { est = r.beta * mkt / 100; parts.push({ driver: "No price history: market move × sector beta", pct: est, label: "estimate" }); }
      } else {
        if (mkt) { const v = r.beta * mkt / 100; parts.push({ driver: `Market move × beta ${r.beta.toFixed(2)}`, pct: v, label: "estimate" }); est += v; }
        if (tech && ["Semiconductors", "Software", "Technology", "Communication"].includes(r.sector)) { const v = tech / 100 * 0.8; parts.push({ driver: "Tech tilt", pct: v, label: "estimate" }); est += v; }
        for (const [f, uv] of Object.entries(u)) {
          const s = r.sens[f] || 0;
          if (!s || (f === "risk" && mkt)) continue;
          const v = s * uv * (KMULT[f] || KMULT.default) / 100;
          if (Math.abs(v) > 0.0005) { parts.push({ driver: K.FACTORS[f][0], pct: v, label: "estimate" }); est += v; }
        }
        if (usdMove && r.sens.usd) { const v = r.sens.usd * (usdMove / 5) * KMULT.default / 100; parts.push({ driver: "US dollar sensitivity", pct: v, label: "estimate" }); est += v; }
      }
      let calc = 0;
      if (inputs.holding && r.id === inputs.holding) { calc = (+inputs.holding_pct || 0) / 100; est = 0; parts = [{ driver: "Your assumed price move", pct: calc, label: "calculated" }]; }
      let tr = 0;
      if (cad && r.currency !== base) tr = base === "CAD" ? 1 / (1 + cad) - 1 : r.currency === "CAD" ? cad : 0;
      if (tr) { parts.push({ driver: `Currency translation (${r.currency} → ${base})`, pct: tr, label: "calculated" }); calc = (1 + calc) * (1 + tr) - 1; }
      const pct = (1 + est) * (1 + calc) - 1;
      const band = model === "empirical" ? [0.6, 1.4] : [0.5, 1.5];
      const lo = est >= 0 ? (1 + est * band[0]) * (1 + calc) - 1 : (1 + est * band[1]) * (1 + calc) - 1;
      const hi = est >= 0 ? (1 + est * band[1]) * (1 + calc) - 1 : (1 + est * band[0]) * (1 + calc) - 1;
      rows.push({ id: r.id, ticker: r.ticker || r.name, sector: r.sector, weight: r.weight, value: r.value, est_pct: est, calc_pct: calc, pct, low: lo, high: hi, delta: r.value * pct, parts, sens_source: model === "empirical" ? "fitted on 1y of daily prices" : r.sens_source });
      totDelta += r.value * pct;
    }
    rows.sort((a, b) => a.delta - b.delta);
    const total = port.total || 1;
    const lo = rows.reduce((a, x) => a + x.value * x.low, 0), hi = rows.reduce((a, x) => a + x.value * x.high, 0);
    const active = Object.entries(u).filter(([, v]) => Math.abs(v) > 0.2).map(([f]) => f).concat(cad ? ["cad"] : [], mkt ? ["risk"] : []);
    return { base, model, total: port.total, delta: totDelta, pct: totDelta / total, low: lo / total, high: hi / total, rows,
      drivers: Object.fromEntries(Object.entries(u).map(([f, v]) => [K.FACTORS[f][0], v])), second_order: second,
      episodes: K.EPISODES.filter((e) => e.applies.some((a) => active.includes(a))).slice(0, 3),
      limitations: model === "empirical" ? ["Betas are fitted on about a year of daily returns: they capture recent co-movement, not cause, and they change over time.", "Currency translation and single-holding moves are calculated exactly.", "Holdings without price history fall back to sector betas."]
        : ["Driver effects are hypothetical estimates from rough sector sensitivities (range 0.5× to 1.5×).", "Currency translation and single-holding moves are calculated exactly.", "Only one hop of economic channels is modelled.", "Historical episodes are context, not predictions."] };
  };

  // ------------------------------------------------------------------ indicator values (current + history + percentiles)
  E.indicator = function (id) {
    const st = S(), ind = K.IND[id];
    if (!ind) return null;
    let series = null, value = null, asof = null, src = "";
    const [kind, key] = ind.src;
    if (kind === "yahoo") {
      const h = st.hist(key), q = st.quote(key);
      series = h ? h.map(([t, v]) => [t, v]) : null;
      if (q) { value = q.p; asof = q.t || q.fetched; }
      src = "Yahoo Finance (" + key + ", delayed)";
    } else if (kind === "boc") {
      const s = st.boc(key);
      if (s) { series = s.map(([d, v]) => [Date.parse(d + "T16:00:00Z") / 1000, v]); value = s[s.length - 1][1]; asof = series[series.length - 1][0]; }
      src = "Bank of Canada Valet (" + key + ")";
    } else if (kind === "calc") {
      const pair = { curve_us: ["^TNX", "2YY=F", "-"], curve_ca: ["boc:BD.CDN.10YR.DQ.YLD", "boc:BD.CDN.2YR.DQ.YLD", "-"], brent_wti: ["BZ=F", "CL=F", "-"] }[key];
      const get = (k) => k.startsWith("boc:") ? (st.boc(k.slice(4)) || []).map(([d, v]) => [Date.parse(d + "T16:00:00Z") / 1000, v]) : st.hist(k);
      if (pair) {
        const a = get(pair[0]), b = get(pair[1]);
        if (a && b && a.length && b.length) {
          const mb = new Map(b.map(([t, v]) => [dayKey(t), v]));
          series = a.filter(([t]) => mb.has(dayKey(t))).map(([t, v]) => [t, +(v - mb.get(dayKey(t))).toFixed(4)]);
          if (series.length) { value = series[series.length - 1][1]; asof = series[series.length - 1][0]; }
        }
        src = "Calculated from " + pair.slice(0, 2).map((x) => x.replace("boc:", "")).join(" − ");
      } else if (key === "crack") {
        const cl = st.hist("CL=F"), rb = st.hist("RB=F"), ho = st.hist("HO=F");
        if (cl && rb && ho) {
          const mr = new Map(rb.map(([t, v]) => [dayKey(t), v])), mh = new Map(ho.map(([t, v]) => [dayKey(t), v]));
          series = cl.filter(([t]) => mr.has(dayKey(t)) && mh.has(dayKey(t))).map(([t, v]) => [t, +((2 * mr.get(dayKey(t)) * 42 + mh.get(dayKey(t)) * 42 - 3 * v) / 3).toFixed(2)]);
          if (series.length) { value = series[series.length - 1][1]; asof = series[series.length - 1][0]; }
        }
        src = "Calculated: (2 × RBOB + 1 × heating oil) × 42 − 3 × WTI, per barrel";
      }
    }
    const out = { ind, value, asof, series, src };
    if (series && series.length > 2) {
      const vals = series.map((x) => x[1]).sort((a, b) => a - b);
      out.pctl = vals.findIndex((v) => v >= value) / vals.length;
      out.min = vals[0]; out.max = vals[vals.length - 1];
      const t = series[series.length - 1][0];
      const ago = (d) => { const v = closeOn(series, t - d * DAY); return v == null ? null : v; };
      out.chg = { "1w": ago(7), "1m": ago(30), "3m": ago(91), "1y": ago(365) };
    }
    return out;
  };
  E.longHistory = async function (id) {
    const ind = K.IND[id]; if (!ind) return null;
    const st = S();
    if (ind.long) { await st.ensure(["m:" + ind.long]); const m = st.long(ind.long); if (m && m.length) return { series: m, src: "Yahoo Finance weekly since 2000 (" + ind.long + ")" }; }
    if (ind.src[0] === "boc") {
      const d = await st.px(`https://www.bankofcanada.ca/valet/observations/${ind.src[1]}/json?start_date=1990-01-01`, { ttl: 86400 });
      const s = (d.observations || []).filter((o) => o[ind.src[1]] && o[ind.src[1]].v).map((o) => [Date.parse(o.d + "T16:00:00Z") / 1000, +o[ind.src[1]].v]);
      return { series: s, src: "Bank of Canada Valet (since " + (s[0] ? new Date(s[0][0] * 1000).getFullYear() : "?") + ")" };
    }
    return null;
  };
  E.isMonthly = (series) => { const n = (series || []).length; return n > 3 && (series[n - 1][0] - series[Math.max(0, n - 7)][0]) / Math.min(6, n - 1) > 20 * DAY; };
  E.compare = function (series, value) {
    if (!series || !series.length) return [];
    const t = series[series.length - 1][0], monthly = E.isMonthly(series);
    return [...(monthly ? [] : [["1 week", 7]]), ["1 month", 30], ["3 months", 91], ["1 year", 365], ["3 years", 1095], ["5 years", 1826], ["10 years", 3652], ["20 years", 7305]].map(([label, d]) => {
      const then = t - d * DAY; if (then < series[0][0] - 20 * DAY) return null;
      const v = closeOn(series, then);
      return v == null ? null : { label, date: new Date(then * 1000), then: v, change: value - v, pct: v ? value / v - 1 : null };
    }).filter(Boolean);
  };

  // run after boot: analytics warm-up + radar
  E.afterBoot = function () {
    setTimeout(() => {
      try { E.analytics(); } catch (e) { console.warn("analytics", e); }
      if (V.intel && V.intel.autoRadar) V.intel.autoRadar();
    }, 400);
  };
})();
