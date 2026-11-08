import type { Watch } from "../data/watches";
import { useProductImage } from "../lib/useProductImage";

/**
 * Product image with a graceful fallback: if a product has no extracted
 * photo (or it fails to load), render an elegant branded placeholder.
 */
export default function ProductImage({
  watch,
  className = "",
}: {
  watch: Watch;
  className?: string;
}) {
  const { src, failed, onError } = useProductImage(watch);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-white ${className}`}
      >
        <div className="text-center">
          <div className="font-display text-2xl text-ink">{watch.brand}</div>
          <div className="mt-1 text-[10px] tracking-widest text-ink/50 uppercase">
            {watch.model}
          </div>
        </div>
      </div>
    );
  }

  return (
    <img
      src={src ?? undefined}
      alt={`${watch.brand} ${watch.model}`}
      loading="lazy"
      onError={onError}
      className={className}
    />
  );
}
