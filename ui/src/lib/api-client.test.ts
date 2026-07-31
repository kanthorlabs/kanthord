// EPIC 026 Verification Gate: api-client builds request URLs from
// runtime.apiBaseUrl for BOTH "" and an injected base, and sets no
// Authorization header in either case (rule R3).
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  apiGet,
  apiUrl,
  ApiError,
  apiPath,
  fetchProjects,
  fetchProject,
  fetchProjectOverview,
  fetchResources,
  fetchResource,
} from "./api-client";
import { apiBaseUrl } from "./runtime";

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

describe("runtime.apiBaseUrl", () => {
  test("is empty when no host shell injected one — same origin", () => {
    delete globalThis.kanthord;
    expect(apiBaseUrl()).toBe("");
  });

  test("returns an injected base and strips a trailing slash", () => {
    globalThis.kanthord = { apiBaseUrl: "http://127.0.0.1:4100/" };
    expect(apiBaseUrl()).toBe("http://127.0.0.1:4100");
  });

  test("reads the global per call, not at module scope (R6)", () => {
    delete globalThis.kanthord;
    expect(apiBaseUrl()).toBe("");
    globalThis.kanthord = { apiBaseUrl: "http://127.0.0.1:4100" };
    expect(apiBaseUrl()).toBe("http://127.0.0.1:4100");
  });
});

describe("apiUrl", () => {
  test("same-origin base leaves the path absolute", () => {
    delete globalThis.kanthord;
    expect(apiUrl("/healthz")).toBe("/healthz");
  });

  test("an injected base is prefixed", () => {
    globalThis.kanthord = { apiBaseUrl: "http://127.0.0.1:4100" };
    expect(apiUrl("/api/project")).toBe("http://127.0.0.1:4100/api/project");
  });

  test("a path that does not start with / is refused", () => {
    expect(() => apiUrl("healthz")).toThrow(/must start with/);
  });
});

