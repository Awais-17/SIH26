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

async function handleSanitize({ screenshot, domScanResults }) {
  // 1. Load screenshot into canvas
  const img = await loadImage(screenshot);
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  const maskedRegions = [];

  // 2. Mask password fields (solid black fill)
  if (domScanResults.fields) {
    for (const field of domScanResults.fields) {
      if (field.type === "password_input" || field.type === "sensitive_input") {
        const { x, y, width, height } = field.rect;
        ctx.fillStyle = "black";
        ctx.fillRect(x, y, width, height);
        maskedRegions.push({ type: field.type, bbox: [x, y, x + width, y + height] });
      }
    }
  }

  // 3. Face detection (placeholder — will use BlazeFace ONNX)
  // TODO: Replace with actual BlazeFace inference via Web Worker
  const faceDetections = await detectFaces(screenshot);
  for (const face of faceDetections) {
    const [x1, y1, x2, y2] = face.bbox;
    applyGaussianBlur(ctx, x1, y1, x2 - x1, y2 - y1);
    maskedRegions.push({ type: "face", bbox: [x1, y1, x2, y2] });
  }

  // 4. PII text detection (placeholder — will use regex + NER)
  // TODO: Replace with actual regex + Transformers.js NER
  const piiDetections = await detectTextPII(domScanResults.visibleText || []);
  for (const pii of piiDetections) {
    if (pii.bbox) {
      const { x, y, width, height } = pii.bbox;
      applyGaussianBlur(ctx, x, y, width, height);
      maskedRegions.push({ type: "pii", entity: pii.entity_type, bbox: [x, y, x + width, y + height] });
    }
  }

  // 5. Export sanitized image
  const sanitizedImage = canvas.toDataURL("image/png");

  return { sanitizedImage, maskedRegions };
}

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

// ── Placeholder: Face Detection (BlazeFace ONNX) ─────────────────

async function detectFaces(screenshotDataUrl) {
  // TODO: Implement BlazeFace ONNX inference via inference Web Worker
  // For now, return empty array (no faces detected)
  return [];
}

// ── Placeholder: Text PII Detection (Regex + NER) ────────────────

async function detectTextPII(visibleTexts) {
  // TODO: Implement regex + Transformers.js DistilBERT NER
  // For now, run basic regex patterns
  const detections = [];

  const patterns = [
    { type: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g, entity: "SSN" },
    { type: "email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, entity: "EMAIL" },
    { type: "phone", regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, entity: "PHONE" },
  ];

  for (const item of visibleTexts) {
    if (!item.rect) continue;

    for (const { type, regex, entity } of patterns) {
      const matches = item.text.matchAll(regex);
      for (const match of matches) {
        detections.push({
          text: match[0],
          entity_type: entity,
          start: match.index,
          end: match.index + match[0].length,
          bbox: item.rect,
          confidence: 1.0,
        });
      }
    }
  }

  return detections;
}

console.log("[SIH26171] Offscreen document loaded");
