import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const pdfjsPath = path.dirname(require.resolve("pdfjs-dist/package.json"));
const pdfjs = await import(
  "file://" + path.join(pdfjsPath, "legacy/build/pdf.mjs").replace(/\\/g, "/")
);
const { getDocument, OPS } = pdfjs;

const rows = JSON.parse(fs.readFileSync("tmp/extract/products.json", "utf8"));
const outDir = path.resolve("public/products");
fs.mkdirSync(outDir, { recursive: true });

const sheets = {
  fastrack: "C:/Users/Sych-win/Downloads/CFA FASTRACK IMAGE STK SHEET 211026.pdf",
  titan: "C:/Users/Sych-win/Downloads/CFA TITAN IMAGE STK SHEET  211026.pdf",
  bdb: "C:/Users/Sych-win/Downloads/BDB Stock 27Oct.pdf",
};

const slug = (r) => `${r.brand.toLowerCase()}-${r.code.toLowerCase()}`;

let saved = 0;
let missing = [];

for (const [sheet, file] of Object.entries(sheets)) {
  const sheetRows = rows.filter((r) => r.sheet === sheet);
  const byPage = new Map();
  for (const r of sheetRows) {
    if (!byPage.has(r.page)) byPage.set(r.page, []);
    byPage.get(r.page).push(r);
  }

  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;

  for (let p = 0; p < doc.numPages; p++) {
    const pageRows = byPage.get(p + 1);
    if (!pageRows) continue;
    const page = await doc.getPage(p + 1);
    const ops = await page.getOperatorList();
    const imageNames = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === OPS.paintImageXObject || ops.fnArray[i] === OPS.paintJpegXObject) {
        imageNames.push(ops.argsArray[i][0]);
      }
    }

    if (imageNames.length !== pageRows.length) {
      // still zip the ones we can — order is stable top-to-bottom
      console.log(`mismatch ${sheet} p${p + 1}: ${pageRows.length} rows vs ${imageNames.length} images`);
    }

    for (let k = 0; k < Math.min(imageNames.length, pageRows.length); k++) {
      const name = imageNames[k];
      const img = await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("timeout " + name)), 15000);
        try {
          page.objs.get(name, (obj) => {
            clearTimeout(t);
            res(obj);
          });
        } catch (err) {
          clearTimeout(t);
          rej(err);
        }
      }).catch(() => null);
      if (!img || !img.data || !img.width) {
        missing.push(slug(pageRows[k]));
        continue;
      }
      const channels = img.data.length / (img.width * img.height);
      if (channels !== 3 && channels !== 4) {
        missing.push(slug(pageRows[k]));
        continue;
      }
      const out = path.join(outDir, slug(pageRows[k]) + ".webp");
      try {
        const strong = img.width < 150; // tiny Timex sources need more help
        const inner = await sharp(Buffer.from(img.data), {
          raw: { width: img.width, height: img.height, channels },
        })
          .trim({ threshold: 12 })
          .resize({
            width: 548,
            height: 548,
            fit: "inside",
            kernel: "lanczos3",
          })
          .sharpen(
            strong
              ? { sigma: 1.3, m1: 1.1, m2: 0.5 }
              : { sigma: 1.0, m1: 0.85, m2: 0.35 },
          )
          .modulate({ brightness: 1.02, saturation: 1.07 })
          .linear(1.05, -4)
          .png()
          .toBuffer();

        await sharp({
          create: {
            width: 600,
            height: 600,
            channels: 3,
            background: { r: 255, g: 255, b: 255 },
          },
        })
          .composite([{ input: inner, gravity: "center" }])
          .webp({ quality: 90, effort: 5 })
          .toFile(out);
        saved++;
      } catch (e) {
        missing.push(slug(pageRows[k]));
      }
    }
    page.cleanup?.();
  }
  doc.destroy?.();
  console.log(`${sheet}: done (saved so far ${saved})`);
}

console.log(`saved ${saved} images, missing ${missing.length}`);
fs.writeFileSync("tmp/extract/missing-images.json", JSON.stringify(missing, null, 1));
