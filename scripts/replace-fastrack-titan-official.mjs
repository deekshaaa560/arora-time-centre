import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "tmp/brand-official-processed");
const BACKUP = path.join(ROOT, "tmp/products-before-brand-official");
const PROGRESS = path.join(ROOT, "tmp/extract/brand-official-progress.json");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(BACKUP, { recursive: true });

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/catalog.json"), "utf8"));
const active = new Map();
for (const w of catalog) {
  if (!w.image || !["Fastrack", "Titan"].includes(w.brand)) continue;
  const file = w.image.split("/").pop();
  if (!active.has(file)) active.set(file, w);
}

const SKIP = new Set([
  "titan-rnu95219vm01.webp",
  "titan-10011ql01.webp",
  "fastrack-nu3297km01.webp",
  "fastrack-nu3297kl01.webp",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function modelVariants(m) {
  const up = norm(m);
  const set = new Set([up]);
  const noLead = up.replace(/^[A-Z]+/, "");
  if (noLead.length >= 4) set.add(noLead);
  for (const p of ["NU", "NT", "RNU", "R", "NR", "NF", "NK", "NS", "ND", "SR"]) {
    if (up.startsWith(p)) {
      const s = up.slice(p.length);
      if (s.length >= 4) set.add(s);
    }
  }
  return [...set];
}

async function meanColor(buf) {
  const { data, info } = await sharp(buf)
    .resize(64, 64, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    const rr = data[i * 3], gg = data[i * 3 + 1], bb = data[i * 3 + 2];
    if (Math.min(rr, gg, bb) > 238) continue;
    r += rr; g += gg; b += bb; n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

async function officialBuffer(brand, model) {
  const base = brand === "Fastrack"
    ? "https://www.fastrack.in/on/demandware.static/-/Sites-titan-master-catalog/default/images/Fastrack/Catalog"
    : "https://www.titan.co.in/on/demandware.static/-/Sites-titan-master-catalog/default/images/Titan/Catalog";
  const exts = brand === "Fastrack" ? ["jpg", "png"] : ["png", "jpg"];
  for (const v of modelVariants(model)) {
    for (const ext of exts) {
      const url = `${base}/${encodeURIComponent(v)}_1.${ext}`;
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!res.ok) continue;
        const type = res.headers.get("content-type") || "";
        if (!type.startsWith("image/")) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 5000) continue;
        return { buf, url, variant: v, ext };
      } catch {}
    }
  }
  return null;
}

let replaced = 0;
let skippedColor = 0;
let missing = 0;
const log = [];

for (const [file, w] of active) {
  if (SKIP.has(file)) continue;
  if (fs.existsSync(path.join(OUT, file))) continue;
  const official = await officialBuffer(w.brand, w.model);
  if (!official) {
    missing++;
    continue;
  }

  let colorOk = true;
  if (w.brand === "Fastrack") {
    try {
      const current = fs.readFileSync(path.join(ROOT, "public/products", file));
      const [cr, cg, cb] = await meanColor(current);
      const [or, og, ob] = await meanColor(official.buf);
      const dist = Math.sqrt((cr - or) ** 2 + (cg - og) ** 2 + (cb - ob) ** 2);
      if (dist > 60) {
        colorOk = false;
        skippedColor++;
        log.push({ file, model: w.model, skipped: "color", dist: Math.round(dist), url: official.url });
      }
    } catch {}
  }

  if (colorOk) {
    try {
      if (!fs.existsSync(path.join(BACKUP, file))) {
        fs.copyFileSync(path.join(ROOT, "public/products", file), path.join(BACKUP, file));
      }
      await sharp(official.buf)
        .flatten({ background: "#ffffff" })
        .removeAlpha()
        .resize(1000, 1000, { fit: "contain", background: "#ffffff", kernel: "lanczos3" })
        .webp({ quality: 92, effort: 6 })
        .toFile(path.join(OUT, file));
      replaced++;
      log.push({ file, model: w.model, url: official.url });
      if (replaced % 25 === 0) {
        console.log("official", replaced, "missing", missing, "colorSkip", skippedColor);
        fs.writeFileSync(PROGRESS, JSON.stringify({ replaced, missing, skippedColor, log }, null, 1));
      }
    } catch {
      missing++;
    }
  }
  await sleep(120);
}

fs.writeFileSync(PROGRESS, JSON.stringify({ replaced, missing, skippedColor, log }, null, 1));
console.log(JSON.stringify({ total: active.size, replaced, missing, skippedColor }, null, 1));
