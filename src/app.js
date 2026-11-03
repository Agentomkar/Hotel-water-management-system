/* HydroGarden UI. All numbers come from engine.js; this file only wires inputs and draws. */
(function () {
"use strict";
const HG = window.HG, P = window.HGPortfolio, C = window.HGCharts;
const MODEL = HG.MODEL;
const { r0, r1, money, esc, clamp } = C.fmt;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const STORE_KEY = "hydrogarden.site.v1";
const DEMO_LABEL = "Lakeview Grand Hotel (demo site)";
const MAX_ZONES = 60;

/* One stable site object: renderers read it, loaders mutate it in place. */
const SITE = HG.defaultSite();
const ZONES = SITE.zones, CFG = SITE.cfg;
let label = DEMO_LABEL, SIM = null, PORT = null, runToken = 0;

/* ------------------------------------------------------------ persistence */
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ zones: ZONES, cfg: CFG, label })); } catch (e) { /* private mode etc. */ }
}
function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY); if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.zones) || !d.zones.length) return false;
    applySite(d.zones, d.cfg, String(d.label || DEMO_LABEL));
    return true;
  } catch (e) { return false; }
}
function applySite(zones, cfg, lbl) {
  const seen = {};
  const z = zones.slice(0, MAX_ZONES).map((x, i) => {
    const c = HG.sanitizeZone(x, i);
    while (seen[c.id]) c.id = (c.id.slice(0, 20) + "_" + i).slice(0, 24);      // ids key the simulator state
    seen[c.id] = true; return c;
  });
  ZONES.splice(0, ZONES.length, ...z);
  Object.assign(CFG, HG.sanitizeCfg(cfg));
  label = lbl;
}
function setSite(zones, cfg, lbl) {
  applySite(zones, cfg, lbl);
  syncInputs(); renderEditor(); resetSim(); renderAll(); save();
}

/* ---------------------------------------------------------------- inputs */
const CFG_INPUTS = { tariff: "#inTariff", rainfall: "#inRain", peakET0: "#inET", season: "#inDays", nativeShare: "#inNative",
                     roof: "#inRoof", rooms: "#inRooms", greyShare: "#inGrey", tank: "#inTank" };
function nearestOption(sel, v) {
  let best = sel.options[0].value, d = Infinity;
  Array.from(sel.options).forEach((o) => { const x = Math.abs(parseFloat(o.value) - v); if (x < d) { d = x; best = o.value; } });
  return best;
}
function syncInputs() {
  Object.keys(CFG_INPUTS).forEach((k) => {
    const el = $(CFG_INPUTS[k]); if (!el) return;
    el.value = el.tagName === "SELECT" ? nearestOption(el, CFG[k]) : String(Math.round(CFG[k] * 100) / 100);
  });
}
function readInputs() {
  const raw = {};
  Object.keys(CFG_INPUTS).forEach((k) => { const v = parseFloat($(CFG_INPUTS[k]).value); if (isFinite(v)) raw[k] = v; });
  Object.assign(CFG, HG.sanitizeCfg(Object.assign({}, CFG, raw)));
}

/* ----------------------------------------------------------------- views */
const VIEWS = ["dash", "zones", "portfolio", "audit", "schedule", "sim", "harvest", "method", "limits"];
function switchView(name, focusTab, opts) {
  if (VIEWS.indexOf(name) < 0) name = "dash";
  $$(".tab").forEach((t) => {
    const on = t.dataset.view === name;
    t.classList.toggle("on", on); t.setAttribute("aria-selected", on ? "true" : "false"); t.tabIndex = on ? 0 : -1;
    if (on && focusTab) t.focus();
  });
  $$(".view").forEach((v) => v.classList.toggle("on", v.id === "view-" + name));
  try { history.replaceState(null, "", "#" + name); } catch (e) { /* file:// in some browsers */ }
  const app = document.getElementById("app");
  if (app && opts && opts.scroll !== false) window.scrollTo(0, app.offsetTop);
}
function tabKeys(e) {
  const i = VIEWS.indexOf(e.target.dataset.view); if (i < 0) return;
  let j = null;
  if (e.key === "ArrowRight") j = (i + 1) % VIEWS.length;
  else if (e.key === "ArrowLeft") j = (i + VIEWS.length - 1) % VIEWS.length;
  else if (e.key === "Home") j = 0; else if (e.key === "End") j = VIEWS.length - 1;
  if (j !== null) { e.preventDefault(); switchView(VIEWS[j], true); }
}

/* ------------------------------------------------------------- dashboard */
let uncCache = { key: "", val: null };
function uncertainty() {
  const key = JSON.stringify([ZONES, CFG]);
  if (uncCache.key !== key) uncCache = { key, val: HG.uncertainty(SITE, { n: 400 }) };
  return uncCache.val;
}
const payTxt = (v) => (v === null || !isFinite(v) ? "no payback" : v === 0 ? "nothing to buy" : r1(v) + " yr");

