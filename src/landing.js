/* Landing behaviour: BlurText, FadingVideo, nav hide-on-scroll, live hero stats from the engine. */
(function () {
"use strict";
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* BlurText: words in spans, staggered 100 ms; hero starts at once, others when scrolled into view (threshold 0.1) */
function blurText(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.setAttribute("aria-label", words.join(" "));
  el.innerHTML = words.map((w, i) => `<span aria-hidden="true" style="--i:${i}">${w.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`).join(" ");
  el.classList.add("bt");
  if (!("IntersectionObserver" in window)) { el.classList.add("ready"); return; }
  el.classList.add("ready", "wait");
  new IntersectionObserver((es, io) => es.forEach((e) => { if (e.isIntersecting) { el.classList.remove("wait"); io.disconnect(); } }), { threshold: 0.1 }).observe(el);
}

/* FadingVideo: fade in 500 ms on load, fade out over the last 0.55 s, replay on end. If the source fails, nothing breaks. */
function fadingVideo(v) {
  const src = v.dataset.src; if (!src || reduced) return;
  v.muted = true; v.playsInline = true; v.preload = "auto";
  let raf = 0;
  const fade = (to, ms) => {
    cancelAnimationFrame(raf);
    const from = parseFloat(v.style.opacity || "0"), t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); v.style.opacity = String(from + (to - from) * k); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  };
  let fadingOut = false;
  v.addEventListener("loadeddata", () => { fadingOut = false; fade(1, 500); });
  v.addEventListener("timeupdate", () => { if (!fadingOut && v.duration && v.duration - v.currentTime <= 0.55) { fadingOut = true; fade(0, 550); } });
  v.addEventListener("ended", () => { v.currentTime = 0; fadingOut = false; v.play().then(() => fade(1, 500)).catch(() => {}); });
  v.addEventListener("error", () => { v.style.opacity = "0"; });
  v.src = src; v.play().catch(() => {});
}

function heroStats() {
  if (!window.HG) return;
  const s = HG.defaultSite(), r = HG.summary(s), u = HG.uncertainty(s, { n: 200 });
  const set = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  set("heroPct", Math.round(r.pct) + "%");
  set("heroBand", `modelled saving · likely ${Math.round(u.pct.p10)}–${Math.round(u.pct.p90)}%`);
  set("heroM3", Math.round(r.saved).toLocaleString("en-IN") + " m³");
}

function go(view) {
  if (window.HGApp) window.HGApp.openView(view);
}

function init() {
  $$("[data-blur]").forEach(blurText);
  $$("video[data-src]").forEach(fadingVideo);
  heroStats();
  $$("[data-go]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); go(b.dataset.go); }));
  const nav = $("#lnav"), landing = $("#landing");
  if (nav && landing && "IntersectionObserver" in window)
    new IntersectionObserver((es) => es.forEach((e) => nav.classList.toggle("away", !e.isIntersecting)), { threshold: 0.02 }).observe(landing);
}
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
