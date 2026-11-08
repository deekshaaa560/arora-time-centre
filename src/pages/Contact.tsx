import { useRef } from "react";
import Icon from "../components/Icon";
import { useReveal } from "../lib/useReveal";
import { useCart } from "../context/CartContext";
import { orderMessage } from "../lib/orderMessage";
import { SHOP, waUrl } from "../config";

export default function Contact() {
  const scope = useRef<HTMLDivElement>(null);
  useReveal(scope);

  const { items, subtotal } = useCart();
  const waOrder = waUrl(orderMessage(items, subtotal));

  const mapCoords = `${SHOP.lat},${SHOP.lng}`;
  const mapEmbedUrl = `https://www.google.com/maps?q=${mapCoords}&z=17&output=embed`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${mapCoords}`;

  const cards = [
    {
      icon: "phone",
      title: "Call the counter",
      body: "Fastest way to confirm stock, price match, exchange or EMI options.",
      href: `tel:${SHOP.tel}`,
      cta: SHOP.phoneDisplay,
      accent: "hover:border-gold/60",
    },
    {
      icon: "whatsapp",
      title: "WhatsApp us",
      body: "Send a screenshot of any watch on this site — we'll reply with availability and final price.",
      href: waUrl(`Hi ${SHOP.name}! I'd like to know about a watch from your website.`),
      cta: "Start a chat",
      accent: "hover:border-gold/60",
    },
    {
      icon: "clock",
      title: "Shop hours",
      body: `${SHOP.hours} · ${SHOP.closed}`,
      href: null,
      cta: null,
      accent: "",
    },
  ] as const;

  return (
    <div ref={scope} className="mx-auto max-w-5xl px-4 pt-28 pb-24 sm:px-6">
      <p className="text-xs font-semibold tracking-[0.3em] text-gold uppercase" data-reveal>
        Contact Us
      </p>
      <h1 className="mt-3 font-display text-4xl text-cream md:text-6xl" data-reveal>
        Talk to us. It's a shop, not a checkout bot.
      </h1>
      <p className="mt-4 max-w-2xl leading-relaxed text-muted" data-reveal>
        Everything on this site is reservation-first: add your watches to the
        cart, send the shortlist on WhatsApp, and we'll keep them at the counter
        while you confirm.
      </p>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.title}
            data-reveal
            className={`flex flex-col rounded-3xl border border-ink-line bg-ink-card p-7 transition-colors ${c.accent}`}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-ink-line text-gold/80">
              <Icon name={c.icon} className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-display text-xl text-cream">{c.title}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{c.body}</p>
            {c.href && (
              <a
                href={c.href}
                target={c.href.startsWith("http") ? "_blank" : undefined}
                rel="noreferrer"
                className="mt-5 text-sm font-semibold text-gold underline-offset-4 hover:underline"
              >
                {c.cta} →
              </a>
            )}
          </div>
        ))}
      </div>

      <section
        className="mt-12 overflow-hidden rounded-3xl border border-ink-line bg-ink-card"
        data-reveal
        aria-labelledby="visit-heading"
      >
        <div className="grid md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="flex flex-col justify-center p-7 md:p-10">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-ink-line text-gold/80">
              <Icon name="map-pin" className="h-5 w-5" />
            </div>
            <p className="mt-5 text-xs font-semibold tracking-[0.28em] text-gold uppercase">
              Visit the store
            </p>
            <h2
              id="visit-heading"
              className="mt-2 font-display text-2xl text-cream md:text-3xl"
            >
              Find us in West Patel Nagar
            </h2>
            <address className="mt-3 text-sm leading-relaxed text-muted not-italic">
              {SHOP.address}
            </address>
            <div className="mt-3 flex items-start gap-2 text-sm text-cream">
              <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0 text-gold/80" />
              <span>
                {SHOP.hours}
                <span className="mt-0.5 block text-xs text-muted">{SHOP.closed}</span>
              </span>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={directionsUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-gold px-6 py-2.5 text-sm font-bold text-ink transition-transform hover:scale-105"
              >
                Get directions
              </a>
              <a
                href={`tel:${SHOP.tel}`}
                className="inline-flex items-center gap-2 rounded-full border border-cream/25 px-6 py-2.5 text-sm font-semibold text-cream hover:border-gold hover:text-gold"
              >
                <Icon name="phone" className="h-4 w-4" />
                Call the store
              </a>
            </div>
          </div>
          <div className="relative min-h-[320px] border-t border-ink-line md:min-h-[400px] md:border-t-0 md:border-l">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-soft px-6 text-center">
              <Icon name="map-pin" className="h-7 w-7 text-gold/70" />
              <p className="text-sm text-muted">
                Map loading? Open the pin directly in Google Maps.
              </p>
              <a
                href={directionsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-gold underline-offset-4 hover:underline"
              >
                Open in Google Maps →
              </a>
            </div>
            <iframe
              title={`${SHOP.name} — Google Map`}
              src={mapEmbedUrl}
              className="absolute inset-0 h-full w-full"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </section>

      <div className="mt-12 rounded-3xl border border-gold/30 bg-gradient-to-br from-ink-card to-ink-soft p-8 text-center md:p-12" data-reveal>
        <h2 className="font-display text-2xl text-cream md:text-3xl">
          Already picked your watches?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Your cart becomes a pre-written WhatsApp message — send it over and
          we'll keep the watches at the counter while we confirm stock and the
          best price.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href={waOrder}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-gold px-7 py-3 font-bold text-ink transition-transform hover:scale-105"
          >
            <Icon name="whatsapp" className="h-4 w-4" />
            {items.length > 0 ? "Send Order on WhatsApp" : "Chat on WhatsApp"}
          </a>
          <a
            href={`tel:${SHOP.tel}`}
            className="inline-flex items-center gap-2 rounded-full border border-cream/25 px-7 py-3 font-semibold text-cream hover:border-gold hover:text-gold"
          >
            <Icon name="phone" className="h-4 w-4" />
            Call Now
          </a>
        </div>
      </div>

      <p className="mt-10 text-center text-xs text-muted" data-reveal>
        {SHOP.name} · {SHOP.city} · {SHOP.phoneDisplay} · Hours: {SHOP.hours} · {SHOP.closed}
      </p>
    </div>
  );
}
