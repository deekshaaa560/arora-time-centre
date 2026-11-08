import fs from "node:fs";
import path from "node:path";

const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);
const codeRe = /^[A-Za-z0-9][A-Za-z0-9-]{2,}$/;

function parseCfa(name, brand) {
  const text = fs.readFileSync(path.resolve(`tmp/extract/${name}/text.txt`), "utf8");
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const rows = [];
  let page = 1;
  let tokens = [];
  const flush = () => {
    let i = 0;
    while (i < tokens.length) {
      if (
        tokens[i] === brand.toUpperCase() &&
        codeRe.test(tokens[i + 1] ?? "") &&
        num(tokens[i + 2] ?? "") !== null &&
        num(tokens[i + 3] ?? "") !== null &&
        num(tokens[i + 4] ?? "") !== null
      ) {
        rows.push({
          brand,
          sheet: name,
          page,
          code: tokens[i + 1],
          qty: num(tokens[i + 2]),
          mrp: num(tokens[i + 3]),
          discount: num(tokens[i + 4]),
          fn: null,
        });
        i += 5;
        continue;
      }
      i++;
    }
    tokens = [];
  };
  for (const line of lines) {
    if (!line) continue;
    const pm = line.match(/^===== PAGE (\d+) =====$/);
    if (pm) {
      flush();
      page = Number(pm[1]);
      continue;
    }
    tokens.push(...line.split(/\s+/));
  }
  flush();
  return rows;
}

function parseBdb() {
  const text = fs.readFileSync(path.resolve("tmp/extract/bdb/text.txt"), "utf8");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  let page = 1;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const pm = line.match(/^===== PAGE (\d+) =====$/);
    if (pm) {
      page = Number(pm[1]);
      i++;
      continue;
    }
    // function, gender, code, mrp, qty, discount%
    const fn = lines[i];
    const gender = lines[i + 1];
    const code = lines[i + 2];
    const mrp = num(lines[i + 3] ?? "");
    const qty = num(lines[i + 4] ?? "");
    const disc = (lines[i + 5] ?? "").replace("%", "");
    const discN = num(disc);
    if (
      ["Men", "Women", "Pair", "Multi"].includes(gender) &&
      codeRe.test(code ?? "") &&
      mrp !== null &&
      qty !== null &&
      discN !== null
    ) {
      rows.push({ brand: "Timex", sheet: "bdb", page, code, qty, mrp, discount: discN, fn, gender });
      i += 6;
      continue;
    }
    i++;
  }
  return rows;
}

const rows = [
  ...parseCfa("fastrack", "Fastrack"),
  ...parseCfa("titan", "Titan"),
  ...parseBdb(),
];

fs.writeFileSync("tmp/extract/products.json", JSON.stringify(rows, null, 1));
const byBrand = rows.reduce((a, r) => ((a[r.brand] = (a[r.brand] || 0) + 1), a), {});
const bySheet = rows.reduce((a, r) => ((a[r.sheet] = (a[r.sheet] || 0) + 1), a), {});
console.log("total", rows.length);
console.log("by brand", byBrand);
console.log("by sheet", bySheet);
console.log("sample", rows.slice(0, 3), "…", rows.at(-1));
const dupes = rows.length - new Set(rows.map((r) => r.brand + ":" + r.code)).size;
console.log("duplicate brand+code:", dupes);
const badPrice = rows.filter((r) => !r.mrp || r.mrp < 200 || r.mrp > 500000).length;
const badDisc = rows.filter((r) => r.discount < 0 || r.discount > 90).length;
console.log("badPrice", badPrice, "badDisc", badDisc);
