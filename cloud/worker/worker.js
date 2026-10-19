// Vantage · Cloudflare Worker
// Private API (auth, records, alerts, data), a locked-down fetch proxy for the browser engine, and the
// scheduled "engine" that keeps every data source fresh even when nobody is signed in.
//
// Free-plan design: Workers get ~10 ms of CPU per invocation, so heavy work happens in the browser.
// Password stretching (PBKDF2, 600k rounds) runs client-side; the server stores an HMAC of the result.
// Collectors fetch and store compact JSON; analysis (clustering, factor models, maps) runs in the app.

import { FEEDS, MARKET, LONG, BOC_SERIES, BOC_MONTHLY, HOTSPOTS, PORTS, PROXY_HOSTS } from "./sources.js";
import { demoSeed } from "./demo.js";

const KINDS = new Set(["holding", "contact", "event", "decision", "note", "watch", "plan", "scenario", "investor", "ics_sub"]);
const SETTING_KEYS = new Set(["base_currency", "interests", "objectives", "constraints", "max_position", "max_sector", "benchmark", "topic_weights",
  "muted", "muted_kinds", "kind_weights", "home_mode", "timezones", "ask_history", "theme", "watch_countries", "alert_thresholds"]);
const LIVE_ONLY = new Set(["anthropic_key", "anthropic_model", "sec_contact"]);
const ITER = 600000;
const IDLE = 12 * 3600, SHORT = 12 * 3600, LONGTTL = 30 * 86400;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Vantage/2";
const enc = new TextEncoder();

// ------------------------------------------------------------------ utilities
const now = () => Date.now() / 1000;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
async function sha256(s) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function hmacHex(keyHex, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(keyHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
function safeEq(a, b) {
  a = String(a || ""); b = String(b || "");
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
function hash53(str, seed = 7) { // fast non-crypto id hash
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const J = (s, d = null) => { try { return JSON.parse(s); } catch (e) { return d; } };

const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Cross-Origin-Opener-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow, noarchive", "Strict-Transport-Security": "max-age=31536000",
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function json(data, status = 200, extra = {}) {
  return new Response(typeof data === "string" ? data : JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SEC_HEADERS, ...extra },
  });
}

// ------------------------------------------------------------------ small D1 helpers
const q = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const q1 = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
const run = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();

async function kvGet(env, k, d = null) { const r = await q1(env, "SELECT v FROM kv WHERE k=?", k); return r ? J(r.v, d) : d; }
async function kvSet(env, k, v) { await run(env, "INSERT OR REPLACE INTO kv (k, v, updated) VALUES (?,?,?)", k, JSON.stringify(v), now()); }
async function secret(env) {
  let s = await kvGet(env, "secret");
  if (!s) { s = hex(rand(32)); await kvSet(env, "secret", s); }
  return s;
}
async function getSetting(env, space, key, d = null) { const r = await q1(env, "SELECT value FROM settings WHERE space=? AND key=?", space, key); return r ? J(r.value, d) : d; }
async function setSetting(env, space, key, v) { await run(env, "INSERT OR REPLACE INTO settings (space, key, value) VALUES (?,?,?)", space, key, JSON.stringify(v)); }
async function audit(env, event, detail = "") { await run(env, "INSERT INTO audit VALUES (?,?,?)", now(), event, String(detail).slice(0, 400)); }

// ------------------------------------------------------------------ sessions
function cookieName(req) { return new URL(req.url).protocol === "https:" ? "__Host-vt" : "vt"; }
function readToken(req, env) {
  const raw = req.headers.get("Cookie") || (env.HARNESS ? req.headers.get("X-Harness-Cookie") : "") || "";
  const name = cookieName(req);
  for (const part of raw.split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1); }
  return null;
}
function setCookie(req, token, ttl) {
  const secure = new URL(req.url).protocol === "https:";
  return `${cookieName(req)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttl}${secure ? "; Secure" : ""}`;
}
async function newSession(env, req, userId, remember, mfaPending) {
  const token = b64url(rand(32));
  const ttl = mfaPending ? 300 : remember ? LONGTTL : SHORT;
  const prev = await q1(env, "SELECT space FROM sessions WHERE user_id=? ORDER BY last_seen DESC LIMIT 1", userId);
  await run(env, "INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)", await sha256(token), userId, now(), now(), now() + ttl,
    ip(req), (req.headers.get("User-Agent") || "").slice(0, 200), prev ? prev.space : "live", mfaPending ? 1 : 0, remember ? 1 : 0);
  return { token, ttl };
}
async function getSession(env, req) {
  const token = readToken(req, env);
  if (!token) return null;
  const h = await sha256(token);
  const s = await q1(env, "SELECT * FROM sessions WHERE token_hash=?", h);
  if (!s) return null;
  const t = now();
  if (s.expires < t || (!s.remember && t - s.last_seen > IDLE)) { await run(env, "DELETE FROM sessions WHERE token_hash=?", h); return null; }
  if (t - s.last_seen > 120) await run(env, "UPDATE sessions SET last_seen=? WHERE token_hash=?", t, h);
  s.token = token;
  return s;
}
const ip = (req) => req.headers.get("CF-Connecting-IP") || "local";

async function lockout(env, ipAddr, user) {
  const win = now() - 3600;
  const a = await q1(env, "SELECT COUNT(*) n FROM attempts WHERE ok=0 AND ts>? AND (ip=? OR username=?)", win, ipAddr, user);
  const n = a ? a.n : 0;
  if (n < 5) return 0;
  const last = await q1(env, "SELECT MAX(ts) t FROM attempts WHERE ok=0 AND (ip=? OR username=?)", ipAddr, user);
  return Math.max(0, Math.round((last.t || 0) + Math.min(2 ** (n - 4), 900) - now()));
}
async function attempt(env, ipAddr, user, ok) {
  await run(env, "INSERT INTO attempts VALUES (?,?,?,?)", now(), ipAddr, user, ok ? 1 : 0);
  if (ok) await run(env, "DELETE FROM attempts WHERE ok=0 AND (ip=? OR username=?)", ipAddr, user);
}

// TOTP (RFC 6238)
function b32decode(s) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "", out = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) { const v = alpha.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, "0"); }
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(out);
}
function b32encode(bytes) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "", out = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) out += alpha[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
async function totpAt(secretB32, counter) {
  const key = await crypto.subtle.importKey("raw", b32decode(secretB32), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new ArrayBuffer(8); const dv = new DataView(msg); dv.setUint32(0, Math.floor(counter / 2 ** 32)); dv.setUint32(4, counter >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = mac[19] & 15;
  const code = ((mac[o] & 127) << 24 | mac[o + 1] << 16 | mac[o + 2] << 8 | mac[o + 3]) % 1e6;
  return String(code).padStart(6, "0");
}
async function verifyTotp(secretB32, code) {
  code = String(code || "").replace(/\D/g, "");
  if (code.length !== 6 || !secretB32) return false;
  const step = Math.floor(now() / 30);
  for (const d of [-1, 0, 1]) if (safeEq(await totpAt(secretB32, step + d), code)) return true;
  return false;
}

// ------------------------------------------------------------------ records
function rowJson(r) {
  // Build JSON by concatenation so large tables don't pay a parse+stringify round trip (CPU budget).
  return `{"id":${JSON.stringify(r.id)},"_kind":${JSON.stringify(r.kind)},"_created":${r.created},"_updated":${r.updated},"data":${r.data || "{}"}}`;
}
function clean(d) { const o = {}; for (const [k, v] of Object.entries(d || {})) if (!k.startsWith("_") && k !== "id") o[k] = v; return o; }
async function getRecord(env, space, id) {
  const r = await q1(env, "SELECT * FROM records WHERE space=? AND id=? AND deleted=0", space, id);
  if (!r) return null;
  return Object.assign(J(r.data, {}), { id: r.id, _kind: r.kind, _created: r.created, _updated: r.updated });
}
async function createRecord(env, space, kind, data, id, ts) {
  id = id || kind.slice(0, 3) + "_" + b64url(rand(8)).replace(/[-_]/g, "x");
  const t = ts || now(), body = JSON.stringify(clean(data));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO records VALUES (?,?,?,?,?,?,0)").bind(id, space, kind, body, t, t),
    env.DB.prepare("INSERT INTO revisions (record_id, ts, action, data) VALUES (?,?,?,?)").bind(id, t, "create", body),
  ]);
  return getRecord(env, space, id);
}
async function updateRecord(env, space, id, data, merge = true) {
  const cur = await getRecord(env, space, id);
  if (!cur) return null;
  const body = JSON.stringify(Object.assign(merge ? clean(cur) : {}, clean(data)));
  const t = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE records SET data=?, updated=? WHERE id=? AND space=?").bind(body, t, id, space),
    env.DB.prepare("INSERT INTO revisions (record_id, ts, action, data) VALUES (?,?,?,?)").bind(id, t, "update", body),
  ]);
  return getRecord(env, space, id);
}
function sanitize(kind, d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new HttpError(400, "Expected an object");
  if (JSON.stringify(d).length > 400000) throw new HttpError(413, "Record too large");
  if (kind === "holding") {
    if (d.ticker) d.ticker = String(d.ticker).trim().toUpperCase();
    for (const k of ["quantity", "cost", "manual_price", "cost_base_total", "target_weight", "beta"]) {
      if (k in d && d[k] !== null && d[k] !== "") { const v = Number(String(d[k]).replace(/[,$]/g, "")); if (!isFinite(v)) throw new HttpError(400, k + " must be a number"); d[k] = v; }
    }
  }
  if (kind === "ics_sub" && !/^(https|webcal):\/\//.test(d.url || "")) throw new HttpError(400, "Calendar link must start with https:// or webcal://");
  if (kind === "investor") { d.cik = parseInt(String(d.cik).trim(), 10); if (!d.cik) throw new HttpError(400, "CIK must be a number"); }
  return d;
}

async function ensureDemo(env) {
  const r = await q1(env, "SELECT id FROM records WHERE space='demo' LIMIT 1");
  if (r) return;
  const { records, settings } = demoSeed();
  const stmts = [];
  for (const x of records) {
    const id = x.id || x.kind.slice(0, 3) + "_d" + hash53(JSON.stringify(x.data));
    const body = JSON.stringify(x.data);
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO records VALUES (?,?,?,?,?,?,0)").bind(id, "demo", x.kind, body, x.created, x.created));
    stmts.push(env.DB.prepare("INSERT INTO revisions (record_id, ts, action, data) VALUES (?,?,?,?)").bind(id, x.created, "create", body));
  }
  for (const [k, v] of Object.entries(settings)) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO settings VALUES (?,?,?)").bind("demo", k, JSON.stringify(v)));
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
}

// ------------------------------------------------------------------ alerts
async function upsertAlert(env, space, a, origin) {
  const kw = await getSetting(env, space, "kind_weights", {});
  const muted = await getSetting(env, space, "muted_kinds", []);
  if (muted.includes(a.kind)) return;
  const rel = +a.relevance || 0, imp = +a.impact || 0, urg = +a.urgency || 0, conf = +a.confidence || 0;
  const score = (0.35 * rel + 0.3 * imp + 0.2 * urg + 0.15 * conf) * (+(kw[a.kind] || 1));
  const id = "al_" + hash53(space + a.key);
  const t = now();
  const ex = await q1(env, "SELECT id, status FROM alerts WHERE space=? AND key=?", space, a.key);
  if (ex) {
    await run(env, "UPDATE alerts SET title=?, body=?, relevance=?, impact=?, urgency=?, confidence=?, score=?, updated=? WHERE id=?",
      a.title, JSON.stringify(a.body || {}), rel, imp, urg, conf, score, t, ex.id);
  } else {
    await run(env, "INSERT INTO alerts (id, space, key, kind, title, body, relevance, impact, urgency, confidence, score, created, updated, status, group_key, origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, space, a.key, a.kind, a.title, JSON.stringify(a.body || {}), rel, imp, urg, conf, score, t, t, "open", a.group_key || a.key, origin || "app");
  }
  // a newer alert in the same series (next month, next rate move) retires the open older ones
  if (a.supersede) await run(env, "UPDATE alerts SET status='stale', updated=? WHERE space=? AND key LIKE ? AND key<>? AND status='open'", t, space, a.supersede + "%", a.key);
}

// ------------------------------------------------------------------ Claude (optional)
async function callClaude(env, body) {
  const key = await getSetting(env, "live", "anthropic_key");
  if (!key) throw new HttpError(503, "Add an Anthropic API key in Settings → Integrations to use Claude.");
  const model = (await getSetting(env, "live", "anthropic_model")) || "claude-opus-5";
  const system = "You are the analytical engine inside Vantage, a private command center for one person.\n" +
    "- Use only the records and sources provided. Never invent prices, holdings, people, dates, quotes or sources.\n" +
    "- Separate what the records say (facts) from your reasoning (interpretation) and anything forward-looking (forecast).\n" +
    "- Cite records as [ref:<kind>:<id>] and sources as [src:<n>] using the ids given.\n" +
    "- Say exactly what information is missing when it matters. Be concise and decision-useful. Offer considerations, not personalised financial advice.\n" +
    (body.system ? "\n" + String(body.system).slice(0, 4000) : "");
  const req = {
    model, max_tokens: Math.min(+body.max_tokens || 8000, 16000), system,
    messages: [{ role: "user", content: String(body.prompt || "").slice(0, 200000) + (body.json ? "\n\nRespond with a single JSON object only." : "") }],
    output_config: { effort: ["low", "medium", "high"].includes(body.effort) ? body.effort : "medium" },
    fallbacks: "default",
  };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" },
    body: JSON.stringify(req),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) throw new HttpError(503, "The Anthropic API key was rejected.");
  if (r.status === 429) throw new HttpError(503, "Rate limited by the Anthropic API. Try again shortly.");
  if (!r.ok) throw new HttpError(503, "Anthropic API error " + r.status + ": " + ((data.error && data.error.message) || ""));
  if (data.stop_reason === "refusal") throw new HttpError(503, "The model declined this request.");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text, model: data.model || model };
}

