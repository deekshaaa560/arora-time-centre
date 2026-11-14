/**
 * Stage 3 of the brochure import: append the Bigotti Milano and Valentino
 * Orlandi rows to the live catalogue once their tiles exist in
 * public/products/ (built by brochure-tiles.mjs from brochure-import.mjs's
 * extraction). Idempotent: re-running refreshes the rows in place.
 *
 *   node scripts/brochure-merge.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { BROCHURES } from "./brochure-import.mjs";

const CATALOG = path.resolve("src/data/catalog-final.json");
const PRODUCTS = path.resolve("public/products");
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const byId = new Map(catalog.map((w, i) => [w.id, i]));

let added = 0;
let refreshed = 0;
const missing = [];
for (const key of Object.keys(BROCHURES)) {
  const cfg = BROCHURES[key];
  const rows = JSON.parse(fs.readFileSync(path.resolve(`tmp/brochures/${key}/rows.json`), "utf8"));
  for (const r of rows) {
    const file = path.join(PRODUCTS, `${r.id}.webp`);
    if (!fs.existsSync(file)) {
      missing.push(r.id);
      continue;
    }
    const row = {
      id: r.id,
      brand: cfg.brand,
      model: r.model,
      gender: r.gender,
      price: r.price,
      mrp: r.mrp,
      discount: 0,
      qty: null,
      fn: null,
      image: `/products/${r.id}.webp`,
      source: "richcrest-brochure-2026",
    };
    if (byId.has(r.id)) {
      catalog[byId.get(r.id)] = row;
      refreshed++;
    } else {
      catalog.push(row);
      added++;
    }
  }
}

fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + "\n");
const perBrand = {};
for (const w of catalog) perBrand[w.brand] = (perBrand[w.brand] || 0) + 1;
console.log(`added ${added}, refreshed ${refreshed}, missing tiles ${missing.length}`);
console.log("Bigotti Milano:", perBrand["Bigotti Milano"], "| Valentino Orlandi:", perBrand["Valentino Orlandi"], "| total rows:", catalog.length);
if (missing.length) console.log("MISSING:", missing.join(", "));
