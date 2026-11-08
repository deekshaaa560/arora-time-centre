import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const existing = JSON.parse(fs.readFileSync("src/data/catalog.json", "utf8"));
const coverage = JSON.parse(fs.readFileSync("tmp/stock-2026/coverage.json", "utf8"));
const genders = JSON.parse(fs.readFileSync("tmp/stock-2026/genders.json", "utf8"));
const tommy = JSON.parse(fs.readFileSync("tmp/stock-2026/tommy-selection.json", "utf8"));

const slugify = (s) =>
  String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const idOf = (r) => `${slugify(r.brand)}-${slugify(r.model)}`;

const existingIds = new Set(existing.map((w) => w.id));
const existingKeys = new Set(existing.map((w) => `${w.brand.toLowerCase()}|${String(w.model).toLowerCase()}`));

const titleCase = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .trim();

const formatCase = (s) => {
  const raw = String(s || "").trim();
  if (!raw) return undefined;
  const m = raw.match(/^(\d+(?:\.\d+)?)\s?MM$/i);
  if (m) return `${m[1]} mm`;
  if (/^\d+$/.test(raw)) return `${raw} mm`;
  return titleCase(raw);
};

const materialLabel = (s) => {
  const v = String(s || "").toUpperCase();
  if (v.includes("STAINLESS")) return "Stainless steel";
  if (v.includes("LEATHER")) return "Leather";
  if (v.includes("SILICONE")) return "Silicone";
  if (v.includes("CERAMIC")) return "Ceramic";
  if (v.includes("MIXED")) return "Mixed metal";
  if (v.includes("PRO-PLANET") || v.includes("PRO PLANET")) return "Pro Planet recycled steel";
  if (v.includes("TITANIUM")) return "Titanium";
  if (!v) return undefined;
  return titleCase(v);
};

const colourLabel = (s) => {
  const v = String(s || "").trim();
  if (!v) return undefined;
  const up = v.toUpperCase();
  if (up === "ROSE GOLD") return "Rose gold-tone";
  if (up === "GOLD") return "Gold-tone";
  if (up === "SILVER") return "Silver-tone";
  if (up === "MULTI") return "Multi-tone";
  return titleCase(v);
};

const fnOf = (title) => {
  const s = String(title || "");
  if (/chronograph/i.test(s)) return "Chronograph";
  if (/automatic/i.test(s)) return "Automatic";
  if (/multi[\s-]?function/i.test(s)) return "Multifunction";
  if (/solar/i.test(s)) return "Solar";
  if (/quartz/i.test(s)) return "Quartz";
  return null;
};

const movementOf = (title, fn) => {
  const s = String(title || "");
  if (/automatic/i.test(s)) return "Automatic";
  if (/solar/i.test(s)) return "Solar";
  if (/quartz/i.test(s) || /chronograph/i.test(s) || /multi[\s-]?function/i.test(s)) return "Quartz";
  if (fn === "Automatic" || fn === "Solar" || fn === "Quartz") return fn;
  return undefined;
};

const caseFromTitle = (title) => {
  const m = String(title || "").match(/\b(\d{2}(?:\.\d+)?)\s?mm\b/i);
  return m ? `${m[1]} mm` : undefined;
};

const strapFromTitle = (title) => {
  const s = String(title || "");
  if (/leather/i.test(s)) return "Leather";
  if (/silicone/i.test(s)) return "Silicone";
  if (/ceramic/i.test(s)) return "Ceramic";
  if (/stainless steel|steel/i.test(s) && /strap|bracelet|bracelet style/i.test(s)) return "Stainless steel";
  if (/bracelet/i.test(s)) return "Stainless steel";
  return undefined;
};

function specsForStock(row, title) {
  const a = row.attrs ?? {};
  const fn = fnOf(title);
  const specs = {};
  const caseSize = formatCase(a.CaseSize);
  if (caseSize) specs.caseSize = caseSize;
  const caseColor = colourLabel(a.CaseColor);
  if (caseColor) specs.caseColor = caseColor;
  const dialColor = colourLabel(a.DialColor);
  if (dialColor) specs.dialColor = dialColor;
  const material = materialLabel(a["Bracelet Material"]);
  const braceletColor = colourLabel(a["Bracelet Color"]);
  if (material) specs.strap = braceletColor ? `${material} · ${braceletColor}` : material;
  const movement = movementOf(title, fn);
  if (movement) specs.movement = movement;
  return { fn, specs };
}

