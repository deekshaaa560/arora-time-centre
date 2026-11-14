/**
 * Which photo each homepage hero tile shows, and whether that is a clean front
 * view of the watch. The strip is FEATURED in src/data/watches.ts - the priciest
 * in-stock piece per brand and gender - so this is exactly what a visitor sees
 * first, which is why a box or a case back here is worth more than twenty
 * elsewhere.
 *
 * The selection is not hardcoded here: the pick(...) / top(...) calls are read out
 * of watches.ts, and officialGenders.json is applied, because WATCHES overrides
 * the catalogue's gender column and a check that missed that audits the wrong
 * watches.
 *
 *   node scripts/check-featured.mjs
 *     -> tmp/featured-ids.txt (all tiles, for the other passes' --ids-file)
 *     -> tmp/featured-bad.txt (the ones that are not a clean front view)
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { classifyImage, gateOk, isClear } from "./front-view.mjs";

const ROOT = process.cwd();
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/catalog-final.json"), "utf8"));
const genderFile = path.join(ROOT, "src/data/officialGenders.json");
const official = fs.existsSync(genderFile) ? JSON.parse(fs.readFileSync(genderFile, "utf8")) : {};
/** WATCHES is the catalogue with the shop's own gender list laid over it. */
const watches = catalog.map((w) => ({ ...w, gender: official[w.id] ?? w.gender }));

const srcTs = fs.readFileSync(path.join(ROOT, "src/data/watches.ts"), "utf8");
const block = (srcTs.match(/export const FEATURED[\s\S]*?\n\}\)\(\);/) || [""])[0];
const calls = [...block.matchAll(/\b(pick|top)\(\s*"([^"]+)"\s*(?:,\s*"(men|women|unisex)"\s*)?(?:,\s*(\d+)\s*)?\)/g)].map((m) => ({
  fn: m[1],
  brand: m[2],
  gender: m[3],
  n: Number(m[4] || 1),
}));
if (!calls.length) {
  console.error("could not read the FEATURED selection out of src/data/watches.ts");
  process.exit(1);
}

const inStock = (w) => w.image && (w.qty === null || w.qty > 0);
const pick = (brand, gender, n) =>
  watches
    .filter((w) => w.brand === brand && w.gender === gender && inStock(w))
    .sort((a, b) => b.price - a.price)
    .slice(0, n);
const top = (brand, n) => watches.filter((w) => w.brand === brand && inStock(w)).sort((a, b) => b.price - a.price).slice(0, n);

const featured = calls.flatMap((c) => (c.fn === "pick" ? pick(c.brand, c.gender, c.n) : top(c.brand, c.n)));

const bad = [];
console.log(`homepage tiles: ${featured.length} (${calls.length} picks read from watches.ts)`);
// Stricter than the audit on purpose: a set SKU may show two watches on a product
// page, but the visitor's first look at the shop should be the watch itself, not
// packaging - which is how a Fossil gift box ended up as a homepage tile.
for (const w of featured) {
  const file = path.join(ROOT, "public", w.image.replace(/^\//, ""));
  if (!fs.existsSync(file)) {
    console.log(`  ${w.id.padEnd(26)} ${String(w.price).padStart(6)}  MISSING FILE`);
    bad.push(w.id);
    continue;
  }
  const flat = await sharp(file).flatten({ background: "#ffffff" }).resize(1000, 1000, { fit: "contain" }).png().toBuffer();
  const r = await classifyImage(flat);
  // A couple or gift-set SKU is *photographed* as a pair - two dials side by side is
  // the right tile for fossil-bq2400set, and refusing it here asked for a re-photo of
  // a frame that cannot exist. Packaging is still refused (that is what this rule was
  // written for); two watches, each facing the lens, is not packaging.
  const pair = /set|pair|duo|\d+x|combo/i.test(`${w.model} ${w.id}`);
  const ok = gateOk(r, { allowMultiple: pair }) && isClear(r, { allowMultiple: pair });
  if (!ok) bad.push(w.id);
  console.log(
    `  ${w.id.padEnd(26)} ${String(w.price).padStart(6)}  ${r.front ? (isClear(r) ? "front" : "weak ") : "BAD  " + r.reason.padEnd(14)} r=${String(r.radius).padStart(3)} cov=${String(r.coverage).padEnd(6)} ring=${String(r.ring).padEnd(6)} s=${r.frontScore}`,
  );
}
const lines = (list) => list.join("\n") + (list.length ? "\n" : "");
fs.writeFileSync(path.join(ROOT, "tmp/featured-bad.txt"), lines(bad));
fs.writeFileSync(path.join(ROOT, "tmp/featured-ids.txt"), lines(featured.map((w) => w.id)));
console.log(`\ntiles to re-photo: ${bad.length} -> tmp/featured-bad.txt`);
