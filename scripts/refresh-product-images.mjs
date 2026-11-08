import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, "src/data/catalog.json");
const OUT_DIR = path.join(ROOT, "public/products");
const BACKUP_DIR = path.join(ROOT, "tmp/products-before-hires");
const PROGRESS_PATH = path.join(ROOT, "tmp/extract/hires-progress.json");
const CDN_COVERAGE_PATH = path.join(ROOT, "tmp/cdn-coverage.json");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
const cdn = fs.existsSync(CDN_COVERAGE_PATH)
  ? JSON.parse(fs.readFileSync(CDN_COVERAGE_PATH, "utf8"))
  : { results: [], misses: [] };
const cdnById = new Map(cdn.results.map((r) => [r.id, r]));

const state = fs.existsSync(PROGRESS_PATH)
  ? JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8"))
  : { done: {}, failed: {}, stats: {} };
state.done ??= {};
state.failed ??= {};
state.stats ??= {};

const ARGS = new Set(process.argv.slice(2));
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] || 0);
const FORCE = ARGS.has("--force");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1] || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function variants(model) {
  const n = norm(model);
  const out = new Set([n]);
  for (const p of ["RNU", "ENU", "NU", "NT", "NM", "NR", "NS", "E", "R", "T"]) {
    if (n.startsWith(p) && n.length - p.length >= 5) out.add(n.slice(p.length));
  }
  for (const v of [...out]) {
    for (const suf of ["W", "F"]) if (v.endsWith(suf) && v.length - 1 >= 6) out.add(v.slice(0, -1));
  }
  return [...out];
}

function brandOk(vendor, brand) {
  const v = String(vendor || "").toLowerCase();
  const b = String(brand || "").toLowerCase();
  if (b === "armani exchange") return v.includes("armani exchange") || v.includes("a|x");
  return v.includes(b);
}

function modelMatches(w, text) {
  const hay = norm(text);
  return variants(w.model).some((v) => v.length >= 4 && hay.includes(v));
}

