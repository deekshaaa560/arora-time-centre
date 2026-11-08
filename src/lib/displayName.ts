import type { Watch } from "../data/watches";

const GENDER_LABEL = { men: "Men's", women: "Women's", unisex: "Unisex" } as const;

/**
 * Customer-facing product name (no stock-sheet serial codes).
 * e.g. "Timex Women's Quartz Watch".
 */
export function displayName(watch: Watch): string {
  const fn = watch.fn ? `${watch.fn} ` : "";
  return `${watch.brand} ${GENDER_LABEL[watch.gender]} ${fn}Watch`;
}
