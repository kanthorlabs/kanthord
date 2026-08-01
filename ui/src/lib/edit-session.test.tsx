// Story 01 Verify — edit-session: frozen validator, 412 conflict, reload re-arms,
// 428 client-defect, 404 missing, success, stale guard.
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { type ReactElement } from "react";
import { useEditSession } from "./edit-session";
import type { EditSessionOptions } from "./edit-session";
import type { Etagged, ApiError } from "./api-client";
import { ApiError as ApiErrorClass } from "./api-client";

// --- Harness ---

interface HarnessProps<T, D> {
  readonly options: EditSessionOptions<T, D>;
}

function Harness<T, D>({ options }: HarnessProps<T, D>): ReactElement {
  const session = useEditSession<T, D>(options);
  return (
    <div>
      <span data-testid="status">{session.status}</span>
      <span data-testid="base-etag">{session.base?.etag ?? "null"}</span>
      <span data-testid="base-data">{JSON.stringify(session.base?.data)}</span>
      <span data-testid="draft">{JSON.stringify(session.draft)}</span>
      <span data-testid="current">{JSON.stringify(session.current)}</span>
      <span data-testid="error">{session.error?.message ?? "null"}</span>
      <span data-testid="error-status">
        {session.error
          ? String((session.error as ApiError).status ?? "none")
          : "none"}
      </span>
      <button data-testid="open" onClick={() => session.open()}>
        open
      </button>
      <button
        data-testid="set-draft-a"
        onClick={() => session.setDraft("a" as D)}
      >
        set-draft-a
      </button>
      <button
        data-testid="set-draft-b"
        onClick={() => session.setDraft("b" as D)}
      >
        set-draft-b
      </button>
      <button data-testid="submit" onClick={() => session.submit()}>
        submit
      </button>
      <button data-testid="reload" onClick={() => session.reload()}>
        reload
      </button>
      <button data-testid="reset" onClick={() => session.reset()}>
        reset
      </button>
      <button data-testid="close" onClick={() => session.close()}>
        close
      </button>
    </div>
  );
}

function makeEtagged<T>(data: T, etag: string): Etagged<T> {
  return { data, etag };
}

function makeApiError(status: number, code: string, message: string): ApiError {
  return new ApiErrorClass(status, code, message);
}

// --- Tests ---

