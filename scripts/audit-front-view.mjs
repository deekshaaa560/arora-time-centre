/**
 * Audit the live product photos for non-front views (side profiles, back cases,
 * 3/4 angles) where the dial is not readable, which is what the customer sees.
 *
 *   node scripts/audit-front-view.mjs [--brands=citizen,casio,...] [--all] [--limit=n] [--sheet]
 *
 * Writes tmp/front-audit.json (metrics per watch) and, with --sheet, a labelled
 * contact sheet at tmp/front-audit-<n>.png for eyeballing the cut-off.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { classifyImage, gateOk, isClear, isSet } from "./front-view.mjs";
import { writeJson } from "./write-json.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "tmp");
const CATALOG = path.join(ROOT, "src/data/catalog-final.json");
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const numArg = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? Number(hit.split("=")[1]) : Infinity;
};

const BRANDS = [
  "Citizen",
  "Casio",
  "G-Shock",
  "DKNY",
  "Kenneth Cole",
  "Giordano",
  "Earnshaw",
  "Sonata",
  "Alba",
  "Maxima",
  "Alexandre Christie",
  "Tommy Hilfiger",
];

const scope = arg("brands");
const wanted = scope
  ? scope.split(",").map((s) => s.trim())
  : process.argv.includes("--all")
    ? null
    : BRANDS;

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
// Which frames a person chose by eye (scripts/pick-front.mjs and
// source-front-online.mjs --picks-file record them here as `picked`).
const MANIFEST = path.join(ROOT, "tmp/stock-2026/myntra/brands-manifest.json");
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
// --review only re-renders the sheets from the previous run's JSON.
const SKIP = process.argv.includes("--review");
// --no-save keeps the existing JSON (a queued pass may still be reading it).
const SKIP_WRITE = SKIP || process.argv.includes("--no-save");
// --brands accepts "casio", "G-Shock", ...; match brand names case-insensitively
const wantedSet = wanted
  ? new Set(catalog.map((w) => w.brand).filter((b) => wanted.some((s) => s.toLowerCase() === String(b).toLowerCase())))
  : null;
const rows = [];
let done = 0;
for (const w of SKIP ? [] : catalog) {
  if (wantedSet && !wantedSet.has(w.brand)) continue;
  if (!w.image) continue;
  if (rows.length >= numArg("limit")) break;
  const file = path.join(ROOT, "public", w.image.replace(/^\//, ""));
  if (!fs.existsSync(file)) {
    rows.push({ ...w, missing: true, front: false, reason: "missing-file" });
    continue;
  }
  let res;
  try {
    res = await classifyImage(await fs.promises.readFile(file));
  } catch (e) {
    res = { front: false, reason: `error:${e.message.slice(0, 40)}`, frontScore: 0, radius: 0, detail: 0 };
  }
  rows.push({
    id: w.id,
    brand: w.brand,
    model: w.model,
    image: w.image,
    ...res,
    // A frame a person chose after looking at the candidates is recorded as `picked`
    // in the brands manifest. Several Michael Kors dials - pale rose and mother of
    // pearl - measure below the dial-evidence floor while being unambiguously the
    // watch facing the lens, so the measurement defers to the eye here instead of
    // flagging them for re-sourcing on every run and churning a correct photo.
    human: Boolean(manifest[w.id]?.picked),
    // A couple/set SKU showing both watches is the right photo, not clutter.
    front: res.front || (isSet(w) && gateOk(res, { allowMultiple: true })),
    // "clear": not just a frame that passes the geometric front gate, but one the
    // storefront rule actually wants - the dial dead-on, the watch alone. A clasp
    // or an engraved back can pass `front`, so it must show dial evidence too.
    clear: isClear(res, { allowMultiple: isSet(w) }) || Boolean(manifest[w.id]?.picked),
  });
  done++;
  if (done % 100 === 0) console.log(`  ${done} checked, ${rows.filter((r) => !r.front).length} flagged`);
}

const bad = rows.filter((r) => !r.front);
const weak = rows.filter((r) => r.front && !r.clear);
console.log(`\nchecked ${rows.length} | front ${rows.length - bad.length} | NOT front ${bad.length} | front but not clear (3/4, pavé back) ${weak.length}`);
const byBrand = {};
for (const r of [...bad, ...weak]) byBrand[r.brand] = (byBrand[r.brand] || 0) + 1;
console.log("flagged by brand:", byBrand);
console.log("reasons:", bad.reduce((a, r) => ({ ...a, [r.reason]: (a[r.reason] || 0) + 1 }), {}));

if (!SKIP) fs.writeFileSync(path.join(OUT, "front-audit.json"), JSON.stringify(rows, null, 1));

/* ---------- labelled contact sheets ---------- */
if (process.argv.some((a) => a === "--sheet" || a.startsWith("--sheet="))) {
  await sheet(rows, "tmp/front-audit-sheet.png");
}
if (process.argv.includes("--review")) {
  // Re-render from the previous run's tmp/front-audit.json instead of
  // re-classifying 3k images. --only narrows it to something specific, e.g.
  //   --only "areaFrac>0.45"    a silhouette too big for a watch (a model shot)
  //   --only "clean<0.2"        a scene or packaging frame instead of white
  const cached = JSON.parse(fs.readFileSync(path.join(OUT, "front-audit.json"), "utf8"));
  const only = (arg("only", "") || "")
    .split(",")
    .map((s) => /^([a-zA-Z]+)([<>]=?)([-\d.]+)$/.exec(s.trim()))
    .filter(Boolean)
    .map((m) => ({ f: m[1], op: m[2], v: Number(m[3]) }));
  const pick = (r) =>
    only.length === 0
      ? !r.front
      : only.every(({ f, op, v }) => {
          const x = Number(r[f]);
          if (Number.isNaN(x)) return false;
          return op === ">" ? x > v : op === ">=" ? x >= v : op === "<" ? x < v : x <= v;
        });
  const picked = cached.filter(pick);
  await sheet(picked, "tmp/front-audit-flagged.png");
  console.log(
    `review sheet -> tmp/front-audit-flagged.png (${picked.length} tiles${only.length ? `, matching --only ${arg("only")}` : ", flagged"})`,
  );
}