describe("apiGet", () => {
  test("same-origin mode: requests the bare path and sends no Authorization", async () => {
    const { calls, restore } = stubFetch(200, { data: { version: "27.8.1" } });
    await withRuntime(undefined, async () => {
      const data = await apiGet<{ version: string }>("/healthz");
      expect(data).toEqual({ version: "27.8.1" });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/healthz");
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
    restore();
  });

  test("injected-base mode: requests the prefixed URL and still sends no Authorization", async () => {
    const { calls, restore } = stubFetch(200, { data: { version: "27.8.1" } });
    await withRuntime("http://127.0.0.1:4100", async () => {
      await apiGet<{ version: string }>("/healthz");
    });
    expect(calls[0]?.url).toBe("http://127.0.0.1:4100/healthz");
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
    restore();
  });

  test("no ui/ code path can add an auth header: every recorded header is inert", async () => {
    const { calls, restore } = stubFetch(200, { data: {} });
    await withRuntime(undefined, async () => {
      await apiGet("/healthz");
    });
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual(["accept"]);
    restore();
  });

  test("a non-2xx answer becomes an ApiError carrying the envelope code", async () => {
    const { restore } = stubFetch(404, {
      error: { code: "not_found", message: "no such project", requestId: "R1" },
    });
    await withRuntime(undefined, async () => {
      await expect(apiGet("/api/project/nope")).rejects.toMatchObject({
        name: "ApiError",
        status: 404,
        code: "not_found",
        requestId: "R1",
      });
    });
    restore();
  });

  test("a non-2xx answer with no envelope still becomes an ApiError", async () => {
    const { restore } = stubFetch(500, "not json at all");
    await withRuntime(undefined, async () => {
      const error = await apiGet("/healthz").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("transport_error");
    });
    restore();
  });
});

// --- Story 02: api-path builder and fetch helpers ---

describe("apiPath", () => {
  test("returns the bare path when no params", () => {
    expect(apiPath("/api/project")).toBe("/api/project");
  });

  test("appends defined, non-empty params", () => {
    expect(apiPath("/api/project", { name: "alpha" })).toBe(
      "/api/project?name=alpha",
    );
  });

  test("skips undefined params", () => {
    expect(apiPath("/api/project", { name: undefined })).toBe("/api/project");
  });

  test("skips empty-string params", () => {
    expect(apiPath("/api/project", { name: "" })).toBe("/api/project");
  });

  test("multiple params are joined with &", () => {
    expect(apiPath("/api/search", { q: "foo", page: "1" })).toBe(
      "/api/search?q=foo&page=1",
    );
  });
});

describe("fetchProjects", () => {
  test("fetches /api/project with no name param", async () => {
    const { calls, restore } = stubFetch(200, {
      data: [{ id: "p1", name: "alpha" }],
    });
    await withRuntime(undefined, async () => {
      const result = await fetchProjects();
      expect(result).toEqual([{ id: "p1", name: "alpha" }]);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/project");
    restore();
  });

  test("fetchProjects('alpha') requests /api/project?name=alpha", async () => {
    const { calls, restore } = stubFetch(200, { data: [] });
    await withRuntime(undefined, async () => {
      await fetchProjects("alpha");
    });
    expect(calls[0]?.url).toBe("/api/project?name=alpha");
    restore();
  });

  test("fetchProjects('') requests /api/project — no name=", async () => {
    const { calls, restore } = stubFetch(200, { data: [] });
    await withRuntime(undefined, async () => {
      await fetchProjects("");
    });
    expect(calls[0]?.url).toBe("/api/project");
    restore();
  });
});

describe("fetchProject", () => {
  test("fetches /api/project/p1", async () => {
    const { calls, restore } = stubFetch(200, {
      data: { id: "p1", name: "alpha" },
    });
    await withRuntime(undefined, async () => {
      const result = await fetchProject("p1");
      expect(result).toEqual({ id: "p1", name: "alpha" });
    });
    expect(calls[0]?.url).toBe("/api/project/p1");
    restore();
  });
});

describe("fetchProjectOverview", () => {
  test("fetches /api/project/p1/overview", async () => {
    const { calls, restore } = stubFetch(200, {
      data: {
        projectId: "p1",
        initiatives: [],
        lanes: [],
        decisions: [],
        digest: {},
      },
    });
    await withRuntime(undefined, async () => {
      await fetchProjectOverview("p1");
    });
    expect(calls[0]?.url).toBe("/api/project/p1/overview");
    restore();
  });
});

describe("fetchResources", () => {
  test("fetches /api/project/p1/credential", async () => {
    const { calls, restore } = stubFetch(200, { data: [] });
    await withRuntime(undefined, async () => {
      await fetchResources("p1", "credential");
    });
    expect(calls[0]?.url).toBe("/api/project/p1/credential");
    restore();
  });

  test("fetchResources with name appends ?name=", async () => {
    const { calls, restore } = stubFetch(200, { data: [] });
    await withRuntime(undefined, async () => {
      await fetchResources("p1", "credential", "k1");
    });
    expect(calls[0]?.url).toBe("/api/project/p1/credential?name=k1");
    restore();
  });
});

describe("fetchResource", () => {
  test("fetches /api/resource/r1", async () => {
    const { calls, restore } = stubFetch(200, {
      data: { type: "credential", id: "r1", name: "k1", provider: "openai" },
    });
    await withRuntime(undefined, async () => {
      const result = await fetchResource("r1");
      expect(result).toMatchObject({ type: "credential", id: "r1" });
    });
    expect(calls[0]?.url).toBe("/api/resource/r1");
    restore();
  });

  test("id with slash is percent-encoded: /api/resource/a%2Fb", async () => {
    const { calls, restore } = stubFetch(200, {
      data: { type: "filesystem", id: "a/b", name: "fs", path: "/tmp" },
    });
    await withRuntime(undefined, async () => {
      await fetchResource("a/b");
    });
    expect(calls[0]?.url).toBe("/api/resource/a%2Fb");
    restore();
  });
});

describe("R3 — no Authorization header in any helper", () => {
  test("fetchProjects sets only accept header", async () => {
    const { calls, restore } = stubFetch(200, { data: [] });
    await withRuntime(undefined, async () => {
      await fetchProjects();
    });
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual(["accept"]);
    restore();
  });

  test("fetchProject sets only accept header", async () => {
    const { calls, restore } = stubFetch(200, {
      data: { id: "p1", name: "a" },
    });
    await withRuntime(undefined, async () => {
      await fetchProject("p1");
    });
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual(["accept"]);
    restore();
  });

  test("fetchResources sets only accept header", async () => {
    const { calls, restore } = stubFetch(200, { data: [] });
    await withRuntime(undefined, async () => {
      await fetchResources("p1", "repository");
    });
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual(["accept"]);
    restore();
  });

  test("fetchResource sets only accept header", async () => {
    const { calls, restore } = stubFetch(200, {
      data: { type: "credential", id: "r1", name: "k", provider: "x" },
    });
    await withRuntime(undefined, async () => {
      await fetchResource("r1");
    });
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual(["accept"]);
    restore();
  });
});

describe("ApiError from helpers", () => {
  test("404 from fetchProject surfaces as ApiError", async () => {
    const { restore } = stubFetch(404, {
      error: { code: "not_found", message: "no such project" },
    });
    await withRuntime(undefined, async () => {
      await expect(fetchProject("nope")).rejects.toMatchObject({
        name: "ApiError",
        status: 404,
        code: "not_found",
      });
    });
    restore();
  });
});