describe("useEditSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
  });

  test("frozen validator: cache update while dirty does not change submitted If-Match", async () => {
    const load = vi
      .fn()
      .mockResolvedValue(makeEtagged({ name: "original" }, '"v1"'));
    const save = vi
      .fn()
      .mockResolvedValue(makeEtagged({ name: "saved" }, '"v2"'));
    const onSaved = vi.fn();

    render(
      <Harness
        options={{
          load,
          toDraft: (d: { name: string }) => d.name,
          save,
          onSaved,
        }}
      />,
    );

    // Open the session
    await act(async () => {
      screen.getByTestId("open").click();
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId("status").textContent).toBe("editing");
    expect(screen.getByTestId("base-etag").textContent).toBe('"v1"');

    // Set draft twice
    act(() => {
      screen.getByTestId("set-draft-a").click();
    });
    act(() => {
      screen.getByTestId("set-draft-b").click();
    });
    expect(screen.getByTestId("draft").textContent).toBe('"b"');

    // Submit — must use the frozen '"v1"' etag
    await act(async () => {
      screen.getByTestId("submit").click();
      await vi.runAllTimersAsync();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("b", '"v1"');
  });

  test("412 → conflict: draft unchanged, current from recovery load", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(makeEtagged({ name: "v1" }, '"v1"'))
      .mockResolvedValueOnce(makeEtagged({ name: "v2" }, '"v2"'));
    const save = vi
      .fn()
      .mockRejectedValue(
        makeApiError(412, "precondition_failed", "precondition failed"),
      );

    render(
      <Harness
        options={{ load, toDraft: (d: { name: string }) => d.name, save }}
      />,
    );

    // Open
    await act(async () => {
      screen.getByTestId("open").click();
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId("status").textContent).toBe("editing");

    // Set draft and submit
    act(() => {
      screen.getByTestId("set-draft-a").click();
    });
    await act(async () => {
      screen.getByTestId("submit").click();
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("status").textContent).toBe("conflict");
    expect(screen.getByTestId("draft").textContent).toBe('"a"');
    expect(screen.getByTestId("base-data").textContent).toBe(
      JSON.stringify({ name: "v1" }),
    );
    expect(screen.getByTestId("current").textContent).toBe(
      JSON.stringify({ name: "v2" }),
    );
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("reload re-arms: status → editing, draft preserved, base.etag updated", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(makeEtagged({ name: "v1" }, '"v1"'))
      .mockResolvedValueOnce(makeEtagged({ name: "v2" }, '"v2"'))
      .mockResolvedValueOnce(makeEtagged({ name: "v3" }, '"v3"'));
    const save = vi
      .fn()
      .mockRejectedValueOnce(
        makeApiError(412, "precondition_failed", "precondition failed"),
      )
      .mockResolvedValueOnce(makeEtagged({ name: "saved" }, '"v4"'));

    render(
      <Harness
        options={{ load, toDraft: (d: { name: string }) => d.name, save }}
      />,
    );

    // Open and get to conflict
    await act(async () => {
      screen.getByTestId("open").click();
      await vi.runAllTimersAsync();
    });
    act(() => {
      screen.getByTestId("set-draft-a").click();
    });
    await act(async () => {
      screen.getByTestId("submit").click();
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId("status").textContent).toBe("conflict");

    // Reload
    await act(async () => {
      screen.getByTestId("reload").click();
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId("status").textContent).toBe("editing");
    expect(screen.getByTestId("draft").textContent).toBe('"a"');
    expect(screen.getByTestId("base-etag").textContent).toBe('"v3"');
    expect(screen.getByTestId("current").textContent).toBe("null");

    // Submit with the re-armed etag
    await act(async () => {
      screen.getByTestId("submit").click();
      await vi.runAllTimersAsync();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith("a", '"v3"');
  });

  test("second 412 repeats the cycle with draft intact", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(makeEtagged({ name: "v1" }, '"v1"'))
      .mockResolvedValueOnce(makeEtagged({ name: "v2" }, '"v2"'))
      .mockResolvedValueOnce(makeEtagged({ name: "v3" }, '"v3"'))
      .mockResolvedValueOnce(makeEtagged({ name: "v4" }, '"v4"'));
    const save = vi
      .fn()
      .mockRejectedValue(
        makeApiError(412, "precondition_failed", "precondition failed"),
      );

    render(
      <Harness
        options={{ load, toDraft: (d: { name: string }) => d.name, save }}
      />,
    );

    // Open → editing
    await act(async () => {
      screen.getByTestId("open").click();
      await vi.runAllTimersAsync();
    });
    act(() => {
      screen.getByTestId("set-draft-a").click();
    });

    // Submit #1 → conflict
    await act(async () => {
      screen.getByTestId("submit").click();
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId("status").textContent).toBe("conflict");
    expect(screen.getByTestId("draft").textContent).toBe('"a"');

    // Reload → editing
    await act(async () => {
      screen.getByTestId("reload").click();
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId("status").textContent).toBe("editing");
    expect(screen.getByTestId("draft").textContent).toBe('"a"');

    // Submit #2 → conflict again
    await act(async () => {
      screen.getByTestId("submit").click();
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId("status").textContent).toBe("conflict");
    expect(screen.getByTestId("draft").textContent).toBe('"a"');
  });

  test("428 → client-defect, never conflict", async () => {
    const load = vi.fn().mockResolvedValue(makeEtagged({ name: "v1" }, '"v1"'));
    const save = vi
      .fn()
      .mockRejectedValue(
        makeApiError(428, "precondition_required", "precondition required"),
      );

    render(
      <Harness
        options={{ load, toDraft: (d: { name: string }) => d.name, save }}
      />,
    );

    await act(async () => {
      screen.getByTestId("open").click();
      await vi.runAllTimersAsync();
    });
    act(() => {
      screen.getByTestId("set-draft-a").click();
    });
    await act(async () => {
      screen.getByTestId("submit").click();
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("status").textContent).toBe("client-defect");
    expect(screen.getByTestId("error").textContent).toBe(
      "precondition required",
    );
    expect(screen.getByTestId("error-status").textContent).toBe("428");
  });

  test("404 during recovery → missing", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(makeEtagged({ name: "v1" }, '"v1"'))
      .mockResolvedValueOnce(makeEtagged({ name: "v2" }, '"v2"'))
      .mockRejectedValue(makeApiError(404, "not_found", "not found"));
    const save = vi
      .fn()
      .mockRejectedValue(
        makeApiError(412, "precondition_failed", "precondition failed"),
      );

    render(
      <Harness
        options={{ load, toDraft: (d: { name: string }) => d.name, save }}
      />,
    );

    await act(async () => {
      screen.getByTestId("open").click();
      await vi.runAllTimersAsync();
    });
    act(() => {
      screen.getByTestId("set-draft-a").click();
    });

    // Submit → 412 → recovery load succeeds → conflict
    await act(async () => {
      screen.getByTestId("submit").click();
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId("status").textContent).toBe("conflict");

    // Reload → 404 → missing
    await act(async () => {
      screen.getByTestId("reload").click();
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId("status").textContent).toBe("missing");
    expect(screen.getByTestId("error").textContent).toBe("not found");
  });

  test("success: save resolves, onSaved called once, status closed, base null", async () => {
    const savedData = { name: "saved" };
    const load = vi
      .fn()
      .mockResolvedValue(makeEtagged({ name: "original" }, '"v1"'));
    const save = vi.fn().mockResolvedValue(makeEtagged(savedData, '"v2"'));
    const onSaved = vi.fn();

    render(
      <Harness
        options={{
          load,
          toDraft: (d: { name: string }) => d.name,
          save,
          onSaved,
        }}
      />,
    );

    await act(async () => {
      screen.getByTestId("open").click();
      await vi.runAllTimersAsync();
    });
    act(() => {
      screen.getByTestId("set-draft-a").click();
    });
    await act(async () => {
      screen.getByTestId("submit").click();
      await vi.runAllTimersAsync();
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ data: savedData, etag: '"v2"' }),
    );
    expect(screen.getByTestId("status").textContent).toBe("closed");
    expect(screen.getByTestId("base-etag").textContent).toBe("null");
  });

  test("no retry: after 412, save called exactly once", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(makeEtagged({ name: "v1" }, '"v1"'))
      .mockResolvedValueOnce(makeEtagged({ name: "v2" }, '"v2"'));
    const save = vi
      .fn()
      .mockRejectedValue(
        makeApiError(412, "precondition_failed", "precondition failed"),
      );

    render(
      <Harness
        options={{ load, toDraft: (d: { name: string }) => d.name, save }}
      />,
    );

    await act(async () => {
      screen.getByTestId("open").click();
      await vi.runAllTimersAsync();
    });
    act(() => {
      screen.getByTestId("set-draft-a").click();
    });
    await act(async () => {
      screen.getByTestId("submit").click();
      await vi.runAllTimersAsync();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status").textContent).toBe("conflict");
  });

  test("stale guard: open twice with first load resolving after second", async () => {
    let resolveFirst: (value: Etagged<{ name: string }>) => void;
    const firstLoad = new Promise<Etagged<{ name: string }>>((r) => {
      resolveFirst = r;
    });
    const load = vi
      .fn()
      .mockReturnValueOnce(firstLoad)
      .mockResolvedValueOnce(makeEtagged({ name: "second" }, '"v2"'));
    const save = vi.fn();

    render(
      <Harness
        options={{ load, toDraft: (d: { name: string }) => d.name, save }}
      />,
    );

    // Open #1
    act(() => {
      screen.getByTestId("open").click();
    });
    expect(screen.getByTestId("status").textContent).toBe("loading");

    // Open #2 — this resolves before the first
    await act(async () => {
      screen.getByTestId("open").click();
      await vi.runAllTimersAsync();
    });

    // First load resolves after the second — stale, should be ignored
    await act(async () => {
      resolveFirst!(makeEtagged({ name: "first" }, '"v1"'));
      await vi.runAllTimersAsync();
    });

    // State should reflect the second resolution
    expect(screen.getByTestId("status").textContent).toBe("editing");
    expect(screen.getByTestId("base-etag").textContent).toBe('"v2"');
    expect(screen.getByTestId("draft").textContent).toBe('"second"');
  });

  test("loading 404 → missing status", async () => {
    const load = vi
      .fn()
      .mockRejectedValue(makeApiError(404, "not_found", "not found"));

    render(
      <Harness
        options={{
          load,
          toDraft: (d: { name: string }) => d.name,
          save: vi.fn(),
        }}
      />,
    );

    await act(async () => {
      screen.getByTestId("open").click();
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("status").textContent).toBe("missing");
  });
});
