import type { Watch } from "../data/watches";
import { SHOP } from "../config";
import { discountPct, inr } from "./format";
import { displayName } from "./displayName";
import {
  availabilityLabel,
  watchCategoryLabel,
  watchSpecEntries,
} from "./watchShare";

const WIDTH = 1080;
const HEIGHT = 1350;
const MARGIN = 80;
const CONTENT = WIDTH - MARGIN * 2;

const COLOR = {
  background: "#080808",
  panel: "#f7f5f0",
  cream: "#f2f2f2",
  muted: "#9a9a9a",
  gold: "#d8b46a",
  line: "#2a2a2a",
  stock: "#25d366",
  soldOut: "#e07a7a",
} as const;

/** Rounded rectangle path (kept manual for older mobile canvas engines). */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Letter-spaced uppercase text. */
function trackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
) {
  let cursor = x;
  for (const char of text) {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + tracking;
  }
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped.trimEnd()}…`;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let index = 0;

  while (index < words.length && lines.length < maxLines) {
    let line = "";
    while (index < words.length) {
      const test = line ? `${line} ${words[index]}` : words[index];
      if (line && ctx.measureText(test).width > maxWidth) break;
      line = test;
      index += 1;
    }
    lines.push(line);
  }

  if (index < words.length && lines.length > 0) {
    const last = lines[lines.length - 1];
    let clipped = last;
    while (clipped && ctx.measureText(`${clipped}…`).width > maxWidth) {
      clipped = clipped.slice(0, -1);
    }
    lines[lines.length - 1] = `${clipped.trimEnd()}…`;
  }

  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load watch photo"));
    image.src = src;
  });
}

function drawImageContained(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  padding: number,
) {
  const scale = Math.min(
    (w - padding * 2) / image.naturalWidth,
    (h - padding * 2) / image.naturalHeight,
  );
  const drawW = image.naturalWidth * scale;
  const drawH = image.naturalHeight * scale;
  ctx.drawImage(image, x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH);
}

function drawPhotoPanel(
  ctx: CanvasRenderingContext2D,
  watch: Watch,
  image: HTMLImageElement | null,
) {
  const x = MARGIN;
  const y = 188;
  const w = CONTENT;
  const h = 520;

  ctx.save();
  ctx.fillStyle = COLOR.panel;
  roundedRect(ctx, x, y, w, h, 24);
  ctx.fill();
  ctx.clip();

  if (image) {
    drawImageContained(ctx, image, x, y, w, h, 34);
  } else {
    ctx.fillStyle = "#2b2b2b";
    ctx.textAlign = "center";
    ctx.font = '500 46px "Playfair Display", Georgia, serif';
    ctx.fillText(watch.brand, x + w / 2, y + h / 2 - 8);
    ctx.fillStyle = "#8a8a8a";
    ctx.font = '500 18px "Inter", Arial, sans-serif';
    ctx.fillText("Photo available on request", x + w / 2, y + h / 2 + 34);
    ctx.textAlign = "left";
  }

  ctx.restore();

  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 1.5;
  roundedRect(ctx, x, y, w, h, 24);
  ctx.stroke();
}

/** Builds a shareable watch card image with photo and every detail baked in. */
export async function createWatchShareCard(watch: Watch): Promise<File | null> {
  if (typeof document === "undefined") return null;

  try {
    await document.fonts.ready;

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Background + frame
    ctx.fillStyle = COLOR.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = COLOR.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(28, 28, WIDTH - 56, HEIGHT - 56);

    // Header
    ctx.fillStyle = COLOR.gold;
    ctx.font = '600 34px "Cinzel", Georgia, serif';
    ctx.fillText(SHOP.name.toUpperCase(), MARGIN, 112);

    ctx.fillStyle = COLOR.muted;
    ctx.font = '500 14px "Inter", Arial, sans-serif';
    trackedText(ctx, "A LEGACY OF TIMELESS TRUST SINCE 1970", MARGIN, 146, 2.4);

    ctx.strokeStyle = COLOR.gold;
    ctx.lineWidth = 1.5;
    roundedRect(ctx, WIDTH - MARGIN - 220, 86, 220, 48, 24);
    ctx.stroke();
    ctx.fillStyle = COLOR.gold;
    ctx.textAlign = "center";
    ctx.font = '600 13px "Inter", Arial, sans-serif';
    trackedText(ctx, "WATCH ENQUIRY", WIDTH - MARGIN - 184, 117, 1.8);
    ctx.textAlign = "left";

    // Watch photo
    let image: HTMLImageElement | null = null;
    if (watch.image) {
      try {
        image = await loadImage(watch.image);
      } catch {
        image = null;
      }
    }
    drawPhotoPanel(ctx, watch, image);

    // Brand
    ctx.fillStyle = COLOR.gold;
    ctx.font = '600 17px "Inter", Arial, sans-serif';
    trackedText(ctx, watch.brand.toUpperCase(), MARGIN, 772, 2.2);

    // Product title
    let cursor = 822;
    ctx.fillStyle = COLOR.cream;
    ctx.font = '500 44px "Playfair Display", Georgia, serif';
    const titleLines = wrapText(ctx, displayName(watch), CONTENT, 2);
    for (const line of titleLines) {
      ctx.fillText(line, MARGIN, cursor);
      cursor += 52;
    }

    // Code / category / function
    ctx.fillStyle = COLOR.muted;
    ctx.font = '400 19px "Inter", Arial, sans-serif';
    const meta = [
      `Code ${watch.model}`,
      watchCategoryLabel(watch),
      watch.fn,
    ]
      .filter(Boolean)
      .join("  ·  ");
    ctx.fillText(meta, MARGIN, cursor + 2);
    cursor += 46;

    // Price + MRP + availability
    const priceY = cursor + 38;
    ctx.fillStyle = COLOR.gold;
    ctx.font = '600 46px "Inter", Arial, sans-serif';
    const priceText = inr(watch.price);
    ctx.fillText(priceText, MARGIN, priceY);
    const priceWidth = ctx.measureText(priceText).width;

    const off = discountPct(watch.price, watch.mrp);
    if (off > 0) {
      const mrpText = inr(watch.mrp);
      const mrpX = MARGIN + priceWidth + 24;
      ctx.fillStyle = COLOR.muted;
      ctx.font = '400 22px "Inter", Arial, sans-serif';
      ctx.fillText(mrpText, mrpX, priceY - 4);
      const mrpWidth = ctx.measureText(mrpText).width;
      ctx.strokeStyle = COLOR.muted;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mrpX, priceY - 12);
      ctx.lineTo(mrpX + mrpWidth, priceY - 12);
      ctx.stroke();

      ctx.fillStyle = COLOR.gold;
      ctx.font = '600 17px "Inter", Arial, sans-serif';
      ctx.fillText(`${off}% off`, mrpX + mrpWidth + 16, priceY - 4);
    }

    ctx.textAlign = "right";
    ctx.fillStyle = watch.qty !== null && watch.qty <= 0 ? COLOR.soldOut : COLOR.stock;
    ctx.font = '600 17px "Inter", Arial, sans-serif';
    ctx.fillText(availabilityLabel(watch).toUpperCase(), WIDTH - MARGIN, priceY - 4);
    ctx.textAlign = "left";

    // Specifications
    const specs = watchSpecEntries(watch).slice(0, 9);
    const specHeaderY = priceY + 56;

    if (specs.length > 0) {
      ctx.strokeStyle = COLOR.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN, specHeaderY - 26);
      ctx.lineTo(WIDTH - MARGIN, specHeaderY - 26);
      ctx.stroke();

      ctx.fillStyle = COLOR.gold;
      ctx.font = '600 13px "Inter", Arial, sans-serif';
      trackedText(ctx, "SPECIFICATIONS", MARGIN, specHeaderY, 2);

      const columns = 3;
      const gap = 20;
      const columnWidth = (CONTENT - gap * (columns - 1)) / columns;
      const rowsTop = specHeaderY + 34;
      const rowHeight = 52;

      specs.forEach(([label, value], index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = MARGIN + column * (columnWidth + gap);
        const y = rowsTop + row * rowHeight;

        ctx.fillStyle = COLOR.muted;
        ctx.font = '500 10px "Inter", Arial, sans-serif';
        trackedText(ctx, label.toUpperCase(), x, y, 0.8);

        ctx.fillStyle = COLOR.cream;
        ctx.font = '400 17px "Inter", Arial, sans-serif';
        ctx.fillText(fitText(ctx, value, columnWidth), x, y + 20);
      });
    } else {
      ctx.fillStyle = COLOR.muted;
      ctx.font = '400 17px "Inter", Arial, sans-serif';
      ctx.fillText("Full specifications available on request.", MARGIN, specHeaderY + 4);
    }

    // Closing ask — only when the card has room for it.
    const usedRows = Math.ceil(specs.length / 3);
    const specsBottom = specs.length
      ? specHeaderY + 34 + usedRows * 52
      : specHeaderY + 10;
    const noteY = Math.max(specsBottom + 30, 1160);
    if (noteY < 1238) {
      ctx.fillStyle = COLOR.gold;
      ctx.font = 'italic 500 24px "Playfair Display", Georgia, serif';
      ctx.fillText("Please confirm availability and the best price.", MARGIN, noteY);
    }

    // Footer
    ctx.strokeStyle = COLOR.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN, 1258);
    ctx.lineTo(WIDTH - MARGIN, 1258);
    ctx.stroke();

    ctx.fillStyle = COLOR.muted;
    ctx.font = '400 15px "Inter", Arial, sans-serif';
    ctx.fillText(`${SHOP.name} · ${SHOP.city}`, MARGIN, 1300);

    ctx.textAlign = "right";
    ctx.fillStyle = COLOR.cream;
    ctx.font = '500 16px "Inter", Arial, sans-serif';
    ctx.fillText(SHOP.phoneDisplay, WIDTH - MARGIN, 1300);
    ctx.textAlign = "left";

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });
    if (!blob) return null;

    const safeModel = (watch.model || watch.id).replace(/[^\w.-]+/g, "-");
    return new File([blob], `arora-watch-${safeModel}.jpg`, { type: "image/jpeg" });
  } catch {
    return null;
  }
}

/** True when this device can share actual image files (mobile share sheets). */
export function canShareImage(file: File | null): file is File {
  if (!file || typeof navigator === "undefined") return false;
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}
