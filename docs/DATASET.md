# Can the Hotel Garden Water AI dataset be used?

**Yes for three things, no for two.** Audit: `python3 tools/audit_dataset.py <dir>`.

## What it is
Synthetic (stated in its own README): 1,000 hotels, 6,143 zones, 151 plants, 50,000 sensor rows, 20,000 irrigation events, 15,000 "AI training" rows. Structurally clean — no nulls, no duplicate IDs, every foreign key resolves, zone areas sum exactly to each hotel's garden area, and the supervised label arithmetic is consistent.

## Used in HydroGarden
1. **Portfolio engine test at scale** — `garden_zones.csv` (+ `hotels.csv`, `irrigation_history.csv`) are imported and scored: 1,000 hotels in ~0.3 s. Hotels with sensors *and* weather controllers model ~30% saving versus ~63% for those with neither — the gradient the engine should show.
2. **Plant library** — `plant_master.csv` → 151 plants selectable in the zone editor (class factor 0.20/0.35/0.50/0.65 as Kc).
3. **Fixtures** — a 12-hotel / 86-zone sample (`data/sample/`, 120 KB) drives tests and the demo. Rebuild with `tools/make_sample.py`.

The full 36 MB set is deliberately not committed.

## Why it cannot do more
- **It cannot validate the savings.** It has no measured water use. Any "saving" in it is computed by the generator.
- **The AI labels are a lookup, not a signal.** `recommended_water_l ÷ current_daily_water_l` is a near-constant per irrigation method (Flood 0.456 ± 0.012, Manual Hose 0.472 ± 0.020, Fixed Spray 0.523 ± 0.032, Drip 0.848 ± 0.052). `recommended_irrigation_method` is always Drip, except Micro → Micro. `recommended_action` has 4 distinct values. A model trained on it re-learns this table.
- **Splits leak.** All 849 test hotels (and 1,516 test zones) also appear in train, so held-out scores would be inflated.
- **No real structure between columns.** The water-class mix is identical across zone types (Lawn zones are Low-to-Moderate water, like every other type), and plants land in impossible zones (Mint in a "Tree Grove", Gulmohar in a "Shrub Bed").
- **Timestamps are uniform over 24 h**, so `irrigation_history` carries no real "when do hotels water" pattern; HydroGarden uses it only as an event-weighted evaporation factor.
- **Rain is zero in 90% of rows**, and there is no per-city ET₀ or rainfall, so cross-city comparison in the Portfolio tab reflects plant mix and equipment only.

## What would make it valuable
Replace the synthetic columns with metered water per zone, real probe readings, and the nearest station's weather — then a model has something to learn that a spreadsheet does not already say.
