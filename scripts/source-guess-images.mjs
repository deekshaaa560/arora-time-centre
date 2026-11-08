import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/guess-images.json");
fs.mkdirSync(OUT, { recursive: true });

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const rows = JSON.parse(fs.readFileSync("tmp/stock-2026/coverage.json", "utf8")).filter(
  (r) => r.brand === "GUESS",
);
const slugify = (s) =>
  String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const idOf = (r) => `${slugify(r.brand)}-${slugify(r.model)}`;
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const todo = rows.filter((r) => !manifest[idOf(r)]);
console.log("Guess rows", rows.length, "todo", todo.length);

async function suggest(model) {
  const url = `https://guesswatches.com/search/suggest.json?q=${encodeURIComponent(model)}&resources%5Btype%5D=product&resources%5Blimit%5D=5`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      if (res.status === 429) throw new Error("429");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return j.resources?.results?.products ?? [];
    } catch (e) {
      if (attempt === 3) return [];
      await sleep(4000 * (attempt + 1));
    }
  }
  return [];
}

function genderOf(product) {
  const s = `${product.title} ${(product.tags ?? []).join(" ")}`.toLowerCase();
  if (/\b(ladies|women|womens|female)\b/.test(s)) return "women";
  if (/\b(mens|men|male)\b/.test(s)) return "men";
  return null;
}

async function processImage(buffer, id) {
  const base = await sharp(buffer).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  let trimmed = base;
  let info = await sharp(base).metadata();
  try {
    trimmed = await sharp(base).trim({ threshold: 8 }).png().toBuffer();
    info = await sharp(trimmed).metadata();
  } catch {
    /* keep untrimmed */
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

async function sourceOne(row) {
  const id = idOf(row);
  const model = row.model.toUpperCase();
  const products = await suggest(model);
  const key = norm(model);
  const hit = products.find((p) => {
    const hay = norm(`${p.title} ${p.handle} ${p.image}`);
    return hay.includes(key);
  });
  if (!hit?.image) return false;

  const imageUrl = `${hit.image}${hit.image.includes("?") ? "&" : "?"}width=2400`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(imageUrl, { headers: { "user-agent": "Mozilla/5.0" } });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.startsWith("image/")) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 8000) throw new Error("small image");
      const meta = await processImage(buffer, id);
      manifest[id] = {
        id,
        brand: row.brand,
        model: row.model,
        title: hit.title,
        handle: hit.handle,
        genderGuess: genderOf(hit),
        source: hit.image,
        ...meta,
      };
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
      return true;
    } catch (e) {
      if (attempt === 2) return false;
      await sleep(1500 * (attempt + 1));
    }
  }
  return false;
}

let index = 0, ok = 0, miss = 0;
const workers = Array.from({ length: 2 }, async () => {
  while (index < todo.length) {
    const row = todo[index++];
    if (await sourceOne(row)) ok++;
    else {
      miss++;
      console.log(`MISS ${row.model}`);
    }
    if ((ok + miss) % 10 === 0) console.log(`progress ${ok + miss}/${todo.length} ok=${ok} miss=${miss}`);
    await sleep(350);
  }
});
await Promise.all(workers);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log("DONE", { ok, miss, total: todo.length, manifest: Object.keys(manifest).length });
