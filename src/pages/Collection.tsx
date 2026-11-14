import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  WATCHES,
  CATALOG_BRANDS,
  brandSlug,
  findBrandByNameOrSlug,
  findWatchByCode,
  type Gender,
} from "../data/watches";
import WatchCard from "../components/WatchCard";
import WatchModal from "../components/WatchModal";
import { useReveal } from "../lib/useReveal";

const PRICE_BANDS = [
  { label: "All prices", min: 0, max: Infinity },
  { label: "Under ₹5,000", min: 0, max: 5000 },
  { label: "₹5,000 – ₹15,000", min: 5000, max: 15000 },
  { label: "₹15,000 – ₹30,000", min: 15000, max: 30000 },
  { label: "Above ₹30,000", min: 30000, max: Infinity },
];

const SORTS = [
  { label: "Price: low to high", value: "price-asc" },
  { label: "Price: high to low", value: "price-desc" },
  { label: "Brand A → Z", value: "brand" },
  { label: "Featured", value: "featured" },
];

const PAGE_SIZE = 48;

const GENDER_LABEL: Record<Gender, string> = {
  men: "Men",
  women: "Women",
  unisex: "Unisex",
};

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-ink-line py-5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold tracking-[0.22em] text-cream uppercase">
          {title}
        </span>
        <svg
          className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}

