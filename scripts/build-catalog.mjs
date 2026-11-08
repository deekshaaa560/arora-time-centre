import fs from "node:fs";
import path from "node:path";

const rows = JSON.parse(fs.readFileSync("tmp/extract/products.json", "utf8"));

/* Verified Fastrack/Titan gender labels (official brand catalogues). The
   stock-sheet model suffix is not a reliable gender code. */
const officialGenders = fs.existsSync("src/data/officialGenders.json")
  ? JSON.parse(fs.readFileSync("src/data/officialGenders.json", "utf8"))
  : {};

// Pages where image↔row alignment is unreliable (count mismatch) — no photo
const unreliable = new Set([
  ...["24", "25", "69", "84", "85", "132"].map((p) => `fastrack:${p}`),
  ...[
    "53", "54", "60", "61", "63", "71", "72", "73", "95", "116", "117",
    "129", "137", "138", "141", "166", "169", "171", "199",
  ].map((p) => `titan:${p}`),
  ...["31", "49", "59", "62", "63", "69", "70"].map((p) => `bdb:${p}`),
]);

const slug = (r) => `${r.brand.toLowerCase()}-${r.code.toLowerCase()}`;
const hasPhoto = (r) => !unreliable.has(`${r.sheet}:${r.page}`);

/** Fallback only. Stock-sheet suffixes are NOT reliable gender codes
 *  (e.g. Fastrack NU6248NM01 is an official girls' watch), so verified
 *  labels in src/data/officialGenders.json take precedence. */
function genderFromCode(code) {
  const m = code.match(/([A-Z])([A-Z])(\d{2})$/i);
  if (!m) return "unisex";
  const l = m[2].toUpperCase();
  return l === "L" ? "women" : l === "M" ? "men" : "unisex";
}

const bdbGender = (g) => (g === "Men" ? "men" : g === "Women" ? "women" : "unisex");

const seen = new Set();
const catalog = [];
for (const r of rows) {
  const id = slug(r);
  if (seen.has(id)) continue;
  seen.add(id);

  const inferredGender =
    r.sheet === "bdb" ? bdbGender(r.gender) : genderFromCode(r.code);
  const gender = officialGenders[id] ?? inferredGender;
  const price = Math.max(1, Math.round(r.mrp * (1 - r.discount / 100)));
  catalog.push({
    id,
    brand: r.brand,
    model: r.code,
    gender,
    price,
    mrp: r.mrp,
    discount: r.discount,
    qty: r.qty,
    fn: r.fn ?? null,
    image: hasPhoto(r) ? `/products/${id}.webp` : null,
  });
}

/* Fossil group stock (Fossil, Michael Kors, Armani Exchange, Emporio Armani)
   from the FOSSIL READY STOCK workbook — images are dealer assets. */
const fossilFile = "tmp/extract/fossil-products.json";
let fossilCount = 0;
if (fs.existsSync(fossilFile)) {
  const fossil = JSON.parse(fs.readFileSync(fossilFile, "utf8"));
  for (const r of fossil) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    catalog.push({ ...r, qty: null, fn: null });
    fossilCount++;
  }
}

// Copy the Fossil-group images from their staging folder into public/products
let copied = 0;
const fossilDir = "tmp/fossil-products";
if (fs.existsSync(fossilDir)) {
  for (const f of fs.readdirSync(fossilDir)) {
    if (!f.endsWith(".webp")) continue;
    fs.copyFileSync(path.join(fossilDir, f), path.join("public/products", f));
    copied++;
  }
}
console.log("fossil products:", fossilCount, "| images copied:", copied);

const byGender = catalog.reduce((a, r) => ((a[r.gender] = (a[r.gender] || 0) + 1), a), {});
const withPhoto = catalog.filter((r) => r.image).length;
const unisexCfa = catalog.filter((r) => r.gender === "unisex" && r.brand !== "Timex").length;
const inStock = catalog.filter((r) => r.qty === null || r.qty > 0).length;

console.log("catalog", catalog.length);
console.log("by gender", byGender);
console.log("with photo", withPhoto, "| cfa unisex (unmatched code pattern)", unisexCfa);
console.log("in stock", inStock);
console.log(
  "price range",
  Math.min(...catalog.map((r) => r.price)),
  "–",
  Math.max(...catalog.map((r) => r.price)),
);

fs.writeFileSync("src/data/catalog.json", JSON.stringify(catalog));
console.log("wrote src/data/catalog.json");

// Remove photo files for unreliable-page products
let removed = 0;
for (const r of catalog) {
  if (r.image) continue;
  const f = path.resolve(`public/products/${r.id}.webp`);
  if (fs.existsSync(f)) {
    fs.unlinkSync(f);
    removed++;
  }
}
console.log("removed unreliable photos", removed);
