// Vantage · Cloudflare Worker
// Private API (auth, records, alerts, data), a locked-down fetch proxy for the browser engine, and the
// scheduled "engine" that keeps every data source fresh even when nobody is signed in.
//
// Free-plan design: Workers get ~10 ms of CPU per invocation, so heavy work happens in the browser.
// Password stretching (PBKDF2, 600k rounds) runs client-side; the server stores an HMAC of the result.
// Collectors fetch and store compact JSON; analysis (clustering, factor models, maps) runs in the app.

import { J, SEC_HEADERS, CSP, HttpError, json, getSession, ROUTES } from "./lib.js";
import { tick } from "./jobs.js";
import "./routes/account.js";
import "./routes/data.js";
import "./routes/records.js";
import "./routes/admin.js";

export { tick };

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
