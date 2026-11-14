/**
 * Take watches off the storefront by hand - the shop stopped carrying them, or the
 * only frames anyone can find show the back or the side and the customer should not
 * see them. Unlike finalize-photos.mjs, which drops rows for want of a price, this
 * is a decision, so the ids go into a ledger that the restore passes respect:
 * nothing re-adds a watch the shop removed on purpose.
 *
 *   node scripts/remove-rows.mjs --ids=michael-kors-mk7615,michael-kors-mk7543 [--drop-images] [--dry]
 *   node scripts/remove-rows.mjs --ids-file=tmp/gone.txt --drop-images
 *
 * Removed rows are kept in tmp/removed-rows.json (so they can be put back with
 * scripts/restore-dropped-rows.mjs --ids=... if that was a mistake) and their ids
 * are appended to tmp/removed-rows.txt.
 */
import fs from "node:fs";
import path from "node:path";
import { writeJson } from "./write-json.mjs";

const ROOT = process.cwd();
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const LEDGER = path.join(ROOT, "tmp/removed-rows.txt");
const ARCHIVE = path.join(ROOT, "tmp/removed-rows.json");
const OUT = path.join(ROOT, "public/products");
const DRY = process.argv.includes("--dry");
const dropImages = process.argv.includes("--drop-images");
const arg = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};

const ids = new Set(
  (arg("ids") ? arg("ids").split(",") : [])
    .concat(arg("ids-file") ? fs.readFileSync(path.join(ROOT, arg("ids-file")), "utf8").split(/\s+/) : [])
    .map((s) => s.trim())
    .filter(Boolean),
);
if (!ids.size) {
  console.log("nothing to remove: pass --ids=a,b or --ids-file=path");
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const gone = catalog.filter((w) => ids.has(w.id));
const missing = [...ids].filter((id) => !catalog.some((w) => w.id === id));

console.log(`catalogue ${catalog.length} rows | removing ${gone.length}${DRY ? " (dry)" : ""}`);
for (const w of gone) console.log(`  ${w.id.padEnd(28)} ${w.brand} ${w.model} ${w.gender} Rs${w.price} ${w.image || "no photo"}`);
if (missing.length) console.log(`not in the catalogue: ${missing.join(", ")}`);

if (!DRY && gone.length) {
  const kept = catalog.filter((w) => !ids.has(w.id));
  writeJson(CATALOG, JSON.stringify(kept, null, 1) + "\n");

  const archive = fs.existsSync(ARCHIVE) ? JSON.parse(fs.readFileSync(ARCHIVE, "utf8")) : [];
  const known = new Set(archive.map((w) => w.id));
  writeJson(ARCHIVE, JSON.stringify(archive.concat(gone.filter((w) => !known.has(w.id))), null, 1));

  const ledger = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, "utf8").split(/\s+/).filter(Boolean) : [];
  writeJson(LEDGER, [...new Set(ledger.concat(gone.map((w) => w.id)))].join("\n") + "\n");

  if (dropImages) {
    let files = 0;
    for (const w of gone) {
      if (!w.image) continue;
      const f = path.join(OUT, path.basename(w.image));
      // Only if no remaining row still points at it.
      if (fs.existsSync(f) && !kept.some((k) => k.image && path.basename(k.image) === path.basename(w.image))) {
        fs.rmSync(f);
        files++;
      }
    }
    console.log(`deleted ${files} now-unused photo file(s)`);
  }
  console.log(`-> ${kept.length} rows | ledger ${LEDGER} | archive ${ARCHIVE}`);
}