function renderDash() {
  const s = HG.summary(SITE), u = uncertainty();
  $("#kBase").innerHTML = r0(s.base) + '<span class="unit">m³/yr</span>';
  $("#kOpt").innerHTML = r0(s.opt) + '<span class="unit">m³/yr</span>';
  $("#kPct").innerHTML = Math.round(s.pct) + '<span class="unit">%</span>';
  $("#kPay").innerHTML = (s.payback === null ? "—" : r1(s.payback)) + '<span class="unit">yr</span>';
  $("#kBaseCost").textContent = money(s.base * CFG.tariff) + " per year at the current tariff";
  $("#kOptCost").textContent = money(s.opt * CFG.tariff) + " per year";
  $("#kSaved").textContent = r0(s.saved) + " m³ · " + money(s.cash) + " saved annually";
  $("#kCapex").textContent = money(s.capex) + " retrofit · " + money(s.om) + "/yr O&M";
  $("#kPctBand").innerHTML = `likely <b>${Math.round(u.pct.p10)}–${Math.round(u.pct.p90)}%</b> (P10–P90)`;
  $("#kPayBand").innerHTML = `likely <b>${payTxt(u.payback.p10)} – ${payTxt(u.payback.p90)}</b>` +
    (s.simplePayback !== null && isFinite(s.simplePayback) ? ` · ${r1(s.simplePayback)} yr before O&amp;M` : "");
  $("#uncNote").innerHTML =
    `The current-use figure is a <b>model of assumed practice</b> — there is no meter on this garden. Varying the overwatering ` +
    `factor, current efficiencies and crop coefficients over plausible ranges moves the saving between ` +
    `<b>${Math.round(u.pct.p10)}% and ${Math.round(u.pct.p90)}%</b> (P10–P90, ${u.n} seeded draws), centred near ` +
    `<b>${Math.round(u.pct.p50)}%</b>. It becomes a result only once a pilot zone is metered.`;

  const max = Math.max.apply(null, ZONES.map((z) => HG.baselineVolume(z, SITE)).concat([1e-9]));
  $("#cmpBars").innerHTML = ZONES.map((z) => {
    const b = HG.baselineVolume(z, SITE), o = HG.optimisedVolume(z, SITE), cut = b - o;
    return `<div class="cmp-row">
      <div class="cmp-lab"><b>${esc(z.name)}</b><span class="saveflag">−${r0(cut)} m³ (${Math.round(b ? cut / b * 100 : 0)}%)</span></div>
      <div class="bar base"><span style="width:${b / max * 100}%"></span></div>
      <div class="bar opt"><span style="width:${o / max * 100}%"></span></div>
      <div class="small muted"><span class="num">${r0(b)}</span> → <span class="num">${r0(o)}</span> m³/yr</div></div>`;
  }).join("");

  const wf = HG.savingsByMeasure(SITE), wmax = Math.max.apply(null, wf.map((w) => Math.abs(w.saved)).concat([1e-9]));
  $("#wfList").innerHTML = wf.map((w) => `
    <div class="wf-item">
      <div><b>${esc(w.label)}</b><br><span class="small muted">${esc(w.note)}</span></div>
      <div class="wf-track"><span style="width:${Math.max(0, w.saved) / wmax * 100}%"></span></div>
      <div class="wf-val">${r0(w.saved)} m³</div></div>`).join("");

  const mb = HG.monthlyTotals(SITE, {}), mo = HG.monthlyTotals(SITE, { time: true, rain: true, sensor: true, drip: true, native: true });
  const tot = mb.reduce((a, b) => a + b, 0) - mo.reduce((a, b) => a + b, 0);
  let wet = 0; for (let m = 5; m <= 8; m++) wet += mb[m] - mo[m];
  $("#wetNote").innerHTML = tot > 0 && wet / tot > 0.25
    ? `<b>${Math.round(wet / tot * 100)}% of the modelled saving falls in June–September</b>, because the fixed timers are assumed to keep running ` +
      `(at half depth) through the monsoon. If the grounds team already pauses irrigation when it rains, expect a smaller saving than shown.`
    : "";
  $("#monthChart").innerHTML = C.monthlyChart(SITE);
  $("#siteName").textContent = label;
  $("#siteArea").textContent = r0(ZONES.reduce((a, z) => a + z.area, 0));
  $("#siteZones").textContent = ZONES.length;
}

