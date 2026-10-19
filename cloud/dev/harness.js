// Runs the real Cloudflare Worker module inside this page for local testing.
// D1 calls go to /__sql (SQLite), upstream fetches go to /__fetch. Never shipped to Cloudflare.
(function () {
  "use strict";
  const realFetch = window.fetch.bind(window);
  const JAR = "vt_harness_cookie";

  async function sql(stmts) {
    const r = await realFetch("/__sql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stmts }) });
    const d = await r.json();
    if (!r.ok) throw new Error("D1 (local): " + d.error);
    return d;
  }
  function stmt(sqlText, params) {
    return {
      sql: sqlText, params: params || [],
      bind(...a) { return stmt(sqlText, a.map((x) => (x === undefined ? null : x))); },
      async all() { return (await sql([{ sql: this.sql, params: this.params }]))[0]; },
      async first(col) { const r = (await sql([{ sql: this.sql, params: this.params }]))[0].results[0]; return r === undefined ? null : col ? r[col] : r; },
      async run() { return (await sql([{ sql: this.sql, params: this.params }]))[0]; },
    };
  }
  const env = {
    HARNESS: true,
    DB: { prepare: (s) => stmt(s), batch: async (list) => sql(list.map((s) => ({ sql: s.sql, params: s.params }))) },
  };
  const ctx = { waitUntil() {} };
  let mod = null;
  const ready = import("/__worker/worker.js").then((m) => (mod = m));

  window.fetch = async function (input, init) {
    init = init || {};
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin === location.origin && url.pathname.startsWith("/api/")) {
      await ready;
      const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
      const ck = localStorage.getItem(JAR);
      if (ck) headers.set("X-Harness-Cookie", ck);
      const req = new Request(url.href, { method: init.method || "GET", headers, body: init.body });
      const resp = await mod.default.fetch(req, env, ctx);
      const sc = resp.headers.get("X-Harness-Set-Cookie");
      if (sc) {
        const m = sc.match(/^([^=]+)=([^;]*)/);
        if (!m || !m[2] || /Max-Age=0\b/.test(sc)) localStorage.removeItem(JAR);
        else localStorage.setItem(JAR, m[1] + "=" + m[2]);
      }
      return resp;
    }
    if (url.origin !== location.origin) {
      const fwd = {};
      new Headers(init.headers || {}).forEach((v, k) => (fwd[k] = v));
      return realFetch("/__fetch?u=" + encodeURIComponent(url.href), { method: init.method || "GET", headers: { "X-Fwd": JSON.stringify(fwd) }, body: init.body });
    }
    return realFetch(input, init);
  };
  window.__harness = { ready, env, tick: async (jobs) => { await ready; return mod.tick(env, jobs || null); } };
  console.info("[harness] Worker runs in-page; D1 → local SQLite");
})();
