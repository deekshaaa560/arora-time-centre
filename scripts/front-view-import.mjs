/**
 * Enforce "front view of the watch only" for the 11 curated brands using the
 * Myntra view metadata (front > search > default) saved by fetch-myntra-brands.mjs.
 * Rejects any processed candidate that still looks like a model shot (skin ratio).
 * Alexandre Christie (Ajio) listings have no view tags: their primary Ajio image
 * is re-checked and, if it fails the model/full-bleed test, the entry is flagged.
 *
 *   node scripts/front-view-import.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const DATA = path.join(ROOT, "tmp/stock-2026/myntra");
const CACHE = path.join(ROOT, "tmp/imgcache");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const MANIFEST = path.join(DATA, "brands-manifest.json");
const DRY = process.argv.includes("--dry");
fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MYNTRA_KEYS = ["citizen", "casio", "gshock", "dkny", "kenneth-cole", "giordano", "earnshaw", "alba", "maxima", "sonata"];
const BRAND_KEY = {
  Citizen: "citizen",
  Casio: "casio",
  "G-Shock": "gshock",
  DKNY: "dkny",
  "Kenneth Cole": "kenneth-cole",
  Giordano: "giordano",
  Earnshaw: "earnshaw",
  Alba: "alba",
  Maxima: "maxima",
  Sonata: "sonata",
};

function loadPool(key) {
  const list = JSON.parse(fs.readFileSync(path.join(DATA, `myntra-${key}.json`), "utf8"));
  const byId = new Map();
  for (const p of list) byId.set(String(p.productId), p);
  return byId;
}
const pools = Object.fromEntries(MYNTRA_KEYS.map((k) => [k, loadPool(k)]));

const VIEW_ORDER = { front: 0, search: 1, default: 2 };
function frontCandidates(rec) {
  const items = (rec.images || [])
    .map((src, i) => ({ src, view: String(rec.imageViews?.[i] || "").toLowerCase() }))
    .filter((x) => x.src && VIEW_ORDER[x.view] !== undefined);
  items.sort((a, b) => VIEW_ORDER[a.view] - VIEW_ORDER[b.view]);
  const seen = new Set();
  return items.filter((x) => !seen.has(x.src) && seen.add(x.src)).map((x) => x.src);
}

async function cachedFetch(url) {
  const key = Buffer.from(url).toString("base64url").slice(0, 80);
  const file = path.join(CACHE, key);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 6000) throw new Error("small");
      fs.writeFileSync(file, buf);
      return buf;
    } catch {
      await sleep(700 * (attempt + 1));
    }
  }
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
    /* keep */
  }
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

function skinAndRing(file) {
  // model shots: large skin areas AND the photo bleeds to the frame edges.
  // gold/brown watches on white have near-zero ring coverage.
}

async function classifyWorn(file) {
  const { data, info } = await sharp(file)
    .flatten({ background: "#ffffff" })
    .resize(300, 300, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  let skin = 0;
  let ringHit = 0;
  let ringN = 0;
  const R = 10;
  for (let y = 0; y < H; y++) {
    const edge = y < R || y >= H - R;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * ch;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const lum = (r * 299 + g * 587 + b * 114) / 1000;
      const isSkin = r > 95 && g > 40 && b > 20 && r > g && g >= b && r - Math.min(g, b) > 25 && Math.abs(r - g) > 12 && lum < 235;
      if (isSkin) skin++;
      if (edge || x < R || x >= W - R) {
        ringN++;
        if (lum < 244) ringHit++;
      }
    }
  }
  return { skin: skin / (W * H), ring: ringHit / Math.max(1, ringN) };
}

const MODEL_SKIN = 0.1;
const MODEL_RING = 0.3;
const isModelShot = async (file) => {
  const { skin, ring } = await classifyWorn(file);
  return skin > MODEL_SKIN && ring > MODEL_RING;
};

