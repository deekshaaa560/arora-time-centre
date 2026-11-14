/**
 * Rank live product photos by how likely they are to be a person, a box or a
 * cluttered scene rather than the watch alone, using the shared front-view
 * detector (scripts/front-view.mjs). The list is the to-do sheet for sourcing a
 * clean front shot from another site.
 *
 *   node scripts/find-non-watch-frames.mjs [--brands="Titan,Fastrack"] [--top=40]
 */
import fs from "node:fs";
import path from "node:path";
import { classifyImage } from "./front-view.mjs";

const ROOT = process.cwd();
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/catalog-final.json"), "utf8"));
const brands = (arg("brands", "") || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const rows = [];
let n = 0;
for (const w of catalog) {
  if (brands.length && !brands.includes(String(w.brand).toLowerCase())) continue;
  if (!w.image) continue;
  const file = path.join(ROOT, "public", w.image.replace(/^\//, ""));
  if (!fs.existsSync(file)) continue;
  try {
    const c = await classifyImage(await fs.promises.readFile(file));
    rows.push({ id: w.id, brand: w.brand, model: w.model, image: w.image, ...c });
  } catch {
    /* unreadable */
  }
  n++;
  if (n % 200 === 0) console.log(`  ${n} scanned`);
}

// Anything the detector is not happy with, worst first: model shots and clutter
// lead, then profiles and frames with no readable dial.
const weight = (r) => (r.front ? 0 : 1) + (r.modelRisk ? 1 : 0) + (r.cluttered ? 0.5 : 0) + (1 - r.frontScore);
rows.sort((a, b) => weight(b) - weight(a));
const top = Number(arg("top", 40));
console.log(`\ntop ${top} suspects of ${rows.length} scanned:`);
console.log(
  rows
    .slice(0, top)
    .map(
      (r) =>
        `${String(r.id).padEnd(30)} ${String(r.brand).padEnd(16)} ${String(r.reason || "ok").padEnd(14)} s=${String(r.frontScore).padEnd(5)} skin=${r.skinFrac}/${r.skinTex} objs=${r.objects} area=${r.areaFrac} clean=${r.clean}`,
    )
    .join("\n"),
);
fs.writeFileSync(path.join(ROOT, "tmp/frame-scan.json"), JSON.stringify(rows, null, 1));
console.log("\n-> tmp/frame-scan.json (re-render sheets with scripts/audit-front-view.mjs --review)");
