import catalogJson from "./catalog-final.json";

// 2026 stock import: official FIPL images, official Guess images and a curated
// Myntra Tommy Hilfiger range. Gender/category tags are sourced from the
// distributor sheets and verified against the brand listings.
import officialGendersJson from "./officialGenders.json";

export type Gender = "men" | "women" | "unisex";

export interface WatchSpecs {
  caseSize?: string;
  movement?: string;
  glass?: string;
  strap?: string;
  waterResistance?: string;
  warranty?: string;
  /** Additional listing details from the distributor sheet */
  caseColor?: string;
  dialColor?: string;
  platform?: string;
}

export interface Watch {
  id: string;
  brand: string;
  /** Product code from the stock sheet, e.g. "3273NL04" */
  model: string;
  gender: Gender;
  /** Selling price (MRP less sheet discount) */
  price: number;
  /** MRP / UCP from the stock sheet */
  mrp: number;
  discount: number;
  /** Units in stock — null means in stock, count not tracked */
  qty: number | null;
  /** Movement / function, e.g. "Quartz", "Chrono" (Timex sheet) */
  fn: string | null;
  image: string | null;
  /** Publicly listed specifications (top products only) */
  specs?: WatchSpecs;
  tag?: "Bestseller" | "New" | "Limited";
}

interface RawWatch {
  id: string;
  brand: string;
  model: string;
  gender: "men" | "women" | "unisex";
  price: number;
  mrp: number;
  discount: number;
  qty: number | null;
  fn: string | null;
  image: string | null;
}

/** Official gender labels verified against brand catalogues and retailer
 *  listings. Stock-sheet model suffixes (L/M, QL/QM, etc.) do not reliably
 *  encode gender, so this map overrides the inferred value. */
const OFFICIAL_GENDERS = officialGendersJson as unknown as Record<string, Gender>;

/** Live in-store stock imported from the distributor stock sheets
 *  (Fastrack & Titan CFA sheets + Timex BDB sheet, Oct 2026). */
export const WATCHES: Watch[] = (catalogJson as RawWatch[]).map((w) => ({
  ...w,
  gender: OFFICIAL_GENDERS[w.id] ?? w.gender,
}));

/**
 * Marketing list of brands the shop carries in-store (20 brands).
 * Used by the footer, About page and the home marquee.
 */
export const BRANDS = [
  "Fastrack",
  "Titan",
  "Timex",
  "Armani Exchange",
  "Fossil",
  "Guess",
  "Citizen",
  "Casio",
  "G-Shock",
  "Michael Kors",
  "Diesel",
  "DKNY",
  "Kenneth Cole",
  "Giordano",
  "Thomas Earnshaw",
  "Emporio Armani",
  "Alexandre Christie",
  "Alba",
  "Maxima",
  "Sonata",
  "Tommy Hilfiger",
] as const;

/** Brands actually present in the imported live stock */
export const CATALOG_BRANDS = Array.from(new Set(WATCHES.map((w) => w.brand))).sort();

export const watchById = new Map(WATCHES.map((w) => [w.id, w]));

/** Eight hero picks for the homepage — priciest in-stock pieces per brand */
export const FEATURED: Watch[] = (() => {
  const pick = (brand: string, gender: Gender, n: number) =>
    WATCHES.filter(
      (w) =>
        w.brand === brand &&
        w.gender === gender &&
        w.image &&
        (w.qty === null || w.qty > 0),
    )
      .sort((a, b) => b.price - a.price)
      .slice(0, n);
  const top = (brand: string, n: number) =>
    WATCHES.filter((w) => w.brand === brand && w.image && (w.qty === null || w.qty > 0))
      .sort((a, b) => b.price - a.price)
      .slice(0, n);
  return [
    ...pick("Titan", "men", 1),
    ...pick("Titan", "women", 1),
    ...pick("Fastrack", "men", 1),
    ...pick("Fastrack", "women", 1),
    ...pick("Timex", "men", 1),
    ...pick("Timex", "women", 1),
    ...top("Fossil", 1),
    ...top("Michael Kors", 1),
    ...pick("Guess", "men", 1),
    ...pick("Guess", "women", 1),
    ...pick("Tommy Hilfiger", "men", 1),
    ...pick("Tommy Hilfiger", "women", 1),
  ];
})();
