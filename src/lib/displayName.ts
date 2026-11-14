import type { Watch } from "../data/watches";

const GENDER_LABEL = { men: "Men's", women: "Women's", unisex: "Unisex" } as const;

/**
 * A watch is described by what it does, then by what it looks like. Stock rows
 * that carry no functional word fall back to their dial / movement / strap, so
 * two watches of the same brand never print the same card title.
 */
const MOVEMENT_WORDS: [RegExp, string][] = [
  [/chronograph/i, "Chronograph"],
  [/automatic|mechanical/i, "Automatic"],
  [/solar/i, "Solar"],
  [/ana[- ]?digi/i, "Ana-Digi"],
  [/digital/i, "Digital"],
  [/quartz \(analogue\)|analogue|analog/i, "Analogue"],
  [/quartz/i, "Quartz"],
];

const STRAP_WORDS: [RegExp, string][] = [
  [/mesh/i, "Mesh"],
  [/leather/i, "Leather"],
  [/silico|rubber|silicone/i, "Silicon"],
  [/nato|fabric|nylon|cloth/i, "Fabric"],
  [/steel|metal|bracelet|bangle/i, "Steel"],
];

/** Stock-sheet placeholders that are not a real colour or material. */
const MISSING = /^$|^(null|n\/a|na|none|-|other)$/i;

const firstMatch = (text: string, table: [RegExp, string][]) => {
  for (const [re, word] of table) if (re.test(text)) return word;
  return "";
};

/** "Stainless steel · Gold-tone" -> "Steel"; "Black" -> "Black Dial". */
function descriptor(watch: Watch): string {
  if (watch.fn) return watch.fn;
  const specs = watch.specs || {};
  const parts: string[] = [];
  const dial = (specs.dialColor || "").trim();
  if (!MISSING.test(dial)) parts.push(`${dial} Dial`);
  const movement = MISSING.test((specs.movement || "").trim()) ? "" : firstMatch(specs.movement || "", MOVEMENT_WORDS);
  if (movement) parts.push(movement);
  if (!parts.length) {
    const strap = (specs.strap || "").trim();
    if (!MISSING.test(strap)) {
      const word = firstMatch(strap, STRAP_WORDS);
      if (word) parts.push(`${word} Strap`);
    }
  }
  return parts.slice(0, 2).join(" ");
}

/** A bare movement word describes half the shop, so it is not enough to tell
 *  two cards apart on its own. */
const GENERIC = /^(quartz|analogue|analog|automatic|solar|digital|ana-digi|multi|multifunction|chrono|chronograph|steel strap)$/i;

/**
 * Product name without the brand, e.g. "Men's Chronograph Watch".
 * Stock codes stay off the site — they only travel in WhatsApp messages
 * (see orderMessage / watchInquiryMessage) — so a generic word like
 * "Analogue" is qualified with the dial colour instead of the code to keep
 * two watches of the same brand from printing the same card title.
 */
export function shortName(watch: Watch): string {
  const who = GENDER_LABEL[watch.gender];
  let what = descriptor(watch);
  const dial = (watch.specs?.dialColor || "").trim();
  if ((!what || GENERIC.test(what)) && dial && !MISSING.test(dial) &&
      !what.toLowerCase().includes(dial.toLowerCase())) {
    what = (what ? `${dial} Dial ${what}` : `${dial} Dial`).trim();
  }
  return `${who} ${what} Watch`.replace(/\s+/g, " ").trim();
}

/** Customer-facing product name, e.g. "Timex Women's Chronograph Watch". */
export function displayName(watch: Watch): string {
  return `${watch.brand} ${shortName(watch)}`.replace(/\s+/g, " ").trim();
}
