/* Vantage core: transport (network + in-browser engine routes), formatting, shell, command bar, overlays, audio. */
"use strict";
const V = (window.V = { views: {}, state: { space: "live" }, cache: {}, local: [] });
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
V.esc = esc; V.$ = $; V.$$ = $$;
try { const t = localStorage.getItem("vt_theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }

/* ---------- transport ---------- */
// Engine routes are computed in the browser from synced data; everything else goes to the Worker.
V.handle = (method, pattern, fn) => V.local.push([method, new RegExp("^" + pattern + "$"), fn]);
async function net(path, opts = {}) {
  const o = { method: opts.method || (opts.body !== undefined ? "POST" : "GET"), headers: { "X-Vantage": "1" }, credentials: "same-origin" };
  if (opts.body !== undefined) { o.headers["Content-Type"] = "application/json"; o.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body); }
  const r = await fetch(path, o);
  let data = null;
  const ct = r.headers.get("Content-Type") || "";
  if (opts.raw) { if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { status: r.status }); return r; }
  data = ct.includes("json") ? await r.json().catch(() => ({})) : await r.text();
  if (r.status === 401 && !/^\/api\/(login|mfa|password|mfa\/disable)/.test(path)) { location.href = "/login"; throw new Error("Signed out"); }
  if (!r.ok) { const e = new Error((data && data.error) || "HTTP " + r.status); e.status = r.status; throw e; }
  return data;
}
V.net = net;
V.api = async function (path, opts = {}) {
  const method = opts.method || (opts.body !== undefined ? "POST" : "GET");
  const u = new URL(path, location.origin);
  for (const [m, rx, fn] of V.local) {
    if (m !== method) continue;
    const mt = u.pathname.match(rx);
    if (mt) return fn({ q: Object.fromEntries(u.searchParams), body: opts.body }, ...mt.slice(1));
  }
  const out = await net(path, opts);
  // keep the in-browser store in step with record writes
  const rm = u.pathname.match(/^\/api\/r\/(\w+)(?:\/([\w-]+))?$/);
  if (rm && V.store) {
    if (method === "POST" || method === "PUT") V.store.upsert(rm[1], out);
    if (method === "DELETE") V.store.remove(rm[1], rm[2]);
  }
  return out;
};
V.get = (p) => V.api(p);
V.post = (p, body) => V.api(p, { body: body || {} });
V.put = (p, body) => V.api(p, { method: "PUT", body });
V.del = (p) => V.api(p, { method: "DELETE" });

