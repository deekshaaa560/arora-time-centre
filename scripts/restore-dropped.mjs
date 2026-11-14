/** Restore the 38 entries dropped by the faulty clasp rule: rebuild catalog rows
 * from listing pools + manifest, reprocess images from manifest.source (cached). */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT = path.join("public/products");
const DATA = path.join("tmp/stock-2026/myntra");
const CACHE = path.join("tmp/imgcache");
const CATALOG = path.join("src/data/catalog-final.json");
const MANIFEST = path.join(DATA, "brands-manifest.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IDS = [
  "citizen-nk0023-57l","citizen-nj0180-80x","citizen-nj0150-81z","citizen-nj0180-80m","citizen-nk0024-54x",
  "citizen-cit-23398586","citizen-au1060-51a","citizen-nk5020-58x","citizen-cit-43069535","citizen-cit-40072949",
  "casio-aeq-120w-9avdf","casio-a2358","casio-a2359","casio-g1615","casio-g1774","casio-g1781","casio-b239",
  "g-shock-gm-2100mf-5adr","g-shock-gm-2100bb-1adr","g-shock-g-5600ue-1dr","g-shock-gbd-200uu-9dr","g-shock-s140m-4adr",
  "g-shock-gbd-200-1dr","g-shock-gbd-200-9dr","g-shock-s2100-1adr","g-shock-g1698","g-shock-ga-900-1adr",
  "giordano-gi-36305772","giordano-gi-36305769","giordano-gz-50139-66","giordano-gi-7186208",
  "alba-al-47383415","sonata-nt7930pp01","sonata-nt8080sm01","sonata-sp80051km03w","earnshaw-es-8006-11",
  "alexandre-christie-3030galrgsl1","alexandre-christie-9205mclbrba",
];

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const existing = new Set(catalog.map((w) => w.id));

const pools = new Map();
for (const f of fs.readdirSync(DATA)) {
  if (!/^myntra-[a-z-]+\.json$/.test(f)) continue;
  for (const p of JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"))) pools.set(String(p.productId), p);
}

function genderOf(g) {
  const s = String(g || "").toLowerCase();
  return s === "men" ? "men" : s === "women" ? "women" : "unisex";
}
function specsOf(name) {
  const n = String(name).toLowerCase();
  const specs = {};
  if (/stainless steel strap|steel strap|metallic strap|link bracelet|bracelet/.test(n)) specs.strap = "Stainless steel";
  else if (/leather strap|genuine leather/.test(n)) specs.strap = "Leather";
  else if (/rubber|silicone/.test(n)) specs.strap = "Silicone";
  else if (/nylon|fabric|canvas/.test(n)) specs.strap = "Nylon";
  else if (/resin strap/.test(n)) specs.strap = "Resin";
  if (/analogue-?digital|analog-?digital/.test(n)) specs.movement = "Analogue-digital quartz";
  else if (/chronograph/.test(n)) specs.movement = "Chronograph quartz";
  else if (/analogue|analog/.test(n)) specs.movement = "Quartz (analogue)";
  else if (/digital/.test(n)) specs.movement = "Digital quartz";
  return specs;
}

async function processImage(buffer, id) {
  const base = await sharp(buffer).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  let trimmed = base;
  let info = await sharp(base).metadata();
  try {
    trimmed = await sharp(base).trim({ threshold: 8 }).png().toBuffer();
    info = await sharp(trimmed).metadata();
  } catch {}
  const scale = Math.min(940 / info.width, 940 / info.height);
  const resized = await sharp(trimmed)
    .resize(Math.max(1, Math.round(info.width * scale)), Math.max(1, Math.round(info.height * scale)), { fit: "inside", kernel: "lanczos3" })
    .sharpen({ sigma: 0.5, m1: 0.45, m2: 0.18 })
    .png()
    .toBuffer();
  const tmp = path.join(OUT, `${id}.webp.tmp.webp`);
  await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
    .composite([{ input: resized, gravity: "center" }])
    .webp({ quality: 92, alphaQuality: 92, effort: 5 })
    .toFile(tmp);
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.renameSync(tmp, path.join(OUT, `${id}.webp`));
      return true;
    } catch {
      await sleep(500 * (attempt + 1));
    }
  }
  return false;
}

async function load(url) {
  const key = Buffer.from(url).toString("base64url").slice(0, 80);
  const file = path.join(CACHE, key);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

let restored = 0;
const failed = [];
for (const id of IDS) {
  if (existing.has(id)) continue;
  const m = manifest[id];
  if (!m) {
    failed.push(`${id} (no manifest)`);
    continue;
  }
  const rec = pools.get(String(m.productId));
  const mrp = Number(rec?.mrp) || 0;
  const price = Number(rec?.price) || 0;
  if (!mrp || !price) {
    failed.push(`${id} (no price data)`);
    continue;
  }
  let ok = false;
  try {
    ok = await processImage(await load(m.source), id);
  } catch (e) {
    failed.push(`${id} (img ${String(e).slice(0, 60)})`);
    continue;
  }
  if (!ok) {
    failed.push(`${id} (locked)`);
    continue;
  }
  catalog.push({
    id,
    brand: m.brand,
    model: m.model,
    gender: genderOf(rec.gender),
    price,
    mrp,
    discount: mrp > price ? Math.round((1 - price / mrp) * 100) : 0,
    qty: null,
    fn: null,
    image: `/products/${id}.webp`,
    specs: specsOf(rec.product || ""),
  });
  restored++;
  await sleep(80);
}
catalog.sort((a, b) => 0); // keep append order
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + "\n");
console.log(`restored ${restored}/${IDS.length}; catalog ${catalog.length}`);
console.log("FAILED:", failed.join("\n") || "none");
