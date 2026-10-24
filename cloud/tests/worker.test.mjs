// Worker API tests: the real worker.js against an in-memory SQLite stand-in for D1 (Node 22+, no dependencies).
//
//   node --test cloud/tests/
//
// Upstream fetches are never made: the tests only exercise auth, records and settings routes.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker/worker.js";

const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://vantage.test";
const CODE = "TEST-SETUP-CODE";
const SALT = "ab".repeat(16), VERIFIER = "cd".repeat(32);
const sha = (s) => createHash("sha256").update(s).digest("hex");

function d1(db) { // the subset of the D1 binding worker.js uses
  const stmt = (sql, params = []) => ({
    sql, params,
    bind: (...a) => stmt(sql, a.map((x) => (x === undefined ? null : x))),
    async all() { const p = db.prepare(sql); return p.columns().length ? { results: p.all(...params).map((r) => ({ ...r })) } : (p.run(...params), { results: [] }); },
    async first() { const r = db.prepare(sql).get(...params); return r ? { ...r } : null; },
    async run() { db.prepare(sql).run(...params); return { success: true }; },
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); return []; } };
}

let env, db, cookie;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  db.prepare("INSERT INTO kv VALUES ('setup_code_hash', ?, 0)").run(JSON.stringify(sha(CODE)));
  env = { DB: d1(db) };
  cookie = null;
});

async function call(method, path, body, headers = {}) {
  const h = { "X-Vantage": "1", "Content-Type": "application/json", ...headers };
  if (cookie) h.Cookie = cookie;
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  const sc = res.headers.get("Set-Cookie");
  if (sc) cookie = sc.split(";")[0];
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, body: json, headers: res.headers };
}
async function signIn() {
  assert.equal((await call("POST", "/api/setup", { code: CODE, username: "pedrum", salt: SALT, verifier: VERIFIER, iterations: 600000 })).status, 200);
  assert.equal((await call("POST", "/api/login", { username: "pedrum", verifier: VERIFIER })).status, 200);
}
function totp(secretB32, step) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = ""; for (const ch of secretB32) bits += alpha.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", key).update(msg).digest(); const o = mac[19] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}
const age = (id, days) => db.prepare("UPDATE records SET created=? WHERE id=?").run(Date.now() / 1000 - days * 86400, id);

test("records need a session and the CSRF header", async () => {
  assert.equal((await call("GET", "/api/r/note")).status, 401);
  await signIn();
  assert.equal((await call("GET", "/api/r/note")).status, 200);
  assert.equal((await call("POST", "/api/r/note", { title: "x" }, { "X-Vantage": "0" })).status, 403);
});

test("the URL kind must match the stored record", async () => {
  await signIn();
  const { body: rec } = await call("POST", "/api/r/note", { title: "n" });
  for (const [m, p] of [["GET", "/api/r/contact/ID"], ["GET", "/api/r/contact/ID/revisions"], ["PUT", "/api/r/contact/ID"], ["DELETE", "/api/r/contact/ID"]])
    assert.equal((await call(m, p.replace("ID", rec.id), m === "PUT" ? {} : undefined)).status, 404, m + " " + p);
  assert.equal((await call("GET", "/api/r/note/" + rec.id)).body.title, "n");
});

test("live records stay out of the demo workspace", async () => {
  await signIn();
  const { body: rec } = await call("POST", "/api/r/note", { title: "private" });
  assert.equal((await call("POST", "/api/space", { space: "demo" })).status, 200);
  assert.equal((await call("GET", "/api/r/note/" + rec.id + "/revisions")).status, 404);
  assert.equal((await call("DELETE", "/api/r/note/" + rec.id)).status, 404);
});

test("a decision's original reasoning is locked after 24 hours", async () => {
  await signIn();
  const { body: rec } = await call("POST", "/api/r/decision", { title: "Buy X", rationale: "cheap" });
  age(rec.id, 2);
  assert.equal((await call("PUT", "/api/r/decision/" + rec.id, { rationale: "hindsight" })).status, 409);
  assert.equal((await call("PUT", "/api/r/note/" + rec.id, { rationale: "hindsight" })).status, 404, "kind swap can't skip the lock");
  assert.equal((await call("POST", "/api/bulk", { items: [{ kind: "decision", id: rec.id, data: { rationale: "hindsight" } }] })).status, 409);
  assert.equal((await call("POST", "/api/bulk", { items: [{ kind: "note", id: rec.id, data: { rationale: "hindsight" } }] })).body.written, 0);
  const r = await call("PUT", "/api/r/decision/" + rec.id + "?replace=1", { reviews: [{ note: "ok" }] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.title, r.body.rationale, r.body.reviews], ["Buy X", "cheap", [{ note: "ok" }]]);
});

