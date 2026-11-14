/**
 * Record that a person looked at the photo a row is already using and approved it.
 *
 * The audit scores dial evidence, and a pale rose or mother-of-pearl dial measures
 * weak while being unambiguously the watch facing the lens. Left unmarked, the next
 * automated pass re-sources such a row and is free to install something that scores
 * better and shows a different watch entirely - which is what happened to Michael Kors
 * MK7602, whose rose bangle was replaced with a green chronograph because the model code
 * matched somewhere on the page it was scraped from.
 *
 *   node scripts/mark-picked.mjs --ids=michael-kors-mk7602,michael-kors-mk4907 [--dry]
 *
 * Writes `picked: "eye"` into the brands manifest, which is what the audit, the gallery
 * repair and the web sourcing all read before touching a frame again.
 */
import fs from "node:fs";
import path from "node:path";
import { writeJson } from "./write-json.mjs";

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, "tmp/stock-2026/myntra/brands-manifest.json");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const DRY = process.argv.includes("--dry");
const arg = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};

const ids = (arg("ids") ? arg("ids").split(",") : [])
  .concat(arg("ids-file") ? fs.readFileSync(path.join(ROOT, arg("ids-file")), "utf8").split(/\s+/) : [])
  .map((s) => s.trim())
  .filter(Boolean);
if (!ids.length) {
  console.log("usage: node scripts/mark-picked.mjs --ids=a,b,c");
  process.exit(1);
}

const catalog = new Map(JSON.parse(fs.readFileSync(CATALOG, "utf8")).map((w) => [w.id, w]));
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
let marked = 0;
for (const id of ids) {
  const w = catalog.get(id);
  if (!w) {
    console.log(`SKIP ${id} (no such row)`);
    continue;
  }
  manifest[id] = { ...(manifest[id] || {}), brand: w.brand, model: w.model, front: true, picked: "eye" };
  marked++;
  console.log(`EYE  ${id.padEnd(28)} ${w.brand} ${w.model} kept as-is (${w.image})`);
}
if (marked && !DRY) writeJson(MANIFEST, JSON.stringify(manifest, null, 1));
console.log(`\n${DRY ? "would mark" : "marked"} ${marked}/${ids.length} as eye-approved`);
