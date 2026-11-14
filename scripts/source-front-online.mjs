/**
 * Source a clean front-view photo for watches whose current image is a side
 * profile, a case back, packaging or a model shot - and which have no listing
 * dump to re-pick from (the distributor-sheet brands: Titan, Fastrack, Timex).
 *
 * Sources, in order:
 *   1. Myntra, searched by model code (their catalogue labels the straight-on
 *      image with view "front", which is exactly the shot wanted).
 *   2. Bing image search for "<brand> <model> watch", filtered to results whose
 *      page title or source URL repeats the model code, so we land on a real
 *      product photo rather than a lookalike.
 *
 * Every candidate must pass scripts/front-view.mjs (dial facing the lens, no
 * person, no extras in frame). Backgrounds that are not white are flooded to
 * white before tiling, so a brand-site photo matches the rest of the catalog.
 *
 *   node scripts/source-front-online.mjs --brands="Titan,Fastrack,Timex" [--dry] [--limit=n]
 *   node scripts/source-front-online.mjs --ids=titan-r2815wm01,...
 *   node scripts/source-front-online.mjs --needs-sourcing     # rows with no price yet
 *   node scripts/source-front-online.mjs --ids-file=f --sheet # show every candidate, choose by eye
 *   node scripts/source-front-online.mjs --picks-file=tmp/picks.txt  # install those choices
 *
 * --brands checks those brands itself first, so only frames that are really
 * wrong get re-fetched. A frame with two watches (a pair SKU photographed as a
 * couple, or nothing better available) is accepted as a last resort and logged
 * as "loose". Decisions land in tmp/source-front.json; provenance in the
 * brands manifest.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { classifyImage, gateOk, isClear, isSet } from "./front-view.mjs";
import { pruneRemoved, writeJson } from "./write-json.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const CACHE = path.join(ROOT, "tmp/imgcache");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/myntra/brands-manifest.json");
const AUDIT = path.join(ROOT, "tmp/front-audit.json");
const DRY = process.argv.includes("--dry");
const STRICT = process.argv.includes("--strict"); // refuse pair/duo frames even as a fallback
fs.mkdirSync(CACHE, { recursive: true });

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "accept-language": "en-IN,en;q=0.9",
  accept: "text/html,application/xhtml+xml",
};
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};

async function cachedFetch(url) {
  const key = createHash("sha1").update(url).digest("hex");
  const file = path.join(CACHE, key);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA["user-agent"] } });
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

function jsonBefore(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  let s = html.slice(i + marker.length, html.indexOf("</script>", i)).trimEnd();
  if (s.endsWith(";")) s = s.slice(0, -1);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Myntra products whose title carries the model code, with the tagged front image first. */
async function fromMyntra(brand, model) {
  try {
    const res = await fetch(`https://www.myntra.com/${encodeURIComponent(model)}`, { headers: UA });
    if (!res.ok) return [];
    const myx = jsonBefore(await res.text(), "window.__myx = ");
    const products = myx?.searchData?.results?.products || [];
    const code = norm(model);
    const hits = products.filter((p) => norm(p.product || p.name).includes(code));
    const urls = [];
    for (const p of hits.slice(0, 2)) {
      const imgs = (p.images || []).filter((im) => im?.src);
      const src = (u) => String(u).replace(/^http:/, "https:");
      const meta = {
        rec: p,
        price: Number(p.price) || 0,
        mrp: Number(p.mrp) || 0,
        discount: Number(p.discount) || 0,
        gender: /women|ladies|girl/.test(String(p.gender || "").toLowerCase())
          ? "women"
          : /men|male|boy/.test(String(p.gender || "").toLowerCase())
            ? "men"
            : "unisex",
      };
      for (const view of ["front", "default", "search"]) {
        const im = imgs.find((i2) => String(i2.view) === view);
        if (im) urls.push({ url: src(im.src), tagged: view === "front", via: "myntra", title: p.product || p.name, ...meta });
      }
      for (const im of imgs)
        if (!urls.some((u) => u.url === src(im.src))) urls.push({ url: src(im.src), tagged: false, via: "myntra", title: p.product || p.name, ...meta });
    }
    return urls;
  } catch {
    return [];
  }
}

