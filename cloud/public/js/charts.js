/* Hand-built SVG charts: sparklines, line & range charts, bars, donut, heatmap, consequence map, world map. */
"use strict";
(function () {
  const esc = V.esc;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  V.spark = function (vals, w = 110, h = 30, color) {
    vals = (vals || []).filter((v) => v != null);
    if (vals.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
    const mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1;
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - 3 - ((v - mn) / r) * (h - 6)]);
    const c = color || (vals[vals.length - 1] >= vals[0] ? "var(--up)" : "var(--down)");
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}L${w} ${h}L0 ${h}Z" fill="${c}" fill-opacity=".08"/><path d="${d}" fill="none" stroke="${c}" stroke-width="1.5"/></svg>`;
  };

  // series: [{name, color, pts:[[t,v]], dash, width}]; opts: {h, fmt, base, log, annotations:[{t,label}], bands:[{t0,t1,label}]}
  V.lineChart = function (series, opts = {}) {
    const W = opts.w || 760, H = opts.h || 220, pl = 48, pr = 14, pt = 14, pb = 24;
    const all = series.flatMap((s) => s.pts.filter((p) => p[1] != null && (!opts.log || p[1] > 0)));
    if (all.length < 2) return `<div class="empty small">Not enough history to chart yet.</div>`;
    const tf = (v) => (opts.log ? Math.log(v) : v);
    const t0 = Math.min(...all.map((p) => p[0])), t1 = Math.max(...all.map((p) => p[0]));
    let mn = Math.min(...all.map((p) => tf(p[1]))), mx = Math.max(...all.map((p) => tf(p[1])));
    const pad = (mx - mn) * 0.08 || 1; mn -= pad; mx += pad;
    const X = (t) => pl + ((t - t0) / (t1 - t0 || 1)) * (W - pl - pr);
    const Y = (v) => pt + (1 - (tf(v) - mn) / (mx - mn)) * (H - pt - pb);
    let g = "";
    for (const b of opts.bands || []) if (b.t1 > t0 && b.t0 < t1) g += `<rect x="${X(Math.max(t0, b.t0))}" y="${pt}" width="${Math.max(1, X(Math.min(t1, b.t1)) - X(Math.max(t0, b.t0)))}" height="${H - pt - pb}" fill="var(--raise2)"><title>${esc(b.label)}</title></rect>`;
    for (let i = 0; i <= 4; i++) {
      const lv = mn + ((mx - mn) * i) / 4, v = opts.log ? Math.exp(lv) : lv, y = pt + (1 - i / 4) * (H - pt - pb);
      g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${pl - 7}" y="${y + 3}" text-anchor="end">${opts.fmt ? opts.fmt(v) : v.toFixed(0)}</text>`;
    }
    const span = t1 - t0, step = span > 86400 * 365 * 8 ? 86400 * 365 * 5 : span > 86400 * 365 * 2 ? 86400 * 365 : span > 86400 * 200 ? 86400 * 30.4 * 2 : 86400 * 30.4;
    let k = 0;
    for (let t = t0; t <= t1; t += step, k++) if (k % Math.max(1, Math.ceil((span / step) / 7)) === 0) g += `<text x="${X(t)}" y="${H - 6}" text-anchor="middle">${new Date(t * 1000).toLocaleDateString(undefined, span > 86400 * 365 * 2 ? { year: "numeric" } : { month: "short", year: "2-digit" })}</text>`;
    if (opts.base != null) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(opts.base)}" y2="${Y(opts.base)}" stroke="var(--line2)" stroke-dasharray="3 4"/>`;
    for (const ln of opts.hlines || []) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(ln.v)}" y2="${Y(ln.v)}" stroke="${ln.color || "var(--muted)"}" stroke-dasharray="4 4"/><text x="${W - pr}" y="${Y(ln.v) - 4}" text-anchor="end" style="fill:${ln.color || "var(--muted)"}">${esc(ln.label || "")}</text>`;
    const paths = series.map((s) => {
      const p = s.pts.filter((x) => x[1] != null && (!opts.log || x[1] > 0));
      const d = p.map((x, i) => (i ? "L" : "M") + X(x[0]).toFixed(1) + " " + Y(x[1]).toFixed(1)).join("");
      const last = p[p.length - 1];
      const area = s.area ? `<path d="${d}L${X(last[0])} ${H - pb}L${X(p[0][0])} ${H - pb}Z" fill="${s.color}" fill-opacity=".07"/>` : "";
      return area + `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.7}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>` + (last ? `<circle cx="${X(last[0])}" cy="${Y(last[1])}" r="3" fill="${s.color}"/>` : "");
    }).join("");
    // annotation labels drop to a lower row when they would collide with a neighbour (~6 units per character)
    let ann = "";
    const rowEnd = [-Infinity, -Infinity, -Infinity];
    for (const a of (opts.annotations || []).filter((a) => a.t >= t0 && a.t <= t1).sort((p, q) => p.t - q.t)) {
      const x = X(a.t), w = String(a.label).length * 6, flip = x + 3 + w > W - pr;
      const x0 = flip ? x - 3 - w : x + 3;
      let row = rowEnd.findIndex((e) => x0 > e + 6); if (row < 0) row = rowEnd.indexOf(Math.min(...rowEnd));
      rowEnd[row] = x0 + w;
      ann += `<line x1="${x}" x2="${x}" y1="${pt}" y2="${H - pb}" stroke="var(--acc)" stroke-opacity=".45" stroke-dasharray="2 3"/><text class="annot" x="${flip ? x - 3 : x + 3}" y="${pt + 9 + row * 11}"${flip ? ' text-anchor="end"' : ""}>${esc(a.label)}</text>`;
    }
    const id = "lc" + Math.random().toString(36).slice(2, 8);
    setTimeout(() => {
      const svg = document.getElementById(id); if (!svg) return;
      const tip = svg.parentElement.querySelector(".lctip"), ln = svg.querySelector(".hov");
      svg.onmousemove = (e) => {
        const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W, t = t0 + ((x - pl) / (W - pl - pr)) * (t1 - t0);
        ln.setAttribute("x1", x); ln.setAttribute("x2", x); ln.style.opacity = 1;
        const rows = series.map((s) => { let best = null; for (const p of s.pts) if (p[1] != null && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p; return best ? `<div><span style="color:${s.color}">●</span> ${esc(s.name)} <b class="mono">${opts.fmt ? opts.fmt(best[1]) : best[1].toFixed(2)}</b></div>` : ""; }).join("");
        tip.innerHTML = `<div class="dim mono xs">${new Date(t * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</div>${rows}`;
        tip.style.display = "block"; tip.style.left = Math.min(r.width - 170, e.clientX - r.left + 14) + "px"; tip.style.top = "6px";
      };
      svg.onmouseleave = () => { tip.style.display = "none"; ln.style.opacity = 0; };
    });
    return `<div style="position:relative"><svg id="${id}" class="svgchart" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${g}${paths}${ann}<line class="hov" y1="${pt}" y2="${H - pb}" stroke="var(--muted)" style="opacity:0"/></svg><div class="lctip" style="display:none"></div></div>`;
  };

  // Interactive range chart: ranges + log toggle. data: [[t,v]...]
  V.rangeChart = function (host, data, opts = {}) {
    const ranges = [["1M", 31], ["6M", 183], ["1Y", 366], ["5Y", 1827], ["10Y", 3653], ["20Y", 7306], ["MAX", 1e6]].filter(([, d]) => !data.length || (data[data.length - 1][0] - data[0][0]) / 86400 > d * 0.35 || d === 1e6);
    let cur = opts.range || (ranges.find((r) => r[0] === "5Y") ? "5Y" : ranges[ranges.length - 1][0]), log = false;
    const draw = () => {
      const d = ranges.find((r) => r[0] === cur)[1], tEnd = data.length ? data[data.length - 1][0] : 0;
      const pts = data.filter((p) => p[0] >= tEnd - d * 86400);
      host.innerHTML = `<div class="row wrap sp" style="margin-bottom:8px"><div class="ranges">${ranges.map(([r]) => `<button data-r="${r}" class="${r === cur ? "on" : ""}">${r}</button>`).join("")}</div>
        <div class="row gap6">${opts.canLog ? `<button class="chip ${log ? "on" : ""}" data-log>log scale</button>` : ""}${opts.extra || ""}</div></div>
        ${V.lineChart([{ name: opts.name || "", color: "var(--acc)", pts, area: true }].concat((opts.overlays || []).map((o) => ({ name: o.name, color: o.color, dash: o.dash, pts: o.pts.filter((p) => p[0] >= tEnd - d * 86400) }))), { h: opts.h || 260, fmt: opts.fmt, log, annotations: opts.annotations, hlines: opts.hlines, bands: opts.bands })}`;
      host.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => { cur = b.dataset.r; draw(); }));
      const lb = host.querySelector("[data-log]"); if (lb) lb.onclick = () => { log = !log; draw(); };
      if (opts.onDraw) opts.onDraw(host);
    };
    draw();
  };

  V.barList = function (rows, opts = {}) {
    const max = opts.max || Math.max(...rows.map((r) => Math.abs(r.value)), 0.0001);
    return `<div class="bars ${opts.diverging ? "div" : ""}">${rows.map((r) => {
      const w = (Math.abs(r.value) / max) * (opts.diverging ? 50 : 100), left = opts.diverging ? (r.value >= 0 ? 50 : 50 - w) : 0;
      const c = r.color || (opts.diverging ? (r.value >= 0 ? "var(--up)" : "var(--down)") : "var(--acc)");
      return `<div class="b" ${r.title ? `title="${esc(r.title)}"` : ""}><span class="ellipsis">${esc(r.label)}</span><span class="track"><b style="left:${left}%;width:${Math.max(0.5, w)}%;background:${c}"></b></span><span class="mono right small">${opts.fmt ? opts.fmt(r.value) : V.pct(r.value, 1, false)}</span></div>`;
    }).join("")}</div>`;
  };
  V.donut = function (rows, size = 130) {
    const tot = rows.reduce((a, r) => a + r.value, 0) || 1, R = size / 2 - 8, C = 2 * Math.PI * R;
    let acc = 0;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rows.map((r) => { const len = (r.value / tot) * C; const s = `<circle r="${R}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${r.color || V.color(r.label)}" stroke-width="12" stroke-dasharray="${Math.max(0, len - 1.5)} ${C}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(r.label)} ${V.pct(r.value / tot, 1, false)}</title></circle>`; acc += len; return s; }).join("")}</svg>`;
  };
  V.pctl = (p) => `<div class="pctl" title="Percentile vs its own history: ${Math.round((p || 0) * 100)}th"><i style="left:${Math.round((p || 0) * 100)}%"></i></div>`;

  V.heatmap = function (labels, M) {
    const col = (v) => { const a = Math.min(1, Math.abs(v)); return v >= 0 ? `rgba(var(--acc-rgb),${(a * 0.85).toFixed(2)})` : `rgba(29,111,216,${(a * 0.85).toFixed(2)})`; };
    return `<div class="tblwrap"><table class="heatmap"><tr><th></th>${labels.map((l) => `<th style="writing-mode:vertical-rl;transform:rotate(180deg);height:70px">${esc(l)}</th>`).join("")}</tr>${M.map((row, i) => `<tr><th style="text-align:right">${esc(labels[i])}</th>${row.map((v, j) => `<td style="background:${i === j ? "var(--raise2)" : col(v)}" title="${esc(labels[i])} × ${esc(labels[j])}: ${v.toFixed(2)}"></td>`).join("")}</tr>`).join("")}</table></div>`;
  };

  // daily transit bars + 1y average line (PortWatch)
  V.transits = function (rows, avg, opts = {}) {
    if (!rows || !rows.length) return `<div class="empty small">No shipping data.</div>`;
    const W = 760, H = opts.h || 150, pl = 34, pr = 10, pt = 10, pb = 20, n = rows.length;
    const mx = Math.max(avg || 0, ...rows.map((r) => r[1] || 0)) * 1.1 || 1;
    const bw = (W - pl - pr) / n;
    const Y = (v) => pt + (1 - v / mx) * (H - pt - pb);
    let s = "";
    for (let i = 0; i <= 3; i++) { const v = (mx * i) / 3; s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${pl - 5}" y="${Y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`; }
    rows.forEach((r, i) => {
      const x = pl + i * bw, tot = r[1] || 0, tk = r[2] || 0;
      s += `<rect x="${x + 0.5}" y="${Y(tot)}" width="${Math.max(1, bw - 1)}" height="${H - pb - Y(tot)}" fill="var(--line2)"><title>${r[0]}: ${tot} transits (${tk} tankers)</title></rect><rect x="${x + 0.5}" y="${Y(tk)}" width="${Math.max(1, bw - 1)}" height="${H - pb - Y(tk)}" fill="var(--acc)" opacity=".8"/>`;
      if (i % Math.ceil(n / 6) === 0) s += `<text x="${x}" y="${H - 5}">${r[0].slice(5)}</text>`;
    });
    if (avg) s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(avg)}" y2="${Y(avg)}" stroke="var(--text)" stroke-dasharray="5 4"/><text x="${W - pr}" y="${Y(avg) - 4}" text-anchor="end" style="fill:var(--text)">normal ${avg.toFixed(0)}/day</text>`;
    return `<svg class="svgchart" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${s}</svg><div class="legend mt8"><span><i style="background:var(--line2);height:8px"></i>all vessels</span><span><i style="background:var(--acc);height:8px"></i>tankers</span></div>`;
  };

  /* ---------- consequence map ---------- */
  V.impactMap = function (m, host, onSelect) {
    const W = 1100, colW = W / 5, nodeW = 178, nodeH = 40;
    const layers = [0, 1, 2, 3, 4].map((l) => m.nodes.filter((n) => n.layer === l));
    const H = Math.max(360, Math.max(...layers.map((l) => l.length)) * 56 + 60);
    const pos = {};
    layers.forEach((ns, l) => { const gap = (H - 40) / (ns.length + 1); ns.sort((a, b) => (b.value || 0) - (a.value || 0)); ns.forEach((n, i) => { pos[n.id] = { x: l * colW + (colW - nodeW) / 2, y: 20 + gap * (i + 1) - nodeH / 2 }; }); });
    const up = css("--up") || "#0a8a4a", dn = css("--down") || "#d12a3c";
    const col = (s) => (s > 0 ? up : dn);
    const fe = m.edges.filter((e) => pos[e.from] && pos[e.to]);
    const edges = fe.map((e, i) => {
      const a = pos[e.from], b = pos[e.to], x1 = a.x + nodeW, y1 = a.y + nodeH / 2, x2 = b.x, y2 = b.y + nodeH / 2;
      const d = x2 <= x1 ? `M${a.x + nodeW / 2} ${a.y + nodeH} C ${a.x + nodeW / 2} ${a.y + nodeH + 40}, ${b.x + nodeW / 2} ${b.y - 40}, ${b.x + nodeW / 2} ${b.y}` : `M${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`;
      const dash = e.uncertainty === "high" ? "5 5" : e.type === "estimate" ? "2 4" : "";
      return `<path class="iedge" data-e="${i}" d="${d}" fill="none" stroke="${col(e.sign)}" stroke-width="${(1 + (e.strength || 0.3) * 3.2).toFixed(1)}" stroke-opacity=".6" ${dash ? `stroke-dasharray="${dash}"` : ""}><title>${esc(e.logic)}</title></path><path class="iedge" data-e="${i}" d="${d}" fill="none" stroke="transparent" stroke-width="12"/>`;
    }).join("");
    const kc = { event: css("--text"), driver: css("--blue"), industry: css("--violet"), holding: css("--acc"), plan: css("--pink") };
    const nodes = m.nodes.map((n) => {
      const p = pos[n.id]; if (!p) return "";
      const v = n.value;
      const bar = v != null ? `<rect x="${p.x}" y="${p.y + nodeH - 3}" width="${Math.min(nodeW, Math.abs(v) * nodeW)}" height="3" rx="1.5" fill="${col(v)}"/>` : "";
      const label = n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label;
      const sub = n.kind === "holding" && n.weight != null ? V.pct(n.weight, 1, false) + " of portfolio" : n.kind === "driver" ? (v > 0 ? "▲ rising" : "▼ falling") : n.kind === "industry" ? (v > 0 ? "tailwind" : "headwind") : n.kind === "plan" ? (v > 0 ? "helped" : "hurt") : "";
      return `<g class="inode" data-n="${esc(n.id)}"><rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" rx="8" fill="var(--panel)" stroke="var(--line2)"/>
        <circle cx="${p.x + 12}" cy="${p.y + 14}" r="3.5" fill="${kc[n.kind]}"/><text x="${p.x + 22}" y="${p.y + 17}" style="font:600 11.5px var(--sans);fill:var(--text)">${esc(label)}</text>
        <text x="${p.x + 22}" y="${p.y + 31}" style="font:10px var(--mono);fill:var(--muted)">${esc(sub)}</text>${bar}<title>${esc(n.label)}${n.desc ? " · " + esc(n.desc) : ""}</title></g>`;
    }).join("");
    host.innerHTML = `<div class="imap-wrap"><div class="imap-cols"><div>Event</div><div>Economic effects</div><div>Second-order</div><div>Industries</div><div>Your holdings &amp; plans</div></div><svg class="imap" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin meet">${edges}${nodes}</svg></div>`;
    const svg = host.querySelector("svg");
    const clear = () => { svg.classList.remove("dimmed"); host.querySelectorAll(".sel,.near").forEach((x) => x.classList.remove("sel", "near")); };
    host.querySelectorAll(".iedge").forEach((el) => (el.onclick = (ev) => {
      ev.stopPropagation(); clear(); svg.classList.add("dimmed");
      const e = fe[+el.dataset.e];
      host.querySelectorAll(`.iedge[data-e="${el.dataset.e}"]`).forEach((x) => x.classList.add("sel"));
      host.querySelectorAll(`.inode[data-n="${CSS.escape(e.from)}"], .inode[data-n="${CSS.escape(e.to)}"]`).forEach((x) => x.classList.add("near"));
      onSelect({ edge: e, from: m.nodes.find((n) => n.id === e.from), to: m.nodes.find((n) => n.id === e.to) });
    }));
    host.querySelectorAll(".inode").forEach((el) => (el.onclick = (ev) => {
      ev.stopPropagation(); clear(); svg.classList.add("dimmed"); el.classList.add("sel");
      const id = el.dataset.n;
      fe.forEach((e, i) => { if (e.from === id || e.to === id) { host.querySelectorAll(`.iedge[data-e="${i}"]`).forEach((x) => x.classList.add("near")); host.querySelectorAll(`.inode[data-n="${CSS.escape(e.from === id ? e.to : e.from)}"]`).forEach((x) => x.classList.add("near")); } });
      onSelect({ node: m.nodes.find((n) => n.id === id), edges: m.edges.filter((e) => e.from === id || e.to === id) });
    }));
    svg.onclick = () => { clear(); onSelect(null); };
  };

  /* ---------- world map (TopoJSON, equirectangular) ---------- */
  let TOPO = null;
  V.loadWorld = async function () {
    if (TOPO) return TOPO;
    TOPO = await (await fetch("/data/countries-110m.json", { credentials: "same-origin" })).json();
    return TOPO;
  };
  function decodeArcs(topo) {
    const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
    return topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
  }
  const ALIAS = { "United States of America": "United States", "Dem. Rep. Congo": "Democratic Republic of Congo (Kinshasa)", "Dominican Rep.": "Dominican Republic", "Falkland Is.": "Falkland Islands",
    "Timor-Leste": "Timor-Leste (East Timor)", "Côte d'Ivoire": "Côte d'Ivoire (Ivory Coast)", "Central African Rep.": "Central African Republic", "Congo": "Republic of Congo (Brazzaville)", "Eq. Guinea": "Equatorial Guinea",
    "eSwatini": "Swaziland", "Israel": "Israel and Palestine", "Palestine": "Israel and Palestine", "Gambia": "Gambia, The", "Turkey": "Türkiye", "Solomon Is.": "Solomon Islands", "Bosnia and Herz.": "Bosnia and Herzegovina",
    "Macedonia": "North Macedonia", "S. Sudan": "South Sudan", "N. Cyprus": "Cyprus", "Somaliland": "Somalia", "W. Sahara": "Morocco" };
  V.worldMap = async function (host, opts = {}) {
    const topo = await V.loadWorld(), arcs = decodeArcs(topo);
    const W = 1000, H = 500, X = (lon) => ((lon + 180) / 360) * W, Y = (lat) => ((85 - lat) / 145) * H;
    const ring = (idx) => { const pts = []; for (const i of idx) { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; pts.push(...(pts.length ? a.slice(1) : a)); } return pts; };
    const levels = opts.levels || {}, byName = {};
    for (const [iso, v] of Object.entries(levels)) byName[(v[2] || "").toLowerCase()] = [iso, v[0]];
    let paths = "";
    for (const g of topo.objects.countries.geometries) {
      const polys = g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : [];
      const d = polys.map((poly) => poly.map((r) => { const pts = ring(r); let s = "", prev = null; for (const [lon, lat] of pts) { const x = X(lon), y = Y(lat); s += (prev && Math.abs(prev - lon) > 180 ? "M" : s ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); prev = lon; } return s + "Z"; }).join("")).join("");
      const nm = g.properties.name, hit = byName[(ALIAS[nm] || nm).toLowerCase()];
      const lvl = nm === "Canada" ? "x" : hit ? hit[1] : "x";
      paths += `<path class="land lvl${lvl}" d="${d}"><title>${esc(nm)}${hit ? " · " + esc(V.kb.ADVISORY[hit[1]]) : ""}</title></path>`;
    }
    const hs = (opts.hotspots || []).map((h) => {
      const x = X(h.ll[1]), y = Y(h.ll[0]);
      const c = h.status === "Critical" ? "var(--down)" : h.status === "Elevated" ? "var(--acc)" : h.status === "Watch" ? "var(--warn)" : h.status === "Calm" ? "var(--up)" : "var(--dim)";
      return `<g class="hs" data-hs="${h.id}"><circle class="ring" cx="${x}" cy="${y}" r="7" stroke="${c}"/><circle class="core" cx="${x}" cy="${y}" r="6" fill="${c}"/><text x="${x + 9}" y="${y + 3}">${esc(h.short || h.name)}</text><title>${esc(h.name)}: ${esc(h.status)}${h.score != null ? " (" + h.score + "/100)" : ""}</title></g>`;
    }).join("");
    const quakes = (opts.quakes || []).map((q) => `<circle cx="${X(q.c[0])}" cy="${Y(q.c[1])}" r="${Math.max(2, (q.m - 4) * 2.2)}" fill="var(--violet)" fill-opacity=".35" stroke="var(--violet)" stroke-width=".6"><title>M${q.m.toFixed(1)} · ${esc(q.p)}</title></circle>`).join("");
    host.innerHTML = `<div class="map-wrap"><svg viewBox="0 0 ${W} ${H}">${paths}${quakes}${hs}</svg></div>`;
    host.querySelectorAll("[data-hs]").forEach((g) => (g.onclick = () => opts.onHotspot && opts.onHotspot(g.dataset.hs)));
  };
})();
