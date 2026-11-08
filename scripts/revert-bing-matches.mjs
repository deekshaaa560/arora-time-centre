import fs from "node:fs";
import path from "node:path";

const PROGRESS = "tmp/extract/hires-progress.json";
const OUT = "public/products";
const BACKUP = "tmp/products-before-hires";
const state = JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
const catalog = JSON.parse(fs.readFileSync("src/data/catalog.json", "utf8"));
const byId = new Map(catalog.map((w) => [w.id, w]));

const keep = new Set(["fastrack-6291sm01", "timex-tw000s812"]);
let reverted = 0, missing = 0, kept = 0;

for (const [id, done] of Object.entries(state.done || {})) {
  if (done.source !== "bing-images") continue;
  if (keep.has(id)) { kept++; continue; }
  const w = byId.get(id);
  const file = done.file || (w?.image ? path.basename(w.image) : `${id}.webp`);
  const src = path.join(BACKUP, file);
  const dst = path.join(OUT, file);
  if (!fs.existsSync(src)) {
    missing++;
    console.log("missing backup", id, file);
    continue;
  }
  fs.copyFileSync(src, dst);
  delete state.done[id];
  state.failed[id] = { reason: "reverted wrong bing match", attempts: 3, at: new Date().toISOString() };
  reverted++;
  console.log("reverted", id);
}

fs.writeFileSync(PROGRESS, JSON.stringify(state, null, 1));
console.log({ reverted, kept, missing, failed: Object.keys(state.failed || {}).length });
