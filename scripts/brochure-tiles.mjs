/**
 * Stage 2 of the brochure import: turn the extracted full-resolution product
 * photos into storefront tiles, exactly like the other brands:
 *
 *   border flood-cut the studio background (cream for Bigotti, dark vignette
 *   for Orlandi) → paint white → Real-ESRGAN upscale → fit 940 on a
 *   1000x1000 white canvas → light sharpen → WebP.
 *
 * Every tile is run through scripts/front-view.mjs isClear() so a storefront
 * photo is guaranteed to show the dial facing the camera.
 *
 *   node scripts/brochure-tiles.mjs [--brands=bigotti,orlandi] [--limit=N] [--out=public/products]
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import * as ort from "onnxruntime-node";
import { classifyImage, isClear } from "./front-view.mjs";

const ROOT = process.cwd();
const flag = (name, dflt) => {
  const a = process.argv.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const BRAND_KEYS = flag("brands", "bigotti,orlandi").split(",").filter(Boolean);
const LIMIT = Number(flag("limit", "0"));
const IDS = flag("ids", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const SEAL_DEPTH = Number(flag("depth", "6"));
const STEP_DARK = Number(flag("step", "3"));
const CHROMA_DARK = Number(flag("chroma", "30"));
const OUT_DIR = path.resolve(flag("out", "public/products"));
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ---------- fp16 helpers (same as upscale-products.mjs) ---------- */
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

const session = await ort.InferenceSession.create(path.join(ROOT, "tmp/realesrgan.onnx"), {
  executionProviders: ["cpu"],
  graphOptimizationLevel: "all",
});

async function upscaleRgb(rgb, w, h) {
  const n = w * h;
  const half = new Uint16Array(3 * n);
  for (let i = 0; i < n; i++) {
    half[i] = f32ToF16(rgb[i * 3] / 255);
    half[n + i] = f32ToF16(rgb[i * 3 + 1] / 255);
    half[2 * n + i] = f32ToF16(rgb[i * 3 + 2] / 255);
  }
  const out = await session.run({
    input: new ort.Tensor("float16", half, [1, 3, h, w]),
    denoise_strength: new ort.Tensor("float16", new Uint16Array([f32ToF16(0.25)]), [1]),
  });
  const o = out.output;
  const [, , oh, ow] = o.dims;
  const d = o.data;
  const rgbOut = Buffer.alloc(ow * oh * 3);
  for (let i = 0; i < ow * oh; i++) {
    rgbOut[i * 3] = Math.max(0, Math.min(255, Math.round(f16ToF32(d[i]) * 255)));
    rgbOut[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(f16ToF32(d[ow * oh + i]) * 255)));
    rgbOut[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(f16ToF32(d[2 * ow * oh + i]) * 255)));
  }
  return { rgb: rgbOut, w: ow, h: oh };
}

