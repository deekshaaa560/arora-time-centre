import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

/**
 * Some product photos were flattened onto the old dark card colour because a
 * flood-fill cutout was unsafe (white straps). With the storefront now using
 * white product tiles, re-colour those backgrounds to pure white.
 */
const dir = path.resolve("public/products");
const DARK = { r: 23, g: 28, b: 40 };
let fixed = 0;
let skipped = 0;

for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".webp")) continue;
  const file = path.join(dir, f);
  const meta = await sharp(file).metadata();
  if (meta.hasAlpha) {
    skipped++;
    continue;
  }
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = new Uint8Array(data);
  const removed = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;

  const isBg = (i) => {
    const o = i * 4;
    return (
      Math.abs(px[o] - DARK.r) <= 12 &&
      Math.abs(px[o + 1] - DARK.g) <= 12 &&
      Math.abs(px[o + 2] - DARK.b) <= 12
    );
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

  for (let i = 0; i < w * h; i++) {
    if (!removed[i]) continue;
    const o = i * 4;
    px[o] = 255;
    px[o + 1] = 255;
    px[o + 2] = 255;
    px[o + 3] = 255;
  }

  const tmp = file + ".tmp.webp";
  await sharp(Buffer.from(px), { raw: { width: w, height: h, channels: 4 } })
    .webp({ quality: 90, alphaQuality: 90, effort: 5 })
    .toFile(tmp);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      fs.rmSync(file, { force: true });
      fs.renameSync(tmp, file);
      ok = true;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  if (ok) {
    fixed++;
  } else {
    fs.rmSync(tmp, { force: true });
    console.log("could not replace", f);
  }
}

console.log({ fixed, skipped });
