/* Chart and plan rendering — pure functions that return SVG/HTML strings.
 * No DOM access here; app.js decides where the strings go. */
(function (root) {
"use strict";
const HG = root.HG;
const MODEL = HG.MODEL;

/* ------------------------------------------------------------ formatting */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r0 = (n) => Math.round(n).toLocaleString("en-IN");
const r1 = (n) => (Math.round(n * 10) / 10).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const money = (n) => "₹" + r0(n);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmt = { r0, r1, money, esc, clamp };

/* ----------------------------------------------------------- SVG kit */
function svg(w, h, inner, label) {
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(label || "Chart")}"
           style="display:block;height:auto;overflow:visible;font-family:Consolas,'Courier New',monospace">${inner}</svg>`;
}
function txt(x, y, s, o) {
  o = o || {};
  return `<text x="${x}" y="${y}" font-size="${o.size || 11}" fill="${o.fill || "#5B7370"}"
    text-anchor="${o.anchor || "middle"}" font-weight="${o.weight || 400}">${esc(s)}</text>`;
}
function rect(x, y, w, h, fill, rx) {
  return `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="${fill}" rx="${rx === undefined ? 2 : rx}"/>`;
}

/* ---- hyetograph + demand: rainfall hangs from the top, irrigation demand rises from the baseline */
function monthlyChart(site) {
  const W = 840, H = 356, L = 52, R = 14, topH = 92, gap = 26;
  const plotT = topH + gap, plotB = H - 50, bw = (W - L - R) / 12;
  const clim = HG.climateOf(site);
  const base = HG.monthlyTotals(site, {});
  const opt = HG.monthlyTotals(site, { time: true, rain: true, sensor: true, drip: true, native: true });
  const maxV = Math.max.apply(null, base) * 1.1 || 1, maxR = Math.max.apply(null, clim.rain) * 1.12 || 1;
  const yV = (v) => plotB - (v / maxV) * (plotB - plotT);
  let s = "";
  for (let i = 0; i <= 3; i++) {
    const v = maxV * i / 3, y = yV(v);
    s += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#E8EFEE" stroke-width="1"/>`;
    s += txt(L - 7, y + 3.5, Math.round(v), { anchor: "end", size: 10 });
  }
  s += txt(L - 7, plotT - 11, "m³", { anchor: "end", size: 9.5 });
  const rTop = 16;
  for (let m = 0; m < 12; m++) {
    const h = (clim.rain[m] / maxR) * (topH - rTop), x = L + m * bw + bw * 0.30;
    s += rect(x, rTop, bw * 0.40, h, "#8FB8D4", 2);
    const pe = HG.effectiveRain(clim.rain[m]);
    if (pe > 0) s += rect(x, rTop, bw * 0.40, (pe / maxR) * (topH - rTop), "#3F7CA6", 2);
    if (clim.rain[m] >= 60) s += txt(x + bw * 0.20, rTop + h + 11, Math.round(clim.rain[m]), { size: 9.5, fill: "#3F7CA6" });
  }
  s += `<line x1="${L}" y1="${rTop}" x2="${W - R}" y2="${rTop}" stroke="#C6DAE7" stroke-width="1"/>`;
  s += txt(L - 7, rTop + 4, "0", { anchor: "end", size: 10, fill: "#3F7CA6" });
  s += txt(L - 7, rTop - 6, "mm", { anchor: "end", size: 9.5, fill: "#3F7CA6" });
  for (let m = 0; m < 12; m++) {
    const x = L + m * bw;
    s += rect(x + bw * 0.14, yV(base[m]), bw * 0.32, plotB - yV(base[m]), "#C2703D", 2);
    s += rect(x + bw * 0.52, yV(opt[m]), bw * 0.32, plotB - yV(opt[m]), "#10707A", 2);
    if (opt[m] < maxV * 0.012) {
      s += rect(x + bw * 0.52, plotB - 2, bw * 0.32, 2, "#10707A", 1);
      s += txt(x + bw * 0.68, plotB - 6, "nil", { size: 9, fill: "#10707A", weight: 700 });
    }
    s += txt(x + bw / 2, plotB + 15, clim.month[m], { size: 10.5 });
  }
  s += `<line x1="${L}" y1="${plotB}" x2="${W - R}" y2="${plotB}" stroke="#D8E2E0" stroke-width="1"/>`;
  s += txt(L, H - 6, "Rainfall above · irrigation demand below", { anchor: "start", size: 10, fill: "#8FA3A1" });
  return `<div class="bar-key" style="margin:0 0 6px">
      <span><i style="background:#8FB8D4"></i>Rainfall</span>
      <span><i style="background:#3F7CA6"></i>Effective rainfall (usable)</span>
      <span><i class="k-base"></i>Current use</span>
      <span><i class="k-opt"></i>Proposed use</span></div>` +
    svg(W, H, s, "Monthly irrigation demand, current versus proposed, with rainfall");
}

