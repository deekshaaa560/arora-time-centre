/**
 * Alexandre Christie curation from Ajio (the brand is absent from Myntra and
 * the official Shopify store rate-limits this network hard).
 *
 * Fetches the Ajio search page, pulls products out of the embedded
 * window.__PRELOADED_STATE__ (grid.entities), processes images with the same
 * white 1000x1000 webp pipeline as the Myntra imports and appends entries to
 * src/data/catalog-final.json. price = Ajio offerPrice, mrp = list price.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/myntra/brands-manifest.json");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const NORM = path.join(ROOT, "tmp/stock-2026/myntra/myntra-alexandre-christie.json");
const PER_BRAND = Number(process.env.PER_BRAND || 32);
const UA = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "accept-language": "en-IN,en;q=0.9",
  accept: "text/html,application/xhtml+xml",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) =>
  String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function extractPreloaded(html) {
  const marker = "window.__PRELOADED_STATE__ = ";
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = i + marker.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(html.slice(start, j + 1));
  }
  return null;
}

async function fetchSearch() {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const url = `https://www.ajio.com/search/?text=${encodeURIComponent("alexandre christie watch")}${page > 1 ? `&page=${page}` : ""}`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const st = extractPreloaded(await res.text());
    const ents = st?.grid?.entities || {};
    const list = Object.values(ents).filter(
      (e) => String(e.fnlColorVariantData?.brandName || "").toLowerCase() === "alexandre christie"
    );
    if (!list.length) break;
    out.push(...list);
    await sleep(1500);
  }
  return out;
}

function toEntry(e) {
  const name = String(e.name || "");
  const m = name.match(/-\s*([A-Z0-9]{6,})\s*$/i);
  const model = m ? m[1].toUpperCase() : String(e.sellerSku || e.code);
  const gender = /women/i.test(name) ? "women" : /men/i.test(name) ? "men" : "unisex";
  const mrp = Number(e.price?.value) || 0;
  const price = Number(e.offerPrice?.value) || mrp;
  const img =
    (e.images || []).find((im) => im.format === "product" && im.url) ||
    (e.images || [])[0] ||
    {};
  return {
    brand: "Alexandre Christie",
    sourceBrand: e.fnlColorVariantData?.brandName || "Alexandre Christie",
    product: `Alexandre Christie ${name}`,
    gender,
    model,
    mrp,
    price,
    discount: mrp > price ? Math.round((1 - price / mrp) * 100) : 0,
    productId: String(e.code),
    url: `https://www.ajio.com${e.url || ""}`,
    image: img.url || "",
    images: (e.images || []).map((im) => im.url).filter(Boolean),
  };
}

/* image pipeline identical to add-myntra-brands.mjs */
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
  const scale = Math.min(940 / info.width, 940 / info.height);
  const resized = await sharp(trimmed)
    .resize(Math.max(1, Math.round(info.width * scale)), Math.max(1, Math.round(info.height * scale)), {
      fit: "inside",
      kernel: "lanczos3",
    })
    .sharpen({ sigma: 0.5, m1: 0.45, m2: 0.18 })
    .png()
    .toBuffer();
  await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
    .composite([{ input: resized, gravity: "center" }])
    .webp({ quality: 92, alphaQuality: 92, effort: 5 })
    .toFile(path.join(OUT, `${id}.webp`));
  return { sourceSize: `${info.width}x${info.height}`, outputSize: "1000x1000" };
}

async function main() {
  const raw = await fetchSearch();
  const list = raw.map(toEntry).filter((p) => p.price > 0 && p.image);
  fs.writeFileSync(NORM, JSON.stringify(list, null, 1));
  console.log("ajio AC listings:", list.length);

  const seen = new Set();
  const pool = { men: [], women: [], unisex: [] };
  for (const p of list) {
    const key = p.model.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pool[p.gender].push(p);
  }
  const wantM = Math.ceil(PER_BRAND / 2);
  const picked = [...pool.men.slice(0, wantM), ...pool.women.slice(0, PER_BRAND - Math.min(pool.men.length, wantM))];
  if (picked.length < PER_BRAND) picked.push(...pool.men.slice(wantM), ...pool.women.slice(wantM), ...pool.unisex);
  const selected = picked.slice(0, PER_BRAND);
  console.log("selected:", selected.length, { men: pool.men.length, women: pool.women.length });

  const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const usedIds = new Set(catalog.map((w) => w.id));
  const usedKeys = new Set(catalog.map((w) => `${w.brand.toLowerCase()}|${String(w.model).toLowerCase()}`));
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
  let ok = 0;
  for (const item of selected) {
    const key = `alexandre christie|${item.model.toLowerCase()}`;
    if (usedKeys.has(key)) continue;
    let id = `alexandre-christie-${slugify(item.model)}`;
    if (usedIds.has(id)) id = `${id}-${item.productId}`;
    if (!(manifest[id] && fs.existsSync(path.join(OUT, `${id}.webp`)))) {
      let done = false;
      for (const url of [item.image, ...item.images].slice(0, 3)) {
        if (done) break;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch(url, { headers: UA });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buffer = Buffer.from(await res.arrayBuffer());
            if (buffer.length < 8000) throw new Error("small");
            const meta = await processImage(buffer, id);
            manifest[id] = { brand: item.brand, model: item.model, productId: item.productId, source: url, ...meta };
            done = true;
            break;
          } catch {
            await sleep(900 * (attempt + 1));
          }
        }
      }
      if (!done) {
        console.log(`FAIL img ${item.model}`);
        continue;
      }
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
    }
    const specs = {};
    const n = item.product.toLowerCase();
    if (/leather/.test(n)) specs.strap = "Leather";
    else if (/rubber|silicone/.test(n)) specs.strap = "Silicone";
    else if (/steel|metal|chain/.test(n)) specs.strap = "Stainless steel";
    if (/chronograph/.test(n)) specs.movement = "Chronograph quartz";
    else if (/analog(?:ue)?\s*digital/.test(n)) specs.movement = "Analogue-digital quartz";
    else if (/digital/.test(n)) specs.movement = "Digital quartz";
    else if (/watch/.test(n)) specs.movement = "Quartz (analogue)";
    catalog.push({
      id,
      brand: "Alexandre Christie",
      model: item.model,
      gender: item.gender,
      price: item.price,
      mrp: item.mrp,
      discount: item.discount,
      qty: null,
      fn: null,
      image: `/products/${id}.webp`,
      specs,
    });
    usedIds.add(id);
    usedKeys.add(key);
    ok++;
    await sleep(250);
  }
  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + "\n");
  console.log("AC import done: added", ok, "catalog total", catalog.length);
}

await main();
