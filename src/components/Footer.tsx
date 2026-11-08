import { Link } from "react-router-dom";
import { SHOP } from "../config";
import { BRANDS } from "../data/watches";
import BrandLockup from "./BrandLockup";
import Icon from "./Icon";

export default function Footer() {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${SHOP.lat},${SHOP.lng}`;

  return (
    <footer className="border-t border-ink-line bg-ink-soft">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 md:grid-cols-3">
        <div>
          <Link to="/" aria-label="Arora Time Centre — home" className="inline-block">
            <BrandLockup size={190} variant="stacked" />
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
            {SHOP.tagline} Genuine branded watches, honest prices, and one-call
            service — no online payment confusion.
          </p>
          <p className="mt-4 text-sm text-cream">{SHOP.hours}</p>
          <p className="mt-1 text-xs text-muted">{SHOP.closed}</p>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">
            Explore
          </p>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-muted">
            <Link to="/about" className="hover:text-cream">About Us</Link>
            <Link to="/collection" className="hover:text-cream">Collection</Link>
            <Link to="/mens" className="hover:text-cream">Men's Collection</Link>
            <Link to="/womens" className="hover:text-cream">Women's Collection</Link>
            <Link to="/contact" className="hover:text-cream">Contact Us</Link>
          </div>
          <p className="mt-5 text-xs font-semibold tracking-[0.2em] text-gold uppercase">
            We stock
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {BRANDS.join(" · ")}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">
            Talk to a human
          </p>
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <a href={`tel:${SHOP.tel}`} className="inline-flex items-center gap-2 text-cream hover:text-gold">
              <Icon name="phone" className="h-4 w-4" />
              {SHOP.phoneDisplay}
            </a>
            <a
              href={`https://wa.me/${SHOP.whatsapp}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-cream hover:text-gold"
            >
              <Icon name="whatsapp" className="h-4 w-4" />
              WhatsApp us
            </a>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-start gap-2 text-cream hover:text-gold"
            >
              <Icon name="map-pin" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{SHOP.address}</span>
            </a>
          </div>
        </div>
      </div>

      <div className="border-t border-ink-line px-6 py-5">
        <p className="mx-auto max-w-7xl text-center text-[11px] leading-relaxed text-muted">
          © {new Date().getFullYear()} {SHOP.name}. Product imagery is representative —
          please confirm the exact model, finish and availability with our team.
        </p>
      </div>
    </footer>
  );
}