/* ---- cumulative comparison for the simulator */
function simChart(hist) {
  if (!hist.length) return `<p class="small muted" style="margin:0">Run the simulation to plot the comparison.</p>`;
  const W = 840, H = 260, L = 52, R = 16, T = 18, B = 34, n = hist.length;
  const maxY = Math.max(hist[n - 1].base, 1) * 1.08;
  const X = (i) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const Y = (v) => H - B - (v / maxY) * (H - B - T);
  const step = n > 120 ? 30 : n > 40 ? 10 : 5;
  let s = "";
  for (let i = 0; i <= 4; i++) {
    const v = maxY * i / 4, y = Y(v);
    s += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#E8EFEE"/>`;
    s += txt(L - 7, y + 3.5, Math.round(v), { anchor: "end", size: 10 });
  }
  s += txt(L - 7, T - 6, "m³", { anchor: "end", size: 9.5 });
  const path = (key, col) => {
    let d = ""; hist.forEach((h, i) => { d += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(h[key]).toFixed(1) + " "; });
    return `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
  };
  let area = "M" + X(0) + " " + Y(hist[0].base) + " ";
  hist.forEach((h, i) => { area += "L" + X(i).toFixed(1) + " " + Y(h.base).toFixed(1) + " "; });
  for (let i = n - 1; i >= 0; i--) area += "L" + X(i).toFixed(1) + " " + Y(hist[i].ctrl).toFixed(1) + " ";
  s += `<path d="${area}Z" fill="#5F8A3F" opacity=".13"/>` + path("base", "#C2703D") + path("ctrl", "#10707A");
  hist.forEach((h, i) => {
    if (h.rain > 0.5 && n <= 120) s += `<circle cx="${X(i).toFixed(1)}" cy="${H - B + 9}" r="2.6" fill="#3F7CA6"/>`;
    if (i % step === 0 || i === n - 1) s += txt(X(i), H - B + 22, "d" + h.day, { size: 10 });
  });
  s += `<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#D8E2E0"/>`;
  const last = hist[n - 1], cut = last.base - last.ctrl, pct = last.base ? cut / last.base * 100 : 0;
  return `<div class="bar-key" style="margin:0 0 8px">
      <span><i class="k-base"></i>Fixed timer</span><span><i class="k-opt"></i>HydroGarden controller</span>
      <span><i style="background:#3F7CA6;border-radius:50%"></i>Rain day</span></div>` +
    svg(W, H, s, "Cumulative water applied by the controller and by a fixed timer") +
    `<p class="small" style="margin:10px 0 0">After <b class="num">${n}</b> simulated days the controller has used
     <b class="num">${r1(last.ctrl)} m³</b> against the fixed timer's <b class="num">${r1(last.base)} m³</b> — a saving of
     <b class="num" style="color:var(--moss-dk)">${r1(cut)} m³ (${r1(pct)}%)</b> for this window only.</p>`;
}

/* ---- monthly supply vs demand with tank level */
function harvestChart(h) {
  const W = 840, H = 300, L = 52, R = 14, T = 16, B = 46, bw = (W - L - R) / 12;
  const maxV = Math.max.apply(null, h.monthly.map((m) => Math.max(m.demand, m.rain + m.grey))) * 1.1 || 1;
  const Y = (v) => H - B - (v / maxV) * (H - B - T);
  let s = "";
  for (let i = 0; i <= 3; i++) {
    const v = maxV * i / 3, y = Y(v);
    s += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#E8EFEE"/>` + txt(L - 7, y + 3.5, Math.round(v), { anchor: "end", size: 10 });
  }
  s += txt(L - 7, T - 4, "m³", { anchor: "end", size: 9.5 });
  h.monthly.forEach((m, i) => {
    const x = L + i * bw;
    s += rect(x + bw * 0.10, Y(m.demand), bw * 0.34, (H - B) - Y(m.demand), "#10707A", 2);
    s += rect(x + bw * 0.52, Y(m.rain), bw * 0.34, (H - B) - Y(m.rain), "#3F7CA6", 2);
    s += rect(x + bw * 0.52, Y(m.rain + m.grey), bw * 0.34, (H - B) - Y(m.rain + m.grey) - ((H - B) - Y(m.rain)), "#5F8A3F", 2);
    if (m.mains > 0.5) s += rect(x + bw * 0.10, H - B + 6, bw * 0.34, 4, "#A8402F", 1);
    s += txt(x + bw / 2, H - B + 24, m.month, { size: 10.5 });
  });
  s += `<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#D8E2E0"/>`;
  return `<div class="bar-key" style="margin:0 0 6px">
      <span><i class="k-opt"></i>Garden demand after retrofit</span><span><i style="background:#3F7CA6"></i>Roof harvest</span>
      <span><i style="background:#5F8A3F"></i>Usable greywater</span><span><i style="background:#A8402F"></i>Month needing mains water</span></div>` +
    svg(W, H, s, "Monthly garden demand against roof harvest and greywater supply");
}


/* ---------------------------------------------------------- site plan ----
   A squarified treemap: every zone is a rectangle whose AREA is proportional to
   its surveyed m², and whose fill is the CURRENT method on a warm-to-cool
   efficiency ramp, so the plan visibly cools as zones are converted.        */
const PLAN_FILL = { hose: "#A8402F", flood: "#B4552E", spray: "#C2703D", micro: "#5F8A3F", drip: "#14919B", subdrip: "#10707A" };

function squarify(items, X, Y, W, H){
  const out = [];
  let list = items.slice().sort((a,b) => b.value - a.value);
  let x = X, y = Y, w = W, h = H;
  let remain = list.reduce((s,i) => s + i.value, 0);

  while (list.length){
    if (remain <= 0) break;
    const horiz = w >= h;                       /* row runs down the short edge */
    const short = horiz ? h : w;
    const long  = horiz ? w : h;

    let n = 1, bestAsp = Infinity;
    for (let k = 1; k <= list.length; k++){
      const val = list.slice(0,k).reduce((s,i) => s + i.value, 0);
      const thick = (val / remain) * long;
      let asp = 0;
      for (const it of list.slice(0,k)){
        const len = (it.value / val) * short;
        if (len <= 0 || thick <= 0) { asp = Infinity; break; }
        asp = Math.max(asp, Math.max(thick/len, len/thick));
      }
      if (asp <= bestAsp){ bestAsp = asp; n = k; } else break;
    }

    const row = list.slice(0,n);
    const val = row.reduce((s,i) => s + i.value, 0);
    const thick = (val / remain) * long;
    let off = 0;
    for (const it of row){
      const len = (it.value / val) * short;
      out.push(horiz ? { ...it, x, y: y + off, w: thick, h: len }
                     : { ...it, x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (horiz){ x += thick; w -= thick; } else { y += thick; h -= thick; }
    remain -= val;
    list = list.slice(n);
  }
  return out;
}

/* SVG has no text metrics without a live layout; a monospace glyph is a dependable
   0.60 em wide, so label width is computable and labels can be fitted, not hoped for. */
const CH_W = 0.60;
const measure = (s, size) => String(s).length * size * CH_W;

function fitLabel(s, width, sizes, maxLines){
  const words = String(s).split(/\s+/).filter(Boolean);
  for (const size of sizes){
    const maxChars = Math.floor(width / (size * CH_W));
    if (maxChars < 3) continue;
    const lines = [];
    let cur = "", overflow = false;
    for (const word of words){
      if (word.length > maxChars){ overflow = true; break; }
      const join = cur ? cur + " " + word : word;
      if (join.length <= maxChars) cur = join;
      else { lines.push(cur); cur = word; }
    }
    if (overflow) continue;
    if (cur) lines.push(cur);
    if (lines.length <= maxLines) return { size, lines };
  }
  return null;
}

function planSVG(site){
  const ZONES = site.zones;
  if (!ZONES.length) return "";
  const W = 1000, H = 560, PAD = 3;

  const cells = squarify(
    ZONES.map(z => ({ z, value: Math.max(1, z.area) })), 0, 0, W, H);

  let body = "";
  for (const c of cells){
    const z = c.z;
    const x = c.x + PAD, y = c.y + PAD;
    const w = Math.max(0, c.w - PAD*2), h = Math.max(0, c.h - PAD*2);
    const saved = HG.baselineVolume(z, site) - HG.optimisedVolume(z, site);
    body += rect(x, y, w, h, PLAN_FILL[z.now] || "#5B7370", 7);

    const cx = x + 16, inner = w - 32;
    const name = fitLabel(z.name, inner, [25,21,18,15], 2);

    if (!name || h < 46){
      /* no room for words — carry the zone id, keyed to the table above */
      if (w > 54 && h > 26)
        body += txt(x + w/2, y + h/2 + 6, z.id, { size:16, fill:"#fff", weight:700 });
      continue;
    }

    /* vertical budget, measured rather than guessed */
    const nameH  = name.lines.length * name.size * 1.14;
    const meta   = fitLabel(fmt.r0(z.area) + " m² · " +
                            HG.MODEL.methodName[z.now], inner, [16,14,12,11], 1)
                || fitLabel(fmt.r0(z.area) + " m²", inner, [14,12,11], 1);
    const savesTxt  = "saves " + fmt.r0(saved) + " m³/yr";
    const savesFits = saved > 1 && fitLabel(savesTxt, inner, [17], 1) &&
                      h > nameH + 74;
    const metaFits  = meta && h > nameH + 30 + (savesFits ? 32 : 0);

    let ty = y + (h > 96 ? 18 + name.size : (h + name.size) / 2 - 3);
    for (const line of name.lines){
      body += txt(cx, ty, line, { size:name.size, fill:"#fff",
                                  weight:700, anchor:"start" });
      ty += name.size * 1.14;
    }
    if (metaFits){
      body += txt(cx, ty + 5, meta.lines[0],
                  { size:meta.size, fill:"rgba(255,255,255,.88)", anchor:"start" });
    }
    if (savesFits){
      body += txt(cx, y + h - 18, savesTxt,
                  { size:17, fill:"#fff", weight:700, anchor:"start" });
    }
  }

  /* legend: only the methods actually present, in efficiency order.
     Widths come from measure(), so entries can never run into each other. */
  const order = ["hose","flood","spray","micro","drip","subdrip"];
  const used  = order.filter(m => ZONES.some(z => z.now === m));
  let lx = 0, legend = "";
  for (const m of used){
    const lab = HG.MODEL.methodName[m];
    legend += rect(lx, H + 26, 13, 13, PLAN_FILL[m], 3);
    legend += txt(lx + 20, H + 37, lab, { size:14, fill:"#5B7370", anchor:"start" });
    lx += 20 + measure(lab, 14) + 22;
  }
  const note = "block area ∝ zone area";
  /* only add the right-hand note if it cannot collide with the legend */
  if (W - measure(note, 13) > lx + 16)
    legend += txt(W, H + 37, note, { size:13, fill:"#93A8A6", anchor:"end" });

  return svg(W, H + 48, body + legend, "Site plan: each block is a garden zone drawn to relative area and coloured by current irrigation method");
}

root.HGCharts = { fmt, svg, txt, rect, monthlyChart, simChart, harvestChart, planSVG, squarify, fitLabel };
})(typeof self !== "undefined" ? self : this);
