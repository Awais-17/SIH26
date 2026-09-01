// Regression test for src/offscreen/vision.js detectFaces TILE SCAN.
//
// BlazeFace needs a face to fill most of its fixed 128x128 input, so face
// detection tiles the screenshot into overlapping 128x128 tiles (stride 96,
// last tile clamped inside the image) and decodes each tile directly:
//   absXY = tileOrigin + 128 * normBox
// This test pastes a real face (Lena) at a known spot on a WIDE 1280x720
// canvas, runs the full tile scan through the real model, and asserts the
// merged detection lands on the pasted face.
import sharp from "sharp";
import ort from "onnxruntime-node";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const lena = process.env.TEMP + "\\opencode\\lena.jpg";
if (!existsSync(lena)) {
  console.log(`SKIPPED: face test image not found.\nPlace a face photo (e.g. lena.jpg) at: ${lena} to enable this check.`);
  process.exit(0);
}
const pass = [];
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) pass.push(name);
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

const MODEL = join(__dirname, "..", "src", "models", "blazeface.onnx");
const TILE = 128, OVERLAP = 32, STRIDE = TILE - OVERLAP;

// ── Wide canvas with Lena's face at a known location ──
const W = 1280, H = 720;
const FACE_LEFT = 450, FACE_TOP = 50, FACE_SIZE = 300;
const FACE_CX = FACE_LEFT + FACE_SIZE / 2;
const FACE_CY = FACE_TOP + FACE_SIZE / 2;

const base = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } } })
  .composite([{ input: await sharp(lena).resize(FACE_SIZE, FACE_SIZE).toBuffer(), left: FACE_LEFT, top: FACE_TOP }])
  .png().toBuffer();

// ── Replicate production tile-grid ──
const cols = W <= TILE ? 1 : Math.floor((W - TILE) / STRIDE) + 2;
const rows = H <= TILE ? 1 : Math.floor((H - TILE) / STRIDE) + 2;
const tiles = [];
for (let r = 0; r < rows; r++) {
  const ty = r < rows - 1 ? Math.min(r * STRIDE, H - TILE) : H - TILE;
  for (let c = 0; c < cols; c++) {
    const tx = c < cols - 1 ? Math.min(c * STRIDE, W - TILE) : W - TILE;
    tiles.push([tx, ty]);
  }
}
console.log(`[scan] cols=${cols} rows=${rows} tiles=${tiles.length}`);

// ── Run every tile, decode exactly like vision.js ──
const session = await ort.InferenceSession.create(MODEL);
const raw = [];
for (const [tx, ty] of tiles) {
  const tile = await sharp(base).extract({ left: tx, top: ty, width: TILE, height: TILE })
    .removeAlpha().raw().toBuffer();
  const data = new Float32Array(3 * TILE * TILE).fill(-1);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const si = (y * TILE + x) * 3;
      const di = y * TILE + x;
      data[di] = (tile[si] - 127.5) / 127.5;
      data[TILE * TILE + di] = (tile[si + 1] - 127.5) / 127.5;
      data[2 * TILE * TILE + di] = (tile[si + 2] - 127.5) / 127.5;
    }
  }
  const out = await session.run({
    image: new ort.Tensor("float32", data, [1, 3, TILE, TILE]),
    conf_threshold: new ort.Tensor("float32", Float32Array.of(0.5), [1]),
    iou_threshold: new ort.Tensor("float32", Float32Array.of(0.3), [1]),
    max_detections: new ort.Tensor("int64", BigInt64Array.of(10n), [1]),
  });
  const t = out.selectedBoxes;
  const n = t.dims.length === 2 ? t.dims[0] : t.dims[1] || 0;
  const d = t.data;
  for (let i = 0; i < n; i++) {
    const o = i * 16;
    const x1 = tx + d[o] * TILE, y1 = ty + d[o + 1] * TILE;
    const x2 = tx + d[o + 2] * TILE, y2 = ty + d[o + 3] * TILE;
    if (x2 > x1 && y2 > y1) raw.push({ bbox: [x1, y1, x2, y2] });
  }
}

console.log(`raw tiles with faces: ${raw.length}`);
for (const f of raw) console.log(`  box: [${f.bbox.map((v) => v.toFixed(0)).join(", ")}]`);

// ── Union-merge (same as vision.js overlapRatio > 0.3) ──
function overlapRatio(a, b) {
  const ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  const area = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
  return area > 0 ? inter / area : 0;
}
const merged = [];
for (const f of raw) {
  const hit = merged.find((m) => overlapRatio(m.bbox, f.bbox) > 0.3);
  if (hit) {
    const b = hit.bbox;
    hit.bbox = [Math.min(b[0], f.bbox[0]), Math.min(b[1], f.bbox[1]), Math.max(b[2], f.bbox[2]), Math.max(b[3], f.bbox[3])];
  } else merged.push({ bbox: [...f.bbox] });
}

check("scan found at least one face", merged.length >= 1, `n=${merged.length}`);
if (merged.length >= 1) {
  const [x1, y1, x2, y2] = merged[0].bbox;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  check("merged box overlaps pasted face", x1 < FACE_LEFT + FACE_SIZE && x2 > FACE_LEFT && y1 < FACE_TOP + FACE_SIZE && y2 > FACE_TOP,
    `box=[${x1.toFixed(0)},${y1.toFixed(0)},${x2.toFixed(0)},${y2.toFixed(0)}]`);
  check("merged center near pasted face", Math.abs(cx - FACE_CX) < 100 && Math.abs(cy - FACE_CY) < 100,
    `center=(${cx.toFixed(0)},${cy.toFixed(0)}) expected ~(${FACE_CX},${FACE_CY})`);
  check("merged box within canvas", x1 >= 0 && y1 >= 0 && x2 <= W && y2 <= H,
    `box=[${x1.toFixed(0)},${y1.toFixed(0)},${x2.toFixed(0)},${y2.toFixed(0)}]`);
}

console.log(`${pass.length} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);