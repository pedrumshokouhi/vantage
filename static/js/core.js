/* Vantage core: API client, formatting, router, shell, overlays, command palette, audio. */
"use strict";
const V = window.V = { views: {}, state: { space: "live" }, cache: {} };

/* ---------- utilities ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
V.esc = esc; V.$ = $; V.$$ = $$;

V.api = async function (path, opts = {}) {
  const o = { method: opts.method || (opts.body !== undefined ? "POST" : "GET"), headers: { "X-Vantage": "1" }, credentials: "same-origin" };
  if (opts.body !== undefined) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(opts.body); }
  const r = await fetch(path, o);
  let data = null;
  try { data = await r.json(); } catch (e) { data = {}; }
  if (r.status === 401 && !path.startsWith("/api/login") && !path.startsWith("/api/mfa") && !path.startsWith("/api/password") && !path.startsWith("/api/mfa/disable")) {
    V.boot(); throw new Error("Signed out");
  }
  if (!r.ok) { const e = new Error(data.error || ("HTTP " + r.status)); e.status = r.status; throw e; }
  return data;
};
V.get = (p) => V.api(p);
V.post = (p, body) => V.api(p, { body: body || {} });
V.put = (p, body) => V.api(p, { method: "PUT", body });
V.del = (p) => V.api(p, { method: "DELETE" });

const nf = (d, min = 0) => new Intl.NumberFormat(undefined, { maximumFractionDigits: d, minimumFractionDigits: min });
V.num = (x, d = 0) => (x == null || isNaN(x) ? "—" : nf(d, d).format(x));
V.money = (x, ccy, d) => {
  if (x == null || isNaN(x)) return "—";
  const a = Math.abs(x);
  const dd = d != null ? d : a >= 1000 ? 0 : 2;
  return (x < 0 ? "−" : "") + (ccy && ccy !== "CAD" && ccy !== "USD" ? ccy + " " : "$") + nf(dd, dd).format(a);
};
V.compact = (x) => {
  if (x == null || isNaN(x)) return "—";
  const a = Math.abs(x), s = x < 0 ? "−" : "";
  if (a >= 1e12) return s + (a / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return s + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + "M";
  if (a >= 1e4) return s + (a / 1e3).toFixed(1) + "K";
  return s + nf(0).format(a);
};
V.pct = (x, d = 1, sign = true) => (x == null || isNaN(x) ? "—" : (sign && x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x * 100).toFixed(d) + "%");
V.cls = (x) => (x == null ? "" : x > 0 ? "up" : x < 0 ? "down" : "");
V.dpct = (x, d = 1) => `<span class="delta ${V.cls(x)}">${V.pct(x, d)}</span>`;
V.ago = (ts) => {
  if (!ts) return "never";
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 86400 * 30) return Math.floor(s / 86400) + "d ago";
  return new Date(ts * 1000).toLocaleDateString();
};
V.time = (ts) => new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
V.dateLong = (d) => new Date(d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
V.today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
V.iso = (d) => { const z = new Date(d); return z.getFullYear() + "-" + String(z.getMonth() + 1).padStart(2, "0") + "-" + String(z.getDate()).padStart(2, "0"); };
V.parseDay = (s) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
V.evTime = (e) => (e.all_day ? "All day" : new Date(e.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
V.lbl = (kind, text) => `<span class="lbl ${esc(kind)}">${esc(text || kind)}</span>`;
V.fresh = (ts, maxAge) => {
  const stale = ts && Date.now() / 1000 - ts > (maxAge || 3600);
  return `<span class="fresh ${stale ? "stale" : ""}" title="${ts ? esc(new Date(ts * 1000).toLocaleString()) : ""}">${stale ? "⚠ " : "● "}${ts ? "as of " + V.ago(ts) : "no data yet"}</span>`;
};
V.initials = (n) => (n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
V.hue = (s) => { let h = 0; for (const c of String(s || "")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
V.color = (s) => `hsl(${V.hue(s)} 70% 68%)`;
V.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
V.md = (src) => {
  // Minimal, safe Markdown: escape first, then format.
  let s = esc(src || "");
  s = s.replace(/^### (.*)$/gm, "<h3>$1</h3>").replace(/^## (.*)$/gm, "<h2>$1</h2>").replace(/^# (.*)$/gm, "<h1>$1</h1>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\[ref:(\w+):(\w+)\]/g, '<span class="ref" data-ref-kind="$1" data-ref-id="$2">$1</span>');
  s = s.replace(/\[src:(\d+)\]/g, '<span class="ref">src $1</span>');
  s = s.replace(/^(?:- |\* )(.*)$/gm, "<li>$1</li>").replace(/(<li>.*<\/li>\n?)+/g, (m) => "<ul>" + m + "</ul>");
  s = s.replace(/^\d+\. (.*)$/gm, "<li>$1</li>");
  s = s.split(/\n{2,}/).map((p) => (/^<(h\d|ul|li)/.test(p) ? p : "<p>" + p.replace(/\n/g, "<br>") + "</p>")).join("");
  return `<div class="md">${s}</div>`;
};

/* ---------- icons (inline SVG, stroke) ---------- */
const P = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  brief: "M4 5h16M4 10h16M4 15h10M4 20h7",
  port: "M4 19V9M10 19V5M16 19v-7M22 19H2",
  lab: "M9 3h6M10 3v6L4 19a2 2 0 002 3h12a2 2 0 002-3l-6-10V3",
  cal: "M4 6h16v14H4zM4 10h16M9 3v5M15 3v5",
  net: "M12 12m-2.5 0a2.5 2.5 0 105 0 2.5 2.5 0 10-5 0M5 5m-2 0a2 2 0 104 0 2 2 0 10-4 0M19 6m-2 0a2 2 0 104 0 2 2 0 10-4 0M18 19m-2 0a2 2 0 104 0 2 2 0 10-4 0M6 18m-2 0a2 2 0 104 0 2 2 0 10-4 0M7 6.5l3.2 3.7M17.3 7.4l-3.4 3M16.4 17.6l-2.6-3.8M7.6 16.6l2.7-2.9",
  ask: "M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z",
  journal: "M6 3h11a2 2 0 012 2v16H6a2 2 0 01-2-2V5a2 2 0 012-2zM8 7h7M8 11h7",
  radar: "M12 12m-9 0a9 9 0 1018 0 9 9 0 10-18 0M12 12m-5 0a5 5 0 1010 0 5 5 0 10-10 0M12 12L19 5",
  filings: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  search: "M11 11m-7 0a7 7 0 1014 0 7 7 0 10-14 0M21 21l-5-5",
  play: "M7 4l13 8-13 8z", pause: "M7 4h4v16H7zM14 4h4v16h-4z", stop: "M6 6h12v12H6z",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 118 0v4",
  plus: "M12 5v14M5 12h14", refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7", spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  impact: "M4 12h4M10 6h4M10 18h4M16 12h4M8 12l2-6M8 12l2 6M14 6l2 6M14 18l2-6",
  ext: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6", down: "M12 4v12M6 10l6 6 6-6M4 20h16", up: "M12 20V8M6 14l6-6 6 6M4 4h16",
  check: "M5 12l5 5L20 7", eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0",
  headphones: "M4 15v-3a8 8 0 0116 0v3M4 15h3v6H5a1 1 0 01-1-1zM20 15h-3v6h2a1 1 0 001-1z",
  pin: "M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11zM12 10m-2.5 0a2.5 2.5 0 105 0 2.5 2.5 0 10-5 0",
};
V.icon = (n, cls = "") => `<svg class="${cls}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${P[n] || ""}"/></svg>`;

