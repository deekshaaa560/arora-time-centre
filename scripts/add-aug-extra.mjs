import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const extras = [
  { brand: "Fossil", model: "ES5443", mrp: 11995, qty: 410, rating: "H4A+" },
  { brand: "Fossil", model: "ES5476", mrp: 15495, qty: 51, rating: "H2A" },
  { brand: "Fossil", model: "ES5477", mrp: 15995, qty: 27, rating: "H2C" },
  { brand: "Fossil", model: "ES5480", mrp: 13495, qty: 295, rating: "H2A" },
  { brand: "Fossil", model: "FS6168", mrp: 14495, qty: 9, rating: "H2B" },
  { brand: "Armani Exchange", model: "AX7147SET", mrp: 15495, qty: 27, rating: "H2B" },
  { brand: "Emporio Armani", model: "AR11715", mrp: 18495, qty: 44, rating: "H4B" },
  { brand: "Emporio Armani", model: "AR11716", mrp: 18495, qty: 19, rating: "H4A" },
  { brand: "Emporio Armani", model: "AR11717", mrp: 18495, qty: 25, rating: "H4D" },
  { brand: "Emporio Armani", model: "AR11718", mrp: 15995, qty: 48, rating: "H4D" },
  { brand: "Emporio Armani", model: "AR11720", mrp: 15995, qty: 53, rating: "H4C" },
  { brand: "Emporio Armani", model: "AR11721", mrp: 15995, qty: 163, rating: "H4B" },
  { brand: "Emporio Armani", model: "AR11723", mrp: 18495, qty: 10, rating: "H4D" },
  { brand: "Emporio Armani", model: "AR11741", mrp: 25995, qty: 344, rating: "H1A+" },
  { brand: "Emporio Armani", model: "AR11743", mrp: 19495, qty: 375, rating: "H1A" },
  { brand: "Emporio Armani", model: "AR80083SET", mrp: 17495, qty: 3, rating: "H4D" },
  { brand: "Michael Kors", model: "MK4967", mrp: 15995, qty: 2, rating: "H4D" },
  { brand: "Michael Kors", model: "MK7609", mrp: 20495, qty: 1, rating: "H2B" },
  { brand: "Michael Kors", model: "MK7611", mrp: 15995, qty: 48, rating: "H2B" },
];

const slugify = (s) => String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const OUT = "public/products";
fs.mkdirSync(OUT, { recursive: true });

async function isWhite(buffer) {
  const { data, info } = await sharp(buffer).resize(12, 12).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let edge = 0, white = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (!(x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1)) continue;
      edge++;
      const o = (y * info.width + x) * 3;
      if (data[o] > 236 && data[o + 1] > 236 && data[o + 2] > 236) white++;
    }
  }
  return white / edge > 0.6;
}

async function processImage(buffer, id) {
  const base = await sharp(buffer).rotate().flatten({ background: "#fff" }).png().toBuffer();
  const white = await isWhite(base);
  let trimmed = base;
  let info = await sharp(base).metadata();
  if (white) {
    try { trimmed = await sharp(base).trim({ threshold: 8 }).png().toBuffer(); info = await sharp(trimmed).metadata(); } catch {}
  }
  const content = 940;
  const scale = Math.min(content / info.width, content / info.height);
  const w = Math.max(1, Math.round(info.width * scale));
  const h = Math.max(1, Math.round(info.height * scale));
  const resized = await sharp(trimmed).resize(w, h, { fit: "inside", kernel: "lanczos3" }).sharpen({ sigma: 0.5, m1: 0.45, m2: 0.18 }).png().toBuffer();
  await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#fff" } }).composite([{ input: resized, gravity: "center" }]).webp({ quality: 92, effort: 5 }).toFile(path.join(OUT, `${id}.webp`));
  return { white, sourceSize: `${info.width}x${info.height}` };
}

for (const item of extras) {
  const id = `${slugify(item.brand)}-${slugify(item.model)}`;
  const url = `https://fossil.scene7.com/is/image/FossilPartners/${encodeURIComponent(item.model)}_main?wid=1800&hei=1800&qlt=90`;
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await processImage(buffer, id);
    item.id = id;
    item.image = `/products/${id}.webp`;
    item.imageSource = url;
    item.imageMeta = meta;
    console.log("OK", id, meta.sourceSize);
  } catch (e) {
    console.log("FAIL", id, String(e).slice(0, 100));
  }
}
fs.writeFileSync("tmp/stock-2026/aug-extra.json", JSON.stringify(extras, null, 1));
