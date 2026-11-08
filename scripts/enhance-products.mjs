import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import * as ort from "onnxruntime-node";

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public/products");
const OUT = path.join(ROOT, "tmp/products-enhanced");
const BACKUP = path.join(ROOT, "tmp/products-backup");
const PROGRESS = path.join(ROOT, "tmp/extract/enhance-progress.json");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(BACKUP, { recursive: true });

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/catalog.json"), "utf8"));
const active = [...new Set(catalog.map((w) => w.image).filter(Boolean).map((u) => u.split("/").pop()))];

const sharpness = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp/extract/sharpness.json"), "utf8")).sorted;
const score = new Map(sharpness.map((x) => [path.basename(x.file), x.sharp]));
const aiSet = new Set(
  active.filter((f) => (score.get(f) ?? 9999) < 700)
);
const fastList = active.filter((f) => !aiSet.has(f));
const aiList = [...aiSet];

console.log("active", active.length, "ai", aiList.length, "fast", fastList.length);

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

let done = 0;
let failed = 0;
const total = active.length;
const writeProgress = (phase, current) => {
  fs.writeFileSync(
    PROGRESS,
    JSON.stringify({ phase, done, total, current, failed, updatedAt: new Date().toISOString() })
  );
};

async function writeFast(file, outFile) {
  await sharp(path.join(PUBLIC, file))
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .resize(1000, 1000, { kernel: "lanczos3" })
    .sharpen({ sigma: 0.7, m1: 0.6, m2: 0.2 })
    .linear(1.02, -2)
    .webp({ quality: 90, effort: 5 })
    .toFile(outFile);
}

async function main() {
  // AI pass for the haziest images
  let session = null;
  const denoise = new ort.Tensor("float16", new Uint16Array([f32ToF16(0.35)]), [1]);
  if (aiList.length) {
    session = await ort.InferenceSession.create(path.join(ROOT, "tmp/realesrgan.onnx"), {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
  }

  for (const file of aiList) {
    const outFile = path.join(OUT, file);
    try {
      const { data, info } = await sharp(path.join(PUBLIC, file))
        .flatten({ background: "#ffffff" })
        .removeAlpha()
        .resize(300, 300, { fit: "contain", background: "#ffffff" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const w = info.width;
      const h = info.height;
      const n = w * h;
      const half = new Uint16Array(3 * n);
      for (let i = 0; i < n; i++) {
        half[i] = f32ToF16(data[i * 3] / 255);
        half[n + i] = f32ToF16(data[i * 3 + 1] / 255);
        half[2 * n + i] = f32ToF16(data[i * 3 + 2] / 255);
      }
      const out = await session.run({
        input: new ort.Tensor("float16", half, [1, 3, h, w]),
        denoise_strength: denoise,
      });
      const o = out.output;
      const [, , oh, ow] = o.dims;
      const d = o.data;
      const rgb = Buffer.alloc(ow * oh * 3);
      for (let i = 0; i < ow * oh; i++) {
        rgb[i * 3] = Math.max(0, Math.min(255, Math.round(f16ToF32(d[i]) * 255)));
        rgb[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(f16ToF32(d[ow * oh + i]) * 255)));
        rgb[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(f16ToF32(d[2 * ow * oh + i]) * 255)));
      }
      await sharp(rgb, { raw: { width: ow, height: oh, channels: 3 } })
        .resize(1000, 1000, { kernel: "lanczos3" })
        .sharpen({ sigma: 0.8, m1: 0.7, m2: 0.25 })
        .linear(1.03, -3)
        .webp({ quality: 90, effort: 5 })
        .toFile(outFile);
    } catch (e) {
      failed++;
      console.log("AI FAIL", file, String(e).slice(0, 120));
      try {
        await writeFast(file, outFile);
      } catch {
        fs.copyFileSync(path.join(PUBLIC, file), outFile);
      }
    }
    done++;
    writeProgress("ai", file);
    if (done % 10 === 0) console.log(`ai ${done}/${aiList.length} (${file})`);
  }
  session?.release?.();

  // Fast sharpening for the rest
  for (const file of fastList) {
    const outFile = path.join(OUT, file);
    try {
      await writeFast(file, outFile);
    } catch (e) {
      failed++;
      console.log("FAST FAIL", file, String(e).slice(0, 120));
      try {
        fs.copyFileSync(path.join(PUBLIC, file), outFile);
      } catch {}
    }
    done++;
    writeProgress("fast", file);
    if (done % 100 === 0) console.log(`fast ${done}/${total}`);
  }

  // Backup originals, then swap enhanced images in.
  for (const file of active) {
    const source = path.join(PUBLIC, file);
    const backup = path.join(BACKUP, file);
    if (!fs.existsSync(backup)) fs.copyFileSync(source, backup);
  }
  for (const file of active) {
    const enhanced = path.join(OUT, file);
    if (fs.existsSync(enhanced)) fs.copyFileSync(enhanced, path.join(PUBLIC, file));
  }

  writeProgress("done", "");
  console.log("DONE", { done, failed, total });
}

await main();
