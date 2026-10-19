/* One calendar for life, work and markets; week ahead; preparation mode. */
"use strict";
(function () {
  const esc = V.esc, $ = V.$, $$ = V.$$;
  const CATS = ["professional", "personal", "financial", "travel", "birthday", "market", "filing", "dividend", "follow-up", "decision", "milestone"];

  V.views.calendar = async function (page, rest) {
    const view = rest[0] || localStorage.getItem("vt_calview") || "week";
    const off = +(rest[1] || 0);
    const today = V.today();
    let start, end;
    if (view === "month") { start = new Date(today.getFullYear(), today.getMonth() + off, 1); end = new Date(start.getFullYear(), start.getMonth() + 1, 0); }
    else if (view === "agenda") { start = new Date(today); start.setDate(start.getDate() + off * 30); end = new Date(start); end.setDate(end.getDate() + 45); }
    else { start = new Date(today); start.setDate(start.getDate() + off * 8); end = new Date(start); end.setDate(end.getDate() + 7); }
    const gs = new Date(start), ge = new Date(end);
    if (view === "month") { gs.setDate(gs.getDate() - ((gs.getDay() + 6) % 7)); ge.setDate(ge.getDate() + (6 - ((ge.getDay() + 6) % 7))); }
    const [cal, wk] = await Promise.all([V.get(`/api/calendar?start=${V.iso(gs)}&end=${V.iso(ge)}`), view === "week" && off === 0 ? V.get("/api/week") : Promise.resolve(null)]);
    V.cache.cal = cal;
    const hidden = JSON.parse(localStorage.getItem("vt_calhide") || "[]");
    const evs = cal.events.filter((e) => !hidden.includes(e.category));
    const title = view === "month" ? start.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    page.innerHTML = `<div class="fade-in">
      <div class="ph"><div><div class="kicker">Calendar · CAL &lt;GO&gt; · personal · professional · financial</div><h1>${view === "week" && off === 0 ? "The week <em>ahead</em>" : esc(title)}</h1></div>
        <div class="actions"><div class="seg">${[["week", "Week ahead"], ["month", "Month"], ["agenda", "Agenda"]].map(([k, l]) => `<button data-view="${k}" class="${k === view ? "on" : ""}">${l}</button>`).join("")}</div>
          <button class="btn ghost" data-off="${off - 1}">‹</button><button class="btn ghost" data-off="0">Today</button><button class="btn ghost" data-off="${off + 1}">›</button>
          <button class="btn" id="subs">${V.icon("cal")} Calendars</button><button class="btn pri" id="addE">${V.icon("plus")} Event</button></div></div>
      <div class="row wrap gap6" style="margin-bottom:14px">${CATS.map((c) => `<button class="chip ${hidden.includes(c) ? "" : "on"}" data-cat="${c}"><span class="dot cat-${c}"></span>${c}</button>`).join("")}</div>
      ${wk ? weekSummary(wk) : ""}
      <div id="calBody"></div></div>`;
    const body = $("#calBody");
    if (view === "month") body.innerHTML = month(gs, ge, start, evs);
    else if (view === "agenda") body.innerHTML = agenda(evs);
    else body.innerHTML = week(start, evs, wk);
    $$("[data-view]").forEach((b) => (b.onclick = () => { localStorage.setItem("vt_calview", b.dataset.view); V.go("calendar/" + b.dataset.view); }));
    $$("[data-off]").forEach((b) => (b.onclick = () => V.go(`calendar/${view}/${b.dataset.off}`)));
    $$("[data-cat]").forEach((b) => (b.onclick = () => { const c = b.dataset.cat; const h = hidden.includes(c) ? hidden.filter((x) => x !== c) : hidden.concat([c]); localStorage.setItem("vt_calhide", JSON.stringify(h)); V.render(); }));
    $$("[data-ev]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); V.openPrep(b.dataset.ev); }));
    $$("[data-newday]").forEach((b) => (b.ondblclick = () => V.editEvent({ start: b.dataset.newday, all_day: true })));
    $("#addE").onclick = () => V.editEvent();
    $("#subs").onclick = () => subsModal(cal.subscriptions);
    const hideBd = localStorage.getItem("vt_calhide") && JSON.parse(localStorage.getItem("vt_calhide")).includes("birthday");
    if (!hideBd && V.store.records.contact.length > 400) { /* large address books: birthdays of unrated contacts are shown but de-emphasised in lists */ }
  };

  function weekSummary(wk) {
    const busy = wk.busiest ? V.parseDay(wk.busiest).toLocaleDateString(undefined, { weekday: "long" }) : null;
    return `<div class="grid g3" style="margin-bottom:16px">
      <div class="panel"><div class="panel-h"><h3>Shape of the week</h3>${V.lbl("calculated")}</div><div class="small">${busy ? `Most demanding day: <b>${busy}</b>. ` : "No overloaded days. "}${wk.conflicts ? `<span class="down">${wk.conflicts} conflict${wk.conflicts > 1 ? "s" : ""}</span> to resolve.` : "No conflicts."}</div>
        <div class="heat mt12">${wk.days.map((x) => { const d = V.parseDay(x.date); return `<div class="d" title="${x.hours}h scheduled"><div class="dn">${d.toLocaleDateString(undefined, { weekday: "narrow" })}</div><div class="dd" style="font-size:13px">${d.getDate()}</div><div class="ld"><b style="width:${Math.max(4, x.load * 100)}%;background:${x.load > .7 ? "var(--rose)" : x.load > .4 ? "var(--amber)" : "var(--ion)"}"></b></div></div>`; }).join("")}</div></div>
      <div class="panel"><div class="panel-h"><h3>Prepare in advance</h3></div><div class="list">${wk.prep.slice(0, 5).map((p) => `<div class="item clickable" data-ev="${esc(p.event.id)}"><span class="dot" style="background:${p.overdue ? "var(--rose)" : "var(--amber)"};margin-top:6px"></span><div class="grow small"><div class="ttl">${esc(p.what)}</div><div class="meta">start by ${V.parseDay(p.due).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</div></div></div>`).join("") || '<div class="small muted">Nothing needs advance prep.</div>'}</div></div>
      <div class="panel"><div class="panel-h"><h3>Market &amp; filing events</h3></div><div class="list">${wk.market.slice(0, 5).map((e) => `<div class="item small clickable" data-ev="${esc(e.id)}"><span class="dot cat-${esc(e.category)}" style="margin-top:6px"></span><div class="grow"><div class="ttl">${esc(e.title)}</div><div class="meta">${V.parseDay(e.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric" })} · ${esc(e.source)}</div></div></div>`).join("") || '<div class="small muted">No market events this week.</div>'}</div></div>
    </div>`;
  }

  const catColor = (c) => `var(--${{ professional: "blue", personal: "up", financial: "acc", market: "warn", travel: "violet", birthday: "pink", "follow-up": "down", decision: "violet", filing: "warn", milestone: "pink", dividend: "up" }[c] || "muted"})`;
  const evChip = (e, conf) => `<div class="ev ${conf ? "conf" : ""}" data-ev="${esc(e.id)}" style="border-left-color:${catColor(e.category)}"><div class="t">${V.evTime(e)}${e.estimated ? " · est." : ""}</div>${esc(e.title)}</div>`;

  function week(start, evs, wk) {
    const days = [];
    for (let i = 0; i < 8; i++) { const d = new Date(start); d.setDate(d.getDate() + i); days.push(d); }
    const todayIso = V.iso(V.today());
    return `<div class="week">${days.map((d) => {
      const iso = V.iso(d);
      const de = evs.filter((e) => e.start.slice(0, 10) === iso || (e.all_day && e.end && e.start.slice(0, 10) < iso && e.end.slice(0, 10) >= iso));
      const wd = wk && wk.days.find((x) => x.date === iso);
      const confTitles = new Set((wd ? wd.conflicts : []).flat());
      return `<div class="day ${iso === todayIso ? "today" : ""}" data-newday="${iso}"><div class="dh2"><span class="xs mono muted" style="letter-spacing:.12em">${d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}</span><span class="mono" style="font-size:18px">${d.getDate()}</span></div>
        ${wd ? `<div class="ld" style="height:3px;border-radius:3px;background:var(--line);overflow:hidden"><b style="display:block;height:100%;width:${Math.max(3, wd.load * 100)}%;background:${wd.load > .7 ? "var(--rose)" : wd.load > .4 ? "var(--amber)" : "var(--ion)"}"></b></div>` : ""}
        ${de.map((e) => evChip(e, confTitles.has(e.title))).join("") || '<div class="xs dim" style="margin-top:8px">Free</div>'}</div>`;
    }).join("")}</div><div class="help mt12">Double-click a day to add an event. Red outline = overlapping commitments.</div>`;
  }

  function month(gs, ge, start, evs) {
    const cells = [];
    for (let d = new Date(gs); d <= ge; d.setDate(d.getDate() + 1)) cells.push(new Date(d));
    const todayIso = V.iso(V.today());
    return `<div class="month">${["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((x) => `<div class="hd">${x}</div>`).join("")}${cells.map((d) => {
      const iso = V.iso(d);
      const de = evs.filter((e) => e.start.slice(0, 10) === iso);
      return `<div class="c ${d.getMonth() !== start.getMonth() ? "out" : ""} ${iso === todayIso ? "today" : ""}" data-newday="${iso}"><div class="n">${d.getDate()}</div>${de.slice(0, 4).map((e) => `<div class="e" data-ev="${esc(e.id)}" style="border-left-color:${catColor(e.category)}" title="${esc(e.title)}">${e.all_day ? "" : V.evTime(e) + " "}${esc(e.title)}</div>`).join("")}${de.length > 4 ? `<div class="xs dim">+${de.length - 4} more</div>` : ""}</div>`;
    }).join("")}</div>`;
  }

  function agenda(evs) {
    const by = {};
    evs.forEach((e) => (by[e.start.slice(0, 10)] = by[e.start.slice(0, 10)] || []).push(e));
    const keys = Object.keys(by).sort();
    return keys.length ? `<div class="panel">${keys.map((k) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="xs mono muted" style="letter-spacing:.12em">${V.parseDay(k).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}</div><div class="agenda">${by[k].map((e) => `<div class="ev clickable" data-ev="${esc(e.id)}"><span class="tm">${V.evTime(e)}</span><span class="bar cat-${esc(e.category)}"></span><div><div class="ttl">${esc(e.title)}</div><div class="meta">${esc(e.category)} · ${esc(e.source)}${e.location ? " · " + esc(e.location) : ""}</div></div></div>`).join("")}</div></div>`).join("")}</div>` : `<div class="panel"><div class="empty">Nothing in this range.</div></div>`;
  }

  V.editEvent = async function (rec) {
    rec = rec || {};
    const isNew = !rec.id;
    const contacts = (V.cache.cal && V.cache.cal.contacts) || (await V.get("/api/r/contact")).items.map((c) => ({ id: c.id, name: c.name }));
    const toLocal = (s) => (s && s.length > 10 ? s.slice(0, 16) : s ? s + "T09:00" : "");
    const b = V.modal(isNew ? "New event" : "Edit event", `<form class="form two">
      ${V.field("Title", "title", rec.title, { full: true })}
      <label class="f"><span>Starts</span><input class="in" type="datetime-local" name="start" value="${esc(toLocal(rec.start))}"></label>
      <label class="f"><span>Ends</span><input class="in" type="datetime-local" name="end" value="${esc(toLocal(rec.end))}"></label>
      <label class="row small full"><input type="checkbox" name="all_day" ${rec.all_day ? "checked" : ""}> All day</label>
      ${V.field("Category", "category", rec.category || "personal", { options: CATS.slice(0, 6) })}
      ${V.field("Repeats", "recur", rec.recur || "none", { options: [["none", "Doesn't repeat"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]] })}
      ${V.field("Location / city", "location", rec.location, { help: "Travel events with a city surface contacts who live there." })}
      ${V.field("Time zone (optional)", "tz", rec.tz, { ph: Intl.DateTimeFormat().resolvedOptions().timeZone })}
      <label class="f full"><span>People</span><select class="in" name="people" multiple size="5">${contacts.map((c) => `<option value="${c.id}" ${(rec.people || []).includes(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select><div class="help">Linking attendees powers preparation mode.</div></label>
      ${V.field("Importance", "importance", rec.importance || 2, { options: [[1, "Low"], [2, "Normal"], [3, "High"]] })}
      ${V.field("Notes", "notes", rec.notes, { area: true, full: true })}
    </form>`, `${isNew ? "" : '<button class="btn danger" id="dE" style="margin-right:auto">Delete</button>'}<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="sE">Save</button>`);
    $("#sE", b).onclick = async () => {
      const d = V.formData(b);
      d.people = Array.from($("[name=people]", b).selectedOptions).map((o) => o.value);
      d.importance = +d.importance;
      if (!d.title || !d.start) return V.toast("Title and start are required", "err");
      if (d.all_day) { d.start = d.start.slice(0, 10); d.end = d.end ? d.end.slice(0, 10) : null; }
      else { d.start = new Date(d.start).toISOString(); d.end = d.end ? new Date(d.end).toISOString() : null; }
      await V.try(() => (isNew ? V.post("/api/r/event", d) : V.put("/api/r/event/" + rec.id, d)), "Saved");
      V.closeOverlay(); V.render();
    };
    if (!isNew) $("#dE", b).onclick = async () => { if (await V.confirm("Delete this event (all occurrences)?", "Delete")) { await V.del("/api/r/event/" + rec.id); V.render(); } };
  };

  function subsModal(subs) {
    const b = V.modal("Connected calendars", `<p class="small muted">Subscribe to any calendar's secret iCal (ICS) link: Google Calendar (Settings → your calendar → <i>Secret address in iCal format</i>), iCloud (Share → Public Calendar), Outlook (Publish calendar → ICS). Read-only; refreshed every 30 minutes. The link is stored only in your private database and fetched through your own Worker.</p>
      <div class="list">${subs.map((s) => `<div class="item"><div class="grow"><div class="ttl small">${esc(s.name)}</div><div class="meta">${s.error ? `<span class="down">Error: ${esc(s.error)}</span>` : `${s.count} events · updated ${V.ago(s.fetched)}`}</div></div><button class="btn ghost xs" data-rs="${s.id}">Remove</button></div>`).join("") || '<div class="small muted">No calendars connected.</div>'}</div>
      <hr class="divider"><form class="form">${V.field("Name", "name", "", { ph: "Work (Google)" })}${V.field("ICS link", "url", "", { ph: "https://calendar.google.com/calendar/ical/…/basic.ics" })}${V.field("Category", "category", "professional", { options: CATS.slice(0, 4) })}</form><div class="err-msg" id="icsMsg"></div>`,
      `<button class="btn ghost" data-close>Close</button><button class="btn" id="tI">Test</button><button class="btn pri" id="aI">Connect</button>`);
    $$("[data-rs]", b).forEach((x) => (x.onclick = async () => { await V.del("/api/r/ics_sub/" + x.dataset.rs); V.closeOverlay(); V.render(); }));
    $("#tI", b).classList.add("hidden");
    $("#aI", b).onclick = async () => { const d = V.formData(b); if (!d.url) return; await V.try(() => V.post("/api/r/ics_sub", { name: d.name || "Calendar", url: d.url, category: d.category }), "Connected. Loading events…"); V.closeOverlay(); setTimeout(V.render, 2500); };
  }

  /* ---------- preparation mode ---------- */
  V.openPrep = async function (eid) {
    const box = V.drawer("Preparation", `<div class="loading"><span class="spin"></span></div>`, { kicker: "Preparation mode" });
    let b;
    try { b = await V.get("/api/prep/" + encodeURIComponent(eid)); } catch (e) { $(".db", box).innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const e = b.event;
    $(".dh h2", box).textContent = e.title;
    const when = e.all_day ? V.parseDay(e.start).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : new Date(e.start).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
    $(".db", box).innerHTML = `
      <div class="row wrap gap6"><span class="chip" style="cursor:default"><span class="dot cat-${esc(e.category)}"></span>${esc(e.category)}</span><span class="small">${esc(when)}</span>${e.location ? `<span class="small muted">· ${esc(e.location)}</span>` : ""}<span class="src">· ${esc(e.source)}</span>
        <span class="grow"></span>${e.rid ? `<button class="btn sm" id="edEv">Edit</button>` : ""}${e.url ? `<a class="btn sm" href="${esc(e.url)}" target="_blank" rel="noopener">Source ${V.icon("ext")}</a>` : ""}</div>
      ${e.notes ? `<div class="small muted mt12" style="white-space:pre-wrap">${esc(e.notes)}</div>` : ""}
      <div class="panel mt16"><div class="panel-h"><h3>What to prepare, and when</h3></div><div class="list">${b.checklist.map((c) => `<div class="item small"><span class="mono" style="width:96px;flex:none">${V.parseDay(c.when).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span><span>${esc(c.task)}</span></div>`).join("")}</div></div>
      ${b.people.length ? `<div class="panel mt16"><div class="panel-h"><h3>Who you're seeing</h3>${V.lbl("retrieved")}</div>${b.people.map((p) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="row"><div class="avatar" style="background:${V.color(p.name)}">${V.initials(p.name)}</div><div class="grow"><div class="ttl clickable" data-contact="${p.id}">${esc(p.name)}</div><div class="meta">${esc([p.role, p.org].filter(Boolean).join(" · "))}${p.how_met ? " · met: " + esc(p.how_met) : ""}</div></div></div>
        ${p.notes ? `<div class="small mt8">${esc(p.notes)}</div>` : ""}
        ${p.interactions.length ? `<div class="xs mono muted mt12">PREVIOUS CONVERSATIONS</div>${p.interactions.slice().reverse().map((i) => `<div class="small"><span class="mono muted">${esc(i.date)}</span> ${esc(i.type || "")}: ${esc(i.notes || "")}</div>`).join("")}` : ""}
        ${p.commitments.filter((c) => !c.done).length ? `<div class="xs mono muted mt12">OPEN PROMISES</div>${p.commitments.filter((c) => !c.done).map((c) => `<div class="small">• ${esc(c.text)}${c.due ? ` <span class="muted">(due ${esc(c.due)})</span>` : ""}</div>`).join("")}` : ""}</div>`).join("")}</div>` : ""}
      ${b.points.length ? `<div class="panel mt16"><div class="panel-h"><h3>Suggested discussion points</h3></div><div class="list">${b.points.map((p) => `<div class="item small"><div class="grow">${esc(p.text)}<div class="src">${esc(p.basis)}</div></div>${V.lbl(p.label)}</div>`).join("")}</div></div>` : ""}
      ${b.news.length ? `<div class="panel mt16"><div class="panel-h"><h3>Relevant developments</h3>${V.lbl("fact")}</div><div class="list">${b.news.map((n) => `<div class="item small"><div class="grow"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="src">${esc(n.source)} · ${V.time(n.published)} · ${esc(n.why)}</div></div></div>`).join("")}</div></div>` : ""}
      ${b.holdings.length ? `<div class="panel mt16"><div class="panel-h"><h3>Related holdings</h3></div>${b.holdings.map((h) => `<span class="chip" data-ref-kind="holding" data-ref-id="${h.id}">${esc(h.label)}</span>`).join(" ")}</div>` : ""}
      ${b.past.length ? `<div class="panel mt16"><div class="panel-h"><h3>Previous meetings</h3></div>${b.past.map((x) => `<div class="small"><span class="mono muted">${esc(x.start.slice(0, 10))}</span> ${esc(x.title)}</div>`).join("")}</div>` : ""}
      ${b.missing.length ? `<div class="callout mt16"><b>Missing information</b><ul>${b.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
      <div class="panel mt16"><div class="panel-h"><h3>Claude brief</h3>${V.lbl("ai")}<div class="tools"><button class="btn ai sm" id="prepAi">${V.icon("spark")} ${b.ai ? "Refresh" : "Write a brief"}</button></div></div><div id="prepAiBody">${b.ai ? V.md(b.ai.text) : '<div class="small muted">Turns the records above into an objective, talking points and questions.</div>'}</div></div>`;
    $$("[data-contact]", box).forEach((x) => (x.onclick = () => V.openContact(x.dataset.contact)));
    const ed = $("#edEv", box); if (ed) ed.onclick = async () => { const r = await V.get("/api/r/event/" + e.rid); V.editEvent(r); };
    $("#prepAi", box).onclick = async (ev) => {
      if (!V.state.ai || !V.state.ai.ok) return V.aiHelp();
      const btn = ev.currentTarget; btn.innerHTML = '<span class="spin"></span>'; btn.disabled = true;
      try { const r = await V.post(`/api/prep/${encodeURIComponent(eid)}/ai`); $("#prepAiBody", box).innerHTML = V.md(r.text); } catch (err) { V.toast(err.message, "err"); }
      btn.disabled = false; btn.innerHTML = V.icon("spark") + " Refresh";
    };
  };
})();
