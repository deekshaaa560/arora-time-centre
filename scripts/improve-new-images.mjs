/**
 * Clarity pass for the 11 curated (Myntra/Ajio) brands.
 *
 * For every imported watch, download up to 4 candidate images from the source
 * listing, run the same white-1000x1000 pipeline in memory, and score the
 * result: product-on-white photos win; dark lifestyle shots, promo cards and
 * overlay bars ("TAP TO INSPECT", inset rectangles) lose. Reprocess the best
 * candidate into public/products when it beats the current file.
 *
 *   node scripts/improve-new-images.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { classifyCanvas } from "./front-view.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const DATA = path.join(ROOT, "tmp/stock-2026/myntra");
const CACHE = path.join(ROOT, "tmp/imgcache");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const MANIFEST = path.join(DATA, "brands-manifest.json");
const DRY = process.argv.includes("--dry");
fs.mkdirSync(CACHE, { recursive: true });

const BRANDS = [
  { key: "citizen", brand: "Citizen" },
  { key: "casio", brand: "Casio" },
  { key: "gshock", brand: "G-Shock" },
  { key: "dkny", brand: "DKNY" },
  { key: "kenneth-cole", brand: "Kenneth Cole" },
  { key: "giordano", brand: "Giordano" },
  { key: "earnshaw", brand: "Earnshaw" },
  { key: "sonata", brand: "Sonata" },
  { key: "alba", brand: "Alba" },
  { key: "maxima", brand: "Maxima" },
  { key: "alexandre-christie", brand: "Alexandre Christie" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) =>
  String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/* ---------- scoring pipeline (in-memory version of the import pipeline) ---------- */
async function normalize(buffer) {
  const base = await sharp(buffer).rotate().flatten({ background: "#ffffff" }).resize(800, 800, { fit: "inside" }).png().toBuffer();
  let trimmed = base;
  try {
    trimmed = await sharp(base).trim({ threshold: 8 }).png().toBuffer();
  } catch {
    /* uniform */
  }
  const info = await sharp(trimmed).metadata();
  const scale = Math.min(760 / info.width, 760 / info.height);
  const resized = await sharp(trimmed)
    .resize(Math.max(1, Math.round(info.width * scale)), Math.max(1, Math.round(info.height * scale)), { fit: "inside" })
    .png()
    .toBuffer();
  const canvas = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#ffffff" } })
    .composite([{ input: resized, gravity: "center" }])
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return canvas; // {data, info: {width 800 height 800 channels 3}}
}

function components(mask, W, H) {
  const labels = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || labels[i] >= 0) continue;
    const id = comps.length;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = id;
    let area = 0;
    let minX = W, maxX = 0, minY = H, maxY = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % W;
      const y = (p - x) / W;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (mask[q] && labels[q] < 0) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
    }
    comps.push({ id, area, minX, minY, maxX, maxY });
  }
  return { labels, comps };
}

function scoreCanvas({ data, info }) {
  const { width: W, height: H, channels: ch } = info;
  const lum = new Float32Array(W * H);
  let dark = 0;
  let white = 0;
  for (let i = 0; i < W * H; i++) {
    const o = i * ch;
    const l = (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000;
    lum[i] = l;
    if (l < 80) dark++;
    if (l >= 244) white++;
  }
  let ring = 0;
  let ringN = 0;
  const R = 12;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (x < R || y < R || x >= W - R || y >= H - R) {
        ringN++;
        if (lum[y * W + x] < 244) ring++;
      }
    }
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = lum[i] < 250 ? 1 : 0;
  const { comps } = components(mask, W, H);
  comps.sort((a, b) => b.area - a.area);
  const main = comps[0] || { area: 0 };
  const imgArea = W * H;
  let overlay = 0;
  for (const c of comps.slice(1)) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    const fill = c.area / (bw * bh);
    const aspect = bw / bh;
    if (c.area > imgArea * 0.03) continue; // big second object (e.g. box)
    if (aspect > 5) overlay += 0.35; // promo text bar
    else if (fill < 0.3 && Math.abs(aspect - 1) < 0.6) overlay += 0.35; // inset outline square
    else if (c.area > 30) overlay += 0.08; // stray mark / small badge
  }
  const big = comps.filter((c) => c.area > imgArea * 0.03).length; // multiple large objects (box/lid)
  const whiteFrac = white / imgArea;
  return whiteFrac * 1.0 - (dark / imgArea) * 2.5 - (ring / Math.max(1, ringN)) * 4 - overlay - Math.max(0, big - 1) * 0.3 + (main.area / imgArea) * 0.4;
}

