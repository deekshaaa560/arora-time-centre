import sharp from "sharp";
import { copyFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");

const svg = await readFile(join(publicDir, "favicon.svg"));

const targets = [
  ["favicon-16x16.png", 16],
  ["favicon-32x32.png", 32],
  ["favicon-48x48.png", 48],
  ["favicon-512x512.png", 512],
  ["apple-touch-icon.png", 180],
];

await Promise.all(
  targets.map(([name, size]) =>
    sharp(svg, { density: 512 })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(join(publicDir, name)),
  ),
);

await copyFile(
  join(publicDir, "favicon.svg"),
  join(publicDir, "brand", "arora-favicon.svg"),
);

console.log(`Rendered ${targets.length} favicon PNGs from favicon.svg`);
