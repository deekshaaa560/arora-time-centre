import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { shortName } from "../lib/displayName";
import { useCart } from "../context/CartContext";
import { orderMessage } from "../lib/orderMessage";
import { sendToGoogleForm } from "../lib/checkoutForm";
import { inr } from "../lib/format";
import { SHOP, waUrl } from "../config";
import BrandMark from "./BrandMark";
import ProductImage from "./ProductImage";
import Icon from "./Icon";

type Step = "cart" | "details";

type Fields = {
  fullName: string;
  age: string;
  whatsapp: string;
  email: string;
  feedback: string;
};

const EMPTY: Fields = { fullName: "", age: "", whatsapp: "", email: "", feedback: "" };
const REMEMBER_KEY = "arora-checkout-details";

/** Returning shoppers don't retype — everything but the feedback persists */
function rememberedFields(): Fields {
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBER_KEY) || "null");
    if (saved && typeof saved.fullName === "string")
      return { ...EMPTY, ...saved, feedback: "" };
  } catch {
    /* corrupted storage — start clean */
  }
  return EMPTY;
}

const inputCls =
  "w-full rounded-xl border border-ink-line bg-ink-card px-4 py-3 text-sm text-cream placeholder:text-muted outline-none transition-colors focus:border-gold/70";
const labelCls =
  "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-gold";

function validate(f: Fields): Partial<Record<keyof Fields, string>> {
  const e: Partial<Record<keyof Fields, string>> = {};
  if (f.fullName.trim().length < 2) e.fullName = "Please tell us your name";
  const age = Number(f.age);
  if (!/^\d{1,3}$/.test(f.age.trim()) || age < 12 || age > 100) e.age = "Enter a valid age";
  const digits = f.whatsapp.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13)
    e.whatsapp = "Enter a valid WhatsApp number";
  if (!f.email.trim()) e.email = "We need your email to save the form";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim()))
    e.email = "That email doesn't look right";
  return e;
}

