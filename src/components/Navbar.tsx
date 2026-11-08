import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { SHOP } from "../config";
import BrandLockup from "./BrandLockup";
import Icon from "./Icon";

const LINKS = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About Us" },
  { to: "/collection", label: "Collection" },
  { to: "/mens", label: "Men's" },
  { to: "/womens", label: "Women's" },
  { to: "/contact", label: "Contact Us" },
];

export default function Navbar() {
  const { count, setDrawerOpen } = useCart();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `relative text-sm font-medium tracking-wide transition-colors hover:text-gold ${
      isActive ? "text-gold" : "text-cream/85"
    }`;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled || menuOpen
          ? "border-b border-ink-line bg-ink/90 backdrop-blur-md"
          : "bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <NavLink
          to="/"
          aria-label="Arora Time Centre — home"
          className="flex items-center gap-2.5"
          onClick={() => setMenuOpen(false)}
        >
          <BrandLockup size={160} variant="horizontal" bold />
        </NavLink>

        {/* desktop links */}
        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.to === "/"} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <a
            href={`tel:${SHOP.tel}`}
            className="hidden items-center gap-2 rounded-full border border-gold/50 px-4 py-1.5 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-ink lg:flex"
          >
            <Icon name="phone" className="h-3.5 w-3.5" />
            {SHOP.phoneDisplay}
          </a>

          <button
            aria-label={`Open cart, ${count} ${count === 1 ? "item" : "items"}`}
            onClick={() => setDrawerOpen(true)}
            className="relative rounded-full border border-ink-line bg-ink-card p-2.5 text-cream transition-colors hover:border-gold/60"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
              <path d="M3 6h18" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            {count > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[11px] font-bold text-ink">
                {count}
              </span>
            )}
          </button>

          {/* hamburger */}
          <button
            aria-label="Toggle menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-full border border-ink-line bg-ink-card p-2.5 text-cream md:hidden"
          >
            {menuOpen ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </nav>

      {/* mobile menu */}
      {menuOpen && (
        <div className="border-t border-ink-line bg-ink/95 px-6 py-4 backdrop-blur-md md:hidden">
          <div className="flex flex-col gap-4">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === "/"}
                className={linkClass}
                onClick={() => setMenuOpen(false)}
              >
                {l.label}
              </NavLink>
            ))}
            <a
              href={`tel:${SHOP.tel}`}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-gold px-4 py-2.5 text-center text-sm font-semibold text-ink"
            >
              <Icon name="phone" className="h-4 w-4" />
              Call {SHOP.phoneDisplay}
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
