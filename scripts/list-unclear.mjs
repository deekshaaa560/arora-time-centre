/**
 * Row ids whose photo is not a usable storefront frame, read out of the last
 * audit (tmp/front-audit.json, written by audit-front-view.mjs). Feeds the
 * targeted modes of the other passes:
 *
 *   node scripts/audit-front-view.mjs --all
 *   node scripts/list-unclear.mjs                  -> tmp/still-bad.txt
 *   node scripts/fix-front-views.mjs --ids-file=tmp/still-bad.txt
 *   node scripts/source-front-online.mjs --ids-file=tmp/still-bad.txt
 *
 * --front-only lists the frames that fail outright, ignoring the ones that merely
 * score thin on dial evidence (a low-contrast white dial is still a dial).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const audit = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp/front-audit.json"), "utf8"));
const rows = Array.isArray(audit) ? audit : audit.rows || [];
const onlyFront = process.argv.includes("--front-only");

const bad = rows.filter((r) => (!r.front || (!onlyFront && !r.clear)) && !r.human);
const out = path.join(ROOT, "tmp/still-bad.txt");
fs.writeFileSync(out, bad.map((r) => r.id).join("\n") + (bad.length ? "\n" : ""));

const byBrand = {};
for (const r of bad) byBrand[r.brand] = (byBrand[r.brand] || 0) + 1;
console.log(`rows checked ${rows.length} | not usable ${bad.length} -> ${path.relative(ROOT, out)}`);
console.log(
  "by brand:",
  Object.entries(byBrand)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 22)
    .map(([b, n]) => `${b}=${n}`)
    .join(", "),
);
const reasons = {};
for (const r of bad) if (!r.front) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
console.log("reasons:", JSON.stringify(reasons));
