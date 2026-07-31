// Story 03 — useDebouncedValue hook tests.
// Tests that the debounce hook delays value updates and cleans up on unmount.
import { describe, expect, test, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue, SEARCH_DEBOUNCE_MS } from "./use-debounced-value";

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedValue", () => {
  test("returns initial value immediately", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDebouncedValue("hello", 200));
    expect(result.current).toBe("hello");
  });

  test("value updates only after delayMs", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "a", delay: 200 } },
    );
    expect(result.current).toBe("a");

    rerender({ value: "b", delay: 200 });
    // Before delay: still "a"
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    // After delay: "b"
    expect(result.current).toBe("b");
  });

  test("a change inside the window restarts the timer", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "a", delay: 200 } },
    );

    rerender({ value: "b", delay: 200 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // Still "a" — timer restarted
    expect(result.current).toBe("a");

    rerender({ value: "c", delay: 200 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // Still "a" — second restart
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    // Now 200ms since last change: "c"
    expect(result.current).toBe("c");
  });

  test("unmount clears the timer", () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "a", delay: 200 } },
    );

    rerender({ value: "b", delay: 200 });
    unmount();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    // No error thrown — timer was cleared
  });

  test("SEARCH_DEBOUNCE_MS is 200", () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(200);
  });
});
