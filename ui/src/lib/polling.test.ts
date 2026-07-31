// Story 05 — useVisibilityPoll: all nine bullets of decision 10.
// Tests the polling hook with fake timers, stubbed visibilityState, and abort tracking.
import { describe, expect, test, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVisibilityPoll, POLL_INTERVAL_MS } from "./polling";

function stubVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function emitVisibilityChange() {
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  vi.useRealTimers();
  stubVisibility("visible");
});

describe("useVisibilityPoll", () => {
  // Bullet 1: hidden at mount — probe never fires
  test("hidden at mount: probe never called after 3 intervals", () => {
    stubVisibility("hidden");
    vi.useFakeTimers();
    const probe = vi.fn().mockResolvedValue("v1");

    renderHook(() =>
      useVisibilityPoll({
        signal: null,
        probe,
        onChange: vi.fn(),
        resetKey: "p1",
      }),
    );

    act(() => {
      vi.advanceTimersByTime(3 * POLL_INTERVAL_MS);
    });

    expect(probe).not.toHaveBeenCalled();
  });

  // Bullet 2: visible — one probe per interval, three ticks → 3 calls
  test("visible: probe called once per interval, three ticks → 3 calls", async () => {
    stubVisibility("visible");
    vi.useFakeTimers();
    const probe = vi.fn().mockResolvedValue("v1");

    renderHook(() =>
      useVisibilityPoll({
        signal: "v1",
        probe,
        onChange: vi.fn(),
        resetKey: "p1",
      }),
    );

    // Flush microtasks so initial probe's .finally() clears inFlight
    await act(async () => {
      await vi.advanceTimersByTime(0);
    });

    // Initial probe on mount
    expect(probe).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(probe).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(probe).toHaveBeenCalledTimes(3);

    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(probe).toHaveBeenCalledTimes(4);
  });

  // Bullet 3: hidden → visible probes immediately
  test("hidden → visible: probe fires immediately on visibility change", () => {
    stubVisibility("hidden");
    vi.useFakeTimers();
    const probe = vi.fn().mockResolvedValue("v1");

    renderHook(() =>
      useVisibilityPoll({
        signal: null,
        probe,
        onChange: vi.fn(),
        resetKey: "p1",
      }),
    );

    // No probe yet (hidden)
    expect(probe).not.toHaveBeenCalled();

    // Switch to visible
    stubVisibility("visible");
    act(() => {
      emitVisibilityChange();
    });

    // Probe fires immediately — no timer advance needed
    expect(probe).toHaveBeenCalledTimes(1);
  });

  // Bullet 4: no overlap — a never-settling probe called once, even after three intervals
  test("no overlap: in-flight probe suppresses next ticks", () => {
    stubVisibility("visible");
    vi.useFakeTimers();
    // Promise that never resolves
    const neverSettles = new Promise<string>(() => {});
    const probe = vi.fn().mockReturnValue(neverSettles);

    renderHook(() =>
      useVisibilityPoll({
        signal: "v1",
        probe,
        onChange: vi.fn(),
        resetKey: "p1",
      }),
    );

    // Initial probe fires
    expect(probe).toHaveBeenCalledTimes(1);

    // Advance three intervals — probe should NOT be called again (overlap suppressed)
    act(() => {
      vi.advanceTimersByTime(3 * POLL_INTERVAL_MS);
    });

    expect(probe).toHaveBeenCalledTimes(1);
  });

  // Bullet 5: unmount aborts in-flight probe
  test("unmount: AbortSignal has aborted=true after unmount", () => {
    stubVisibility("visible");
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const probe = vi.fn().mockImplementation((signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<string>(() => {}); // never settles
    });

    const { unmount } = renderHook(() =>
      useVisibilityPoll({
        signal: "v1",
        probe,
        onChange: vi.fn(),
        resetKey: "p1",
      }),
    );

    expect(probe).toHaveBeenCalledTimes(1);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    unmount();

    expect(capturedSignal!.aborted).toBe(true);
  });

  // Bullet 6: resetKey change aborts previous probe, next tick probes fresh
  test("resetKey change: aborts previous probe and probes with fresh signal", () => {
    stubVisibility("visible");
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const probe = vi.fn().mockImplementation((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>(() => {}); // never settles
    });

    const { rerender } = renderHook(
      ({ resetKey }) =>
        useVisibilityPoll({
          signal: "v1",
          probe,
          onChange: vi.fn(),
          resetKey,
        }),
      { initialProps: { resetKey: "p1" } },
    );

    // First probe fired, signal not aborted
    expect(probe).toHaveBeenCalledTimes(1);
    expect(signals[0]!.aborted).toBe(false);

    // Change resetKey
    rerender({ resetKey: "p2" });

    // Previous signal was aborted
    expect(signals[0]!.aborted).toBe(true);
    // A new probe fired (fresh signal)
    expect(probe).toHaveBeenCalledTimes(2);
    expect(signals[1]!.aborted).toBe(false);
  });

  // Bullet 7: same signal value → onChange not called
  test("probe resolves same value as signal → onChange not called", async () => {
    stubVisibility("visible");
    vi.useFakeTimers();
    const onChange = vi.fn();
    const probe = vi.fn().mockResolvedValue("same-value");

    renderHook(() =>
      useVisibilityPoll({
        signal: "same-value",
        probe,
        onChange,
        resetKey: "p1",
      }),
    );

    // Wait for probe to resolve
    await act(async () => {
      await vi.advanceTimersByTime(0);
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  // Bullet 8: different signal value → onChange called exactly once
  test("probe resolves different value → onChange called once", async () => {
    stubVisibility("visible");
    vi.useFakeTimers();
    const onChange = vi.fn();
    const probe = vi.fn().mockResolvedValue("01J0ABCDEF00000000000000000");

    renderHook(() =>
      useVisibilityPoll({
        signal: null,
        probe,
        onChange,
        resetKey: "p1",
      }),
    );

    // Wait for probe to resolve
    await act(async () => {
      await vi.advanceTimersByTime(0);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // Bullet 9: probe rejects → onChange not called, error surfaced, next tick probes again
  test("probe rejects: error surfaced, onChange not called, next tick probes again", async () => {
    stubVisibility("visible");
    vi.useFakeTimers();
    const onChange = vi.fn();
    const probeError = new Error("network timeout");
    let callCount = 0;
    const probe = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(probeError);
      return Promise.resolve("v1");
    });

    const { result } = renderHook(() =>
      useVisibilityPoll({
        signal: "v1",
        probe,
        onChange,
        resetKey: "p1",
      }),
    );

    // Initial probe resolves (rejects)
    await act(async () => {
      await vi.advanceTimersByTime(0);
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(result.current.error).toBe(probeError);

    // Next interval: probe fires again
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe("POLL_INTERVAL_MS", () => {
  test("is 15_000", () => {
    expect(POLL_INTERVAL_MS).toBe(15_000);
  });
});