async function sheet(rowsIn, target) {
  const sorted = [...rowsIn].sort((a, b) => (a.frontScore ?? 0) - (b.frontScore ?? 0)).slice(0, numArg("sheet"));
  if (!sorted.length) {
    console.log(`sheet -> ${target}: nothing to render`);
    return;
  }
  const CELL = 190;
  const COLS = 8;
  const rowsN = Math.ceil(sorted.length / COLS);
  const composites = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const x = (i % COLS) * CELL;
    const y = Math.floor(i / COLS) * CELL;
    const file = path.join(ROOT, "public", String(r.image || "").replace(/^\//, ""));
    if (fs.existsSync(file)) {
      composites.push({
        input: await sharp(file).resize(170, 150, { fit: "contain", background: "#ffffff" }).png().toBuffer(),
        left: x + 10,
        top: y + 4,
      });
    }
    const tag = r.front ? "FRONT" : String(r.reason).toUpperCase();
    const svg = `<svg width="${CELL}" height="34"><rect width="${CELL}" height="34" fill="${r.front ? "#0f1720" : "#7f1d1d"}"/><text x="6" y="14" font-family="monospace" font-size="11" fill="#fff">${String(r.id).slice(0, 26)}</text><text x="6" y="28" font-family="monospace" font-size="11" fill="#ffd">${tag} s=${r.frontScore} o=${r.objects} sk=${r.skinFrac} a=${r.areaFrac}</text></svg>`;
    composites.push({ input: Buffer.from(svg), left: x, top: y + CELL - 36 });
  }
  await sharp({ create: { width: COLS * CELL, height: rowsN * CELL, channels: 3, background: "#111" } })
    .composite(composites)
    .png()
    .toFile(path.join(OUT, path.basename(target)));
  console.log(`sheet -> ${target} (${sorted.length} tiles, worst first)`);
}
