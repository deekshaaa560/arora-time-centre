/**
 * Did the web pass install a photo of the right watch?
 *
 * The sourcing sweep matches a retailer page on the model code, and a code appearing
 * in a page title or a URL is weak evidence: Michael Kors MK7602, a rose-gold bangle,
 * came back with a green chronograph from a page that happened to mention both. Dial
 * colour is the cheap tell - the catalogue carries the shop's own spec sheet, and a
 * photo whose dial family contradicts it is a different watch.
 *
 *   node scripts/check-photo-colour.mjs [--origin=bing] [--limit=n] [--sheet]
 *
 * Prints the rows whose dial colour contradicts the spec sheet; --sheet writes a
 * montage of them. Rows a person already accepted are tagged [eye]: reported, not a
 * defect. See scripts/mark-picked.mjs for how a frame earns that tag.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { classifyCanvas, scoringCanvas } from "../scripts/front-view.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const MANIFEST = path.join(ROOT, "tmp/stock-2026/myntra/brands-manifest.json");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/catalog-final.json"), "utf8"));
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const onlyOrigin = (process.argv.find((a) => a.startsWith("--origin=")) || "").split("=")[1] || "";
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 0) || Infinity;

// Colour families the spec sheet uses, and what the pixels have to look like. Metal
// families are checked before pink: a pale gold dial (237,221,177) is closer to rose
// than to any pink, and the first version of this list called half the gold catalogue
// pink.
const FAMILIES = [
  ["black", (r, g, b) => r < 78 && g < 78 && b < 78],
  ["white", (r, g, b) => r > 222 && g > 222 && b > 216],
  ["blue", (r, g, b) => b > r + 14 && b > g + 6],
  ["green", (r, g, b) => g > r + 8 && g >= b + 2],
  ["red", (r, g, b) => r > g + 55 && r > b + 55 && g < 110],
  ["purple", (r, g, b) => r > g + 18 && b > g + 18],
  ["brown", (r, g, b) => r > g + 12 && g > b + 6 && r < 165],
  // Metals before pink: a pale gold dial is (237,221,177) and a real pink is
  // (235,190,200) - the difference is whether blue sits below or above green, which a
  // "redder than the rest" test alone cannot see.
  ["gold", (r, g, b) => r > g + 14 && g > b + 14],
  ["rose", (r, g, b) => r > g + 10 && g >= b && r > 150],
  ["pink", (r, g, b) => r > 180 && b > g],
  ["silver", (r, g, b) => Math.abs(r - g) < 16 && Math.abs(g - b) < 20 && r >= 120],
];
const SPECFAM = [
  [/rose/i, "rose"],
  [/champagne|gold/i, "gold"],
  [/silver|steel|stainless/i, "silver"],
  [/black/i, "black"],
  [/white|mother.?of.?pearl|mop|ivory/i, "white"],
  [/blue|navy/i, "blue"],
  [/green|olive/i, "green"],
  [/red|bordeaux|burgundy/i, "red"],
  [/purple|violet/i, "purple"],
  [/brown|tan|beige|cream/i, "brown"],
  [/pink/i, "pink"],
  [/grey|gray/i, "silver"],
];
const famOf = (spec) => {
  for (const [re, f] of SPECFAM) if (re.test(spec)) return f;
  return "";
};

const rows = [];
for (const w of catalog) {
  if (!w.image) continue;
  const m = manifest[w.id] || {};
  if (onlyOrigin && m.origin !== onlyOrigin) continue;
  const want = famOf(w.specs?.dialColor || "");
  if (!want) continue;
  const file = path.join(OUT, path.basename(w.image));
  if (!fs.existsSync(file)) continue;
  rows.push({ w, file, want, m });
}
console.log(`rows with a usable dial colour in the specs: ${rows.length}`);

const out = [];
let n = 0;
for (const { w, file, want, m } of rows) {
  if (out.length >= LIMIT) break;
  if (++n % 250 === 0) console.log(`  ${n} checked`);
  let r;
  let canvas;
  try {
    const buf = await fs.promises.readFile(file);
    canvas = await scoringCanvas(buf);
    r = classifyCanvas(canvas);
    const { data, info } = canvas;
    // Mean colour inside the disc, ignoring the white background the tile is padded
    // with - the dial itself is what has to match the spec sheet.
    const W = info.width;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let c = 0;
    const rad = 0.62 * r.radius;
    for (let y = Math.max(0, r.cy - rad); y < Math.min(info.height, r.cy + rad); y += 2) {
      for (let x = Math.max(0, r.cx - rad); x < Math.min(W, r.cx + rad); x += 2) {
        const dx = x - r.cx;
        const dy = y - r.cy;
        if (dx * dx + dy * dy > rad * rad) continue;
        const o = (y * W + x) * info.channels;
        // A webp tile with transparency stores arbitrary RGB under alpha=0 - usually
        // pure green - and those pixels are not the dial. Compositing them in dragged
        // every dial average toward green and made half the catalogue look wrong.
        if (info.channels === 4 && data[o + 3] < 250) continue;
        let R = data[o];
        let G = data[o + 1];
        let B = data[o + 2];
        if (info.channels === 4) {
          const a = data[o + 3] / 255;
          R = Math.round(R * a + 255 * (1 - a));
          G = Math.round(G * a + 255 * (1 - a));
          B = Math.round(B * a + 255 * (1 - a));
        }
        if (R > 236 && G > 236 && B > 236) continue;
        sr += R;
        sg += G;
        sb += B;
        c++;
      }
    }
    if (c < 400) continue;
    const avg = [sr / c, sg / c, sb / c];
    let got = "";
    for (const [f, test] of FAMILIES)
      if (test(avg[0], avg[1], avg[2])) {
        got = f;
        break;
      }
    if (!got) continue;
    if (got !== want) out.push({ w, want, got, avg: avg.map((v) => Math.round(v)), m, score: r.frontScore });
  } catch {
    /* unreadable */
  }
}

