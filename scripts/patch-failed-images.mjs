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
const failed = Object.keys(state.failed || {})
  .map((id) => byId.get(id))
  .filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const variants = (m) => {
  const n = norm(m);
  const out = new Set([n]);
  for (const p of ["RNU", "ENU", "NU", "NT", "NM", "NR", "NS", "E", "R", "T"]) {
    if (n.startsWith(p) && n.length - p.length >= 5) out.add(n.slice(p.length));
  }
  for (const v of [...out]) for (const s of ["W", "F"]) if (v.endsWith(s) && v.length - 1 >= 6) out.add(v.slice(0, -1));
  return [...out];
};
const modelHit = (w, text) => variants(w.model).some((v) => norm(text).includes(v));
const brandOk = (vendor, brand) => {
  const v = String(vendor || "").toLowerCase();
  const b = String(brand || "").toLowerCase();
  if (b === "armani exchange") return v.includes("armani exchange") || v.includes("a|x");
  return v.includes(b);
};

async function fetchText(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45000);
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(800 + i * 1000);
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
  if (min < 800) throw new Error(`source too small: ${meta.width}x${meta.height}`);
  const tmp = file + ".tmp.webp";
  await sharp(buf, { failOn: "none" })
    .flatten({ background: "#ffffff" })
    .resize(1200, 1200, { fit: "contain", background: "#ffffff", kernel: "lanczos3" })
    .webp({ quality: 92, effort: 5 })
    .toFile(tmp);
  fs.renameSync(tmp, file);
}

function extractImages(html, pageUrl) {
  const urls = new Set();
  for (const m of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/"image"\s*:\s*"([^"]+)"/g)) urls.add(m[1]);
  for (const m of html.matchAll(/"image"\s*:\s*\[([^\]]+)\]/g)) {
    for (const x of m[1].matchAll(/"([^"]+)"/g)) urls.add(x[1]);
  }
  for (const m of html.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) urls.add(m[1]);
  const out = [];
  for (let u of urls) {
    u = u.replace(/&amp;/g, "&").replace(/\\\//g, "/");
    if (u.startsWith("//")) u = `https:${u}`;
    if (u.startsWith("/")) u = new URL(u, pageUrl).href;
    if (/^https?:\/\//.test(u)) out.push(u);
  }
  return [...new Set(out)];
}

function ddgLinks(html) {
  const links = new Set();
  for (const m of html.matchAll(/uddg=([^&"']+)/g)) {
    try { links.add(decodeURIComponent(m[1])); } catch {}
  }
  return [...links];
}

const preferred = [
  "timex.in", "timexindia.com", "titan.co.in", "fastrack.in", "justintime.in",
  "malabarwatches.com", "swisstimehouse.com", "myntra.com", "flipkart.com",
  "amazon.in", "nykaa.com", "tatacliq.com", "ajio.com",
];

const BRAND_BASE = {
  Titan: "https://www.titan.co.in/dw/image/v2/BKDD_PRD/on/demandware.static/-/Sites-titan-master-catalog/default/images/Titan/Catalog",
  Fastrack: "https://www.fastrack.in/dw/image/v2/BKDD_PRD/on/demandware.static/-/Sites-titan-master-catalog/default/images/Fastrack/Catalog",
};

async function officialCdnFallback(w) {
  const base = BRAND_BASE[w.brand];
  if (!base) return null;
  for (const v of variants(w.model)) {
    for (const suffix of ["_1", "_2", "_3", "_4", "_5", "_6"]) {
      const url = `${base}/${v}${suffix}.jpg?sw=2000&sh=2000`;
      try {
        const buf = await fetchImage(url);
        const meta = await sharp(buf).metadata();
        if (Math.min(meta.width || 0, meta.height || 0) >= 900) {
          return { buf, imageUrl: url, pageUrl: url };
        }
      } catch {}
      await sleep(50);
    }
  }
  return null;
}

async function resolveWithSearch(w) {
  if (w.brand === "Titan" || w.brand === "Fastrack") {
    const official = await officialCdnFallback(w);
    if (official) return official;
  }
  const q = encodeURIComponent(`${w.brand} ${w.model} watch`);
  const html = await fetchText(`https://duckduckgo.com/html/?q=${q}`);
  let links = [...new Set(ddgLinks(html).filter((u) => /^https?:\/\//.test(u)))];
  links = links
    .map((u) => ({ u, score: preferred.findIndex((p) => u.includes(p)), model: modelHit(w, u) ? 1 : 0 }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.model - a.model || a.score - b.score)
    .slice(0, 10)
    .map((x) => x.u);

  for (const link of links) {
    let page = null;
    let pageUrl = link;
    try {
      page = await fetchText(link);
    } catch {
      try {
        pageUrl = `https://r.jina.ai/${link}`;
        page = await fetchText(pageUrl);
      } catch {}
    }
    if (!page) continue;
    const title = (page.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "") + " " + page.slice(0, 20000) + " " + pageUrl;
    if (!modelHit(w, title)) continue;
    const allImgs = extractImages(page, link);
    const imgs = [
      ...allImgs.filter((u) => modelHit(w, u)),
      ...allImgs.filter((u) => !modelHit(w, u) && !/(logo|icon|banner|sprite|favicon|placeholder)/i.test(u)),
    ];
    for (const img of imgs.slice(0, 6)) {
      try {
        const buf = await fetchImage(img);
        return { buf, imageUrl: img, pageUrl: link };
      } catch {}
    }
  }
  return null;
}

let ok = 0;
let fail = 0;
for (const w of failed) {
  console.log("trying", w.brand, w.model);
  try {
    const found = await resolveWithSearch(w);
    if (!found) throw new Error("no image found");
    const name = w.image ? path.basename(w.image) : `${w.id}.webp`;
    const file = path.join(OUT_DIR, name);
    if (w.image) {
      const src = path.join(OUT_DIR, path.basename(w.image));
      const dst = path.join(BACKUP_DIR, path.basename(w.image));
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
    await writeImage(found.buf, file);
    if (!w.image) w.image = `/products/${name}`;
    state.done[w.id] = { source: "search-fallback", imageUrl: found.imageUrl, file: name, at: new Date().toISOString() };
    delete state.failed[w.id];
    ok++;
    console.log("  OK", found.imageUrl);
  } catch (e) {
    fail++;
    console.log("  FAIL", String(e?.message || e));
  }
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 1));
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n");
  await sleep(1200);
}
console.log({ ok, fail, remainingFailed: Object.keys(state.failed || {}).length });
