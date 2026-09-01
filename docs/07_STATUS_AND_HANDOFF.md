# 07 — Status & Handoff (READ THIS FIRST)

**Last updated:** 2026-09-01
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
| MV3 scaffold (SW + content + offscreen + popup) | `src/` | ✅ Working code, installed as unpacked extension |
| Screenshot capture + DOM scan + password black-fill + regex PII blur | `src/background/background.js`, `src/content/content.js`, `src/offscreen/offscreen.js` | ✅ Working pipeline end-to-end **in mock mode** |
| **BlazeFace face detection** | `src/inference/inference.worker.js` | ❌ **STUB — returns `[]`. No model loaded.** This is Phase 1's core deliverable and 25% of the score |
| **DistilBERT NER** | `src/inference/inference.worker.js` | ❌ **STUB — returns `[]`.** Regex still catches emails/phones/SSNs |
| WebGPU backend selection | `src/inference/inference.worker.js` | ⚠️ Logic exists, never exercised with a real model |
| Backend VLM gateway | `server/index.js` | ✅ Working (zero deps, Node ≥18). Tested via `--mock` + contract test. Untested against a real VLM |
| Eval harness + 7 test pages + ground truth | `eval/` | ✅ Files exist. ❌ **Zero measured results** |
| RAG profile / doc upload (`new features.md`) | — | ❌ Not started (correctly — build only after core works) |

**Nothing has been verified in a real Chrome run yet.** Every "✅" above means the code exists and passes local unit/contract tests, not that it survived a live browser.

---

## 3. How to run it (today, two modes)

### Mode A — Mock (no VLM needed, tests extension plumbing)
```powershell
cd server
npm run start:mock          # backend on port 8000, fake actions
```
Load `src/` via `chrome://extensions` → Developer mode → Load unpacked.
Click the extension icon → it captures, masks passwords/regex-PII, gets a fake action back.

### Mode B — Real VLM on a second laptop (the current plan)
The VLM runtime (Ollama) lives on **Friend's laptop**. Both laptops must be on the same WiFi.

**On the friend's laptop (the VLM host):**
```powershell
ollama pull qwen3-vl:8b        # or: qwen2.5vl:7b — any vision-capable model that fits
ollama serve                   # usually auto-runs as a service
ollama set OLLAMA_HOST 0.0.0.0  # allow LAN connections (or set env var OLLAMA_HOST=0.0.0.0)
ipconfig                        # note the IPv4 address, e.g. 192.168.1.42
```
Then run the Aegis gateway (from this repo) on the friend's laptop too:
```powershell
cd server
set HOST=0.0.0.0
set UPSTREAM_BASE_URL=http://localhost:11434/v1
npm start
```
Allow Node through Windows Firewall when prompted (or: `New-NetFirewallRule -DisplayName "Aegis" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow` — admin PowerShell).

**On your laptop (the browser):**
The extension's VLM endpoint must point at the friend's IP. Set it in the popup (it persists via `chrome.storage.local`), or it defaults to `http://localhost:8000` which is wrong for this setup:
- Popup → VLM Endpoint → `http://192.168.1.42:8000/v1/chat/completions` (friend's IP)

Sanity check from your laptop before loading the extension:
```powershell
curl http://192.168.1.42:8000/health     # expect upstreamReachable: true
```

> Firewall is the #1 reason this fails. If `curl` times out, it's the host's firewall, not the code.

---

## 4. Remaining work, in build order

### 4.1 Phase 1 completion — BlazeFace (HIGHEST PRIORITY, 25% of score)
- [ ] Put `blazeface.onnx` (~400KB) in `src/models/` — convert from TFJS or find an ONNX release
- [ ] Implement `detectFaces()` in `inference.worker.js`: preprocess (resize 128×128, normalize), run session, decode anchors → bboxes, confidence filter
- [ ] Load model via Cache API (see `03_TECH_STACK_MODELS.md` §5.3)
- [ ] Wire offscreen.js placeholder → real worker inference
- [ ] **Verify by eye**: load `eval/test-pages/tp03-profile-page.html`, confirm blur lands on faces (ENGINEERING_RULES: "look at the output")

### 4.2 Phase 2 completion — NER (20% of score)
- [ ] DistilBERT NER ONNX (~66MB) + tokenizer in worker; lazy-load with loading state
- [ ] Char-offset → bbox mapping via `Range` API (see milestone risks — this is the tricky part)
- [ ] Tune confidence threshold + exclusion list to avoid over-redaction

### 4.3 Phase 4 — Real E2E loop (per §3 above, once BlazeFace works)
- [ ] Friend's laptop: Ollama + gateway running, `/health` green from your machine
- [ ] Extension: run the full loop on `eval/test-pages/tp01-login-form.html`
- [ ] Verify password typed via DOM injection never appears in any network payload (DevTools → Network — this is a demo-day talking point)

### 4.4 Phase 5 — Run the harness, produce real numbers
- [ ] `eval/harness/eval-harness.js` against all 7 test pages
- [ ] Fill `eval/reports/benchmark-report-template.md` with **measured** values only
- [ ] Targets: Visual ≥90%, PII recall ≥85%, redaction precision ≥90%, mem ≤500MB, latency ≤3s

### 4.5 Phase 6 — Demo polish
- [ ] Loan-application demo scenario; popup status UI; rehearse on a clean machine; record backup video

### 4.6 Only if time remains (`new features.md`)
- RAG profile building, document upload. Per that doc: "an unfinished differentiator is worse than a polished core."

---

## 5. Key files map

```
src/background/background.js   orchestrator: capture → sanitize → VLM → execute
src/content/content.js         DOM scan + action execution (click/type/scroll)
src/offscreen/offscreen.js     canvas masking + detection merge  ← STUBS for faces/NER
src/inference/inference.worker.js  ONNX inference           ← BIGGEST GAP
src/popup/popup.js             UI, config (VLM endpoint lives in chrome.storage.local)
server/index.js                laptop-hosted VLM gateway (this repo, zero deps)
eval/                          test pages, ground truth, harness, report template
docs/                          all specs; ENGINEERING_RULES.md is binding
```

## 6. Non-negotiables (from ENGINEERING_RULES.md)

- Never claim a metric you didn't measure
- Never send raw screenshots/passwords/PII anywhere — sanitized image + structure only
- "Complete" = runs on a clean machine + handles failure cases + output visually verified
- Working → Measurable → Explainable → Privacy-safe → Lightweight → Demoable, in that order
