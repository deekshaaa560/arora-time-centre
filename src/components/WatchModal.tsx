import { useEffect, useState, type MouseEvent } from "react";
import type { Watch } from "../data/watches";
import { inr, discountPct } from "../lib/format";
import { useCart } from "../context/CartContext";
import { waUrl } from "../config";
import { displayName } from "../lib/displayName";
import { watchInquiryMessage } from "../lib/watchShare";
import { canShareImage, createWatchShareCard } from "../lib/watchShareCard";
import Icon from "./Icon";
import WatchZoom from "./WatchZoom";

const BRAND_SITES: Record<string, string> = {
  Titan: "titan.co.in",
  Fastrack: "fastrack.in",
  Timex: "timex.com",
  Fossil: "fossil.com",
  "Michael Kors": "michaelkors.com",
  "Armani Exchange": "armaniexchange.com",
  "Emporio Armani": "armani.com",
};

/** Search the brand's own site for this exact model code */
const officialLink = (watch: Watch) => {
  const domain = BRAND_SITES[watch.brand];
  const q = domain ? `site:${domain} ${watch.model}` : `${watch.brand} ${watch.model} watch`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
};

export default function WatchModal({
  watch,
  onClose,
}: {
  watch: Watch | null;
  onClose: () => void;
}) {
  const { add, setDrawerOpen } = useCart();
  const [qty, setQty] = useState(1);
  const [shareCard, setShareCard] = useState<File | null>(null);

  useEffect(() => setQty(1), [watch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Prepare the shareable watch card while the customer is viewing details.
  useEffect(() => {
    setShareCard(null);
    if (!watch) return;
    let cancelled = false;
    createWatchShareCard(watch).then((file) => {
      if (!cancelled) setShareCard(file);
    });
    return () => {
      cancelled = true;
    };
  }, [watch]);

  if (!watch) return null;
  const off = discountPct(watch.price, watch.mrp);

  const askWa = waUrl(watchInquiryMessage(watch, qty));

  const shareOnWhatsApp = async (event: MouseEvent<HTMLAnchorElement>) => {
    const file = shareCard;
    if (!canShareImage(file)) return;

    event.preventDefault();
    try {
      await navigator.share({
        files: [file],
        title: displayName(watch),
        text: watchInquiryMessage(watch, qty),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      window.location.href = askWa;
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close watch details"
          className="absolute top-3 right-3 z-30 rounded-full border border-white/20 bg-ink/85 p-2 text-cream shadow-lg backdrop-blur transition-colors hover:border-gold hover:text-gold"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="max-h-[90vh] overflow-y-auto rounded-3xl border border-ink-line bg-ink-card">
          <WatchZoom watch={watch} />

          <div className="mx-auto flex w-full max-w-3xl flex-col p-6 md:p-8">
          <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">
            {watch.brand} ·{" "}
            {watch.gender === "men" ? "Men's" : watch.gender === "women" ? "Women's" : "Unisex"}
            {watch.fn ? ` · ${watch.fn}` : ""}
          </p>
          <h2 className="mt-2 font-display text-3xl text-cream">{displayName(watch)}</h2>

          <div className="mt-4 flex items-end gap-3">
            <span className="text-3xl font-bold text-gold-soft">
              {inr(watch.price)}
            </span>
            {off > 0 && (
              <>
                <span className="pb-1 text-muted line-through">{inr(watch.mrp)}</span>
                <span className="pb-1 text-sm font-semibold text-cream">
                  {off}% off
                </span>
              </>
            )}
          </div>

          <p className="mt-2 text-sm text-muted">
            {watch.qty === null || watch.qty > 0 ? (
              <span className="text-cream">
                ● In stock
                {watch.qty !== null && watch.qty <= 3 ? ` — only ${watch.qty} left` : ""}
              </span>
            ) : (
              <span className="text-muted">● Currently sold out</span>
            )}
            <span className="ml-2">· Code {watch.model}</span>
          </p>

          <p className="mt-4 text-sm leading-relaxed text-muted">
            100% genuine with brand warranty and bill. Not sure about sizing or
            stock? Add it to your cart and check out on WhatsApp — or message us
            directly to confirm availability instantly.
          </p>

          {watch.specs && Object.keys(watch.specs).length > 0 && (
            <div className="mt-5 rounded-2xl border border-ink-line bg-ink-soft p-4">
              <p className="text-[10px] font-semibold tracking-[0.2em] text-gold uppercase">
                Specifications
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {(
                  [
                    ["Movement", watch.specs.movement],
                    ["Case size", watch.specs.caseSize],
                    ["Case", watch.specs.caseColor],
                    ["Dial", watch.specs.dialColor],
                    ["Glass", watch.specs.glass],
                    ["Strap", watch.specs.strap],
                    ["Water resistance", watch.specs.waterResistance],
                    ["Warranty", watch.specs.warranty],
                  ] as const
                )
                  .filter(([, v]) => Boolean(v))
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-[11px] text-muted uppercase tracking-wide">{k}</dt>
                      <dd className="text-cream">{v}</dd>
                    </div>
                  ))}
              </dl>
              <p className="mt-3 text-[10px] text-muted">
                Compiled from public product listings — confirm exact specs on call.
              </p>
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <div className="flex items-center rounded-full border border-ink-line">
              <button
                aria-label="Decrease quantity"
                className="px-4 py-2 text-lg text-cream hover:text-gold"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
              >
                −
              </button>
              <span className="w-8 text-center font-semibold">{qty}</span>
              <button
                aria-label="Increase quantity"
                className="px-4 py-2 text-lg text-cream hover:text-gold"
                onClick={() => setQty((q) => Math.min(10, q + 1))}
              >
                +
              </button>
            </div>
            <button
              className="flex-1 rounded-full bg-gold px-6 py-3 font-semibold text-ink transition-transform hover:scale-[1.02] active:scale-95"
              onClick={() => {
                add(watch.id, qty);
                onClose();
                setDrawerOpen(true);
              }}
            >
              Add to Cart
            </button>
          </div>

          <a
            href={askWa}
            target="_blank"
            rel="noreferrer"
            onClick={shareOnWhatsApp}
            className="mt-3 flex items-center justify-center gap-2 rounded-full border border-ink-line px-6 py-3 text-center text-sm font-semibold text-cream transition-colors hover:bg-white/5"
          >
            <Icon name="whatsapp" className="h-4 w-4" />
            Send watch photo + details on WhatsApp
          </a>
          <p className="mt-2 text-center text-[11px] text-muted">
            The exact watch photo and its full details go with your message.
          </p>

          <a
            href={officialLink(watch)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 text-center text-xs text-muted underline underline-offset-2 hover:text-cream"
          >
            Look up the official page &amp; full specifications ↗
          </a>

          <button
            onClick={onClose}
            className="mt-4 text-sm text-muted underline-offset-4 hover:text-cream hover:underline"
          >
            Continue browsing
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