// ------------------------------------------------------------------ fetch helpers for collectors & proxy
async function secHeaders(env) {
  const contact = (await getSetting(env, "live", "sec_contact")) || "vantage-selfhosted@example.com";
  return { "User-Agent": "Vantage personal research tool " + contact, "Accept-Encoding": "gzip, deflate" };
}
async function upstream(env, url, opts = {}) {
  const u = new URL(url);
  const headers = u.host.endsWith("sec.gov") ? await secHeaders(env) : { "User-Agent": UA, Accept: "*/*" };
  const r = await fetch(url, { method: opts.method || "GET", headers: { ...headers, ...(opts.headers || {}) }, body: opts.body, cf: { cacheTtl: opts.ttl || 0 } });
  return r;
}
async function getJson(env, url) { const r = await upstream(env, url); if (!r.ok) throw new Error(url.split("?")[0] + " → HTTP " + r.status); return r.json(); }
async function getText(env, url) { const r = await upstream(env, url); if (!r.ok) throw new Error(url.split("?")[0] + " → HTTP " + r.status); return r.text(); }

async function putSeries(env, id, data, error) {
  const t = now();
  if (error) await run(env, "INSERT INTO series (id, updated, error, tried) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET error=excluded.error, tried=excluded.tried", id, 0, String(error).slice(0, 300), t);
  else await run(env, "INSERT INTO series (id, data, updated, ok, error, tried) VALUES (?,?,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated=excluded.updated, ok=excluded.ok, error=NULL, tried=excluded.tried",
    id, typeof data === "string" ? data : JSON.stringify(data), t, t, t);
}
async function getSeries(env, id) { const r = await q1(env, "SELECT data, updated FROM series WHERE id=?", id); return r && r.data ? { data: J(r.data), updated: r.updated } : null; }

