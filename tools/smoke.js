/* Browser smoke test: loads index.html over file://, walks every tab and the main
 * interactions, and fails on any console error, page error or external request.
 *   node tools/smoke.js [--shots dir]        (needs Playwright + Chromium) */
"use strict";
const path = require("path");
const { chromium } = require("playwright");
const shotsDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const url = "file://" + path.resolve(__dirname, "..", process.env.HG_PAGE || "index.html");
let failures = 0;
const check = (ok, label, extra) => { if (!ok) failures++; console.log((ok ? "  ✓ " : "  ✗ FAIL: ") + label + (extra ? "  " + extra : "")); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], external = [];
  const OPTIONAL = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|d8j0ntlcm91z4\.cloudfront\.net)\//;
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  page.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url()) && !OPTIONAL.test(r.url())) external.push(r.url()); });
  await page.goto(url);
  const shot = async (n) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, n + ".png"), fullPage: true }); };
  const txt = (sel) => page.locator(sel).first().innerText();

  console.log("\n== boot");
  check((await page.locator("h1").count()) === 1, "exactly one <h1>");
  check(/6[0-9]/.test(await txt("#kPct")), "dashboard headline renders a ~6x% saving", (await txt("#kPct")).replace(/\n/g, " "));
  check(!/NaN|undefined|Infinity/.test(await page.locator("main").innerText()), "no NaN/undefined/Infinity in visible text");
  await shot("01-dashboard");

  console.log("\n== landing");
  check(await page.locator("#hero h1").isVisible(), "hero headline visible on first screen");
  check(/^\d+%$/.test((await txt("#heroPct")).trim()), "hero saving comes from the engine", await txt("#heroPct"));
  check((await page.locator("#capabilities .card3").count()) === 3, "three capability cards");
  check(!(await page.locator("#landing").innerText()).match(/Aeon|Vela|Zeno|140\+|Trusted by/), "no invented logos or stats");
  await shot("00-hero");
  await page.click("[data-go='audit']");
  check(await page.locator("#view-audit").isVisible() && (await page.evaluate(() => scrollY)) > 500, "capability card opens the Audit tab and scrolls to the app");
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(400);
  check(await page.evaluate(() => !document.getElementById("lnav").classList.contains("away")), "nav visible on landing");
  await page.click("#tab-dash");
  await page.waitForTimeout(500);
  check(await page.evaluate(() => document.getElementById("lnav").classList.contains("away")), "nav hides once inside the app");
  await shot("00b-capabilities");

  console.log("\n== every tab");
  for (const v of ["zones", "portfolio", "audit", "schedule", "sim", "harvest", "method", "limits", "dash"]) {
    await page.click(`#tab-${v}`);
    const vis = await page.locator(`#view-${v}`).isVisible();
    const body = await page.locator(`#view-${v}`).innerText();
    check(vis && body.length > 100, `tab ${v} shows`, `${body.length} chars`);
    check(!/NaN|undefined|Infinity/.test(body), `tab ${v} has no NaN/undefined/Infinity`);
    if (v !== "dash") await shot("tab-" + v);
  }
  await page.keyboard.press("Tab");  // keyboard sanity: tablist is reachable
  await page.focus("#tab-dash"); await page.keyboard.press("ArrowRight");
  check((await page.getAttribute("#tab-zones", "aria-selected")) === "true", "ArrowRight moves to next tab");

  console.log("\n== zone editor");
  await page.click("#tab-zones");
  const before = await txt("#kBase");
  await page.selectOption("#editor tr[data-i='0'] select[data-f='now']", "drip");
  await page.click("#tab-dash");
  check((await txt("#kBase")) !== before, "changing Main Lawn to drip changes current use", before.replace(/\n/g, " ") + " → " + (await txt("#kBase")).replace(/\n/g, " "));
  await page.click("#tab-zones");
  const nZ = await page.locator("#editor tbody tr").count();
  await page.click("#btnAddZone");
  check((await page.locator("#editor tbody tr").count()) === nZ + 1, "Add zone adds a row");
  await page.click(`#editor tr[data-i='${nZ}'] [data-del]`);
  check((await page.locator("#editor tbody tr").count()) === nZ, "Remove zone removes it");
  await page.fill("#editor tr[data-i='1'] input[data-f='area']", "-50");
  await page.press("#editor tr[data-i='1'] input[data-f='area']", "Tab");
  check(!/NaN|Infinity/.test(await page.locator("main").innerText()), "negative area is sanitised, nothing breaks");
  await page.selectOption("#editor tr[data-i='2'] select[data-f='lib']", { index: 5 });
  check(/Kc|K/.test(await txt("#zoneTable")), "plant library selection accepted");
  await page.reload();
  check((await page.locator("#editor tbody tr[data-i='0'] select[data-f='now']").inputValue()) === "drip", "edits persist across reload (localStorage)");
  await page.click("#tab-zones"); await page.click("#btnReset");
  check((await page.locator("#editor tbody tr[data-i='0'] select[data-f='now']").inputValue()) === "spray", "Reset restores the demo site");

  console.log("\n== portfolio");
  await page.click("#tab-portfolio"); await page.click("#btnSample");
  check((await page.locator("#rankTable tbody tr").count()) === 12, "sample loads 12 hotels");
  await shot("portfolio-loaded");
  const name = await page.locator("#rankTable tbody tr:first-child td:first-child b").innerText();
  await page.click("#rankTable tbody tr:first-child [data-open]");
  check(/dataset/.test(await txt("#siteName")) && (await txt("#siteName")).includes(name), "Open loads that hotel into the advisor", await txt("#siteName"));
  check(!/NaN|Infinity/.test(await page.locator("main").innerText()), "dataset hotel renders without NaN");
  await shot("hotel-dashboard");
  await page.click("#tab-zones"); await page.click("#btnReset");

  console.log("\n== simulator");
  await page.click("#tab-sim"); await page.click("#btnDay");
  check((await txt("#wDay")) === "1", "advance one day");
  await page.click("#btnYear");
  await page.waitForFunction(() => document.querySelector("#wDay").textContent === "366");
  check(/saving of/.test(await txt("#simChart")), "full-year run plots a saving", (await txt("#simChart")).split("\n").pop().slice(0, 120));
  await shot("sim-year");

  console.log("\n== harvest");
  await page.click("#tab-harvest");
  await page.fill("#inTank", "0"); await page.press("#inTank", "Tab");
  const c0 = parseFloat((await txt("#hCover")).replace(/[^\d.]/g, ""));
  await page.fill("#inTank", "400"); await page.press("#inTank", "Tab");
  const c1 = parseFloat((await txt("#hCover")).replace(/[^\d.]/g, ""));
  check(c1 >= c0, "bigger tank never covers less", `${c0}% → ${c1}%`);

  console.log("\n== mobile");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click("#tab-dash");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 4, "no horizontal page scroll at 390px", "overflow " + overflow + "px");
  await shot("mobile-dashboard");

  console.log("\n== hygiene");
  check(external.length === 0, "no network requests beyond optional fonts/videos", external.slice(0, 3).join(", "));
  check(errors.length === 0, "no console/page errors", errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} SMOKE CHECK(S) FAILED` : "\nSMOKE TEST PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
