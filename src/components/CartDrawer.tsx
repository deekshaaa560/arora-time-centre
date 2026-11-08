import { useEffect } from "react";
import { useCart } from "../context/CartContext";
import { orderMessage } from "../lib/orderMessage";
import { inr } from "../lib/format";
import { SHOP, waUrl } from "../config";
import BrandMark from "./BrandMark";
import ProductImage from "./ProductImage";
import Icon from "./Icon";

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setDrawerOpen]);

  const checkout = () => {
    window.open(waUrl(orderMessage(items, subtotal)), "_blank", "noopener");
    setDrawerOpen(false);
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
            <h2 className="font-display text-xl text-cream">
              Your Cart{" "}
              <span className="text-sm text-muted">
                ({items.length} {items.length === 1 ? "item" : "items"})
              </span>
            </h2>
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

        {items.length === 0 ? (
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
                      {watch.model}
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
                onClick={checkout}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-gold py-3.5 font-bold text-ink transition-transform hover:scale-[1.02] active:scale-95"
              >
                <Icon name="whatsapp" className="h-4 w-4" />
                Checkout on WhatsApp →
              </button>
              <p className="mt-2 text-center text-[11px] text-muted">
                No online payment — your cart is pre-written into a WhatsApp
                message, just press send. Or call{" "}
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
