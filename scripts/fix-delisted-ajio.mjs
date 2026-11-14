/**
 * Second repair pass for delisted Myntra models: search Ajio by the real model
 * code (extracted from the saved selection titles) and use Ajio's primary
 * product image (always a front cutout) via the standard white-1000x1000 pipeline.
 *
 *   node scripts/fix-delisted-ajio.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const DATA = path.join(ROOT, "tmp/stock-2026/myntra");
const MANIFEST = path.join(DATA, "brands-manifest.json");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const DRY = process.argv.includes("--dry");
const UA = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "accept-language": "en-IN,en;q=0.9",
  accept: "text/html,application/xhtml+xml",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGETS = [
  { id: "casio-d320", code: "CASIO D320" },
  { id: "casio-a2436", code: "CASIO A2436" },
  { id: "kenneth-cole-kc-36529846", code: "KCWGY0103904MNW" },
  { id: "kenneth-cole-kc-27059810", code: "KCWLL2235702LD" },
  { id: "alba-al4321x1", code: "ALBA AL4321X1" },
  { id: "alba-av3581x1", code: "ALBA AV3581X1" },
  { id: "alba-au4057x1", code: "ALBA AU4057X1" },
  { id: "alba-au4051x1", code: "ALBA AU4051X1" },
  { id: "alba-al4539x1", code: "ALBA AL4539X1" },
  { id: "alba-al-34044570", code: "ALBA AS9T79X1" },
  { id: "sonata-nt77083sl06w", code: "SONATA NT77083SL06W" },
  { id: "sonata-nt7987sl01w", code: "SONATA NT7987SL01W" },
  { id: "sonata-nt77118pp01w", code: "SONATA NT77118PP01W" },
  { id: "sonata-nt87018yl03w", code: "SONATA NT87018YL03W" },
  { id: "sonata-nt8096ym02", code: "SONATA NT8096YM02" },
  { id: "sonata-nt8096ym04", code: "SONATA NT8096YM04" },
];

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

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const byId = new Map(catalog.map((w) => [w.id, w]));
let fixed = 0;
const failed = [];

for (const t of TARGETS) {
  const codeToken = t.code.split(" ").pop();
  let hit = null;
  try {
    const res = await fetch(`https://www.ajio.com/search/?text=${encodeURIComponent(t.code)}`, { headers: UA });
    const st = extractPreloaded(await res.text());
    const ents = st?.grid?.entities || {};
    for (const e of Object.values(ents)) {
      const hay = `${e.name || ""} ${(e.images || []).map((i) => i.altText || "").join(" ")}`.toUpperCase();
      if (!hay.includes(codeToken.toUpperCase())) continue;
      const img =
        (e.images || []).find((im) => im.format === "product" && im.url) ||
        (e.images || [])[0];
      if (img?.url) {
        hit = { url: img.url, name: e.name, brand: e.fnlColorVariantData?.brandName };
        break;
      }
    }
  } catch (e) {
    console.log(`ERR ${t.id} ${String(e).slice(0, 100)}`);
  }
  if (!hit) {
    failed.push(`${t.id} (code ${codeToken}: not on Ajio)`);
    await sleep(1500);
    continue;
  }
  if (DRY) {
    console.log(`DRY ${t.id} <- ${hit.url.slice(0, 90)} (${hit.name})`);
    fixed++;
  } else {
    try {
      const res = await fetch(hit.url, { headers: UA });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 6000) throw new Error("small");
      if (await processImage(buf, t.id)) {
        const w = byId.get(t.id);
        manifest[t.id] = { ...(manifest[t.id] || {}), brand: w?.brand, model: w?.model, source: hit.url, frontView: true, ajioRepair: true };
        fixed++;
        console.log(`FIX ${t.id} <- ${hit.name.slice(0, 70)}`);
      } else failed.push(`${t.id} (locked)`);
    } catch (e) {
      failed.push(`${t.id} (download ${String(e).slice(0, 60)})`);
    }
  }
  await sleep(1500);
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log(`fixed ${fixed}/${TARGETS.length}`);
console.log("FAILED:\n" + (failed.join("\n") || "none"));
