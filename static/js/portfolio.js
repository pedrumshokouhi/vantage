/* Portfolio intelligence: performance, exposure, hidden exposure, living theses, holding detail. */
"use strict";
(function () {
  const esc = V.esc, $ = V.$, $$ = V.$$;
  const PER = [["1d", "Day"], ["1m", "1M"], ["ytd", "YTD"], ["1y", "1Y"]];

  V.views.portfolio = async function (page, rest) {
    const tab = rest[0] || "overview";
    const p = await V.get("/api/portfolio");
    V.cache.port = p;
    const tabs = [["overview", "Overview"], ["holdings", "Holdings"], ["exposure", "Exposure"], ["thesis", "Theses"], ["watch", "Watchlist"]];
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Portfolio intelligence · base ${esc(p.base)}</div><h1>${p.count ? V.money(p.total, p.base, 0) : "Your portfolio"}</h1>
        <p>${p.count ? `${p.count} positions · effective diversification ≈ ${p.effective_n.toFixed(1)} equal-weight positions · ${V.fresh(p.asof, 3600)}` : "Add holdings by hand or import a CSV from your brokerage."}</p></div>
        <div class="actions"><button class="btn" id="imp">${V.icon("down")} Import CSV</button><button class="btn pri" id="add">${V.icon("plus")} Add holding</button><button class="btn ghost" id="rf" title="Refresh quotes">${V.icon("refresh")}</button></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div>
      <div id="tabBody"></div></div>`;
    $$("[data-tab]", page).forEach((b) => (b.onclick = () => V.go("portfolio/" + b.dataset.tab)));
    $("#add").onclick = () => V.editHolding();
    $("#imp").onclick = importModal;
    $("#rf").onclick = async () => { await V.try(() => V.get("/api/portfolio?force=1"), "Quotes refreshed"); V.render(); };
    const body = $("#tabBody");
    if (!p.count && tab !== "watch") { body.innerHTML = `<div class="panel"><div class="empty"><b>No holdings in this workspace yet</b>Add positions manually, or import a CSV with columns like <code>symbol, quantity, average cost, currency, account</code>.<div class="row mt16" style="justify-content:center"><button class="btn pri" id="add2">Add holding</button><button class="btn" id="imp2">Import CSV</button></div></div></div>`; $("#add2").onclick = () => V.editHolding(); $("#imp2").onclick = importModal; return; }
    ({ overview, holdings, exposure, thesis, watch }[tab] || overview)(body, p);
  };

  function overview(el, p) {
    const b = p.benchmark;
    el.innerHTML = `<div class="grid g12">
      <div class="s8 panel"><div class="panel-h"><h3>Performance vs benchmark</h3>${V.lbl("calculated")}<div class="tools legend"><span><i style="background:var(--ion)"></i>You (in ${esc(p.base)})</span><span><i style="background:rgba(148,170,200,.6)"></i>${b.parts.map((x) => esc((x.name || x.ticker) + " " + Math.round(x.w * 100) + "%")).join(" + ")}</span></div></div>
        ${p.series ? V.lineChart([{ name: "You", color: "var(--ion)", pts: p.series.map((x) => [x[0], x[1]]) }, { name: "Benchmark", color: "rgba(148,170,200,.65)", dash: "4 4", pts: p.series.map((x) => [x[0], x[2]]) }], { h: 240, base: 100, fmt: (v) => v.toFixed(0) }) : ""}
        <table class="tbl mt12"><thead><tr><th></th>${PER.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
          <tr><td>Your portfolio (${esc(p.base)})</td>${PER.map(([k]) => `<td class="num ${V.cls(p.returns[k] && p.returns[k].base)}">${p.returns[k] ? V.pct(p.returns[k].base, 2) : "—"}</td>`).join("")}</tr>
          <tr><td class="muted">…of which currency effect</td>${PER.map(([k]) => `<td class="num muted">${p.returns[k] ? V.pct(p.returns[k].fx, 2) : "—"}</td>`).join("")}</tr>
          <tr><td>Blended benchmark</td>${PER.map(([k]) => `<td class="num ${V.cls(b.blend[k])}">${V.pct(b.blend[k], 2)}</td>`).join("")}</tr>
          <tr><td><b>Difference</b></td>${PER.map(([k]) => { const d = p.returns[k] && b.blend[k] != null ? p.returns[k].base - b.blend[k] : null; return `<td class="num ${V.cls(d)}"><b>${V.pct(d, 2)}</b></td>`; }).join("")}</tr>
        </tbody></table>
        <div class="help mt12">${p.notes.map(esc).join(" ")}</div>
      </div>
      <div class="s4 col gap16">
        <div class="panel"><div class="panel-h"><h3>Concentration</h3>${V.lbl("calculated")}</div>
          <div class="grid g2"><div class="kpi"><span class="l">Largest</span><span class="v" style="font-size:22px">${V.pct(p.top1, 1, false)}</span></div><div class="kpi"><span class="l">Top 5</span><span class="v" style="font-size:22px">${V.pct(p.top5, 0, false)}</span></div></div>
          <div class="mt16">${V.barList(p.by_sector.slice(0, 7).map((s) => ({ label: s.name, value: s.weight, color: V.color(s.name) })))}</div>
          <div class="help mt12">Limits: ${V.pct(p.limits.max_position, 0, false)} per position, ${V.pct(p.limits.max_sector, 0, false)} per sector (Settings).</div>
          ${p.breaches.map((x) => `<div class="callout mt8">${esc(x.kind)} <b>${esc(x.name)}</b> at ${V.pct(x.weight, 1, false)} exceeds ${V.pct(x.limit, 0, false)}</div>`).join("")}
        </div>
        <div class="panel"><div class="panel-h"><h3>Currency mix</h3></div><div class="row gap16">${V.donut(p.by_currency.map((c) => ({ label: c.name, value: c.weight })), 110)}<div class="col gap6 small">${p.by_currency.map((c) => `<div class="row gap6"><span class="dot" style="background:${V.color(c.name)}"></span>${esc(c.name)} <b class="mono">${V.pct(c.weight, 1, false)}</b></div>`).join("")}<div class="src">FX: ${Object.entries(p.fx).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(" · ")} CAD</div></div></div></div>
        ${riskChange(p.risk_change)}
      </div>
      <div class="s12 panel"><div class="panel-h"><h3>Hidden exposure</h3>${V.lbl("interpretation")}<div class="tools"><a class="btn ghost xs" href="#/portfolio/exposure">Full exposure →</a></div></div>${hiddenHtml(p.hidden.slice(0, 3))}</div>
      ${p.gaps.length ? `<div class="s12 callout">Data gaps: ${p.gaps.map((g) => `<b>${esc(g.ticker)}</b> ${esc(g.issue)}`).join(" · ")}</div>` : ""}
    </div>`;
  }

  function riskChange(rc) {
    if (!rc || !rc.available) return `<div class="panel"><div class="panel-h"><h3>Risk since last month</h3></div><div class="small muted">${esc((rc && rc.note) || "")}</div></div>`;
    return `<div class="panel"><div class="panel-h"><h3>Risk change</h3>${V.lbl("calculated")}</div><div class="small muted">${esc(rc.from)} → ${esc(rc.to)}</div>
      ${rc.drivers.slice(0, 5).map((d) => `<div class="row sp small mt8"><span>${esc(d.factor)}</span><span class="mono">${d.from.toFixed(2)} → <b>${d.to.toFixed(2)}</b></span></div>`).join("") || `<div class="small muted mt8">No material change in driver exposure.</div>`}</div>`;
  }

  function hiddenHtml(list) {
    if (!list.length) return `<div class="empty small">No hidden overlaps detected across drivers, dependencies or currency.</div>`;
    return `<div class="grid g3">${list.map((h) => `<div class="panel" style="background:rgba(0,0,0,.2)">
      <div class="row gap6"><span class="chip" style="cursor:default">${esc(h.type === "driver" ? "shared driver" : h.type === "dependency" ? "shared dependency" : "currency")}</span><span class="mono small muted">${V.pct(h.weight, 0, false)} of portfolio</span></div>
      <div class="ttl mt8">${esc(h.headline)}</div>
      <div class="row wrap gap6 mt12">${h.holdings.map((x) => `<span class="chip" style="cursor:default" title="${esc(x.sector)}${x.src ? " · " + esc(x.src) : ""}"><span class="tkr">${esc(x.ticker)}</span>${x.sens != null ? `<span class="mono xs ${V.cls(x.sens)}">${x.sens > 0 ? "+" : ""}${x.sens.toFixed(1)}</span>` : ""}<span class="xs dim">${esc(x.sector)}</span></span>`).join("")}</div>
      ${h.gaps && h.gaps.length ? `<div class="help mt8">Evidence gaps: ${esc(h.gaps.join("; "))}</div>` : `<div class="help mt8">Evidence: built-in sensitivities (editable per holding) and your dependency tags.</div>`}
    </div>`).join("")}</div>`;
  }

  function holdings(el, p) {
    let sortK = localStorage.getItem("vt_sort") || "value", dir = -1;
    const draw = () => {
      const rows = p.holdings.slice().sort((a, b) => {
        const g = (r) => sortK === "ticker" ? r.ticker : sortK === "d1" ? (r.returns["1d"] || {}).base : sortK === "ytd" ? (r.returns.ytd || {}).base : sortK === "pl" ? r.pl : r[sortK];
        const x = g(a), y = g(b);
        return (x == null) - (y == null) || (x > y ? 1 : x < y ? -1 : 0) * dir;
      });
      const th = (k, l, num) => `<th class="sort ${num ? "num" : ""}" data-sort="${k}">${l}${sortK === k ? (dir < 0 ? " ↓" : " ↑") : ""}</th>`;
      el.innerHTML = `<div class="panel flush"><div class="tblwrap"><table class="tbl"><thead><tr>${th("ticker", "Holding")}${th("account", "Account")}${th("quantity", "Qty", 1)}${th("price", "Price", 1)}${th("value", "Value (" + p.base + ")", 1)}${th("weight", "Weight", 1)}${th("d1", "Day", 1)}${th("ytd", "YTD (" + p.base + ")", 1)}${th("pl", "Unrealised P/L", 1)}<th>Thesis</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="click" data-h="${r.id}">
          <td><div class="tkr">${esc(r.ticker || "—")}</div><div class="xs muted ellipsis" style="max-width:220px">${esc(r.name)} · ${esc(r.sector)}</div></td>
          <td class="small muted">${esc(r.account)}</td>
          <td class="num">${V.num(r.quantity, r.quantity % 1 ? 3 : 0)}</td>
          <td class="num">${r.price != null ? V.num(r.price, 2) : "—"} <span class="xs dim">${esc(r.currency)}</span>${r.price_src === "manual" ? " " + V.lbl("estimate", "manual") : ""}</td>
          <td class="num">${V.money(r.value, p.base, 0)}</td>
          <td class="num"><span class="wbar"><b style="width:${Math.min(100, r.weight * 400)}%"></b></span> ${V.pct(r.weight, 1, false)}</td>
          <td class="num ${V.cls((r.returns["1d"] || {}).base)}">${V.pct((r.returns["1d"] || {}).base)}</td>
          <td class="num ${V.cls((r.returns.ytd || {}).base)}" title="${r.returns.ytd ? "Local " + V.pct(r.returns.ytd.local) + " · FX " + V.pct(r.returns.ytd.fx) : ""}">${V.pct((r.returns.ytd || {}).base)}</td>
          <td class="num ${V.cls(r.pl)}" title="${esc(r.cost_note)}">${r.pl != null ? V.money(r.pl, p.base, 0) : "—"}</td>
          <td>${r.thesis && r.thesis.why ? `<span class="lbl calculated">written</span>` : `<span class="lbl missing">missing</span>`}</td>
        </tr>`).join("")}</tbody></table></div></div>
        <div class="help mt12">YTD in ${esc(p.base)} includes currency effects; hover for local vs FX split. Unrealised P/L uses today's FX when purchase FX wasn't entered.</div>`;
      $$("[data-sort]", el).forEach((t) => (t.onclick = () => { if (sortK === t.dataset.sort) dir = -dir; else { sortK = t.dataset.sort; dir = -1; } localStorage.setItem("vt_sort", sortK); draw(); }));
      $$("[data-h]", el).forEach((t) => (t.onclick = () => V.go("holding/" + t.dataset.h)));
    };
    draw();
  }

  function exposure(el, p) {
    const f = p.factors;
    const ex = Object.entries(p.exposures).filter(([, v]) => Math.abs(v.value) > 0.01).sort((a, b) => Math.abs(b[1].value) - Math.abs(a[1].value));
    el.innerHTML = `<div class="grid g12">
      <div class="s7 panel"><div class="panel-h"><h3>Sensitivity to economic drivers</h3>${V.lbl("estimate")}</div>
        <div class="small muted" style="margin-bottom:12px">Weighted sum of each holding's sensitivity (−1 to +1). Positive = the portfolio tends to gain when the driver rises. Click a row for contributors.</div>
        <div class="bars div">${ex.map(([k, v]) => `<div class="b clickable" data-f="${k}" title="${esc(f[k].desc)}"><span class="ellipsis">${esc(f[k].label)}</span><span class="track"><b style="left:${v.value >= 0 ? 50 : 50 - Math.min(50, Math.abs(v.value) * 100)}%;width:${Math.min(50, Math.abs(v.value) * 100)}%;background:${v.value >= 0 ? "var(--up)" : "var(--down)"}"></b></span><span class="mono right small">${v.value > 0 ? "+" : ""}${v.value.toFixed(2)}</span></div>`).join("")}</div>
        <div id="contrib" class="mt16"></div>
      </div>
      <div class="s5 col gap16">
        ${[["Sector", p.by_sector], ["Geography", p.by_country], ["Currency", p.by_currency], ["Account", p.by_account]].map(([t, rows]) => `<div class="panel"><div class="panel-h"><h3>${t}</h3>${V.lbl("calculated")}</div>${V.barList(rows.slice(0, 8).map((s) => ({ label: s.name, value: s.weight, color: V.color(s.name) })))}</div>`).join("")}
      </div>
      <div class="s12 panel"><div class="panel-h"><h3>Hidden exposure detection</h3>${V.lbl("interpretation")}</div><div class="small muted" style="margin-bottom:12px">Holdings that look different (different sectors) but lean on the same underlying driver, dependency or currency. Broad market and growth sensitivity are excluded because every equity shares them.</div>${hiddenHtml(p.hidden)}</div>
    </div>`;
    $$("[data-f]", el).forEach((r) => (r.onclick = () => {
      const k = r.dataset.f, v = p.exposures[k];
      $("#contrib", el).innerHTML = `<div class="xs mono muted" style="letter-spacing:.12em">CONTRIBUTORS TO ${esc(f[k].label.toUpperCase())}</div>` + V.barList(v.contributors.map(([t, c]) => ({ label: t, value: c })), { diverging: true, fmt: (x) => (x > 0 ? "+" : "") + x.toFixed(3) });
    }));
  }

  function thesis(el, p) {
    el.innerHTML = `<div class="callout info" style="margin-bottom:16px">Every holding gets a living thesis: why you own it, what you expect, what would prove you wrong, and indicators to watch. The thesis monitor scans news and filings for evidence touching these and flags it on the Radar. Theses keep a full revision history.</div>
      <div class="grid g2">${p.holdings.map((r) => {
        const t = r.thesis || {};
        return `<div class="panel clickable" data-h="${r.id}"><div class="row"><span class="tkr">${esc(r.ticker || r.name)}</span><span class="xs muted">${V.pct(r.weight, 1, false)} · ${esc(r.sector)}</span><span class="grow"></span>${t.conviction ? `<span class="mono xs">conviction ${"●".repeat(t.conviction)}${"○".repeat(5 - t.conviction)}</span>` : ""}</div>
        ${t.why ? `<div class="kv mt12"><div>Why I own it</div><div>${esc(t.why)}</div><div>Expect</div><div>${esc(t.expect || "—")}</div><div>Wrong if</div><div>${esc(t.wrong_if || "—")}</div><div>Watch</div><div>${(t.indicators || []).map((i) => `<span class="chip" style="cursor:default">${esc(i)}</span>`).join(" ") || "—"}</div></div>` : `<div class="empty small"><b>No thesis written</b>Click to record why you own it.</div>`}
        </div>`;
      }).join("")}</div>`;
    $$("[data-h]", el).forEach((t) => (t.onclick = () => V.go("holding/" + t.dataset.h)));
  }

  function watch(el, p) {
    el.innerHTML = `<div class="panel"><div class="panel-h"><h3>Watchlist</h3><div class="tools"><button class="btn sm" id="addW">${V.icon("plus")} Add</button></div></div>
      ${p.watch.length ? `<table class="tbl"><thead><tr><th>Ticker</th><th>Why I'm watching</th><th class="num">Price</th><th class="num">Day</th><th class="num">1Y</th><th></th></tr></thead><tbody>${p.watch.map((w) => `<tr><td><div class="tkr">${esc(w.ticker)}</div><div class="xs muted">${esc(w.name || "")}</div></td><td class="small">${esc(w.reason || "")}</td><td class="num">${w.price != null ? V.num(w.price, 2) + " " + esc(w.currency) : "—"}</td><td class="num ${V.cls(w.d1)}">${V.pct(w.d1)}</td><td class="num ${V.cls(w.y1)}">${V.pct(w.y1)}</td><td class="right"><button class="btn ghost xs" data-rm="${w.id}">Remove</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty">Nothing on your watchlist.</div>`}</div>`;
    $("#addW").onclick = () => {
      const b = V.modal("Add to watchlist", `<form class="form">${V.field("Ticker", "ticker", "", { ph: "e.g. ASML or BN.TO" })}${V.field("Why are you watching it?", "reason", "", { area: true })}</form>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="sv">Add</button>`);
      $("#sv", b).onclick = async () => { const d = V.formData(b); if (!d.ticker) return; d.ticker = d.ticker.toUpperCase(); await V.try(() => V.post("/api/r/watch", d), "Added"); V.closeOverlay(); V.render(); };
    };
    $$("[data-rm]", el).forEach((b) => (b.onclick = async () => { await V.del("/api/r/watch/" + b.dataset.rm); V.render(); }));
  }

  function importModal() {
    const b = V.modal("Import holdings", `<p class="small muted">Paste CSV from your brokerage (Wealthsimple, Questrade, IBKR, etc.). Recognised headers include <code>symbol/ticker</code>, <code>quantity/shares</code>, <code>average cost</code> or <code>book value</code>, <code>currency</code>, <code>account</code>, <code>name</code>. Use Yahoo-style tickers for non-US listings (e.g. <code>SHOP.TO</code>).</p>
      <textarea class="in mono" id="csv" rows="10" placeholder="symbol,quantity,average cost,currency,account&#10;SHOP.TO,50,95,CAD,TFSA&#10;NVDA,20,110,USD,RRSP"></textarea>
      <label class="row small mt12"><input type="checkbox" id="merge" checked> Update existing positions with the same ticker and account</label>
      <div class="row mt12"><input type="file" id="file" accept=".csv,text/csv" class="small"></div>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="go">Import</button>`);
    $("#file", b).onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then((t) => ($("#csv", b).value = t)); };
    $("#go", b).onclick = async () => {
      const r = await V.try(() => V.post("/api/import/holdings", { csv: $("#csv", b).value, mode: $("#merge", b).checked ? "merge" : "add" }));
      V.toast(`Imported ${r.added} holding${r.added === 1 ? "" : "s"}${r.skipped.length ? " · skipped " + r.skipped.length : ""}`, "ok");
      V.closeOverlay(); V.render();
    };
  }

  V.editHolding = function (rec) {
    rec = rec || {};
    const isNew = !rec.id;
    const b = V.modal(isNew ? "Add holding" : "Edit " + esc(rec.ticker || rec.name), `<form class="form two">
      ${V.field("Ticker", "ticker", rec.ticker, { ph: "AAPL · SHOP.TO · BTC-USD · CASH", help: "Yahoo Finance symbol. Use CASH for cash balances." })}
      ${V.field("Name (optional)", "name", rec.name)}
      ${V.field("Quantity", "quantity", rec.quantity, { type: "number" })}
      ${V.field("Average cost per unit", "cost", rec.cost, { type: "number", help: "In the holding's own currency." })}
      ${V.field("Account", "account", rec.account, { ph: "TFSA, RRSP, Taxable…" })}
      ${V.field("Currency override", "currency", rec.currency, { ph: "auto from quote" })}
      ${V.field("Total cost in base currency (optional)", "cost_base_total", rec.cost_base_total, { type: "number", help: "Makes P/L exact when you bought at a different FX rate." })}
      ${V.field("Manual price (unlisted assets)", "manual_price", rec.manual_price, { type: "number" })}
    </form>`, `${isNew ? "" : '<button class="btn danger" id="delH" style="margin-right:auto">Delete</button>'}<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="svH">Save</button>`);
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
    const base = V.cache.port ? V.cache.port.base : "CAD";
    const fl = d.filings;
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker"><a href="#/portfolio/holdings">Portfolio</a> / ${esc(r.sector || "")} · ${esc(r.country || "")}</div>
        <h1><span class="mono" style="font-size:.8em;letter-spacing:-.02em">${esc(rec.ticker || "")}</span> <em style="font-size:.7em">${esc(r.name || rec.name || "")}</em></h1>
        <p>${q.price != null ? `<b class="mono">${V.num(q.price, 2)} ${esc(q.currency)}</b> ${V.dpct(r.returns && r.returns["1d"] ? r.returns["1d"].local : null, 2)} · ${esc(q.exchange || "")} · ${V.fresh(q.fetched, 3600)} <span class="src">${esc(q.source || "")}</span>` : "No live quote."}</p></div>
        <div class="actions"><button class="btn impact" id="impH">${V.icon("impact")} What moves this?</button><button class="btn" id="edH">Edit position</button></div></div>
      <div class="grid g12">
        <div class="s8 col gap16">
          <div class="panel"><div class="panel-h"><h3>Price, 1 year</h3>${V.lbl("fact", "quote history")}</div>${d.series ? V.lineChart([{ name: rec.ticker, color: "var(--ion)", pts: d.series }], { h: 220, fmt: (v) => v.toFixed(v < 10 ? 2 : 0) }) : '<div class="empty small">No price history.</div>'}</div>
          <div class="panel hl"><div class="panel-h"><h3>Living thesis</h3><div class="tools">${d.revisions.length > 1 ? `<button class="btn ghost xs" id="revs">${d.revisions.length} revisions</button>` : ""}<button class="btn sm" id="edT">${t.why ? "Update" : "Write thesis"}</button></div></div>
            ${t.why ? `<div class="kv"><div>Why I own it</div><div>${esc(t.why)}</div><div>What I expect</div><div>${esc(t.expect || "—")}</div><div>What would prove me wrong</div><div>${esc(t.wrong_if || "—")}</div><div>Indicators</div><div>${(t.indicators || []).map((i) => `<span class="chip" style="cursor:default">${esc(i)}</span>`).join(" ") || "—"}</div><div>Horizon · conviction</div><div>${esc(t.horizon || "—")} · ${t.conviction ? t.conviction + "/5" : "—"}</div><div>Target weight</div><div>${rec.target_weight != null ? V.pct(rec.target_weight, 1, false) + " (now " + V.pct(r.weight, 1, false) + ")" : "—"}</div></div>` : `<div class="empty"><b>No thesis yet</b>Without one, the thesis monitor has nothing to test new evidence against.</div>`}
          </div>
          <div class="panel"><div class="panel-h"><h3>Thesis monitor</h3>${V.lbl("interpretation")}</div>
            ${d.alerts.length ? `<div>${d.alerts.map((a) => `<div class="alert" style="grid-template-columns:4px 1fr"><div class="sc" style="background:var(--violet)"></div><div><h4>${esc(a.title)}</h4><div class="small">${esc(a.body.why || "")} ${esc(a.body.latest || "")}</div><ul class="ev-list">${(a.body.evidence || []).filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
              <div class="small mt8" id="as-${a.id}">${a.body.ai ? `<b>${esc((a.body.ai.verdict || "").toUpperCase())}</b> ${V.lbl("ai", "Claude")} ${esc(a.body.ai.what_changed || "")} <div class="muted">${esc(a.body.ai.reason || "")}</div>` : `<span class="muted">${esc(a.body.assessment || "")}</span>`}</div>
              <div class="row gap6 mt8">${a.body.link ? `<a class="btn xs" href="${esc(a.body.link)}" target="_blank" rel="noopener">Read source ${V.icon("ext")}</a>` : ""}<button class="btn ai xs" data-assess="${a.id}">${V.icon("spark")} Assess with Claude</button><button class="btn ghost xs" data-fb="${a.id}">Dismiss</button></div></div></div>`).join("")}</div>` : `<div class="empty small">No new evidence touching this thesis in the last 72 hours.</div>`}
          </div>
          <div class="panel"><div class="panel-h"><h3>Filings &amp; announcements</h3>${V.lbl("fact", "SEC EDGAR")}</div>
            ${fl && fl.filings ? `<div class="list">${fl.filings.slice(0, 12).map((f) => `<div class="item"><span class="mono small" style="width:88px;flex:none">${esc(f.filed)}</span><span class="chip" style="cursor:default">${esc(f.form)}</span><div class="grow small">${esc(f.labels.join(", ") || f.desc || "")}<div class="src">period ${esc(f.period || "—")}</div></div><a class="btn ghost xs" href="${esc(f.url)}" target="_blank" rel="noopener">Open ${V.icon("ext")}</a></div>`).join("")}</div><div class="help mt8">Form 4 insider filings in last 90 days: ${fl.insider_form4_90d}. ${fl.earnings_dates.length ? "Last earnings release (8-K 2.02): " + esc(fl.earnings_dates[0]) + "." : ""}</div>` : `<div class="empty small">${esc(d.filings_note || (fl && fl.error) || "Not an SEC registrant, or filings not loaded yet.")}</div>`}
          </div>
          <div class="panel"><div class="panel-h"><h3>In the news (7 days)</h3></div>${d.news.length ? `<div class="list">${d.news.map((n) => `<div class="item"><div class="grow"><a class="ttl small" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="src">${esc(n.source)} · ${V.time(n.published)}</div></div><button class="btn impact xs" data-imp="${esc(n.cluster || "")}">Affect me?</button></div>`).join("")}</div>` : `<div class="empty small">No mentions in your feeds.</div>`}</div>
        </div>
        <div class="s4 col gap16">
          <div class="panel"><div class="panel-h"><h3>Position</h3>${V.lbl("calculated")}</div><div class="kv">
            <div>Quantity</div><div class="mono">${V.num(rec.quantity, 3)}</div><div>Value</div><div class="mono">${V.money(r.value, base)} ${esc(base)}</div>
            <div>Weight</div><div class="mono">${V.pct(r.weight, 2, false)}</div><div>Cost basis</div><div class="mono">${V.money(r.cost_base, base)} <span class="xs dim">${esc(r.cost_note || "")}</span></div>
            <div>Unrealised</div><div class="mono ${V.cls(r.pl)}">${V.money(r.pl, base)}</div><div>Account</div><div>${esc(r.account)}</div></div>
            <table class="tbl mt12"><thead><tr><th></th>${PER.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
              <tr><td class="small">Local</td>${PER.map(([k]) => `<td class="num small ${V.cls(r.returns && r.returns[k] && r.returns[k].local)}">${r.returns && r.returns[k] ? V.pct(r.returns[k].local) : "—"}</td>`).join("")}</tr>
              <tr><td class="small">FX</td>${PER.map(([k]) => `<td class="num small muted">${r.returns && r.returns[k] ? V.pct(r.returns[k].fx) : "—"}</td>`).join("")}</tr>
              <tr><td class="small">In ${esc(base)}</td>${PER.map(([k]) => `<td class="num small ${V.cls(r.returns && r.returns[k] && r.returns[k].base)}"><b>${r.returns && r.returns[k] ? V.pct(r.returns[k].base) : "—"}</b></td>`).join("")}</tr></tbody></table>
          </div>
          <div class="panel"><div class="panel-h"><h3>Driver sensitivities</h3>${V.lbl("estimate")}<div class="tools"><button class="btn xs" id="edS">Tune</button></div></div>
            <div class="small muted" style="margin-bottom:10px">Sector: <b>${esc(r.sector)}</b> <span class="xs">(${esc(r.sector_source || "")})</span> · beta ${(r.beta || 1).toFixed(2)}</div>
            ${V.barList(Object.entries(r.sens || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => ({ label: d.factors[k], value: v })), { diverging: true, max: 1, fmt: (x) => (x > 0 ? "+" : "") + x.toFixed(1) })}
            ${(r.deps || []).length ? `<div class="xs mono muted mt16">DEPENDENCIES</div><div class="row wrap gap6 mt8">${r.deps.map((x) => `<span class="chip" style="cursor:default">${esc(x)}</span>`).join("")}</div>` : ""}
            <div class="help mt12">Source: ${esc(r.sens_source || "defaults")}. Rough, editable tendencies; they drive the consequence map, hidden exposure and the scenario lab.</div>
          </div>
          <div class="panel"><div class="panel-h"><h3>Catalysts</h3><div class="tools"><button class="btn xs" id="addC">${V.icon("plus")}</button></div></div>
            ${(rec.catalysts || []).length ? `<div class="list">${rec.catalysts.map((c, i) => `<div class="item small"><span class="mono">${esc(c.date)}</span><span class="grow">${esc(c.title)}</span><button class="btn ghost xs" data-rc="${i}">×</button></div>`).join("")}</div>` : `<div class="small muted">Add earnings dates, product launches or votes. They appear on your calendar.</div>`}
          </div>
        </div>
      </div></div>`;
    $("#edH").onclick = () => V.editHolding(rec);
    $("#edT").onclick = () => editThesis(rec);
    $("#edS").onclick = () => editSens(rec, r, d);
    $("#impH").onclick = () => V.openImpact({ title: (rec.ticker || "") + " " + (r.name || ""), text: (t.why || "") + " " + (t.wrong_if || "") + " " + (t.indicators || []).join(" ") });
    const rv = $("#revs"); if (rv) rv.onclick = () => V.showRevisions(d.revisions, "thesis");
    $("#addC").onclick = () => {
      const b = V.modal("Add catalyst", `<form class="form">${V.field("Date", "date", "", { type: "date" })}${V.field("What", "title", "", { ph: "Q4 earnings, investor day…" })}</form>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="sc">Add</button>`);
      $("#sc", b).onclick = async () => { const x = V.formData(b); if (!x.date || !x.title) return; await V.put("/api/r/holding/" + rec.id, { catalysts: (rec.catalysts || []).concat([x]) }); V.closeOverlay(); V.render(); };
    };
    $$("[data-rc]").forEach((btn) => (btn.onclick = async () => { const c = (rec.catalysts || []).slice(); c.splice(+btn.dataset.rc, 1); await V.put("/api/r/holding/" + rec.id, { catalysts: c }); V.render(); }));
    $$("[data-imp]").forEach((btn) => (btn.onclick = () => btn.dataset.imp && V.openImpact({ story_id: btn.dataset.imp })));
    $$("[data-fb]").forEach((btn) => (btn.onclick = async () => { await V.post(`/api/radar/${btn.dataset.fb}/feedback`, { fb: "dismiss" }); V.render(); }));
    $$("[data-assess]").forEach((btn) => (btn.onclick = async () => {
      if (!V.state.ai || !V.state.ai.ok) return V.aiHelp();
      btn.innerHTML = '<span class="spin"></span>'; btn.disabled = true;
      try { await V.post(`/api/holding/${rec.id}/assess`, { alert: btn.dataset.assess }); V.render(); } catch (e) { V.toast(e.message, "err"); btn.disabled = false; }
    }));
  };

  function editThesis(rec) {
    const t = rec.thesis || {};
    const b = V.modal("Living thesis · " + esc(rec.ticker || ""), `<form class="form">
      ${V.field("Why I own it", "why", t.why, { area: true, ph: "The core reason, in one or two sentences." })}
      ${V.field("What I expect", "expect", t.expect, { area: true, rows: 2, ph: "Measurable if possible: growth, margins, dividends, re-rating…" })}
      ${V.field("What would prove me wrong", "wrong_if", t.wrong_if, { area: true, rows: 2, ph: "Specific conditions that would break the thesis." })}
      ${V.field("Indicators to watch (comma-separated)", "indicators", t.indicators, { list: true, ph: "GMV, take rate, margins, export controls" })}
      <div class="form two">${V.field("Horizon", "horizon", t.horizon, { ph: "3-5 years" })}${V.field("Conviction (1-5)", "conviction", t.conviction, { options: [["", "—"], 1, 2, 3, 4, 5] })}</div>
      ${V.field("Target weight (e.g. 0.08 for 8%)", "target_weight", rec.target_weight, { type: "number" })}
    </form><div class="help">Every save is kept as a dated revision, so you can see how your reasoning evolved.</div>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="svT">Save thesis</button>`);
    $("#svT", b).onclick = async () => {
      const d = V.formData(b);
      const tw = d.target_weight; delete d.target_weight;
      if (d.conviction) d.conviction = +d.conviction;
      await V.try(() => V.put("/api/r/holding/" + rec.id, { thesis: d, target_weight: tw }), "Thesis saved");
      V.closeOverlay(); V.render();
    };
  }

  function editSens(rec, r, d) {
    const cur = r.sens || {};
    const b = V.modal("Tune sensitivities · " + esc(rec.ticker || ""), `<div class="form">
      ${V.field("Sector", "sector", rec.sector || r.sector, { options: d.sectors })}
      ${V.field("Dependencies (comma-separated)", "deps", rec.deps, { list: true, ph: "TSMC, US consumer, China demand" })}
      <div class="small muted">How does this holding tend to move when each driver <b>rises</b>? −1 strongly hurt · 0 unaffected · +1 strongly helped. Leave untouched to keep defaults.</div>
      ${Object.entries(d.factors).map(([k, l]) => `<div class="sl"><span class="nm">${esc(l)}</span><span class="val" id="sv-${k}">${(cur[k] || 0).toFixed(1)}</span><input type="range" min="-1" max="1" step="0.1" value="${cur[k] || 0}" data-k="${k}"></div>`).join("")}
    </div>`, `<button class="btn ghost" id="rsS" style="margin-right:auto">Reset to defaults</button><button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="svS">Save</button>`);
    const changed = {};
    $$("[data-k]", b).forEach((i) => (i.oninput = () => { $("#sv-" + i.dataset.k, b).textContent = (+i.value).toFixed(1); changed[i.dataset.k] = +i.value; }));
    $("#svS", b).onclick = async () => {
      const f = V.formData(b);
      await V.try(() => V.put("/api/r/holding/" + rec.id, { sector: f.sector, deps: f.deps, sensitivities: Object.assign({}, rec.sensitivities || {}, changed) }), "Saved");
      V.closeOverlay(); V.render();
    };
    $("#rsS", b).onclick = async () => { await V.put("/api/r/holding/" + rec.id, { sensitivities: {}, sector: null }); V.closeOverlay(); V.render(); };
  }

  V.showRevisions = function (revs, field) {
    V.drawer("Revision history", revs.slice().reverse().map((r) => `<div class="panel" style="margin-bottom:12px"><div class="row"><span class="mono small">${new Date(r.ts * 1000).toLocaleString()}</span><span class="chip" style="cursor:default">${esc(r.action)}</span></div>
      ${field && r.data[field] ? `<div class="kv mt12">${Object.entries(r.data[field]).map(([k, v]) => `<div>${esc(k)}</div><div>${esc(Array.isArray(v) ? v.join(", ") : v)}</div>`).join("")}</div>` : `<pre class="small mono" style="white-space:pre-wrap;color:var(--text2)">${esc(JSON.stringify(r.data, null, 2)).slice(0, 3000)}</pre>`}</div>`).join(""), { kicker: "Append-only log" });
  };
})();
