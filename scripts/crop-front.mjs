/**
 * Rescue a photo whose frame is right but crowded: the couple-pack images retailers
 * shoot - one watch facing the lens, its partner turned over - are two objects, so the
 * single-object storefront rule refuses them and the row keeps a photo showing a case
 * back. Cutting the front-facing watch out of such a frame gives the row its own
 * product shot, which is what the customer should see.
 *
 *   node scripts/crop-front.mjs --ids-file=tmp/bad.txt [--dry] [--force]
 *
 * Each object in the frame is cropped with a margin, re-tiled the way every other
 * pass tiles, and measured. The crop that passes the storefront gate and scores best
 * wins; if none does, the row is left alone. `--force` also considers rows whose whole
 * frame already passes (their crowded sibling might be the better shot).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { allComponents, classifyCanvas, gateOk, isClear, scoringCanvas, watchMask } from "./front-view.mjs";
import { writeJson } from "./write-json.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/myntra/brands-manifest.json");
const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const ids = (arg("ids") ? arg("ids").split(",") : [])
  .concat(arg("ids-file") ? fs.readFileSync(path.join(ROOT, arg("ids-file")), "utf8").split(/\s+/) : [])
  .map((s) => s.trim())
  .filter(Boolean);
if (!ids.length) {
  console.log("usage: node scripts/crop-front.mjs --ids=a,b | --ids-file=path [--dry]");
  process.exit(1);
}
const byId = new Map(catalog.map((w) => [w.id, w]));

/** 1000x1000 white tile, the shape the storefront expects. */
async function tile(buffer) {
  const resized = await sharp(buffer)
    .flatten({ background: "#ffffff" })
    .resize(1000, 1000, { fit: "inside", background: "#ffffff" })
    .sharpen({ sigma: 0.5, m1: 0.45, m2: 0.18 })
    .png()
    .toBuffer();
  return sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
    .composite([{ input: resized, gravity: "center" }])
    .webp({ quality: 92, alphaQuality: 92, effort: 5 })
    .toBuffer();
}

/**
 * When the frame on disk holds no dial at all (the supplier photographed the pair from
 * behind), the same cut is tried on the candidates `source-front-online.mjs --sheet`
 * found for this row: a couple-pack shot with both watches facing the lens fails the
 * single-object rule, but one watch cut out of it passes, and it is the row's own
 * product. `--from-candidates` turns that on.
 */