// ------------------------------------------------------------------ collectors (the engine)
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
function strip(s) {
  s = (s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ");
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));
  return s.replace(/\s+/g, " ").trim();
}
const RX = {
  item: /<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi, title: /<title[^>]*>([\s\S]*?)<\/title>/i, link: /<link[^>]*>([\s\S]*?)<\/link>/i,
  href: /<link[^>]*?href="([^"]+)"[^>]*\/?>/i, desc: /<(description|summary|content)[^>]*>([\s\S]*?)<\/(description|summary|content)>/i,
  date: /<(pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(pubDate|published|updated|dc:date)>/i,
};
function parseFeed(xml) {
  const out = [];
  let m; RX.item.lastIndex = 0;
  while ((m = RX.item.exec(xml)) && out.length < 40) {
    const b = m[0];
    const title = strip((b.match(RX.title) || [])[1]);
    let link = strip((b.match(RX.link) || [])[1]);
    if (!link || !/^https?:/.test(link)) link = (b.match(RX.href) || [])[1] || link;
    if (!title || !link) continue;
    const desc = strip((b.match(RX.desc) || [])[2]).slice(0, 500);
    const d = Date.parse(strip((b.match(RX.date) || [])[2]));
    out.push({ title, link, desc, pub: isFinite(d) ? d / 1000 : null });
  }
  return out;
}
async function jobNews(env, feedIdx) {
  const [fid, source, url, topic] = FEEDS[feedIdx % FEEDS.length];
  const items = parseFeed(await getText(env, url));
  if (!items.length) throw new Error("no items parsed");
  const t = now();
  const ids = items.map((i) => "n" + hash53(i.link));
  const existing = new Set((await q(env, `SELECT id FROM news WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids)).map((r) => r.id));
  const stmts = [];
  items.forEach((it, k) => {
    if (existing.has(ids[k])) return;
    let pub = it.pub || t; if (pub > t + 3600) pub = t;
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO news VALUES (?,?,?,?,?,?,?,?,?)").bind(ids[k], fid, source, topic, it.title.slice(0, 400), it.link.slice(0, 1000), it.desc, pub, t));
  });
  if (stmts.length) await env.DB.batch(stmts);
  return fid + ": " + stmts.length + " new";
}

function compactChart(d, withDiv) {
  const r = d && d.chart && d.chart.result && d.chart.result[0];
  if (!r) throw new Error((d && d.chart && d.chart.error && d.chart.error.description) || "no data");
  const m = r.meta, ts = r.timestamp || [], cl = ((r.indicators || {}).quote || [{}])[0].close || [];
  const pts = [];
  for (let i = 0; i < ts.length; i++) if (cl[i] != null) pts.push([ts[i], Math.round(cl[i] * 10000) / 10000]);
  const out = { s: m.symbol, n: m.longName || m.shortName || m.symbol, c: (m.currency || "USD"), x: m.fullExchangeName || m.exchangeName, ty: m.instrumentType,
    p: m.regularMarketPrice, t: m.regularMarketTime, d: pts, f: now() };
  if (withDiv) out.dv = Object.values(((r.events || {}).dividends) || {}).map((x) => [x.date, x.amount]).sort((a, b) => a[0] - b[0]);
  return out;
}
async function trackedTickers(env) {
  const rows = await q(env, "SELECT data FROM records WHERE kind IN ('holding','watch') AND deleted=0");
  const set = new Set(MARKET);
  for (const r of rows) { const d = J(r.data, {}); const t = (d.ticker || "").toUpperCase(); if (t && t !== "CASH" && !t.startsWith("CASH")) set.add(t); }
  return [...set];
}
async function jobQuotes(env, st, n = 10) {
  const all = await trackedTickers(env);
  const batch = [];
  for (let i = 0; i < Math.min(n, all.length); i++) batch.push(all[(st.qi + i) % all.length]);
  st.qi = (st.qi + batch.length) % Math.max(1, all.length);
  const res = await Promise.all(batch.map(async (s) => {
    try {
      const d = await getJson(env, `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d`);
      const c = compactChart(d);
      const prev = c.d.length > 1 ? c.d[c.d.length - 2][1] : null;
      const rec = { s: c.s, n: c.n, c: c.c, x: c.x, ty: c.ty, p: c.p, pc: prev, t: c.t, f: c.f };
      await putSeries(env, "q:" + s, rec);
      return [s, rec];
    } catch (e) { await putSeries(env, "q:" + s, null, e.message); return [s, null]; }
  }));
  await quoteAlerts(env, res.filter((x) => x[1]));
  return res.filter((x) => x[1]).length + "/" + batch.length + " quotes";
}
async function jobHistory(env) {
  const all = await trackedTickers(env);
  const rows = await q(env, "SELECT id, updated, tried FROM series WHERE id LIKE 'h:%' OR id LIKE 'm:%'");
  const age = Object.fromEntries(rows.map((r) => [r.id, r]));
  // stale after ~a day; a failing symbol waits 3 h before its next try so it cannot block the queue
  const stale = (id, maxAge) => { const r = age[id] || {}; return now() - (r.updated || 0) > maxAge && now() - (r.tried || 0) > 3 * 3600; };
  const due = [];
  for (const s of all) if (stale("h:" + s, 20 * 3600)) due.push(["h", s]);
  for (const s of LONG) if (stale("m:" + s, 22 * 3600)) due.push(["m", s]);
  // work off a big backlog (first run, new holdings) faster; long weekly histories count double
  let budget = due.length > 12 ? 8 : 4;
  const pick = [];
  for (const d of due) { const cost = d[0] === "m" ? 2 : 1; if (cost > budget) continue; pick.push(d); budget -= cost; if (!budget) break; }
  for (const [kind, s] of pick) {
    try {
      // explicit dates for the long view: with range=max Yahoo silently falls back to monthly bars and drops
      // whole months (June 2008, March 2020), so weekly bars since 2000 are requested instead
      const url = kind === "h" ? `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=2y&interval=1d&events=div`
        : `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?period1=946684800&period2=${Math.floor(now())}&interval=1wk`;
      await putSeries(env, kind + ":" + s, compactChart(await getJson(env, url), kind === "h"));
    } catch (e) { await putSeries(env, kind + ":" + s, null, e.message); }
  }
  return pick.length + " histories (" + due.length + " due)";
}
async function jobBoc(env) {
  const d = await getJson(env, `https://www.bankofcanada.ca/valet/observations/${BOC_SERIES.join(",")}/json?recent_weeks=110`);
  const series = {};
  for (const k of BOC_SERIES) series[k] = [];
  for (const ob of d.observations || []) for (const k of BOC_SERIES) if (ob[k] && ob[k].v !== "" && ob[k].v != null) series[k].push([ob.d, +ob[k].v]);
  for (const k of BOC_MONTHLY) {
    const m = await getJson(env, `https://www.bankofcanada.ca/valet/observations/${k}/json?recent=40`);
    series[k] = (m.observations || []).filter((o) => o[k] && o[k].v).map((o) => [o.d, +o[k].v]);
  }
  for (const k in series) series[k].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const prev = await getSeries(env, "boc");
  await putSeries(env, "boc", { series, f: now() });
  // alert when the policy rate changes
  const pr = series.V39079, old = prev && prev.data && prev.data.series && prev.data.series.V39079;
  if (pr && pr.length && old && old.length && pr[pr.length - 1][1] !== old[old.length - 1][1]) {
    for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "boc:rate:" + pr[pr.length - 1][0], supersede: "boc:rate:", kind: "macro",
      title: `Bank of Canada moved its policy rate to ${pr[pr.length - 1][1].toFixed(2)}% (from ${old[old.length - 1][1].toFixed(2)}%)`,
      body: { why: "Policy-rate changes reprice variable mortgages, lines of credit and savings within days.", evidence: ["Bank of Canada Valet, " + pr[pr.length - 1][0]], action: "Open Rates to see the effect on borrowing and your holdings.", go: "rates" },
      relevance: 0.9, impact: 0.8, urgency: 0.8, confidence: 1 }, "engine");
  }
  return "boc ok";
}
async function jobPortwatch(env) {
  const base = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
  const names = PORTS.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  // "Normal" = the two years before the most recent 90 days, so an ongoing disruption doesn't drag its own baseline down.
  const since1y = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
  const baseEnd = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const recentFrom = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const stats = await getJson(env, `${base}?where=${encodeURIComponent(`portname IN (${names}) AND date>='${since1y}' AND date<'${baseEnd}'`)}&groupByFieldsForStatistics=portname&outStatistics=${encodeURIComponent(JSON.stringify([
    { statisticType: "avg", onStatisticField: "n_total", outStatisticFieldName: "avg_total" }, { statisticType: "avg", onStatisticField: "n_tanker", outStatisticFieldName: "avg_tanker" },
    { statisticType: "avg", onStatisticField: "capacity", outStatisticFieldName: "avg_cap" }]))}&f=json`);
  // the service returns at most 1,000 rows per request: page through newest-first so the latest days are never cut off
  const feats = [];
  for (let off = 0; off < 5000; off += 1000) {
    const pg = await getJson(env, `${base}?where=${encodeURIComponent(`portname IN (${names}) AND date>='${recentFrom}'`)}&outFields=date,portname,n_total,n_tanker,n_container,n_dry_bulk,capacity&orderByFields=${encodeURIComponent("date DESC")}&resultOffset=${off}&resultRecordCount=1000&f=json`);
    feats.push(...(pg.features || []));
    if (!pg.exceededTransferLimit || !(pg.features || []).length) break;
  }
  feats.reverse();
  const daily = {};
  for (const f of feats) { const a = f.attributes; (daily[a.portname] = daily[a.portname] || []).push([typeof a.date === "number" ? new Date(a.date).toISOString().slice(0, 10) : a.date, a.n_total, a.n_tanker, a.n_container, a.n_dry_bulk, a.capacity]); }
  const avg = {};
  for (const f of stats.features || []) avg[f.attributes.portname] = { total: f.attributes.avg_total, tanker: f.attributes.avg_tanker, cap: f.attributes.avg_cap };
  await putSeries(env, "pw", { daily, avg, since, base_from: since1y, base_to: baseEnd, f: now() });
  // disruption alerts: last 7 days vs 1-year average
  const IMPORTANCE = { "Strait of Hormuz": 1, "Bab el-Mandeb Strait": 0.8, "Suez Canal": 0.8, "Malacca Strait": 0.8, "Taiwan Strait": 0.75, "Panama Canal": 0.6, "Bosporus Strait": 0.55, "Cape of Good Hope": 0.5, "Luzon Strait": 0.45, "Korea Strait": 0.45, "Kerch Strait": 0.3 };
  for (const [port, rows] of Object.entries(daily)) {
    const a = avg[port]; if (!a || !a.total || a.total < 20 || rows.length < 7) continue;
    const last7 = rows.slice(-7).reduce((s, r) => s + (r[1] || 0), 0) / 7;
    const ratio = last7 / a.total;
    if (ratio < 0.6) {
      const hs = HOTSPOTS.find((h) => (h.port || []).includes(port));
      for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "pw:" + port + ":" + rows[rows.length - 1][0].slice(0, 7), supersede: "pw:" + port + ":", kind: "world",
        title: `${port}: ship transits running at ${Math.round(ratio * 100)}% of normal`,
        body: { why: `7-day average ${last7.toFixed(1)} transits/day vs a normal of ${a.total.toFixed(1)} (average ${since1y} to ${baseEnd}; IMF PortWatch, AIS-based).`, evidence: ["Latest data " + rows[rows.length - 1][0] + " (PortWatch publishes with a lag of a few days)"],
          action: "Open the World tracker.", go: "world/" + (hs ? hs.id : "") }, relevance: 0.6 + 0.35 * (IMPORTANCE[port] || 0.4), impact: Math.min(1, (1.2 - ratio) * (IMPORTANCE[port] || 0.4)), urgency: 0.6, confidence: 0.85 }, "engine");
    }
  }
  return Object.keys(daily).length + " chokepoints";
}
async function jobGdelt(env, st) {
  const h = HOTSPOTS[st.gi % HOTSPOTS.length];
  const mode = st.gm ? "artlist" : "timelinevolraw";
  const url = mode === "artlist"
    ? `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent("(" + h.q + ") sourcelang:english")}&mode=artlist&maxrecords=12&sort=datedesc&timespan=3d&format=json`
    : `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(h.q)}&mode=timelinevolraw&timespan=90d&format=json`;
  if (st.gm) st.gi = (st.gi + 1) % HOTSPOTS.length;
  st.gm = !st.gm;
  const r = await upstream(env, url);
  if (r.status === 429) throw new Error("GDELT rate limit (will retry next cycle)");
  if (!r.ok) throw new Error("GDELT HTTP " + r.status);
  const d = J(await r.text(), null);
  if (!d) throw new Error("GDELT returned non-JSON");
  if (mode === "artlist") {
    const arts = (d.articles || []).map((a) => ({ t: a.title, u: a.url, s: a.domain, d: a.seendate, c: a.sourcecountry }));
    await putSeries(env, "ga:" + h.id, { arts, f: now() });
    return h.id + " articles " + arts.length;
  }
  const tl = ((d.timeline || [])[0] || {}).data || [];
  const vol = tl.map((p) => [p.date.slice(0, 8), p.value, p.norm]);
  await putSeries(env, "g:" + h.id, { vol, f: now() });
  if (vol.length > 30) {
    const base = vol.slice(-31, -3).map((x) => x[1]), last = vol.slice(-3).map((x) => x[1]);
    const mean = base.reduce((a, b) => a + b, 0) / base.length;
    const sd = Math.sqrt(base.reduce((a, b) => a + (b - mean) ** 2, 0) / base.length) || 1;
    const lm = last.reduce((a, b) => a + b, 0) / last.length, z = (lm - mean) / sd;
    if (z > 2.5 && lm > 50) for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "gd:" + h.id + ":" + vol[vol.length - 1][0], supersede: "gd:" + h.id + ":", kind: "world",
      title: `News attention on ${h.id === "hormuz" ? "the Strait of Hormuz" : h.id} is surging (${z.toFixed(1)}σ above normal)`,
      body: { why: `Articles/day over the last 3 days (${Math.round(lm)}) vs the prior 4-week average (${Math.round(mean)}), GDELT.`, action: "Open the World tracker.", go: "world/" + h.id },
      relevance: 0.75, impact: 0.6, urgency: 0.7, confidence: 0.7 }, "engine");
  }
  return h.id + " volume " + vol.length;
}
async function jobFlights(env, st) {
  const withAir = HOTSPOTS.filter((h) => h.air);
  const h = withAir[st.fi % withAir.length];
  st.fi = (st.fi + 1) % withAir.length;
  const [lat, lon, nm] = h.air;
  // Free community ADS-B feeds rate-limit unpredictably, so try several in order.
  const sources = [
    ["adsb.fi", async () => { const d = await getJson(env, `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`); return d.aircraft || d.ac; }],
    ["adsb.lol", async () => { const d = await getJson(env, `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${nm}`); return d.ac || d.aircraft; }],
    ["OpenSky", async () => {
      const dLat = nm / 60, dLon = nm / (60 * Math.cos(lat * Math.PI / 180));
      const d = await getJson(env, `https://opensky-network.org/api/states/all?lamin=${(lat - dLat).toFixed(2)}&lomin=${(lon - dLon).toFixed(2)}&lamax=${(lat + dLat).toFixed(2)}&lomax=${(lon + dLon).toFixed(2)}`);
      return (d.states || []).map((x) => ({ flight: x[1], t: "", r: x[2], alt_baro: x[8] ? "ground" : Math.round((x[7] || 0) * 3.281), lat: x[6], lon: x[5], dbFlags: 0 }));
    }],
  ];
  let ac = null, used = null, errs = [];
  for (const [name, fn] of sources) {
    try { const a = await fn(); if (Array.isArray(a) && (a.length || name === "OpenSky")) { ac = a; used = name; break; } errs.push(name + ": empty"); }
    catch (e) { errs.push(name + ": " + e.message); }
  }
  if (!ac) throw new Error("all ADS-B sources failed (" + errs.join("; ") + ")");
  const airborne = ac.filter((a) => a.alt_baro !== "ground");
  const mil = ac.filter((a) => (a.dbFlags & 1) === 1).length;
  const prev = (await getSeries(env, "f:" + h.id)) || { data: { pts: [] } };
  const pts = (prev.data && prev.data.pts) || [];
  pts.push([Math.round(now()), airborne.length, mil]);
  while (pts.length && pts[0][0] < now() - 21 * 86400) pts.shift();
  const sample = airborne.slice(0, 40).map((a) => [a.flight ? String(a.flight).trim() : "", a.t || "", a.r || "", a.alt_baro, a.lat, a.lon]);
  await putSeries(env, "f:" + h.id, { pts, sample, f: now(), src: used + " (community ADS-B receivers)" });
  return h.id + " aircraft " + airborne.length + " via " + used;
}
async function jobUsgs(env) {
  const d = await getJson(env, "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson");
  const eq = (d.features || []).map((f) => ({ m: f.properties.mag, p: f.properties.place, t: f.properties.time / 1000, u: f.properties.url, ts: f.properties.tsunami, a: f.properties.alert, c: f.geometry.coordinates }))
    .sort((a, b) => b.t - a.t).slice(0, 80);
  await putSeries(env, "usgs", { eq, f: now() });
  for (const e of eq.filter((x) => x.m >= 6.5 && x.t > now() - 2 * 86400)) for (const space of ["live", "demo"]) await upsertAlert(env, space, {
    key: "eq:" + e.u, kind: "world", title: `M${e.m.toFixed(1)} earthquake: ${e.p}`, body: { why: "Major earthquakes can disrupt supply chains, ports and insurers.", evidence: ["USGS " + new Date(e.t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" + (e.ts ? " · tsunami flag" : "")], link: e.u },
    relevance: 0.5, impact: Math.min(1, (e.m - 6) / 2.5), urgency: 0.6, confidence: 1 }, "engine");
  return eq.length + " quakes";
}
async function jobTravel(env) {
  const d = await getJson(env, "https://data.international.gc.ca/travel-voyage/index-alpha-eng.json");
  const levels = {};
  for (const [iso, c] of Object.entries(d.data || {})) levels[iso] = [c["advisory-state"], c["date-published"] && c["date-published"].date, c["country-eng"], c["has-regional-advisory"]];
  const prev = await getSeries(env, "travel");
  await putSeries(env, "travel", { levels, f: now() });
  if (prev && prev.data && prev.data.levels) {
    const watch = new Set(["IR", "IL", "LB", "SY", "YE", "UA", "RU", "TW", "CN", "KP", "AE", "OM", "QA", "SA", "KW", "BH", "EG", "IQ", "JO", "TR", "US", "MX"]);
    for (const [iso, v] of Object.entries(levels)) {
      const old = prev.data.levels[iso];
      if (old && old[0] !== v[0] && watch.has(iso)) {
        const lab = ["take normal precautions", "exercise a high degree of caution", "avoid non-essential travel", "avoid all travel"];
        for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "tr:" + iso + ":" + v[0] + ":" + (v[1] || ""), supersede: "tr:" + iso + ":", kind: "world",
          title: `Canada changed its ${v[2]} travel advisory: ${lab[v[0]] || v[0]}`, body: { why: `Was "${lab[old[0]] || old[0]}". Government of Canada travel advisories.`, action: "Open the World tracker.", go: "world" },
          relevance: 0.7, impact: 0.5 + 0.15 * v[0], urgency: 0.6, confidence: 1 }, "engine");
      }
    }
  }
  return Object.keys(levels).length + " countries";
}
async function jobSec(env, st) {
  const invs = await q(env, "SELECT DISTINCT data FROM records WHERE kind='investor' AND deleted=0");
  const ciks = [...new Set(invs.map((r) => J(r.data, {}).cik).filter(Boolean))];
  if (!ciks.length) return "no investors";
  const cik = ciks[st.si % ciks.length];
  st.si = (st.si + 1) % ciks.length;
  const d = await getJson(env, `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`);
  const rec = d.filings.recent;
  let latest = null;
  for (let i = 0; i < rec.form.length; i++) if (rec.form[i] === "13F-HR") { latest = { acc: rec.accessionNumber[i], filed: rec.filingDate[i], period: rec.reportDate[i] }; break; }
  const prev = await getSeries(env, "s13:" + cik);
  await putSeries(env, "s13:" + cik, { name: d.name, latest, f: now() });
  if (latest && prev && prev.data && prev.data.latest && prev.data.latest.acc !== latest.acc) {
    for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "13f:" + cik + ":" + latest.acc, supersede: "13f:" + cik + ":", kind: "investor",
      title: `${d.name} filed a new 13F (holdings as of ${latest.period})`, body: { why: "A followed investor disclosed quarter-end holdings.", evidence: ["Filed " + latest.filed],
        caveat: "13F data is up to 45 days old at filing and shows long US-listed positions only.", action: "Open Filings to see what changed.", go: "filings" },
      relevance: 0.7, impact: 0.4, urgency: 0.4, confidence: 1 }, "engine");
  }
  return d.name;
}
async function quoteAlerts(env, pairs) {
  if (!pairs.length) return;
  const holds = await q(env, "SELECT space, data FROM records WHERE kind='holding' AND deleted=0");
  const bySym = {};
  for (const r of holds) { const d = J(r.data, {}); if (d.ticker) (bySym[d.ticker.toUpperCase()] = bySym[d.ticker.toUpperCase()] || []).push(r.space); }
  const day = new Date().toISOString().slice(0, 10);
  const macro = { "CL=F": [0.04, "WTI crude"], "BZ=F": [0.04, "Brent crude"], "^VIX": [0.2, "VIX (volatility)"], "^GSPC": [0.02, "S&P 500"], "^GSPTSE": [0.02, "S&P/TSX"], "^IXIC": [0.025, "Nasdaq"], "GC=F": [0.03, "Gold"], "CADUSD=X": [0.01, "Canadian dollar"] };
  // Continuous front-month futures jump when the contract rolls. If WTI and Brent diverge sharply on the
  // same day, treat the move as a probable roll artifact rather than news.
  const qOf = async (sym) => { const f = pairs.find((p) => p[0] === sym); if (f) return f[1]; const r = await getSeries(env, "q:" + sym); return r && r.data; };
  const wti = await qOf("CL=F"), brent = await qOf("BZ=F");
  const chg = (x) => (x && x.p && x.pc ? x.p / x.pc - 1 : null);
  const rollSuspect = chg(wti) != null && chg(brent) != null && Math.abs(chg(wti) - chg(brent)) > 0.04;
  for (const [s, rec] of pairs) {
    if (!rec.p || !rec.pc) continue;
    const ch = rec.p / rec.pc - 1;
    if (rollSuspect && (s === "CL=F" || s === "BZ=F")) continue;
    if (bySym[s] && Math.abs(ch) >= 0.05) for (const space of new Set(bySym[s])) await upsertAlert(env, space, { key: "px:" + s + ":" + day, kind: "price",
      title: `${s} ${ch > 0 ? "up" : "down"} ${Math.abs(ch * 100).toFixed(1)}% today`, body: { why: "Daily moves of 5% or more usually reflect new information.", evidence: [`${rec.p} vs previous close ${rec.pc} ${rec.c} (Yahoo Finance, delayed)`], action: "Check news and filings before reacting.", ticker: s },
      relevance: 0.9, impact: Math.min(1, Math.abs(ch) * 5), urgency: 0.8, confidence: 0.95 }, "engine");
    if (macro[s] && Math.abs(ch) >= macro[s][0]) for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "mx:" + s + ":" + day, kind: "market",
      title: `${macro[s][1]} ${ch > 0 ? "jumped" : "fell"} ${Math.abs(ch * 100).toFixed(1)}% today`, body: { why: "A large move in a market-wide driver can reprice many holdings at once.", evidence: [`${rec.p} vs ${rec.pc}`], action: "Open the driver to see what it means for you.", go: s === "CL=F" || s === "BZ=F" ? "oil" : s === "CADUSD=X" ? "macro" : "macro" },
      relevance: 0.8, impact: Math.min(1, Math.abs(ch) * 8), urgency: 0.8, confidence: 0.95 }, "engine");
  }
  // 10-year yield: alert on 12bp+ daily move
  const tnx = pairs.find((p) => p[0] === "^TNX");
  if (tnx && tnx[1].p && tnx[1].pc && Math.abs(tnx[1].p - tnx[1].pc) >= 0.12) for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "tnx:" + day, kind: "market",
    title: `US 10-year yield moved ${((tnx[1].p - tnx[1].pc) * 100).toFixed(0)} bp to ${tnx[1].p.toFixed(2)}%`, body: { why: "Long yields set mortgage rates and the discount rate used to value stocks.", action: "Open Rates.", go: "rates" },
    relevance: 0.8, impact: 0.7, urgency: 0.7, confidence: 0.95 }, "engine");
}
async function jobSnapshot(env) {
  const day = new Date().toISOString().slice(0, 10);
  const boc = await getSeries(env, "boc");
  const fx = { CAD: 1 };
  if (boc && boc.data) for (const [k, v] of Object.entries(boc.data.series || {})) if (k.startsWith("FX") && v.length) fx[k.slice(2, 5)] = v[v.length - 1][1];
  for (const space of ["live", "demo"]) {
    const rows = await q(env, "SELECT data FROM records WHERE space=? AND kind='holding' AND deleted=0", space);
    if (!rows.length) continue;
    const quotes = Object.fromEntries((await q(env, "SELECT id, data FROM series WHERE id LIKE 'q:%'")).map((r) => [r.id.slice(2), J(r.data, {})]));
    let total = 0; const w = {};
    for (const r of rows) {
      const h = J(r.data, {}); const t = (h.ticker || "").toUpperCase(); const qte = quotes[t];
      let price = t === "CASH" ? 1 : qte && qte.p != null ? qte.p : h.manual_price != null ? h.manual_price : h.broker_price;
      let ccy = (t === "CASH" ? h.currency : (qte && qte.c) || h.currency || h.broker_currency || "CAD") || "CAD";
      if (ccy === "GBp") { ccy = "GBP"; price = price / 100; }
      const v = (+h.quantity || 0) * (price || 0) * (fx[ccy] || 0);
      total += v; w[t || h.name] = (w[t || h.name] || 0) + v;
    }
    const prev = await q1(env, "SELECT data FROM snapshots WHERE space=? AND day=?", space, day);
    const pd = prev ? J(prev.data, {}) : {};
    await run(env, "INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)", space, day, now(), JSON.stringify(Object.assign(pd, { total, values: w, base: "CAD", engine: true })));
  }
  return "snapshots";
}
async function jobPrune(env) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM news WHERE published<?").bind(t - 21 * 86400),
    env.DB.prepare("DELETE FROM attempts WHERE ts<?").bind(t - 30 * 86400),
    env.DB.prepare("DELETE FROM sessions WHERE expires<?").bind(t),
    env.DB.prepare("UPDATE alerts SET status='stale' WHERE status='open' AND updated<? AND origin='engine'").bind(t - 5 * 86400),
  ]);
  return "pruned";
}

