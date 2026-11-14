/**
 * Final tidy-up after the photo passes: nothing on the storefront should point
 * at a photo that does not exist, and nothing should be listed at an unknown
 * price. Rows with no usable image are switched to the branded placeholder
 * (image: null), which the UI already renders; rows still without a price after
 * sourcing are dropped, because a watch cannot be shown at an unknown price.
 *
 *   node scripts/finalize-photos.mjs [--dry]
 */
import fs from "node:fs";
import { writeJson } from "./write-json.mjs";
import path from "node:path";

const ROOT = process.cwd();
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const DRY = process.argv.includes("--dry");

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const blanked = [];
const dropped = [];

const kept = catalog.filter((w) => {
  if (!w.price || w.price <= 0) {
    dropped.push(w);
    return false;
  }
  if (w.image) {
    const file = path.join(ROOT, "public", w.image.replace(/^\//, ""));
    if (!fs.existsSync(file)) {
      w = { ...w, image: null };
      blanked.push(w);
    }
  }
  delete w.needsSourcing;
  return true;
});

const byBrand = {};
for (const w of blanked) byBrand[w.brand] = (byBrand[w.brand] || 0) + 1;
const dropBy = {};
for (const w of dropped) dropBy[w.brand] = (dropBy[w.brand] || 0) + 1;

console.log(`rows ${catalog.length} -> ${kept.length}`);
console.log(`placeholder (no photo found): ${blanked.length}`, byBrand);
console.log(`dropped for unknown price: ${dropped.length}`, dropBy);
if (dropped.length) console.log(dropped.map((w) => `  ${w.brand} ${w.model} (${w.id})`).join("\n"));

if (!DRY) writeJson(CATALOG, JSON.stringify(kept, null, 1) + "\n");
fs.writeFileSync(path.join(ROOT, "tmp/finalize-photos.json"), JSON.stringify({ blanked, dropped }, null, 1));
console.log(DRY ? "(dry run, nothing written)" : `-> ${CATALOG}`);
