/**
 * Repair pass for curated-brand entries whose original Myntra listing got
 * delisted (image currently shows caseback / side / lifestyle). Searches
 * Myntra by the model code, finds a live listing of the same brand carrying
 * that code, and swaps in its `front` view image.
 *
 *   node scripts/fix-delisted.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const DATA = path.join(ROOT, "tmp/stock-2026/myntra");
const CACHE = path.join(ROOT, "tmp/imgcache");
const MANIFEST = path.join(DATA, "brands-manifest.json");
const DRY = process.argv.includes("--dry");
fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36", accept: "text/html" };

const TARGETS = [
  { id: "citizen-bi5120-51l", brand: "Citizen", aliases: ["citizen"] },
  { id: "casio-d320", brand: "Casio", aliases: ["casio"] },
  { id: "casio-a2436", brand: "Casio", aliases: ["casio"] },
  { id: "kenneth-cole-kc-36529846", brand: "Kenneth Cole", aliases: ["kenneth cole", "kenneth cole new york", "kenneth cole reactions"] },
  { id: "kenneth-cole-kc-27059810", brand: "Kenneth Cole", aliases: ["kenneth cole", "kenneth cole new york"] },
  { id: "alba-al4321x1", brand: "Alba", aliases: ["alba"] },
  { id: "alba-av3581x1", brand: "Alba", aliases: ["alba"] },
  { id: "alba-au4057x1", brand: "Alba", aliases: ["alba"] },
  { id: "alba-au4051x1", brand: "Alba", aliases: ["alba"] },
  { id: "alba-al4539x1", brand: "Alba", aliases: ["alba"] },
  { id: "alba-al-34044570", brand: "Alba", aliases: ["alba"] },
  { id: "sonata-nt77083sl06w", brand: "Sonata", aliases: ["sonata"] },
  { id: "sonata-nt7987sl01w", brand: "Sonata", aliases: ["sonata"] },
  { id: "sonata-nt77118pp01w", brand: "Sonata", aliases: ["sonata"] },
  { id: "sonata-nt87018yl03w", brand: "Sonata", aliases: ["sonata"] },
  { id: "sonata-nt8096ym02", brand: "Sonata", aliases: ["sonata"] },
  { id: "sonata-nt8096ym04", brand: "Sonata", aliases: ["sonata"] },
];

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/catalog-final.json"), "utf8"));
const byId = new Map(catalog.map((w) => [w.id, w]));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

// real model codes from the selection files (catalog model may be a synthetic PREFIX-productId)
const codesByProduct = {};
for (const file of fs.readdirSync(DATA)) {
  if (!file.endsWith("-selection.json")) continue;
  for (const p of JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"))) {
    codesByProduct[String(p.productId)] = p;
  }
}

function searchCode(t) {
  const rec = codesByProduct[String(manifest[t.id]?.productId)];
  const fromTitle = String(rec?.product || "").toUpperCase().match(/\b[A-Z]{2,4}[-\s]?\d{3,}[A-Z0-9\/-]*\b/g) || [];
  const cat = String(byId.get(t.id)?.model || "").toUpperCase();
  const cands = [...fromTitle.filter((c) => c.replace(/[^A-Z0-9]/g, "").length >= 6), cat.replace(/\s+/g, "")];
  return cands.filter((c) => !/^KC?-?\d{8}$|^CAS-|^CIT-|^AL-\d{8}$/.test(c)) || [];
}

function extractMyx(html) {
  const marker = "window.__myx = ";
  const i = html.indexOf(marker);
  if (i < 0) return null;
  let chunk = html.slice(i + marker.length, html.indexOf("</script>", i)).trimEnd();
  if (chunk.endsWith(";")) chunk = chunk.slice(0, -1);
  try {
    return JSON.parse(chunk);
  } catch {
    return null;
  }
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

let fixed = 0;
const failed = [];
for (const t of TARGETS) {
  const w = byId.get(t.id);
  const cands = searchCode(t);
  const code = (cands || [])[0];
  if (!code) {
    failed.push(`${t.id} (no code found: tried ${JSON.stringify(cands)})`);
    continue;
  }
  let hit = null;
  try {
    const res = await fetch(`https://www.myntra.com/${encodeURIComponent(code)}`, { headers: UA });
    const myx = extractMyx(await res.text());
    const prods = myx?.searchData?.results?.products || [];
    for (const p of prods) {
      const brandOk = t.aliases.includes(String(p.brand || "").toLowerCase());
      const codeOk = String(p.product || "").toUpperCase().includes(code.slice(0, 8));
      const front = (p.images || []).find((im) => String(im.view || "").toLowerCase() === "front") ||
        (p.images || []).find((im) => String(im.view || "").toLowerCase() === "default");
      if (brandOk && codeOk && front?.src) {
        hit = { src: front.src.replace(/^http:/, "https:"), name: p.product, id: p.productId };
        break;
      }
    }
  } catch (e) {
    console.log(`ERR ${t.id}: ${String(e).slice(0, 100)}`);
  }
  if (!hit) {
    failed.push(`${t.id} (code ${code}: no matching live listing)`);
    await sleep(1200);
    continue;
  }
  if (DRY) {
    console.log(`DRY ${t.id} <- ${hit.src.slice(0, 90)}`);
    fixed++;
  } else {
    try {
      const res = await fetch(hit.src, { headers: { "user-agent": "Mozilla/5.0" } });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 6000) throw new Error("small");
      if (await processImage(buf, t.id)) {
        manifest[t.id] = { ...(manifest[t.id] || {}), brand: w.brand, model: w.model, productId: hit.id, source: hit.src, frontView: true, delistedRepair: true };
        fixed++;
        console.log(`FIX ${t.id} <- ${hit.name.slice(0, 60)}`);
      } else failed.push(`${t.id} (locked)`);
    } catch (e) {
      failed.push(`${t.id} (download: ${String(e).slice(0, 60)})`);
    }
  }
  await sleep(1200);
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log(`fixed ${fixed}/${TARGETS.length}`);
console.log("FAILED:\n" + (failed.join("\n") || "none"));
