/**
 * Front-view validator + repair for curated brands.
 *
 * Myntra's `front` view tag is not always trustworthy and some listings are
 * straps. This checks every curated image with geometry heuristics:
 *   - central window inside the product bbox: a dial has high edge/structure
 *     density and colour variety; a caseback is flat metal; a strap ring has a
 *     big white hole in the middle.
 *   - bbox aspect: side profiles are narrow strips.
 * Suspects are rebuilt from every image of their listing (scored by the same
 * frontness metric, front tag preferred as a bonus); if nothing in the listing
 * passes, the entry is removed from the catalog.
 *
 *   node scripts/validate-front-views.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const DATA = path.join(ROOT, "tmp/stock-2026/myntra");
const CACHE = path.join(ROOT, "tmp/imgcache");
const MANIFEST = path.join(DATA, "brands-manifest.json");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const DRY = process.argv.includes("--dry");
fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" };

const NEW = ["Citizen", "Casio", "G-Shock", "DKNY", "Kenneth Cole", "Giordano", "Earnshaw", "Alba", "Maxima", "Sonata", "Alexandre Christie"];

/* ---------- frontness metrics ---------- */
async function metrics(fileOrBuffer) {
  const { data, info } = await sharp(fileOrBuffer)
    .flatten({ background: "#ffffff" })
    .resize(600, 600, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  const lum = new Float32Array(W * H);
  const sat = new Float32Array(W * H);
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * ch;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    lum[i] = (r * 299 + g * 587 + b * 114) / 1000;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    sat[i] = mx === 0 ? 0 : (mx - mn) / mx;
    ink[i] = lum[i] < 244 ? 1 : 0;
  }
  // product bbox (largest component would be better; bbox of all ink is fine for isolated products)
  let minX = W, maxX = 0, minY = H, maxY = 0, total = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ink[y * W + x]) {
        total++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (total < W * H * 0.005) return { bad: true, why: "near-empty" };
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const aspect = bw / bh;
  const fill = total / (bw * bh); // ring/strap: low fill
  // central window: 46% of bbox
  const cw = Math.floor(bw * 0.46);
  const chh = Math.floor(bh * 0.46);
  const cx0 = minX + Math.floor((bw - cw) / 2);
  const cy0 = minY + Math.floor((bh - chh) / 2);
  let cInk = 0;
  let cEdge = 0;
  let cSat = 0;
  let cN = 0;
  let cLum = 0;
  let darkAll = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lum[y * W + x] < 60) darkAll++;
  for (let y = cy0; y < cy0 + chh; y++) {
    for (let x = cx0; x < cx0 + cw; x++) {
      const i = y * W + x;
      cN++;
      if (ink[i]) cInk++;
      cLum += lum[i];
      cSat += sat[i];
      if (x + 1 < W && Math.abs(lum[i] - lum[i + 1]) > 40) cEdge++;
      if (y + 1 < H && Math.abs(lum[i] - lum[i + W]) > 40) cEdge++;
    }
  }
  const cInkFrac = cInk / cN;
  // horizontal ink extent across mid-height rows: front views show the case (wide),
  // side profiles are a thin vertical sliver
  let midFrac = 0;
  let midRows = 0;
  for (let y = Math.floor(cy0 - chh * 0.15); y <= Math.ceil(cy0 + chh * 1.15); y++) {
    if (y < 0 || y >= H) continue;
    let rowInk = 0;
    for (let x = minX; x <= maxX; x++) if (ink[y * W + x]) rowInk++;
    midFrac += rowInk / bw;
    midRows++;
  }
  midFrac /= Math.max(1, midRows);
  // exact-centre row band: front views cross the dial (wide ink), side views are a sliver
  const yMid = Math.floor((minY + maxY) / 2);
  let centreRow = 0;
  let cRows = 0;
  for (let y = yMid - 3; y <= yMid + 3; y++) {
    if (y < 0 || y >= H) continue;
    let rowInk = 0;
    for (let x = minX; x <= maxX; x++) if (ink[y * W + x]) rowInk++;
    centreRow += rowInk / bw;
    cRows++;
  }
  centreRow /= Math.max(1, cRows);
  // A real watch shows a case noticeably wider than its strap; folded-bracelet /
  // clasp close-ups have constant row width from top to bottom.
  let maxRow = 0;
  const rowWidths = [];
  for (let y = minY; y <= maxY; y++) {
    let rowInk = 0;
    for (let x = minX; x <= maxX; x++) if (ink[y * W + x]) rowInk++;
    rowWidths.push(rowInk);
    if (rowInk > maxRow) maxRow = rowInk;
  }
  rowWidths.sort((a, b) => a - b);
  const medRow = rowWidths[Math.floor(rowWidths.length / 2)] || 1;
  const widthRatio = maxRow / medRow;
  const edgeFrac = cEdge / cN;
  const satMean = cSat / cN;
  const cLumMean = cLum / cN;
  const reasons = [];
  const hole = cInkFrac < 0.35 && fill < 0.55; // strap ring / open middle
  const flat = edgeFrac < 0.03 && cInkFrac > 0.6 && satMean < 0.12; // plain metal caseback
  const darkFrac = darkAll / (W * H);
  const side = (aspect < 0.5 || aspect > 2.0) && (hole || flat) || (aspect < 0.46 && cLumMean > 230);
  const darkPhoto = darkFrac > 0.5; // moody lifestyle photo background (black watches stay < 0.5)
  // scene-photo check: cut-outs have white/light margins inside their bbox corners
  let cornerLum = 0;
  let cornerN = 0;
  const cs = Math.max(8, Math.round(Math.min(bw, bh) * 0.06));
  for (const [qx, qy] of [
    [minX, minY],
    [maxX - cs, minY],
    [minX, maxY - cs],
    [maxX - cs, maxY - cs],
  ]) {
    for (let y = Math.max(0, qy); y < Math.min(H, qy + cs); y++)
      for (let x = Math.max(0, qx); x < Math.min(W, qx + cs); x++) {
        cornerN++;
        cornerLum += lum[y * W + x];
      }
  }
  const cornerLumMean = cornerLum / Math.max(1, cornerN);
  const scene = cornerLumMean < 215 && cInkFrac > 0.8; // photo background at bbox corners
  const thinMid = midFrac < 0.3 && cInkFrac < 0.55; // side sliver even with curved strap widening the bbox
  const edgeOn = centreRow < 0.38 && !hole; // centre row misses the dial -> side/edge-on view
  const claspBand = false && widthRatio < 1.35 && fill > 0.5 && cInkFrac > 0.7; // disabled: large-dial fronts also have uniform width
  if (hole) reasons.push(`center-hole(${cInkFrac.toFixed(2)})`);
  if (flat) reasons.push(`flat-metal-center(${edgeFrac.toFixed(3)})`);
  if (side) reasons.push(`side-profile(${aspect.toFixed(2)})`);
  if (thinMid) reasons.push(`side-sliver(${midFrac.toFixed(2)})`);
  if (edgeOn) reasons.push(`edge-on(${centreRow.toFixed(2)})`);
  if (claspBand) reasons.push(`clasp-band(${widthRatio.toFixed(2)})`);
  if (darkPhoto) reasons.push(`dark-photo(${darkFrac.toFixed(2)})`);
  if (scene) reasons.push(`scene-photo(${cornerLumMean.toFixed(0)})`);
  return { bad: reasons.length > 0, why: reasons.join(","), cInkFrac, edgeFrac, satMean, aspect, fill, darkFrac, cornerLumMean, centreRow };
}

