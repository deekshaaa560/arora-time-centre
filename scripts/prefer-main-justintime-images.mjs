import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, "src/data/catalog.json");
const OUT_DIR = path.join(ROOT, "public/products");
const REJECT_DIR = path.join(ROOT, "tmp/alternate-rejects");
const PROGRESS_PATH = path.join(ROOT, "tmp/extract/hires-progress.json");

fs.mkdirSync(REJECT_DIR, { recursive: true });

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
const state = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8"));
const byId = new Map(catalog.map((w) => [w.id, w]));
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
const modelHit = (w, text) => variants(w.model).some((v) => v.length >= 4 && norm(text).includes(v));
const brandOk = (vendor, brand) => {
  const v = String(vendor || "").toLowerCase();
  const b = String(brand || "").toLowerCase();
  if (b === "armani exchange") return v.includes("armani exchange") || v.includes("a|x");
  return v.includes(b);
};

function filename(url) {
  try { return decodeURIComponent((url || "").split("?")[0].split("/").pop() || ""); } catch { return ""; }
}
function isMainFile(file, model) {
  const n = norm(model);
  const f = String(file).toUpperCase();
  return new RegExp(`^${n}(?:[_-]1(?:[_-][A-Z0-9]+)?)?\\.(JPG|JPEG|PNG|WEBP)$`).test(f);
}

async function fetchJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const text = await res.text();
      if (text.includes("local_rate_limited")) throw new Error("rate limited");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(text);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(2500 + i * 2000);
    }
  }
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
async function sizeOf(buf) {
  const m = await sharp(buf).metadata();
  return Math.min(m.width || 0, m.height || 0);
}
async function writeImage(buf, file) {
  const min = await sizeOf(buf);
  if (min < 600) throw new Error(`source too small: ${min}`);
  const target = min >= 1000 ? 1200 : 1000;
  const tmp = file + ".tmp.webp";
  await sharp(buf, { failOn: "none" })
    .flatten({ background: "#ffffff" })
    .resize(target, target, { fit: "contain", background: "#ffffff", kernel: "lanczos3" })
    .webp({ quality: 92, effort: 5 })
    .toFile(tmp);
  fs.renameSync(tmp, file);
}

const targets = [];
for (const [id, done] of Object.entries(state.done || {})) {
  if (!done.source?.startsWith("justintime")) continue;
  const w = byId.get(id);
  if (!w || !w.image) continue;
  const f = filename(done.imageUrl);
  if (!isMainFile(f, w.model)) targets.push({ w, done, f });
}

console.log("Non-main justintime images:", targets.length);

let fixed = 0, kept = 0, failed = 0;
for (const { w, done, f } of targets) {
  console.log("checking", w.brand, w.model, f);
  let product = null;
  try {
    outer: for (const v of variants(w.model)) {
      const data = await fetchJson(
        `https://justintime.in/search/suggest.json?q=${encodeURIComponent(v)}&resources%5Btype%5D=product&resources%5Blimit%5D=10`,
      );
      const prods = data.resources?.results?.products ?? [];
      for (const p of prods) {
        if (brandOk(p.vendor, w.brand) && modelHit(w, `${p.title} ${p.handle}`)) {
          product = p;
          break outer;
        }
      }
      await sleep(900);
    }
  } catch (e) {
    console.log("  search err", String(e?.message || e));
  }

  if (!product) {
    failed++;
    console.log("  no product");
    await sleep(1000);
    continue;
  }

  let images = [];
  try {
    const js = await fetchJson(`https://justintime.in/products/${product.handle}.js`);
    images = (js.images || []).map((u) => (u.startsWith("//") ? `https:${u}` : u));
  } catch (e) {
    console.log("  js err", String(e?.message || e));
  }

  const main = images.find((u) => isMainFile(filename(u), w.model));
  const candidate = main || images.find((u) => /[_-](2|3)\.(jpg|jpeg|png|webp)$/i.test(filename(u)));
  if (!candidate) {
    kept++;
    console.log("  no main candidate");
    await sleep(800);
    continue;
  }

  try {
    const buf = await fetchBuf(candidate);
    const min = await sizeOf(buf);
    if (min < 600) {
      kept++;
      console.log("  main too small", min);
      await sleep(800);
      continue;
    }
    const file = path.join(OUT_DIR, path.basename(w.image));
    fs.copyFileSync(file, path.join(REJECT_DIR, path.basename(w.image)));
    await writeImage(buf, file);
    state.done[w.id] = { ...done, source: "justintime-main", imageUrl: candidate };
    fixed++;
    console.log("  FIXED", min, candidate);
  } catch (e) {
    failed++;
    console.log("  write err", String(e?.message || e));
  }
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 1));
  await sleep(1000);
}

fs.writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 1));
console.log({ fixed, kept, failed });
