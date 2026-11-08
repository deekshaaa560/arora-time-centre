import sharp from "sharp";

const id = "fastrack-3273nl04";
const before = await sharp(`public/products/${id}.webp`)
  .resize(600, 600, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
const after = await sharp(`tmp/products-ai/${id}.webp`)
  .resize(600, 600, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

const label = Buffer.from(`<svg width="1240" height="700" xmlns="http://www.w3.org/2000/svg">
  <text x="310" y="38" font-family="Arial" font-size="22" fill="#93a0b4" text-anchor="middle" letter-spacing="3">BEFORE</text>
  <text x="930" y="38" font-family="Arial" font-size="22" fill="#e3c58c" text-anchor="middle" letter-spacing="3">AI-SHARPENED (NEW)</text>
</svg>`);

await sharp({ create: { width: 1240, height: 700, channels: 3, background: { r: 11, g: 14, b: 21 } } })
  .composite([
    { input: before, left: 10, top: 60 },
    { input: after, left: 630, top: 60 },
    { input: label, left: 0, top: 0 },
  ])
  .png()
  .toFile("tmp/before-after.png");
console.log("created tmp/before-after.png");
