import fs from "node:fs";
import path from "node:path";

/**
 * Publish the AI-upscaled 600px WebP tiles produced by upscale-products.mjs
 * into public/products (overwriting the Lanczos versions).
 */
const srcDir = path.resolve("tmp/products-ai");
const outDir = path.resolve("public/products");

if (!fs.existsSync(srcDir)) {
  console.error("no tmp/products-ai — run scripts/upscale-products.mjs first");
  process.exit(1);
}

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".webp"));
if (files.length < 1900) {
  console.error(`only ${files.length} upscaled images — expected ~2041, aborting`);
  process.exit(1);
}

let copied = 0;
for (const f of files) {
  fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f));
  copied++;
}
console.log(`published ${copied} upscaled images to public/products`);
