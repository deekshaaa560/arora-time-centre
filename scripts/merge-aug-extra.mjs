import fs from "node:fs";

const extras = JSON.parse(fs.readFileSync("tmp/stock-2026/aug-extra.json", "utf8"));
const catalog = JSON.parse(fs.readFileSync("src/data/catalog.json", "utf8"));
const official = JSON.parse(fs.readFileSync("src/data/officialGenders.json", "utf8"));

const GENDERS = {
  ES5443: "women",
  ES5476: "women",
  ES5477: "women",
  ES5480: "women",
  FS6168: "men",
  AX7147SET: "men",
  AR11715: "men",
  AR11716: "women",
  AR11717: "women",
  AR11718: "women",
  AR11720: "women",
  AR11721: "women",
  AR11723: "women",
  AR11741: "men",
  AR11743: "women",
  AR80083SET: "women",
  MK4967: "women",
  MK7609: "women",
  MK7611: "women",
};

const existing = new Set(catalog.map((w) => w.id));
const additions = [];
for (const item of extras) {
  if (existing.has(item.id)) continue;
  const gender = GENDERS[item.model] ?? official[item.id] ?? "unisex";
  additions.push({
    id: item.id,
    brand: item.brand,
    model: item.model,
    gender,
    price: Number(item.mrp) || 0,
    mrp: Number(item.mrp) || 0,
    discount: 0,
    qty: typeof item.qty === "number" ? item.qty : null,
    fn: null,
    image: item.image,
  });
  existing.add(item.id);
}
const merged = [...catalog, ...additions];
fs.writeFileSync("src/data/catalog.json", JSON.stringify(merged));
fs.writeFileSync("tmp/stock-2026/catalog-before-aug19.json", JSON.stringify(catalog));
console.log("added", additions.length, "catalog", merged.length);
console.log(additions.map((w) => `${w.brand} ${w.model} ${w.gender}`));
