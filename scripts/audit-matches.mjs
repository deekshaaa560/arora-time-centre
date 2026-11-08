import fs from "node:fs";

const rows = JSON.parse(fs.readFileSync("tmp/stock-2026/coverage.json", "utf8"));
const byProduct = new Map();
for (const r of rows) {
  if (!r.myntra) continue;
  const id = r.myntra.productId;
  if (!byProduct.has(id)) byProduct.set(id, []);
  byProduct.get(id).push(r);
}
const dupes = [...byProduct.values()].filter((v) => v.length > 1);
console.log("products with multiple stock matches", dupes.length);
for (const group of dupes.slice(0, 30)) {
  console.log(
    group.map((r) => `${r.brand} ${r.model} -> ${r.myntra.product}`).join("\n  "),
    "\n---",
  );
}

const genderMap = { MEN: "men", WOMEN: "women", UNISEX: "unisex" };
const mismatch = [];
for (const r of rows) {
  if (!r.myntra || !r.gender) continue;
  const sheet = genderMap[String(r.gender).toUpperCase()];
  const myn = String(r.myntra.gender || "").toLowerCase();
  const m = myn === "men" ? "men" : myn === "women" ? "women" : myn === "unisex" ? "unisex" : null;
  if (sheet && m && sheet !== m) mismatch.push({ brand: r.brand, model: r.model, sheet, myntra: m, title: r.myntra.product });
}
console.log("gender mismatches", mismatch.length);
console.log(mismatch.slice(0, 40));

const missing = rows.filter((r) => !r.myntra);
console.log("missing", missing.length, missing.map((r) => `${r.brand}|${r.model}`).join(", "));
