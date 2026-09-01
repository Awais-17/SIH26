// Node test: verify blazeface.onnx (garavv/blazeface-onnx) produces sane
// face boxes on a known test image (lena.jpg — exactly one centered face).
// Run: node scripts/test-blazeface.mjs
import sharp from "sharp";
import ort from "onnxruntime-node";
import { existsSync } from "fs";

const MODEL = "src/models/blazeface.onnx";
const IMAGE = process.argv[2] || process.env.TEMP + "\\opencode\\lena.jpg";

if (!existsSync(IMAGE)) {
  console.log(`SKIPPED: face test image not found.\nPlace a face photo (e.g. lena.jpg) at: ${IMAGE} to enable this check.`);
  process.exit(0);
}

async function preprocess(buf, size, mode) {
  let img = sharp(buf);
  let w, h, padX = 0, padY = 0;
  const meta = await img.metadata();
  const s = Math.min(size / meta.width, size / meta.height);
  if (mode === "letterbox") {
    w = Math.round(meta.width * s);
    h = Math.round(meta.height * s);
    padX = Math.floor((size - w) / 2);
    padY = Math.floor((size - h) / 2);
  } else {
    w = size; h = size;
  }
  const raw = await img.resize(w, h).removeAlpha().raw().toBuffer();
  // NCHW float32, normalized to [-1,1]
  const data = new Float32Array(3 * size * size).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 3;
      const di = (y + padY) * size + (x + padX);
      data[di] = (raw[si] - 127.5) / 127.5;
      data[size * size + di] = (raw[si + 1] - 127.5) / 127.5;
      data[2 * size * size + di] = (raw[si + 2] - 127.5) / 127.5;
    }
  }
  return { data, s, padX, padY };
}

async function run(mode) {
  const session = await ort.InferenceSession.create(MODEL);
  const buf = await sharp(IMAGE).toBuffer();
  const { data, s, padX, padY } = await preprocess(buf, 128, mode);

  const feed = {
    image: new ort.Tensor("float32", data, [1, 3, 128, 128]),
    conf_threshold: new ort.Tensor("float32", Float32Array.of(0.5), [1]),
    iou_threshold: new ort.Tensor("float32", Float32Array.of(0.3), [1]),
    max_detections: new ort.Tensor("int64", BigInt64Array.of(10n), [1]),
  };
  const out = await session.run(feed);
  const t = out.selectedBoxes;
  console.log(`\n[${mode}] output dims: ${t.dims}`);
  const d = t.data;
  const n = t.dims.length === 2 ? t.dims[0] : 0;
  console.log(`[${mode}] detections: ${n}`);
  for (let i = 0; i < Math.min(n, 5); i++) {
    const v = Array.from(d.slice(i * t.dims[1], (i + 1) * t.dims[1]));
    console.log(`  box ${i}: [${v.map((x) => x.toFixed(4)).join(", ")}]`);
  }
}

await run("stretch");
await run("letterbox");
