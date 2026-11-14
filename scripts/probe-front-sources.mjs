/**
 * Which public sources answer a model-code search with product images, so
 * scripts/source-front-online.mjs knows where to look. One request per source.
 *
 *   node scripts/probe-front-sources.mjs [MODEL]
 */
const UA = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "accept-language": "en-IN,en;q=0.9",
  accept: "text/html,application/xhtml+xml",
};
const model = process.argv[2] || "TW000R420";

function jsonBefore(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  let s = html.slice(i + marker.length, html.indexOf("</script>", i)).trimEnd();
  if (s.endsWith(";")) s = s.slice(0, -1);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// 1. Myntra search page (server-rendered window.__myx)
try {
  const res = await fetch(`https://www.myntra.com/search?term=${encodeURIComponent(model)}`, { headers: UA });
  const html = await res.text();
  const myx = jsonBefore(html, "window.__myx = ");
  const prods = myx?.searchData?.results?.products || [];
  console.log(
    `myntra      ${res.status} total=${myx?.searchData?.results?.totalCount} items=${prods.length}`,
    prods[0] ? `| ${prods[0].product || prods[0].name} | imgs=${(prods[0].images || []).length} views=${JSON.stringify((prods[0].images || []).map((i) => i.view))}` : "",
  );
} catch (e) {
  console.log("myntra      ERR", e.message);
}

// 2. Ajio search page (window.__PRELOADED_STATE__, grid.entities)
try {
  const res = await fetch(`https://www.ajio.com/s/${encodeURIComponent(model)}`, { headers: UA });
  const html = await res.text();
  const st = jsonBefore(html, "window.__PRELOADED_STATE__ = ");
  const ents = st?.grid?.entities || st?.searchResults?.entities || {};
  const list = Array.isArray(ents) ? ents : Object.values(ents);
  console.log(`ajio        ${res.status} items=${list.length}`, list[0] ? `| ${JSON.stringify(list[0]).slice(0, 220)}` : "");
} catch (e) {
  console.log("ajio        ERR", e.message);
}

// 3. Shopify brand stores (Titan World, Fastrack) - suggest endpoint
for (const host of ["https://www.titanworld.com", "https://www.fastrack.in"]) {
  try {
    const res = await fetch(`${host}/search/suggest.json?q=${encodeURIComponent(model)}&resources[type]=product&resources[limit]=6`, { headers: UA });
    const j = await res.json().catch(() => null);
    const prods = j?.resources?.results?.products || [];
    console.log(`${host.slice(8, 28).padEnd(12)} ${res.status} items=${prods.length}`, prods[0] ? `| ${prods[0].title} | ${prods[0].image?.url ? "has image" : "no image"}` : "");
  } catch (e) {
    console.log(`${host.slice(8, 28).padEnd(12)} ERR ${e.message}`);
  }
}
