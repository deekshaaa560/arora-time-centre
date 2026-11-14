/**
 * Tighten a tile whose watch floats in too much white.
 *
 * The storefront gate asks that the product dominate the frame (span >= 0.6), because a
 * marketing card with a small watch beside a paragraph of copy measures clean on every
 * circular test. A supplier that photographs a watch at 55% of canvas and pads the rest
 * with white fails that test while having done nothing wrong - Bigotti Milano's whole
 * catalogue arrives like that. Re-cropping the whitespace fixes it: same pixels, same
 * watch, and it fills the card the way the rest of the shop's photos do.
 *
 *   node scripts/zoom-tiles.mjs --ids-file=tmp/still-bad.txt [--dry] [--span=0.86]
 *
 * Only rows that actually gain are written: the crop has to pass the gate the full
 * frame failed, and the watch has to be inside a plain background the trim can find.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { classifyCanvas, gateOk, isClear, scoringCanvas } from "./front-view.mjs";
import { writeJson } from "./write-json.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/myntra/brands-manifest.json");
const DRY = process.argv.includes("--dry");
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const TARGET_SPAN = Number(arg("span", "0.86"));
const MIN_SPAN = Number(arg("min-span", "0.62"));

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const ids = (arg("ids") ? arg("ids").split(",") : [])
  .concat(arg("ids-file") ? fs.readFileSync(path.join(ROOT, arg("ids-file")), "utf8").split(/\s+/) : [])
  .map((s) => s.trim())
  .filter(Boolean);
if (!ids.length) {
  console.log("usage: node scripts/zoom-tiles.mjs --ids=a,b | --ids-file=path [--dry]");
  process.exit(1);
}
const byId = new Map(catalog.map((w) => [w.id, w]));

let tightened = 0;
let skipped = 0;
for (const id of ids) {
  const w = byId.get(id);
  if (!w?.image) continue;
  const file = path.join(OUT, path.basename(w.image));
  if (!fs.existsSync(file)) continue;
  const buf = await fs.promises.readFile(file);
  const before = classifyCanvas(await scoringCanvas(buf));
  if (before.span >= MIN_SPAN) {
    skipped++;
    continue;
  }
  let cut;
  let meta;
  try {
    const flat = await sharp(buf).flatten({ background: "#ffffff" }).png().toBuffer();
    cut = await sharp(flat).trim({ threshold: 6 }).png().toBuffer();
    meta = await sharp(cut).metadata();
  } catch {
    skipped++;
    continue;
  }
  // Scale the trimmed artwork so the watch spans TARGET_SPAN of the 1000px canvas,
  // then re-centre it on white. Capped at 4x so a tiny logo in a big page screenshot is
  // not blown up into mush.
  const scale = Math.min((TARGET_SPAN * 1000) / Math.max(meta.width, meta.height), 4);
  if (scale <= 1.02) {
    skipped++;
    continue;
  }
  const grown = await sharp(cut)
    .resize(Math.round(meta.width * scale), Math.round(meta.height * scale), { fit: "inside" })
    .png()
    .toBuffer();
  const tiled = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
    .composite([{ input: grown, gravity: "center" }])
    .webp({ quality: 92, alphaQuality: 92, effort: 5 })
    .toBuffer();
  const after = classifyCanvas(await scoringCanvas(tiled));
  const gained = gateOk(after) && isClear(after) && !(gateOk(before) && isClear(before));
  if (!gained) {
    console.log(`keep ${w.id} - span ${before.span} -> ${after.span}, still ${after.reason || (isClear(after) ? "usable" : "thin")}`);
    skipped++;
    continue;
  }
  tightened++;
  console.log(
    `${DRY ? "DRY " : "TIGHTEN"} ${w.id} - span ${before.span} -> ${after.span}, radius ${before.radius} -> ${after.radius} (${before.reason || "weak"} -> ${after.front ? "front" : after.reason})`,
  );
  if (!DRY) {
    await fs.promises.writeFile(file, tiled);
    manifest[w.id] = { ...(manifest[w.id] || {}), brand: w.brand, model: w.model, front: true, tightened: `${before.span}->${after.span}` };
  }
}
if (!DRY && tightened) writeJson(MANIFEST, JSON.stringify(manifest, null, 1));
console.log(`\ntightened ${tightened} tile(s) | ${skipped} left alone`);
