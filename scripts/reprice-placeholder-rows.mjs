/**
 * Rows that were restored without a listing record sit at price 0 and read as
 * "Brand Unisex Watch", which a customer sees as a broken or duplicate card.
 * Their model codes are delisted on Myntra's shop pages, but three sources still
 * quote them:
 *
 *   Myntra     https://www.myntra.com/api/myntra/models/<id>/view
 *              -> basePrice.mrp / basePrice.sellingPrice (works after delisting,
 *                 answers 404 when throttled, so it is retried)
 *   Shopify    https://<shop>/search/suggest.json?q=<code>&resources[type]=product
 *              https://<shop>/products/<handle>.json  -> price, compare_at_price,
 *              title, tags ("Gender: Male"). Shops: justintime.in and
 *              titanworld.com, Sonata's own store.
 *
 * The title/tags are also what makes a card name distinct, so gender and the
 * functional word (fn) are read from them.
 *
 *   node scripts/reprice-placeholder-rows.mjs [--dry] [--brands=Alba,Sonata]
 */
import fs from "node:fs";
import { pruneRemoved, writeJson } from "./write-json.mjs";
import path from "node:path";

const ROOT = process.cwd();
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/myntra/brands-manifest.json");
const DRY = process.argv.includes("--dry");
const arg = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};
const UA = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "application/json,text/html;q=0.9,*/*;q=0.8",
  "accept-language": "en-IN,en;q=0.9",
};
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Same functional vocabulary the rest of the catalogue uses in `fn`. */
const FUNCTION_WORDS = [
  [/\bchronograph\b/i, "Chronograph"],
  [/\bautomatic\b|\bmechanical\b/i, "Automatic"],
  [/\bsolar\b/i, "Solar"],
  [/\bday[- ]?date\b/i, "Day Date"],
  [/\bmoon ?phase\b/i, "Moonphase"],
  [/\bmulti ?function\b/i, "Multifunction"],
  [/\bdigital\b/i, "Digital"],
  [/\bana[- ]?digi\b|\bdual time\b/i, "Dual Time"],
  [/\bsmart ?watch\b/i, "Smart"],
];

/** What a retailer title says about who the watch is for and what it does. */
function readTitle(title, tags = "") {
  const out = {};
  const text = `${title} ${tags}`;
  if (/\bwomen'?s?\b|Gender: Female/i.test(text)) out.gender = "women";
  else if (/\bmen'?s?\b|\bmale\b|\bboys?\b|\bgirls?\b|\bkids?\b|\byouth\b/i.test(text)) out.gender = "men";
  for (const [re, word] of FUNCTION_WORDS)
    if (re.test(text)) {
      out.fn = word;
      break;
    }
  return out;
}

async function get(url, ok = (r) => r.ok) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: UA, redirect: "follow" });
      if (ok(res)) return await res.json();
      if (res.status !== 429 && res.status !== 503) return null;
    } catch {
      /* network hiccup: retry */
    }
    await sleep(1200 * (i + 1));
  }
  return null;
}

/** Myntra's own model record: still served after the shop page is gone. */
async function fromMyntra(productId, brand) {
  const id = String(productId || "").trim();
  if (!/^\d{6,12}$/.test(id)) return null;
  const j = await get(`https://www.myntra.com/api/myntra/models/${id}/view`);
  await sleep(500);
  const price = j?.basePrice || {};
  const mrp = Math.round(Number(price.mrp) || 0);
  const sell = Math.round(Number(price.sellingPrice) || 0);
  const name = String(j?.name || "");
  if (!(sell > 0) || !name || !norm(name).includes(norm(brand).slice(0, 4))) return null;
  return {
    price: sell,
    mrp: mrp >= sell ? mrp : sell,
    title: name,
    tags: "",
    via: "myntra-api",
  };
}

const SHOPS = ["www.justintime.in", "www.titanworld.com"];

/**
 * Shopify stores publish their whole catalogue at /products.json, and that is far
 * more reliable than their search box (titanworld's suggest endpoint answers 200
 * with zero results for codes the store plainly carries). Matching is done on the
 * code as it appears in the product's title, tags or variant titles, so a colour
 * variant of the family is found and the store's own "Brand:" tag confirms it.
 */
const catalogues = new Map();

async function shopifyCatalogue(host) {
  if (catalogues.has(host)) return catalogues.get(host);
  const all = [];
  for (let page = 1; page <= 14; page++) {
    const json = await get(`https://${host}/products.json?limit=250&page=${page}`);
    const prods = (json && json.products) || [];
    all.push(...prods);
    if (prods.length < 250) break;
    await sleep(200);
  }
  catalogues.set(host, all);
  return all;
}

