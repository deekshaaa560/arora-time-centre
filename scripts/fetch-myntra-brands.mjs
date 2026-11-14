/**
 * Fetch watch listings for brands not present in the distributor stock sheets
 * (Citizen, Casio, G-Shock, DKNY, Kenneth Cole, Giordano, Earnshaw, Alexandre
 * Christie, Alba, Maxima, Sonata) from Myntra category pages.
 *
 * Myntra embeds full SSR product data in `window.__myx` on every listing page;
 * the old /api/pim/search endpoint now 404s. Output shape matches the existing
 * tmp/stock-2026/myntra/myntra-*.json files.
 *
 * Usage:  node scripts/fetch-myntra-brands.mjs            (fetch everything)
 *         PROBE=1 node scripts/fetch-myntra-brands.mjs    (probe totals only)
 */
import fs from "node:fs";
import path from "node:path";

const OUT = "tmp/stock-2026/myntra";
fs.mkdirSync(OUT, { recursive: true });

const BRANDS = [
  { key: "citizen", slug: ["citizen watches", "citizen women watch", "citizen ladies watch"], brand: "Citizen" },
  { key: "casio", slug: ["casio watches", "casio women watch", "casio baby g"], brand: "Casio" },
  { key: "gshock", slug: ["g shock watches", "g shock", "g shock women", "casio g shock men watch"], brand: "G-Shock" },
  { key: "dkny", slug: ["dkny watches"], brand: "DKNY" },
  { key: "kenneth-cole", slug: ["kenneth cole watches"], brand: "Kenneth Cole" },
  { key: "giordano", slug: ["giordano watches"], brand: "Giordano" },
  { key: "earnshaw", slug: ["earnshaw watches", "thomas earnshaw watches"], brand: "Earnshaw" },
  { key: "alexandre-christie", slug: ["alexandre christie watches", "ac watches"], brand: "Alexandre Christie" },
  { key: "alba", slug: ["alba watches", "alba women watch"], brand: "Alba" },
  { key: "maxima", slug: ["maxima watches"], brand: "Maxima" },
  { key: "sonata", slug: ["sonata watches", "sonata women watch"], brand: "Sonata" },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractMyx(html) {
  const marker = "window.__myx = ";
  const i = html.indexOf(marker);
  if (i < 0) return null;
  let chunk = html.slice(i + marker.length, html.indexOf("</script>", i));
  chunk = chunk.trimEnd();
  if (chunk.endsWith(";")) chunk = chunk.slice(0, -1);
  try {
    return JSON.parse(chunk);
  } catch {
    return null;
  }
}

function normalize(myx, brand) {
  const res = myx?.searchData?.results;
  const products = res?.products || [];
  return products.map((p) => {
    const images = (p.images || [])
      .filter((im) => im?.src)
      .map((im) => ({
        src: im.src.replace(/^http:/, "https:"),
        view: String(im.view || "").toLowerCase(),
      }));
    const frontish =
      images.find((im) => im.view === "front") ||
      images.find((im) => im.view === "search") ||
      images.find((im) => im.view === "default") ||
      images[0];
    return {
      brand,
      sourceBrand: p.brand || "",
      product: p.product || p.productName || "",
      gender: p.gender || "",
      mrp: Number(p.mrp) || 0,
      price: Number(p.price) || 0,
      discount: Number(p.discount) || 0,
      rating: p.rating || null,
      ratingCount: p.ratingCount || 0,
      productId: p.productId,
      url: p.landingPageUrl || `https://www.myntra.com/product/${p.productId}`,
      image: frontish?.src || "",
      front: images.filter((im) => im.view === "front" || im.view === "default").map((im) => im.src),
      images: images.map((im) => im.src),
      imageViews: images.map((im) => im.view || "unlabeled"),
      masterCategory: p.masterCategory?.name || String(p.masterCategory || ""),
      subCategory: p.subCategory?.name || String(p.subCategory || ""),
      catalogDate: p.catalogDate || "",
    };
  });
}

async function fetchPage(slug, page) {
  const url = `https://www.myntra.com/${encodeURIComponent(slug)}${page > 1 ? `?p=${page}` : ""}`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchBrand({ key, slug, brand }) {
  const out = path.join(OUT, `myntra-${key}.json`);
  const all = new Map();
  for (const q of [slug].flat()) {
    let total = Infinity;
    for (let page = 1; page <= 12 && all.size < total; page++) {
      let html;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          html = await fetchPage(q, page);
          break;
        } catch (e) {
          if (attempt === 2) throw e;
          await sleep(1500 * (attempt + 1));
        }
      }
      const myx = extractMyx(html);
      if (!myx) throw new Error(`no __myx on ${q} p${page}`);
      total = myx?.searchData?.results?.totalCount ?? 0;
      const list = normalize(myx, brand);
      if (!list.length) break;
      for (const p of list) if (!all.has(p.productId)) all.set(p.productId, p);
      if (process.env.PROBE) {
        const brands = [...new Set(list.map((p) => p.brand))];
        console.log(
          `PROBE ${brand} [${q}]: total=${total} page1=${list.length} genders=[${[...new Set(list.map((p) => p.gender))]}] brands=[${brands.join(",")}]`
        );
        return;
      }
      await sleep(350);
    }
  }
  const arr = [...all.values()];
  fs.writeFileSync(out, JSON.stringify(arr, null, 1));
  console.log(`OK ${brand}: ${arr.length} products -> ${out}`);
}

if (process.env.PROBE) {
  for (const b of BRANDS) {
    try {
      await fetchBrand(b);
    } catch (e) {
      console.log(`PROBE ${b.brand}: FAIL ${String(e).slice(0, 120)}`);
    }
    await sleep(400);
  }
} else {
  const only = process.argv[2];
  for (const b of BRANDS) {
    if (only && b.key !== only) continue;
    try {
      await fetchBrand(b);
    } catch (e) {
      console.log(`FAIL ${b.brand}: ${String(e).slice(0, 160)}`);
    }
    await sleep(600);
  }
}
