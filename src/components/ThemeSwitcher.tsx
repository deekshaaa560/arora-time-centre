import { useState } from "react";

/**
 * DARK THEME TESTER — floating bar to preview every dark preset live.
 * Pick a winner and the bar can be removed (or kept as a feature).
 */
const THEMES = [
  { id: "dark-gold", label: "Black & Gold", dots: ["#0b0b0d", "#c9a24b"] },
  { id: "burgundy", label: "Burgundy & Rose Gold", dots: ["#230610", "#e5a68c"] },
  { id: "midnight-ice", label: "Midnight & Ice Blue", dots: ["#070d14", "#6fb7ff"] },
  { id: "emerald-noir", label: "Emerald Noir", dots: ["#060d0a", "#2fbf8f"] },
  { id: "rose-charcoal", label: "Rose Charcoal", dots: ["#141013", "#f2a0b5"] },
  { id: "royal-purple", label: "Royal Purple", dots: ["#110821", "#b794f6"] },
  { id: "espresso-caramel", label: "Espresso & Caramel", dots: ["#171008", "#d9a05b"] },
  { id: "stealth-mono", label: "Stealth Mono", dots: ["#060606", "#e8e8e8"] },
  { id: "obsidian-copper", label: "Obsidian & Copper", dots: ["#0d0b0a", "#d9822b"] },
  { id: "midnight-champagne", label: "Midnight & Champagne", dots: ["#0a0d14", "#e3c58c"] },
  { id: "graphite-lime", label: "Graphite & Lime", dots: ["#0c0d0b", "#b8e02f"] },
  { id: "ink-crimson", label: "Ink & Crimson", dots: ["#0c0809", "#e0455f"] },
  { id: "forest-brass", label: "Forest & Brass", dots: ["#070d0a", "#c8a24a"] },
  { id: "navy-steel", label: "Navy & Steel", dots: ["#080d16", "#7fa7cf"] },
] as const;

const STORAGE_KEY = "atc-dark-theme";

export default function ThemeSwitcher() {
  const [active, setActive] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return THEMES.some((t) => t.id === saved)
        ? saved!
        : document.documentElement.dataset.theme || "dark-gold";
    } catch {
      return "dark-gold";
    }
  });

  const apply = (id: string) => {
    document.documentElement.dataset.theme = id;
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode */
    }
    setActive(id);
  };

  return (
    <div className="no-scrollbar fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-[96vw] flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-ink-line bg-ink-card/95 p-2 shadow-2xl backdrop-blur-md">
      <span className="px-2 text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">
        Dark
      </span>
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => apply(t.id)}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
            active === t.id
              ? "bg-gold text-ink"
              : "text-cream/85 hover:bg-ink-soft hover:text-cream"
          }`}
        >
          <span className="flex -space-x-1">
            {t.dots.map((c) => (
              <span
                key={c}
                className="h-3 w-3 rounded-full border border-black/30"
                style={{ backgroundColor: c }}
              />
            ))}
          </span>
          <span className="hidden sm:block">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