/**
 * Bing image search. The model code on the distributor sheet is not always the
 * code retailers use (sheet TW000R420 is sold as TI000R420), so each code is
 * tried as-is and with its leading letters stripped. A hit only counts when the
 * searched variant really appears in the result's title or URL, which keeps
 * lookalike siblings (2715WM01 for R2815WM01) out.
 */
function codeVariants(model) {
  const raw = norm(model);
  const out = [raw];
  const stripped = raw.replace(/^(TW|TX|TI|TB|NT|EN|NL|ML|SL|QL|GM|CG|FA|NS|NU|NZ|R|G|D|A|B|C|E|H|J|K|M|P|S|U|V|W|Y|Z)+/, "");
  if (stripped.length >= 5 && stripped !== raw) out.push(stripped);
  const tail = raw.replace(/^[A-Z]+/, "").replace(/^0+/, "");
  if (tail.length >= 6 && !out.includes(tail)) out.push(tail);
  return out;
}

// Official brand CDNs first: their catalogue photography is the cleanest.
const HOST_RANK = [
  ["titan.co.in", 6],
  ["fastrack.in", 6],
  ["titanworld.com", 6],
  ["timex.in", 6],
  ["myntassets.com", 5],
  ["assets.ajio.com", 5],
  ["justintime.in", 4],
  ["swisstimehouse", 3],
  ["media-amazon", 1],
];
const hostScore = (url) => HOST_RANK.find(([h]) => String(url).includes(h))?.[1] ?? 0;

async function fromBing(brand, model) {
  const seen = new Set();
  const out = [];
  for (const variant of codeVariants(model)) {
    const query = `${brand} ${variant} watch`;
    let html = "";
    for (let attempt = 0; attempt < 3 && !html; attempt++) {
      try {
        const res = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
            "accept-language": "en-US,en;q=0.9",
          },
        });
        if (res.status === 429) throw new Error("429");
        if (res.ok) html = await res.text();
      } catch {
        /* retry */
      }
      await sleep(1500 * (attempt + 1));
    }
    for (const m of html.matchAll(/class="iusc"[^>]*?m="([^"]+)"/g)) {
      try {
        const d = JSON.parse(decodeURIComponent(m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"')));
        if (!d.murl) continue;
        const url = String(d.murl).replace(/&amp;/g, "&");
        if (seen.has(url)) continue;
        if (!norm(`${d.t || ""} ${d.purl || ""} ${url}`).includes(variant)) continue; // must really be this model
        if (/\.(svg|gif|mp4)(\?|$)/i.test(url)) continue;
        seen.add(url);
        out.push({ url, tagged: false, via: "bing", host: hostScore(url), title: d.t || "" });
      } catch {
        /* skip tile */
      }
    }
    await sleep(400);
  }
  return out.sort((a, b) => b.host - a.host).slice(0, 10);
}

/** Shopify stores publish a JSON API; Sonata's own shop (titanworld) and
 *  justintime still list codes that Myntra has delisted, and their product
 *  record carries every photo plus the live price. */
const SHOPIFY_SHOPS = ["www.justintime.in", "www.titanworld.com"];

async function fetchJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { ...UA, accept: "application/json" }, redirect: "follow" });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status !== 503) return null;
    } catch {
      /* retry */
    }
    await sleep(1000 * (i + 1));
  }
  return null;
}

