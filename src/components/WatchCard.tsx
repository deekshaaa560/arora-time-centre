import { useRef, useState, type MouseEvent } from "react";
import type { Watch } from "../data/watches";
import { inr, discountPct } from "../lib/format";
import { displayName } from "../lib/displayName";
import { shareWatch } from "../lib/watchShare";
import { useCart } from "../context/CartContext";
import ProductImage from "./ProductImage";

const tagStyle: Record<string, string> = {
  Bestseller: "bg-cream text-ink",
  New: "bg-cream text-ink",
  Limited: "bg-cream/70 text-ink",
};

export default function WatchCard({
  watch,
  onOpen,
}: {
  watch: Watch;
  onOpen: (w: Watch) => void;
}) {
  const { add, setDrawerOpen } = useCart();
  const zoomRef = useRef<HTMLDivElement>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const off = discountPct(watch.price, watch.mrp);

  const onShare = async (e: MouseEvent) => {
    e.stopPropagation();
    const result = await shareWatch(watch);
    if (result !== "shared") {
      setLinkCopied(result === "copied");
      window.setTimeout(() => setLinkCopied(false), 1800);
    }
  };

  const stockLabel =
    watch.qty === null
      ? "In stock"
      : watch.qty <= 0
        ? "Sold out"
        : watch.qty <= 3
          ? `Only ${watch.qty} left`
          : "In stock";

  return (
    <article
      data-reveal
      className="group cursor-pointer overflow-hidden rounded-2xl border border-ink-line bg-ink-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/50"
      onClick={() => onOpen(watch)}
    >
      <div
        className="relative aspect-square overflow-hidden bg-white"
        onMouseMove={(e) => {
          const el = zoomRef.current;
          if (!el) return;
          const r = e.currentTarget.getBoundingClientRect();
          el.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
        }}
        onMouseLeave={() => {
          if (zoomRef.current) zoomRef.current.style.transformOrigin = "50% 50%";
        }}
      >
        <div
          ref={zoomRef}
          className="relative z-10 h-full w-full transition-transform duration-300 ease-out will-change-transform group-hover:scale-[1.35]"
        >
          <ProductImage watch={watch} className="h-full w-full object-cover" />
        </div>

        {watch.tag && (
          <span
            className={`absolute top-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${tagStyle[watch.tag]}`}
          >
            {watch.tag}
          </span>
        )}
        {off > 0 && (
          <span className="absolute top-3 right-3 rounded-full bg-black/80 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
            {off}% OFF
          </span>
        )}
        <span
          className={`absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur ${
            watch.qty === null || watch.qty > 0
              ? "bg-black/80 text-white"
              : "bg-black/80 text-white/60"
          }`}
        >
          {stockLabel}
        </span>
        <button
          aria-label={`Share ${displayName(watch)}`}
          title={linkCopied ? "Link copied!" : "Copy link to this watch"}
          onClick={onShare}
          className={`absolute bottom-3 right-3 z-20 flex items-center gap-1.5 rounded-full px-2.5 py-2 backdrop-blur transition-colors ${
            linkCopied ? "bg-gold text-ink" : "bg-black/80 text-white hover:text-gold"
          }`}
        >
          {linkCopied ? (
            <>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-[11px] font-bold tracking-wide">COPIED</span>
            </>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          )}
        </button>
      </div>

      <div className="p-4">
        <button
          aria-label={`Add ${displayName(watch)} to cart`}
          onClick={(e) => {
            e.stopPropagation();
            add(watch.id);
            setDrawerOpen(true);
          }}
          className="w-full rounded-full border border-ink-line py-2.5 text-xs font-semibold tracking-[0.15em] text-cream uppercase transition-colors hover:border-gold hover:bg-gold hover:text-ink"
        >
          Add to Cart
        </button>

        <p className="mt-4 text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">
          {watch.brand}
        </p>
        <h3 className="mt-1 line-clamp-2 min-h-[2.6rem] font-display text-lg leading-snug text-cream">
          {displayName(watch)}
        </h3>
        <div className="mt-2 flex items-end gap-2">
          <span className="text-lg font-bold text-cream">{inr(watch.price)}</span>
          {off > 0 && (
            <span className="pb-0.5 text-sm text-muted line-through">
              {inr(watch.mrp)}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
