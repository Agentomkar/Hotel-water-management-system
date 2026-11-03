"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const HG = require("../src/engine.js");
const P = require("../src/portfolio.js");
const S = (f) => fs.readFileSync(path.join(__dirname, "..", "data", "sample", f), "utf8");

test("CSV parser: BOM, CRLF, quoted commas, escaped quotes, embedded newlines", () => {
  const rows = P.parseCSV('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"line\nbreak",\r\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "x, y", 'say "hi"'], ["2", "line\nbreak", ""]]);
  assert.deepEqual(P.toObjects("h1,h2\n a , b \n"), [{ h1: "a", h2: "b" }]);
  assert.deepEqual(P.toObjects(""), []);
});

test("every soil name in the dataset maps to a soil the engine knows", () => {
  const names = ["Loam", "Deep soil", "Acidic well-drained", "Well-drained", "Moist rich soil", "Acidic rich soil",
    "Deep loam", "Sandy loam", "Sandy well-drained", "Very well-drained", "Moist loam", "Rich well-drained", "Clay loam"];
  names.forEach((n) => assert.ok(HG.MODEL.awc[P.soilOf(n)], n));
  assert.equal(P.soilOf("Clay loam"), "clayloam");
  assert.equal(P.soilOf("Clay"), "clay");
});

test("sample dataset imports cleanly and every zone is a valid engine zone", () => {
  const { hotels, issues, counts } = P.buildHotels({ zones: S("garden_zones.csv"), hotels: S("hotels.csv"), history: S("irrigation_history.csv") });
  assert.equal(hotels.length, 12);
  assert.equal(counts.zones, 86);
  assert.deepEqual(issues, { badArea: 0, unknownMethod: 0, unknownZoneType: 0, noZones: 0 });
  hotels.forEach((h) => h.zones.forEach((z) => {
    assert.ok(z.area > 0 && HG.MODEL.ea[z.now] && HG.MODEL.ea[z.prop] && HG.MODEL.awc[z.soil] && HG.MODEL.kc[z.plant]);
    assert.ok(z.eaNow > 0 && z.eaNow <= 1 && z.timeEffNow >= 0.85 && z.timeEffNow <= 1);
  }));
});

test("hotel flags flow into zones: sensors and weather controller", () => {
  const { hotels } = P.buildHotels({ zones: S("garden_zones.csv"), hotels: S("hotels.csv") });
  hotels.forEach((h) => h.zones.forEach((z) => {
    assert.equal(z.sensor, h.sensors); assert.equal(z.rainAware, h.controller);
  }));
});

test("ranking is finite, sorted, and a hotel with nothing left to fix saves nothing", () => {
  const { hotels } = P.buildHotels({ zones: S("garden_zones.csv"), hotels: S("hotels.csv"), history: S("irrigation_history.csv") });
  const r = P.rank(hotels);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].saved >= r[i].saved);
  r.forEach((x) => { assert.ok(Number.isFinite(x.saved) && Number.isFinite(x.pct) && x.opt <= x.base + 1e-6); });
  const done = P.siteFor(hotels[0]); done.cfg.nativeShare = 0;
  done.zones.forEach((z) => Object.assign(z, { now: "drip", prop: "drip", sensor: true, rainAware: true, timeEffNow: 1, eaNow: 0.9 }));
  assert.ok(HG.summary(done).saved < 1e-6);
});

test("dataset kc below the native value is never raised by species conversion", () => {
  const s = HG.defaultSite();
  s.zones = [{ id: "a", name: "a", plant: "bed", area: 100, soil: "loam", now: "drip", window: "dawn", slope: false, sensor: false, prop: "drip", kc: 0.2 }];
  assert.ok(HG.zoneKc(s.zones[0], s) <= 0.2 + 1e-12);
});

test("roof area is unknown for imported hotels and must not be invented", () => {
  const { hotels } = P.buildHotels({ zones: S("garden_zones.csv"), hotels: S("hotels.csv") });
  assert.equal(P.siteFor(hotels[0]).cfg.roof, 0);
});

test("malformed rows are counted, not silently absorbed", () => {
  const bad = "zone_id,hotel_id,zone_type,plant_name,area_m2,irrigation_method,irrigation_efficiency_pct,soil_type,plant_factor\n" +
    "a,H1,Lawn,x,-5,Drip,90,Loam,0.5\nb,H1,Lawn,x,100,Teleport,90,Loam,0.5\nc,H1,Moon Bed,x,100,Drip,90,Loam,0.5\n";
  const r = P.buildHotels({ zones: bad });
  assert.equal(r.issues.badArea, 1); assert.equal(r.issues.unknownMethod, 1); assert.equal(r.issues.unknownZoneType, 1);
});

/* Optional: the full 36 MB dataset. HG_FULL_DATASET=/path/to/dir node --test tests/ */
const full = process.env.HG_FULL_DATASET;
test("full dataset (optional): 1,000 hotels import and score in a few seconds", { skip: !full }, () => {
  const rd = (f) => fs.readFileSync(path.join(full, f), "utf8");
  const t0 = Date.now();
  const { hotels, issues } = P.buildHotels({ zones: rd("garden_zones.csv"), hotels: rd("hotels.csv"), history: rd("irrigation_history.csv") });
  const r = P.rank(hotels);
  assert.equal(hotels.length, 1000); assert.equal(issues.badArea + issues.unknownMethod, 0);
  r.forEach((x) => assert.ok(Number.isFinite(x.pct)));
  assert.ok(Date.now() - t0 < 15000, "took " + (Date.now() - t0) + " ms");
});
