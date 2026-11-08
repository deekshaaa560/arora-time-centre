import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const queries = [
  ["Fossil", "CE1134"],
  ["Emporio Armani", "AR11748"],
  ["GUESS", "GW0265G10"],
  ["Michael Kors", "MK4339"],
  ["Diesel", "DZ2187"],
  ["Armani Exchange", "AX1720"],
];
const outDir = path.resolve("tmp/stock-2026/probe");
fs.mkdirSync(outDir, { recursive: true });

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

for (const [brand, model] of queries) {
  const q = encodeURIComponent(`"${brand} ${model}" watch`);
  const res = await fetch(`https://www.bing.com/images/search?q=${q}&form=HDRSC2&first=1`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  const html = await res.text();
  const results = [];
  for (const m of html.matchAll(/class="iusc"[^>]*?m="([^"]+)"/g)) {
    try {
      const data = JSON.parse(decode(m[1]));
      if (data.murl) results.push({ murl: data.murl, purl: data.purl, t: data.t, w: data.mw, h: data.mh });
    } catch {}
  }
  console.log(`\n${brand} ${model}: ${results.length} results`);
  console.log(
    results.slice(0, 6).map((r) => `${r.w}x${r.h} | ${r.murl.slice(0, 120)} | ${r.t?.slice(0, 80)}`).join("\n"),
  );

  // Try to download the first 3 candidates that have the model in title/url.
  const key = model.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const candidates = results
    .filter((r) => `${r.tally ?? ""} ${r.t ?? ""} ${r.purl ?? ""} ${r.murl}`.replace(/[^A-Z0-9]/gi, "").toUpperCase().includes(key))
    .slice(0, 3);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      const imgRes = await fetch(c.murl.replace(/&amp;/g, "&"), {
        headers: { "user-agent": "Mozilla/5.0" },
      });
      if (!imgRes.ok) throw new Error(`image ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const meta = await sharp(buf).metadata();
      const file = path.join(outDir, `${brand.replace(/\s+/g, "-").toLowerCase()}-${model.toLowerCase()}-${i}.jpg`);
      fs.writeFileSync(file, buf);
      console.log(`  saved ${file} ${meta.width}x${meta.height} ${buf.length}`);
    } catch (e) {
      console.log(`  download fail ${i}: ${String(e).slice(0, 100)}`);
    }
  }
}
