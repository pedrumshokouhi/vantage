// Collectors (the engine): scheduled jobs that keep every data source fresh, run from tick().
import { FEEDS, MARKET, LONG, BOC_SERIES, BOC_MONTHLY, HOTSPOTS, PORTS } from "./sources.js";
import { run, J, now, q, hash53, q1, kvGet, kvSet } from "./lib.js";
import { upsertAlert } from "./store.js";
import { upstream, getJson, getText, putSeries, getSeries } from "./upstream.js";

// ------------------------------------------------------------------ collectors (the engine)
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
function strip(s) {
  s = (s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ");
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));
  return s.replace(/\s+/g, " ").trim();
}
const RX = {
  item: /<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi, title: /<title[^>]*>([\s\S]*?)<\/title>/i, link: /<link[^>]*>([\s\S]*?)<\/link>/i,
  href: /<link[^>]*?href="([^"]+)"[^>]*\/?>/i, desc: /<(description|summary|content)[^>]*>([\s\S]*?)<\/(description|summary|content)>/i,
  date: /<(pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(pubDate|published|updated|dc:date)>/i,
};
function parseFeed(xml) {
  const out = [];
  let m; RX.item.lastIndex = 0;
  while ((m = RX.item.exec(xml)) && out.length < 40) {
    const b = m[0];
    const title = strip((b.match(RX.title) || [])[1]);
    let link = strip((b.match(RX.link) || [])[1]);
    if (!link || !/^https?:/.test(link)) link = (b.match(RX.href) || [])[1] || link;
    if (!title || !link) continue;
    const desc = strip((b.match(RX.desc) || [])[2]).slice(0, 500);
    const d = Date.parse(strip((b.match(RX.date) || [])[2]));
    out.push({ title, link, desc, pub: isFinite(d) ? d / 1000 : null });
  }
  return out;
}
async function jobNews(env, feedIdx) {
  const [fid, source, url, topic] = FEEDS[feedIdx % FEEDS.length];
  const items = parseFeed(await getText(env, url));
  if (!items.length) throw new Error("no items parsed");
  const t = now();
  const ids = items.map((i) => "n" + hash53(i.link));
  const existing = new Set((await q(env, `SELECT id FROM news WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids)).map((r) => r.id));
  const stmts = [];
  items.forEach((it, k) => {
    if (existing.has(ids[k])) return;
    let pub = it.pub || t; if (pub > t + 3600) pub = t;
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO news VALUES (?,?,?,?,?,?,?,?,?)").bind(ids[k], fid, source, topic, it.title.slice(0, 400), it.link.slice(0, 1000), it.desc, pub, t));
  });
  if (stmts.length) await env.DB.batch(stmts);
  return fid + ": " + stmts.length + " new";
}

function compactChart(d, withDiv) {
  const r = d && d.chart && d.chart.result && d.chart.result[0];
  if (!r) throw new Error((d && d.chart && d.chart.error && d.chart.error.description) || "no data");
  const m = r.meta, ts = r.timestamp || [], cl = ((r.indicators || {}).quote || [{}])[0].close || [];
  const pts = [];
  for (let i = 0; i < ts.length; i++) if (cl[i] != null) pts.push([ts[i], Math.round(cl[i] * 10000) / 10000]);
  const out = { s: m.symbol, n: m.longName || m.shortName || m.symbol, c: (m.currency || "USD"), x: m.fullExchangeName || m.exchangeName, ty: m.instrumentType,
    p: m.regularMarketPrice, t: m.regularMarketTime, d: pts, f: now() };
  if (withDiv) out.dv = Object.values(((r.events || {}).dividends) || {}).map((x) => [x.date, x.amount]).sort((a, b) => a[0] - b[0]);
  return out;
}
async function trackedTickers(env) {
  const rows = await q(env, "SELECT data FROM records WHERE kind IN ('holding','watch') AND deleted=0");
  const set = new Set(MARKET);
  for (const r of rows) { const d = J(r.data, {}); const t = (d.ticker || "").toUpperCase(); if (t && t !== "CASH" && !t.startsWith("CASH")) set.add(t); }
  return [...set];
}
async function jobQuotes(env, st, n = 10) {
  const all = await trackedTickers(env);
  const batch = [];
  for (let i = 0; i < Math.min(n, all.length); i++) batch.push(all[(st.qi + i) % all.length]);
  st.qi = (st.qi + batch.length) % Math.max(1, all.length);
  const res = await Promise.all(batch.map(async (s) => {
    try {
      const d = await getJson(env, `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d`);
      const c = compactChart(d);
      const prev = c.d.length > 1 ? c.d[c.d.length - 2][1] : null;
      const rec = { s: c.s, n: c.n, c: c.c, x: c.x, ty: c.ty, p: c.p, pc: prev, t: c.t, f: c.f };
      await putSeries(env, "q:" + s, rec);
      return [s, rec];
    } catch (e) { await putSeries(env, "q:" + s, null, e.message); return [s, null]; }
  }));
  await quoteAlerts(env, res.filter((x) => x[1]));
  return res.filter((x) => x[1]).length + "/" + batch.length + " quotes";
}
async function jobHistory(env) {
  const all = await trackedTickers(env);
  const rows = await q(env, "SELECT id, updated, tried FROM series WHERE id LIKE 'h:%' OR id LIKE 'm:%'");
  const age = Object.fromEntries(rows.map((r) => [r.id, r]));
  // stale after ~a day; a failing symbol waits 3 h before its next try so it cannot block the queue
  const stale = (id, maxAge) => { const r = age[id] || {}; return now() - (r.updated || 0) > maxAge && now() - (r.tried || 0) > 3 * 3600; };
  const due = [];
  for (const s of all) if (stale("h:" + s, 20 * 3600)) due.push(["h", s]);
  for (const s of LONG) if (stale("m:" + s, 22 * 3600)) due.push(["m", s]);
  // work off a big backlog (first run, new holdings) faster; long weekly histories count double
  let budget = due.length > 12 ? 8 : 4;
  const pick = [];
  for (const d of due) { const cost = d[0] === "m" ? 2 : 1; if (cost > budget) continue; pick.push(d); budget -= cost; if (!budget) break; }
  for (const [kind, s] of pick) {
    try {
      // explicit dates for the long view: with range=max Yahoo silently falls back to monthly bars and drops
      // whole months (June 2008, March 2020), so weekly bars since 2000 are requested instead
      const url = kind === "h" ? `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=2y&interval=1d&events=div`
        : `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?period1=946684800&period2=${Math.floor(now())}&interval=1wk`;
      await putSeries(env, kind + ":" + s, compactChart(await getJson(env, url), kind === "h"));
    } catch (e) { await putSeries(env, kind + ":" + s, null, e.message); }
  }
  return pick.length + " histories (" + due.length + " due)";
}
async function jobBoc(env) {
  const d = await getJson(env, `https://www.bankofcanada.ca/valet/observations/${BOC_SERIES.join(",")}/json?recent_weeks=110`);
  const series = {};
  for (const k of BOC_SERIES) series[k] = [];
  for (const ob of d.observations || []) for (const k of BOC_SERIES) if (ob[k] && ob[k].v !== "" && ob[k].v != null) series[k].push([ob.d, +ob[k].v]);
  for (const k of BOC_MONTHLY) {
    const m = await getJson(env, `https://www.bankofcanada.ca/valet/observations/${k}/json?recent=40`);
    series[k] = (m.observations || []).filter((o) => o[k] && o[k].v).map((o) => [o.d, +o[k].v]);
  }
  for (const k in series) series[k].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const prev = await getSeries(env, "boc");
  await putSeries(env, "boc", { series, f: now() });
  // alert when the policy rate changes
  const pr = series.V39079, old = prev && prev.data && prev.data.series && prev.data.series.V39079;
  if (pr && pr.length && old && old.length && pr[pr.length - 1][1] !== old[old.length - 1][1]) {
    for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "boc:rate:" + pr[pr.length - 1][0], supersede: "boc:rate:", kind: "macro",
      title: `Bank of Canada moved its policy rate to ${pr[pr.length - 1][1].toFixed(2)}% (from ${old[old.length - 1][1].toFixed(2)}%)`,
      body: { why: "Policy-rate changes reprice variable mortgages, lines of credit and savings within days.", evidence: ["Bank of Canada Valet, " + pr[pr.length - 1][0]],
             action: "Open Rates to see the effect on borrowing and your holdings.", go: "rates" },
      relevance: 0.9, impact: 0.8, urgency: 0.8, confidence: 1 }, "engine");
  }
  return "boc ok";
}
async function jobPortwatch(env) {
  const base = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
  const names = PORTS.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  // "Normal" = the two years before the most recent 90 days, so an ongoing disruption doesn't drag its own baseline down.
  const since1y = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
  const baseEnd = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const recentFrom = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const stats = await getJson(env, `${base}?where=${encodeURIComponent(`portname IN (${names}) AND date>='${since1y}' AND date<'${baseEnd}'`)}` +
    `&groupByFieldsForStatistics=portname&outStatistics=${encodeURIComponent(JSON.stringify([
    { statisticType: "avg", onStatisticField: "n_total", outStatisticFieldName: "avg_total" }, { statisticType: "avg", onStatisticField: "n_tanker", outStatisticFieldName: "avg_tanker" },
    { statisticType: "avg", onStatisticField: "capacity", outStatisticFieldName: "avg_cap" }]))}&f=json`);
  // the service returns at most 1,000 rows per request: page through newest-first so the latest days are never cut off
  const feats = [];
  for (let off = 0; off < 5000; off += 1000) {
    const pg = await getJson(env, `${base}?where=${encodeURIComponent(`portname IN (${names}) AND date>='${recentFrom}'`)}` +
      `&outFields=date,portname,n_total,n_tanker,n_container,n_dry_bulk,capacity&orderByFields=${encodeURIComponent("date DESC")}&resultOffset=${off}&resultRecordCount=1000&f=json`);
    feats.push(...(pg.features || []));
    if (!pg.exceededTransferLimit || !(pg.features || []).length) break;
  }
  feats.reverse();
  const daily = {};
  for (const f of feats) { const a = f.attributes; (daily[a.portname] = daily[a.portname] || []).push([typeof a.date === "number" ? new Date(a.date).toISOString().slice(0, 10) : a.date, a.n_total,
    a.n_tanker, a.n_container, a.n_dry_bulk, a.capacity]); }
  const avg = {};
  for (const f of stats.features || []) avg[f.attributes.portname] = { total: f.attributes.avg_total, tanker: f.attributes.avg_tanker, cap: f.attributes.avg_cap };
  await putSeries(env, "pw", { daily, avg, since, base_from: since1y, base_to: baseEnd, f: now() });
  // disruption alerts: last 7 days vs 1-year average
  const IMPORTANCE = { "Strait of Hormuz": 1, "Bab el-Mandeb Strait": 0.8, "Suez Canal": 0.8, "Malacca Strait": 0.8, "Taiwan Strait": 0.75, "Panama Canal": 0.6, "Bosporus Strait": 0.55,
                      "Cape of Good Hope": 0.5, "Luzon Strait": 0.45, "Korea Strait": 0.45, "Kerch Strait": 0.3 };
  for (const [port, rows] of Object.entries(daily)) {
    const a = avg[port]; if (!a || !a.total || a.total < 20 || rows.length < 7) continue;
    const last7 = rows.slice(-7).reduce((s, r) => s + (r[1] || 0), 0) / 7;
    const ratio = last7 / a.total;
    if (ratio < 0.6) {
      const hs = HOTSPOTS.find((h) => (h.port || []).includes(port));
      for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "pw:" + port + ":" + rows[rows.length - 1][0].slice(0, 7), supersede: "pw:" + port + ":", kind: "world",
        title: `${port}: ship transits running at ${Math.round(ratio * 100)}% of normal`,
        body: { why: `7-day average ${last7.toFixed(1)} transits/day vs a normal of ${a.total.toFixed(1)} (average ${since1y} to ${baseEnd}; IMF PortWatch, AIS-based).`,
               evidence: ["Latest data " + rows[rows.length - 1][0] + " (PortWatch publishes with a lag of a few days)"],
          action: "Open the World tracker.", go: "world/" + (hs ? hs.id : "") }, relevance: 0.6 + 0.35 * (IMPORTANCE[port] || 0.4), impact: Math.min(1, (1.2 - ratio) * (IMPORTANCE[port] || 0.4)),
            urgency: 0.6, confidence: 0.85 }, "engine");
    }
  }
  return Object.keys(daily).length + " chokepoints";
}
async function jobGdelt(env, st) {
  const h = HOTSPOTS[st.gi % HOTSPOTS.length];
  const mode = st.gm ? "artlist" : "timelinevolraw";
  const url = mode === "artlist"
    ? `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent("(" + h.q + ") sourcelang:english")}&mode=artlist&maxrecords=12&sort=datedesc&timespan=3d&format=json`
    : `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(h.q)}&mode=timelinevolraw&timespan=90d&format=json`;
  if (st.gm) st.gi = (st.gi + 1) % HOTSPOTS.length;
  st.gm = !st.gm;
  const r = await upstream(env, url);
  if (r.status === 429) throw new Error("GDELT rate limit (will retry next cycle)");
  if (!r.ok) throw new Error("GDELT HTTP " + r.status);
  const d = J(await r.text(), null);
  if (!d) throw new Error("GDELT returned non-JSON");
  if (mode === "artlist") {
    const arts = (d.articles || []).map((a) => ({ t: a.title, u: a.url, s: a.domain, d: a.seendate, c: a.sourcecountry }));
    await putSeries(env, "ga:" + h.id, { arts, f: now() });
    return h.id + " articles " + arts.length;
  }
  const tl = ((d.timeline || [])[0] || {}).data || [];
  const vol = tl.map((p) => [p.date.slice(0, 8), p.value, p.norm]);
  await putSeries(env, "g:" + h.id, { vol, f: now() });
  if (vol.length > 30) {
    const base = vol.slice(-31, -3).map((x) => x[1]), last = vol.slice(-3).map((x) => x[1]);
    const mean = base.reduce((a, b) => a + b, 0) / base.length;
    const sd = Math.sqrt(base.reduce((a, b) => a + (b - mean) ** 2, 0) / base.length) || 1;
    const lm = last.reduce((a, b) => a + b, 0) / last.length, z = (lm - mean) / sd;
    if (z > 2.5 && lm > 50) for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "gd:" + h.id + ":" + vol[vol.length - 1][0], supersede: "gd:" + h.id + ":", kind: "world",
      title: `News attention on ${h.id === "hormuz" ? "the Strait of Hormuz" : h.id} is surging (${z.toFixed(1)}σ above normal)`,
      body: { why: `Articles/day over the last 3 days (${Math.round(lm)}) vs the prior 4-week average (${Math.round(mean)}), GDELT.`, action: "Open the World tracker.", go: "world/" + h.id },
      relevance: 0.75, impact: 0.6, urgency: 0.7, confidence: 0.7 }, "engine");
  }
  return h.id + " volume " + vol.length;
}
async function jobFlights(env, st) {
  const withAir = HOTSPOTS.filter((h) => h.air);
  const h = withAir[st.fi % withAir.length];
  st.fi = (st.fi + 1) % withAir.length;
  const [lat, lon, nm] = h.air;
  // Free community ADS-B feeds rate-limit unpredictably, so try several in order.
  const sources = [
    ["adsb.fi", async () => { const d = await getJson(env, `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`); return d.aircraft || d.ac; }],
    ["adsb.lol", async () => { const d = await getJson(env, `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${nm}`); return d.ac || d.aircraft; }],
    ["OpenSky", async () => {
      const dLat = nm / 60, dLon = nm / (60 * Math.cos(lat * Math.PI / 180));
      const d = await getJson(env, `https://opensky-network.org/api/states/all?lamin=${(lat - dLat).toFixed(2)}&lomin=${(lon - dLon).toFixed(2)}` +
        `&lamax=${(lat + dLat).toFixed(2)}&lomax=${(lon + dLon).toFixed(2)}`);
      return (d.states || []).map((x) => ({ flight: x[1], t: "", r: x[2], alt_baro: x[8] ? "ground" : Math.round((x[7] || 0) * 3.281), lat: x[6], lon: x[5], dbFlags: 0 }));
    }],
  ];
  let ac = null, used = null, errs = [];
  for (const [name, fn] of sources) {
    try { const a = await fn(); if (Array.isArray(a) && (a.length || name === "OpenSky")) { ac = a; used = name; break; } errs.push(name + ": empty"); }
    catch (e) { errs.push(name + ": " + e.message); }
  }
  if (!ac) throw new Error("all ADS-B sources failed (" + errs.join("; ") + ")");
  const airborne = ac.filter((a) => a.alt_baro !== "ground");
  const mil = ac.filter((a) => (a.dbFlags & 1) === 1).length;
  const prev = (await getSeries(env, "f:" + h.id)) || { data: { pts: [] } };
  const pts = (prev.data && prev.data.pts) || [];
  pts.push([Math.round(now()), airborne.length, mil]);
  while (pts.length && pts[0][0] < now() - 21 * 86400) pts.shift();
  const sample = airborne.slice(0, 40).map((a) => [a.flight ? String(a.flight).trim() : "", a.t || "", a.r || "", a.alt_baro, a.lat, a.lon]);
  await putSeries(env, "f:" + h.id, { pts, sample, f: now(), src: used + " (community ADS-B receivers)" });
  return h.id + " aircraft " + airborne.length + " via " + used;
}
async function jobUsgs(env) {
  const d = await getJson(env, "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson");
  const eq = (d.features || []).map((f) => ({ m: f.properties.mag, p: f.properties.place, t: f.properties.time / 1000, u: f.properties.url, ts: f.properties.tsunami, a: f.properties.alert,
                                             c: f.geometry.coordinates }))
    .sort((a, b) => b.t - a.t).slice(0, 80);
  await putSeries(env, "usgs", { eq, f: now() });
  for (const e of eq.filter((x) => x.m >= 6.5 && x.t > now() - 2 * 86400)) for (const space of ["live", "demo"]) await upsertAlert(env, space, {
    key: "eq:" + e.u, kind: "world", title: `M${e.m.toFixed(1)} earthquake: ${e.p}`,
      body: { why: "Major earthquakes can disrupt supply chains, ports and insurers.",
      evidence: ["USGS " + new Date(e.t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" + (e.ts ? " · tsunami flag" : "")], link: e.u },
    relevance: 0.5, impact: Math.min(1, (e.m - 6) / 2.5), urgency: 0.6, confidence: 1 }, "engine");
  return eq.length + " quakes";
}
async function jobTravel(env) {
  const d = await getJson(env, "https://data.international.gc.ca/travel-voyage/index-alpha-eng.json");
  const levels = {};
  for (const [iso, c] of Object.entries(d.data || {})) levels[iso] = [c["advisory-state"], c["date-published"] && c["date-published"].date, c["country-eng"], c["has-regional-advisory"]];
  const prev = await getSeries(env, "travel");
  await putSeries(env, "travel", { levels, f: now() });
  if (prev && prev.data && prev.data.levels) {
    const watch = new Set(["IR", "IL", "LB", "SY", "YE", "UA", "RU", "TW", "CN", "KP", "AE", "OM", "QA", "SA", "KW", "BH", "EG", "IQ", "JO", "TR", "US", "MX"]);
    for (const [iso, v] of Object.entries(levels)) {
      const old = prev.data.levels[iso];
      if (old && old[0] !== v[0] && watch.has(iso)) {
        const lab = ["take normal precautions", "exercise a high degree of caution", "avoid non-essential travel", "avoid all travel"];
        for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "tr:" + iso + ":" + v[0] + ":" + (v[1] || ""), supersede: "tr:" + iso + ":", kind: "world",
          title: `Canada changed its ${v[2]} travel advisory: ${lab[v[0]] || v[0]}`,
            body: { why: `Was "${lab[old[0]] || old[0]}". Government of Canada travel advisories.`, action: "Open the World tracker.", go: "world" },
          relevance: 0.7, impact: 0.5 + 0.15 * v[0], urgency: 0.6, confidence: 1 }, "engine");
      }
    }
  }
  return Object.keys(levels).length + " countries";
}
async function jobSec(env, st) {
  const invs = await q(env, "SELECT DISTINCT data FROM records WHERE kind='investor' AND deleted=0");
  const ciks = [...new Set(invs.map((r) => J(r.data, {}).cik).filter(Boolean))];
  if (!ciks.length) return "no investors";
  const cik = ciks[st.si % ciks.length];
  st.si = (st.si + 1) % ciks.length;
  const d = await getJson(env, `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`);
  const rec = d.filings.recent;
  let latest = null;
  for (let i = 0; i < rec.form.length; i++) if (rec.form[i] === "13F-HR") { latest = { acc: rec.accessionNumber[i], filed: rec.filingDate[i], period: rec.reportDate[i] }; break; }
  const prev = await getSeries(env, "s13:" + cik);
  await putSeries(env, "s13:" + cik, { name: d.name, latest, f: now() });
  if (latest && prev && prev.data && prev.data.latest && prev.data.latest.acc !== latest.acc) {
    for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "13f:" + cik + ":" + latest.acc, supersede: "13f:" + cik + ":", kind: "investor",
      title: `${d.name} filed a new 13F (holdings as of ${latest.period})`, body: { why: "A followed investor disclosed quarter-end holdings.", evidence: ["Filed " + latest.filed],
        caveat: "13F data is up to 45 days old at filing and shows long US-listed positions only.", action: "Open Filings to see what changed.", go: "filings" },
      relevance: 0.7, impact: 0.4, urgency: 0.4, confidence: 1 }, "engine");
  }
  return d.name;
}
async function quoteAlerts(env, pairs) {
  if (!pairs.length) return;
  const holds = await q(env, "SELECT space, data FROM records WHERE kind='holding' AND deleted=0");
  const bySym = {};
  for (const r of holds) { const d = J(r.data, {}); if (d.ticker) (bySym[d.ticker.toUpperCase()] = bySym[d.ticker.toUpperCase()] || []).push(r.space); }
  const day = new Date().toISOString().slice(0, 10);
  const macro = { "CL=F": [0.04, "WTI crude"], "BZ=F": [0.04, "Brent crude"], "^VIX": [0.2, "VIX (volatility)"], "^GSPC": [0.02, "S&P 500"], "^GSPTSE": [0.02, "S&P/TSX"],
                 "^IXIC": [0.025, "Nasdaq"], "GC=F": [0.03, "Gold"], "CADUSD=X": [0.01, "Canadian dollar"] };
  // Continuous front-month futures jump when the contract rolls. If WTI and Brent diverge sharply on the
  // same day, treat the move as a probable roll artifact rather than news.
  const qOf = async (sym) => { const f = pairs.find((p) => p[0] === sym); if (f) return f[1]; const r = await getSeries(env, "q:" + sym); return r && r.data; };
  const wti = await qOf("CL=F"), brent = await qOf("BZ=F");
  const chg = (x) => (x && x.p && x.pc ? x.p / x.pc - 1 : null);
  const rollSuspect = chg(wti) != null && chg(brent) != null && Math.abs(chg(wti) - chg(brent)) > 0.04;
  for (const [s, rec] of pairs) {
    if (!rec.p || !rec.pc) continue;
    const ch = rec.p / rec.pc - 1;
    if (rollSuspect && (s === "CL=F" || s === "BZ=F")) continue;
    if (bySym[s] && Math.abs(ch) >= 0.05) for (const space of new Set(bySym[s])) await upsertAlert(env, space, { key: "px:" + s + ":" + day, kind: "price",
      title: `${s} ${ch > 0 ? "up" : "down"} ${Math.abs(ch * 100).toFixed(1)}% today`,
        body: { why: "Daily moves of 5% or more usually reflect new information.", evidence: [`${rec.p} vs previous close ${rec.pc} ${rec.c} (Yahoo Finance, delayed)`],
        action: "Check news and filings before reacting.", ticker: s },
      relevance: 0.9, impact: Math.min(1, Math.abs(ch) * 5), urgency: 0.8, confidence: 0.95 }, "engine");
    if (macro[s] && Math.abs(ch) >= macro[s][0]) for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "mx:" + s + ":" + day, kind: "market",
      title: `${macro[s][1]} ${ch > 0 ? "jumped" : "fell"} ${Math.abs(ch * 100).toFixed(1)}% today`,
        body: { why: "A large move in a market-wide driver can reprice many holdings at once.", evidence: [`${rec.p} vs ${rec.pc}`], action: "Open the driver to see what it means for you.",
        go: s === "CL=F" || s === "BZ=F" ? "oil" : s === "CADUSD=X" ? "macro" : "macro" },
      relevance: 0.8, impact: Math.min(1, Math.abs(ch) * 8), urgency: 0.8, confidence: 0.95 }, "engine");
  }
  // 10-year yield: alert on 12bp+ daily move
  const tnx = pairs.find((p) => p[0] === "^TNX");
  if (tnx && tnx[1].p && tnx[1].pc && Math.abs(tnx[1].p - tnx[1].pc) >= 0.12) for (const space of ["live", "demo"]) await upsertAlert(env, space, { key: "tnx:" + day, kind: "market",
    title: `US 10-year yield moved ${((tnx[1].p - tnx[1].pc) * 100).toFixed(0)} bp to ${tnx[1].p.toFixed(2)}%`,
      body: { why: "Long yields set mortgage rates and the discount rate used to value stocks.", action: "Open Rates.", go: "rates" },
    relevance: 0.8, impact: 0.7, urgency: 0.7, confidence: 0.95 }, "engine");
}
async function jobSnapshot(env) {
  const day = new Date().toISOString().slice(0, 10);
  const boc = await getSeries(env, "boc");
  const fx = { CAD: 1 };
  if (boc && boc.data) for (const [k, v] of Object.entries(boc.data.series || {})) if (k.startsWith("FX") && v.length) fx[k.slice(2, 5)] = v[v.length - 1][1];
  for (const space of ["live", "demo"]) {
    const rows = await q(env, "SELECT data FROM records WHERE space=? AND kind='holding' AND deleted=0", space);
    if (!rows.length) continue;
    const quotes = Object.fromEntries((await q(env, "SELECT id, data FROM series WHERE id LIKE 'q:%'")).map((r) => [r.id.slice(2), J(r.data, {})]));
    let total = 0; const w = {};
    for (const r of rows) {
      const h = J(r.data, {}); const t = (h.ticker || "").toUpperCase(); const qte = quotes[t];
      let price = t === "CASH" ? 1 : qte && qte.p != null ? qte.p : h.manual_price != null ? h.manual_price : h.broker_price;
      let ccy = (t === "CASH" ? h.currency : (qte && qte.c) || h.currency || h.broker_currency || "CAD") || "CAD";
      if (ccy === "GBp") { ccy = "GBP"; price = price / 100; }
      const v = (+h.quantity || 0) * (price || 0) * (fx[ccy] || 0);
      total += v; w[t || h.name] = (w[t || h.name] || 0) + v;
    }
    const prev = await q1(env, "SELECT data FROM snapshots WHERE space=? AND day=?", space, day);
    const pd = prev ? J(prev.data, {}) : {};
    await run(env, "INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)", space, day, now(), JSON.stringify(Object.assign(pd, { total, values: w, base: "CAD", engine: true })));
  }
  return "snapshots";
}
async function jobPrune(env) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM news WHERE published<?").bind(t - 21 * 86400),
    env.DB.prepare("DELETE FROM attempts WHERE ts<?").bind(t - 30 * 86400),
    env.DB.prepare("DELETE FROM sessions WHERE expires<?").bind(t),
    env.DB.prepare("UPDATE alerts SET status='stale' WHERE status='open' AND updated<? AND origin='engine'").bind(t - 5 * 86400),
  ]);
  return "pruned";
}

