/* Network: relationship map, "Who do I know who…?", relationship memory, rating triage, contact records. */
"use strict";
(function () {
  const esc = V.esc, $ = V.$, $$ = V.$$;
  const I = () => V.intel;

  V.views.network = async function (page) {
    const d = await V.get("/api/network");
    V.cache.net = d;
    const mem = d.memory, all = d.contacts;
    const rated = all.filter((c) => c.closeness);
    const scope = localStorage.getItem("vt_netscope") || (rated.length >= 8 ? "rated" : "tagged");
    const colorBy = localStorage.getItem("vt_netcolor") || "community";
    const sizeBy = localStorage.getItem("vt_netsize") || "closeness";
    const shown = scope === "rated" ? rated : scope === "tagged" ? all.filter((c) => c.closeness || c.org || c.community || c.birthday) : all;
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Network · PPL &lt;GO&gt; · ${all.length.toLocaleString()} people · ${rated.length} rated</div><h1>Your <em>network</em>, with you at the centre</h1>
        <p>Distance = how close you are (your rating). Colour = ${esc(colorBy)}. Dashed links are unverified. Rate people to turn an address book into a relationship map.</p></div>
        <div class="actions"><button class="btn acc" id="rate">${V.icon("bolt")} Rate people</button><button class="btn" id="impC">${V.icon("down")} Import CSV</button><button class="btn pri" id="addC">${V.icon("plus")} Contact</button></div></div>
      <div class="who" style="margin-bottom:14px"><span class="pre">WHO DO I KNOW WHO…</span><input id="whoQ" placeholder="…could introduce me to Sequoia?  …is in New York?  …is a lawyer?  …works at Apple?" autocomplete="off"><button class="btn pri" id="whoGo">Ask</button></div>
      <div id="whoOut"></div>
      <div class="grid g12">
        <div class="s8 col gap16">
          <div class="row wrap gap6"><span class="kicker">SHOW</span><div class="seg">${[["rated", `Rated (${rated.length})`], ["tagged", "Tagged & rated"], ["all", `All (${all.length.toLocaleString()})`]].map(([k, l]) => `<button data-scope="${k}" class="${k === scope ? "on" : ""}">${l}</button>`).join("")}</div>
            <span class="kicker" style="margin-left:8px">COLOUR</span><div class="seg">${["community", "city", "industry", "closeness"].map((k) => `<button data-color="${k}" class="${k === colorBy ? "on" : ""}">${k}</button>`).join("")}</div>
            <input class="in" id="netFilter" placeholder="Filter: name, tag, city…" style="max-width:200px;margin-left:auto"></div>
          <div class="net-wrap" id="netWrap"><canvas id="net"></canvas><div class="net-legend" id="netLegend"></div><div class="net-tip hidden" id="netTip"></div></div>
          <div class="panel"><div class="panel-h"><h3>Directory</h3><div class="tools"><input class="in" id="dirQ" placeholder="Search ${all.length.toLocaleString()} people" style="width:240px"></div></div><div id="dir"></div></div>
        </div>
        <div class="s4 col gap16">
          <div class="panel"><div class="panel-h"><h3>Relationship memory</h3></div>
            ${mem.promises.length ? `<div class="kicker">Promises you made</div><div class="list">${mem.promises.map((p) => `<div class="item clickable small" data-c="${p.id}"><span class="lbl ${p.overdue ? "missing" : "retrieved"}">${p.overdue ? "overdue" : p.due ? "due " + p.due.slice(5) : "open"}</span><div class="grow"><span class="ttl">${esc(p.text)}</span><div class="meta">${esc(p.name)}</div></div></div>`).join("")}</div>` : ""}
            ${mem.milestones.length ? `<div class="kicker mt16">Birthdays &amp; milestones (next 30 days)</div><div class="list">${mem.milestones.slice(0, 12).map((m) => `<div class="item clickable small" data-c="${m.id}"><span class="lbl ${m.rated === false ? "retrieved" : "forecast"}">${m.days === 0 ? "today" : m.days + "d"}</span><div class="grow"><span class="ttl">${esc(m.name)}</span> · ${esc(m.what)}</div><button class="btn xs" data-draft="${m.id}">Note</button></div>`).join("")}</div>` : ""}
            ${mem.reasons.length ? `<div class="kicker mt16">Reasons to reconnect</div><div class="list">${mem.reasons.map((r) => `<div class="item clickable small" data-c="${r.id}"><div class="grow">${esc(r.text)}${r.src ? `<div class="src">${esc(r.src)}</div>` : ""}</div><button class="btn xs" data-draft="${r.id}">Draft</button></div>`).join("")}</div>` : ""}
            <div class="kicker mt16">Lost touch</div><div class="list">${mem.lost_touch.slice(0, 8).map((x) => `<div class="item clickable small" data-c="${x.id}"><div class="avatar" style="background:${V.color(x.name)};width:26px;height:26px;font-size:10px">${V.initials(x.name)}</div><div class="grow"><span class="ttl">${esc(x.name)}</span><div class="meta">${x.days ? x.days + "d since contact · cadence " + x.cadence + "d" : "never logged"}</div></div><button class="btn xs" data-draft="${x.id}">Draft</button></div>`).join("") || `<div class="small muted">Rate people and log interactions, and Vantage tracks who's slipping.</div>`}</div>
          </div>
          <div class="panel"><div class="panel-h"><h3>Your circles</h3></div>${circles(all)}</div>
        </div>
      </div></div>`;
    $$("[data-scope]").forEach((b) => (b.onclick = () => { localStorage.setItem("vt_netscope", b.dataset.scope); V.render(); }));
    $$("[data-color]").forEach((b) => (b.onclick = () => { localStorage.setItem("vt_netcolor", b.dataset.color); V.render(); }));
    $$("[data-c]").forEach((b) => (b.onclick = (e) => { if (!e.target.closest("[data-draft]")) V.openContact(b.dataset.c); }));
    $$("[data-draft]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); V.draftFor(b.dataset.draft); }));
    $$("[data-circle]").forEach((b) => (b.onclick = () => { $("#dirQ").value = b.dataset.circle; drawDir(); }));
    $("#addC").onclick = () => V.editContact();
    $("#impC").onclick = importContacts;
    $("#rate").onclick = () => rateMode(all);
    const g = graph($("#net"), shown, { colorBy, sizeBy });
    $("#netFilter").oninput = V.debounce((e) => g.filter(e.target.value.trim().toLowerCase()), 150);
    const drawDir = () => {
      const q = ($("#dirQ").value || "").toLowerCase().trim();
      const list = (q ? all.filter((c) => [c.name, c.org, c.city, c.role, c.community, c.email].some((v) => (v || "").toLowerCase().includes(q))) : all.filter((c) => c.closeness).concat(all.filter((c) => !c.closeness && c.org))).slice(0, 80);
      $("#dir").innerHTML = list.length ? `<table class="tbl"><thead><tr><th>Name</th><th>Tag / org</th><th>City</th><th>Closeness</th><th>Last contact</th><th></th></tr></thead><tbody>${list.map((c) => `<tr class="click" data-cid="${c.id}"><td><b>${esc(c.name)}</b>${c.role ? `<div class="xs muted">${esc(c.role)}</div>` : ""}</td><td class="small">${esc(c.org || "")}</td><td class="small">${esc(c.city || "")}</td><td>${c.closeness ? `<span class="mono">${"●".repeat(c.closeness)}${"○".repeat(5 - c.closeness)}</span>` : `<span class="xs muted">unrated</span>`}</td><td class="small mono">${esc(c._last || "—")}</td><td class="right">${c.phone ? `<a class="btn ghost xs" href="sms:${esc(c.phone)}" title="Text">✉</a>` : ""}</td></tr>`).join("")}</tbody></table><div class="help mt8">${q ? list.length + " match" + (list.length === 1 ? "" : "es") + (list.length === 80 ? " (first 80)" : "") : "Showing rated and tagged people. Search to find anyone."}</div>` : `<div class="empty small">No one matches.</div>`;
      $$("[data-cid]", $("#dir")).forEach((r) => (r.onclick = (e) => { if (!e.target.closest("a")) V.openContact(r.dataset.cid); }));
    };
    $("#dirQ").oninput = V.debounce(drawDir, 120); drawDir();
    const ask = async () => {
      const q = $("#whoQ").value.trim(); if (!q) return;
      const r = await V.get("/api/who?q=" + encodeURIComponent("who do I know who " + q.replace(/^who do i know (who )?/i, "")));
      g.highlight(r.results.map((x) => x.id));
      $("#whoOut").innerHTML = `<div class="panel" style="margin-bottom:14px"><div class="panel-h"><h3>Results</h3>${V.lbl("retrieved", "from your contact records")}<div class="tools"><button class="btn ghost xs" id="clrW">Clear</button></div></div>
        ${r.results.length ? `<div class="grid g3">${r.results.slice(0, 12).map((x) => `<div class="row clickable" data-c2="${x.id}" style="align-items:flex-start"><div class="avatar" style="background:${V.color(x.name)}">${V.initials(x.name)}</div><div class="grow small"><div class="ttl">${esc(x.name)}</div><div class="meta">${esc([x.role, x.org, x.city].filter(Boolean).join(" · "))}</div><div class="xs" style="color:var(--acc-ink)">${esc(x.reasons.join(" · "))}</div></div></div>`).join("")}</div>` : `<div class="small muted">${esc(r.empty_reason || "No direct matches.")}</div>`}
        ${r.paths.length ? `<div class="kicker mt16">Known paths${r.parsed.org ? " to " + esc(r.parsed.org) : ""}</div><div class="col gap6 mt8">${r.paths.map((p) => `<div class="path ${p.verified ? "" : "unv"}">${p.path.map((n) => `<span class="nd">${esc(n.name)}</span>`).join('<span class="ar">→</span>')} ${p.verified ? "" : V.lbl("unverified")}<span class="xs muted">${esc(p.note)}</span></div>`).join("")}</div>` : ""}
        <div class="help mt12">Parsed: ${r.parsed.city ? "city “" + esc(r.parsed.city) + "” · " : ""}${r.parsed.org ? "organisation “" + esc(r.parsed.org) + "” · " : ""}${r.parsed.terms.length ? "terms: " + esc(r.parsed.terms.join(", ")) : ""}</div></div>`;
      $$("[data-c2]").forEach((b) => (b.onclick = () => V.openContact(b.dataset.c2)));
      $("#clrW").onclick = () => { $("#whoOut").innerHTML = ""; g.highlight(null); };
    };
    $("#whoGo").onclick = ask;
    $("#whoQ").onkeydown = (e) => { if (e.key === "Enter") ask(); };
  };

  function circles(all) {
    const c = {};
    for (const x of all) if (x.community || x.org) { const k = x.community || x.org; c[k] = (c[k] || 0) + 1; }
    const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 18);
    return top.length ? `<div class="row wrap gap6">${top.map(([k, n]) => `<button class="chip" data-circle="${esc(k)}">${esc(k)} <span class="mono xs muted">${n}</span></button>`).join("")}</div><div class="help mt8">From the organisation / group labels in your contacts.</div>` : `<div class="small muted">No groups yet.</div>`;
  }

  function graph(cv, contacts, opt) {
    const wrap = cv.parentElement, ctx = cv.getContext("2d");
    let W, H;
    const size = () => { const dpr = Math.min(2, devicePixelRatio || 1); W = wrap.clientWidth; H = wrap.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    const dark = document.documentElement.dataset.theme === "dark";
    const groupOf = (c) => opt.colorBy === "closeness" ? "closeness " + (c.closeness || "unrated") : (c[opt.colorBy] || c.org || "—");
    const counts = {}; contacts.forEach((c) => { const g = groupOf(c); counts[g] = (counts[g] || 0) + 1; });
    const groups = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const pal = ["#ff6a00", "#1d6fd8", "#6d3fd6", "#0a8a4a", "#d02a78", "#b7791f", "#0f766e", "#c2410c", "#4f46e5", "#be123c", "#15803d", "#7c3aed"];
    const gcol = (g) => (g === "—" || /unrated/.test(g) ? (dark ? "#4b5260" : "#b9bdc4") : pal[groups.indexOf(g) % pal.length]);
    const R = (c) => 60 + (5 - (+c.closeness || 0.3)) * 52;
    const big = contacts.length > 450;
    const gi = (g) => groups.indexOf(g) / Math.max(1, groups.length);
    const nodes = contacts.map((c, i) => {
      const g = groupOf(c), a = (big ? gi(g) * Math.PI * 2 + (Math.random() - 0.5) * 0.35 : (i / contacts.length) * Math.PI * 2), r = R(c) + (big ? Math.random() * 40 : 0);
      return { id: c.id, c, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, target: r, r: big ? 2.2 + (+c.closeness || 0) : 4 + (+c.closeness || 0.5) * 2.2, color: gcol(g), name: c.name, g };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = [], seenL = new Set();
    for (const c of contacts) for (const l of c.connections || []) { if (!byId.has(l.id)) continue; const k = [c.id, l.id].sort().join("|"); if (seenL.has(k)) continue; seenL.add(k); links.push({ a: byId.get(c.id), b: byId.get(l.id), verified: !!l.verified }); }
    for (const c of contacts) if (c.introduced_by && byId.has(c.introduced_by)) links.push({ a: byId.get(c.introduced_by), b: byId.get(c.id), verified: true, intro: true });
    let view = { x: 0, y: 0, k: big ? 0.8 : 1 }, hover = null, hl = null, filt = "";
    const step = () => {
      for (const n of nodes) { const d = Math.hypot(n.x, n.y) || 1, f = (n.target - d) * 0.02; n.vx += (n.x / d) * f; n.vy += (n.y / d) * f; }
      if (!big) for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01, min = a.r + b.r + 14;
        if (d2 < min * min * 4) { const f = 50 / d2; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f; }
      }
      for (const l of links) { const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y; l.a.vx += dx * 0.0015; l.a.vy += dy * 0.0015; l.b.vx -= dx * 0.0015; l.b.vy -= dy * 0.0015; }
      for (const n of nodes) { n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy; }
    };
    for (let i = 0; i < (big ? 40 : 240); i++) step();
    const match = (n) => !filt || [n.c.org, n.c.city, n.c.industry, n.c.community, n.c.name, n.c.role].some((v) => (v || "").toLowerCase().includes(filt));
    const ink = dark ? "rgba(236,238,241," : "rgba(12,13,16,";
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.save(); ctx.translate(W / 2 + view.x, H / 2 + view.y); ctx.scale(view.k, view.k);
      for (let i = 1; i <= 5; i++) { ctx.beginPath(); ctx.arc(0, 0, 60 + (5 - i) * 52, 0, Math.PI * 2); ctx.strokeStyle = ink + ".08)"; ctx.setLineDash([2, 6]); ctx.stroke(); ctx.setLineDash([]); }
      ctx.font = "10px Geist Mono, monospace"; ctx.fillStyle = ink + ".35)";
      ["inner circle", "close", "friends", "", "acquaintances"].forEach((t, i) => t && ctx.fillText(t, 4, -(60 + i * 52) - 4));
      const dim = (n) => (hl && !hl.has(n.id)) || !match(n);
      if (!big) for (const n of nodes) { if (!n.c.closeness) continue; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(n.x, n.y); ctx.strokeStyle = dim(n) ? ink + ".02)" : `rgba(255,106,0,${0.05 + (+n.c.closeness || 0) * 0.03})`; ctx.lineWidth = 1; ctx.stroke(); }
      for (const l of links) { ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.setLineDash(l.verified ? [] : [4, 4]); ctx.strokeStyle = dim(l.a) && dim(l.b) ? ink + ".05)" : l.intro ? "rgba(109,63,214,.6)" : ink + ".3)"; ctx.lineWidth = l.intro ? 1.4 : 1; ctx.stroke(); ctx.setLineDash([]); }
      for (const n of nodes) {
        const dd = dim(n); ctx.globalAlpha = dd ? 0.15 : 1;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fillStyle = n.color; ctx.fill();
        if (hover === n || (hl && hl.has(n.id))) { ctx.lineWidth = 2; ctx.strokeStyle = dark ? "#fff" : "#000"; ctx.stroke(); }
        if (!big && (view.k > 0.7 || hover === n) && !dd) { ctx.fillStyle = ink + ".8)"; ctx.font = "11px Geist, sans-serif"; ctx.textAlign = "center"; ctx.fillText(n.name.split(" ")[0], n.x, n.y + n.r + 12); }
      }
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fillStyle = "#ff6a00"; ctx.fill();
      ctx.fillStyle = "#111"; ctx.font = "700 9px Geist Mono, monospace"; ctx.textAlign = "center"; ctx.fillText("YOU", 0, 3);
      ctx.restore();
    };
    let t = 0;
    const loop = () => { if (!document.body.contains(cv)) return; if (!big && t++ < 90) step(); draw(); requestAnimationFrame(loop); };
    loop();
    $("#netLegend").innerHTML = groups.slice(0, 12).map((g) => `<span class="row gap6"><span class="dot" style="background:${gcol(g)}"></span>${esc(g)} <span class="mono xs">${counts[g]}</span></span>`).join("") + `<span class="row gap6"><span style="width:14px;border-top:1.5px dashed var(--muted)"></span>unverified link</span>`;
    const toWorld = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - W / 2 - view.x) / view.k, y: (e.clientY - r.top - H / 2 - view.y) / view.k }; };
    const hit = (p) => { let best = null, bd = 1e9; for (const n of nodes) { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < n.r + 4 && d < bd) { best = n; bd = d; } } return best; };
    let drag = null;
    cv.onmousedown = (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; };
    window.addEventListener("mouseup", () => { setTimeout(() => (drag = null), 0); });
    cv.onmousemove = (e) => {
      if (drag) { view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y; if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true; return; }
      const n = hit(toWorld(e)); hover = n || null;
      const tip = $("#netTip");
      if (n) { const r = cv.getBoundingClientRect(); tip.classList.remove("hidden"); tip.style.left = e.clientX - r.left + "px"; tip.style.top = e.clientY - r.top + "px"; tip.innerHTML = `<b>${esc(n.name)}</b><div class="muted">${esc([n.c.role, n.c.org].filter(Boolean).join(" · "))}</div><div class="xs">${esc(n.c.city || "")} ${n.c.closeness ? "· closeness " + n.c.closeness + "/5" : "· unrated"}</div>`; }
      else tip.classList.add("hidden");
      cv.style.cursor = n ? "pointer" : "grab";
    };
    cv.onclick = (e) => { if (drag && drag.moved) return; const n = hit(toWorld(e)); if (n) V.openContact(n.id); };
    cv.onwheel = (e) => { e.preventDefault(); view.k = Math.max(0.3, Math.min(3, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); };
    window.addEventListener("resize", size);
    return { highlight: (ids) => { hl = ids ? new Set(ids) : null; }, filter: (f) => { filt = f; } };
  }

  // "Rate people": fast keyboard triage to build an inner circle out of a phone book
  function rateMode(all) {
    const queue = all.filter((c) => !c.closeness).sort((a, b) => (b.birthday ? 1 : 0) + (b.org ? 1 : 0) + (b.email ? 0.5 : 0) - ((a.birthday ? 1 : 0) + (a.org ? 1 : 0) + (a.email ? 0.5 : 0)));
    let i = 0, done = 0;
    const box = V.modal("Rate your people", `<div id="rateCard"></div>`, `<span class="small muted" id="rateCount" style="margin-right:auto"></span><button class="btn ghost" data-close>Done</button>`);
    const show = () => {
      const c = queue[i];
      $("#rateCount", box).textContent = `${done} rated this session · ${queue.length - i} to go`;
      if (!c) { $("#rateCard", box).innerHTML = `<div class="empty"><b>All caught up</b>Everyone has a rating.</div>`; return; }
      $("#rateCard", box).innerHTML = `<div class="row gap16"><div class="avatar" style="background:${V.color(c.name)};width:54px;height:54px;font-size:17px">${V.initials(c.name)}</div><div class="grow"><div style="font:700 20px var(--sans)">${esc(c.name)}</div><div class="muted">${esc([c.role, c.org, c.city].filter(Boolean).join(" · ") || "No details")}</div><div class="xs muted mt8">${c.birthday ? "🎂 " + esc(c.birthday) + " · " : ""}${c.phone ? "phone · " : ""}${c.email ? "email" : ""}</div></div></div>
        <div class="kicker mt16">How close are you?</div>
        <div class="grid g5 mt8">${[[1, "Acquaintance"], [2, "Know them"], [3, "Friend"], [4, "Close"], [5, "Inner circle"]].map(([v, l]) => `<button class="btn" data-v="${v}" style="flex-direction:column;padding:10px"><b class="mono" style="font-size:18px">${v}</b><span class="xs">${l}</span></button>`).join("")}</div>
        <div class="row mt12"><button class="btn ghost sm" data-v="skip">Skip (S)</button><span class="xs muted">Keyboard: 1–5 to rate, S to skip. Ratings set follow-up cadence and who appears in memory.</span></div>`;
      $$("[data-v]", box).forEach((b) => (b.onclick = () => rate(b.dataset.v)));
    };
    const rate = async (v) => {
      const c = queue[i]; if (!c) return;
      i++;
      if (v !== "skip") { done++; V.put("/api/r/contact/" + c.id, { closeness: +v }).catch((e) => V.toast(e.message, "err")); c.closeness = +v; }
      show();
    };
    const key = (e) => { if (!document.body.contains(box)) { document.removeEventListener("keydown", key); V.render(); return; } if (/^[1-5]$/.test(e.key)) rate(e.key); if (e.key.toLowerCase() === "s") rate("skip"); };
    document.addEventListener("keydown", key);
    show();
  }

  function importContacts() {
    const b = V.modal("Import contacts", `<p class="small muted">Apple / "MyContacts" exports, Google Contacts CSV, and LinkedIn <code>Connections.csv</code> are recognised. Duplicates (same name and phone/email) are skipped. Organisation or group labels become circles you can colour and search by.</p>
      <div class="panel" id="drop" style="text-align:center;border-style:dashed;padding:22px;cursor:pointer"><b>Drop a CSV here</b><div class="small muted">or click to choose</div><input type="file" id="file" accept=".csv,text/csv" class="hidden"></div><div id="out" class="mt12"></div>`, `<button class="btn ghost" data-close>Close</button>`);
    const run = async (text) => { $("#out", b).innerHTML = `<div class="loading" style="padding:10px"><span class="spin"></span>Importing…</div>`; try { const r = await V.post("/api/import/contacts", { csv: text }); $("#out", b).innerHTML = `<div class="callout info">Imported ${r.added.toLocaleString()} of ${r.rows.toLocaleString()} rows.</div>`; } catch (e) { $("#out", b).innerHTML = `<div class="callout bad">${esc(e.message)}</div>`; } };
    const drop = $("#drop", b), file = $("#file", b);
    drop.onclick = () => file.click();
    drop.ondragover = (e) => { e.preventDefault(); };
    drop.ondrop = async (e) => { e.preventDefault(); run(await e.dataTransfer.files[0].text()); };
    file.onchange = async () => run(await file.files[0].text());
  }

  const DIMS = [["closeness", "Closeness to you", "1 = acquaintance, 5 = inner circle."], ["influence", "Professional influence", "1 = early career, 5 = decision-maker."], ["prominence", "Public prominence", "1 = private, 5 = widely known."]];
  V.openContact = async function (id) {
    const c = V.store.records.contact.find((x) => x.id === id) || await V.get("/api/r/contact/" + id);
    const all = V.store.records.contact;
    const name = (x) => (all.find((y) => y.id === x) || {}).name || "Unknown";
    const box = V.drawer(esc(c.name), `
      <div class="row gap16"><div class="avatar" style="background:${V.color(c.name)};width:52px;height:52px;font-size:16px">${V.initials(c.name)}</div><div class="grow"><div class="big"><b>${esc([c.role, c.org].filter(Boolean).join(" · ") || "—")}</b></div><div class="muted small">${esc([c.industry, c.city, c.country].filter(Boolean).join(" · "))}</div>
        <div class="small mt8 row wrap gap6">${c.phone ? `<a class="btn xs" href="tel:${esc(c.phone)}">Call</a><a class="btn xs" href="sms:${esc(c.phone)}">Text</a>` : ""}${c.email ? `<a class="btn xs" href="mailto:${esc(c.email)}">Email</a>` : ""}${c.linkedin ? `<a class="btn xs" href="${esc(c.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>` : ""}</div></div>
        <button class="btn" id="edC">Edit</button><button class="btn pri" id="drC">Draft message</button></div>
      <div class="dims mt16">${DIMS.map(([k, l, h]) => `<div class="panel" style="padding:10px"><div class="kicker">${esc(l)}</div><div class="dim5 mt8" data-dim="${k}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= (c[k] || 0) ? "on" : ""}" data-v="${i}" title="${i}"></i>`).join("")}</div><div class="xs muted mt8">${esc(h)}</div></div>`).join("")}</div>
      <div class="help mt8">Your own assessments, kept separate: someone can be close to you without being influential, or prominent without being close.</div>
      <div class="kv mt16"><div>How we met</div><div>${esc(c.how_met || "—")}</div><div>Introduced by</div><div>${c.introduced_by ? `<a href="#" data-open="${c.introduced_by}">${esc(name(c.introduced_by))}</a>` : "—"}</div>
        <div>Experience</div><div>${(c.experience || []).map((x) => `<span class="chip" style="cursor:default">${esc(x)}</span>`).join(" ") || "—"}</div><div>Interests</div><div>${(c.interests || []).map((x) => `<span class="chip" style="cursor:default">${esc(x)}</span>`).join(" ") || "—"}</div>
        <div>Birthday</div><div>${esc(c.birthday || "—")}</div><div>Phone · email</div><div class="mono small">${esc(c.phone || "—")} · ${esc(c.email || "—")}</div><div>Cadence</div><div>${V.intel.cadence(c) ? "every " + V.intel.cadence(c) + " days" : "set a closeness to track"}</div></div>
      ${c.notes ? `<div class="panel mt16"><div class="panel-h"><h3>Private notes</h3></div><div class="small" style="white-space:pre-wrap">${esc(c.notes)}</div></div>` : ""}
      <div class="panel mt16"><div class="panel-h"><h3>Mutual connections</h3><div class="tools"><button class="btn xs" id="addL">${V.icon("plus")} Link</button></div></div>${(c.connections || []).map((l, i) => `<div class="row small" style="padding:3px 0"><a href="#" data-open="${l.id}">${esc(name(l.id))}</a>${l.verified ? V.lbl("retrieved", "verified") : V.lbl("unverified")}<span class="grow"></span><button class="btn ghost xs" data-togv="${i}">${l.verified ? "Mark unverified" : "Mark verified"}</button><button class="btn ghost xs" data-rml="${i}">×</button></div>`).join("") || '<div class="small muted">No known links to others in your network.</div>'}</div>
      <div class="panel mt16"><div class="panel-h"><h3>Promises</h3><div class="tools"><button class="btn xs" id="addP">${V.icon("plus")}</button></div></div>${(c.commitments || []).map((x, i) => `<div class="row small" style="padding:3px 0"><input type="checkbox" data-done="${i}" ${x.done ? "checked" : ""}><span class="grow ${x.done ? "dim" : ""}">${esc(x.text)}</span><span class="mono xs muted">${esc(x.due || "")}</span></div>`).join("") || '<div class="small muted">Nothing promised.</div>'}</div>
      <div class="panel mt16"><div class="panel-h"><h3>Milestones</h3><div class="tools"><button class="btn xs" id="addM">${V.icon("plus")}</button></div></div>${(c.milestones || []).map((m) => `<div class="small">${esc(m.date)} · ${esc(m.title)}${m.yearly ? " (yearly)" : ""}</div>`).join("") || '<div class="small muted">Weddings, launches, new jobs, anniversaries…</div>'}</div>
      <div class="panel mt16"><div class="panel-h"><h3>Interactions</h3><div class="tools"><button class="btn xs" id="addI">${V.icon("plus")} Log</button></div></div>${(c.interactions || []).slice().reverse().map((i) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="row small"><span class="mono">${esc(i.date)}</span><span class="chip" style="cursor:default">${esc(i.type || "note")}</span></div><div class="small mt8">${esc(i.notes || "")}</div></div>`).join("") || '<div class="small muted">Log calls, coffees and messages.</div>'}</div>`, { kicker: "Contact" });
    const save = async (patch, msg) => { await V.try(() => V.put("/api/r/contact/" + id, patch), msg); V.openContact(id); };
    $$("[data-dim] i", box).forEach((i) => (i.onclick = () => save({ [i.parentElement.dataset.dim]: +i.dataset.v })));
    $$("[data-open]", box).forEach((a) => (a.onclick = (e) => { e.preventDefault(); V.openContact(a.dataset.open); }));
    $("#edC", box).onclick = () => V.editContact(c);
    $("#drC", box).onclick = () => V.draftFor(id);
    $$("[data-done]", box).forEach((x) => (x.onchange = () => { const cm = (c.commitments || []).slice(); cm[+x.dataset.done] = Object.assign({}, cm[+x.dataset.done], { done: x.checked }); save({ commitments: cm }); }));
    $$("[data-togv]", box).forEach((x) => (x.onclick = () => { const l = (c.connections || []).slice(); l[+x.dataset.togv] = Object.assign({}, l[+x.dataset.togv], { verified: !l[+x.dataset.togv].verified }); save({ connections: l }); }));
    $$("[data-rml]", box).forEach((x) => (x.onclick = () => { const l = (c.connections || []).slice(); l.splice(+x.dataset.rml, 1); save({ connections: l }); }));
    const mini = (title, fields, onSave) => { const m = V.modal(title, `<form class="form">${fields}</form>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="ms">Save</button>`); $("#ms", m).onclick = () => { const d = V.formData(m); V.closeOverlay(); onSave(d); }; };
    $("#addI", box).onclick = () => mini("Log interaction", V.field("Date", "date", V.iso(new Date()), { type: "date" }) + V.field("Type", "type", "coffee", { options: ["coffee", "call", "meeting", "message", "email", "event", "dinner"] }) + V.field("Notes", "notes", "", { area: true }), (d) => save({ interactions: (c.interactions || []).concat([{ date: d.date, type: d.type, notes: d.notes }]), last_contact: d.date }, "Logged"));
    $("#addP", box).onclick = () => mini("Add promise", V.field("What did you promise?", "text", "") + V.field("Due", "due", "", { type: "date" }), (d) => d.text && save({ commitments: (c.commitments || []).concat([{ text: d.text, due: d.due, made: V.iso(new Date()) }]) }, "Added"));
    $("#addM", box).onclick = () => mini("Add milestone", V.field("What", "title", "") + V.field("Date", "date", "", { type: "date" }) + `<label class="row small"><input type="checkbox" name="yearly"> Repeats yearly</label>`, (d) => d.title && save({ milestones: (c.milestones || []).concat([d]) }, "Added"));
    $("#addL", box).onclick = () => mini("Link to someone", `<label class="f"><span>Person</span><input class="in" name="q" placeholder="Type a name" list="plist"><datalist id="plist">${all.filter((x) => x.id !== id).slice(0, 3000).map((x) => `<option value="${esc(x.name)}">`).join("")}</datalist></label><label class="row small"><input type="checkbox" name="verified"> I've confirmed they know each other</label>`, (d) => { const t = all.find((x) => x.name === d.q); if (t) save({ connections: (c.connections || []).concat([{ id: t.id, verified: d.verified }]) }, "Linked"); else V.toast("No contact with that exact name", "err"); });
  };
  V.editContact = function (c) {
    c = c || {};
    const isNew = !c.id;
    const b = V.modal(isNew ? "New contact" : "Edit contact", `<form class="form two">
      ${V.field("Name", "name", c.name)}${V.field("Role", "role", c.role)}${V.field("Organisation / group", "org", c.org)}${V.field("Industry", "industry", c.industry)}
      ${V.field("City", "city", c.city)}${V.field("Country", "country", c.country)}${V.field("Community / circle", "community", c.community)}${V.field("How we met", "how_met", c.how_met)}
      ${V.field("Email", "email", c.email)}${V.field("Phone", "phone", c.phone)}${V.field("Birthday (YYYY-MM-DD or MM-DD)", "birthday", c.birthday)}${V.field("Follow-up cadence (days)", "cadence_days", c.cadence_days, { type: "number", ph: "default by closeness" })}
      ${V.field("Experience tags", "experience", c.experience, { list: true, ph: "founder, investor, operator", full: true })}${V.field("Interests", "interests", c.interests, { list: true, full: true })}${V.field("Private notes", "notes", c.notes, { area: true, full: true })}</form>`,
      `${isNew ? "" : '<button class="btn danger" id="dC" style="margin-right:auto">Delete</button>'}<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="sC">Save</button>`);
    $("#sC", b).onclick = async () => {
      const d = V.formData(b);
      if (!d.name) return V.toast("Name is required", "err");
      const r = await V.try(() => (isNew ? V.post("/api/r/contact", d) : V.put("/api/r/contact/" + c.id, d)), "Saved");
      V.closeOverlay(); if (V.route()[0] === "network") V.render(); V.openContact(r.id);
    };
    if (!isNew) $("#dC", b).onclick = async () => { if (await V.confirm("Delete " + c.name + "?", "Delete")) { await V.del("/api/r/contact/" + c.id); V.closeOverlay(); V.render(); } };
  };
  V.draftFor = async function (id, purpose) {
    const b = V.modal("Draft message", `<div class="loading"><span class="spin"></span></div>`, `<button class="btn ghost" data-close>Close</button><button class="btn ai" id="dAi">${V.icon("spark")} Rewrite with Claude</button><button class="btn" id="dMail">Email</button><button class="btn" id="dSms">Text</button><button class="btn pri" id="dCopy">Copy</button>`);
    const load = async (ai) => {
      const r = await V.post("/api/draft", { contact_id: id, purpose: purpose || "", ai });
      $(".mb", b).innerHTML = `<div class="small muted">To <b>${esc(r.to)}</b>${r.email ? " · " + esc(r.email) : ""}${r.phone ? " · " + esc(r.phone) : ""} ${r.model ? V.lbl("ai", "Claude") : V.lbl("interpretation", "template")}</div><textarea class="in mt12" id="dBody" rows="12">${esc(r.body)}</textarea>${r.basis.length ? `<div class="help mt8">Based on: ${esc(r.basis.join(" · "))}</div>` : ""}<div class="callout info mt12">${esc(r.note)}</div>`;
      $("#dMail", b).onclick = () => { location.href = `mailto:${encodeURIComponent(r.email || "")}?body=${encodeURIComponent($("#dBody", b).value)}`; };
      $("#dSms", b).onclick = () => { location.href = `sms:${encodeURIComponent(r.phone || "")}&body=${encodeURIComponent($("#dBody", b).value)}`; };
    };
    try { await load(false); } catch (e) { $(".mb", b).innerHTML = esc(e.message); }
    $("#dCopy", b).onclick = async () => { await navigator.clipboard.writeText($("#dBody", b).value); V.toast("Copied. Nothing was sent.", "ok"); };
    $("#dAi", b).onclick = async (e) => { if (!V.state.ai || !V.state.ai.ok) return V.aiHelp(); e.currentTarget.innerHTML = '<span class="spin"></span>'; try { await load(true); } catch (err) { V.toast(err.message, "err"); } e.currentTarget.innerHTML = V.icon("spark") + " Rewrite with Claude"; };
  };
})();
