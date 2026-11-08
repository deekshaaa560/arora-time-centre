import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT = "public/products";
const BACKUP = "tmp/products-before-hires";
const REJECT = "tmp/bad-fallback-rejects";
fs.mkdirSync(REJECT, { recursive: true });

const fixes = {
  "titan-nn1639sm02": "https://www.titan.co.in/dw/image/v2/BKDD_PRD/on/demandware.static/-/Sites-titan-master-catalog/default/images/Titan/Catalog/1639SM02_1.jpg?sw=2000&sh=2000",
  "titan-np2639sl04": "https://www.titan.co.in/dw/image/v2/BKDD_PRD/on/demandware.static/-/Sites-titan-master-catalog/default/images/Titan/Catalog/2639SL04_1.jpg?sw=2000&sh=2000",
  "titan-np2639sl05": "https://www.titan.co.in/dw/image/v2/BKDD_PRD/on/demandware.static/-/Sites-titan-master-catalog/default/images/Titan/Catalog/2639SL05_1.jpg?sw=2000&sh=2000",
  "timex-tweg14903": "https://cdn.shopify.com/s/files/1/0787/5375/9521/products/tweg14903.jpg?v=1690215089",
  "timex-ti000q80500": "https://rukmini1.flixcart.com/image/1500/1500/watch/b/x/5/ti000q80500-timex-original-imae2zgqdzgfnmsg.jpeg?q=70",
  "timex-twel11701": "https://rukmini1.flixcart.com/image/1500/1500/jefzonk0/watch/u/q/y/twel11701-timex-original-imaf2akgeyapqnyt.jpeg?q=70",
  "timex-twel11509": "https://rukmini1.flixcart.com/image/1500/1500/xif0q/watch/v/f/g/twel11509-timex-watermarked-original-imaf3mstm3vrsmhg.jpeg?q=70",
};

async function fetchBuf(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.startsWith("image/")) throw new Error(`not image: ${ct}`);
  return Buffer.from(await res.arrayBuffer());
}

for (const [id, url] of Object.entries(fixes)) {
  const file = path.join(OUT, `${id}.webp`);
  try {
    const buf = await fetchBuf(url);
    const meta = await sharp(buf).metadata();
    const min = Math.min(meta.width || 0, meta.height || 0);
    if (min < 600) throw new Error(`too small ${meta.width}x${meta.height}`);

    let img = sharp(buf, { failOn: "none" }).flatten({ background: "#ffffff" });

    if (id === "timex-twel11509") {
      // white-out the Flipkart "brand authorised seller" badge at bottom-right
      const { data, info } = await sharp(buf)
        .resize(1200, 1200, { fit: "contain", background: "#ffffff", kernel: "lanczos3" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const { width: w, height: h, channels: ch } = info;
      const px = new Uint8Array(data);
      for (let y = Math.floor(h * 0.80); y < h; y++) for (let x = Math.floor(w * 0.80); x < w; x++) {
        const o = (y * w + x) * ch;
        px[o] = 255; px[o + 1] = 255; px[o + 2] = 255;
      }
      img = sharp(Buffer.from(px), { raw: { width: w, height: h, channels: ch } });
    }

    const tmp = file + ".fix.webp";
    await img
      .resize(1200, 1200, { fit: "contain", background: "#ffffff", kernel: "lanczos3" })
      .webp({ quality: 92, effort: 5 })
      .toFile(tmp);
    fs.copyFileSync(file, path.join(REJECT, path.basename(file)));
    fs.renameSync(tmp, file);
    console.log("fixed", id, meta.width + "x" + meta.height);
  } catch (e) {
    console.log("FAIL", id, String(e?.message || e));
  }
}

// TWEL28202: no clean front image found online — restore the correct front shot
const revert = ["timex-twel28202-w.webp"];
for (const f of revert) {
  const src = path.join(BACKUP, f);
  const dst = path.join(OUT, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(dst, path.join(REJECT, f));
    fs.copyFileSync(src, dst);
    console.log("reverted", f);
  } else {
    console.log("missing backup", f);
  }
}
