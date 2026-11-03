/* Inline CSS + scripts into one double-clickable file: dist/hydrogarden.html
 *   node tools/build-single.js */
"use strict";
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, "");   // inline script needs a different policy
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/, (_, p) => `<style>\n${read(p)}\n</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, p) => `<script>\n${read(p).replace(/<\/script/gi, "<\\/script")}\n</script>`);
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist", "hydrogarden.html"), html);
console.log("dist/hydrogarden.html", Math.round(html.length / 1024) + " KB");
