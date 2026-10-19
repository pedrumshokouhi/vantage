/* Hand-built SVG charts: sparkline, line comparison, bars, donut, consequence map. */
"use strict";
(function () {
  const esc = V.esc;

  V.spark = function (vals, w = 110, h = 30, color) {
    vals = (vals || []).filter((v) => v != null);
    if (vals.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
    const mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1;
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - 3 - ((v - mn) / r) * (h - 6)]);
    const c = color || (vals[vals.length - 1] >= vals[0] ? "var(--up)" : "var(--down)");
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
    const id = "sg" + Math.random().toString(36).slice(2, 8);
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".25"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs><path d="${d}L${w} ${h}L0 ${h}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${c}" stroke-width="1.5"/></svg>`;
  };

  // series: [{name, color, pts:[[t, v]], dash}]
  V.lineChart = function (series, opts = {}) {
    const W = opts.w || 760, H = opts.h || 220, pl = 44, pr = 12, pt = 12, pb = 24;
    const all = series.flatMap((s) => s.pts.filter((p) => p[1] != null));
    if (all.length < 2) return `<div class="empty">Not enough history to chart yet.</div>`;
    const t0 = Math.min(...all.map((p) => p[0])), t1 = Math.max(...all.map((p) => p[0]));
    let mn = Math.min(...all.map((p) => p[1])), mx = Math.max(...all.map((p) => p[1]));
    const pad = (mx - mn) * 0.08 || 1; mn -= pad; mx += pad;
    const X = (t) => pl + ((t - t0) / (t1 - t0 || 1)) * (W - pl - pr);
    const Y = (v) => pt + (1 - (v - mn) / (mx - mn)) * (H - pt - pb);
    let g = "";
    for (let i = 0; i <= 4; i++) {
      const v = mn + ((mx - mn) * i) / 4;
      g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(148,170,200,.08)"/><text x="${pl - 8}" y="${Y(v) + 3}" text-anchor="end">${opts.fmt ? opts.fmt(v) : v.toFixed(0)}</text>`;
    }
    const months = [];
    for (let t = t0; t <= t1; t += 86400 * 30.4) months.push(t);
    months.forEach((t, i) => { if (i % Math.ceil(months.length / 6) === 0) g += `<text x="${X(t)}" y="${H - 6}" text-anchor="middle">${new Date(t * 1000).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}</text>`; });
    if (opts.base != null) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(opts.base)}" y2="${Y(opts.base)}" stroke="rgba(148,170,200,.25)" stroke-dasharray="3 4"/>`;
    const paths = series.map((s) => {
      const p = s.pts.filter((x) => x[1] != null);
      const d = p.map((x, i) => (i ? "L" : "M") + X(x[0]).toFixed(1) + " " + Y(x[1]).toFixed(1)).join("");
      const last = p[p.length - 1];
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.8}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>` +
        (last ? `<circle cx="${X(last[0])}" cy="${Y(last[1])}" r="3" fill="${s.color}"/>` : "");
    }).join("");
    const id = "lc" + Math.random().toString(36).slice(2, 8);
    setTimeout(() => {
      const svg = document.getElementById(id); if (!svg) return;
      const tip = svg.parentElement.querySelector(".lctip"), ln = svg.querySelector(".hov");
      svg.onmousemove = (e) => {
        const r = svg.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * W;
        const t = t0 + ((x - pl) / (W - pl - pr)) * (t1 - t0);
        ln.setAttribute("x1", x); ln.setAttribute("x2", x); ln.style.opacity = 1;
        const rows = series.map((s) => { let best = null; for (const p of s.pts) if (p[1] != null && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p; return best ? `<div><span style="color:${s.color}">●</span> ${esc(s.name)} <b class="mono">${opts.fmt ? opts.fmt(best[1]) : best[1].toFixed(1)}</b></div>` : ""; }).join("");
        tip.innerHTML = `<div class="xs dim mono">${new Date(t * 1000).toLocaleDateString()}</div>${rows}`;
        tip.style.display = "block"; tip.style.left = Math.min(r.width - 170, e.clientX - r.left + 12) + "px"; tip.style.top = "8px";
      };
      svg.onmouseleave = () => { tip.style.display = "none"; ln.style.opacity = 0; };
    });
    return `<div style="position:relative"><svg id="${id}" class="svgchart" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${g}${paths}<line class="hov" y1="${pt}" y2="${H - pb}" stroke="rgba(148,170,200,.35)" style="opacity:0"/></svg><div class="lctip net-tip" style="display:none;transform:none"></div></div>`;
  };

  V.barList = function (rows, opts = {}) {
    // rows: [{label, value, color, sub}] value in [0,1] (or signed for diverging)
    const max = opts.max || Math.max(...rows.map((r) => Math.abs(r.value)), 0.0001);
    return `<div class="bars ${opts.diverging ? "div" : ""}">${rows.map((r) => {
      const w = (Math.abs(r.value) / max) * (opts.diverging ? 50 : 100);
      const left = opts.diverging ? (r.value >= 0 ? 50 : 50 - w) : 0;
      const c = r.color || (opts.diverging ? (r.value >= 0 ? "var(--up)" : "var(--down)") : "var(--ion)");
      return `<div class="b" ${r.title ? `title="${esc(r.title)}"` : ""}><span class="ellipsis">${esc(r.label)}</span><span class="track"><b style="left:${left}%;width:${Math.max(0.5, w)}%;background:${c}"></b></span><span class="mono right small">${opts.fmt ? opts.fmt(r.value) : V.pct(r.value, 1, false)}</span></div>`;
    }).join("")}</div>`;
  };

  V.donut = function (rows, size = 140) {
    const tot = rows.reduce((a, r) => a + r.value, 0) || 1;
    const R = size / 2 - 8, C = 2 * Math.PI * R;
    let acc = 0;
    const segs = rows.map((r, i) => {
      const len = (r.value / tot) * C;
      const s = `<circle r="${R}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${r.color || V.color(r.label)}" stroke-width="12" stroke-dasharray="${Math.max(0, len - 1.5)} ${C}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(r.label)} ${V.pct(r.value / tot, 1, false)}</title></circle>`;
      acc += len; return s;
    }).join("");
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${segs}</svg>`;
  };

  /* ---------- consequence map ---------- */
  V.impactMap = function (m, host, onSelect) {
    const W = 1100, colW = W / 5, nodeW = 176, nodeH = 40;
    const layers = [0, 1, 2, 3, 4].map((l) => m.nodes.filter((n) => n.layer === l));
    const H = Math.max(360, Math.max(...layers.map((l) => l.length)) * 56 + 60);
    const pos = {};
    layers.forEach((ns, l) => {
      const gap = (H - 40) / (ns.length + 1);
      ns.sort((a, b) => (b.value || 0) - (a.value || 0));
      ns.forEach((n, i) => { pos[n.id] = { x: l * colW + (colW - nodeW) / 2, y: 20 + gap * (i + 1) - nodeH / 2 }; });
    });
    const col = (sign) => (sign > 0 ? "#34d399" : "#fb7185");
    const edges = m.edges.filter((e) => pos[e.from] && pos[e.to]).map((e, i) => {
      const a = pos[e.from], b = pos[e.to];
      const x1 = a.x + nodeW, y1 = a.y + nodeH / 2, x2 = b.x, y2 = b.y + nodeH / 2;
      const same = x2 <= x1;
      const d = same ? `M${a.x + nodeW / 2} ${a.y + nodeH} C ${a.x + nodeW / 2} ${a.y + nodeH + 40}, ${b.x + nodeW / 2} ${b.y - 40}, ${b.x + nodeW / 2} ${b.y}` : `M${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`;
      const wdt = 1 + (e.strength || 0.3) * 3.2;
      const dash = e.uncertainty === "high" ? "5 5" : e.type === "estimate" ? "2 4" : "";
      return `<path class="iedge" data-e="${i}" d="${d}" fill="none" stroke="${col(e.sign)}" stroke-width="${wdt.toFixed(1)}" stroke-opacity=".55" ${dash ? `stroke-dasharray="${dash}"` : ""} style="opacity:.8"><title>${esc(e.logic)}</title></path><path class="iedge" data-e="${i}" d="${d}" fill="none" stroke="transparent" stroke-width="12"/>`;
    }).join("");
    const kindColor = { event: "var(--text)", driver: "var(--sky)", industry: "var(--violet)", holding: "var(--ion)", plan: "var(--pink)" };
    const nodes = m.nodes.map((n) => {
      const p = pos[n.id]; if (!p) return "";
      const v = n.value;
      const bar = v != null ? `<rect x="${p.x}" y="${p.y + nodeH - 3}" width="${Math.min(nodeW, Math.abs(v) * nodeW)}" height="3" rx="1.5" fill="${col(v)}" opacity=".85"/>` : "";
      const label = n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label;
      const sub = n.kind === "holding" && n.weight != null ? V.pct(n.weight, 1, false) + " of portfolio" : n.kind === "driver" ? (v > 0 ? "▲ rising" : "▼ falling") : n.kind === "industry" ? (v > 0 ? "tailwind" : "headwind") : n.kind === "plan" ? (v > 0 ? "helped" : "hurt") : "";
      return `<g class="inode" data-n="${esc(n.id)}"><rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" rx="9" fill="rgba(12,17,26,.95)" stroke="rgba(148,170,200,.25)"/>
        <circle cx="${p.x + 12}" cy="${p.y + 14}" r="3.5" fill="${kindColor[n.kind]}"/>
        <text x="${p.x + 22}" y="${p.y + 17}" fill="#e8eef6" style="font:500 11.5px var(--sans)">${esc(label)}</text>
        <text x="${p.x + 22}" y="${p.y + 31}" fill="#8593a6" style="font:10px var(--mono)">${esc(sub)}</text>${bar}<title>${esc(n.label)}${n.desc ? " · " + esc(n.desc) : ""}</title></g>`;
    }).join("");
    host.innerHTML = `<div class="imap-wrap"><div class="imap-cols"><div>Event</div><div>Economic effects</div><div>Second-order</div><div>Industries</div><div>Your holdings &amp; plans</div></div>
      <svg class="imap" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin meet">${edges}${nodes}</svg></div>`;
    const svg = host.querySelector("svg");
    const clear = () => { svg.classList.remove("dimmed"); host.querySelectorAll(".sel,.near").forEach((x) => x.classList.remove("sel", "near")); };
    host.querySelectorAll(".iedge").forEach((el) => (el.onclick = (ev) => {
      ev.stopPropagation(); clear(); svg.classList.add("dimmed");
      const e = m.edges.filter((x) => pos[x.from] && pos[x.to])[+el.dataset.e];
      host.querySelectorAll(`.iedge[data-e="${el.dataset.e}"]`).forEach((x) => x.classList.add("sel"));
      host.querySelectorAll(`.inode[data-n="${CSS.escape(e.from)}"], .inode[data-n="${CSS.escape(e.to)}"]`).forEach((x) => x.classList.add("near"));
      onSelect({ edge: e, from: m.nodes.find((n) => n.id === e.from), to: m.nodes.find((n) => n.id === e.to) });
    }));
    host.querySelectorAll(".inode").forEach((el) => (el.onclick = (ev) => {
      ev.stopPropagation(); clear(); svg.classList.add("dimmed"); el.classList.add("sel");
      const id = el.dataset.n;
      const fe = m.edges.filter((x) => pos[x.from] && pos[x.to]);
      fe.forEach((e, i) => { if (e.from === id || e.to === id) { host.querySelectorAll(`.iedge[data-e="${i}"]`).forEach((x) => x.classList.add("near")); host.querySelectorAll(`.inode[data-n="${CSS.escape(e.from === id ? e.to : e.from)}"]`).forEach((x) => x.classList.add("near")); } });
      onSelect({ node: m.nodes.find((n) => n.id === id), edges: m.edges.filter((e) => e.from === id || e.to === id) });
    }));
    svg.onclick = () => { clear(); onSelect(null); };
  };
})();