async function fetchOk(url, { tries = 3, json = false, timeout = 45000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (json) return await res.json();
      const ct = res.headers.get("content-type") || "";
      if (!ct.startsWith("image/")) throw new Error(`not image: ${ct}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 12000) throw new Error(`too small: ${buf.length}`);
      return buf;
    } catch (e) {
      lastErr = e;
      await sleep(700 + i * 1200);
    }
  }
  throw lastErr;
}

async function writeImage(buf, outFile) {
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  const min = Math.min(meta.width || 0, meta.height || 0);
  if (min < 900) throw new Error(`source too small: ${meta.width}x${meta.height}`);
  const tmp = outFile + ".tmp.webp";
  await sharp(buf, { failOn: "none" })
    .flatten({ background: "#ffffff" })
    .resize(1200, 1200, {
      fit: "contain",
      background: "#ffffff",
      kernel: "lanczos3",
    })
    .webp({ quality: 92, effort: 5 })
    .toFile(tmp);
  fs.renameSync(tmp, outFile);
}

function backupExisting(w) {
  if (!w.image) return;
  const src = path.join(OUT_DIR, path.basename(w.image));
  if (!fs.existsSync(src)) return;
  const dst = path.join(BACKUP_DIR, path.basename(w.image));
  if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
}

function outFileFor(w) {
  const name = w.image ? path.basename(w.image) : `${w.id}.webp`;
  return { name, file: path.join(OUT_DIR, name) };
}

function bump(brand, key) {
  state.stats[brand] ??= { total: 0, replaced: 0, failed: 0, skipped: 0 };
  state.stats[brand][key] = (state.stats[brand][key] || 0) + 1;
}

function saveProgress() {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 1));
}

function saveCatalog() {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n");
}

async function justintimeProduct(w) {
  for (const v of variants(w.model)) {
    const url = `https://justintime.in/search/suggest.json?q=${encodeURIComponent(v)}&resources%5Btype%5D=product&resources%5Blimit%5D=10`;
    let data;
    try {
      data = await fetchOk(url, { json: true, tries: 2 });
    } catch {
      continue;
    }
    const products = data.resources?.results?.products ?? [];
    const matches = products.filter(
      (p) => brandOk(p.vendor, w.brand) && modelMatches(w, `${p.title} ${p.handle}`),
    );
    if (!matches.length) continue;
    matches.sort((a, b) => {
      const exact = (p) => (norm(`${p.title} ${p.handle}`).includes(norm(w.model)) ? 1 : 0);
      const price = (p) => {
        const n = Number(p.price);
        const gap = Math.min(
          Math.abs(n - w.price) / Math.max(1, w.price),
          Math.abs(n - w.mrp) / Math.max(1, w.mrp),
        );
        return Number.isFinite(gap) ? Math.max(0, 1 - gap) : 0;
      };
      return exact(b) - exact(a) || price(b) - price(a);
    });
    const p = matches[0];
    let img = p.featured_image?.url;
    if (!img && p.handle) {
      try {
        const js = await fetchOk(`https://justintime.in/products/${p.handle}.js`, {
          json: true,
          tries: 2,
        });
        img = js.images?.[0];
      } catch {}
    }
    if (img) return { imageUrl: img.startsWith("//") ? `https:${img}` : img, product: p };
    await sleep(200);
  }
  return null;
}

async function malabarProduct(w) {
  for (const v of variants(w.model)) {
    const url = `https://malabarwatches.com/search/suggest.json?q=${encodeURIComponent(v)}&resources%5Btype%5D=product&resources%5Blimit%5D=10`;
    let data;
    try {
      data = await fetchOk(url, { json: true, tries: 2 });
    } catch {
      continue;
    }
    const products = data.resources?.results?.products ?? [];
    const matches = products.filter(
      (p) => brandOk(p.vendor, w.brand) && modelMatches(w, `${p.title} ${p.handle}`),
    );
    if (matches.length) {
      const p = matches[0];
      let img = p.featured_image?.url;
      if (!img && p.handle) {
        try {
          const js = await fetchOk(`https://malabarwatches.com/products/${p.handle}.js`, {
            json: true,
            tries: 2,
          });
          img = js.images?.[0];
        } catch {}
      }
      if (img) return { imageUrl: img.startsWith("//") ? `https:${img}` : img, product: p };
    }
    await sleep(150);
  }
  return null;
}

async function processOne(w) {
  if (FORCE) delete state.done[w.id];
  if (state.done[w.id]) {
    const { file } = outFileFor(w);
    if (fs.existsSync(file)) {
      bump(w.brand, "skipped");
      return "skipped";
    }
  }

  const { name, file } = outFileFor(w);
  let source = null;
  let imageUrl = null;

  const cdnHit = cdnById.get(w.id);
  if (cdnHit) {
    source = "official-cdn";
    imageUrl = cdnHit.url;
  } else if (w.brand === "Titan" || w.brand === "Fastrack") {
    const fallback = await malabarProduct(w);
    if (fallback) {
      source = "malabar";
      imageUrl = fallback.imageUrl;
    }
  }

  if (!imageUrl) {
    const jt = await justintimeProduct(w);
    if (jt) {
      source = "justintime";
      imageUrl = jt.imageUrl;
    }
  }

  if (!imageUrl) throw new Error("no high-res source found");

  const buf = await fetchOk(imageUrl, { tries: 3 });
  backupExisting(w);
  await writeImage(buf, file);

  if (!w.image) w.image = `/products/${name}`;
  state.done[w.id] = { source, imageUrl, file: name, at: new Date().toISOString() };
  delete state.failed[w.id];
  bump(w.brand, "replaced");
  return "replaced";
}

let items = catalog.filter((w) => !ONLY || w.brand === ONLY);
if (LIMIT) items = items.slice(0, LIMIT);

console.log(`Processing ${items.length} watches (force=${FORCE}, only=${ONLY || "all"})`);

let processed = 0;
let replaced = 0;
let failed = 0;
let lastSave = Date.now();

async function worker() {
  while (items.length) {
    const w = items.shift();
    if (!w) break;
    try {
      const r = await processOne(w);
      if (r === "replaced") replaced++;
    } catch (e) {
      failed++;
      state.failed[w.id] = { reason: String(e?.message || e), at: new Date().toISOString() };
      bump(w.brand, "failed");
    }
    processed++;
    if (processed % 25 === 0) {
      console.log(
        `progress ${processed} replaced=${replaced} failed=${failed} remaining=${items.length}`,
      );
      saveProgress();
      saveCatalog();
      lastSave = Date.now();
    }
    await sleep(60);
  }
}

await Promise.all(Array.from({ length: 6 }, worker));

saveProgress();
saveCatalog();

const summary = {
  total: catalog.length,
  replaced,
  failed,
  stats: state.stats,
  failedItems: Object.entries(state.failed).map(([id, v]) => ({ id, ...v })),
};
fs.writeFileSync(path.join(ROOT, "tmp/extract/hires-summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ replaced, failed, stats: state.stats }, null, 1));
