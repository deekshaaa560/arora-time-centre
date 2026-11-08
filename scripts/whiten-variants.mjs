import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

/**
 * Some product photos carry a dark flattened background (unsafe cutouts).
 * Since the storefront now uses white product tiles, create "-w" variants
 * with the background re-coloured to white and point the catalog at them.
 */
const catalogPath = "src/data/catalog.json";
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const dir = path.resolve("public/products");

let created = 0;
let already = 0;
let missing = [];

for (const w of catalog) {
  if (!w.image) continue;
  const abs = path.join(dir, path.basename(w.image));
  if (!fs.existsSync(abs)) {
    missing.push(w.id);
    continue;
  }
  const meta = await sharp(abs).metadata();
  if (meta.hasAlpha) continue; // transparent cutout — white tile shows through

  const whitePath = abs.replace(/\.webp$/, "-w.webp");
  if (!fs.existsSync(whitePath)) {
    const { data, info } = await sharp(abs).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: wd, height: ht } = info;
    const px = new Uint8Array(data);
    const bg = new Uint8Array(wd * ht);
    const queue = new Int32Array(wd * ht);
    let head = 0, tail = 0;
    const isDark = (i) => {
      const o = i * 4;
      return (
        Math.abs(px[o] - 23) <= 12 &&
        Math.abs(px[o + 1] - 28) <= 12 &&
        Math.abs(px[o + 2] - 40) <= 12
      );
    };
    const push = (i) => {
      if (!bg[i] && isDark(i)) {
        bg[i] = 1;
        queue[tail++] = i;
      }
    };
    for (let x = 0; x < wd; x++) { push(x); push((ht - 1) * wd + x); }
    for (let y = 0; y < ht; y++) { push(y * wd); push(y * wd + wd - 1); }
    while (head < tail) {
      const i = queue[head++];
      const x = i % wd, y = (i / wd) | 0;
      if (x > 0) push(i - 1);
      if (x < wd - 1) push(i + 1);
      if (y > 0) push(i - wd);
      if (y < ht - 1) push(i + wd);
    }
    for (let i = 0; i < wd * ht; i++) {
      if (!bg[i]) continue;
      const o = i * 4;
      px[o] = 255; px[o + 1] = 255; px[o + 2] = 255; px[o + 3] = 255;
    }
    await sharp(Buffer.from(px), { raw: { width: wd, height: ht, channels: 4 } })
      .webp({ quality: 90, alphaQuality: 90, effort: 5 })
      .toFile(whitePath);
    created++;
  } else {
    already++;
  }
  w.image = `/products/${path.basename(whitePath)}`;
}

fs.writeFileSync(catalogPath, JSON.stringify(catalog));
fs.writeFileSync("tmp/white-variants.json", JSON.stringify({ created, already, missing }, null, 1));
console.log({ created, already, missing: missing.length, missingSample: missing.slice(0, 5) });