/* ----------------------------------------------------------------- zones */
function gauge(pctFull, threshPct, dry) {
  let ticks = ""; for (let i = 1; i < 4; i++) ticks += `<i style="top:${i * 25}%"></i>`;
  return `<div class="gauge"><div class="tube ${dry ? "dry" : ""}"><div class="ticks">${ticks}</div>
    <div class="fill" style="height:${clamp(pctFull, 0, 100)}%"></div><div class="thresh" style="bottom:${clamp(threshPct, 0, 100)}%"></div></div>
    <div class="pct">${Math.round(pctFull)}%</div><div class="cap">soil<br>moisture</div></div>`;
}
function zoneCard(z, live) {
  const sc = HG.schedule(z, SITE), base = HG.baselineVolume(z, SITE), opt = HG.optimisedVolume(z, SITE);
  const cut = base - opt, pct = base ? cut / base * 100 : 0;
  const st = live && SIM ? SIM.state[z.id] : null;
  const full = st ? clamp(100 - (st.dr / sc.taw) * 100, 0, 100) : 100;
  const thresh = 100 - MODEL.depletion[z.plant] * 100, dry = st ? st.dr >= sc.raw : false;
  const decision = st && SIM.day > 0
    ? (st.last === "water" ? `<div class="verdict water">▸ Irrigating — ${r1(st.lastMm)} mm applied</div>`
                           : `<div class="verdict skip">▪ Holding — soil above threshold</div>`) : "";
  return `<div class="card zone">${gauge(full, thresh, dry)}<div class="zone-body">
    <h4>${esc(z.name)}</h4>
    <div class="zone-meta">${r0(z.area)} m² · ${MODEL.soilName[z.soil]} · ${MODEL.methodName[z.now]}</div>
    <div class="zrow"><span>Peak ET<sub>c</sub></span><b>${r1(sc.etc)} mm/d</b></div>
    <div class="zrow"><span>Trigger depletion</span><b>${r1(sc.raw)} mm</b></div>
    <div class="zrow"><span>Current use</span><b style="color:var(--clay-dk)">${r0(base)} m³/yr</b></div>
    <div class="zrow"><span>Proposed use</span><b style="color:var(--teal)">${r0(opt)} m³/yr</b></div>
    <div class="zrow"><span>Saving</span><b class="saveflag">${r0(cut)} m³ · ${Math.round(pct)}%</b></div>${decision}</div></div>`;
}
const PLANT_LABEL = { turf: "Turf grass", bed: "Ornamental beds", shrub: "Shrubs", hedge: "Hedge", tree: "Palms & trees", native: "Drought-tolerant" };

function renderZones() {
  $("#zoneCards").innerHTML = ZONES.map((z) => zoneCard(z, false)).join("");
  $("#planFig").innerHTML = C.planSVG(SITE);
  $("#zoneTable tbody").innerHTML = ZONES.map((z) => {
    const sc = HG.schedule(z, SITE), b = HG.baselineVolume(z, SITE), o = HG.optimisedVolume(z, SITE);
    return `<tr><td><b>${esc(z.name)}</b></td>
      <td>${PLANT_LABEL[z.plant] || z.plant}${z.plantName ? `<br><span class="small muted">${esc(z.plantName)}</span>` : ""}</td>
      <td class="r num">${r0(z.area)}</td><td class="r num">${HG.zoneKc(z, SITE).toFixed(2)}</td><td class="r num">${r1(sc.etc)}</td>
      <td>${MODEL.methodName[z.now]}<br><span class="small muted">${isFinite(z.timeEffNow) ? "mixed times of day" : MODEL.timeName[z.window]}</span></td>
      <td class="r num">${HG.baselineEa(z, SITE).toFixed(2)}</td>
      <td class="r num" style="color:var(--clay-dk)">${r0(b)}</td><td class="r num" style="color:var(--teal)">${r0(o)}</td>
      <td class="r num" style="color:var(--moss-dk);font-weight:700">${r0(b - o)}</td></tr>`;
  }).join("");
}