/* ---------- toasts ---------- */
V.toast = (msg, kind = "") => {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .4s"; setTimeout(() => t.remove(), 400); }, kind === "err" ? 6000 : 3200);
};
V.try = async (fn, okMsg) => {
  try { const r = await fn(); if (okMsg) V.toast(okMsg, "ok"); return r; } catch (e) { if (e.message !== "Signed out") V.toast(e.message, "err"); throw e; }
};

/* ---------- overlays ---------- */
V.overlay = function (kind, html, opts = {}) {
  V.closeOverlay();
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const box = document.createElement("div");
  box.className = kind + " " + (opts.cls || "");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.innerHTML = html;
  document.body.append(scrim, box);
  requestAnimationFrame(() => { scrim.classList.add("in"); box.classList.add("in"); });
  scrim.onclick = () => V.closeOverlay();
  $$("[data-close]", box).forEach((b) => (b.onclick = () => V.closeOverlay()));
  V._ov = { scrim, box, onClose: opts.onClose };
  const f = box.querySelector("input:not([type=hidden]),textarea,select");
  if (f && opts.focus !== false) setTimeout(() => f.focus(), 60);
  return box;
};
V.closeOverlay = function () {
  const o = V._ov;
  if (!o) return;
  V._ov = null;
  o.scrim.classList.remove("in"); o.box.classList.remove("in");
  setTimeout(() => { o.scrim.remove(); o.box.remove(); }, 250);
  if (o.onClose) o.onClose();
};
V.drawer = (title, body, opts = {}) => V.overlay("drawer", `<div class="dh">${opts.kicker ? `<div><div class="xs mono muted" style="letter-spacing:.14em;text-transform:uppercase">${esc(opts.kicker)}</div>` : "<div>"}<h2>${title}</h2></div>${opts.tools || ""}<button class="x" data-close aria-label="Close">×</button></div><div class="db">${body}</div>`, opts);
V.modal = (title, body, foot, opts = {}) => V.overlay("modal", `<div class="mh"><h3>${title}</h3><button class="x" data-close aria-label="Close">×</button></div><div class="mb">${body}</div>${foot ? `<div class="mf">${foot}</div>` : ""}`, opts);
V.confirm = (msg, yes = "Confirm") => new Promise((res) => {
  const b = V.modal("Are you sure?", `<p>${esc(msg)}</p>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="cfy">${esc(yes)}</button>`);
  $("#cfy", b).onclick = () => { V.closeOverlay(); res(true); };
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && V._ov) V.closeOverlay();
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && V.state.authed) { e.preventDefault(); V.palette(); }
  if (e.key === "/" && V.state.authed && !/input|textarea|select/i.test(document.activeElement.tagName) && !V._ov) { e.preventDefault(); V.palette(); }
});