async function recordJob(env, name, fn) {
  const t = now();
  try {
    const note = await fn();
    await run(env, "INSERT INTO jobs (name, last_run, last_ok, last_error, runs, note) VALUES (?,?,?,NULL,1,?) ON CONFLICT(name) DO UPDATE SET last_run=excluded.last_run, last_ok=excluded.last_ok, last_error=NULL, runs=jobs.runs+1, note=excluded.note", name, t, t, String(note || "").slice(0, 200));
    return { name, ok: true, note };
  } catch (e) {
    await run(env, "INSERT INTO jobs (name, last_run, last_error, runs) VALUES (?,?,?,1) ON CONFLICT(name) DO UPDATE SET last_run=excluded.last_run, last_error=excluded.last_error, runs=jobs.runs+1", name, t, String(e.message || e).slice(0, 300));
    return { name, ok: false, error: e.message };
  }
}

// One engine tick. Every 5 minutes: 3 news feeds, 10 quotes, 1 GDELT call, 1 flight scan; heavier jobs rotate
// (history checks every tick but only fetches what is stale, so it is usually a cheap no-op).
export async function tick(env, only) {
  const st = Object.assign({ fi: 0, qi: 0, gi: 0, gm: false, si: 0, ni: 0, n: 0 }, await kvGet(env, "engine", {}));
  st.n = (st.n || 0) + 1;
  const t = now(), out = [];
  const due = async (name, every) => { const r = await q1(env, "SELECT last_ok, last_run FROM jobs WHERE name=?", name); return !r || t - (r.last_ok || 0) > every && t - (r.last_run || 0) > Math.min(every, 1800); };
  const want = (name) => !only || only.includes(name);
  if (want("news")) for (let i = 0; i < 3; i++) { const idx = st.ni; st.ni = (st.ni + 1) % FEEDS.length; out.push(await recordJob(env, "news:" + FEEDS[idx][0], () => jobNews(env, idx))); }
  if (want("quotes")) out.push(await recordJob(env, "quotes", () => jobQuotes(env, st)));
  if (want("gdelt")) out.push(await recordJob(env, "gdelt", () => jobGdelt(env, st)));
  if (want("flights")) out.push(await recordJob(env, "flights", () => jobFlights(env, st)));
  // heavier jobs: at most one per tick, rotating
  const heavy = [["history", 4 * 60, () => jobHistory(env)], ["boc", 3 * 3600, () => jobBoc(env)], ["portwatch", 6 * 3600, () => jobPortwatch(env)],
    ["usgs", 3600, () => jobUsgs(env)], ["travel", 12 * 3600, () => jobTravel(env)], ["sec", 6 * 3600, () => jobSec(env, st)],
    ["snapshot", 3 * 3600, () => jobSnapshot(env)], ["prune", 24 * 3600, () => jobPrune(env)]];
  for (let k = 0; k < heavy.length; k++) {
    const [name, every, fn] = heavy[(st.n + k) % heavy.length];
    if (!want(name)) continue;
    if (only || await due(name, every)) { out.push(await recordJob(env, name, fn)); if (!only) break; }
  }
  await kvSet(env, "engine", Object.assign(st, { last: t }));
  return out;
}