/* ----------------------------------------------------------- zone editor */
function opts(table, selected, label) {
  return Object.keys(table).map((k) => `<option value="${k}"${k === selected ? " selected" : ""}>${esc(label ? label[k] : table[k])}</option>`).join("");
}
let plantOptions = "";
function buildPlantOptions() {
  const lib = window.HG_PLANTS || []; if (!lib.length) return "";
  const groups = {}; lib.forEach((p) => { (groups[p[2]] = groups[p[2]] || []).push(p); });
  return ["Very Low", "Low", "Moderate", "High"].filter((g) => groups[g]).map((g) =>
    `<optgroup label="${g} water use">` + groups[g].sort((a, b) => a[1].localeCompare(b[1])).map((p) =>
      `<option value="${esc(p[0])}">${esc(p[1])} (Kc ${p[3]})</option>`).join("") + "</optgroup>").join("");
}
function plantSel(z) {
  const lib = window.HG_PLANTS || [], hit = z.plantName ? lib.find((p) => p[1] === z.plantName && p[3] === z.kc) : null;
  const html = `<option value="">— type default —</option>` + plantOptions;
  return hit ? html.replace(`value="${esc(hit[0])}"`, `value="${esc(hit[0])}" selected`) : html;
}
function renderEditor() {
  const plantNames = { turf: "Turf grass", bed: "Ornamental beds", shrub: "Shrubs", hedge: "Hedge", tree: "Palms & trees" };
  const times = Object.keys(MODEL.timeEff).reduce((o, k) => { o[k] = k[0].toUpperCase() + k.slice(1) + " " + MODEL.timeName[k]; return o; }, {});
  $("#editor tbody").innerHTML = ZONES.map((z, i) => `<tr data-i="${i}">
    <td><input type="text" data-f="name" value="${esc(z.name)}" aria-label="Zone ${i + 1} name" maxlength="60"></td>
    <td><select data-f="plant" aria-label="Planting">${opts(plantNames, z.plant, plantNames)}</select></td>
    <td><select data-f="lib" aria-label="Plant library">${plantSel(z)}</select></td>
    <td><input type="number" data-f="area" value="${z.area}" min="0" max="1000000" step="10" aria-label="Area m²"></td>
    <td><select data-f="soil" aria-label="Soil">${opts(MODEL.soilName, z.soil, MODEL.soilName)}</select></td>
    <td><select data-f="now" aria-label="Current method">${opts(MODEL.methodName, z.now, MODEL.methodName)}</select></td>
    <td><select data-f="window" aria-label="Watering time">${opts(times, z.window, times)}</select></td>
    <td class="c"><input type="checkbox" data-f="slope" ${z.slope ? "checked" : ""} aria-label="On a slope"></td>
    <td class="c"><input type="checkbox" data-f="sensor" ${z.sensor ? "checked" : ""} aria-label="Has soil-moisture sensor"></td>
    <td class="c"><input type="checkbox" data-f="rainAware" ${z.rainAware ? "checked" : ""} aria-label="Has rain control"></td>
    <td><select data-f="prop" aria-label="Proposed method">${opts({ drip: "Inline drip", subdrip: "Subsurface drip", micro: "Micro-spray" }, z.prop, { drip: "Inline drip", subdrip: "Subsurface drip", micro: "Micro-spray" })}</select></td>
    <td><button class="x" type="button" data-del="${i}" aria-label="Remove zone ${i + 1}">×</button></td></tr>`).join("");
}
function editMsg(text, kind) { const m = $("#editMsg"); m.textContent = text || ""; m.className = "msg" + (kind ? " " + kind : ""); }
function onEdit(e) {
  const tr = e.target.closest("tr[data-i]"); if (!tr || !e.target.dataset.f) return;
  const i = +tr.dataset.i, f = e.target.dataset.f, z = ZONES[i]; if (!z) return;
  const patch = {};
  if (e.target.type === "checkbox") patch[f] = e.target.checked;
  else if (f === "lib") {
    const p = (window.HG_PLANTS || []).find((x) => x[0] === e.target.value);
    if (p) { patch.kc = p[3]; patch.plantName = p[1]; } else { patch.kc = undefined; patch.plantName = undefined; }
  } else patch[f] = e.target.value;
  const next = Object.assign({}, z, patch);
  if (patch.kc === undefined && f === "lib") { delete next.kc; delete next.plantName; }
  ZONES[i] = HG.sanitizeZone(next, i);
  if (f === "name" || f === "plant" || f === "lib") $("#editor tbody tr[data-i='" + i + "'] select[data-f='lib']").innerHTML = plantSel(ZONES[i]);
  editMsg("");
  afterEdit();
}
function afterEdit() { resetSim(); renderAll(); save(); }

function onEditorClick(e) {
  const del = e.target.closest("[data-del]"); if (!del) return;
  if (ZONES.length <= 1) { editMsg("A site needs at least one zone.", "err"); return; }
  ZONES.splice(+del.dataset.del, 1); renderEditor(); afterEdit();
}
function addZone() {
  if (ZONES.length >= MAX_ZONES) { editMsg("Zone limit reached (" + MAX_ZONES + ").", "err"); return; }
  const n = ZONES.reduce((m, z) => Math.max(m, parseInt(String(z.id).replace(/\D/g, ""), 10) || 0), 0) + 1;
  ZONES.push(HG.sanitizeZone({ id: "Z" + n, name: "New zone " + n, plant: "bed", area: 100, soil: "loam", now: "spray", window: "morning", prop: "drip" }, ZONES.length));
  renderEditor(); afterEdit(); editMsg("Zone added — set its details in the last row.", "ok");
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function importSite(file) {
  if (!file) return;
  if (file.size > 2e6) { editMsg("That file is too large for a site file.", "err"); return; }
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const d = JSON.parse(fr.result);
      if (!d || !Array.isArray(d.zones) || !d.zones.length) throw new Error("no zones found");
      setSite(d.zones, d.cfg, String(d.label || file.name.replace(/\.json$/i, "")));
      editMsg("Imported " + ZONES.length + " zones from " + file.name + ".", "ok");
    } catch (err) { editMsg("Could not import: " + err.message, "err"); }
  };
  fr.onerror = () => editMsg("Could not read the file.", "err");
  fr.readAsText(file);
}

