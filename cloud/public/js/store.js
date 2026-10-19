/* In-browser data store: one boot call, incremental sync, and an IndexedDB cache so heavy series
   (price histories, raw source data) are only downloaded when they change. */
"use strict";
(function () {
  const idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res) => {
        let r;
        try { r = indexedDB.open("vantage", 2); } catch (e) { return res(null); }
        r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); };
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => res(null);
      });
    },
    async get(k) { const db = await this.open(); if (!db) return null; return new Promise((res) => { try { const t = db.transaction("kv").objectStore("kv").get(k); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); } catch (e) { res(null); } }); },
    async set(k, v) { const db = await this.open(); if (!db) return; return new Promise((res) => { try { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = res; } catch (e) { res(); } }); },
    async clear() { const db = await this.open(); if (!db) return; return new Promise((res) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").clear(); t.oncomplete = res; }); },
  };

  const KINDS = ["holding", "contact", "event", "decision", "note", "watch", "plan", "scenario", "investor", "ics_sub"];
  const S = (V.store = {
    records: {}, settings: {}, alerts: [], seen: new Set(), snapshots: [], series: {}, meta: {}, news: [], jobs: [], engine: {}, serverTime: 0, idb,
    ready: false,
  });
  KINDS.forEach((k) => (S.records[k] = []));

  function flatten(r) { return Object.assign({}, r.data, { id: r.id, _kind: r._kind, _created: r._created, _updated: r._updated }); }

  S.boot = async function (force) {
    const space = V.state.space || "live";
    const cacheKey = "boot:" + space;
    const cached = force ? null : await idb.get(cacheKey);
    let d;
    if (cached && cached.server_time && Date.now() / 1000 - cached.server_time < 86400 * 3) {
      d = await V.net("/api/boot?since=" + cached.server_time);
      const byId = new Map(cached.records.map((r) => [r.id, r]));
      for (const r of d.records) byId.set(r.id, r);
      for (const id of d.deleted) byId.delete(id);
      d.records = [...byId.values()];
    } else d = await V.net("/api/boot");
    await idb.set(cacheKey, { server_time: d.server_time, records: d.records });
    KINDS.forEach((k) => (S.records[k] = []));
    for (const r of d.records) (S.records[r._kind] = S.records[r._kind] || []).push(flatten(r));
    for (const k of KINDS) S.records[k].sort((a, b) => a._created - b._created);
    S.settings = d.settings || {};
    S.alerts = d.alerts || [];
    S.seen = new Set(d.seen || []);
    S.snapshots = (d.snapshots || []).map((s) => Object.assign({ day: s.day }, s.data)).sort((a, b) => (a.day < b.day ? -1 : 1));
    S.index = d.series_index || [];
    S.jobs = d.jobs || [];
    S.engine = d.engine || {};
    S.serverTime = d.server_time;
    S.space = d.space;
    await Promise.all([S.loadSeries(S.initialIds()), S.loadNews()]);
    S.ready = true;
    return S;
  };
  S.refresh = async function () {
    try {
      const d = await V.net("/api/boot?since=" + S.serverTime);
      for (const r of d.records) S.upsert(r._kind, flatten(r), true);
      for (const id of d.deleted) for (const k of KINDS) S.records[k] = S.records[k].filter((x) => x.id !== id);
      S.alerts = d.alerts || S.alerts; S.index = d.series_index || S.index; S.jobs = d.jobs || S.jobs; S.engine = d.engine || S.engine; S.serverTime = d.server_time;
      await Promise.all([S.loadSeries(Object.keys(S.series)), S.loadNews()]);
    } catch (e) { console.warn("refresh failed", e); }
  };
  S.initialIds = function () {
    const want = new Set(["boc", "pw", "travel", "usgs"]);
    for (const x of S.index) {
      if (/^(q|g|ga|f|s13):/.test(x.id)) want.add(x.id);
    }
    const tick = new Set(V.kb.FACTOR_TICKERS);
    for (const h of S.records.holding.concat(S.records.watch)) if (h.ticker && h.ticker !== "CASH") tick.add(h.ticker.toUpperCase());
    for (const t of tick) want.add("h:" + t);
    return [...want];
  };
  S.loadSeries = async function (ids) {
    ids = [...new Set(ids)].filter(Boolean);
    const cached = await Promise.all(ids.map((id) => idb.get("s:" + id)));
    const known = [];
    ids.forEach((id, i) => { if (cached[i]) { S.series[id] = cached[i].data; S.meta[id] = { updated: cached[i].updated }; known.push(id + "@" + cached[i].updated); } });
    for (let i = 0; i < ids.length; i += 60) {
      const chunk = ids.slice(i, i + 60);
      const kn = known.filter((k) => chunk.includes(k.slice(0, k.lastIndexOf("@"))));
      let res;
      try { res = await V.net("/api/series?ids=" + encodeURIComponent(chunk.join(",")) + "&known=" + encodeURIComponent(kn.join(","))); } catch (e) { console.warn(e); continue; }
      for (const [id, v] of Object.entries(res)) {
        S.meta[id] = { updated: v.updated, error: v.error };
        if (v.same) continue;
        if (v.data !== undefined && v.data !== null) { S.series[id] = v.data; idb.set("s:" + id, { updated: v.updated, data: v.data }); }
      }
    }
  };
  S.ensure = async function (ids) { const missing = ids.filter((id) => !(id in S.series)); if (missing.length) await S.loadSeries(missing); };
  S.loadNews = async function () {
    const since = Date.now() / 1000 - 7 * 86400;
    const d = await V.net("/api/news?since=" + since);
    S.news = d.items || [];
  };

  // ---------- records ----------
  S.upsert = function (kind, rec, quiet) {
    if (!rec || !rec.id) return;
    const list = (S.records[kind] = S.records[kind] || []);
    const i = list.findIndex((x) => x.id === rec.id);
    if (i >= 0) list[i] = rec; else list.push(rec);
    if (!quiet) idb.set("boot:" + V.state.space, null); // force a full resync of the cache next boot
  };
  S.remove = function (kind, id) { S.records[kind] = (S.records[kind] || []).filter((x) => x.id !== id); idb.set("boot:" + V.state.space, null); };
  S.get = (id) => { for (const k of KINDS) { const r = S.records[k].find((x) => x.id === id); if (r) return r; } return null; };

  // ---------- market data accessors ----------
  S.quote = function (t) {
    t = (t || "").toUpperCase();
    const q = S.series["q:" + t], h = S.series["h:" + t];
    if (q && q.p != null) {
      const out = Object.assign({}, q);
      if (out.pc == null && h && h.d && h.d.length > 1) out.pc = h.d[h.d.length - 2][1];
      out.fetched = q.f || (S.meta["q:" + t] || {}).updated;
      return out;
    }
    if (h && h.d && h.d.length) return { s: t, n: h.n, c: h.c, x: h.x, ty: h.ty, p: h.d[h.d.length - 1][1], pc: h.d.length > 1 ? h.d[h.d.length - 2][1] : null, t: h.d[h.d.length - 1][0], fetched: h.f, fromHistory: true };
    return null;
  };
  // Brent and WTI are continuous front-month futures; a large divergence in their daily moves usually
  // means one of them rolled to the next contract, not that prices really jumped.
  S.rollSuspect = function (t) {
    if (t !== "CL=F" && t !== "BZ=F") return false;
    const a = S.quote("CL=F"), b = S.quote("BZ=F");
    if (!a || !b || !a.pc || !b.pc) return false;
    return Math.abs(a.p / a.pc - b.p / b.pc) > 0.04;
  };
  S.hist = (t) => { const h = S.series["h:" + (t || "").toUpperCase()]; return h && h.d ? h.d : null; };
  S.long = (t) => { const h = S.series["m:" + (t || "").toUpperCase()]; return h && h.d ? h.d : null; };
  S.div = (t) => { const h = S.series["h:" + (t || "").toUpperCase()]; return h && h.dv ? h.dv : []; };
  S.boc = (k) => { const b = S.series.boc; return b && b.series && b.series[k] ? b.series[k] : null; };
  S.fxTable = function () {
    const t = { CAD: 1 };
    const b = S.series.boc;
    if (b && b.series) for (const [k, v] of Object.entries(b.series)) if (k.startsWith("FX") && v.length) t[k.slice(2, 5)] = v[v.length - 1][1];
    const q = S.quote("CADUSD=X");
    if (!t.USD && q && q.p) t.USD = 1 / q.p;
    return t;
  };
  S.fxHist = function (ccy) { if (ccy === "CAD") return null; return S.boc("FX" + ccy + "CAD"); };

  // ---------- proxy with persistent cache ----------
  S.px = async function (url, opts = {}) {
    const ttl = opts.ttl || 3600;
    const key = "px:" + url + (opts.body ? "#" + opts.body : "");
    const c = await idb.get(key);
    if (c && Date.now() / 1000 - c.t < ttl) return c.v;
    try {
      const r = await V.net("/api/px?ttl=" + Math.min(ttl, 86400) + "&u=" + encodeURIComponent(url), opts.body ? { raw: true, body: opts.body, method: "POST" } : { raw: true });
      const v = opts.type === "text" ? await r.text() : await r.json();
      idb.set(key, { t: Date.now() / 1000, v });
      return v;
    } catch (e) {
      if (c) return c.v; // stale beats nothing; the caller shows its age
      throw e;
    }
  };
})();
