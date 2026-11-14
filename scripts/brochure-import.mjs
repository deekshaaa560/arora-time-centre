/**
 * Import the Bigotti Milano and Valentino Orlandi 2026 brochure PDFs.
 *
 * The brochures are PowerPoint-exported catalogues: every product page is a
 * grid of cells, each holding one full-resolution front-view watch photo
 * (512x816 JPEG) with a text label beside it — MEN/WOMEN, MODEL NO. and MRP.
 *
 *   node scripts/brochure-import.mjs --extract   # pair photos with labels -> tmp/brochures/<key>/
 *   node scripts/brochure-import.mjs --process   # cut out, float on white, gate -> public/products/
 *   node scripts/brochure-import.mjs --merge     # append rows to catalog-final.json
 */
import fs from "node:fs";
import path from "node:path";
import * as mupdf from "mupdf";

export const BROCHURES = {
  bigotti: {
    file: "C:/Users/Sych-win/Downloads/Bigotti_Milano_Brochure_2026 new.pdf",
    brand: "Bigotti Milano",
    modelRe: /\bBG\.\d\.\d+(?:-\d+)?\b/,
    pageGenderRe: /D O N N A|W O M E N '?\s* C O L L E C T I O N/u,
    expectModels: 106,
  },
  orlandi: {
    file: "C:/Users/Sych-win/Downloads/Valentino_Orlandi_Brochure_2026.pdf",
    brand: "Valentino Orlandi",
    modelRe: /\bVO\.\d\.\d+(?:-\d+)?\b/,
    pageGenderRe: /D O N N A|W O M E N '?\s* C O L L E C T I O N/u,
    expectModels: 55,
  },
};

const OUT = path.resolve("tmp/brochures");

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Text of every line on a page, in mupdf's y-down page points. */
function textLines(page) {
  const st = JSON.parse(page.toStructuredText().asJSON());
  const lines = [];
  for (const block of st.blocks) {
    if (block.type !== "text") continue;
    for (const line of block.lines || []) {
      const text = String(line.text || "").trim();
      if (!text || !line.bbox) continue;
      lines.push({
        text,
        x: line.bbox.x,
        y: line.bbox.y,
        w: line.bbox.w,
        h: line.bbox.h,
        cx: line.bbox.x + line.bbox.w / 2,
        cy: line.bbox.y + line.bbox.h / 2,
      });
    }
  }
  return lines;
}

/** Every raster drawn on a page, with its placement box in y-down points. */
function placedImages(page) {
  const found = [];
  const dev = new mupdf.Device({
    fillImage(img, ctm) {
      const [a, b, c, d, e, f] = ctm;
      const xs = [e, e + a, e + c, e + a + c];
      const ys = [f, f + b, f + d, f + b + d];
      found.push({
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        y0: Math.min(...ys),
        y1: Math.max(...ys),
        png: Buffer.from(img.toPixmap().asPNG()),
      });
    },
  });
  page.run(dev, mupdf.Matrix.identity);
  dev.close?.();
  return found;
}

const flattenText = (t) => t.replace(/[^A-Z0-9₹]/gi, "").toUpperCase();

