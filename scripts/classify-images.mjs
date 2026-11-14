/**
 * Classify every product image for "front view of the watch only":
 *  - skinFrac: model-worn lifestyle shot (face/arm skin dominance)
 *  - fullBleed: photo fills the frame (studio/model shot, not cut-out product)
 *  - flat: nearly uniform image
 * Prints per-brand counts and writes tmp/flagged-images.json
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const catalog = JSON.parse(fs.readFileSync("src/data/catalog-final.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function analyze({ data, info }) {
  const { width: W, height: H, channels: ch } = info;
  let skin = 0;
  let nonwhite = 0;
  let ringHit = 0;
  let ringN = 0;
  const R = 10;
  for (let y = 0; y < H; y++) {
    const edge = y < R || y >= H - R;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * ch;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const lum = (r * 299 + g * 587 + b * 114) / 1000;
      const isSkin = r > 95 && g > 40 && b > 20 && r > g && g >= b && r - Math.min(g, b) > 25 && Math.abs(r - g) > 12 && lum < 235;
      if (isSkin) skin++;
      if (lum < 244) nonwhite++;
      if (edge || x < R || x >= W - R) {
        ringN++;
        if (lum < 244) ringHit++;
      }
    }
  }
  return { skin: skin / (W * H), ink: nonwhite / (W * H), ring: ringHit / Math.max(1, ringN) };
}

const out = [];
const byBrand = {};
let n = 0;
for (const w of catalog) {
  const file = path.join("public/products", path.basename(w.image || ""));
  if (!w.image || !fs.existsSync(file)) continue;
  let canvas;
  try {
    canvas = await sharp(file).flatten({ background: "#ffffff" }).resize(400, 400, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  } catch {
    continue;
  }
  const a = analyze(canvas);
  n++;
  const reasons = [];
  if (a.skin > 0.1) reasons.push("model/skin");
  if (a.ring > 0.45) reasons.push("full-bleed photo");
  if (a.ink > 0.9) reasons.push("no background");
  if (reasons.length) {
    out.push({ id: w.id, brand: w.brand, model: w.model, ...a, reasons });
    byBrand[w.brand] ??= { total: 0, flagged: 0 };
  }
  byBrand[w.brand] ??= { total: 0, flagged: 0 };
  byBrand[w.brand].total++;
  if (reasons.length) byBrand[w.brand].flagged++;
  if (n % 400 === 0) console.log(`...${n}`);
  await sleep(0);
}
fs.writeFileSync("tmp/flagged-images.json", JSON.stringify(out, null, 1));
console.table(byBrand);
console.log("total scanned", n, "flagged", out.length);
