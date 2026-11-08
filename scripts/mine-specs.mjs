import fs from "node:fs";

const targets = JSON.parse(fs.readFileSync("tmp/spec-targets.json", "utf8"));
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 600_000);
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

async function ddg(query) {
  const html = await fetchText(
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query),
  );
  const urls = [];
  for (const m of html.matchAll(/uddg=([^&"']+)/g)) {
    try {
      const u = decodeURIComponent(m[1]);
      if (u.startsWith("http") && !urls.includes(u)) urls.push(u);
    } catch {}
  }
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => strip(m[1]))
    .join(" ");
  return { urls, snippets };
}

const pickFreq = (values, filter = () => true) => {
  const counts = new Map();
  for (const v of values) {
    if (!filter(v)) continue;
    const k = typeof v === "string" ? v.toLowerCase() : v;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.length ? { value: sorted[0][0], votes: sorted[0][1] } : null;
};

function extractSpecs(text) {
  const lower = text.toLowerCase();
  const specs = {};

  // Case size: all "NN mm" and pick the most frequent plausible value
  const sizes = [...lower.matchAll(/(\d{2}(?:\.\d)?)\s?mm\b/g)].map((m) => Number(m[1]));
  const size = pickFreq(sizes, (v) => v >= 24 && v <= 52);
  if (size && size.votes >= 2) specs.caseSize = `${size.value} mm`;

  const movement = lower.match(/eco[\s-]?drive|automatic|mechanical|quartz|solar|kinetic/);
  if (movement) specs.movement = movement[0].replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace("Eco-drive", "Eco-Drive");

  const glass = lower.match(/sapphire|hardlex|mineral|acrylic/);
  if (glass) specs.glass = glass[0][0].toUpperCase() + glass[0].slice(1);

  const strapMatches = lower.match(/leather|stainless steel|silicone|resin|nylon|fabric|ceramic|titanium|mesh|bracelet/g) || [];
  const strap = pickFreq(strapMatches);
  if (strap && strap.votes >= 2) {
    const map = { bracelet: "Metal bracelet", "stainless steel": "Stainless steel" };
    specs.strap = map[strap.value] ?? strap.value.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const water = [
    ...[...lower.matchAll(/(\d{2,3})\s?(?:m|meters|metres)\b/g)].map((m) => Number(m[1])),
    ...[...lower.matchAll(/wr\s?(\d{2,3})/g)].map((m) => Number(m[1])),
  ].filter((v) => [30, 50, 100, 200, 300].includes(v));
  const wr = pickFreq(water);
  if (wr && wr.votes >= 2) specs.waterResistance = `${wr.value} m`;

  const warranty = lower.match(/(\d)\s?(?:year|yr)s?\s?(?:warranty|guarantee)/);
  if (warranty) specs.warranty = `${warranty[1]} year${warranty[1] === "1" ? "" : "s"}`;

  return specs;
}

const out = fs.existsSync("tmp/specs.json") ? JSON.parse(fs.readFileSync("tmp/specs.json", "utf8")) : {};

for (const w of targets) {
  if (out[w.id]?.caseSize) continue;
  const query = `"${w.model}" ${w.brand} watch specifications`;
  const search = await ddg(query);
  let corpus = search.snippets + " ";

  const skip = /google|duckduckgo|youtube|facebook|instagram|twitter|pinterest|linkedin/i;
  const candidates = search.urls.filter((u) => !skip.test(u)).slice(0, 4);
  for (const url of candidates) {
    if (corpus.length > 250_000) break;
    const html = await fetchText(url);
    if (html) corpus += " " + strip(html);
    await sleep(300);
  }

  const specs = extractSpecs(corpus);
  out[w.id] = { ...specs, sources: candidates.length, model: w.model, brand: w.brand };
  fs.writeFileSync("tmp/specs.json", JSON.stringify(out, null, 1));
  console.log(
    w.model,
    JSON.stringify(specs),
    `(${candidates.length} pages)`,
  );
  await sleep(1100);
}

console.log("done", Object.keys(out).length);
