// Story 03 — useDebouncedValue: delays value updates by delayMs, clearing on change and unmount.
import { useEffect, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 200;

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
