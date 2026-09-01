// Offscreen Document — Runs inference and mask rendering (has Canvas/DOM access)

const canvas = document.getElementById("mask-canvas");
const ctx = canvas.getContext("2d");

// ── Message Listener ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SANITIZE") {
    handleSanitize(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async
  }
});

// ── Sanitize Pipeline ─────────────────────────────────────────────

async function handleSanitize({ screenshot, domScanResults, tabId }) {
  // 1. Load screenshot into canvas
  const img = await loadImage(screenshot);
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  // DOM rects are CSS px; the screenshot canvas is device px. Scale by DPR.
  const dpr = domScanResults.dpr || 1;
  const scale = (r) => ({
    x: r.x * dpr,
    y: r.y * dpr,
    width: r.width * dpr,
    height: r.height * dpr,
  });

  const maskedRegions = [];

  // 2. Mask sensitive fields (solid black fill): password inputs, sensitive
  //    inputs, never-store IDs, and profile-prefilled values. Values are set
  //    on-device and must never appear in the transmitted image.
  if (domScanResults.fields) {
    for (const field of domScanResults.fields) {
      if (!field.sensitive) continue;
      const { x, y, width, height } = scale(field.rect);
      ctx.fillStyle = "black";
      ctx.fillRect(x, y, width, height);
      maskedRegions.push({
        type: field.type,
        bbox: [x, y, x + width, y + height],
      });
    }
  }

  // 3. Face detection (BlazeFace via transformers.js — lazy-loads the model)
  if (detectionEnabled("faceDetection")) {
    try {
      const faceDetections = await AegisVision.detectFaces(screenshot);
      for (const face of faceDetections) {
        const [x1, y1, x2, y2] = face.bbox;
        applyGaussianBlur(ctx, x1, y1, x2 - x1, y2 - y1);
        maskedRegions.push({ type: "face", bbox: [x1, y1, x2, y2] });
      }
    } catch (e) {
      console.warn("[Aegis] Face detection failed (page not blocked):", e.message);
    }
  }

  // 4. PII text detection: regex (fast, local) + NER spans → precise rects
  //    measured in the page via Range, then blurred here.
  if (detectionEnabled("piiDetection")) {
    try {
      const visibleTexts = domScanResults.visibleText || [];
      const regexDetections = detectRegexPII(visibleTexts, dpr);
      const nerDetections = await detectNERPii(visibleTexts, dpr, tabId);

      for (const pii of [...regexDetections, ...nerDetections]) {
        if (!pii.bbox) continue;
        const { x, y, width, height } = pii.bbox;
        applyGaussianBlur(ctx, x, y, width, height);
        maskedRegions.push({
          type: "pii",
          entity: pii.entity_type,
          source: pii.source,
          bbox: [x, y, x + width, y + height],
        });
      }
    } catch (e) {
      console.warn("[Aegis] PII detection failed (page not blocked):", e.message);
    }
  }

  // 5. Export sanitized image
  const sanitizedImage = canvas.toDataURL("image/png");

  return { sanitizedImage, maskedRegions };
}

function detectionEnabled(key) {
  // Detection toggles live in chrome.storage.local; cache is refreshed per call.
  return cachedDetectionConfig[key] !== false;
}

let cachedDetectionConfig = {};
chrome.storage.local.get(["faceDetection", "piiDetection"]).then((v) => {
  cachedDetectionConfig = v;
});
chrome.storage.onChanged.addListener((changes) => {
  for (const key of ["faceDetection", "piiDetection"]) {
    if (changes[key]) cachedDetectionConfig[key] = changes[key].newValue;
  }
});

// ── Helpers ───────────────────────────────────────────────────────

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function applyGaussianBlur(ctx, x, y, w, h) {
  if (w <= 0 || h <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Use canvas filter for blur (kernel size ~21px equivalent)
  // For production: implement proper Gaussian kernel or use WebGL
  ctx.filter = "blur(12px)";
  ctx.drawImage(ctx.canvas, x, y, w, h, x, y, w, h);
  ctx.filter = "none";

  ctx.restore();
}

// ── Regex PII (fast, always-on fallback) ──────────────────────────

function detectRegexPII(visibleTexts, dpr) {
  const detections = [];

  const patterns = [
    { regex: /\b\d{3}-\d{2}-\d{4}\b/g, entity: "SSN" },
    { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, entity: "EMAIL" },
    { regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, entity: "PHONE" },
    { regex: /\b[5-9]\d{9}\b/g, entity: "PHONE_IN" },
    { regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g, entity: "PAN" },
    { regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g, entity: "AADHAAR_LIKELY" },
    { regex: /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, entity: "CARD" },
  ];

  for (const [index, item] of visibleTexts.entries()) {
    if (!item.rect) continue;
    const box = scaleRect(item.rect, dpr);

    for (const { regex, entity } of patterns) {
      for (const match of item.text.matchAll(regex)) {
        detections.push({
          text: match[0],
          entity_type: entity,
          source: "regex",
          start: match.index,
          end: match.index + match[0].length,
          bbox: box,
          nodeIndex: index,
          confidence: 1.0,
        });
      }
    }
  }

  return detections;
}

function scaleRect(rect, dpr) {
  return {
    x: rect.x * dpr,
    y: rect.y * dpr,
    width: rect.width * dpr,
    height: rect.height * dpr,
  };
}

// ── NER PII (DistilBERT via transformers.js, lazy-loaded) ─────────
// The model returns char-offset spans per text node; precise sub-rects are
// measured in the page (Range API) by the content script, since only the
// page's DOM can compute them.

async function detectNERPii(visibleTexts, dpr, tabId) {
  const texts = visibleTexts.map((t) => t.text);
  const spans = await AegisVision.detectEntities(texts);
  if (spans.length === 0) return [];

  let measured = { rects: spans.map((s) => ({ nodeIndex: s.nodeIndex, rect: null })), dpr };

  if (typeof tabId === "number") {
    try {
      measured = await chrome.tabs.sendMessage(tabId, {
        type: "MEASURE_PII_RECTS",
        spans: spans.map((s) => ({
          nodeIndex: s.nodeIndex,
          text: s.text,
          offsetHint: s.start, // exact occurrence offset in the text node
          entity: s.entity,
        })),
      });
    } catch (e) {
      console.warn("[Aegis] PII rect measurement unavailable:", e.message);
    }
  }

  const rectByNode = new Map();
  for (const r of measured.rects || []) rectByNode.set(r.nodeIndex, r.rect);

  // Fallback: blur the whole text node's box when sub-rect measurement failed
  const detections = [];
  for (const span of spans) {
    let bbox = rectByNode.get(span.nodeIndex);
    if (!bbox) {
      const item = visibleTexts[span.nodeIndex];
      if (!item?.rect) continue;
      bbox = scaleRect(item.rect, dpr);
    } else {
      bbox = scaleRect(bbox, measured.dpr || dpr);
    }
    detections.push({
      text: span.text,
      entity_type: span.entity,
      source: "ner",
      bbox,
      nodeIndex: span.nodeIndex,
      confidence: span.confidence ?? 0,
    });
  }

  // Over-redaction guard: drop low-confidence and trivially short entities
  const MIN_ENTITY_LENGTH = 3;
  const MIN_CONFIDENCE = 0.75;
  return detections.filter(
    (d) => d.text.length >= MIN_ENTITY_LENGTH && d.confidence >= MIN_CONFIDENCE
  );
}

console.log("[Aegis] Offscreen document loaded");
