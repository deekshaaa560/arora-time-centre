import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, "src/data/catalog.json");
const OUT_DIR = path.join(ROOT, "public/products");
const PROGRESS_PATH = path.join(ROOT, "tmp/extract/whiten-progress.json");

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
const progress = fs.existsSync(PROGRESS_PATH)
  ? JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8"))
  : { done: {}, stats: { whitened: 0, skipped: 0, failed: 0 } };

const files = [...new Set(catalog.filter((w) => w.image).map((w) => path.basename(w.image)))];
console.log("Checking", files.length, "images for light-grey backgrounds");

function cornerMeans(data, info) {
  const { width: w, height: h, channels: ch } = info;
  const box = 40;
  const regions = [[0, 0], [w - box, 0], [0, h - box], [w - box, h - box]];
  const means = [];
  for (const [x0, y0] of regions) {
    let sum = 0, n = 0;
    for (let y = y0; y < y0 + box; y++) for (let x = x0; x < x0 + box; x++) {
      const i = (y * w + x) * ch;
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      n++;
    }
    means.push(sum / n);
  }
  return means;
}

async function whiten(file) {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const means = cornerMeans(data, info);
  const min = Math.min(...means), max = Math.max(...means);
  if (min < 222 || max - min > 8) return { status: "skip" };
  if (min > 252) return { status: "skip" };

  // sample background colour from the top-left corner
  const { width: w, height: h, channels: ch } = info;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const i = (y * w + x) * ch;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  r /= n; g /= n; b /= n;
  if (Math.abs(r - g) > 5 || Math.abs(g - b) > 5) return { status: "skip" };

  const px = new Uint8Array(data);
  let changed = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    if (
      Math.abs(px[o] - r) <= 6 &&
      Math.abs(px[o + 1] - g) <= 6 &&
      Math.abs(px[o + 2] - b) <= 6
    ) {
      px[o] = 255;
      px[o + 1] = 255;
      px[o + 2] = 255;
      changed++;
    }
  }
  if (changed < w * h * 0.02) return { status: "skip" };

  const tmp = file + ".whiten.webp";
  await sharp(Buffer.from(px), { raw: { width: w, height: h, channels: ch } })
    .webp({ quality: 92, effort: 5 })
    .toFile(tmp);
  for (let attempt = 0; attempt < 5; attempt++) {
    try { fs.renameSync(tmp, file); break; } catch { await new Promise((r) => setTimeout(r, 400)); }
  }
  return { status: "whitened", coverage: changed / (w * h) };
}

const queue = files.filter((f) => !progress.done[f]);
let processed = 0;
async function worker() {
  while (queue.length) {
    const f = queue.shift();
    if (!f) break;
    const file = path.join(OUT_DIR, f);
    if (!fs.existsSync(file)) continue;
    try {
      const r = await whiten(file);
      if (r.status === "whitened") progress.stats.whitened++;
      else progress.stats.skipped++;
      progress.done[f] = r.status;
    } catch (e) {
      progress.stats.failed++;
      progress.done[f] = "failed";
    }
    processed++;
    if (processed % 50 === 0) {
      console.log(`whiten ${processed}/${files.length}`, progress.stats);
      fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 1));
    }
  }
}

await Promise.all(Array.from({ length: 4 }, worker));
fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 1));
console.log(progress.stats);