function extractKey(key) {
  const cfg = BROCHURES[key];
  const dir = path.join(OUT, key);
  fs.mkdirSync(path.join(dir, "extract"), { recursive: true });

  const doc = mupdf.Document.openDocument(fs.readFileSync(cfg.file), "application/pdf");
  const rows = [];
  let logo = null;

  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p);
    const lines = textLines(page);
    const flat = lines.map((l) => ({ ...l, flat: flattenText(l.text) }));

    const images = placedImages(page);
    // Product photos are the tall placements; small header rasters are brand logos.
    const products = images.filter((im) => im.y1 - im.y0 > 120 && im.x1 - im.x0 > 60);
    for (const im of images) {
      if (!logo && im.y1 - im.y0 > 30 && im.y1 < 120 && (im.x1 - im.x0) * (im.y1 - im.y0) < 6000) {
        logo = { png: im.png, w: im.x1 - im.x0, h: im.y1 - im.y0 };
      }
    }

    const pageText = flat.map((l) => l.text).join("\n");
    const pageGender = cfg.pageGenderRe.test(pageText) ? "women" : "men";

    const models = flat.filter((l) => cfg.modelRe.test(l.text));
    for (const m of models) {
      const model = m.text.match(cfg.modelRe)[0];

      // gender word printed directly above the MODEL NO. label of the same cell
      let gender = null;
      for (const g of flat) {
        if (g.flat !== "MEN" && g.flat !== "WOMEN") continue;
        if (Math.abs(g.cx - m.cx) < 150 && g.cy < m.cy && m.cy - g.cy < 150) {
          gender = g.flat === "MEN" ? "men" : "women";
          break;
        }
      }
      if (!gender) {
        // nearest gender word in the same column, or the page section header
        let best = Infinity;
        for (const g of flat) {
          if (g.flat !== "MEN" && g.flat !== "WOMEN") continue;
          const d = Math.abs(g.cy - m.cy);
          if (Math.abs(g.cx - m.cx) < 150 && d < best) {
            best = d;
            gender = g.flat === "MEN" ? "men" : "women";
          }
        }
      }
      if (!gender) gender = pageGender;

      // MRP printed directly below the model code of the same cell
      let mrp = 0;
      for (const l of flat) {
        const mm = l.text.match(/₹\s*([\d,]+)(?:\.\d+)?/);
        if (!mm) continue;
        if (Math.abs(l.cx - m.cx) < 150 && l.cy > m.cy && l.cy - m.cy < 160) {
          mrp = Number(mm[1].replace(/,/g, ""));
          break;
        }
      }

      // the photo to the LEFT of the label, vertically overlapping it;
      // for right-column labels both row photos overlap, so take the closest
      let pick = null;
      let bestX1 = -Infinity;
      for (const im of products) {
        if (im.x1 > m.x + 20) continue;
        const overlap = Math.min(im.y1, m.cy + 10) - Math.max(im.y0, m.cy - 10);
        if (overlap <= 0) continue;
        if (im.x1 > bestX1) {
          bestX1 = im.x1;
          pick = im;
        }
      }
      if (!pick) {
        // labels below the photo (any brochure variant): nearest product centre
        let best = Infinity;
        for (const im of products) {
          const cx = (im.x0 + im.x1) / 2;
          const cy = (im.y0 + im.y1) / 2;
          const d = Math.hypot(cx - (m.cx - 120), cy - m.cy);
          if (d < best) {
            best = d;
            pick = im;
          }
        }
      }

      const id = `${slug(cfg.brand)}-${slug(model)}`;
      if (pick) fs.writeFileSync(path.join(dir, "extract", `${id}.png`), pick.png);
      rows.push({
        id,
        brand: cfg.brand,
        model,
        gender,
        mrp,
        price: mrp,
        page: p + 1,
        image: pick ? `/products/${id}.webp` : null,
      });
    }
  }

  if (logo) fs.writeFileSync(path.join(dir, "logo.png"), logo.png);
  fs.writeFileSync(path.join(dir, "rows.json"), JSON.stringify(rows, null, 1));

  const uniq = new Set(rows.map((r) => r.model)).size;
  const men = rows.filter((r) => r.gender === "men").length;
  const women = rows.filter((r) => r.gender === "women").length;
  const noImg = rows.filter((r) => !r.image).length;
  const noPrice = rows.filter((r) => !r.mrp).length;
  console.log(
    `${key}: ${rows.length} rows (${uniq} unique models, ${men} men / ${women} women), ` +
      `missing image ${noImg}, missing price ${noPrice}, logo ${logo ? "yes" : "NO"}, ` +
      `expected ${cfg.expectModels}`,
  );
  for (const bad of rows.filter((r) => !r.image || !r.mrp)) console.log("  ISSUE", JSON.stringify(bad));
}

const arg = process.argv.find((a) => a.startsWith("--")) || "--extract";
if (process.argv[1] && process.argv[1].endsWith("brochure-import.mjs") && arg === "--extract") {
  for (const key of Object.keys(BROCHURES)) extractKey(key);
}
