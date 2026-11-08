import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import * as ort from "onnxruntime-node";

const require = createRequire(import.meta.url);
const pdfjsPath = path.dirname(require.resolve("pdfjs-dist/package.json"));
const pdfjs = await import(
  "file://" + path.join(pdfjsPath, "legacy/build/pdf.mjs").replace(/\\/g, "/")
);
const { getDocument, OPS } = pdfjs;

const CARD_BG = { r: 23, g: 28, b: 40 };
const OUT_DIR = path.resolve("tmp/products-ai");
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ---------- float16 helpers ---------- */
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

/* ---------- background cutout ---------- */
async function cutoutRgb(rgb, w, h) {
  // Build RGBA from RGB for alpha handling
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = rgb[i * 3];
    px[i * 4 + 1] = rgb[i * 3 + 1];
    px[i * 4 + 2] = rgb[i * 3 + 2];
    px[i * 4 + 3] = 255;
  }
  const removed = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const isBg = (i) => {
    const o = i * 4;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mn >= 243 && mx - mn <= 10;
  };
  const push = (i) => {
    if (!removed[i] && isBg(i)) {
      removed[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  const fraction = tail / (w * h);
  if (fraction > 0.82) {
    for (let i = 0; i < w * h; i++) {
      if (!removed[i]) continue;
      const o = i * 4;
      px[o] = CARD_BG.r;
      px[o + 1] = CARD_BG.g;
      px[o + 2] = CARD_BG.b;
    }
    return { out: px, mode: "recolored" };
  }
  for (let i = 0; i < w * h; i++) if (removed[i]) px[i * 4 + 3] = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (removed[i]) continue;
      if (removed[i - 1] || removed[i + 1] || removed[i - w] || removed[i + w]) {
        const o = i * 4;
        if (Math.min(px[o], px[o + 1], px[o + 2]) > 200) px[o + 3] = Math.round(px[o + 3] * 0.35);
      }
    }
  }
  return { out: px, mode: "alpha" };
}

/* ---------- load rows + model ---------- */
const rows = JSON.parse(fs.readFileSync("tmp/extract/products.json", "utf8"));
const slug = (r) => `${r.brand.toLowerCase()}-${r.code.toLowerCase()}`;

const session = await ort.InferenceSession.create("tmp/realesrgan.onnx", {
  executionProviders: ["cpu"],
  graphOptimizationLevel: "all",
});

const sheets = {
  fastrack: "C:/Users/Sych-win/Downloads/CFA FASTRACK IMAGE STK SHEET 211026.pdf",
  titan: "C:/Users/Sych-win/Downloads/CFA TITAN IMAGE STK SHEET  211026.pdf",
  bdb: "C:/Users/Sych-win/Downloads/BDB Stock 27Oct.pdf",
};

const progressFile = "tmp/upscale-progress.json";
const started = Date.now();
const LIMIT = Number(process.env.LIMIT || 0);
let done = 0;
let total = 0;
for (const r of rows) total++;
if (LIMIT) total = LIMIT;

for (const [sheet, file] of Object.entries(sheets)) {
  const byPage = new Map();
  for (const r of rows.filter((x) => x.sheet === sheet)) {
    if (!byPage.has(r.page)) byPage.set(r.page, []);
    byPage.get(r.page).push(r);
  }
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;

  for (let p = 0; p < doc.numPages; p++) {
    const pageRows = byPage.get(p + 1);
    if (!pageRows) continue;
    const page = await doc.getPage(p + 1);
    const ops = await page.getOperatorList();
    const names = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === OPS.paintImageXObject) names.push(ops.argsArray[i][0]);
    }
    if (names.length !== pageRows.length) {
      // page numbering mismatch handled by catalog builder (no photos used)
      continue;
    }

    for (let k = 0; k < names.length; k++) {
      const img = await new Promise((res) => page.objs.get(names[k], res));
      if (!img || !img.width) continue;
      const channels = img.data.length / (img.width * img.height);
      const src = await sharp(Buffer.from(img.data), {
        raw: { width: img.width, height: img.height, channels },
      })
        .trim({ threshold: 12 })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const w = src.info.width;
      const h = src.info.height;
      const n = w * h;
      const half = new Uint16Array(3 * n);
      for (let i = 0; i < n; i++) {
        half[i] = f32ToF16(src.data[i * 3] / 255);
        half[n + i] = f32ToF16(src.data[i * 3 + 1] / 255);
        half[2 * n + i] = f32ToF16(src.data[i * 3 + 2] / 255);
      }

      const out = await session.run({
        input: new ort.Tensor("float16", half, [1, 3, h, w]),
        denoise_strength: new ort.Tensor("float16", new Uint16Array([f32ToF16(0.35)]), [1]),
      });
      const o = out.output;
      const [, , oh, ow] = o.dims;
      const data = o.data;
      const rgb = Buffer.alloc(ow * oh * 3);
      for (let i = 0; i < ow * oh; i++) {
        rgb[i * 3] = Math.max(0, Math.min(255, Math.round(f16ToF32(data[i]) * 255)));
        rgb[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(f16ToF32(data[ow * oh + i]) * 255)));
        rgb[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(f16ToF32(data[2 * ow * oh + i]) * 255)));
      }

      const inner = await sharp(rgb, { raw: { width: ow, height: oh, channels: 3 } })
        .resize({ width: 546, height: 546, fit: "inside", kernel: "lanczos3" })
        .sharpen({ sigma: 0.6, m1: 0.6, m2: 0.2 })
        .png()
        .toBuffer();

      const tile = await sharp({
        create: { width: 600, height: 600, channels: 3, background: { r: 255, g: 255, b: 255 } },
      })
        .composite([{ input: inner, gravity: "center" }])
        .flatten({ background: "#ffffff" })
        .removeAlpha()
        .raw()
        .toBuffer();

      const cut = await cutoutRgb(tile, 600, 600);
      await sharp(cut.out, { raw: { width: 600, height: 600, channels: 4 } })
        .webp({ quality: 90, alphaQuality: 90, effort: 4 })
        .toFile(path.join(OUT_DIR, slug(pageRows[k]) + ".webp"));

      done++;
      if (LIMIT && done >= LIMIT) {
        fs.writeFileSync(progressFile, JSON.stringify({ done, total, finished: true }));
        console.log("LIMIT reached", done);
        process.exit(0);
      }
      if (done % 10 === 0) {
        const elapsed = (Date.now() - started) / 1000;
        fs.writeFileSync(
          progressFile,
          JSON.stringify({ done, total, elapsedSec: Math.round(elapsed), perImageSec: +(elapsed / done).toFixed(2) }),
        );
        console.log(`done ${done}/${total} (${(elapsed / done).toFixed(2)}s/img)`);
      }
    }
    page.cleanup?.();
  }
  doc.destroy?.();
  console.log(`${sheet} complete — ${done}/${total}`);
}

fs.writeFileSync(progressFile, JSON.stringify({ done, total, finished: true }));
console.log("ALL DONE", done);