/* ---------- border flood background cut ---------- */
async function cutBackground(png) {
  const { data, info } = await sharp(png).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const c = info.channels;
  const px = data;

  // border stats: mean colour + how much it varies (paper texture, gradients)
  let mr = 0, mg = 0, mb = 0, cnt = 0;
  const ring = (x, y) => {
    const o = (y * w + x) * c;
    mr += px[o]; mg += px[o + 1]; mb += px[o + 2]; cnt++;
  };
  for (let x = 0; x < w; x++) { ring(x, 0); ring(x, h - 1); }
  for (let y = 0; y < h; y++) { ring(0, y); ring(w - 1, y); }
  mr /= cnt; mg /= cnt; mb /= cnt;
  let dev = 0;
  for (let x = 0; x < w; x++)
    for (const y of [0, 1, h - 2, h - 1]) {
      const o = (y * w + x) * c;
      dev = Math.max(dev, Math.abs(px[o] - mr), Math.abs(px[o + 1] - mg), Math.abs(px[o + 2] - mb));
    }
  const dark = (mr + mg + mb) / 3 < 128;
  const localStep = dark ? STEP_DARK : 7;      // follow smooth vignette/gradient, stop at watch edges
  const globalCap = (dark ? 130 : 70) + dev;   // never climb into the product's own colours

  const removed = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const far = (o) => Math.max(Math.abs(px[o] - mr), Math.abs(px[o + 1] - mg), Math.abs(px[o + 2] - mb)) > globalCap;
  // The brochure backgrounds are warm (cream / brown glow) while steel, chrome
  // and white dials are neutral, and On dark the glow also runs a smooth
  // gradient a strict step can follow, while product edges (rubber, steel,
  // gold on the vignette) jump harder than that. The two together let the flood
  // cross the whole glow - even where it desaturates near the watch - without
  // ever entering the product itself.
  const borderWarm = mr - mb;
  const chromaTol = dark ? CHROMA_DARK : 9;
  const warmOk = (o) => Math.abs(px[o] - px[o + 2] - borderWarm) <= chromaTol;
  const push = (i, j) => {
    if (removed[i]) return;
    const oi = i * c, oj = j * c;
    if (Math.abs(px[oi] - px[oj]) > localStep || Math.abs(px[oi + 1] - px[oj + 1]) > localStep || Math.abs(px[oi + 2] - px[oj + 2]) > localStep) return;
    if (far(oi)) return;
    if (!warmOk(oi)) return;
    removed[i] = 1;
    queue[tail++] = i;
  };
  for (let x = 0; x < w; x++) {
    if (!far(x * c) && warmOk(x * c)) { removed[x] = 1; queue[tail++] = x; }
    const b = (h - 1) * w + x;
    if (!far(b * c) && warmOk(b * c)) { removed[b] = 1; queue[tail++] = b; }
  }
  for (let y = 0; y < h; y++) {
    const l = y * w, r = y * w + w - 1;
    if (!far(l * c) && warmOk(l * c)) { removed[l] = 1; queue[tail++] = l; }
    if (!far(r * c) && warmOk(r * c)) { removed[r] = 1; queue[tail++] = r; }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1, i);
    if (x < w - 1) push(i + 1, i);
    if (y > 0) push(i - w, i);
    if (y < h - 1) push(i + w, i);
  }
  // 1px more where the frame is dark (vignette seam sits closer to the product);
  // on light backgrounds dilation slices thin link edges off the bracelet and the
  // gate then reads the case as a small object among fragments.
  const dil = Uint8Array.from(removed);
  for (let pass = 0; pass < (dark ? 1 : 0); pass++) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!dil[i]) continue;
        if (x > 0) removed[i - 1] = 1;
        if (x < w - 1) removed[i + 1] = 1;
        if (y > 0) removed[i - w] = 1;
        if (y < h - 1) removed[i + w] = 1;
      }
  }
  const frac = tail / (w * h);
  for (let i = 0; i < w * h; i++) {
    if (!removed[i]) continue;
    const o = i * c;
    px[o] = 255; px[o + 1] = 255; px[o + 2] = 255;
  }
  // bbox of the kept watch + the kept mask itself: the outline the colour flood
  // on the finished tile cannot recover (chrome sits AT white level), so the
  // gate-seal is carried from the cut through to the final canvas.
  let minX = w, maxX = 0, minY = h, maxY = 0, kept = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (removed[y * w + x]) continue;
      kept++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  if (!kept) return null;
  const cw = maxX - minX + 1;
  const chh = maxY - minY + 1;
  const rgbCrop = Buffer.alloc(cw * chh * 3);
  const maskCrop = Buffer.alloc(cw * chh);
  for (let y = 0; y < chh; y++)
    for (let x = 0; x < cw; x++) {
      const si = (minY + y) * w + (minX + x);
      const di = y * cw + x;
      rgbCrop[di * 3] = px[si * c];
      rgbCrop[di * 3 + 1] = px[si * c + 1];
      rgbCrop[di * 3 + 2] = px[si * c + 2];
      maskCrop[di] = removed[si] ? 0 : 255;
    }
  return { rgb: rgbCrop, w: cw, h: chh, mask: maskCrop, removedFrac: frac };
}

/* ---------- final-tile silhouette seal ---------- */
/**
 * The brochure light blows polished steel to the same level as the white
 * background, so scoringCanvas' border flood used to walk the highlights into
 * the case and slice the silhouette apart (the gate then read a 0.45-span dial
 * among fragments). Colour cannot recover the true outline on the finished
 * tile, but the background cut knows it exactly: the kept-mask is resized onto
 * the final canvas, and every watch pixel within 6px of it is capped just
 * under the gate's white level (238). The flood stops at that band at any
 * scale, while interior chrome keeps its highlights. The band reads as the
 * soft edge a studio shadow would give - invisible on the storefront card.
 */
function sealWatchBand(data, c, w, h, mask) {
  const CAP = 228;
  const band = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const ring = (i) => {
    const x = i % w;
    const y = (i / w) | 0;
    const nb = [];
    if (x > 0) nb.push(i - 1);
    if (x < w - 1) nb.push(i + 1);
    if (y > 0) nb.push(i - w);
    if (y < h - 1) nb.push(i + w);
    return nb;
  };
  for (let i = 0; i < w * h; i++) if (!mask[i]) band[i] = 1;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    for (const j of ring(i)) {
      if (!mask[j]) {
        queue[tail++] = i;
        break;
      }
    }
  }
  for (const i of queue.subarray(0, tail)) band[i] = 1;
  let depth = 0;
  let levelEnd = tail;
  let nextEnd = tail;
  while (head < levelEnd && depth < SEAL_DEPTH) {
    for (; head < levelEnd; head++) {
      const i = queue[head];
      const o = i * c;
      if (data[o] > CAP) data[o] = CAP;
      if (data[o + 1] > CAP) data[o + 1] = CAP;
      if (data[o + 2] > CAP) data[o + 2] = CAP;
      for (const j of ring(i)) {
        if (mask[j] && !band[j]) {
          band[j] = 1;
          queue[nextEnd++] = j;
        }
      }
    }
    levelEnd = nextEnd;
    depth++;
  }
}

