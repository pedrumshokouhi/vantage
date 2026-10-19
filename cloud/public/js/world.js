/* World tracker: chokepoint shipping (IMF PortWatch), flights (ADS-B), news attention (GDELT),
   travel advisories (Government of Canada), earthquakes (USGS), and what each means for your money. */
"use strict";
(function () {
  const esc = V.esc, $ = V.$, $$ = V.$$, K = V.kb, I = V.intel, E = V.engine;
  const S = () => V.store;
  const pill = (st, score, limited) => `<span class="status-pill st-${(st || "").toLowerCase().replace(/ /g, "")}" ${limited ? 'title="Limited data: fewer than half the components are available"' : ""}>${esc(st)}${score != null ? " · " + score : ""}${limited ? " ·?" : ""}</span>`;
  const compBar = (label, v, c) => `<div>${label}<i><b style="width:${v == null ? 0 : Math.round(v * 100)}%;background:${c}"></b></i></div>`;

  V.views.world = async function (page, rest) {
    const st = S();
    const ids = ["pw", "travel", "usgs"].concat(K.HOTSPOTS.flatMap((h) => ["g:" + h.id, "ga:" + h.id, "f:" + h.id]));
    await st.ensure(ids);
    E.portfolio();
    if (rest[0]) return detail(page, rest[0]);
    const hs = I.world();
    const quakes = ((st.series.usgs || {}).eq || []).filter((q) => q.m >= 5);
    const travel = (st.series.travel || {}).levels || {};
    const lvlCount = [0, 0, 0, 0]; for (const v of Object.values(travel)) if (v[0] >= 0 && v[0] <= 3) lvlCount[v[0]]++;
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">World tracker · WRLD &lt;GO&gt;</div><h1>Situations around the world, <em>scored and explained</em></h1>
        <p>Each hotspot combines ship transits through its chokepoint, aircraft over the area, news attention and Canada's travel advisory into a 0–100 score, then traces what it means for your holdings.</p></div>
        <div class="actions"><button class="btn" id="wRefresh">${V.icon("refresh")} Refresh sources</button></div></div>
      <div class="grid g12">
        <div class="s8 panel flush" style="overflow:hidden"><div id="map"></div>
          <div class="legend" style="padding:10px 14px"><span><i style="background:#dfe3e8;height:8px"></i>normal precautions</span><span><i style="background:#f6d9a8;height:8px"></i>high caution</span><span><i style="background:#f1a877;height:8px"></i>avoid non-essential travel</span><span><i style="background:#d9534f;height:8px"></i>avoid all travel</span><span><i style="background:var(--violet);height:8px;opacity:.5"></i>M5+ earthquakes (7 days)</span><span class="src">Advisories: Government of Canada · Quakes: USGS</span></div></div>
        <div class="s4 col gap16">
          <div class="panel"><div class="panel-h"><h3>Hotspots by severity</h3>${V.lbl("interpretation", "scored")}</div><div class="list">${hs.map((h) => `<div class="item clickable" data-hs="${h.id}"><div class="grow"><div class="ttl small">${esc(h.name)}</div><div class="meta">${esc(h.region)}</div></div>${pill(h.status, h.score, h.limited)}</div>`).join("")}</div></div>
          <div class="panel"><div class="panel-h"><h3>Travel advisories</h3>${V.lbl("fact")}</div><div class="small">${lvlCount[3]} countries: avoid all travel · ${lvlCount[2]}: avoid non-essential travel · ${lvlCount[1]}: high caution.</div><div class="src mt8">${st.series.travel ? "Updated " + V.ago(st.series.travel.f) : "Loading on the next engine run"}</div></div>
        </div>
        <div class="s12"><div class="grid g3">${hs.map(hcard).join("")}</div></div>
        <div class="s12 panel"><div class="panel-h"><h3>Significant earthquakes · past 7 days</h3>${V.lbl("fact", "USGS")}</div>
          ${quakes.length ? `<table class="tbl"><thead><tr><th>Mag</th><th>Where</th><th>When</th><th></th></tr></thead><tbody>${quakes.slice(0, 12).map((q) => `<tr><td class="mono"><b>${q.m.toFixed(1)}</b></td><td>${esc(q.p)}${q.ts ? " " + V.lbl("missing", "tsunami flag") : ""}</td><td class="mono small">${V.time(q.t)}</td><td><a class="btn ghost xs" href="${esc(q.u)}" target="_blank" rel="noopener">USGS ${V.icon("ext")}</a></td></tr>`).join("")}</tbody></table>` : `<div class="empty small">No M5+ earthquakes recorded, or data not loaded yet.</div>`}</div>
      </div>
      <div class="help mt16">Sources: IMF PortWatch (daily AIS-based chokepoint transits, published with a lag of several days) · ADS-B Exchange community data via adsb.lol (aircraft broadcasting positions; military and some flights don't broadcast) · GDELT (global news volume) · Government of Canada travel advisories · USGS. Scores are Vantage's interpretation; every component is shown so you can judge it.</div></div>`;
    await V.worldMap($("#map"), { levels: travel, hotspots: hs.map((h) => Object.assign({ short: h.name.replace(/^Strait of /, "").replace(/ & .*/, "") }, h)), quakes, onHotspot: (id) => V.go("world/" + id) });
    $$("[data-hs]", page).forEach((x) => (x.onclick = () => V.go("world/" + x.dataset.hs)));
    $("#wRefresh").onclick = async (e) => { e.currentTarget.innerHTML = '<span class="spin"></span>'; await V.try(() => V.post("/api/refresh", { jobs: ["gdelt", "flights", "portwatch", "travel", "usgs"] }), "World sources refreshed"); V.render(); };
  };
  function hcard(h) {
    const colors = { shipping: "var(--blue)", attention: "var(--violet)", flights: "var(--acc)", advisory: "var(--down)" };
    return `<div class="hcard" data-hs="${h.id}"><div class="row sp"><div><div class="ttl">${esc(h.name)}</div><div class="meta">${esc(h.region)}</div></div>${pill(h.status, h.score, h.limited)}</div>
      <div class="comp">${compBar("ships", h.comp.shipping, colors.shipping)}${compBar("news", h.comp.attention, colors.attention)}${compBar("flights", h.comp.flights, colors.flights)}${compBar("advisory", h.comp.advisory, colors.advisory)}</div>
      <div class="small">${esc((h.facts[0] || {}).text || h.why.split(".")[0] + ".")}</div>
      ${h.exposure.length ? `<div class="xs">Your exposure: ${h.exposure.slice(0, 4).map((x) => `<span class="${V.cls(x.tilt)} mono">${esc(x.ticker)} ${x.tilt > 0 ? "▲" : "▼"}</span>`).join(" ")}</div>` : `<div class="xs muted">No meaningful exposure in your holdings.</div>`}</div>`;
  }

  async function detail(page, id) {
    const st = S(), h = K.HOTSPOTS.find((x) => x.id === id);
    if (!h) { page.innerHTML = `<div class="empty">Unknown hotspot</div>`; return; }
    const w = I.world().find((x) => x.id === id);
    const pw = st.series.pw || {}, flights = st.series["f:" + id], g = st.series["g:" + id], ga = st.series["ga:" + id];
    const travel = (st.series.travel || {}).levels || {};
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker"><a href="#/world">World tracker</a> / ${esc(h.region)}</div><h1>${esc(h.name)} ${pill(w.status, w.score)}</h1><p>${esc(h.why)}</p></div>
        <div class="actions"><button class="btn impact" id="hsImpact">${V.icon("impact")} How does this affect me?</button></div></div>
      <div class="grid g4" style="margin-bottom:14px">${["shipping", "attention", "flights", "advisory"].map((k) => { const f = w.facts.find((x) => x.k === k); return `<div class="panel"><div class="kicker">${{ shipping: "Ship transits", attention: "News attention", flights: "Air traffic", advisory: "Travel advisory" }[k]}</div><div class="small mt8">${f ? esc(f.text) : `<span class="muted">${k === "shipping" && !(h.ports || []).length ? "No chokepoint series for this area." : k === "flights" && !h.air ? "Not tracked for this area." : "Loading on the next engine run."}</span>`}</div>${w.comp[k] != null ? `<div class="comp mt8" style="grid-template-columns:1fr">${compBar("stress " + Math.round(w.comp[k] * 100) + "/100", w.comp[k], "var(--acc)")}</div>` : ""}</div>`; }).join("")}</div>
      <div class="grid g12">
        ${(h.ports || []).map((port) => { const rows = (pw.daily || {})[port] || [], avg = (pw.avg || {})[port]; return `<div class="s6 panel"><div class="panel-h"><h3>${esc(port)} · daily transits</h3>${V.lbl("fact", "IMF PortWatch")}<div class="tools src">${rows.length ? "to " + esc(rows[rows.length - 1][0]) : ""}</div></div>${V.transits(rows.slice(-90), avg && avg.total)}${avg ? `<div class="help mt8">Normal (average ${esc(pw.base_from || "")} to ${esc(pw.base_to || "")}): ${avg.total.toFixed(1)} vessels/day, ${(avg.tanker || 0).toFixed(1)} tankers/day. AIS-based estimates, published with a lag of several days.</div>` : ""}</div>`; }).join("")}
        ${h.air ? `<div class="s6 panel"><div class="panel-h"><h3>Aircraft over the area</h3>${V.lbl("fact", "ADS-B")}<div class="tools src">${flights ? "sampled " + V.ago(flights.f) : ""}</div></div>${flights && flights.pts && flights.pts.length > 1 ? V.lineChart([{ name: "Aircraft", color: "var(--acc)", pts: flights.pts.map((p) => [p[0], p[1]]), area: true }], { h: 170, fmt: (v) => v.toFixed(0) }) : `<div class="empty small">Samples accumulate every ~25 minutes; a trend appears after a few hours.</div>`}
          ${flights && flights.sample && flights.sample.length ? `<details class="mt8"><summary class="small clickable muted">Latest sample (${flights.sample.length} aircraft)</summary><div class="small mono mt8" style="max-height:160px;overflow:auto">${flights.sample.map((a) => `${esc(a[0] || "—")} · ${esc(a[1] || "")} · ${a[3] === "ground" ? "ground" : (a[3] || "?") + " ft"}`).join("<br>")}</div></details>` : ""}
          <div class="help mt8">A sharp, sustained drop usually means airspace closures or rerouting. Coverage depends on volunteer receivers; military aircraft often don't broadcast.</div></div>` : ""}
        <div class="s6 panel"><div class="panel-h"><h3>News attention · 90 days</h3>${V.lbl("fact", "GDELT")}<div class="tools src">${g ? V.ago(g.f) : ""}</div></div>${g && g.vol && g.vol.length ? V.lineChart([{ name: "Articles/day", color: "var(--violet)", pts: g.vol.map((x) => [Date.UTC(+x[0].slice(0, 4), +x[0].slice(4, 6) - 1, +x[0].slice(6, 8)) / 1000, x[1]]), area: true }], { h: 170, fmt: (v) => v.toFixed(0) }) : `<div class="empty small">Loading on the next engine run (GDELT allows one request every few seconds, so hotspots refresh in rotation).</div>`}</div>
        <div class="s6 panel"><div class="panel-h"><h3>Latest coverage</h3>${V.lbl("fact")}</div>${ga && ga.arts && ga.arts.length ? `<div class="list">${ga.arts.slice(0, 10).map((a) => `<div class="item small"><div class="grow"><a href="${esc(a.u)}" target="_blank" rel="noopener">${esc(a.t)}</a><div class="src">${esc(a.s)} · ${esc((a.d || "").replace(/T(\d\d)(\d\d).*/, " $1:$2"))}</div></div></div>`).join("")}</div>` : `<div class="empty small">Articles load on the next rotation.</div>`}</div>
        <div class="s6 panel"><div class="panel-h"><h3>Travel advisories in the region</h3>${V.lbl("fact", "Gov. of Canada")}</div><table class="tbl"><tbody>${h.countries.map((c) => travel[c]).filter(Boolean).sort((a, b) => b[0] - a[0]).map((v) => `<tr><td>${esc(v[2])}</td><td><span class="status-pill st-${["calm", "watch", "elevated", "critical"][v[0]]}">${esc(K.ADVISORY[v[0]])}</span>${v[3] ? ' <span class="xs muted">+ regional</span>' : ""}</td></tr>`).join("") || `<tr><td class="muted">No advisory data yet.</td></tr>`}</tbody></table></div>
        <div class="s6 panel"><div class="panel-h"><h3>What it means for your money</h3>${V.lbl("estimate")}</div>
          <div class="small" style="margin-bottom:8px">This situation mainly works through ${Object.entries(h.impulse).map(([f, v]) => `<b>${esc(K.fl(f))}</b> ${v > 0 ? "▲" : "▼"}`).join(", ")}. Net lean on your portfolio: <b class="${V.cls(w.net)}">${w.net > 0 ? "positive" : w.net < 0 ? "negative" : "neutral"}</b>.</div>
          ${w.exposure.length ? `<table class="tbl"><thead><tr><th>Holding</th><th class="num">Weight</th><th class="num">Tilt</th></tr></thead><tbody>${w.exposure.map((x) => `<tr class="click" data-h="${x.id}"><td class="tkr">${esc(x.ticker)}</td><td class="num">${V.pct(x.weight, 1, false)}</td><td class="num ${V.cls(x.tilt)}">${x.tilt > 0 ? "+" : ""}${x.tilt.toFixed(2)}</td></tr>`).join("")}</tbody></table>` : `<div class="small muted">No holdings with a meaningful sensitivity.</div>`}</div>
        <div class="s6 panel"><div class="panel-h"><h3>What to watch</h3>${V.lbl("forecast")}</div><ul class="small" style="margin:0;padding-left:18px">${h.watch.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div></div>`;
    $("#hsImpact").onclick = () => V.openImpact({ hotspot: id });
    $$("[data-h]", page).forEach((r) => (r.onclick = () => V.go("holding/" + r.dataset.h)));
  }
})();
