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
  apiGetWithEtag,
  apiPatch,
  apiPostCreated,
  apiPostNoContent,
  apiDeleteNoContent,
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

// --- Story 01: write transport helpers ---

function stubFetchWithHeaders(
  status: number,
  body: unknown,
  responseHeaders: Record<string, string> = {},
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
        headers: {
          "content-type": "application/json",
          ...responseHeaders,
        },
      });
    });
  return { calls, restore: () => spy.mockRestore() };
}

describe("apiGetWithEtag", () => {
  test("200 with etag returns data and etag", async () => {
    const { calls, restore } = stubFetchWithHeaders(
      200,
      { data: { id: "p1", name: "test" } },
      { etag: '"abc"' },
    );
    await withRuntime(undefined, async () => {
      const result = await apiGetWithEtag<{ id: string; name: string }>(
        "/api/project/p1",
      );
      expect(result).toEqual({
        data: { id: "p1", name: "test" },
        etag: '"abc"',
      });
    });
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual(["accept"]);
    restore();
  });

  test("200 with no etag header throws ApiError(500, missing_etag)", async () => {
    const { restore } = stubFetchWithHeaders(200, { data: {} });
    await withRuntime(undefined, async () => {
      await expect(apiGetWithEtag("/api/project/p1")).rejects.toMatchObject({
        name: "ApiError",
        status: 500,
        code: "missing_etag",
      });
    });
    restore();
  });
});

describe("apiPatch", () => {
  test("sends method PATCH, headers exactly accept/content-type/if-match, if-match byte-identical", async () => {
    const { calls, restore } = stubFetchWithHeaders(
      200,
      { data: { id: "p1", name: "x" } },
      { etag: '"v2"' },
    );
    await withRuntime(undefined, async () => {
      const result = await apiPatch<{ id: string; name: string }>(
        "/api/project/p1",
        { name: "x" },
        '"abc"',
      );
      expect(result).toEqual({ data: { id: "p1", name: "x" }, etag: '"v2"' });
    });
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual([
      "accept",
      "content-type",
      "if-match",
    ]);
    expect(calls[0]?.headers["if-match"]).toBe('"abc"');
    restore();
  });

  test("412 throws ApiError with code from envelope", async () => {
    const { restore } = stubFetchWithHeaders(412, {
      error: {
        code: "precondition_failed",
        message: "precondition failed",
        requestId: "r1",
      },
    });
    await withRuntime(undefined, async () => {
      await expect(
        apiPatch("/api/project/p1", { name: "x" }, '"abc"'),
      ).rejects.toMatchObject({
        name: "ApiError",
        status: 412,
        code: "precondition_failed",
        requestId: "r1",
      });
    });
    restore();
  });

  test("428 throws ApiError with status 428", async () => {
    const { restore } = stubFetchWithHeaders(428, {
      error: {
        code: "precondition_required",
        message: "precondition required",
      },
    });
    await withRuntime(undefined, async () => {
      await expect(
        apiPatch("/api/project/p1", { name: "x" }, '"abc"'),
      ).rejects.toMatchObject({
        name: "ApiError",
        status: 428,
      });
    });
    restore();
  });

  test("404 throws ApiError with status 404", async () => {
    const { restore } = stubFetchWithHeaders(404, {
      error: { code: "not_found" },
    });
    await withRuntime(undefined, async () => {
      await expect(
        apiPatch("/api/project/p1", { name: "x" }, '"abc"'),
      ).rejects.toMatchObject({
        name: "ApiError",
        status: 404,
      });
    });
    restore();
  });
});

