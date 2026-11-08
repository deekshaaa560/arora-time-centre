import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, "src/data/catalog.json");
const OUT_DIR = path.join(ROOT, "public/products");
const REJECT_DIR = path.join(ROOT, "tmp/lifestyle-rejects");
const PROGRESS_PATH = path.join(ROOT, "tmp/extract/hires-progress.json");
const CDN_COVERAGE_PATH = path.join(ROOT, "tmp/cdn-coverage.json");

fs.mkdirSync(REJECT_DIR, { recursive: true });

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
const cdn = JSON.parse(fs.readFileSync(CDN_COVERAGE_PATH, "utf8"));
const cdnById = new Map(cdn.results.map((r) => [r.id, r]));
const state = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8"));

const BRAND_BASE = {
  Titan: "https://www.titan.co.in/dw/image/v2/BKDD_PRD/on/demandware.static/-/Sites-titan-master-catalog/default/images/Titan/Catalog",
  Fastrack: "https://www.fastrack.in/dw/image/v2/BKDD_PRD/on/demandware.static/-/Sites-titan-master-catalog/default/images/Fastrack/Catalog",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function variants(model) {
  const n = norm(model);
  const out = new Set([n]);
  for (const p of ["RNU", "ENU", "NU", "NT", "NM", "NR", "NS", "E", "R", "T"]) {
    if (n.startsWith(p) && n.length - p.length >= 5) out.add(n.slice(p.length));
  }
  for (const v of [...out]) for (const s of ["W", "F"]) if (v.endsWith(s) && v.length - 1 >= 6) out.add(v.slice(0, -1));
  return [...out];
}

async function whiteCorners(input) {
  const { data, info } = await sharp(input)
    .resize(400, 400, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;
  const box = 50;
  const regions = [[0, 0], [w - box, 0], [0, h - box], [w - box, h - box]];
  let white = 0;
  for (const [x0, y0] of regions) {
    let sum = 0, n = 0;
    for (let y = y0; y < y0 + box; y++) for (let x = x0; x < x0 + box; x++) {
      const i = (y * w + x) * ch;
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      n++;
    }
    if (sum / n > 235) white++;
  }
  return white;
}

async function fetchBuf(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.startsWith("image/")) throw new Error(`not image: ${ct}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8000) throw new Error(`too small: ${buf.length}`);
  return buf;
}

async function writeImage(buf, file) {
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  const min = Math.min(meta.width || 0, meta.height || 0);
  if (min < 900) throw new Error(`source too small: ${meta.width}x${meta.height}`);
  const tmp = file + ".tmp.webp";
  await sharp(buf, { failOn: "none" })
    .flatten({ background: "#ffffff" })
    .resize(1200, 1200, { fit: "contain", background: "#ffffff", kernel: "lanczos3" })
    .webp({ quality: 92, effort: 5 })
    .toFile(tmp);
  for (let attempt = 0; attempt < 5; attempt++) {
    try { fs.renameSync(tmp, file); break; } catch { await sleep(400); }
  }
}

const items = catalog.filter(
  (w) => (w.brand === "Titan" || w.brand === "Fastrack") && w.image,
);

let checked = 0, fixed = 0, kept = 0, unresolved = 0;
const queue = [...items];

async function worker() {
  while (queue.length) {
    const w = queue.shift();
    if (!w) break;
    const file = path.join(OUT_DIR, path.basename(w.image));
    if (!fs.existsSync(file)) continue;
    let score;
    try { score = await whiteCorners(file); } catch { continue; }
    checked++;
    if (score >= 2) { kept++; continue; }

    const base = BRAND_BASE[w.brand];
    const cdnHit = cdnById.get(w.id);
    const vars = cdnHit ? [cdnHit.variant] : variants(w.model);
    let chosen = null;

    outer: for (const v of vars) {
      for (const suffix of ["_2", "_3", "_4", "_5", "_6", "_1"]) {
        const previewUrl = `${base}/${v}${suffix}.jpg?sw=600&sh=600`;
        try {
          const preview = await fetchBuf(previewUrl);
          if ((await whiteCorners(preview)) >= 2) {
            chosen = { v, suffix, previewUrl };
            break outer;
          }
        } catch {}
        await sleep(60);
      }
    }

    if (!chosen) {
      unresolved++;
      console.log("unresolved", w.brand, w.model, "current corners", score);
      continue;
    }

    try {
      const url = `${base}/${chosen.v}${chosen.suffix}.jpg?sw=2000&sh=2000`;
      const buf = await fetchBuf(url);
      fs.copyFileSync(file, path.join(REJECT_DIR, path.basename(w.image)));
      await writeImage(buf, file);
      state.done[w.id] = { ...state.done[w.id], source: "official-cdn-white", imageUrl: url };
      fixed++;
      if (fixed % 20 === 0) {
        console.log(`fixed ${fixed} / checked ${checked} / unresolved ${unresolved}`);
        fs.writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 1));
      }
    } catch (e) {
      unresolved++;
      console.log("write fail", w.brand, w.model, String(e?.message || e));
    }
    await sleep(60);
  }
}

console.log(`Checking ${items.length} Titan/Fastrack images for non-white backgrounds`);
await Promise.all(Array.from({ length: 6 }, worker));
fs.writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 1));
console.log({ checked, kept, fixed, unresolved });
