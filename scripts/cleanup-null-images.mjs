import fs from "node:fs";
import path from "node:path";

const PROGRESS = "tmp/extract/hires-progress.json";
const CATALOG = "src/data/catalog.json";
const state = JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const ids = new Set(["timex-twel26605", "timex-tw000t640"]);
let removed = 0;
for (const w of catalog) {
  if (!ids.has(w.id)) continue;
  if (w.image) {
    const f = path.join("public/products", path.basename(w.image));
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    w.image = null;
    removed++;
  }
  delete state.done[w.id];
  state.failed[w.id] = { reason: "no reliable high-res source", attempts: 5, at: new Date().toISOString() };
}
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n");
fs.writeFileSync(PROGRESS, JSON.stringify(state, null, 1));
console.log({ removed, failed: Object.keys(state.failed || {}).length });
