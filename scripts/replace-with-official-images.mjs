import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "tmp/watchfactory-processed");
const BACKUP = path.join(ROOT, "tmp/products-before-watchfactory");
const PROGRESS = path.join(ROOT, "tmp/extract/official-replace-progress.json");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(BACKUP, { recursive: true });

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/catalog.json"), "utf8"));
const byFile = new Map();
for (const w of catalog) {
  if (!w.image) continue;
  const file = w.image.split("/").pop();
  if (!byFile.has(file)) byFile.set(file, w);
}
const items = [...byFile.entries()];

const SKIP = new Set([
  "titan-rnu95219vm01.webp",
  "titan-10011ql01.webp",
  "fastrack-nu3297km01.webp",
  "fastrack-nu3297kl01.webp",
  "timex-tweg16722.webp",
  "timex-twel29100.webp",
  "fossil-es5341.webp",
  "michael-kors-mk8561.webp",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const modelVariants = (m) => {
  const n = norm(m);
  const out = new Set([n]);
  if (n.startsWith("NU")) out.add(n.slice(2));
  if (n.startsWith("NT")) out.add(n.slice(2));
  if (n.startsWith("RNU")) out.add(n.slice(3));
  if (n.startsWith("T")) out.add(n.slice(1));
  return [...out].filter((x) => x.length >= 4);
};
const brandOf = (v) => {
  const b = String(v || "").toLowerCase();
  if (b.includes("armani exchange") || b.includes("a|x")) return "Armani Exchange";
  if (b.includes("emporio")) return "Emporio Armani";
  if (b.includes("michael kors")) return "Michael Kors";
  if (b.includes("fossil")) return "Fossil";
  if (b.includes("fastrack")) return "Fastrack";
  if (b.includes("titan")) return "Titan";
  if (b.includes("timex")) return "Timex";
  return v;
};

const stats = {};
const replaced = [];
let processed = 0;
let failed = 0;

function bump(brand, key) {
  stats[brand] ??= { total: 0, queried: 0, matched: 0, replaced: 0 };
  stats[brand][key]++;
}

for (const [file, w] of items) {
  bump(w.brand, "total");
  if (SKIP.has(file)) continue;

  let products = null;
  for (let attempt = 0; attempt < 4 && !products; attempt++) {
    try {
      const u = `https://watchfactory.in/search/suggest.json?q=${encodeURIComponent(w.model)}&resources%5Btype%5D=product&resources%5Blimit%5D=5`;
      const res = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
      const text = await res.text();
      if (!res.ok || text.includes("local_rate_limited")) throw new Error("rate");
      const json = JSON.parse(text);
      products = json.resources?.results?.products ?? [];
      bump(w.brand, "queried");
    } catch {
      await sleep(1400 + attempt * 900);
    }
  }
  if (!products) {
    failed++;
    continue;
  }

  let chosen = null;
  for (const p of products) {
    if (brandOf(p.vendor) !== w.brand) continue;
    const hay = norm(`${p.title} ${p.handle} ${p.featured_image?.url}`);
    const modelHit = modelVariants(w.model).some((v) => hay.includes(v));
    const price = Number(p.price);
    const priceHit =
      Number.isFinite(price) &&
      [w.price, w.mrp].some((x) => x && Math.abs(price - x) / x < 0.35);
    if (modelHit) {
      chosen = p;
      break;
    }
    if (!chosen && priceHit) chosen = p;
  }
  if (!chosen) {
    await sleep(300);
    continue;
  }
  bump(w.brand, "matched");

  const imageUrl = chosen.featured_image?.url;
  if (!imageUrl) {
    await sleep(300);
    continue;
  }
  try {
    const res = await fetch(imageUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error("image " + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const outFile = path.join(OUT, file);
    await sharp(buf)
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .resize(1000, 1000, { fit: "contain", background: "#ffffff", kernel: "lanczos3" })
      .sharpen({ sigma: 0.4, m1: 0.3, m2: 0.1 })
      .webp({ quality: 92, effort: 5 })
      .toFile(outFile);
    if (!fs.existsSync(path.join(BACKUP, file))) {
      fs.copyFileSync(path.join(ROOT, "public/products", file), path.join(BACKUP, file));
    }
    bump(w.brand, "replaced");
    replaced.push({ file, brand: w.brand, model: w.model, title: chosen.title, imageUrl });
    processed++;
    if (processed % 25 === 0) {
      console.log("replaced", processed);
      fs.writeFileSync(PROGRESS, JSON.stringify({ processed, failed, stats, replaced }, null, 1));
    }
  } catch {
    failed++;
  }
  await sleep(300);
}

fs.writeFileSync(PROGRESS, JSON.stringify({ processed, failed, stats, replaced }, null, 1));
console.log(JSON.stringify({ processed, failed, stats, replacedCount: replaced.length }, null, 1));