function specsForTommy(item) {
  const fn = fnOf(item.title);
  const specs = {};
  const caseSize = caseFromTitle(item.title);
  if (caseSize) specs.caseSize = caseSize;
  const strap = strapFromTitle(item.title);
  if (strap) specs.strap = strap;
  const movement = movementOf(item.title, fn);
  if (movement) specs.movement = movement;
  return { fn, specs };
}

/* Verified gender labels override the sheet/Bing guesses. */
const officialGenders = fs.existsSync("src/data/officialGenders.json")
  ? JSON.parse(fs.readFileSync("src/data/officialGenders.json", "utf8"))
  : {};

const additions = [];
const skipped = [];

for (const row of coverage) {
  const id = idOf(row);
  const brand = row.brand === "GUESS" ? "Guess" : row.brand;
  if (existingIds.has(id)) {
    skipped.push(id);
    continue;
  }
  const key = `${brand.toLowerCase()}|${String(row.model).toLowerCase()}`;
  if (existingKeys.has(key)) {
    skipped.push(`${brand}:${row.model}`);
    continue;
  }
  const genderInfo = genders[`${row.brand}|${row.model}`];
  const gender = genderInfo?.gender ?? "unisex";
  if (!genderInfo) console.log("WARN no gender", row.brand, row.model);
  const title = row.myntra?.product ?? "";
  const { fn, specs } = specsForStock(row, title);
  const image = `/products/${id}.webp`;
  if (!fs.existsSync(path.join("public", image))) console.log("WARN no image", id);

  additions.push({
    id,
    brand,
    model: row.model,
    gender,
    price: Number(row.mrp) || 0,
    mrp: Number(row.mrp) || 0,
    discount: 0,
    qty: typeof row.qty === "number" ? row.qty : null,
    fn: fn ?? null,
    image,
    ...(Object.keys(specs).length ? { specs } : {}),
  });
  existingIds.add(id);
  existingKeys.add(key);
}

for (const item of tommy) {
  const id = item.id;
  if (existingIds.has(id)) continue;
  const key = `tommy hilfiger|${String(item.model).toLowerCase()}`;
  if (existingKeys.has(key)) continue;
  const { fn, specs } = specsForTommy(item);
  const image = `/products/${id}.webp`;
  if (!fs.existsSync(path.join("public", image))) console.log("WARN no image", id);
  additions.push({
    id,
    brand: "Tommy Hilfiger",
    model: item.model,
    gender: item.gender,
    price: Number(item.mrp) || 0,
    mrp: Number(item.mrp) || 0,
    discount: 0,
    qty: null,
    fn: fn ?? null,
    image,
    tag: "New",
    ...(Object.keys(specs).length ? { specs } : {}),
  });
  existingIds.add(id);
  existingKeys.add(key);
}

additions.sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
const merged = [...existing, ...additions];
for (const w of merged) {
  if (officialGenders[w.id]) w.gender = officialGenders[w.id];
}
fs.writeFileSync("tmp/stock-2026/catalog-new.json", JSON.stringify(merged));
fs.writeFileSync("src/data/catalog.json", JSON.stringify(merged));
console.log("wrote catalog bytes", JSON.stringify(merged).length, "to src/data/catalog.json");

const byBrand = {};
const byGender = {};
for (const w of additions) {
  byBrand[w.brand] = (byBrand[w.brand] ?? 0) + 1;
  byGender[w.gender] = (byGender[w.gender] ?? 0) + 1;
}
console.log("existing", existing.length, "additions", additions.length, "merged", merged.length);
console.log("skipped", skipped.length, skipped.slice(0, 10));
console.log("new by brand", byBrand);
console.log("new by gender", byGender);
console.log("new with image", additions.filter((w) => w.image).length);
console.log("sample", additions.slice(0, 3));
console.log(
  "specs sample",
  additions.filter((w) => w.specs).slice(0, 5).map((w) => ({ model: w.model, specs: w.specs })),
);