/* ------------------------------------------------------------- portfolio */
function renderPortfolio() {
  const has = !!PORT;
  $("#portKpis").hidden = !has; $("#portTableWrap").hidden = !has;
  if (!has) return;
  const r = PORT.ranking, base = r.reduce((a, x) => a + x.base, 0), opt = r.reduce((a, x) => a + x.opt, 0);
  $("#pHotels").textContent = r0(r.length);
  $("#pZones").textContent = r0(PORT.hotels.reduce((a, h) => a + h.zones.length, 0)) + " zones";
  $("#pBase").innerHTML = r0(base) + '<span class="unit">m³/yr</span>';
  $("#pOpt").innerHTML = r0(opt) + '<span class="unit">m³/yr</span>';
  $("#pPct").innerHTML = Math.round(base ? (base - opt) / base * 100 : 0) + '<span class="unit">%</span>';
  $("#pSaved").textContent = r0(base - opt) + " m³ a year";
  const shown = r.slice(0, 100), maxPct = Math.max.apply(null, shown.map((x) => x.pct).concat([1]));
  $("#rankTable tbody").innerHTML = shown.map((x) => `<tr>
    <td><b>${esc(x.name)}</b>${x.city ? `<br><span class="small muted">${esc(x.city)}</span>` : ""}
      ${x.sensors ? '<span class="tag-flag">sensors</span>' : ""}${x.controller ? '<span class="tag-flag">weather ctrl</span>' : ""}</td>
    <td>${esc(x.size || "—")}</td><td class="r num">${x.zones}</td><td class="r num">${r0(x.area)}</td>
    <td class="r num" style="color:var(--clay-dk)">${r0(x.base)}</td><td class="r num" style="color:var(--teal)">${r0(x.opt)}</td>
    <td class="barcell"><div class="num" style="font-size:12px">${r1(x.pct)}%</div><div class="mini"><span style="width:${x.pct / maxPct * 100}%"></span></div></td>
    <td class="r num">${payTxt(x.payback)}</td>
    <td><button class="btn ghost" type="button" data-open="${esc(x.id)}" style="padding:4px 10px;font-size:12px">Open</button></td></tr>`).join("");
  $("#rankNote").textContent = (r.length > shown.length ? `Showing the top ${shown.length} of ${r.length}. ` : "") +
    "Hotels that already have sensors and weather controllers rank lower by construction — there is less left to fix. “Open” loads a hotel into the advisor.";
}
function ingest(tables, sourceName) {
  const { hotels, issues, counts } = P.buildHotels(tables);
  if (!hotels.length) { $("#portMsg").className = "msg err"; $("#portMsg").textContent = "No usable zones found in " + sourceName + "."; return; }
  PORT = { hotels, issues, counts, ranking: P.rank(hotels, CFG) };
  const bad = issues.badArea + issues.unknownMethod;
  const notes = [];
  if (!counts.hotelMeta) notes.push("no hotels.csv, so sensors, controllers and room counts are unknown");
  if (!counts.history) notes.push("no irrigation_history.csv, so watering time is assumed to be morning");
  if (bad) notes.push(bad + " zone rows skipped (invalid area or method)");
  $("#portMsg").className = "msg ok";
  $("#portMsg").textContent = `Loaded ${r0(hotels.length)} hotels, ${r0(counts.zones)} zone rows from ${sourceName}.` + (notes.length ? " Note: " + notes.join("; ") + "." : "");
  renderPortfolio();
}
function loadSample() {
  const S = window.HG_SAMPLE;
  if (!S) { $("#portMsg").className = "msg err"; $("#portMsg").textContent = "Sample data is missing (data/sample/sample.js)."; return; }
  ingest({ zones: S.garden_zones, hotels: S.hotels, history: S.irrigation_history }, "the bundled sample");
}
function readFile(f) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error("could not read " + f.name)); fr.readAsText(f); });
}
async function loadFiles(files) {
  const msg = $("#portMsg"); msg.className = "msg"; msg.textContent = "Reading files…";
  try {
    const tables = {}, names = [];
    for (const f of files) {
      if (f.size > 60e6) throw new Error(f.name + " is larger than 60 MB");
      const text = await readFile(f), head = text.slice(0, 1500);
      if (/zone_id/.test(head) && /area_m2/.test(head)) tables.zones = text;
      else if (/hotel_name/.test(head)) tables.hotels = text;
      else if (/irrigation_id/.test(head)) tables.history = text;
      else continue;
      names.push(f.name);
    }
    if (!tables.zones) throw new Error("garden_zones.csv is required (needs zone_id and area_m2 columns)");
    ingest(tables, names.join(" + "));
  } catch (err) { msg.className = "msg err"; msg.textContent = "Could not load: " + err.message; }
}
function openHotel(id) {
  const h = PORT && PORT.hotels.find((x) => x.id === id); if (!h) return;
  const site = P.siteFor(h, { tariff: CFG.tariff, rainfall: CFG.rainfall, peakET0: CFG.peakET0, season: CFG.season, nativeShare: CFG.nativeShare, greyShare: CFG.greyShare, tank: CFG.tank });
  setSite(site.zones, site.cfg, (h.name || h.id) + (h.city ? " · " + h.city : "") + " (dataset)");
  switchView("dash", false, { scroll: true });
}

