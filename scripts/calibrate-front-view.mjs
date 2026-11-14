/**
 * Calibration sheet for the front-view detector: shows every image the retailer
 * listings hold for a handful of watches with the detector's numbers under each,
 * so the thresholds in scripts/front-view.mjs can be checked by eye.
 *
 *   node scripts/calibrate-front-view.mjs --ids=citizen-nj0180-80x,giordano-a2037-77
 *   node scripts/calibrate-front-view.mjs --sample=10   # 10 random SKUs
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { classifyImage } from "./front-view.mjs";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "tmp/stock-2026/myntra");
const CACHE = path.join(ROOT, "tmp/imgcache");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const MANIFEST = path.join(DATA, "brands-manifest.json");
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const BRANDS = {
  citizen: "Citizen",
  casio: "Casio",
  gshock: "G-Shock",
  dkny: "DKNY",
  "kenneth-cole": "Kenneth Cole",
  giordano: "Giordano",
  earnshaw: "Earnshaw",
  sonata: "Sonata",
  alba: "Alba",
  maxima: "Maxima",
  "alexandre-christie": "Alexandre Christie",
  tommy: "Tommy Hilfiger",
};

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const pool = new Map(); // model or productId -> listing record
for (const [key, brand] of Object.entries(BRANDS)) {
  const file = path.join(DATA, `myntra-${key}.json`);
  if (!fs.existsSync(file)) continue;
  for (const p of JSON.parse(fs.readFileSync(file, "utf8"))) {
    const model = String(p.model || "").toUpperCase();
    if (model) pool.set(`${brand}|${model}`, p);
    pool.set(`${brand}|${p.productId}`, p);
  }
}

async function cachedFetch(url) {
  // NOTE: a truncated base64 of the URL is not a key — retailer CDN URLs share a
  // long prefix, so every image of a product collided onto one cache entry.
  const key = createHash("sha1").update(url).digest("hex");
  const file = path.join(CACHE, key);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 6000) return null;
  fs.writeFileSync(file, buf);
  return buf;
}

const byId = new Map(catalog.map((w) => [w.id, w]));
let ids = arg("ids") ? arg("ids").split(",").map((s) => s.trim()) : [];
if (!ids.length) {
  const n = Number(arg("sample", "8"));
  const withPool = catalog.filter((w) => pool.has(`${w.brand}|${String(w.model).toUpperCase()}`));
  const step = Math.max(1, Math.floor(withPool.length / n));
  ids = withPool.filter((_, i) => i % step === 0).slice(0, n).map((w) => w.id);
}

const cells = [];
for (const id of ids) {
  const w = byId.get(id);
  if (!w) continue;
  const rec =
    pool.get(`${w.brand}|${String(w.model).toUpperCase()}`) ||
    (manifest[id]?.productId != null ? pool.get(`${w.brand}|${manifest[id].productId}`) : null);
  const urls = [...new Set([...(rec?.images || []).filter((u) => /^https?:/.test(u)), ...(rec?.image ? [rec.image] : [])])];
  console.log(`\n${w.brand} ${w.model} (${urls.length} listing images)`);
  for (const [i, url] of urls.entries()) {
    const buf = await cachedFetch(url);
    if (!buf) {
      console.log(`  #${i} fetch-fail ${url.slice(-40)}`);
      continue;
    }
    let r;
    try {
      r = await classifyImage(buf);
    } catch (e) {
      console.log(`  #${i} error ${e.message.slice(0, 40)}`);
      continue;
    }
    console.log(
      `  #${i} ${r.front ? "FRONT " : "no    "} score=${String(r.frontScore).padEnd(5)} r=${String(r.radius).padStart(3)} det=${String(r.detail).padEnd(5)} dark=${String(r.darkFrac).padEnd(5)} ring=${String(r.ring).padEnd(5)} mk=${String(r.twelve).padEnd(5)} sk=${String(r.skinFrac).padEnd(5)}/${String(r.skinTex).padEnd(5)} brt=${r.bright} clean=${r.clean} ${r.reason}`,
    );
    cells.push({ id, url, idx: i, ...r, buffer: buf });
  }
}

const CW = 170;
const CH = 208;
const COLS = 8;
const rowsN = Math.ceil(cells.length / COLS);
const composites = [];
for (let i = 0; i < cells.length; i++) {
  const c = cells[i];
  const x = (i % COLS) * CW;
  const y = Math.floor(i / COLS) * CH;
  composites.push({
    input: await sharp(c.buffer).resize(CW - 12, CH - 46, { fit: "contain", background: "#ffffff" }).png().toBuffer(),
    left: x + 6,
    top: y + 4,
  });
  const svg = `<svg width="${CW}" height="40"><rect width="${CW}" height="40" fill="${c.front ? "#0f1720" : "#7f1d1d"}"/><text x="4" y="12" font-family="monospace" font-size="10" fill="#fff">${c.id.slice(0, 24)} #${c.idx}</text><text x="4" y="24" font-family="monospace" font-size="10" fill="#ffd">${c.front ? "FRONT" : c.reason} s=${c.frontScore} r=${c.radius}</text><text x="4" y="36" font-family="monospace" font-size="10" fill="#adf">d=${c.detail} k=${c.darkFrac} g=${c.ring}</text></svg>`;
  composites.push({ input: Buffer.from(svg), left: x, top: y + CH - 42 });
}
const out = path.join(ROOT, "tmp/front-calib.png");
await sharp({ create: { width: COLS * CW, height: rowsN * CH, channels: 3, background: "#111" } })
  .composite(composites)
  .png()
  .toFile(out);
console.log(`\nsheet -> tmp/front-calib.png (${cells.length} tiles)`);
