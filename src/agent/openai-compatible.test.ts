/**
 * src/agent/openai-compatible.test.ts
 *
 * Story 004 — OpenAI-compatible provider account.
 * suite: openai-compatible provider
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProviderCredentialStore } from "./provider-credential-store.ts";
import { createProviderAccountRegistry } from "./provider-account-registry.ts";
import { buildProviderSession } from "./provider-session.ts";
import {
  createOpenAICompatibleConfigStore,
  type OpenAICompatibleConfig,
} from "./openai-compatible.ts";

// ---------------------------------------------------------------------------
// T1 — configured baseUrl resolves correctly
// ---------------------------------------------------------------------------

test("T1 — openai-compatible account resolves with configured baseUrl", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oc-t1-"));
  t.after(() => rm(dir, { recursive: true }));

  const store = createProviderCredentialStore({ dataRoot: dir });
  const registry = createProviderAccountRegistry({ dataRoot: dir, store });
  const configStore = createOpenAICompatibleConfigStore({ dataRoot: dir });

  const acct = await registry.add({ providerKind: "openai-compatible", label: "local-vllm" });
  await store.modify(acct.id, async () => ({ type: "api_key" as const, key: "sk-fake-key" }));

  const config: OpenAICompatibleConfig = {
    baseUrl: "http://localhost:8080/v1",
    api: "openai-completions",
    models: ["local-llama"],
  };
  await configStore.save(acct.id, config);

  const session = await buildProviderSession(
    { accountId: acct.id, modelId: "local-llama" },
    { registry, store, openaiCompatibleConfigStore: configStore },
  );

  assert.equal(
    session.model.baseUrl,
    "http://localhost:8080/v1",
    "baseUrl must equal the configured value",
  );
  assert.equal(session.model.id, "local-llama", "model id must match");
  assert.equal(session.model.provider, acct.id, "provider must be the account id");
  assert.equal(typeof session.streamFn, "function", "streamFn must be a function");
});

// ---------------------------------------------------------------------------
// T2 — typed errors for unknown account/model and missing key
// ---------------------------------------------------------------------------

test("T2 — unknown account id is a typed error naming the id", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oc-t2-a-"));
  t.after(() => rm(dir, { recursive: true }));

  const store = createProviderCredentialStore({ dataRoot: dir });
  const registry = createProviderAccountRegistry({ dataRoot: dir, store });
  const configStore = createOpenAICompatibleConfigStore({ dataRoot: dir });

  await assert.rejects(
    () =>
      buildProviderSession(
        { accountId: "unknown-acct-id", modelId: "some-model" },
        { registry, store, openaiCompatibleConfigStore: configStore },
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error, "must throw an Error");
      assert.ok(
        err.message.includes("unknown-acct-id"),
        `error message must name the id; got: ${err.message}`,
      );
      return true;
    },
  );
});

test("T2 — unknown model id is a typed error naming the model id", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oc-t2-b-"));
  t.after(() => rm(dir, { recursive: true }));

  const store = createProviderCredentialStore({ dataRoot: dir });
  const registry = createProviderAccountRegistry({ dataRoot: dir, store });
  const configStore = createOpenAICompatibleConfigStore({ dataRoot: dir });

  const acct = await registry.add({ providerKind: "openai-compatible", label: "test-ep" });
  await store.modify(acct.id, async () => ({ type: "api_key" as const, key: "sk-fake" }));
  await configStore.save(acct.id, {
    baseUrl: "http://localhost:8080/v1",
    api: "openai-completions",
    models: ["known-model"],
  });

  await assert.rejects(
    () =>
      buildProviderSession(
        { accountId: acct.id, modelId: "unknown-model-id" },
        { registry, store, openaiCompatibleConfigStore: configStore },
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error, "must throw an Error");
      assert.ok(
        err.message.includes("unknown-model-id"),
        `error message must name the model id; got: ${err.message}`,
      );
      return true;
    },
  );
});

test("T2 — account with no stored api-key is a typed unconfigured-account error", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oc-t2-c-"));
  t.after(() => rm(dir, { recursive: true }));

  const store = createProviderCredentialStore({ dataRoot: dir });
  const registry = createProviderAccountRegistry({ dataRoot: dir, store });
  const configStore = createOpenAICompatibleConfigStore({ dataRoot: dir });

  const acct = await registry.add({ providerKind: "openai-compatible", label: "no-key-ep" });
  // intentionally do NOT store an api-key for this account
  await configStore.save(acct.id, {
    baseUrl: "http://localhost:8080/v1",
    api: "openai-completions",
    models: ["some-model"],
  });

  await assert.rejects(
    () =>
      buildProviderSession(
        { accountId: acct.id, modelId: "some-model" },
        { registry, store, openaiCompatibleConfigStore: configStore },
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error, "must throw an Error");
      assert.ok(
        err.message.toLowerCase().includes("unconfigured") ||
          err.message.toLowerCase().includes("no api") ||
          err.message.toLowerCase().includes("missing key") ||
          err.message.toLowerCase().includes("no key"),
        `error message must describe the missing api-key; got: ${err.message}`,
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// T2-B2 — createProvider: api discrimination + no ambient key fallback
// ---------------------------------------------------------------------------

test("T2-B2 — api 'openai-completions' config resolves to a session with model.api 'openai-completions'", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oc-b2-comp-"));
  t.after(() => rm(dir, { recursive: true }));

  const store = createProviderCredentialStore({ dataRoot: dir });
  const registry = createProviderAccountRegistry({ dataRoot: dir, store });
  const configStore = createOpenAICompatibleConfigStore({ dataRoot: dir });

  const acct = await registry.add({ providerKind: "openai-compatible", label: "completions-ep" });
  await store.modify(acct.id, async () => ({ type: "api_key" as const, key: "sk-completions-key" }));
  await configStore.save(acct.id, {
    baseUrl: "http://localhost:8080/v1",
    api: "openai-completions",
    models: ["local-model"],
  });

  const session = await buildProviderSession(
    { accountId: acct.id, modelId: "local-model" },
    { registry, store, openaiCompatibleConfigStore: configStore },
  );

  assert.equal(
    session.model.api,
    "openai-completions",
    "model.api must match the configured completions api",
  );
});

test("T2-B2 — api 'openai-responses' config resolves to a session with model.api 'openai-responses'", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oc-b2-resp-"));
  t.after(() => rm(dir, { recursive: true }));

  const store = createProviderCredentialStore({ dataRoot: dir });
  const registry = createProviderAccountRegistry({ dataRoot: dir, store });
  const configStore = createOpenAICompatibleConfigStore({ dataRoot: dir });

  const acct = await registry.add({ providerKind: "openai-compatible", label: "responses-ep" });
  await store.modify(acct.id, async () => ({ type: "api_key" as const, key: "sk-responses-key" }));
  await configStore.save(acct.id, {
    baseUrl: "http://localhost:9090/v1",
    api: "openai-responses",
    models: ["remote-model"],
  });

  const session = await buildProviderSession(
    { accountId: acct.id, modelId: "remote-model" },
    { registry, store, openaiCompatibleConfigStore: configStore },
  );

  assert.equal(
    session.model.api,
    "openai-responses",
    "model.api must match the configured responses api",
  );
});

test("T2-B2 — OPENAI_API_KEY in env but no stored credential is a typed unconfigured-account error", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oc-b2-ambient-"));
  t.after(() => rm(dir, { recursive: true }));

  // Set ambient key — no-network guard blocks reads of credential env vars,
  // so we cannot save/restore the previous value; unconditional set + delete is safe.
  // Production code must not fall back to this; it must throw for a missing stored key.
  process.env["OPENAI_API_KEY"] = "sk-ambient-should-not-be-used";
  t.after(() => {
    delete process.env["OPENAI_API_KEY"];
  });

  const store = createProviderCredentialStore({ dataRoot: dir });
  const registry = createProviderAccountRegistry({ dataRoot: dir, store });
  const configStore = createOpenAICompatibleConfigStore({ dataRoot: dir });

  const acct = await registry.add({ providerKind: "openai-compatible", label: "no-key-ep" });
  // intentionally no stored credential — OPENAI_API_KEY must not substitute
  await configStore.save(acct.id, {
    baseUrl: "http://custom-endpoint:8080/v1",
    api: "openai-completions",
    models: ["custom-model"],
  });

  await assert.rejects(
    () =>
      buildProviderSession(
        { accountId: acct.id, modelId: "custom-model" },
        { registry, store, openaiCompatibleConfigStore: configStore },
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error, "must throw an Error when no stored key");
      assert.ok(
        err.message.toLowerCase().includes("unconfigured") ||
          err.message.toLowerCase().includes("no api") ||
          err.message.toLowerCase().includes("missing key") ||
          err.message.toLowerCase().includes("no key"),
        `error must describe missing api-key (not fall back to ambient key); got: ${err.message}`,
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// T2-B2 api-discrimination (payload-level) — proves which ProviderStreams is wired
//
// The model.api assertion above is tautological (data round-trip from config).
// These tests call streamFn with an onPayload hook to capture the HTTP request
// body *before* it is sent, proving the correct ProviderStreams implementation
// (openAICompletionsApi vs openAIResponsesApi) is actually wired into
// createProvider. A swap at provider-session.ts:129 makes these fail.
// ---------------------------------------------------------------------------

test("T2-B2 payload — api 'openai-completions': streamFn sends a payload with 'messages' field (not 'input')", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oc-b2-comp-payload-"));
  t.after(() => rm(dir, { recursive: true }));

  const store = createProviderCredentialStore({ dataRoot: dir });
  const registry = createProviderAccountRegistry({ dataRoot: dir, store });
  const configStore = createOpenAICompatibleConfigStore({ dataRoot: dir });

  const acct = await registry.add({ providerKind: "openai-compatible", label: "comp-payload-ep" });
  await store.modify(acct.id, async () => ({ type: "api_key" as const, key: "sk-comp-payload-test" }));
  await configStore.save(acct.id, {
    baseUrl: "http://127.0.0.1:19977/v1",
    api: "openai-completions",
    models: ["local-model"],
  });

  const session = await buildProviderSession(
    { accountId: acct.id, modelId: "local-model" },
    { registry, store, openaiCompatibleConfigStore: configStore },
  );

  // Shield OPENAI_WEBHOOK_SECRET from the no-network-guard: the OpenAI SDK
  // constructor evaluates readEnv('OPENAI_WEBHOOK_SECRET') as a default parameter
  // even when an explicit apiKey is provided, and the guard throws for *_SECRET
  // keys before onPayload fires. The outer proxy returns undefined for that key
  // only; all other cred-suffix keys still reach the guard. Restored via t.after.
  const _origEnv1 = process.env;
  process.env = new Proxy(process.env, {
    get(target, prop, receiver) {
      if (prop === "OPENAI_WEBHOOK_SECRET") return undefined;
      return Reflect.get(target, prop, receiver);
    },
  }) as typeof process.env;
  t.after(() => { process.env = _origEnv1; });

  let capturedPayload: unknown;
  // Context satisfies the pi-ai Context interface — role: "user" literal + timestamp.
  const context = { messages: [{ role: "user" as const, content: "ping", timestamp: 0 }] };
  const stream = session.streamFn(session.model, context, {
    onPayload: (payload) => { capturedPayload = payload; return undefined; },
  });
  // result() drives the stream; it will fail (connection refused on 127.0.0.1:19977)
  // *after* onPayload fires — so we catch the network error and assert the payload.
  try { await stream.result(); } catch { /* expected: ECONNREFUSED on loopback */ }

  assert.ok(capturedPayload !== undefined, "onPayload must be called before the HTTP request");
  const p = capturedPayload as Record<string, unknown>;
  assert.ok("messages" in p, "completions-api payload must carry 'messages' — fails if ternary at provider-session.ts:129 is swapped");
  assert.ok(!("input" in p), "completions-api payload must NOT carry 'input' — fails if ternary is swapped");
});

