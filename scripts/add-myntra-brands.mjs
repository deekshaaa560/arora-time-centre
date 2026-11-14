/**
 * Add curated Myntra ranges for the 11 brands the store lists in-store but has
 * no distributor-sheet stock for (Citizen, Casio, G-Shock, DKNY, Kenneth Cole,
 * Giordano, Earnshaw, Alexandre Christie, Alba, Maxima, Sonata).
 *
 * Reads tmp/stock-2026/myntra/myntra-<key>.json produced by fetch-myntra-brands.mjs,
 * picks the most popular men's/women's models per brand, downloads and processes
 * images exactly like the Tommy Hilfiger import (white 1000x1000 webp) and appends
 * the entries to src/data/catalog-final.json. Prices/MRPs/discounts are the live
 * Myntra ones. Resumable via tmp/stock-2026/myntra/brands-manifest.json.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { classifyImage } from "./front-view.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const DATA = path.join(ROOT, "tmp/stock-2026/myntra");
const MANIFEST = path.join(DATA, "brands-manifest.json");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const PER_BRAND = Number(process.env.PER_BRAND || 32);
fs.mkdirSync(OUT, { recursive: true });

const KEYS = [
  { key: "citizen", brand: "Citizen", aliases: ["citizen"], prefix: "CIT" },
  { key: "casio", brand: "Casio", aliases: ["casio"], prefix: "CAS", nameMustNot: /g[\s-]?shock/i },
  { key: "gshock", brand: "G-Shock", aliases: ["casio"], prefix: "GS", nameMust: /g[\s-]?shock/i },
  { key: "dkny", brand: "DKNY", aliases: ["dkny"], prefix: "DK" },
  { key: "kenneth-cole", brand: "Kenneth Cole", aliases: ["kenneth cole", "kennethcole", "kenneth new york"], prefix: "KC" },
  { key: "giordano", brand: "Giordano", aliases: ["giordano", "giordano timepieces"], prefix: "GI" },
  { key: "earnshaw", brand: "Earnshaw", aliases: ["earnshaw", "thomas earnshaw"], prefix: "EA" },
  { key: "alexandre-christie", brand: "Alexandre Christie", aliases: ["alexandre christie", "alexandre-christie"], prefix: "AC" },
  { key: "alba", brand: "Alba", aliases: ["alba"], prefix: "AL" },
  { key: "maxima", brand: "Maxima", aliases: ["maxima"], prefix: "MX" },
  { key: "sonata", brand: "Sonata", aliases: ["sonata"], prefix: "SON" },
];

const slugify = (s) =>
  String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Product codes commonly appear in Myntra watch names (GA-2100-1A1, BN0152-51E, CG0270PP04W) */
function extractModel(name, productId, prefix) {
  const up = String(name).toUpperCase();
  const hits = up.match(/\b[A-Z]{1,4}[-\s]?\d{3,7}[A-Z0-9\/-]*\b/g) || [];
  let best = null;
  for (let h of hits) {
    h = h.replace(/\s+/g, "").replace(/-+$/, "");
    if (/^(MM|CM|ML|KG)$/.test(h.slice(-2))) continue;
    if (!best || h.length > best.length) best = h;
  }
  return best || `${prefix}-${productId}`;
}

function genderOf(g) {
  const s = String(g || "").toLowerCase();
  if (s === "men") return "men";
  if (s === "women") return "women";
  if (s === "unisex") return "unisex";
  return null; // kids / boys / girls excluded from the curated range
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
  else if (/analogue|analog/.test(n)) specs.movement = "Quartz (analogue)";
  else if (/digital/.test(n)) specs.movement = "Digital quartz";
  else if (/smart ?watch/.test(n)) specs.movement = "Smart watch";
  const wr = n.match(/\b(\d{2,3})\s?(?:m|meters|metres|atm)\b/);
  if (wr && Number(wr[1]) >= 30 && Number(wr[1]) <= 300 && !/square|round/.test(wr[0])) {
    specs.waterResistance = `${wr[1]} m`;
  }
  return specs;
}

/** Curate: most-rated in-stock Myntra listings, balanced men/women. */
function select(list, cfg) {
  const aliasSet = new Set(cfg.aliases);
  const seen = new Set();
  const pool = { men: [], women: [], unisex: [] };
  for (const p of list) {
    if (!aliasSet.has(String(p.sourceBrand || "").toLowerCase())) continue;
    if (cfg.nameMust && !cfg.nameMust.test(p.product)) continue;
    if (cfg.nameMustNot && cfg.nameMustNot.test(p.product)) continue;
    if (!/watch|timepiece/i.test(p.product) && !/watch/i.test(p.subCategory || "")) continue;
    const g = genderOf(p.gender);
    if (!g) continue;
    if (!p.price || !p.mrp || !p.image || !p.image.includes("myntassets")) continue;
    const model = extractModel(p.product, p.productId, cfg.prefix);
    const key = model.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pool[g].push({ ...p, model, gender: g });
  }
  for (const g of Object.keys(pool)) {
    pool[g].sort((a, b) => (b.ratingCount || 0) - (a.ratingCount || 0));
  }
  const wantM = Math.ceil(PER_BRAND / 2);
  const picked = [...pool.men.slice(0, wantM), ...pool.women.slice(0, PER_BRAND - Math.min(pool.men.length, wantM))];
  if (picked.length < PER_BRAND) picked.push(...pool.unisex.slice(0, PER_BRAND - picked.length));
  if (picked.length < PER_BRAND) picked.push(...pool.men.slice(wantM), ...pool.women.slice(PER_BRAND));
  return picked.slice(0, PER_BRAND);
}

