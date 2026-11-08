import fs from "node:fs";

const rows = JSON.parse(fs.readFileSync("tmp/stock-2026/coverage.json", "utf8"));
const guessImages = fs.existsSync("tmp/stock-2026/guess-images.json")
  ? JSON.parse(fs.readFileSync("tmp/stock-2026/guess-images.json", "utf8"))
  : {};

const genderMap = { MEN: "men", WOMEN: "women", UNISEX: "unisex" };
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const genderOfText = (text) => {
  const s = String(text || "").toLowerCase();
  if (/\b(unisex|his\s*(?:and|&)\s*her)\b/.test(s)) return "unisex";
  if (/\b(women'?s?|womens|ladies|lady|female)\b/.test(s)) return "women";
  if (/\b(men'?s?|mens|male|gents)\b/.test(s)) return "men";
  return null;
};

async function bingTitles(brand, model) {
  const q = encodeURIComponent(`"${brand} ${model}" watch`);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://www.bing.com/images/search?q=${q}&form=HDRSC2&first=1`, {
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
          if (d.murl) out.push({ t: d.t ?? "", purl: d.purl ?? "", murl: d.murl });
        } catch {}
      }
      return out;
    } catch {
      if (attempt === 2) return [];
      await sleep(2000 * (attempt + 1));
    }
  }
  return [];
}

const resolved = {};
const unknown = [];

for (const row of rows) {
  const key = `${row.brand}|${row.model}`;
  let gender = null, source = null, evidence = null;

  if (row.attrs?.Gender) {
    gender = genderMap[String(row.attrs.Gender).toUpperCase()] ?? null;
    source = "stock sheet";
  }
  if (!gender && row.brand === "GUESS") {
    const m = row.model.match(/^GW\d{4}([A-Z])\d/);
    if (m) {
      gender = m[1] === "L" ? "women" : "men";
      source = "Guess model code";
    }
  }
  if (!gender && row.myntra?.gender) {
    const g = String(row.myntra.gender).toLowerCase();
    if (g === "men" || g === "women" || g === "unisex") {
      gender = g;
      source = "Myntra listing";
    }
  }
  if (!gender) {
    const gi = guessImages[`guess-${row.model.toLowerCase()}`];
    if (gi?.genderGuess) {
      gender = gi.genderGuess;
      source = "Guess official product";
    }
  }

  if (!gender) {
    const results = await bingTitles(row.brand, row.model);
    const keyNorm = norm(row.model);
    const clues = new Map();
    for (const r of results) {
      const hay = norm(`${r.t} ${r.purl} ${r.murl}`);
      if (!hay.includes(keyNorm)) continue;
      const g = genderOfText(`${r.t} ${r.purl}`);
      if (g) clues.set(g, (clues.get(g) ?? 0) + 1);
    }
    const sorted = [...clues.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length) {
      gender = sorted[0][0];
      source = "Bing listing";
      evidence = sorted[0][1];
    }
  }

  if (gender) resolved[key] = { gender, source, evidence };
  else unknown.push({ brand: row.brand, model: row.model });
}

fs.writeFileSync("tmp/stock-2026/genders.json", JSON.stringify(resolved, null, 1));
console.log("resolved", Object.keys(resolved).length, "unknown", unknown.length);
console.log("unknown", unknown);
console.log(
  "by source",
  Object.values(resolved).reduce((a, r) => ((a[r.source] = (a[r.source] ?? 0) + 1), a), {}),
);
