import fs from "node:fs";

const rows = JSON.parse(fs.readFileSync("tmp/stock-2026/coverage.json", "utf8"));
const genderMap = { MEN: "men", WOMEN: "women", UNISEX: "unisex" };
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const known = {};
const unknown = [];
for (const row of rows) {
  const key = `${row.brand}|${row.model}`;
  let gender = null, source = null;
  if (row.attrs?.Gender) {
    gender = genderMap[String(row.attrs.Gender).toUpperCase()] ?? null;
    source = "stock sheet";
  }
  if (!gender && row.brand === "GUESS") {
    const m = row.model.match(/^GW\d{4}([A-Z])\d/);
    if (m) {
      gender = m[1] === "L" ? "women" : "men";
      source = "Guess code";
    }
  }
  if (!gender && row.myntra?.gender) {
    const g = String(row.myntra.gender).toLowerCase();
    if (["men", "women", "unisex"].includes(g)) {
      gender = g;
      source = "Myntra";
    }
  }
  if (gender) known[key] = { gender, source };
  else unknown.push(row);
}

console.log("need online gender", unknown.length);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clue = (text) => {
  const s = String(text || "").toLowerCase();
  if (/\b(unisex|his\s*(?:and|&)\s*her)\b/.test(s)) return "unisex";
  if (/\b(women'?s?|womens|ladies|lady|female|wos)\b/.test(s)) return "women";
  if (/\b(men'?s?|mens|male|gents)\b/.test(s)) return "men";
  return null;
};

async function bingImages(model) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(model)}&form=HDRSC2&first=1`;
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const out = [];
  for (const m of html.matchAll(/class="iusc"[^>]*?m="([^"]+)"/g)) {
    try {
      const d = JSON.parse(decode(m[1]));
      if (d.murl) out.push({ t: d.t ?? "", p: d.purl ?? "", m: d.murl });
    } catch {}
  }
  return out;
}

async function bingWeb(model) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(model)}&count=20`;
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const text = decode(html);
  return text;
}

async function resolve(row) {
  const key = `${row.brand}|${row.model}`;
  const n = norm(row.model);
  let result = null;
  try {
    const items = await bingImages(row.model);
    const votes = new Map();
    for (const it of items) {
      if (!norm(`${it.t} ${it.p} ${it.m}`).includes(n)) continue;
      const g = clue(`${it.t} ${it.p}`);
      if (g) votes.set(g, (votes.get(g) ?? 0) + 1);
    }
    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length) result = { gender: sorted[0][0], source: "Bing image listing", votes: sorted[0][1] };
  } catch {}
  if (!result) {
    try {
      const text = await bingWeb(row.model);
      const chunks = [...text.matchAll(new RegExp(`[^.]{0,120}${row.model}[^.]{0,160}`, "gi"))].slice(0, 12);
      const votes = new Map();
      for (const c of chunks) {
        const g = clue(c[0]);
        if (g) votes.set(g, (votes.get(g) ?? 0) + 1);
      }
      const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
      if (sorted.length) result = { gender: sorted[0][0], source: "Bing web listing", votes: sorted[0][1] };
    } catch {}
  }
  if (result) {
    known[key] = result;
    console.log(`${row.brand} ${row.model} -> ${result.gender} (${result.source})`);
  } else {
    console.log(`UNKNOWN ${row.brand} ${row.model}`);
  }
  return result;
}

let index = 0;
const workers = Array.from({ length: 3 }, async () => {
  while (index < unknown.length) {
    const row = unknown[index++];
    await resolve(row);
    await sleep(250);
  }
});
await Promise.all(workers);
fs.writeFileSync("tmp/stock-2026/genders.json", JSON.stringify(known, null, 1));
console.log("resolved total", Object.keys(known).length, "of", rows.length);