/* ----------------------------------------------------------------- audit */
function renderAudit() {
  const f = HG.audit(SITE), s = HG.summary(SITE);
  $("#aTotal").textContent = f.length; $("#aHigh").textContent = f.filter((x) => x.sev === "hi").length;
  $("#aZones").textContent = "across " + ZONES.length + " zones";
  $("#aRec").innerHTML = r0(s.saved) + '<span class="unit">m³/yr</span>';
  const ico = { hi: "!", md: "~", lo: "·" }, lab = { hi: "High", md: "Medium", lo: "Low" };
  $("#findings").innerHTML = f.length ? f.map((x) => `<div class="finding sev-${x.sev}">
    <div class="f-ico"><b style="font-family:var(--mono);color:${x.sev === "hi" ? "var(--alert)" : x.sev === "md" ? "var(--clay-dk)" : "var(--moss-dk)"}">${ico[x.sev]}</b></div>
    <div class="f-body"><div class="f-top"><h4>${esc(x.title)}</h4><span class="tag ${x.sev}">${lab[x.sev]}</span><span class="f-zone">${esc(x.zone)}</span>
      ${x.saved === null ? '<span class="tag info">not quantified</span>' : x.saved > 1 ? `<span class="tag info">≈ ${r0(x.saved)} m³/yr alone</span>` : ""}</div>
      <p>${esc(x.body)}</p><div class="f-fix"><b>Measure:</b> ${esc(x.fix)}</div></div></div>`).join("")
    : '<p class="pad muted">No findings.</p>';
}

/* -------------------------------------------------------------- schedule */
function renderSchedule() {
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let g = `<div class="hcell"></div>` + dayNames.map((d) => `<div class="hcell">${d}</div>`).join("");
  ZONES.forEach((z) => {
    const sc = HG.schedule(z, SITE); g += `<div class="zname">${esc(z.name)}</div>`;
    for (let d = 0; d < 7; d++) g += d % sc.days === 0 ? `<div class="cell on">${Math.round(sc.mins)}′</div>` : `<div class="cell">—</div>`;
  });
  $("#weekGrid").innerHTML = g;
  $("#schedTable tbody").innerHTML = ZONES.map((z) => {
    const sc = HG.schedule(z, SITE);
    return `<tr><td><b>${esc(z.name)}</b></td><td>${MODEL.methodName[z.prop]}</td><td class="num">04:30</td>
      <td class="r num">every ${sc.days} d</td><td class="r num">${r1(sc.gross)} mm</td><td class="r num">${sc.rate} mm/h</td>
      <td class="r num"><b>${Math.round(sc.mins)} min</b></td>
      <td class="num">${sc.cycles > 1 ? `${sc.cycles} × ${Math.round(sc.perCycle)} min` : '<span class="muted">single</span>'}</td></tr>`;
  }).join("");
}

