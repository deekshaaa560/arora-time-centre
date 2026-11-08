import { useRef, useState, type PointerEvent } from "react";
import type { Watch } from "../data/watches";
import { useProductImage } from "../lib/useProductImage";
import ProductImage from "./ProductImage";

const ZOOM = 2.2;
const LENS = 100 / ZOOM;

type Point = { x: number; y: number };

const CENTER: Point = { x: 0.5, y: 0.5 };

/**
 * Product inspector: hover (or tap) the main image to move the capture frame.
 * The right-hand panel shows that exact area at 2.6×, so dial details, hands,
 * markers and the case can all be inspected without leaving the modal.
 */
export default function WatchZoom({ watch }: { watch: Watch }) {
  const [active, setActive] = useState(false);
  const [point, setPoint] = useState<Point>(CENTER);
  const [lens, setLens] = useState({
    left: 50 - LENS / 2,
    top: 50 - LENS / 2,
  });
  const frame = useRef<HTMLDivElement>(null);
  const lastPointer = useRef<string>("mouse");
  const {
    src: magnifiedSrc,
    failed: magnifiedFailed,
    onError: onMagnifiedError,
  } = useProductImage(watch);

  const inspect = (e: PointerEvent<HTMLDivElement>) => {
    if (!watch.image) return;
    lastPointer.current = e.pointerType;
    const el = frame.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const half = LENS / 2;
    const left = Math.min(100 - LENS, Math.max(0, x * 100 - half));
    const top = Math.min(100 - LENS, Math.max(0, y * 100 - half));
    setLens({ left, top });
    setPoint({ x: (left + half) / 100, y: (top + half) / 100 });
    setActive(true);
  };

  // Keep the lens visible after a tap; only hide it when a mouse leaves.
  const leave = () => {
    if (lastPointer.current === "mouse") setActive(false);
  };

  const tx = (0.5 / ZOOM - point.x) * 100;
  const ty = (0.5 / ZOOM - point.y) * 100;

  if (!watch.image) {
    return (
      <div className="flex aspect-[2/1] items-center justify-center border-b border-ink-line bg-white">
        <div className="text-center">
          <div className="font-display text-3xl text-ink">{watch.brand}</div>
          <div className="mt-1 text-xs tracking-widest text-ink/50 uppercase">
            {watch.model}
          </div>
          <div className="mt-3 text-[10px] tracking-[0.18em] text-ink/40 uppercase">
            Photo coming soon
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid border-b border-ink-line md:grid-cols-2">
      {/* Main image + lens */}
      <div
        ref={frame}
        className="relative aspect-square cursor-crosshair touch-none overflow-hidden bg-white"
        onPointerMove={inspect}
        onPointerDown={inspect}
        onPointerLeave={leave}
        onDragStart={(e) => e.preventDefault()}
      >
        <ProductImage
          watch={watch}
          className="pointer-events-none h-full w-full select-none object-contain"
        />

        <div
          aria-hidden="true"
          className={`pointer-events-none absolute z-10 border-2 border-white bg-black/10 shadow-[0_0_0_1px_rgba(0,0,0,0.35)] transition-opacity duration-150 ${
            active ? "opacity-100" : "opacity-0"
          }`}
          style={{
            left: `${lens.left}%`,
            top: `${lens.top}%`,
            width: `${LENS}%`,
            height: `${LENS}%`,
          }}
        />

        <span className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-full bg-ink/75 px-3 py-1 text-[9px] font-semibold tracking-[0.18em] text-cream uppercase backdrop-blur">
          Hover or tap to inspect
        </span>
      </div>

      {/* Magnified view */}
      <div className="relative aspect-square overflow-hidden border-t border-ink-line bg-white md:border-t-0 md:border-l">
        {magnifiedFailed ? (
          <div className="flex h-full items-center justify-center text-[10px] tracking-[0.18em] text-ink/40 uppercase">
            Image unavailable
          </div>
        ) : (
          <img
            src={magnifiedSrc ?? undefined}
            alt=""
            aria-hidden="true"
            draggable={false}
            onError={onMagnifiedError}
            className="absolute top-0 left-0 max-w-none select-none"
            style={{
              width: `${ZOOM * 100}%`,
              height: `${ZOOM * 100}%`,
              transform: `translate(${tx}% , ${ty}%)`,
            }}
          />
        )}
        <span className="pointer-events-none absolute top-3 left-3 z-10 rounded-full border border-ink/10 bg-white/90 px-3 py-1 text-[9px] font-semibold tracking-[0.18em] text-ink uppercase backdrop-blur">
          Inspect
        </span>
        <span className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-full bg-ink/75 px-2.5 py-1 text-[9px] font-semibold tracking-[0.12em] text-cream backdrop-blur">
          {ZOOM}×
        </span>
      </div>
    </div>
  );
}
