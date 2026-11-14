/**
 * Front-view repair pass.
 *
 * The customer only wants the dial in the photo: a side profile or a case back
 * hides the watch. For every watch whose current photo fails the front test in
 * scripts/front-view.mjs, score every image the source listing holds, keep the
 * best one and re-run the white 1000x1000 pipeline. Ties go to the retailer's
 * own hero image (the first in the listing), which is the dial shot.
 *
 *   node scripts/fix-front-views.mjs [--brands=citizen,dkny] [--dry] [--limit=n]
 *
 * Writes tmp/front-fix.json (decision per watch) and, with --sheet, a
 * before/after contact sheet at tmp/front-fix-sheet.png. Watches with no
 * front-facing image anywhere are listed at the end - those need another source.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { classifyImage, gateOk, isClear, isSet } from "./front-view.mjs";
import { writeJson } from "./write-json.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const DATA = path.join(ROOT, "tmp/stock-2026/myntra");
const CACHE = path.join(ROOT, "tmp/imgcache");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const MANIFEST = path.join(DATA, "brands-manifest.json");
const DRY = process.argv.includes("--dry");
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const numArg = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? Number(hit.split("=")[1]) || Infinity : Infinity;
};
const limit = Number(arg("limit", "0")) || Infinity;
fs.mkdirSync(CACHE, { recursive: true });

/** Catalogue brand -> listing dump under tmp/stock-2026/myntra. */
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
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};

/**
 * Which rows to consider: `--brands=`, `--ids=a,b`, `--ids-file=tmp/x.txt`, or
 * everything. The targeted modes exist because the audit names the rows that
 * fail, and rescanning 1,200 galleries to fix eleven of them wastes an hour.
 */
const wanted = arg("brands")
  ? arg("brands")
      .split(",")
      .map((s) => s.trim().toLowerCase())
  : null;
const onlyIds = new Set(
  (arg("ids") ? arg("ids").split(",") : [])
    .concat(arg("ids-file") ? fs.readFileSync(path.join(ROOT, arg("ids-file")), "utf8").split(/\s+/) : [])
    .map((s) => s.trim())
    .filter(Boolean),
);

