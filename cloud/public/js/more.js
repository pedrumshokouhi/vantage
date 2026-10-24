/* Chief of staff, radar, decision journal, settings. */
"use strict";
(function () {
  const esc = V.esc, $ = V.$, $$ = V.$$;

  /* ---------- Chief of staff ---------- */
  const SUGGEST = ["What am I overlooking this week?", "What changed in my portfolio's risk since last month?", "Prepare me for tomorrow's meeting", "Which recent developments challenge my investment assumptions?", "Who should I reconnect with before my trip?", "Who do I know who works at Apple?", "Hormuz"];
  V.views.ask = async function (page) {
    const hist = (await V.get("/api/ask/history")).history;
    page.innerHTML = `<div class="fade-in" style="max-width:980px;margin:0 auto">
      <div class="ph"><div><div class="kicker">Chief of staff · ASK &lt;GO&gt;</div><h1>Ask across <em>everything</em> you keep here</h1>
        <p>Searches your holdings, theses, calendar, contacts, notes, decisions, radar and news. Answers separate what your records show from interpretation, and say what's missing. ${V.state.ai && V.state.ai.ok ? "Claude writes a synthesis on top." : "Connect Claude in Settings for a written synthesis on top of retrieval."}</p></div></div>
      <div class="ask-box"><textarea id="q" rows="1" placeholder="Ask anything…"></textarea><button class="btn pri" id="go">Ask</button></div>
      <div class="row wrap gap6 mt12">${SUGGEST.map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      <div id="answers" class="mt24"></div>
      ${hist.length ? `<div class="mt24"><div class="xs mono muted" style="letter-spacing:.12em">RECENT</div><div class="row wrap gap6 mt8">${hist.slice(0, 10).map((h) => `<button class="chip" data-s="${esc(h.q)}">${esc(h.q)}</button>`).join("")}</div></div>` : ""}
    </div>`;
    const q = $("#q");
    q.oninput = () => { q.style.height = "auto"; q.style.height = q.scrollHeight + "px"; };
    const ask = async (text) => {
      text = (text || q.value).trim(); if (!text) return;
      q.value = "";
      const holder = document.createElement("div");
      holder.className = "answer";
      holder.innerHTML = `<div class="q">${esc(text)}</div><div class="loading" style="padding:20px"><span class="spin"></span></div>`;
      $("#answers").prepend(holder);
      try { const r = await V.post("/api/ask", { q: text }); renderAnswer(holder, r); }
      catch (e) { holder.querySelector(".loading").outerHTML = `<div class="down small">${esc(e.message)}</div>`; }
    };
    $("#go").onclick = () => ask();
    q.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } };
    $$("[data-s]").forEach((c) => (c.onclick = () => ask(c.dataset.s)));
    if (V.state.pendingAsk) { const p = V.state.pendingAsk; V.state.pendingAsk = null; ask(p); }
  };

  function renderAnswer(el, r) {
    const blocks = r.blocks.map((b) => `<div class="ablock"><h5>${esc(b.title)} ${V.lbl(b.type === "interpretation" ? "interpretation" : "retrieved")}</h5><ul>${b.items.map((it) => `<li>${esc(it.text)} ${it.ref && it.ref.id ? `<span class="ref" data-ref-kind="${esc(it.ref.kind)}" data-ref-id="${esc(it.ref.id)}" ${it.link ? `data-link="${esc(it.link)}"` : ""}>${esc(it.ref.kind)} ↗</span>` : it.link ? `<a class="ref" href="${esc(it.link)}" target="_blank" rel="noopener">source ↗</a>` : ""} ${it.label && it.label !== "retrieved" && b.type !== "interpretation" ? V.lbl(it.label) : ""}</li>`).join("")}</ul></div>`).join("");
    el.innerHTML = `<div class="row"><div class="q grow">${esc(r.q)}</div><span class="src">${esc(r.intent)} · ${V.ago(r.ts)}</span></div>
      ${r.ai ? `<div class="ablock"><h5>Synthesis ${V.lbl("ai", "Claude")}</h5>${V.md(r.ai)}</div><hr class="divider"><div class="xs mono muted">UNDERLYING RECORDS</div>` : r.ai_error ? `<div class="callout">Claude unavailable: ${esc(r.ai_error)}</div>` : ""}
      ${blocks}
      ${r.missing.length ? `<div class="ablock"><h5>Missing or uncertain ${V.lbl("missing", "gaps")}</h5><ul>${r.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
      <div class="row wrap gap6 mt16">${r.actions.map((a) => `<button class="btn sm" data-prep="${esc(a.event)}">${esc(a.label)}</button>`).join("")}
        <button class="btn sm" data-save="note">Save as note</button><button class="btn sm" data-save="reminder">Create reminder</button><button class="btn sm" data-save="watch">Add to watchlist</button><button class="btn sm" data-save="draft">Draft message</button></div>`;
    const plain = () => [r.q, r.ai || ""].concat(r.blocks.map((b) => b.title + ":\n" + b.items.map((i) => "- " + i.text).join("\n")), r.missing.length ? ["Missing:\n" + r.missing.map((m) => "- " + m).join("\n")] : []).join("\n\n");
    $$("[data-prep]", el).forEach((b) => (b.onclick = () => V.openPrep(b.dataset.prep)));
    $$("[data-save]", el).forEach((b) => (b.onclick = async () => {
      const k = b.dataset.save;
      if (k === "note") { await V.try(() => V.post("/api/r/note", { title: r.q, text: plain(), source: "chief of staff", tags: [r.intent] }), "Saved to notes"); }
      else if (k === "reminder") {
        const m = V.modal("Create reminder", `<form class="form">${V.field("Title", "title", r.q)}${V.field("Date", "start", V.iso(new Date(Date.now() + 864e5)), { type: "date" })}</form>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="rs">Create</button>`);
        $("#rs", m).onclick = async () => { const d = V.formData(m); await V.try(() => V.post("/api/r/event", { title: d.title, start: d.start, all_day: true, category: "follow-up", notes: plain().slice(0, 2000) }), "Reminder added to calendar"); V.closeOverlay(); };
      } else if (k === "watch") {
        const m = V.modal("Add to watchlist", `<form class="form">${V.field("Ticker", "ticker", "")}${V.field("Why", "reason", r.q, { area: true })}</form>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="ws">Add</button>`);
        $("#ws", m).onclick = async () => { const d = V.formData(m); if (!d.ticker) return; d.ticker = d.ticker.toUpperCase(); await V.try(() => V.post("/api/r/watch", d), "Added to watchlist"); V.closeOverlay(); };
      } else if (k === "draft") {
        const ids = [...new Set([].concat(...r.blocks.map((bl) => bl.items)).filter((i) => i.ref && i.ref.kind === "contact").map((i) => i.ref.id))];
        if (!ids.length) return V.toast("No contact in this answer to draft to.", "err");
        V.draftFor(ids[0]);
      }
    }));
  }

  /* ---------- Radar ---------- */
  V.views.radar = async function (page, rest) {
    const status = rest[0] || "open";
    const d = await V.get("/api/radar?status=" + status);
    const kinds = [...new Set(d.alerts.map((a) => a.kind))];
    const filt = localStorage.getItem("vt_rkind") || "all";
    const list = d.alerts.filter((a) => filt === "all" || a.kind === filt);
    const sl = list.filter((a) => a.kind === "second_look");
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Radar · ALRT &lt;GO&gt; · proactive intelligence with restraint</div><h1>Radar</h1>
        <p>Signals from two sources: the <b>engine</b> (runs every 5 minutes on Cloudflare, even when you're away: price moves, rate changes, shipping disruptions, news surges, advisories, new filings) and <b>your session</b> (thesis monitor, exposures, relationships, calendar). Ranked by relevance, impact, urgency and confidence; your feedback tunes what surfaces.</p></div>
        <div class="actions"><div class="seg">${[["open", "Open"], ["snoozed", "Snoozed"], ["dismissed", "Dismissed"]].map(([k, l]) => `<button data-st="${k}" class="${k === status ? "on" : ""}">${l}</button>`).join("")}</div><button class="btn" id="runR">${V.icon("refresh")} Re-scan</button></div></div>
      <div class="row wrap gap6" style="margin-bottom:14px"><button class="chip ${filt === "all" ? "on" : ""}" data-k="all">All · ${d.alerts.length}</button>${kinds.map((k) => `<button class="chip ${filt === k ? "on" : ""}" data-k="${k}">${esc(d.kinds[k] || k)} · ${d.alerts.filter((a) => a.kind === k).length}</button>`).join("")}</div>
      <div class="grid g12">
        <div class="s8 panel">${list.length ? list.map(alertHtml).join("") : `<div class="empty"><b>All quiet</b>Nothing currently crosses your thresholds.</div>`}</div>
        <div class="s4 col gap16">
          <div class="panel"><div class="panel-h"><h3>What deserves a second look</h3>${V.lbl("interpretation")}</div>${sl.length ? `<div class="list">${sl.map((a) => `<div class="item small"><div class="grow"><div class="ttl">${esc(a.title)}</div><div class="meta">${esc(a.body.why || "")}</div></div></div>`).join("")}</div>` : '<div class="small muted">Overlooked developments and inconsistencies (large moves with no news, big positions without a thesis, indirect exposure) appear here.</div>'}</div>
          <div class="panel"><div class="panel-h"><h3>Tuning</h3></div><div class="small muted">Signal weights learned from your feedback:</div>
            <div class="mt8">${Object.keys(d.kinds).map((k) => `<div class="row sp small" style="padding:3px 0"><span>${esc(d.kinds[k])}</span><span class="mono ${d.muted.includes(k) ? "down" : ""}">${d.muted.includes(k) ? "muted" : "×" + (+(d.weights[k] || 1)).toFixed(2)}</span></div>`).join("")}</div>
            <button class="btn sm mt12" id="unm">Reset tuning</button></div>
        </div>
      </div></div>`;
    $$("[data-st]").forEach((b) => (b.onclick = () => V.go("radar/" + b.dataset.st)));
    $$("[data-k]").forEach((b) => (b.onclick = () => { localStorage.setItem("vt_rkind", b.dataset.k); V.render(); }));
    $("#runR").onclick = async (e) => { e.currentTarget.innerHTML = '<span class="spin"></span>'; await V.try(() => V.post("/api/radar/run"), "Radar re-scanned"); V.render(); V.refreshLeds(); };
    $("#unm").onclick = async () => { await V.post("/api/radar/unmute"); V.render(); };
    $$("[data-fb]").forEach((b) => (b.onclick = async () => { await V.post(`/api/radar/${b.dataset.id}/feedback`, { fb: b.dataset.fb }); V.toast({ useful: "Thanks: more like this", noise: "Got it: fewer like this", mute: "Muted this kind of signal", done: "Marked done", snooze: "Snoozed" }[b.dataset.fb], "ok"); V.render(); V.refreshLeds(); }));
    $$("[data-open]").forEach((b) => (b.onclick = () => { const a = d.alerts.find((x) => x.id === b.dataset.open); const bd = a.body || {}; if (bd.event) V.openPrep(bd.event); else if (bd.story) V.openImpact({ story_id: bd.story }); else if (bd.go) V.go(bd.go); else if (bd.ref) V.openRef(bd.ref.kind, bd.ref.id); else if (bd.ticker) V.openTicker(bd.ticker); else if (bd.link) window.open(bd.link, "_blank", "noopener"); }));
  };
  function alertHtml(a) {
    const c = a.score > 0.75 ? "var(--down)" : a.score > 0.6 ? "var(--acc)" : "var(--blue)";
    const b = a.body || {};
    a.kind_label = a.kind_label || V.intel.KIND_LABEL[a.kind] || a.kind;
    a.grouped = a.grouped || [];
    return `<div class="alert"><div class="sc" style="background:${c}"></div><div>
      <div class="row gap6 xs mono muted"><span style="color:${c}">${esc(a.kind_label.toUpperCase())}</span><span>· ${V.ago(a.created)}</span>${a.origin === "engine" ? '<span class="lbl calculated">engine</span>' : ""}${a.grouped.length ? `<span>· grouped with ${a.grouped.length} related</span>` : ""}</div>
      <h4 class="mt8">${esc(a.title)}</h4>
      ${b.why ? `<div class="small"><b class="muted">Why this appeared:</b> ${esc(b.why)} ${b.latest ? esc(b.latest) : ""}</div>` : ""}
      ${(b.evidence || []).filter(Boolean).length ? `<ul class="ev-list">${b.evidence.filter(Boolean).map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
      ${b.wrong_if ? `<div class="small mt8"><b class="muted">You said you'd be wrong if:</b> ${esc(b.wrong_if)}</div>` : ""}
      ${b.caveat ? `<div class="small mt8 muted">⚠ ${esc(b.caveat)}</div>` : ""}${b.assessment ? `<div class="small mt8 muted">${esc(b.assessment)}</div>` : ""}
      ${b.gaps && b.gaps.length ? `<div class="help mt8">Gaps: ${esc([].concat(b.gaps).join("; "))}</div>` : ""}
      ${a.grouped.length ? `<details class="mt8"><summary class="small clickable muted">Related signals</summary>${a.grouped.map((g) => `<div class="small">· ${esc(g.title)}</div>`).join("")}</details>` : ""}
      <div class="meters" style="max-width:420px">${["relevance", "impact", "urgency", "confidence"].map((k) => `<div class="meter">${k}<i><b style="width:${Math.round(a[k] * 100)}%"></b></i></div>`).join("")}</div>
      <div class="row wrap gap6 mt12">${b.ref || b.story || b.event || b.link || b.go || b.ticker ? `<button class="btn sm" data-open="${a.id}">${esc(b.action && b.action.length <= 40 ? b.action : "Open")}</button>` : b.action ? `<span class="small muted">→ ${esc(b.action)}</span>` : ""}${b.link && b.action ? `<a class="btn ghost sm" href="${esc(b.link)}" target="_blank" rel="noopener">Source ${V.icon("ext")}</a>` : ""}</div>
    </div><div class="fb">
      <button class="btn ghost xs" data-fb="useful" data-id="${a.id}" title="More like this">👍</button><button class="btn ghost xs" data-fb="noise" data-id="${a.id}" title="Less like this">👎</button>
      <button class="btn ghost xs" data-fb="done" data-id="${a.id}">Done</button><button class="btn ghost xs" data-fb="snooze" data-id="${a.id}">Snooze</button><button class="btn ghost xs" data-fb="mute" data-id="${a.id}" title="Mute this kind">Mute kind</button></div></div>`;
  }

  /* ---------- Decision journal ---------- */
  V.views.journal = async function (page, rest) {
    if (rest[0] === "new") return newDecision(page);
    if (rest[0]) return decisionPage(page, rest[0]);
    const items = V.store.records.decision.slice().sort((a, b) => b._created - a._created);
    const today = V.iso(new Date());
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Journal · JRNL &lt;GO&gt;</div><h1>Decide <em>deliberately</em>, review honestly</h1>
        <p>Capture the decision, your reasoning, assumptions, alternatives and what you expect. Original reasoning is locked after 24 hours, so hindsight can't quietly rewrite it. Replay shows what you knew next to what happened.</p></div>
        <div class="actions"><a class="btn pri" href="#/journal/new">${V.icon("plus")} New decision</a></div></div>
      <div class="grid g2">${items.map((d) => {
        const due = d.review_date && d.review_date <= today && !(d.reviews || []).length;
        return `<div class="panel clickable" data-d="${d.id}"><div class="row"><span class="chip" style="cursor:default">${esc(d.category || "decision")}</span><span class="src">${esc(d.date || new Date(d._created * 1000).toISOString().slice(0, 10))}</span><span class="grow"></span>${due ? `<span class="badge warn">review due</span>` : (d.reviews || []).length ? `<span class="badge">${d.reviews.length} review${d.reviews.length > 1 ? "s" : ""}</span>` : `<span class="src">review ${esc(d.review_date || "—")}</span>`}</div>
          <h3 style="font:700 17px var(--sans);margin:10px 0 6px">${esc(d.title)}</h3><div class="small muted clamp2">${esc(d.rationale || "")}</div>
          <div class="xs mono muted mt12">${(d.assumptions || []).length} assumptions${d.ticker ? " · " + esc(d.ticker) : ""}</div></div>`;
      }).join("") || `<div class="panel"><div class="empty"><b>No decisions recorded</b>Start with a live one: an investment, a job choice, a commitment.</div></div>`}</div></div>`;
    $$("[data-d]").forEach((c) => (c.onclick = () => V.go("journal/" + c.dataset.d)));
  };

  function newDecision(page) {
    page.innerHTML = `<div class="fade-in" style="max-width:820px">
      <div class="ph"><div><div class="kicker"><a href="#/journal">Journal</a> / new</div><h1>Record a <em>decision</em></h1><p>Write it as if explaining to your future self who will know how it turned out.</p></div></div>
      <div class="panel"><form class="form two" id="df">
        ${V.field("Decision (short title)", "title", "", { full: true })}
        ${V.field("Category", "category", "investment", { options: ["investment", "career", "business", "personal"] })}
        ${V.field("Date", "date", V.iso(new Date()), { type: "date" })}
        ${V.field("What exactly did you decide?", "decision", "", { area: true, full: true })}
        ${V.field("Why (rationale)", "rationale", "", { area: true, full: true })}
        <div class="full"><div class="xs mono muted" style="letter-spacing:.1em">ASSUMPTIONS · confidence %</div><div id="asm" class="col gap6 mt8"></div><button type="button" class="btn sm mt8" id="addA">${V.icon("plus")} Assumption</button></div>
        ${V.field("Alternatives considered", "alternatives", "", { area: true, full: true, rows: 2 })}
        ${V.field("What do you expect to happen, by when?", "expectations", "", { area: true, full: true, rows: 2 })}
        ${V.field("Review date", "review_date", V.iso(new Date(Date.now() + 90 * 864e5)), { type: "date" })}
        ${V.field("Linked ticker (optional)", "ticker", "", { help: "Captures the price at decision time for replay." })}
      </form><div class="row mt16" style="justify-content:flex-end"><a class="btn ghost" href="#/journal">Cancel</a><button class="btn pri" id="svD">Record decision</button></div></div></div>`;
    const add = (t = "", c = 60) => { const r = document.createElement("div"); r.className = "row"; r.innerHTML = `<input class="in grow" data-at value="${esc(t)}" placeholder="Something that must be true for this to work"><input class="in mono" data-ac type="number" min="0" max="100" value="${c}" style="width:80px">`; $("#asm").appendChild(r); };
    add(); add();
    $("#addA").onclick = () => add();
    $("#svD").onclick = async () => {
      const d = V.formData($("#df"));
      delete d[""];
      d.assumptions = $$("#asm .row").map((r) => ({ text: r.querySelector("[data-at]").value.trim(), confidence: +r.querySelector("[data-ac]").value })).filter((a) => a.text);
      if (d.ticker) {
        d.ticker = d.ticker.toUpperCase();
        await V.store.ensure(["q:" + d.ticker, "h:" + d.ticker]);
        const q = V.store.quote(d.ticker);
        if (q && q.p) { d.price_at_decision = q.p; d.price_source = "Quote when recorded (" + new Date().toLocaleString() + ")"; }
      }
      if (!d.title || !d.decision) return V.toast("Title and decision are required", "err");
      const r = await V.try(() => V.post("/api/r/decision", d), "Recorded");
      V.go("journal/" + r.id);
    };
  }

  async function decisionPage(page, id) {
    const r = await V.get(`/api/journal/${id}/replay`);
    const o = r.original, d = r.decision;
    const locked = Date.now() / 1000 - r.recorded > 86400;
    const st = {};
    r.assumptions.forEach((a, i) => (st[i] = a.status));
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker"><a href="#/journal">Journal</a> / ${esc(o.category || "decision")}</div><h1>${esc(o.title)}</h1>
        <p><span class="lock">${V.icon("lock")} ${locked ? "Original reasoning locked" : "Editable for 24h, then locked"} · recorded ${new Date(r.recorded * 1000).toLocaleString()}</span></p></div>
        <div class="actions"><button class="btn ghost" id="revD">History</button><button class="btn pri" id="rvw">Add review</button></div></div>
      <div class="split">
        <div class="panel then"><div class="panel-h"><h3>What you knew then</h3>${V.lbl("retrieved", "dated " + new Date(r.recorded * 1000).toISOString().slice(0, 10))}</div>
          <div class="kv"><div>Decision</div><div>${esc(o.decision)}</div><div>Rationale</div><div>${esc(o.rationale || "—")}</div><div>Alternatives</div><div>${esc(o.alternatives || "—")}</div><div>Expected</div><div>${esc(o.expectations || "—")}</div>${o.ticker ? `<div>Price then</div><div class="mono">${esc(o.ticker)} ${o.price_at_decision != null ? V.num(o.price_at_decision, 2) : "—"}</div>` : ""}</div>
          ${r.amendments.length ? `<div class="help mt12">Later edits to: ${esc([...new Set(r.amendments.flatMap((a) => a.fields))].join(", "))}. This column always shows the original.</div>` : ""}
        </div>
        <div class="panel now"><div class="panel-h"><h3>What happened since</h3>${V.lbl("calculated")}</div>
          ${r.after.price ? `<div class="kpi"><span class="l">${esc(r.after.price.ticker)} since decision</span><span class="v ${V.cls(r.after.price.change)}">${V.pct(r.after.price.change)}</span><span class="src">${V.num(r.after.price.then, 2)} → ${V.num(r.after.price.now, 2)} ${esc(r.after.price.currency)} · ${esc(r.after.price.label)}</span></div>` : '<div class="small muted">No linked ticker; record outcomes in reviews.</div>'}
          ${r.after.news && r.after.news.length ? `<div class="xs mono muted mt16">DEVELOPMENTS SINCE</div><div class="list">${r.after.news.map((n) => `<div class="item small"><div class="grow"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="src">${esc(n.source)} · ${V.time(n.published)}</div></div></div>`).join("")}</div>` : ""}
          ${r.reviews.map((rv) => `<div class="mt16"><div class="xs mono muted">REVIEW · ${esc(rv.date)}</div><div class="small">${esc(rv.what_happened || "")}</div>${rv.lessons ? `<div class="small mt8"><b class="muted">Lesson:</b> ${esc(rv.lessons)}</div>` : ""}</div>`).join("")}
        </div>
      </div>
      <div class="panel mt16"><div class="panel-h"><h3>Assumption replay</h3><div class="tools small">${["held", "failed", "unresolved"].map((k) => `<span class="mono ${k === "held" ? "up" : k === "failed" ? "down" : ""}">${r.tally[k] || 0} ${k}</span>`).join(" · ")}</div></div>
        ${r.assumptions.map((a, i) => `<div class="row" style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="grow"><div>${esc(a.text)}</div>${a.confidence != null ? `<div class="xs mono muted">you were ${a.confidence}% confident</div>` : ""}</div><div class="vt" data-a="${i}">${["held", "failed", "unresolved"].map((k) => `<button class="${k} ${a.status === k ? "on" : ""}" data-v="${k}">${k}</button>`).join("")}</div></div>`).join("") || '<div class="small muted">No assumptions recorded.</div>'}
        <div class="help mt12">Mark each assumption, then save as a dated review. Calibration builds over time: were your 70%-confident assumptions right about 70% of the time?</div>
      </div></div>`;
    $$(".vt button").forEach((b) => (b.onclick = () => { const i = b.parentElement.dataset.a; st[i] = b.dataset.v; $$("button", b.parentElement).forEach((x) => x.classList.toggle("on", x === b)); }));
    $("#revD").onclick = async () => V.showRevisions((await V.net(`/api/r/decision/${id}/revisions`)).revisions);
    $("#rvw").onclick = () => {
      const m = V.modal("Add review", `<form class="form">${V.field("What actually happened?", "what_happened", "", { area: true })}${V.field("What did you learn?", "lessons", "", { area: true, rows: 2 })}${V.field("Next review date (optional)", "next", "", { type: "date" })}</form><div class="help">Assumption verdicts from the replay panel are saved with this review.</div>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="sr">Save review</button>`);
      $("#sr", m).onclick = async () => {
        const f = V.formData(m);
        const review = { date: V.iso(new Date()), what_happened: f.what_happened, lessons: f.lessons, assumptions: st };
        const patch = { reviews: (d.reviews || []).concat([review]) };
        if (f.next) patch.review_date = f.next;
        await V.try(() => V.put("/api/r/decision/" + id, patch), "Review saved");
        V.closeOverlay(); V.render();
      };
    };
  }

  /* ---------- Settings ---------- */
  V.views.more = (page) => {
    page.innerHTML = `<div class="ph"><div><h1>More</h1></div></div><div class="col gap6">${[["radar", "Radar"], ["ask", "Chief of staff"], ["oil", "Energy & oil"], ["macro", "Macro & markets"], ["calendar", "Calendar"], ["network", "Network"], ["lab", "Scenario lab"], ["filings", "Filings"], ["journal", "Journal"], ["settings", "Settings"]].map(([k, l]) => `<a class="panel row" href="#/${k}">${esc(l)}<span class="grow"></span>→</a>`).join("")}<button class="btn mt16" id="lockM">${V.icon("lock")} Lock</button></div>`;
    $("#lockM").onclick = async () => { await V.net("/api/logout", { body: {} }); location.href = "/login"; };
  };

  V.views.settings = async function (page, rest) {
    const tab = rest[0] || "profile";
    const tabs = [["profile", "Profile & goals"], ["engine", "Engine room"], ["security", "Security"], ["integrations", "Integrations"], ["notes", "Notes"], ["data", "Data & export"], ["trust", "Trust"]];
    page.innerHTML = `<div class="fade-in"><div class="ph"><div><div class="kicker">Settings · SET &lt;GO&gt;</div><h1>Your <em>system</em></h1></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div><div id="sb"></div></div>`;
    $$("[data-t]").forEach((b) => (b.onclick = () => V.go("settings/" + b.dataset.t)));
    const sb = $("#sb");
    await ({ profile, engine, security, integrations, notes, data, trust }[tab] || profile)(sb);
  };

  async function profile(el) {
    const s = await V.net("/api/settings");
    s.plan_templates = Object.keys(V.kb.PLAN_TEMPLATES);
    const plans = V.store.records.plan;
    el.innerHTML = `<div class="grid g12"><div class="s7 panel"><div class="panel-h"><h3>Preferences · ${esc(V.state.space.toUpperCase())} workspace</h3></div><form class="form two" id="pf">
      ${V.field("Base currency", "base_currency", s.base_currency || "CAD", { options: ["CAD", "USD", "EUR", "GBP", "CHF", "AUD", "JPY"] })}
      ${V.field("World clocks (IANA zones)", "timezones", s.timezones || ["America/Toronto", "America/New_York", "Europe/London"], { list: true })}
      ${V.field("Interests (personalise the briefing)", "interests", s.interests, { list: true, full: true, ph: "AI, venture capital, Canadian housing…" })}
      ${V.field("Objectives", "objectives", s.objectives, { area: true, full: true, ph: "What is this money and time for?" })}
      ${V.field("Constraints", "constraints", s.constraints, { area: true, full: true, ph: "Liquidity needs, ethical exclusions, tax…" })}
      ${V.field("Max single position (0-1)", "max_position", s.max_position || 0.15, { type: "number" })}
      ${V.field("Max sector (0-1)", "max_sector", s.max_sector || 0.35, { type: "number" })}
      ${V.field("Benchmark (ticker:weight, …)", "benchmark_s", (s.benchmark || [{ ticker: "^GSPC", w: 0.6 }, { ticker: "^GSPTSE", w: 0.4 }]).map((b) => b.ticker + ":" + b.w).join(", "), { full: true, help: "Yahoo symbols, e.g. ^GSPC:0.6, ^GSPTSE:0.4 or XEQT.TO:1" })}
      ${V.field("Muted keywords (hide stories containing)", "muted", s.muted, { list: true, full: true })}
    </form><div class="row mt16" style="justify-content:flex-end"><button class="btn pri" id="sp">Save</button></div></div>
    <div class="s5 panel"><div class="panel-h"><h3>Plans &amp; goals</h3><div class="tools"><button class="btn sm" id="addPl">${V.icon("plus")}</button></div></div>
      <div class="small muted" style="margin-bottom:10px">Plans appear in consequence maps: “How does this affect me?” traces events to your goals, not only your holdings.</div>
      <div class="list">${plans.map((p) => `<div class="item"><div class="grow"><div class="ttl">${esc(p.title)}</div><div class="meta">${esc(p.template || "custom")} · ${esc(p.horizon || "")}</div></div><button class="btn ghost xs" data-rp="${p.id}">×</button></div>`).join("") || '<div class="small muted">No plans yet.</div>'}</div></div></div>`;
    $("#sp").onclick = async () => {
      const d = V.formData($("#pf"));
      d.benchmark = (d.benchmark_s || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const [t, w] = x.split(":"); return { ticker: t.trim(), w: +(w || 1) }; });
      delete d.benchmark_s;
      await V.try(() => V.net("/api/settings", { body: d }), "Saved");
      Object.assign(V.store.settings, d); V.tickClocks();
    };
    $$("[data-rp]").forEach((b) => (b.onclick = async () => { await V.del("/api/r/plan/" + b.dataset.rp); V.render(); }));
    $("#addPl").onclick = () => {
      const m = V.modal("Add a plan", `<form class="form">${V.field("Title", "title", "", { ph: "Buy a home in Toronto" })}${V.field("Type", "template", s.plan_templates[0], { options: s.plan_templates })}${V.field("Horizon", "horizon", "", { ph: "2027" })}</form>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="ap">Add</button>`);
      $("#ap", m).onclick = async () => { const d = V.formData(m); if (!d.title) return; await V.post("/api/r/plan", d); V.closeOverlay(); V.render(); };
    };
  }

  async function security(el) {
    const s = await V.net("/api/sessions");
    el.innerHTML = `<div class="grid g12">
      <div class="s6 col gap16">
        <div class="panel"><div class="panel-h"><h3>Two-factor authentication</h3>${V.state.mfa ? V.lbl("calculated", "on") : V.lbl("missing", "off")}</div>
          <div class="small muted">Time-based one-time codes (TOTP) from any authenticator: Apple Passwords, 1Password, Google Authenticator, Authy.</div>
          <div id="mfaBox" class="mt12">${V.state.mfa ? `<button class="btn danger" id="mfaOff">Turn off</button>` : `<button class="btn pri" id="mfaOn">Set up two-factor</button>`}</div></div>
        <div class="panel"><div class="panel-h"><h3>Change password</h3></div><form class="form" id="pwf">
          <label class="f"><span>Current password</span><input class="in" type="password" name="current" autocomplete="current-password"></label>
          <label class="f"><span>New password</span><input class="in" type="password" name="new" autocomplete="new-password"></label>
          <div class="help">12+ characters with mixed types, or a 16+ character passphrase. Stretched in your browser (PBKDF2, 600k rounds) before anything is sent. Changing it signs out other devices.</div></form>
          <div class="row mt12" style="justify-content:flex-end"><button class="btn pri" id="pwS">Update password</button></div></div>
      </div>
      <div class="s6 col gap16">
        <div class="panel"><div class="panel-h"><h3>Active sessions</h3><div class="tools"><button class="btn sm" id="rvk">Sign out others</button></div></div>
          <div class="list">${s.sessions.map((x) => `<div class="item small"><div class="grow"><div class="ttl">${esc((x.ua || "").slice(0, 70))}</div><div class="meta">${esc(x.ip)} · started ${V.ago(x.created)} · active ${V.ago(x.last_seen)}</div></div>${x.current ? V.lbl("calculated", "this device") : ""}</div>`).join("")}</div></div>
        <div class="panel"><div class="panel-h"><h3>Security log</h3></div><div class="list">${s.audit.map((a) => `<div class="item small"><span class="mono muted" style="width:130px;flex:none">${new Date(a.ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><span class="grow">${esc(a.event)} <span class="muted">${esc(a.detail)}</span></span></div>`).join("") || '<div class="small muted">No events.</div>'}</div></div>
      </div></div>`;
    $("#pwS").onclick = async () => {
      const f = V.formData($("#pwf"));
      if (!f.new || f.new.length < 12) return V.toast("Use at least 12 characters.", "err");
      const cur = await V.net("/api/salt?u=" + encodeURIComponent(V.state.user));
      const salt = V.hexOf(crypto.getRandomValues(new Uint8Array(16)));
      await V.try(async () => V.net("/api/password", { body: { current_verifier: await V.derive(f.current || "", cur.salt, cur.iterations), salt, iterations: 600000, verifier: await V.derive(f.new, salt, 600000) } }), "Password updated. Other sessions signed out.");
      $("#pwf").reset();
    };
    $("#rvk").onclick = async () => { await V.try(() => V.net("/api/sessions/revoke", { body: {} }), "Other sessions signed out"); V.render(); };
    const on = $("#mfaOn"), off = $("#mfaOff");
    if (on) on.onclick = async () => {
      const r = await V.net("/api/mfa/setup", { body: {} });
      $("#mfaBox").innerHTML = `<ol class="small" style="padding-left:18px"><li>On this device, <a href="${esc(r.uri)}">open the setup link</a> (iPhone/Mac: adds to Passwords), or add this key manually in your authenticator:<div class="mono mt8" style="font-size:15px;letter-spacing:.12em;word-break:break-all;padding:10px;border:1px dashed var(--line2);border-radius:8px">${esc(r.secret.match(/.{1,4}/g).join(" "))}</div></li><li class="mt8">Enter the 6-digit code it shows:</li></ol>
        <div class="row"><input class="in mono" id="mfaCode" inputmode="numeric" placeholder="123456" style="max-width:160px;letter-spacing:.2em"><button class="btn pri" id="mfaV">Verify &amp; enable</button></div>`;
      $("#mfaV").onclick = async () => {
        const x = await V.try(() => V.net("/api/mfa/enable", { body: { code: $("#mfaCode").value } }));
        V.state.mfa = true;
        V.modal("Save your recovery codes", `<p class="small">Each code works once if you lose your authenticator. Store them in your password manager. They won't be shown again.</p><div class="mono" style="display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;font-size:15px;padding:12px;border:1px dashed var(--line2);border-radius:10px">${x.recovery.map((c) => `<span>${esc(c)}</span>`).join("")}</div>`, `<button class="btn" id="cpR">Copy</button><button class="btn pri" data-close>I've saved them</button>`);
        $("#cpR").onclick = () => navigator.clipboard.writeText(x.recovery.join("\n")).then(() => V.toast("Copied", "ok"));
        security(el);
      };
    };
    if (off) off.onclick = () => {
      const m = V.modal("Turn off two-factor", `<label class="f"><span>Confirm your password</span><input class="in" type="password" id="pwc"></label>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="dm">Turn off</button>`);
      $("#dm", m).onclick = async () => { const cur = await V.net("/api/salt?u=" + encodeURIComponent(V.state.user)); await V.try(async () => V.net("/api/mfa/disable", { body: { verifier: await V.derive($("#pwc", m).value, cur.salt, cur.iterations) } }), "Two-factor turned off"); V.state.mfa = false; V.closeOverlay(); security(el); };
    };
  }

  async function integrations(el) {
    const s = await V.net("/api/settings");
    el.innerHTML = `<div class="grid g12">
      <div class="s6 col gap16">
        <div class="panel"><div class="panel-h"><h3>Claude (optional)</h3>${s.anthropic_key_set ? V.lbl("calculated", "connected") : V.lbl("missing", "not connected")}</div>
          <div class="small muted">Adds reasoned analysis to stories, consequence maps, thesis checks, meeting prep, drafts and the chief of staff. Records are sent to the Anthropic API only when you press an AI button or ask a question. The key is stored in your private database and used only by your Worker.</div>
          <form class="form mt12" id="aif">${V.field("Anthropic API key", "anthropic_key", "", { type: "password", ph: s.anthropic_key_set ? "•••••••• (saved — enter to replace)" : "sk-ant-…" })}${V.field("Model", "anthropic_model", s.anthropic_model)}</form>
          <div class="row mt12" style="justify-content:flex-end">${s.anthropic_key_set ? '<button class="btn ghost" id="aiDel">Remove key</button>' : ""}<button class="btn pri" id="aiS">Save</button></div></div>
        <div class="panel"><div class="panel-h"><h3>SEC EDGAR contact</h3>${s.sec_contact ? V.lbl("calculated", "set") : V.lbl("estimate", "placeholder in use")}</div>
          <div class="small muted">SEC asks automated tools to identify a contact email in requests. It's sent only to sec.gov.</div>
          <form class="form mt12" id="secf">${V.field("Your email", "sec_contact", s.sec_contact, { type: "email" })}</form><div class="row mt12" style="justify-content:flex-end"><button class="btn pri" id="secS">Save</button></div></div></div>
      <div class="s6 panel"><div class="panel-h"><h3>What each source provides</h3></div><div class="small col gap6">
        <div><b>News</b>: 15 public RSS feeds (BBC, Guardian, Al Jazeera, NYT, CNBC, MarketWatch, CBC, Federal Reserve, Bank of Canada, Ars Technica, TechCrunch, Hacker News). Headlines and summaries.</div>
        <div><b>Quotes &amp; history</b>: Yahoo Finance's public chart endpoint. Unofficial and delayed; upgrade path is a paid market-data API.</div>
        <div><b>Bank of Canada</b>: official Valet API (FX, policy/prime/mortgage rates, bond yields, CPI).</div>
        <div><b>US CPI</b>: Bureau of Labor Statistics public API (for inflation-adjusted prices).</div>
        <div><b>Shipping</b>: IMF PortWatch daily chokepoint transits (AIS-based; lags a few days).</div>
        <div><b>Flights</b>: ADS-B Exchange community data via adsb.lol (aircraft broadcasting positions).</div>
        <div><b>News attention</b>: GDELT global news volume and latest articles.</div>
        <div><b>Travel advisories</b>: Government of Canada. <b>Earthquakes</b>: USGS.</div>
        <div><b>Filings</b>: SEC EDGAR (13F, 8-K, 10-Q/K, N-PORT). Canadian SEDAR+ has no free API.</div>
        <div><b>Calendars</b>: ICS links you add. <b>Not integrated</b>: brokerage account sync (use CSV), email, LinkedIn API.</div></div></div></div>`;
    $("#aiS").onclick = async () => { const d = V.formData($("#aif")); if (!d.anthropic_key) delete d.anthropic_key; await V.try(() => V.net("/api/settings", { body: d }), "Saved"); V.state.ai = (await V.net("/api/state")).ai; V.render(); };
    const del = $("#aiDel"); if (del) del.onclick = async () => { await V.net("/api/settings", { body: { anthropic_key: "" } }); V.state.ai = (await V.net("/api/state")).ai; V.render(); };
    $("#secS").onclick = async () => { const d = V.formData($("#secf")); await V.try(() => V.net("/api/settings", { body: d }), "Saved"); V.state.settings = Object.assign(V.state.settings || {}, d); V.state.sec = !!d.sec_contact; V.render(); };
  }

  async function engine(el) {
    const st = await V.net("/api/status"), now = Date.now() / 1000;
    const state = (j) => j.last_error && (!j.last_ok || j.last_run > j.last_ok) ? ["err", "failing"] : !j.last_ok ? ["off", "pending"] : now - j.last_ok > 86400 ? ["warn", "stale"] : ["ok", "healthy"];
    const series = st.series.filter((x) => x.error).slice(0, 30);
    el.innerHTML = `<div class="grid g12">
      <div class="s12">${V.engineStrip()}</div>
      <div class="s7 panel"><div class="panel-h"><h3>Jobs</h3><div class="tools"><button class="btn sm" id="runNow">${V.icon("refresh")} Run engine now</button></div></div>
        <table class="tbl"><thead><tr><th>Job</th><th>Status</th><th>Last success</th><th class="num">Runs</th><th>Note</th></tr></thead><tbody>
        ${st.jobs.map((j) => { const [c, l] = state(j); return `<tr><td class="mono small"><b>${esc(j.name)}</b></td><td><span class="row gap6 small"><span class="led ${c}"></span>${l}</span>${j.last_error ? `<div class="xs down" style="max-width:300px">${esc(j.last_error)}</div>` : ""}</td><td class="small mono">${V.ago(j.last_ok)}</td><td class="num small">${j.runs}</td><td class="xs muted">${esc(j.note || "")}</td></tr>`; }).join("") || `<tr><td colspan="5" class="muted">The engine hasn't run yet. Press “Run engine now”.</td></tr>`}</tbody></table></div>
      <div class="s5 col gap16">
        <div class="panel"><div class="panel-h"><h3>How the engine works</h3></div><div class="small col gap6">
          <div>Every <b>5 minutes</b> a Cloudflare Cron Trigger wakes the engine, even when you're not signed in. Each run collects 3 news feeds, refreshes 10 quotes, samples one flight region and one news-attention series, and runs one heavier job in rotation (price histories, Bank of Canada, shipping, earthquakes, travel advisories, SEC filings, daily snapshot).</div>
          <div>After collecting, it checks thresholds and writes <b>signals</b> to your Radar: a holding moving 5%+, oil or indices lurching, the 10-year moving 12 bp, a Bank of Canada rate change, a chokepoint running below 60% of normal, a news surge on a hotspot, a changed travel advisory, a new 13F.</div>
          <div>When you open Vantage, your browser adds the deeper layer: thesis monitoring, exposure and correlation models, calendar and relationship signals. The free Cloudflare plan limits server CPU, so the heavy math runs on your device.</div></div></div>
        <div class="panel"><div class="panel-h"><h3>Data held</h3></div><div class="kv small">${Object.entries(st.counts).map(([k, v]) => `<div>${esc(k)}</div><div class="mono">${v.toLocaleString()}</div>`).join("")}<div>news items</div><div class="mono">${st.news_items.toLocaleString()}</div><div>series</div><div class="mono">${st.series.length}</div></div></div>
        ${series.length ? `<div class="panel"><div class="panel-h"><h3>Series with errors</h3></div><div class="small">${series.map((x) => `<div><span class="mono">${esc(x.id)}</span> <span class="down xs">${esc(x.error)}</span></div>`).join("")}</div></div>` : ""}
      </div></div>`;
    $("#runNow").onclick = async (e) => { e.currentTarget.innerHTML = '<span class="spin"></span> Running…'; await V.try(() => V.post("/api/refresh", {}), "Engine ran"); engine(el); };
  }

  async function notes(el) {
    const items = V.store.records.note.slice().sort((a, b) => b._created - a._created);
    el.innerHTML = `<div class="row" style="margin-bottom:12px"><span class="grow small muted">Saved research, answers and thoughts. Searchable from ⌘K and the chief of staff.</span><button class="btn pri sm" id="nN">${V.icon("plus")} Note</button></div>
      <div class="grid g2">${items.map((n) => `<div class="panel"><div class="row"><b>${esc(n.title || "Untitled")}</b><span class="grow"></span><span class="src">${V.ago(n._created)}</span><button class="btn ghost xs" data-dn="${n.id}">×</button></div><div class="small mt8" style="white-space:pre-wrap;max-height:220px;overflow:auto">${esc(n.text || "")}</div>${(n.tags || []).map((t) => `<span class="chip" style="cursor:default">${esc(t)}</span>`).join(" ")}</div>`).join("") || '<div class="panel"><div class="empty">No notes yet.</div></div>'}</div>`;
    $$("[data-dn]").forEach((b) => (b.onclick = async () => { await V.del("/api/r/note/" + b.dataset.dn); V.render(); }));
    $("#nN").onclick = () => {
      const m = V.modal("New note", `<form class="form">${V.field("Title", "title", "")}${V.field("Note", "text", "", { area: true, rows: 8 })}${V.field("Tags", "tags", "", { list: true })}</form>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="sn">Save</button>`);
      $("#sn", m).onclick = async () => { await V.post("/api/r/note", V.formData(m)); V.closeOverlay(); V.render(); };
    };
  }

  async function data(el) {
    const st = await V.net("/api/status");
    el.innerHTML = `<div class="grid g12"><div class="s6 panel"><div class="panel-h"><h3>Export &amp; import</h3></div>
        <div class="small muted">Download everything in the ${esc(V.state.space.toUpperCase())} workspace as JSON (records and settings; API keys are never exported). Keep a copy somewhere safe: it's your backup.</div>
        <div class="row mt12"><a class="btn pri" href="/api/export" download>${V.icon("down")} Export JSON</a><label class="btn">${V.icon("up")} Import JSON<input type="file" id="impJ" accept="application/json" class="hidden"></label></div>
        <hr class="divider"><div class="kv small">${Object.entries(st.counts).map(([k, v]) => `<div>${esc(k)}</div><div class="mono">${v.toLocaleString()}</div>`).join("")}</div></div>
      <div class="s6 panel"><div class="panel-h"><h3>Where your data lives</h3></div><div class="small col gap6">
        <div>Your records are stored in a <b>Cloudflare D1</b> database in your own Cloudflare account, readable only through this Worker after you sign in. D1 keeps point-in-time recovery (Time Travel) for recent changes.</div>
        <div>Heavy market series are cached in your browser (IndexedDB) so pages load fast; clearing site data just re-downloads them.</div>
        <div><button class="btn sm" id="clrCache">Clear this device's cache</button></div></div>
        ${V.state.space === "demo" ? `<hr class="divider"><button class="btn danger" id="rsDemo">Reset demo workspace</button>` : ""}</div></div>`;
    $("#impJ").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const j = JSON.parse(await f.text()); const r = await V.try(() => V.net("/api/import", { body: j })); V.toast(`Imported ${r.imported} records` + (r.skipped ? ` (${r.skipped} skipped: already present or invalid)` : ""), "ok"); await V.store.boot(true); };
    $("#clrCache").onclick = async () => { await V.store.idb.clear(); V.toast("Cache cleared; reloading", "ok"); setTimeout(() => location.reload(), 600); };
    const rd = $("#rsDemo"); if (rd) rd.onclick = async () => { if (await V.confirm("Reset the demo workspace to its sample data?", "Reset")) { await V.net("/api/demo/reset", { body: {} }); await V.store.boot(true); V.toast("Demo reset", "ok"); V.render(); } };
  }

  function trust(el) {
    el.innerHTML = `<div class="panel" style="max-width:860px"><h2 style="font:700 22px var(--sans);margin:0 0 10px">How Vantage earns trust</h2>
      <div class="col gap16 small" style="line-height:1.65">
        <div><b>Private by construction.</b> Everything, including the app's code, sits behind your sign-in; only the login page is public, and search engines are told not to index it. Your password is stretched in your browser (PBKDF2-SHA256, 600k rounds) and never sent; the server keeps only a keyed hash of the result. Sessions are random 256-bit tokens stored as hashes, in __Host- cookies (HttpOnly, Secure, SameSite=Strict). Logins are rate-limited, two-factor is available, and every sign-in is logged.</div>
        <div><b>No fabricated data.</b> Prices, FX, news, filings and calendar entries come from named sources with timestamps. When a fetch fails you see the last good value with its age, or nothing. Vantage never invents holdings, people, relationships, sources or integrations.</div>
        <div><b>Labels on every claim.</b> ${V.lbl("fact", "reported")} from a source · ${V.lbl("calculated")} arithmetic on your records and fetched data · ${V.lbl("statistical")} fitted on price history (association, not cause) · ${V.lbl("estimate")} rough sensitivity model · ${V.lbl("interpretation")} economic reasoning · ${V.lbl("forecast")} forward-looking · ${V.lbl("ai", "Claude")} model-written · ${V.lbl("demo")} sample content.</div>
        <div><b>Demo is quarantined.</b> Sample people, positions, events and decisions exist only in the DEMO workspace, watermarked on every page, and never mix with LIVE.</div>
        <div><b>Nothing is sent on your behalf.</b> Message drafts are drafts. Vantage never emails, posts or trades.</div>
        <div><b>History can't be rewritten.</b> Every record change is appended to a revision log; decision reasoning locks after 24 hours.</div>
        <div><b>Not financial advice.</b> Portfolio considerations are evidence and reasoning to support your own decisions, framed by the objectives and constraints you set.</div>
      </div></div>`;
  }
})();
