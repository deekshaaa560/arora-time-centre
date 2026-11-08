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
  .sort((a, b) => (state.failed[a.id]?.attempts || 0) - (state.failed[b.id]?.attempts || 0))
  .filter((w) => (state.failed[w.id]?.attempts || 0) < 3);

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

const BRAND_BASE = {
  Titan: "https://www.titan.co.in/dw/image/v2/BKDD_PRD/on/demandware.static/-/Sites-titan-master-catalog/default/images/Titan/Catalog",
  Fastrack: "https://www.fastrack.in/dw/image/v2/BKDD_PRD/on/demandware.static/-/Sites-titan-master-catalog/default/images/Fastrack/Catalog",
};
const preferred = [
  "timexindia.com", "titan.co.in", "fastrack.in", "justintime.in",
  "malabarwatches.com", "swisstimehouse.com", "myntra.com", "flipkart.com",
  "amazon.in", "nykaa.com", "tatacliq.com", "ajio.com",
];

async function fetchText(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 40000);
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(900 + i * 1200);
    }
  }
}

async function fetchBuf(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
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
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(700 + i * 1000);
    }
  }
}

function upgradeImageUrl(u) {
  let out = u;
  out = out.replace(/([?&])sw=\d+/, "$1sw=2000").replace(/([?&])sh=\d+/, "$1sh=2000");
  out = out.replace(/\/image\/\d+\/\d+\//, "/image/1500/1500/");
  out = out.replace(/w_\d+/, "w_1500").replace(/h_\d+/, "h_1500");
  out = out.replace(/\._[A-Z0-9_]+_\./, "._AC_SL1500_.");
  return out;
}

function extractImages(html, pageUrl) {
  const urls = new Set();
  for (const m of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/"image"\s*:\s*"([^"]+)"/g)) urls.add(m[1]);
  for (const m of html.matchAll(/"image"\s*:\s*\[([^\]]+)\]/g)) for (const x of m[1].matchAll(/"([^"]+)"/g)) urls.add(x[1]);
  for (const m of html.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) urls.add(m[1]);
  const out = [];
  for (let u of urls) {
    u = u.replace(/&amp;/g, "&").replace(/\\\//g, "/");
    if (u.startsWith("//")) u = `https:${u}`;
    if (u.startsWith("/")) {
      try { u = new URL(u, pageUrl).href; } catch { continue; }
    }
    if (/^https?:\/\//.test(u)) out.push(u);
  }
  return [...new Set(out)];
}

async function imageSize(buf) {
  try {
    const m = await sharp(buf).metadata();
    return Math.min(m.width || 0, m.height || 0);
  } catch { return 0; }
}

async function pickBest(candidates, minPreferred = 1200) {
  let best = null;
  for (const url of candidates.slice(0, 14)) {
    try {
      const buf = await fetchBuf(url);
      const size = await imageSize(buf);
      if (!best || size > best.size) best = { buf, url, size };
      if (size >= minPreferred) return { buf, url, size };
    } catch {}
  }
  return best;
}

async function officialTimexIndia(w) {
  for (const v of variants(w.model)) {
    for (const slug of [v.toLowerCase(), v.toLowerCase().replace(/^t/, "")]) {
      try {
        const res = await fetch(`https://shop.timexindia.com/products/${slug}.js`, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!res.ok) continue;
        const js = await res.json();
        const imgs = (js.images || []).map((u) => (u.startsWith("//") ? `https:${u}` : u));
        if (!imgs.length) continue;
        const best = await pickBest(imgs.map(upgradeImageUrl), 700);
        if (best && best.size >= 700) return best;
      } catch {}
      await sleep(200);
    }
  }
  return null;
}

async function officialTitanFastrack(w) {
  const base = BRAND_BASE[w.brand];
  if (!base) return null;
  const candidates = [];
  for (const v of variants(w.model)) for (const suffix of ["_1", "_2", "_3", "_4", "_5", "_6"]) {
    candidates.push(`${base}/${v}${suffix}.jpg?sw=2000&sh=2000`);
  }
  const best = await pickBest(candidates, 700);
  return best && best.size >= 700 ? best : null;
}

function ddgLinks(html) {
  const links = new Set();
  for (const m of html.matchAll(/uddg=([^&"']+)/g)) {
    try { links.add(decodeURIComponent(m[1])); } catch {}
  }
  return [...links];
}

async function searchFallback(w) {
  const q = encodeURIComponent(`${w.brand} ${w.model} watch`);
  const html = await fetchText(`https://duckduckgo.com/html/?q=${q}`);
  let links = [...new Set(ddgLinks(html).filter((u) => /^https?:\/\//.test(u)))];
  links = links
    .map((u) => ({ u, score: preferred.findIndex((p) => u.includes(p)), model: modelHit(w, u) ? 1 : 0 }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.model - a.model || a.score - b.score)
    .slice(0, 8)
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
    const hay = (page.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "") + " " + page.slice(0, 25000) + " " + pageUrl;
    if (!modelHit(w, hay)) continue;
    const all = extractImages(page, link);
    const ranked = [
      ...all.filter((u) => modelHit(w, u)),
      ...all.filter((u) => !modelHit(w, u) && !/(logo|icon|banner|sprite|favicon|placeholder)/i.test(u)),
    ];
    const best = await pickBest(ranked.map(upgradeImageUrl), 900);
    if (best && best.size >= 600) return best;
  }
  return null;
}

async function writeImage(buf, file) {
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  const min = Math.min(meta.width || 0, meta.height || 0);
  if (min < 600) throw new Error(`source too small: ${meta.width}x${meta.height}`);
  const target = min >= 1000 ? 1200 : 1000;
  const tmp = file + ".tmp.webp";
  await sharp(buf, { failOn: "none" })
    .flatten({ background: "#ffffff" })
    .resize(target, target, { fit: "contain", background: "#ffffff", kernel: "lanczos3" })
    .webp({ quality: 92, effort: 5 })
    .toFile(tmp);
  fs.renameSync(tmp, file);
}

console.log("Patching", targets.length, "remaining failures");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] || 0);
const batch = LIMIT ? targets.slice(0, LIMIT) : targets;
let ok = 0, fail = 0;

for (const w of batch) {
  console.log("trying", w.brand, w.model);
  let best = null;
  try {
    if (w.brand === "Timex") best = await officialTimexIndia(w);
    if (!best && (w.brand === "Titan" || w.brand === "Fastrack")) best = await officialTitanFastrack(w);
    if (!best) best = await searchFallback(w);
  } catch (e) {
    console.log("  lookup err", String(e?.message || e));
  }

  if (!best) {
    fail++;
    state.failed[w.id] = {
      ...(state.failed[w.id] || {}),
      attempts: (state.failed[w.id]?.attempts || 0) + 1,
      at: new Date().toISOString(),
    };
    console.log("  FAIL no image");
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
    state.done[w.id] = { source: "search-fallback-v2", imageUrl: best.url, file: name, at: new Date().toISOString() };
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