/** brand|model|productId -> listing record, for candidate lookup. */
const pools = new Map();
const poolByBrand = new Map(); // catalogue brand -> listing records (name fallback)
const brandOf = new Map(); // catalogue brand -> pool available?
for (const [brand, file] of Object.entries(POOL_FILES)) {
  const full = path.join(DATA, file);
  brandOf.set(brand, fs.existsSync(full));
  if (!fs.existsSync(full)) continue;
  const items = JSON.parse(fs.readFileSync(full, "utf8"));
  poolByBrand.set(brand, items);
  for (const p of items) {
    const model = String(p.model || "").toUpperCase();
    if (model) pools.set(`${brand}|${model}`, p);
    if (p.productId) pools.set(`${brand}|${p.productId}`, p);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cachedFetch(url) {
  // A truncated base64 of the URL collided across a product's images, which is
  // how a scored photo and a saved photo could end up being different watches.
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

/** Official white 1000x1000 tile, same as the import pipeline. Returns the PNG:
 *  candidates must be judged on exactly the frame the storefront will show,
 *  because every number the detector produces - disc radius, ring, edge-on
 *  coverage - is a measurement of how big the watch sits in the frame. Judged at
 *  their own resolution, a 200px thumbnail dial loses to a 1080px case back. */
async function makeTile(buffer) {
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
  return sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toBuffer();
}

/** Save a candidate as the product photo. */
async function tile(buffer, file) {
  const png = await makeTile(buffer);
  const tmp = `${file}.tmp.webp`;
  await sharp(png).webp({ quality: 92, alphaQuality: 92, effort: 5 }).toFile(tmp);
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return true;
    } catch {
      await sleep(400 * (attempt + 1));
    }
  }
  return false;
}

function listingRecord(w) {
  const model = String(w.model).toUpperCase();
  let rec =
    pools.get(`${w.brand}|${model}`) ||
    (manifest[w.id]?.productId != null ? pools.get(`${w.brand}|${manifest[w.id].productId}`) : null);
  // Some dumps (the Tommy range) carry no model field, only the code inside the
  // product title - match there before giving up.
  if (!rec) rec = (poolByBrand.get(w.brand) || []).find((p) => String(p.product || "").toUpperCase().includes(model));
  return rec || null;
}

/**
 * Views the retailer labels on its own gallery images. None of these can be the
 * hero shot, and the label outranks my measurement: a polished case back with a
 * crystal bezel scores exactly as well as a dial, but Myntra knows which is which.
 */
const BAD_VIEWS = new Set(["back", "left", "right", "top", "bottom", "certificate", "size_representation"]);

/** What the retailer calls the photo this row is currently showing. */
function sourceLabel(w) {
  const src = manifest[w.id]?.source;
  if (!src) return "";
  const rec = listingRecord(w);
  if (!rec) return "";
  const i = (rec.images || []).indexOf(src);
  return i >= 0 ? String((rec.imageViews || [])[i] || "").toLowerCase() : "";
}

function candidatesFor(w) {
  const rec = listingRecord(w);
  if (!rec) return [];
  // Myntra labels every gallery image with its view. Anything the retailer itself
  // calls back / left / right / top / bottom / certificate can never be the hero
  // shot, so it is dropped before the detector is even consulted - that is what
  // let a case back or an edge-on view survive as a storefront photo.
  const ok = (list) => (list || []).filter((u) => /^https?:/.test(u));
  const views = rec.imageViews || [];
  const labelOf = (u) => {
    const i = (rec.images || []).indexOf(u);
    return i >= 0 ? String(views[i] || '').toLowerCase() : '';
  };
  const tagged = new Set(ok(rec.front));
  const pool = [...tagged, ...ok([rec.image]), ...ok(rec.images)].filter((u) => !BAD_VIEWS.has(labelOf(u)));
  const seen = new Set();
  return pool
    .filter((u) => (seen.has(u) ? false : (seen.add(u), true)))
    .slice(0, 10)
    .map((url) => ({ url, tagged: tagged.has(url) }));
}

const rows = [];
const hopeless = [];
// A frame a person chose by eye (the manifest records it as `picked`) is not
// re-decided by measurement: the scorer cannot tell a pale mother-of-pearl Michael
// Kors dial from an engraved case back, so re-running over a hand pick tends to
// replace a correct photo with a wrong one that happens to measure better.
// --revisit-picked, or naming the row with --ids / --ids-file, overrides this.
const REVISIT = process.argv.includes("--revisit-picked");
const byHand = [];
let replaced = 0;
let checked = 0;

for (const w of catalog) {
  if (onlyIds.size && !onlyIds.has(w.id)) continue;
  if (wanted && !wanted.includes(String(w.brand).toLowerCase())) continue;
  if (!w.image && !w.id) continue;
  if (checked >= limit) break;
  const file = path.join(OUT, path.basename(w.image || `${w.id}.webp`));
  if (!REVISIT && !onlyIds.size && manifest[w.id]?.picked && fs.existsSync(file)) {
    byHand.push(w.id);
    continue;
  }
  checked++;

  let cur;
  if (!fs.existsSync(file)) {
    // Nothing on disk, so the card is showing the branded placeholder. Skipping
    // these left rows photoless forever - six Earnshaws, an Alba, a Maxima - while
    // their own listing gallery holds the picture. Treat it as a frame that fails
    // every test, so the best listing frame is installed.
    cur = {
      current: true,
      front: false,
      reason: "missing-file",
      frontScore: 0,
      clean: 0,
      radius: 0,
      ring: 0,
      twelve: 0,
      detail: 0,
      darkFrac: 0,
      coverage: 0,
      areaFrac: 0,
      span: 0,
      bbox: { w: 0, h: 0, aspect: 0 },
      modelRisk: false,
      cluttered: false,
    };
  } else
    try {
    // Measured the same way as every candidate: the catalogue holds both 1000px
    // and 1200px tiles, and a disc radius gate is meaningless if the two frames
    // are judged at their own scale.
    cur = await classifyImage(await makeTile(await fs.promises.readFile(file)));
  } catch {
    continue;
  }
  // A couple/set SKU is photographed as a pair; that is the right photo, not clutter.
  const setOk = (r) => isSet(w) && gateOk(r, { allowMultiple: true });
  // The retailer's own label outranks the measurement. Two DKNY clasps scored
  // 1.105 and 1.107 - higher than most dials - while Myntra called them "back".
  const label = sourceLabel(w);
  if (cur.front && BAD_VIEWS.has(label)) cur = { ...cur, front: false, reason: `labelled-${label}` };
  // "Clear" is what the storefront must actually show: the dial dead-on. The
  // geometric front gate alone lets a pavé case back (crystal bezel gives it a
  // ring, engravings give it detail) and a bracelet clasp through, which is how
  // those photos kept surviving re-runs.
  const clear = (r) => isClear(r, { allowMultiple: isSet(w) });
  if (!cur.front && setOk(cur)) cur = { ...cur, front: true, reason: "" };
  // With a listing to choose from, always re-check: a case back can outscore a
  // plain dial, so trusting the photo already on disk is what hid these.
  const urls = candidatesFor(w);
  // Nothing to choose from (no listing record): a photo that passes the geometric
  // gate stays as it is, because there is no better frame to move in. One that
  // merely passes while being a 3/4 or a weak disc is queued for web sourcing.
  if (cur.front && !urls.length) {
    rows.push({ id: w.id, brand: w.brand, model: w.model, action: clear(cur) ? "keep" : "keep-weak", ...cur });
    if (!clear(cur))
      hopeless.push({ id: w.id, brand: w.brand, model: w.model, current: "weak-front", best: null, why: "no-listing-record" });
    continue;
  }
  const scored = [];
  for (const [i, c] of urls.entries()) {
    const buf = await cachedFetch(c.url);
    if (!buf) continue;
    try {
      scored.push({ url: c.url, rank: i, tagged: c.tagged, buf, ...(await classifyImage(await makeTile(buf))) });
    } catch {
      /* unreadable candidate */
    }
  }

  // Tiered ranking.
  // Tier 2 is a straight-on dial that shows dial evidence; tier 1 passes the
  // geometric gate but is weak - a 3/4 angle, a bracelet clasp, a bare-minimum
  // disc; tier 0 is a profile, a case back, a box or a promo card. Inside a tier
  // the detector's score decides, and the retailer's own "front" tag is only a
  // tiebreaker, because that tag is wrong often enough (coil-of-bracelet and
  // case-back shots get labelled "front").
  // The studio background deliberately does NOT form a tier of its own any more:
  // DKNY shoots these chronographs' dials on grey and their case backs on white,
  // so a "clean white first" tier kept the back (score 1.03) above the real dial
  // (1.24) on the card. Cleanliness is worth at most 0.1 of score in key().
  // Tier 3 is the frame the retailer itself puts first - the tagged `front` image
  // where it labels one, otherwise the listing's hero - and it has to survive every
  // check below; tier 2 is any other clear straight-on dial; tier 1 passes the
  // geometric gate but is weak; tier 0 is a profile, a case back, a box or a card.
  // The hero leads because the retailer sells this watch and chose that picture to
  // sell it with; the checks keep it honest when the choice was a wrist shot.
  const tier = (r) => (r.front ? (clear(r) ? (r.rank === 0 ? 3 : 2) : 1) : 0);
  const key = (r) =>
    tier(r) * 1e6 + r.frontScore * 100 + (r.tagged ? 25 : 0) + r.clean * 10 + (r.rank === 0 ? 1.5 : 0);

  // The photo on disk competes on the same terms: it keeps its place only if it
  // wins this ranking, so a case back that happens to score well still loses to
  // the listing's tagged front shot.
  const curTagged = Boolean(manifest[w.id]?.source && urls.some((u) => u.tagged && u.url === manifest[w.id].source));
  const pool = [{ current: true, tagged: curTagged, rank: -1, url: manifest[w.id]?.source || "file", ...cur }, ...scored];
  pool.sort((a, b) => key(b) - key(a) || a.rank - b.rank);
  const best = pool[0];
  // Replace when the winner is a real improvement: the frame on disk fails the
  // gate (any passing candidate wins, the ranking then choosing which), or the
  // winner is a cleaner tier, or it scores clearly higher. Without the margin, a
  // candidate that is the same picture at another URL - which Myntra offers
  // several of - would be re-encoded over itself on every run.
  const beats =
    best &&
    !best.current &&
    best.front &&
    best.url !== cur.url &&
    (!cur.front || tier(best) > tier(cur) || best.frontScore > cur.frontScore + 0.06);

  if (!beats) {
    rows.push({ id: w.id, brand: w.brand, model: w.model, action: cur.front ? (clear(cur) ? "keep" : "keep-weak") : "no-source", ...cur });
    if (!clear(cur)) {
      const bestCand = scored.length ? Math.max(...scored.map((s) => s.frontScore)) : null;
      hopeless.push({
        id: w.id,
        brand: w.brand,
        model: w.model,
        current: cur.front ? "weak-front" : cur.reason,
        best: bestCand,
        why: !scored.length
          ? "no-listing-record"
          : scored.some((s) => s.front)
            ? "current-still-best-front"
            : "listing-has-no-front-photo",
      });
    }
    continue;
  }

  rows.push({
    id: w.id,
    brand: w.brand,
    action: DRY ? "would-replace" : "replaced",
    from: { score: cur.frontScore, reason: cur.reason, clean: +cur.clean.toFixed(2) },
    to: { score: best.frontScore, clean: +best.clean.toFixed(2), url: best.url, rank: best.rank },
  });
  if (DRY) {
    replaced++;
    console.log(`DRY ${w.brand} ${w.model}: ${cur.reason || "weak"} (${cur.frontScore}) -> #${best.rank} (${best.frontScore})`);
    continue;
  }
  if (await tile(best.buf, path.join(OUT, path.basename(w.image || `${w.id}.webp`)))) {
    manifest[w.id] = { ...(manifest[w.id] || {}), brand: w.brand, model: w.model, source: best.url, front: true };
    replaced++;
    console.log(`FIX ${w.brand} ${w.model}: ${cur.reason || `weak ${cur.frontScore}`} -> #${best.rank} ${best.frontScore}`);
  }
}

writeJson(MANIFEST, JSON.stringify(manifest, null, 1));
fs.writeFileSync(path.join(ROOT, "tmp/front-fix.json"), JSON.stringify({ rows, hopeless }, null, 1));

const stillBad = rows.filter((r) => !["replaced", "would-replace"].includes(r.action) && !r.id);
const kept = rows.filter((r) => r.action === "keep").length;
console.log(`\nchecked ${checked} | replaced ${replaced} | kept (already front) ${kept}`);
if (byHand.length)
  console.log(`${byHand.length} left alone because a person picked the frame (--revisit-picked to override)`);
console.log(`no front-facing photo available: ${hopeless.length}`);
if (hopeless.length) console.log(hopeless.map((h) => `  ${h.brand} ${h.model} (${h.id}) best=${h.best}`).join("\n"));
void stillBad;

/* ---------- before/after contact sheet ---------- */
if (process.argv.some((a) => a === "--sheet" || a.startsWith("--sheet="))) {
  const done = rows.filter((r) => r.action === "replaced" || r.action === "would-replace").slice(0, numArg("sheet"));
  const CW = 170;
  const CH = 200;
  const COLS = 8;
  const composites = [];
  for (let i = 0; i < done.length; i++) {
    const r = done[i];
    const x = (i % COLS) * CW;
    const y = Math.floor(i / COLS) * CH;
    const w = catalog.find((c) => c.id === r.id);
    const f = path.join(OUT, path.basename(w.image));
    if (fs.existsSync(f)) {
      composites.push({
        input: await sharp(f).resize(CW - 12, CH - 40, { fit: "contain", background: "#ffffff" }).png().toBuffer(),
        left: x + 6,
        top: y + 4,
      });
    }
    const svg = `<svg width="${CW}" height="36"><rect width="${CW}" height="36" fill="#0f1720"/><text x="4" y="13" font-family="monospace" font-size="10" fill="#fff">${r.id.slice(0, 25)}</text><text x="4" y="26" font-family="monospace" font-size="10" fill="#fbb">${r.from.reason} ${r.from.score}</text><text x="4" y="36" font-family="monospace" font-size="10" fill="#8f8">-> #${r.to.rank} ${r.to.score}</text></svg>`;
    composites.push({ input: Buffer.from(svg), left: x, top: y + CH - 38 });
  }
  await sharp({ create: { width: COLS * CW, height: Math.ceil(done.length / COLS) * CH, channels: 3, background: "#111" } })
    .composite(composites)
    .png()
    .toFile(path.join(ROOT, "tmp/front-fix-sheet.png"));
  console.log(`sheet -> tmp/front-fix-sheet.png (${done.length} tiles)`);
}
