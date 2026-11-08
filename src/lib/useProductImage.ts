import { useEffect, useState } from "react";
import type { Watch } from "../data/watches";

/**
 * Product images can be replaced on disk while a browser still has the old
 * (possibly corrupt) response cached. Retry once with a cache-busting query
 * before falling back to the branded placeholder.
 */
export function useProductImage(watch: Watch) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [watch.id, watch.image]);

  const src = watch.image
    ? attempt === 0
      ? watch.image
      : `${watch.image}?retry=${attempt}`
    : null;

  const onError = () => {
    if (!watch.image) {
      setFailed(true);
      return;
    }
    if (attempt === 0) setAttempt(1);
    else setFailed(true);
  };

  return { src, failed: failed || !watch.image, onError };
}
