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

export const waUrl = (message: string) =>
  `https://wa.me/${SHOP.whatsapp}?text=${encodeURIComponent(message)}`;
