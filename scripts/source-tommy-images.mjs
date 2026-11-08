import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/tommy-images.json");
const SELECTION = path.join(ROOT, "tmp/stock-2026/tommy-selection.json");
fs.mkdirSync(OUT, { recursive: true });

const list = JSON.parse(fs.readFileSync("tmp/stock-2026/myntra/myntra-tommy.json", "utf8"));
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const slugify = (s) =>
  String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const codeOf = (p) => {
  const m = String(p.product || "").match(/\b(?:NET)?TH\d{6,}[A-Z]*\b/i);
  return m ? m[0].toUpperCase() : null;
};

const perGender = Number(process.env.PER_GENDER || 16);
const selected = [];
const seen = new Set();
for (const gender of ["men", "women"]) {
  let count = 0;
  for (const p of list) {
    if (String(p.gender || "").toLowerCase() !== gender) continue;
    const code = codeOf(p);
    const model = code || `TH-${p.productId}`;
    const key = model.toUpperCase();
    if (seen.has(key)) continue;
    if (!p.image || !p.image.includes("myntassets")) continue;
    seen.add(key);
    selected.push({
      brand: "Tommy Hilfiger",
      model,
      gender,
      mrp: Number(p.mrp) || 0,
      sourcePrice: Number(p.price) || 0,
      title: p.product,
      productId: p.productId,
      source: p.image,
      id: `tommy-hilfiger-${slugify(model)}`,
    });
    count++;
    if (count >= perGender) break;
  }
  console.log(gender, count);
}

fs.writeFileSync(SELECTION, JSON.stringify(selected, null, 1));
console.log("selected", selected.length);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function processImage(buffer, id) {
  const base = await sharp(buffer).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  let trimmed = base;
  let info = await sharp(base).metadata();
  try {
    trimmed = await sharp(base).trim({ threshold: 8 }).png().toBuffer();
    info = await sharp(trimmed).metadata();
  } catch {
    /* keep */
  }
  const content = 940;
  const scale = Math.min(content / info.width, content / info.height);
  const w = Math.max(1, Math.round(info.width * scale));
  const h = Math.max(1, Math.round(info.height * scale));
  const resized = await sharp(trimmed)
    .resize(w, h, { fit: "inside", kernel: "lanczos3" })
    .sharpen({ sigma: 0.5, m1: 0.45, m2: 0.18 })
    .png()
    .toBuffer();
  await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
    .composite([{ input: resized, gravity: "center" }])
    .webp({ quality: 92, alphaQuality: 92, effort: 5 })
    .toFile(path.join(OUT, `${id}.webp`));
  return { sourceSize: `${info.width}x${info.height}`, outputSize: "1000x1000" };
}

async function sourceOne(item) {
  if (manifest[item.id] && fs.existsSync(path.join(OUT, `${item.id}.webp`))) return true;
  const candidates = [item.source];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(candidates[0], { headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 8000) throw new Error("small");
      const meta = await processImage(buffer, item.id);
      manifest[item.id] = { ...item, ...meta };
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
      return true;
    } catch (e) {
      if (attempt === 2) {
        console.log(`FAIL ${item.id} ${String(e).slice(0, 100)}`);
        return false;
      }
      await sleep(1200 * (attempt + 1));
    }
  }
  return false;
}

let index = 0, ok = 0, fail = 0;
const workers = Array.from({ length: 4 }, async () => {
  while (index < selected.length) {
    const item = selected[index++];
    if (await sourceOne(item)) ok++;
    else fail++;
    await sleep(100);
  }
});
await Promise.all(workers);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log("DONE", { ok, fail, total: selected.length, manifest: Object.keys(manifest).length });