async function fromShopify(brand, model) {
  const code = String(model || "").trim();
  if (code.length < 4) return [];
  const out = [];
  for (const host of SHOPIFY_SHOPS) {
    // titanworld registers Sonata codes without the shop's NT prefix.
    const queries = [code];
    if (/^NT\d/i.test(code)) queries.push(code.replace(/^NT/i, ""));
    let hits = [];
    for (const q of queries) {
      const j = await fetchJson(
        `https://${host}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=6`,
      );
      hits = ((j && j.resources?.results?.products) || []).filter((p) => norm(p.title).includes(norm(q)));
      if (hits.length) break;
    }
    await sleep(200);
    for (const h of hits.slice(0, 2)) {
      const detail = await fetchJson(`https://${host}/products/${h.handle}.json`);
      const p = detail && detail.product;
      if (!p) continue;
      const v = (p.variants || [])[0] || {};
      const price = Math.round(Number(v.price ?? h.price) || 0);
      const mrp = Math.round(Number(v.compare_at_price) || 0) || price;
      const title = String(p.title || h.title || "");
      const tags = String(p.tags || "");
      const gender = /women|female/i.test(`${title} ${tags}`)
        ? "women"
        : /men\b|male|boys|girls|kids/i.test(`${title} ${tags}`)
          ? "men"
          : null;
      for (const im of (p.images || []).slice(0, 6)) {
        const src = String(im.src || "").split("?")[0];
        if (!/^https?:/.test(src)) continue;
        out.push({
          url: `${src}?width=1200`,
          tagged: false,
          via: "shopify",
          host: 3,
          title,
          price,
          mrp,
          discount: mrp > price ? Math.round((1 - price / mrp) * 100) : 0,
          gender,
        });
      }
      await sleep(200);
    }
    if (out.length) break;
  }
  return out;
}

