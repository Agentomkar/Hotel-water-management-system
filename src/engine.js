/* HydroGarden engine — pure functions, no DOM, no globals.
 *
 * Loads in the browser (window.HG) and in Node (require). Every function takes
 * the `site` it works on, so the same engine can score one garden or a thousand.
 *
 * Method: FAO-56 crop water requirement (ETc = ET0 x Kc) with an application
 * efficiency, FAO/AGLW dependable-rainfall for effective rain, and an
 * allowable-depletion soil-water balance for scheduling. Rule-based; no ML.
 *
 * HONESTY NOTE: baseline behaviour (overwatering factor, window, efficiency) is an
 * ASSUMPTION until a meter is fitted. `uncertainty()` shows how much the headline
 * saving moves when those assumptions move.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HG = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------ constants */
  const MODEL = {
    /* Landscape coefficient Kc by planting type (FAO-56 / WUCOLS-style) */
    kc: { turf: 0.80, bed: 0.90, shrub: 0.55, hedge: 0.55, tree: 0.65, native: 0.30 },
    /* Application efficiency Ea by delivery method */
    ea: { hose: 0.55, flood: 0.45, spray: 0.75, micro: 0.80, drip: 0.90, subdrip: 0.88 },
    /* Application rate, mm/h */
    rate: { hose: 25, flood: 30, spray: 15, micro: 12, drip: 8, subdrip: 8 },
    methodName: {
      hose: "Manual hose", flood: "Basin flooding", spray: "Fixed spray heads",
      micro: "Micro-spray", drip: "Inline drip", subdrip: "Subsurface drip"
    },
    /* Available water capacity, mm per m of root depth, by soil texture */
    awc: { sand: 90, sandyloam: 120, loam: 165, clayloam: 195, clay: 175 },
    /* Basic infiltration rate, mm/h */
    infil: { sand: 30, sandyloam: 20, loam: 13, clayloam: 6, clay: 4 },
    soilName: { sand: "Sand", sandyloam: "Sandy loam", loam: "Loam", clayloam: "Clay loam", clay: "Clay" },
    /* Root depth (m) and allowable depletion fraction p */
    rootDepth: { turf: 0.30, bed: 0.30, shrub: 0.50, hedge: 0.50, tree: 0.90, native: 0.50 },
    depletion: { turf: 0.45, bed: 0.40, shrub: 0.50, hedge: 0.50, tree: 0.55, native: 0.60 },
    /* Share of applied water surviving evaporation, by watering window */
    timeEff: { dawn: 1.00, morning: 0.95, midday: 0.88, afternoon: 0.90, evening: 0.94 },
    timeName: { dawn: "04:30–06:30", morning: "07:00–09:00", midday: "11:00–14:00",
                afternoon: "14:00–16:00", evening: "18:00–20:00" },
    /* Fixed timers water by routine: assumed over-application factor (ASSUMPTION) */
    overwater: 1.15,
    /* Extra loss where spray irrigation meets a slope */
    slopeLoss: 0.90,
    /* Months wetter than this make staff halve a fixed timer by hand */
    manualCutoff: 150,
    /* Retrofit cost assumptions, INR */
    cost: { dripPerM2: 85, subdripPerM2: 150, sensorPerZone: 5500, controller: 28000, rainSensor: 3500 },
    /* Annual operation & maintenance, as a fraction of capex (ASSUMPTION) */
    omRate: 0.04,
    /* Rain harvesting */
    roofRunoff: 0.85, filterEff: 0.90,
    /* Greywater per occupied room per night (L) and usable yield after treatment */
    greyPerRoom: 165, greyTreatYield: 0.85
  };

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  /* Reference climate normals: ET0 mm/day, rainfall mm/month. One source of truth. */
  const CLIMATE = {
    month: MONTHS,
    days: [31,28,31,30,31,30,31,31,30,31,30,31],
    et0:  [3.4,4.0,4.9,5.6,6.0,5.2,4.3,4.2,4.4,4.3,3.7,3.3],
    rain: [8,6,12,28,62,168,212,186,142,96,32,12]
  };
  const SUM_RAIN = CLIMATE.rain.reduce((a, b) => a + b, 0);

  const DEFAULT_ZONES = [
    { id: "Z1", name: "Main Lawn", plant: "turf", area: 1200, soil: "loam",
      now: "spray", window: "midday", slope: false, sensor: false, prop: "subdrip" },
    { id: "Z2", name: "Entrance Ornamental Beds", plant: "bed", area: 340, soil: "sandyloam",
      now: "hose", window: "midday", slope: false, sensor: false, prop: "drip" },
    { id: "Z3", name: "Poolside Palms & Trees", plant: "tree", area: 260, soil: "sand",
      now: "flood", window: "morning", slope: false, sensor: false, prop: "drip" },
    /* rootOverride: container planting holds far less water than open ground */
    { id: "Z4", name: "Terrace Planters", plant: "shrub", area: 90, soil: "sandyloam",
      now: "micro", window: "afternoon", slope: false, sensor: false, prop: "drip", rootOverride: 0.25 },
    { id: "Z5", name: "Rear Slope Hedge", plant: "hedge", area: 480, soil: "clay",
      now: "spray", window: "evening", slope: true, sensor: false, prop: "drip" }
  ];

  const DEFAULT_CFG = {
    tariff: 42,            // INR per m3
    peakET0: Math.max.apply(null, CLIMATE.et0),   // design-day ET0 for scheduling, mm/day
    season: 300,           // irrigated days per year
    nativeShare: 0.3,      // share of bed/shrub/hedge area converted to drought-tolerant
    roof: 2400,            // catchment roof area, m2
    rainfall: SUM_RAIN,    // annual rainfall, mm (scales the monthly normals)
    rooms: 120,            // occupied rooms per night
    greyShare: 0.4,        // share of hotel greywater diverted to the garden
    tank: 60               // storage tank, m3
  };
  /* Uncertain inputs, all multipliers. 1 = the point estimate used in the headline. */
  const DEFAULT_ASSUMP = { overwater: MODEL.overwater, baseEaScale: 1, kcScale: 1 };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  function defaultSite() {
    return { zones: clone(DEFAULT_ZONES), cfg: Object.assign({}, DEFAULT_CFG),
             assump: Object.assign({}, DEFAULT_ASSUMP) };
  }

  /* ---------------------------------------------------------- sanitising */
  const pickKey = (v, table, d) => (typeof v === "string" && Object.prototype.hasOwnProperty.call(table, v) ? v : d);
  /* Coerce untrusted input (editor, JSON import, localStorage) into a valid engine zone. */
  function sanitizeZone(z, i) {
    z = z || {};
    const kc = parseFloat(z.kc), eaN = parseFloat(z.eaNow), te = parseFloat(z.timeEffNow);
    const out = {
      id: String(z.id || "Z" + ((i || 0) + 1)).slice(0, 24),
      name: String(z.name || "Zone " + ((i || 0) + 1)).slice(0, 60),
      plant: pickKey(z.plant, MODEL.rootDepth, "bed"),
      area: clamp(num(parseFloat(z.area), 0), 0, 1e6),
      soil: pickKey(z.soil, MODEL.awc, "loam"),
      now: pickKey(z.now, MODEL.ea, "spray"),
      window: pickKey(z.window, MODEL.timeEff, "morning"),
      slope: !!z.slope, sensor: !!z.sensor, rainAware: !!z.rainAware,
      prop: pickKey(z.prop, { drip: 1, subdrip: 1, micro: 1 }, "drip")
    };
    if (isFinite(kc) && kc >= 0.1 && kc <= 1.3) out.kc = kc;
    if (isFinite(eaN) && eaN > 0 && eaN <= 1) out.eaNow = eaN;
    if (isFinite(te) && te > 0 && te <= 1) out.timeEffNow = te;
    const ro = parseFloat(z.rootOverride); if (isFinite(ro) && ro > 0 && ro <= 2) out.rootOverride = ro;
    if (typeof z.plantName === "string") out.plantName = z.plantName.slice(0, 60);
    return out;
  }
  const CFG_LIMITS = { tariff: [1, 500], peakET0: [1, 12], season: [30, 365], nativeShare: [0, 0.5],
                       roof: [0, 50000], rainfall: [50, 6000], rooms: [0, 2000], greyShare: [0, 0.6], tank: [0, 5000] };
  function sanitizeCfg(c) {
    const out = Object.assign({}, DEFAULT_CFG);
    Object.keys(CFG_LIMITS).forEach((k) => {
      const v = parseFloat(c && c[k]);
      if (isFinite(v)) out[k] = clamp(v, CFG_LIMITS[k][0], CFG_LIMITS[k][1]);
    });
    return out;
  }

  /* -------------------------------------------------------------- helpers */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

  /* Effective rainfall, FAO/AGLW dependable-rain formula (mm per month). */
  function effectiveRain(p) {
    if (!(p > 0)) return 0;
    return Math.max(0, p > 70 ? 0.8 * p - 24 : 0.6 * p - 10);
  }

  /* Site climate with rainfall scaled to cfg.rainfall — the only place rain is read. */
  function climateOf(site) {
    const k = num(site.cfg.rainfall, SUM_RAIN) / SUM_RAIN;
    return { month: MONTHS, days: CLIMATE.days, et0: CLIMATE.et0,
             rain: CLIMATE.rain.map((r) => r * k) };
  }

  function baseKc(z, site) {
    const k = isFinite(z.kc) ? z.kc : MODEL.kc[z.plant];
    return k * (site.assump ? site.assump.kcScale : 1);
  }
  /* Kc after converting part of a bed/shrub/hedge zone to drought-tolerant species */
  function zoneKc(z, site) {
    const base = baseKc(z, site), share = site.cfg.nativeShare;
    const eligible = z.plant === "bed" || z.plant === "shrub" || z.plant === "hedge";
    if (!eligible || !share) return base;
    const nat = Math.min(base, MODEL.kc.native * (site.assump ? site.assump.kcScale : 1));
    return base * (1 - share) + nat * share;      // never raises Kc of an already-thrifty planting
  }
  const isSpray = (m) => m === "spray" || m === "micro";
  /* Evaporation survival of the zone's current watering time. Imported gardens may
     carry a measured, event-weighted value (z.timeEffNow) instead of one window. */
  const timeEffOf = (z) => (isFinite(z.timeEffNow) ? z.timeEffNow : MODEL.timeEff[z.window]);
  /* Current application efficiency of the delivery method (dataset zones carry their own) */
  const eaNow = (z, site) =>
    (isFinite(z.eaNow) ? z.eaNow : MODEL.ea[z.now]) * (site.assump ? site.assump.baseEaScale : 1);

  /* Baseline effective efficiency: method, degraded by watering window and slope runoff */
  function baselineEa(z, site) {
    let ea = eaNow(z, site) * timeEffOf(z);
    if (z.slope && isSpray(z.now)) ea *= MODEL.slopeLoss;
    return ea;
  }

  /* --------------------------------------------------------------- engine */
  const MEASURES = [
    { key: "time",   label: "Shift watering to the pre-dawn window",    note: "Cuts evaporation loss during application" },
    { key: "rain",   label: "Rain-responsive scheduling (rain sensor)", note: "Skip irrigation the soil does not need" },
    { key: "sensor", label: "Soil-moisture sensors replace fixed timers", note: "Water by measured depletion, not by routine" },
    { key: "drip",   label: "Convert to drip / micro-irrigation",       note: "Deliver water at the root zone" },
    { key: "native", label: "Drought-tolerant species in ornamental beds", note: "Lower the water demand itself" }
  ];

  /* Monthly applied water for one zone (m3) under a set of measures.
     flags: {time, rain, sensor, drip, native, noSlope}. A zone that already has a
     sensor / rain-aware controller gets those "for free" in every scenario. */
  function zoneMonthly(z, site, flags) {
    flags = flags || {};
    const clim = climateOf(site), A = site.assump || DEFAULT_ASSUMP;
    let ea = eaNow(z, site) * (flags.time ? MODEL.timeEff.dawn : timeEffOf(z));
    if (z.slope && !flags.drip && !flags.noSlope && isSpray(z.now)) ea *= MODEL.slopeLoss;
    if (flags.drip) ea = MODEL.ea[z.prop];
    const kc = flags.native ? zoneKc(z, site) : baseKc(z, site);
    const over = (flags.sensor || z.sensor) ? 1.0 : A.overwater;
    const rainAware = !!(flags.rain || z.rainAware);
    const f = (site.cfg.season / 365) * z.area / 1000;     // mm over area -> m3
    const out = [];
    for (let m = 0; m < 12; m++) {
      const etc = clim.et0[m] * kc * clim.days[m];
      const need = rainAware ? Math.max(0, etc - effectiveRain(clim.rain[m]))
                             : etc * (clim.rain[m] > MODEL.manualCutoff ? 0.5 : 1);
      out.push(ea > 0 ? (need * over / ea) * f : 0);
    }
    return out;
  }
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const zoneVolume = (z, site, flags) => sum(zoneMonthly(z, site, flags));

  const ALL = { time: true, rain: true, sensor: true, drip: true, native: true };
  const baselineVolume  = (z, site) => zoneVolume(z, site, {});
  const optimisedVolume = (z, site) => zoneVolume(z, site, ALL);
  const siteVolume = (site, flags) => sum(site.zones.map((z) => zoneVolume(z, site, flags)));
  const monthlyTotals = (site, flags) => {
    const out = new Array(12).fill(0);
    site.zones.forEach((z) => zoneMonthly(z, site, flags).forEach((v, m) => { out[m] += v; }));
    return out;
  };

  /* Savings attributed to each measure with Shapley values: the average marginal
     saving over every order the measures could be adopted in. Unlike a layered
     waterfall, the answer does not depend on which measure is listed first, and
     the five numbers still sum exactly to baseline - optimised. */
  function savingsByMeasure(site) {
    const n = MEASURES.length, memo = {};
    const v = (mask) => memo[mask] !== undefined ? memo[mask] : (memo[mask] = (() => {
      const fl = {};
      MEASURES.forEach((m, i) => { if (mask & (1 << i)) fl[m.key] = true; });
      return siteVolume(site, fl);
    })());
    const fact = [1, 1, 2, 6, 24, 120];
    return MEASURES.map((m, i) => {
      let phi = 0;
      for (let mask = 0; mask < (1 << n); mask++) {
        if (mask & (1 << i)) continue;
        let k = 0; for (let b = 0; b < n; b++) if (mask & (1 << b)) k++;
        phi += (fact[k] * fact[n - k - 1] / fact[n]) * (v(mask) - v(mask | (1 << i)));
      }
      return { key: m.key, label: m.label, note: m.note, saved: phi };
    });
  }

  /* Irrigation plan for one zone: interval, depth, runtime, cycle-and-soak */
  function schedule(z, site) {
    const kc = zoneKc(z, site);
    const etc = site.cfg.peakET0 * kc;
    const zr = z.rootOverride || MODEL.rootDepth[z.plant];
    const taw = MODEL.awc[z.soil] * zr;
    const raw = taw * MODEL.depletion[z.plant];
    const days = Math.max(1, Math.floor(raw / etc));
    const net = etc * days;
    const gross = net / MODEL.ea[z.prop];
    const rate = MODEL.rate[z.prop];
    const mins = (gross / rate) * 60;
    /* Split where the soil cannot absorb water as fast as it is applied, and never
       run one valve longer than three hours (operational limit). */
    const cycles = Math.max(1, Math.ceil(rate / MODEL.infil[z.soil]), Math.ceil(mins / 180));
    return { etc, taw, raw, days, net, gross, rate, mins, cycles, perCycle: mins / cycles };
  }

  /* Audit: loss conditions per zone. `saved` is what the ENGINE says that one fix
     would recover on its own (a counterfactual), or null where the model has no
     term for it. Findings overlap, so they are NOT additive — use summary().saved. */
  function audit(site) {
    const out = [];
    const add = (z, sev, title, body, fix, saved) =>
      out.push({ zone: z ? z.name : "Site-wide", sev, title, body, fix, saved });
    const gain = (z, fl) => Math.max(0, baselineVolume(z, site) - zoneVolume(z, site, fl));

    site.zones.forEach((z) => {
      if (timeEffOf(z) < 0.92)
        add(z, "hi", "Watering during peak evaporation",
          `Irrigation runs ${isFinite(z.timeEffNow) ? "partly in the heat of the day" : "at " + MODEL.timeName[z.window]}, when a measurable share of applied water (about ${Math.round((1 - timeEffOf(z)) * 100)}%) evaporates before it reaches the root zone.`,
          "Move the cycle to the 04:30–06:30 window.", gain(z, { time: true }));

      if (eaNow(z, site) <= 0.60)
        add(z, "hi", "Low-efficiency delivery method",
          `${MODEL.methodName[z.now]} has an application efficiency of about ${eaNow(z, site).toFixed(2)}, so nearly half the water never benefits the planting.`,
          `Convert to ${MODEL.methodName[z.prop].toLowerCase()} (Ea ${MODEL.ea[z.prop].toFixed(2)}).`, gain(z, { drip: true }));

      if (!z.sensor)
        add(z, "md", "No soil-moisture feedback",
          "Watering decisions follow a fixed timer, so the zone is watered whether or not the soil needs it.",
          "Install a soil-moisture probe and trigger on measured depletion.", gain(z, { sensor: true }));

      if (z.slope && isSpray(z.now))
        add(z, "hi", "Runoff on sloped ground",
          "Spray irrigation on a slope loses water downhill before it can infiltrate.",
          "Use inline drip and split the cycle (cycle-and-soak).", gain(z, { noSlope: true }));

      if (MODEL.rate[z.now] > MODEL.infil[z.soil])
        add(z, "md", "Application rate exceeds infiltration",
          `The system applies ${MODEL.rate[z.now]} mm/h onto ${MODEL.soilName[z.soil].toLowerCase()}, which absorbs only ${MODEL.infil[z.soil]} mm/h. The excess ponds or runs off.`,
          "Reduce the rate or split into shorter repeated cycles.", null);

      if (z.plant === "bed" || z.plant === "hedge")
        add(z, "lo", "High-water species in an ornamental zone",
          `Current planting carries a landscape coefficient of ${baseKc(z, site).toFixed(2)}. Drought-tolerant species sit near ${MODEL.kc.native.toFixed(2)}.`,
          "Convert part of the bed to native drought-tolerant planting.", gain(z, { native: true }));
    });

    const n = site.zones.length;
    if (site.zones.some((z) => !z.rainAware))
      add(null, "hi", "No rainfall response on site",
        `No rain sensor is fitted on ${site.zones.filter((z) => !z.rainAware).length} of ${n} zones, so scheduled cycles run during and after rainfall.`,
        "Fit a site rain sensor and enable the rain-skip rule.",
        sum(site.zones.map((z) => gain(z, { rain: true }))));
    add(null, "md", "No sub-metering on the garden supply",
      "Garden consumption is not separated from the building supply, so savings cannot be verified after the retrofit.",
      "Fit a dedicated irrigation meter before the pilot begins.", null);
    add(null, "lo", "Rain and greywater capture unused",
      "Roof runoff and treated greywater are both available on site but not connected to irrigation.",
      "See the Rain & Greywater tab for the recoverable volume.", null);

    const order = { hi: 0, md: 1, lo: 2 };
    return out.sort((a, b) => order[a.sev] - order[b.sev]);
  }

  /* Retrofit capital cost — only what a zone actually needs */
  function capex(site) {
    const C = MODEL.cost;
    let c = 0;
    if (site.zones.some((z) => !z.rainAware)) c += C.controller + C.rainSensor;
    site.zones.forEach((z) => {
      if (z.now !== z.prop) c += z.area * (z.prop === "subdrip" ? C.subdripPerM2 : C.dripPerM2);
      if (!z.sensor) c += C.sensorPerZone;
    });
    return c;
  }

  /* Whole-site summary. Payback is net of O&M; null when the retrofit never pays back. */
  function summary(site) {
    const base = siteVolume(site, {}), opt = siteVolume(site, ALL);
    const saved = base - opt, cash = saved * site.cfg.tariff;
    const cx = capex(site), om = cx * MODEL.omRate, net = cash - om;
    return {
      base, opt, saved, pct: base > 0 ? saved / base * 100 : 0,
      cash, capex: cx, om, net,
      payback: net > 0 && cx > 0 ? cx / net : (cx === 0 ? 0 : null),
      simplePayback: cash > 0 && cx > 0 ? cx / cash : (cx === 0 ? 0 : null)
    };
  }

  /* ---------------------------------------------------------- uncertainty */
  function mulberry32(seed) {
    let s = seed | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pctile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

  /* Monte-Carlo over the assumptions nobody has metered yet:
       overwatering factor of the fixed timers  U(1.00, 1.30)
       efficiency of the current methods        U(0.90, 1.10) x nominal
       crop coefficients                        U(0.85, 1.15) x nominal
     Returns P10 / P50 / P90 of the saving and payback. Seeded, so reproducible. */
  function uncertainty(site, opts) {
    opts = opts || {};
    const n = opts.n || 400, rnd = mulberry32(opts.seed || 20260825);
    const pcts = [], saved = [], paybacks = [];
    for (let i = 0; i < n; i++) {
      const s = { zones: site.zones, cfg: site.cfg, assump: {
        overwater: 1.0 + 0.30 * rnd(), baseEaScale: 0.90 + 0.20 * rnd(), kcScale: 0.85 + 0.30 * rnd() } };
      const r = summary(s);
      pcts.push(r.pct); saved.push(r.saved); paybacks.push(r.payback === null ? Infinity : r.payback);
    }
    const f = (a) => { const t = a.slice().sort((x, y) => x - y);
      return { p10: pctile(t, 0.10), p50: pctile(t, 0.50), p90: pctile(t, 0.90) }; };
    return { n, pct: f(pcts), saved: f(saved), payback: f(paybacks) };
  }

  /* -------------------------------------------------------------- harvest */
  /* Monthly mass balance with a finite tank. Supply = roof yield + treated greywater;
     the tank carries surplus forward (capped, overflow spills); mains covers the rest.
     Monthly steps overstate how well a small tank works inside a month — read the
     result as an optimistic bound. */
  function harvest(site, tankM3) {
    const cfg = site.cfg, clim = climateOf(site);
    const tank = tankM3 === undefined ? num(cfg.tank, 0) : tankM3;
    const demand = monthlyTotals(site, ALL);
    let store = 0, spill = 0, mains = 0, used = 0;
    const monthly = [];
    for (let m = 0; m < 12; m++) {
      const rain = cfg.roof * (clim.rain[m] / 1000) * MODEL.roofRunoff * MODEL.filterEff;
      const grey = cfg.rooms * MODEL.greyPerRoom * cfg.greyShare * MODEL.greyTreatYield * clim.days[m] / 1000;
      const avail = store + rain + grey, use = Math.min(demand[m], avail);
      const left = avail - use;
      store = Math.min(tank, left); spill += left - store;
      mains += demand[m] - use; used += use;
      monthly.push({ month: MONTHS[m], demand: demand[m], rain, grey, use, mains: demand[m] - use, store });
    }
    const rain = sum(monthly.map((x) => x.rain)), grey = sum(monthly.map((x) => x.grey));
    const dem = sum(demand);
    return { rain, grey, demand: dem, annualBalanceCover: dem ? Math.min(rain + grey, dem) / dem * 100 : 0,
             cover: dem ? used / dem * 100 : 0, used, mains, spill, tank, monthly,
             savings: used * cfg.tariff };
  }

  /* ----------------------------------------------------------- simulation */
  /* Day-by-day soil-water balance. The "fixed timer" comparator is set the way a
     groundskeeper would set it — from the month's mean ET0, never from today's
     weather, with the same coarse manual halving in wet months the annual model uses —
     so a 30-day run is directly comparable to that month of the annual model. */
  const DAILY_TMAX = [27,29,32,34,35,32,30,30,31,31,29,27];
  function createSim(site, startMonth, seed) {
    const sim = { site, day: 0, seed: seed === undefined ? 20260824 : seed, month0: startMonth || 0,
                  date: new Date(2026, startMonth || 0, 1), state: {}, hist: [] };
    site.zones.forEach((z) => { sim.state[z.id] = { dr: 0, ctrl: 0, base: 0, events: 0, last: null, lastMm: 0 }; });
    return sim;
  }
  function simRng(sim) {
    sim.seed |= 0; sim.seed = (sim.seed + 0x6D2B79F5) | 0;
    let t = Math.imul(sim.seed ^ (sim.seed >>> 15), 1 | sim.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function stepSim(sim) {
    const site = sim.site, clim = climateOf(site);
    sim.day++;
    const m = sim.date.getMonth();
    const et0 = clim.et0[m] * (0.86 + 0.28 * simRng(sim));
    const pRain = clamp(clim.rain[m] / (clim.days[m] * 20), 0.03, 0.55);
    const wet = simRng(sim) < pRain;
    const rain = wet ? (clim.rain[m] / (clim.days[m] * pRain)) * (0.35 + 1.3 * simRng(sim)) : 0;
    const tmax = DAILY_TMAX[m] + (simRng(sim) * 5 - 2);
    const pe = Math.max(0, rain * 0.8 - 1);        // daily effective rain (simplified)
    const A = site.assump || DEFAULT_ASSUMP;
    const events = []; let appliedToday = 0;

    site.zones.forEach((z) => {
      const st = sim.state[z.id], sc = schedule(z, site);
      const etc = et0 * zoneKc(z, site);
      st.dr = Math.max(0, st.dr + etc - pe);
      /* fixed timer: monthly-mean setting, not today's weather */
      const baseDepth = (clim.et0[m] * baseKc(z, site) / baselineEa(z, site)) * (z.sensor ? 1 : A.overwater)
                        * (z.rainAware ? 1 : (clim.rain[m] > MODEL.manualCutoff ? 0.5 : 1));
      st.base += baseDepth * z.area / 1000;
      if (st.dr >= sc.raw) {
        const gross = st.dr / MODEL.ea[z.prop], vol = gross * z.area / 1000;
        st.ctrl += vol; appliedToday += vol; st.events++; st.last = "water"; st.lastMm = gross;
        events.push({ id: z.id, name: z.name, action: "water", dr: st.dr, raw: sc.raw,
                      mm: gross, mins: Math.round(gross / sc.rate * 60) });
        st.dr = 0;
      } else {
        st.last = "skip"; st.lastMm = 0;
        events.push({ id: z.id, name: z.name, action: pe > 1 ? "rain-skip" : "hold", dr: st.dr, raw: sc.raw });
      }
    });
    const tot = site.zones.reduce((a, z) => ({ ctrl: a.ctrl + sim.state[z.id].ctrl, base: a.base + sim.state[z.id].base }),
                                  { ctrl: 0, base: 0 });
    sim.hist.push({ day: sim.day, ctrl: tot.ctrl, base: tot.base, rain });
    const rec = { day: sim.day, date: new Date(sim.date), et0, rain, pe, tmax, events, applied: appliedToday };
    sim.date.setDate(sim.date.getDate() + 1);
    return rec;
  }

  return { MODEL, CLIMATE, MONTHS, MEASURES, DEFAULT_CFG, DEFAULT_ASSUMP, CFG_LIMITS, defaultSite, clone,
           sanitizeZone, sanitizeCfg,
           effectiveRain, climateOf, zoneKc, baseKc, baselineEa, eaNow, timeEffOf,
           zoneMonthly, zoneVolume, baselineVolume, optimisedVolume, siteVolume, monthlyTotals,
           savingsByMeasure, schedule, audit, capex, summary, uncertainty, harvest,
           createSim, stepSim, mulberry32 };
});
