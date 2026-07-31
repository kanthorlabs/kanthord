// Story 05 — useVisibilityPoll: visibility-aware polling engine.
// Bullets 1-9 of decision 10: polls only while visible, no overlap, abort on unmount/resetKey.
import { useEffect, useRef, useState } from "react";

export const POLL_INTERVAL_MS = 15_000;

export interface UseVisibilityPollOptions {
  /** The signal value the screen currently shows — `digest.latest`. */
  readonly signal: string | null;
  /** Fetches the current signal value. Must forward the AbortSignal. */
  readonly probe: (abort: AbortSignal) => Promise<string | null>;
  /** Called once per probe whose result differs from `signal`. */
  readonly onChange: () => void;
  /** Aborts the in-flight probe and restarts the engine when it changes. */
  readonly resetKey: string;
  readonly intervalMs?: number;
}

export interface VisibilityPollState {
  readonly probing: boolean;
  readonly error: Error | null;
}

export function useVisibilityPoll(
  options: UseVisibilityPollOptions,
): VisibilityPollState {
  const [state, setState] = useState<VisibilityPollState>({
    probing: false,
    error: null,
  });

  // Refs keep latest values stable inside the effect — bullet 5.
  const signalRef = useRef(options.signal);
  const probeRef = useRef(options.probe);
  const onChangeRef = useRef(options.onChange);
  signalRef.current = options.signal;
  probeRef.current = options.probe;
  onChangeRef.current = options.onChange;

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const abortCtrl = new AbortController();

    const tick = () => {
      // Bullet 1: only while visible.
      if (document.visibilityState !== "visible") return;
      // Bullet 3: no overlap.
      if (inFlight) return;
      inFlight = true;
      setState((prev) => ({ ...prev, probing: true }));
      probeRef
        .current(abortCtrl.signal)
        .then(
          (result) => {
            if (!active) return;
            if (result !== signalRef.current) {
              onChangeRef.current();
            }
          },
          (err: unknown) => {
            if (!active) return;
            if (err instanceof DOMException && err.name === "AbortError")
              return;
            if (err instanceof Error) {
              setState((prev) => ({ ...prev, error: err as Error }));
            }
          },
        )
        .finally(() => {
          inFlight = false;
          if (active) {
            setState((prev) => ({ ...prev, probing: false }));
          }
        });
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && active) {
        // Bullet 2: probe immediately on visible, then restart interval.
        tick();
        clearInterval(intervalId);
        intervalId = setInterval(tick, options.intervalMs ?? POLL_INTERVAL_MS);
      }
    };

    // Bullet 1: only start if visible.
    let intervalId: ReturnType<typeof setInterval> | undefined;
    if (document.visibilityState === "visible") {
      tick();
      intervalId = setInterval(tick, options.intervalMs ?? POLL_INTERVAL_MS);
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      // Bullet 4: clear interval, remove listener, abort in-flight probe.
      if (intervalId !== undefined) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
      abortCtrl.abort();
    };
    // Bullet 8: depends on [resetKey, intervalMs] only.
  }, [options.resetKey, options.intervalMs]);

  return state;
}
