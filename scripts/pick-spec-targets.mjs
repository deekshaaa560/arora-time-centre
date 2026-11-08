import fs from "node:fs";

const catalog = JSON.parse(fs.readFileSync("src/data/catalog.json", "utf8"));
const chosen = new Map();

const featuredIds = [
  "titan-10069km03", "titan-rnu95219vm01", "fastrack-nu3297km01",
  "fastrack-3333qm01", "timex-tweg16722", "timex-tweg31902",
].filter((id) => catalog.some((w) => w.id === id));

const priced = (brand, gender, n) =>
  catalog
    .filter((w) => w.brand === brand && w.gender === gender && w.image)
    .sort((a, b) => b.price - a.price)
    .slice(0, n);

for (const w of catalog.filter((w) => featuredIds.includes(w.id))) chosen.set(w.id, w);
for (const brand of ["Fastrack", "Titan", "Timex"]) {
  for (const gender of ["men", "women"]) {
    for (const w of priced(brand, gender, 5)) chosen.set(w.id, w);
  }
}

// Fill up to 40 with the priciest remaining in-stock watches
for (const w of catalog
  .filter((w) => w.image && w.qty > 0 && !chosen.has(w.id))
  .sort((a, b) => b.price - a.price)) {
  if (chosen.size >= 40) break;
  chosen.set(w.id, w);
}

const list = [...chosen.values()].slice(0, 40);
fs.writeFileSync("tmp/spec-targets.json", JSON.stringify(list, null, 1));
console.log(list.length, "targets:");
for (const w of list) console.log(`${w.brand} ${w.model} ₹${w.price} ${w.gender}`);
