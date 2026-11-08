import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/guess-bing-images.json");
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};

const rows = JSON.parse(fs.readFileSync("tmp/stock-2026/coverage.json", "utf8")).filter(
  (r) => r.brand === "GUESS",
);
const slugify = (s) =>
  String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const idOf = (r) => `${slugify(r.brand)}-${slugify(r.model)}`;
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const todo = rows.filter((r) => !fs.existsSync(path.join(OUT, `${idOf(r)}.webp`)));
console.log("Guess missing retry", todo.length);

const BAD = ["pinterest.", "facebook.", "instagram.", "youtube.", "tiktok.", "aliexpress.", "dhgate.", "alibaba.", "flickr."];
const OFFICIAL = ["guess.com", "guess.eu", "guesswatches.com"];
const GOOD = ["myntra.com", "tatacliq.com", "watchfactory.in", "justintime.in", "justwatches.com", "shoppersstop.com", "nykaa.com", "jomashop.com", "watchard.com", "swisstimehouse.com", "watchandwatch.co.uk", "i-watch.co", "kamalwatch.com", "thewatchagency.com", "watchdirect.com.au", "amazon.in", "amazon.com", "flipkart.com", "buckle.com", "noon.com", "elaraby.group"];
const domainOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
};
const domainScore = (url) => {
  const d = domainOf(url);
  if (BAD.some((x) => d.includes(x))) return -100;
  if (OFFICIAL.some((x) => d === x || d.endsWith("." + x))) return 50;
  if (GOOD.some((x) => d === x || d.endsWith("." + x))) return 25;
  return 0;
};

async function bing(query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      if (res.status === 429) throw new Error("429");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const out = [];
      for (const m of html.matchAll(/class="iusc"[^>]*?m="([^"]+)"/g)) {
        try {
          const d = JSON.parse(decode(m[1]));
          if (d.murl) out.push({ murl: d.murl.replace(/&amp;/g, "&"), purl: d.purl ?? "", t: d.t ?? "" });
        } catch {}
      }
      return out;
    } catch {
      if (attempt === 2) return [];
      await sleep(2500 * (attempt + 1));
    }
  }
  return [];
}

async function stats(buffer) {
  const img = sharp(buffer).rotate().flatten({ background: "#fff" });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error("no meta");
  const { data, info } = await img.resize(12, 12).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let edge = 0, white = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (!(x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1)) continue;
      edge++;
      const o = (y * info.width + x) * 3;
      if (data[o] > 236 && data[o + 1] > 236 && data[o + 2] > 236) white++;
    }
  }
  return { width: meta.width, height: meta.height, white: edge ? white / edge : 0 };
}

async function processImage(buffer, id) {
  const base = await sharp(buffer).rotate().flatten({ background: "#fff" }).png().toBuffer();
  const st = await stats(base);
  let trimmed = base;
  let info = await sharp(base).metadata();
  if (st.white > 0.55) {
    try {
      trimmed = await sharp(base).trim({ threshold: 8 }).png().toBuffer();
      info = await sharp(trimmed).metadata();
    } catch {}
  }
  const content = 940;
  const scale = Math.min(content / info.width, content / info.height);
  const w = Math.max(1, Math.round(info.width * scale));
  const h = Math.max(1, Math.round(info.height * scale));
  const resized = await sharp(trimmed)
    .resize(w, h, { fit: "inside", kernel: "lanczos3" })
    .sharpen({ sigma: 0.5, m1: 0.45, m2: 0.18 })
    .png()
    .toBuffer();
  await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
    .composite([{ input: resized, gravity: "center" }])
    .webp({ quality: 92, quality: 92, effort: 5 })
    .toFile(path.join(OUT, `${id}.webp`));
  return st;
}

async function fetchImage(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("image/")) throw new Error("not image");
  const b = Buffer.from(await res.arrayBuffer());
  if (b.length < 9000) throw new Error("small");
  return b;
}

async function sourceOne(row) {
  const id = idOf(row);
  const model = row.model.toUpperCase();
  const q = `"GUESS ${model}" watch`;
  let results = await bing(q);
  if (!results.length) results = await bing(`GUESS ${model} watch`);
  const key = norm(model);
  const candidates = results
    .filter((r) => !BAD.some((b) => domainOf(r.murl).includes(b) || domainOf(r.purl).includes(b)))
    .filter((r) => norm(`${r.t} ${r.purl} ${r.murl}`).includes(key))
    .map((r) => ({ ...r, score: domainScore(r.murl) + domainScore(r.purl) / 2 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  let best = null;
  for (const c of candidates) {
    try {
      const b = await fetchImage(c.murl);
      const st = await stats(b);
      if (st.width < 400 || st.height < 400) continue;
      if (st.width / st.height > 3.5 || st.height / st.width > 3.5) continue;
      const score = c.score + Math.min(30, Math.max(st.width, st.height) / 80) + (st.white > 0.7 ? 50 : st.white > 0.4 ? 20 : 0);
      if (!best || score > best.score) best = { ...c, buffer: b, st, score };
      if (st.white > 0.75 && Math.max(st.width, st.height) > 900) break;
    } catch {}
  }
  if (!best) {
    console.log(`MISS ${model}`);
    return false;
  }
  const out = await processImage(best.buffer, id);
  manifest[id] = {
    id,
    brand: row.brand,
    model: row.model,
    source: best.murl,
    page: best.purl,
    title: best.t,
    ...out,
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  console.log(`OK ${model} ${best.st.width}x${best.st.height} white=${best.st.white.toFixed(2)} ${domainOf(best.murl)}`);
  return true;
}

let ok = 0, miss = 0;
for (const row of todo) {
  if (await sourceOne(row)) ok++;
  else miss++;
  await sleep(500);
}
console.log("DONE", { ok, miss, total: todo.length });
