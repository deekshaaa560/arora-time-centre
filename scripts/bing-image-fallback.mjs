import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, "src/data/catalog.json");
const OUT_DIR = path.join(ROOT, "public/products");
const BACKUP_DIR = path.join(ROOT, "tmp/products-before-hires");
const PROGRESS_PATH = path.join(ROOT, "tmp/extract/hires-progress.json");

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
const state = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8"));
const byId = new Map(catalog.map((w) => [w.id, w]));
const targets = Object.keys(state.failed || {})
  .map((id) => byId.get(id))
  .filter(Boolean)
  .filter((w) => (state.failed[w.id]?.attempts || 0) < 5);

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

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 40000);
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, signal: ctrl.signal });
  clearTimeout(t);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
async function fetchBuf(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 40000);
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal });
  clearTimeout(t);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.startsWith("image/")) throw new Error(`not image: ${ct}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 6000) throw new Error(`too small: ${buf.length}`);
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

function parseBing(html) {
  const out = [];
  for (const m of html.matchAll(/murl&quot;:&quot;(.*?)&quot;/g)) out.push(m[1].replace(/\\\//g, "/"));
  for (const m of html.matchAll(/"murl":"(.*?)"/g)) out.push(m[1].replace(/\\\//g, "/"));
  return [...new Set(out)].filter((u) => /^https?:\/\//.test(u));
}

console.log("Bing fallback for", targets.length, "failures");
let ok = 0, fail = 0;
for (const w of targets) {
  console.log("trying", w.brand, w.model);
  let best = null;
  try {
    const q = encodeURIComponent(`${w.brand} ${w.model} watch`);
    const html = await fetchText(`https://www.bing.com/images/search?q=${q}&form=HDRSC2`);
    const urls = parseBing(html);
    const ranked = [
      ...urls.filter((u) => modelHit(w, u)),
      ...urls.filter((u) => !modelHit(w, u) && !/(logo|icon|banner|sprite|favicon|placeholder)/i.test(u)),
    ];
    for (const u of ranked.slice(0, 12)) {
      try {
        const buf = await fetchBuf(u);
        const size = await sizeOf(buf);
        if (!best || size > best.size) best = { buf, url: u, size };
        if (size >= 900) break;
      } catch {}
      await sleep(200);
    }
  } catch (e) {
    console.log("  search err", String(e?.message || e));
  }

  if (!best || best.size < 600) {
    fail++;
    state.failed[w.id] = {
      ...(state.failed[w.id] || {}),
      attempts: (state.failed[w.id]?.attempts || 0) + 1,
      at: new Date().toISOString(),
    };
    console.log("  FAIL", best?.size || "none");
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 1));
    await sleep(1200);
    continue;
  }

  try {
    const name = w.image ? path.basename(w.image) : `${w.id}.webp`;
    const file = path.join(OUT_DIR, name);
    if (w.image) {
      const src = path.join(OUT_DIR, path.basename(w.image));
      const dst = path.join(BACKUP_DIR, path.basename(w.image));
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
    await writeImage(best.buf, file);
    if (!w.image) w.image = `/products/${name}`;
    state.done[w.id] = { source: "bing-images", imageUrl: best.url, file: name, at: new Date().toISOString() };
    delete state.failed[w.id];
    ok++;
    console.log("  OK", best.size, best.url);
  } catch (e) {
    fail++;
    console.log("  WRITE FAIL", String(e?.message || e));
  }
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 1));
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n");
  await sleep(1200);
}
console.log({ ok, fail, remaining: Object.keys(state.failed || {}).length });
