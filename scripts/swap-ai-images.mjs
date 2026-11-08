import fs from "node:fs";
import path from "node:path";

const newDir = path.resolve("tmp/products-ai");
const liveDir = path.resolve("public/products");

const count = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".webp")).length : 0);
const fresh = count(newDir);
const current = count(liveDir);
console.log("new images:", fresh, "| current:", current);

if (fresh < 1900) {
  console.log("not enough new images — aborting swap");
  process.exit(1);
}

const backup = path.resolve("tmp/products-pre-ai");
fs.rmSync(backup, { recursive: true, force: true });
fs.renameSync(liveDir, backup);
fs.renameSync(newDir, liveDir);
console.log("swapped. backup at tmp/products-pre-ai");
