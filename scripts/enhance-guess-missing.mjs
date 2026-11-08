import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import * as ort from "onnxruntime-node";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "tmp/stock-2026/guess-missing");
const OUT = path.join(ROOT, "public/products");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/guess-missing-images.json");

const f32ToF16 = (f) => {
  const bits = new Uint32Array(new Float32Array([f]).buffer)[0];
  const sign = (bits >>> 16) & 0x8000;
  const exp = (bits >>> 23) & 0xff;
  let mant = bits & 0x7fffff;
  if (exp === 255) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant = (mant | 0x800000) >>> (1 - e);
    return sign | (mant >>> 13);
  }
  return sign | (e << 10) | (mant >>> 13);
};
const f16ToF32 = (h) => {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
};

const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".png"));
const session = await ort.InferenceSession.create(path.join(ROOT, "tmp/realesrgan.onnx"), {
  executionProviders: ["cpu"],
  graphOptimizationLevel: "all",
});
const denoise = new ort.Tensor("float16", new Uint16Array([f32ToF16(0.3)]), [1]);
const manifest = {};

for (const file of files) {
  const model = file.replace(/\.png$/i, "");
  const id = `guess-${model.toLowerCase()}`;
  const { data, info } = await sharp(path.join(SRC, file))
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .resize(300, 300, { fit: "contain", background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, n = w * h;
  const half = new Uint16Array(3 * n);
  for (let i = 0; i < n; i++) {
    half[i] = f32ToF16(data[i * 3] / 255);
    half[n + i] = f32ToF16(data[i * 3 + 1] / 255);
    half[2 * n + i] = f32ToF16(data[i * 3 + 2] / 255);
  }
  const result = await session.run({
    input: new ort.Tensor("float16", half, [1, 3, h, w]),
    denoise_strength: denoise,
  });
  const out = result.output;
  const [, , oh, ow] = out.dims;
  const d = out.data;
  const rgb = Buffer.alloc(ow * oh * 3);
  for (let i = 0; i < ow * oh; i++) {
    rgb[i * 3] = Math.max(0, Math.min(255, Math.round(f16ToF32(d[i]) * 255)));
    rgb[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(f16ToF32(d[ow * oh + i]) * 255)));
    rgb[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(f16ToF32(d[2 * ow * oh + i]) * 255)));
  }

  await sharp(rgb, { raw: { width: ow, height: oh, channels: 3 } })
    .flatten({ background: "#ffffff" })
    .trim({ threshold: 8 })
    .resize(940, 940, { fit: "inside", kernel: "lanczos3" })
    .sharpen({ sigma: 0.6, m1: 0.55, m2: 0.2 })
    .png()
    .toBuffer()
    .then(async (inner) => {
      await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
        .composite([{ input: inner, gravity: "center" }])
        .webp({ quality: 92, alphaQuality: 92, effort: 5 })
        .toFile(path.join(OUT, `${id}.webp`));
    });

  manifest[id] = { id, model, source: "27OCT PDF product image, AI-enhanced", sourceSize: "130x156", outputSize: "1000x1000" };
  console.log("enhanced", model);
}
session.release?.();
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log("done", Object.keys(manifest).length);
