# HydroGarden

Offline irrigation water advisor for hotel gardens. It models current water use from zone data (FAO-56), audits waste, schedules irrigation, balances rain and greywater against demand, and can score a whole portfolio of hotels. **It is a model, not a meter** — the saving is shown with an uncertainty band and an explicit assumptions register.

```
open index.html            # no server, no internet, no install
npm run build              # dist/hydrogarden.html — one file you can email
npm test                   # 24 engine and portfolio tests (Node ≥ 20, no dependencies)
npm run smoke              # browser walk-through (needs Playwright + Chromium)
```

## What it does
| Tab | |
|---|---|
| Dashboard | Current vs proposed use, P10–P90 saving band, order-independent (Shapley) attribution of five measures, monthly chart |
| Garden Zones | Editable zones (plant library, method, soil, sensors, slope), JSON import/export, area-true site plan |
| Portfolio | Import the Hotel Garden Water AI CSVs (or use the bundled 12-hotel sample), rank hotels, open one in the advisor |
| Water Audit | Rule findings with engine-computed stand-alone savings |
| Irrigation Plan | Interval, depth, runtime and cycle-and-soak per zone |
| Simulator | Daily soil-water balance with seeded weather; full-year run agrees with the annual model |
| Rain & Greywater | Monthly mass balance with a finite tank |
| Methodology / Assumptions | Formulas, coefficients, and what is assumed vs evidenced |

## Layout
```
index.html  src/{engine,portfolio,charts,app}.js  src/styles.css
data/       plants.js (151 plants)  sample/ (12 synthetic hotels)
tests/      engine + portfolio (node:test)      tools/  smoke, build, dataset tools
docs/       REVIEW.md (what v2.1 got wrong)  DATASET.md (can the data be used?)  DEMO.md
```
`src/engine.js` is pure (no DOM) and runs in Node or the browser; every function takes the `site` it works on.

## Landing page
Hero + Capabilities follow the "liquid glass" design brief (Instrument Serif / Barlow, blur-in headline, fading background video), built in plain CSS/JS so the app stays dependency-free. Fonts and the two background videos are **optional enhancements** loaded from Google Fonts and the CDN URLs in `index.html`; offline, the gradients and system fonts take over and nothing breaks. For a fully offline deployment, download the videos into `assets/` and point the `data-src` attributes there. The brief's invented logos and stats were replaced: the hero numbers are computed by the engine and the "trust" row lists real references.

## Honest limits
Baseline overwatering, current efficiencies and Kc are textbook or assumed values; sensors and weather are simulated; annual need is scaled by season length; harvest uses monthly steps. See the Assumptions tab and `docs/REVIEW.md`.

MIT licensed. Dataset: synthetic, see `docs/DATASET.md`.
