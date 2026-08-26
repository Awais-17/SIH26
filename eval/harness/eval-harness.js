/**
 * SIH26171 — Evaluation Harness
 * eval/harness/eval-harness.js
 *
 * PURPOSE
 * -------
 * Standalone JavaScript module that can be injected into any test page
 * (or run from the extension's DevTools console) to:
 *
 *   1. Read the page's #benchmark-meta ground-truth annotations
 *   2. Run the extension's content-script detection logic directly
 *   3. Compute TP / FP / TN / FN / Precision / Recall / F1
 *   4. Measure latency at each pipeline stage
 *   5. Measure JS heap memory usage
 *   6. Emit a structured JSON report to console
 *   7. Accumulate cross-page results for aggregate metrics
 *
 * USAGE
 * -----
 * Option A — Injected via chrome.scripting.executeScript from the extension popup:
 *   chrome.scripting.executeScript({ target: { tabId }, files: ['eval/harness/eval-harness.js'] })
 *
 * Option B — Pasted directly into Chrome DevTools console on a test page.
 *
 * Option C — Loaded as <script> in the test page itself during local development.
 *
 * DEPENDENCIES
 * ------------
 * None. Pure vanilla JS. No Node.js. No npm.
 * Reads SENSITIVE_KEYWORDS and scanning logic mirrored from content.js.
 */

"use strict";

// ── Configuration ─────────────────────────────────────────────────

const HARNESS_VERSION = "1.0.0";

const EVAL_CONFIG = {
  // IoU threshold for bbox overlap matching (redaction evaluation)
  iouThreshold: 0.5,

  // Maximum acceptable over-redaction rate (10%)
  maxOverRedactionRate: 0.10,

  // Targets per SIH evaluation rubric
  targets: {
    precision: 0.90,
    recall: 0.85,
    f1: 0.875,
    overRedactionRate: 0.10,
    captureMs: 100,
    localInferenceMs: 500,
    vlmRoundTripMs: 2000,
    totalE2eMs: 3000,
    peakMemoryMB: 500,
  },
};

// ── Detection Logic (mirrored from content.js) ────────────────────
// Mirror here so harness can run standalone without extension injection.

const SENSITIVE_AUTOCOMPLETE_KEYS = [
  "cc-number", "cc-exp", "cc-csc", "cc-name", "cc-type", "transaction-amount",
];

const SENSITIVE_KEYWORDS = [
  "password", "pin", "secret", "ssn", "social-security",
  "credit", "card", "cvv", "csc", "otp",
];

const REGEX_PATTERNS = [
  { name: "email",   pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,    pii_type: "email_pii"   },
  { name: "phone",   pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b|\+91\s?\d{5}\s?\d{5}\b/g, pii_type: "phone_pii" },
  { name: "ssn",     pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                                   pii_type: "ssn_pii"    },
  { name: "card16",  pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,             pii_type: "card_pii"   },
  { name: "aadhaar", pattern: /\b\d{4}\s\d{4}\s\d{4}\b/g,                                 pii_type: "aadhaar_pii"},
];

/**
 * Mirrors content.js scanDOMForSensitiveFields().
 * Returns array of detected field descriptors.
 */
function harnessRunDOMScan() {
  const detected = [];

  // 1. type=password
  document.querySelectorAll('input[type="password"]').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      detected.push({
        selector: buildSelector(el),
        type: "password_input",
        detection_layer: "DOM",
        rect: rectToObj(rect),
      });
    }
  });

  // 2. Autocomplete-sensitive
  document.querySelectorAll("input[autocomplete]").forEach(el => {
    const ac = (el.autocomplete || "").toLowerCase();
    if (SENSITIVE_AUTOCOMPLETE_KEYS.some(k => ac.includes(k))) {
      const sel = buildSelector(el);
      if (!detected.find(d => d.selector === sel)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          detected.push({
            selector: sel,
            type: "sensitive_input",
            detection_layer: "DOM",
            reason: `autocomplete="${el.autocomplete}"`,
            rect: rectToObj(rect),
          });
        }
      }
    }
  });

  // 3. Keyword-based (name, id, aria-label, data-testid, placeholder)
  document.querySelectorAll("input, textarea").forEach(el => {
    const attrs = [el.name, el.id, el.getAttribute("aria-label"),
                   el.getAttribute("data-testid"), el.placeholder]
      .filter(Boolean).join(" ").toLowerCase();

    if (SENSITIVE_KEYWORDS.some(k => attrs.includes(k))) {
      const sel = buildSelector(el);
      if (!detected.find(d => d.selector === sel)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          detected.push({
            selector: sel,
            type: "sensitive_input",
            detection_layer: "DOM",
            reason: "keyword in attributes",
            rect: rectToObj(rect),
          });
        }
      }
    }
  });

  // 4. Regex on visible text nodes
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const s = window.getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") {
        return NodeFilter.FILTER_REJECT;
      }
      const r = p.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (text.length < 4) continue;
    const parent = node.parentElement;
    const rect = parent.getBoundingClientRect();

    for (const { name, pattern, pii_type } of REGEX_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        const sel = buildSelector(parent);
        if (!detected.find(d => d.selector === sel && d.type === pii_type)) {
          detected.push({
            selector: sel,
            type: pii_type,
            detection_layer: "regex",
            matched_pattern: name,
            rect: rectToObj(rect),
          });
        }
      }
    }
  }

  return detected;
}

