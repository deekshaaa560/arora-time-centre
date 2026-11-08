import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon";

type Slide = {
  brand: string;
  brandSuffix?: string;
  eyebrow: string;
  headline: string[];
  subline: string;
  image: string;
  mobileImage?: string;
  alt: string;
  position: string;
  mobilePosition?: string;
  accent: string;
  background: string;
  fade: string;
  logoClass: string;
  cta: string;
  href: string;
  external?: boolean;
  whatsapp?: boolean;
};

const SLIDES: Slide[] = [
  {
    brand: "GUESS",
    brandSuffix: "WATCHES",
    eyebrow: "GUESS WATCHES · TAMANNAAH BHATIA",
    headline: ["Made for the", "moments you'll remember"],
    subline: "Designed with care, made to stay with you.",
    image: "/campaigns/guess.webp",
    alt: "Tamannaah Bhatia wearing a GUESS watch",
    position: "50% 32%",
    accent: "#e4c27a",
    background:
      "radial-gradient(ellipse at 28% 38%, #3d0b17 0%, #18040b 48%, #050203 100%)",
    fade: "#18040b",
    logoClass:
      "font-display text-2xl font-semibold uppercase tracking-[0.24em]",
    cta: "Shop Guess",
    href: "/collection?brand=Guess",
  },
  {
    brand: "FASTRACK",
    eyebrow: "FASTRACK · YOUR TIME. YOUR VIBE.",
    headline: ["Your time.", "Your vibe."],
    subline:
      "Bold watches for the generation that moves on its own clock.",
    image: "/campaigns/fastrack.webp",
    alt: "Fastrack campaign photograph",
    position: "50% 28%",
    accent: "#d8ef55",
    background:
      "radial-gradient(ellipse at 30% 40%, #1b2610 0%, #0a0e07 48%, #030402 100%)",
    fade: "#0a0e07",
    logoClass: "font-body text-xl font-bold uppercase tracking-[0.18em]",
    cta: "Shop Fastrack",
    href: "/collection?brand=Fastrack",
  },
  {
    brand: "FOSSIL",
    eyebrow: "FOSSIL · NICK JONAS",
    headline: ["Make time", "for good."],
    subline:
      "The Machine Luxe collection, with global brand ambassador Nick Jonas.",
    image: "/campaigns/fossil.webp",
    mobileImage: "/campaigns/fossil-mobile.webp",
    alt: "Nick Jonas wearing a Fossil watch",
    position: "62% 38%",
    mobilePosition: "52% 55%",
    accent: "#d4b06a",
    background:
      "radial-gradient(ellipse at 28% 38%, #122130 0%, #080d13 48%, #030405 100%)",
    fade: "#080d13",
    logoClass: "font-body text-xl font-semibold uppercase tracking-[0.34em]",
    cta: "Shop Fossil",
    href: "/collection?brand=Fossil",
  },
];

export default function BrandHero() {
  const [index, setIndex] = useState(0);
  const active = SLIDES[index];

  useEffect(() => {
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % SLIDES.length),
      6000,
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section
      className="relative h-[78vh] min-h-[580px] max-h-[780px] w-full overflow-hidden bg-ink"
      aria-roledescription="carousel"
      aria-label="Brand campaigns"
    >
      {SLIDES.map((s, i) => {
        const isActive = i === index;
        return (
          <article
            key={s.brand}
            className={`absolute inset-0 transition-opacity duration-700 ${
              isActive ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"
            }`}
            aria-hidden={!isActive}
          >
            <div className="absolute inset-0" style={{ background: s.background }} />

            {/* Desktop campaign image */}
            <div className="absolute inset-y-0 right-0 hidden w-[54%] md:block">
              <img
                src={s.image}
                alt={s.alt}
                className="h-full w-full object-cover"
                style={{ objectPosition: s.position }}
                loading="eager"
                draggable={false}
              />
              <div
                className="absolute inset-y-0 left-0 w-1/2"
                style={{
                  background: `linear-gradient(to right, ${s.fade} 0%, ${s.fade}dd 32%, transparent 100%)`,
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-black/10" />
            </div>

            {/* Mobile campaign image */}
            <div className="absolute inset-0 md:hidden">
              <img
                src={s.mobileImage ?? s.image}
                alt={s.alt}
                className="h-full w-full object-cover"
                style={{ objectPosition: s.mobilePosition ?? s.position }}
                loading="eager"
                draggable={false}
              />
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(to top, ${s.fade} 12%, ${s.fade}cc 52%, ${s.fade}33 100%)`,
                }}
              />
            </div>

            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-36 bg-gradient-to-b from-ink/80 via-ink/30 to-transparent" />

            <div className="relative z-20 mx-auto flex h-full max-w-7xl items-end px-4 pb-28 pt-20 sm:px-6 md:items-center md:pb-0">
              <div className="max-w-[600px]">
                <p
                  className="text-[10px] font-semibold tracking-[0.32em] uppercase"
                  style={{ color: s.accent }}
                >
                  {s.eyebrow}
                </p>
                <h1 className="mt-4 font-display text-[clamp(2.4rem,3.8vw,4.2rem)] leading-[1.04] font-medium text-cream">
                  {s.headline.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </h1>
                <p className="mt-5 max-w-md text-sm leading-relaxed text-cream/65 md:text-base">
                  {s.subline}
                </p>

                <div className="mt-8" style={{ color: s.accent }}>
                  <span className={s.logoClass}>{s.brand}</span>
                  {s.brandSuffix && (
                    <span className="mt-1 block text-[9px] font-medium tracking-[0.44em]">
                      {s.brandSuffix}
                    </span>
                  )}
                </div>

                <div className="mt-7 flex flex-wrap items-center gap-4">
                  {s.external ? (
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-cream/25 px-6 py-3 text-[10px] font-semibold tracking-[0.16em] text-cream uppercase transition-colors hover:bg-cream hover:text-ink"
                    >
                      {s.whatsapp && <Icon name="whatsapp" className="h-3.5 w-3.5" />}
                      {s.cta} <span aria-hidden="true">↗</span>
                    </a>
                  ) : (
                    <Link
                      to={s.href}
                      className="inline-flex items-center gap-2 rounded-full border border-cream/25 px-6 py-3 text-[10px] font-semibold tracking-[0.16em] text-cream uppercase transition-colors hover:bg-cream hover:text-ink"
                    >
                      {s.cta} <span aria-hidden="true">→</span>
                    </Link>
                  )}
                  <span className="hidden text-[9px] tracking-[0.22em] text-cream/35 uppercase sm:inline">
                    Official campaign
                  </span>
                </div>
              </div>
            </div>
          </article>
        );
      })}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 pb-6 sm:px-6">
          <div className="pointer-events-auto flex items-center gap-2">
            {SLIDES.map((s, i) => (
              <button
                key={s.brand}
                onClick={() => setIndex(i)}
                aria-label={`Show ${s.brand} slide`}
                aria-current={i === index}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === index ? "w-10" : "w-4 bg-cream/30 hover:bg-cream/55"
                }`}
                style={i === index ? { backgroundColor: s.accent } : undefined}
              />
            ))}
          </div>
          <div className="hidden items-center gap-3 text-[9px] tracking-[0.24em] text-cream/40 uppercase md:flex">
            <span style={{ color: active.accent }}>0{index + 1}</span>
            <span className="h-px w-8 bg-cream/20" />
            <span>0{SLIDES.length}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