/** Flood the border colour to white, so brand-site shots match the white tiles. */
async function toWhite(buffer) {
  const img = sharp(buffer).rotate().flatten({ background: "#ffffff" });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const ch = info.channels;
  const px = (i) => [data[i * ch], data[i * ch + 1], data[i * ch + 2]];
  const corners = [px(0), px(W - 1), px((H - 1) * W), px(H * W - 1)];
  const ref = corners[0];
  const near = (i) => {
    const [r, g, b] = px(i);
    return corners.some(([cr, cg, cb]) => Math.abs(r - cr) + Math.abs(g - cg) + Math.abs(b - cb) < 90);
  };
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let sp = 0;
  const push = (i) => {
    if (!seen[i] && near(i)) {
      seen[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < W; x++) {
    push(x);
    push((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    push(y * W);
    push(y * W + W - 1);
  }
  while (sp) {
    const p = stack[--sp];
    const x = p % W;
    const y = (p - x) / W;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (y > 0) push(p - W);
    if (y < H - 1) push(p + W);
  }
  for (let i = 0; i < W * H; i++) {
    if (!seen[i]) continue;
    data[i * ch] = 255;
    data[i * ch + 1] = 255;
    data[i * ch + 2] = 255;
  }
  return sharp(Buffer.from(data), { raw: { width: W, height: H, channels: ch } }).png().toBuffer();
}

/** Official 1000x1000 white tile as a buffer, so candidates are judged exactly
 *  the way the finished storefront photo will be judged. */
async function prepareTile(buffer) {
  const raw = await sharp(buffer).grayscale().raw().toBuffer();
  let light = 0;
  for (let i = 0; i < raw.length; i += 7) if (raw[i] >= 242) light++;
  const whiteFrac = light / Math.ceil(raw.length / 7);
  let base = whiteFrac < 0.55 ? await toWhite(buffer) : buffer; // brand-site / lifestyle background
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
    .resize(Math.max(1, Math.round(info.width * scale)), Math.max(1, Math.round(info.height * scale)), { fit: "inside", kernel: "lanczos3" })
    .sharpen({ sigma: 0.5, m1: 0.45, m2: 0.18 })
    .png()
    .toBuffer();
  return sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
    .composite([{ input: resized, gravity: "center" }])
    .webp({ quality: 92, alphaQuality: 92, effort: 5 })
    .toBuffer();
}

async function writeTile(tiled, file) {
  const tmp = `${file}.tmp.webp`;
  fs.writeFileSync(tmp, tiled);
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

/* ---------- targets ---------- */
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const byId = new Map(catalog.map((w) => [w.id, w]));

/** Classify rows live: which of them is not a clean front view right now. */
async function flaggedNow(brands) {
  const out = [];
  let n = 0;
  for (const w of catalog) {
    if (brands.length && !brands.includes(String(w.brand).toLowerCase())) continue;
    if (!w.image) continue;
    const file = path.join(ROOT, "public", w.image.replace(/^\//, ""));
    if (!fs.existsSync(file)) {
      out.push(w);
      continue;
    }
    let r;
    try {
      r = await classifyImage(await fs.promises.readFile(file));
    } catch {
      continue;
    }
    const setOk = isSet(w) && gateOk(r, { allowMultiple: true });
    if (!r.front && !setOk) out.push(w);
    if (++n % 250 === 0) console.log(`  checking ${n} (${out.length} to re-source)`);
  }
  return out;
}

let targets = [];
if (arg("ids")) targets = arg("ids").split(",").map((s) => byId.get(s.trim())).filter(Boolean);
else if (arg("ids-file")) {
  const ids = fs
    .readFileSync(path.join(ROOT, arg("ids-file")), "utf8")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  targets = ids.map((id) => byId.get(id)).filter(Boolean);
} else if (process.argv.includes("--needs-sourcing")) {
  targets = catalog.filter((w) => w.needsSourcing || !w.price);
} else if (arg("picks-file")) {
  // Picks are applied from the saved candidate map; no need to look at targets.
  targets = [];
} else {
  // --brands audits those brands itself, so a stale tmp/front-audit.json from
  // another run can never make this a no-op.
  const brands = (arg("brands", "") || "Titan,Fastrack,Timex").split(",").map((s) => s.trim().toLowerCase());
  console.log(`checking ${brands.join(", ")} for frames that need re-sourcing`);
  targets = await flaggedNow(brands);
}
const limit = Number(arg("limit", "0")) || Infinity;
targets = targets.slice(0, limit);

/**
 * One labelled strip per watch: the photo in use, then every candidate the web
 * offered, numbered in the order --picks-file uses. Caption carries the detector's
 * verdict so a suspicious frame can be spotted without leaving the image.
 */
async function writeCandidateSheet(w, evaluated) {
  const S = 220;
  const CAP = 30;
  const tiles = [];
  const current = w.image && fs.existsSync(path.join(OUT, path.basename(w.image)))
    ? await sharp(await fs.promises.readFile(path.join(OUT, path.basename(w.image))))
        .flatten({ background: "#ffffff" })
        .resize(S, S)
        .png()
        .toBuffer()
    : null;
  const capOf = (label, r) =>
    `${label} s=${r.frontScore} r=${r.radius} mk=${r.twelve} ${gateOk(r) ? "gate:ok" : "gate:" + r.reason}`;
  const add = async (buf, caption) => {
    const svg = Buffer.from(
      `<svg width="${S}" height="${S + CAP}"><image href="data:image/png;base64,${buf.toString("base64")}" width="${S}" height="${S}"/>` +
        `<rect y="${S}" width="${S}" height="${CAP}" fill="#111"/>` +
        `<text x="3" y="${S + 12}" font-family="monospace" font-size="9" fill="#fff">${caption.slice(0, 32)}</text>` +
        `<text x="3" y="${S + 24}" font-family="monospace" font-size="9" fill="#9cf">${caption.slice(32, 64)}</text></svg>`,
    );
    tiles.push(await sharp(svg).png().toBuffer());
  };
  if (current) await add(current, capOf("NOW", await classifyImage(current)));
  for (let i = 0; i < evaluated.length; i++) await add(await sharp(evaluated[i].tiled).resize(S, S).png().toBuffer(), capOf(`#${i}`, evaluated[i].r));
  if (!tiles.length) {
    console.log(`SHEET ${w.brand} ${w.model}: nothing to show (no candidates, no photo on disk)`);
    return;
  }
  const cols = Math.min(8, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const file = path.join(ROOT, "tmp", `webpick-${w.id}.png`);
  await sharp({ create: { width: cols * (S + 4), height: rows * (S + CAP + 4), channels: 3, background: "#333" } })
    .composite(tiles.map((input, i) => ({ input, left: (i % cols) * (S + 4), top: Math.floor(i / cols) * (S + CAP + 4) })))
    .png()
    .toFile(file);
  console.log(`SHEET ${w.brand} ${w.model} -> ${path.relative(ROOT, file)} (${tiles.length - 1} candidates)`);
  await sleep(80);
}

/* ---------- picks mode: install a frame chosen from an earlier --sheet run ---------- */
const PICKS_FILE = arg("picks-file");
if (PICKS_FILE) {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp/webpick.json"), "utf8"));
  const picks = fs
    .readFileSync(path.join(ROOT, PICKS_FILE), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [id, idx] = l.split(/[=\s]+/);
      return { id, idx: Number(idx) };
    });
  let installed = 0;
  let touchedCatalog = false;
  const failed = [];
  for (const pick of picks) {
    const w = byId.get(pick.id);
    const cand = ((map[pick.id] || [])[pick.idx] || {}).url ? map[pick.id][pick.idx] : null;
    if (!w || !cand) {
      failed.push(`${pick.id}=${pick.idx}`);
      console.log(`SKIP ${pick.id}=${pick.idx} (no such row or candidate)`);
      continue;
    }
    const buf = await cachedFetch(cand.url);
    if (!buf) {
      failed.push(`${pick.id}=${pick.idx}`);
      console.log(`SKIP ${pick.id}=${pick.idx} (fetch failed)`);
      continue;
    }
    const file = path.join(OUT, path.basename(w.image || `${w.id}.webp`));
    if (!(await writeTile(await prepareTile(buf), file))) {
      failed.push(`${pick.id}=${pick.idx}`);
      console.log(`SKIP ${pick.id}=${pick.idx} (write failed)`);
      continue;
    }
    if (!w.image) {
      w.image = `/products/${path.basename(file)}`;
      touchedCatalog = true;
    }
    manifest[w.id] = { ...(manifest[w.id] || {}), brand: w.brand, model: w.model, source: cand.url, front: true, picked: true };
    installed++;
    console.log(`PICK ${w.brand} ${w.model} <- #${pick.idx} ${cand.via || ""} ${cand.url.slice(0, 70)}`);
    await sleep(150);
  }
  if (installed) {
    writeJson(MANIFEST, JSON.stringify(manifest, null, 1));
    if (touchedCatalog) writeJson(CATALOG, JSON.stringify(pruneRemoved(catalog), null, 1) + "\n");
  }
  console.log(`\ninstalled ${installed}/${picks.length}${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
  process.exit(0);
}

console.log(`sourcing front views for ${targets.length} watches`);
const SHEET = process.argv.includes("--sheet");
const sheetMap = {};
const results = [];
let fixed = 0;
let repriced = 0;
const missing = [];
let catalogDirty = false;
// A frame a person chose by eye is not re-chosen by an automated sweep - see the same
// guard in fix-front-views.mjs. Naming rows with --ids/--ids-file, or asking for a
// candidate sheet, is a deliberate request and still goes through.
const NAMED = Boolean(arg("ids") || arg("ids-file"));
const REVISIT = process.argv.includes("--revisit-picked");
let byHand = 0;
for (const w of targets) {
  if (!NAMED && !SHEET && !REVISIT && manifest[w.id]?.picked) {
    byHand++;
    continue;
  }
  const cands = [
    ...(await fromMyntra(w.brand, w.model)),
    ...(await fromShopify(w.brand, w.model)),
    ...(await fromBing(w.brand, w.model)),
  ].slice(0, 14);
  let best = null;
  const evaluated = [];
  for (const c of cands) {
    const buf = await cachedFetch(c.url);
    if (!buf) continue;
    let tiled;
    let r;
    try {
      tiled = await prepareTile(buf);
      r = await classifyImage(tiled);
    } catch {
      continue;
    }
    evaluated.push({ url: c.url, via: c.via, tagged: !!c.tagged, tiled, r });
    // Never a profile, a case back, a printed card or a person: a real case
    // facing the lens, with a circular crystal edge - and something on the disc
    // only a dial has. Without the dial proof a "TIMEX Certificate of
    // Authenticity" card passes the geometry (its gold seal is a ringed disc)
    // and can ship as the photo of a watch (TW00PR344 did).
    if (!gateOk(r)) continue;
    const dialProof = r.frontScore >= 0.95 || r.detail >= 0.3 || r.twelve >= 0.45;
    if (!dialProof) continue;
    // Strict = the watch alone. A pair shot (couple SKU, or all we can find) is
    // kept as a fallback so the watch is at least shown from the front.
    const strict = r.front || (isSet(w) && r.cluttered);
    if (!strict && STRICT) continue;
    const score =
      (strict ? 1e9 : 0) + r.frontScore * 1000 + (c.tagged ? 30 : 0) + (c.host || 0) * 5 + Math.min(1, r.clean) * 10;
    if (!best || score > best.score) best = { ...c, score, strict, tiled, ...r };
    await sleep(120);
  }
  if (SHEET) {
    // Show every frame the web offered, in the order a pick is numbered, so a
    // human (or a careful look) can choose. The gate has been wrong about Michael
    // Kors clasps and marketing cards often enough that its opinion is printed but
    // not obeyed here.
    sheetMap[w.id] = evaluated.map((e) => ({
      url: e.url,
      via: e.via,
      tagged: e.tagged,
      s: e.r.frontScore,
      ok: gateOk(e.r) && (e.r.frontScore >= 0.95 || e.r.detail >= 0.3 || e.r.twelve >= 0.45),
    }));
    await writeCandidateSheet(w, evaluated);
    continue;
  }
  if (!best) {
    missing.push({ id: w.id, brand: w.brand, model: w.model, candidates: cands.length });
    results.push({ id: w.id, action: "no-source", candidates: cands.length });
    console.log(`MISS ${w.brand} ${w.model} (${cands.length} candidates, none a clean front view)`);
    continue;
  }
  // A restored placeholder row also needs its price back: the retailer hit that
  // supplied the photo carries the live price, MRP and gender.
  if (best.price > 0 && (!w.price || w.needsSourcing)) {
    w.price = best.price;
    w.mrp = best.mrp || best.price;
    w.discount = best.discount || 0;
    if (["men", "women", "unisex"].includes(best.gender)) w.gender = best.gender;
    delete w.needsSourcing;
    catalogDirty = true;
    repriced++;
  }
  results.push({
    id: w.id,
    brand: w.brand,
    model: w.model,
    action: DRY ? "would-source" : "sourced",
    via: best.via,
    tagged: best.tagged, strict: best.strict,
    url: best.url,
    score: best.frontScore,
    clean: +best.clean.toFixed(2),
  });
  // Write whatever file this row actually points at: some sheet-stock rows were
  // re-pointed to a whitened "-w" variant by an earlier pass.
  const target = path.join(OUT, path.basename(w.image || `${w.id}.webp`));
  if (!DRY && (await writeTile(best.tiled, target))) {
    manifest[w.id] = { ...(manifest[w.id] || {}), brand: w.brand, model: w.model, source: best.url, origin: best.via, front: true };
    fixed++;
  }
  console.log(`${DRY ? "DRY " : "GOT  "}${w.brand} ${w.model} <- ${best.via}${best.tagged ? "(front-tagged)" : ""}${best.strict ? "" : " [pair frame]"} ${best.frontScore} ${best.url.slice(0, 80)}`);
  await sleep(250);
}

if (SHEET) {
  // Accumulate across runs so a pick file can name rows gathered on different days.
  const file = path.join(ROOT, "tmp/webpick.json");
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  writeJson(file, JSON.stringify({ ...prev, ...sheetMap }, null, 1));
  console.log(`\ncandidate maps for ${Object.keys(sheetMap).length} rows -> tmp/webpick.json`);
  console.log("pick with:  node scripts/source-front-online.mjs --picks-file=tmp/picks.txt");
  process.exit(0);
}

if (!DRY) {
  writeJson(MANIFEST, JSON.stringify(manifest, null, 1));
  if (catalogDirty) writeJson(CATALOG, JSON.stringify(pruneRemoved(catalog), null, 1) + "\n");
}
fs.writeFileSync(path.join(ROOT, "tmp/source-front.json"), JSON.stringify({ results, missing }, null, 1));
console.log(`\nsourced ${fixed || results.filter((r) => r.action === "would-source").length} | repriced ${repriced} | no clean front found ${missing.length} (dry=${DRY})`);
if (missing.length) console.log(missing.map((m) => `  ${m.brand} ${m.model} (${m.id})`).join("\n"));
