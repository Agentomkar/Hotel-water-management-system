/* Portfolio layer: turns the Hotel Garden Water AI dataset tables (garden_zones.csv,
 * hotels.csv, irrigation_history.csv) into engine sites and ranks them.
 *
 * The dataset is SYNTHETIC. This module uses its structural columns (area, method,
 * efficiency, soil, plant factor, sensors) — never its AI-label columns — and it
 * does not pretend the data carries information it does not. See docs/DATASET.md.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine.js"));
  else root.HGPortfolio = factory(root.HG);
})(typeof self !== "undefined" ? self : this, function (HG) {
  "use strict";

  /* ------------------------------------------------------------ CSV parse */
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, "");
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); if (row.length > 1 || row[0] !== "") rows.push(row); }
    return rows;
  }
  function toObjects(text) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim());
    return rows.slice(1).map((r) => { const o = {}; head.forEach((h, i) => { o[h] = (r[i] === undefined ? "" : r[i]).trim(); }); return o; });
  }

  /* --------------------------------------------------------------- mapping */
  const METHOD = { "Sprinkler": "spray", "Fixed Spray": "spray", "Micro-irrigation": "micro",
                   "Drip": "drip", "Manual Hose": "hose", "Flood": "flood" };
  const PLANT = { "Lawn": "turf", "Flower Bed": "bed", "Shrub Bed": "shrub", "Tree Grove": "tree", "Ornamental": "bed" };
  const OCCUPANCY = 0.65;       // dataset gives total rooms, the engine wants occupied rooms (ASSUMPTION)

  function soilOf(name) {
    const s = String(name).toLowerCase();
    if (s.includes("clay loam")) return "clayloam";
    if (s.includes("clay")) return "clay";
    if (s.includes("sandy") || s.includes("well-drained")) return "sandyloam";
    if (s.includes("sand")) return "sand";
    return "loam";
  }
  /* Share of applied water that survives evaporation at hour h (matches engine windows) */
  function hourEff(h) {
    const T = HG.MODEL.timeEff;
    if (h >= 4 && h <= 6) return T.dawn;
    if (h >= 7 && h <= 10) return T.morning;
    if (h >= 11 && h <= 13) return T.midday;
    if (h >= 14 && h <= 16) return T.afternoon;
    if (h >= 17 && h <= 20) return T.evening;
    return 1.0;               // 21:00-03:59, cool and dark
  }
  const yes = (v) => /^y/i.test(String(v));
  const proposedFor = (now, plant) => now === "micro" ? "micro" : now === "drip" ? "drip" : plant === "turf" ? "subdrip" : "drip";

  /* Build hotels from table text/objects. `tables` = {zones, hotels?, history?}, each CSV text or array of objects. */
  function buildHotels(tables) {
    const rows = (t) => (typeof t === "string" ? toObjects(t) : t || []);
    const zones = rows(tables.zones), hotelRows = rows(tables.hotels), hist = rows(tables.history);
    const issues = { badArea: 0, unknownMethod: 0, unknownZoneType: 0, noZones: 0 };
    const meta = {}; hotelRows.forEach((h) => { meta[h.hotel_id] = h; });
    const evap = {}; hist.forEach((e) => {
      const h = parseInt(String(e.timestamp).slice(11, 13), 10); if (!isFinite(h)) return;
      const a = evap[e.hotel_id] || (evap[e.hotel_id] = { sum: 0, n: 0 }); a.sum += hourEff(h); a.n++;
    });
    const by = new Map();
    zones.forEach((r) => {
      const area = parseFloat(r.area_m2);
      if (!(area > 0)) { issues.badArea++; return; }
      const now = METHOD[r.irrigation_method];
      if (!now) { issues.unknownMethod++; return; }
      const plant = PLANT[r.zone_type];
      if (!plant) issues.unknownZoneType++;
      const p = plant || "bed", hm = meta[r.hotel_id] || {}, ev = evap[r.hotel_id];
      const eff = parseFloat(r.irrigation_efficiency_pct) / 100;
      const z = {
        id: r.zone_id, name: `${r.zone_type || "Zone"} · ${r.plant_name || ""}`.trim(), plant: p, area,
        soil: soilOf(r.soil_type), now, window: "morning", slope: false,
        sensor: yes(hm.soil_moisture_sensors), rainAware: yes(hm.weather_controller),
        prop: proposedFor(now, p),
        kc: isFinite(parseFloat(r.plant_factor)) ? parseFloat(r.plant_factor) : undefined,
        eaNow: eff > 0 && eff <= 1 ? eff : undefined,
        timeEffNow: ev ? ev.sum / ev.n : undefined
      };
      if (!by.has(r.hotel_id)) by.set(r.hotel_id, []);
      by.get(r.hotel_id).push(z);
    });
    const hotels = [];
    by.forEach((zs, id) => {
      const m = meta[id] || {}, rooms = parseFloat(m.rooms);
      hotels.push({ id, name: m.hotel_name || id, city: m.city || "", size: m.hotel_size || "", rooms: isFinite(rooms) ? rooms : null,
                    sensors: yes(m.soil_moisture_sensors), controller: yes(m.weather_controller),
                    hasHistory: !!evap[id], zones: zs });
    });
    return { hotels, issues, counts: { zones: zones.length, hotels: hotels.length, hotelMeta: hotelRows.length, history: hist.length } };
  }

  /* Engine site for one hotel (reference climate, tariff etc. from base config) */
  function siteFor(hotel, baseCfg) {
    const s = HG.defaultSite();
    if (baseCfg) Object.assign(s.cfg, baseCfg);
    s.zones = HG.clone(hotel.zones);
    if (hotel.rooms) s.cfg.rooms = Math.round(hotel.rooms * OCCUPANCY);
    s.cfg.roof = 0;           // roof area is not in the dataset — user must enter it
    return s;
  }

  /* Score every hotel. Sorted by modelled saving (m3/yr), largest first. */
  function rank(hotels, baseCfg) {
    return hotels.map((h) => {
      const s = siteFor(h, baseCfg), r = HG.summary(s);
      return { id: h.id, name: h.name, city: h.city, size: h.size, zones: h.zones.length,
               area: h.zones.reduce((a, z) => a + z.area, 0), base: r.base, opt: r.opt, saved: r.saved,
               pct: r.pct, capex: r.capex, payback: r.payback, sensors: h.sensors, controller: h.controller };
    }).sort((a, b) => b.saved - a.saved);
  }

  return { parseCSV, toObjects, buildHotels, siteFor, rank, soilOf, hourEff, OCCUPANCY };
});
