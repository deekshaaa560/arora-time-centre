import { useRef } from "react";
import { Link } from "react-router-dom";
import { BRANDS } from "../data/watches";
import { useReveal } from "../lib/useReveal";
import { SHOP, waUrl } from "../config";
import Icon from "../components/Icon";
import BrandLockup from "../components/BrandLockup";

const MILESTONES = [
  {
    year: "1970",
    title: "A dream begins",
    body: "Shri Krishan Lal Gaba opens Arora Time Centre with a vision built on a love for watches, quality and customer trust.",
  },
  {
    year: "Today",
    title: "The legacy continues",
    body: "Mr. Pankaj Gaba carries the store into its next chapter — new horizons, the same timeless values.",
  },
] as const;

const STATS = [
  ["Since 1970", "a family legacy of timeless trust"],
  [`${BRANDS.length} brands`, "under one roof, for every occasion"],
  ["100%", "genuine, with warranty & bill"],
  ["1 call", "personal service, no payment gates"],
] as const;

export default function About() {
  const scope = useRef<HTMLDivElement>(null);
  useReveal(scope);

  return (
    <div ref={scope} className="mx-auto max-w-5xl px-4 pt-28 pb-24 sm:px-6">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <p className="text-xs font-semibold tracking-[0.3em] text-gold uppercase" data-reveal>
        About Us · Since 1970
      </p>
      <div className="mt-4 grid gap-6 md:grid-cols-[1.5fr_1fr] md:items-end">
        <h1
          className="max-w-3xl font-display text-4xl leading-tight text-cream md:text-6xl"
          data-reveal
        >
          A legacy of timeless trust since 1970.
        </h1>
        <p className="max-w-md text-sm leading-relaxed text-muted md:pb-2 md:text-base" data-reveal>
          More than a watch store — a name generations of families have grown
          up with, and a counter where trust is handed down as carefully as the
          timepieces themselves.
        </p>
      </div>

      {/* ── Our journey ──────────────────────────────────────────────── */}
      <section
        className="mt-16 grid gap-8 md:grid-cols-[1.15fr_0.85fr]"
        aria-labelledby="our-journey"
      >
        <div data-reveal>
          <p className="text-xs font-semibold tracking-[0.3em] text-gold uppercase">
            Our Journey
          </p>
          <h2
            id="our-journey"
            className="mt-2 font-display text-3xl text-cream md:text-4xl"
          >
            A legacy since 1970
          </h2>
          <div className="mt-6 space-y-5 leading-relaxed text-muted">
            <p>
              The story of <span className="font-semibold text-cream">{SHOP.name}</span>{" "}
              began in 1970 with the vision and passion of Shri Krishan Lal
              Gaba. What started as a dream built on a love for watches,
              quality and customer trust gradually grew into a name that
              generations have come to value.
            </p>
            <p>
              With a strong foundation of honesty, dedication and a commitment
              to customer satisfaction, {SHOP.name} has continued to bring
              together exceptional timepieces and timeless designs.
            </p>
          </div>
          <p className="mt-7 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-ink-line bg-ink-card px-5 py-2.5 text-xs font-medium tracking-[0.14em] text-cream/80 uppercase">
            Honesty
            <span aria-hidden="true" className="text-gold/60">·</span>
            Dedication
            <span aria-hidden="true" className="text-gold/60">·</span>
            Customer satisfaction
          </p>
        </div>

        <ol className="relative self-start rounded-2xl border border-ink-line bg-ink-soft p-6 md:p-7" data-reveal>
          {MILESTONES.map((m, i) => (
            <li
              key={m.year}
              className={`relative border-l border-ink-line pl-6 ${
                i > 0 ? "mt-8 pt-1" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-gold shadow-[0_0_0_4px_var(--color-ink-soft)]"
              />
              <p className="text-[10px] font-semibold tracking-[0.28em] text-gold uppercase">
                {m.year}
              </p>
              <h3 className="mt-1.5 font-display text-xl text-cream">{m.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{m.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Legacy in numbers ────────────────────────────────────────── */}
      <div className="mt-14 grid gap-4 sm:grid-cols-2 md:grid-cols-4" data-reveal>
        {STATS.map(([big, small]) => (
          <div key={small} className="rounded-2xl border border-ink-line bg-ink-card p-5">
            <p className="font-display text-2xl text-gold md:text-3xl">{big}</p>
            <p className="mt-1 text-sm leading-snug text-muted">{small}</p>
          </div>
        ))}
      </div>

      {/* ── The next generation ──────────────────────────────────────── */}
      <section
        className="relative mt-16 overflow-hidden rounded-3xl border border-ink-line bg-ink-soft p-8 md:p-12"
        aria-labelledby="next-chapter"
        data-reveal
      >
        <p
          aria-hidden="true"
          className="pointer-events-none absolute -top-6 right-4 select-none font-display text-[120px] leading-none text-cream/[0.04] md:text-[180px]"
        >
          1970
        </p>
        <div className="relative grid gap-10 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-xs font-semibold tracking-[0.3em] text-gold uppercase">
              Today · The next generation
            </p>
            <h2
              id="next-chapter"
              className="mt-2 font-display text-3xl text-cream md:text-4xl"
            >
              Carrying the legacy forward
            </h2>
            <p className="mt-5 max-w-2xl leading-relaxed text-muted">
              Today, this cherished legacy is being carried forward by the
              next generation, <span className="font-semibold text-cream">Mr. Pankaj Gaba</span>.
              He is taking {SHOP.name} towards new horizons while preserving
              the trust, quality and customer relationships that have defined
              the brand for generations.
            </p>
          </div>

          <div className="flex items-center justify-center">
            <div className="rounded-2xl border border-ink-line bg-ink px-8 py-9 text-center">
              <p className="text-[10px] font-semibold tracking-[0.3em] text-gold uppercase">
                Established
              </p>
              <p className="mt-1 font-display text-6xl text-cream">1970</p>
              <div aria-hidden="true" className="mx-auto mt-3 h-px w-10 bg-gold/50" />
              <p className="mt-3 max-w-[150px] text-[10px] tracking-[0.2em] text-muted uppercase">
                A legacy of timeless trust
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Brands & visit ───────────────────────────────────────────── */}
      <div className="mt-16 rounded-3xl border border-ink-line bg-ink-soft p-8 md:p-12" data-reveal>
        <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-start">
          <div>
            <h2 className="font-display text-2xl text-cream md:text-3xl">
              Our brands
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              {BRANDS.length} brands — from first-job Fastracks and dependable
              Casios to G-Shocks, Fossils and Emporio Armani for the big
              occasions. Every watch leaves our counter with its original box,
              papers and brand warranty.
            </p>
          </div>
          <BrandLockup
            size={130}
            variant="stacked"
            className="hidden opacity-70 md:block"
          />
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {BRANDS.map((b) => (
            <span
              key={b}
              className="rounded-full border border-ink-line px-4 py-1.5 text-sm text-cream/85"
            >
              {b}
            </span>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            to="/collection"
            className="inline-block rounded-full bg-gold px-7 py-3 font-semibold text-ink transition-transform hover:scale-105"
          >
            Browse the Collection →
          </Link>
          <a
            href={waUrl(`Hi ${SHOP.name}! I'd like to know more about your store and watches.`)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-ink-line px-7 py-3 font-semibold text-cream transition-colors hover:bg-white/5"
          >
            <Icon name="whatsapp" className="h-4 w-4" />
            Talk to us
          </a>
        </div>
      </div>
    </div>
  );
}