test("T2-B2 payload — api 'openai-responses': streamFn sends a payload with 'input' field (not 'messages')", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oc-b2-resp-payload-"));
  t.after(() => rm(dir, { recursive: true }));

  const store = createProviderCredentialStore({ dataRoot: dir });
  const registry = createProviderAccountRegistry({ dataRoot: dir, store });
  const configStore = createOpenAICompatibleConfigStore({ dataRoot: dir });

  const acct = await registry.add({ providerKind: "openai-compatible", label: "resp-payload-ep" });
  await store.modify(acct.id, async () => ({ type: "api_key" as const, key: "sk-resp-payload-test" }));
  await configStore.save(acct.id, {
    baseUrl: "http://127.0.0.1:19977/v1",
    api: "openai-responses",
    models: ["remote-model"],
  });

  const session = await buildProviderSession(
    { accountId: acct.id, modelId: "remote-model" },
    { registry, store, openaiCompatibleConfigStore: configStore },
  );

  // Same OPENAI_WEBHOOK_SECRET shield as the completions payload test above.
  const _origEnv2 = process.env;
  process.env = new Proxy(process.env, {
    get(target, prop, receiver) {
      if (prop === "OPENAI_WEBHOOK_SECRET") return undefined;
      return Reflect.get(target, prop, receiver);
    },
  }) as typeof process.env;
  t.after(() => { process.env = _origEnv2; });

  let capturedPayload: unknown;
  const context = { messages: [{ role: "user" as const, content: "ping", timestamp: 0 }] };
  const stream = session.streamFn(session.model, context, {
    onPayload: (payload) => { capturedPayload = payload; return undefined; },
  });
  try { await stream.result(); } catch { /* expected: ECONNREFUSED on loopback */ }

  assert.ok(capturedPayload !== undefined, "onPayload must be called before the HTTP request");
  const p = capturedPayload as Record<string, unknown>;
  assert.ok("input" in p, "responses-api payload must carry 'input' — fails if ternary at provider-session.ts:129 is swapped");
  assert.ok(!("messages" in p), "responses-api payload must NOT carry 'messages' — fails if ternary is swapped");
});