export default function CartDrawer() {
  const {
    items,
    subtotal,
    savings,
    setQty,
    remove,
    clear,
    drawerOpen,
    setDrawerOpen,
  } = useCart();
  const [step, setStep] = useState<Step>("cart");
  const [fields, setFields] = useState<Fields>(rememberedFields);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setDrawerOpen]);

  const set = (key: keyof Fields) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const beginCheckout = () => {
    setFields(rememberedFields());
    setErrors({});
    setStep("details");
  };

  /**
   * Final step: quietly post the details to the store's Google Form, then
   * hand the shopper over to WhatsApp with the cart as a pre-written message.
   */
  const finishCheckout = (e: FormEvent) => {
    e.preventDefault();
    const errs = validate(fields);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const customer = {
      name: fields.fullName.trim(),
      whatsapp: fields.whatsapp.trim(),
      email: fields.email.trim() || undefined,
    };
    try {
      const { feedback: _feedback, ...remember } = fields;
      localStorage.setItem(REMEMBER_KEY, JSON.stringify(remember));
    } catch {
      /* private mode — no remembering, no problem */
    }

    void sendToGoogleForm({ ...fields, feedback: fields.feedback.trim() });
    window.open(waUrl(orderMessage(items, subtotal, customer)), "_blank", "noopener");
    setDrawerOpen(false);
    setStep("cart");
  };

  return (
    <>
      {/* scrim */}
      <div
        aria-hidden={!drawerOpen}
        onClick={() => setDrawerOpen(false)}
        className={`fixed inset-0 z-70 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* panel */}
      <aside
        aria-label="Shopping cart"
        className={`fixed top-0 right-0 z-80 flex h-dvh w-full max-w-md flex-col border-l border-ink-line bg-ink-soft transition-transform duration-300 ease-out ${
          drawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-ink-line px-5 py-4">
          <div className="flex items-center gap-3">
            <BrandMark size={34} bold />
            {step === "cart" ? (
              <h2 className="font-display text-xl text-cream">
                Your Cart{" "}
                <span className="text-sm text-muted">
                  ({items.length} {items.length === 1 ? "item" : "items"})
                </span>
              </h2>
            ) : (
              <h2 className="font-display text-xl text-cream">Your Details</h2>
            )}
          </div>
          <button
            aria-label="Close cart"
            onClick={() => setDrawerOpen(false)}
            className="rounded-full border border-ink-line p-2 text-cream hover:border-gold/50 hover:text-gold"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {step === "details" ? (
          /* ── checkout details — fills the store's form, stays on-brand ── */
          <form onSubmit={finishCheckout} className="flex flex-1 flex-col overflow-y-auto">
            <div className="flex items-center gap-2 px-5 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em]">
              <button
                type="button"
                onClick={() => setStep("cart")}
                className="text-muted underline underline-offset-2 hover:text-cream"
              >
                ← Cart
              </button>
              <span className="text-gold">2 · Your details</span>
              <span className="text-muted">3 · WhatsApp</span>
            </div>
            <div className="px-5 pt-3">
              <p className="text-sm leading-relaxed text-muted">
                Two quick things before we open WhatsApp — it helps us keep your
                shortlist ready at the counter when your message arrives.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label htmlFor="co-name" className={labelCls}>
                  Full Name<span className="text-gold"> *</span>
                </label>
                <input
                  id="co-name"
                  className={inputCls}
                  placeholder="Your name"
                  value={fields.fullName}
                  onChange={set("fullName")}
                  autoComplete="name"
                />
                {errors.fullName && (
                  <p role="alert" className="mt-1 text-[11px] text-red-400">{errors.fullName}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="co-age" className={labelCls}>
                    Age<span className="text-gold"> *</span>
                  </label>
                  <input
                    id="co-age"
                    className={inputCls}
                    placeholder="e.g. 27"
                    inputMode="numeric"
                    value={fields.age}
                    onChange={set("age")}
                  />
                  {errors.age && (
                    <p role="alert" className="mt-1 text-[11px] text-red-400">{errors.age}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="co-email" className={labelCls}>
                    Email<span className="text-gold"> *</span>
                  </label>
                  <input
                    id="co-email"
                    className={inputCls}
                    placeholder="you@example.com"
                    type="email"
                    value={fields.email}
                    onChange={set("email")}
                    autoComplete="email"
                  />
                  {errors.email && (
                    <p role="alert" className="mt-1 text-[11px] text-red-400">{errors.email}</p>
                  )}
                </div>
              </div>
              <div>
                <label htmlFor="co-wa" className={labelCls}>
                  Whatsapp Number<span className="text-gold"> *</span>
                </label>
                <input
                  id="co-wa"
                  className={inputCls}
                  placeholder="10-digit mobile number"
                  inputMode="tel"
                  value={fields.whatsapp}
                  onChange={set("whatsapp")}
                  autoComplete="tel"
                />
                {errors.whatsapp && (
                  <p role="alert" className="mt-1 text-[11px] text-red-400">{errors.whatsapp}</p>
                )}
              </div>
              <div>
                <label htmlFor="co-feedback" className={labelCls}>
                  How are you finding this website?
                </label>
                <textarea
                  id="co-feedback"
                  className={`${inputCls} min-h-20 resize-none`}
                  placeholder="Loving it? Found everything? Tell us in a line — optional"
                  value={fields.feedback}
                  onChange={set("feedback")}
                />
              </div>
            </div>
            <div className="mt-auto border-t border-ink-line px-5 py-4">
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-full bg-gold py-3.5 font-bold text-ink transition-transform hover:scale-[1.02] active:scale-95"
              >
                <Icon name="whatsapp" className="h-4 w-4" />
                Continue to WhatsApp →
              </button>
              <p className="mt-2 text-center text-[11px] text-muted">
                Your details go straight to the store. No payment — just press
                send once WhatsApp opens.
              </p>
            </div>
          </form>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="text-5xl">⌚</div>
            <p className="text-muted">
              Your cart is empty. Browse the collection and add your favourites —
              no payment needed, just a WhatsApp message and a call.
            </p>
            <button
              onClick={() => setDrawerOpen(false)}
              className="rounded-full bg-gold px-6 py-2.5 font-semibold text-ink"
            >
              Browse Watches
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {items.map(({ watch, qty }) => (
                <div
                  key={watch.id}
                  className="flex gap-4 rounded-2xl border border-ink-line bg-ink-card p-3"
                >
                  <ProductImage
                    watch={watch}
                    className="h-20 w-20 shrink-0 rounded-xl bg-white object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold tracking-[0.18em] text-gold uppercase">
                      {watch.brand}
                    </p>
                    <p className="truncate text-sm font-medium text-cream">
                      {shortName(watch)}
                    </p>
                    <p className="mt-0.5 text-sm text-gold-soft">
                      {inr(watch.price * qty)}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center rounded-full border border-ink-line text-sm">
                        <button
                          aria-label="Decrease quantity"
                          className="px-3 py-1 text-cream hover:text-gold"
                          onClick={() => setQty(watch.id, qty - 1)}
                        >
                          −
                        </button>
                        <span className="w-7 text-center">{qty}</span>
                        <button
                          aria-label="Increase quantity"
                          className="px-3 py-1 text-cream hover:text-gold"
                          onClick={() => setQty(watch.id, qty + 1)}
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="text-xs text-muted underline underline-offset-2 hover:text-muted"
                        onClick={() => remove(watch.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={clear}
                className="text-xs text-muted underline underline-offset-2 hover:text-cream"
              >
                Clear cart
              </button>
            </div>

            <div className="border-t border-ink-line px-5 py-4">
              <div className="flex justify-between text-sm text-muted">
                <span>Estimated total</span>
                <span className="text-lg font-bold text-cream">{inr(subtotal)}</span>
              </div>
              {savings > 0 && (
                <p className="mt-1 text-right text-xs text-cream">
                  You save {inr(savings)} off MRP
                </p>
              )}
              <button
                onClick={beginCheckout}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-gold py-3.5 font-bold text-ink transition-transform hover:scale-[1.02] active:scale-95"
              >
                <Icon name="whatsapp" className="h-4 w-4" />
                Checkout on WhatsApp →
              </button>
              <p className="mt-2 text-center text-[11px] text-muted">
                No online payment — just a quick form and your cart opens as a
                WhatsApp message. Or call{" "}
                <a
                  href={`tel:${SHOP.tel}`}
                  className="text-cream underline-offset-2 hover:text-gold hover:underline"
                >
                  {SHOP.phoneDisplay}
                </a>
                .
              </p>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
