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

async function fetchJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const text = await res.text();
      if (text.includes("local_rate_limited")) throw new Error("rate limited");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(text);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(2500 + i * 2500);
    }
  }
}

async function fetchImage(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.startsWith("image/")) throw new Error(`not image: ${ct}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 12000) throw new Error(`too small: ${buf.length}`);
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
  fs.renameSync(tmp, file);
}

const targets = Object.keys(state.failed || {})
  .map((id) => byId.get(id))
  .filter((w) => w && !["Titan", "Fastrack"].includes(w.brand));

console.log("Retrying", targets.length, "non-Titan/Fastrack failures at justintime");

let ok = 0, fail = 0;
for (const w of targets) {
  console.log("trying", w.brand, w.model);
  let found = null;
  try {
    outer: for (const v of variants(w.model)) {
      const data = await fetchJson(
        `https://justintime.in/search/suggest.json?q=${encodeURIComponent(v)}&resources%5Btype%5D=product&resources%5Blimit%5D=10`,
      );
      const prods = data.resources?.results?.products ?? [];
      const matches = prods.filter((p) => brandOk(p.vendor, w.brand) && modelHit(w, `${p.title} ${p.handle}`));
      for (const p of matches) {
        let images = [];
        try {
          const js = await fetchJson(`https://justintime.in/products/${p.handle}.js`);
          images = (js.images || []).map((u) => (u.startsWith("//") ? `https:${u}` : u));
        } catch {}
        if (!images.length && p.featured_image?.url) {
          images = [p.featured_image.url.startsWith("//") ? `https:${p.featured_image.url}` : p.featured_image.url];
        }
        images.sort((a, b) => Number(modelHit(w, b)) - Number(modelHit(w, a)));
        for (const img of images.slice(0, 4)) {
          try {
            const buf = await fetchImage(img);
            const meta = await sharp(buf).metadata();
            if (Math.min(meta.width || 0, meta.height || 0) < 900) continue;
            found = { buf, img, p };
            break outer;
          } catch {}
        }
      }
      await sleep(900);
    }
  } catch (e) {
    console.log("  search err", String(e?.message || e));
  }

  if (!found) {
    fail++;
    console.log("  FAIL");
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
    await writeImage(found.buf, file);
    if (!w.image) w.image = `/products/${name}`;
    state.done[w.id] = { source: "justintime-retry", imageUrl: found.img, file: name, at: new Date().toISOString() };
    delete state.failed[w.id];
    ok++;
    console.log("  OK", found.img);
  } catch (e) {
    fail++;
    console.log("  WRITE FAIL", String(e?.message || e));
  }
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 1));
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n");
  await sleep(1200);
}
console.log({ ok, fail, remaining: Object.keys(state.failed || {}).length });