/* ---------- formatting ---------- */
const nf = (d, min = 0) => new Intl.NumberFormat(undefined, { maximumFractionDigits: d, minimumFractionDigits: min });
V.num = (x, d = 0) => (x == null || isNaN(x) ? "—" : nf(d, d).format(x));
V.money = (x, ccy, d) => {
  if (x == null || isNaN(x)) return "—";
  const a = Math.abs(x), dd = d != null ? d : a >= 1000 ? 0 : 2;
  return (x < 0 ? "−" : "") + (ccy && !["CAD", "USD"].includes(ccy) ? ccy + " " : "$") + nf(dd, dd).format(a);
};
V.compact = (x) => {
  if (x == null || isNaN(x)) return "—";
  const a = Math.abs(x), s = x < 0 ? "−" : "";
  if (a >= 1e12) return s + (a / 1e12).toFixed(2) + "T"; if (a >= 1e9) return s + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + "M"; if (a >= 1e4) return s + (a / 1e3).toFixed(1) + "K";
  return s + nf(0).format(a);
};
V.pct = (x, d = 1, sign = true) => (x == null || isNaN(x) ? "—" : (sign && x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x * 100).toFixed(d) + "%");
V.bp = (x) => (x == null || isNaN(x) ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(Math.round(x * 100)) + " bp");
V.cls = (x) => (x == null ? "" : x > 0 ? "up" : x < 0 ? "down" : "");
V.dpct = (x, d = 1) => `<span class="delta ${V.cls(x)}">${V.pct(x, d)}</span>`;
V.ago = (ts) => {
  if (!ts) return "never";
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 86400 * 30) return Math.floor(s / 86400) + "d ago";
  return new Date(ts * 1000).toLocaleDateString();
};
V.time = (ts) => new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
V.dateLong = (d) => new Date(d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
V.today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
V.iso = (d) => { const z = new Date(d); return z.getFullYear() + "-" + String(z.getMonth() + 1).padStart(2, "0") + "-" + String(z.getDate()).padStart(2, "0"); };
V.parseDay = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
V.evTime = (e) => (e.all_day ? "All day" : new Date(e.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
V.lbl = (kind, text) => `<span class="lbl ${esc(kind)}">${esc(text || kind)}</span>`;
V.fresh = (ts, maxAge) => {
  const stale = ts && Date.now() / 1000 - ts > (maxAge || 3600);
  return `<span class="fresh ${stale ? "stale" : ""}" title="${ts ? esc(new Date(ts * 1000).toLocaleString()) : ""}">${stale ? "⚠" : "●"} ${ts ? V.ago(ts) : "no data yet"}</span>`;
};
V.initials = (n) => (n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
V.hue = (s) => { let h = 0; for (const c of String(s || "")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
V.color = (s) => `hsl(${V.hue(s)} 62% ${document.documentElement.dataset.theme === "dark" ? 62 : 46}%)`;
V.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
V.md = (src) => {
  let s = esc(src || "");
  s = s.replace(/^### (.*)$/gm, "<h3>$1</h3>").replace(/^## (.*)$/gm, "<h2>$1</h2>").replace(/^# (.*)$/gm, "<h1>$1</h1>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\[ref:(\w+):([\w-]+)\]/g, '<span class="ref" data-ref-kind="$1" data-ref-id="$2">$1</span>').replace(/\[src:(\d+)\]/g, '<span class="ref">src $1</span>');
  s = s.replace(/^(?:- |\* )(.*)$/gm, "<li>$1</li>").replace(/(<li>.*<\/li>\n?)+/g, (m) => "<ul>" + m + "</ul>").replace(/^\d+\. (.*)$/gm, "<li>$1</li>");
  s = s.split(/\n{2,}/).map((p) => (/^<(h\d|ul|li)/.test(p) ? p : "<p>" + p.replace(/\n/g, "<br>") + "</p>")).join("");
  return `<div class="md">${s}</div>`;
};
V.hexOf = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
V.derive = async (password, saltHex, iterations) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return V.hexOf(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
};

/* ---------- icons ---------- */
const P = {
  home: "M3 11l9-8 9 8M5 10v10h14V10", brief: "M4 5h16M4 10h16M4 15h10M4 20h7", port: "M4 19V9M10 19V5M16 19v-7M22 19H2",
  lab: "M9 3h6M10 3v6L4 19a2 2 0 002 3h12a2 2 0 002-3l-6-10V3", cal: "M4 6h16v14H4zM4 10h16M9 3v5M15 3v5",
  net: "M12 12m-2.5 0a2.5 2.5 0 105 0 2.5 2.5 0 10-5 0M5 5m-2 0a2 2 0 104 0 2 2 0 10-4 0M19 6m-2 0a2 2 0 104 0 2 2 0 10-4 0M18 19m-2 0a2 2 0 104 0 2 2 0 10-4 0M6 18m-2 0a2 2 0 104 0 2 2 0 10-4 0M7 6.5l3.2 3.7M17.3 7.4l-3.4 3M16.4 17.6l-2.6-3.8M7.6 16.6l2.7-2.9",
  ask: "M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z", journal: "M6 3h11a2 2 0 012 2v16H6a2 2 0 01-2-2V5a2 2 0 012-2zM8 7h7M8 11h7",
  radar: "M12 12m-9 0a9 9 0 1018 0 9 9 0 10-18 0M12 12m-5 0a5 5 0 1010 0 5 5 0 10-10 0M12 12L19 5",
  filings: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  search: "M11 11m-7 0a7 7 0 1014 0 7 7 0 10-14 0M21 21l-5-5", play: "M7 4l13 8-13 8z", pause: "M7 4h4v16H7zM14 4h4v16h-4z", stop: "M6 6h12v12H6z",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 118 0v4", plus: "M12 5v14M5 12h14", refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  impact: "M4 12h4M10 6h4M10 18h4M16 12h4M8 12l2-6M8 12l2 6M14 6l2 6M14 18l2-6", ext: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  down: "M12 4v12M6 10l6 6 6-6M4 20h16", up: "M12 20V8M6 14l6-6 6 6M4 4h16", check: "M5 12l5 5L20 7",
  headphones: "M4 15v-3a8 8 0 0116 0v3M4 15h3v6H5a1 1 0 01-1-1zM20 15h-3v6h2a1 1 0 001-1z",
  rates: "M4 18c4-1 6-10 16-12M4 6h4M16 18h4", oil: "M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z",
  globe: "M12 12m-9 0a9 9 0 1018 0 9 9 0 10-18 0M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
  macro: "M4 19h16M6 15l4-4 3 3 5-6", sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 12m-4 0a4 4 0 108 0 4 4 0 10-8 0",
  moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z", bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
};
V.icon = (n, cls = "") => `<svg class="${cls}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${P[n] || ""}"/></svg>`;

/* ---------- toasts & overlays ---------- */
V.toast = (msg, kind = "") => {
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .4s"; setTimeout(() => t.remove(), 400); }, kind === "err" ? 6000 : 3000);
};
V.try = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) V.toast(okMsg, "ok"); return r; } catch (e) { if (e.message !== "Signed out") V.toast(e.message, "err"); throw e; } };
V.overlay = function (kind, html, opts = {}) {
  V.closeOverlay();
  const scrim = document.createElement("div"); scrim.className = "scrim";
  const box = document.createElement("div"); box.className = kind + " " + (opts.cls || ""); box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
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
  const o = V._ov; if (!o) return; V._ov = null;
  o.scrim.classList.remove("in"); o.box.classList.remove("in");
  setTimeout(() => { o.scrim.remove(); o.box.remove(); }, 220);
  if (o.onClose) o.onClose();
};
V.drawer = (title, body, opts = {}) => V.overlay("drawer", `<div class="dh"><div>${opts.kicker ? `<div class="kicker">${esc(opts.kicker)}</div>` : ""}<h2>${title}</h2></div>${opts.tools || ""}<button class="x" data-close aria-label="Close">×</button></div><div class="db">${body}</div>`, opts);
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
    else if (el.multiple) d[k] = Array.from(el.selectedOptions).map((o) => o.value);
    else d[k] = el.value.trim() === "" ? null : el.value.trim();
  });
  return d;
};
V.field = (label, name, val, opts = {}) => {
  const v = val == null ? "" : Array.isArray(val) ? val.join(", ") : val;
  const attrs = `name="${name}" ${opts.type === "number" ? 'data-type="number" type="number" step="any"' : `type="${opts.type || "text"}"`} ${opts.list ? 'data-type="list"' : ""} placeholder="${esc(opts.ph || "")}"`;
  let input;
  if (opts.area) input = `<textarea class="in" name="${name}" ${opts.list ? 'data-type="list"' : ""} placeholder="${esc(opts.ph || "")}" rows="${opts.rows || 3}">${esc(v)}</textarea>`;
  else if (opts.options) input = `<select class="in" name="${name}">${opts.options.map((o) => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(v) ? "selected" : ""}>${esc(ol)}</option>`; }).join("")}</select>`;
  else input = `<input class="in" ${attrs} value="${esc(v)}">`;
  return `<label class="f ${opts.full ? "full" : ""}"><span>${esc(label)}</span>${input}${opts.help ? `<div class="help">${esc(opts.help)}</div>` : ""}</label>`;
};

/* ---------- navigation ---------- */
const NAV = [
  ["home", "Today", "home", "TOP"], ["brief", "Briefing", "brief", "N"], ["radar", "Radar", "radar", "ALRT"], ["ask", "Chief of staff", "ask", "ASK"],
  ["-", "Markets"], ["rates", "Rates", "rates", "RATE"], ["oil", "Energy & oil", "oil", "OIL"], ["macro", "Macro & markets", "macro", "ECO"], ["world", "World tracker", "globe", "WRLD"],
  ["-", "Money"], ["portfolio", "Portfolio", "port", "PORT"], ["lab", "Scenario lab", "lab", "SCEN"], ["filings", "Filings", "filings", "13F"],
  ["-", "Life"], ["calendar", "Calendar", "cal", "CAL"], ["network", "Network", "net", "PPL"], ["journal", "Journal", "journal", "JRNL"],
  ["-", "System"], ["settings", "Settings", "settings", "SET"],
];
V.NAV = NAV;
V.route = () => (location.hash.replace(/^#\/?/, "") || "home").split("/");
V.go = (p) => { location.hash = "#/" + p; };

V.shell = function () {
  const s = V.state;
  const nav = NAV.map(([id, label, ic, code]) => id === "-" ? `<div class="nav-sec">${label}</div>` :
    `<a href="#/${id}" data-nav="${id}">${V.icon(ic)}<span>${label}</span>${id === "radar" ? '<span class="badge" id="radarBadge" style="display:none"></span>' : `<span class="code">${code}</span>`}</a>`).join("");
  $("#root").innerHTML = `
  <div class="tape" id="tape"><div class="brand"><i></i>VANTAGE</div><div class="track"><div class="run" id="tapeRun"></div></div><div class="right" id="clocks"></div></div>
  <div class="shell">
    <aside class="rail">
      <div class="logo"><div class="mk"></div><div><div class="w">VANTAGE</div><div class="s">PERSONAL TERMINAL</div></div></div>
      <nav class="nav">${nav}</nav>
      <div class="rail-foot">
        <div class="row sp"><span class="muted small">${esc(s.user)}</span><button class="btn ghost xs" id="lockBtn" title="Sign out">${V.icon("lock")} Lock</button></div>
        ${s.prev_login ? `<div class="xs dim mt8">Previous sign-in ${V.ago(s.prev_login)}${s.prev_ip ? " · " + esc(s.prev_ip) : ""}</div>` : ""}
      </div>
    </aside>
    <div class="main">
      ${s.space === "demo" ? `<div class="demo-banner">${V.lbl("demo", "Demo workspace")} <span class="long">Sample holdings, people, events and decisions are fictional. Prices, news, rates and world data are live. Your records are in <a href="#" id="toLive">LIVE</a>.</span><span class="short">Fictional sample data · live markets</span></div>` : ""}
      <header class="top">
        <div class="cmd" id="openPalette"><span class="pr">&gt;</span><span class="ellipsis">Command, ticker or question — try OIL, RATES, HORMUZ, AAPL</span><span class="go">GO</span></div>
        <div class="status" id="engineStatus" title="Data engine">…</div>
        <button class="iconbtn" id="themeBtn" title="Light / dark">${V.icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon")}</button>
        <div class="seg-space"><button data-space="live" class="${s.space === "live" ? "on" : ""}">LIVE</button><button data-space="demo" class="${s.space === "demo" ? "on demo" : ""}">DEMO</button></div>
      </header>
      <div class="page" id="page"></div>
    </div>
  </div>
  <nav class="mnav">${[["home", "Today", "home"], ["brief", "News", "brief"], ["portfolio", "Money", "port"], ["world", "World", "globe"], ["rates", "Rates", "rates"], ["more", "More", "settings"]].map(([id, l, ic]) => `<a href="#/${id}" data-nav="${id}">${V.icon(ic)}${l}</a>`).join("")}</nav>`;
  document.body.classList.toggle("demo", s.space === "demo");
  $("#openPalette").onclick = () => V.palette();
  $("#lockBtn").onclick = async () => { await V.net("/api/logout", { body: {} }); location.href = "/login"; };
  $$("[data-space]").forEach((b) => (b.onclick = () => V.switchSpace(b.dataset.space)));
  const tl = $("#toLive"); if (tl) tl.onclick = (e) => { e.preventDefault(); V.switchSpace("live"); };
  $("#engineStatus").onclick = () => V.go("settings/engine");
  $("#themeBtn").onclick = () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("vt_theme", dark ? "dark" : "light"); } catch (e) { /* ignore */ }
    $("#themeBtn").innerHTML = V.icon(dark ? "sun" : "moon");
    V.render();
  };
  V.tickClocks(); clearInterval(V._clk); V._clk = setInterval(V.tickClocks, 20000);
  V.drawTape(); V.drawEngine();
};
V.switchSpace = async (sp) => {
  await V.net("/api/space", { body: { space: sp } });
  V.state.space = sp; V.cache = {};
  const page = $("#page"); if (page) page.innerHTML = `<div class="loading"><span class="spin"></span>Switching workspace…</div>`;
  await V.store.boot(true);
  V.shell(); V.render();
};
V.tickClocks = () => {
  const el = $("#clocks"); if (!el) return;
  const zones = (V.store && V.store.settings.timezones) || ["America/Toronto", "America/New_York", "Europe/London", "Asia/Dubai"];
  el.innerHTML = zones.slice(0, 4).map((z) => { let t = ""; try { t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: z }); } catch (e) { return ""; } return `<span>${esc(z.split("/").pop().replace("_", " ").toUpperCase().slice(0, 3))} <b>${t}</b></span>`; }).join("");
};
V.drawTape = () => {
  const el = $("#tapeRun"); if (!el || !V.store) return;
  const items = [["^GSPC", "S&P 500"], ["^GSPTSE", "TSX"], ["^IXIC", "NASDAQ"], ["^TNX", "US 10Y"], ["CL=F", "WTI"], ["BZ=F", "BRENT"], ["NG=F", "NAT GAS"], ["GC=F", "GOLD"], ["HG=F", "COPPER"], ["CADUSD=X", "CAD/USD"], ["DX-Y.NYB", "DXY"], ["^VIX", "VIX"], ["BTC-USD", "BTC"]];
  const html = items.map(([t, n]) => {
    const q = V.store.quote(t); if (!q || q.p == null) return "";
    const ch = q.pc ? q.p / q.pc - 1 : null;
    const val = t === "^TNX" ? q.p.toFixed(2) + "%" : t === "CADUSD=X" ? q.p.toFixed(4) : V.num(q.p, q.p < 100 ? 2 : 0);
    const roll = V.store.rollSuspect(t);
    return `<span class="it" data-tk="${esc(t)}"><span class="n">${n}</span><b>${val}</b><span class="${roll ? "n" : ch > 0 ? "u" : ch < 0 ? "d" : ""}" ${roll ? 'title="Probable futures contract roll, not a real move"' : ""}>${ch == null ? "" : (ch > 0 ? "▲" : "▼") + Math.abs(ch * 100).toFixed(2) + "%" + (roll ? " roll?" : "")}</span></span>`;
  }).join("");
  el.innerHTML = html + html; // doubled for a seamless loop
  $$("[data-tk]", el).forEach((x) => (x.onclick = () => V.openIndicator(V.kb.tickerIndicator(x.dataset.tk) || x.dataset.tk)));
};
V.drawEngine = () => {
  const el = $("#engineStatus"); if (!el || !V.store) return;
  const e = V.store.engine || {};
  const age = e.last ? Date.now() / 1000 - e.last : null;
  const cls = age == null ? "off" : age < 900 ? "ok pulse" : age < 3600 ? "warn" : "err";
  el.innerHTML = `<span class="led ${cls}"></span><span>ENGINE ${age == null ? "idle" : V.ago(e.last).replace(" ago", "")}</span>`;
  el.title = age == null ? "The data engine hasn't run yet" : `Last engine tick ${V.ago(e.last)}. Runs every 5 minutes on Cloudflare.`;
  const n = (V.store.alerts || []).filter((a) => a.score > 0.6).length, b = $("#radarBadge");
  if (b) { b.style.display = n ? "" : "none"; b.textContent = n; }
};

V.render = async function () {
  if (!V.state.authed) return;
  const [name, ...rest] = V.route();
  $$("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === name || (name === "holding" && a.dataset.nav === "portfolio")));
  const page = $("#page"); if (!page) return;
  const view = V.views[name] || V.views.home;
  page.innerHTML = `<div class="loading"><span class="spin"></span><span class="small">Loading…</span></div>`;
  window.scrollTo(0, 0);
  try { await view(page, rest); }
  catch (e) { if (e.message !== "Signed out") page.innerHTML = `<div class="empty"><b>Couldn't load this view</b>${esc(e.message)}</div>`; console.error(e); }
  // browsers freeze CSS animations in background tabs, which would leave a re-rendered page at opacity 0
  if (document.hidden) $$(".fade-in", page).forEach((el) => el.classList.add("static"));
};
window.addEventListener("hashchange", () => { V.closeOverlay(); V.render(); });