export default function Collection({
  heading,
  sub,
  gender,
}: {
  heading: string;
  sub: string;
  gender?: Gender;
}) {
  const scope = useRef<HTMLDivElement>(null);
  useReveal(scope);

  const [searchParams, setSearchParams] = useSearchParams();

  /** ?brand=titan,fastrack — slugs or plain names; kept in sync with the
   *  brand checkboxes so any filtered view (or single watch) can be linked. */
  const urlBrands = useMemo(
    () =>
      (searchParams.get("brand") ?? "")
        .split(",")
        .map((v) => findBrandByNameOrSlug(v))
        .filter((b): b is string => b !== null),
    [searchParams],
  );
  const [brands, setBrands] = useState<Set<string>>(() => new Set(urlBrands));
  const [genders, setGenders] = useState<Set<Gender>>(new Set());
  const [band, setBand] = useState(0);
  const [minInput, setMinInput] = useState("");
  const [maxInput, setMaxInput] = useState("");
  const [customRange, setCustomRange] = useState<{ min: number; max: number } | null>(null);
  const [offerOnly, setOfferOnly] = useState(false);
  const [sort, setSort] = useState("price-asc");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [mobileFilters, setMobileFilters] = useState(false);

  /** ?code=3273nl04 — the watch whose details are open (deep-linkable). */
  const selected = useMemo(
    () => findWatchByCode(searchParams.get("code") ?? "", urlBrands),
    [searchParams, urlBrands],
  );

  const patchParams = (mutate: (sp: URLSearchParams) => void, replace = false) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace });
  };

  const openWatch = (id: string) =>
    patchParams((sp) => sp.set("code", id));

  const closeWatch = () => patchParams((sp) => sp.delete("code"), true);

  const writeBrands = (next: Set<string>) => {
    setBrands(next);
    patchParams((sp) => {
      const want = [...next].map(brandSlug).join(",");
      if (want) sp.set("brand", want);
      else sp.delete("brand");
    }, true);
  };

  // Back/forward and pasted links update ?brand= — keep the checkboxes in sync.
  useEffect(() => {
    setBrands((prev) =>
      prev.size === urlBrands.length && urlBrands.every((b) => prev.has(b))
        ? prev
        : new Set(urlBrands),
    );
  }, [urlBrands]);

  const pool = useMemo(
    () => (gender ? WATCHES.filter((w) => w.gender === gender) : WATCHES),
    [gender],
  );

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [brands, genders, band, customRange, offerOnly, sort]);

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const range = customRange ?? { min: PRICE_BANDS[band].min, max: PRICE_BANDS[band].max };

  const visible = useMemo(() => {
    let list = pool.filter(
      (w) =>
        (brands.size === 0 || brands.has(w.brand)) &&
        (genders.size === 0 || genders.has(w.gender)) &&
        w.price >= range.min &&
        w.price < range.max &&
        (!offerOnly || w.discount > 0),
    );
    if (sort === "price-asc") list = [...list].sort((a, b) => a.price - b.price);
    if (sort === "price-desc") list = [...list].sort((a, b) => b.price - a.price);
    if (sort === "brand")
      list = [...list].sort((a, b) => a.brand.localeCompare(b.brand) || a.price - b.price);
    return list;
  }, [pool, brands, genders, range.min, range.max, offerOnly, sort]);

  /** Only brands that actually have watches in the current collection
   *  (e.g. Women's) get a checkbox — a 0-count brand is not shown. */
  const brandsWithWatches = useMemo(() => {
    const present = new Set<string>();
    for (const w of pool) present.add(w.brand);
    return CATALOG_BRANDS.filter((b) => present.has(b));
  }, [pool]);

  const activeCount =
    brands.size + genders.size + (offerOnly ? 1 : 0) + (band !== 0 || customRange ? 1 : 0);

  const applyCustomRange = () => {
    const min = Number(minInput.replace(/[^0-9]/g, "")) || 0;
    const max = Number(maxInput.replace(/[^0-9]/g, "")) || Infinity;
    setCustomRange({ min, max: max <= min ? Infinity : max });
    setBand(-1);
  };

  const clearAll = () => {
    writeBrands(new Set());
    setGenders(new Set());
    setBand(0);
    setCustomRange(null);
    setMinInput("");
    setMaxInput("");
    setOfferOnly(false);
  };

  const Filters = (
    <div>
      <Section title="Price Range (₹)">
        <div className="space-y-1.5">
          {PRICE_BANDS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => {
                setBand(i);
                setCustomRange(null);
                setMinInput("");
                setMaxInput("");
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                band === i
                  ? "border-gold bg-gold/10 font-semibold text-cream"
                  : "border-transparent text-cream/75 hover:border-ink-line hover:bg-ink-soft"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${band === i ? "bg-gold" : "bg-muted/50"}`}
              />
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <input
            inputMode="numeric"
            placeholder="₹ Min"
            value={minInput}
            onChange={(e) => setMinInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyCustomRange()}
            className="w-full rounded-lg border border-ink-line bg-ink-soft px-3 py-2 text-sm text-cream placeholder:text-muted focus:border-gold focus:outline-none"
          />
          <input
            inputMode="numeric"
            placeholder="₹ Max"
            value={maxInput}
            onChange={(e) => setMaxInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyCustomRange()}
            className="w-full rounded-lg border border-ink-line bg-ink-soft px-3 py-2 text-sm text-cream placeholder:text-muted focus:border-gold focus:outline-none"
          />
        </div>
        <button
          onClick={applyCustomRange}
          className="mt-2 w-full rounded-full border border-ink-line py-1.5 text-xs font-semibold tracking-wide text-cream uppercase hover:border-gold hover:text-gold"
        >
          Apply price
        </button>
      </Section>

      <Section title="On Offer" defaultOpen={false}>
        <label className="flex cursor-pointer items-center justify-between text-sm text-cream/85">
          <span>Discounted watches</span>
          <button
            role="switch"
            aria-checked={offerOnly}
            onClick={() => setOfferOnly((v) => !v)}
            className={`relative h-5 w-9 rounded-full transition-colors ${offerOnly ? "bg-gold" : "bg-ink-line"}`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full transition-transform ${
                offerOnly ? "left-[18px] bg-ink" : "left-0.5 bg-cream"
              }`}
            />
          </button>
        </label>
      </Section>

      <Section title="Brand">
        <div className="space-y-1">
          {brandsWithWatches.map((b) => (
            <button
              key={b}
              onClick={() => writeBrands(toggle(brands, b))}
              className="flex w-full items-center rounded-lg px-1 py-1.5 text-sm text-cream/85 hover:text-cream"
            >
              <span className="flex items-center gap-2.5">
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-[4px] border ${
                    brands.has(b) ? "border-gold bg-gold text-ink" : "border-muted/50"
                  }`}
                >
                  {brands.has(b) && (
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                {b}
              </span>
            </button>
          ))}
        </div>
      </Section>

      {!gender && (
        <Section title="Gender">
          <div className="space-y-1">
            {(["men", "women", "unisex"] as Gender[]).map((g) => (
              <button
                key={g}
                onClick={() => setGenders((s) => toggle(s, g))}
                className="flex w-full items-center rounded-lg px-1 py-1.5 text-sm text-cream/85 hover:text-cream"
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-[4px] border ${
                      genders.has(g) ? "border-gold bg-gold text-ink" : "border-muted/50"
                    }`}
                  >
                    {genders.has(g) && (
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  {GENDER_LABEL[g]}
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {(activeCount > 0 || customRange) && (
        <button
          onClick={clearAll}
          className="mt-4 w-full rounded-full border border-ink-line py-2 text-xs font-semibold tracking-wide text-muted uppercase hover:border-gold hover:text-gold"
        >
          Clear all filters
        </button>
      )}
    </div>
  );

  return (
    <div ref={scope} className="mx-auto max-w-[1400px] px-4 pt-28 pb-20 sm:px-6">
      <header className="max-w-2xl" data-reveal>
        <h1 className="font-display text-4xl text-cream md:text-5xl">{heading}</h1>
        <p className="mt-3 text-muted">{sub}</p>
      </header>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[270px_1fr]">
        {/* Desktop filters */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-3">
            {Filters}
          </div>
        </aside>

        <section>
          {/* Sort row */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-ink-line py-3">
            <p className="text-[11px] font-semibold tracking-[0.22em] text-muted uppercase">
              Sorted by {SORTS.find((s) => s.value === sort)?.label}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileFilters(true)}
                className="rounded-full border border-ink-line px-4 py-1.5 text-xs font-semibold tracking-wide text-cream uppercase lg:hidden"
              >
                Filters{activeCount ? ` (${activeCount})` : ""}
              </button>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Sort watches"
                className="rounded-lg border border-ink-line bg-ink-card px-4 py-2 text-xs font-semibold tracking-wide text-cream uppercase outline-none focus:border-gold"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="mt-5 text-sm text-muted">
            Showing <span className="text-cream">{Math.min(limit, visible.length)}</span> of{" "}
            <span className="text-cream">{visible.length}</span> watches
            {visible.length !== pool.length ? ` (filtered from ${pool.length})` : ""}
          </p>

          {visible.length === 0 ? (
            <div className="mt-16 text-center">
              <p className="text-4xl">🔍</p>
              <p className="mt-4 text-muted">
                Nothing matches those filters. Loosen the price range or pick fewer brands.
              </p>
              <button
                onClick={clearAll}
                className="mt-5 rounded-full border border-ink-line px-5 py-2 text-sm font-semibold text-cream hover:border-gold hover:text-gold"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <div className="mt-5 grid grid-cols-2 gap-4 sm:gap-6 xl:grid-cols-3">
                {visible.slice(0, limit).map((w) => (
                  <WatchCard key={w.id} watch={w} onOpen={(x) => openWatch(x.id)} />
                ))}
              </div>
              {limit < visible.length && (
                <div className="mt-10 text-center">
                  <button
                    onClick={() => setLimit((l) => l + PAGE_SIZE)}
                    className="rounded-full border border-gold/50 bg-ink-card px-8 py-3 font-semibold text-gold transition-colors hover:bg-gold hover:text-ink"
                  >
                    Load {Math.min(PAGE_SIZE, visible.length - limit)} more watches ↓
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Mobile filter drawer */}
      {mobileFilters && (
        <div className="fixed inset-0 z-70 flex flex-col bg-ink lg:hidden">
          <div className="flex items-center justify-between border-b border-ink-line px-5 py-4">
            <p className="font-display text-xl text-cream">Filters</p>
            <button
              aria-label="Close filters"
              onClick={() => setMobileFilters(false)}
              className="rounded-full border border-ink-line p-2 text-cream"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-4">{Filters}</div>
          <div className="border-t border-ink-line p-4">
            <button
              onClick={() => setMobileFilters(false)}
              className="w-full rounded-full bg-gold py-3 font-bold text-ink"
            >
              Show {visible.length} watches
            </button>
          </div>
        </div>
      )}

      <WatchModal watch={selected} onClose={closeWatch} />
    </div>
  );
}