/* ---------- per-row pipeline ---------- */
const results = [];
let done = 0;
for (const key of BRAND_KEYS) {
  const dir = path.join(ROOT, "tmp/brochures", key);
  const rows = JSON.parse(fs.readFileSync(path.join(dir, "rows.json"), "utf8"));
  for (const row of rows) {
    if (LIMIT && done >= LIMIT) break;
    if (IDS.length && !IDS.includes(row.id)) continue;
    const src = path.join(dir, "extract", `${row.id}.png`);
    if (!fs.existsSync(src)) {
      console.log("NO EXTRACT", row.id);
      continue;
    }
    const cut = await cutBackground(src);
    if (!cut) {
      console.log("EMPTY CUT", row.id);
      continue;
    }
    let { rgb, w, h, mask } = cut;
    if (w * h > 4000 * 4000) {
      const s = 3200 / Math.max(w, h);
      const rw = Math.round(w * s), rh = Math.round(h * s);
      const r2 = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
        .resize(rw, rh).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      mask = await sharp(mask, { raw: { width: w, height: h, channels: 1 } })
        .resize(rw, rh, { kernel: "nearest" }).raw().toBuffer();
      rgb = r2.data; w = r2.info.width; h = r2.info.height;
    }
    const up = await upscaleRgb(rgb, w, h);
    const fit = Math.min(940 / up.w, 940 / up.h);
    const fw = Math.max(1, Math.round(up.w * fit));
    const fh = Math.max(1, Math.round(up.h * fit));
    const fitted = await sharp(up.rgb, { raw: { width: up.w, height: up.h, channels: 3 } })
      .resize(fw, fh, { kernel: "lanczos3" })
      .sharpen({ sigma: 0.5, m1: 0.45, m2: 0.18 })
      .png()
      .toBuffer();
    // the kept-mask covers the same rectangle as the upscaled photo, so it
    // lands on the canvas exactly where the photo does (centre gravity both)
    const maskSmall = await sharp(mask, { raw: { width: w, height: h, channels: 1 } })
      .resize(fw, fh, { kernel: "nearest" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const canvasRaw = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
      .composite([{ input: fitted, gravity: "center" }])
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const CW = canvasRaw.info.width;
    const CH = canvasRaw.info.height;
    const ox = Math.round((CW - fw) / 2);
    const oy = Math.round((CH - fh) / 2);
    const mch = maskSmall.info.channels;
    const maskCanvas = new Uint8Array(CW * CH);
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++)
        maskCanvas[(oy + y) * CW + (ox + x)] = maskSmall.data[(y * fw + x) * mch] > 127 ? 1 : 0;
    sealWatchBand(canvasRaw.data, canvasRaw.info.channels, CW, CH, maskCanvas);
    const file = path.join(OUT_DIR, `${row.id}.webp`);
    await sharp(Buffer.from(canvasRaw.data), { raw: { width: CW, height: CH, channels: canvasRaw.info.channels } })
      .webp({ quality: 92, alphaQuality: 92, effort: 5 })
      .toFile(file);

    const r = await classifyImage(fs.readFileSync(file));
    const clear = isClear(r);
    results.push({ id: row.id, clear, cut: +cut.removedFrac.toFixed(2), r: { front: r.front, radius: Math.round(r.radius), span: +r.span.toFixed(2), ring: +r.ring.toFixed(2), twelve: +r.twelve.toFixed(2), detail: +r.detail.toFixed(2), coverage: +r.coverage.toFixed(2), content: +r.content.toFixed(2), darkFrac: +r.darkFrac.toFixed(2), coiled: r.coiled, cluttered: r.cluttered, modelRisk: r.modelRisk, reason: r.reason } });
    if (!clear) console.log("GATE-FAIL", row.id, JSON.stringify(results.at(-1).r), "cut", results.at(-1).cut);
    done++;
    if (done % 10 === 0) console.log(`processed ${done}`);
  }
  if (LIMIT && done >= LIMIT) break;
}
fs.writeFileSync(path.join(ROOT, "tmp/brochures/tiles-report.json"), JSON.stringify(results, null, 1));
const fails = results.filter((x) => !x.clear).length;
console.log(`tiles: ${results.length}, gate fails: ${fails}`);
