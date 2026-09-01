# 08 — Demo Runbook (SIH demo day)

Live demo of Aegis: **the loan application you can fill without any data leaving the device.**

Everything in here is real and reproducible — this runbook was written after the E2E harness
went green (12/12). The three stories below map to the three SIH rubric pillars you'll be judged on.

---

## 0. The three stories (pick your 90 seconds)

1. **Progressive profile** — a form is asked *once*, remembered on-device, prefilled forever after.
2. **Privacy** — the VLM sees a blacked-out, blurred screen; the raw one never leaves the browser.
3. **Closed loop** — capture → sanitize → model → action → field fills itself, on screen, live.

The recommended script delivers all three in under 3 minutes. Wired stories are more convincing
than pixel-perfect slides — but also rehearse, and record a backup video.

---

## 1. Prerequisites (two laptops on the same WiFi)

| Machine | Needs |
|---|---|
| **Browser laptop** (the demo screen) | Chrome, this repo, Node ≥18 (for tests + harness) |
| **VLM host** (friend's laptop, only for real-model story) | Ollama + `qwen3-vl:8b`, this repo. Or skip — mock mode needs no model |

### Checklist before demo day
- [ ] `node scripts/browser-verify.mjs <face.jpg>` → **12/12 PASS** on the exact demo laptop (this
      is the whole loop in one command; if this is green, the core is green).
- [ ] Backend boots: `cd server; powershell -ExecutionPolicy Bypass -File start-demo.ps1 -Mock`
- [ ] Extension loads unpacked from the repo root (Chrome → `chrome://extensions` → Developer mode → Load unpacked)
- [ ] Demo page opens: `eval/demo/demo-loan.html` (see step 2 for serving options)
- [ ] Backup screen recording starts before the demo starts (demo-day nerves wipe memory; the video doesn't).

---

## 2. Set up the browser laptop (5 minutes)

### a) Seed the profile (this is "remembered on first ask")
The Aegis profile lives in `chrome.storage.local`. Two ways to seed it:

- **In the UI (recommended, it's the demo itself):**
  1. Load the extension, open the popup → **My Profile**.
  2. Add: Full name `Ananya Rao`, Email `ananya.rao@example.com`, Mobile `9812345670`,
     DOB, Address 1, City `Bengaluru`, State `Karnataka`, PIN 456789, Country `Indian`,
     College `Indian Institute of Science`, Occupation `Research Engineer`,
     Annual income `1200000`.
  3. Click the Aegis icon → `chrome.storage.local` persists it.

- **Or pre-seed for a clean rehearsal** from the harness flow (the E2E harness does exactly this:
  per-key `{ value, updatedAt }` under `aegisProfile`; see `scripts/browser-verify.mjs`).

### b) Open the demo page
Option A (zero extra): open `eval/demo/demo-loan.html` directly and enable the extension's
*Allow access to file URLs* (toggle on the extension's detail page). Capture works on `file://`.

Option B (nicer, still zero-dep): serve it localhost
```powershell
npx --yes http-server eval/demo -p 4321 -c-1
```
open `http://localhost:4321/demo-loan.html`, and make sure `face.png` sits next to the page
(replace `eval/demo/face.png` with a real face photo — then the BlazeFace story actually blurs a face).

### c) Point the VLM at the right endpoint
- Mock story: default `http://localhost:8000/v1/chat/completions` (start server first).
- Real-model story: popup → VLM Endpoint → `http://<VLM_HOST_IP>:8000/v1/chat/completions`.

---

## 3. Story 1 — Progressive profile (the "it learns you" moment)

1. Open the loan page in **incognito-ish clean state** (fresh profile is even better: ask it once live).
2. Type a task in the popup: *"Fill this loan application"* → **Run Agent**.
3. On the first run, the **ask-once card** appears for any unknown field (demo the one field you
   didn't pre-seed — e.g. "What is your Date of Birth?"). Answer it; it is never asked again.
4. Reload the page → run again → every known field is **prefilled instantly**.
   Show the popup → My Profile listing all values, and hit **Clear profile** to show the reset.

**Talking points:** no onboarding form ever; storage is local (`chrome.storage.local`); hard IDs
(PAN/Aadhaar) are `never_store` — even if a profile editor allowed it, Aegis refuses to save them.

---

## 4. Story 2 — Privacy (what the model actually sees)

This is the moment that wins the crowd. Two ways to show it:

1. **In-product:** after a run, look at the sanitized frame the VLM received — photo blurred
   (BlazeFace), PAN/Aadhaar/account fields black squares, prefilled values blacked out,
   declaration names/places/organisations blurred (NER).
2. **Proof, in the network tab:**
   - Open DevTools → **Network** on the demo page.
   - Run the agent.
   - Find the `chat/completions` POST and examine its payload → only the sanitized image +
     page structure. No password, no PAN, no raw screenshot, no readable names. The profile
     values **never** appear — they were blacked out *before* the screenshot left the page.

**Talking points:** sanitization is on-device (WASM, models ship offline); the sheet image is
discarded; the gateway adds no persistence and logs no image data (zero-dep `server/index.js`).

---

## 5. Story 3 — Closed loop (the agent acts, live)

Don't hand-type anything: run the loop and let the agent do it.

1. Backend running (mock = no model needed): `cd server; powershell -ExecutionPolicy Bypass -File start-demo.ps1 -Mock`
2. Extension loaded, profile seeded (or asked once), page open.
3. Popup → task → **Run Agent**.
4. Watch: fields fill, photo blurs, boxes blacken, and the VLM's action is **executed in the live DOM**.

**The honest-demo version (no "it worked" claims):** run the scripted proof in front of the judges —
```powershell
node scripts/browser-verify.mjs C:\path\face.jpg
```
That launches a real Chrome with the extension, seeds a profile, captures, sanitizes, asks the mock VLM,
executes the action, and reports **12/12 assertions**. It is the single strongest artifact you have.

**Real-model version (needs the VLM host):** `start-demo.ps1` on the friend's laptop, then:
```powershell
curl http://<HOST_IP>:8000/health    # expect upstreamReachable: true
```
Open the page in your Chrome, point the popup at the host IP, run a task with a real Qwen3-VL answer.

---

## 6. Failure playbook (what to do if something misbehaves)

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl /health` times out from browser laptop | Host firewall (Mode-B #1) | Admin PowerShell on host: `New-NetFirewallRule -DisplayName "Aegis" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow` |
| "Receiving end does not exist" | Branded Chrome ≥137 reloading an old extension | `chrome://extensions` → reload; or use Chrome for Testing 152 (see `browser-verify.mjs`) |
| No prefill / fields empty | Profile seeded with plain strings | Must be `{ value, updatedAt }` per key, or seeded via the popup editor |
| Sanitized image misaligned masks | OS display scale ≠ 1 | Harness forces scale 1; on live Chrome keep Windows display scale at 100% |
| BlazeFace blurs nothing | Demo page has no face | Drop a face photo at `eval/demo/face.png` |
| Stale extension code | Extension caches | Reload unpacked extension; hard-refresh the page |
| Nothing typed | Mock server not running | Start mock backend first; check popup endpoint |

---

## 7. One-page cheat sheet (paste into your notes)

```
1. server/start-demo.ps1 -Mock  (or no flag, with Ollama on a host laptop)
2. chrome://extensions → Load unpacked → repo root
3. Popup → My Profile → add fields (or let ask-once collect them)
4. Open eval/demo/demo-loan.html (+face.png beside it)
5. Popup → task → Run Agent → watch prefill → blackout → blur → auto-fill
6. Proof: DevTools Network → sanitized payload only; profile values never leave
7. Scripted: node scripts/browser-verify.mjs <face.jpg>  → 12/12
```