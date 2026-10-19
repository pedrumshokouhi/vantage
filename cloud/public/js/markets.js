/* Markets: rates tracker, energy & oil tracker, macro dashboard and the "so what?" indicator drawer. */
"use strict";
(function () {
  const esc = V.esc, $ = V.$, $$ = V.$$, K = V.kb, E = V.engine;
  const S = () => V.store;
  const DAY = 86400;
  const fmtInd = (ind, v) => v == null ? "—" : (ind.pre || "") + v.toFixed(ind.dec) + (ind.unit === "%" ? "%" : ind.unit === " pts" ? "" : "");
  const chgInd = (ind, now, then) => {
    if (now == null || then == null) return "—";
    if (ind.unit === "%" || ind.unit === " pts") return `<span class="${V.cls(now - then)}">${V.bp((now - then))}</span>`;
    return V.dpct(then ? now / then - 1 : null);
  };
  const ANN = { oil: [[Date.UTC(2008, 6, 3) / 1000, "2008 peak"], [Date.UTC(2014, 5, 20) / 1000, "2014 collapse begins"], [Date.UTC(2016, 1, 11) / 1000, "2016 low"], [Date.UTC(2020, 3, 20) / 1000, "Apr 2020: negative"], [Date.UTC(2022, 2, 8) / 1000, "2022 spike"]],
    rates: [[Date.UTC(2008, 11, 16) / 1000, "Fed to zero"], [Date.UTC(2013, 4, 22) / 1000, "Taper tantrum"], [Date.UTC(2020, 2, 15) / 1000, "Covid cuts"], [Date.UTC(2022, 2, 16) / 1000, "Hikes begin"]] };

  function card(id) {
    const x = E.indicator(id); if (!x) return "";
    const ind = x.ind, spark = x.series ? x.series.slice(-60).map((p) => p[1]) : [];
    const ch1m = x.chg ? x.chg["1m"] : null, ch1y = x.chg ? x.chg["1y"] : null;
    const dir = ch1m != null && x.value != null ? Math.sign(x.value - ch1m) : 0;
    const sw = dir > 0 ? ind.up.markets : dir < 0 ? ind.down.markets : ind.desc;
    return `<div class="icard" data-ind="${id}"><div class="top2"><span class="nm grow">${esc(ind.name)}</span>${x.pctl != null ? `<span class="xs mono muted" title="Percentile vs its own history">P${Math.round(x.pctl * 100)}</span>` : ""}</div>
      <div class="row sp"><span class="val">${fmtInd(ind, x.value)}</span>${V.spark(spark, 90, 26, "var(--acc)")}</div>
      <div class="row gap16 small mono"><span>1m ${chgInd(ind, x.value, ch1m)}</span><span>1y ${chgInd(ind, x.value, ch1y)}</span></div>
      ${x.pctl != null ? V.pctl(x.pctl) : ""}<div class="sw clamp2">${dir ? (dir > 0 ? "▲ " : "▼ ") : ""}${esc(sw)}</div></div>`;
  }
  const grid = (ids) => `<div class="ind">${ids.map(card).join("")}</div>`;
  const bindCards = (root) => $$("[data-ind]", root).forEach((c) => (c.onclick = () => V.openIndicator(c.dataset.ind)));

  function exposureList(factor, statKey, move, label) {
    const port = E._port || E.portfolio(), fm = E.factorModel();
    const held = port.holdings.filter((r) => r.ticker !== "CASH");
    const rank = (a, b) => Math.abs((b.stat ? b.stat.per : b.kb * 0.05) * b.r.weight) - Math.abs((a.stat ? a.stat.per : a.kb * 0.05) * a.r.weight);
    let rows = held.map((r) => {
      const f = fm.rows.find((x) => x.id === r.id && x.betas);
      return { r, kb: r.sens[factor] || 0, stat: f && statKey ? f.betas[statKey] : null };
    }).filter((x) => x.kb || x.stat).sort(rank).slice(0, 12);
    // nothing tied to this driver directly: follow the knowledge graph one step (e.g. inflation -> rates)
    let via = null;
    if (!rows.length) {
      const tot = E.propagate({ [factor]: 1 }).total; delete tot[factor];
      via = Object.entries(tot).filter(([, v]) => Math.abs(v) >= 0.12);
      rows = held.map((r) => ({ r, stat: null, kb: Math.max(-1, Math.min(1, via.reduce((s, [k, v]) => s + v * (r.sens[k] || 0), 0))) }))
        .filter((x) => Math.abs(x.kb) >= 0.05).sort(rank).slice(0, 12);
    }
    if (!rows.length) return `<div class="small muted">${esc(label)}</div><div class="empty small">None of your holdings has a notable built-in or fitted link to ${esc(K.fl(factor))}.</div>`;
    const portStat = fm.ok && statKey ? fm.portfolio[statKey] : null;
    return `<div class="small muted" style="margin-bottom:8px">${esc(label)}</div>
      ${via ? `<div class="small" style="margin-bottom:8px">No holding is tied to ${esc(K.fl(factor))} directly; it reaches you through ${via.map(([k, v]) => `${esc(K.fl(k))} (${v > 0 ? "up" : "down"})`).join(", ")}. ${V.lbl("estimate")}</div>` : ""}
      ${portStat != null ? `<div class="calc" style="margin-bottom:10px"><div class="kicker">Your portfolio, ${esc(move)}</div><div class="out ${V.cls(portStat)}">${V.pct(portStat, 2)}</div><div class="small muted">≈ ${V.money(portStat * port.total * fm.coverage, port.base, 0)} ${V.lbl("statistical")} fitted on ~1 year of daily prices (${Math.round(fm.coverage * 100)}% of value covered)</div></div>` : ""}
      <table class="tbl"><thead><tr><th>Holding</th><th class="num">Weight</th><th class="num">${via ? "Indirect tilt" : "Built-in tilt"}</th>${statKey ? `<th class="num">Fitted: ${esc(move)}</th><th class="num">t-stat</th>` : ""}</tr></thead><tbody>
      ${rows.map((x) => `<tr class="click" data-h="${x.r.id}"><td><span class="tkr">${esc(x.r.ticker)}</span> <span class="xs muted">${esc(x.r.sector)}</span></td><td class="num">${V.pct(x.r.weight, 1, false)}</td><td class="num ${V.cls(x.kb)}">${x.kb ? (x.kb > 0 ? "+" : "") + x.kb.toFixed(1) : "—"}</td>
        ${statKey ? `<td class="num ${V.cls(x.stat && x.stat.per)}">${x.stat ? V.pct(x.stat.per, 2) : "—"}</td><td class="num ${x.stat && Math.abs(x.stat.t) >= 2 ? "" : "muted"}">${x.stat ? x.stat.t.toFixed(1) : "—"}</td>` : ""}</tr>`).join("")}</tbody></table>
      <div class="help mt8">Built-in tilt: rough sector sensitivity (−1 to +1) ${V.lbl("estimate")}. Fitted: regression of each holding's daily returns on market, tech, 10-year yield, oil and US dollar moves. |t| ≥ 2 is conventionally "significant". Association, not cause.</div>`;
  }

  /* ---------- RATES ---------- */
  V.views.rates = async function (page) {
    const st = S();
    await st.ensure(["h:^IRX", "h:2YY=F", "h:^FVX", "h:^TNX", "h:^TYX"]);
    E.portfolio(); E.factorModel();
    const bocS = (k) => st.boc(k) || [];
    const last = (s) => (s.length ? s[s.length - 1] : null);
    const pol = bocS("V39079"), cpi = bocS("STATIC_TOTALCPICHANGE");
    let lastChange = null; for (let i = pol.length - 1; i > 0; i--) if (pol[i][1] !== pol[i - 1][1]) { lastChange = { date: pol[i][0], from: pol[i - 1][1], to: pol[i][1] }; break; }
    const pol1y = pol.length ? pol.find((x) => x[0] >= V.iso(new Date(Date.now() - 365 * DAY * 1000))) : null;
    const us = E.indicator("us_curve"), ca = E.indicator("ca_curve"), t10 = E.indicator("us_10y"), c10 = E.indicator("ca_10y");
    const insight = [];
    if (last(pol)) insight.push({ t: `BoC at ${last(pol)[1].toFixed(2)}%`, x: lastChange ? `Last move ${lastChange.date}: ${lastChange.from.toFixed(2)}% → ${lastChange.to.toFixed(2)}%. ${pol1y ? (last(pol)[1] < pol1y[1] ? `Down ${((pol1y[1] - last(pol)[1]) * 100).toFixed(0)} bp over the year: borrowing is getting cheaper.` : last(pol)[1] > pol1y[1] ? `Up ${((last(pol)[1] - pol1y[1]) * 100).toFixed(0)} bp over the year.` : "Unchanged over the year.") : ""}` : "", l: "fact" });
    if (last(pol) && last(cpi)) { const real = last(pol)[1] - last(cpi)[1]; insight.push({ t: `Real policy rate ${real >= 0 ? "+" : ""}${real.toFixed(2)}%`, x: real < 0 ? "Negative: cash in a savings account loses purchasing power after inflation, and policy is still stimulating." : "Positive: savers are ahead of inflation; policy is restraining demand.", l: "calculated" }); }
    if (us && us.value != null) insight.push({ t: `US curve ${us.value >= 0 ? "+" : ""}${us.value.toFixed(2)} pts`, x: us.value < 0 ? "Inverted: markets expect the Fed to cut, usually because they expect a slowdown." : us.value < 0.5 ? "Flat-to-normal: the inversion has unwound; historically recessions often started after the curve re-steepened." : "Normal and upward-sloping: markets price growth and some inflation ahead.", l: "interpretation" });
    if (t10 && c10 && t10.value != null && c10.value != null) insight.push({ t: `US 10Y − Canada 10Y: ${(t10.value - c10.value).toFixed(2)} pts`, x: "A wider gap in favour of the US tends to pull capital into US dollars and weigh on the loonie, which raises the CAD value of your US holdings.", l: "interpretation" });

    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Rates · RATE &lt;GO&gt;</div><h1>Interest rates and <em>what they mean for you</em></h1><p>Policy rates, bond yields and mortgage rates in Canada and the US, with history, curves and the effect on your borrowing and your holdings.</p></div>
        <div class="actions"><button class="btn" id="decisions">${V.icon("cal")} Decision dates</button></div></div>
      <div class="grid g4" style="margin-bottom:14px">${insight.map((i) => `<div class="panel"><div class="row sp"><b>${esc(i.t)}</b>${V.lbl(i.l)}</div><div class="small muted mt8">${esc(i.x)}</div></div>`).join("")}</div>
      <div class="grid g12">
        <div class="s7 panel"><div class="panel-h"><h3>Yield curves</h3>${V.lbl("fact", "market data")}<div class="tools legend"><span><i style="background:var(--acc)"></i>today</span><span><i style="background:var(--blue)"></i>1 month ago</span><span><i style="background:var(--muted)"></i>1 year ago</span></div></div><div id="curves"></div>
          <div class="help mt8">US: 3-month bill, 2-year (futures), 5, 10, 30-year Treasuries. Canada: 2, 5, 10-year and long benchmark bonds (Bank of Canada). An upward slope is normal; an inverted curve has preceded US recessions with long, variable lags.</div></div>
        <div class="s5 panel"><div class="panel-h"><h3>Mortgage &amp; borrowing</h3>${V.lbl("calculated")}</div><div id="mort"></div></div>
        <div class="s12">${grid(K.IND_GROUPS.rates)}</div>
        <div class="s7 panel"><div class="panel-h"><h3>Your holdings' rate sensitivity</h3></div>${exposureList("rates", "rates", "per +10 bp in the US 10-year", "How your positions have tended to move when long-term yields rise.")}</div>
        <div class="s5 panel"><div class="panel-h"><h3>If rates rise / fall</h3>${V.lbl("interpretation")}</div>${soWhat(K.IND.boc_policy)}</div>
      </div></div>`;
    bindCards(page);
    $$("[data-h]", page).forEach((r) => (r.onclick = () => V.go("holding/" + r.dataset.h)));
    $("#decisions").onclick = () => V.modal("Rate decision dates (2026)", Object.entries(K.CENTRAL_BANK_2026).map(([bank, [url, ds]]) => `<div class="mt8"><b>${esc(bank)}</b> <a class="small" href="${url}" target="_blank" rel="noopener">official schedule</a><div class="row wrap gap6 mt8">${ds.map((d) => `<span class="chip ${d >= V.iso(new Date()) ? "on" : ""}" style="cursor:default">${V.parseDay(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>`).join("")}</div></div>`).join("") + `<div class="help mt16">Built-in published schedules; confirm at the official links.</div>`);
    // curves
    const t = Date.now() / 1000, at = (sym, d) => { const h = st.hist(sym); return h ? E.closeOn(h, t - d * DAY) : null; };
    const bocAt = (k, d) => { const s = bocS(k); const dd = V.iso(new Date(Date.now() - d * DAY * 1000)); let v = null; for (const x of s) if (x[0] <= dd) v = x[1]; return v; };
    const US = [["3M", 0.25, "^IRX"], ["2Y", 2, "2YY=F"], ["5Y", 5, "^FVX"], ["10Y", 10, "^TNX"], ["30Y", 30, "^TYX"]];
    const CA = [["2Y", 2, "BD.CDN.2YR.DQ.YLD"], ["5Y", 5, "BD.CDN.5YR.DQ.YLD"], ["10Y", 10, "BD.CDN.10YR.DQ.YLD"], ["Long", 25, "BD.CDN.LONG.DQ.YLD"]];
    const curveSvg = (title, pts) => {
      const W = 360, H = 190, pl = 34, pr = 10, ptp = 18, pb = 22, all = pts.flatMap((s) => s.v.filter((x) => x[1] != null).map((x) => x[1]));
      if (!all.length) return `<div class="empty small">${esc(title)}: no data yet</div>`;
      const mn = Math.min(...all) - 0.25, mx = Math.max(...all) + 0.25, X = (m) => pl + (Math.log(m + 0.5) / Math.log(30.5)) * (W - pl - pr), Y = (v) => ptp + (1 - (v - mn) / (mx - mn)) * (H - ptp - pb);
      let g = `<text x="${pl}" y="11" style="font:700 10px var(--mono);fill:var(--text)">${esc(title)}</text>`;
      for (let i = 0; i <= 3; i++) { const v = mn + ((mx - mn) * i) / 3; g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${pl - 4}" y="${Y(v) + 3}" text-anchor="end">${v.toFixed(1)}</text>`; }
      for (const [lab, m] of pts[0].v.map((x) => [x[2], x[0]])) g += `<text x="${X(m)}" y="${H - 6}" text-anchor="middle">${lab}</text>`;
      for (const s of pts.slice().reverse()) { const p = s.v.filter((x) => x[1] != null); g += `<path d="${p.map((x, i) => (i ? "L" : "M") + X(x[0]) + " " + Y(x[1])).join("")}" fill="none" stroke="${s.c}" stroke-width="${s.w || 1.6}" ${s.dash ? 'stroke-dasharray="4 3"' : ""}/>${p.map((x) => `<circle cx="${X(x[0])}" cy="${Y(x[1])}" r="2.6" fill="${s.c}"><title>${x[2]}: ${x[1].toFixed(2)}%</title></circle>`).join("")}`; }
      return `<svg class="svgchart" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${g}</svg>`;
    };
    $("#curves").innerHTML = `<div class="grid g2">${curveSvg("UNITED STATES", [{ c: "var(--acc)", w: 2.2, v: US.map(([l, m, s]) => [m, at(s, 0), l]) }, { c: "var(--blue)", dash: 1, v: US.map(([l, m, s]) => [m, at(s, 30), l]) }, { c: "var(--muted)", dash: 1, v: US.map(([l, m, s]) => [m, at(s, 365), l]) }])}
      ${curveSvg("CANADA", [{ c: "var(--acc)", w: 2.2, v: CA.map(([l, m, k]) => [m, bocAt(k, 0), l]) }, { c: "var(--blue)", dash: 1, v: CA.map(([l, m, k]) => [m, bocAt(k, 30), l]) }, { c: "var(--muted)", dash: 1, v: CA.map(([l, m, k]) => [m, bocAt(k, 365), l]) }])}</div>`;
    // mortgage calculator
    const prime = last(bocS("V80691311")), posted = last(bocS("V80691335"));
    const prime1y = bocAt("V80691311", 365), fixed5y = last(bocS("BD.CDN.5YR.DQ.YLD"));
    const pay = (P, r, years) => { const i = r / 100 / 12, n = years * 12; return i ? (P * i) / (1 - Math.pow(1 + i, -n)) : P / n; };
    const m = $("#mort");
    m.innerHTML = `<div class="form two"><label class="f"><span>Mortgage balance ($)</span><input class="in mono" id="mP" type="number" value="600000" step="10000"></label><label class="f"><span>Amortization (years)</span><input class="in mono" id="mY" type="number" value="25"></label>
      <label class="f"><span>Variable: prime −</span><input class="in mono" id="mD" type="number" value="0.5" step="0.05"></label><label class="f"><span>Fixed 5-yr offered rate (%)</span><input class="in mono" id="mF" type="number" value="${fixed5y ? (fixed5y[1] + 1.5).toFixed(2) : "4.5"}" step="0.05"></label></div><div id="mOut" class="mt12"></div>
      <div class="help mt8">Prime ${prime ? prime[1].toFixed(2) + "% (" + prime[0] + ")" : "n/a"} · 5-yr posted ${posted ? posted[1].toFixed(2) + "%" : "n/a"} · 5-yr GoC yield ${fixed5y ? fixed5y[1].toFixed(2) + "%" : "n/a"} (fixed offers are typically the 5-yr yield + 1.3–2 pts; edit to match your quote). Monthly payments, compounding simplified to monthly.</div>`;
    const calc = () => {
      const P = +$("#mP").value || 0, Y = +$("#mY").value || 25, dsc = +$("#mD").value || 0, fx = +$("#mF").value || 0;
      const vr = prime ? prime[1] - dsc : null, vr1y = prime1y != null ? prime1y - dsc : null;
      const rows = [["Variable today", vr], ["Variable a year ago", vr1y], ["Variable if rates +1%", vr != null ? vr + 1 : null], ["Variable if rates −1%", vr != null ? vr - 1 : null], ["5-year fixed (your input)", fx]].filter((x) => x[1] != null);
      const base = vr != null ? pay(P, vr, Y) : null;
      const q = Math.max(fx + 2, 5.25);
      $("#mOut").innerHTML = `<table class="cmp"><thead><tr><th>Scenario</th><th class="num">Rate</th><th class="num">Monthly</th><th class="num">vs today</th></tr></thead><tbody>${rows.map(([l, r]) => { const p = pay(P, r, Y); return `<tr><td>${esc(l)}</td><td class="num">${r.toFixed(2)}%</td><td class="num">${V.money(p, "CAD", 0)}</td><td class="num ${base ? V.cls(-(p - base)) : ""}">${base ? (p - base >= 0 ? "+" : "−") + V.money(Math.abs(p - base), "CAD", 0) : "—"}</td></tr>`; }).join("")}</tbody></table>
        <div class="small mt8">Stress test: you'd need to qualify at <b>${q.toFixed(2)}%</b> (greater of contract + 2 pts or 5.25%) → payment ${V.money(pay(P, q, Y), "CAD", 0)}/month.</div>`;
    };
    $$("#mort input").forEach((i) => (i.oninput = calc)); calc();
  };

  function soWhat(ind) {
    return `<div class="sowhat"><div class="col2 upc"><h5>▲ If it rises</h5><ul><li><b>People:</b> ${esc(ind.up.people)}</li><li><b>Businesses:</b> ${esc(ind.up.business)}</li><li><b>Markets:</b> ${esc(ind.up.markets)}</li></ul></div>
      <div class="col2 dnc"><h5>▼ If it falls</h5><ul><li><b>People:</b> ${esc(ind.down.people)}</li><li><b>Businesses:</b> ${esc(ind.down.business)}</li><li><b>Markets:</b> ${esc(ind.down.markets)}</li></ul></div></div>`;
  }
  V.soWhat = soWhat;

  /* ---------- ENERGY & OIL ---------- */
  async function usCpi() {
    const parts = [["2000", "2009"], ["2010", "2019"], ["2020", String(new Date().getFullYear())]];
    const out = [];
    for (const [a, b] of parts) {
      const d = await S().px("https://api.bls.gov/publicAPI/v1/timeseries/data/", { ttl: 20 * DAY, body: JSON.stringify({ seriesid: ["CUUR0000SA0"], startyear: a, endyear: b }) });
      for (const x of ((((d.Results || {}).series || [])[0] || {}).data || [])) if (/^M\d\d$/.test(x.period) && x.period !== "M13") out.push([Date.UTC(+x.year, +x.period.slice(1) - 1, 15) / 1000, +x.value]);
    }
    return out.sort((a, b) => a[0] - b[0]);
  }
  V.views.oil = async function (page) {
    const st = S();
    await st.ensure(["m:CL=F", "m:BZ=F", "h:CL=F", "h:BZ=F", "h:NG=F", "h:RB=F", "h:HO=F", "pw"]);
    E.portfolio(); E.factorModel();
    const wti = E.indicator("wti"), brent = E.indicator("brent");
    const merge = (m, d) => { const cut = d && d.length ? d[0][0] : Infinity; return (m || []).filter((x) => x[0] < cut).concat(d || []); };
    const wLong = merge(st.long("CL=F"), st.hist("CL=F")), bLong = merge(st.long("BZ=F"), st.hist("BZ=F"));
    const fx = st.fxTable(), usdcad = fx.USD || 1.4;
    const hz = V.kb.HOTSPOTS.find((h) => h.id === "hormuz"), hzs = V.intel.hotspotStatus(hz);
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Energy · OIL &lt;GO&gt;</div><h1>Oil &amp; energy, <em>then and now</em></h1><p>WTI and Brent crude with history back to 2000, inflation-adjusted comparisons, refining margins, and what every move means for your wallet and your portfolio.</p></div></div>
      ${hzs.score != null ? `<div class="callout ${hzs.score >= 75 ? "bad" : ""}" style="margin-bottom:14px"><b>Supply watch: Strait of Hormuz is ${esc(hzs.status.toLowerCase())} (${hzs.score}/100).</b> ${esc((hzs.facts.find((f) => f.k === "shipping") || {}).text || "")} <a href="#/world/hormuz">Open tracker →</a></div>` : ""}
      ${grid(K.IND_GROUPS.energy)}
      <div class="grid g12 mt16">
        <div class="s8 panel"><div class="panel-h"><h3>WTI &amp; Brent since 2000</h3>${V.lbl("fact", "market data")}<div class="tools"><button class="chip" id="realBtn">Inflation-adjusted</button></div></div><div id="oilChart"></div><div class="help mt8" id="oilNote">Weekly closes of front-month futures (Yahoo Finance), daily for the last two years. Annotations mark well-known episodes.</div></div>
        <div class="s4 panel"><div class="panel-h"><h3>Compared with years before</h3>${V.lbl("calculated")}</div><div id="cmp"></div></div>
        <div class="s6 panel"><div class="panel-h"><h3>What if WTI goes to…</h3>${V.lbl("estimate")}</div>
          <div class="sl"><span class="nm">WTI price</span><span class="val" id="wv"></span><input type="range" id="wr" min="30" max="200" step="1" value="${Math.round((wti && wti.value) || 80)}"></div>
          <div id="what" class="mt12"></div></div>
        <div class="s6 panel"><div class="panel-h"><h3>Your holdings and oil</h3></div>${exposureList("oil", "oil", "per +10% oil", "How your positions tend to move with crude.")}</div>
        <div class="s12 panel"><div class="panel-h"><h3>If oil rises / falls</h3>${V.lbl("interpretation")}</div>${soWhat(K.IND.wti)}</div>
      </div></div>`;
    bindCards(page);
    $$("[data-h]", page).forEach((r) => (r.onclick = () => V.go("holding/" + r.dataset.h)));
    let real = false, cpi = null;
    const draw = async () => {
      let w = wLong, b = bLong, fmt = (v) => "$" + v.toFixed(0), note = "Weekly closes of front-month futures (Yahoo Finance), daily for the last two years.";
      if (real) {
        try { cpi = cpi || await usCpi(); } catch (e) { V.toast("US CPI (BLS) unavailable: " + e.message, "err"); real = false; }
        if (cpi && cpi.length) {
          const cNow = cpi[cpi.length - 1][1], adj = (s) => s.map(([t, v]) => { const c = E.closeOn(cpi, t) || cpi[0][1]; return [t, v * cNow / c]; });
          w = adj(wLong); b = adj(bLong); note = `In today's US dollars (US CPI, Bureau of Labor Statistics, latest ${new Date(cpi[cpi.length - 1][0] * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })}).`;
        }
      }
      $("#realBtn").classList.toggle("on", real);
      $("#oilNote").textContent = note;
      V.rangeChart($("#oilChart"), w, { name: "WTI", fmt, canLog: true, range: "MAX", annotations: ANN.oil.map(([t, l]) => ({ t, label: l })), overlays: [{ name: "Brent", color: "var(--blue)", dash: "4 3", pts: b }] });
      const cur = w.length ? w[w.length - 1][1] : null, rows = E.compare(w, cur);
      const vals = w.map((x) => x[1]).sort((a, c) => a - c), pctl = cur != null ? vals.findIndex((v) => v >= cur) / vals.length : null;
      const hi = w.reduce((a, x) => (x[1] > a[1] ? x : a), w[0] || [0, 0]), lo = w.reduce((a, x) => (x[1] < a[1] ? x : a), w[0] || [0, 0]);
      $("#cmp").innerHTML = cur == null ? `<div class="empty small">No data</div>` : `<div class="kpi"><span class="l">WTI ${real ? "(today's $)" : ""}</span><span class="v">$${cur.toFixed(2)}</span></div>
        <div class="small mt8">Higher than <b>${Math.round(pctl * 100)}%</b> of weeks since ${new Date(w[0][0] * 1000).getFullYear()}.</div>${V.pctl(pctl)}
        <table class="cmp mt12"><thead><tr><th>vs</th><th class="num">Then</th><th class="num">Change</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.label} ago <span class="xs muted">${r.date.toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span></td><td class="num">$${r.then.toFixed(2)}</td><td class="num ${V.cls(r.pct)}">${V.pct(r.pct, 0)}</td></tr>`).join("")}</tbody></table>
        <div class="small mt8">Record high in this series: <b>$${hi[1].toFixed(0)}</b> (${new Date(hi[0] * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })}); low: <b>$${lo[1].toFixed(0)}</b> (${new Date(lo[0] * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })}).</div>`;
    };
    $("#realBtn").onclick = () => { real = !real; draw(); };
    draw();
    // what-if calculator
    const fm = E._fm, port = E._port;
    const whatIf = () => {
      const target = +$("#wr").value, cur = (wti && wti.value) || target, d = target - cur, pct = cur ? target / cur - 1 : 0;
      $("#wv").textContent = "$" + target;
      const perL = (d / 158.987) * usdcad * 100, withTax = perL * 1.13;
      const cpiPP = pct * 0.28;
      const portStat = fm && fm.ok ? fm.portfolio.oil * (pct / 0.1) : null;
      const kbTilt = port.holdings.reduce((a, r) => a + r.weight * (r.sens.oil || 0), 0) * (pct / 0.3) * 0.07;
      $("#what").innerHTML = `<div class="grid g2">
        <div class="calc"><div class="kicker">Pump price (Canada)</div><div class="out ${V.cls(-perL)}">${perL >= 0 ? "+" : "−"}${Math.abs(withTax).toFixed(1)}¢/L</div><div class="small muted">≈ ${perL >= 0 ? "+" : "−"}${Math.abs(perL).toFixed(1)}¢ before HST; a driver using 1,500 L/yr pays ${V.money(Math.abs(withTax) * 15, "CAD", 0)} ${perL >= 0 ? "more" : "less"} a year ${V.lbl("calculated")}</div></div>
        <div class="calc"><div class="kicker">Headline inflation</div><div class="out">${cpiPP >= 0 ? "+" : "−"}${Math.abs(cpiPP * 100).toFixed(1)} pts</div><div class="small muted">Rule of thumb: a 10% oil move shifts headline CPI by roughly 0.2–0.3 points within months ${V.lbl("estimate")}</div></div>
        <div class="calc"><div class="kicker">Your portfolio</div><div class="out ${V.cls(portStat != null ? portStat : kbTilt)}">${portStat != null ? V.pct(portStat, 1) : V.pct(kbTilt, 1)}</div><div class="small muted">${portStat != null ? `Fitted oil sensitivity (${V.money(portStat * port.total * fm.coverage, port.base, 0)}) ${V.lbl("statistical")}` : "Built-in sensitivities " + V.lbl("estimate")}</div></div>
        <div class="calc"><div class="kicker">Canadian dollar</div><div class="out">${pct >= 0 ? "firmer" : "softer"}</div><div class="small muted">Canada is a net oil exporter, so higher oil tends to support the loonie (weaker link since 2015) ${V.lbl("interpretation")}</div></div></div>
        <div class="help mt8">From WTI $${cur.toFixed(2)} to $${target}: ${V.pct(pct, 0)}. USD/CAD ${usdcad.toFixed(4)}. 1 barrel = 158.99 litres.</div>`;
    };
    $("#wr").oninput = whatIf; whatIf();
  };

  /* ---------- MACRO & MARKETS ---------- */
  V.views.macro = async function (page) {
    await S().ensure(K.FACTOR_TICKERS.map((t) => "h:" + t));
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Macro &amp; markets · ECO &lt;GO&gt;</div><h1>The dashboard, <em>with the so-what</em></h1><p>Every card shows today's level, its 1-month and 1-year change, where it sits versus its own history, and what the latest direction means. Click any card for the full story.</p></div></div>
      <div class="kicker" style="margin:4px 0 8px">Markets</div>${grid(K.IND_GROUPS.markets)}
      <div class="kicker" style="margin:18px 0 8px">Inflation</div>${grid(K.IND_GROUPS.macro)}
      <div class="kicker" style="margin:18px 0 8px">Rates</div>${grid(["boc_policy", "us_10y", "us_curve", "ca_5y"])}
      <div class="kicker" style="margin:18px 0 8px">Energy</div>${grid(["wti", "brent", "natgas"])}</div>`;
    bindCards(page);
  };

  /* ---------- indicator drawer ---------- */
  V.openIndicator = async function (id) {
    const st = S();
    if (!K.IND[id]) return openTickerDrawer(id);
    const ind = K.IND[id];
    const box = V.drawer(esc(ind.name), `<div class="loading"><span class="spin"></span></div>`, { cls: "wide", kicker: "Indicator · so what?" });
    if (ind.src[0] === "yahoo") await st.ensure(["h:" + ind.src[1], "q:" + ind.src[1]]);
    E.portfolio(); E.factorModel();
    const x = E.indicator(id);
    let long = null; try { long = await E.longHistory(id); } catch (e) { /* optional */ }
    const series = long && long.series && long.series.length > (x.series || []).length ? long.series.concat((x.series || []).filter((p) => p[0] > long.series[long.series.length - 1][0])) : x.series || [];
    const cmp = E.compare(series, x.value);
    const vals = series.map((p) => p[1]).sort((a, b) => a - b), pctl = x.value != null && vals.length ? vals.findIndex((v) => v >= x.value) / vals.length : null;
    const statKey = { rates: "rates", oil: "oil", usd: "usd", risk: "mkt", ai_capex: "tech" }[ind.factor];
    const words = ind.name.toLowerCase().replace(/[()]/g, "").split(/\s+/).filter((w) => w.length > 3 && !["rate", "yield", "index", "canada", "bank"].includes(w)).slice(0, 2);
    const news = st.news.filter((n) => words.some((w) => n.title.toLowerCase().includes(w))).slice(0, 6);
    const isPct = ind.unit === "%" || ind.unit === " pts";
    $(".db", box).innerHTML = `
      <div class="grid g12"><div class="s4 col gap16">
        <div class="panel"><div class="kpi"><span class="l">${esc(ind.name)}</span><span class="v">${fmtInd(ind, x.value)}${ind.unit && !isPct ? ` <span class="small muted">${esc(ind.unit)}</span>` : ""}</span><span class="src">${esc(x.src)} · ${!x.asof ? "no data" : E.isMonthly(x.series) ? new Date(x.asof * 1000).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) : V.ago(x.asof)}</span></div>
          ${pctl != null ? `<div class="small mt12">Higher than <b>${Math.round(pctl * 100)}%</b> of readings since ${new Date(series[0][0] * 1000).getFullYear()}.</div>${V.pctl(pctl)}` : ""}
          <p class="small mt12">${esc(ind.desc)}</p></div>
        <div class="panel"><div class="panel-h"><h3>Compared with before</h3>${V.lbl("calculated")}</div>
          <table class="cmp"><tbody>${cmp.map((r) => `<tr><td>${r.label} ago <span class="xs muted">${r.date.toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span></td><td class="num">${fmtInd(ind, r.then)}</td><td class="num">${isPct ? `<span class="${V.cls(r.change)}">${V.bp(r.change)}</span>` : V.dpct(r.pct, 1)}</td></tr>`).join("") || `<tr><td class="muted">Not enough history</td></tr>`}</tbody></table></div>
      </div><div class="s8 col gap16">
        <div class="panel"><div class="panel-h"><h3>History</h3><div class="tools src">${esc(long ? long.src : x.src)}</div></div><div id="indChart"></div></div>
        ${soWhat(ind)}
        <div class="panel"><div class="panel-h"><h3>What it means for you</h3></div>${ind.factor ? exposureList(ind.factor, statKey, statKey ? V.engine.FACTORS_STAT.find((f) => f.id === statKey).unit : "", `Holdings most exposed to ${K.fl(ind.factor)}.`) : `<div class="small muted">No direct mapping to your holdings.</div>`}</div>
        ${news.length ? `<div class="panel"><div class="panel-h"><h3>In the news</h3>${V.lbl("fact")}</div><div class="list">${news.map((n) => `<div class="item small"><div class="grow"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="src">${esc(n.source)} · ${V.time(n.published)}</div></div></div>`).join("")}</div></div>` : ""}
      </div></div>`;
    if (series.length) V.rangeChart($("#indChart", box), series, { name: ind.name, fmt: (v) => (ind.pre || "") + v.toFixed(ind.dec > 2 ? 2 : ind.dec) + (isPct ? "%" : ""), canLog: !isPct, range: "5Y", annotations: (ind.group === "energy" ? ANN.oil : ind.group === "rates" ? ANN.rates : []).map(([t, l]) => ({ t, label: l })), hlines: id.endsWith("curve") ? [{ v: 0, label: "inversion line", color: "var(--down)" }] : [] });
    else $("#indChart", box).innerHTML = `<div class="empty small">History is loading on the next engine run.</div>`;
    $$("[data-h]", box).forEach((r) => (r.onclick = () => { V.closeOverlay(); V.go("holding/" + r.dataset.h); }));
  };
  async function openTickerDrawer(t) {
    t = t.toUpperCase();
    const st = S();
    const box = V.drawer(esc(t), `<div class="loading"><span class="spin"></span></div>`, { kicker: "Quote" });
    let q = st.quote(t), h = st.hist(t);
    if (!h) { try { const d = await st.px(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=5y&interval=1d`, { ttl: 3600 }); const r = d.chart.result[0]; h = r.timestamp.map((ts, i) => [ts, r.indicators.quote[0].close[i]]).filter((x) => x[1] != null); q = { p: r.meta.regularMarketPrice, c: r.meta.currency, n: r.meta.longName || r.meta.shortName, pc: h.length > 1 ? h[h.length - 2][1] : null }; } catch (e) { $(".db", box).innerHTML = `<div class="empty"><b>No data for ${esc(t)}</b>Check the symbol (Yahoo format, e.g. SHOP.TO, BRK-B).</div>`; return; } }
    const cmp = E.compare(h, q.p);
    $(".db", box).innerHTML = `<div class="kpi"><span class="l">${esc(q.n || t)}</span><span class="v">${V.num(q.p, 2)} <span class="small muted">${esc(q.c || "")}</span></span><span>${V.dpct(q.pc ? q.p / q.pc - 1 : null, 2)} today</span></div>
      <div id="tkChart" class="mt16"></div><table class="cmp mt16"><tbody>${cmp.map((r) => `<tr><td>${r.label} ago</td><td class="num">${V.num(r.then, 2)}</td><td class="num">${V.dpct(r.pct)}</td></tr>`).join("")}</tbody></table>
      <div class="row mt16"><button class="btn" id="addW">${V.icon("plus")} Add to watchlist</button></div>`;
    V.rangeChart($("#tkChart", box), h, { name: t, fmt: (v) => v.toFixed(2), canLog: true, range: "1Y" });
    $("#addW", box).onclick = async () => { await V.try(() => V.post("/api/r/watch", { ticker: t, reason: "" }), "Added to watchlist"); };
  }
})();
