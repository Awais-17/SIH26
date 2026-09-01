# 07 — Status & Handoff (READ THIS FIRST)

**Last updated:** 2026-09-02 (browser-verified E2E landed: capture → sanitize → VLM → action = 12/12 in a real Chrome; backend demo packaging added)
**Purpose:** The single doc for any teammate (or agent) picking up the project. Explains what exists, what's real, what's fake, and exactly what to do next.

---

## 1. What this project is

**Aegis** — a Chrome extension (MV3) that captures the screen, redacts sensitive content **locally in the browser** (blur faces, black-fill passwords, blur PII text), and sends only the sanitized image + page structure to a VLM. The VLM returns a single JSON action (click / type / scroll / navigate / done), which the extension executes on the live page.

**Pitch in one line:** form-filling agent where the password/PII never leaves your device.

Read order for a new teammate: `00_INDEX.md` → `02_ARCHITECTURE.md` → `new features.md` → this doc. Rules in `ENGINEERING_RULES.md` are binding.

---

## 2. Current state (honest, per ENGINEERING_RULES)

| Component | File(s) | Status |
|---|---|---|
| MV3 scaffold (SW + content + offscreen + popup) | `src/` | ✅ Working in a real Chrome session |
| Screenshot capture + DOM scan + password black-fill + regex PII blur | `src/background/background.js`, `src/content/content.js`, `src/offscreen/offscreen.js` | ✅ Browser-verified in the E2E harness |
| **Progressive profile autofill** (`new features.md`) | `src/content/field-mapper.js`, `src/content/autofill.js`, popup UI | ✅ Browser-verified — harness seeds profile, prefill lands 5/5 in the DOM (28 mapper + 17 autofill unit tests) |
| **BlazeFace face detection** | `src/offscreen/vision.js` + `src/models/blazeface.onnx` (0.5MB) | ✅ **REAL, BROWSER-VERIFIED.** Tiled 128×128 scan; face found at the expected coordinates in the sanitized image (BlazeFace dims == capture dims at scale 1.0) |
| **DistilBERT NER** | `src/offscreen/vision.js` + `src/models/ner/` (**129MB**, q8) | ✅ **REAL, BROWSER-VERIFIED.** PER/LOC/ORG detected in-page; manual char-offset recovery works (regex is still the primary fast path) |
| Old inference stubs | `src/inference/inference.worker.js` | ⚠️ **Superseded** — real inference moved to `src/offscreen/vision.js`. Delete candidate (see 4.x) |
| Backend VLM gateway | `server/index.js` | ✅ Working. Mock contract 10/10 + browser E2E. `HOST=0.0.0.0` verified reachable over LAN IP. **Real-VLM (Ollama) call still untested on a real laptop** |
| Backend demo packaging | `server/start-demo.ps1` / `.bat` | ✅ Added — checks Node + Ollama, pulls `qwen3-vl:8b` if missing, prints LAN IP + `/health` URL + firewall rule, `-Mock` fallback verified |
| Eval harness + 7 test pages + ground truth | `eval/` | ✅ Files exist + a browser E2E harness (`scripts/browser-verify.mjs`). ❌ The 7-page benchmark scorecard still has **zero measured numbers** |
| RAG profile / doc upload (`new features.md`) | — | ❌ Not started (correctly — build only after core works) |

**The headline result (browser-verified, `scripts/browser-verify.mjs`):**
- The **full loop runs in a real Chrome** (Chrome for Testing 152, extension loaded from this repo): content scripts inject → profile prefill 5/5 → `captureVisibleTab` → offscreen SANITIZE (WASM BlazeFace + NER + regex + black-fill) → mock VLM → `{"action":"type",...}` → EXECUTE_ACTION → **the typed value lands in the live DOM**.
- **12/12 harness assertions pass**, including: sanitized PNG contains **no** password/prefilled-value pixels (black-filled), BlazeFace face box == the face's true position, NER PER span recovered with correct offsets, regex PII matched, and an action round-trip executed end-to-end.
- All Node suites still green: `npm test` EXIT=0 (28 mapper + 17 autofill + BlazeFace model sanity + tile-scan ortho + NER offsets) and `node server/test-extract.js` (10/10).