async function fromShopify(code, brand) {
  const digits = String(code).replace(/\D/g, "");
  const stem = (String(code).toUpperCase().match(/^[A-Z]*\d+/) || [""])[0];
  const bare = /^NT\d/i.test(stem) ? stem.slice(2) : stem;
  // The code, its family stem, the same stem without Sonata's "NT" shop prefix and
  // the bare digit run: between them these cover how each store writes the model.
  const keys = [code, stem, bare, digits].filter((v, i, a) => v.length >= 4 && a.indexOf(v) === i);
  for (const host of SHOPS) {
    const catalogue = await shopifyCatalogue(host);
    if (!catalogue.length) continue;
    for (const p of catalogue) {
      const tags = String(p.tags || "");
      const variants = p.variants || [];
      const hay = norm(`${p.title} ${tags} ${variants.map((v) => v.title).join(" ")}`);
      if (!keys.some((k) => hay.includes(norm(k)))) continue;
      const brandTag = (tags.match(/Brand:\s*([^,;]+)/i) || [])[1];
      const brandOk =
        !brandTag || norm(brandTag).startsWith(norm(brand).slice(0, 4)) || norm(brand).startsWith(norm(brandTag).slice(0, 4));
      if (!brandOk) continue;
      // Prefer the variant that carries this exact code; a colourway variant of the
      // same model shares its price, so falling back to the product is safe.
      const variant = variants.find((v) => norm(v.title).includes(norm(code))) || variants[0] || {};
      const price = Math.round(Number(variant.price) || 0);
      if (!(price > 0)) continue;
      const compare = Math.round(Number(variant.compare_at_price) || 0);
      return {
        price,
        mrp: compare >= price ? compare : price,
        title: String(p.title || ""),
        tags,
        via: host,
      };
    }
  }
  return null;
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const brandFilter = arg("brands")
  ? arg("brands")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  : null;

const targets = catalog.filter(
  (w) =>
    (!w.price || w.price <= 0 || w.needsSourcing) &&
    (!brandFilter || brandFilter.includes(String(w.brand).toLowerCase())),
);
console.log(`placeholder rows: ${targets.length}${DRY ? " (dry)" : ""}`);

let fixed = 0;
const missed = [];
for (const w of targets) {
  const code = String(w.model).trim();
  if (!code) continue;
  const found =
    (await fromMyntra(manifest[w.id]?.productId, w.brand)) || (await fromShopify(code, w.brand));
  if (!found) {
    missed.push(w.id);
    console.log(`MISS ${w.brand} ${code} (${w.id})`);
    continue;
  }
  const read = readTitle(found.title, found.tags);
  console.log(
    `GOT  ${w.brand} ${code} <- ${found.via} Rs${found.price}/${found.mrp} ${read.gender || w.gender} ${read.fn || ""} | ${found.title.slice(0, 56)}`,
  );
  if (!DRY) {
    w.price = found.price;
    w.mrp = found.mrp;
    w.discount = found.mrp > found.price ? Math.round((1 - found.price / found.mrp) * 100) : 0;
    if (read.gender) w.gender = read.gender;
    if (read.fn && !w.fn) w.fn = read.fn;
    delete w.needsSourcing;
    if (manifest[w.id]) manifest[w.id].pricedBy = found.via;
  }
  fixed++;
}

if (!DRY && fixed) {
  writeJson(CATALOG, JSON.stringify(catalog, null, 1) + "\n");
  writeJson(MANIFEST, JSON.stringify(manifest, null, 1) + "\n");
  // The photo on a restored row came from a plain web search and may be a gift
  // box, so hand the ids to the sourcing pass, which checks every frame it owns.
  fs.writeFileSync(path.join(ROOT, "tmp/repriced-ids.txt"), targets.map((w) => w.id).join("\n") + "\n");
}
const still = DRY ? targets.filter((w) => missed.includes(w.id)) : catalog.filter((w) => !w.price || w.price <= 0);
console.log(`\nrepriced ${fixed}/${targets.length}; rows still at price 0: ${still.length}`);
if (still.length) console.log("  " + still.map((w) => `${w.id}(${w.model})`).join(", "));
console.log("-> nothing quotes these any more (delisted everywhere): finalize-photos.mjs drops them, the storefront must not show Rs 0");
