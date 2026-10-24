// Data routes for the browser engine: boot, news, series and the locked-down fetch proxy.
import { PROXY_HOSTS } from "../sources.js";
import { J, SETTING_KEYS, now, q, hash53, SEC_HEADERS, HttpError, kvGet, route } from "../lib.js";
import { rowJson, ensureDemo } from "../store.js";
import { upstream } from "../upstream.js";

// ---- boot: everything the browser engine needs in one round trip
route("GET", "/api/boot", async (c) => {
  const sp = c.space;
  if (sp === "demo") await ensureDemo(c.env);
  const since = +(c.url.searchParams.get("since") || 0);
  const recs = await q(c.env, "SELECT id, kind, data, created, updated, deleted FROM records WHERE space=? AND " + (since ? "updated>?" : "deleted=0"),
    sp, ...(since ? [since] : []));
  const live = recs.filter((r) => !r.deleted), dead = recs.filter((r) => r.deleted).map((r) => r.id);
  const settings = {};
  for (const r of await q(c.env, "SELECT key, value FROM settings WHERE space=?", sp)) {
    if (SETTING_KEYS.has(r.key) || r.key === "last_visit" || r.key === "last_visit_value") settings[r.key] = J(r.value);
  }
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
    `"seen":${JSON.stringify(seen)}`, `"snapshots":[${snaps.map((s) => `{"day":${JSON.stringify(s.day)},"data":${s.data || "{}"}}`).join(",")}]`,
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
  const entry = (r) => `${JSON.stringify(r.id)}:{"updated":${r.updated || 0},"error":${JSON.stringify(r.error)}` +
    `${known[r.id] && known[r.id] >= r.updated ? ',"same":true' : `,"data":${r.data || "null"}`}}`;
  return "{" + rows.map(entry).join(",") + "}";
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
  // Third-party bytes served from our own origin: the app only fetch()es them, so a sandbox CSP costs nothing and
  // stops an upstream HTML/SVG body from ever running script as Vantage if it is opened directly.
  const resp = new Response(r.body, { status: r.status, headers: {
    "Content-Type": r.headers.get("Content-Type") || "application/octet-stream", "Cache-Control": `private, max-age=${ttl}`, "X-Fetched": String(now()), ...SEC_HEADERS,
    "Content-Security-Policy": "sandbox; default-src 'none'" } });
  if (cache && r.ok) c.ctx.waitUntil(cache.put(key, resp.clone()));
  return resp;
}
route("GET", "/api/px", proxy);
route("POST", "/api/px", proxy);