// ------------------------------------------------------------------ router
const ROUTES = [];
const route = (method, pattern, fn, open = false) => ROUTES.push([method, new RegExp("^" + pattern + "$"), fn, open]);

route("GET", "/api/state", async (c) => {
  const user = await q1(c.env, "SELECT username, totp_enabled, prev_login, prev_ip FROM users LIMIT 1");
  const s = await getSession(c.env, c.req);
  const out = { setup_needed: !user, authed: !!(s && !s.mfa_pending), mfa_pending: !!(s && s.mfa_pending) };
  if (out.authed) Object.assign(out, { user: user.username, mfa: !!user.totp_enabled, space: s.space, prev_login: user.prev_login, prev_ip: user.prev_ip,
    ai: { ok: !!(await getSetting(c.env, "live", "anthropic_key")), model: (await getSetting(c.env, "live", "anthropic_model")) || "claude-opus-5" },
    sec: !!(await getSetting(c.env, "live", "sec_contact")) });
  return out;
}, true);

route("GET", "/api/salt", async (c) => {
  const u = (c.url.searchParams.get("u") || "").trim().toLowerCase();
  const user = await q1(c.env, "SELECT salt, iterations FROM users WHERE username=?", u);
  if (user) return { salt: user.salt, iterations: user.iterations };
  return { salt: (await hmacHex(await secret(c.env), "salt:" + u)).slice(0, 32), iterations: ITER }; // no username probing
}, true);

