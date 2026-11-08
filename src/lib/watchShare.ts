import type { Watch } from "../data/watches";
import { SHOP } from "../config";
import { discountPct, inr } from "./format";
import { displayName } from "./displayName";

const GENDER_LABEL = { men: "Men's", women: "Women's", unisex: "Unisex" } as const;

export const watchCategoryLabel = (watch: Watch) => GENDER_LABEL[watch.gender];

/** All filled-in specification rows for a watch. */
export function watchSpecEntries(watch: Watch): Array<[string, string]> {
  const specs: Array<[string, string | undefined]> = [
    ["Movement", watch.specs?.movement],
    ["Case size", watch.specs?.caseSize],
    ["Case", watch.specs?.caseColor],
    ["Dial", watch.specs?.dialColor],
    ["Glass", watch.specs?.glass],
    ["Strap", watch.specs?.strap],
    ["Water resistance", watch.specs?.waterResistance],
    ["Warranty", watch.specs?.warranty],
    ["Platform", watch.specs?.platform],
  ];
  return specs.flatMap(([label, value]) => (value ? [[label, value] as [string, string]] : []));
}

/** Absolute URL so the owner can open the product photo from WhatsApp.
 *  Skipped on local/dev hosts where the link would not be reachable. */
export function watchImageUrl(watch: Watch): string | null {
  if (!watch.image) return null;
  if (typeof window === "undefined") return null;
  const { hostname, origin, protocol } = window.location;
  if (protocol !== "http:" && protocol !== "https:") return null;
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".local");
  if (isLocal) return null;
  return new URL(watch.image, origin).href;
}

export function availabilityLabel(watch: Watch): string {
  if (watch.qty === null || watch.qty > 0) {
    return watch.qty !== null && watch.qty <= 3
      ? `Only ${watch.qty} left`
      : "In stock";
  }
  return "Currently sold out";
}

/**
 * Complete WhatsApp enquiry for a single watch — every detail we hold,
 * plus a direct photo link the owner can tap to see the exact piece.
 */
export function watchInquiryMessage(watch: Watch, qty = 1): string {
  const off = discountPct(watch.price, watch.mrp);

  const lines = [
    `Hi ${SHOP.name}! I'd like to ask about this watch from your website:`,
    "",
    `*${displayName(watch)}*`,
    `Brand: ${watch.brand}`,
    `Code: ${watch.model}`,
    `Category: ${watchCategoryLabel(watch)}`,
  ];

  if (watch.fn) lines.push(`Function: ${watch.fn}`);
  lines.push(`Price: ${inr(watch.price)}`);
  if (off > 0) lines.push(`MRP: ${inr(watch.mrp)} (${off}% off)`);
  lines.push(`Availability: ${availabilityLabel(watch)}`);
  if (qty > 1) lines.push(`Quantity: ${qty}`);

  const filled = watchSpecEntries(watch);

  if (filled.length > 0) {
    lines.push("", "*Specifications*");
    for (const [label, value] of filled) lines.push(`• ${label}: ${value}`);
  }

  const photo = watchImageUrl(watch);
  if (photo) lines.push("", `*Watch photo:* ${photo}`);

  lines.push("", "Please confirm availability and the best price. Thank you!");
  return lines.join("\n");
}
