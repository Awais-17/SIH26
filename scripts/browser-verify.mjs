// Browser end-to-end verifier for the Aegis extension.
//   - Servers: static page server (eval/test-pages) + mock VLM gateway
//   - Chrome (new headless) with the unpacked extension loaded
//   - Exercises the REAL offscreen WASM vision pipeline (BlazeFace tiles + NER)
//
// Run:  node scripts/browser-verify.mjs
// Pass a face photo:  node scripts/browser-verify.mjs C:\path\face.jpg
import puppeteer from "puppeteer-core";
import http from "http";
import { spawn } from "child_process";
import { readFileSync, existsSync, mkdtempSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Branded Chrome removed --load-extension (Chrome 137+); use Chrome for Testing.
const CF_BIN = (process.env.TEMP + "\\opencode\\chrome-for-testing\\chrome\\win64-152.0.7977.64\\chrome-win64\\chrome.exe").replace(/\\/g, "/");
const CHROME = existsSync(CF_BIN) ? CF_BIN : "C:/Program Files/Google/Chrome/Application/chrome.exe";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}

const FACE_SRC = process.argv[2] || (process.env.TEMP + "/opencode/lena.jpg");
if (!existsSync(FACE_SRC)) {
  console.error("No face photo found. Pass one: node scripts/browser-verify.mjs <path-to-face.jpg>");
  process.exit(1);
}

// ── 1. Build the face-on-canvas test image (face served at a known spot) ──
const sharp = require("sharp");
const W = 1280, H = 720, FL = 450, FT = 50, FS = 300;
const FACE_PNG = join(process.env.TEMP, "opencode", "aegis-face.png");
await sharp(FACE_SRC).resize(FS, FS).png().toBuffer()
  .then((b) => require("fs").writeFileSync(FACE_PNG, b));

// ── 2. Static page server ──
const MIME = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".css": "text/css" };
const staticServer = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/vision.html";
  const file = join(__dirname_test("eval/test-pages"), p.replace(/^\//, ""));
  if (existsSync(file)) {
    const ext = file.slice(file.lastIndexOf("."));
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(readFileSync(file));
  } else if (p === "/face.png" && existsSync(FACE_PNG)) {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(readFileSync(FACE_PNG));
  } else {
    res.writeHead(404); res.end("not found");
  }
});
function __dirname_test(rel) { return join(root, rel); }

const PAGE_PORT = 8123;
await new Promise((r) => staticServer.listen(PAGE_PORT, "127.0.0.1", r));
console.log(`[harness] static server on http://127.0.0.1:${PAGE_PORT}`);

// ── 3. Mock VLM gateway ──
const gateway = spawn(process.execPath, [join(root, "server", "index.js"), "--mock"], {
  cwd: join(root, "server"),
  env: { ...process.env, HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
gateway.stdout.on("data", (d) => process.stdout.write(`[gateway] ${d}`));
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:8000/health");
    if (r.ok) { console.log("[harness] mock gateway ready"); break; }
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

// ── 4. Launch Chrome for Testing with extension ──
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: mkdtempSync(tmpdir() + "\\aegis-verify-"),
  args: [
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    "--window-size=1400,900",
    "--force-device-scale-factor=1",
  ],
  ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"],
});

const swTarget = await browser.waitForTarget(
  (t) => t.type() === "service_worker" && t.url().includes("src/background/background.js"),
  { timeout: 30000 }
);
const sw = await swTarget.worker();
sw.on("console", (m) => console.log(`[SW.console] ${m.text()}`));
sw.on("error", (e) => console.log(`[SW.error] ${e.message}`));
console.log("[harness] service worker connected");

const extId = swTarget.url().split("/")[2];
console.log(`[harness] extension id: ${extId}`);

// ── 5. Open the vision test page (face + PII text + password field) ──
// No explicit viewport: puppeteer emulation made the page 1280x720 while
// captureVisibleTab reports the window tab area (1600x900), misaligning every
// mask. Letting the page fill the tab area keeps DOM coords == capture pixels.
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.text().includes("[Aegis]")) console.log(`[page.Aegis] ${m.text()}`);
});
await page.goto(`http://127.0.0.1:${PAGE_PORT}/vision.html`, { waitUntil: "networkidle0" });
const pageGeo = await page.evaluate(() => ({
  innerW: window.innerWidth, innerH: window.innerHeight, dpr: window.devicePixelRatio,
  photoRect: (() => { const r = document.querySelector(".photo").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
}));
console.log(`[harness] page geometry: ${JSON.stringify(pageGeo)}`);

// captureVisibleTab renders the tab at the OS display scale even though the page
// dpr is emulated to 1 — so DOM px vs capture px differ by that factor. Pin the
// page deviceScaleFactor to the observed scale so the offscreen's dpr scaling
// (domScanResults.dpr) matches capture pixels, like a real scaled display.
const cvtProbeUrl = await sw.evaluate(() => new Promise((res, rej) => {
  chrome.tabs.captureVisibleTab(null, { format: "png" }, (u) => {
    if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
    else res(u);
  });
}));
const cvtMeta = await sharp(Buffer.from(cvtProbeUrl.split(",")[1], "base64")).metadata();
const scale = cvtMeta.width / pageGeo.innerW;
console.log(`[harness] capture ${cvtMeta.width}x${cvtMeta.height} vs css ${pageGeo.innerW}x${pageGeo.innerH} => scale ${scale.toFixed(3)}`);
await page.setViewport({ width: pageGeo.innerW, height: pageGeo.innerH, deviceScaleFactor: scale });
await page.goto(`http://127.0.0.1:${PAGE_PORT}/vision.html`, { waitUntil: "networkidle0" });

// Content scripts live in an isolated world; reach them via tabs.sendMessage.
const tabId = (await sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab.id;
}));
console.log(`[harness] active tab id=${tabId}`);

