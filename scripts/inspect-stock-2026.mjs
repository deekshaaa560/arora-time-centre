import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const root = process.cwd();
const catalog = JSON.parse(fs.readFileSync("src/data/catalog.json", "utf8"));
const byModel = new Map();
for (const w of catalog) {
  const key = `${w.brand.toLowerCase()}|${String(w.model).toLowerCase()}`;
  if (!byModel.has(key)) byModel.set(key, w);
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/* ---------- XLSX ---------- */
const BRAND_MAP = {
  FOSSIL: "Fossil",
  "ARMANI EXCHANGE": "Armani Exchange",
  ARMANI: "Emporio Armani",
  "MICHAEL KORS": "Michael Kors",
  DIESEL: "Diesel",
};
const xlsxProducts = [];
const wb = XLSX.readFile("C:/Users/Sych-win/Downloads/FIPL - STOCK SHEET - 07.09.2026.xlsx");
for (const sheetName of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
  let current = null;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row[1] ?? "").trim();
    const mrp = num(row[2]);
    const qty = num(row[3]);
    if (code && mrp && !/^Brand:/i.test(code) && !/^Gender:/i.test(code)) {
      current = {
        sheet: sheetName,
        row: i + 1,
        model: code,
        mrp,
        qty,
        attrs: {},
      };
      xlsxProducts.push(current);
      continue;
    }
    if (current && code) {
      const m = code.match(/^([^:]+):\s*(.*)$/);
      if (m) current.attrs[m[1].trim()] = m[2].trim();
    }
  }
}
const xlsxByBrand = {};
for (const p of xlsxProducts) {
  const brand = BRAND_MAP[String(p.attrs.Brand ?? "").toUpperCase()] ?? p.attrs.Brand ?? p.sheet;
  p.brand = brand;
  xlsxByBrand[brand] = (xlsxByBrand[brand] ?? 0) + 1;
}

/* ---------- aug 5 PDF ---------- */
const augText = fs.readFileSync("tmp/stock-2026/aug5/text.txt", "utf8");
const AUG_BRANDS = new Set(["FOSSIL", "ARMANI EXCHANGE", "ARMANI", "MICHAEL KORS", "DIESEL"]);
const AUG_RATINGS = new Set(["A+", "A", "B", "C", "D", "E", "R"]);
const clean = (s) => s.trim();
const augPages = augText.split(/===== PAGE /).slice(1);
const augProducts = [];
for (const page of augPages) {
  const pageNo = Number(page.match(/^(\d+) =====/)?.[1]);
  const tokens = page
    .replace(/^(\d+) =====/, "")
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean)
    .filter((t) => !/^(Images|Items|MRP|Brand|Rating|Available in WH|EOSS .*)$/i.test(t));
  for (let i = 0; i < tokens.length - 4; i++) {
    const [code, mrp, brand, rating, qty] = tokens.slice(i, i + 5);
    if (
      /^[A-Z0-9][A-Z0-9-]{3,}$/.test(code) &&
      num(mrp) &&
      AUG_BRANDS.has(brand) &&
      AUG_RATINGS.has(rating) &&
      /^\d+$/.test(qty)
    ) {
      augProducts.push({ page: pageNo, model: code, mrp: num(mrp), brand: BRAND_MAP[brand] ?? brand, rating, qty: Number(qty) });
      i += 4;
    }
  }
}

/* ---------- oct 27 PDF ---------- */
const octText = fs.readFileSync("tmp/stock-2026/oct27/text.txt", "utf8");
const octPages = octText.split(/===== PAGE /).slice(1);
const octProducts = [];
for (const page of octPages) {
  const pageNo = Number(page.match(/^(\d+) =====/)?.[1]);
  const tokens = page
    .replace(/^(\d+) =====/, "")
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean)
    .filter((t) => !/^(SKU|Images|MRP|QTY|avl)$/i.test(t));
  for (let i = 0; i < tokens.length - 1; i++) {
    const [code, mrp] = tokens.slice(i, i + 2);
    if (/^[A-Z0-9][A-Z0-9-]{3,}$/.test(code) && num(mrp)) {
      octProducts.push({ page: pageNo, model: code, mrp: num(mrp) });
      i += 1;
    }
  }
}

/* ---------- compare ---------- */
const check = (list, brandOf) => {
  const missing = [];
  for (const p of list) {
    const brand = brandOf(p);
    const key = `${brand.toLowerCase()}|${p.model.toLowerCase()}`;
    if (!byModel.has(key)) missing.push(p);
  }
  return missing;
};
const xlsxMissing = check(xlsxProducts, (p) => p.brand);
const augMissing = check(augProducts, (p) => p.brand);
const octMissing = check(octProducts, () => "G-Shock");

const uniqueModels = new Set([...xlsxProducts, ...augProducts, ...octProducts].map((p) => p.model.toUpperCase()));
const missingModels = new Set([...xlsxMissing, ...augMissing, ...octMissing].map((p) => p.model.toUpperCase()));

console.log("catalog", catalog.length);
console.log("XLSX products", xlsxProducts.length, xlsxByBrand);
console.log("Aug5 products", augProducts.length);
console.log("Oct27 products", octProducts.length);
console.log("unique new-file models", uniqueModels.size);
console.log("XLSX missing from catalog", xlsxMissing.length);
console.log("Aug5 missing", augMissing.length);
console.log("Oct27 missing", octMissing.length);
console.log("unique missing models", missingModels.size);
console.log("missing brand counts", [...missingModels].length);

const out = { xlsxProducts, augProducts, octProducts, xlsxMissing, augMissing, octMissing };
fs.writeFileSync("tmp/stock-2026/parsed.json", JSON.stringify(out, null, 1));
console.log("sample xlsx missing", xlsxMissing.slice(0, 5));
console.log("sample aug missing", augMissing.slice(0, 5));
console.log("sample oct missing", octMissing.slice(0, 5));