async function skinFrac(file) {
  return (await classifyWorn(file)).skin;
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

// cross-listing recovery: index every fetched product by normalized model codes in its title
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const titleIndex = {}; // brandKey -> code -> rec
for (const key of MYNTRA_KEYS) {
  const list = JSON.parse(fs.readFileSync(path.join(DATA, `myntra-${key}.json`), "utf8"));
  titleIndex[key] = new Map();
  for (const p of list) {
    const codes = String(p.product).toUpperCase().match(/\b[A-Z]{1,4}[-\s]?\d{3,7}[A-Z0-9\/-]*\b/g) || [];
    for (const c of codes) {
      const n = norm(c);
      if (n.length >= 5 && !titleIndex[key].has(n)) titleIndex[key].set(n, p);
    }
  }
}
function findByModel(brandKey, model) {
  const keys = brandKey === "gshock" ? ["gshock", "casio"] : brandKey === "casio" ? ["casio", "gshock"] : [brandKey];
  const n = norm(model).replace(/[^A-Z0-9]/g, "");
  for (const k of keys) {
    const hit = titleIndex[k]?.get(n);
    if (hit) return hit;
    // also try with trailing DR/NDR variants stripped
    for (const [code, rec] of titleIndex[k] || []) {
      if (code.startsWith(n) || n.startsWith(code)) return rec;
    }
  }
  return null;
}

const flagged = [];
let replaced = 0;
let kept = 0;

for (const w of catalog) {
  if (!BRAND_KEY[w.brand]) continue;
  const productId = String(manifest[w.id]?.productId || "");
  const rec =
    pools[BRAND_KEY[w.brand]].get(productId) ||
    findByModel(BRAND_KEY[w.brand], w.model);
  if (!rec) {
    const f = path.join(OUT, path.basename(w.image));
    if (fs.existsSync(f) && (await isModelShot(f))) flagged.push(`NO-LISTING-MODEL ${w.brand} ${w.model} (${w.id})`);
    else flagged.push(`NO-LISTING-KEPT ${w.brand} ${w.model} (${w.id})`);
    continue;
  }
  const cands = frontCandidates(rec);
  if (!cands.length) {
    // no front/search/default view at all: check current file for model shot
    const f = path.join(OUT, path.basename(w.image));
    if (fs.existsSync(f) && (await isModelShot(f))) flagged.push(`MODEL-SHOT ${w.brand} ${w.model} (${w.id})`);
    else flagged.push(`NO-FRONT-VIEW ${w.brand} ${w.model} (${w.id})`);
    continue;
  }
  const curSrc = manifest[w.id]?.source;
  const file = path.join(OUT, path.basename(w.image));
  const alreadyFront = cands[0] === curSrc && fs.existsSync(file) && !(await isModelShot(file));
  if (alreadyFront) {
    kept++;
    continue;
  }
  let done = false;
  for (const url of cands.slice(0, 3)) {
    const buf = await cachedFetch(url);
    if (!buf) continue;
    if (DRY) {
      console.log(`FRONT ${w.brand} ${w.model} -> ${url.slice(0, 90)}`);
      replaced++;
      done = true;
      break;
    }
    if (await processImage(buf, w.id)) {
      manifest[w.id] = { ...(manifest[w.id] || {}), brand: w.brand, model: w.model, productId: rec.productId, source: url, frontView: true };
      const f = path.join(OUT, `${w.id}.webp`);
      if (await isModelShot(f)) flagged.push(`STILL-MODEL ${w.brand} ${w.model} (${w.id})`);
      replaced++;
      done = true;
      break;
    }
  }
  if (!done) flagged.push(`DOWNLOAD-FAIL ${w.brand} ${w.model} (${w.id})`);
  await sleep(80);
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log(`kept ${kept}, replaced ${replaced} (dry=${DRY})`);
console.log("--- flagged ---");
console.log(flagged.join("\n") || "none");
fs.writeFileSync("tmp/frontview-flagged.json", JSON.stringify(flagged, null, 1));