/* ------------------------------------------------------------- simulator */
function startMonth() { return parseInt($("#inStart").value, 10) || 0; }
function resetSim() {
  runToken++;
  SIM = HG.createSim(SITE, startMonth());
  $("#simLog").innerHTML = `<div class="hd">Controller reset. All ${ZONES.length} zones at field capacity (depletion 0 mm), starting ${HG.MONTHS[startMonth()]} 1.</div>`;
  ["#wDay"].forEach((s) => { $(s).textContent = "0"; });
  ["#wTemp", "#wET", "#wRain", "#wApplied"].forEach((s) => { $(s).textContent = "—"; });
  $("#simChart").innerHTML = C.simChart([]);
  setBusy(false); renderSensors();
}
function setBusy(b) { $$("#view-sim .btn").forEach((x) => { x.disabled = b; }); }
function hud(rec) {
  $("#wDay").textContent = rec.day; $("#wTemp").textContent = rec.tmax.toFixed(0) + "°C"; $("#wET").textContent = rec.et0.toFixed(2);
  $("#wRain").textContent = rec.rain.toFixed(1) + " mm"; $("#wApplied").textContent = rec.applied.toFixed(1) + " m³";
}
function logDay(rec) {
  const d = rec.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const lines = [`<div class="hd">── Day ${rec.day} · ${d} · ET₀ ${rec.et0.toFixed(2)} mm · rain ${rec.rain.toFixed(1)} mm (effective ${rec.pe.toFixed(1)} mm)</div>`];
  rec.events.forEach((ev) => {
    const nm = esc(ev.name.slice(0, 26).padEnd(26, "·")), dep = `depletion ${ev.dr.toFixed(1)}/${ev.raw.toFixed(1)} mm`;
    lines.push(ev.action === "water"
      ? `<div><span class="t">  ${esc(ev.id)}</span> <span class="w">IRRIGATE</span> ${nm} ${dep} → apply ${ev.mm.toFixed(1)} mm (${ev.mins} min)</div>`
      : `<div><span class="t">  ${esc(ev.id)}</span> ${ev.action === "rain-skip" ? '<span class="r">RAIN SKIP</span>' : '<span class="s">HOLD    </span>'} ${nm} ${dep} → no water needed</div>`);
  });
  const log = $("#simLog"); log.insertAdjacentHTML("beforeend", lines.join("")); log.scrollTop = log.scrollHeight;
}
function stepOne() { const rec = HG.stepSim(SIM); logDay(rec); hud(rec); renderSensors(); $("#simChart").innerHTML = C.simChart(SIM.hist); return rec; }
function run(n) {
  const token = ++runToken; setBusy(true);
  if (n > 31) {                                   // long run: step quietly, then report once
    let rec; const d0 = new Date(SIM.date);
    for (let i = 0; i < n; i++) rec = HG.stepSim(SIM);
    const h = SIM.hist[SIM.hist.length - 1];
    $("#simLog").insertAdjacentHTML("beforeend", `<div class="hd">── Ran ${n} days from ${d0.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}: controller ${h.ctrl.toFixed(1)} m³ vs fixed timer ${h.base.toFixed(1)} m³ so far</div>`);
    $("#simLog").scrollTop = $("#simLog").scrollHeight;
    hud(rec); renderSensors(); $("#simChart").innerHTML = C.simChart(SIM.hist); setBusy(false); return;
  }
  let i = 0;
  const tick = () => {
    if (token !== runToken) return;
    stepOne(); i++;
    if (i < n) setTimeout(tick, n > 10 ? 26 : 150); else setBusy(false);
  };
  tick();
}
function renderSensors() { $("#sensorCards").innerHTML = ZONES.map((z) => zoneCard(z, true)).join(""); }

/* --------------------------------------------------------------- harvest */
function renderHarvest() {
  const h = HG.harvest(SITE);
  $("#hRain").innerHTML = r0(h.rain) + '<span class="unit">m³/yr</span>';
  $("#hGrey").innerHTML = r0(h.grey) + '<span class="unit">m³/yr</span>';
  $("#hCover").innerHTML = Math.round(h.cover) + '<span class="unit">%</span>';
  $("#hCoverNote").textContent = `with a ${r0(h.tank)} m³ tank · annual balance alone says ${Math.round(h.annualBalanceCover)}%`;
  $("#hSave").innerHTML = money(h.savings) + '<span class="unit">/yr</span>';
  $("#harvestChart").innerHTML = C.harvestChart(h);
  const short = h.monthly.filter((m) => m.mains > 0.5).map((m) => m.month);
  const rainShare = h.rain + h.grey ? h.rain / (h.rain + h.grey) * 100 : 0;
  $("#harvestNote").innerHTML = h.cover >= 99.5
    ? `<h4>On-site water can carry the whole garden</h4><p>After the retrofit the garden needs <b class="num">${r0(h.demand)} m³</b> a year. The roof yields
       <b class="num">${r0(h.rain)} m³</b> and diverted greywater a further <b class="num">${r0(h.grey)} m³</b>. With a <b class="num">${r0(h.tank)} m³</b> tank
       no month needs mains water in this model.</p>
       <p style="margin:0"><b>The caveats:</b> the roof only delivers in the wet months (${Math.round(rainShare)}% of supply), so in the dry season the garden runs on
       greywater alone — which is only as reliable as hotel occupancy and the treatment plant. Reusing greywater needs treatment and local approval
       that are not costed here, and a mains connection should stay as backup.</p>`
    : `<h4>On-site water covers part of the demand</h4><p style="margin:0">Roof and greywater supply <b class="num">${r0(h.rain + h.grey)} m³</b> against
       <b class="num">${r0(h.demand)} m³</b> of demand. With a <b class="num">${r0(h.tank)} m³</b> tank the garden still needs <b class="num">${r0(h.mains)} m³</b> from the mains,
       mostly in ${short.length ? esc(short.slice(0, 4).join(", ")) : "the dry months"}. Greywater is produced all year while rain is seasonal, so raising the diverted share
       or the tank size is the cheapest way to close that gap.</p>`;
  const row = (t) => { const x = HG.harvest(SITE, t); return `<tr><td class="num">${r0(t)} m³${t === h.tank ? " <span class='muted'>(current)</span>" : ""}</td>
    <td class="r num">${r1(x.cover)}%</td><td class="r num">${r0(x.mains)} m³</td><td class="r num">${r0(x.spill)} m³</td></tr>`; };
  const sizes = [0, 30, 60, 120, 250, 500]; if (sizes.indexOf(h.tank) < 0) sizes.push(h.tank);
  $("#tankTable tbody").innerHTML = sizes.sort((a, b) => a - b).map(row).join("");
}