/* ---------- image pipeline (same as source-tommy-images.mjs) ---------- */
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

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};

async function getImage(item, id) {
  // Myntra labels each gallery image with its view; the tagged "front" shot is
  // the dial, so it goes first, then the hero photo, then the rest. A listing
  // without labels (the Ajio range) falls back to the detector's own judgement.
  const tagged = (Array.isArray(item.front) ? item.front : []).filter(Boolean);
  const candidates = [...new Set([...tagged, item.image, ...(item.images || [])].filter(Boolean))].slice(0, 6);
  const scored = [];
  for (const url of candidates) {
    let buffer = null;
    for (let attempt = 0; attempt < 2 && !buffer; attempt++) {
      try {
        const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const b = Buffer.from(await res.arrayBuffer());
        if (b.length < 8000) throw new Error("small");
        buffer = b;
      } catch {
        await sleep(800 * (attempt + 1));
      }
    }
    if (!buffer) continue;
    let r;
    try {
      r = await classifyImage(buffer);
    } catch {
      r = { front: false, frontScore: 0, clean: 0 };
    }
    scored.push({ url, buffer, tagged: tagged.includes(url), ...r });
    if (r.front && r.clean >= 0.2 && tagged.includes(url)) break;
  }
  const pick = [...scored].sort(
    (a, b) =>
      (b.front ? 1 : 0) - (a.front ? 1 : 0) ||
      (b.tagged ? 1 : 0) - (a.tagged ? 1 : 0) ||
      Math.min(1, b.clean) - Math.min(1, a.clean) ||
      b.frontScore - a.frontScore,
  )[0];
  if (!pick) return false;
  try {
    const meta = await processImage(pick.buffer, id);
    manifest[id] = {
      brand: item.brand,
      model: item.model,
      productId: item.productId,
      source: pick.url,
      front: pick.front,
      ...meta,
    };
    return true;
  } catch {
    return false;
  }
}

/* ---------- main ---------- */
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const usedIds = new Set(catalog.map((w) => w.id));
const usedKeys = new Set(catalog.map((w) => `${w.brand.toLowerCase()}|${String(w.model).toLowerCase()}`));

const added = [];
const stats = {};
let index = 0;

for (const cfg of KEYS) {
  const file = path.join(DATA, `myntra-${cfg.key}.json`);
  if (!fs.existsSync(file)) {
    console.log(`SKIP ${cfg.brand}: no fetch file`);
    continue;
  }
  const list = JSON.parse(fs.readFileSync(file, "utf8"));
  const selected = select(list, cfg);
  fs.writeFileSync(path.join(DATA, `${cfg.key}-selection.json`), JSON.stringify(selected, null, 1));
  let ok = 0;
  for (const item of selected) {
    const key = `${cfg.brand.toLowerCase()}|${item.model.toLowerCase()}`;
    if (usedKeys.has(key)) continue;
    let id = `${slugify(cfg.brand)}-${slugify(item.model)}`;
    if (usedIds.has(id)) id = `${id}-${item.productId}`;
    if (manifest[id] && fs.existsSync(path.join(OUT, `${id}.webp`))) {
      ok++;
      usedIds.add(id);
      usedKeys.add(key);
      continue;
    }
    const got = await getImage(item, id);
    if (!got) {
      console.log(`FAIL img ${cfg.brand} ${item.model}`);
      continue;
    }
    // Myntra's own `discount` field is a rupee amount; the catalog stores a percentage
    const discount = item.mrp > item.price ? Math.round((1 - item.price / item.mrp) * 100) : 0;
    catalog.push({
      id,
      brand: cfg.brand,
      model: item.model,
      gender: item.gender,
      price: item.price,
      mrp: item.mrp,
      discount: discount > 0 ? discount : 0,
      qty: null,
      fn: null,
      image: `/products/${id}.webp`,
      specs: specsOf(item.product),
    });
    added.push(id);
    usedIds.add(id);
    usedKeys.add(key);
    ok++;
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
    await sleep(120);
    index++;
  }
  stats[cfg.brand] = { pool: list.length, selected: selected.length, added: ok };
  console.log(`OK ${cfg.brand}`, stats[cfg.brand]);
}

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + "\n");
console.log("DONE catalog", catalog.length, "added", added.length, stats);
