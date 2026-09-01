// Vision — on-device inference for the offscreen document.
//
// Bundles two detectors:
//   1. Face detection (BlazeFace ONNX, `garavv/blazeface-onnx`) via onnxruntime-web.
//      Model output `selectedBoxes` already includes decode + NMS; boxes are
//      normalized to the 128×128 letterboxed input (verified on test images).
//   2. NER (DistilBERT multilingual) via transformers.js pipeline('token-classification').
//
// Everything runs LOCALLY from vendored files in src/vendor and src/models.
// The NER model does NOT tokenize/obsess over char offsets; we recover the
// input-relative offset ourselves by searching each text node.

(async () => {
  "use strict";

  const MODELS_URL = chrome.runtime.getURL("src/models/");
  const WASM_URL = chrome.runtime.getURL("src/vendor/ort/");
  const ORT_URL = chrome.runtime.getURL("src/vendor/ort.min.mjs");
  const TRANSFORMERS_URL = chrome.runtime.getURL(
    "src/vendor/transformers.min.js"
  );

  // ── Lazy module handles ──────────────────────────────────────────
  let ort = null;
  let faceSession = null;
  let nerPipeline = null;
  let nerInitPromise = null;

  async function getOrt() {
    if (!ort) {
      const mod = await import(ORT_URL);
      ort = mod.default || mod;
      // NOTE: onnxruntime-web's default wasm paths point at the CDN; force local.
      if (ort.env?.wasm) {
        ort.env.wasm.wasmPaths = WASM_URL;
      }
    }
    return ort;
  }

  // ── Face detection ───────────────────────────────────────────────

  async function getFaceSession() {
    if (faceSession) return faceSession;
    const runtime = await getOrt();
    faceSession = await runtime.InferenceSession.create(
      `${MODELS_URL}blazeface.onnx`,
      { executionProviders: ["wasm"] }
    );
    return faceSession;
  }

  // Build a 128×128 letterboxed NCHW float32 tensor, normalized to [-1,1].
  // Content is scaled to FIT inside 128×128 (contain) and centered; decode
  // maps boxes back with x_img = (nx*128 - padX) / s.
  function preprocessImage(imageData, width, height) {
    const size = 128;
    const s = Math.min(size / width, size / height);
    const cw = Math.max(1, Math.round(width * s));
    const ch = Math.max(1, Math.round(height * s));
    const padX = (size - cw) / 2;
    const padY = (size - ch) / 2;

    const work = document.createElement("canvas");
    work.width = size;
    work.height = size;
    const wctx = work.getContext("2d", { willReadFrequently: true });
    wctx.drawImage(imageData, padX, padY, cw, ch);
    const px = wctx.getImageData(0, 0, size, size).data;

    const data = new Float32Array(3 * size * size).fill(-1);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const si = (y * size + x) * 4;
        const di = y * size + x;
        data[di] = (px[si] - 127.5) / 127.5;
        data[size * size + di] = (px[si + 1] - 127.5) / 127.5;
        data[2 * size * size + di] = (px[si + 2] - 127.5) / 127.5;
      }
    }
    return { data, s, padX, padY };
  }

  /**
   * Detect faces in a screenshot data URL.
   *
   * BlazeFace expects the face to fill a large part of its fixed 128×128 input,
   * so a whole-page screenshot (letterboxed) never yields detections in
   * practice. Instead we scan overlapping 128×128 tiles; each tile feeds the
   * model directly (s=1, no letterbox), so decoded boxes are simply
   * tileOrigin + 128*norm.
   * @returns {Promise<Array<{bbox:[x1,y1,x2,y2], confidence:number}>>} px
   */
  async function detectFaces(screenshotDataUrl) {
    const session = await getFaceSession();
    const runtime = await getOrt();

    const img = new Image();
    img.src = screenshotDataUrl;
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    });
    const width = img.naturalWidth;
    const height = img.naturalHeight;

    const TILE = 128;
    const OVERLAP = 32; // face crossing two tiles still gets caught
    let stride = TILE - OVERLAP;

    // Compute tile grid; force a left-over overlap-only pitfall: last tile
    // origin clamps so every tile is a full 128×128 region inside the image.
    const cols = width <= TILE ? 1 : Math.floor((width - TILE) / stride) + 2;
    const rows = height <= TILE ? 1 : Math.floor((height - TILE) / stride) + 2;

    // Runtime cap: avoid pathological pages (very long screenshots).
    const MAX_TILES = 260;
    if (cols * rows > MAX_TILES) {
      stride = Math.ceil(Math.max((width - TILE) / MAX_TILES, (height - TILE) / MAX_TILES, TILE * 0.5));
      cols = width <= TILE ? 1 : Math.floor((width - TILE) / stride) + 2;
      rows = height <= TILE ? 1 : Math.floor((height - TILE) / stride) + 2;
    }

    const work = document.createElement("canvas");
    work.width = TILE;
    work.height = TILE;
    const wctx = work.getContext("2d", { willReadFrequently: true });

    const rawFaces = [];
    for (let r = 0; r < rows; r++) {
      const ty = r < rows - 1 ? Math.min(r * stride, height - TILE) : height - TILE;
      for (let c = 0; c < cols; c++) {
        const tx = c < cols - 1 ? Math.min(c * stride, width - TILE) : width - TILE;
        wctx.drawImage(img, tx, ty, TILE, TILE, 0, 0, TILE, TILE);
        const px = wctx.getImageData(0, 0, TILE, TILE).data;

        // NCHW float32, normalized to [-1,1]
        const data = new Float32Array(3 * TILE * TILE).fill(-1);
        for (let y = 0; y < TILE; y++) {
          for (let x = 0; x < TILE; x++) {
            const si = (y * TILE + x) * 4;
            const di = y * TILE + x;
            data[di] = (px[si] - 127.5) / 127.5;
            data[TILE * TILE + di] = (px[si + 1] - 127.5) / 127.5;
            data[2 * TILE * TILE + di] = (px[si + 2] - 127.5) / 127.5;
          }
        }

        const out = await session.run({
          image: new runtime.Tensor("float32", data, [1, 3, TILE, TILE]),
          conf_threshold: new runtime.Tensor("float32", Float32Array.from([0.5]), [1]),
          iou_threshold: new runtime.Tensor("float32", Float32Array.from([0.3]), [1]),
          max_detections: new runtime.Tensor(
            "int64",
            BigInt64Array.from([10n]),
            [1]
          ),
        });

        const t = out.selectedBoxes;
        const n = t.dims.length === 2 ? t.dims[0] : t.dims[1] || 0;
        const d = t.data;
        for (let i = 0; i < n; i++) {
          const o = i * 16;
          const x1 = tx + d[o + 0] * TILE;
          const y1 = ty + d[o + 1] * TILE;
          const x2 = tx + d[o + 2] * TILE;
          const y2 = ty + d[o + 3] * TILE;
          if (x2 <= x1 || y2 <= y1) continue;
          rawFaces.push({ bbox: [x1, y1, x2, y2], confidence: 1.0 });
        }
      }
    }

    // Union-merge faces caught by overlapping tiles (dedupe, clean bbox list).
    const merged = [];
    for (const f of rawFaces) {
      let hit = merged.find((m) => overlapRatio(m.bbox, f.bbox) > 0.3);
      if (hit) {
        const b = hit.bbox;
        hit.bbox = [Math.min(b[0], f.bbox[0]), Math.min(b[1], f.bbox[1]), Math.max(b[2], f.bbox[2]), Math.max(b[3], f.bbox[3])];
      } else {
        merged.push({ ...f, bbox: [...f.bbox] });
      }
    }
    return merged;
  }

  function overlapRatio(a, b) {
    const ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    const iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (ix <= 0 || iy <= 0) return 0;
    const inter = ix * iy;
    const area = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
    return area > 0 ? inter / area : 0;
  }

  // ── NER ──────────────────────────────────────────────────────────

  function labelToGroup(label) {
    return label.replace(/^[BI]-/, "").split("_")[0];
  }

  function ensureNer() {
    if (nerPipeline) return Promise.resolve(nerPipeline);
    if (!nerInitPromise) {
      nerInitPromise = (async () => {
        const mod = await import(TRANSFORMERS_URL);
        const { pipeline, env } = mod;
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = MODELS_URL;
        if (env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.wasmPaths = WASM_URL;
        }
        nerPipeline = await pipeline("token-classification", "ner", {
          dtype: "q8",
          local_files_only: true,
        });
        return nerPipeline;
      })().catch((e) => {
        nerInitPromise = null; // allow retry
        throw e;
      });
    }
    return nerInitPromise;
  }

  /**
   * Detect PII entities across an array of text nodes.
   * @returns {Promise<Array<{nodeIndex:number,text:string,start:number,end:number,entity:string,confidence:number}>>}
   */
  async function detectEntities(texts) {
    const extractor = await ensureNer();
    const spans = [];

    for (let nodeIndex = 0; nodeIndex < texts.length; nodeIndex++) {
      const text = texts[nodeIndex];
      if (!text || text.length < 2) continue;

      let tokens;
      try {
        tokens = await extractor(text, { aggregation_strategy: "none" });
      } catch {
        continue;
      }

      const ents = tokens.filter((t) => t.entity !== "O");

      const groups = [];
      for (const t of ents) {
        const g = labelToGroup(t.entity);
        const begins = t.entity.startsWith("B-") || !t.entity.includes("-");
        if (groups.length === 0 || begins || groups[groups.length - 1].group !== g) {
          groups.push({
            group: g,
            token: t.word.startsWith("##") ? t.word.slice(2) : t.word,
            score: t.score,
          });
        } else {
          groups[groups.length - 1].token +=
            t.word.startsWith("##") ? t.word.slice(2) : " " + t.word;
          groups[groups.length - 1].score = Math.min(
            groups[groups.length - 1].score,
            t.score
          );
        }
      }

      const seen = new Map();
      const lower = text.toLowerCase();
      for (const grp of groups) {
        const phrase = grp.token.replace(/\s+/g, " ").trim();
        if (phrase.length < 3) continue;

        // Find every occurrence; pick the next unseen one.
        const positions = [];
        let from = 0;
        const needle = phrase.toLowerCase();
        while (true) {
          const p = lower.indexOf(needle, from);
          if (p === -1) break;
          const before = p > 0 ? lower[p - 1] : " ";
          const after =
            p + phrase.length < text.length ? lower[p + phrase.length] : " ";
          // Word boundary: skip if glued to an alphanumeric char on either side
          if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) {
            from = p + 1;
            continue;
          }
          positions.push(p);
          from = p + phrase.length;
        }
        const k = seen.get(phrase.toLowerCase()) || 0;
        seen.set(phrase.toLowerCase(), k + 1);
        const start = positions[k];
        if (start === undefined) continue;
        spans.push({
          nodeIndex,
          text: phrase,
          start,
          end: start + phrase.length,
          entity: grp.group,
          confidence: grp.score,
        });
      }
    }

    return spans;
  }

  // ── Public API ───────────────────────────────────────────────────
  window.AegisVision = { detectFaces, detectEntities };
  console.log("[Aegis] vision module ready");
})();
