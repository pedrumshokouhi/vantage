/* Today: the daily command view at three depths (2-minute, 10-minute, deep session). */
"use strict";
(function () {
  const esc = V.esc, $ = V.$, $$ = V.$$;
  const greet = () => { const h = new Date().getHours(); return h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
  const mode = () => { try { return localStorage.getItem("vt_mode") || "10"; } catch (e) { return "10"; } };

  V.engineStrip = function () {
    const st = V.store, e = st.engine || {}, jobs = st.jobs || [];
    const ok = jobs.filter((j) => j.last_ok && !j.last_error).length, bad = jobs.filter((j) => j.last_error).length;
    const age = e.last ? Date.now() / 1000 - e.last : null;
    return `<div class="engine"><span class="led ${age != null && age < 900 ? "ok pulse" : age != null ? "warn" : "off"}"></span><b>VANTAGE ENGINE</b>
      <span class="sep">|</span><span>${age == null ? "waiting for first run" : "last run " + V.ago(e.last)} · every 5 min on Cloudflare</span>
      <span class="sep">|</span><span>${ok} sources healthy${bad ? ` · <span style="color:#ff8a94">${bad} failing</span>` : ""}</span>
      <span class="sep">|</span><span>${(st.alerts || []).length} live signals</span><span class="grow"></span><a href="#/settings/engine">engine room →</a></div>`;
  };

  V.views.home = async function (page) {
    const d = await V.get("/api/home");
    V.cache.home = d;
    const m = mode(), since = d.since || {}, p = d.portfolio, r1 = p.returns["1d"];
    const nm = (V.state.user || "").split(/[._]/)[0];
    const name = nm ? nm[0].toUpperCase() + nm.slice(1) : "";
    const sinceAge = since.since ? Date.now() / 1000 - since.since : 0;
    const sinceStrip = !since.first && since.since && sinceAge > 600 ? `<div class="since"><span class="k">Since your last visit · ${V.ago(since.since)}</span>
        ${since.value ? `<span class="pill">Portfolio ${V.dpct(since.value.pct, 2)} <span class="muted mono small">${V.money(since.value.delta, p.base)}</span></span>` : ""}
        <span class="pill">${since.stories || 0} new reports</span>${since.alerts && since.alerts.length ? `<span class="pill clickable" data-go="radar">${since.alerts.length} new signals</span>` : ""}
        ${(since.movers || []).slice(0, 5).map((mv) => `<span class="pill"><span class="tkr">${esc(mv.ticker)}</span> ${V.dpct(mv.change)}</span>`).join("")}
        ${(since.new_records || []).map((r) => `<span class="pill muted">+${r.n} ${esc(r.kind)}</span>`).join("")}</div>` : "";
    const prio = d.priorities.length ? `<div class="prio">${d.priorities.map((x, i) => `<div class="pcard" data-prio="${i}"><div class="n">0${i + 1}</div><div class="kind">${esc(x.kind)}</div><h4>${esc(x.title)}</h4><p class="clamp3">${esc(x.why || "")}</p><div class="act">${x.action ? "→ " + esc(x.action) : ""}</div>
      <div class="meters">${["relevance", "impact", "urgency", "confidence"].map((k) => `<div class="meter">${k}<i><b style="width:${Math.round((x.scores[k] || 0) * 100)}%"></b></i></div>`).join("")}</div></div>`).join("")}</div>` : "";

    const quote = (t, label, fmt) => { const q = V.store.quote(t); if (!q || q.p == null) return ""; const ch = q.pc ? q.p / q.pc - 1 : null; const h = (V.store.hist(t) || []).slice(-40).map((x) => x[1]);
      const roll = V.store.rollSuspect(t);
      return `<div class="qcell" data-ind="${esc(V.kb.tickerIndicator(t) || t)}"><div class="n">${esc(label)}</div><div class="p">${fmt ? fmt(q.p) : V.num(q.p, q.p < 100 ? 2 : 0)}</div><div class="row">${roll ? `<span class="delta muted" title="Brent and WTI moved very differently: probably a futures contract roll, not a real move">${V.pct(ch, 2)} roll?</span>` : V.dpct(ch, 2)}${V.spark(h, 60, 18)}</div></div>`; };
    const mac = d.macro, b = mac.boc;
    const macroCard = `<div class="panel"><div class="panel-h"><h3>Markets &amp; rates</h3><div class="tools">${V.fresh((V.store.quote("^GSPC") || {}).fetched, 3600)}<a class="btn ghost xs" href="#/macro">All →</a></div></div>
      <div class="qgrid">${quote("^GSPC", "S&P 500")}${quote("^GSPTSE", "S&P/TSX")}${quote("^IXIC", "Nasdaq")}${quote("^TNX", "US 10Y", (v) => v.toFixed(2) + "%")}${quote("CL=F", "WTI", (v) => "$" + v.toFixed(2))}${quote("BZ=F", "Brent", (v) => "$" + v.toFixed(2))}${quote("CADUSD=X", "CAD/USD", (v) => v.toFixed(4))}${quote("^VIX", "VIX", (v) => v.toFixed(1))}
        ${b.policy ? `<div class="qcell" data-ind="boc_policy"><div class="n">BoC rate</div><div class="p">${b.policy.value.toFixed(2)}%</div><div class="src">${esc(b.policy.date)}</div></div>` : ""}
        ${b.cpi ? `<div class="qcell" data-ind="ca_cpi"><div class="n">Canada CPI</div><div class="p">${b.cpi.value.toFixed(1)}%</div><div class="src">${esc(b.cpi.date.slice(0, 7))}</div></div>` : ""}</div>
      ${m !== "2" ? `<div class="grid g4 mt12">${mac.practical.map((x) => `<div class="small"><div>${V.lbl(x.label)}</div><div class="ttl mt8">${esc(x.title)}</div><div class="meta">${esc(x.text)}</div><div class="src mt8">${esc(x.src)}</div></div>`).join("")}</div>` : ""}</div>`;

    const worldCard = `<div class="panel"><div class="panel-h"><h3>World situation</h3><div class="tools"><a class="btn ghost xs" href="#/world">Tracker →</a></div></div>
      <div class="grid g4">${d.world.map((w) => `<div class="hcard" data-world="${w.id}"><div class="row sp"><span class="ttl small">${esc(w.name)}</span><span class="status-pill st-${w.status.toLowerCase().replace(/ /g, "")}">${esc(w.status)}${w.score != null ? " " + w.score : ""}</span></div>
        <div class="meta clamp2">${esc((w.facts[0] || {}).text || w.why.split(".")[0])}</div>${w.exposure.length ? `<div class="xs">Your exposure: ${w.exposure.slice(0, 3).map((x) => `<span class="${V.cls(x.tilt)}">${esc(x.ticker)}</span>`).join(", ")}</div>` : ""}</div>`).join("")}</div></div>`;

    const portCard = `<div class="panel"><div class="panel-h"><h3>My portfolio</h3><div class="tools">${V.fresh(p.asof, 3 * 86400)}</div></div>
      ${p.count ? `<div class="row sp" style="align-items:flex-end"><div class="kpi"><span class="l">Value · ${esc(p.base)}</span><span class="v">${V.money(p.total, p.base, 0)}</span>
          <span class="small">${r1 ? V.dpct(r1.base, 2) + " today" : ""}${p.returns.ytd ? " · " + V.dpct(p.returns.ytd.base) + " YTD" : ""}</span></div>
        <div class="right small muted">Unrealised<br><b class="mono ${V.cls(p.pl)}">${V.money(p.pl, p.base, 0)}</b></div></div>
      ${p.series ? `<div class="mt12">${V.lineChart([{ name: "You", color: "var(--acc)", pts: p.series.map((x) => [x[0], x[1]]), area: true }, { name: "Benchmark", color: "var(--muted)", dash: "4 4", pts: p.series.map((x) => [x[0], x[2]]) }], { h: 140, base: 100, fmt: (v) => v.toFixed(0) })}</div>` : ""}
      <div class="row wrap gap6 mt12">${p.movers.map((mv) => `<span class="chip" data-hold="${mv.id}"><span class="tkr">${esc(mv.ticker)}</span>${V.dpct(mv.d1)}</span>`).join("")}</div>
      ${p.breaches.length ? `<div class="callout mt12">${p.breaches.map((x) => `${esc(x.name)} is ${V.pct(x.weight, 0, false)} (limit ${V.pct(x.limit, 0, false)})`).join("<br>")}</div>` : ""}
      ${p.hidden.length && m !== "2" ? `<div class="mt12 small">${V.lbl("interpretation", "hidden exposure")} ${esc(p.hidden[0].headline)}</div>` : ""}`
      : `<div class="empty"><b>No holdings yet</b><a href="#/portfolio">Import your broker CSV</a> to see performance, exposure and thesis alerts.</div>`}</div>`;

    const agenda = (evs) => evs.length ? `<div class="agenda">${evs.map((e) => `<div class="ev clickable" data-ev="${esc(e.id)}"><span class="tm">${V.evTime(e)}</span><span class="bar cat-${esc(e.category)}"></span><div><div class="ttl small">${esc(e.title)}</div><div class="meta">${esc(e.category)}${e.location ? " · " + esc(e.location) : ""}${e.source !== "you" ? " · " + esc(e.source) : ""}</div></div></div>`).join("")}</div>` : `<div class="small muted" style="padding:6px 0">Nothing scheduled.</div>`;
    const agendaCard = `<div class="panel"><div class="panel-h"><h3>Agenda</h3><div class="tools"><a class="btn ghost xs" href="#/calendar">Week →</a></div></div>
      <div class="kicker">Today</div>${agenda(d.today)}<div class="kicker mt12">Tomorrow</div>${agenda(d.tomorrow)}
      ${d.week.prep.length ? `<div class="kicker mt16">Prepare</div><div class="list">${d.week.prep.slice(0, m === "2" ? 2 : 5).map((x) => `<div class="item clickable" data-ev="${esc(x.event.id)}"><span class="dot" style="background:${x.overdue ? "var(--down)" : "var(--warn)"};margin-top:6px"></span><div class="grow"><div class="ttl small">${esc(x.what)}</div><div class="meta">by ${V.parseDay(x.due).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div></div></div>`).join("")}</div>` : ""}</div>`;

    const pp = d.people;
    const peopleCard = `<div class="panel"><div class="panel-h"><h3>People</h3><div class="tools"><a class="btn ghost xs" href="#/network">Network →</a></div></div><div class="list">
      ${pp.promises.map((x) => `<div class="item clickable" data-contact="${x.id}"><span class="lbl ${x.overdue ? "missing" : "retrieved"}">${x.overdue ? "overdue" : "promise"}</span><div class="grow small"><span class="ttl">${esc(x.text)}</span><div class="meta">to ${esc(x.name)}${x.due ? " · due " + esc(x.due) : ""}</div></div></div>`).join("")}
      ${pp.milestones.map((x) => `<div class="item clickable" data-contact="${x.id}"><span class="lbl forecast">${x.days === 0 ? "today" : "in " + x.days + "d"}</span><div class="grow small"><span class="ttl">${esc(x.name)}: ${esc(x.what)}</span></div></div>`).join("")}
      ${pp.reasons.map((x) => `<div class="item clickable" data-contact="${x.id}"><span class="lbl interpretation">reason</span><div class="grow small"><span class="ttl">${esc(x.text)}</span></div></div>`).join("")}
      ${pp.lost_touch.slice(0, m === "2" ? 2 : 4).map((x) => `<div class="item clickable" data-contact="${x.id}"><div class="avatar" style="background:${V.color(x.name)}">${V.initials(x.name)}</div><div class="grow small"><span class="ttl">${esc(x.name)}</span><div class="meta">${x.days ? x.days + " days since you spoke" : "no interaction logged"}</div></div><button class="btn xs" data-draft="${x.id}">Draft</button></div>`).join("")}
      </div>${!pp.promises.length && !pp.milestones.length && !pp.lost_touch.length ? `<div class="small muted">Rate a few people as close (Network → Rate people) and Vantage will track cadence, promises and milestones.</div>` : ""}</div>`;

    const watchCard = `<div class="panel"><div class="panel-h"><h3>Watch closely</h3><div class="tools"><a class="btn ghost xs" href="#/radar">Radar →</a></div></div><div class="list">
      ${d.radar.slice(0, m === "deep" ? 9 : 5).map((a) => `<div class="item clickable" data-go="radar"><span class="dot" style="background:${a.score > 0.75 ? "var(--down)" : a.score > 0.6 ? "var(--acc)" : "var(--blue)"};margin-top:6px"></span><div class="grow"><div class="ttl small">${esc(a.title)}</div><div class="meta">${esc(V.intel.KIND_LABEL[a.kind] || a.kind)} · score ${Math.round(a.score * 100)}${a.origin === "engine" ? " · engine" : ""}</div></div></div>`).join("") || `<div class="small muted">Quiet. Nothing crosses your thresholds.</div>`}</div>
      ${d.second_look.length && m !== "2" ? `<div class="kicker mt16" style="color:var(--violet)">What deserves a second look</div><div class="list">${d.second_look.slice(0, 3).map((a) => `<div class="item clickable" data-go="radar"><div class="grow small"><div class="ttl">${esc(a.title)}</div><div class="meta">${esc((a.body || {}).why || "")}</div></div></div>`).join("")}</div>` : ""}</div>`;

    const weekCard = `<div class="panel"><div class="panel-h"><h3>The week ahead</h3><div class="tools">${d.week.conflicts ? `<span class="badge err">${d.week.conflicts} conflict${d.week.conflicts > 1 ? "s" : ""}</span>` : ""}</div></div>
      <div class="heat">${d.week.days.map((x) => { const dt = V.parseDay(x.date); return `<div class="d" data-go="calendar" title="${x.n} events · ${x.hours}h"><div class="dn">${dt.toLocaleDateString(undefined, { weekday: "short" })}</div><div class="dd">${dt.getDate()}</div><div class="ld"><b style="width:${Math.max(4, x.load * 100)}%;background:${x.load > 0.7 ? "var(--down)" : x.load > 0.4 ? "var(--warn)" : "var(--acc)"}"></b></div></div>`; }).join("")}</div>
      ${d.week.market.length ? `<div class="list mt12">${d.week.market.slice(0, 4).map((e) => `<div class="item"><span class="dot cat-${esc(e.category)}" style="margin-top:6px"></span><div class="grow small"><span class="ttl">${esc(e.title)}</span><div class="meta">${V.parseDay(e.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · ${esc(e.source)}</div></div></div>`).join("")}</div>` : ""}</div>`;

    const n = m === "2" ? 3 : m === "10" ? 6 : 14;
    const storiesCard = `<div class="panel"><div class="panel-h"><h3>Morning briefing</h3><div class="tools">${V.fresh(d.sources.news.last_ok, 3600)}<a class="btn ghost xs" href="#/brief">All →</a></div></div>
      ${d.stories.length ? d.stories.slice(0, n).map((s, i) => V.storyCard(s, { compact: m === "2" || (m === "10" && i >= 3), analysis: m !== "2" && i < (m === "deep" ? 8 : 3) })).join("") : `<div class="empty"><b>No stories yet</b>The engine collects 15 feeds every 25 minutes.</div>`}</div>`;
    const onb = d.onboarding && d.onboarding.some((x) => !x.done) ? `<div class="panel" style="margin-bottom:14px"><div class="panel-h"><h3>Set up your terminal</h3><div class="tools"><span class="xs muted mono">${d.onboarding.filter((x) => x.done).length}/${d.onboarding.length}</span></div></div><div class="onb">${d.onboarding.map((x) => `<div class="s ${x.done ? "done" : ""}" data-onb="${x.id}"><i></i>${esc(x.label)}</div>`).join("")}</div></div>` : "";

    let body;
    if (m === "2") body = `<div class="grid g12"><div class="s7">${storiesCard}</div><div class="s5 col gap16">${portCard}${agendaCard}</div></div>`;
    else if (m === "10") body = `<div class="grid g12"><div class="s12">${macroCard}</div><div class="s8 col gap16">${storiesCard}${worldCard}</div><div class="s4 col gap16">${portCard}${watchCard}${agendaCard}${peopleCard}</div><div class="s12">${weekCard}</div></div>`;
    else body = `<div class="grid g12"><div class="s12">${macroCard}</div><div class="s12">${worldCard}</div><div class="s8 col gap16">${storiesCard}</div><div class="s4 col gap16">${portCard}${watchCard}${peopleCard}${agendaCard}</div><div class="s12">${weekCard}</div></div>`;

    page.innerHTML = `<div class="fade-in">
      <div class="hero"><div><div class="date">${esc(V.dateLong(new Date()))}${V.state.space === "demo" ? " · " + V.lbl("demo", "demo data") : ""}</div><h1>${greet()}${name ? `, <em>${esc(name)}</em>` : ""}.</h1></div>
        <div class="right"><div class="seg">${[["2", "2-min"], ["10", "10-min"], ["deep", "Deep session"]].map(([k, l]) => `<button data-mode="${k}" class="${m === k ? "on" : ""}">${l}</button>`).join("")}</div>
          <div class="row gap6"><button class="btn sm" id="listen">${V.icon("headphones")} Listen <span class="muted mono xs" id="listenLen"></span></button><button class="btn sm" id="refreshAll" title="Run the engine now">${V.icon("refresh")} Update now</button></div></div></div>
      ${V.engineStrip()}${onb}${sinceStrip}${prio}${body}</div>`;
    bind(page, d);
    V.post("/api/visit").catch(() => {});
    $("#listenLen").textContent = "~" + Math.max(1, Math.round(V.homeScript(d, m).join(" ").split(/\s+/).length / 160)) + " min";
  };

  function bind(page, d) {
    $$("[data-mode]", page).forEach((b) => (b.onclick = () => { try { localStorage.setItem("vt_mode", b.dataset.mode); } catch (e) { /* ignore */ } V.render(); }));
    $$("[data-go]", page).forEach((b) => (b.onclick = () => V.go(b.dataset.go)));
    $$("[data-hold]", page).forEach((b) => (b.onclick = () => V.go("holding/" + b.dataset.hold)));
    $$("[data-ind]", page).forEach((b) => (b.onclick = () => V.openIndicator(b.dataset.ind)));
    $$("[data-world]", page).forEach((b) => (b.onclick = () => V.go("world/" + b.dataset.world)));
    $$("[data-contact]", page).forEach((b) => (b.onclick = (e) => { if (!e.target.closest("[data-draft]")) V.openContact(b.dataset.contact); }));
    $$("[data-draft]", page).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); V.draftFor(b.dataset.draft); }));
    $$("[data-ev]", page).forEach((b) => (b.onclick = () => V.openPrep(b.dataset.ev)));
    $$("[data-onb]", page).forEach((b) => (b.onclick = () => V.go({ holdings: "portfolio", thesis: "portfolio/thesis", contacts: "network", rate: "network", calendar: "calendar", investors: "filings", sec: "settings/integrations", ai: "settings/integrations", mfa: "settings/security" }[b.dataset.onb] || "settings")));
    $$("[data-prio]", page).forEach((c) => (c.onclick = () => {
      const x = d.priorities[+c.dataset.prio];
      if (x.event) return V.openPrep(x.event);
      if (x.story) return V.openImpact({ story_id: x.story });
      if (x.go) return V.go(x.go);
      if (x.ref) return V.openRef(x.ref.kind, x.ref.id);
      V.go("radar");
    }));
    V.bindStories(page, d.stories);
    $("#listen").onclick = () => V.audio.play(V.homeScript(d, mode()), "Your briefing");
    $("#refreshAll").onclick = async (e) => {
      e.currentTarget.innerHTML = '<span class="spin"></span> Updating…';
      await V.try(() => V.post("/api/refresh", {}), "Engine ran: sources refreshed and signals recomputed");
      V.render();
    };
  }

  V.homeScript = function (d, m) {
    const out = [];
    const nm = (V.state.user || "").split(/[._]/)[0];
    out.push(`${greet()}${nm ? " " + nm : ""}. It's ${V.dateLong(new Date())}.`);
    if (d.since && d.since.value) out.push(`Since your last visit, your portfolio is ${d.since.value.pct >= 0 ? "up" : "down"} ${Math.abs(d.since.value.pct * 100).toFixed(1)} percent.`);
    if (d.priorities.length) { out.push(`Your ${d.priorities.length === 3 ? "three" : d.priorities.length} priorities.`); d.priorities.forEach((x, i) => out.push(`${["First", "Second", "Third"][i]}: ${x.title}. ${x.why || ""}`)); }
    const p = d.portfolio;
    if (p.count && p.returns["1d"]) out.push(`Your portfolio is worth about ${Math.round(p.total).toLocaleString()} ${p.base === "CAD" ? "Canadian dollars" : p.base}, ${p.returns["1d"].base >= 0 ? "up" : "down"} ${Math.abs(p.returns["1d"].base * 100).toFixed(1)} percent on the day.`);
    const hot = d.world.filter((w) => w.score >= 50);
    if (hot.length) out.push("On the world tracker: " + hot.map((w) => `${w.name} is ${w.status.toLowerCase()}`).join("; ") + ".");
    const n = m === "2" ? 3 : m === "10" ? 5 : 8;
    if (d.stories.length) out.push("The developments that matter most to you.");
    d.stories.slice(0, n).forEach((s) => { out.push(s.title + "."); if (m !== "2" && s.analysis && s.analysis.matters) out.push(s.analysis.matters.text); });
    if (d.today.length) out.push("On your calendar today: " + d.today.map((e) => (e.all_day ? "" : V.evTime(e) + ", ") + e.title).join("; ") + ".");
    if (d.people.promises.length) out.push("Promises you've made: " + d.people.promises.slice(0, 3).map((x) => x.text + " for " + x.name + (x.overdue ? ", which is overdue" : "")).join("; ") + ".");
    out.push("That's your briefing. Sources and details are on screen.");
    return out;
  };
})();
