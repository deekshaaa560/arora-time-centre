const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** ₹1,25,000 style Indian currency formatting */
export const inr = (value: number) => inrFormatter.format(value);

export const discountPct = (price: number, mrp: number) =>
  Math.max(0, Math.round(((mrp - price) / mrp) * 100));
