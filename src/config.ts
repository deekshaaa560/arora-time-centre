/**
 * ─────────────────────────────────────────────────────────────
 *  STORE CONFIG — edit this file to update shop details.
 * ─────────────────────────────────────────────────────────────
 */
export const SHOP = {
  name: "Arora Time Centre",
  tagline: "Every brand on your wrist.",
  /** Shown on screen */
  phoneDisplay: "+91 98114 07363",
  /** tel: link */
  tel: "+919811407363",
  /** wa.me link (country code + number, digits only) */
  whatsapp: "919811407363",
  hours: "Tue – Sun · 11:00 AM – 9:00 PM",
  closed: "Monday closed",
  city: "West Patel Nagar, New Delhi",
  address:
    "X-65, Near Kalinga Chauk, Suraj Parkash Marg, West Patel Nagar, New Delhi – 110008",
  /** Exact shop coordinates — used for the map pin and directions */
  lat: 28.6496389,
  lng: 77.1642328,
} as const;

/**
 * Canonical web address. Share links and photo links are always built on this
 * host, so somebody browsing `www.` still hands out a bare-domain link.
 * The host configs (`public/.htaccess`, `netlify.toml`, `vercel.json`) 301
 * `www.` here and route every path back to `index.html` so a shared
 * `/collection?brand=…&code=…` link resolves for a cold visitor.
 */
export const SITE = {
  host: "aroratimecentre.in",
  url: "https://aroratimecentre.in",
} as const;

export const waUrl = (message: string) =>
  `https://wa.me/${SHOP.whatsapp}?text=${encodeURIComponent(message)}`;

/**
 * Checkout Google Form — filled on-site (never shown as Google), responses
 * land in the form's sheet. Field keys are the form's entry.* ids; if you
 * rebuild the form, open it in a browser and grab fresh ids.
 * https://forms.gle/cu4zf31eFuwsfRvTA
 */
export const CHECKOUT_FORM = {
  url: "https://docs.google.com/forms/d/e/1FAIpQLSeDCtxFcQPS6ymtXG2Fnea5HE-WVIb6lwLsSXXRFk7m62haiw/formResponse",
  fields: {
    fullName: "entry.370479731",
    age: "entry.962868985",
    whatsapp: "entry.1791256213",
    feedback: "entry.2140993054",
  },
} as const;
