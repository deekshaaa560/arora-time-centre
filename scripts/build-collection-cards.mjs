import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT = "public/collections";
fs.mkdirSync(OUT, { recursive: true });

const pieces = {
  men: { id: "michael-kors-mk8561", accent: "#c9a24b", label: "men" },
  women: { id: "titan-10011ql01", accent: "#d8b2a2", label: "women" },
};

function erode(mask, w, h, steps) {
  let cur = mask;
  for (let s = 0; s < steps; s++) {
    const next = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (cur[i] && cur[i - 1] && cur[i + 1] && cur[i - w] && cur[i + w]) next[i] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

async function cutout(id) {
  const enhanced = `public/products/${id}.webp`;
  const backup = `tmp/products-backup/${id}.webp`;
  const meta = await sharp(enhanced).metadata();
  const size = meta.width;
  const alpha = await sharp(backup)
    .ensureAlpha()
    .extractChannel(3)
    .resize(size, size, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();

  // Tighten the matte: remove the soft white fringe that becomes a halo on dark.
  const hard = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) hard[i] = alpha[i] >= 155 ? 1 : 0;
  const tight = erode(hard, size, size, 2);

  // One-pixel box feather, kept single-channel (sharp raw() defaults to 3ch).
  const feathered = new Uint8Array(size * size);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      if (!tight[i]) continue;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += tight[(y + dy) * size + (x + dx)] ? 255 : 0;
        }
      }
      feathered[i] = Math.round(sum / 9);
    }
  }

  const { data } = await sharp(enhanced).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = data[i * 3];
    rgba[i * 4 + 1] = data[i * 3 + 1];
    rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = feathered[i];
  }
  return sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

function background(accent) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1000">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.75" y2="1">
        <stop offset="0" stop-color="#15120d"/>
        <stop offset="0.55" stop-color="#0b0a09"/>
        <stop offset="1" stop-color="#050505"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.65" cy="0.43" r="0.58">
        <stop offset="0" stop-color="${accent}" stop-opacity="0.24"/>
        <stop offset="0.55" stop-color="${accent}" stop-opacity="0.06"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
        <stop offset="0.58" stop-color="#000000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0.55"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="1000" fill="url(#bg)"/>
    <rect width="1200" height="1000" fill="url(#glow)"/>
    <g fill="none" stroke="${accent}">
      <circle cx="790" cy="470" r="312" stroke-opacity="0.12" stroke-width="1"/>
      <circle cx="790" cy="470" r="348" stroke-opacity="0.045" stroke-width="0.7"/>
      <g stroke-opacity="0.10" stroke-width="1.2" stroke-linecap="round">
        <path d="M790 140v14M790 786v14M460 470h14M1106 470h14"/>
      </g>
    </g>
    <rect width="1200" height="1000" fill="url(#vignette)"/>
  </svg>`);
}

function shadow() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1000">
    <defs><filter id="blur"><feGaussianBlur stdDeviation="28"/></filter></defs>
    <ellipse cx="800" cy="862" rx="235" ry="46" fill="#000000" fill-opacity="0.72" filter="url(#blur)"/>
  </svg>`);
}

for (const p of Object.values(pieces)) {
  const watch = await cutout(p.id);
  const main = await sharp(watch).resize({ height: 730 }).png().toBuffer();
  const out = await sharp(background(p.accent))
    .composite([
      { input: shadow(), left: 0, top: 0 },
      { input: main, left: 420, top: 105 },
    ])
    .webp({ quality: 92, effort: 6 })
    .toFile(path.join(OUT, `${p.label}.webp`));
  console.log(p.label, p.id, out.width, out.height);
}
