import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const map = {
  "titan-rnu95219vm01": "tmp/official/titan-raga-2.img",
  "titan-10011ql01": "tmp/official/titan-10011ql01.img",
  "fastrack-nu3297km01": "tmp/official/fastrack-nu3297km01.img",
  "fastrack-nu3297kl01": "tmp/official/fastrack-nu3297kl01.img",
  "timex-tweg16722": "tmp/official/timex-tweg16722.img",
  "timex-twel29100": "tmp/official/timex-twel29100.img",
  "fossil-es5341": "tmp/official/fossil-test-1.img",
  "michael-kors-mk8561": "tmp/official/michael-kors-mk8561.img",
};

const BACKUP = "tmp/products-featured-before-official";
fs.mkdirSync(BACKUP, { recursive: true });

for (const [id, src] of Object.entries(map)) {
  const dest = path.join("public/products", `${id}.webp`);
  if (!fs.existsSync(src)) {
    console.log("missing", src);
    continue;
  }
  if (!fs.existsSync(path.join(BACKUP, `${id}.webp`))) {
    fs.copyFileSync(dest, path.join(BACKUP, `${id}.webp`));
  }
  const meta = await sharp(src).metadata();
  await sharp(src)
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .resize(1000, 1000, { fit: "contain", background: "#ffffff", kernel: "lanczos3" })
    .sharpen({ sigma: 0.5, m1: 0.35, m2: 0.12 })
    .webp({ quality: 92, effort: 6 })
    .toFile(dest);
  console.log("replaced", id, meta.width + "x" + meta.height);
}