route("POST", "/api/setup", async (c) => {
  const d = await c.body();
  if (await q1(c.env, "SELECT id FROM users LIMIT 1")) throw new HttpError(400, "An account already exists.");
  if (await lockout(c.env, ip(c.req), "setup")) throw new HttpError(429, "Too many attempts. Wait and try again.");
  const want = await kvGet(c.env, "setup_code_hash");
  if (!want || !safeEq(await sha256(String(d.code || "").trim().toUpperCase()), want)) { await attempt(c.env, ip(c.req), "setup", false); throw new HttpError(400, "Setup code is incorrect."); }
  const username = String(d.username || "").trim().toLowerCase();
  if (!/^[a-z0-9._]{3,32}$/.test(username)) throw new HttpError(400, "Username: 3-32 letters, digits, dots or underscores.");
  if (!/^[0-9a-f]{32}$/.test(d.salt || "") || !/^[0-9a-f]{64}$/.test(d.verifier || "") || +d.iterations < 300000) throw new HttpError(400, "Malformed credentials.");
  await run(c.env, "INSERT INTO users (username, salt, verifier_hash, iterations, created) VALUES (?,?,?,?,?)", username, d.salt, await hmacHex(await secret(c.env), d.verifier), +d.iterations, now());
  await run(c.env, "DELETE FROM kv WHERE k='setup_code_hash'");
  await audit(c.env, "setup", "account created: " + username);
  await ensureDemo(c.env);
  return { ok: true };
}, true);

route("POST", "/api/login", async (c) => {
  const d = await c.body();
  const username = String(d.username || "").trim().toLowerCase();
  const wait = await lockout(c.env, ip(c.req), username);
  if (wait) throw new HttpError(429, `Too many failed attempts. Try again in ${wait} seconds.`);
  const u = await q1(c.env, "SELECT * FROM users WHERE username=?", username);
  const ok = u && safeEq(await hmacHex(await secret(c.env), String(d.verifier || "")), u.verifier_hash);
  await attempt(c.env, ip(c.req), username, !!ok);
  if (!ok) { await audit(c.env, "login_failed", username + " from " + ip(c.req)); throw new HttpError(401, "Incorrect username or password."); }
  const { token, ttl } = await newSession(c.env, c.req, u.id, !!d.remember, !!u.totp_enabled);
  if (!u.totp_enabled) await markLogin(c.env, u, c.req);
  return c.reply({ ok: true, mfa: !!u.totp_enabled }, { "Set-Cookie": setCookie(c.req, token, ttl) });
}, true);
async function markLogin(env, u, req) {
  await run(env, "UPDATE users SET prev_login=last_login, prev_ip=last_ip, last_login=?, last_ip=? WHERE id=?", now(), ip(req), u.id);
  await audit(env, "login", u.username + " from " + ip(req));
}
route("POST", "/api/mfa", async (c) => {
  const token = readToken(c.req, c.env);
  const s = token && await q1(c.env, "SELECT * FROM sessions WHERE token_hash=?", await sha256(token));
  if (!s || !s.mfa_pending || s.expires < now()) throw new HttpError(401, "Sign in first.");
  const u = await q1(c.env, "SELECT * FROM users WHERE id=?", s.user_id);
  const wait = await lockout(c.env, ip(c.req), u.username + ":mfa");
  if (wait) throw new HttpError(429, `Too many attempts. Try again in ${wait} seconds.`);
  const code = String((await c.body()).code || "").trim();
  let ok = await verifyTotp(u.totp_secret, code);
  if (!ok && code.includes("-")) {
    const h = await sha256(code.toLowerCase()); const rec = J(u.recovery, []);
    if (rec.includes(h)) { ok = true; await run(c.env, "UPDATE users SET recovery=? WHERE id=?", JSON.stringify(rec.filter((x) => x !== h)), u.id); await audit(c.env, "mfa", "recovery code used"); }
  }
  await attempt(c.env, ip(c.req), u.username + ":mfa", ok);
  if (!ok) throw new HttpError(401, "That code didn't work.");
  await run(c.env, "DELETE FROM sessions WHERE token_hash=?", s.token_hash);
  const n = await newSession(c.env, c.req, u.id, !!s.remember, false);
  await markLogin(c.env, u, c.req);
  return c.reply({ ok: true }, { "Set-Cookie": setCookie(c.req, n.token, n.ttl) });
}, true);
route("POST", "/api/logout", async (c) => {
  const t = readToken(c.req, c.env);
  if (t) await run(c.env, "DELETE FROM sessions WHERE token_hash=?", await sha256(t));
  return c.reply({ ok: true }, { "Set-Cookie": setCookie(c.req, "", 0) });
}, true);
route("POST", "/api/password", async (c) => {
  const d = await c.body();
  const u = await q1(c.env, "SELECT * FROM users WHERE id=?", c.s.user_id);
  if (!safeEq(await hmacHex(await secret(c.env), String(d.current_verifier || "")), u.verifier_hash)) throw new HttpError(401, "Current password is incorrect.");
  if (!/^[0-9a-f]{32}$/.test(d.salt || "") || !/^[0-9a-f]{64}$/.test(d.verifier || "")) throw new HttpError(400, "Malformed credentials.");
  await run(c.env, "UPDATE users SET salt=?, verifier_hash=?, iterations=? WHERE id=?", d.salt, await hmacHex(await secret(c.env), d.verifier), +d.iterations || ITER, u.id);
  await run(c.env, "DELETE FROM sessions WHERE user_id=? AND token_hash<>?", u.id, c.s.token_hash);
  await audit(c.env, "password_changed", u.username);
  return { ok: true };
});
route("POST", "/api/mfa/setup", async (c) => {
  const u = await q1(c.env, "SELECT username FROM users WHERE id=?", c.s.user_id);
  const sec = b32encode(rand(20));
  await kvSet(c.env, "pending_totp", sec);
  return { secret: sec, uri: `otpauth://totp/Vantage:${encodeURIComponent(u.username)}?secret=${sec}&issuer=Vantage&digits=6&period=30` };
});
route("POST", "/api/mfa/enable", async (c) => {
  const sec = await kvGet(c.env, "pending_totp");
  if (!sec || !(await verifyTotp(sec, (await c.body()).code))) throw new HttpError(400, "Code didn't match. Check your authenticator's clock and try again.");
  const codes = Array.from({ length: 10 }, () => hex(rand(2)) + "-" + hex(rand(2)));
  const hashes = await Promise.all(codes.map((x) => sha256(x)));
  await run(c.env, "UPDATE users SET totp_secret=?, totp_enabled=1, recovery=? WHERE id=?", sec, JSON.stringify(hashes), c.s.user_id);
  await run(c.env, "DELETE FROM kv WHERE k='pending_totp'");
  await audit(c.env, "mfa_enabled", "");
  return { ok: true, recovery: codes };
});
route("POST", "/api/mfa/disable", async (c) => {
  const u = await q1(c.env, "SELECT * FROM users WHERE id=?", c.s.user_id);
  if (!safeEq(await hmacHex(await secret(c.env), String((await c.body()).verifier || "")), u.verifier_hash)) throw new HttpError(401, "Password is incorrect.");
  await run(c.env, "UPDATE users SET totp_enabled=0, totp_secret=NULL, recovery='[]' WHERE id=?", u.id);
  await audit(c.env, "mfa_disabled", "");
  return { ok: true };
});
route("GET", "/api/sessions", async (c) => ({
  sessions: (await q(c.env, "SELECT created, last_seen, ip, ua, token_hash FROM sessions WHERE user_id=? AND mfa_pending=0 ORDER BY last_seen DESC", c.s.user_id))
    .map((s) => ({ created: s.created, last_seen: s.last_seen, ip: s.ip, ua: s.ua, current: s.token_hash === c.s.token_hash })),
  audit: await q(c.env, "SELECT * FROM audit ORDER BY ts DESC LIMIT 40"),
}));
route("POST", "/api/sessions/revoke", async (c) => { await run(c.env, "DELETE FROM sessions WHERE user_id=? AND token_hash<>?", c.s.user_id, c.s.token_hash); await audit(c.env, "sessions_revoked"); return { ok: true }; });
route("POST", "/api/space", async (c) => {
  const sp = (await c.body()).space;
  if (!["live", "demo"].includes(sp)) throw new HttpError(400, "Unknown space");
  if (sp === "demo") await ensureDemo(c.env);
  await run(c.env, "UPDATE sessions SET space=? WHERE token_hash=?", sp, c.s.token_hash);
  return { ok: true, space: sp };
});

