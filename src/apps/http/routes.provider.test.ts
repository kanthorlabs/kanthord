// src/apps/http/routes.provider.test.ts — Story S8: ai-provider, model and
// queue rows, over the wire, fakes only, no server, no sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import { UnknownReferenceError } from "../../app/errors.ts";
import type { AiProviderView } from "../../app/ai-provider/ai-provider-view.ts";
import type { GetDecisionQueueOutput } from "../../app/project/get-decision-queue.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  return { info() {}, warn() {}, error() {} };
}

function providerFixture(): AiProviderView {
  return {
    id: "ap1",
    name: "provider one",
    provider: "anthropic",
    model: "claude",
    baseUrl: null,
    effort: null,
    state: "active",
    isDefault: true,
  };
}

function emptyQueueOutput(): GetDecisionQueueOutput {
  return {
    items: [],
    counts: { total: 0, byKind: {} },
    truncated: false,
    warnings: [],
  };
}

function makeDeps(): {
  deps: HttpDeps;
  received: Record<string, unknown>;
} {
  const received: Record<string, unknown> = {};
  const deps = {
    logger: makeLogger(),
    listAiProviders: {
      execute: (...args: unknown[]) => {
        received.listAiProvidersArgsLength = args.length;
        return [providerFixture()];
      },
    },
    getAiProvider: {
      execute: (id: string) => {
        received.getAiProvider = id;
        return providerFixture();
      },
    },
    resolveProjectChain: {
      execute: (projectId: string) => {
        received.resolveProjectChain = projectId;
        if (projectId === "missing") {
          throw new UnknownReferenceError("project", projectId);
        }
        return [providerFixture()];
      },
    },
    listModels: (provider?: string) => {
      received.listModels = provider;
      return [
        {
          provider: "anthropic",
          id: "claude-x",
          name: "Claude X",
          reasoning: true,
          contextWindow: 200000,
        },
      ];
    },
    getDecisionQueue: {
      execute: async (input: unknown) => {
        received.getDecisionQueue = input;
        return emptyQueueOutput();
      },
    },
  } as unknown as HttpDeps;
  return { deps, received };
}

test("GET /api/ai-provider is 200; the fake's execute received no argument", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/ai-provider")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.equal(received.listAiProvidersArgsLength, 0);
});

test("GET /api/ai-provider/a1 forwards the string 'a1'", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/ai-provider/a1")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.equal(received.getAiProvider, "a1");
});

test("GET /api/project/p1/ai-provider forwards the string 'p1'", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project/p1/ai-provider")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.equal(received.resolveProjectChain, "p1");
});

test("GET /api/project/missing/ai-provider where the fake throws UnknownReferenceError is 404 unknown_reference", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project/missing/ai-provider")
    .set("Authorization", AUTH);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_reference");
});

test("GET /api/model forwards undefined; ?provider=anthropic forwards 'anthropic'", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res1 = await request(app.callback())
    .get("/api/model")
    .set("Authorization", AUTH);
  assert.equal(res1.status, 200);
  assert.equal(received.listModels, undefined);

  const res2 = await request(app.callback())
    .get("/api/model?provider=anthropic")
    .set("Authorization", AUTH);
  assert.equal(res2.status, 200);
  assert.equal(received.listModels, "anthropic");
});

test("GET /api/queue forwards {}; ?limit=5 forwards { limit: 5 }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res1 = await request(app.callback())
    .get("/api/queue")
    .set("Authorization", AUTH);
  assert.equal(res1.status, 200);
  assert.deepEqual(received.getDecisionQueue, {});

  const res2 = await request(app.callback())
    .get("/api/queue?limit=5")
    .set("Authorization", AUTH);
  assert.equal(res2.status, 200);
  assert.deepEqual(received.getDecisionQueue, { limit: 5 });
});

for (const bad of ["0", "501", "abc"]) {
  test(`GET /api/queue?limit=${bad} is 400 invalid_input, use case not called`, async () => {
    const { deps, received } = makeDeps();
    const app = buildHttpApp(deps, {
      apiKey: KEY,
      newRequestId: () => REQUEST_ID,
    });
    const res = await request(app.callback())
      .get(`/api/queue?limit=${bad}`)
      .set("Authorization", AUTH);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "invalid_input");
    assert.equal("getDecisionQueue" in received, false);
  });
}
