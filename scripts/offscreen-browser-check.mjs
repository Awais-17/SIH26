// In-browser check of the REAL offscreen/vision pipeline (WASM + vendored ESM).
// Runs the production src/offscreen/{vision,offscreen}.js in a real Chrome page
// with a minimal chrome shim, feeds a face composite + PII text, and asserts
// BlazeFace (tiled), NER, regex, and field masking all fire on-device.
import puppeteer from "puppeteer-core";
import http from "http";
import { createRequire } from "module";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHARP = require("sharp");
const PORT = 8765;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".png": "image/png", ".wasm": "application/wasm", ".json": "application/json", ".onnx": "application/octet-stream" };

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}

// ── Face composite (1280x720, light bg, face at 450,50 / 300x300) ──
const FACE_SRC = process.argv[2] || (process.env.TEMP + "/opencode/lena.jpg");
if (!existsSync(FACE_SRC)) {
  console.error("Pass a face photo: node scripts/offscreen-browser-check.mjs <face.jpg>");
  process.exit(1);
}
const outDir = join(root, "scripts", ".h");
mkdirSync(outDir, { recursive: true });
const FACE_PNG = join(outDir, "face.png");
await SHARP({ create: { width: 1280, height: 720, channels: 3, background: { r: 236, g: 240, b: 247 } } })
  .composite([{ input: await SHARP(FACE_SRC).resize(300, 300).toBuffer(), left: 450, top: 50 }])
  .png().toBuffer().then((b) => require("fs").writeFileSync(FACE_PNG, b));

// ── Static server serving the repo root ──
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let p = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (p === "") p = "scripts/offscreen-harness.html";
  if (p === "h/face.png" && existsSync(FACE_PNG)) {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(readFileSync(FACE_PNG));
    return;
  }
  const file = join(root, p);
  if (existsSync(file) && file.startsWith(root)) {
    res.writeHead(200, { "Content-Type": MIME[file.slice(file.lastIndexOf("."))] || "application/octet-stream" });
    res.end(readFileSync(file));
  } else {
    res.writeHead(404); res.end("nf");
  }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
console.log(`[check] serving repo root on http://127.0.0.1:${PORT}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-first-run", "--disable-gpu"],
});

const page = await browser.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("[Aegis]") || /WASM|wasm|error/i.test(t)) console.log(`  [page] ${t}`);
});
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

console.log("[check] opening harness page — loading models (NER ~129MB, first run slow)...");
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });

const start = Date.now();
let nerDiag = null;
while (Date.now() - start < 180000) {
  nerDiag = await page.evaluate(() => window.__nerDiag);
  if (nerDiag && (nerDiag.state === "done" || nerDiag.state === "error")) break;
  await new Promise((r) => setTimeout(r, 1500));
}
if (!nerDiag || nerDiag.state === "pending") {
  console.log("  NER diag TIMEOUT");
} else if (nerDiag.state === "loading") {
  console.log("  NER diag still loading");
} else if (nerDiag.state === "error") {
  console.log(`  NER diag ERROR: ${(nerDiag.error || "").split("\n")[0]}`);
  console.log((nerDiag.console || []).slice(-15).join("\n"));
} else {
  console.log(`  NER diag: nonO=${nerDiag.nonO} tokens=${nerDiag.tokenCount}`);
  console.log(`    sample: ${(nerDiag.sample || []).join(" ")}`);
  const tail = (nerDiag.consoleTail || []).slice(-6);
  if (tail.length) console.log(`    console: ${tail.join(" | ")}`);
}

const start2 = Date.now();
let res = null;
while (Date.now() - start < 180000) {
  res = await page.evaluate(() => window.__aegisCheck);
  if (res && res.state !== "pending") break;
  await new Promise((r) => setTimeout(r, 1500));
}
if (!res || res.state === "pending") {
  console.log("  TIMEOUT waiting for harness result");
  const consoleLog = await page.evaluate(() => window.__captureConsole || []);
  console.log(consoleLog.slice(-30).join("\n"));
  fail++;
} else if (res.state === "error") {
  console.log(`  HARNESS ERROR: ${res.error}`);
  console.log((res.console || []).slice(-30).join("\n"));
  fail++;
} else {
  console.log(`  done in ${res.elapsedMs}ms, sanitized=${res.hasSanitized}`);
  const types = res.types || [];
  console.log(`  masked types: ${types.join(", ")}`);
  check("sanitized image produced", res.hasSanitized);
  check("password field black-filled", types.includes("password_input"), types.join(","));
  check("profile-filled value black-filled", types.includes("profile_filled"), types.join(","));
  check("BlazeFace found the face (WASM tiles)", types.includes("face"), types.join(","));
  check("NER detected PER entity", types.includes("pii:ner:PER"), types.join(","));
  check("NER detected LOC entity", types.includes("pii:ner:LOC"), types.join(","));
  check("NER detected ORG entity", types.includes("pii:ner:ORG"), types.join(","));
  check("regex caught EMAIL", types.includes("pii:regex:EMAIL"), types.join(","));
  check("regex caught Aadhaar-likely", types.includes("pii:regex:AADHAAR_LIKELY"), types.join(","));
  const face = (res.masked || []).find((m) => m.type === "face");
  if (face) {
    const [x1, y1, x2, y2] = face.bbox;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    check("face box near pasted face (600,200)", Math.abs(cx - 600) < 120 && Math.abs(cy - 200) < 120,
      `box=[${x1.toFixed(0)},${y1.toFixed(0)},${x2.toFixed(0)},${y2.toFixed(0)}]`);
  }
  // surface interesting console warnings (e.g., ort shape noise tolerated)
  const warns = (res.console || []).filter((l) => l.startsWith("warn:"));
  if (warns.length) console.log(`  [warnings] ${warns.slice(0, 3).join(" | ")}`);
}

const entDiag = await page.evaluate(() => window.__nerEntityDiag).catch(() => null);
if (!entDiag) {
  console.log("  entity diag not ready — retrying in 8s...");
  await new Promise((r) => setTimeout(r, 8000));
}
const entDiag2 = await page.evaluate(() => window.__nerEntityDiag).catch(() => null);
console.log(`\n  direct detectEntities on DOM texts:`, JSON.stringify(entDiag2).slice(0, 500));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);