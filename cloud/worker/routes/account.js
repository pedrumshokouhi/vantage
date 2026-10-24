// Account routes: setup, sign-in, MFA, password, sessions and workspace switching.
import { run, J, ITER, now, hex, rand, sha256, hmacHex, safeEq, q, ip, HttpError, q1, kvGet, kvSet, secret, getSetting, audit, readToken, setCookie, newSession, getSession, lockout, attempt,
        b32encode, verifyTotp, route } from "../lib.js";
import { ensureDemo } from "../store.js";

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
  const username = String(d.username || "").trim().toLowerCase().slice(0, 64); // also the key failed attempts are stored under
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
  let ok = await verifyTotp(c.env, u.totp_secret, code);
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
  const iterations = d.iterations === undefined ? ITER : +d.iterations;
  if (!/^[0-9a-f]{32}$/.test(d.salt || "") || !/^[0-9a-f]{64}$/.test(d.verifier || "") || !(iterations >= 300000)) throw new HttpError(400, "Malformed credentials.");
  await run(c.env, "UPDATE users SET salt=?, verifier_hash=?, iterations=? WHERE id=?", d.salt, await hmacHex(await secret(c.env), d.verifier), iterations, u.id);
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
  if (!sec || !(await verifyTotp(c.env, sec, (await c.body()).code))) throw new HttpError(400, "Code didn't match. Check your authenticator's clock and try again.");
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
route("POST", "/api/sessions/revoke", async (c) => {
  await run(c.env, "DELETE FROM sessions WHERE user_id=? AND token_hash<>?", c.s.user_id, c.s.token_hash);
  await audit(c.env, "sessions_revoked");
  return { ok: true };
});
route("POST", "/api/space", async (c) => {
  const sp = (await c.body()).space;
  if (!["live", "demo"].includes(sp)) throw new HttpError(400, "Unknown space");
  if (sp === "demo") await ensureDemo(c.env);
  await run(c.env, "UPDATE sessions SET space=? WHERE token_hash=?", sp, c.s.token_hash);
  return { ok: true, space: sp };
});