test("T1 — two openai-compatible accounts with different baseUrls each resolve to their own URL", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oc-t1-two-"));
  t.after(() => rm(dir, { recursive: true }));

  const store = createProviderCredentialStore({ dataRoot: dir });
  const registry = createProviderAccountRegistry({ dataRoot: dir, store });
  const configStore = createOpenAICompatibleConfigStore({ dataRoot: dir });

  const acct1 = await registry.add({ providerKind: "openai-compatible", label: "server-a" });
  const acct2 = await registry.add({ providerKind: "openai-compatible", label: "server-b" });

  await store.modify(acct1.id, async () => ({ type: "api_key" as const, key: "key-a" }));
  await store.modify(acct2.id, async () => ({ type: "api_key" as const, key: "key-b" }));

  await configStore.save(acct1.id, {
    baseUrl: "http://server-a:8080/v1",
    api: "openai-completions",
    models: ["gpt-mini"],
  });
  await configStore.save(acct2.id, {
    baseUrl: "http://server-b:9090/v1",
    api: "openai-responses",
    models: ["llama-3"],
  });

  const session1 = await buildProviderSession(
    { accountId: acct1.id, modelId: "gpt-mini" },
    { registry, store, openaiCompatibleConfigStore: configStore },
  );
  const session2 = await buildProviderSession(
    { accountId: acct2.id, modelId: "llama-3" },
    { registry, store, openaiCompatibleConfigStore: configStore },
  );

  assert.equal(
    session1.model.baseUrl,
    "http://server-a:8080/v1",
    "server-a resolves to its own baseUrl",
  );
  assert.equal(
    session2.model.baseUrl,
    "http://server-b:9090/v1",
    "server-b resolves to its own baseUrl",
  );
});