// ---- boot: everything the browser engine needs in one round trip
route("GET", "/api/boot", async (c) => {
  const sp = c.space;
  if (sp === "demo") await ensureDemo(c.env);
  const since = +(c.url.searchParams.get("since") || 0);
  const recs = await q(c.env, since ? "SELECT id, kind, data, created, updated, deleted FROM records WHERE space=? AND updated>?" : "SELECT id, kind, data, created, updated, deleted FROM records WHERE space=? AND deleted=0", sp, ...(since ? [since] : []));
  const live = recs.filter((r) => !r.deleted), dead = recs.filter((r) => r.deleted).map((r) => r.id);
  const settings = {};
  for (const r of await q(c.env, "SELECT key, value FROM settings WHERE space=?", sp)) if (SETTING_KEYS.has(r.key) || r.key === "last_visit" || r.key === "last_visit_value") settings[r.key] = J(r.value);
  const alerts = await q(c.env, "SELECT * FROM alerts WHERE space=? AND status='open' ORDER BY score DESC LIMIT 150", sp);
  const seen = (await q(c.env, "SELECT key FROM seen WHERE space=? AND ts>?", sp, now() - 30 * 86400)).map((r) => r.key);
  const snaps = await q(c.env, "SELECT day, data FROM snapshots WHERE space=? ORDER BY day DESC LIMIT 400", sp);
  const idx = await q(c.env, "SELECT id, updated, ok, error FROM series");
  const jobs = await q(c.env, "SELECT * FROM jobs");
  const engine = await kvGet(c.env, "engine", {});
  const parts = [
    `"space":${JSON.stringify(sp)}`, `"server_time":${now()}`, `"full":${since ? "false" : "true"}`,
    `"records":[${live.map(rowJson).join(",")}]`, `"deleted":${JSON.stringify(dead)}`,
    `"settings":${JSON.stringify(settings)}`,
    `"alerts":[${alerts.map((a) => JSON.stringify(Object.assign({}, a, { body: undefined })).replace(/}$/, `,"body":${a.body || "{}"}}`)).join(",")}]`,
    `"seen":${JSON.stringify(seen)}`, `"snapshots":[${snaps.map((s) => `{"day":"${s.day}","data":${s.data}}`).join(",")}]`,
    `"series_index":${JSON.stringify(idx)}`, `"jobs":${JSON.stringify(jobs)}`, `"engine":${JSON.stringify(engine)}`,
  ];
  return "{" + parts.join(",") + "}";
});

