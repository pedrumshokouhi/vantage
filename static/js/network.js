/* Relationship map, "Who do I know who…?", relationship memory, contact records. */
"use strict";
(function () {
  const esc = V.esc, $ = V.$, $$ = V.$$;

  V.views.network = async function (page) {
    const d = await V.get("/api/network");
    V.cache.net = d;
    const mem = d.memory;
    const colorBy = localStorage.getItem("vt_netcolor") || "industry";
    const sizeBy = localStorage.getItem("vt_netsize") || "influence";
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Relationship map · ${d.contacts.length} people</div><h1>Your <em>network</em>, with you at the centre</h1>
        <p>Distance = closeness (your assessment). Size = ${sizeBy}. Dashed links are unverified. Everything is editable and explainable.</p></div>
        <div class="actions"><button class="btn" id="impC">${V.icon("down")} Import CSV</button><button class="btn pri" id="addC">${V.icon("plus")} Contact</button></div></div>
      <div class="who" style="margin-bottom:16px"><span class="pre">Who do I know who…</span><input id="whoQ" placeholder="…could introduce me to Sequoia?  …is in New York?  …has built a startup?" autocomplete="off"><button class="btn pri" id="whoGo">Ask</button></div>
      <div id="whoOut"></div>
      <div class="grid g12">
        <div class="s8 col gap16">
          <div class="row wrap gap6"><span class="xs mono muted">COLOUR BY</span><div class="seg">${["industry", "city", "org", "community", "closeness"].map((k) => `<button data-color="${k}" class="${k === colorBy ? "on" : ""}">${k}</button>`).join("")}</div>
            <span class="xs mono muted" style="margin-left:10px">SIZE BY</span><div class="seg">${["influence", "prominence", "closeness"].map((k) => `<button data-size="${k}" class="${k === sizeBy ? "on" : ""}">${k}</button>`).join("")}</div>
            <input class="in" id="netFilter" placeholder="Filter: company, city, industry…" style="max-width:220px;margin-left:auto"></div>
          <div class="net-wrap" id="netWrap"><canvas id="net"></canvas><div class="net-legend" id="netLegend"></div><div class="net-tip hidden" id="netTip"></div></div>
        </div>
        <div class="s4 col gap16">
          <div class="panel"><div class="panel-h"><h3>Relationship memory</h3></div>
            ${mem.promises.length ? `<div class="xs mono muted" style="letter-spacing:.12em">PROMISES YOU MADE</div><div class="list">${mem.promises.map((p) => `<div class="item clickable small" data-c="${p.id}"><span class="lbl ${p.overdue ? "missing" : "retrieved"}">${p.overdue ? "overdue" : p.due ? "due " + p.due.slice(5) : "open"}</span><div class="grow"><span class="ttl">${esc(p.text)}</span><div class="meta">${esc(p.name)}</div></div></div>`).join("")}</div>` : ""}
            ${mem.milestones.length ? `<div class="xs mono muted mt16" style="letter-spacing:.12em">MILESTONES</div><div class="list">${mem.milestones.map((m) => `<div class="item clickable small" data-c="${m.id}"><span class="lbl forecast">${m.days}d</span><div class="grow"><span class="ttl">${esc(m.name)}</span> · ${esc(m.what)}</div></div>`).join("")}</div>` : ""}
            ${mem.reasons.length ? `<div class="xs mono muted mt16" style="letter-spacing:.12em">REASONS TO RECONNECT</div><div class="list">${mem.reasons.map((r) => `<div class="item clickable small" data-c="${r.id}"><div class="grow">${esc(r.text)}${r.src ? `<div class="src">${esc(r.src)}</div>` : ""}</div><button class="btn xs" data-draft="${r.id}">Draft</button></div>`).join("")}</div>` : ""}
            <div class="xs mono muted mt16" style="letter-spacing:.12em">LOST TOUCH</div><div class="list">${mem.lost_touch.slice(0, 8).map((x) => `<div class="item clickable small" data-c="${x.id}"><div class="avatar" style="background:${V.color(x.name)};width:28px;height:28px;font-size:10px">${V.initials(x.name)}</div><div class="grow"><span class="ttl">${esc(x.name)}</span><div class="meta">${x.days ? x.days + "d since contact · cadence " + x.cadence + "d" : "never logged"}</div></div><button class="btn xs" data-draft="${x.id}">Draft</button></div>`).join("") || '<div class="small muted">Everyone is within their cadence.</div>'}</div>
          </div>
        </div>
      </div></div>`;
    $$("[data-color]").forEach((b) => (b.onclick = () => { localStorage.setItem("vt_netcolor", b.dataset.color); V.render(); }));
    $$("[data-size]").forEach((b) => (b.onclick = () => { localStorage.setItem("vt_netsize", b.dataset.size); V.render(); }));
    $$("[data-c]").forEach((b) => (b.onclick = (e) => { if (!e.target.closest("[data-draft]")) V.openContact(b.dataset.c); }));
    $$("[data-draft]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); V.draftFor(b.dataset.draft); }));
    $("#addC").onclick = () => V.editContact();
    $("#impC").onclick = importContacts;
    const g = graph($("#net"), d.contacts, { colorBy, sizeBy });
    $("#netFilter").oninput = V.debounce((e) => g.filter(e.target.value.trim().toLowerCase()), 150);
    const ask = async () => {
      const q = $("#whoQ").value.trim(); if (!q) return;
      const r = await V.get("/api/who?q=" + encodeURIComponent("who do I know who " + q.replace(/^who do i know (who )?/i, "")));
      g.highlight(r.results.map((x) => x.id));
      $("#whoOut").innerHTML = `<div class="panel" style="margin-bottom:16px"><div class="panel-h"><h3>Results</h3>${V.lbl("retrieved", "from your contact records")}<div class="tools"><button class="btn ghost xs" id="clrW">Clear</button></div></div>
        ${r.results.length ? `<div class="grid g3">${r.results.slice(0, 9).map((x) => `<div class="row clickable" data-c2="${x.id}" style="align-items:flex-start"><div class="avatar" style="background:${V.color(x.name)}">${V.initials(x.name)}</div><div class="grow small"><div class="ttl">${esc(x.name)}</div><div class="meta">${esc([x.role, x.org, x.city].filter(Boolean).join(" · "))}</div><div class="xs" style="color:var(--ion)">${esc(x.reasons.join(" · "))}</div></div></div>`).join("")}</div>` : `<div class="small muted">${esc(r.empty_reason || "No direct matches.")}</div>`}
        ${r.paths.length ? `<div class="xs mono muted mt16" style="letter-spacing:.12em">KNOWN PATHS${r.parsed.org ? " TO " + esc(r.parsed.org.toUpperCase()) : ""}</div><div class="col gap6 mt8">${r.paths.map((p) => `<div class="path ${p.verified ? "" : "unv"}">${p.path.map((n) => `<span class="nd">${esc(n.name)}</span>`).join('<span class="ar">→</span>')} ${p.verified ? "" : V.lbl("unverified")}<span class="xs muted">${esc(p.note)}</span></div>`).join("")}</div>` : ""}
        <div class="help mt12">Parsed: ${r.parsed.city ? "city “" + esc(r.parsed.city) + "” · " : ""}${r.parsed.org ? "organisation “" + esc(r.parsed.org) + "” · " : ""}${r.parsed.terms.length ? "expanded terms: " + esc(r.parsed.terms.join(", ")) : ""}</div></div>`;
      $$("[data-c2]").forEach((b) => (b.onclick = () => V.openContact(b.dataset.c2)));
      $("#clrW").onclick = () => { $("#whoOut").innerHTML = ""; g.highlight(null); };
    };
    $("#whoGo").onclick = ask;
    $("#whoQ").onkeydown = (e) => { if (e.key === "Enter") ask(); };
  };

  function graph(cv, contacts, opt) {
    const wrap = cv.parentElement;
    const ctx = cv.getContext("2d");
    let W, H, dpr;
    const size = () => { dpr = Math.min(2, devicePixelRatio || 1); W = wrap.clientWidth; H = wrap.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    const groupOf = (c) => opt.colorBy === "closeness" ? "closeness " + (c.closeness || 2) : (c[opt.colorBy] || "—");
    const groups = [...new Set(contacts.map(groupOf))];
    const palette = ["#5eead4", "#7dd3fc", "#b4a2ff", "#fbbf24", "#f472b6", "#34d399", "#fb7185", "#fdba74", "#a3e635", "#93c5fd", "#f0abfc", "#fcd34d"];
    const gcol = (g) => opt.colorBy === "closeness" ? ["#56627a", "#7dd3fc", "#5eead4", "#34d399", "#fbbf24", "#f472b6"][+g.split(" ")[1] || 0] : palette[groups.indexOf(g) % palette.length];
    const me = { id: "me", x: 0, y: 0, r: 16, fixed: true, name: "You" };
    const nodes = contacts.map((c, i) => {
      const a = (i / contacts.length) * Math.PI * 2;
      const target = 70 + (5 - (+c.closeness || 2)) * 62;
      return { id: c.id, c, x: Math.cos(a) * target, y: Math.sin(a) * target, vx: 0, vy: 0, target,
        r: 5 + (+(c[opt.sizeBy] || 2)) * 2.4, color: gcol(groupOf(c)), name: c.name };
    });
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const links = [], seenL = new Set();
    contacts.forEach((c) => (c.connections || []).forEach((l) => {
      if (!byId[l.id]) return;
      const key = [c.id, l.id].sort().join("|");
      if (seenL.has(key)) return;
      seenL.add(key);
      links.push({ a: byId[c.id], b: byId[l.id], verified: !!l.verified });
    }));
    contacts.forEach((c) => { if (c.introduced_by && byId[c.introduced_by]) links.push({ a: byId[c.introduced_by], b: byId[c.id], verified: true, intro: true }); });
    let view = { x: 0, y: 0, k: 1 }, hover = null, hl = null, filt = "";
    const step = () => {
      for (const n of nodes) {
        const d = Math.hypot(n.x, n.y) || 1;
        const f = (n.target - d) * 0.02;
        n.vx += (n.x / d) * f; n.vy += (n.y / d) * f;
      }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy + 0.01; const min = a.r + b.r + 18;
        if (d2 < min * min * 4) { const f = 60 / d2; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f; }
      }
      for (const l of links) { const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y; const f = 0.0015; l.a.vx += dx * f; l.a.vy += dy * f; l.b.vx -= dx * f; l.b.vy -= dy * f; }
      for (const n of nodes) { n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy; }
    };
    for (let i = 0; i < 260; i++) step();
    const match = (n) => !filt || [n.c.org, n.c.city, n.c.industry, n.c.community, n.c.name, n.c.role].some((v) => (v || "").toLowerCase().includes(filt));
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.save(); ctx.translate(W / 2 + view.x, H / 2 + view.y); ctx.scale(view.k, view.k);
      for (let i = 1; i <= 5; i++) { ctx.beginPath(); ctx.arc(0, 0, 70 + (5 - i) * 62, 0, Math.PI * 2); ctx.strokeStyle = "rgba(148,170,200,.06)"; ctx.setLineDash([2, 6]); ctx.stroke(); ctx.setLineDash([]); }
      ctx.font = "10px Geist Mono, monospace"; ctx.fillStyle = "rgba(148,170,200,.35)";
      ["closest", "close", "", "", "distant"].forEach((t, i) => t && ctx.fillText(t, 4, -(70 + i * 62) - 4));
      const dim = (n) => (hl && !hl.has(n.id)) || !match(n);
      for (const n of nodes) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(n.x, n.y); ctx.strokeStyle = dim(n) ? "rgba(148,170,200,.03)" : `rgba(94,234,212,${0.04 + (+n.c.closeness || 2) * 0.03})`; ctx.lineWidth = 1; ctx.stroke(); }
      for (const l of links) {
        ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y);
        ctx.setLineDash(l.verified ? [] : [4, 4]);
        ctx.strokeStyle = dim(l.a) && dim(l.b) ? "rgba(148,170,200,.05)" : l.intro ? "rgba(180,162,255,.55)" : "rgba(148,170,200,.35)";
        ctx.lineWidth = l.intro ? 1.4 : 1; ctx.stroke(); ctx.setLineDash([]);
      }
      for (const n of nodes) {
        const dd = dim(n);
        ctx.globalAlpha = dd ? 0.18 : 1;
        if (+n.c.prominence >= 4) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 5, 0, Math.PI * 2); ctx.strokeStyle = n.color; ctx.globalAlpha = dd ? 0.08 : 0.35; ctx.stroke(); ctx.globalAlpha = dd ? 0.18 : 1; }
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fillStyle = n.color; ctx.fill();
        if (hover === n || (hl && hl.has(n.id))) { ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke(); }
        ctx.fillStyle = "rgba(232,238,246,.85)"; ctx.font = "11px Geist, sans-serif"; ctx.textAlign = "center";
        if (view.k > 0.7 || hover === n) ctx.fillText(n.name.split(" ")[0], n.x, n.y + n.r + 13);
      }
      ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 30); g.addColorStop(0, "rgba(94,234,212,.9)"); g.addColorStop(1, "rgba(94,234,212,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fillStyle = "#5eead4"; ctx.fill();
      ctx.fillStyle = "#04201c"; ctx.font = "600 9px Geist Mono, monospace"; ctx.textAlign = "center"; ctx.fillText("YOU", 0, 3);
      ctx.restore();
    };
    let t = 0;
    const loop = () => { if (!document.body.contains(cv)) return; if (t++ < 120) { step(); } draw(); requestAnimationFrame(loop); };
    loop();
    $("#netLegend").innerHTML = groups.slice(0, 14).map((g) => `<span class="row gap6"><span class="dot" style="background:${gcol(g)}"></span>${esc(g)}</span>`).join("") + `<span class="row gap6"><span style="width:14px;border-top:1.5px dashed var(--muted)"></span>unverified</span><span class="row gap6"><span style="width:14px;border-top:1.5px solid var(--violet)"></span>introduced</span>`;
    const toWorld = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - W / 2 - view.x) / view.k, y: (e.clientY - r.top - H / 2 - view.y) / view.k }; };
    const hit = (p) => nodes.find((n) => Math.hypot(n.x - p.x, n.y - p.y) < n.r + 4);
    let drag = null;
    cv.onmousedown = (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; };
    window.addEventListener("mouseup", () => { drag = null; });
    cv.onmousemove = (e) => {
      if (drag) { view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y; if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true; return; }
      const n = hit(toWorld(e)); hover = n || null;
      const tip = $("#netTip");
      if (n) { const r = cv.getBoundingClientRect(); tip.classList.remove("hidden"); tip.style.left = e.clientX - r.left + "px"; tip.style.top = e.clientY - r.top + "px";
        tip.innerHTML = `<b>${esc(n.name)}</b><div class="muted">${esc([n.c.role, n.c.org].filter(Boolean).join(" · "))}</div><div class="xs mono mt8">${esc(n.c.city || "")} · closeness ${n.c.closeness || "?"}/5 · influence ${n.c.influence || "?"}/5</div>${n.c._last ? `<div class="xs dim">last contact ${esc(n.c._last)}</div>` : ""}`; }
      else tip.classList.add("hidden");
      cv.style.cursor = n ? "pointer" : "grab";
    };
    cv.onclick = (e) => { if (drag && drag.moved) return; const n = hit(toWorld(e)); if (n) V.openContact(n.id); };
    cv.onwheel = (e) => { e.preventDefault(); view.k = Math.max(0.4, Math.min(2.5, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); };
    window.addEventListener("resize", size);
    return { highlight: (ids) => { hl = ids ? new Set(ids) : null; }, filter: (f) => { filt = f; } };
  }

  function importContacts() {
    const b = V.modal("Import contacts", `<p class="small muted">LinkedIn: <i>Settings → Data privacy → Get a copy of your data → Connections</i>, then paste or upload <code>Connections.csv</code>. Google Contacts CSV and simple <code>name, org, role, city, email, birthday</code> files also work. Imported people start at closeness 2; set your own assessments afterwards. Duplicate names are skipped.</p>
      <textarea class="in mono" id="csv" rows="8"></textarea><div class="row mt12"><input type="file" id="file" accept=".csv,text/csv" class="small"></div>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="go">Import</button>`);
    $("#file", b).onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then((t) => ($("#csv", b).value = t)); };
    $("#go", b).onclick = async () => { const r = await V.try(() => V.post("/api/import/contacts", { csv: $("#csv", b).value })); V.toast(`Imported ${r.added} of ${r.rows} rows`, "ok"); V.closeOverlay(); V.render(); };
  }

  const DIMS = [["closeness", "Closeness to you", "How well you know each other and how likely they'd help. 1 = acquaintance, 5 = inner circle."],
    ["influence", "Professional influence", "Ability to open doors or make decisions in their field. 1 = early career, 5 = decision-maker."],
    ["prominence", "Public prominence", "How publicly known they are. 1 = private, 5 = widely known."]];

  V.openContact = async function (id) {
    const c = await V.get("/api/r/contact/" + id);
    const all = (V.cache.net && V.cache.net.contacts) || (await V.get("/api/r/contact")).items;
    const name = (x) => (all.find((y) => y.id === x) || {}).name || "Unknown";
    const box = V.drawer(esc(c.name), `
      <div class="row gap16"><div class="avatar" style="background:${V.color(c.name)};width:54px;height:54px;font-size:16px">${V.initials(c.name)}</div><div class="grow"><div class="big">${esc([c.role, c.org].filter(Boolean).join(" · ") || "—")}</div><div class="muted small">${esc([c.industry, c.city, c.country].filter(Boolean).join(" · "))}</div>
        ${c.email || c.linkedin ? `<div class="small mt8">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ""} ${c.linkedin ? `· <a href="${esc(c.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>` : ""}</div>` : ""}</div>
        <button class="btn" id="edC">Edit</button><button class="btn pri" id="drC">Draft message</button></div>
      <div class="dims mt16">${DIMS.map(([k, l, help]) => `<div class="panel" style="padding:12px"><div class="xs mono muted" title="${esc(help)}">${esc(l.toUpperCase())}</div><div class="dim5 mt8" data-dim="${k}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= (c[k] || 0) ? "on" : ""}" data-v="${i}" title="${i}"></i>`).join("")}</div><div class="xs dim mt8">${esc(help)}</div></div>`).join("")}</div>
      <div class="help mt8">These are your own assessments, kept separate on purpose: someone can be close to you without being influential, or prominent without being close.</div>
      <div class="kv mt16"><div>How we met</div><div>${esc(c.how_met || "—")}</div><div>Introduced by</div><div>${c.introduced_by ? `<a href="#" data-open="${c.introduced_by}">${esc(name(c.introduced_by))}</a>` : "—"}</div>
        <div>Experience</div><div>${(c.experience || []).map((x) => `<span class="chip" style="cursor:default">${esc(x)}</span>`).join(" ") || "—"}</div>
        <div>Interests</div><div>${(c.interests || []).map((x) => `<span class="chip" style="cursor:default">${esc(x)}</span>`).join(" ") || "—"}</div>
        <div>Birthday</div><div>${esc(c.birthday ? c.birthday.slice(5) : "—")}</div><div>Cadence</div><div>every ${c.cadence_days || { 5: 30, 4: 45, 3: 90, 2: 180, 1: 365 }[c.closeness || 2]} days${c.cadence_days ? "" : " (default for closeness)"}</div></div>
      ${c.notes ? `<div class="panel mt16"><div class="panel-h"><h3>Private notes</h3></div><div class="small" style="white-space:pre-wrap">${esc(c.notes)}</div></div>` : ""}
      <div class="panel mt16"><div class="panel-h"><h3>Mutual connections</h3><div class="tools"><button class="btn xs" id="addL">${V.icon("plus")} Link</button></div></div>${(c.connections || []).map((l, i) => `<div class="row small" style="padding:4px 0"><a href="#" data-open="${l.id}">${esc(name(l.id))}</a>${l.verified ? V.lbl("retrieved", "verified") : V.lbl("unverified")}<span class="grow"></span><button class="btn ghost xs" data-togv="${i}">${l.verified ? "Mark unverified" : "Mark verified"}</button><button class="btn ghost xs" data-rml="${i}">×</button></div>`).join("") || '<div class="small muted">No known links between this person and others in your network.</div>'}</div>
      <div class="panel mt16"><div class="panel-h"><h3>Promises &amp; commitments</h3><div class="tools"><button class="btn xs" id="addP">${V.icon("plus")}</button></div></div>${(c.commitments || []).map((x, i) => `<div class="row small" style="padding:4px 0"><input type="checkbox" data-done="${i}" ${x.done ? "checked" : ""}><span class="grow ${x.done ? "dim" : ""}">${esc(x.text)}</span><span class="mono xs muted">${esc(x.due || "")}</span></div>`).join("") || '<div class="small muted">Nothing promised.</div>'}</div>
      <div class="panel mt16"><div class="panel-h"><h3>Milestones</h3><div class="tools"><button class="btn xs" id="addM">${V.icon("plus")}</button></div></div>${(c.milestones || []).map((m) => `<div class="small">${esc(m.date)} · ${esc(m.title)}${m.yearly ? " (yearly)" : ""}</div>`).join("") || '<div class="small muted">Add weddings, launches, new jobs, anniversaries…</div>'}</div>
      <div class="panel mt16"><div class="panel-h"><h3>Interactions</h3><div class="tools"><button class="btn xs" id="addI">${V.icon("plus")} Log</button></div></div>${(c.interactions || []).slice().reverse().map((i) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="row small"><span class="mono">${esc(i.date)}</span><span class="chip" style="cursor:default">${esc(i.type || "note")}</span></div><div class="small mt8">${esc(i.notes || "")}</div></div>`).join("") || '<div class="small muted">Log calls, coffees and messages to keep your memory sharp.</div>'}</div>`, { kicker: "Contact" });
    const save = async (patch, msg) => { await V.try(() => V.put("/api/r/contact/" + id, patch), msg); V.openContact(id); if (V.route()[0] === "network") setTimeout(V.render, 50); };
    $$("[data-dim] i", box).forEach((i) => (i.onclick = () => save({ [i.parentElement.dataset.dim]: +i.dataset.v })));
    $$("[data-open]", box).forEach((a) => (a.onclick = (e) => { e.preventDefault(); V.openContact(a.dataset.open); }));
    $("#edC", box).onclick = () => V.editContact(c);
    $("#drC", box).onclick = () => V.draftFor(id);
    $$("[data-done]", box).forEach((x) => (x.onchange = () => { const cm = (c.commitments || []).slice(); cm[+x.dataset.done] = Object.assign({}, cm[+x.dataset.done], { done: x.checked }); save({ commitments: cm }); }));
    $$("[data-togv]", box).forEach((x) => (x.onclick = () => { const l = (c.connections || []).slice(); l[+x.dataset.togv] = Object.assign({}, l[+x.dataset.togv], { verified: !l[+x.dataset.togv].verified }); save({ connections: l }); }));
    $$("[data-rml]", box).forEach((x) => (x.onclick = () => { const l = (c.connections || []).slice(); l.splice(+x.dataset.rml, 1); save({ connections: l }); }));
    const mini = (title, fields, onSave) => { const m = V.modal(title, `<form class="form">${fields}</form>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="ms">Save</button>`); $("#ms", m).onclick = () => { const d = V.formData(m); V.closeOverlay(); onSave(d); }; };
    $("#addI", box).onclick = () => mini("Log interaction", V.field("Date", "date", V.iso(new Date()), { type: "date" }) + V.field("Type", "type", "coffee", { options: ["coffee", "call", "meeting", "message", "email", "event", "dinner"] }) + V.field("Notes", "notes", "", { area: true }) + `<label class="row small"><input type="checkbox" name="promise_toggle"> I promised something (add it under commitments next)</label>`, (d) => save({ interactions: (c.interactions || []).concat([{ date: d.date, type: d.type, notes: d.notes }]), last_contact: d.date }, "Logged"));
    $("#addP", box).onclick = () => mini("Add promise", V.field("What did you promise?", "text", "") + V.field("Due", "due", "", { type: "date" }), (d) => d.text && save({ commitments: (c.commitments || []).concat([{ text: d.text, due: d.due, made: V.iso(new Date()) }]) }, "Added"));
    $("#addM", box).onclick = () => mini("Add milestone", V.field("What", "title", "") + V.field("Date", "date", "", { type: "date" }) + `<label class="row small"><input type="checkbox" name="yearly"> Repeats yearly</label>`, (d) => d.title && save({ milestones: (c.milestones || []).concat([d]) }, "Added"));
    $("#addL", box).onclick = () => mini("Link to someone", `<label class="f"><span>Person</span><select class="in" name="lid">${all.filter((x) => x.id !== id).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label class="row small"><input type="checkbox" name="verified"> I've confirmed they know each other</label>`, (d) => save({ connections: (c.connections || []).concat([{ id: d.lid, verified: d.verified }]) }, "Linked"));
  };

  V.editContact = function (c) {
    c = c || {};
    const isNew = !c.id;
    const b = V.modal(isNew ? "New contact" : "Edit contact", `<form class="form two">
      ${V.field("Name", "name", c.name)}${V.field("Role", "role", c.role)}${V.field("Organisation", "org", c.org)}${V.field("Industry", "industry", c.industry)}
      ${V.field("City", "city", c.city)}${V.field("Country", "country", c.country)}${V.field("Community / circle", "community", c.community, { ph: "MBA, climbing club…" })}${V.field("How we met", "how_met", c.how_met)}
      ${V.field("Email", "email", c.email)}${V.field("LinkedIn URL", "linkedin", c.linkedin)}
      ${V.field("Birthday (YYYY-MM-DD or MM-DD)", "birthday", c.birthday)}${V.field("Follow-up cadence (days)", "cadence_days", c.cadence_days, { type: "number", ph: "default by closeness" })}
      ${V.field("Experience tags", "experience", c.experience, { list: true, ph: "founder, investor, operator", full: true })}
      ${V.field("Interests", "interests", c.interests, { list: true, full: true })}
      ${V.field("Private notes", "notes", c.notes, { area: true, full: true })}
    </form>`, `${isNew ? "" : '<button class="btn danger" id="dC" style="margin-right:auto">Delete</button>'}<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="sC">Save</button>`);
    $("#sC", b).onclick = async () => {
      const d = V.formData(b);
      if (!d.name) return V.toast("Name is required", "err");
      if (isNew) Object.assign(d, { closeness: 2, influence: 2, prominence: 1 });
      const r = await V.try(() => (isNew ? V.post("/api/r/contact", d) : V.put("/api/r/contact/" + c.id, d)), "Saved");
      V.closeOverlay(); if (V.route()[0] === "network") V.render(); V.openContact(r.id);
    };
    if (!isNew) $("#dC", b).onclick = async () => { if (await V.confirm("Delete " + c.name + "?", "Delete")) { await V.del("/api/r/contact/" + c.id); V.closeOverlay(); V.render(); } };
  };

  V.draftFor = async function (id, purpose) {
    const b = V.modal("Draft message", `<div class="loading"><span class="spin"></span></div>`, `<button class="btn ghost" data-close>Close</button><button class="btn ai" id="dAi">${V.icon("spark")} Rewrite with Claude</button><button class="btn" id="dMail">Open in mail</button><button class="btn pri" id="dCopy">Copy</button>`);
    const load = async (ai) => {
      const r = await V.post("/api/draft", { contact_id: id, purpose: purpose || "", ai });
      $(".mb", b).innerHTML = `<div class="small muted">To <b>${esc(r.to)}</b>${r.email ? " · " + esc(r.email) : ""} ${r.model ? V.lbl("ai", "Claude") : V.lbl("interpretation", "template")}</div>
        <textarea class="in mt12" id="dBody" rows="12">${esc(r.body)}</textarea>
        ${r.basis.length ? `<div class="help mt8">Based on: ${esc(r.basis.join(" · "))}</div>` : ""}
        <div class="callout info mt12">${esc(r.note)}</div>`;
      $("#dMail", b).onclick = () => { location.href = `mailto:${encodeURIComponent(r.email || "")}?body=${encodeURIComponent($("#dBody", b).value)}`; };
    };
    try { await load(false); } catch (e) { $(".mb", b).innerHTML = esc(e.message); }
    $("#dCopy", b).onclick = async () => { await navigator.clipboard.writeText($("#dBody", b).value); V.toast("Copied. Nothing was sent.", "ok"); };
    $("#dAi", b).onclick = async (e) => { if (!V.state.ai || !V.state.ai.ok) return V.aiHelp(); e.currentTarget.innerHTML = '<span class="spin"></span>'; try { await load(true); } catch (err) { V.toast(err.message, "err"); } e.currentTarget.innerHTML = V.icon("spark") + " Rewrite with Claude"; };
  };
})();
