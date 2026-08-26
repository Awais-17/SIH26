// Inference Worker — Dedicated Web Worker for ONNX Runtime Web inference
// Runs BlazeFace ONNX (faces) and DistilBERT NER (text PII)

let ort = null;
let faceSession = null;
let nerSession = null;
let backend = "wasm";

// ── Backend Selection ─────────────────────────────────────────────

async function selectBackend() {
  if (typeof navigator !== "undefined" && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        backend = "webgpu";
        return;
      }
    } catch (e) {
      // fall through to wasm
    }
  }
  backend = "wasm";
}

// ── Model Loading ─────────────────────────────────────────────────

async function loadModel(name, modelUrl) {
  // TODO: Use Cache API to cache model weights
  // For now, load directly from URL
  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: [backend],
  });
  return session;
}

// ── Face Detection (BlazeFace) ────────────────────────────────────

async function detectFaces(imageData) {
  if (!faceSession) {
    // TODO: Replace with actual model URL
    // faceSession = await loadModel("blazeface", chrome.runtime.getURL("models/blazeface.onnx"));
    return [];
  }

  // Preprocess: resize to 128x128, normalize to [0,1]
  // Run inference
  // Postprocess: extract bboxes, filter by confidence
  // TODO: Implement full pipeline
  return [];
}

// ── NER (DistilBERT) ─────────────────────────────────────────────

async function detectNER(texts) {
  if (!nerSession) {
    // TODO: Replace with actual model URL
    // nerSession = await loadModel("distilbert-ner", chrome.runtime.getURL("models/distilbert-ner.onnx"));
    return [];
  }

  // TODO: Implement tokenization + inference + entity extraction
  return [];
}

// ── Message Handler ───────────────────────────────────────────────

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  switch (type) {
    case "INIT":
      await selectBackend();
      self.postMessage({ type: "INIT_DONE", backend });
      break;

    case "DETECT_FACES":
      const faces = await detectFaces(payload.imageData);
      self.postMessage({ type: "FACES_DETECTED", faces });
      break;

    case "DETECT_NER":
      const entities = await detectNER(payload.texts);
      self.postMessage({ type: "NER_DETECTED", entities });
      break;

    default:
      self.postMessage({ type: "ERROR", error: `Unknown message type: ${type}` });
  }
};
