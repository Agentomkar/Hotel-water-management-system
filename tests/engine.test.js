"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const HG = require("../src/engine.js");

const ALL = { time: true, rain: true, sensor: true, drip: true, native: true };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} vs ${b} (tol ${tol})`);
const finite = (v, label) => assert.ok(Number.isFinite(v), `${label} is not finite: ${v}`);

test("effective rainfall: zero, continuous at the knee, monotone, never negative", () => {
  assert.equal(HG.effectiveRain(0), 0);
  assert.equal(HG.effectiveRain(-5), 0);
  assert.equal(HG.effectiveRain(NaN), 0);
  near(HG.effectiveRain(70), 0.6 * 70 - 10, 1e-9);
  near(HG.effectiveRain(70.0001), HG.effectiveRain(70), 1e-3, "continuity");
  let prev = -1;
  for (let p = 0; p <= 400; p += 5) { const e = HG.effectiveRain(p); assert.ok(e >= prev && e >= 0); prev = e; }
});

test("default site reproduces the headline: ~63% saving, 5 zones, 2,370 m2", () => {
  const s = HG.defaultSite(), r = HG.summary(s);
  assert.equal(s.zones.length, 5);
  assert.equal(s.zones.reduce((a, z) => a + z.area, 0), 2370);
  near(r.pct, 63, 1.5, "saving %");
  assert.ok(r.opt < r.base);
  near(r.base - r.opt, r.saved, 1e-9);
  assert.equal(r.capex, 338450);
});

test("monthly totals reconcile to the annual volume", () => {
  const s = HG.defaultSite();
  for (const fl of [{}, ALL, { rain: true }]) {
    const a = HG.monthlyTotals(s, fl).reduce((x, y) => x + y, 0);
    near(a, HG.siteVolume(s, fl), 1e-6);
  }
});

test("Shapley attribution sums exactly to the total saving and no measure is negative", () => {
  const s = HG.defaultSite(), sh = HG.savingsByMeasure(s), r = HG.summary(s);
  near(sh.reduce((a, m) => a + m.saved, 0), r.saved, 1e-6, "sum of measures");
  sh.forEach((m) => assert.ok(m.saved >= -1e-9, `${m.key} negative`));
  assert.equal(sh.length, 5);
});

test("attribution does not depend on zone order", () => {
  const a = HG.defaultSite(), b = HG.defaultSite(); b.zones.reverse();
  const A = HG.savingsByMeasure(a), B = HG.savingsByMeasure(b);
  A.forEach((m, i) => near(m.saved, B[i].saved, 1e-6, m.key));
});

test("a zone that already has sensor + rain control gets no credit for them", () => {
  const s = HG.defaultSite();
  s.zones = [Object.assign({}, s.zones[0], { sensor: true, rainAware: true, now: "drip", window: "dawn", prop: "drip" })];
  const sh = Object.fromEntries(HG.savingsByMeasure(s).map((m) => [m.key, m.saved]));
  near(sh.sensor, 0, 1e-9); near(sh.rain, 0, 1e-9); near(sh.drip, 0, 1e-9); near(sh.time, 0, 1e-9);
  assert.equal(HG.capex(s), 0);
  const r = HG.summary(s);
  assert.equal(r.payback, 0);          // nothing to buy
});

test("capex counts only what each zone needs", () => {
  const s = HG.defaultSite();
  const full = HG.capex(s);
  s.zones[0].now = "subdrip";            // lawn already converted
  s.zones[1].sensor = true;              // bed already has a probe
  assert.equal(full - HG.capex(s), 1200 * 150 + 5500);
});

test("payback is net of O&M and null when the retrofit cannot pay back", () => {
  const s = HG.defaultSite(), r = HG.summary(s);
  near(r.payback, r.capex / (r.cash - r.capex * HG.MODEL.omRate), 1e-9);
  assert.ok(r.payback > r.simplePayback);
  s.cfg.tariff = 0.01;
  assert.equal(HG.summary(s).payback, null);
});

test("rainfall is a single source of truth: more rain, less demand", () => {
  const dry = HG.defaultSite(), wet = HG.defaultSite();
  wet.cfg.rainfall = dry.cfg.rainfall * 1.6;
  near(HG.climateOf(wet).rain.reduce((a, b) => a + b, 0), wet.cfg.rainfall, 1e-6);
  assert.ok(HG.siteVolume(wet, ALL) < HG.siteVolume(dry, ALL));
});

test("schedule: sane interval, cycles and cap on single-valve run time", () => {
  const s = HG.defaultSite();
  s.zones.forEach((z) => {
    const p = HG.schedule(z, s);
    assert.ok(p.days >= 1 && p.cycles >= 1);
    assert.ok(p.perCycle <= 180 + 1e-9, `${z.name} cycle ${p.perCycle}`);
    ["etc", "taw", "raw", "gross", "mins"].forEach((k) => finite(p[k], k));
  });
  const slope = s.zones.find((z) => z.slope), p = HG.schedule(slope, s);
  assert.ok(p.cycles >= Math.ceil(HG.MODEL.rate[slope.prop] / HG.MODEL.infil[slope.soil]));
});

test("audit: savings are engine counterfactuals (null or finite, bounded), findings sorted by severity", () => {
  const s = HG.defaultSite(), f = HG.audit(s), r = HG.summary(s);
  const order = { hi: 0, md: 1, lo: 2 };
  for (let i = 1; i < f.length; i++) assert.ok(order[f[i - 1].sev] <= order[f[i].sev]);
  f.forEach((x) => { if (x.saved !== null) { finite(x.saved, x.title); assert.ok(x.saved >= 0 && x.saved <= r.base); } });
  assert.ok(f.some((x) => x.saved === null), "unmodelled findings must be null, not invented");
  assert.ok(f.some((x) => x.zone === "Site-wide" && x.title.includes("rainfall")));
});

test("harvest: water balance closes and storage only helps", () => {
  const s = HG.defaultSite();
  const h = HG.harvest(s);
  near(h.rain + h.grey, h.used + h.spill + h.monthly[11].store, 1e-6, "supply = used + spill + stored");
  near(h.demand, h.used + h.mains, 1e-6, "demand = used + mains");
  assert.ok(h.cover <= 100 + 1e-9);
  let prev = -1;
  for (const t of [0, 10, 30, 60, 120, 400]) {
    const c = HG.harvest(s, t).cover;
    assert.ok(c >= prev - 1e-9, `coverage fell when tank grew to ${t}`);
    prev = c;
  }
  const noGrey = HG.defaultSite(); noGrey.cfg.greyShare = 0;
  assert.ok(HG.harvest(noGrey, 60).cover < 100, "rain alone cannot cover the dry season");
});

test("uncertainty band is ordered, deterministic and brackets the point estimate", () => {
  const s = HG.defaultSite(), u = HG.uncertainty(s, { n: 200 }), v = HG.uncertainty(s, { n: 200 });
  assert.deepEqual(u, v);
  assert.ok(u.pct.p10 <= u.pct.p50 && u.pct.p50 <= u.pct.p90);
  assert.ok(u.pct.p10 < HG.summary(s).pct + 1 && u.pct.p90 > HG.summary(s).pct - 1);
  assert.ok(u.pct.p90 - u.pct.p10 > 2, "band should not be degenerate");
});

test("simulation is deterministic and its yearly saving agrees with the annual model", () => {
  const s = HG.defaultSite();
  const run = (seed) => { const sim = HG.createSim(s, 0, seed); for (let i = 0; i < 365; i++) HG.stepSim(sim); return sim.hist[364]; };
  assert.deepEqual(run(7), run(7));
  const annual = HG.summary(s).pct;
  const pcts = [1, 2, 3, 4, 5, 6].map((sd) => { const h = run(sd); return (h.base - h.ctrl) / h.base * 100; });
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  near(mean, annual, 6, "mean simulated saving vs annual model");
});

test("fuzz: random gardens never produce NaN, Infinity or negative volumes", () => {
  const rnd = HG.mulberry32(42), pick = (a) => a[Math.floor(rnd() * a.length)];
  const M = HG.MODEL;
  for (let i = 0; i < 300; i++) {
    const s = HG.defaultSite();
    s.zones = Array.from({ length: 1 + Math.floor(rnd() * 8) }, (_, k) => ({
      id: "F" + k, name: "Fuzz " + k, plant: pick(["turf", "bed", "shrub", "hedge", "tree"]),
      area: Math.floor(rnd() * 5000), soil: pick(Object.keys(M.awc)), now: pick(Object.keys(M.ea)),
      window: pick(Object.keys(M.timeEff)), slope: rnd() < 0.3, sensor: rnd() < 0.3, rainAware: rnd() < 0.3,
      prop: pick(["drip", "subdrip", "micro"]) }));
    s.cfg.rainfall = rnd() * 3000; s.cfg.season = 30 + Math.floor(rnd() * 336); s.cfg.nativeShare = pick([0, 0.3, 0.5]);
    const r = HG.summary(s);
    ["base", "opt", "saved", "pct", "cash", "capex"].forEach((k) => finite(r[k], k));
    assert.ok(r.base >= -1e-9 && r.opt >= -1e-9 && r.opt <= r.base + 1e-6, "optimised never exceeds baseline");
    HG.savingsByMeasure(s).forEach((m) => finite(m.saved, m.key));
    HG.audit(s).forEach((f) => { if (f.saved !== null) finite(f.saved, f.title); });
    s.zones.forEach((z) => { const p = HG.schedule(z, s); finite(p.mins, "mins"); });
    finite(HG.harvest(s).cover, "cover");
  }
});

test("sanitising: hostile or broken input becomes a valid zone / config", () => {
  const z = HG.sanitizeZone({ id: "x".repeat(100), name: "<img src=x onerror=alert(1)>", plant: "__proto__", area: "-40",
    soil: "lava", now: "teleport", window: 7, prop: "flood", kc: 9, eaNow: 2, timeEffNow: "abc" }, 3);
  assert.equal(z.plant, "bed"); assert.equal(z.area, 0); assert.equal(z.soil, "loam"); assert.equal(z.now, "spray");
  assert.equal(z.window, "morning"); assert.equal(z.prop, "drip"); assert.equal(z.id.length, 24);
  assert.ok(!("kc" in z) && !("eaNow" in z) && !("timeEffNow" in z));
  const s = HG.defaultSite(); s.zones = [z];
  HG.summary(s); HG.audit(s); HG.schedule(z, s);          // must not throw
  const c = HG.sanitizeCfg({ tariff: -5, rainfall: "x", season: 9999, nativeShare: 0.4, greyShare: 5 });
  assert.equal(c.tariff, 1); assert.equal(c.rainfall, HG.DEFAULT_CFG.rainfall); assert.equal(c.season, 365);
  assert.equal(c.nativeShare, 0.4); assert.equal(c.greyShare, 0.6);
  assert.equal(HG.sanitizeZone(null).plant, "bed");
});
