/**
 * Does a Myntra slug-style search return the product for a raw model code?
 * (The existing brand pools were built the same way, with `/<query>` slugs.)
 *
 *   node scripts/probe-myntra-code-search.mjs NU2536BM02 R2815WM01 TWEG24001
 */
const UA = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "text/html",
};

for (const q of process.argv.slice(2)) {
  try {
    const res = await fetch(`https://www.myntra.com/${encodeURIComponent(q)}`, { headers: UA });
    const html = await res.text();
    const i = html.indexOf("window.__myx = ");
    let out = `${q.padEnd(12)} ${res.status} myx=${i > 0}`;
    if (i > 0) {
      let s = html.slice(i + "window.__myx = ".length, html.indexOf("</script>", i)).trimEnd();
      if (s.endsWith(";")) s = s.slice(0, -1);
      try {
        const j = JSON.parse(s);
        const prods = j?.searchData?.results?.products || [];
        const hit = prods.find((p) => String(p.product || p.name || "").toUpperCase().replace(/[^A-Z0-9]/g, "").includes(q.toUpperCase().replace(/[^A-Z0-9]/g, "")));
        const imgs = (hit?.images || prods[0]?.images || []).map((im) => im.view);
        out += ` items=${prods.length} codeMatch=${!!hit} first="${(prods[0]?.product || prods[0]?.name || "").slice(0, 46)}" views=${JSON.stringify(imgs)}`;
      } catch (e) {
        out += ` parseFail=${e.message.slice(0, 40)}`;
      }
    }
    console.log(out);
  } catch (e) {
    console.log(`${q.padEnd(12)} ERR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