test("bulk import creates and updates holdings", async () => {
  await signIn();
  const { body: h } = await call("POST", "/api/r/holding", { ticker: "abc", quantity: 1 });
  const r = await call("POST", "/api/bulk", { items: [
    { kind: "holding", id: h.id, data: { ticker: "ABC", quantity: "2" } },
    { kind: "holding", data: { ticker: "xyz", quantity: 3 } },
    { kind: "holding", id: "hol_missing", data: { ticker: "Q" } },
  ] });
  assert.equal(r.body.written, 2);
  const items = (await call("GET", "/api/r/holding")).body.items.map((x) => [x.data.ticker, x.data.quantity]).sort();
  assert.deepEqual(items, [["ABC", 2], ["XYZ", 3]]);
});

test("a TOTP code is accepted only once", async () => {
  await signIn();
  const { body: setup } = await call("POST", "/api/mfa/setup", {});
  const step = Math.floor(Date.now() / 30000);
  assert.equal((await call("POST", "/api/mfa/enable", { code: totp(setup.secret, step - 1) })).status, 200);
  await call("POST", "/api/logout", {});
  assert.equal((await call("POST", "/api/login", { username: "pedrum", verifier: VERIFIER })).body.mfa, true);
  assert.equal((await call("POST", "/api/mfa", { code: totp(setup.secret, step - 1) })).status, 401, "replayed code");
  assert.equal((await call("POST", "/api/mfa", { code: totp(setup.secret, step) })).status, 200);
});

test("password change can't weaken the stretching", async () => {
  await signIn();
  assert.equal((await call("POST", "/api/password", { current_verifier: VERIFIER, salt: SALT, verifier: "ef".repeat(32), iterations: 1 })).status, 400);
  assert.equal((await call("POST", "/api/password", { current_verifier: VERIFIER, salt: SALT, verifier: "ef".repeat(32), iterations: 600000 })).status, 200);
});

test("a malformed snapshot day can't break /api/boot", async () => {
  await signIn();
  assert.equal((await call("POST", "/api/snapshot", { day: '2026"x', data: {} })).status, 400);
  assert.equal((await call("POST", "/api/snapshot", { day: "2026-10-24", data: { total: 1 } })).status, 200);
  db.prepare("INSERT INTO snapshots VALUES ('live', 'a\"b', 0, '{}')").run(); // e.g. written by an older build
  const boot = await call("GET", "/api/boot");
  assert.equal(boot.status, 200);
  assert.ok(boot.body, "boot returns valid JSON");
});

test("failed-login rows store a bounded username", async () => {
  await signIn();
  await call("POST", "/api/logout", {});
  await call("POST", "/api/login", { username: "x".repeat(5000), verifier: "00".repeat(32) });
  assert.ok(db.prepare("SELECT MAX(LENGTH(username)) n FROM attempts").get().n <= 64);
});

test("import validates rows, writes revisions and never overwrites", async () => {
  await signIn();
  const { body: keep } = await call("POST", "/api/r/note", { title: "mine" });
  const r = await call("POST", "/api/import", { vantage_export: 2, records: [
    { id: "not_new1", _kind: "note", _created: 1, data: { title: "imported" } },
    { id: keep.id, _kind: "note", data: { title: "overwrite?" } },
    { id: "bad id!", _kind: "note", data: {} }, "junk",
    { _kind: "holding", data: { ticker: "abc", quantity: "lots" } },
  ] });
  assert.deepEqual(r.body, { imported: 1, skipped: 4 });
  assert.equal((await call("GET", "/api/r/note/" + keep.id)).body.title, "mine");
  assert.equal((await call("GET", "/api/r/note/not_new1/revisions")).body.revisions.length, 1);
  const v1 = await call("POST", "/api/import", { vantage_export: 1, records: { note: [{ id: "not_new2", title: "from local" }] } });
  assert.deepEqual(v1.body, { imported: 1, skipped: 0 });
});

test("stale and expired-snooze alerts reopen when they fire again", async () => {
  await signIn();
  const fire = () => call("POST", "/api/alerts/upsert", { alerts: [{ key: "k1", kind: "price", title: "t" }] });
  const status = () => db.prepare("SELECT status FROM alerts WHERE key='k1'").get().status;
  await fire();
  db.prepare("UPDATE alerts SET status='stale'").run(); await fire(); assert.equal(status(), "open");
  db.prepare("UPDATE alerts SET status='snoozed', updated=?").run(Date.now() / 1000 - 60); await fire(); assert.equal(status(), "snoozed");
  db.prepare("UPDATE alerts SET updated=?").run(Date.now() / 1000 - 4 * 86400); await fire(); assert.equal(status(), "open");
  db.prepare("UPDATE alerts SET status='dismissed'").run(); await fire(); assert.equal(status(), "dismissed");
});
