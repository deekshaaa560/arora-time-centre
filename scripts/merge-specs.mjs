import fs from "node:fs";

if (!fs.existsSync("tmp/specs.json")) {
  console.log("no specs yet");
  process.exit(0);
}

const catalog = JSON.parse(fs.readFileSync("src/data/catalog.json", "utf8"));
const specs = JSON.parse(fs.readFileSync("tmp/specs.json", "utf8"));
const FIELDS = ["caseSize", "movement", "glass", "strap", "waterResistance", "warranty"];

let merged = 0;
for (const w of catalog) {
  const s = specs[w.id];
  if (!s) continue;
  const clean = {};
  for (const f of FIELDS) if (s[f]) clean[f] = s[f];
  if (Object.keys(clean).length === 0) continue;
  w.specs = clean;
  merged++;
}

fs.writeFileSync("src/data/catalog.json", JSON.stringify(catalog));
console.log("specs merged into", merged, "products");
