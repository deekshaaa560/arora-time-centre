import * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";

const files = [
  ["aug5", "C:/Users/Sych-win/Downloads/5th Aug Stock Qty - Sheet1.pdf"],
  ["oct27", "C:/Users/Sych-win/Downloads/27OCT.pdf"],
];

const outRoot = path.resolve("tmp/stock-2026");
fs.mkdirSync(outRoot, { recursive: true });

for (const [name, file] of files) {
  const doc = mupdf.Document.openDocument(fs.readFileSync(file), "application/pdf");
  const pages = doc.countPages();
  const dir = path.join(outRoot, name);
  fs.mkdirSync(dir, { recursive: true });

  let allText = "";

  for (let i = 0; i < pages; i++) {
    const page = doc.loadPage(i);
    allText += `\n===== PAGE ${i + 1} =====\n` + page.toStructuredText().asText();

    const pix = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false);
    fs.writeFileSync(path.join(dir, `page-${String(i + 1).padStart(3, "0")}.png`), pix.asPNG());
  }

  fs.writeFileSync(path.join(dir, "text.txt"), allText, "utf8");
  console.log(`${name}: ${pages} pages`);
}
