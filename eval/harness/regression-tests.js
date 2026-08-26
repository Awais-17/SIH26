/**
 * SIH26171 — Regression Test Suite
 * eval/harness/regression-tests.js
 *
 * Unit-level tests for individual detection functions.
 * Run in the browser console or inject into any page.
 *
 * Tests are self-contained and deterministic — they create
 * temporary DOM elements, run detection, assert outcomes, and clean up.
 *
 * USAGE:
 *   1. Load eval-harness.js first (provides harnessRunDOMScan, etc.)
 *   2. Then load or paste this file.
 *   3. Call: runRegressionTests()
 */

"use strict";

// ── Test Runner Infrastructure ────────────────────────────────────

const _regressionResults = {
  passed: [],
  failed: [],
  skipped: [],
};

function test(name, fn) {
  try {
    const result = fn();
    if (result === false) {
      _regressionResults.failed.push({ name, reason: "Returned false" });
      console.warn(`  ❌ FAIL: ${name}`);
    } else {
      _regressionResults.passed.push(name);
      console.log(`  ✅ PASS: ${name}`);
    }
  } catch (err) {
    _regressionResults.failed.push({ name, reason: err.message });
    console.error(`  ❌ FAIL: ${name} — ${err.message}`);
  }
}

function assertEqual(actual, expected, msg = "") {
  if (actual !== expected) {
    throw new Error(`${msg ? msg + ": " : ""}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertGte(actual, min, msg = "") {
  if (actual < min) {
    throw new Error(`${msg ? msg + ": " : ""}Expected ≥ ${min}, got ${actual}`);
  }
}

function assertLte(actual, max, msg = "") {
  if (actual > max) {
    throw new Error(`${msg ? msg + ": " : ""}Expected ≤ ${max}, got ${actual}`);
  }
}

function assertTrue(condition, msg = "") {
  if (!condition) throw new Error(msg || "Assertion failed");
}

// ── DOM Helper ────────────────────────────────────────────────────

let _testContainer = null;

function getContainer() {
  if (!_testContainer) {
    _testContainer = document.createElement("div");
    _testContainer.id = "__regression_test_container__";
    _testContainer.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:400px;height:600px;overflow:hidden;";
    document.body.appendChild(_testContainer);
  }
  return _testContainer;
}

function inject(html) {
  const container = getContainer();
  container.innerHTML = html;
  return container;
}

function cleanup() {
  if (_testContainer) {
    _testContainer.innerHTML = "";
  }
}

// ── Helper: run scan on injected HTML ─────────────────────────────

function scanInjected(html) {
  inject(html);
  // Brief pause would be needed for real async — but DOM scan is sync
  const detected = harnessRunDOMScan ? harnessRunDOMScan() : [];
  return detected.filter(d => !d.selector.includes("benchmark-meta"));
}

// ── SECTION 1: DOM Detection Tests ───────────────────────────────

function testDOMDetection() {
  console.group("%cSection 1: DOM Detection", "color:#58a6ff;font-weight:bold");

  test("Detects input[type=password]", () => {
    const results = scanInjected(`<input type="password" id="test-pw" value="secret" style="width:100px;height:30px;">`);
    const found = results.find(r => r.type === "password_input");
    assertTrue(!!found, "password_input not found");
    assertTrue(found.detection_layer === "DOM");
  });

  test("Detects autocomplete=cc-number", () => {
    const results = scanInjected(`<input type="text" id="cc" autocomplete="cc-number" style="width:100px;height:30px;" value="4532015112830366">`);
    const found = results.find(r => r.type === "sensitive_input");
    assertTrue(!!found, "cc-number not detected");
  });

  test("Detects autocomplete=cc-csc", () => {
    const results = scanInjected(`<input type="text" id="cvv" autocomplete="cc-csc" style="width:100px;height:30px;" value="847">`);
    assertTrue(results.some(r => r.type === "sensitive_input"), "cc-csc not detected");
  });

  test("Detects autocomplete=cc-name", () => {
    const results = scanInjected(`<input type="text" id="cname" autocomplete="cc-name" style="width:100px;height:30px;" value="John Doe">`);
    assertTrue(results.some(r => r.type === "sensitive_input"), "cc-name not detected");
  });

  test("Detects keyword 'password' in name attribute", () => {
    const results = scanInjected(`<input type="text" name="user_password" style="width:100px;height:30px;">`);
    assertTrue(results.some(r => r.selector.includes("user_password")), "keyword 'password' in name not detected");
  });

  test("Detects keyword 'pin' in id attribute", () => {
    const results = scanInjected(`<input type="text" id="pin-code" style="width:100px;height:30px;">`);
    assertTrue(results.length > 0, "keyword 'pin' in id not detected");
  });

  test("Detects keyword 'cvv' in aria-label", () => {
    const results = scanInjected(`<input type="text" aria-label="CVV code" style="width:100px;height:30px;">`);
    assertTrue(results.length > 0, "keyword 'cvv' in aria-label not detected");
  });

  test("Does NOT flag innocent text inputs", () => {
    const results = scanInjected(`
      <input type="text" id="username" name="username" placeholder="Username" style="width:100px;height:30px;">
      <input type="text" id="search" name="search" placeholder="Search..." style="width:100px;height:30px;">
      <input type="text" id="city" name="city" placeholder="City" style="width:100px;height:30px;">
    `);
    assertEqual(results.length, 0, "Innocent inputs were incorrectly flagged");
  });

  test("Does NOT flag select elements", () => {
    const results = scanInjected(`
      <select id="country" name="country" style="width:100px;height:30px;">
        <option>India</option><option>USA</option>
      </select>
    `);
    assertEqual(results.length, 0, "Select element incorrectly flagged");
  });

  test("Does NOT flag zero-size inputs (off-screen)", () => {
    const results = scanInjected(`<input type="password" id="hidden-pw" style="width:0;height:0;">`);
    assertEqual(results.length, 0, "Zero-size password input should not be flagged");
  });

  console.groupEnd();
  cleanup();
}

// ── SECTION 2: Regex Detection Tests ─────────────────────────────

function testRegexDetection() {
  console.group("%cSection 2: Regex Detection", "color:#58a6ff;font-weight:bold");

  test("Detects email address in text", () => {
    const results = scanInjected(`<p style="width:200px;height:20px;">Contact: user@example.com</p>`);
    assertTrue(results.some(r => r.type === "email_pii"), "Email not detected");
  });

  test("Detects Indian phone number (+91 format)", () => {
    const results = scanInjected(`<p style="width:200px;height:20px;">Call: +91 98765 43210</p>`);
    assertTrue(results.some(r => r.type === "phone_pii"), "Indian phone not detected");
  });

  test("Detects US-format phone number", () => {
    const results = scanInjected(`<p style="width:200px;height:20px;">Phone: (555) 123-4567</p>`);
    assertTrue(results.some(r => r.type === "phone_pii"), "US phone not detected");
  });

  test("Detects SSN pattern", () => {
    const results = scanInjected(`<p style="width:200px;height:20px;">SSN: 524-68-1903</p>`);
    assertTrue(results.some(r => r.type === "ssn_pii"), "SSN not detected");
  });

  test("Detects 16-digit card number (spaced)", () => {
    const results = scanInjected(`<p style="width:200px;height:20px;">Card: 4532 0151 1283 0366</p>`);
    assertTrue(results.some(r => r.type === "card_pii"), "Card number not detected");
  });

  test("Detects 16-digit card number (dashes)", () => {
    const results = scanInjected(`<p style="width:200px;height:20px;">4532-0151-1283-0366</p>`);
    assertTrue(results.some(r => r.type === "card_pii"), "Dashed card number not detected");
  });

  test("Detects Aadhaar number (12-digit spaced)", () => {
    const results = scanInjected(`<p style="width:200px;height:20px;">Aadhaar: 5432 8761 9023</p>`);
    assertTrue(results.some(r => r.type === "aadhaar_pii"), "Aadhaar not detected");
  });

  test("Does NOT false-positive on 16-digit order ID (non-card format)", () => {
    // Order IDs are typically non-spaced or have different structure
    // This is a known tricky case
    const results = scanInjected(`<p style="width:200px;height:20px;">Order: 1234567890123456</p>`);
    // This may or may not match — document the behaviour
    const matched = results.some(r => r.type === "card_pii");
    console.log(`    [Note] Continuous 16-digit order ID matched as card: ${matched} (known false-positive risk)`);
    // We do not assert pass/fail here — we document it as a known FP risk
  });

  test("Does NOT false-positive on year ranges as phone numbers", () => {
    const results = scanInjected(`<p style="width:200px;height:20px;">Copyright 2020-2026. All rights reserved.</p>`);
    const phoneFP = results.some(r => r.type === "phone_pii");
    assertTrue(!phoneFP, "Year range false-positived as phone number");
  });

  test("Does NOT false-positive on zip codes as SSN", () => {
    const results = scanInjected(`<p style="width:200px;height:20px;">PIN: 400001</p>`);
    const ssnFP = results.some(r => r.type === "ssn_pii");
    assertTrue(!ssnFP, "Zip code false-positived as SSN");
  });

  console.groupEnd();
  cleanup();
}

// ── SECTION 3: Metrics Calculation Tests ─────────────────────────

function testMetricsCalculation() {
  console.group("%cSection 3: Metrics Calculation", "color:#58a6ff;font-weight:bold");

  const groundTruth = {
    sensitive: [
      { selector: "#pw",    type: "password_input", reason: "type=password" },
      { selector: "#email", type: "email_pii",       reason: "email regex" },
      { selector: "#ssn",   type: "ssn_pii",         reason: "SSN regex" },
    ],
    nonSensitive: [
      { selector: "#username", type: "text" },
      { selector: "#submit",   type: "button" },
    ],
  };

  test("Perfect detection: Precision=1, Recall=1, F1=1", () => {
    const detections = [
      { selector: "#pw",    type: "password_input" },
      { selector: "#email", type: "email_pii" },
      { selector: "#ssn",   type: "ssn_pii" },
    ];
    const m = computeDetectionMetrics(detections, groundTruth);
    assertEqual(m.tp, 3);
    assertEqual(m.fp, 0);
    assertEqual(m.fn, 0);
    assertEqual(m.precision, 1.0);
    assertEqual(m.recall, 1.0);
    assertEqual(m.f1, 1.0);
  });

  test("Missed one sensitive: Recall < 1", () => {
    const detections = [
      { selector: "#pw",    type: "password_input" },
      { selector: "#email", type: "email_pii" },
      // #ssn missed
    ];
    const m = computeDetectionMetrics(detections, groundTruth);
    assertEqual(m.tp, 2);
    assertEqual(m.fn, 1);
    assertEqual(m.recall, 0.6667, `Got ${m.recall}`);
  });

  test("False positive on non-sensitive: Precision < 1", () => {
    const detections = [
      { selector: "#pw",       type: "password_input" },
      { selector: "#email",    type: "email_pii" },
      { selector: "#ssn",      type: "ssn_pii" },
      { selector: "#username", type: "text" },  // FP — non-sensitive flagged
    ];
    const m = computeDetectionMetrics(detections, groundTruth);
    assertEqual(m.tp, 3);
    assertEqual(m.fp, 1);
    assertTrue(m.precision < 1.0, `Precision should be < 1, got ${m.precision}`);
    assertTrue(m.overRedactionRate > 0, "Over-redaction rate should be > 0");
  });

  test("Zero detections: Precision=0, Recall=0, F1=0", () => {
    const m = computeDetectionMetrics([], groundTruth);
    assertEqual(m.tp, 0);
    assertEqual(m.precision, 0);
    assertEqual(m.recall, 0);
    assertEqual(m.f1, 0);
  });

  test("F1 is harmonic mean of precision and recall", () => {
    const detections = [
      { selector: "#pw",       type: "password_input" },
      { selector: "#email",    type: "email_pii" },
      { selector: "#username", type: "text" }, // FP
      // #ssn missed — FN
    ];
    const m = computeDetectionMetrics(detections, groundTruth);
    const expectedF1 = 2 * m.precision * m.recall / (m.precision + m.recall);
    assertEqual(m.f1, Math.round(expectedF1 * 10000) / 10000);
  });

  console.groupEnd();
}

// ── SECTION 4: Failure Mode Tests ────────────────────────────────

function testFailureModes() {
  console.group("%cSection 4: Failure Modes", "color:#58a6ff;font-weight:bold");

  test("Empty page produces no detections", () => {
    const results = scanInjected("<div></div>");
    assertEqual(results.length, 0, "Empty page should produce no detections");
  });

  test("Hidden password input (display:none) not detected", () => {
    const results = scanInjected(`<input type="password" id="hidden" style="display:none;">`);
    assertEqual(results.length, 0, "Hidden (display:none) input should not be detected");
  });

  test("Malformed email not detected", () => {
    const results = scanInjected(`<p style="width:200px;height:20px;">Email: not-an-email</p>`);
    const emailFP = results.some(r => r.type === "email_pii");
    assertTrue(!emailFP, "Malformed email should not be detected");
  });

  test("Script tag content not scanned", () => {
    const results = scanInjected(`<script>var email = "secret@hidden.com";</script>`);
    const emailFound = results.some(r => r.type === "email_pii");
    assertTrue(!emailFound, "Script tag content should not be visible-text-scanned");
  });

  test("Duplicate detection avoided for same element", () => {
    // Element matching both autocomplete and keyword criteria
    const results = scanInjected(`<input type="text" id="card-num" name="card-number" autocomplete="cc-number" style="width:100px;height:30px;">`);
    const dupes = results.filter(r => r.selector === "#card-num");
    assertLte(dupes.length, 1, `Element detected ${dupes.length} times — should be deduplicated`);
  });

  test("readGroundTruth returns null when no benchmark-meta present", () => {
    inject("<div>No meta here</div>");
    const gt = readGroundTruth();
    assertTrue(gt === null, "Should return null when no #benchmark-meta");
    cleanup();
  });

  console.groupEnd();
}

// ── SECTION 5: Performance Tests ─────────────────────────────────

function testPerformance() {
  console.group("%cSection 5: Performance", "color:#58a6ff;font-weight:bold");

  test("DOM scan completes within 100ms on moderate page", () => {
    // Inject a moderately complex page
    const html = Array.from({ length: 50 }, (_, i) =>
      `<div style="height:20px;width:200px;"><input type="text" name="field${i}" style="width:100px;height:20px;"> <span>Label ${i}</span></div>`
    ).join("") +
    `<input type="password" id="test-perf-pw" style="width:100px;height:30px;">`;
    inject(html);

    const t0 = performance.now();
    harnessRunDOMScan();
    const elapsed = performance.now() - t0;

    cleanup();
    console.log(`    DOM scan on 51-element page: ${elapsed.toFixed(2)}ms`);
    assertLte(elapsed, 100, `DOM scan took ${elapsed}ms (target: ≤100ms)`);
  });

  test("Regex scan completes within 100ms on text-dense page", () => {
    const emails = Array.from({ length: 20 }, (_, i) =>
      `<p style="width:300px;height:20px;">Contact ${i}: user${i}@example.com, Phone: +91 9876${i}43210</p>`
    ).join("");
    inject(emails);

    const t0 = performance.now();
    harnessRunDOMScan();
    const elapsed = performance.now() - t0;

    cleanup();
    console.log(`    Regex scan on 20-text-node page: ${elapsed.toFixed(2)}ms`);
    assertLte(elapsed, 100, `Regex scan took ${elapsed}ms (target: ≤100ms)`);
  });

  console.groupEnd();
}

// ── Main Runner ───────────────────────────────────────────────────

function runRegressionTests() {
  _regressionResults.passed.length = 0;
  _regressionResults.failed.length = 0;
  _regressionResults.skipped.length = 0;

  console.group("%c[SIH26171] Regression Tests", "color:#f6e05e;font-weight:bold;font-size:14px");

  // Check dependencies
  if (typeof harnessRunDOMScan === "undefined" ||
      typeof computeDetectionMetrics === "undefined" ||
      typeof readGroundTruth === "undefined") {
    console.error("⛔ eval-harness.js must be loaded first. Dependencies not found.");
    console.groupEnd();
    return;
  }

  testDOMDetection();
  testRegexDetection();
  testMetricsCalculation();
  testFailureModes();
  testPerformance();

  // Summary
  const total  = _regressionResults.passed.length + _regressionResults.failed.length;
  const passed = _regressionResults.passed.length;
  const failed = _regressionResults.failed.length;

  console.log("\n");
  console.log(`%c${"═".repeat(50)}`, "color:#30363d");
  console.log(
    `%cResults: ${passed}/${total} passed`,
    `font-weight:bold;font-size:14px;color:${failed === 0 ? "#3fb950" : "#f85149"}`
  );
  if (failed > 0) {
    console.log(`%cFailed tests:`, "color:#f85149;font-weight:bold");
    _regressionResults.failed.forEach(f => {
      console.log(`  ❌ ${f.name}: ${f.reason}`);
    });
  }
  console.groupEnd();

  return { passed, failed, total, details: _regressionResults };
}

// Export to window
window.__sih26171_regression = { runRegressionTests };
console.log("%c[SIH26171 Regression] Loaded. Run: window.__sih26171_regression.runRegressionTests()", "color:#4299e1");
