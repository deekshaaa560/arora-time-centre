import type { CartLine } from "../context/CartContext";
import { SHOP } from "../config";
import { inr } from "./format";
import { displayName } from "./displayName";

/** Optional shopper details collected at checkout, appended to the order */
export type CheckoutCustomer = {
  name: string;
  whatsapp: string;
  email?: string;
};

/** Pre-written WhatsApp/checkout message describing the order */
export function orderMessage(
  items: CartLine[],
  subtotal: number,
  customer?: CheckoutCustomer
): string {
  if (items.length === 0) return `Hi ${SHOP.name}, I'd like to know about watch availability.`;

  const lines = items.map(({ watch, qty }) => {
    const details = [
      `• ${displayName(watch)} — Code ${watch.model}`,
      `  Qty ${qty} · Your price ${inr(watch.price)} each · MRP ${inr(watch.mrp)}`,
      `  Subtotal ${inr(watch.price * qty)}`,
    ];
    return details.join("\n");
  });

  const aboutMe = customer
    ? [
        "",
        `About me: ${customer.name}` +
          (customer.email ? ` · ${customer.email}` : "") +
          ` · WhatsApp ${customer.whatsapp}`,
      ]
    : [];

  return [
    `Hi ${SHOP.name}! Here's my shortlist from your website:`,
    "",
    ...lines,
    "",
    `Order total: ${inr(subtotal)}`,
    "Is this available? What's the best price?",
    ...aboutMe,
  ].join("\n");
}