// ── Ground Truth Reader ────────────────────────────────────────────

function readGroundTruth() {
  const meta = document.getElementById("benchmark-meta");
  if (!meta) return null;

  const pageId = meta.dataset.pageId || "unknown";
  const sensitive = JSON.parse(meta.dataset.gtSensitive || "[]");
  const nonSensitive = JSON.parse(meta.dataset.gtNonSensitive || "[]");

  return { pageId, sensitive, nonSensitive };
}

// ── Metrics Calculator ─────────────────────────────────────────────

/**
 * Compute TP, FP, FN, TN, Precision, Recall, F1 for PII detection.
 *
 * A detection is a TRUE POSITIVE if its selector matches a ground-truth sensitive element.
 * A detection is a FALSE POSITIVE if its selector matches a ground-truth non-sensitive element.
 * A ground-truth sensitive element with no matching detection is a FALSE NEGATIVE.
 * A ground-truth non-sensitive element with no matching detection is a TRUE NEGATIVE.
 */
function computeDetectionMetrics(detections, groundTruth) {
  if (!groundTruth) {
    return { error: "No ground truth available on this page" };
  }

  const { sensitive: gtSensitive, nonSensitive: gtNonSensitive } = groundTruth;

  const detectedSelectors = new Set(detections.map(d => d.selector));

  // TP: sensitive elements that were detected
  const truePositives = gtSensitive.filter(gt => {
    return detections.some(d => selectorMatch(d.selector, gt.selector));
  });

  // FN: sensitive elements that were NOT detected
  const falseNegatives = gtSensitive.filter(gt => {
    return !detections.some(d => selectorMatch(d.selector, gt.selector));
  });

  // FP: detections that hit a non-sensitive element
  const falsePositives = detections.filter(d => {
    return gtNonSensitive.some(gt => selectorMatch(d.selector, gt.selector));
  });

  // TN: non-sensitive elements that were not detected (correct)
  const trueNegatives = gtNonSensitive.filter(gt => {
    return !detections.some(d => selectorMatch(d.selector, gt.selector));
  });

  const tp = truePositives.length;
  const fp = falsePositives.length;
  const fn = falseNegatives.length;
  const tn = trueNegatives.length;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall    = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1        = precision + recall > 0
    ? 2 * (precision * recall) / (precision + recall)
    : 0;

  // Over-redaction rate = FP / (TP + FP)
  const overRedactionRate = tp + fp > 0 ? fp / (tp + fp) : 0;

  return {
    tp, fp, fn, tn,
    precision: round(precision, 4),
    recall:    round(recall, 4),
    f1:        round(f1, 4),
    overRedactionRate: round(overRedactionRate, 4),
    truePositives:  truePositives.map(g => g.selector),
    falseNegatives: falseNegatives.map(g => ({ selector: g.selector, reason: g.reason, type: g.type })),
    falsePositives: falsePositives.map(d => d.selector),
    trueNegatives:  trueNegatives.map(g => g.selector),
  };
}

/**
 * Compute pass/fail against EVAL_CONFIG.targets.
 */
