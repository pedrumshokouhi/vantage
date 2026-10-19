/* Today: the daily command view. Three depths: 2-minute, 10-minute, deep session. */
"use strict";
(function () {
  const esc = V.esc, $ = V.$, $$ = V.$$;

  function greet() {
    const h = new Date().getHours();
    return h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  }
  const mode = () => localStorage.getItem("vt_mode") || "10";

  V.views.home = async function (page) {
    const d = await V.get("/api/home");
    V.cache.home = d;
    const m = mode();
    const name = (V.state.user || "").split(/[._]/)[0];
    const nm = name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
    const since = d.since || {};
    const p = d.portfolio;
    const r1 = p.returns["1d"];

    const sinceAge = since.since ? Date.now() / 1000 - since.since : 0;
    const sinceStrip = !since.first && since.since && sinceAge > 600 ? `<div class="since" id="since">
        <span class="k">Since your last visit · ${V.ago(since.since)}</span>
        ${since.value ? `<span class="pill">Portfolio ${V.dpct(since.value.pct, 2)} <span class="muted mono small">${V.money(since.value.delta, p.base)}</span> ${V.lbl("calculated", "calc")}</span>` : ""}
        <span class="pill">${since.stories || 0} new developments</span>
        ${since.alerts && since.alerts.length ? `<span class="pill clickable" data-go="radar">${since.alerts.length} new radar signals</span>` : ""}
        ${(since.movers || []).slice(0, 4).map((mv) => `<span class="pill"><span class="tkr">${esc(mv.ticker)}</span> ${V.dpct(mv.change)}</span>`).join("")}
        ${(since.new_records || []).map((r) => `<span class="pill muted">+${r.n} ${esc(r.kind)}</span>`).join("")}
      </div>` : since.first ? `<div class="since"><span class="k">First visit</span><span class="small">From now on, this strip shows what changed since you last looked.</span></div>` : "";

    const prio = d.priorities.length ? `<div class="prio">${d.priorities.map((x, i) => `
      <div class="pcard" data-prio="${i}">
        <div class="n">0${i + 1}</div>
        <div class="kind">${esc(x.kind)}</div>
        <h4>${esc(x.title)}</h4>
        <p class="clamp3">${esc(x.why || "")}</p>
        <div class="act">${x.action ? "→ " + esc(x.action) : ""}</div>
        <div class="meters">${["relevance", "impact", "urgency", "confidence"].map((k) => `<div class="meter">${k}<i><b style="width:${Math.round((x.scores[k] || 0) * 100)}%"></b></i></div>`).join("")}</div>
      </div>`).join("")}</div>` : `<div class="panel" style="margin-bottom:16px"><div class="empty"><b>No priorities yet</b>Add holdings, contacts and events, and Vantage will rank what deserves your attention.</div></div>`;

    const portCard = `<div class="panel">
      <div class="panel-h">${V.icon("port", "ico")}<h3>My portfolio</h3><div class="tools">${V.fresh(p.asof, 3600)}</div></div>
      ${p.count ? `<div class="row sp" style="align-items:flex-end">
        <div class="kpi"><span class="l">Value · ${esc(p.base)}</span><span class="v">${V.money(p.total, p.base, 0)}</span>
          <span class="small">${r1 ? V.dpct(r1.base, 2) + " today" : ""} ${p.returns.ytd ? " · " + V.dpct(p.returns.ytd.base) + " YTD" : ""}</span></div>
        <div class="right small muted">Benchmark YTD<br><b class="mono ${V.cls(p.benchmark.blend.ytd)}">${V.pct(p.benchmark.blend.ytd)}</b></div>
      </div>
      ${p.series ? `<div class="mt12">${V.lineChart([{ name: "You", color: "var(--ion)", pts: p.series.map((x) => [x[0], x[1]]) }, { name: "Benchmark", color: "rgba(148,170,200,.6)", dash: "4 4", pts: p.series.map((x) => [x[0], x[2]]) }], { h: 150, base: 100, fmt: (v) => v.toFixed(0) })}</div>` : ""}
      <div class="row wrap gap6 mt12">${p.movers.map((mv) => `<span class="chip" data-hold="${mv.id}"><span class="tkr">${esc(mv.ticker)}</span>${V.dpct(mv.d1)}</span>`).join("")}</div>
      ${p.breaches.length ? `<div class="callout mt12">${p.breaches.map((b) => `${esc(b.name)} is ${V.pct(b.weight, 0, false)} (limit ${V.pct(b.limit, 0, false)})`).join("<br>")}</div>` : ""}
      ${p.hidden.length && mode() !== "2" ? `<div class="mt12 small"><span class="lbl interpretation">hidden exposure</span> ${esc(p.hidden[0].headline)}</div>` : ""}
      ` : `<div class="empty"><b>No holdings yet</b><a href="#/portfolio">Add or import holdings</a> to see performance, exposure and thesis alerts.</div>`}
    </div>`;

    const agenda = (evs) => evs.length ? `<div class="agenda">${evs.map((e) => `<div class="ev clickable" data-ev="${esc(e.id)}"><span class="tm">${V.evTime(e)}</span><span class="bar cat-${esc(e.category)}"></span><div><div class="ttl">${esc(e.title)}</div><div class="meta">${esc(e.category)}${e.location ? " · " + esc(e.location) : ""}${e.source !== "you" ? " · " + esc(e.source) : ""}</div></div></div>`).join("")}</div>` : `<div class="empty small">Nothing scheduled.</div>`;
    const agendaCard = `<div class="panel"><div class="panel-h">${V.icon("cal", "ico")}<h3>Today's agenda</h3><div class="tools"><a class="btn ghost xs" href="#/calendar">Week ahead →</a></div></div>
      ${agenda(d.today)}
      <div class="xs mono muted mt12" style="letter-spacing:.14em">TOMORROW</div>${agenda(d.tomorrow)}
      ${d.week.prep.length ? `<div class="xs mono muted mt16" style="letter-spacing:.14em">PREPARE</div><div class="list">${d.week.prep.slice(0, m === "2" ? 2 : 5).map((x) => `<div class="item clickable" data-ev="${esc(x.event.id)}"><span class="dot" style="background:${x.overdue ? "var(--rose)" : "var(--amber)"};margin-top:6px"></span><div class="grow"><div class="ttl small">${esc(x.what)}</div><div class="meta">by ${new Date(x.due + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div></div></div>`).join("")}</div>` : ""}
    </div>`;

    const weekCard = `<div class="panel"><div class="panel-h">${V.icon("cal", "ico")}<h3>The week ahead</h3><div class="tools">${d.week.conflicts ? `<span class="badge err">${d.week.conflicts} conflict${d.week.conflicts > 1 ? "s" : ""}</span>` : ""}</div></div>
      <div class="heat">${d.week.days.map((x) => { const dt = V.parseDay(x.date); return `<div class="d" data-go="calendar" title="${x.n} events · ${x.hours}h scheduled"><div class="dn">${dt.toLocaleDateString(undefined, { weekday: "short" })}</div><div class="dd">${dt.getDate()}</div><div class="ld"><b style="width:${Math.max(4, x.load * 100)}%;background:${x.load > .7 ? "var(--rose)" : x.load > .4 ? "var(--amber)" : "var(--ion)"}"></b></div></div>`; }).join("")}</div>
      ${d.week.market.length ? `<div class="list mt12">${d.week.market.slice(0, 4).map((e) => `<div class="item"><span class="dot cat-${esc(e.category)}" style="margin-top:6px"></span><div class="grow small"><span class="ttl">${esc(e.title)}</span><div class="meta">${V.parseDay(e.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · ${esc(e.source)}</div></div></div>`).join("")}</div>` : ""}
    </div>`;

    const pp = d.people;
    const peopleCard = `<div class="panel"><div class="panel-h">${V.icon("net", "ico")}<h3>People</h3><div class="tools"><a class="btn ghost xs" href="#/network">Network →</a></div></div>
      <div class="list">
      ${pp.promises.map((x) => `<div class="item clickable" data-contact="${x.id}"><span class="lbl ${x.overdue ? "missing" : "retrieved"}">${x.overdue ? "overdue" : "promise"}</span><div class="grow small"><span class="ttl">${esc(x.text)}</span><div class="meta">to ${esc(x.name)}${x.due ? " · due " + esc(x.due) : ""}</div></div></div>`).join("")}
      ${pp.milestones.map((x) => `<div class="item clickable" data-contact="${x.id}"><span class="lbl forecast">${x.days === 0 ? "today" : "in " + x.days + "d"}</span><div class="grow small"><span class="ttl">${esc(x.name)}: ${esc(x.what)}</span></div></div>`).join("")}
      ${pp.reasons.map((x) => `<div class="item clickable" data-contact="${x.id}"><span class="lbl interpretation">reason</span><div class="grow small"><span class="ttl">${esc(x.text)}</span></div></div>`).join("")}
      ${pp.lost_touch.slice(0, m === "2" ? 2 : 4).map((x) => `<div class="item clickable" data-contact="${x.id}"><div class="avatar" style="background:${V.color(x.name)}">${V.initials(x.name)}</div><div class="grow small"><span class="ttl">${esc(x.name)}</span><div class="meta">${x.days ? x.days + " days since you spoke" : "no interaction logged"}${x.org ? " · " + esc(x.org) : ""}</div></div><button class="btn xs" data-draft="${x.id}">Draft</button></div>`).join("")}
      </div>
      ${!pp.promises.length && !pp.milestones.length && !pp.lost_touch.length ? `<div class="empty small">Add contacts to surface follow-ups, milestones and reasons to reconnect.</div>` : ""}
    </div>`;

    const watchCard = `<div class="panel"><div class="panel-h">${V.icon("radar", "ico")}<h3>Watch closely</h3><div class="tools"><a class="btn ghost xs" href="#/radar">Radar →</a></div></div>
      <div class="list">${d.radar.slice(0, m === "deep" ? 8 : 5).map((a) => `<div class="item clickable" data-go="radar"><span class="dot" style="background:${a.score > .75 ? "var(--rose)" : a.score > .6 ? "var(--amber)" : "var(--sky)"};margin-top:6px"></span><div class="grow"><div class="ttl small">${esc(a.title)}</div><div class="meta">${esc(a.kind_label)} · score ${(a.score * 100).toFixed(0)}${a.grouped.length ? " · +" + a.grouped.length + " related" : ""}</div></div></div>`).join("") || `<div class="empty small">Quiet. Nothing crosses your thresholds right now.</div>`}</div>
      ${d.second_look.length && m !== "2" ? `<div class="xs mono mt16" style="letter-spacing:.14em;color:var(--violet)">WHAT DESERVES A SECOND LOOK</div><div class="list">${d.second_look.slice(0, 3).map((a) => `<div class="item clickable" data-go="radar"><div class="grow small"><div class="ttl">${esc(a.title)}</div><div class="meta">${esc(a.body.why || "")}</div></div></div>`).join("")}</div>` : ""}
    </div>`;

    const mac = d.macro;
    const macroCard = `<div class="panel"><div class="panel-h">${V.icon("spark", "ico")}<h3>Markets &amp; macro</h3><div class="tools">${V.fresh(mac.fetched, 86400 * 2)}</div></div>
      <div class="tick">${mac.markets.map((x) => `<div class="t"><div class="n">${esc(x.label)}</div><div class="p">${x.ticker === "^TNX" ? x.price.toFixed(2) + "%" : V.num(x.price, x.price < 100 ? 2 : 0)}</div><div class="row gap6">${V.dpct(x.change, 2)}${V.spark(x.spark, 54, 18)}</div></div>`).join("")}</div>
      ${m !== "2" ? `<div class="grid g3 mt16">${mac.practical.map((x) => `<div><div class="row gap6">${V.lbl(x.label)}</div><div class="ttl small mt8">${esc(x.title)}</div><div class="meta">${esc(x.text)}</div><div class="src mt8">${esc(x.src)}</div></div>`).join("")}</div>` : ""}
    </div>`;

    const nStories = m === "2" ? 3 : m === "10" ? 5 : 14;
    const storiesCard = `<div class="panel"><div class="panel-h">${V.icon("brief", "ico")}<h3>Morning briefing</h3><div class="tools">${V.fresh(d.sources.news.last_ok, 3600)}<a class="btn ghost xs" href="#/brief">All →</a></div></div>
      ${d.stories.length ? d.stories.slice(0, nStories).map((s, i) => V.storyCard(s, { compact: m === "2" || (m === "10" && i >= 3), analysis: m !== "2" && i < (m === "deep" ? 8 : 3) })).join("") : `<div class="empty"><b>No stories yet</b>News feeds refresh every 15 minutes. ${d.sources.news.last_error ? "Last error: " + esc(d.sources.news.last_error) : ""}</div>`}
    </div>`;

    const onb = d.onboarding && d.onboarding.some((x) => !x.done) ? `<div class="panel" style="margin-bottom:16px"><div class="panel-h"><h3>Set up your command center</h3><div class="tools"><span class="xs muted">${d.onboarding.filter((x) => x.done).length}/${d.onboarding.length}</span></div></div>
      <div class="onb">${d.onboarding.map((x) => `<div class="s ${x.done ? "done" : ""}" data-onb="${x.id}"><i></i>${esc(x.label)}</div>`).join("")}</div>
      <div class="help mt12">Want to look around first? Switch to <a href="#" id="toDemo">DEMO</a> for a fully populated, clearly labelled sample.</div></div>` : "";

    let body;
    if (m === "2") body = `<div class="grid g12"><div class="s7">${storiesCard}</div><div class="s5 col gap16">${portCard}${agendaCard}</div></div>`;
    else if (m === "10") body = `<div class="grid g12"><div class="s8 col gap16">${storiesCard}${macroCard}</div><div class="s4 col gap16">${portCard}${agendaCard}${peopleCard}${watchCard}</div><div class="s12">${weekCard}</div></div>`;
    else body = `<div class="grid g12"><div class="s12">${macroCard}</div><div class="s8 col gap16">${storiesCard}</div><div class="s4 col gap16">${portCard}${watchCard}${peopleCard}${agendaCard}</div><div class="s12">${weekCard}</div></div>`;

    page.innerHTML = `<div class="fade-in">
      <div class="hero">
        <div><div class="date">${V.dateLong(new Date())}${V.state.space === "demo" ? " · " + V.lbl("demo", "demo data") : ""}</div><h1>${greet()}${nm ? `, <em>${esc(nm)}</em>` : ""}.</h1></div>
        <div class="right">
          <div class="seg" id="modeSeg">${[["2", "2-min overview"], ["10", "10-min briefing"], ["deep", "Deep session"]].map(([k, l]) => `<button data-mode="${k}" class="${m === k ? "on" : ""}">${l}</button>`).join("")}</div>
          <div class="row gap6"><button class="btn sm" id="listen">${V.icon("headphones")} Listen <span class="muted mono xs" id="listenLen"></span></button><button class="btn sm ghost" id="refreshAll" title="Refresh all sources">${V.icon("refresh")}</button></div>
        </div>
      </div>
      ${onb}${sinceStrip}${prio}${body}
    </div>`;
    bindHome(page, d);
    V.post("/api/visit").catch(() => {});
    const script = V.homeScript(d, m);
    $("#listenLen").textContent = "~" + Math.max(1, Math.round(script.join(" ").split(/\s+/).length / 160)) + " min";
  };

  function bindHome(page, d) {
    $$("[data-mode]", page).forEach((b) => (b.onclick = () => { localStorage.setItem("vt_mode", b.dataset.mode); V.render(); }));
    $$("[data-go]", page).forEach((b) => (b.onclick = () => V.go(b.dataset.go)));
    $$("[data-hold]", page).forEach((b) => (b.onclick = () => V.go("holding/" + b.dataset.hold)));
    $$("[data-contact]", page).forEach((b) => (b.onclick = (e) => { if (!e.target.closest("[data-draft]")) V.openContact(b.dataset.contact); }));
    $$("[data-draft]", page).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); V.draftFor(b.dataset.draft); }));
    $$("[data-ev]", page).forEach((b) => (b.onclick = () => V.openPrep(b.dataset.ev)));
    $$("[data-onb]", page).forEach((b) => (b.onclick = () => {
      const map = { holdings: "portfolio", thesis: "portfolio", contacts: "network", calendar: "calendar", interests: "settings/profile", investors: "filings", sec: "settings/integrations", ai: "settings/integrations", mfa: "settings/security" };
      V.go(map[b.dataset.onb] || "settings");
    }));
    const td = $("#toDemo", page); if (td) td.onclick = (e) => { e.preventDefault(); V.switchSpace("demo"); };
    $$("[data-prio]", page).forEach((c) => (c.onclick = () => {
      const x = d.priorities[+c.dataset.prio];
      if (x.event) return V.openPrep(x.event);
      if (x.story) return V.openImpact({ story_id: x.story });
      if (x.ref) return V.openRef(x.ref.kind, x.ref.id);
      V.go("radar");
    }));
    V.bindStories(page, d.stories);
    $("#listen").onclick = () => V.audio.play(V.homeScript(d, mode()), "Your briefing");
    $("#refreshAll").onclick = async (e) => {
      e.currentTarget.innerHTML = '<span class="spin"></span>';
      await V.try(() => V.post("/api/refresh", { what: "all" }), "All sources refreshed");
      V.refreshLeds(); V.render();
    };
  }

  V.homeScript = function (d, m) {
    const out = [];
    const nm = (V.state.user || "").split(/[._]/)[0];
    out.push(`${greet()}${nm ? " " + nm : ""}. It's ${V.dateLong(new Date())}.`);
    if (d.since && d.since.value) out.push(`Since your last visit, your portfolio is ${d.since.value.pct >= 0 ? "up" : "down"} ${Math.abs(d.since.value.pct * 100).toFixed(1)} percent.`);
    if (d.priorities.length) {
      out.push(`Your ${d.priorities.length === 3 ? "three" : d.priorities.length} priorities.`);
      d.priorities.forEach((x, i) => out.push(`${["First", "Second", "Third"][i]}: ${x.title}. ${x.why || ""}`));
    }
    const p = d.portfolio;
    if (p.count && p.returns["1d"]) out.push(`Your portfolio is worth about ${Math.round(p.total).toLocaleString()} ${p.base === "CAD" ? "Canadian dollars" : p.base}, ${p.returns["1d"].base >= 0 ? "up" : "down"} ${Math.abs(p.returns["1d"].base * 100).toFixed(1)} percent on the day${p.returns.ytd ? ", and " + (p.returns.ytd.base >= 0 ? "up " : "down ") + Math.abs(p.returns.ytd.base * 100).toFixed(1) + " percent this year" : ""}.`);
    const n = m === "2" ? 3 : m === "10" ? 5 : 8;
    if (d.stories.length) out.push("The developments that matter most to you.");
    d.stories.slice(0, n).forEach((s) => {
      out.push(s.title + ".");
      if (m !== "2" && s.analysis && s.analysis.matters) out.push(s.analysis.matters.text);
      if (m !== "2" && s.analysis && s.analysis.mine && s.analysis.mine.items && s.analysis.mine.items.length) out.push("In your portfolio, this touches " + s.analysis.mine.items.map((x) => x.ticker.replace(".TO", "")).join(", ") + ".");
    });
    if (d.today.length) out.push("On your calendar today: " + d.today.map((e) => (e.all_day ? "" : V.evTime(e) + ", ") + e.title).join("; ") + ".");
    if (d.tomorrow.length) out.push("Tomorrow: " + d.tomorrow.slice(0, 4).map((e) => e.title).join("; ") + ".");
    const pp = d.people;
    if (pp.promises.length) out.push("Promises you've made: " + pp.promises.slice(0, 3).map((x) => x.text + " for " + x.name + (x.overdue ? ", which is overdue" : "")).join("; ") + ".");
    if (pp.milestones.length) out.push("Coming up: " + pp.milestones.slice(0, 3).map((x) => x.name + "'s " + x.what.toLowerCase() + " in " + x.days + " days").join("; ") + ".");
    out.push("That's your briefing. Sources and details are on screen.");
    return out;
  };
})();