route("GET", "/api/news", async (c) => {
  const since = +(c.url.searchParams.get("since") || now() - 72 * 3600);
  const rows = await q(c.env, "SELECT * FROM news WHERE published>? ORDER BY published DESC LIMIT 1500", since);
  return { items: rows };
});
route("GET", "/api/series", async (c) => {
  const ids = (c.url.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 120);
  const known = Object.fromEntries((c.url.searchParams.get("known") || "").split(",").filter(Boolean).map((x) => { const i = x.lastIndexOf("@"); return [x.slice(0, i), +x.slice(i + 1)]; }));
  if (!ids.length) return {};
  const rows = await q(c.env, `SELECT id, data, updated, error FROM series WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
  return "{" + rows.map((r) => `${JSON.stringify(r.id)}:{"updated":${r.updated || 0},"error":${JSON.stringify(r.error)}${known[r.id] && known[r.id] >= r.updated ? ',"same":true' : `,"data":${r.data || "null"}`}}`).join(",") + "}";
});
async function proxy(c) {
  const target = c.url.searchParams.get("u") || "";
  let u; try { u = new URL(target); } catch (e) { throw new HttpError(400, "Bad URL"); }
  if (u.protocol !== "https:") throw new HttpError(400, "https only");
  let allowed = PROXY_HOSTS.has(u.host);
  if (!allowed) { // calendar subscriptions the user added
    const subs = await q(c.env, "SELECT data FROM records WHERE kind='ics_sub' AND deleted=0");
    allowed = subs.some((r) => (J(r.data, {}).url || "").replace(/^webcal:/, "https:") === u.href);
  }
  if (!allowed) throw new HttpError(403, "Host not allowed");
  const isPost = c.req.method === "POST";
  if (isPost && u.host !== "api.bls.gov") throw new HttpError(403, "POST not allowed for this host");
  const ttl = Math.max(60, Math.min(86400 * 7, +(c.url.searchParams.get("ttl") || 900)));
  const body = isPost ? await c.req.text() : undefined;
  const cache = typeof caches !== "undefined" && caches.default;
  const key = new Request("https://vantage-cache.internal/" + encodeURIComponent(u.href + (body ? "#" + hash53(body) : "")));
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const r = await upstream(c.env, u.href, { ttl, method: isPost ? "POST" : "GET", body, headers: isPost ? { "Content-Type": "application/json" } : {} });
  const resp = new Response(r.body, { status: r.status, headers: { "Content-Type": r.headers.get("Content-Type") || "application/octet-stream", "Cache-Control": `private, max-age=${ttl}`, "X-Fetched": String(now()), ...SEC_HEADERS } });
  if (cache && r.ok) c.ctx.waitUntil(cache.put(key, resp.clone()));
  return resp;
}
route("GET", "/api/px", proxy);
route("POST", "/api/px", proxy);

// ---- records
route("GET", "/api/r/(\\w+)", async (c, kind) => {
  if (!KINDS.has(kind)) throw new HttpError(404, "Unknown type");
  return `{"items":[${(await q(c.env, "SELECT * FROM records WHERE space=? AND kind=? AND deleted=0 ORDER BY created", c.space, kind)).map(rowJson).join(",")}]}`;
});
route("GET", "/api/r/(\\w+)/([\\w-]+)", async (c, kind, id) => { const r = await getRecord(c.env, c.space, id); if (!r) throw new HttpError(404, "Not found"); return r; });
route("GET", "/api/r/(\\w+)/([\\w-]+)/revisions", async (c, kind, id) => ({ revisions: (await q(c.env, "SELECT * FROM revisions WHERE record_id=? ORDER BY rid", id)).map((r) => ({ ts: r.ts, action: r.action, data: J(r.data, {}) })) }));
route("POST", "/api/r/(\\w+)", async (c, kind) => {
  if (!KINDS.has(kind)) throw new HttpError(404, "Unknown type");
  const d = sanitize(kind, await c.body());
  if (Array.isArray(d.__bulk)) throw new HttpError(400, "Use /api/bulk");
  return createRecord(c.env, c.space, kind, d);
});
route("POST", "/api/bulk", async (c) => { // bulk create/update (imports)
  const d = await c.body();
  const items = (d.items || []).slice(0, 3000);
  const t = now(), stmts = [];
  for (const it of items) {
    if (!KINDS.has(it.kind)) continue;
    const body = JSON.stringify(clean(sanitize(it.kind, it.data)));
    if (it.id) {
      stmts.push(c.env.DB.prepare("UPDATE records SET data=?, updated=? WHERE id=? AND space=?").bind(body, t, it.id, c.space));
      stmts.push(c.env.DB.prepare("INSERT INTO revisions (record_id, ts, action, data) VALUES (?,?,?,?)").bind(it.id, t, "update", body));
    } else {
      const id = it.kind.slice(0, 3) + "_" + b64url(rand(8)).replace(/[-_]/g, "x");
      stmts.push(c.env.DB.prepare("INSERT INTO records VALUES (?,?,?,?,?,?,0)").bind(id, c.space, it.kind, body, t, t));
      if (it.kind !== "contact") stmts.push(c.env.DB.prepare("INSERT INTO revisions (record_id, ts, action, data) VALUES (?,?,?,?)").bind(id, t, "create", body));
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  return { ok: true, written: items.length };
});
route("PUT", "/api/r/(\\w+)/([\\w-]+)", async (c, kind, id) => {
  const cur = await getRecord(c.env, c.space, id);
  if (!cur) throw new HttpError(404, "Not found");
  const d = sanitize(kind, await c.body());
  if (kind === "decision" && now() - cur._created > 86400) {
    const locked = ["decision", "rationale", "assumptions", "alternatives", "expectations", "date", "title", "price_at_decision"];
    if (locked.some((k) => k in d && JSON.stringify(d[k]) !== JSON.stringify(cur[k]))) throw new HttpError(409, "Original reasoning is locked after 24 hours so hindsight can't rewrite it. Add a review instead.");
  }
  return updateRecord(c.env, c.space, id, d, c.url.searchParams.get("replace") !== "1");
});
route("DELETE", "/api/r/(\\w+)/([\\w-]+)", async (c, kind, id) => {
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE records SET deleted=1, updated=? WHERE id=? AND space=?").bind(now(), id, c.space),
    c.env.DB.prepare("INSERT INTO revisions (record_id, ts, action, data) VALUES (?,?,?,?)").bind(id, now(), "delete", "{}"),
  ]);
  return { ok: true };
});

// ---- alerts, seen, visits, snapshots, settings
route("GET", "/api/alerts", async (c) => {
  const st = c.url.searchParams.get("status") || "open";
  const rows = await q(c.env, "SELECT * FROM alerts WHERE space=? AND status=? ORDER BY score DESC LIMIT 200", c.space, st);
  return { alerts: rows.map((a) => Object.assign(a, { body: J(a.body, {}) })), weights: await getSetting(c.env, c.space, "kind_weights", {}), muted: await getSetting(c.env, c.space, "muted_kinds", []) };
});
route("POST", "/api/alerts/upsert", async (c) => {
  const d = await c.body();
  const list = (d.alerts || []).slice(0, 200);
  for (const a of list) if (a && a.key && a.kind && a.title) await upsertAlert(c.env, c.space, a, "app");
  if (d.stale_before) await run(c.env, "UPDATE alerts SET status='stale' WHERE space=? AND status='open' AND origin='app' AND updated<?", c.space, +d.stale_before);
  return { ok: true, n: list.length };
});
route("POST", "/api/alerts/([\\w]+)/feedback", async (c, id) => {
  const fb = (await c.body()).fb;
  const a = await q1(c.env, "SELECT * FROM alerts WHERE id=? AND space=?", id, c.space);
  if (!a) throw new HttpError(404, "Not found");
  const kw = await getSetting(c.env, c.space, "kind_weights", {});
  let w = +(kw[a.kind] || 1);
  if (fb === "useful") w = Math.min(1.6, w * 1.1);
  else if (fb === "noise") { w = Math.max(0.3, w * 0.8); await run(c.env, "UPDATE alerts SET status='dismissed' WHERE id=?", id); }
  else if (fb === "mute") { const m = await getSetting(c.env, c.space, "muted_kinds", []); if (!m.includes(a.kind)) m.push(a.kind); await setSetting(c.env, c.space, "muted_kinds", m); await run(c.env, "UPDATE alerts SET status='dismissed' WHERE space=? AND kind=?", c.space, a.kind); }
  else if (fb === "done" || fb === "dismiss") await run(c.env, "UPDATE alerts SET status='dismissed' WHERE id=?", id);
  else if (fb === "snooze") await run(c.env, "UPDATE alerts SET status='snoozed', updated=? WHERE id=?", now(), id);
  else throw new HttpError(400, "Unknown feedback");
  kw[a.kind] = w;
  await setSetting(c.env, c.space, "kind_weights", kw);
  await run(c.env, "UPDATE alerts SET feedback=? WHERE id=?", fb, id);
  return { ok: true };
});
route("POST", "/api/alerts/unmute", async (c) => { await setSetting(c.env, c.space, "muted_kinds", []); await setSetting(c.env, c.space, "kind_weights", {}); return { ok: true }; });
route("POST", "/api/seen", async (c) => {
  const keys = ((await c.body()).keys || []).slice(0, 300);
  const stmts = keys.map((k) => c.env.DB.prepare("INSERT OR REPLACE INTO seen VALUES (?,?,?)").bind(c.space, String(k).slice(0, 120), now()));
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  return { ok: true };
});
route("POST", "/api/visit", async (c) => {
  const d = await c.body();
  const last = await getSetting(c.env, c.space, "last_visit", 0);
  if (now() - last < 15 * 60) return { ok: true, unchanged: true };
  await setSetting(c.env, c.space, "last_visit", now());
  if (d.value) await setSetting(c.env, c.space, "last_visit_value", +d.value);
  return { ok: true };
});
route("POST", "/api/snapshot", async (c) => {
  const d = await c.body();
  const day = String(d.day || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const prev = await q1(c.env, "SELECT data FROM snapshots WHERE space=? AND day=?", c.space, day);
  const body = Object.assign(prev ? J(prev.data, {}) : {}, d.data || {});
  await run(c.env, "INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)", c.space, day, now(), JSON.stringify(body));
  return { ok: true };
});
route("GET", "/api/settings", async (c) => {
  const out = {};
  for (const r of await q(c.env, "SELECT key, value FROM settings WHERE space=?", c.space)) if (SETTING_KEYS.has(r.key)) out[r.key] = J(r.value);
  out.sec_contact = (await getSetting(c.env, "live", "sec_contact")) || "";
  out.anthropic_model = (await getSetting(c.env, "live", "anthropic_model")) || "claude-opus-5";
  out.anthropic_key_set = !!(await getSetting(c.env, "live", "anthropic_key"));
  return out;
});
route("POST", "/api/settings", async (c) => {
  const d = await c.body();
  for (const [k, v] of Object.entries(d)) {
    if (SETTING_KEYS.has(k)) await setSetting(c.env, c.space, k, v);
    else if (LIVE_ONLY.has(k)) {
      if (k === "anthropic_key" && v && !String(v).startsWith("sk-")) throw new HttpError(400, "That doesn't look like an Anthropic API key.");
      await setSetting(c.env, "live", k, v ? String(v).trim() : null);
    } else throw new HttpError(400, "Unknown setting: " + k);
  }
  return { ok: true };
});
route("POST", "/api/ai", async (c) => callClaude(c.env, await c.body()));
route("POST", "/api/tick", async (c) => {
  const only = (await c.body()).jobs;
  return { results: await tick(c.env, only && only.length ? only : null) };
});
route("GET", "/api/status", async (c) => ({
  jobs: await q(c.env, "SELECT * FROM jobs ORDER BY name"), series: await q(c.env, "SELECT id, updated, ok, error FROM series ORDER BY id"),
  engine: await kvGet(c.env, "engine", {}), news_items: (await q1(c.env, "SELECT COUNT(*) n FROM news")).n,
  counts: Object.fromEntries((await q(c.env, "SELECT kind, COUNT(*) n FROM records WHERE space=? AND deleted=0 GROUP BY kind", c.space)).map((r) => [r.kind, r.n])),
  ai: { ok: !!(await getSetting(c.env, "live", "anthropic_key")) }, schedule: "every 5 minutes",
}));
route("GET", "/api/export", async (c) => {
  const recs = await q(c.env, "SELECT * FROM records WHERE space=? AND deleted=0", c.space);
  const settings = {};
  for (const r of await q(c.env, "SELECT key, value FROM settings WHERE space=?", c.space)) if (SETTING_KEYS.has(r.key)) settings[r.key] = J(r.value);
  const body = `{"vantage_export":2,"space":${JSON.stringify(c.space)},"exported":${now()},"settings":${JSON.stringify(settings)},"records":[${recs.map(rowJson).join(",")}]}`;
  return c.reply(body, { "Content-Disposition": `attachment; filename="vantage-${c.space}-${new Date().toISOString().slice(0, 10)}.json"` });
});
route("POST", "/api/import", async (c) => {
  const d = await c.body();
  if (![1, 2].includes(d.vantage_export)) throw new HttpError(400, "Not a Vantage export file");
  let n = 0; const stmts = [];
  for (const it of d.records || []) {
    const kind = it._kind || it.kind; const data = it.data || clean(it);
    if (!KINDS.has(kind)) continue;
    stmts.push(c.env.DB.prepare("INSERT OR IGNORE INTO records VALUES (?,?,?,?,?,?,0)").bind(it.id || kind.slice(0, 3) + "_" + hash53(JSON.stringify(data)), c.space, kind, JSON.stringify(clean(data)), it._created || now(), now()));
    n++;
  }
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  return { imported: n };
});
route("POST", "/api/demo/reset", async (c) => {
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM records WHERE space='demo'"), c.env.DB.prepare("DELETE FROM settings WHERE space='demo'"), c.env.DB.prepare("DELETE FROM alerts WHERE space='demo'"), c.env.DB.prepare("DELETE FROM snapshots WHERE space='demo'")]);
  await ensureDemo(c.env);
  return { ok: true };
});

// ------------------------------------------------------------------ entry points
async function handleApi(req, env, ctx) {
  const url = new URL(req.url);
  if (req.method !== "GET") {
    if (req.headers.get("X-Vantage") !== "1") throw new HttpError(403, "Missing request header");
    const origin = req.headers.get("Origin");
    if (origin && new URL(origin).host !== url.host) throw new HttpError(403, "Cross-origin request blocked");
  }
  for (const [m, rx, fn, open] of ROUTES) {
    if (m !== req.method) continue;
    const mt = url.pathname.match(rx);
    if (!mt) continue;
    const c = { req, env, ctx, url, body: async () => { const t = await req.text(); if (t.length > 8e6) throw new HttpError(413, "Too large"); return t ? J(t, {}) || {} : {}; },
      reply: (data, headers) => json(data, 200, env.HARNESS && headers && headers["Set-Cookie"] ? Object.assign({}, headers, { "X-Harness-Set-Cookie": headers["Set-Cookie"] }) : headers) };
    if (!open) {
      const s = await getSession(env, req);
      if (!s || s.mfa_pending) throw new HttpError(401, "Not signed in");
      c.s = s; c.space = s.space;
    }
    const out = await fn(c, ...mt.slice(1));
    return out instanceof Response ? out : json(out);
  }
  throw new HttpError(404, "Not found");
}

const PUBLIC_ASSETS = new Set(["/login", "/login.html", "/js/auth.js", "/app.css", "/favicon.svg"]);

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, env, ctx);
      // Static app: only the sign-in page is public; everything else needs a session.
      if (!env.ASSETS) return new Response("Not found", { status: 404 });
      let path = url.pathname;
      if (path === "/login") path = "/login.html";
      if (!PUBLIC_ASSETS.has(url.pathname)) {
        const s = await getSession(env, req);
        if (!s || s.mfa_pending) return Response.redirect(url.origin + "/login", 302);
        if (path === "/" || !/\.[a-z0-9]+$/i.test(path)) path = "/index.html";
      }
      const r = await env.ASSETS.fetch(new Request(url.origin + path, req));
      const h = new Headers(r.headers);
      for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
      if ((h.get("Content-Type") || "").includes("text/html")) { h.set("Content-Security-Policy", CSP); h.set("Cache-Control", "no-store"); }
      else h.set("Cache-Control", "private, no-cache");
      return new Response(r.body, { status: r.status, headers: h });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e && e.stack || e);
      return json({ error: "Server error" }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env).catch((e) => console.error("tick", e && e.stack || e)));
  },
};
