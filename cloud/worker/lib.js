// Shared helpers: constants, crypto, D1 access, sessions and TOTP, plus the route table every routes/* module registers into.

export const KINDS = new Set(["holding", "contact", "event", "decision", "note", "watch", "plan", "scenario", "investor", "ics_sub"]);
export const SETTING_KEYS = new Set(["base_currency", "interests", "objectives", "constraints", "max_position", "max_sector", "benchmark", "topic_weights",
  "muted", "muted_kinds", "kind_weights", "home_mode", "timezones", "ask_history", "theme", "watch_countries", "alert_thresholds"]);
export const LIVE_ONLY = new Set(["anthropic_key", "anthropic_model", "sec_contact"]);
export const ITER = 600000;
export const SNOOZE = 3 * 86400;
const IDLE = 12 * 3600, SHORT = 12 * 3600, LONGTTL = 30 * 86400;
export const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Vantage/2";
const enc = new TextEncoder();

// ------------------------------------------------------------------ utilities
export const now = () => Date.now() / 1000;
export const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
export async function sha256(s) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
export async function hmacHex(keyHex, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(keyHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
export function safeEq(a, b) {
  a = String(a || ""); b = String(b || "");
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
export function hash53(str, seed = 7) { // fast non-crypto id hash
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export const J = (s, d = null) => { try { return JSON.parse(s); } catch (e) { return d; } };

export const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Cross-Origin-Opener-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow, noarchive", "Strict-Transport-Security": "max-age=31536000",
};
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export function json(data, status = 200, extra = {}) {
  return new Response(typeof data === "string" ? data : JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SEC_HEADERS, ...extra },
  });
}

// ------------------------------------------------------------------ small D1 helpers
export const q = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
export const q1 = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
export const run = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();

export async function kvGet(env, k, d = null) { const r = await q1(env, "SELECT v FROM kv WHERE k=?", k); return r ? J(r.v, d) : d; }
export async function kvSet(env, k, v) { await run(env, "INSERT OR REPLACE INTO kv (k, v, updated) VALUES (?,?,?)", k, JSON.stringify(v), now()); }
export async function secret(env) {
  let s = await kvGet(env, "secret");
  if (!s) { s = hex(rand(32)); await kvSet(env, "secret", s); }
  return s;
}
export async function getSetting(env, space, key, d = null) { const r = await q1(env, "SELECT value FROM settings WHERE space=? AND key=?", space, key); return r ? J(r.value, d) : d; }
export async function setSetting(env, space, key, v) { await run(env, "INSERT OR REPLACE INTO settings (space, key, value) VALUES (?,?,?)", space, key, JSON.stringify(v)); }
export async function audit(env, event, detail = "") { await run(env, "INSERT INTO audit VALUES (?,?,?)", now(), event, String(detail).slice(0, 400)); }

// ------------------------------------------------------------------ sessions
function cookieName(req) { return new URL(req.url).protocol === "https:" ? "__Host-vt" : "vt"; }
export function readToken(req, env) {
  const raw = req.headers.get("Cookie") || (env.HARNESS ? req.headers.get("X-Harness-Cookie") : "") || "";
  const name = cookieName(req);
  for (const part of raw.split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1); }
  return null;
}
export function setCookie(req, token, ttl) {
  const secure = new URL(req.url).protocol === "https:";
  return `${cookieName(req)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttl}${secure ? "; Secure" : ""}`;
}
export async function newSession(env, req, userId, remember, mfaPending) {
  const token = b64url(rand(32));
  const ttl = mfaPending ? 300 : remember ? LONGTTL : SHORT;
  const prev = await q1(env, "SELECT space FROM sessions WHERE user_id=? ORDER BY last_seen DESC LIMIT 1", userId);
  await run(env, "INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)", await sha256(token), userId, now(), now(), now() + ttl,
    ip(req), (req.headers.get("User-Agent") || "").slice(0, 200), prev ? prev.space : "live", mfaPending ? 1 : 0, remember ? 1 : 0);
  return { token, ttl };
}
export async function getSession(env, req) {
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
export const ip = (req) => req.headers.get("CF-Connecting-IP") || "local";

export async function lockout(env, ipAddr, user) {
  const win = now() - 3600;
  const a = await q1(env, "SELECT COUNT(*) n FROM attempts WHERE ok=0 AND ts>? AND (ip=? OR username=?)", win, ipAddr, user);
  const n = a ? a.n : 0;
  if (n < 5) return 0;
  const last = await q1(env, "SELECT MAX(ts) t FROM attempts WHERE ok=0 AND (ip=? OR username=?)", ipAddr, user);
  return Math.max(0, Math.round((last.t || 0) + Math.min(2 ** (n - 4), 900) - now()));
}
export async function attempt(env, ipAddr, user, ok) {
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
export function b32encode(bytes) {
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
// An accepted code burns its time step (and every earlier one), so a code that was seen once can't be replayed.
export async function verifyTotp(env, secretB32, code) {
  code = String(code || "").replace(/\D/g, "");
  if (code.length !== 6 || !secretB32) return false;
  const step = Math.floor(now() / 30);
  for (const d of [-1, 0, 1]) {
    if (!safeEq(await totpAt(secretB32, step + d), code)) continue;
    if (step + d <= (await kvGet(env, "totp_last_step", 0))) return false;
    await kvSet(env, "totp_last_step", step + d);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ router
export const ROUTES = [];
export const route = (method, pattern, fn, open = false) => ROUTES.push([method, new RegExp("^" + pattern + "$"), fn, open]);