async function recordJob(env, name, fn) {
  const t = now();
  try {
    const note = await fn();
    await run(env, "INSERT INTO jobs (name, last_run, last_ok, last_error, runs, note) VALUES (?,?,?,NULL,1,?) " +
      "ON CONFLICT(name) DO UPDATE SET last_run=excluded.last_run, last_ok=excluded.last_ok, last_error=NULL, runs=jobs.runs+1, note=excluded.note", name, t, t, String(note || "").slice(0, 200));
    return { name, ok: true, note };
  } catch (e) {
    await run(env, "INSERT INTO jobs (name, last_run, last_error, runs) VALUES (?,?,?,1) " +
      "ON CONFLICT(name) DO UPDATE SET last_run=excluded.last_run, last_error=excluded.last_error, runs=jobs.runs+1", name, t, String(e.message || e).slice(0, 300));
    return { name, ok: false, error: e.message };
  }
}

// One engine tick. Every 5 minutes: 3 news feeds, 10 quotes, 1 GDELT call, 1 flight scan; heavier jobs rotate
// (history checks every tick but only fetches what is stale, so it is usually a cheap no-op).
export async function tick(env, only) {
  const st = Object.assign({ fi: 0, qi: 0, gi: 0, gm: false, si: 0, ni: 0, n: 0 }, await kvGet(env, "engine", {}));
  st.n = (st.n || 0) + 1;
  const t = now(), out = [];
  const due = async (name, every) => {
    const r = await q1(env, "SELECT last_ok, last_run FROM jobs WHERE name=?", name);
    return !r || t - (r.last_ok || 0) > every && t - (r.last_run || 0) > Math.min(every, 1800);
  };
  const want = (name) => !only || only.includes(name);
  if (want("news")) for (let i = 0; i < 3; i++) { const idx = st.ni; st.ni = (st.ni + 1) % FEEDS.length; out.push(await recordJob(env, "news:" + FEEDS[idx][0], () => jobNews(env, idx))); }
  if (want("quotes")) out.push(await recordJob(env, "quotes", () => jobQuotes(env, st)));
  if (want("gdelt")) out.push(await recordJob(env, "gdelt", () => jobGdelt(env, st)));
  if (want("flights")) out.push(await recordJob(env, "flights", () => jobFlights(env, st)));
  // heavier jobs: at most one per tick, rotating
  const heavy = [["history", 4 * 60, () => jobHistory(env)], ["boc", 3 * 3600, () => jobBoc(env)], ["portwatch", 6 * 3600, () => jobPortwatch(env)],
    ["usgs", 3600, () => jobUsgs(env)], ["travel", 12 * 3600, () => jobTravel(env)], ["sec", 6 * 3600, () => jobSec(env, st)],
    ["snapshot", 3 * 3600, () => jobSnapshot(env)], ["prune", 24 * 3600, () => jobPrune(env)]];
  for (let k = 0; k < heavy.length; k++) {
    const [name, every, fn] = heavy[(st.n + k) % heavy.length];
    if (!want(name)) continue;
    if (only || await due(name, every)) { out.push(await recordJob(env, name, fn)); if (!only) break; }
  }
  await kvSet(env, "engine", Object.assign(st, { last: t }));
  return out;
}
