# Review of HydroGarden v2.1 — what was wrong, and what changed

Every item was checked against the code, not assumed. Severity: **A** misleads a reader, **B** breaks or erodes trust, **C** hygiene.

## A. Claims the project could not support

| # | Finding | Evidence | Fix in v3 |
|---|---|---|---|
| A1 | **"All 150+ checks pass" was false.** `qa_motion.js` crashed (`intro` undefined) and still printed in CI's hard-coded report. | `node qa_motion.js` → `TypeError: Cannot read properties of undefined`. CI wrote `Motion: ✅` with `echo`, regardless of results. | Tests run the real engine; CI report removed; failures fail the build. |
| A2 | **"Offline, zero-CDN" was false.** | Page requested `fonts.googleapis.com`, `cloudfront.net` (two MP4s) and `figma.site` (travel-template images). | Zero external requests (asserted by the smoke test, plus a CSP). |
| A3 | **Fabricated social proof.** Landing page: "Trusted by grounds teams, operators, and hotel owners" with five logo names, and a "Live" badge on a simulated site. | `index` lines for `.landing-trust` / `.landing-logos`. | Removed. Header says "Modelled · not metered". |
| A4 | **The simulator's 82% saving was an artifact.** The "fixed timer" baseline used the *peak* ET₀ (6.0 mm) every day, rain or not, while the controller used actual weather. The annual model said 63%. | `stepSim`: `baseMm = (CFG.peakET0*Kc/Ea)*overwater`. | Timer is set from the month's mean ET₀ with the annual model's rules. A 365-day run now gives 58–64% across seeds, tested against the annual figure. |
| A5 | **"Verified" meant "adds up", not "is right".** The reconciliation test proves the five bars sum to the total; it says nothing about whether the baseline is real. The 63% depends on assumed overwatering (×1.15) and timers running through the monsoon. | 37% of the saving falls in Jun–Sep, purely from that assumption. | Monte-Carlo band (58–68%), Assumptions tab, and a note on the dashboard. |
| A6 | **Audit "recoverable m³" were invented.** Each finding was `gap × 0.12 / 0.40 / 0.18 …` — arbitrary fractions, summed to 1,388 m³ with no relation to the 2,499 m³ total. | `audit()` | Each finding is an engine counterfactual; losses the model has no term for (infiltration, metering) say "not quantified". |
| A7 | **Waterfall order exaggerated one measure.** Layering measures in a fixed order credited rain-skip with 1,101 m³ because it came early. | Order-dependence of the stack. | Shapley attribution (order-independent): drip conversion is the largest (874 m³), rain sensor 933 m³. |
| A8 | **Greywater/rain "100% coverage"** was an annual balance; the caveat about monthly deficits was text only. | `renderHarvest` | Monthly mass balance with a finite tank, tank-size table. |

## B. Bugs and structural problems

| # | Finding | Fix |
|---|---|---|
| B1 | The **site plan was `display:none`** (0×0 px) yet tested by `qa_plan` and sold in the demo script ("scroll to expand the plan"). The "cinema" travel template (`sight-pin`, "bazaar", a dead language switcher) was also hidden, and its JS sat in `if (false) { … }`. | Dead layers deleted; the plan is a visible card. |
| B2 | Four pasted-in layers (video landing, cinema scroll, ball intro, hero expand) stood between the user and the engine; 3 `<h1>`s; the nav dock overlapped the landing page. | One page, one `<h1>`, tab semantics with arrow-key support. |
| B3 | **Tests regex-scraped `<script>` blocks by index** and ran them against a hand-built DOM stub — brittle (the crash in A1). | Engine is a pure module; `node --test`. |
| B4 | **Zones were hard-coded.** The "what-if" could change the tariff, not the garden. | Zone editor, JSON import/export, persistence. |
| B5 | Two sources of truth for rainfall (monthly table 964 mm vs input 980 mm) and ET₀ (input default 5.6 vs code 6.0). | One climate; the rainfall input scales both demand and roof yield. |
| B6 | A zone that already had a sensor still got the 15% overwatering penalty and capex for a sensor and drip it did not need. | `sensor` / `rainAware` / current method respected in volume and capex. |
| B7 | Effective rainfall was labelled "USDA-SCS" but is the FAO/AGLW formula (and with a 75 mm knee). | Correct formula and label. |
| B8 | Weekly schedule drew hard-coded "rain" on Wed/Thu. | Removed; honest peak-season example. |
| B9 | Payback ignored O&M; `Infinity` could be printed. | Net-of-O&M payback, `null` when none, shown as "no payback". |
| B10 | Species conversion could *raise* Kc for plants already below 0.30. | Clamped. |
| B11 | `esc()` did not escape `>` or quotes. | Full escape; names are user input now. |

## C. Packaging

`package.json` declared a `bin` (`cli.js`) and `types` (`hydrogarden.d.ts`) that did not exist, unused `jest`/`typescript` devDependencies, and `yourusername` placeholders. CI used `cache: npm` with no lockfile, `upload-artifact@v3` (retired), and a "NaN in `console.log`" grep that tested nothing. The README promised a `.pptx` that was not shipped. `ENHANCEMENTS.md` was a self-assessment ("Maximum", "-5% to 8% smaller") with no content. All removed or corrected.