**What is NOT yet verified:** a real Ollama/Qwen3-VL call (Mode B) and the measured 7-page benchmark scorecard.

---

## 3. How to run it (today, two modes)

### Mode A — Mock (no VLM needed, tests extension plumbing)
```powershell
cd server
npm run start:mock          # backend on port 8000, fake actions
```
Load `src/` via `chrome://extensions` → Developer mode → Load unpacked.
Click the extension icon → it captures, masks passwords/regex-PII, gets a fake action back.

**Automated E2E (no clicking, needs a face photo):**
```powershell
node scripts/browser-verify.mjs C:\path\to\face.jpg
```
Launches Chrome for Testing with the extension preloaded, serves `eval/test-pages/vision.html`, seeds a profile, runs capture → sanitize → mock VLM → execute, asserts 12 checks. It does **not** use the popup UI; it drives the same background/offscreen/content code the popup drives.

**Regression checks before/after any change:** `npm test` and `node server/test-extract.js`.

**Chrome load-path for automation:** branded Chrome ≥137 dropped `--load-extension`. The harness uses **Chrome for Testing 152** (see `scripts/browser-verify.mjs` for the binary path). Manual `Load unpacked` in branded Chrome still works fine.

### Mode B — Real VLM on a second laptop (the current plan)
The VLM runtime (Ollama) lives on **Friend's laptop**. Both laptops must be on the same WiFi.

**On the friend's laptop (the VLM host):**
```powershell
# one run does everything: checks Node, pulls the model, starts HOST=0.0.0.0,
# prints the LAN IP, /health URL and the firewall rule to allow inbound 8000
cd server
powershell -ExecutionPolicy Bypass -File start-demo.ps1         # -Mock to go model-free
```
(Manual equivalent: `ollama pull qwen3-vl:8b`; `ollama serve`; `set HOST=0.0.0.0`; `npm start`.)
Open the port if the second laptop times out (admin shell):
```powershell
New-NetFirewallRule -DisplayName "Aegis" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
```

**On your laptop (the browser):**
Set the popup VLM Endpoint to `http://<FRIEND_IP>:8000/v1/chat/completions` (persists in `chrome.storage.local`), then sanity-check:
```powershell
curl http://192.168.1.42:8000/health     # expect upstreamReachable: true
```

> Firewall is the #1 reason this fails. If `curl` times out, it's the host's firewall, not the code.

---

## 4. Remaining work, in build order

### 4.0 ✅ DONE — in-browser verification (was the highest risk)
Covered by `scripts/browser-verify.mjs` (12/12) + `scripts/offscreen-browser-check.mjs` (10/10 on the vision layer alone). Findings that came out of it — read before repeating any of this:
1. **Branded Chrome ≥137 refuses `--load-extension`**; switch to Chrome for Testing (repo pins 152), or load unpacked manually in developer mode.
2. **Chrome does not deliver `chrome.runtime.sendMessage` sent from the service worker to itself** ("Receiving end does not exist"), even with a listener registered inside the SW. Drive SW-bound traffic from an *extension page* (the popup) — which is the real production call path anyway. SW→content-script `tabs.sendMessage` works fine.
3. **Real product bug fixed:** EXECUTE_ACTION used `sender.tab?.id`, which for extension-page senders is the popup's own tab (no content script there) → "Receiving end does not exist". Background now always targets the **active tab**.
4. **Real product bug fixed:** `content.js` computed `filled` as `undefined` for sensitive/prefilled fields; now `filled: (field.value || "").trim().length > 0` so the VLM page structure sees prefilled fields as filled.
5. **`captureVisibleTab` renders at the OS display scale** (×1.25 here) while the page keeps device-pixel-ratio 1 → masks misalign with the drawing. Fixed with `--force-device-scale-factor=1` + a harness dynamic scale probe (capture dims vs CSS dims → `deviceScaleFactor`). At scale 1.0, sanitized-pixel coordinates == DOM coordinates.
6. **BlazeFace false-positives on repaint-blurred captures**; re-capturing after the page settles or forcing scale 1.0 eliminated them.
7. **Prefill seeding shape:** `chrome.storage.local` key `aegisProfile` must store per-key `{ value, updatedAt }` objects — plain strings read back as empty.
8. **Real product bug fixed while building the demo page:** placeholder hints on a *name* field — "Full Name (as per Aadhaar / PAN)" — triggered `never_store` and turned the name field into a redacted identifier (the word `PAN` matched against `el.placeholder`). Never-store detection now uses label/name/id/aria/title only (`field-mapper.js`); regression tests added (tests went 28 → 31). Lesson: identifier detection must never trust instructional placeholder copy.
9. **"Nationality" fields classify as `country`** (the country rule lists `/nationality/i`) — seed `country` in the profile or expect the ask-once card to ask "Country".

