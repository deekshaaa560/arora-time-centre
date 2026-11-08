import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/bing-images.json");
fs.mkdirSync(OUT, { recursive: true });

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const myntraManifest = fs.existsSync(path.join(ROOT, "tmp/stock-2026/myntra-images.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "tmp/stock-2026/myntra-images.json"), "utf8"))
  : {};

const rows = JSON.parse(fs.readFileSync("tmp/stock-2026/coverage.json", "utf8"));
const slugify = (s) =>
  String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const idOf = (r) => `${slugify(r.brand)}-${slugify(r.model)}`;
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const limit = Number(process.env.LIMIT || 0);
const todo = rows
  .filter((r) => {
    const id = idOf(r);
    // Only items without a downloaded image are candidates.
    return !myntraManifest[id] && !manifest[id];
  })
  .slice(0, limit || undefined);

console.log("missing image candidates", todo.length);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const OFFICIAL = [
  "fossil.com",
  "michaelkors.com",
  "armani.com",
  "diesel.com",
  "guess.com",
  "guess.eu",
  "tommy.com",
  "casio.com",
];
const GOOD_RETAIL = [
  "myntra.com",
  "tatacliq.com",
  "watchfactory.in",
  "justintime.in",
  "shoppersstop.com",
  "jomashop.com",
  "watchard.com",
  "swisstimehouse.com",
  "firstclasswatches.com",
  "watchdirect.com.au",
  "thbaker.co.uk",
  "kamalwatch.com",
  "i-watch.co",
  "watchandwatch.co.uk",
  "bestwatch.ru",
  "gioiellerialucchese.it",
  "ocarat.com",
  "wehkamp.nl",
  "amazon.in",
  "amazon.com",
  "flipkart.com",
  "nykaafashion.com",
  "ajio.com",
];
const BAD = [
  "pinterest.",
  "facebook.",
  "instagram.",
  "youtube.",
  "tiktok.",
  "aliexpress.",
  "dhgate.",
  "alibaba.",
  "yupoo.",
  "flickr.",
  "twitter.",
  "x.com",
];
const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const domainScore = (url) => {
  const d = domainOf(url);
  if (BAD.some((b) => d.includes(b))) return -100;
  if (OFFICIAL.some((o) => d === o || d.endsWith("." + o))) return 40;
  if (GOOD_RETAIL.some((o) => d === o || d.endsWith("." + o))) return 25;
  return 0;
};

async function bingImages(query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`,
        {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
            "accept-language": "en-US,en;q=0.9",
          },
        },
      );
      if (res.status === 429) throw new Error("429");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const out = [];
      for (const m of html.matchAll(/class="iusc"[^>]*?m="([^"]+)"/g)) {
        try {
          const data = JSON.parse(decode(m[1]));
          if (data.murl) {
            out.push({
              murl: data.murl.replace(/&amp;/g, "&"),
              purl: data.purl ?? "",
              t: data.t ?? "",
              w: data.mw,
              h: data.mh,
            });
          }
        } catch {
          /* skip malformed tile */
        }
      }
      return out;
    } catch (e) {
      if (attempt === 2) return [];
      await sleep(2500 * (attempt + 1));
    }
  }
  return [];
}

function genderFrom(text) {
  const s = String(text || "").toLowerCase();
  if (/\b(unisex|his\s*(?:and|&)\s*her)\b/.test(s)) return "unisex";
  if (/\b(women'?s?|womens|ladies|lady|female)\b/.test(s)) return "women";
  if (/\b(men'?s?|mens|male|gents)\b/.test(s)) return "men";
  return null;
}

async function imageStats(buffer) {
  const img = sharp(buffer).rotate().flatten({ background: "#ffffff" });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error("no dimensions");
  const { data, info } = await img.resize(12, 12, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let edge = 0, white = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (!(x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1)) continue;
      edge++;
      const o = (y * info.width + x) * 3;
      if (data[o] > 236 && data[o + 1] > 236 && data[o + 2] > 236) white++;
    }
  }
  return { width: meta.width, height: meta.height, whiteRatio: edge ? white / edge : 0 };
}

async function processImage(buffer, id) {
  const base = await sharp(buffer).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  const stats = await imageStats(base);
  let trimmed = base;
  let info = await sharp(base).metadata();
  if (stats.whiteRatio > 0.55) {
    try {
      trimmed = await sharp(base).trim({ threshold: 10 }).png().toBuffer();
      info = await sharp(trimmed).metadata();
    } catch {
      /* keep untrimmed */
    }
  }
  const content = 940;
  const scale = Math.min(content / info.width, content / info.height);
  const w = Math.max(1, Math.round(info.width * scale));
  const h = Math.max(1, Math.round(info.height * scale));
  const resized = await sharp(trimmed)
    .resize(w, h, { fit: "inside", kernel: "lanczos3" })
    .sharpen({ sigma: 0.55, m1: 0.5, m2: 0.2 })
    .png()
    .toBuffer();
  const file = path.join(OUT, `${id}.webp`);
  await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } })
    .composite([{ input: resized, gravity: "center" }])
    .webp({ quality: 92, alphaQuality: 92, effort: 5 })
    .toFile(file);
  return stats;
}

async function fetchImage(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("image/")) throw new Error(`not image: ${type}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 9000) throw new Error("small file");
  return buffer;
}

function candidateScore(result) {
  let score = domainScore(result.murl) + domainScore(result.purl) / 2;
  if (/(large|zoom|original|thickbox|1000|1200|2000|3000|1440|2048)/i.test(result.murl)) score += 8;
  if (result.w && result.h) score += Math.min(20, Math.min(result.w, result.h) / 80);
  return score;
}

async function sourceOne(row) {
  const id = idOf(row);
  const brand = row.brand;
  const model = row.model;
  const variants = [norm(model)];
  if (/SET$/i.test(model)) variants.push(norm(model.replace(/SET$/i, "")));
  if (!/I$/i.test(model)) variants.push(norm(model + "I"));

  const query = `"${brand} ${model}" watch`;
  let results = await bingImages(query);
  if (!results.length) results = await bingImages(`${brand} ${model} watch`);

  const filtered = results
    .filter((r) => !BAD.some((b) => domainOf(r.murl).includes(b) || domainOf(r.purl).includes(b)))
    .filter((r) => {
      const hay = norm(`${r.t} ${r.purl} ${r.murl}`);
      return variants.some((v) => v.length >= 4 && hay.includes(v));
    })
    .map((r) => ({ ...r, score: candidateScore(r), gender: genderFrom(`${r.t} ${r.purl}`) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  let best = null;
  for (const c of filtered) {
    try {
      const buffer = await fetchImage(c.murl);
      const stats = await imageStats(buffer);
      if (stats.width < 350 || stats.height < 350) continue;
      if (stats.width / stats.height > 4 || stats.height / stats.width > 4) continue;
      const quality =
        c.score +
        Math.min(25, Math.max(stats.width, stats.height) / 100) +
        (stats.whiteRatio > 0.7 ? 35 : stats.whiteRatio > 0.4 ? 18 : 0);
      if (!best || quality > best.quality) {
        best = { ...c, buffer, stats, quality };
        if (stats.whiteRatio > 0.7 && Math.max(stats.width, stats.height) > 900) break;
      }
    } catch {
      /* try next result */
    }
  }

  if (!best) {
    console.log(`MISS ${brand} ${model}`);
    return { ok: false, id, gender: null };
  }

  const outStats = await processImage(best.buffer, id);
  manifest[id] = {
    id,
    brand,
    model,
    source: best.murl,
    page: best.purl,
    title: best.t,
    genderGuess: best.gender,
    ...outStats,
    whiteRatio: Math.round(best.stats.whiteRatio * 100) / 100,
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  console.log(`OK ${brand} ${model} ${best.stats.width}x${best.stats.height} white=${best.stats.whiteRatio.toFixed(2)} ${domainOf(best.murl)}`);
  return { ok: true, id, gender: best.gender };
}

let index = 0, ok = 0, miss = 0;
const workers = Array.from({ length: 3 }, async () => {
  while (index < todo.length) {
    const i = index++;
    const row = todo[i];
    const res = await sourceOne(row);
    if (res.ok) ok++;
    else miss++;
    if ((ok + miss) % 10 === 0) console.log(`progress ${ok + miss}/${todo.length} ok=${ok} miss=${miss}`);
    await sleep(180);
  }
});
await Promise.all(workers);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log("DONE", { ok, miss, total: todo.length, manifest: Object.keys(manifest).length });
