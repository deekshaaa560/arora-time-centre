import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/myntra-images.json");
fs.mkdirSync(OUT, { recursive: true });

const rows = JSON.parse(fs.readFileSync("tmp/stock-2026/coverage.json", "utf8")).filter(
  (r) => r.myntra && r.myntra.image,
);
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const slugify = (s) =>
  String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
function slugId(r) {
  return `${slugify(r.brand)}-${slugify(r.model)}`;
}
const done = new Set(Object.keys(manifest).filter((k) => fs.existsSync(path.join(OUT, `${k}.webp`))));
const todo = rows.filter((r) => {
  const id = slugId(r);
  return !done.has(id);
});

console.log("rows with Myntra image", rows.length, "already done", done.size, "todo", todo.length);

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
        const isEdge = x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1;
        if (!isEdge) continue;
        edge++;
        const o = (y * info.width + x) * 3;
        if (data[o] > 236 && data[o + 1] > 236 && data[o + 2] > 236) white++;
      }
    }
    return white / edge > 0.7;
  } catch {
    return false;
  }
}

async function processImage(buffer, id) {
  const base = await sharp(buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const white = await isWhiteBacked(base);

  let trimmed = base;
  let info = await sharp(base).metadata();
  if (white) {
    try {
      trimmed = await sharp(base).trim({ threshold: 10 }).png().toBuffer();
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
    .sharpen({ sigma: 0.55, m1: 0.5, m2: 0.2 })
    .png()
    .toBuffer();

  const file = path.join(OUT, `${id}.webp`);
  await sharp({
    create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" },
  })
    .composite([{ input: resized, gravity: "center" }])
    .webp({ quality: 92, alphaQuality: 92, effort: 5 })
    .toFile(file);

  return { white, sourceSize: `${info.width}x${info.height}`, outputSize: "1000x1000" };
}

async function downloadOne(row) {
  const id = slugId(row);
  const candidates = [row.myntra.image, ...(row.myntra.images ?? [])].filter(
    (u, i, a) => u && a.indexOf(u) === i && /assets\.myntassets\.com/.test(u) && !u.includes("/banner"),
  );
  let lastError = null;
  for (const url of candidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length < 8000) throw new Error("too small");
        const meta = await processImage(buffer, id);
        manifest[id] = {
          id,
          brand: row.brand,
          model: row.model,
          productId: row.myntra.productId,
          product: row.myntra.product,
          source: url,
          ...meta,
        };
        fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
        return true;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  console.log(`FAIL ${id}: ${String(lastError).slice(0, 120)}`);
  return false;
}

let index = 0, ok = 0, failed = 0;
const workers = Array.from({ length: 6 }, async () => {
  while (index < todo.length) {
    const i = index++;
    const row = todo[i];
    const success = await downloadOne(row);
    if (success) ok++;
    else failed++;
    if ((ok + failed) % 25 === 0) console.log(`progress ${ok + failed}/${todo.length} ok=${ok} failed=${failed}`);
  }
});
await Promise.all(workers);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log("DONE", { ok, failed, total: todo.length, manifest: Object.keys(manifest).length });
