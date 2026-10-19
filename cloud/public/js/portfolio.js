/* Portfolio: overview, holdings, exposure, risk & factors, income, theses, watchlist; holding detail. */
"use strict";
(function () {
  const esc = V.esc, $ = V.$, $$ = V.$$, E = V.engine, K = V.kb;
  const PER = [["1d", "Day"], ["1m", "1M"], ["ytd", "YTD"], ["1y", "1Y"]];

  V.views.portfolio = async function (page, rest) {
    const tab = rest[0] || "overview";
    const p = await V.get("/api/portfolio");
    V.cache.port = p;
    const tabs = [["overview", "Overview"], ["holdings", "Holdings"], ["exposure", "Exposure"], ["risk", "Risk & factors"], ["income", "Income"], ["thesis", "Theses"], ["watch", "Watchlist"]];
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Portfolio · PORT &lt;GO&gt; · base ${esc(p.base)}</div><h1>${p.count ? V.money(p.total, p.base, 0) : "Your portfolio"} ${p.count ? `<span class="small mono ${V.cls(p.pl)}" style="font-size:15px">${V.money(p.pl, p.base, 0)} unrealised</span>${p.cost_coverage < 0.99 ? `<span class="xs muted" style="font-weight:400"> on the ${V.pct(p.cost_coverage, 0, false)} of value with a known cost</span>` : ""}` : ""}</h1>
        <p>${p.count ? `${p.count} positions across ${p.accounts.length} account${p.accounts.length > 1 ? "s" : ""} · effective diversification ≈ ${p.effective_n.toFixed(1)} equal-weight positions · ${V.fresh(p.asof, 3 * 86400)}` : "Import your broker CSV or add positions by hand."}</p></div>
        <div class="actions"><button class="btn" id="imp">${V.icon("down")} Import broker CSV</button><button class="btn pri" id="add">${V.icon("plus")} Add holding</button></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div><div id="tabBody"></div></div>`;
    $$("[data-tab]", page).forEach((b) => (b.onclick = () => V.go("portfolio/" + b.dataset.tab)));
    $("#add").onclick = () => V.editHolding();
    $("#imp").onclick = importModal;
    const body = $("#tabBody");
    if (!p.count && tab !== "watch") { body.innerHTML = `<div class="panel"><div class="empty"><b>No holdings in this workspace yet</b>Drop in an RBC Direct Investing "Holdings Export" CSV (or any CSV with symbol, quantity, cost) and Vantage maps symbols, currencies and book costs for you.<div class="row mt16" style="justify-content:center"><button class="btn pri" id="imp2">Import CSV</button></div></div></div>`; $("#imp2").onclick = importModal; return; }
    ({ overview, holdings, exposure, risk, income, thesis, watch }[tab] || overview)(body, p);
  };

  function overview(el, p) {
    const b = p.benchmark;
    el.innerHTML = `<div class="grid g12">
      <div class="s12"><div class="grid g4">${p.accounts.map((a) => `<div class="panel"><div class="kicker">${esc(a.name)}</div><div class="kpi mt8"><span class="v" style="font-size:22px">${V.money(a.value, p.base, 0)}</span></div><div class="small mono">${a.known ? `<span class="${V.cls(a.pl)}">${V.money(a.pl, p.base, 0)}</span> unrealised${a.known < a.n ? ` (${a.known}/${a.n} with cost)` : ""}` : `<span class="muted">cost not entered</span>`} · ${V.pct(a.weight, 0, false)} of total</div><div class="small muted">${a.n} positions${a.income ? " · ≈" + V.money(a.income, p.base, 0) + "/yr income" : ""}${a.dist ? " · " + V.money(a.dist, p.base, 0) + " fund distributions (12m)" : ""}</div></div>`).join("")}</div></div>
      <div class="s8 panel"><div class="panel-h"><h3>Performance vs benchmark</h3>${V.lbl("calculated")}<div class="tools legend"><span><i style="background:var(--acc)"></i>You (${esc(p.base)})</span><span><i style="background:var(--muted)"></i>${b.parts.map((x) => esc((x.name || x.ticker) + " " + Math.round(x.w * 100) + "%")).join(" + ")}</span></div></div>
        ${p.series ? V.lineChart([{ name: "You", color: "var(--acc)", pts: p.series.map((x) => [x[0], x[1]]), area: true }, { name: "Benchmark", color: "var(--muted)", dash: "4 4", pts: p.series.map((x) => [x[0], x[2]]) }], { h: 240, base: 100, fmt: (v) => v.toFixed(0) }) : ""}
        <table class="tbl mt12"><thead><tr><th></th>${PER.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
          <tr><td>Your portfolio (${esc(p.base)})</td>${PER.map(([k]) => `<td class="num ${V.cls(p.returns[k] && p.returns[k].base)}">${p.returns[k] ? V.pct(p.returns[k].base, 2) : "—"}</td>`).join("")}</tr>
          <tr><td class="muted">…of which currency effect</td>${PER.map(([k]) => `<td class="num muted">${p.returns[k] ? V.pct(p.returns[k].fx, 2) : "—"}</td>`).join("")}</tr>
          <tr><td>Blended benchmark</td>${PER.map(([k]) => `<td class="num ${V.cls(b.blend[k])}">${V.pct(b.blend[k], 2)}</td>`).join("")}</tr>
          <tr><td><b>Difference</b></td>${PER.map(([k]) => { const d = p.returns[k] && b.blend[k] != null ? p.returns[k].base - b.blend[k] : null; return `<td class="num ${V.cls(d)}"><b>${V.pct(d, 2)}</b></td>`; }).join("")}</tr></tbody></table>
        <div class="help mt12">${p.notes.map(esc).join(" ")}</div></div>
      <div class="s4 col gap16">
        <div class="panel"><div class="panel-h"><h3>Concentration</h3>${V.lbl("calculated")}</div>
          <div class="grid g2"><div class="kpi"><span class="l">Largest</span><span class="v" style="font-size:20px">${V.pct(p.top1, 1, false)}</span></div><div class="kpi"><span class="l">Top 5</span><span class="v" style="font-size:20px">${V.pct(p.top5, 0, false)}</span></div></div>
          <div class="mt12">${V.barList(p.by_sector.slice(0, 8).map((s) => ({ label: s.name, value: s.weight, color: V.color(s.name) })))}</div>
          ${p.breaches.map((x) => `<div class="callout mt8">${esc(x.kind)} <b>${esc(x.name)}</b> ${V.pct(x.weight, 1, false)} > limit ${V.pct(x.limit, 0, false)}</div>`).join("")}</div>
        <div class="panel"><div class="panel-h"><h3>Currency mix</h3></div><div class="row gap16">${V.donut(p.by_currency.map((c) => ({ label: c.name, value: c.weight })), 100)}<div class="col gap6 small">${p.by_currency.map((c) => `<div class="row gap6"><span class="dot" style="background:${V.color(c.name)}"></span>${esc(c.name)} <b class="mono">${V.pct(c.weight, 1, false)}</b></div>`).join("")}<div class="src">FX (CAD per unit): ${Object.entries(p.fx).filter(([k]) => ["USD", "EUR"].includes(k)).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(" · ")}</div></div></div></div>
      </div>
      <div class="s12 panel"><div class="panel-h"><h3>Hidden exposure</h3>${V.lbl("interpretation")}<div class="tools"><a class="btn ghost xs" href="#/portfolio/exposure">Full exposure →</a></div></div>${hiddenHtml(p.hidden.slice(0, 3))}</div>
      ${p.gaps.length ? `<div class="s12 callout">Data gaps: ${p.gaps.map((g) => `<b>${esc(g.ticker)}</b> ${esc(g.issue)}`).join(" · ")}</div>` : ""}</div>`;
  }
  function hiddenHtml(list) {
    if (!list.length) return `<div class="empty small">No hidden overlaps detected.</div>`;
    return `<div class="grid g3">${list.map((h) => `<div class="panel" style="background:var(--panel2)"><div class="row gap6"><span class="chip" style="cursor:default">${esc({ driver: "shared driver", dependency: "shared dependency", currency: "currency", statistical: "moves together" }[h.type])}</span><span class="mono small muted">${V.pct(h.weight, 0, false)} of portfolio</span>${h.type === "statistical" ? V.lbl("statistical") : ""}</div>
      <div class="ttl mt8">${esc(h.headline)}</div><div class="row wrap gap6 mt8">${h.holdings.map((x) => `<span class="chip" style="cursor:default" title="${esc(x.sector)}"><span class="tkr">${esc(x.ticker)}</span>${x.sens != null ? `<span class="mono xs ${V.cls(x.sens)}">${x.sens > 0 ? "+" : ""}${x.sens.toFixed(1)}</span>` : ""}</span>`).join("")}</div>
      <div class="help mt8">${esc((h.gaps || []).join("; ") || "Evidence: built-in sensitivities (editable per holding) and dependency tags.")}</div></div>`).join("")}</div>`;
  }

  function holdings(el, p) {
    let sortK = "value", dir = -1, group = "account";
    const draw = () => {
      const rows = p.holdings.slice().sort((a, b) => {
        const g = (r) => sortK === "ticker" ? r.ticker : sortK === "d1" ? (r.returns["1d"] || {}).base : sortK === "ytd" ? (r.returns.ytd || {}).base : sortK === "pl" ? r.pl : sortK === "plp" ? r.pl_pct : r[sortK];
        const x = g(a), y = g(b); return (x == null) - (y == null) || (x > y ? 1 : x < y ? -1 : 0) * dir;
      });
      const groups = group === "none" ? [["", rows]] : [...new Set(rows.map((r) => r[group]))].map((k) => [k, rows.filter((r) => r[group] === k)]);
      const th = (k, l, num) => `<th class="sort ${num ? "num" : ""}" data-sort="${k}">${l}${sortK === k ? (dir < 0 ? " ↓" : " ↑") : ""}</th>`;
      el.innerHTML = `<div class="row" style="margin-bottom:8px"><span class="xs mono muted">GROUP BY</span><div class="seg">${[["account", "Account"], ["sector", "Sector"], ["currency", "Currency"], ["none", "None"]].map(([k, l]) => `<button data-g="${k}" class="${group === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
        <div class="panel flush"><div class="tblwrap"><table class="tbl"><thead><tr>${th("ticker", "Holding")}${th("quantity", "Qty", 1)}${th("price", "Price", 1)}${th("value", "Value (" + p.base + ")", 1)}${th("weight", "Weight", 1)}${th("d1", "Day", 1)}${th("ytd", "YTD", 1)}${th("pl", "Unrealised", 1)}${th("plp", "%", 1)}<th>Thesis</th></tr></thead><tbody>
        ${groups.map(([gname, gr]) => (gname ? `<tr class="group"><td colspan="10">${esc(gname)} · ${V.money(gr.reduce((a, r) => a + (r.value || 0), 0), p.base, 0)} · ${V.pct(gr.reduce((a, r) => a + r.weight, 0), 1, false)}</td></tr>` : "") + gr.map((r) => `<tr class="click" data-h="${r.id}">
          <td><div class="tkr">${esc(r.ticker || "—")}${r.broker_symbol && r.broker_symbol !== r.ticker ? ` <span class="xs dim">${esc(r.broker_symbol)}</span>` : ""}</div><div class="xs muted ellipsis" style="max-width:240px">${esc(r.name)} · ${esc(r.sector)}</div></td>
          <td class="num">${V.num(r.quantity, r.quantity % 1 ? 2 : 0)}</td>
          <td class="num">${r.price != null ? V.num(r.price, r.price < 1 ? 4 : 2) : "—"} <span class="xs dim">${esc(r.currency)}</span>${["broker", "manual", "stale quote"].includes(r.price_src) ? " " + V.lbl("estimate", r.price_src) : ""}</td>
          <td class="num">${V.money(r.value, p.base, 0)}</td><td class="num"><span class="wbar"><b style="width:${Math.min(100, r.weight * 400)}%"></b></span> ${V.pct(r.weight, 1, false)}</td>
          <td class="num ${V.cls((r.returns["1d"] || {}).base)}">${V.pct((r.returns["1d"] || {}).base)}</td>
          <td class="num ${V.cls((r.returns.ytd || {}).base)}" title="${r.returns.ytd ? "Local " + V.pct(r.returns.ytd.local) + " · FX " + V.pct(r.returns.ytd.fx) : ""}">${V.pct((r.returns.ytd || {}).base)}</td>
          <td class="num ${V.cls(r.pl)}" title="${esc(r.cost_note)}">${r.pl != null ? V.money(r.pl, p.base, 0) : "—"}</td><td class="num ${V.cls(r.pl_pct)}">${r.pl_pct != null ? V.pct(r.pl_pct, 0) : "—"}</td>
          <td>${r.ticker === "CASH" ? "" : r.thesis && r.thesis.why ? V.lbl("calculated", "written") : V.lbl("missing", "missing")}</td></tr>`).join("")).join("")}
        </tbody><tfoot><tr><td>Total</td><td></td><td></td><td class="num">${V.money(p.total, p.base, 0)}</td><td class="num">100%</td><td class="num ${V.cls((p.returns["1d"] || {}).base)}">${V.pct((p.returns["1d"] || {}).base)}</td><td class="num ${V.cls((p.returns.ytd || {}).base)}">${V.pct((p.returns.ytd || {}).base)}</td><td class="num ${V.cls(p.pl)}">${V.money(p.pl, p.base, 0)}</td><td class="num">${p.cost ? V.pct(p.pl / p.cost, 0) : "—"}</td><td></td></tr></tfoot></table></div></div>
        <div class="help mt8">YTD is in ${esc(p.base)} including currency effects (hover for local vs FX). Book costs from your broker export are used as-is; where purchase FX is unknown, today's rate is used and flagged.</div>`;
      $$("[data-sort]", el).forEach((t) => (t.onclick = () => { if (sortK === t.dataset.sort) dir = -dir; else { sortK = t.dataset.sort; dir = -1; } draw(); }));
      $$("[data-g]", el).forEach((t) => (t.onclick = () => { group = t.dataset.g; draw(); }));
      $$("[data-h]", el).forEach((t) => (t.onclick = () => V.go("holding/" + t.dataset.h)));
    };
    draw();
  }

  function exposure(el, p) {
    const f = p.factors;
    const ex = Object.entries(p.exposures).filter(([, v]) => Math.abs(v.value) > 0.01).sort((a, b) => Math.abs(b[1].value) - Math.abs(a[1].value));
    el.innerHTML = `<div class="grid g12">
      <div class="s7 panel"><div class="panel-h"><h3>Sensitivity to economic drivers</h3>${V.lbl("estimate")}</div><div class="small muted" style="margin-bottom:10px">Weighted sum of each holding's built-in sensitivity (−1 to +1). Positive = the portfolio tends to gain when the driver rises. Click a row for contributors.</div>
        <div class="bars div">${ex.map(([k, v]) => `<div class="b clickable" data-f="${k}" title="${esc(f[k].desc)}"><span class="ellipsis">${esc(f[k].label)}</span><span class="track"><b style="left:${v.value >= 0 ? 50 : 50 - Math.min(50, Math.abs(v.value) * 100)}%;width:${Math.min(50, Math.abs(v.value) * 100)}%;background:${v.value >= 0 ? "var(--up)" : "var(--down)"}"></b></span><span class="mono right small">${v.value > 0 ? "+" : ""}${v.value.toFixed(2)}</span></div>`).join("")}</div><div id="contrib" class="mt16"></div></div>
      <div class="s5 col gap16">${[["Sector", p.by_sector], ["Geography", p.by_country], ["Currency", p.by_currency], ["Account", p.by_account]].map(([t, rows]) => `<div class="panel"><div class="panel-h"><h3>${t}</h3>${V.lbl("calculated")}</div>${V.barList(rows.slice(0, 8).map((s) => ({ label: s.name, value: s.weight, color: V.color(s.name) })))}</div>`).join("")}</div>
      <div class="s12 panel"><div class="panel-h"><h3>Hidden exposure detection</h3>${V.lbl("interpretation")}</div><div class="small muted" style="margin-bottom:10px">Holdings that look different but lean on the same driver, dependency, currency, or that have actually moved together over the past year.</div>${hiddenHtml(p.hidden)}</div></div>`;
    $$("[data-f]", el).forEach((r) => (r.onclick = () => { const k = r.dataset.f, v = p.exposures[k]; $("#contrib", el).innerHTML = `<div class="kicker">Contributors to ${esc(f[k].label)}</div>` + V.barList(v.contributors.map(([t, c]) => ({ label: t, value: c })), { diverging: true, fmt: (x) => (x > 0 ? "+" : "") + x.toFixed(3) }); }));
  }

  async function risk(el, p) {
    el.innerHTML = `<div class="loading"><span class="spin"></span>Fitting models on your price history…</div>`;
    await V.store.ensure(p.holdings.filter((r) => r.ticker && r.ticker !== "CASH").map((r) => "h:" + r.ticker).concat(K.FACTOR_TICKERS.map((t) => "h:" + t)));
    const a = V.engine.analytics(), rk = a.risk, fm = a.factors;
    if (!rk) { el.innerHTML = `<div class="panel"><div class="empty"><b>Not enough price history yet</b>Risk statistics need about three months of daily prices for at least two holdings. The engine downloads two years of history for each position; check back after its next runs.</div></div>`; return; }
    const top = fm.rows.filter((r) => r.betas).sort((x, y) => y.weight - x.weight);
    el.innerHTML = `<div class="grid g12">
      <div class="s12"><div class="grid g5">
        <div class="panel"><div class="kicker">Volatility (annualised)</div><div class="kpi mt8"><span class="v" style="font-size:24px">${V.pct(rk.vol, 1, false)}</span></div><div class="small muted">S&amp;P 500 is typically 15–20%</div></div>
        <div class="panel"><div class="kicker">1-in-20 bad day</div><div class="kpi mt8"><span class="v down" style="font-size:24px">−${V.money(rk.var1d, p.base, 0)}</span></div><div class="small muted">${V.pct(rk.var1d_pct, 1, false)} of the covered value (historical 95% VaR)</div></div>
        <div class="panel"><div class="kicker">1-in-20 bad month</div><div class="kpi mt8"><span class="v down" style="font-size:24px">−${V.money(rk.var1m, p.base, 0)}</span></div><div class="small muted">${V.pct(rk.var1m_pct, 1, false)} over 21 trading days</div></div>
        <div class="panel"><div class="kicker">Beta to S&amp;P 500</div><div class="kpi mt8"><span class="v" style="font-size:24px">${rk.beta != null ? rk.beta.toFixed(2) : "—"}</span></div><div class="small muted">1.0 = moves with the market</div></div>
        <div class="panel"><div class="kicker">Max drawdown (1y)</div><div class="kpi mt8"><span class="v down" style="font-size:24px">${V.pct(rk.mdd, 1)}</span></div><div class="small muted">Peak-to-trough at today's weights</div></div>
      </div><div class="help mt8">${V.lbl("statistical")} Computed from ${rk.days} trading days (${esc(rk.from)} → ${esc(rk.to)}) of daily returns in ${esc(p.base)}, holding today's weights fixed; covers ${V.pct(rk.coverage, 0, false)} of your portfolio (holdings with price history${rk.missing && rk.missing.length ? `; not covered: ${esc(rk.missing.join(", "))}` : ""}). The past year may not resemble the next.</div></div>
      <div class="s6 panel"><div class="panel-h"><h3>Where your risk comes from</h3>${V.lbl("statistical")}</div><div class="small muted" style="margin-bottom:8px">Share of portfolio volatility contributed by each holding, versus its share of value.</div>
        <table class="tbl"><thead><tr><th>Holding</th><th class="num">Value</th><th class="num">Risk</th><th class="num">Own vol</th></tr></thead><tbody>${rk.contrib.slice(0, 14).map((c) => `<tr class="click" data-h="${c.id}"><td class="tkr">${esc(c.ticker)}</td><td class="num">${V.pct(c.weight, 1, false)}</td><td class="num"><b class="${c.rc > c.weight * 1.4 ? "down" : ""}">${V.pct(c.rc, 1, false)}</b></td><td class="num muted">${V.pct(c.vol, 0, false)}</td></tr>`).join("")}</tbody></table></div>
      <div class="s6 panel"><div class="panel-h"><h3>What actually moves your holdings</h3>${V.lbl("statistical")}</div><div class="small muted" style="margin-bottom:8px">Regression of each holding's daily returns on five drivers. Read: "when the S&amp;P rises 1%, this holding has tended to move x%".</div>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>Holding</th>${V.engine.FACTORS_STAT.map((f) => `<th class="num" title="${esc(f.unit)}">${esc(f.label.split(" (")[0])}</th>`).join("")}<th class="num">R²</th></tr></thead><tbody>
        ${top.map((r) => `<tr class="click" data-h="${r.id}"><td class="tkr">${esc(r.ticker)}</td>${V.engine.FACTORS_STAT.map((f) => { const b = r.betas[f.id]; return `<td class="num ${Math.abs(b.t) >= 2 ? V.cls(b.per) : "muted"}" title="t = ${b.t.toFixed(1)}">${V.pct(b.per, 2)}</td>`; }).join("")}<td class="num muted">${r.r2.toFixed(2)}</td></tr>`).join("")}
        <tr style="font-weight:700"><td>Portfolio</td>${V.engine.FACTORS_STAT.map((f) => `<td class="num ${V.cls(fm.portfolio[f.id])}">${V.pct(fm.portfolio[f.id], 2)}</td>`).join("")}<td></td></tr></tbody></table></div>
        <div class="help mt8">Columns: per +1% S&amp;P · per +1% Nasdaq-over-S&amp;P · per +10 bp US 10-year · per +10% WTI · per +1% US dollar. Greyed = not statistically distinguishable from zero (|t| &lt; 2).${fm.rows.some((r) => !r.betas) ? ` Not fitted: ${fm.rows.filter((r) => !r.betas).map((r) => `${esc(r.ticker)} (${r.illiquid != null ? "price barely moves" : "short history"})`).join(", ")}.` : ""}</div></div>
      <div class="s12 panel"><div class="panel-h"><h3>Correlation map</h3>${V.lbl("statistical")}<div class="tools legend"><span><i style="background:var(--acc);height:8px"></i>move together</span><span><i style="background:var(--blue);height:8px"></i>move opposite</span></div></div>${V.heatmap(rk.tickers, rk.corr)}
        ${a.clusters.length ? `<div class="mt12">${a.clusters.map((c) => `<div class="small">${V.lbl("statistical", "cluster")} <b>${c.members.map((m) => m.ticker).join(", ")}</b>: ${V.pct(c.weight, 0, false)} of your portfolio, average correlation ${c.avg.toFixed(2)}. Diversification between them is weaker than their different names suggest.</div>`).join("")}</div>` : ""}</div></div>`;
    $$("[data-h]", el).forEach((t) => (t.onclick = () => V.go("holding/" + t.dataset.h)));
  }

  function income(el, p) {
    const rows = p.holdings.filter((r) => r.income > 0).sort((a, b) => b.income - a.income), funds = p.holdings.filter((r) => r.distribution > 0);
    const usdTfsa = rows.filter((r) => r.account === "TFSA" && r.currency === "USD");
    el.innerHTML = `<div class="grid g12"><div class="s4 col gap16">
        <div class="panel"><div class="kicker">Estimated annual income</div><div class="kpi mt8"><span class="v" style="font-size:26px">${V.money(p.income, p.base, 0)}</span></div><div class="small muted">≈ ${V.money(p.income / 12, p.base, 0)}/month · yield ${V.pct(p.yield, 2, false)} ${V.lbl("estimate")}</div></div>
        ${usdTfsa.length ? `<div class="callout">US dividends inside a <b>TFSA</b> lose 15% to US withholding tax that can't be recovered (the treaty exemption covers RRSPs, not TFSAs). Affected: ${usdTfsa.map((r) => esc(r.ticker)).join(", ")} ≈ ${V.money(usdTfsa.reduce((a, r) => a + r.income, 0) * 0.15, p.base, 0)}/yr. Worth a conversation with a tax professional.</div>` : ""}
        ${funds.map((r) => `<div class="callout info"><b>${esc(r.ticker)} fund distribution</b>: ${V.num(r.div_ps, 3)} ${esc(r.currency)}/share in the last 12 months${r.div_last ? ` (paid ${esc(V.iso(new Date(r.div_last[0] * 1000)))})` : ""}, ≈ ${V.money(r.distribution, p.base, 0)} on your ${V.num(r.quantity, 0)} shares. A once-a-year payout from an actively managed fund is mostly realised capital gains: the fund's price drops by the same amount, so it isn't counted as yield here. Outside a TFSA/RRSP it's taxable in the year paid. ${V.lbl("interpretation")}</div>`).join("")}
        <div class="help">Trailing-12-month dividends per share from market data where available, otherwise your broker's stated annual amount. Converted at today's FX. Next ex-dates come from your broker when still ahead, otherwise they're projected from the usual payment rhythm (est.).</div></div>
      <div class="s8 panel"><div class="panel-h"><h3>Income by holding</h3></div>${rows.length ? `<table class="tbl"><thead><tr><th>Holding</th><th>Account</th><th class="num">Per share</th><th class="num">Annual (${esc(p.base)})</th><th class="num">Yield on value</th><th>Next ex-date</th><th>Source</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="click" data-h="${r.id}"><td class="tkr">${esc(r.ticker)}</td><td class="small">${esc(r.account)}</td><td class="num">${V.num(r.div_ps, 4)} ${esc(r.currency)}</td><td class="num">${V.money(r.income, p.base, 0)}</td><td class="num">${V.pct(r.value ? r.income / r.value : null, 2, false)}</td><td class="mono small">${r.div_next ? esc(r.div_next.d) + (r.div_next.est ? ` <span class="xs muted">est.</span>` : "") : "—"}</td><td class="xs muted">${esc(r.div_src || "")}</td></tr>`).join("")}</tbody></table>` : `<div class="empty small">No dividend-paying holdings detected.</div>`}</div></div>`;
    $$("[data-h]", el).forEach((t) => (t.onclick = () => V.go("holding/" + t.dataset.h)));
  }

  function thesis(el, p) {
    el.innerHTML = `<div class="callout info" style="margin-bottom:14px">Every holding can carry a living thesis: why you own it, what you expect, what would prove you wrong, and indicators to watch. The monitor scans news for evidence touching them and flags it on the Radar. Every edit is kept as a dated revision.</div>
      <div class="grid g2">${p.holdings.filter((r) => r.ticker !== "CASH").map((r) => { const t = r.thesis || {}; return `<div class="panel clickable" data-h="${r.id}"><div class="row"><span class="tkr">${esc(r.ticker || r.name)}</span><span class="xs muted">${V.pct(r.weight, 1, false)} · ${esc(r.sector)} · ${esc(r.account)}</span><span class="grow"></span>${t.conviction ? `<span class="mono xs">conviction ${"●".repeat(t.conviction)}${"○".repeat(5 - t.conviction)}</span>` : ""}</div>
        ${t.why ? `<div class="kv mt12"><div>Why I own it</div><div>${esc(t.why)}</div><div>Expect</div><div>${esc(t.expect || "—")}</div><div>Wrong if</div><div>${esc(t.wrong_if || "—")}</div></div>` : `<div class="small muted mt8">No thesis yet. Click to write one.</div>`}</div>`; }).join("")}</div>`;
    $$("[data-h]", el).forEach((t) => (t.onclick = () => V.go("holding/" + t.dataset.h)));
  }

  function watch(el, p) {
    el.innerHTML = `<div class="panel"><div class="panel-h"><h3>Watchlist</h3><div class="tools"><button class="btn sm" id="addW">${V.icon("plus")} Add</button></div></div>
      ${p.watch.length ? `<table class="tbl"><thead><tr><th>Ticker</th><th>Why I'm watching</th><th class="num">Price</th><th class="num">Day</th><th class="num">1Y</th><th></th></tr></thead><tbody>${p.watch.map((w) => `<tr><td><div class="tkr clickable" data-t="${esc(w.ticker)}">${esc(w.ticker)}</div><div class="xs muted">${esc(w.name || "")}</div></td><td class="small">${esc(w.reason || "")}</td><td class="num">${w.price != null ? V.num(w.price, 2) + " " + esc(w.currency) : "—"}</td><td class="num ${V.cls(w.d1)}">${V.pct(w.d1)}</td><td class="num ${V.cls(w.y1)}">${V.pct(w.y1)}</td><td class="right"><button class="btn ghost xs" data-rm="${w.id}">Remove</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty">Nothing on your watchlist.</div>`}</div>`;
    $("#addW").onclick = () => { const b = V.modal("Add to watchlist", `<form class="form">${V.field("Ticker", "ticker", "", { ph: "ASML or BN.TO" })}${V.field("Why?", "reason", "", { area: true })}</form>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="sv">Add</button>`); $("#sv", b).onclick = async () => { const d = V.formData(b); if (!d.ticker) return; d.ticker = d.ticker.toUpperCase(); await V.try(() => V.post("/api/r/watch", d), "Added"); V.closeOverlay(); V.render(); }; };
    $$("[data-rm]", el).forEach((b) => (b.onclick = async () => { await V.del("/api/r/watch/" + b.dataset.rm); V.render(); }));
    $$("[data-t]", el).forEach((b) => (b.onclick = () => V.openIndicator(b.dataset.t)));
  }

  function importModal() {
    const b = V.modal("Import holdings", `<p class="small muted">Drop one or more files. <b>RBC Direct Investing "Holdings Export" CSVs</b> are recognised automatically (account, cash, book cost, dividends, symbol mapping to market tickers, e.g. NET.UN → NET-UN.V, CDRs → .NE). Other brokers: any CSV with <code>symbol</code>, <code>quantity</code> and <code>average cost</code> or <code>book value</code>. Re-importing updates quantities and keeps your theses.</p>
      <div class="panel" id="drop" style="text-align:center;border-style:dashed;padding:26px;cursor:pointer"><b>Drop CSV files here</b><div class="small muted">or click to choose</div><input type="file" id="file" accept=".csv,text/csv" multiple class="hidden"></div>
      <textarea class="in mono mt12" id="csv" rows="5" placeholder="…or paste CSV text"></textarea><div id="impOut" class="mt12"></div>`, `<button class="btn ghost" data-close>Close</button><button class="btn pri" id="go">Import pasted text</button>`);
    const run = async (texts) => {
      const out = $("#impOut", b); out.innerHTML = `<div class="loading" style="padding:10px"><span class="spin"></span>Resolving symbols…</div>`;
      const res = [];
      for (const t of texts) { try { res.push(await V.post("/api/import/holdings", { csv: t })); } catch (e) { res.push({ error: e.message }); } }
      out.innerHTML = res.map((r) => r.error ? `<div class="callout bad">${esc(r.error)}</div>` : `<div class="callout info"><b>${esc(r.account || "Import")}</b>${r.asof ? " · as of " + esc(r.asof) : ""}: ${r.added} added, ${r.updated} updated.${r.gone && r.gone.length ? ` Not in this export: ${r.gone.map((g) => esc(g.ticker)).join(", ")} <button class="btn xs danger" data-gone='${esc(JSON.stringify(r.gone.map((g) => g.id)))}'>Remove them</button>` : ""}</div>`).join("");
      $$("[data-gone]", out).forEach((x) => (x.onclick = async () => { for (const id of JSON.parse(x.dataset.gone)) await V.del("/api/r/holding/" + id); x.replaceWith(document.createTextNode(" Removed.")); }));
      V.toast("Import complete", "ok");
    };
    const drop = $("#drop", b), file = $("#file", b);
    drop.onclick = () => file.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = "var(--acc)"; };
    drop.ondrop = async (e) => { e.preventDefault(); run(await Promise.all([...e.dataTransfer.files].map((f) => f.text()))); };
    file.onchange = async () => run(await Promise.all([...file.files].map((f) => f.text())));
    $("#go", b).onclick = () => { const t = $("#csv", b).value.trim(); if (t) run([t]); };
    const obs = new MutationObserver(() => { if (!document.body.contains(b)) { obs.disconnect(); V.render(); } });
    obs.observe(document.body, { childList: true });
  }

  V.editHolding = function (rec) {
    rec = rec || {};
    const isNew = !rec.id;
    const b = V.modal(isNew ? "Add holding" : "Edit " + esc(rec.ticker || rec.name), `<form class="form two">
      ${V.field("Ticker", "ticker", rec.ticker, { ph: "AAPL · SHOP.TO · CASH", help: "Yahoo Finance symbol. CASH for cash balances." })}${V.field("Name (optional)", "name", rec.name)}
      ${V.field("Quantity", "quantity", rec.quantity, { type: "number" })}${V.field("Average cost per unit", "cost", rec.cost, { type: "number", help: "In the holding's own currency." })}
      ${V.field("Account", "account", rec.account, { ph: "TFSA, RRSP, Taxable…" })}${V.field("Currency override", "currency", rec.currency, { ph: "auto" })}
      ${V.field("Total cost in base currency (optional)", "cost_base_total", rec.cost_base_total, { type: "number" })}${V.field("Manual price (unlisted assets)", "manual_price", rec.manual_price, { type: "number" })}</form>`,
      `${isNew ? "" : '<button class="btn danger" id="delH" style="margin-right:auto">Delete</button>'}<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="svH">Save</button>`);
    $("#svH", b).onclick = async () => {
      const d = V.formData(b);
      if (!d.ticker && !d.name) return V.toast("Add a ticker or a name", "err");
      const r = isNew ? await V.try(() => V.post("/api/r/holding", d)) : await V.try(() => V.put("/api/r/holding/" + rec.id, d));
      V.closeOverlay(); V.toast("Saved", "ok");
      if (isNew) V.go("holding/" + r.id); else V.render();
    };
    if (!isNew) $("#delH", b).onclick = async () => { if (await V.confirm("Delete this holding? Its history stays in the revision log.", "Delete")) { await V.del("/api/r/holding/" + rec.id); V.go("portfolio/holdings"); } };
  };

  /* ---------- holding detail ---------- */
  V.views.holding = async function (page, rest) {
    const d = await V.get("/api/holding/" + rest[0]);
    const r = d.row || {}, rec = d.record, t = rec.thesis || {}, q = d.quote || {};
    const base = (V.cache.port || {}).base || "CAD";
    const fl = d.filings;
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker"><a href="#/portfolio/holdings">Portfolio</a> / ${esc(r.account || "")} · ${esc(r.sector || "")} · ${esc(r.country || "")}</div>
        <h1><span class="mono">${esc(rec.ticker || "")}</span> <span style="font-weight:500;color:var(--muted)">${esc(r.name || rec.name || "")}</span></h1>
        <p>${r.price != null ? `<b class="mono">${V.num(r.price, r.price < 1 ? 4 : 2)} ${esc(r.currency)}</b> ${V.dpct(r.returns && r.returns["1d"] ? r.returns["1d"].local : null, 2)} · ${esc(q.x || "")} · ${r.price_src === "quote" ? V.fresh(q.t || q.fetched, 3 * 86400) + " <span class='src'>Yahoo Finance (delayed)</span>" : V.lbl("estimate", r.price_src + " price") + (rec.broker_asof ? ` <span class="src">as of ${esc(rec.broker_asof)}</span>` : "")}` : "No live quote."}</p></div>
        <div class="actions"><button class="btn impact" id="impH">${V.icon("impact")} What moves this?</button><button class="btn" id="edH">Edit position</button></div></div>
      ${rec.note ? `<div class="callout" style="margin-bottom:14px">${esc(rec.note)}</div>` : ""}
      <div class="grid g12"><div class="s8 col gap16">
        <div class="panel"><div class="panel-h"><h3>Price history</h3>${V.lbl("fact", "quote history")}</div><div id="hChart"></div></div>
        <div class="panel hl"><div class="panel-h"><h3>Living thesis</h3><div class="tools">${d.revisions.length > 1 ? `<button class="btn ghost xs" id="revs">${d.revisions.length} revisions</button>` : ""}<button class="btn sm" id="edT">${t.why ? "Update" : "Write thesis"}</button></div></div>
          ${t.why ? `<div class="kv"><div>Why I own it</div><div>${esc(t.why)}</div><div>What I expect</div><div>${esc(t.expect || "—")}</div><div>Wrong if</div><div>${esc(t.wrong_if || "—")}</div><div>Indicators</div><div>${(t.indicators || []).map((i) => `<span class="chip" style="cursor:default">${esc(i)}</span>`).join(" ") || "—"}</div><div>Horizon · conviction</div><div>${esc(t.horizon || "—")} · ${t.conviction ? t.conviction + "/5" : "—"}</div></div>` : `<div class="empty"><b>No thesis yet</b>Without one, the thesis monitor has nothing to test new evidence against.</div>`}</div>
        <div class="panel"><div class="panel-h"><h3>Thesis monitor</h3>${V.lbl("interpretation")}</div>
          ${d.alerts.length ? d.alerts.map((a) => `<div class="alert" style="grid-template-columns:3px 1fr"><div class="sc" style="background:var(--violet)"></div><div><h4>${esc(a.title)}</h4><div class="small">${esc(a.body.why || "")} ${esc(a.body.latest || "")}</div><ul class="ev-list">${(a.body.evidence || []).filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
            <div class="small mt8">${a.body.ai ? `<b>${esc((a.body.ai.verdict || "").toUpperCase())}</b> ${V.lbl("ai", "Claude")} ${esc(a.body.ai.what_changed || "")}` : `<span class="muted">${esc(a.body.assessment || "")}</span>`}</div>
            <div class="row gap6 mt8">${a.body.link ? `<a class="btn xs" href="${esc(a.body.link)}" target="_blank" rel="noopener">Read ${V.icon("ext")}</a>` : ""}<button class="btn ai xs" data-assess="${a.id}">${V.icon("spark")} Assess with Claude</button><button class="btn ghost xs" data-fb="${a.id}">Dismiss</button></div></div></div>`).join("") : `<div class="empty small">No new evidence touching this position in the last 72 hours.</div>`}</div>
        ${rec.fund ? `<div class="panel"><div class="panel-h"><h3>Look-through: what this fund owns</h3>${V.lbl("fact", "SEC N-PORT")}</div><div id="fund"><div class="loading" style="padding:14px"><span class="spin"></span>Reading the fund's latest SEC filing…</div></div></div>` : ""}
        <div class="panel"><div class="panel-h"><h3>Filings &amp; announcements</h3>${V.lbl("fact", "SEC EDGAR")}</div>
          ${fl && fl.filings ? `<div class="list">${fl.filings.slice(0, 12).map((f) => `<div class="item"><span class="mono small" style="width:86px;flex:none">${esc(f.filed)}</span><span class="chip" style="cursor:default">${esc(f.form)}</span><div class="grow small">${esc(f.labels.join(", ") || f.desc || "")}<div class="src">period ${esc(f.period || "—")}</div></div><a class="btn ghost xs" href="${esc(f.url)}" target="_blank" rel="noopener">${V.icon("ext")}</a></div>`).join("")}</div><div class="help mt8">Form 4 insider filings (90 days): ${fl.insider_form4_90d}. ${fl.earnings_dates.length ? "Last earnings 8-K: " + esc(fl.earnings_dates[0]) + "." : ""}</div>` : `<div class="empty small">${esc(d.filings_note || (fl && fl.error) || (rec.fund ? "Mutual fund: see look-through above." : "Not an SEC registrant."))}</div>`}</div>
        <div class="panel"><div class="panel-h"><h3>In the news</h3></div>${d.news.length ? `<div class="list">${d.news.map((n) => `<div class="item"><div class="grow"><a class="ttl small" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="src">${esc(n.source)} · ${V.time(n.published)}</div></div></div>`).join("")}</div>` : `<div class="empty small">No mentions in your feeds this week.</div>`}</div>
      </div><div class="s4 col gap16">
        <div class="panel"><div class="panel-h"><h3>Position</h3>${V.lbl("calculated")}</div><div class="kv">
          <div>Quantity</div><div class="mono">${V.num(rec.quantity, 3)}</div><div>Value</div><div class="mono">${V.money(r.value, base)} ${esc(base)}</div><div>Weight</div><div class="mono">${V.pct(r.weight, 2, false)}</div>
          <div>Book cost</div><div class="mono">${V.money(r.cost_base, base)}<div class="xs dim">${esc(r.cost_note || "")}</div></div><div>Unrealised</div><div class="mono ${V.cls(r.pl)}">${V.money(r.pl, base)} ${r.pl_pct != null ? "(" + V.pct(r.pl_pct, 0) + ")" : ""}</div>
          <div>Account</div><div>${esc(r.account)}${rec.account_no ? " ···" + esc(rec.account_no) : ""}</div>${rec.broker_symbol ? `<div>Broker symbol</div><div class="mono">${esc(rec.broker_symbol)}</div>` : ""}
          ${r.income ? `<div>Income</div><div class="mono">≈${V.money(r.income, base, 0)}/yr</div>` : ""}</div>
          <table class="tbl mt12"><thead><tr><th></th>${PER.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
            ${["local", "fx", "base"].map((k) => `<tr><td class="small">${k === "base" ? "In " + esc(base) : k === "fx" ? "FX" : "Local"}</td>${PER.map(([pk]) => `<td class="num small ${k === "fx" ? "muted" : V.cls(r.returns && r.returns[pk] && r.returns[pk][k])}">${r.returns && r.returns[pk] ? V.pct(r.returns[pk][k]) : "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        ${d.fit ? `<div class="panel"><div class="panel-h"><h3>What moves it (fitted)</h3>${V.lbl("statistical")}</div>${d.fit.betas ? V.barList(d.stat.map((f) => ({ label: f.label, value: d.fit.betas[f.id].per, title: `${f.unit}; t = ${d.fit.betas[f.id].t.toFixed(1)}`, color: Math.abs(d.fit.betas[f.id].t) >= 2 ? undefined : "var(--line2)" })), { diverging: true, fmt: (x) => V.pct(x, 2) }) + `<div class="help mt8">Per +1% S&amp;P · +1% Nasdaq vs S&amp;P · +10 bp 10-year · +10% oil · +1% US dollar. R² ${d.fit.r2.toFixed(2)} over ${d.fit.n} days. Grey = not significant.</div>` : d.fit.illiquid != null ? `<div class="small muted">The quoted price barely moves (${d.fit.illiquid} changes in a year), so there is nothing to fit. Often a halted or defunct listing.</div>` : `<div class="small muted">Needs ~6 months of daily prices (${d.fit.insufficient || 0} so far).</div>`}</div>` : ""}
        <div class="panel"><div class="panel-h"><h3>Driver sensitivities</h3>${V.lbl("estimate")}<div class="tools"><button class="btn xs" id="edS">Tune</button></div></div>
          <div class="small muted" style="margin-bottom:8px">Sector: <b>${esc(r.sector)}</b> <span class="xs">(${esc(r.sector_source || "")})</span> · beta ${(r.beta || 1).toFixed(2)}</div>
          ${V.barList(Object.entries(r.sens || {}).sort((a, c) => Math.abs(c[1]) - Math.abs(a[1])).map(([k, v]) => ({ label: d.factors[k], value: v })), { diverging: true, max: 1, fmt: (x) => (x > 0 ? "+" : "") + x.toFixed(1) })}
          ${(r.deps || []).length ? `<div class="kicker mt12">Dependencies</div><div class="row wrap gap6 mt8">${r.deps.map((x) => `<span class="chip" style="cursor:default">${esc(x)}</span>`).join("")}</div>` : ""}</div>
        <div class="panel"><div class="panel-h"><h3>Catalysts</h3><div class="tools"><button class="btn xs" id="addC">${V.icon("plus")}</button></div></div>${(rec.catalysts || []).length ? `<div class="list">${rec.catalysts.map((c, i) => `<div class="item small"><span class="mono">${esc(c.date)}</span><span class="grow">${esc(c.title)}</span><button class="btn ghost xs" data-rc="${i}">×</button></div>`).join("")}</div>` : `<div class="small muted">Add earnings dates, launches or votes. They appear on your calendar.</div>`}</div>
      </div></div></div>`;
    if (d.series && d.series.length) V.rangeChart($("#hChart"), d.series, { name: rec.ticker, fmt: (v) => v.toFixed(v < 10 ? 2 : 0), canLog: true, range: "1Y", hlines: rec.cost ? [{ v: +rec.cost, label: "your average cost", color: "var(--blue)" }] : [] });
    else $("#hChart").innerHTML = `<div class="empty small">No price history${rec.ticker === "CASH" ? " (cash)" : " yet"}.</div>`;
    $("#edH").onclick = () => V.editHolding(rec);
    $("#edT").onclick = () => editThesis(rec);
    $("#edS").onclick = () => editSens(rec, r, d);
    $("#impH").onclick = () => V.openImpact({ title: (rec.ticker || "") + " " + (r.name || ""), text: (t.why || "") + " " + (t.wrong_if || "") + " " + (t.indicators || []).join(" ") + " " + (r.deps || []).join(" ") });
    const rv = $("#revs"); if (rv) rv.onclick = () => V.showRevisions(d.revisions, "thesis");
    $("#addC").onclick = () => { const bx = V.modal("Add catalyst", `<form class="form">${V.field("Date", "date", "", { type: "date" })}${V.field("What", "title", "", { ph: "Q4 earnings, investor day…" })}</form>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="sc">Add</button>`); $("#sc", bx).onclick = async () => { const x = V.formData(bx); if (!x.date || !x.title) return; await V.put("/api/r/holding/" + rec.id, { catalysts: (rec.catalysts || []).concat([x]) }); V.closeOverlay(); V.render(); }; };
    $$("[data-rc]").forEach((btn) => (btn.onclick = async () => { const c = (rec.catalysts || []).slice(); c.splice(+btn.dataset.rc, 1); await V.put("/api/r/holding/" + rec.id, { catalysts: c }); V.render(); }));
    $$("[data-fb]").forEach((btn) => (btn.onclick = async () => { await V.post(`/api/radar/${btn.dataset.fb}/feedback`, { fb: "dismiss" }); V.render(); }));
    $$("[data-assess]").forEach((btn) => (btn.onclick = async () => { if (!V.state.ai || !V.state.ai.ok) return V.aiHelp(); btn.innerHTML = '<span class="spin"></span>'; btn.disabled = true; try { await V.post(`/api/holding/${rec.id}/assess`, { alert: btn.dataset.assess }); V.render(); } catch (e) { V.toast(e.message, "err"); btn.disabled = false; } }));
    if (rec.fund) {
      try {
        const f = await V.get("/api/fund/" + rec.fund.series);
        const ov = f.holdings.filter((x) => x.overlap);
        $("#fund").innerHTML = `<div class="small" style="margin-bottom:8px">Latest N-PORT for period ${esc(f.period || "?")} (filed ${esc(f.filed || "?")}). Top holdings by weight; <b>${ov.length}</b> overlap with positions you also hold directly.</div>
          ${ov.length ? `<div class="callout" style="margin-bottom:10px">Hidden overlap: this fund also owns ${ov.map((x) => `<b>${esc(x.overlap.ticker)}</b> (${V.pct(x.pct, 1, false)} of fund)`).join(", ")}. Your true exposure to those names is higher than their direct weights suggest.</div>` : ""}
          <table class="tbl"><thead><tr><th>Holding</th><th class="num">% of fund</th><th class="num">≈ your exposure</th></tr></thead><tbody>${f.holdings.slice(0, 20).map((x) => `<tr><td>${esc(x.name)}${x.overlap ? " " + V.lbl("calculated", "you also hold") : ""}</td><td class="num">${V.pct(x.pct, 2, false)}</td><td class="num">${V.money(x.pct * (r.value || 0), base, 0)}</td></tr>`).join("")}</tbody></table>
          <div class="help mt8"><a href="${esc(f.url)}" target="_blank" rel="noopener">SEC filing</a> · N-PORT holdings are disclosed with a lag (~60 days after quarter end).</div>`;
      } catch (e) { $("#fund").innerHTML = `<div class="small muted">Couldn't read the fund's filing: ${esc(e.message)}${/Settings/.test(e.message) ? ` <a href="#/settings/integrations">Open Integrations →</a>` : ""}</div>`; }
    }
  };
  function editThesis(rec) {
    const t = rec.thesis || {};
    const b = V.modal("Living thesis · " + esc(rec.ticker || ""), `<form class="form">
      ${V.field("Why I own it", "why", t.why, { area: true, ph: "The core reason, in one or two sentences." })}${V.field("What I expect", "expect", t.expect, { area: true, rows: 2 })}
      ${V.field("What would prove me wrong", "wrong_if", t.wrong_if, { area: true, rows: 2 })}${V.field("Indicators to watch (comma-separated)", "indicators", t.indicators, { list: true, ph: "margins, AI capex, China" })}
      <div class="form two">${V.field("Horizon", "horizon", t.horizon, { ph: "3-5 years" })}${V.field("Conviction (1-5)", "conviction", t.conviction, { options: [["", "—"], 1, 2, 3, 4, 5] })}</div>
      ${V.field("Target weight (0.08 = 8%)", "target_weight", rec.target_weight, { type: "number" })}</form><div class="help">Every save is kept as a dated revision.</div>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="svT">Save thesis</button>`);
    $("#svT", b).onclick = async () => { const d = V.formData(b); const tw = d.target_weight; delete d.target_weight; if (d.conviction) d.conviction = +d.conviction; await V.try(() => V.put("/api/r/holding/" + rec.id, { thesis: d, target_weight: tw }), "Thesis saved"); V.closeOverlay(); V.render(); };
  }
  function editSens(rec, r, d) {
    const cur = r.sens || {};
    const b = V.modal("Tune sensitivities · " + esc(rec.ticker || ""), `<div class="form">${V.field("Sector", "sector", rec.sector || r.sector, { options: d.sectors })}${V.field("Dependencies (comma-separated)", "deps", rec.deps, { list: true })}
      <div class="small muted">How does this holding tend to move when each driver <b>rises</b>? −1 hurt · 0 unaffected · +1 helped.</div>
      ${Object.entries(d.factors).map(([k, l]) => `<div class="sl"><span class="nm">${esc(l)}</span><span class="val" id="sv-${k}">${(cur[k] || 0).toFixed(1)}</span><input type="range" min="-1" max="1" step="0.1" value="${cur[k] || 0}" data-k="${k}"></div>`).join("")}</div>`,
      `<button class="btn ghost" id="rsS" style="margin-right:auto">Reset</button><button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="svS">Save</button>`);
    const changed = {};
    $$("[data-k]", b).forEach((i) => (i.oninput = () => { $("#sv-" + i.dataset.k, b).textContent = (+i.value).toFixed(1); changed[i.dataset.k] = +i.value; }));
    $("#svS", b).onclick = async () => { const f = V.formData(b); await V.try(() => V.put("/api/r/holding/" + rec.id, { sector: f.sector, deps: f.deps, sensitivities: Object.assign({}, rec.sensitivities || {}, changed) }), "Saved"); V.closeOverlay(); V.render(); };
    $("#rsS", b).onclick = async () => { await V.put("/api/r/holding/" + rec.id, { sensitivities: {}, sector: null }); V.closeOverlay(); V.render(); };
  }
  V.showRevisions = function (revs, field) {
    V.drawer("Revision history", revs.slice().reverse().map((r) => `<div class="panel" style="margin-bottom:10px"><div class="row"><span class="mono small">${new Date(r.ts * 1000).toLocaleString()}</span><span class="chip" style="cursor:default">${esc(r.action)}</span></div>
      ${field && r.data[field] ? `<div class="kv mt12">${Object.entries(r.data[field]).map(([k, v]) => `<div>${esc(k)}</div><div>${esc(Array.isArray(v) ? v.join(", ") : v)}</div>`).join("")}</div>` : `<pre class="small mono" style="white-space:pre-wrap;color:var(--text2)">${esc(JSON.stringify(r.data, null, 2)).slice(0, 3000)}</pre>`}</div>`).join(""), { kicker: "Append-only log" });
  };
})();
