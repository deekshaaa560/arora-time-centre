import * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";

// Re-extract Titan text (previous run died on memory while rendering PNGs)
const titanPath = "C:/Users/Sych-win/Downloads/CFA TITAN IMAGE STK SHEET  211026.pdf";
const titanDir = path.resolve("tmp/extract/titan");
const doc = mupdf.Document.openDocument(fs.readFileSync(titanPath), "application/pdf");
const pages = doc.countPages();
let all = "";
for (let i = 0; i < pages; i++) {
  all += `\n===== PAGE ${i + 1} =====\n` + doc.loadPage(i).toStructuredText().asText();
}
fs.writeFileSync(path.join(titanDir, "text.txt"), all, "utf8");
console.log(`titan: ${pages} pages`);

// Render one sample page per sheet for visual verification (single page, low memory)
const samples = [
  ["titan sample", titanPath, 2, "tmp/extract/titan/sample-page-3.png"],
  ["bdb sample", "C:/Users/Sych-win/Downloads/BDB Stock 27Oct.pdf", 0, "tmp/extract/bdb/sample-page-1.png"],
];
for (const [label, file, pageNo, out] of samples) {
  const d = mupdf.Document.openDocument(fs.readFileSync(file), "application/pdf");
  const pix = d
    .loadPage(pageNo)
    .toPixmap(mupdf.Matrix.scale(1.6, 1.6), mupdf.ColorSpace.DeviceRGB, false);
  fs.writeFileSync(out, pix.asPNG());
  console.log(`${label}: ok`);
}
