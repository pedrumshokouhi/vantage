/* Scenario lab + institutional filings. */
"use strict";
(function () {
  const esc = V.esc, $ = V.$, $$ = V.$$;

  const SLIDERS = [
    ["rates", "Interest rates (10-year)", -200, 300, 25, (v) => (v > 0 ? "+" : "") + v + " bp"],
    ["inflation", "Inflation", -2, 4, 0.5, (v) => (v > 0 ? "+" : "") + v + " pp"],
    ["oil", "Oil price", -50, 100, 5, (v) => (v > 0 ? "+" : "") + v + "%"],
    ["cad", "Canadian dollar vs USD", -20, 20, 1, (v) => (v > 0 ? "+" : "") + v + "%"],
    ["growth", "GDP growth", -4, 2, 0.5, (v) => (v > 0 ? "+" : "") + v + " pp"],
    ["market", "Broad equity market", -40, 30, 1, (v) => (v > 0 ? "+" : "") + v + "%"],
    ["tech", "Tech vs market", -20, 20, 1, (v) => (v > 0 ? "+" : "") + v + "%"],
    ["usd", "US dollar index", -15, 15, 1, (v) => (v > 0 ? "+" : "") + v + "%"],
  ];

  V.views.lab = async function (page) {
    const meta = await V.get("/api/scenario/presets");
    let inputs = V.state.labInputs || { oil: 40, inflation: 1, rates: 50, market: -8 };
    let model = inputs.model || "kb";
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Scenario lab · SCEN &lt;GO&gt;</div><h1>What if <em>the world shifts?</em></h1>
        <p>Adjust assumptions and see which positions are most sensitive. Currency translation and single-holding moves are <b>calculated</b>. Driver effects come from either the built-in sensitivity model or betas fitted on your holdings' actual price history, shown as ranges.</p></div>
        <div class="actions"><div class="seg" id="modelSeg"><button data-model="kb" class="on">Built-in model</button><button data-model="empirical">Fitted on your history</button></div><button class="btn" id="saveSc">${V.icon("plus")} Save scenario</button></div></div>
      <div class="row wrap gap6" style="margin-bottom:16px">${meta.presets.map((p) => `<button class="chip" data-preset="${p.id}" title="${esc(p.desc || "")}">${esc(p.name)}</button>`).join("")}<button class="chip" data-preset="reset">Reset</button></div>
      <div class="grid g12">
        <div class="s4 col gap16">
          <div class="panel"><div class="panel-h"><h3>Assumptions</h3></div><div class="col gap16" id="sliders"></div>
            <hr class="divider"><div class="sl"><span class="nm">A single holding moves</span><span class="val" id="hv"></span></div>
            <div class="row gap6 mt8"><select class="in" id="hSel"><option value="">— none —</option>${meta.holdings.map((h) => `<option value="${h.id}">${esc(h.ticker)}</option>`).join("")}</select></div>
            <input type="range" id="hPct" min="-80" max="80" step="5" value="${inputs.holding_pct || -30}">
            <hr class="divider"><label class="row small"><input type="checkbox" id="so" ${inputs.second_order === false ? "" : "checked"}> Include second-order effects (one hop of economic channels)</label>
            <details class="mt12"><summary class="small clickable muted">Advanced: push any driver directly</summary><div class="col gap6 mt12" id="adv">${Object.entries(meta.factors).map(([k, l]) => `<div class="sl"><span class="nm small">${esc(l)}</span><span class="val small" id="fv-${k}">0</span><input type="range" min="-2" max="2" step="0.25" value="${(inputs.factors || {})[k] || 0}" data-fk="${k}"></div>`).join("")}</div></details>
          </div>
          <div class="panel"><div class="panel-h"><h3>Saved scenarios</h3></div><div id="saved">${meta.saved.length ? meta.saved.map((s) => `<div class="item clickable" data-load="${s.id}"><div class="grow"><div class="ttl small">${esc(s.name)}</div><div class="meta">${esc(s.note || "")} · saved ${V.ago(s._created)}</div></div><button class="btn ghost xs" data-delsc="${s.id}">×</button></div>`).join("") : '<div class="small muted">Save scenarios to revisit them as events unfold.</div>'}</div></div>
        </div>
        <div class="s8 col gap16" id="out"><div class="loading"><span class="spin"></span></div></div>
      </div></div>`;
    const sl = $("#sliders");
    sl.innerHTML = SLIDERS.map(([k, l, mn, mx, st, f]) => `<div class="sl"><span class="nm">${l}</span><span class="val" id="v-${k}">${f(inputs[k] || 0)}</span><input type="range" min="${mn}" max="${mx}" step="${st}" value="${inputs[k] || 0}" data-k="${k}"></div>`).join("");
    const read = () => {
      const x = {};
      SLIDERS.forEach(([k, , , , , f]) => { const v = +$(`[data-k="${k}"]`).value; x[k] = v; $("#v-" + k).textContent = f(v); });
      x.factors = {}; $$("[data-fk]").forEach((i) => { const v = +i.value; $("#fv-" + i.dataset.fk).textContent = v.toFixed(2); if (v) x.factors[i.dataset.fk] = v; });
      x.holding = $("#hSel").value || null; x.holding_pct = +$("#hPct").value; $("#hv").textContent = x.holding ? (x.holding_pct > 0 ? "+" : "") + x.holding_pct + "%" : "off";
      x.second_order = $("#so").checked;
      x.model = model;
      return x;
    };
    const set = (x) => {
      SLIDERS.forEach(([k]) => ($(`[data-k="${k}"]`).value = x[k] || 0));
      $$("[data-fk]").forEach((i) => (i.value = (x.factors || {})[i.dataset.fk] || 0));
      $("#hSel").value = x.holding || ""; $("#hPct").value = x.holding_pct || -30;
      $("#so").checked = x.second_order !== false;
    };
    set(inputs);
    const run = V.debounce(async () => {
      inputs = read(); V.state.labInputs = inputs;
      try { draw(await V.post("/api/scenario", { inputs })); } catch (e) { $("#out").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    }, 180);
    $$("input,select", page).forEach((i) => (i.oninput = i.onchange = run));
    $$("[data-preset]").forEach((c) => (c.onclick = () => {
      const p = meta.presets.find((x) => x.id === c.dataset.preset);
      set(p ? Object.assign({ second_order: true }, p.inputs) : {});
      $$("[data-preset]").forEach((x) => x.classList.toggle("on", x === c && !!p)); run();
    }));
    $$("[data-load]").forEach((c) => (c.onclick = (e) => { if (e.target.closest("[data-delsc]")) return; const s = meta.saved.find((x) => x.id === c.dataset.load); set(s.inputs); run(); V.toast("Loaded “" + s.name + "”"); }));
    $$("[data-delsc]").forEach((b) => (b.onclick = async () => { await V.del("/api/r/scenario/" + b.dataset.delsc); V.render(); }));
    $("#saveSc").onclick = () => {
      const b = V.modal("Save scenario", `<form class="form">${V.field("Name", "name", "")}${V.field("Note (why it matters, when to revisit)", "note", "", { area: true, rows: 2 })}</form>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="ss">Save</button>`);
      $("#ss", b).onclick = async () => { const d = V.formData(b); if (!d.name) return; d.inputs = read(); await V.try(() => V.post("/api/r/scenario", d), "Scenario saved"); V.closeOverlay(); V.render(); };
    };
    $$("[data-model]").forEach((b) => (b.onclick = () => { model = b.dataset.model; $$("[data-model]").forEach((x) => x.classList.toggle("on", x === b)); run(); }));
    $$("[data-model]").forEach((x) => x.classList.toggle("on", x.dataset.model === model));
    run();

    function draw(r) {
      if (!r.rows.length) { $("#out").innerHTML = `<div class="panel"><div class="empty"><b>No holdings to stress</b>Add holdings first, or switch to the DEMO workspace.</div></div>`; return; }
      const span = Math.max(0.05, ...r.rows.map((x) => Math.max(Math.abs(x.low), Math.abs(x.high))));
      const X = (v) => 50 + (v / span) * 48;
      const totSpan = Math.max(0.05, Math.abs(r.low), Math.abs(r.high)) * 1.15;
      const TX = (v) => 50 + (v / totSpan) * 50;
      $("#out").innerHTML = `
        <div class="panel hl"><div class="row sp wrap gap16">
          <div class="kpi"><span class="l">Estimated portfolio effect</span><span class="v ${V.cls(r.pct)}">${V.pct(r.pct, 1)}</span><span class="mono small ${V.cls(r.delta)}">${V.money(r.delta, r.base, 0)} ${esc(r.base)}</span></div>
          <div class="grow" style="min-width:260px"><div class="range"><div class="axis"></div><div class="zero" style="left:50%"></div><div class="band" style="left:${TX(Math.min(r.low, r.high))}%;width:${Math.abs(TX(r.high) - TX(r.low))}%;background:${r.pct >= 0 ? "var(--up)" : "var(--down)"}"></div><div class="pt" style="left:${TX(r.pct)}%"></div></div>
            <div class="row sp xs mono muted"><span>range ${V.pct(Math.min(r.low, r.high))}</span><span>${V.pct(Math.max(r.low, r.high))}</span></div></div>
          <div>${V.lbl(r.model === "empirical" ? "statistical" : "estimate", r.model === "empirical" ? "fitted betas" : "hypothetical range")}</div></div>
          ${Object.keys(r.drivers).length ? `<div class="row wrap gap6 mt12">${Object.entries(r.drivers).map(([k, v]) => `<span class="chip" style="cursor:default">${esc(k)} <b class="mono ${V.cls(v)}">${v > 0 ? "+" : ""}${v.toFixed(2)}u</b></span>`).join("")}</div>` : ""}
        </div>
        <div class="panel"><div class="panel-h"><h3>Most sensitive positions</h3><div class="tools legend"><span><i style="background:var(--text)"></i>estimate</span><span><i style="background:var(--muted);height:4px;opacity:.5"></i>range</span></div></div>
          ${r.rows.map((x) => `<div class="hbar" data-row="${x.id}"><span class="tkr">${esc(x.ticker)}</span><span class="tr"><span class="rng" style="left:${X(Math.min(x.low, x.high))}%;width:${Math.max(0.5, Math.abs(X(x.high) - X(x.low)))}%;background:${x.pct >= 0 ? "var(--up)" : "var(--down)"}"></span><span class="v" style="left:${Math.min(X(0), X(x.pct))}%;width:${Math.max(0.4, Math.abs(X(x.pct) - X(0)))}%;background:${x.pct >= 0 ? "var(--up)" : "var(--down)"}"></span></span><span class="mono right small"><span class="${V.cls(x.pct)}">${V.pct(x.pct)}</span> <span class="muted">${V.money(x.delta, r.base, 0)}</span></span></div>
            <div class="small hidden" id="parts-${x.id}" style="padding:6px 0 10px 100px">${x.parts.map((p) => `<div class="row sp"><span>${esc(p.driver)} ${V.lbl(p.label)}</span><span class="mono ${V.cls(p.pct)}">${V.pct(p.pct, 2)}</span></div>`).join("") || '<span class="muted">No modelled sensitivity.</span>'}<div class="help">Sensitivity source: ${esc(x.sens_source || "defaults")}</div></div>`).join("")}
        </div>
        ${r.second_order.length ? `<div class="panel"><div class="panel-h"><h3>Second-order effects included</h3>${V.lbl("interpretation")}</div><div class="list">${r.second_order.map((s) => `<div class="item small"><div class="grow"><b>${esc(s.from)}</b> → <b>${esc(s.to)}</b> <span class="mono ${V.cls(s.value)}">${s.value > 0 ? "+" : ""}${s.value.toFixed(2)}u</span><div class="muted">${esc(s.logic)}</div></div></div>`).join("")}</div></div>` : ""}
        ${r.episodes.length ? `<div class="panel"><div class="panel-h"><h3>Historical comparisons</h3>${V.lbl("fact", "approx. history")}</div><div class="grid g3">${r.episodes.map((e) => `<div class="small"><b>${esc(e.title)}</b><div class="muted mt8">${esc(e.text)}</div></div>`).join("")}</div><div class="help mt12">Context, not prediction: starting valuations, policy and positioning differed each time.</div></div>` : ""}
        <div class="callout"><b>Limitations</b><ul>${r.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`;
      $$("[data-row]").forEach((row) => (row.onclick = () => $("#parts-" + row.dataset.row).classList.toggle("hidden")));
    }
  };

  /* ---------- Filings ---------- */
  V.views.filings = async function (page) {
    page.innerHTML = `<div class="loading"><span class="spin"></span>Reading SEC filings (first load can take a moment)…</div>`;
    const d = await V.get("/api/filings");
    const kinds = [["new", "New positions"], ["increased", "Increased"], ["reduced", "Reduced"], ["exited", "Exited"]];
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Filings · 13F &lt;GO&gt; · SEC EDGAR</div><h1>Follow the <em>allocators</em></h1>
        <p>Disclosed 13F changes from investors you follow, overlap with your holdings and watchlist, and patterns across them. Report period and filing date are always shown separately.</p></div>
        <div class="actions"><button class="btn" id="rfF">${V.icon("refresh")} Refresh</button><button class="btn pri" id="addI">${V.icon("plus")} Follow investor</button></div></div>
      <div class="callout" style="margin-bottom:16px"><b>Read these with care</b><ul>${d.caveats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>${d.sec_contact || V.state.sec ? "" : `<div class="mt8"><b>Needed once:</b> SEC only answers automated requests that declare a real contact email, so filings and fund look-throughs stay blank until you add yours in <a href="#/settings/integrations">Settings → Integrations</a>. It is sent only to sec.gov, in the request header SEC requires.</div>`}</div>
      ${d.patterns.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-h"><h3>Patterns across investors you follow</h3>${V.lbl("calculated")}</div><div class="grid g3">${d.patterns.map((p) => `<div class="small"><span class="${p.buy ? "up" : "down"} mono">${p.buy ? "▲ added by" : "▼ reduced/exited by"} ${p.who.length}</span><div class="ttl">${esc(p.issuer)}</div><div class="muted">${esc(p.who.join(", "))}</div></div>`).join("")}</div></div>` : ""}
      <div class="col gap16">${d.investors.length ? d.investors.map((inv) => inv.error ? `<div class="panel"><div class="row"><b>${esc(inv.name || "CIK " + inv.cik)}</b><span class="lbl missing">unavailable</span><span class="grow"></span><button class="btn ghost xs" data-unf="${inv.record_id}">Unfollow</button></div><div class="small muted mt8">${esc(inv.error)}</div></div>` : `
        <div class="panel"><div class="panel-h"><h3 style="text-transform:none;letter-spacing:0;font:700 17px var(--sans);color:var(--text)">${esc(titleCase(inv.name))}</h3>
          <div class="tools"><span class="src">CIK ${inv.cik}</span><a class="btn ghost xs" href="${esc(inv.url)}" target="_blank" rel="noopener">Filing ${V.icon("ext")}</a><button class="btn ghost xs" data-unf="${inv.record_id}">Unfollow</button></div></div>
          <div class="row wrap gap24 small">
            <div><span class="muted">Holdings as of</span> <b class="mono">${esc(inv.current.period)}</b></div>
            <div><span class="muted">Published</span> <b class="mono">${esc(inv.current.filed)}</b> <span class="xs dim">(${Math.round((new Date(inv.current.filed) - new Date(inv.current.period)) / 864e5)} days later)</span></div>
            <div><span class="muted">Compared with</span> <b class="mono">${esc(inv.previous ? inv.previous.period : "—")}</b></div>
            <div><span class="muted">Reported value</span> <b class="mono">$${V.compact(inv.total_value)}</b> · ${inv.positions} positions</div>
            ${inv.stale_error ? `<span class="lbl estimate">cached · refresh failed</span>` : ""}${inv.amendments && inv.amendments.length ? `<span class="lbl unverified">${inv.amendments.length} amendment(s) filed</span>` : ""}
          </div>
          <div class="grid g4 mt16">${kinds.map(([k, l]) => { const rows = inv.changes.filter((c) => c.change === k).sort((a, b) => (b.value || b.prev_value || 0) - (a.value || a.prev_value || 0)); return `<div><div class="xs mono muted" style="letter-spacing:.12em">${l.toUpperCase()} · ${rows.length}</div><div class="list mt8">${rows.slice(0, 8).map((c) => `<div class="item small" style="padding:6px 0"><div class="grow"><div class="ellipsis" title="${esc(c.issuer)}">${esc(titleCase(c.issuer))}${c.put_call ? ` <span class="xs dim">${esc(c.put_call)}</span>` : ""}</div><div class="xs muted mono">${k === "exited" ? "was $" + V.compact(c.prev_value) : "$" + V.compact(c.value) + " · " + V.pct(c.weight, 1, false)}${c.share_delta != null && k !== "exited" && k !== "new" ? " · shares " + V.pct(c.share_delta, 0) : ""}</div></div>${c.overlap ? `<span class="lbl ${c.overlap === "holding" ? "calculated" : "interpretation"}">${c.overlap === "holding" ? "you hold" : "watchlist"}</span>` : ""}</div>`).join("") || '<div class="xs dim">none</div>'}</div></div>`; }).join("")}</div>
          <div class="help mt12">History: ${inv.history.map((h) => `${esc(h.period)} (filed ${esc(h.filed)})`).join(" · ")}</div>
        </div>`).join("") : `<div class="panel"><div class="empty"><b>Not following anyone yet</b>Follow investors to track their disclosed changes.</div></div>`}</div>
      <div class="panel mt16"><div class="panel-h"><h3>Recent filings from companies you hold</h3>${V.lbl("fact", "SEC EDGAR")}</div>${d.company.length ? `<table class="tbl"><thead><tr><th>Filed</th><th>Ticker</th><th>Form</th><th>What</th><th>Period</th><th></th></tr></thead><tbody>${d.company.map((f) => `<tr><td class="mono small">${esc(f.filed)}</td><td class="tkr">${esc(f.ticker)}</td><td><span class="chip" style="cursor:default">${esc(f.form)}</span></td><td class="small">${esc(f.labels.join(", ") || f.desc || "")}</td><td class="mono small muted">${esc(f.period || "")}</td><td><a class="btn ghost xs" href="${esc(f.url)}" target="_blank" rel="noopener">${V.icon("ext")}</a></td></tr>`).join("")}</tbody></table>` : `<div class="empty small">US-listed holdings' filings appear here after the next background refresh (every 6 hours). Canadian issuers file on SEDAR+, which has no free API.</div>`}</div>
    </div>`;
    $("#rfF").onclick = async (e) => { e.currentTarget.innerHTML = '<span class="spin"></span>'; await V.try(() => V.post("/api/refresh", { jobs: ["sec"] }), "Filings checked"); V.render(); };
    $$("[data-unf]").forEach((b) => (b.onclick = async () => { await V.del("/api/r/investor/" + b.dataset.unf); V.render(); }));
    $("#addI").onclick = () => {
      const b = V.modal("Follow an investor", `<form class="form">${V.field("Pick a well-known filer", "preset", "", { options: [["", "—"]].concat(d.presets.map((p) => [p.cik, p.name])) })}<div class="small muted">…or enter any 13F filer's CIK (find it on <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=13F-HR" target="_blank" rel="noopener">EDGAR</a>).</div>${V.field("Name", "name", "")}${V.field("CIK", "cik", "", { type: "number" })}</form>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="fi">Follow</button>`);
      $("[name=preset]", b).onchange = (e) => { const p = d.presets.find((x) => String(x.cik) === e.target.value); if (p) { $("[name=name]", b).value = p.name; $("[name=cik]", b).value = p.cik; } };
      $("#fi", b).onclick = async () => { const x = V.formData(b); if (!x.cik) return; await V.try(() => V.post("/api/r/investor", { name: x.name || "CIK " + x.cik, cik: x.cik }), "Following. Loading filings…"); V.closeOverlay(); setTimeout(V.render, 2500); };
    };
  };
  function titleCase(s) { return String(s || "").toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Inc|Corp|Co|Ltd|Plc|Lp|Llc|Etf|Adr|Nv|Sa)\b/g, (m) => m.toUpperCase()); }
})();
