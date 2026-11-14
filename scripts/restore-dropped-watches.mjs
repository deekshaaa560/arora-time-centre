/**
 * Put back curated watches that a repair pass dropped from the catalog because
 * it could not find a good photo in the listing. Losing the product is the wrong
 * fix: the photo is the problem, and scripts/source-front-online.mjs goes and
 * fetches one from the brand or another retailer instead.
 *
 *   node scripts/restore-dropped-watches.mjs [--dry]
 *
 * Rows are rebuilt from the Myntra/Ajio listing dumps (same fields the original
 * import used) and inserted back into their brand's block. Michael Kors and
 * Armani Exchange rows come from git, since they were distributor-sheet stock.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/myntra/brands-manifest.json");
const DRY = process.argv.includes("--dry");

const POOL_FILES = {
  Citizen: "myntra-citizen.json",
  Casio: "myntra-casio.json",
  "G-Shock": "myntra-gshock.json",
  DKNY: "myntra-dkny.json",
  "Kenneth Cole": "myntra-kenneth-cole.json",
  Giordano: "myntra-giordano.json",
  Earnshaw: "myntra-earnshaw.json",
  Sonata: "myntra-sonata.json",
  Alba: "myntra-alba.json",
  Maxima: "myntra-maxima.json",
  "Alexandre Christie": "myntra-alexandre-christie.json",
  "Tommy Hilfiger": "myntra-tommy.json",
};

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const have = new Set(catalog.map((w) => w.id));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

/** Listing record for a dropped row: by product id, model, or code in the title. */
const pools = new Map();
for (const [brand, file] of Object.entries(POOL_FILES)) {
  const full = path.join(ROOT, "tmp/stock-2026/myntra", file);
  if (!fs.existsSync(full)) continue;
  pools.set(brand, JSON.parse(fs.readFileSync(full, "utf8")));
}
function findListing(brand, model, productId) {
  const list = pools.get(brand) || [];
  if (productId) {
    const byId = list.find((p) => String(p.productId) === String(productId));
    if (byId) return byId;
  }
  const m = norm(model);
  return (
    list.find((p) => norm(p.model) === m) ||
    list.find((p) => norm(p.product).includes(m)) ||
    null
  );
}

/** Same light spec derivation the import used, from the listing title. */
function specsFrom(title) {
  const t = String(title || "").toLowerCase();
  const specs = {};
  if (/stainless steel|bracelet|link/.test(t)) specs.strap = "Stainless steel";
  else if (/leather|genuine leather/.test(t)) specs.strap = "Leather";
  else if (/nylon|fabric|canvas/.test(t)) specs.strap = "Nylon";
  else if (/silicone|rubber|resin/.test(t)) specs.strap = "Silicone";
  if (/chronograph/.test(t)) specs.movement = "Quartz chronograph";
  else if (/digital/.test(t) && /analog/.test(t)) specs.movement = "Quartz (analogue + digital)";
  else if (/digital/.test(t)) specs.movement = "Digital";
  else if (/automatic|self-winding/.test(t)) specs.movement = "Automatic";
  else if (/analog/.test(t)) specs.movement = "Quartz (analogue)";
  return Object.keys(specs).length ? specs : undefined;
}

const restored = [];
const unfixable = [];

// 1. Sheet-stock rows that exist in git (Michael Kors / Armani Exchange sets).
try {
  const head = JSON.parse(execSync("git show HEAD:src/data/catalog-final.json", { maxBuffer: 1 << 28 }).toString());
  for (const w of head) {
    if (have.has(w.id) || !["Michael Kors", "Armani Exchange"].includes(w.brand)) continue;
    catalog.push(w);
    have.add(w.id);
    restored.push({ id: w.id, brand: w.brand, from: "git" });
  }
} catch (e) {
  console.log("git rows unavailable:", e.message.slice(0, 60));
}

// 2. Curated rows rebuilt from the listing dumps.
const needsOnline = [];
for (const [id, meta] of Object.entries(manifest)) {
  if (have.has(id)) continue;
  const rec = findListing(meta.brand, meta.model, meta.productId);
  if (!rec) {
    // No local dump entry: restore the row anyway and let
    // scripts/source-front-online.mjs refill price and photo from the web.
    needsOnline.push(id);
    const row = {
      id,
      brand: meta.brand,
      model: String(meta.model || "").toUpperCase(),
      gender: "unisex",
      price: 0,
      mrp: 0,
      discount: 0,
      qty: null,
      fn: null,
      image: `/products/${id}.webp`,
      needsSourcing: true,
    };
    catalog.push(row);
    have.add(id);
    restored.push({ id, brand: meta.brand, from: "needs-online" });
    continue;
  }
  const row = {
    id,
    brand: meta.brand,
    model: String(meta.model || rec.model || "").toUpperCase(),
    gender: ["men", "women", "unisex"].includes(rec.gender) ? rec.gender : "unisex",
    price: Number(rec.price) || Number(rec.mrp) || 0,
    mrp: Number(rec.mrp) || Number(rec.price) || 0,
    discount: Number(rec.discount) || 0,
    qty: null,
    fn: null,
    image: `/products/${id}.webp`,
  };
  const specs = specsFrom(rec.product);
  if (specs) row.specs = specs;
  catalog.push(row);
  have.add(id);
  restored.push({ id, brand: meta.brand, from: "listing" });
}

// Keep each brand's rows together: sort stable by the brand's first appearance.
const order = [];
for (const w of catalog) if (!order.includes(w.brand)) order.push(w.brand);
catalog.sort((a, b) => order.indexOf(a.brand) - order.indexOf(b.brand));

const byBrand = {};
for (const r of restored) byBrand[r.brand] = (byBrand[r.brand] || 0) + 1;
console.log(`restored ${restored.length} rows:`, byBrand);
if (needsOnline.length)
  console.log(`need an online price+photo for ${needsOnline.length}: ${needsOnline.slice(0, 8).join(", ")}${needsOnline.length > 8 ? " ..." : ""}`);

if (!DRY) {
  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + "\n");
  const ids = restored.map((r) => r.id);
  fs.writeFileSync(path.join(ROOT, "tmp/restored-ids.txt"), ids.join("\n"));
  fs.writeFileSync(path.join(ROOT, "tmp/needs-online-ids.txt"), needsOnline.join("\n"));
  console.log(`catalog now ${catalog.length} rows -> tmp/restored-ids.txt (${ids.length} ids to source photos for)`);
} else {
  console.log(`(dry) catalog would be ${catalog.length} rows`);
}
