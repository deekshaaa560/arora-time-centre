import * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";

const name = "bdb";
const file = "C:/Users/Sych-win/Downloads/BDB Stock 27Oct.pdf";
const dir = path.resolve("tmp/extract", name);
fs.mkdirSync(dir, { recursive: true });

const doc = mupdf.Document.openDocument(fs.readFileSync(file), "application/pdf");
const pages = doc.countPages();
let all = "";
for (let i = 0; i < pages; i++) {
  all += `\n===== PAGE ${i + 1} =====\n` + doc.loadPage(i).toStructuredText().asText();
}
fs.writeFileSync(path.join(dir, "text.txt"), all, "utf8");
console.log(`${name}: ${pages} pages`);
