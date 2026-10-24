// Outbound calls: the optional Claude API, upstream fetches for collectors and the proxy, and the series cache.
import { run, J, UA, now, HttpError, q1, getSetting } from "./lib.js";

// ------------------------------------------------------------------ Claude (optional)
export async function callClaude(env, body) {
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
export async function upstream(env, url, opts = {}) {
  const u = new URL(url);
  const headers = u.host.endsWith("sec.gov") ? await secHeaders(env) : { "User-Agent": UA, Accept: "*/*" };
  const r = await fetch(url, { method: opts.method || "GET", headers: { ...headers, ...(opts.headers || {}) }, body: opts.body, cf: { cacheTtl: opts.ttl || 0 } });
  return r;
}
export async function getJson(env, url) { const r = await upstream(env, url); if (!r.ok) throw new Error(url.split("?")[0] + " → HTTP " + r.status); return r.json(); }
export async function getText(env, url) { const r = await upstream(env, url); if (!r.ok) throw new Error(url.split("?")[0] + " → HTTP " + r.status); return r.text(); }

export async function putSeries(env, id, data, error) {
  const t = now();
  if (error) await run(env, "INSERT INTO series (id, updated, error, tried) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET error=excluded.error, tried=excluded.tried", id, 0,
                       String(error).slice(0, 300), t);
  else await run(env, "INSERT INTO series (id, data, updated, ok, error, tried) VALUES (?,?,?,?,NULL,?) " +
    "ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated=excluded.updated, ok=excluded.ok, error=NULL, tried=excluded.tried",
    id, typeof data === "string" ? data : JSON.stringify(data), t, t, t);
}
export async function getSeries(env, id) { const r = await q1(env, "SELECT data, updated FROM series WHERE id=?", id); return r && r.data ? { data: J(r.data), updated: r.updated } : null; }