check("content scripts injected (DOM_SCAN responds)", await sw.evaluate(async (id) => {
  try {
    const r = await chrome.tabs.sendMessage(id, { type: "DOM_SCAN" });
    return Array.isArray(r.fields);
  } catch { return false; }
}, tabId).catch((e) => { console.log(`  DOM_SCAN error: ${e.message}`); return false; }));

// ── 6. Seed the profile, prefill, and verify filled fields get flagged ──
await sw.evaluate(async (profile) => {
  await chrome.storage.local.set({ aegisProfile: profile });
}, {
  fullName: { value: "Ananya Rao", updatedAt: Date.now() },
  email: { value: "ananya@example.com", updatedAt: Date.now() },
  phone: { value: "9876543210", updatedAt: Date.now() },
  dob: { value: "14/05/1998", updatedAt: Date.now() },
  city: { value: "Bengaluru", updatedAt: Date.now() },
});

const prefill = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "PROFILE_PREFILL" }), tabId);
console.log(`  prefill => ${JSON.stringify(prefill)}`);
check("prefill filled a profile field", (prefill?.filled?.length || 0) > 0);

const dmScan = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "DOM_SCAN" }), tabId);
const filledImports = dmScan.fields.filter((f) => f.type === "profile_filled");
console.log(`  fields scanned=${dmScan.fields.length} profile_filled=${filledImports.length}`);
check("profile-filled fields flagged sensitive after prefill",
  dmScan.fields.some((f) => f.type === "profile_filled" && f.sensitive === true));

// ── 7. Full pipeline: capture → sanitize → mock VLM ──
// Chrome does not deliver runtime messages sent from the service worker to
// itself, so drive the call from a real extension page (the production path:
// the popup UI talks to the SW over chrome.runtime.sendMessage).
const popup = await browser.newPage();
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`, { waitUntil: "domcontentloaded" });

const popupMsg = (msg) =>
  popup.evaluate((m) => {
    return new Promise((res, rej) => {
      chrome.runtime.sendMessage(m, (r) => {
        if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
        else res(r);
      });
    });
  }, msg);

await page.bringToFront();
const capResult = await popupMsg({ type: "CAPTURE_AND_SANITIZE", task: "Fill in this loan application" });
console.log(`  capture->sanitize->vlm: action=${capResult.action?.action} masked=${capResult.pageStructure?.maskedRegions?.length}`);
check("capture pipeline returned an action", !!capResult.action, JSON.stringify(capResult).slice(0, 300));
check("capture pipeline returned a sanitized image", typeof capResult.sanitizedImage === "string" && capResult.sanitizedImage.startsWith("data:image/png"));
const pwMask = (capResult.pageStructure?.maskedRegions || []).find((m) => m.type === "password_input");
check("password field black-filled (masked)", !!pwMask, JSON.stringify(capResult.pageStructure?.maskedRegions));

// ── 8. REAL vision in-browser: BlazeFace tiles on the actual screenshot ──
const faceMask = (capResult.pageStructure?.maskedRegions || []).find((m) => m.type === "face");
check("BlazeFace found the face in-browser (WASM tiles)", !!faceMask,
  `no face mask; masked=[${(capResult.pageStructure?.maskedRegions || []).map((m) => m.type).join(",")}]`);
if (faceMask) {
  const [x1, y1, x2, y2] = faceMask.bbox;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  check("face box near the pasted face", Math.abs(cx - (FL + FS / 2)) < 120 && Math.abs(cy - (FT + FS / 2)) < 120,
    `face=${[x1, y1, x2, y2].map((v) => v.toFixed(0)).join(",")}`);
}

// ── 9. NER + regex in-browser ──
const nerMask = (capResult.pageStructure?.maskedRegions || []).find((m) => m.source === "ner");
check("DistilBERT NER detected a PII entity in-browser", !!nerMask,
  `ner=${(capResult.pageStructure?.maskedRegions || []).map((m) => m.entity || m.type).join(",")}`);
const reMask = (capResult.pageStructure?.maskedRegions || []).find((m) => m.source === "regex");
check("regex PII fired", !!reMask);

// ── 10. Execute the action the VLM chose (round-trips through content script) ──
await page.bringToFront();
const execResult = await popupMsg({ type: "EXECUTE_ACTION", action: capResult.action });
console.log(`  execute action => ${JSON.stringify(execResult)}`);
check("action execution responded ok", !!execResult?.ok);
if (capResult.action?.action === "type") {
  const typed = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.value : null;
  }, capResult.action.selector);
  check("typed value landed in the DOM", typed === capResult.action.value,
    `selector=${capResult.action.selector} got="${typed}" expected="${capResult.action.value}"`);
}

await browser.close();
gateway.kill();
staticServer.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);