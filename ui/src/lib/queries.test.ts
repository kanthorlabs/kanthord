// S5 — query option factories: healthQueryOptions, projectQueryOptions, useProjectSummary.
// Covers: query keys, queryFn unwraps data, no Authorization header in either mode.
import { afterEach, describe, expect, test, vi } from "vitest";

interface RecordedCall {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function stubFetch(
  status: number,
  body: unknown,
): { calls: RecordedCall[]; restore: () => void } {
  const calls: RecordedCall[] = [];
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(
        (init?.headers ?? {}) as Record<string, string>,
      )) {
        headers[k.toLowerCase()] = v;
      }
      calls.push({ url: String(input), headers });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    });
  return { calls, restore: () => spy.mockRestore() };
}

function withRuntime(base: string | undefined, run: () => Promise<void>) {
  if (base === undefined) {
    delete globalThis.kanthord;
  } else {
    globalThis.kanthord = { apiBaseUrl: base };
  }
  return run().finally(() => {
    delete globalThis.kanthord;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.kanthord;
});

describe("healthQueryOptions", () => {
  test("queryKey is ['healthz']", async () => {
    const { healthQueryOptions } = await import("./queries");
    expect(healthQueryOptions().queryKey).toEqual(["healthz"]);
  });

  test("queryFn unwraps the data envelope and returns {status, version}", async () => {
    const { healthQueryOptions } = await import("./queries");
    const { calls, restore } = stubFetch(200, {
      data: { status: "ok", version: "27.8.1" },
    });
    await withRuntime(undefined, async () => {
      const result = await healthQueryOptions().queryFn();
      expect(result).toEqual({ status: "ok", version: "27.8.1" });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/healthz");
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
    restore();
  });

  test("injected-base mode: recorded URL is prefixed and still no Authorization", async () => {
    const { healthQueryOptions } = await import("./queries");
    const { calls, restore } = stubFetch(200, {
      data: { status: "ok", version: "27.8.1" },
    });
    await withRuntime("http://127.0.0.1:4100", async () => {
      await healthQueryOptions().queryFn();
    });
    expect(calls[0]?.url).toBe("http://127.0.0.1:4100/healthz");
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
    restore();
  });
});

describe("projectQueryOptions", () => {
  test("queryKey is ['project', id]", async () => {
    const { projectQueryOptions } = await import("./queries");
    expect(projectQueryOptions("p1").queryKey).toEqual(["project", "p1"]);
  });

  test("queryFn unwraps the data envelope and returns {id, name}", async () => {
    const { projectQueryOptions } = await import("./queries");
    const { calls, restore } = stubFetch(200, {
      data: { id: "p1", name: "alpha" },
    });
    await withRuntime(undefined, async () => {
      const result = await projectQueryOptions("p1").queryFn();
      expect(result).toEqual({ id: "p1", name: "alpha" });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/project/p1");
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
    restore();
  });

  test("no request carries an Authorization header in either mode", async () => {
    const { projectQueryOptions } = await import("./queries");
    // Same-origin mode
    const { calls: c1, restore: r1 } = stubFetch(200, {
      data: { id: "p1", name: "alpha" },
    });
    await withRuntime(undefined, async () => {
      await projectQueryOptions("p1").queryFn();
    });
    expect(c1[0]?.headers["authorization"]).toBeUndefined();
    r1();

    // Injected-base mode
    const { calls: c2, restore: r2 } = stubFetch(200, {
      data: { id: "p1", name: "alpha" },
    });
    await withRuntime("http://127.0.0.1:4100", async () => {
      await projectQueryOptions("p1").queryFn();
    });
    expect(c2[0]?.headers["authorization"]).toBeUndefined();
    r2();
  });
});

// --- human review regression tests ---

describe("S1: AbortSignal forwarding", () => {
  test("health queryFn forwards AbortSignal to fetch", async () => {
    const { healthQueryOptions } = await import("./queries");
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;

    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        capturedSignal = init?.signal as AbortSignal | undefined;
        return new Response(
          JSON.stringify({ data: { status: "ok", version: "27.8.1" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

    // TanStack Query calls queryFn(QueryFunctionContext) which includes signal
    await withRuntime(undefined, async () => {
      await healthQueryOptions().queryFn({
        signal: controller.signal,
      } as never);
    });

    // The signal must reach fetch so navigation can abort in-flight requests
    expect(capturedSignal).toBe(controller.signal);
    spy.mockRestore();
  });

  test("project queryFn forwards AbortSignal to fetch", async () => {
    const { projectQueryOptions } = await import("./queries");
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;

    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        capturedSignal = init?.signal as AbortSignal | undefined;
        return new Response(
          JSON.stringify({ data: { id: "p1", name: "alpha" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

    await withRuntime(undefined, async () => {
      await projectQueryOptions("p1").queryFn({
        signal: controller.signal,
      } as never);
    });

    expect(capturedSignal).toBe(controller.signal);
    spy.mockRestore();
  });
});