const rank = { "": 0 };
out.sort((a, b) => (a.want === b.got ? 1 : 0) - (b.want === b.got ? 1 : 0));
console.log(`\ndial colour contradicts the spec sheet: ${out.length} rows`);
for (const o of out.slice(0, 40))
  console.log(
    `  ${o.w.id.padEnd(28)} spec=${String(o.w.specs.dialColor).padEnd(18)}(${o.want.padEnd(6)}) photo=rgb(${o.avg.join(",")}) is ${o.got.padEnd(6)} via=${o.m.origin || "sheet"} ${o.m.picked ? "[eye]" : ""}`,
  );
fs.writeFileSync(
  path.join(ROOT, "tmp/colour-mismatch.txt"),
  out.map((o) => `${o.w.id}\t${o.want}\t${o.got}\t${o.m.origin || "sheet"}`).join("\n") + "\n",
);
console.log(`-> tmp/colour-mismatch.txt (${out.length} rows)`);
if (process.argv.includes("--sheet")) {
  const S = 230;
  const tiles = [];
  for (const o of out.slice(0, 24)) {
    const png = await sharp(o.w ? path.join(OUT, path.basename(o.w.image)) : "")
      .flatten({ background: "#ffffff" })
      .resize(S, S)
      .png()
      .toBuffer();
    const svg = Buffer.from(
      `<svg width="${S}" height="${S + 40}"><image href="data:image/png;base64,${png.toString("base64")}" width="${S}" height="${S}"/>` +
        `<rect y="${S}" width="${S}" height="40" fill="#111"/><text x="4" y="${S + 14}" font-family="monospace" font-size="10" fill="#fff">${o.w.id}</text>` +
        `<text x="4" y="${S + 28}" font-family="monospace" font-size="10" fill="#f88">spec=${o.want} photo=${o.got}</text></svg>`,
    );
    tiles.push(await sharp(svg).png().toBuffer());
  }
  const cols = 4;
  await sharp({ create: { width: cols * (S + 4), height: Math.ceil(tiles.length / cols) * (S + 44), channels: 3, background: "#222" } })
    .composite(tiles.map((input, i) => ({ input, left: (i % cols) * (S + 4), top: Math.floor(i / cols) * (S + 44) })))
    .png()
    .toFile(path.join(ROOT, "tmp/colour-mismatch.png"));
  console.log(`sheet -> tmp/colour-mismatch.png`);
}
