// Record routes: CRUD, revisions, bulk import and the decision lock.
import { J, KINDS, now, b64url, rand, q, HttpError, route } from "../lib.js";
import { rowJson, clean, getRecord, createRecord, updateRecord, sanitize } from "../store.js";

// ---- records
route("GET", "/api/r/(\\w+)", async (c, kind) => {
  if (!KINDS.has(kind)) throw new HttpError(404, "Unknown type");
  return `{"items":[${(await q(c.env, "SELECT * FROM records WHERE space=? AND kind=? AND deleted=0 ORDER BY created", c.space, kind)).map(rowJson).join(",")}]}`;
});
// The URL's kind must match the stored record in the current space: otherwise a demo session could read live
// revisions, and PUT /api/r/note/<decision id> would skip the decision lock below.
async function recordOr404(c, kind, id) {
  if (!KINDS.has(kind)) throw new HttpError(404, "Unknown type");
  const r = await getRecord(c.env, c.space, id);
  if (!r || r._kind !== kind) throw new HttpError(404, "Not found");
  return r;
}
const DECISION_LOCKED = ["decision", "rationale", "assumptions", "alternatives", "expectations", "date", "title", "price_at_decision"];
const isLocked = (rec) => rec._kind === "decision" && now() - rec._created > 86400;
const touchesLocked = (rec, d) => DECISION_LOCKED.some((k) => k in d && JSON.stringify(d[k]) !== JSON.stringify(rec[k]));

route("GET", "/api/r/(\\w+)/([\\w-]+)", async (c, kind, id) => recordOr404(c, kind, id));
route("GET", "/api/r/(\\w+)/([\\w-]+)/revisions", async (c, kind, id) => {
  await recordOr404(c, kind, id);
  return { revisions: (await q(c.env, "SELECT * FROM revisions WHERE record_id=? ORDER BY rid", id)).map((r) => ({ ts: r.ts, action: r.action, data: J(r.data, {}) })) };
});
route("POST", "/api/r/(\\w+)", async (c, kind) => {
  if (!KINDS.has(kind)) throw new HttpError(404, "Unknown type");
  const d = sanitize(kind, await c.body());
  if (Array.isArray(d.__bulk)) throw new HttpError(400, "Use /api/bulk");
  return createRecord(c.env, c.space, kind, d);
});
route("POST", "/api/bulk", async (c) => { // bulk create/update (imports)
  const d = await c.body();
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 3000).filter((it) => it && KINDS.has(it.kind));
  // updates may only touch existing records of the same kind in this space, and never a locked decision
  const ids = [...new Set(items.filter((it) => it.id).map((it) => String(it.id)))];
  const existing = new Map();
  for (let i = 0; i < ids.length; i += 90) { // D1 caps bound parameters at 100 per statement
    const part = ids.slice(i, i + 90);
    for (const r of await q(c.env, `SELECT id, kind, data, created FROM records WHERE space=? AND deleted=0 AND id IN (${part.map(() => "?").join(",")})`, c.space, ...part))
      existing.set(r.id, Object.assign(J(r.data, {}), { _kind: r.kind, _created: r.created }));
  }
  const t = now(), stmts = [];
  let written = 0;
  for (const it of items) {
    const data = sanitize(it.kind, it.data);
    if (it.id) {
      const cur = existing.get(String(it.id));
      if (!cur || cur._kind !== it.kind) continue;
      if (isLocked(cur) && touchesLocked(cur, data)) throw new HttpError(409, "Original reasoning is locked after 24 hours so hindsight can't rewrite it. Add a review instead.");
    }
    const body = JSON.stringify(clean(data));
    written++;
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
  return { ok: true, written };
});
route("PUT", "/api/r/(\\w+)/([\\w-]+)", async (c, kind, id) => {
  const cur = await recordOr404(c, kind, id);
  const d = sanitize(kind, await c.body());
  const merge = c.url.searchParams.get("replace") !== "1";
  if (isLocked(cur)) {
    if (touchesLocked(cur, d)) throw new HttpError(409, "Original reasoning is locked after 24 hours so hindsight can't rewrite it. Add a review instead.");
    if (!merge) for (const k of DECISION_LOCKED) if (k in cur) d[k] = cur[k]; // a full replace may not drop them either
  }
  return updateRecord(c.env, c.space, id, d, merge);
});
route("DELETE", "/api/r/(\\w+)/([\\w-]+)", async (c, kind, id) => {
  await recordOr404(c, kind, id);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE records SET deleted=1, updated=? WHERE id=? AND space=?").bind(now(), id, c.space),
    c.env.DB.prepare("INSERT INTO revisions (record_id, ts, action, data) VALUES (?,?,?,?)").bind(id, now(), "delete", "{}"),
  ]);
  return { ok: true };
});