/* ---------- real 1000x1000 pipeline for the winner ---------- */
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

async function cachedFetch(url) {
  // A truncated base64 of the URL is not a key: retailer CDN URLs share a long
  // prefix, so every photo of a product collided onto one cache entry and the
  // pass scored one image while saving a different one.
  const key = createHash("sha1").update(url).digest("hex");
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

/* ---------- main ---------- */
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const byKey = {};
for (const { key } of BRANDS) {
  const list = JSON.parse(fs.readFileSync(path.join(DATA, `myntra-${key}.json`), "utf8"));
  byKey[key] = new Map();
  for (const p of list) {
    const model = String(p.model || "").toUpperCase();
    if (model) byKey[key].set(model, p);
    byKey[key].set(String(p.productId), p);
  }
}
// gshock entries live in gshock + casio files under CASIO sourceBrand; casio file has everything from its query
const brandFile = Object.fromEntries(BRANDS.map((b) => [b.brand, b.key]));

function candidatesFor(w) {
  const key = brandFile[w.brand];
  const pool = byKey[key] || new Map();
  let rec = pool.get(String(w.model).toUpperCase());
  if (!rec && manifest[w.id]?.productId != null) rec = pool.get(String(manifest[w.id].productId));
  const urls = [];
  const cur = manifest[w.id]?.source;
  if (rec?.images?.length) urls.push(...rec.images.filter((u) => /^https?:\/\//.test(u)));
  if (rec?.image && /^https?:\/\//.test(rec.image)) urls.unshift(rec.image);
  return [...new Set(urls)].filter((u) => u !== cur).slice(0, 4);
}

let improved = 0;
let scanned = 0;
const flagged = [];
for (const w of catalog) {
  if (!brandFile[w.brand] || !w.image) continue;
  scanned++;
  const file = path.join(OUT, path.basename(w.image));
  if (!fs.existsSync(file)) continue;
  // Compare RAW source vs RAW alternates: processed webp scores systematically
  // lower than raw (ring artifacts), which would cause endless A/B ping-pong.
  let curScore;
  const curSrc = manifest[w.id]?.source;
  const curRaw = curSrc ? await cachedFetch(curSrc) : null;
  const curCanvas = await normalize(curRaw ?? (await sharp(file).webp({ quality: 90 }).toBuffer()));
  curScore = scoreCanvas(curCanvas);
  // Wrong angle is not a clarity problem: scripts/fix-front-views.mjs re-picks
  // those from the listing, so leave them alone here.
  if (!classifyCanvas(curCanvas).front) {
    flagged.push(`${w.brand} ${w.model} not a front view -> fix-front-views`);
    continue;
  }
  const cands = candidatesFor(w);
  let best = { url: "CURRENT", score: curScore + 0.05 }; // require a margin to replace
  for (const url of cands) {
    const buf = await cachedFetch(url);
    if (!buf) continue;
    try {
      const canvas = await normalize(buf);
      const s = scoreCanvas(canvas);
      // Clarity only ever picks a front view: never swap a readable dial for a
      // polished flank, which is how side profiles crept in before.
      if (!classifyCanvas(canvas).front) continue;
      if (s > best.score) best = { url, score: s };
    } catch {
      /* skip */
    }
    await sleep(60);
  }
  const rel = best.score - curScore;
  if (curScore < 0.35) flagged.push(`${w.brand} ${w.model} score=${curScore.toFixed(2)} best=${best.score.toFixed(2)} ${best.url === "CURRENT" ? "(no alt)" : "replace"}`);
  if (best.url !== "CURRENT" && rel > 0.06) {
    improved++;
    console.log(`IMPROVE ${w.brand} ${w.model} ${curScore.toFixed(2)} -> ${best.score.toFixed(2)} ${best.url.slice(0, 110)}`);
    if (!DRY) {
      const buf = await cachedFetch(best.url);
      if (buf) {
        const ok = await processImage(buf, w.id);
        if (ok) {
          manifest[w.id] = { ...(manifest[w.id] || {}), brand: w.brand, model: w.model, source: best.url, improved: true };
        }
      }
    }
  }
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log(`scanned ${scanned}, improved ${improved} (dry=${DRY})`);
console.log("--- low-score inventory ---");
console.log(flagged.join("\n"));
