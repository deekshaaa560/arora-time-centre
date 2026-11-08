import * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";

const files = [
  ["fastrack", "C:/Users/Sych-win/Downloads/CFA FASTRACK IMAGE STK SHEET 211026.pdf"],
  ["titan", "C:/Users/Sych-win/Downloads/CFA TITAN IMAGE STK SHEET  211026.pdf"],
  ["bdb", "C:/Users/Sych-win/Downloads/BDB Stock 27Oct.pdf"],
];

const outRoot = path.resolve("tmp/extract");
fs.mkdirSync(outRoot, { recursive: true });

for (const [name, file] of files) {
  const buf = fs.readFileSync(file);
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const pages = doc.countPages();
  const dir = path.join(outRoot, name);
  fs.mkdirSync(dir, { recursive: true });

  let allText = "";

  for (let i = 0; i < pages; i++) {
    const page = doc.loadPage(i);
    allText += `\n===== PAGE ${i + 1} =====\n` + page.toStructuredText().asText();

    const pix = page.toPixmap(
      mupdf.Matrix.scale(2, 2),
      mupdf.ColorSpace.DeviceRGB,
      false,
    );
    fs.writeFileSync(
      path.join(dir, `page-${String(i + 1).padStart(2, "0")}.png`),
      pix.asPNG(),
    );
  }

  fs.writeFileSync(path.join(dir, "text.txt"), allText, "utf8");
  console.log(`${name}: ${pages} pages`);
}