### 4.1 Cleanup
- [ ] Delete `src/inference/inference.worker.js` (superseded) + update `03_TECH_STACK_MODELS.md`.
- [ ] Add `.gitignore` (`node_modules/`, `.onnx`/`src/models/` bloat debate) — repo is now ~160MB+. OneDrive/git both choke.

### 4.2 Real E2E loop (still needs the friend's laptop)
- [ ] Friend's laptop: `server/start-demo.ps1` → `/health` green from your machine
- [ ] Extension: full loop on `eval/test-pages/tp01-login-form.html` with a **real** VLM action (not `--mock`)
- [ ] Verify password & prefilled profile values never appear in any network payload (DevTools → Network) — demo-day talking point

### 4.3 Run the eval harness, produce real numbers
- [ ] `eval/harness/eval-harness.js` against all 7 test pages
- [ ] Fill `eval/reports/benchmark-report-template.md` with **measured** values only
- [ ] Targets: Visual ≥90%, PII recall ≥85%, redaction precision ≥90%, mem ≤500MB, latency ≤3s. NER model alone is 129MB in RAM on load + BlazeFace tiles ≈ 100–200ms each at stride 96 (1280×720 ≈ 120 tiles) — latency target may need the MAX_TILES cap tightened.

### 4.4 Demo polish
- [ ] `eval/demo/demo-loan.html` — polished loan-application page (photo + form + declaration text with names/locations) built; wire it into the runbook
- [ ] Popup status UI polish; rehearse on a clean machine; record backup video
- Demo pieces already in place: backend packaged (`start-demo.ps1`/`.bat`), browser E2E harness, profile seed + ask-once flow.

### 4.5 Only if time remains (`new features.md`)
- RAG profile building, document upload. Per that doc: "an unfinished differentiator is worse than a polished core."

---

## 5. Key files map

```
src/background/background.js   orchestrator: prefill → capture → sanitize → VLM → execute
src/content/field-mapper.js    classify form fields → canonical profile keys (window.AegisFieldMapper)
src/content/autofill.js        progressive profile + ask-once card (window.AegisAutofill)
src/content/content.js         DOM scan + PII rect measurement + action execution
src/offscreen/vision.js        REAL BlazeFace (tiled) + DistilBERT NER (window.AegisVision)
src/offscreen/offscreen.js     canvas masking + merges vision/regex results
src/inference/inference.worker.js  OLD stubs — superseded by vision.js (delete candidate)
src/popup/popup.js             UI, config (VLM endpoint, profile editor, detection toggles)
src/vendor/                    vendored transformers.min.js + ort.min.mjs + ort wasm pair
src/models/                    blazeface.onnx (0.5MB) + ner/ (129MB q8)
scripts/test-*.mjs             Node regression tests (npm test)
scripts/browser-verify.mjs     CHROME E2E harness — 12/12 assertions, full loop in real Chrome
scripts/offscreen-browser-check.mjs  vision-layer-only browser harness (10/10)
server/index.js                laptop-hosted VLM gateway (zero deps); HOST=0.0.0.0 for LAN
server/start-demo.ps1 / .bat   one-shot demo starter for the friend's laptop (-Mock supported)
eval/                          test pages, ground truth, harness, report template, demo page
docs/                          all specs; ENGINEERING_RULES.md is binding
```

## 6. Non-negotiables (from ENGINEERING_RULES.md)

- Never claim a metric you didn't measure
- Never send raw screenshots/passwords/PII anywhere — sanitized image + structure only
- "Complete" = runs on a clean machine + handles failure cases + output visually verified
- Working → Measurable → Explainable → Privacy-safe → Lightweight → Demoable, in that order