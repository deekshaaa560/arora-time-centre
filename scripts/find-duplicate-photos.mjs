/**
 * Find product photos that are effectively the same picture, which is what makes
 * the grid look like duplicate watches even when the model codes differ. Also
 * reports rows whose on-screen name is identical, because that is what the
 * customer actually reads.
 *
 *   node scripts/find-duplicate-photos.mjs [--top=40]
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/products");
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/catalog-final.json"), "utf8"));
const byFile = new Map();
for (const w of catalog) {
  if (!w.image) continue;
  const f = path.basename(w.image);
  (byFile.get(f) || byFile.set(f, []).get(f)).push(w);
}

/** 8x8 average hash + a 16-bit colour signature, compared by Hamming distance. */
async function signature(file) {
  const { data, info } = await sharp(path.join(OUT, file)).grayscale().resize(9, 9, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const gray = [];
  for (let i = 0; i < 64; i++) gray.push((data[i] + data[i + info.width] + data[i + 1] + data[i + info.width + 1]) / 4);
  const mean = gray.reduce((s, v) => s + v, 0) / gray.length;
  let bits = 0n;
  gray.forEach((v, i) => {
    if (v > mean) bits |= 1n << BigInt(i);
  });
  return bits;
}

const hamming = (a, b) => {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
};

const files = [...byFile.keys()].filter((f) => fs.existsSync(path.join(OUT, f)));
console.log(`hashing ${files.length} photos`);
const sigs = [];
let n = 0;
for (const f of files) {
  try {
    sigs.push({ file: f, bits: await signature(f) });
  } catch {
    /* skip */
  }
  if (++n % 500 === 0) console.log(`  ${n}/${files.length}`);
}

// Bucket by a coarse prefix of the hash so the comparison stays cheap.
const buckets = new Map();
for (const s of sigs) {
  const k = (s.bits & 0xffffn).toString(16);
  (buckets.get(k) || buckets.set(k, []).get(k)).push(s);
}
const groups = [];
const seen = new Set();
for (const s of sigs) {
  if (seen.has(s.file)) continue;
  const near = sigs.filter((o) => o.file !== s.file && !seen.has(o.file) && hamming(o.bits, s.bits) <= Number(arg("maxdiff", 4)));
  if (near.length) {
    groups.push([s.file, ...near.map((x) => x.file)]);
    [s.file, ...near.map((x) => x.file)].forEach((f) => seen.add(f));
  }
}

console.log(`\nvisually identical photo groups: ${groups.length}`);
const rows = [];
for (const g of groups.slice(0, Number(arg("top", 40)))) {
  const watches = g.flatMap((f) => byFile.get(f) || []);
  rows.push(
    `  ${g.join(" == ")}\n     ${watches.map((w) => `${w.id} [${w.model} ${w.gender} ₹${w.price}]`).join(" | ")}`,
  );
}
console.log(rows.join("\n"));

// Same on-screen label: what the customer reads as "the same watch twice".
const labels = new Map();
for (const w of catalog) {
  const k = `${w.brand}|${w.gender}`;
  (labels.get(k) || labels.set(k, []).get(k)).push(w);
}
const generic = catalog.filter((w) => !w.fn && !w.specs?.dialColor).length;
console.log(`\nrows with no distinguishing name data: ${generic} of ${catalog.length}`);
fs.writeFileSync(path.join(ROOT, "tmp/duplicate-photos.json"), JSON.stringify(groups, null, 1));
console.log("-> tmp/duplicate-photos.json");