/* ---------- listing pools ---------- */
const pools = {};
for (const f of fs.readdirSync(DATA)) {
  if (!/^myntra-[a-z-]+\.json$/.test(f)) continue;
  pools[f] = JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
}
const VIEW_BONUS = { front: 0.08, search: 0.04, default: 0.02 };

async function cachedFetch(url) {
  const key = Buffer.from(url).toString("base64url").slice(0, 80);
  const file = path.join(CACHE, key);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
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

/* ---------- main ---------- */
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

// brand -> [records] (casio pool also contains G-Shock names)
const byBrand = {};
for (const [file, list] of Object.entries(pools)) {
  for (const p of list) {
    const b = p.brand;
    (byBrand[b] ??= []).push(p);
  }
}
function listingFor(w) {
  const pid = String(manifest[w.id]?.productId || "");
  const list = byBrand[w.brand] || [];
  let rec = list.find((p) => String(p.productId) === pid);
  if (!rec) {
    const m = String(w.model).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (m.length >= 6) {
      rec = list.find((p) => {
        const hay = String(p.product).toUpperCase().replace(/[^A-Z0-9]/g, "");
        return m.length >= 7 ? hay.includes(m.slice(0, 7)) : hay.includes(m);
      });
    }
  }
  return rec || null;
}

const suspects = [];
const drop = [];
for (const w of catalog) {
  if (!NEW.includes(w.brand) || !w.image) continue;
  const f = path.join(OUT, path.basename(w.image));
  if (!fs.existsSync(f)) continue;
  const m = await metrics(f);
  // repair when heuristics flag it, or when a listing candidate scores clearly better
  suspects.push({ w, why: m.bad ? m.why : "compare", cur: m });
  await sleep(0);
}
console.log(`checking ${suspects.length}`);

for (const { w, why, cur } of suspects) {
  const rec = listingFor(w);
  let best = null;
  if (rec) {
    const views = rec.imageViews || [];
    const urls = (rec.images || []).filter(Boolean);
    for (let i = 0; i < urls.length; i++) {
      const buf = await cachedFetch(urls[i]);
      if (!buf) continue;
      const m = await metrics(buf);
      if (m.bad) continue;
      const bonus = VIEW_BONUS[String(views[i] || "").toLowerCase()] || 0;
      const score = (m.centreRow || 0) * 1.2 + (m.edgeFrac || 0) + (m.satMean || 0) * 0.5 + bonus;
      if (!best || score > best.score) best = { url: urls[i], score, buf };
      await sleep(40);
    }
  }
  const curScore = (cur.centreRow || 0) * 1.2 + (cur.edgeFrac || 0) + (cur.satMean || 0) * 0.5;
  const mustFix = cur.bad;
  if (best && (mustFix || best.score > curScore + 0.15)) {
    console.log(`${mustFix ? "REPAIR" : "UPGRADE"} ${w.brand} ${w.model} [${why}] <- ${best.url.slice(0, 80)}`);
    if (!DRY) {
      if (await processImage(best.buf, w.id)) {
        manifest[w.id] = { ...(manifest[w.id] || {}), brand: w.brand, model: w.model, source: best.url, validated: true };
      }
    }
  } else if (mustFix) {
    console.log(`DROP ${w.brand} ${w.model} [${why}] listing=${rec ? rec.productId : "none"}`);
    if (!DRY) drop.push(w.id);
  }
  await sleep(60);
}

if (!DRY) {
  const dropSet = new Set(drop);
  const kept = catalog.filter((x) => !dropSet.has(x.id));
  fs.writeFileSync(CATALOG, JSON.stringify(kept, null, 1) + "\n");
  for (const id of drop) {
    const f = path.join(OUT, `${id}.webp`);
    try {
      if (fs.existsSync(f)) fs.rmSync(f);
    } catch {
      setTimeout(() => fs.rmSync(f, { force: true }), 800);
    }
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  console.log(`done. catalog ${kept.length}`);
} else {
  console.log(`dry: would drop ${drop.length}`);
}