/* ---------------------------------------------------------------- method */
function renderCoefs() {
  const m = MODEL, rows = [
    ["K<sub>c</sub> — turf / beds / shrubs", `${m.kc.turf} / ${m.kc.bed} / ${m.kc.shrub}`, "FAO-56 landscape coefficients (textbook, not site-measured)"],
    ["K<sub>c</sub> — trees / drought-tolerant", `${m.kc.tree} / ${m.kc.native}`, "FAO-56 / WUCOLS-style low-water class"],
    ["E<sub>a</sub> — hose / flood / spray", `${m.ea.hose} / ${m.ea.flood} / ${m.ea.spray}`, "Irrigation application-efficiency norms"],
    ["E<sub>a</sub> — micro / drip / subsurface", `${m.ea.micro} / ${m.ea.drip} / ${m.ea.subdrip}`, "Irrigation application-efficiency norms"],
    ["Fixed-timer overwatering", "×" + m.overwater, "ASSUMPTION — varied 1.00–1.30 in the uncertainty band"],
    ["Watering-time survival (dawn → midday)", `${m.timeEff.dawn} → ${m.timeEff.midday}`, "Evaporation loss by application window"],
    ["Effective rainfall", "0.6P−10 / 0.8P−24", "FAO/AGLW dependable-rain formula, knee at 70 mm/month"],
    ["Allowable depletion p", "0.40 – 0.60", "FAO-56 typical for garden species"],
    ["Roof runoff × first-flush filter", `${m.roofRunoff} × ${m.filterEff}`, "Rainwater-harvesting design guides"],
    ["Greywater per occupied room × treatment yield", `${m.greyPerRoom} L × ${m.greyTreatYield}`, "ESTIMATE — metered data should replace this"],
    ["O&M as share of capex", (m.omRate * 100) + "% / yr", "ASSUMPTION"]];
  $("#coefTable tbody").innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td>${r[2]}</td></tr>`).join("");
}

/* ------------------------------------------------------------------- all */
function renderAll() {
  readInputs();
  renderDash(); renderZones(); renderAudit(); renderSchedule(); renderHarvest(); renderSensors();
}

function boot() {
  $("#inStart").innerHTML = HG.MONTHS.map((m, i) => `<option value="${i}"${i === 3 ? " selected" : ""}>${m}</option>`).join("");
  plantOptions = buildPlantOptions();
  restore();
  syncInputs(); renderEditor(); renderCoefs(); resetSim(); renderAll(); renderPortfolio();

  $$(".tab").forEach((t) => { t.addEventListener("click", () => switchView(t.dataset.view, false, { scroll: true })); t.addEventListener("keydown", tabKeys); });
  Object.keys(CFG_INPUTS).forEach((k) => { $(CFG_INPUTS[k]).addEventListener("input", () => { renderAll(); save(); }); });
  $("#inStart").addEventListener("change", () => { resetSim(); });
  $("#editor").addEventListener("change", onEdit);
  $("#editor").addEventListener("click", onEditorClick);
  $("#btnAddZone").addEventListener("click", addZone);
  $("#btnExport").addEventListener("click", () => download("hydrogarden-site.json", JSON.stringify({ label, cfg: CFG, zones: ZONES }, null, 2), "application/json"));
  $("#fileSite").addEventListener("change", (e) => { importSite(e.target.files[0]); e.target.value = ""; });
  $("#btnReset").addEventListener("click", () => { const d = HG.defaultSite(); setSite(d.zones, d.cfg, DEMO_LABEL); editMsg("Demo site restored.", "ok"); });
  $("#btnSample").addEventListener("click", loadSample);
  $("#fileCsv").addEventListener("change", (e) => { if (e.target.files.length) loadFiles(Array.from(e.target.files)); e.target.value = ""; });
  $("#rankTable").addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) openHotel(b.dataset.open); });
  $("#btnDay").addEventListener("click", () => stepOne());
  $("#btnWeek").addEventListener("click", () => run(7));
  $("#btnMonth").addEventListener("click", () => run(30));
  $("#btnYear").addEventListener("click", () => run(365));
  $("#btnSimReset").addEventListener("click", resetSim);

  window.HGApp = { openView: (v) => switchView(v, false, { scroll: true }) };
  const h = (location.hash || "").slice(1); if (h && VIEWS.indexOf(h) >= 0) switchView(h, false, { scroll: true });
}

try { document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot(); }
catch (err) {
  document.body.insertAdjacentHTML("afterbegin", '<div class="callout warn" style="margin:16px"><h4>HydroGarden failed to start</h4><p style="margin:0">' + esc(err.message) + "</p></div>");
  throw err;
}
})();