const FROM_CANDS = process.argv.includes("--from-candidates");
const CACHE = path.join(ROOT, "tmp/imgcache");
const webmap = FROM_CANDS && fs.existsSync(path.join(ROOT, "tmp/webpick.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "tmp/webpick.json"), "utf8"))
  : {};
const cachedFile = (u) => path.join(CACHE, createHash("sha1").update(u).digest("hex"));

/** Every frame this row could be photographed from: the one in use, then the web's. */
async function sourcesFor(w) {
  const list = [];
  const file = w.image && path.join(OUT, path.basename(w.image));
  if (file && fs.existsSync(file)) list.push({ name: "on disk", buf: await fs.promises.readFile(file) });
  for (const c of webmap[w.id] || []) {
    const f = cachedFile(c.url);
    if (fs.existsSync(f) && fs.statSync(f).size > 2000) list.push({ name: `#${c.url.slice(-18)}`, buf: await fs.promises.readFile(f), url: c.url });
  }
  return list;
}

/** Cut every object out of one frame and keep the ones that pass as a solo product shot. */
async function cropsFrom(buf) {
  const base = await sharp(buf).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  let trimmed = base;
  try {
    trimmed = await sharp(base).trim({ threshold: 8 }).png().toBuffer();
  } catch {
    /* uniform */
  }
  const meta = await sharp(trimmed).metadata();
  const canvas = await scoringCanvas(buf);
  const TW = canvas.info.width;
  const TH = canvas.info.height;
  const scale = Math.min(760 / meta.width, 760 / meta.height);
  const offX = (TW - Math.round(meta.width * scale)) / 2;
  const offY = (TH - Math.round(meta.height * scale)) / 2;
  const lum = new Uint8Array(TW * TH);
  for (let i = 0; i < TW * TH; i++) {
    const o = i * canvas.info.channels;
    lum[i] = (canvas.data[o] * 299 + canvas.data[o + 1] * 587 + canvas.data[o + 2] * 114) / 1000;
  }
  const out = [];
  for (const [k, c] of allComponents(watchMask(lum, TW, TH), TW, TH, 0.015).entries()) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    const pad = Math.round(0.06 * Math.max(bw, bh));
    const sx = Math.max(0, Math.floor((c.minX - pad - offX) / scale));
    const sy = Math.max(0, Math.floor((c.minY - pad - offY) / scale));
    const sw = Math.min(meta.width - sx, Math.ceil((bw + 2 * pad) / scale));
    const sh = Math.min(meta.height - sy, Math.ceil((bh + 2 * pad) / scale));
    if (sw < 120 || sh < 120) continue;
    let cut;
    try {
      cut = await sharp(trimmed).extract({ left: sx, top: sy, width: sw, height: sh }).png().toBuffer();
    } catch {
      continue;
    }
    const r = classifyCanvas(await scoringCanvas(cut));
    out.push({ k, cut, r, ok: gateOk(r) && isClear(r) });
  }
  return out;
}

let cropped = 0;
let hopeless = 0;
for (const id of ids) {
  const w = byId.get(id);
  if (!w?.image) continue;
  const file = path.join(OUT, path.basename(w.image));
  if (!fs.existsSync(file)) continue;
  const buf = await fs.promises.readFile(file);
  const canvas = await scoringCanvas(buf);
  const now = classifyCanvas(canvas);
  if (!FORCE && gateOk(now) && isClear(now)) {
    console.log(`keep ${w.id} - the frame already passes`);
    continue;
  }
  const frames = FROM_CANDS ? await sourcesFor(w) : [{ name: "on disk", buf }];
  // Prefer a crop that carries hour markers over one that merely passes: a supplier
  // photographing a couple pack from behind produces a clasp-and-case-back crop that
  // measures perfectly clean (s=0.93) while showing no dial at all, and it outranks
  // the real front view of the same watch, which scores lower for having a thin strap
  // in shot. Marker symmetry is the difference, so it decides first.
  const rank = (t) => (t.r.twelve >= 0.28 ? 1000 : 0) + t.r.frontScore;
  let best = null;
  const seen = [];
  for (const f of frames) {
    for (const t of await cropsFrom(f.buf)) {
      seen.push(`${f.name}:obj${t.k}${t.ok ? " PASS" : ""}`);
      if (t.ok && (!best || rank(t) > rank(best))) best = { ...t, from: f };
    }
  }
  const describe = seen.join(" | ").slice(0, 220);
  if (!best) {
    hopeless++;
    console.log(`miss ${w.id} - nothing to cut out (${describe})`);
    continue;
  }
  cropped++;
  console.log(
    `${DRY ? "DRY  " : "CROP "} ${w.id} - ${now.reason || "weak"} -> ${best.from.name} obj${best.k} (s=${best.r.frontScore} mk=${best.r.twelve} det=${best.r.detail})`,
  );
  if (!DRY) {
    await fs.promises.writeFile(file, await tile(best.cut));
    manifest[w.id] = {
      ...(manifest[w.id] || {}),
      brand: w.brand,
      model: w.model,
      source: best.from.url || manifest[w.id]?.source,
      front: true,
      cropped: `${best.from.name} obj${best.k}`,
    };
  }
}
if (!DRY && cropped) writeJson(MANIFEST, JSON.stringify(manifest, null, 1));
console.log(`\ncropped ${cropped} crowded frame(s) down to the watch | ${hopeless} had no clean object to cut out`);
