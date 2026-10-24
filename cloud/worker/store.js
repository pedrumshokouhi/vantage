// Records (with revisions), demo seeding and alerts.
import { demoSeed } from "./demo.js";
import { run, J, SNOOZE, now, b64url, rand, hash53, HttpError, q1, getSetting } from "./lib.js";

// ------------------------------------------------------------------ records
export function rowJson(r) {
  // Build JSON by concatenation so large tables don't pay a parse+stringify round trip (CPU budget).
  return `{"id":${JSON.stringify(r.id)},"_kind":${JSON.stringify(r.kind)},"_created":${r.created},"_updated":${r.updated},"data":${r.data || "{}"}}`;
}
export function clean(d) { const o = {}; for (const [k, v] of Object.entries(d || {})) if (!k.startsWith("_") && k !== "id") o[k] = v; return o; }
export async function getRecord(env, space, id) {
  const r = await q1(env, "SELECT * FROM records WHERE space=? AND id=? AND deleted=0", space, id);
  if (!r) return null;
  return Object.assign(J(r.data, {}), { id: r.id, _kind: r.kind, _created: r.created, _updated: r.updated });
}
export async function createRecord(env, space, kind, data, id, ts) {
  id = id || kind.slice(0, 3) + "_" + b64url(rand(8)).replace(/[-_]/g, "x");
  const t = ts || now(), body = JSON.stringify(clean(data));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO records VALUES (?,?,?,?,?,?,0)").bind(id, space, kind, body, t, t),
    env.DB.prepare("INSERT INTO revisions (record_id, ts, action, data) VALUES (?,?,?,?)").bind(id, t, "create", body),
  ]);
  return getRecord(env, space, id);
}
export async function updateRecord(env, space, id, data, merge = true) {
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
export function sanitize(kind, d) {
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

export async function ensureDemo(env) {
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
export async function upsertAlert(env, space, a, origin) {
  const kw = await getSetting(env, space, "kind_weights", {});
  const muted = await getSetting(env, space, "muted_kinds", []);
  if (muted.includes(a.kind)) return;
  const rel = +a.relevance || 0, imp = +a.impact || 0, urg = +a.urgency || 0, conf = +a.confidence || 0;
  const score = (0.35 * rel + 0.3 * imp + 0.2 * urg + 0.15 * conf) * (+(kw[a.kind] || 1));
  const id = "al_" + hash53(space + a.key);
  const t = now();
  const ex = await q1(env, "SELECT id, status FROM alerts WHERE space=? AND key=?", space, a.key);
  if (ex) {
    // A signal that fires again comes back: a stale one at once, a snoozed one once its snooze has run out.
    // A snoozed row keeps its `updated` (the moment it was snoozed) so the snooze can expire; dismissed stays dismissed.
    await run(env, "UPDATE alerts SET title=?, body=?, relevance=?, impact=?, urgency=?, confidence=?, score=?, " +
      "status=CASE WHEN status='stale' OR (status='snoozed' AND updated<?) THEN 'open' ELSE status END, " +
      "updated=CASE WHEN status='snoozed' AND updated>=? THEN updated ELSE ? END WHERE id=?",
      a.title, JSON.stringify(a.body || {}), rel, imp, urg, conf, score, t - SNOOZE, t - SNOOZE, t, ex.id);
  } else {
    await run(env, "INSERT INTO alerts (id, space, key, kind, title, body, relevance, impact, urgency, confidence, score, created, updated, status, group_key, origin) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, space, a.key, a.kind, a.title, JSON.stringify(a.body || {}), rel, imp, urg, conf, score, t, t, "open", a.group_key || a.key, origin || "app");
  }
  // a newer alert in the same series (next month, next rate move) retires the open older ones
  if (a.supersede) await run(env, "UPDATE alerts SET status='stale', updated=? WHERE space=? AND key LIKE ? AND key<>? AND status='open'", t, space, a.supersede + "%", a.key);
}