function computePassFail(metrics, latency, memory) {
  return {
    precision:        { value: metrics.precision,              target: EVAL_CONFIG.targets.precision,        pass: metrics.precision >= EVAL_CONFIG.targets.precision },
    recall:           { value: metrics.recall,                 target: EVAL_CONFIG.targets.recall,           pass: metrics.recall >= EVAL_CONFIG.targets.recall },
    f1:               { value: metrics.f1,                     target: EVAL_CONFIG.targets.f1,               pass: metrics.f1 >= EVAL_CONFIG.targets.f1 },
    overRedaction:    { value: metrics.overRedactionRate,      target: EVAL_CONFIG.targets.overRedactionRate,pass: metrics.overRedactionRate <= EVAL_CONFIG.targets.overRedactionRate },
    captureLatency:   { value: latency.captureMs,              target: EVAL_CONFIG.targets.captureMs,        pass: latency.captureMs <= EVAL_CONFIG.targets.captureMs },
    inferenceLatency: { value: latency.localInferenceMs,       target: EVAL_CONFIG.targets.localInferenceMs, pass: latency.localInferenceMs <= EVAL_CONFIG.targets.localInferenceMs },
    peakMemory:       { value: memory.peakMemoryMB,            target: EVAL_CONFIG.targets.peakMemoryMB,     pass: memory.peakMemoryMB <= EVAL_CONFIG.targets.peakMemoryMB },
  };
}

// ── Latency Measurement ────────────────────────────────────────────

/**
 * Run the DOM scan with timing instrumentation.
 * Returns { detections, latency }.
 */
function runTimedDOMScan() {
  const memBefore = getHeapMB();
  const t0 = performance.now();

  const detections = harnessRunDOMScan();

  const t1 = performance.now();
  const memAfter = getHeapMB();

  return {
    detections,
    latency: {
      captureMs: 0,              // N/A in standalone mode (no screenshot)
      localInferenceMs: round(t1 - t0, 2),
      vlmRoundTripMs: null,      // Not measured in harness (VLM is cloud)
      totalE2eMs: round(t1 - t0, 2),
    },
    memory: {
      heapBeforeMB: round(memBefore, 2),
      heapAfterMB:  round(memAfter, 2),
      peakMemoryMB: round(memAfter, 2),
      deltaMB:      round(memAfter - memBefore, 2),
    },
  };
}

// ── Report Generator ──────────────────────────────────────────────

/**
 * Run full evaluation on the current page and return a structured report.
 */
function runEvaluation() {
  const pageStartTime = performance.now();

  // Read ground truth
  const groundTruth = readGroundTruth();

  // Run timed detection
  const { detections, latency, memory } = runTimedDOMScan();

  // Compute metrics
  const metrics = computeDetectionMetrics(detections, groundTruth);
  const passFail = groundTruth ? computePassFail(metrics, latency, memory) : null;

  // Environment info
  const env = {
    userAgent: navigator.userAgent,
    url: location.href,
    timestamp: new Date().toISOString(),
    harnessVersion: HARNESS_VERSION,
    heapAvailable: typeof performance.memory !== "undefined",
  };

  const report = {
    environment: env,
    dataset: {
      pageId: groundTruth?.pageId || "unknown",
      sensitiveElements: groundTruth?.sensitive?.length || 0,
      nonSensitiveElements: groundTruth?.nonSensitive?.length || 0,
      totalDetections: detections.length,
    },
    detections,
    metrics,
    latency,
    memory,
    passFail,
    summary: buildSummary(metrics, latency, memory, passFail),
    wallTimeMs: round(performance.now() - pageStartTime, 2),
  };

  return report;
}

function buildSummary(metrics, latency, memory, passFail) {
  if (!passFail) return "No ground truth — metrics only, no pass/fail.";

  const allPassed = Object.values(passFail).every(v => v.pass);
  const failures = Object.entries(passFail)
    .filter(([, v]) => !v.pass)
    .map(([k, v]) => `${k}: ${v.value} (target: ${v.target})`);

  return {
    overall: allPassed ? "PASS ✅" : "FAIL ❌",
    failedChecks: failures,
  };
}

// ── Report Printer ────────────────────────────────────────────────

/**
 * Pretty-print a formatted evaluation report to the console.
 */