describe("apiPostCreated", () => {
  test("201 with location returns data and location", async () => {
    const { restore } = stubFetchWithHeaders(
      201,
      { data: { id: "i1" } },
      { location: "/api/initiative/i1" },
    );
    await withRuntime(undefined, async () => {
      const result = await apiPostCreated<{ id: string }>(
        "/api/project/p1/initiative",
        { name: "test" },
      );
      expect(result).toEqual({
        data: { id: "i1" },
        location: "/api/initiative/i1",
      });
    });
    restore();
  });

  test("201 with no Location header throws ApiError(500, missing_location)", async () => {
    const { restore } = stubFetchWithHeaders(201, { data: { id: "i1" } });
    await withRuntime(undefined, async () => {
      await expect(
        apiPostCreated("/api/project/p1/initiative", { name: "test" }),
      ).rejects.toMatchObject({
        name: "ApiError",
        status: 500,
        code: "missing_location",
      });
    });
    restore();
  });

  test("200 (wrong status) throws ApiError with status 200", async () => {
    const { restore } = stubFetchWithHeaders(200, { data: { id: "i1" } });
    await withRuntime(undefined, async () => {
      await expect(
        apiPostCreated("/api/project/p1/initiative", { name: "test" }),
      ).rejects.toMatchObject({
        name: "ApiError",
        status: 200,
      });
    });
    restore();
  });
});

describe("apiPostNoContent and apiDeleteNoContent", () => {
  test("204 resolves to undefined and does not parse body", async () => {
    const jsonSpy = vi.spyOn(Response.prototype, "json");
    // jsdom's Response constructor rejects 204; use a manual mock
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
        return {
          status: 204,
          ok: false,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({}),
        } as unknown as Response;
      });
    await withRuntime(undefined, async () => {
      const result = await apiPostNoContent("/api/task/t1/dependency", {
        dependencyId: "t2",
      });
      expect(result).toBeUndefined();
    });
    // 204 path should not call response.json()
    expect(jsonSpy).not.toHaveBeenCalled();
    jsonSpy.mockRestore();
    spy.mockRestore();
  });

  test("apiDeleteNoContent 204 resolves to undefined", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return {
        status: 204,
        ok: false,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      } as unknown as Response;
    });
    await withRuntime(undefined, async () => {
      const result = await apiDeleteNoContent("/api/task/t1/dependency/t2");
      expect(result).toBeUndefined();
    });
    spy.mockRestore();
  });

  test("apiPostNoContent on 409 throws ApiError with code from envelope", async () => {
    const { restore } = stubFetch(409, {
      error: {
        code: "cycle_detected",
        message: "That edge would close a cycle.",
      },
    });
    await withRuntime(undefined, async () => {
      await expect(
        apiPostNoContent("/api/task/t1/dependency", { dependencyId: "t2" }),
      ).rejects.toMatchObject({
        name: "ApiError",
        status: 409,
        code: "cycle_detected",
      });
    });
    restore();
  });
});

describe("R3 — no Authorization header in write helpers", () => {
  test("apiGetWithEtag sets only accept", async () => {
    const { calls, restore } = stubFetchWithHeaders(
      200,
      { data: {} },
      { etag: '"x"' },
    );
    await withRuntime(undefined, async () => {
      await apiGetWithEtag("/api/project/p1");
    });
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual(["accept"]);
    restore();
  });

  test("apiPatch sets only accept, content-type, if-match", async () => {
    const { calls, restore } = stubFetchWithHeaders(
      200,
      { data: {} },
      { etag: '"x"' },
    );
    await withRuntime(undefined, async () => {
      await apiPatch("/api/project/p1", { name: "x" }, '"abc"');
    });
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual([
      "accept",
      "content-type",
      "if-match",
    ]);
    restore();
  });

  test("apiPostCreated sets only accept, content-type", async () => {
    const { calls, restore } = stubFetchWithHeaders(
      201,
      { data: {} },
      { location: "/x" },
    );
    await withRuntime(undefined, async () => {
      await apiPostCreated("/api/project", { name: "x" });
    });
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual([
      "accept",
      "content-type",
    ]);
    restore();
  });

  test("apiPostNoContent sets only accept, content-type", async () => {
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
        return {
          status: 204,
          ok: false,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({}),
        } as unknown as Response;
      });
    await withRuntime(undefined, async () => {
      await apiPostNoContent("/api/task/t1/dependency", { dependencyId: "t2" });
    });
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual([
      "accept",
      "content-type",
    ]);
    spy.mockRestore();
  });

  test("apiDeleteNoContent sets only accept", async () => {
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
        return {
          status: 204,
          ok: false,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({}),
        } as unknown as Response;
      });
    await withRuntime(undefined, async () => {
      await apiDeleteNoContent("/api/task/t1/dependency/t2");
    });
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual(["accept"]);
    spy.mockRestore();
  });
});