/* ---------- forms ---------- */
V.formData = (root) => {
  const d = {};
  $$("[name]", root).forEach((el) => {
    const k = el.name;
    if (el.type === "checkbox") d[k] = el.checked;
    else if (el.dataset.type === "number") d[k] = el.value === "" ? null : Number(el.value);
    else if (el.dataset.type === "list") d[k] = el.value.split(",").map((s) => s.trim()).filter(Boolean);
    else d[k] = el.value.trim() === "" ? null : el.value.trim();
  });
  return d;
};
V.field = (label, name, val, opts = {}) => {
  const v = val == null ? "" : Array.isArray(val) ? val.join(", ") : val;
  const attrs = `name="${name}" ${opts.type === "number" ? 'data-type="number" type="number" step="any"' : `type="${opts.type || "text"}"`} ${opts.list ? 'data-type="list"' : ""} placeholder="${esc(opts.ph || "")}" ${opts.req ? "required" : ""}`;
  let input;
  if (opts.area) input = `<textarea class="in" name="${name}" ${opts.list ? 'data-type="list"' : ""} placeholder="${esc(opts.ph || "")}" rows="${opts.rows || 3}">${esc(v)}</textarea>`;
  else if (opts.options) input = `<select class="in" name="${name}">${opts.options.map((o) => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(v) ? "selected" : ""}>${esc(ol)}</option>`; }).join("")}</select>`;
  else input = `<input class="in" ${attrs} value="${esc(v)}">`;
  return `<label class="f ${opts.full ? "full" : ""}"><span>${esc(label)}</span>${input}${opts.help ? `<div class="help">${esc(opts.help)}</div>` : ""}</label>`;
};

/* ---------- router + shell ---------- */
const NAV = [
  ["home", "Today", "home"], ["brief", "Briefing", "brief"], ["radar", "Radar", "radar"], ["ask", "Chief of staff", "ask"],
  ["-", "Money"], ["portfolio", "Portfolio", "port"], ["lab", "Scenario lab", "lab"], ["filings", "Filings", "filings"],
  ["-", "Life"], ["calendar", "Calendar", "cal"], ["network", "Network", "net"], ["journal", "Journal", "journal"],
  ["-", "System"], ["settings", "Settings", "settings"],
];
V.route = () => (location.hash.replace(/^#\/?/, "") || "home").split("/");
V.go = (p) => { location.hash = "#/" + p; };

V.shell = function () {
  const s = V.state;
  const nav = NAV.map(([id, label, ic]) => id === "-" ? `<div class="nav-sec">${label}</div>` :
    `<a href="#/${id}" data-nav="${id}">${V.icon(ic)}<span>${label}</span>${id === "radar" ? '<span class="badge" id="radarBadge" style="display:none"></span>' : ""}</a>`).join("");
  $("#root").innerHTML = `
  <div class="shell">
    <aside class="rail">
      <div class="brand"><div class="mark"><i></i></div><div><div class="word">VANTAGE</div><div class="sub">COMMAND CENTER</div></div></div>
      <nav class="nav">${nav}</nav>
      <div class="rail-foot">
        <div class="row sp"><span class="muted small">${esc(s.user)}</span><button class="btn ghost xs" id="lockBtn" title="Sign out">${V.icon("lock")} Lock</button></div>
        ${s.prev_login ? `<div class="xs dim mt8" title="Previous sign-in">Last sign-in ${V.ago(s.prev_login)}${s.prev_login_ip ? " · " + esc(s.prev_login_ip) : ""}</div>` : ""}
      </div>
    </aside>
    <div class="main">
      ${s.space === "demo" ? `<div class="demo-banner">${V.lbl("demo", "Demo workspace")} <span class="long">Sample holdings, people, events and decisions are fictional. Prices, news and filings are live. Your real records live in <a href="#" id="toLive">LIVE</a>.</span><span class="short">Fictional sample data · live prices &amp; news</span></div>` : ""}
      <header class="top">
        <div class="search" id="openPalette">${V.icon("search")}<span class="ph-txt">Search, jump, or ask anything…</span><span class="kbd" style="margin-left:auto">⌘K</span></div>
        <div class="clocks" id="clocks"></div>
        <div class="leds" id="leds" title="Data freshness">…</div>
        <div class="space"><button data-space="live" class="${s.space === "live" ? "on" : ""}">LIVE</button><button data-space="demo" class="${s.space === "demo" ? "on demo" : ""}">DEMO</button></div>
      </header>
      <div class="page" id="page"></div>
    </div>
  </div>
  <nav class="mnav">${[["home", "Today", "home"], ["brief", "Brief", "brief"], ["portfolio", "Money", "port"], ["calendar", "Calendar", "cal"], ["network", "People", "net"], ["more", "More", "settings"]].map(([id, l, ic]) => `<a href="#/${id}" data-nav="${id}">${V.icon(ic)}${l}</a>`).join("")}</nav>`;
  document.body.classList.toggle("demo", s.space === "demo");
  $("#openPalette").onclick = () => V.palette();
  $("#lockBtn").onclick = async () => { await V.post("/api/logout"); V.boot(); };
  $$("[data-space]").forEach((b) => (b.onclick = () => V.switchSpace(b.dataset.space)));
  const tl = $("#toLive"); if (tl) tl.onclick = (e) => { e.preventDefault(); V.switchSpace("live"); };
  $("#leds").onclick = () => V.go("settings/integrations");
  V.tickClocks(); clearInterval(V._clk); V._clk = setInterval(V.tickClocks, 20000);
  V.refreshLeds();
};
V.switchSpace = async (sp) => {
  await V.post("/api/space", { space: sp });
  V.state.space = sp; V.cache = {};
  V.shell(); V.render();
};
V.tickClocks = () => {
  const el = $("#clocks"); if (!el) return;
  const zones = V.state.timezones && V.state.timezones.length ? V.state.timezones : ["America/Toronto", "America/New_York", "Europe/London"];
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  el.innerHTML = zones.filter((z) => z !== local).slice(0, 3).map((z) => {
    let t = ""; try { t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: z }); } catch (e) { return ""; }
    return `<span>${esc(z.split("/").pop().replace("_", " "))} <b>${t}</b></span>`;
  }).join("");
};
V.refreshLeds = async () => {
  try {
    const s = await V.get("/api/status");
    const now = Date.now() / 1000;
    const led = (name, x, max) => {
      const c = !x ? "off" : x.last_error && (!x.last_ok || x.last_try > x.last_ok) ? "err" : now - (x.last_ok || 0) > max ? "warn" : "ok";
      return `<span class="led ${c}" title="${esc(name)}: ${x && x.last_ok ? "updated " + V.ago(x.last_ok) : "no data"}${x && x.last_error ? " · last error: " + esc(x.last_error) : ""}"></span>`;
    };
    const src = s.sources;
    $("#leds").innerHTML = led("News", src.news, 3600) + led("Quotes", src.quotes, 3600) + led("Bank of Canada", src.boc, 86400 * 2) + led("SEC EDGAR", src.sec, 86400 * 2) +
      `<span class="led ${s.ai.ok ? "ok" : "off"}" title="Claude: ${s.ai.ok ? "connected" : "not connected"}"></span>`;
  } catch (e) { /* ignore */ }
  try {
    const r = await V.get("/api/radar");
    const n = r.alerts.filter((a) => a.score > 0.6).length;
    const b = $("#radarBadge"); if (b) { b.style.display = n ? "" : "none"; b.textContent = n; }
  } catch (e) { /* ignore */ }
};

V.render = async function () {
  if (!V.state.authed) return;
  const [name, ...rest] = V.route();
  $$("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === name || (name === "holding" && a.dataset.nav === "portfolio")));
  const page = $("#page");
  if (!page) return;
  const view = V.views[name] || V.views.home;
  page.innerHTML = `<div class="loading"><span class="spin"></span><span class="small">Loading…</span></div>`;
  window.scrollTo(0, 0);
  try { await view(page, rest); }
  catch (e) { if (e.message !== "Signed out") page.innerHTML = `<div class="empty"><b>Couldn't load this view</b>${esc(e.message)}</div>`; console.error(e); }
};
window.addEventListener("hashchange", () => { V.closeOverlay(); V.render(); });

