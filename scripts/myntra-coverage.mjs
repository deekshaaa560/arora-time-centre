import fs from "node:fs";

const parsed = JSON.parse(fs.readFileSync("tmp/stock-2026/parsed.json", "utf8"));
const catalog = JSON.parse(fs.readFileSync("src/data/catalog.json", "utf8"));
const existing = new Set(catalog.map((w) => `${w.brand.toLowerCase()}|${String(w.model).toLowerCase()}`));

const files = {
  Fossil: "tmp/stock-2026/myntra/myntra-fossil.json",
  "Michael Kors": "tmp/stock-2026/myntra/myntra-mk.json",
  "Armani Exchange": "tmp/stock-2026/myntra/myntra-ax.json",
  "Emporio Armani": "tmp/stock-2026/myntra/myntra-ea.json",
  Diesel: "tmp/stock-2026/myntra/myntra-diesel.json",
  GUESS: "tmp/stock-2026/myntra/myntra-guess.json",
};

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const tokens = (s) =>
  String(s || "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map((t) => t.trim())
    .filter(Boolean);

const myntra = {};
for (const [brand, file] of Object.entries(files)) {
  const list = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const p of list) {
    const set = new Set(tokens(`${p.product} ${p.url}`).map(norm));
    p.tokens = set;
  }
  myntra[brand] = list;
}

const findMatch = (brand, model) => {
  const bank = myntra[brand] ?? [];
  const n = norm(model);
  const exact = bank.filter((p) => p.tokens.has(n));
  if (exact.length) return exact[0];
  const iSuffix = bank.filter((p) => p.tokens.has(n + "I"));
  if (iSuffix.length) return iSuffix[0];
  return null;
};

/* union */
const union = new Map();
for (const p of parsed.xlsxProducts) union.set(p.model.toUpperCase(), { ...p, source: "xlsx" });
for (const p of parsed.augProducts) {
  const key = p.model.toUpperCase();
  if (!union.has(key)) union.set(key, { ...p, source: "aug5" });
}
for (const p of parsed.octProducts) {
  const key = p.model.toUpperCase();
  if (!union.has(key)) union.set(key, { ...p, source: "oct27" });
}

const rows = [];
const stats = {};
for (const p of union.values()) {
  const brand = p.brand ?? "GUESS";
  if (existing.has(`${String(brand).toLowerCase()}|${String(p.model).toLowerCase()}`)) continue;
  const hit = findMatch(brand, p.model);
  rows.push({
    ...p,
    brand,
    myntra: hit
      ? {
          product: hit.product,
          gender: hit.gender,
          mrp: hit.mrp,
          image: hit.image,
          images: hit.images,
          url: hit.url,
          productId: hit.productId,
        }
      : null,
  });
  stats[brand] ??= { total: 0, hit: 0 };
  stats[brand].total++;
  if (hit) stats[brand].hit++;
}

fs.writeFileSync("tmp/stock-2026/coverage.json", JSON.stringify(rows, null, 1));
console.log("new stock rows", rows.length);
console.log(stats, "total hit", rows.filter((r) => r.myntra).length);
console.log("missing", rows.filter((r) => !r.myntra).length);

/* duplicates after stricter matching */
const byProduct = new Map();
for (const r of rows) {
  if (!r.myntra) continue;
  if (!byProduct.has(r.myntra.productId)) byProduct.set(r.myntra.productId, []);
  byProduct.get(r.myntra.productId).push(r);
}
const dupes = [...byProduct.values()].filter((v) => v.length > 1);
console.log("duplicate product matches", dupes.length, dupes.slice(0, 10).map((g) => g.map((r) => r.model).join("+")));
