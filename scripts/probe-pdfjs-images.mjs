// Probe whether pdfjs can pull embedded raster images + transforms from a page
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfjsPath = path.dirname(require.resolve("pdfjs-dist/package.json"));
const { getDocument } = await import(
  "file://" + path.join(pdfjsPath, "legacy/build/pdf.mjs").replace(/\\/g, "/")
);

const file = process.argv[2] ?? "C:/Users/Sych-win/Downloads/CFA FASTRACK IMAGE STK SHEET 211026.pdf";
const data = new Uint8Array(fs.readFileSync(file));
const doc = await getDocument({ data, useSystemFonts: false }).promise;
const page = await doc.getPage(1);
const ops = await page.getOperatorList();
const OPS = (await import("file://" + path.join(pdfjsPath, "legacy/build/pdf.mjs").replace(/\\/g, "/"))).OPS;
const names = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));

const imageOps = [];
for (let i = 0; i < ops.fnArray.length; i++) {
  const fn = ops.fnArray[i];
  const args = ops.argsArray[i];
  if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintInlineImageXObject) {
    imageOps.push({ i, op: names[fn], args: JSON.stringify(args).slice(0, 200) });
  }
}
console.log("page count:", doc.numPages, "| image ops:", imageOps.length);
console.log(imageOps.slice(0, 5));

for (const { i } of imageOps.slice(0, 2)) {
  const name = ops.argsArray[i][0];
  try {
    const img = await new Promise((res, rej) => page.objs.get(name, res));
    console.log("image", name, img.width, img.height, img.data?.length);
  } catch (e) {
    console.log("get failed", name, String(e).slice(0, 120));
  }
}
await doc.destroy();
