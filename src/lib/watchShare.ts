import type { Watch } from "../data/watches";
import { watchLink } from "../data/watches";
import { SHOP, SITE } from "../config";
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

const isLocalHost = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "0.0.0.0" ||
  hostname === "::1" ||
  hostname.endsWith(".local") ||
  /^\d+\.\d+\.\d+\.\d+$/.test(hostname);

/**
 * Origin every shareable link is built from: the canonical bare domain in
 * production (a `www.` visitor still shares `aroratimecentre.in/…`), but the
 * address actually used on dev machines and preview deploys, where the live
 * domain would not resolve for the person being sent the link.
 */
export function siteOrigin(): string {
  if (typeof window === "undefined") return SITE.url;
  const { hostname, origin } = window.location;
  const host = hostname.toLowerCase();
  if (host === SITE.host || host === `www.${SITE.host}`) return SITE.url;
  return origin;
}

/** Absolute URL so the owner can open the product photo from WhatsApp.
 *  Skipped on local/dev hosts where the link would not be reachable. */
export function watchImageUrl(watch: Watch): string | null {
  if (!watch.image) return null;
  if (typeof window === "undefined") return null;
  const { hostname, protocol } = window.location;
  if (protocol !== "http:" && protocol !== "https:") return null;
  if (isLocalHost(hostname)) return null;
  return new URL(watch.image, siteOrigin()).href;
}

/**
 * Absolute, shareable URL for one watch, e.g.
 * https://aroratimecentre.in/collection?brand=titan&code=nl1184jm01 — opening
 * it filters the collection to that brand and pops the watch's details open.
 */
export function watchUrl(watch: Watch): string {
  const path = watchLink(watch);
  if (typeof window === "undefined") return path;
  return `${siteOrigin()}${path}`;
}

/** Copy the watch's direct link to the clipboard (with a legacy fallback). */
export async function copyWatchLink(watch: Watch): Promise<boolean> {
  const url = watchUrl(watch);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    /* fall through to the textarea method */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Native share sheet on phones; copies the link on desktops. */
export async function shareWatch(watch: Watch): Promise<"shared" | "copied" | "failed"> {
  const url = watchUrl(watch);
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({
        title: displayName(watch),
        text: `${watch.brand} ${watch.model} — ${SHOP.name}`,
        url,
      });
    } catch (error) {
      // user dismissed the sheet — still count as handled
      if (!(error instanceof DOMException) || error.name !== "AbortError") {
        return (await copyWatchLink(watch)) ? "copied" : "failed";
      }
    }
    return "shared";
  }
  return (await copyWatchLink(watch)) ? "copied" : "failed";
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
