/**
 * Contact sheet of every candidate frame a watch's listing gallery holds,
 * scored by the front-view detector, worst-to-best, plus a strict pick.
 *
 * The ranking inside a gallery is decided by scripts/front-view.mjs, but on
 * pavé case backs (MK4971) and 3/4 hero shots the detector can be fooled. This
 * sheet exists so a human can see exactly which frame is the real dial before
 * anything is written.
 *
 *   node scripts/pick-front.mjs --ids=michael-kors-mk4971,fossil-bq2400set
 *
 * Writes tmp/pick-front-<brand>-<model>.png per watch (candidates, current on
 * disk first, the strict pick marked PICK) and prints the ranking.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { classifyImage } from "./front-view.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const DATA = path.join(ROOT, "tmp/stock-2026/myntra");
const CACHE = path.join(ROOT, "tmp/imgcache");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const MANIFEST = path.join(DATA, "brands-manifest.json");
const APPLY = process.argv.includes("--apply");
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
fs.mkdirSync(CACHE, { recursive: true });

const POOL_FILES = {
  Citizen: "myntra-citizen.json",
  Casio: "myntra-casio.json",
  "G-Shock": "myntra-gshock.json",
  DKNY: "myntra-dkny.json",
  "Kenneth Cole": "myntra-kenneth-cole.json",
  Giordano: "myntra-giordano.json",
  Earnshaw: "myntra-earnshaw.json",
  Sonata: "myntra-sonata.json",
  Alba: "myntra-alba.json",
  Maxima: "myntra-maxima.json",
  "Alexandre Christie": "myntra-alexandre-christie.json",
  "Tommy Hilfiger": "myntra-tommy.json",
  Fossil: "myntra-fossil.json",
  "Michael Kors": "myntra-mk.json",
  "Armani Exchange": "myntra-ax.json",
  "Emporio Armani": "myntra-ea.json",
  Guess: "myntra-guess.json",
};

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const pools = new Map();
const poolByBrand = new Map();
for (const [brand, file] of Object.entries(POOL_FILES)) {
  const full = path.join(DATA, file);
  if (!fs.existsSync(full)) continue;
  const items = JSON.parse(fs.readFileSync(full, "utf8"));
  poolByBrand.set(brand, items);
  for (const p of items) {
    const model = String(p.model || "").toUpperCase();
    if (model) pools.set(`${brand}|${model}`, p);
    if (p.productId) pools.set(`${brand}|${p.productId}`, p);
  }
}

function listingRecord(w) {
  const model = String(w.model).toUpperCase();
  let rec = pools.get(`${w.brand}|${model}`);
  if (!rec) rec = (poolByBrand.get(w.brand) || []).find((p) => String(p.product || "").toUpperCase().includes(model));
  return rec || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cachedFetch(url) {
  const key = createHash("sha1").update(url).digest("hex");
  const file = path.join(CACHE, key);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 6000) throw new Error("too small");
      fs.writeFileSync(file, buf);
      return buf;
    } catch {
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

/** A frame that is unambiguously the dial, straight-on, the watch alone.
 *  The score alone is not enough: a pavé dial (MK4971) has so little 12-fold
 *  regularity that it scores under a plain dial, while its own engraved case
 *  back - the frame that must never win - scores 0.70. So a candidate is
 *  accepted when it scores near a plain dial, or when it carries the hard
 *  edges (det) or marker spacing (12x) only a dial has; the case back carries
 *  neither. Wide silhouettes are 3/4 or coiled-bracelet crops, not front views. */
export function strictFront(r) {
  return (
    r.front &&
    !r.cluttered &&
    !r.modelRisk &&
    r.bbox.aspect <= 0.8 &&
    (r.frontScore >= 0.95 || r.detail >= 0.3 || r.twelve >= 0.45)
  );
}

/** Official white 1000x1000 tile, same as the fix pipeline. */
async function tile(buffer, file) {
  const base = await sharp(buffer).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  let trimmed = base;
  let info = await sharp(base).metadata();
  try {
    trimmed = await sharp(base).trim({ threshold: 8 }).png().toBuffer();
    info = await sharp(trimmed).metadata();
  } catch {
    /* uniform */
  }
  const scale = Math.min(940 / info.width, 940 / info.height);
  const resized = await sharp(trimmed)
    .resize(Math.max(1, Math.round(info.width * scale)), Math.max(1, Math.round(info.height * scale)), {
      fit: "inside",
      kernel: "lanczos3",
    })
    .sharpen({ sigma: 0.5, m1: 0.45, m2: 0.18 })
    .png()
    .toBuffer();
  const tmp = `${file}.tmp.webp`;
  await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
    .composite([{ input: resized, gravity: "center" }])
    .webp({ quality: 92, alphaQuality: 92, effort: 5 })
    .toFile(tmp);
  fs.renameSync(tmp, file);
}

