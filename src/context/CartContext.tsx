import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { watchById, type Watch } from "../data/watches";

export interface CartLine {
  watch: Watch;
  qty: number;
}

interface CartContextValue {
  items: CartLine[];
  count: number;
  subtotal: number;
  savings: number;
  add: (id: string, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = "atc-cart-v1";

type StoredItem = { id: string; qty: number };

function loadCart(): StoredItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is StoredItem =>
        typeof i === "object" &&
        i !== null &&
        typeof (i as StoredItem).id === "string" &&
        typeof (i as StoredItem).qty === "number" &&
        watchById.has((i as StoredItem).id),
    );
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredItem[]>(loadCart);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }, [stored]);

  const value = useMemo<CartContextValue>(() => {
    const items: CartLine[] = stored.flatMap((s) => {
      const watch = watchById.get(s.id);
      return watch ? [{ watch, qty: s.qty }] : [];
    });
    return {
      items,
      count: items.reduce((n, i) => n + i.qty, 0),
      subtotal: items.reduce((n, i) => n + i.watch.price * i.qty, 0),
      savings: items.reduce((n, i) => n + (i.watch.mrp - i.watch.price) * i.qty, 0),
      add: (id, qty = 1) =>
        setStored((prev) => {
          const existing = prev.find((p) => p.id === id);
          if (existing)
            return prev.map((p) =>
              p.id === id ? { ...p, qty: Math.min(10, p.qty + qty) } : p,
            );
          return [...prev, { id, qty: Math.min(10, qty) }];
        }),
      setQty: (id, qty) =>
        setStored((prev) =>
          qty <= 0
            ? prev.filter((p) => p.id !== id)
            : prev.map((p) => (p.id === id ? { ...p, qty: Math.min(10, qty) } : p)),
        ),
      remove: (id) => setStored((prev) => prev.filter((p) => p.id !== id)),
      clear: () => setStored([]),
      drawerOpen,
      setDrawerOpen,
    };
  }, [stored, drawerOpen]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