/* ---------- command palette ---------- */
V.palette = function () {
  const jumps = NAV.filter((n) => n[0] !== "-").map(([id, l]) => ({ k: "Go to", label: l, go: id }));
  const asks = ["What am I overlooking this week?", "What changed in my portfolio's risk since last month?", "Prepare me for tomorrow's meeting", "Which recent developments challenge my investment assumptions?", "Who should I reconnect with before my trip?"].map((q) => ({ k: "Ask", label: q, ask: q }));
  const box = V.overlay("modal palette", `<input placeholder="Search records and news, jump to a page, or ask a question…" id="pq" autocomplete="off"><div class="res" id="pr"></div>`);
  let items = [], idx = 0;
  const draw = () => {
    $("#pr", box).innerHTML = items.map((it, i) => `<div class="r ${i === idx ? "on" : ""}" data-i="${i}"><span class="k">${esc(it.k)}</span><span class="grow ellipsis">${esc(it.label)}</span>${it.sub ? `<span class="xs dim ellipsis" style="max-width:40%">${esc(it.sub)}</span>` : ""}</div>`).join("") || `<div class="empty">No matches</div>`;
    $$(".r", box).forEach((r) => (r.onclick = () => pick(items[+r.dataset.i])));
  };
  const pick = (it) => {
    V.closeOverlay();
    if (!it) return;
    if (it.go) V.go(it.go);
    else if (it.ask) { V.state.pendingAsk = it.ask; V.go("ask"); if (V.route()[0] === "ask") V.render(); }
    else if (it.ref) V.openRef(it.ref.kind, it.ref.id, it.link);
  };
  const run = V.debounce(async (q) => {
    if (!q) { items = jumps.concat(asks); idx = 0; return draw(); }
    const ql = q.toLowerCase();
    const j = jumps.filter((x) => x.label.toLowerCase().includes(ql));
    let res = [];
    try { res = (await V.get("/api/search?q=" + encodeURIComponent(q))).results; } catch (e) { /* ignore */ }
    items = j.concat(res.map((r) => ({ k: r.kind, label: r.label, sub: r.snippet, ref: { kind: r.kind, id: r.id }, link: r.link })))
      .concat([{ k: "Ask", label: "Ask your chief of staff: “" + q + "”", ask: q }]);
    idx = 0; draw();
  }, 160);
  const inp = $("#pq", box);
  inp.oninput = () => run(inp.value.trim());
  inp.onkeydown = (e) => {
    if (e.key === "ArrowDown") { idx = Math.min(items.length - 1, idx + 1); draw(); e.preventDefault(); }
    if (e.key === "ArrowUp") { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
    if (e.key === "Enter") pick(items[idx]);
  };
  run("");
};

V.openRef = function (kind, id, link) {
  if (kind === "holding") return V.go("holding/" + id);
  if (kind === "contact") return V.openContact(id);
  if (kind === "decision") return V.go("journal/" + id);
  if (kind === "event") return V.go("calendar");
  if (kind === "news" || kind === "story") { if (link) window.open(link, "_blank", "noopener"); else V.go("brief"); return; }
  if (kind === "alert") return V.go("radar");
  if (kind === "investor") return V.go("filings");
  if (kind === "watch") return V.go("portfolio/watch");
  if (kind === "scenario") return V.go("lab");
  if (kind === "note" || kind === "plan") return V.go("settings/" + (kind === "plan" ? "profile" : "notes"));
};
document.addEventListener("click", (e) => {
  const r = e.target.closest("[data-ref-kind]");
  if (r) { e.preventDefault(); V.openRef(r.dataset.refKind, r.dataset.refId, r.dataset.link); }
});

/* ---------- audio briefing (Web Speech API, on-device) ---------- */
V.audio = {
  play(script, title) {
    if (!("speechSynthesis" in window)) return V.toast("Audio isn't supported in this browser.", "err");
    this.stop();
    const parts = script.filter(Boolean);
    let i = 0;
    const bar = document.createElement("div");
    bar.className = "audio-bar";
    bar.innerHTML = `<div class="wave">${[0, .2, .4, .1, .3].map((d) => `<i style="animation-delay:${d}s"></i>`).join("")}</div>
      <div class="now ellipsis" id="aNow">${esc(title || "Briefing")}</div>
      <select class="in" id="aRate" style="width:auto;padding:4px 26px 4px 8px;font-size:12px">${[0.9, 1, 1.15, 1.3, 1.5].map((r) => `<option ${r === (V.state.audioRate || 1.15) ? "selected" : ""}>${r}</option>`).join("")}</select>
      <button class="btn sm" id="aPause">${V.icon("pause")}</button><button class="btn sm" id="aStop">${V.icon("stop")}</button>`;
    document.body.appendChild(bar);
    this.bar = bar;
    const voices = speechSynthesis.getVoices();
    const pref = voices.find((v) => /Samantha|Daniel|Karen|Moira|Serena|Google UK English|Google US English/.test(v.name) && /^en/.test(v.lang)) || voices.find((v) => /^en/.test(v.lang));
    const speak = () => {
      if (i >= parts.length) return this.stop();
      const u = new SpeechSynthesisUtterance(parts[i]);
      if (pref) u.voice = pref;
      u.rate = +$("#aRate", bar).value;
      V.state.audioRate = u.rate;
      $("#aNow", bar).textContent = parts[i].slice(0, 90);
      u.onend = () => { i++; speak(); };
      speechSynthesis.speak(u);
    };
    $("#aPause", bar).onclick = () => { if (speechSynthesis.paused) { speechSynthesis.resume(); $("#aPause", bar).innerHTML = V.icon("pause"); } else { speechSynthesis.pause(); $("#aPause", bar).innerHTML = V.icon("play"); } };
    $("#aStop", bar).onclick = () => this.stop();
    speak();
  },
  stop() { if ("speechSynthesis" in window) speechSynthesis.cancel(); if (this.bar) { this.bar.remove(); this.bar = null; } },
};

/* ---------- auth screens ---------- */
V.authScreen = function (mode) {
  $("#root").innerHTML = `<div class="auth"><canvas id="authBg"></canvas>
    <div class="auth-card">
      <div class="brand"><div class="mark"><i></i></div></div>
      <h1>${mode === "setup" ? "Claim your <em style='color:var(--ion)'>Vantage</em>" : mode === "mfa" ? "Two-step check" : "Vantage"}</h1>
      <div class="tag">${mode === "setup" ? "One-time setup. Enter the code printed in the server console." : mode === "mfa" ? "Enter the 6-digit code from your authenticator, or a recovery code." : "Private command center. Authorised access only."}</div>
      <form id="authForm" class="form" autocomplete="on">
        ${mode === "setup" ? `${V.field("Setup code", "code", "", { ph: "XXXXXX-XXXXXX-XXXXXX" })}` : ""}
        ${mode !== "mfa" ? `
          <label class="f"><span>Username</span><input class="in" name="username" autocomplete="username" required autocapitalize="off" spellcheck="false"></label>
          <label class="f"><span>Password</span><input class="in" name="password" type="password" autocomplete="${mode === "setup" ? "new-password" : "current-password"}" required></label>` : `
          <label class="f"><span>Code</span><input class="in mono" name="code" inputmode="numeric" autocomplete="one-time-code" required style="font-size:20px;letter-spacing:.3em;text-align:center"></label>`}
        ${mode === "setup" ? `<div class="strength"><b id="stb" style="width:0"></b></div><div class="help" id="sth">At least 12 characters; a long passphrase is best.</div>` : ""}
        ${mode === "login" ? `<label class="row small muted"><input type="checkbox" name="remember"> Keep me signed in on this device for 30 days</label>` : ""}
        <div class="err-msg" id="authErr"></div>
        <button class="btn pri" type="submit" style="justify-content:center;padding:11px">${mode === "setup" ? "Create account" : mode === "mfa" ? "Verify" : "Sign in"}</button>
      </form>
      <div class="foot">ENCRYPTED SESSION · PBKDF2 · ${mode === "mfa" ? "TOTP" : "RATE-LIMITED"}</div>
    </div></div>`;
  V.authBg($("#authBg"));
  const f = $("#authForm");
  const pw = f.querySelector("[name=password]");
  if (mode === "setup" && pw) pw.oninput = () => {
    const v = pw.value; let sc = Math.min(1, v.length / 20);
    const cl = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((r) => r.test(v)).length;
    sc = Math.min(1, sc * 0.7 + cl * 0.08);
    $("#stb").style.width = sc * 100 + "%";
    $("#stb").style.background = sc < 0.5 ? "var(--rose)" : sc < 0.75 ? "var(--amber)" : "var(--green)";
  };
  setTimeout(() => { const i = f.querySelector("input"); if (i) i.focus(); }, 50);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = V.formData(f);
    $("#authErr").textContent = "";
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      if (mode === "setup") { await V.post("/api/setup", d); await V.post("/api/login", { username: d.username, password: d.password }); }
      else if (mode === "mfa") { await V.post("/api/mfa", d); }
      else { await V.post("/api/login", d); }
      V.boot();
    } catch (err) { $("#authErr").textContent = err.message; btn.disabled = false; }
  };
};
V.authBg = function (cv) {
  const ctx = cv.getContext("2d");
  let w, h, t = 0;
  const pts = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, r: 80 + Math.random() * 520, s: (Math.random() - 0.5) * 0.0016, z: Math.random() }));
  const size = () => { const dpr = Math.min(2, devicePixelRatio || 1); w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  size(); window.addEventListener("resize", size);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frame = () => {
    if (!document.body.contains(cv)) return;
    t += 1; ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    for (let i = 1; i <= 5; i++) { ctx.beginPath(); ctx.arc(cx, cy, i * 110, 0, Math.PI * 2); ctx.strokeStyle = `rgba(148,170,200,${0.07 - i * 0.008})`; ctx.lineWidth = 1; ctx.stroke(); }
    const sweep = (t * 0.008) % (Math.PI * 2);
    const g = ctx.createConicGradient ? ctx.createConicGradient(sweep, cx, cy) : null;
    if (g) { g.addColorStop(0, "rgba(94,234,212,0.16)"); g.addColorStop(0.08, "rgba(94,234,212,0)"); g.addColorStop(1, "rgba(94,234,212,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 600, 0, Math.PI * 2); ctx.fill(); }
    for (const p of pts) {
      p.a += reduce ? 0 : p.s;
      const x = cx + Math.cos(p.a) * p.r, y = cy + Math.sin(p.a) * p.r * 0.62;
      const d = Math.abs(((p.a - sweep) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
      const lit = d > Math.PI * 1.85 ? 1 : 0.25;
      ctx.beginPath(); ctx.arc(x, y, 1 + p.z * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(94,234,212,${0.15 + lit * 0.6 * p.z})`; ctx.fill();
    }
    if (!reduce) requestAnimationFrame(frame);
  };
  frame();
};

/* ---------- boot ---------- */
V.boot = async function () {
  let st;
  try { st = await (await fetch("/api/state", { credentials: "same-origin" })).json(); }
  catch (e) { $("#root").innerHTML = `<div class="empty"><b>Can't reach the Vantage server</b>Is it running? <code>python3 vantage.py</code></div>`; return; }
  V.state.authed = st.authed;
  V.audio.stop();
  if (st.setup_needed) return V.authScreen("setup");
  if (st.mfa_pending) return V.authScreen("mfa");
  if (!st.authed) return V.authScreen("login");
  Object.assign(V.state, st);
  try { const s = await V.get("/api/settings"); V.state.settings = s; V.state.timezones = s.timezones; } catch (e) { /* ignore */ }
  V.shell();
  V.render();
  clearInterval(V._led); V._led = setInterval(V.refreshLeds, 120000);
};