const ids = (arg("ids", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * `--picks-file=tmp/picks-local.txt` installs frames a person chose after looking at
 * the sheets: one "<id> <n>" per line, n being the #N printed on that row's sheet -
 * its position in the listing's own gallery, which does not move between runs. The
 * detector calls a Michael Kors case back a front view often enough that its ranking
 * cannot be the last word, and this is how the eye overrules it. Implies --apply.
 */
const PICKS = (() => {
  const f = arg("picks-file");
  if (!f || !fs.existsSync(path.join(ROOT, f))) return new Map();
  return new Map(
    fs
      .readFileSync(path.join(ROOT, f), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const [id, i] = l.split(/[=\s]+/);
        return [id, Number(i)];
      }),
  );
})();

if (!ids.length && !PICKS.size) {
  console.log("usage: node scripts/pick-front.mjs --ids=a,b,c [--apply | --picks-file=tmp/picks-local.txt]");
  process.exit(1);
}
const targets = ids.length ? ids : [...PICKS.keys()];

for (const id of targets) {
  const w = catalog.find((x) => x.id === id);
  if (!w) {
    console.log(`${id}: not in catalog`);
    continue;
  }
  const rec = listingRecord(w);
  const urls = rec ? [...new Set([rec.image, ...(rec.images || [])].filter((u) => /^https?:/.test(String(u))))] : [];
  const tiles = [];

  const cur = path.join(ROOT, "public", w.image.replace(/^\//, ""));
  if (fs.existsSync(cur)) {
    const r = await classifyImage(await fs.promises.readFile(cur));
    tiles.push({ label: "ON DISK", r, file: cur });
  }
  for (const [i, url] of urls.entries()) {
    const buf = await cachedFetch(url);
    if (!buf) {
      console.log(`  ${id} #${i} fetch-failed ${String(url).slice(0, 70)}`);
      continue;
    }
    try {
      const r = await classifyImage(buf);
      tiles.push({ label: `#${i}`, r, buf, url });
    } catch {
      /* unreadable */
    }
  }
  const picked = tiles.filter((t) => strictFront(t.r)).sort((a, b) => b.r.frontScore - a.r.frontScore)[0];
  const order = [...tiles].sort((a, b) => b.r.frontScore - a.r.frontScore);
  console.log(`\n${id} (${w.brand} ${w.model}) ${urls.length} candidates, strict pick: ${picked ? picked.label : "NONE"}`);
  for (const t of order)
    console.log(
      `  ${t.label.padEnd(7)} s=${String(t.r.frontScore).padEnd(5)} 12x=${String(t.r.twelve).padEnd(5)} det=${String(t.r.detail).padEnd(5)} ring=${String(t.r.ring).padEnd(5)} asp=${t.r.bbox.aspect} front=${t.r.front}${t.r.reason ? " " + t.r.reason : ""}`,
    );

  const CELL = 200;
  const COLS = Math.min(6, Math.max(1, order.length));
  const composites = [];
  for (let i = 0; i < order.length; i++) {
    const t = order[i];
    const x = (i % COLS) * CELL;
    const y = Math.floor(i / COLS) * CELL;
    const img = t.buf ? sharp(t.buf) : sharp(t.file);
    composites.push({
      input: await img.resize(CELL - 12, CELL - 40, { fit: "contain", background: "#ffffff" }).png().toBuffer(),
      left: x + 6,
      top: y + 4,
    });
    const isPick = t === picked;
    const svg = `<svg width="${CELL}" height="34"><rect width="${CELL}" height="34" fill="${isPick ? "#14532d" : t.r.front ? "#0f1720" : "#7f1d1d"}"/><text x="5" y="13" font-family="monospace" font-size="10" fill="#fff">${t.label} ${isPick ? "PICK" : ""}</text><text x="5" y="27" font-family="monospace" font-size="10" fill="#ffd">s=${t.r.frontScore} 12x=${t.r.twelve} det=${t.r.detail} asp=${t.r.bbox.aspect}</text></svg>`;
    composites.push({ input: Buffer.from(svg), left: x, top: y + CELL - 36 });
  }
  const out = path.join(ROOT, `tmp/pick-front-${id}.png`);
  await sharp({ create: { width: COLS * CELL, height: Math.ceil(order.length / COLS) * CELL, channels: 3, background: "#111" } })
    .composite(composites)
    .png()
    .toFile(out);
  console.log(`  sheet -> ${path.relative(ROOT, out)}`);

  const chosen = PICKS.has(id) ? tiles.find((t) => t.label === `#${PICKS.get(id)}`) : picked;
  const deciding = APPLY || PICKS.has(id);
  if (deciding && PICKS.has(id) && !chosen) {
    console.log(`  PICK ${id}: the listing has no frame #${PICKS.get(id)}`);
  } else if (deciding && chosen && !chosen.buf) {
    console.log(`  APPLY ${id}: the photo on disk is already the pick - keeping`);
  } else if (deciding && !chosen) {
    console.log(`  APPLY ${id}: no strict front in the listing -> needs source-front-online`);
  } else if (deciding) {
    // Re-read the manifest so a concurrent pipeline run's entries survive.
    const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
    await tile(chosen.buf, path.join(OUT, path.basename(w.image)));
    manifest[w.id] = {
      ...(manifest[w.id] || {}),
      brand: w.brand,
      model: w.model,
      source: chosen.url,
      front: true,
      strict: !PICKS.has(id),
      picked: PICKS.has(id) ? chosen.label : undefined,
    };
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
    console.log(`  ${PICKS.has(id) ? "PICK" : "APPLY"} ${id}: ${chosen.label} -> ${path.basename(w.image)} (${chosen.url})`);
  }
}
