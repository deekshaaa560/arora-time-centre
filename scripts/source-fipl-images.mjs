import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/fipl-images.json");
fs.mkdirSync(OUT, { recursive: true });

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const rows = JSON.parse(fs.readFileSync("tmp/stock-2026/coverage.json", "utf8")).filter(
  (r) => r.brand !== "GUESS" && r.brand !== "Tommy Hilfiger",
);
const slugify = (s) =>
  String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const idOf = (r) => `${slugify(r.brand)}-${slugify(r.model)}`;

const done = new Set(Object.keys(manifest).filter((k) => fs.existsSync(path.join(OUT, `${k}.webp`))));
const todo = rows.filter((r) => !done.has(idOf(r)));
console.log("FIPL rows", rows.length, "done", done.size, "todo", todo.length);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isWhiteBacked(buffer) {
  try {
    const { data, info } = await sharp(buffer)
      .resize(12, 12, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
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
  } catch {
    return false;
  }
}

async function processImage(buffer, id) {
  const base = await sharp(buffer).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  const white = await isWhiteBacked(base);
  let trimmed = base;
  let info = await sharp(base).metadata();
  if (white) {
    try {
      trimmed = await sharp(base).trim({ threshold: 8 }).png().toBuffer();
      info = await sharp(trimmed).metadata();
    } catch {
      /* keep untrimmed */
    }
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
  return { white, sourceSize: `${info.width}x${info.height}`, outputSize: "1000x1000" };
}

async function sourceOne(row) {
  const id = idOf(row);
  const model = row.model.toUpperCase();
  const url = `https://fossil.scene7.com/is/image/FossilPartners/${encodeURIComponent(model)}_main?wid=2000&hei=2000&qlt=90`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
        },
      });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.startsWith("image/")) throw new Error(`HTTP ${res.status} ${type}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 8000) throw new Error("small file");
      const meta = await processImage(buffer, id);
      manifest[id] = { id, brand: row.brand, model: row.model, source: url, ...meta };
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
      return true;
    } catch (e) {
      if (attempt === 2) {
        console.log(`FAIL ${id}: ${String(e).slice(0, 100)}`);
        return false;
      }
      await sleep(600 * (attempt + 1));
    }
  }
  return false;
}

let index = 0, ok = 0, fail = 0;
const workers = Array.from({ length: 5 }, async () => {
  while (index < todo.length) {
    const row = todo[index++];
    if (await sourceOne(row)) ok++;
    else fail++;
    if ((ok + fail) % 50 === 0) console.log(`progress ${ok + fail}/${todo.length} ok=${ok} fail=${fail}`);
    await sleep(120);
  }
});
await Promise.all(workers);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log("DONE", { ok, fail, total: todo.length, manifest: Object.keys(manifest).length });
