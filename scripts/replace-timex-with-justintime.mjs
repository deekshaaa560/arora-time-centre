import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "tmp/justintime-processed");
const BACKUP = path.join(ROOT, "tmp/products-before-justintime");
const PROGRESS = path.join(ROOT, "tmp/extract/justintime-progress.json");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(BACKUP, { recursive: true });

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/catalog.json"), "utf8"));
const seen = new Set();
const items = [];
for (const w of catalog) {
  if (w.brand !== "Timex" || !w.image) continue;
  const file = w.image.split("/").pop();
  if (seen.has(file)) continue;
  seen.add(file);
  items.push({ w, file });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const modelVariants = (m) => {
  const n = norm(m);
  const out = new Set([n]);
  if (n.startsWith("NU")) out.add(n.slice(2));
  if (n.startsWith("NT")) out.add(n.slice(2));
  if (n.startsWith("RNU")) out.add(n.slice(3));
  if (n.startsWith("T")) out.add(n.slice(1));
  return [...out].filter((x) => x.length >= 4);
};

async function whiten(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = new Uint8Array(data);
  const seenPx = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let head = 0, tail = 0;
  const isBg = (i) => {
    const o = i * 3;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    return Math.min(r, g, b) > 214 && Math.max(r, g, b) - Math.min(r, g, b) < 22;
  };
  const push = (i) => {
    if (!seenPx[i] && isBg(i)) {
      seenPx[i] = 1;
      q[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const i = q[head++];
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  for (let i = 0; i < w * h; i++) {
    if (seenPx[i]) {
      px[i * 3] = 255;
      px[i * 3 + 1] = 255;
      px[i * 3 + 2] = 255;
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 92, effort: 6 }).toBuffer();
}

let replaced = 0;
let failed = 0;
const log = [];

for (const { w, file } of items) {
  if (fs.existsSync(path.join(OUT, file))) continue;
  let products = null;
  for (let attempt = 0; attempt < 4 && !products; attempt++) {
    try {
      const u = `https://justintime.in/search/suggest.json?q=${encodeURIComponent(w.model)}&resources%5Btype%5D=product&resources%5Blimit%5D=5`;
      const res = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
      const text = await res.text();
      if (!res.ok || text.includes("local_rate_limited")) throw new Error("rate");
      const json = JSON.parse(text);
      products = json.resources?.results?.products ?? [];
    } catch {
      await sleep(1200 + attempt * 700);
    }
  }
  if (!products) { failed++; await sleep(250); continue; }

  let chosen = null;
  for (const p of products) {
    if (!/timex/i.test(p.vendor || "")) continue;
    const hay = norm(`${p.title} ${p.handle} ${p.featured_image?.url}`);
    const modelHit = modelVariants(w.model).some((v) => hay.includes(v));
    const price = Number(p.price);
    const priceHit = Number.isFinite(price) && [w.price, w.mrp].some((x) => x && Math.abs(price - x) / x < 0.35);
    if (modelHit) { chosen = p; break; }
    if (!chosen && priceHit) chosen = p;
  }
  if (!chosen?.featured_image?.url) { await sleep(250); continue; }

  try {
    const res = await fetch(chosen.featured_image.url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error("image");
    const raw = Buffer.from(await res.arrayBuffer());
    const tmp = path.join(ROOT, "tmp", `jt-${file}.tmp.webp`);
    fs.writeFileSync(tmp, raw);
    const white = await whiten(tmp);
    await sharp(white)
      .removeAlpha()
      .resize(1000, 1000, { fit: "contain", background: "#ffffff", kernel: "lanczos3" })
      .sharpen({ sigma: 0.35, m1: 0.25, m2: 0.1 })
      .webp({ quality: 92, effort: 5 })
      .toFile(path.join(OUT, file));
    fs.rmSync(tmp, { force: true });
    if (!fs.existsSync(path.join(BACKUP, file))) {
      fs.copyFileSync(path.join(ROOT, "public/products", file), path.join(BACKUP, file));
    }
    replaced++;
    log.push({ file, model: w.model, title: chosen.title, image: chosen.featured_image.url });
    if (replaced % 25 === 0) {
      console.log("replaced", replaced);
      fs.writeFileSync(PROGRESS, JSON.stringify({ replaced, failed, log }, null, 1));
    }
  } catch {
    failed++;
  }
  await sleep(280);
}

fs.writeFileSync(PROGRESS, JSON.stringify({ replaced, failed, log }, null, 1));
console.log(JSON.stringify({ replaced, failed, total: items.length }, null, 1));
