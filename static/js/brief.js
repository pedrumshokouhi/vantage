/* Morning briefing + "How does this affect me?" consequence map. */
"use strict";
(function () {
  const esc = V.esc, $ = V.$, $$ = V.$$;

  V.storyCard = function (s, o = {}) {
    const a = s.analysis;
    const srcs = `<details class="mt8"><summary class="src clickable">${s.n_sources} source${s.n_sources > 1 ? "s" : ""} · ${s.n_items} report${s.n_items > 1 ? "s" : ""} · first seen ${V.ago(s.first)}</summary><div class="sources">${s.sources.map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.source)} · ${esc(x.title)} <span class="src">${V.time(x.published)}</span></a>`).join("")}</div></details>`;
    const five = a && o.analysis ? `<div class="five">
      <div class="part"><div>1 · What happened</div><div>${esc(a.happened.text)} <span class="src">— ${esc(a.happened.src)}</span> ${V.lbl("fact", "reported")}</div></div>
      ${a.matters ? `<div class="part"><div>2 · Why it matters</div><div>${esc(a.matters.text)} ${V.lbl("interpretation")}</div></div>` : ""}
      ${a.effects ? `<div class="part"><div>3 · Who feels it</div><div><b class="small muted">People</b> ${esc(a.effects.people)}<br><b class="small muted">Businesses</b> ${esc(a.effects.business)}<br><b class="small muted">Markets</b> ${esc(a.effects.markets)} ${V.lbl("interpretation")}</div></div>` : ""}
      <div class="part"><div>4 · Your holdings &amp; plans</div><div>${a.mine.items && a.mine.items.length ? a.mine.items.map((x) => `<span class="chip" style="cursor:default"><span class="tkr">${esc(x.ticker)}</span><span class="${V.cls(x.tilt)} mono xs">${x.tilt > 0 ? "▲" : "▼"} ${Math.abs(x.tilt).toFixed(2)}</span><span class="xs dim">${V.pct(x.weight, 1, false)}</span></span>`).join(" ") + " " + V.lbl("calculated", "from your exposures") : esc(a.mine.text)}
        ${a.mine.direct ? `<div class="small mt8">Directly named: ${a.mine.direct.map((x) => esc(x.label)).join(", ")}</div>` : ""}</div></div>
      ${a.watch ? `<div class="part"><div>5 · What to watch</div><div><ul>${a.watch.items.map((w) => `<li>${esc(w)}</li>`).join("")}</ul><div class="small muted mt8">Competing view: ${esc(a.watch.counter)}</div> ${V.lbl("forecast", "watch items")}</div></div>` : ""}
    </div>` : "";
    const ai = s.ai ? `<div class="five" style="border-color:rgba(180,162,255,.3)"><div class="row">${V.lbl("ai", "Claude analysis")}<span class="src">${esc(s.ai.model || "")} · ${V.ago(s.ai.ts)}</span></div>
      ${["happened", "matters", "people", "business", "markets", "mine"].filter((k) => s.ai[k]).map((k) => `<div class="part"><div>${{ happened: "What happened", matters: "Why it matters", people: "People", business: "Businesses", markets: "Markets", mine: "For you" }[k]}</div><div>${V.md(String(s.ai[k]))}</div></div>`).join("")}
      ${s.ai.watch ? `<div class="part"><div>Watch</div><div><ul>${[].concat(s.ai.watch).map((w) => `<li>${esc(typeof w === "string" ? w : JSON.stringify(w))}</li>`).join("")}</ul></div></div>` : ""}
      ${s.ai.competing ? `<div class="part"><div>Competing view</div><div>${esc(s.ai.competing)}</div></div>` : ""}
      ${s.ai.confidence ? `<div class="part"><div>Confidence</div><div>${esc(typeof s.ai.confidence === "string" ? s.ai.confidence : JSON.stringify(s.ai.confidence))}</div></div>` : ""}
    </div>` : "";
    return `<div class="story ${s.seen ? "seen" : ""}" data-story="${esc(s.id)}">
      <div class="row gap6" style="margin-bottom:6px"><span class="topic ${esc(s.topic)}">${esc(s.topic)}</span>${s.official ? V.lbl("fact", "official") : ""}${s.shocks.slice(0, 2).map((x) => `<span class="xs dim">· ${esc(x.label)}</span>`).join("")}<span class="src" style="margin-left:auto">${esc(s.source)} · ${V.ago(s.updated)}</span></div>
      <h4>${s.seen ? "" : '<span class="new" title="New since you last marked it seen"></span>'}<a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></h4>
      ${!o.compact && s.summary ? `<div class="small muted clamp3">${esc(s.summary)}</div>` : ""}
      ${s.why.length ? `<div class="why"><b>Why it's here:</b> ${esc(s.why.join(" · "))}</div>` : ""}
      ${five}${ai}
      <div class="row wrap gap6 mt8">
        <button class="btn impact sm" data-impact="${esc(s.id)}">${V.icon("impact")} How does this affect me?</button>
        ${!o.compact && !(a && o.analysis) ? `<button class="btn ghost sm" data-expand="${esc(s.id)}">Explain</button>` : ""}
        <button class="btn ai sm" data-ai="${esc(s.id)}">${V.icon("spark")} ${s.ai ? "Re-analyse" : "Analyse"} with Claude</button>
        ${s.seen ? "" : `<button class="btn ghost sm" data-seen="${esc(s.id)}">${V.icon("check")} Seen</button>`}
      </div>
      ${o.compact ? "" : srcs}
    </div>`;
  };

  V.bindStories = function (root, stories) {
    const find = (id) => stories.find((s) => s.id === id);
    $$("[data-impact]", root).forEach((b) => (b.onclick = () => V.openImpact({ story_id: b.dataset.impact })));
    $$("[data-seen]", root).forEach((b) => (b.onclick = async () => {
      await V.post("/api/seen", { keys: ["story:" + b.dataset.seen] });
      const el = b.closest(".story"); el.classList.add("seen"); const dot = el.querySelector(".new"); if (dot) dot.remove(); b.remove();
    }));
    $$("[data-expand]", root).forEach((b) => (b.onclick = () => {
      const s = find(b.dataset.expand); if (!s) return;
      const el = b.closest(".story"); const tmp = document.createElement("div");
      tmp.innerHTML = V.storyCard(s, { analysis: true }); el.replaceWith(tmp.firstElementChild);
      V.bindStories(root, stories);
    }));
    $$("[data-ai]", root).forEach((b) => (b.onclick = async () => {
      const s = find(b.dataset.ai); if (!s) return;
      if (!V.state.ai || !V.state.ai.ok) return V.aiHelp();
      b.innerHTML = '<span class="spin"></span> Analysing…'; b.disabled = true;
      try {
        s.ai = await V.post(`/api/story/${s.id}/ai`);
        const el = b.closest(".story"); const tmp = document.createElement("div");
        tmp.innerHTML = V.storyCard(s, { analysis: true }); el.replaceWith(tmp.firstElementChild); V.bindStories(root, stories);
      } catch (e) { V.toast(e.message, "err"); b.disabled = false; b.innerHTML = V.icon("spark") + " Analyse with Claude"; }
    }));
  };

  V.aiHelp = function () {
    V.modal("Connect Claude", `<p>Claude adds reasoned analysis on top of Vantage's built-in models: story explanations, deeper consequence maps, thesis assessments, meeting prep and message drafts.</p>
      <div class="callout info">${esc((V.state.ai && V.state.ai.help) || "Add an Anthropic API key in Settings → Integrations.")}</div>
      <p class="small muted">Everything else in Vantage works without it. Built-in analysis is always labelled as interpretation.</p>`,
      `<button class="btn ghost" data-close>Not now</button><a class="btn pri" href="#/settings/integrations">Open settings</a>`);
    $$(".modal a.btn").forEach((a) => (a.onclick = () => V.closeOverlay()));
  };

  /* ---------- Briefing page ---------- */
  V.views.brief = async function (page, rest) {
    const topic = rest[0] || "all";
    const hours = localStorage.getItem("vt_hours") || "36";
    const d = await V.get(`/api/briefing?hours=${hours}&topic=${topic}`);
    const mac = d.macro;
    const b = mac.boc;
    const k = (x, label, fmt, unit) => x ? `<div class="kpi"><span class="l">${label}</span><span class="v" style="font-size:24px">${fmt(x.value)}${unit || ""}</span><span class="src">${esc(x.date)}${x.prev != null && x.prev !== x.value ? ` · prev ${fmt(x.prev)}${unit || ""}` : ""}</span></div>` : `<div class="kpi"><span class="l">${label}</span><span class="v muted" style="font-size:24px">—</span><span class="src">unavailable</span></div>`;
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Morning briefing · ${esc(V.dateLong(new Date()))}</div><h1>What changed, and <em>why it matters</em> to you</h1>
        <p>Grouped across ${d.sources.news.feeds_ok || 0} live feeds. Every story shows its sources and timestamps; explanations are labelled as reported fact, interpretation or forecast.</p></div>
        <div class="actions"><button class="btn" id="listenB">${V.icon("headphones")} Listen</button><button class="btn" id="markAll">${V.icon("check")} Mark all seen</button></div></div>
      <div class="panel" style="margin-bottom:16px">
        <div class="panel-h"><h3>Macro that reaches your wallet</h3><div class="tools">${V.fresh(mac.fetched, 86400 * 2)} <span class="src">Bank of Canada Valet · Yahoo Finance</span></div></div>
        <div class="grid g4">${k(b.policy, "BoC policy rate", (v) => v.toFixed(2), "%")}${k(b.cpi, "Canada CPI y/y", (v) => v.toFixed(1), "%")}${k(b.usdcad, "USD / CAD", (v) => v.toFixed(4))}${k(b.y10, "Canada 10Y", (v) => v.toFixed(2), "%")}</div>
        <hr class="divider"><div class="grid g3">${mac.practical.map((x) => `<div><div class="row gap6">${V.lbl(x.label)}</div><div class="ttl mt8">${esc(x.title)}</div><div class="small muted">${esc(x.text)}</div><div class="src mt8">${esc(x.src)}</div></div>`).join("")}</div>
      </div>
      <div class="row wrap gap6" style="margin-bottom:14px">
        ${["all"].concat(d.topics).map((t) => `<button class="chip ${t === topic ? "on" : ""}" data-topic="${t}">${t === "all" ? "All topics" : t}</button>`).join("")}
        <span class="grow"></span>
        <div class="seg">${[["12", "12h"], ["36", "36h"], ["72", "3 days"], ["168", "Week"]].map(([h, l]) => `<button data-hours="${h}" class="${h === hours ? "on" : ""}">${l}</button>`).join("")}</div>
      </div>
      <div class="panel">${d.stories.length ? d.stories.map((s, i) => V.storyCard(s, { analysis: i < 6 })).join("") : `<div class="empty"><b>No stories in this window</b>${d.sources.news.last_error ? esc(d.sources.news.last_error) : "Try a wider window or another topic."}</div>`}</div>
      ${d.sources.news.feeds_err && d.sources.news.feeds_err.length ? `<div class="help mt12">Feeds with errors on last attempt: ${esc(d.sources.news.feeds_err.join(", "))}</div>` : ""}
    </div>`;
    $$("[data-topic]", page).forEach((c) => (c.onclick = () => V.go("brief/" + c.dataset.topic)));
    $$("[data-hours]", page).forEach((c) => (c.onclick = () => { localStorage.setItem("vt_hours", c.dataset.hours); V.render(); }));
    V.bindStories(page, d.stories);
    $("#markAll").onclick = async () => { await V.post("/api/seen", { keys: d.stories.map((s) => "story:" + s.id) }); V.toast("Marked as seen", "ok"); V.render(); };
    $("#listenB").onclick = () => {
      const sc = ["Your briefing for " + V.dateLong(new Date()) + "."];
      mac.practical.forEach((x) => sc.push(x.title + ". " + x.text));
      d.stories.slice(0, 8).forEach((s) => { sc.push(s.title + ", reported by " + s.source + "."); if (s.analysis && s.analysis.matters) sc.push(s.analysis.matters.text); });
      V.audio.play(sc, "Briefing");
    };
  };

  /* ---------- Consequence map ---------- */
  V.openImpact = async function (req) {
    const box = V.drawer("How does this affect me?", `<div class="loading"><span class="spin"></span>Tracing consequences…</div>`, { cls: "wide", kicker: "Consequence map" });
    let m;
    try { m = await V.post("/api/impact", req); } catch (e) { $(".db", box).innerHTML = `<div class="empty"><b>Couldn't build the map</b>${esc(e.message)}</div>`; return; }
    const db = $(".db", box);
    const tiltCls = m.portfolio_tilt > 0.02 ? "up" : m.portfolio_tilt < -0.02 ? "down" : "";
    db.innerHTML = `
      <h3 class="serif" style="font-size:24px;margin:0 0 6px">${esc(m.title)}</h3>
      <div class="row wrap gap6">${m.shocks.map((s) => `<span class="chip" style="cursor:default">${esc(s.label)} ${s.dir < 0 ? "(easing)" : ""}</span>`).join("")}
        <span class="grow"></span><span class="small">Net portfolio tilt: <b class="${tiltCls}">${esc(m.tilt_label)}</b> ${V.lbl("estimate")}</span></div>
      ${m.empty ? `<div class="callout mt16">No known economic pattern was detected in this story's text, so the built-in model can't map it. ${V.state.ai && V.state.ai.ok ? "Try Deepen with Claude." : "Connect Claude for open-ended analysis."}</div>` : ""}
      <div class="legend mt16"><span><i style="background:#34d399"></i>helps / pushes up</span><span><i style="background:#fb7185"></i>hurts / pushes down</span><span><i style="background:none;border-top:2px dashed var(--muted)"></i>high uncertainty or rough estimate</span><span>thickness = strength</span><span class="muted">Click any link or box to see the reasoning.</span></div>
      <div id="imap" class="mt12"></div>
      <div class="grid g12 mt16">
        <div class="s7"><div class="why-box" id="whyBox"><div class="muted small">Select a connection to see its logic, evidence, uncertainty, time horizon and offsetting effects, and to ask what would have to happen for it to matter.</div></div></div>
        <div class="s5 col gap16">
          <div class="panel"><div class="panel-h"><h3>Offsets &amp; competing views</h3></div><ul class="small" style="margin:0;padding-left:18px">${m.offsets.map((o) => `<li>${esc(o)}</li>`).join("") || "<li class='muted'>None identified.</li>"}</ul></div>
          ${m.shocks[0] ? `<div class="panel"><div class="panel-h"><h3>For everyday life</h3>${V.lbl("interpretation")}</div><div class="small"><b class="muted">People:</b> ${esc(m.shocks[0].people)}<br><b class="muted">Businesses:</b> ${esc(m.shocks[0].business)}<br><b class="muted">Markets:</b> ${esc(m.shocks[0].markets)}</div><div class="xs mono muted mt12">WATCH NEXT</div><ul class="small" style="margin:4px 0 0;padding-left:18px">${m.shocks[0].watch.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
          ${m.episodes.length ? `<div class="panel"><div class="panel-h"><h3>Historical context</h3>${V.lbl("fact", "approx. history")}</div>${m.episodes.map((e) => `<div class="small"><b>${esc(e.title)}</b><div class="muted">${esc(e.text)}</div></div>`).join('<hr class="divider">')}</div>` : ""}
        </div>
      </div>
      <div class="panel mt16" id="aiImpact"><div class="panel-h"><h3>Deeper read</h3>${V.lbl("ai", "Claude")}<div class="tools"><button class="btn ai sm" id="deepen">${V.icon("spark")} ${m.ai ? "Refresh" : "Deepen with Claude"}</button></div></div><div id="aiBody">${m.ai ? aiImpactHtml(m.ai) : `<div class="small muted">Claude can add event-specific links the built-in model doesn't know, with evidence and competing interpretations.</div>`}</div></div>
      <div class="help mt16">${esc(m.method)}</div>`;
    V.impactMap(m, $("#imap", db), (sel) => showWhy(sel, $("#whyBox", db)));
    $("#deepen", db).onclick = async (e) => {
      if (!V.state.ai || !V.state.ai.ok) return V.aiHelp();
      const b = e.currentTarget; b.innerHTML = '<span class="spin"></span> Thinking…'; b.disabled = true;
      try { const r = await V.post("/api/impact/ai", Object.assign({ title: m.title }, req)); $("#aiBody", db).innerHTML = aiImpactHtml(r); }
      catch (err) { V.toast(err.message, "err"); }
      b.disabled = false; b.innerHTML = V.icon("spark") + " Refresh";
    };
  };

  function aiImpactHtml(r) {
    return `${r.summary ? `<p>${esc(r.summary)}</p>` : ""}${(r.edges || []).map((e) => `<div class="item" style="display:block;padding:10px 0;border-top:1px solid var(--line)"><div class="row gap6"><b>${esc(e.from)}</b><span class="${e.sign > 0 ? "up" : "down"}">${e.sign > 0 ? "→ ▲" : "→ ▼"}</span><b>${esc(e.to)}</b><span class="lbl ${e.uncertainty === "high" ? "estimate" : "interpretation"}">${esc(e.uncertainty || "")} uncertainty</span><span class="src">${esc(e.horizon || "")}</span></div><div class="small mt8">${esc(e.logic)}</div><div class="small muted">Evidence: ${esc(e.evidence || "—")}</div>${e.offsets ? `<div class="small muted">Offsets: ${esc(e.offsets)}</div>` : ""}${e.threshold ? `<div class="small" style="color:var(--ion)">Would matter if: ${esc(e.threshold)}</div>` : ""}</div>`).join("")}${r.competing ? `<div class="callout mt12">Competing interpretation: ${esc(r.competing)}</div>` : ""}<div class="src mt8">${esc(r.model || "")}</div>`;
  }

  function showWhy(sel, el) {
    if (!sel) { el.innerHTML = `<div class="muted small">Select a connection to see its reasoning.</div>`; return; }
    if (sel.node) {
      const n = sel.node;
      el.innerHTML = `<div class="row gap6"><h3 class="serif" style="margin:0;font-size:22px">${esc(n.label)}</h3><span class="chip" style="cursor:default">${esc(n.kind)}</span></div>
        ${n.desc ? `<div class="small muted mt8">${esc(n.desc)}</div>` : ""}
        ${n.value != null ? `<div class="mt8 small">Net pressure in this map: <b class="${V.cls(n.value)} mono">${n.value > 0 ? "+" : ""}${n.value.toFixed(2)}</b> ${V.lbl("estimate")}</div>` : ""}
        <div class="xs mono muted mt16">CONNECTIONS (${sel.edges.length})</div>
        <ul class="small" style="padding-left:18px">${sel.edges.map((e) => `<li>${esc(e.logic)}</li>`).join("")}</ul>
        ${n.ref ? `<button class="btn sm mt8" data-ref-kind="${esc(n.ref.kind)}" data-ref-id="${esc(n.ref.id)}">Open ${esc(n.ref.kind)}</button>` : ""}`;
      return;
    }
    const e = sel.edge;
    el.innerHTML = `<div class="row wrap gap6"><b>${esc(sel.from.label)}</b><span class="${e.sign > 0 ? "up" : "down"} mono">${e.sign > 0 ? "── pushes up ──▶" : "── pushes down ──▶"}</span><b>${esc(sel.to.label)}</b></div>
      <dl class="mt12" style="margin:0">
        <dt>Logic</dt><dd>${esc(e.logic)} ${V.lbl(e.type)}</dd>
        <dt>Supporting evidence</dt><dd>${esc(e.evidence)}</dd>
        <dt>Uncertainty · time horizon</dt><dd><span class="lbl ${e.uncertainty === "high" ? "estimate" : e.uncertainty === "low" ? "calculated" : "interpretation"}">${esc(e.uncertainty)}</span> · ${esc(e.horizon)} · strength ${(e.strength || 0).toFixed(2)}</dd>
        <dt>Offsetting effects</dt><dd>${esc(e.offsets || "—")}</dd>
      </dl>
      <div class="q-matter"><div class="row"><b class="small" style="color:var(--ion)">What would have to happen for this to matter?</b></div><div class="small mt8">${esc(e.threshold || "Not specified for this link.")}</div>
      ${e.watch ? `<div class="small muted mt8">Watch: ${esc(e.watch.join(" · "))}</div>` : ""}</div>`;
  }
})();