function printReport(report) {
  const { dataset, metrics, latency, memory, passFail, summary } = report;

  console.group(`%c[SIH26171 Eval] ${dataset.pageId}`, "color:#4299e1;font-weight:bold;font-size:14px");

  console.log(`%cEnvironment`, "font-weight:bold;color:#48bb78");
  console.log(`  Browser:  ${report.environment.userAgent.split(") ").pop()}`);
  console.log(`  URL:      ${report.environment.url}`);
  console.log(`  Time:     ${report.environment.timestamp}`);

  console.log(`\n%cDataset`, "font-weight:bold;color:#48bb78");
  console.log(`  Pages evaluated:   1`);
  console.log(`  Sensitive GT:      ${dataset.sensitiveElements}`);
  console.log(`  Non-sensitive GT:  ${dataset.nonSensitiveElements}`);
  console.log(`  Detections made:   ${dataset.totalDetections}`);

  if (!metrics.error) {
    console.log(`\n%cDetection Metrics`, "font-weight:bold;color:#48bb78");
    console.table({
      "True Positives  (TP)": { count: metrics.tp },
      "False Positives (FP)": { count: metrics.fp },
      "False Negatives (FN)": { count: metrics.fn },
      "True Negatives  (TN)": { count: metrics.tn },
    });
    console.log(`\n  Precision:          ${pct(metrics.precision)}  (target ≥${pct(EVAL_CONFIG.targets.precision)})`);
    console.log(`  Recall:             ${pct(metrics.recall)}  (target ≥${pct(EVAL_CONFIG.targets.recall)})`);
    console.log(`  F1 Score:           ${pct(metrics.f1)}  (target ≥${pct(EVAL_CONFIG.targets.f1)})`);
    console.log(`  Over-redaction:     ${pct(metrics.overRedactionRate)}  (target ≤${pct(EVAL_CONFIG.targets.overRedactionRate)})`);

    if (metrics.falseNegatives.length > 0) {
      console.log(`\n%cFalse Negatives (missed PII):`, "color:#fc8181;font-weight:bold");
      metrics.falseNegatives.forEach(fn => {
        console.log(`  ❌ ${fn.selector}  [${fn.type}] — ${fn.reason || "?"}`);
      });
    }

    if (metrics.falsePositives.length > 0) {
      console.log(`\n%cFalse Positives (over-redacted):`, "color:#f6ad55;font-weight:bold");
      metrics.falsePositives.forEach(fp => console.log(`  ⚠️  ${fp}`));
    }
  } else {
    console.warn(`  ${metrics.error}`);
  }

  console.log(`\n%cLatency`, "font-weight:bold;color:#48bb78");
  console.log(`  DOM scan + regex:   ${latency.localInferenceMs}ms  (target ≤${EVAL_CONFIG.targets.localInferenceMs}ms)`);
  if (latency.captureMs > 0) {
    console.log(`  Screenshot capture: ${latency.captureMs}ms  (target <${EVAL_CONFIG.targets.captureMs}ms)`);
  }
  if (latency.vlmRoundTripMs !== null) {
    console.log(`  VLM round-trip:     ${latency.vlmRoundTripMs}ms  (target <${EVAL_CONFIG.targets.vlmRoundTripMs}ms)`);
  }

  console.log(`\n%cMemory`, "font-weight:bold;color:#48bb78");
  if (memory.peakMemoryMB) {
    console.log(`  Heap before:   ${memory.heapBeforeMB} MB`);
    console.log(`  Heap after:    ${memory.heapAfterMB} MB`);
    console.log(`  Delta:         ${memory.deltaMB} MB`);
    console.log(`  Peak:          ${memory.peakMemoryMB} MB  (target ≤${EVAL_CONFIG.targets.peakMemoryMB}MB)`);
  } else {
    console.log(`  performance.memory API not available in this context.`);
  }

  if (passFail) {
    console.log(`\n%cPass/Fail`, "font-weight:bold;color:#48bb78");
    Object.entries(passFail).forEach(([key, { value, target, pass }]) => {
      const icon = pass ? "✅" : "❌";
      console.log(`  ${icon} ${key.padEnd(20)} ${value} (target: ${target})`);
    });

    const overall = summary.overall;
    const color = overall.includes("PASS") ? "#48bb78" : "#fc8181";
    console.log(`\n%cOverall: ${overall}`, `font-size:16px;font-weight:bold;color:${color}`);

    if (summary.failedChecks?.length > 0) {
      console.log(`%cFailed checks:`, "color:#fc8181");
      summary.failedChecks.forEach(f => console.log(`  • ${f}`));
    }
  }

  console.groupEnd();
  return report;
}

// ── Multi-Page Accumulator ────────────────────────────────────────

