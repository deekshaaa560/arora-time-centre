import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

const file = "C:/Users/Sych-win/Downloads/27OCT.pdf";
const data = new Uint8Array(fs.readFileSync(file));
const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
console.log("pages", pdf.numPages);
const page = await pdf.getPage(1);
const ops = await page.getOperatorList();
const seen = new Set();
for (let i = 0; i < ops.fnArray.length; i++) {
  const fn = ops.fnArray[i];
  if (fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintInlineImageXObject) {
    let name = ops.argsArray[i][0];
    if (typeof name === "string" && !seen.has(name)) {
      seen.add(name);
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        try {
          page.objs.get(name, (img) => {
            clearTimeout(timer);
            console.log("img", name, img?.width, img?.height, img?.kind, img?.data?.length);
            resolve();
          });
        } catch (e) {
          clearTimeout(timer);
          console.log("err", name, String(e).slice(0, 120));
          resolve();
        }
      });
    }
  }
}
