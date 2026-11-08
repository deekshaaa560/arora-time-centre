import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import sharp from "sharp";

const xlsxFile = "C:/Users/Sych-win/Downloads/FOSSIL READY STOCK (3) (2).xlsx";
const unz = "tmp/fossil-xlsx/unzipped";
const outDir = path.resolve("tmp/fossil-products");
fs.mkdirSync(outDir, { recursive: true });

/* ---------- rows ---------- */
const wb = XLSX.readFile(xlsxFile);
const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: "" });
const products = rows
  .slice(1)
  .map((r, i) => ({
    row: i + 1,
    sku: String(r[1] ?? "").trim(),
    mrp: Number(r[2] ?? 0),
    brandRaw: String(r[3] ?? "").trim(),
    scheme: Number(r[4] ?? 0),
  }))
  .filter((p) => p.sku && p.mrp > 0);

const BRAND_DISPLAY = {
  "ARMANI EXCHANGE": "Armani Exchange",
  "MICHAEL KORS": "Michael Kors",
  FOSSIL: "Fossil",
  "EMPORIO ARMANI": "Emporio Armani",
};
const slugify = (s) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/* ---------- drawing anchors -> media ---------- */
const drawing = fs.readFileSync(path.join(unz, "xl/drawings/drawing1.xml"), "utf8");
const rels = fs.readFileSync(path.join(unz, "xl/drawings/_rels/drawing1.xml.rels"), "utf8");
const ridToMedia = new Map();
for (const m of rels.matchAll(/Id="(rId\d+)"[^>]*Target="\.\.\/media\/([^"]+)"/g)) {
  ridToMedia.set(m[1], m[2]);
}
const rowToMedia = new Map();
for (const m of drawing.matchAll(/<xdr:twoCellAnchor>([\s\S]*?)<\/xdr:twoCellAnchor>/g)) {
  const block = m[1];
  const row = Number(block.match(/<xdr:row>(\d+)<\/xdr:row>/)?.[1] ?? -1);
  const rid = block.match(/r:embed="(rId\d+)"/)?.[1];
  if (row < 0 || !rid) continue;
  const media = ridToMedia.get(rid);
  if (media) rowToMedia.set(row, media);
}
console.log("anchors mapped:", rowToMedia.size, "| products:", products.length);

/* ---------- cutout (same as site pipeline) ---------- */
const CARD_BG = { r: 23, g: 28, b: 40 };
function cutoutRgba(px, w, h) {
  const removed = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const isBg = (i) => {
    const o = i * 4;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mn >= 240 && mx - mn <= 14;
  };
  const push = (i) => {
    if (!removed[i] && isBg(i)) { removed[i] = 1; queue[tail++] = i; }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  const fraction = tail / (w * h);
  if (fraction > 0.82) {
    for (let i = 0; i < w * h; i++) {
      if (!removed[i]) continue;
      const o = i * 4;
      px[o] = CARD_BG.r; px[o + 1] = CARD_BG.g; px[o + 2] = CARD_BG.b;
    }
    return "recolored";
  }
  for (let i = 0; i < w * h; i++) if (removed[i]) px[i * 4 + 3] = 0;
  return "alpha";
}

/* ---------- process ---------- */
const catalogRows = [];
let missing = [];
for (const p of products) {
  const media = rowToMedia.get(p.row);
  const brand = BRAND_DISPLAY[p.brandRaw] ?? p.brandRaw;
  if (!media) {
    missing.push(p.sku);
    continue;
  }
  const id = `${slugify(brand)}-${p.sku.toLowerCase()}`;
  const file = path.join(unz, "xl/media", media);
  const meta = await sharp(file).metadata();

  const inner = await sharp(file)
    .trim({ threshold: 12 })
    .resize({ width: 546, height: 546, fit: "inside", kernel: "lanczos3", withoutEnlargement: false })
    .sharpen({ sigma: 0.8, m1: 0.7, m2: 0.3 })
    .png()
    .toBuffer();

  const tile = await sharp({
    create: { width: 600, height: 600, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: inner, gravity: "center" }])
    .ensureAlpha()
    .raw()
    .toBuffer();

  cutoutRgba(tile, 600, 600);
  await sharp(tile, { raw: { width: 600, height: 600, channels: 4 } })
    .webp({ quality: 92, alphaQuality: 92, effort: 4 })
    .toFile(path.join(outDir, `${id}.webp`));

  catalogRows.push({
    id,
    brand,
    model: p.sku,
    gender: "unisex",
    price: Math.max(1, Math.round(p.mrp * (1 - p.scheme))),
    mrp: p.mrp,
    discount: Math.round(p.scheme * 100),
    qty: null,
    fn: null,
    image: `/products/${id}.webp`,
    source: "fossil-ready-stock",
    mediaSize: `${meta.width}x${meta.height}`,
  });
}

fs.writeFileSync("tmp/extract/fossil-products.json", JSON.stringify(catalogRows, null, 1));
console.log("processed", catalogRows.length, "missing media", missing.length);
console.log(catalogRows.slice(0, 5).map((r) => `${r.brand} ${r.model} ₹${r.price} (${r.mediaSize})`).join("\n"));