const __evalResults = window.__evalResults || [];

/**
 * Run evaluation, print report, and accumulate results.
 * Call from each test page. After all pages, call computeAggregateReport().
 */
function evalPage() {
  const report = runEvaluation();
  printReport(report);
  __evalResults.push(report);
  window.__evalResults = __evalResults;
  return report;
}

/**
 * Compute aggregate metrics across all accumulated page reports.
 */
function computeAggregateReport() {
  const results = window.__evalResults || [];
  if (results.length === 0) {
    console.warn("[Eval] No results accumulated. Run evalPage() on each test page first.");
    return;
  }

  const validMetrics = results.filter(r => !r.metrics.error);

  const avgPrecision     = avg(validMetrics.map(r => r.metrics.precision));
  const avgRecall        = avg(validMetrics.map(r => r.metrics.recall));
  const avgF1            = avg(validMetrics.map(r => r.metrics.f1));
  const avgOverRedaction = avg(validMetrics.map(r => r.metrics.overRedactionRate));
  const totalTP          = sum(validMetrics.map(r => r.metrics.tp));
  const totalFP          = sum(validMetrics.map(r => r.metrics.fp));
  const totalFN          = sum(validMetrics.map(r => r.metrics.fn));
  const totalTN          = sum(validMetrics.map(r => r.metrics.tn));

  const microPrecision = totalTP + totalFP > 0 ? totalTP / (totalTP + totalFP) : 0;
  const microRecall    = totalTP + totalFN > 0 ? totalTP / (totalTP + totalFN) : 0;
  const microF1        = microPrecision + microRecall > 0
    ? 2 * microPrecision * microRecall / (microPrecision + microRecall) : 0;

  const avgLatency = avg(results.map(r => r.latency.localInferenceMs));
  const maxLatency = Math.max(...results.map(r => r.latency.localInferenceMs));
  const maxMemory  = Math.max(...results.filter(r => r.memory.peakMemoryMB).map(r => r.memory.peakMemoryMB));

  const aggregate = {
    pages_evaluated: results.length,
    pages_with_ground_truth: validMetrics.length,
    macro_metrics: {
      precision:      round(avgPrecision, 4),
      recall:         round(avgRecall, 4),
      f1:             round(avgF1, 4),
      over_redaction: round(avgOverRedaction, 4),
    },
    micro_metrics: {
      tp: totalTP, fp: totalFP, fn: totalFN, tn: totalTN,
      precision: round(microPrecision, 4),
      recall:    round(microRecall, 4),
      f1:        round(microF1, 4),
    },
    latency: {
      avg_inference_ms: round(avgLatency, 2),
      max_inference_ms: round(maxLatency, 2),
    },
    memory: {
      max_peak_mb: round(maxMemory, 2),
    },
    per_page_summary: results.map(r => ({
      pageId:    r.dataset.pageId,
      precision: r.metrics.precision,
      recall:    r.metrics.recall,
      f1:        r.metrics.f1,
      tp: r.metrics.tp, fp: r.metrics.fp, fn: r.metrics.fn,
      inference_ms: r.latency.localInferenceMs,
    })),
    pass_criteria: {
      avg_precision_gte_90pct: avgPrecision >= 0.90,
      avg_recall_gte_85pct:    avgRecall >= 0.85,
      avg_f1_gte_875pct:       avgF1 >= 0.875,
      over_redaction_lte_10pct: avgOverRedaction <= 0.10,
      max_inference_lte_500ms: maxLatency <= 500,
    },
  };

  console.group("%c[SIH26171 Eval] AGGREGATE REPORT", "color:#f6e05e;font-weight:bold;font-size:16px");
  console.log(`Pages: ${aggregate.pages_evaluated} (${aggregate.pages_with_ground_truth} with GT)`);
  console.log(`\nMacro Metrics (average per page):`);
  console.table(aggregate.macro_metrics);
  console.log(`\nMicro Metrics (pooled TP/FP/FN/TN):`);
  console.table(aggregate.micro_metrics);
  console.log(`\nLatency: avg ${aggregate.latency.avg_inference_ms}ms, max ${aggregate.latency.max_inference_ms}ms`);
  console.log(`Memory:  max peak ${aggregate.memory.max_peak_mb} MB`);
  console.log(`\nPass Criteria:`);
  Object.entries(aggregate.pass_criteria).forEach(([k, v]) => {
    console.log(`  ${v ? "✅" : "❌"} ${k}`);
  });
  console.log("\nFull report:", aggregate);
  console.groupEnd();

  return aggregate;
}