/* ---------- command bar (Bloomberg-style mnemonics) ---------- */
V.palette = function () {
  const jumps = NAV.filter((n) => n[0] !== "-").map(([id, l, , code]) => ({ k: "Go", code, label: l, go: id }));
  const extra = [["HORMUZ", "World · Strait of Hormuz", "world/hormuz"], ["REDSEA", "World · Red Sea", "world/redsea"], ["TAIWAN", "World · Taiwan Strait", "world/taiwan"],
    ["WTI", "Energy · WTI crude", "ind:wti"], ["BRENT", "Energy · Brent crude", "ind:brent"], ["CURVE", "Rates · yield curves", "rates"], ["10Y", "Rates · US 10-year", "ind:us_10y"],
    ["BOC", "Rates · Bank of Canada", "ind:boc_policy"], ["MORT", "Rates · mortgage calculator", "rates"], ["RISK", "Portfolio · risk & factors", "portfolio/risk"], ["CORR", "Portfolio · correlations", "portfolio/risk"],
    ["DIV", "Portfolio · dividend income", "portfolio/income"], ["NEWS", "Briefing", "brief"]].map(([code, label, go]) => ({ k: "Go", code, label, go }));
  const asks = ["What am I overlooking this week?", "What changed in my portfolio's risk since last month?", "Prepare me for tomorrow's meeting", "Which recent developments challenge my investment assumptions?", "Who should I reconnect with before my trip?"].map((q) => ({ k: "Ask", label: q, ask: q }));
  const box = V.overlay("modal palette", `<div class="pin"><span class="pr">&gt;</span><input placeholder="Command (OIL, RATES, HORMUZ), ticker (AAPL), person, or a question…" id="pq" autocomplete="off" spellcheck="false"></div><div class="res" id="pr"></div><div class="hint"><span>↑↓ navigate</span><span>↵ GO</span><span>ESC close</span><span>Tickers open their holding or indicator</span></div>`);
  let items = [], idx = 0;
  const draw = () => {
    $("#pr", box).innerHTML = items.map((it, i) => `<div class="r ${i === idx ? "on" : ""}" data-i="${i}">${it.code ? `<span class="code">${esc(it.code)}</span>` : `<span class="k">${esc(it.k)}</span>`}<span class="grow ellipsis">${esc(it.label)}</span>${it.sub ? `<span class="xs dim ellipsis" style="max-width:40%">${esc(it.sub)}</span>` : ""}</div>`).join("") || `<div class="empty">No matches</div>`;
    $$(".r", box).forEach((r) => (r.onclick = () => pick(items[+r.dataset.i])));
  };
  const pick = (it) => {
    V.closeOverlay(); if (!it) return;
    if (it.go && it.go.startsWith("ind:")) return V.openIndicator(it.go.slice(4));
    if (it.go) return V.go(it.go);
    if (it.ticker) return V.openTicker(it.ticker);
    if (it.ask) { V.state.pendingAsk = it.ask; if (V.route()[0] === "ask") V.render(); else V.go("ask"); return; }
    if (it.ref) V.openRef(it.ref.kind, it.ref.id, it.link);
  };
  const run = V.debounce(async (q) => {
    if (!q) { items = jumps.concat(extra, asks); idx = 0; return draw(); }
    const qu = q.toUpperCase(), ql = q.toLowerCase();
    const codes = jumps.concat(extra).filter((x) => x.code.startsWith(qu) || x.label.toLowerCase().includes(ql));
    const tick = /^[A-Z0-9.\-=^]{1,10}$/i.test(q) ? [{ k: "Ticker", code: qu, label: "Open " + qu, ticker: qu }] : [];
    let res = [];
    try { res = (await V.get("/api/search?q=" + encodeURIComponent(q))).results; } catch (e) { /* ignore */ }
    items = codes.concat(tick, res.map((r) => ({ k: r.kind, label: r.label, sub: r.snippet, ref: { kind: r.kind, id: r.id }, link: r.link })), [{ k: "Ask", label: "Ask your chief of staff: “" + q + "”", ask: q }]);
    idx = 0; draw();
  }, 120);
  const inp = $("#pq", box);
  inp.oninput = () => run(inp.value.trim());
  inp.onkeydown = (e) => {
    if (e.key === "ArrowDown") { idx = Math.min(items.length - 1, idx + 1); draw(); e.preventDefault(); }
    if (e.key === "ArrowUp") { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
    if (e.key === "Enter") pick(items[idx]);
  };
  run("");
};
V.openTicker = (t) => {
  const h = V.store.records.holding.find((x) => (x.ticker || "").toUpperCase() === t.toUpperCase());
  if (h) return V.go("holding/" + h.id);
  const ind = V.kb.tickerIndicator(t);
  if (ind) return V.openIndicator(ind);
  V.openIndicator(t.toUpperCase());
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
  if (kind === "hotspot") return V.go("world/" + id);
  if (kind === "indicator") return V.openIndicator(id);
  if (kind === "note" || kind === "plan") return V.go("settings/" + (kind === "plan" ? "profile" : "notes"));
};
document.addEventListener("click", (e) => {
  const r = e.target.closest("[data-ref-kind]");
  if (r) { e.preventDefault(); V.openRef(r.dataset.refKind, r.dataset.refId, r.dataset.link); }
});

/* ---------- audio briefing (on-device speech) ---------- */
V.audio = {
  play(script, title) {
    if (!("speechSynthesis" in window)) return V.toast("Audio isn't supported in this browser.", "err");
    this.stop();
    const parts = script.filter(Boolean); let i = 0;
    const bar = document.createElement("div"); bar.className = "audio-bar";
    bar.innerHTML = `<div class="wave">${[0, .2, .4, .1, .3].map((d) => `<i style="animation-delay:${d}s"></i>`).join("")}</div><div class="now ellipsis" id="aNow">${esc(title || "Briefing")}</div>
      <select class="in" id="aRate" style="width:auto;padding:3px 8px;font-size:12px;background:#1d2025;color:#fff;border-color:#333">${[0.9, 1, 1.15, 1.3, 1.5].map((r) => `<option ${r === (V.state.audioRate || 1.15) ? "selected" : ""}>${r}</option>`).join("")}</select>
      <button class="btn sm" id="aPause">${V.icon("pause")}</button><button class="btn sm" id="aStop">${V.icon("stop")}</button>`;
    document.body.appendChild(bar); this.bar = bar;
    const voices = speechSynthesis.getVoices();
    const pref = voices.find((v) => /Samantha|Daniel|Karen|Moira|Serena|Google UK English|Google US English/.test(v.name) && /^en/.test(v.lang)) || voices.find((v) => /^en/.test(v.lang));
    const speak = () => {
      if (i >= parts.length) return this.stop();
      const u = new SpeechSynthesisUtterance(parts[i]); if (pref) u.voice = pref;
      u.rate = +$("#aRate", bar).value; V.state.audioRate = u.rate; $("#aNow", bar).textContent = parts[i].slice(0, 90);
      u.onend = () => { i++; speak(); }; speechSynthesis.speak(u);
    };
    $("#aPause", bar).onclick = () => { if (speechSynthesis.paused) { speechSynthesis.resume(); $("#aPause", bar).innerHTML = V.icon("pause"); } else { speechSynthesis.pause(); $("#aPause", bar).innerHTML = V.icon("play"); } };
    $("#aStop", bar).onclick = () => this.stop();
    speak();
  },
  stop() { if ("speechSynthesis" in window) speechSynthesis.cancel(); if (this.bar) { this.bar.remove(); this.bar = null; } },
};

/* ---------- boot ---------- */
V.boot = async function () {
  let st;
  try { st = await V.net("/api/state"); } catch (e) { $("#root").innerHTML = `<div class="empty"><b>Can't reach Vantage</b>${esc(e.message)}</div>`; return; }
  if (!st.authed) { location.href = "/login"; return; }
  Object.assign(V.state, st);
  $("#root").innerHTML = `<div class="loading" style="min-height:80vh"><span class="spin"></span><span class="small">Syncing your terminal…</span></div>`;
  await V.store.boot();
  V.shell();
  V.render();
  V.engine.afterBoot();
  clearInterval(V._sync); V._sync = setInterval(() => V.store.refresh().then(() => { V.drawTape(); V.drawEngine(); }), 5 * 60 * 1000);
};
