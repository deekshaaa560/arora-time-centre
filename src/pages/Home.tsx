import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import BrandHero from "../components/BrandHero";
import BrandLockup from "../components/BrandLockup";
import Icon from "../components/Icon";
import WatchCard from "../components/WatchCard";
import WatchModal from "../components/WatchModal";
import { BRAND_LOGOS } from "../data/brandLogos";
import { WATCHES, BRANDS, FEATURED, type Watch } from "../data/watches";
import { useReveal } from "../lib/useReveal";
import { useCart } from "../context/CartContext";
import { orderMessage } from "../lib/orderMessage";
import { SHOP, waUrl } from "../config";

function BrandLogo({ brand }: { brand: string }) {
  const [failed, setFailed] = useState(false);
  const src = BRAND_LOGOS[brand];

  if (!src || failed) {
    return (
      <span className="font-display text-base tracking-[0.14em] text-ink uppercase sm:text-lg">
        {brand}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={`${brand} logo`}
      draggable={false}
      onError={() => setFailed(true)}
      className="max-h-8 max-w-full object-contain sm:max-h-10"
    />
  );
}

function BrandMarquee() {
  const row = [...BRANDS, ...BRANDS];
  return (
    <section
      aria-label="Brands we stock"
      className="marquee relative overflow-hidden border-y border-ink-line bg-ink-soft py-6 sm:py-7"
    >
      <div className="marquee-track flex w-max items-center px-3 sm:px-4">
        {row.map((b, i) => (
          <figure
            key={`${b}-${i}`}
            aria-hidden={i >= BRANDS.length || undefined}
            className="group mr-5 flex w-[132px] shrink-0 flex-col items-center gap-2 sm:mr-8 sm:w-40 sm:gap-2.5"
          >
            <span className="flex h-14 w-full items-center justify-center rounded-lg bg-cream px-2.5 shadow-[0_1px_0_rgba(255,255,255,0.08)] transition-transform duration-300 group-hover:-translate-y-0.5 sm:h-16 sm:px-3.5">
              <BrandLogo brand={b} />
            </span>
            <figcaption className="whitespace-nowrap text-[9px] font-semibold tracking-[0.16em] text-cream/45 uppercase transition-colors group-hover:text-cream sm:text-[10px]">
              {b}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

const COLLECTION_CARDS = {
  men: "/collections/men.webp",
  women: "/collections/women.webp",
};

export default function Home() {
  const scope = useRef<HTMLDivElement>(null);
  useReveal(scope);
  const { items, subtotal } = useCart();
  const [selected, setSelected] = useState<Watch | null>(null);

  const featured = FEATURED;

  return (
    <div ref={scope}>
      <BrandHero />
      <BrandMarquee />

      {/* Featured */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4" data-reveal>
          <div>
            <p className="text-xs font-semibold tracking-[0.3em] text-gold uppercase">
              Counter favourites
            </p>
            <h2 className="mt-2 font-display text-3xl text-cream md:text-4xl">
              Bestsellers & new arrivals
            </h2>
          </div>
          <Link
            to="/collection"
            className="text-sm font-semibold text-gold underline-offset-4 hover:underline"
          >
            View all {WATCHES.length} watches →
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {featured.map((w) => (
            <WatchCard key={w.id} watch={w} onOpen={setSelected} />
          ))}
        </div>
      </section>

      {/* Gender split */}
      <section className="mx-auto grid max-w-7xl gap-6 px-4 pb-20 sm:px-6 md:grid-cols-2">
        {(
          [
            { g: "men", title: "Men's Collection", img: COLLECTION_CARDS.men },
            { g: "women", title: "Women's Collection", img: COLLECTION_CARDS.women },
          ] as const
        ).map(({ g, title, img }, i) => (
          <Link
            key={g}
            to={g === "men" ? "/mens" : "/womens"}
            className="group relative block h-[420px] overflow-hidden rounded-3xl border border-ink-line"
            data-reveal
          >
            <img
              src={img}
              alt={title}
              loading="lazy"
              onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0")}
              data-parallax={i === 0 ? 8 : 12}
              className="absolute inset-[-12%] h-[124%] w-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
            <div className="absolute bottom-0 p-8">
              <p className="text-xs font-semibold tracking-[0.3em] text-gold-soft uppercase">
                {WATCHES.filter((w) => w.gender === g).length} styles
              </p>
              <h3 className="mt-1 font-display text-3xl text-white">{title}</h3>
              <span className="mt-4 inline-block rounded-full bg-gold px-5 py-2 text-sm font-semibold text-ink transition-transform group-hover:scale-105">
                Browse →
              </span>
            </div>
          </Link>
        ))}
      </section>

      {/* Why us */}
      <section className="border-y border-ink-line bg-ink-soft">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-20 md:grid-cols-[1fr_320px]">
          <div>
            <h2 className="font-display text-3xl text-cream md:text-4xl" data-reveal>
              Why buy from <span className="text-gold">Arora Time Centre?</span>
            </h2>
            <div className="mt-10 grid gap-8 sm:grid-cols-2">
              {([
                {
                  icon: "shield-check",
                  title: "100% genuine, always",
                  body: `Every watch billed with the brand's official warranty card. ${BRANDS.length} brands under one roof.`,
                },
                {
                  icon: "tag",
                  title: "Honest counter prices",
                  body: "What you see is what you pay. No fake discounts, no checkout surprises.",
                },
                {
                  icon: "phone",
                  title: "Talk to a human",
                  body: (
                    <>
                      No faceless checkout. Send your shortlist on{" "}
                      <a
                        href={waUrl(`Hi ${SHOP.name}! I'd like to confirm a watch from your website.`)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-gold underline-offset-4 hover:underline"
                      >
                        <Icon name="whatsapp" className="h-3.5 w-3.5" />
                        WhatsApp
                      </a>{" "}
                      or call us to lock availability.
                    </>
                  ),
                },
                {
                  icon: "gift",
                  title: "Gifting done right",
                  body: "Free premium gift packing for watch gifting occasions — just mention it on the call.",
                },
              ] as const).map(({ icon, title, body }) => (
                <div key={title} data-reveal>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-ink-line text-gold/80">
                    <Icon name={icon} className="h-5 w-5" />
                  </div>
                  <h3 className="mt-3 font-display text-xl text-cream">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="hidden items-center justify-center md:flex" data-reveal>
            <div className="w-full max-w-[280px]">
              <BrandLockup size={220} variant="stacked" className="mx-auto" />
              <p className="mt-5 text-center text-xs tracking-[0.25em] text-muted uppercase">
                Time, well spent
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="mx-auto max-w-7xl px-6 py-24 text-center">
        <p className="text-xs font-semibold tracking-[0.35em] text-gold uppercase" data-reveal>
          Spot it online · Confirm on call
        </p>
        <h2 className="mx-auto mt-4 max-w-2xl font-display text-4xl leading-tight text-cream md:text-5xl" data-reveal>
          Add your favourites to the cart — we'll keep them ready when you call.
        </h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3" data-reveal>
          <Link
            to="/collection"
            className="rounded-full bg-gold px-8 py-3.5 font-bold text-ink transition-transform hover:scale-105"
          >
            Start Picking
          </Link>
          <a
            href={waUrl(
              items.length > 0
                ? orderMessage(items, subtotal)
                : `Hi ${SHOP.name}! I'd like some help choosing a watch from your website.`,
            )}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-ink-line px-8 py-3.5 font-semibold text-cream hover:bg-white/5"
          >
            <Icon name="whatsapp" className="h-4 w-4" />
            WhatsApp your list
          </a>
        </div>
      </section>

      <WatchModal watch={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