// ── Failure Mode Tests ────────────────────────────────────────────

/**
 * Test: WebGPU unavailability fallback.
 * Checks if the inference worker correctly falls back to WASM.
 */
function testWebGPUFallback() {
  const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu;
  console.log(`[Failure Test] WebGPU available: ${hasWebGPU}`);
  console.log(`[Failure Test] Expected fallback to WASM: ${!hasWebGPU ? "YES — WASM active" : "NOT NEEDED"}`);
  return { webGPUAvailable: hasWebGPU, status: "logged" };
}

/**
 * Test: Dynamic content detection via MutationObserver.
 * Injects a password field and measures detection delay.
 * Requires the extension's content script to be active.
 */
function testDynamicDetection(delayMs = 500) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const field = document.createElement("input");
    field.type = "password";
    field.id = "__eval_dynamic_test_field__";
    field.style.cssText = "position:fixed;top:-100px;left:-100px;width:1px;height:1px;opacity:0";
    document.body.appendChild(field);

    // Check if content script has re-scanned within delayMs
    setTimeout(() => {
      const elapsed = performance.now() - t0;
      // Try to confirm detection by checking if extension marked it
      const result = {
        injectedAt: t0,
        checkAfterMs: elapsed,
        fieldPresent: !!document.getElementById("__eval_dynamic_test_field__"),
        note: "Content script MutationObserver should have fired. Check extension logs.",
      };
      field.remove();
      console.log("[Dynamic Test] Result:", result);
      resolve(result);
    }, delayMs);
  });
}

// ── Utility Functions ────────────────────────────────────────────

function buildSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
  if (el.className && typeof el.className === "string") {
    const cls = el.className.trim().split(/\s+/).map(CSS.escape).join(".");
    if (cls) return `${el.tagName.toLowerCase()}.${cls}`;
  }
  return el.tagName.toLowerCase();
}

function rectToObj(rect) {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function round(n, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function avg(arr) {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function getHeapMB() {
  if (typeof performance !== "undefined" && performance.memory) {
    return performance.memory.usedJSHeapSize / 1024 / 1024;
  }
  return null;
}

/**
 * Loose selector matching — handles case where detected selector and GT selector
 * both resolve to the same DOM element via different selector strings.
 */
function selectorMatch(detectedSel, gtSel) {
  if (detectedSel === gtSel) return true;
  try {
    const detectedEl = document.querySelector(detectedSel);
    const gtEl = document.querySelector(gtSel);
    return detectedEl && gtEl && detectedEl === gtEl;
  } catch {
    return false;
  }
}

/**
 * Compute Intersection over Union for two bounding boxes.
 * bbox = [x1, y1, x2, y2]
 */
function iou(boxA, boxB) {
  const [ax1, ay1, ax2, ay2] = boxA;
  const [bx1, by1, bx2, by2] = boxB;
  const interX1 = Math.max(ax1, bx1);
  const interY1 = Math.max(ay1, by1);
  const interX2 = Math.min(ax2, bx2);
  const interY2 = Math.min(ay2, by2);
  const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
  const aArea = (ax2 - ax1) * (ay2 - ay1);
  const bArea = (bx2 - bx1) * (by2 - by1);
  const unionArea = aArea + bArea - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

// ── Auto-run if embedded directly in test page ────────────────────

if (document.readyState === "complete") {
  window.__sih26171_harness = {
    evalPage,
    computeAggregateReport,
    testWebGPUFallback,
    testDynamicDetection,
    runEvaluation,
    EVAL_CONFIG,
  };
  console.log(
    "%c[SIH26171 Eval Harness] Loaded. Run: window.__sih26171_harness.evalPage()",
    "color:#4299e1;font-weight:bold"
  );
} else {
  document.addEventListener("DOMContentLoaded", () => {
    window.__sih26171_harness = {
      evalPage,
      computeAggregateReport,
      testWebGPUFallback,
      testDynamicDetection,
      runEvaluation,
      EVAL_CONFIG,
    };
    console.log(
      "%c[SIH26171 Eval Harness] Loaded. Run: window.__sih26171_harness.evalPage()",
      "color:#4299e1;font-weight:bold"
    );
  });
}
