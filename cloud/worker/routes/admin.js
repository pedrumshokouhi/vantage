// Alerts, seen/visit tracking, snapshots, settings, status, export/import and demo reset.
import { run, J, KINDS, SETTING_KEYS, LIVE_ONLY, now, q, hash53, HttpError, q1, kvGet, getSetting, setSetting, route } from "../lib.js";
import { rowJson, clean, sanitize, ensureDemo, upsertAlert } from "../store.js";
import { callClaude } from "../upstream.js";
import { tick } from "../jobs.js";

// ---- alerts, seen, visits, snapshots, settings
route("GET", "/api/alerts", async (c) => {
  const st = c.url.searchParams.get("status") || "open";
  const rows = await q(c.env, "SELECT * FROM alerts WHERE space=? AND status=? ORDER BY score DESC LIMIT 200", c.space, st);
  return { alerts: rows.map((a) => Object.assign(a, { body: J(a.body, {}) })), weights: await getSetting(c.env, c.space, "kind_weights", {}),
          muted: await getSetting(c.env, c.space, "muted_kinds", []) };
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
  else if (fb === "mute") {
    const m = await getSetting(c.env, c.space, "muted_kinds", []);
    if (!m.includes(a.kind)) m.push(a.kind);
    await setSetting(c.env, c.space, "muted_kinds", m);
    await run(c.env, "UPDATE alerts SET status='dismissed' WHERE space=? AND kind=?", c.space, a.kind);
  }
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, "day must be YYYY-MM-DD");
  if (d.data !== undefined && (!d.data || typeof d.data !== "object" || Array.isArray(d.data))) throw new HttpError(400, "data must be an object");
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
  // v2 exports are a list of rows; v1 (the local edition) maps each kind to a list
  let rows = d.records || [];
  if (!Array.isArray(rows) && typeof rows === "object") { // v1 export: { kind: [record, ...] }
    rows = Object.entries(rows).flatMap(([kind, list]) => (Array.isArray(list) ? list : []).map((x) => x && typeof x === "object" ? Object.assign({ _kind: kind }, x) : x));
  }
  if (!Array.isArray(rows)) throw new HttpError(400, "records must be a list");
  const items = [];
  let skipped = 0;
  for (const it of rows.slice(0, 20000)) {
    const kind = it && (it._kind || it.kind);
    if (!it || typeof it !== "object" || !KINDS.has(kind) || (it.id != null && !/^[\w-]{1,64}$/.test(String(it.id)))) { skipped++; continue; }
    let data;
    try { data = clean(sanitize(kind, Object.assign({}, it.data || clean(it)))); } catch (e) { if (e instanceof HttpError) { skipped++; continue; } throw e; }
    const id = it.id ? String(it.id) : kind.slice(0, 3) + "_" + hash53(JSON.stringify(data));
    items.push({ id, kind, body: JSON.stringify(data), created: +it._created || now() });
  }
  // ids that already exist (in any space: ids are global) are left alone, never overwritten
  const taken = new Set();
  for (let i = 0; i < items.length; i += 90) {
    const part = items.slice(i, i + 90).map((x) => x.id);
    for (const r of await q(c.env, `SELECT id FROM records WHERE id IN (${part.map(() => "?").join(",")})`, ...part)) taken.add(r.id);
  }
  const stmts = [];
  let n = 0;
  for (const x of items) {
    if (taken.has(x.id)) { skipped++; continue; }
    taken.add(x.id);
    stmts.push(c.env.DB.prepare("INSERT INTO records VALUES (?,?,?,?,?,?,0)").bind(x.id, c.space, x.kind, x.body, x.created, now()));
    stmts.push(c.env.DB.prepare("INSERT INTO revisions (record_id, ts, action, data) VALUES (?,?,?,?)").bind(x.id, x.created, "create", x.body));
    n++;
  }
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  return { imported: n, skipped };
});
route("POST", "/api/demo/reset", async (c) => {
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM records WHERE space='demo'"), c.env.DB.prepare("DELETE FROM settings WHERE space='demo'"),
                        c.env.DB.prepare("DELETE FROM alerts WHERE space='demo'"), c.env.DB.prepare("DELETE FROM snapshots WHERE space='demo'")]);
  await ensureDemo(c.env);
  return { ok: true };
});
