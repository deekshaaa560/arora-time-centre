import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const CARD_BG = { r: 23, g: 28, b: 40 }; // midnight-champagne card colour

async function cutout(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const px = new Uint8Array(data);
  const removed = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const isBg = (i) => {
    const o = i * c;
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
    // Risky cutout (white strap touching the edge): paint bg to card colour
    for (let i = 0; i < w * h; i++) {
      if (!removed[i]) continue;
      const o = i * c;
      px[o] = CARD_BG.r;
      px[o + 1] = CARD_BG.g;
      px[o + 2] = CARD_BG.b;
      px[o + 3] = 255;
    }
    const out = await sharp(Buffer.from(px), { raw: { width: w, height: h, channels: c } })
      .webp({ quality: 90, effort: 5 })
      .toBuffer();
    return { mode: "recolored", fraction, out };
  }

  for (let i = 0; i < w * h; i++) {
    if (removed[i]) px[i * c + 3] = 0;
  }
  // soften the 1px fringe so no white halo remains on dark cards
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (removed[i]) continue;
      if (removed[i - 1] || removed[i + 1] || removed[i - w] || removed[i + w]) {
        const o = i * c;
        if (Math.min(px[o], px[o + 1], px[o + 2]) > 200) {
          px[o + 3] = Math.round(px[o + 3] * 0.35);
        }
      }
    }
  }

  const out = await sharp(Buffer.from(px), { raw: { width: w, height: h, channels: c } })
    .webp({ quality: 90, alphaQuality: 90, effort: 5 })
    .toBuffer();
  return { mode: "alpha", fraction, out };
}

const dir = path.resolve("public/products");
const outDir = path.resolve("tmp/products-out");
fs.mkdirSync(outDir, { recursive: true });
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".webp"));
let alpha = 0, recolored = 0, failed = 0;
const rejected = [];

for (const f of files) {
  try {
    const r = await cutout(path.join(dir, f));
    fs.writeFileSync(path.join(outDir, f), r.out);
    if (r.mode === "alpha") alpha++;
    else {
      recolored++;
      rejected.push(f);
    }
  } catch (e) {
    failed++;
    console.log("FAIL", f, String(e).slice(0, 100));
  }
}

console.log({ alpha, recolored, failed, total: files.length });
fs.writeFileSync("tmp/extract/recolored-images.json", JSON.stringify(rejected, null, 1));
