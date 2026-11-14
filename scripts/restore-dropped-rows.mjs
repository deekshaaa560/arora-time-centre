/**
 * finalize-photos.mjs drops a row when no source anywhere quotes a price, because
 * a watch cannot be sold at Rs 0 - but the drop is often premature: the price
 * lookup may have been throttled, or the store that carries the code is added
 * later. finalize leaves the full rows in tmp/finalize-photos.json, so this puts
 * back whatever is missing and marks it for the price and photo passes to retry.
 *
 *   node scripts/restore-dropped-rows.mjs [--dry]
 *
 * A restored row keeps the photo that was on disk when it was dropped (the file is
 * still there), and is left at price 0 so reprice-placeholder-rows.mjs and
 * source-front-online.mjs pick it up again. Run this, then those two, then finalize
 * again: only rows that are still unquotable disappear a second time.
 */
import fs from "node:fs";
import { writeJson } from "./write-json.mjs";
import path from "node:path";

const ROOT = process.cwd();
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const DROPPED = path.join(ROOT, "tmp/finalize-photos.json");
const OUT = path.join(ROOT, "public/products");
const DRY = process.argv.includes("--dry");

if (!fs.existsSync(DROPPED)) {
  console.log("nothing to restore:", DROPPED, "does not exist");
  process.exit(0);
}
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const have = new Set(catalog.map((w) => w.id));
const { dropped = [] } = JSON.parse(fs.readFileSync(DROPPED, "utf8"));
// Rows already retried and still unquotable. Without this the two scripts would
// argue forever: finalize drops a watch nobody prices, this restores it, finalize
// drops it again. --force ignores the ledgers.
// tmp/removed-rows.txt is a stronger no: those are watches the shop took off the
// storefront deliberately (scripts/remove-rows.mjs), not watches that failed a test.
const LEDGER = path.join(ROOT, "tmp/unpriceable.txt");
const REMOVED = path.join(ROOT, "tmp/removed-rows.txt");
const readLedger = (f) =>
  fs.existsSync(f)
    ? fs
        .readFileSync(f, "utf8")
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
const knownBad = process.argv.includes("--force") ? new Set() : new Set([...readLedger(LEDGER), ...readLedger(REMOVED)]);

const restore = [];
const skipped = [];
const photoless = [];
for (const row of dropped) {
  if (have.has(row.id)) continue;
  if (knownBad.has(row.id)) {
    skipped.push(row.id);
    continue;
  }
  const w = { ...row };
  delete w.needsSourcing;
  // Which file is this row's photo now? The recorded path first, then the
  // conventional name, because a sourcing pass may have replaced the file.
  const candidates = [w.image && path.basename(w.image), `${w.id}.webp`].filter(Boolean);
  const file = candidates.find((f) => fs.existsSync(path.join(OUT, f)));
  if (file) {
    w.image = `/products/${file}`;
  } else {
    w.image = null;
    photoless.push(w.id);
  }
  if (!w.price || w.price <= 0) w.needsSourcing = true;
  restore.push(w);
}

console.log(
  `dropped on record: ${dropped.length} | missing from catalogue: ${restore.length} | already retried and unpriceable: ${skipped.length}${DRY ? " (dry)" : ""}`,
);
if (skipped.length) console.log(`  skipped: ${skipped.join(", ")}`);
for (const w of restore.slice(0, 40))
  console.log(`  ${w.id.padEnd(30)} ${String(w.brand).padEnd(18)} ${String(w.model).padEnd(14)} Rs${w.price} ${w.image || "no photo"}`);
if (restore.length > 40) console.log(`  ... and ${restore.length - 40} more`);

if (!DRY && restore.length) {
  // Every restored row is picked up again by reprice-placeholder-rows.mjs and
  // source-front-online.mjs; the next finalize pass drops only the ones that are
  // still unquotable, so a throttled lookup no longer costs the customer a watch.
  writeJson(CATALOG, JSON.stringify(pruneRemoved(catalog.concat(restore)), null, 1) + "\n");
  console.log(`\nrestored ${restore.length} rows -> src/data/catalog-final.json (${catalog.length + restore.length} total)`);
  if (photoless.length) console.log(`no photo on disk for: ${photoless.join(", ")} (needs online sourcing)`);
  fs.writeFileSync(path.join(ROOT, "tmp/restored-rows.txt"), restore.map((w) => w.id).join("\n") + "\n");
}
