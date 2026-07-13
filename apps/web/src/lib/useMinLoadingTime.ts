import { useEffect, useRef, useState } from 'react';

const MIN_LOADING_MS = 200;

export function useMinLoadingTime(isLoading: boolean, minMs: number = MIN_LOADING_MS): boolean {
  // `isHolding` covers only the post-load grace window; the in-progress case is
  // derived directly from `isLoading` below, so no effect ever echoes it into state.
  const [isHolding, setIsHolding] = useState(false);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      startedAtRef.current = Date.now();
      return;
    }

    const startedAt = startedAtRef.current;
    startedAtRef.current = null;
    if (startedAt === null) {
      return;
    }

    const remaining = minMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      return;
    }

    setIsHolding(true);
    const timer = setTimeout(() => setIsHolding(false), remaining);
    return () => clearTimeout(timer);
  }, [isLoading, minMs]);

  return isLoading || isHolding;
}
