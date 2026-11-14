/**
 * Remove small overlaid "spec badge" icons (water-drop shields, warranty
 * seals, QR chips...) from processed product images.
 *
 * Each 1000x1000 image is white-background with the watch as one big ink
 * component. Any OTHER small ink cluster that does not touch the product's
 * bounding box is an overlay badge: its region is painted white, then the
 * image is re-trimmed and re-centred exactly like the import pipeline did.
 *
 * Usage: node scripts/remove-badge-icons.mjs [--brands "A,B"] [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const DRY = process.argv.includes("--dry");
const brandArg = process.argv.find((a) => a.startsWith("--brands="))?.split("=")[1];

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const wanted = brandArg ? new Set(brandArg.split(",")) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 8-connected component labelling over the non-white mask. */
function components(mask, W, H) {
  const labels = new Int32Array(W * H).fill(-1);
  const comps = []; // {area, minX, minY, maxX, maxY}
  const stack = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || labels[i] >= 0) continue;
    const id = comps.length;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = id;
    let area = 0;
    let minX = W;
    let maxX = 0;
    let minY = H;
    let maxY = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % W;
      const y = (p - x) / W;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
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
    }
    comps.push({ id, area, minX, minY, maxX, maxY });
  }
  return { labels, comps };
}

async function cleanImage(file) {
  const { data, info } = await sharp(file)
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const ch = info.channels;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * ch;
    const lum = (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000;
    mask[i] = lum < 250 ? 1 : 0;
  }
  const { labels, comps } = components(mask, W, H);
  if (!comps.length) return null;
  comps.sort((a, b) => b.area - a.area);
  const main = comps[0];
  const PAD = 14;
  const overlap = (a, b, pad) =>
    a.minX - pad <= b.maxX + pad &&
    b.minX - pad <= a.maxX + pad &&
    a.minY - pad <= b.maxY + pad &&
    b.minY - pad <= a.maxY + pad;

  // merge non-main comps into clusters by dilated-bbox intersection
  const rest = comps.slice(1);
  const clusters = [];
  for (const c of rest) {
    let target = clusters.find((cl) => cl.some((m) => overlap(m, c, PAD)));
    if (target) target.push(c);
    else clusters.push([c]);
  }
  // also merge clusters that touch each other
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < clusters.length && !merged; i++)
      for (let j = i + 1; j < clusters.length && !merged; j++) {
        if (clusters[i].some((a) => clusters[j].some((b) => overlap(a, b, PAD)))) {
          clusters[i].push(...clusters[j]);
          clusters.splice(j, 1);
          merged = true;
        }
      }
  }
  const imgArea = W * H;
  // main-pixel presence on a coarse grid so badge proximity uses real pixel
  // distance, not bounding boxes (straps make bboxes hug nearby overlays)
  const G = 8;
  const GW = Math.ceil(W / G);
  const mainGrid = new Uint8Array(GW * Math.ceil(H / G));
  for (let i = 0; i < W * H; i++) {
    if (labels[i] === main.id) {
      const x = i % W;
      const y = (i - x) / W;
      mainGrid[Math.floor(y / G) * GW + Math.floor(x / G)] = 1;
    }
  }
  const NEAR = 3; // blocks == 24 px
  const nearMain = (c) => {
    for (let y = c.minY; y <= c.maxY; y++) {
      const gy = Math.floor(y / G);
      for (let x = c.minX; x <= c.maxX; x++) {
        if (labels[y * W + x] !== c.id) continue;
        const gx = Math.floor(x / G);
        for (let by = gy - NEAR; by <= gy + NEAR; by++) {
          for (let bx = gx - NEAR; bx <= gx + NEAR; bx++) {
            if (by < 0 || bx < 0 || by * GW + bx >= mainGrid.length) continue;
            if (mainGrid[by * GW + bx]) return true;
          }
        }
      }
    }
    return false;
  };
  const badgeClusters = clusters.filter((cl) => {
    const area = cl.reduce((s, c) => s + c.area, 0);
    if (area > imgArea * 0.035) return false; // too big to be an overlay
    const box = cl.reduce(
      (b, c) => ({
        minX: Math.min(b.minX, c.minX),
        minY: Math.min(b.minY, c.minY),
        maxX: Math.max(b.maxX, c.maxX),
        maxY: Math.max(b.maxY, c.maxY),
      }),
      { minX: W, minY: H, maxX: 0, maxY: 0 }
    );
    if (box.maxX - box.minX > W * 0.45 || box.maxY - box.minY > H * 0.45) return false;
    if (cl.some((c) => nearMain(c))) return false; // part of the product
    return true;
  });
  if (!badgeClusters.length) return null;

  for (const cl of badgeClusters) {
    let minX = W;
    let minY = H;
    let maxX = 0;
    let maxY = 0;
    for (const c of cl) {
      minX = Math.min(minX, c.minX);
      minY = Math.min(minY, c.minY);
      maxX = Math.max(maxX, c.maxX);
      maxY = Math.max(maxY, c.maxY);
    }
    // white-paint the padded box so webp halos/ghosts vanish too
    minX = Math.max(0, minX - 16);
    minY = Math.max(0, minY - 16);
    maxX = Math.min(W - 1, maxX + 16);
    maxY = Math.min(H - 1, maxY + 16);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const o = (y * W + x) * ch;
        data[o] = data[o + 1] = data[o + 2] = 255;
      }
    }
  }
  let out = await sharp(data, { raw: { width: W, height: H, channels: ch } }).png().toBuffer();

  // re-trim + re-centre like the import pipeline
  let trimmed = out;
  let tinfo = await sharp(out).metadata();
  try {
    trimmed = await sharp(out).trim({ threshold: 8 }).png().toBuffer();
    tinfo = await sharp(trimmed).metadata();
  } catch {
    /* uniform image */
  }
  const scale = Math.min(940 / tinfo.width, 940 / tinfo.height);
  const w = Math.max(1, Math.round(tinfo.width * scale));
  const h = Math.max(1, Math.round(tinfo.height * scale));
  const resized = await sharp(trimmed)
    .resize(w, h, { fit: "inside", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const tmpFile = file + ".tmp.webp";
  await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
    .composite([{ input: resized, gravity: "center" }])
    .webp({ quality: 92, alphaQuality: 92, effort: 5 })
    .toFile(tmpFile);
  if (DRY) {
    fs.renameSync(tmpFile, file + ".preview.webp");
  } else {
    // OneDrive often holds a lock on the original: overwrite via rename with retries
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmpFile, file);
        break;
      } catch (e) {
        if (attempt >= 5) {
          try {
            fs.copyFileSync(tmpFile, file);
            fs.rmSync(tmpFile, { maxRetries: 5, retryDelay: 300 });
          } catch (e2) {
            console.log(`LOCKED ${file}: ${String(e2).slice(0, 80)}`);
          }
          break;
        }
        await sleep(400 * (attempt + 1));
      }
    }
  }
  return { clusters: badgeClusters.length };
}

const entries = catalog.filter((w) => w.image && (!wanted || wanted.has(w.brand)) && fs.existsSync(path.join(OUT, path.basename(w.image))));
let cleaned = 0;
const touched = [];
for (const w of entries) {
  const file = path.join(OUT, path.basename(w.image));
  try {
    const r = await sharp(file).metadata();
    if (r.width !== 1000) continue;
  } catch {
    continue;
  }
  const res = await cleanImage(file);
  if (res) {
    cleaned++;
    touched.push(`${w.brand} ${w.model} (${res.clusters} badge clusters)`);
    if (cleaned % 25 === 0) console.log(`${cleaned} cleaned so far...`);
  }
}
console.log(`scanned ${entries.length} images, cleaned ${cleaned} (dry=${DRY})`);
console.log(touched.join("\n"));
