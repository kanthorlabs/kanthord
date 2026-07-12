/**
 * src/cli/run-deps.test.ts
 *
 * Hermetic unit tests for the testable deps-assembly factory (RB1/RB2/RB5/RB4).
 *
 * Imports the not-yet-created `buildRealDeps` from `./run-deps.ts`; the import
 * fails with ERR_MODULE_NOT_FOUND until the SE creates that module — the
 * intended RED state for this turn.
 *
 *   RB1 — piSurface.spawnAgent uses makeAgentOpts (beforeToolCall bound, bash absent)
 *   RB2 — tickIntervalMs is a positive number
 *   RB5 — patternRegistry is present (not undefined; null = fail-closed is OK)
 *   RB4 — toolGuidance is populated with PI_DEFAULT_ALLOWED_MANIFEST entries
 */

import { test } from "node:test";
import assert from "node:assert/strict";
// This import fails ERR_MODULE_NOT_FOUND until the SE creates src/cli/run-deps.ts
import { buildRealDeps } from "./run-deps.ts";
import { PI_DEFAULT_ALLOWED_MANIFEST } from "../agent/pi-tools.ts";
import { openStore } from "../foundations/sqlite-store.ts";
import type { AgentOptions, StreamFn } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { RunDaemonDeps } from "../daemon/run-loop.ts";
import type { VerbRegistryEntry, AsyncVerbAdapter } from "../broker/registry.ts";
import type { PatternRegistry } from "../ring1/secret-scan.ts";
import { mkdtemp, writeFile, chmod, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdentityLoadError } from "../git/keyring.ts";

// ---------------------------------------------------------------------------
// RB1 — piSurface.spawnAgent uses makeAgentOpts
// ---------------------------------------------------------------------------

/**
 * buildRealDeps must accept an optional injectable `agentFactory` so tests
 * can capture the AgentOptions without making a real model call.
 *
 * Shape: `(opts: AgentOptions) => AgentInstance` where AgentInstance has
 * `abort()`, `waitForIdle()`, `reset()`, and `state.messages`.
 */
test(
  "RB1 — buildRealDeps piSurface.spawnAgent uses makeAgentOpts: beforeToolCall bound, bash absent, tools non-empty",
  () => {
    let capturedOpts: unknown;

    // Injectable agent factory that records the AgentOptions it receives.
    const agentFactory = (opts: unknown): {
      abort(): void;
      waitForIdle(): Promise<void>;
      reset(): void;
      state: { messages: unknown[] };
      prompt(_input: string): Promise<void>;
    } => {
      capturedOpts = opts;
      return {
        abort() {},
        async waitForIdle() {},
        reset() {},
        state: { messages: [] },
        async prompt(_input: string) {},
      };
    };

    const store = openStore(":memory:", { busyTimeout: 1000 });
    const deps = buildRealDeps({
      store,
      featureDir: "/tmp/run-deps-rb1",
      agentFactory,
    });

    const sentinelHook = async (
      _ctx: unknown,
      _sig?: AbortSignal,
    ): Promise<undefined> => undefined;

    deps.piSurface.spawnAgent({
      tools: [...PI_DEFAULT_ALLOWED_MANIFEST],
      beforeToolCall: sentinelHook,
      systemPrompt: "test",
      env: {},
    });

    assert.ok(
      capturedOpts !== undefined,
      "Agent constructor must be invoked — makeAgentOpts path must be called",
    );
    const opts = capturedOpts as AgentOptions;
    const initialState = (opts.initialState as Record<string, unknown> | undefined) ?? {};
    const tools = initialState["tools"] as Array<{ name: string }> | undefined;

    assert.ok(
      Array.isArray(tools) && tools.length > 0,
      "initialState.tools must be present and non-empty (manifest names from opts.tools)",
    );
    assert.ok(
      !tools.some((t) => t.name === "bash"),
      "bash must be absent from AgentOptions.initialState.tools (filtered by PI_EXEC_TOOLS via makeAgentOpts)",
    );
    assert.strictEqual(
      opts.beforeToolCall,
      sentinelHook,
      "AgentOptions.beforeToolCall must be the ring-1 hook passed in opts (not discarded)",
    );
  },
);

// ---------------------------------------------------------------------------
// RB1b — S3 run-deps wiring: spawnAgent threads model+streamFn to agentFactory
// ---------------------------------------------------------------------------

test(
  "RB1b — S3 run-deps: spawnAgent threads model+streamFn through makeAgentOpts and omits getApiKey",
  () => {
    let capturedOpts: unknown;

    const agentFactory = (opts: unknown): {
      abort(): void;
      waitForIdle(): Promise<void>;
      reset(): void;
      state: { messages: unknown[] };
      prompt(_input: string): Promise<void>;
    } => {
      capturedOpts = opts;
      return {
        abort() {},
        async waitForIdle() {},
        reset() {},
        state: { messages: [] },
        async prompt(_input: string) {},
      };
    };

    const store = openStore(":memory:", { busyTimeout: 1000 });
    const deps = buildRealDeps({
      store,
      featureDir: "/tmp/run-deps-rb1b",
      agentFactory,
    });

    const fakeModel = { provider: "acct_s3_run_deps", id: "gpt-s3-run-deps" };
    const fakeStreamFn = async (): Promise<undefined> => undefined;

    deps.piSurface.spawnAgent({
      tools: [...PI_DEFAULT_ALLOWED_MANIFEST],
      beforeToolCall: async (): Promise<undefined> => undefined,
      systemPrompt: "test",
      env: {},
      model: fakeModel,
      streamFn: fakeStreamFn,
    });

    assert.ok(capturedOpts !== undefined, "agentFactory must be invoked");
    const opts = capturedOpts as AgentOptions;

    assert.strictEqual(
      opts.streamFn,
      fakeStreamFn,
      "RB1b: run-deps spawnAgent must forward streamFn to agentFactory via makeAgentOpts",
    );
    assert.strictEqual(
      opts.getApiKey,
      undefined,
      "RB1b: getApiKey must be absent from AgentOptions when streamFn is provided",
    );
    const initialState = (opts.initialState as Record<string, unknown> | undefined) ?? {};
    assert.deepStrictEqual(
      initialState["model"],
      fakeModel,
      "RB1b: model must be threaded into initialState.model via makeAgentOpts",
    );
  },
);

// ---------------------------------------------------------------------------
// RB2 — tickIntervalMs is a positive number
// ---------------------------------------------------------------------------

test("RB2 — buildRealDeps returns tickIntervalMs as a positive number", () => {
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const deps: RunDaemonDeps = buildRealDeps({ store, featureDir: "/tmp/run-deps-rb2" });

  assert.ok(
    typeof deps.tickIntervalMs === "number",
    "tickIntervalMs must be a number (auto-tick loop requires it)",
  );
  assert.ok(
    (deps.tickIntervalMs as number) > 0,
    "tickIntervalMs must be positive (0 would busy-loop; undefined disables the loop)",
  );
});

// ---------------------------------------------------------------------------
// RB5 — patternRegistry present (not undefined)
// ---------------------------------------------------------------------------

test("RB5 — buildRealDeps returns patternRegistry (not undefined; null = fail-closed is acceptable)", () => {
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const deps: RunDaemonDeps = buildRealDeps({ store, featureDir: "/tmp/run-deps-rb5" });

  // patternRegistry is declared as `PatternRegistry | null | undefined` in RunDaemonDeps.
  // A real factory must always produce either a registry OR null (fail-closed).
  // undefined means "no scan configured" — that silently disables outbound scanning.
  assert.ok(
    "patternRegistry" in deps,
    "patternRegistry key must be present in the assembled deps",
  );
  assert.notStrictEqual(
    deps.patternRegistry,
    undefined,
    "patternRegistry must be null (fail-closed) or a PatternRegistry — undefined disables scanning silently",
  );
});

// ---------------------------------------------------------------------------
// T2-a — spawnAgent without model/streamFn uses providerModel+providerStreamFn
// ---------------------------------------------------------------------------

test(
  "T2-a — spawnAgent without model/streamFn uses providerModel+providerStreamFn from buildRealDeps opts",
  () => {
    let capturedOpts: unknown;

    const agentFactory = (opts: unknown): {
      abort(): void;
      waitForIdle(): Promise<void>;
      reset(): void;
      state: { messages: unknown[] };
      prompt(_input: string): Promise<void>;
    } => {
      capturedOpts = opts;
      return {
        abort() {},
        async waitForIdle() {},
        reset() {},
        state: { messages: [] },
        async prompt(_input: string) {},
      };
    };

    const providerModel = { provider: "openai-codex", id: "gpt-5.5-t2" } as unknown as Model<any>;
    const providerStreamFn = (async (): Promise<undefined> => undefined) as unknown as StreamFn;

    const store = openStore(":memory:", { busyTimeout: 1000 });
    const deps = buildRealDeps({
      store,
      featureDir: "/tmp/run-deps-t2a",
      agentFactory,
      providerModel,
      providerStreamFn,
    });

    deps.piSurface.spawnAgent({
      tools: [...PI_DEFAULT_ALLOWED_MANIFEST],
      beforeToolCall: async (): Promise<undefined> => undefined,
      systemPrompt: "test",
      env: {},
      // deliberately no model or streamFn
    });

    assert.ok(capturedOpts !== undefined, "agentFactory must be invoked");
    const opts = capturedOpts as AgentOptions;
    const initialState = (opts.initialState as Record<string, unknown> | undefined) ?? {};

    assert.deepStrictEqual(
      initialState["model"],
      providerModel,
      "T2-a: spawnAgent without model/streamFn must use providerModel from buildRealDeps opts",
    );
    assert.strictEqual(
      opts.streamFn,
      providerStreamFn,
      "T2-a: spawnAgent without model/streamFn must use providerStreamFn from buildRealDeps opts",
    );
  },
);

// ---------------------------------------------------------------------------
// T2-b — spawnAgent with its own model/streamFn ignores provider defaults
// ---------------------------------------------------------------------------

test(
  "T2-b — spawnAgent with its own model/streamFn ignores providerModel+providerStreamFn",
  () => {
    let capturedOpts: unknown;

    const agentFactory = (opts: unknown): {
      abort(): void;
      waitForIdle(): Promise<void>;
      reset(): void;
      state: { messages: unknown[] };
      prompt(_input: string): Promise<void>;
    } => {
      capturedOpts = opts;
      return {
        abort() {},
        async waitForIdle() {},
        reset() {},
        state: { messages: [] },
        async prompt(_input: string) {},
      };
    };

    const providerModel = { provider: "openai-codex", id: "gpt-5.5-t2-default" } as unknown as Model<any>;
    const providerStreamFn = (async (): Promise<undefined> => undefined) as unknown as StreamFn;
    const callerModel = { provider: "caller-prov", id: "caller-model-t2" };
    const callerStreamFn = async (): Promise<undefined> => undefined;

    const store = openStore(":memory:", { busyTimeout: 1000 });
    const deps = buildRealDeps({
      store,
      featureDir: "/tmp/run-deps-t2b",
      agentFactory,
      providerModel,
      providerStreamFn,
    });

    deps.piSurface.spawnAgent({
      tools: [...PI_DEFAULT_ALLOWED_MANIFEST],
      beforeToolCall: async (): Promise<undefined> => undefined,
      systemPrompt: "test",
      env: {},
      model: callerModel,
      streamFn: callerStreamFn,
    });

    assert.ok(capturedOpts !== undefined, "agentFactory must be invoked");
    const opts = capturedOpts as AgentOptions;
    const initialState = (opts.initialState as Record<string, unknown> | undefined) ?? {};

    assert.deepStrictEqual(
      initialState["model"],
      callerModel,
      "T2-b: spawnAgent with caller model must use caller's model, not providerModel",
    );
    assert.strictEqual(
      opts.streamFn,
      callerStreamFn,
      "T2-b: spawnAgent with caller streamFn must use caller's streamFn, not providerStreamFn",
    );
  },
);

// ---------------------------------------------------------------------------
// RB4 — toolGuidance populated with PI_DEFAULT_ALLOWED_MANIFEST entries
// ---------------------------------------------------------------------------

/**
 * GAP5 wired toolGuidance into spawnPiSession (pi-session.test.ts:1006), but
 * tick() in run-loop.ts never passes deps.toolGuidance to spawnPiSession (the
 * "not-wired-in-tick" gap).  The deps factory must provide a non-empty toolGuidance
 * record so tick() has something to thread.
 *
 * This test asserts the necessary-condition side: the assembled deps carry
 * toolGuidance keyed by every PI_DEFAULT_ALLOWED_MANIFEST entry with non-empty
 * guidance strings.
 */
test(
  "RB4 — buildRealDeps returns toolGuidance with PI_DEFAULT_ALLOWED_MANIFEST entries, all non-empty",
  () => {
    const store = openStore(":memory:", { busyTimeout: 1000 });
    // toolGuidance is not yet in RunDaemonDeps — cast after SE adds the field.
    const deps = buildRealDeps({ store, featureDir: "/tmp/run-deps-rb4" }) as RunDaemonDeps & {
      toolGuidance?: Record<string, string>;
    };

    const tg = deps.toolGuidance;
    assert.ok(
      tg !== undefined && tg !== null,
      "toolGuidance must be present in assembled deps (not undefined)",
    );
    for (const name of PI_DEFAULT_ALLOWED_MANIFEST) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(tg, name),
        `toolGuidance must have an entry for allowed tool "${name}"`,
      );
      assert.ok(
        typeof tg[name] === "string" && tg[name].length > 0,
        `toolGuidance["${name}"] must be a non-empty guidance string`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// S002-T1 — per-identity PAT custody: buildRealDeps loads token from 0600 file
// ---------------------------------------------------------------------------

test(
  "S002-T1-happy — buildRealDeps loads identity token from a 0600 file and exposes identityToken",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-s002-t1-"));
    const tmpFile = join(dir, "credentials");
    const fakeToken = "ghp_fake-token-s002t1-happy";
    try {
      await writeFile(tmpFile, fakeToken + "\n", { mode: 0o600 });
      const store = openStore(":memory:", { busyTimeout: 1000 });
      // identity/identityFile are not yet in BuildRealDepsOpts — cast via any (RED seam)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await (buildRealDeps as any)({
        store,
        featureDir: dir,
        identity: "kanthordverify",
        identityFile: tmpFile,
      })) as { identityToken?: string };
      assert.strictEqual(
        result.identityToken,
        fakeToken,
        "S002-T1: buildRealDeps must expose the loaded token as identityToken (trimmed from file)",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "S002-T1-insecure — buildRealDeps rejects with IdentityLoadError(insecure-file-mode) for a 0644 file, message names identity + file, no token",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-s002-t1-insec-"));
    const tmpFile = join(dir, "credentials");
    const fakeToken = "ghp_must-not-appear-in-error-message";
    try {
      await writeFile(tmpFile, fakeToken + "\n");
      await chmod(tmpFile, 0o644);
      const store = openStore(":memory:", { busyTimeout: 1000 });
      await assert.rejects(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async () => { await (buildRealDeps as any)({ store, featureDir: dir, identity: "kanthordverify", identityFile: tmpFile }); },
        (err: unknown) => {
          assert.ok(err instanceof IdentityLoadError, `S002-T1-insecure: must throw IdentityLoadError, got ${String(err)}`);
          const e = err as IdentityLoadError;
          assert.strictEqual(e.code, "insecure-file-mode", "S002-T1-insecure: error code must be insecure-file-mode");
          assert.ok(e.message.includes("kanthordverify"), "S002-T1-insecure: error message must name the identity");
          assert.ok(e.message.includes(tmpFile), "S002-T1-insecure: error message must include the file path");
          assert.ok(!e.message.includes(fakeToken), "S002-T1-insecure: error message must NOT contain the token");
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// S003-T1 — broker verb registry exposed on buildRealDeps deps
// ---------------------------------------------------------------------------

test(
  "S003-T1 — buildRealDeps exposes verbAdapters with git.branch, git.commit, git.push, github.create_pr entries",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-s003-t1-"));
    const tmpFile = join(dir, "credentials");
    const fakeToken = "ghp_s003-build-verb-registry";
    try {
      await writeFile(tmpFile, fakeToken + "\n", { mode: 0o600 });
      const store = openStore(":memory:", { busyTimeout: 1000 });
      const stubPatternRegistry: PatternRegistry = { version: "1", patterns: [] };

      // repo + patternRegistry are not yet in BuildRealDepsOpts — cast via any (RED seam)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deps = (await (buildRealDeps as any)({
        store,
        featureDir: dir,
        identity: "kanthordverify",
        identityFile: tmpFile,
        repo: "kanthordlabs/kanthord-verify",
        patternRegistry: stubPatternRegistry,
      })) as RunDaemonDeps & {
        identityToken?: string;
        verbAdapters?: Record<string, { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter }>;
      };

      assert.ok(
        deps.verbAdapters !== undefined,
        "S003-T1: buildRealDeps must return deps.verbAdapters (broker verb registry) — field not yet wired",
      );

      const EXPECTED_VERBS = ["git.branch", "git.commit", "git.push", "github.create_pr"] as const;
      for (const verb of EXPECTED_VERBS) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(deps.verbAdapters, verb),
          `S003-T1: deps.verbAdapters must contain an entry for verb "${verb}"`,
        );
        const verbEntry = deps.verbAdapters[verb];
        assert.ok(
          verbEntry !== undefined,
          `S003-T1: deps.verbAdapters["${verb}"] must not be undefined`,
        );
        assert.ok(
          typeof verbEntry.adapter.submit === "function",
          `S003-T1: verbAdapters["${verb}"].adapter.submit must be a function (real constructor output)`,
        );
        assert.ok(
          typeof verbEntry.adapter.poll_status === "function",
          `S003-T1: verbAdapters["${verb}"].adapter.poll_status must be a function`,
        );
        assert.ok(
          typeof verbEntry.adapter.reconcile === "function",
          `S003-T1: verbAdapters["${verb}"].adapter.reconcile must be a function (reconcile-path required by PRD §5)`,
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// B1-regression — async (identity) path must preserve caller-supplied patternRegistry
// ---------------------------------------------------------------------------

test(
  "B1 — buildRealDeps async path preserves caller-supplied patternRegistry (not null)",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-b1-reg-"));
    const tmpFile = join(dir, "credentials");
    const fakeToken = "ghp_b1-regression-pattern-registry";
    try {
      await writeFile(tmpFile, fakeToken + "\n", { mode: 0o600 });
      const store = openStore(":memory:", { busyTimeout: 1000 });
      const stubPatternRegistry: PatternRegistry = { version: "1", patterns: [] };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deps = (await (buildRealDeps as any)({
        store,
        featureDir: dir,
        identity: "kanthordverify",
        identityFile: tmpFile,
        patternRegistry: stubPatternRegistry,
      })) as RunDaemonDeps;

      assert.strictEqual(
        deps.patternRegistry,
        stubPatternRegistry,
        "B1: buildRealDeps async path must return deps.patternRegistry === the supplied stub (was always null — blocker B1)",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "S002-T1-missing — buildRealDeps rejects with an error naming identity + file when the identity file does not exist",
  async () => {
    const store = openStore(":memory:", { busyTimeout: 1000 });
    const missingFile = join(tmpdir(), "kanthord-s002-t1-nonexistent-credentials");
    await assert.rejects(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => { await (buildRealDeps as any)({ store, featureDir: "/tmp/s002-missing", identity: "kanthordverify", identityFile: missingFile }); },
      (err: unknown) => {
        assert.ok(err instanceof Error, `S002-T1-missing: must throw an Error, got ${String(err)}`);
        const msg = (err as Error).message;
        assert.ok(msg.includes("kanthordverify"), "S002-T1-missing: error message must name the identity 'kanthordverify'");
        assert.ok(msg.includes(missingFile), "S002-T1-missing: error message must include the file path");
        return true;
      },
    );
  },
);

// ---------------------------------------------------------------------------
// 019.13 S002 T1 — spawnAgent installs a hook that appends model_call_log rows
// ---------------------------------------------------------------------------

import { initSchema } from "../store/schema.ts";
import { queryModelCallLog } from "../metrics/model-call-log.ts";

test(
  "019.13 S002 T1 — spawnAgent installs a model-response hook: each invocation appends a model_call_log row; two calls → two rows; a failing append does not throw",
  async () => {
    let capturedOpts: AgentOptions | undefined;

    const agentFactory = (opts: AgentOptions): {
      abort(): void;
      waitForIdle(): Promise<void>;
      reset(): void;
      state: { messages: unknown[] };
      prompt(input: string): Promise<void>;
    } => {
      capturedOpts = opts;
      return {
        abort() {},
        async waitForIdle() {},
        reset() {},
        state: { messages: [] },
        async prompt(_input: string) {},
      };
    };

    const store = openStore(":memory:", { busyTimeout: 1000 });
    initSchema(store);

    const testTaskId = "task_019_13_s2t1";
    const testAccountId = "acc_019_13_s2t1";
    const testModelId = "gpt-4o-s2t1";

    // accountId is a new field the SE adds to BuildRealDepsOpts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deps = buildRealDeps({ store, featureDir: "/tmp/run-deps-019-13-s2t1", agentFactory, accountId: testAccountId } as any);

    // task_id is a new field in rawOpts that the SE adds
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deps.piSurface.spawnAgent({ tools: [...PI_DEFAULT_ALLOWED_MANIFEST], beforeToolCall: async (): Promise<undefined> => undefined, task_id: testTaskId, model: { provider: "openai-responses", id: testModelId } } as any);

    assert.ok(capturedOpts !== undefined, "019.13 S002 T1: agentFactory must be called by spawnAgent");

    const opts = capturedOpts as AgentOptions & Record<string, unknown>;
    assert.ok(
      typeof opts["prepareNextTurnWithContext"] === "function",
      "019.13 S002 T1: spawnAgent must install a prepareNextTurnWithContext hook on AgentOptions to capture model-call usage — currently missing",
    );

    const hook = opts["prepareNextTurnWithContext"] as (ctx: unknown, signal?: AbortSignal) => Promise<unknown>;

    const makeSynthCtx = (): unknown => ({
      message: {
        role: "assistant",
        usage: { input: 42, output: 17, cacheRead: 0, cacheWrite: 0, totalTokens: 59, cost: { input: 0.0001, output: 0.0002, cacheRead: 0, cacheWrite: 0, total: 0.0003 } },
        stopReason: "stop",
        content: [],
        api: "openai-responses",
        provider: "openai",
        model: testModelId,
        timestamp: Date.now(),
      },
      toolResults: [],
      newMessages: [],
      context: { messages: [] },
    });

    await hook(makeSynthCtx());
    await hook(makeSynthCtx());

    const rows = queryModelCallLog(store, testTaskId);
    assert.strictEqual(rows.length, 2, "019.13 S002 T1: two model responses must produce two model_call_log rows");

    const row = rows[0]!;
    assert.strictEqual(row.task_id, testTaskId, "019.13 S002 T1: row.task_id must match supplied task_id");
    assert.strictEqual(row.account_id, testAccountId, "019.13 S002 T1: row.account_id must match the resolved account_id from buildRealDeps opts");
    assert.strictEqual(row.model, testModelId, "019.13 S002 T1: row.model must match the AssistantMessage.model from the response");
    assert.strictEqual(row.tokens_in, 42, "019.13 S002 T1: row.tokens_in must match usage.input from the response");
    assert.strictEqual(row.tokens_out, 17, "019.13 S002 T1: row.tokens_out must match usage.output from the response");

    // A failing append must not propagate out of the hook (best-effort metrics)
    let capturedOpts2: AgentOptions | undefined;
    const agentFactory2 = (o: AgentOptions): { abort(): void; waitForIdle(): Promise<void>; reset(): void; state: { messages: unknown[] }; prompt(i: string): Promise<void> } => {
      capturedOpts2 = o;
      return { abort() {}, async waitForIdle() {}, reset() {}, state: { messages: [] }, async prompt(_i: string) {} };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deps2 = buildRealDeps({ store: { run() { throw new Error("broken"); }, get: () => undefined, all: () => [] } as any, featureDir: "/tmp/run-deps-019-13-s2t1-broken", agentFactory: agentFactory2, accountId: testAccountId } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deps2.piSurface.spawnAgent({ tools: [...PI_DEFAULT_ALLOWED_MANIFEST], beforeToolCall: async (): Promise<undefined> => undefined, task_id: testTaskId, model: { provider: "openai-responses", id: testModelId } } as any);
    assert.ok(capturedOpts2 !== undefined, "agentFactory2 must be called");
    const opts2 = capturedOpts2 as AgentOptions & Record<string, unknown>;
    const hook2 = opts2["prepareNextTurnWithContext"] as (ctx: unknown, signal?: AbortSignal) => Promise<unknown>;
    await assert.doesNotReject(
      async () => { await hook2(makeSynthCtx()); },
      "019.13 S002 T1: a failing store append must NOT throw out of the hook (best-effort observability)",
    );
  },
);

// ---------------------------------------------------------------------------
// T1 (Story 019.12-001) — spawnAgent drives the Agent run with systemPrompt
// ---------------------------------------------------------------------------

test(
  "T1 (019.12-001) — spawnAgent invokes agent.prompt(systemPrompt) exactly once and waitForIdle resolves after",
  async () => {
    const recordedInputs: string[] = [];

    const agentFactory = (_opts: unknown): {
      abort(): void;
      waitForIdle(): Promise<void>;
      reset(): void;
      state: { messages: unknown[] };
      prompt(input: string): Promise<void>;
    } => {
      return {
        abort() {},
        async waitForIdle() {},
        reset() {},
        state: { messages: [] },
        async prompt(input: string) {
          recordedInputs.push(input);
        },
      };
    };

    const store = openStore(":memory:", { busyTimeout: 1000 });
    const deps = buildRealDeps({
      store,
      featureDir: "/tmp/run-deps-t1-019-12",
      agentFactory,
    });

    const handle = deps.piSurface.spawnAgent({
      systemPrompt: "<brief-XYZ>",
      tools: [...PI_DEFAULT_ALLOWED_MANIFEST],
      beforeToolCall: async (_ctx: unknown, _sig?: AbortSignal): Promise<undefined> => undefined,
    });

    await handle.waitForIdle();

    assert.strictEqual(
      recordedInputs.length,
      1,
      "T1: agent.prompt must be called exactly once (spawnAgent must drive the run)",
    );
    assert.strictEqual(
      recordedInputs[0],
      "<brief-XYZ>",
      "T1: agent.prompt must be called with the systemPrompt brief",
    );
  },
);

// ---------------------------------------------------------------------------
// T2 (019.15-S001) — spawnAgent with worktreePath uses real buildWorktreeTools
// ---------------------------------------------------------------------------

test(
  "T2 (019.15-S001) — spawnAgent with worktreePath uses real buildWorktreeTools: write.execute creates a file and bash is absent",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-019-15-t2-"));
    try {
      let capturedOpts: AgentOptions | undefined;
      const agentFactory = (opts: AgentOptions): {
        abort(): void;
        waitForIdle(): Promise<void>;
        reset(): void;
        state: { messages: unknown[] };
        prompt(i: string): Promise<void>;
      } => {
        capturedOpts = opts;
        return {
          abort() {},
          async waitForIdle() {},
          reset() {},
          state: { messages: [] },
          async prompt(_i: string) {},
        };
      };

      const store = openStore(":memory:", { busyTimeout: 1000 });
      const deps = buildRealDeps({ store, featureDir: dir, agentFactory });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deps.piSurface.spawnAgent({
        tools: [...PI_DEFAULT_ALLOWED_MANIFEST],
        beforeToolCall: async (): Promise<undefined> => undefined,
        worktreePath: dir,
      } as any);

      assert.ok(capturedOpts !== undefined, "agentFactory must be invoked");
      const tools = (
        ((capturedOpts.initialState as Record<string, unknown> | undefined)?.["tools"]) as
          | Array<{ name: string; execute(id: string, args: unknown): Promise<unknown> }>
          | undefined
      ) ?? [];

      // bash must be absent
      assert.ok(
        !tools.some((t) => t.name === "bash"),
        "T2: bash must not be in tools",
      );

      // write tool must be present
      const write = tools.find((t) => t.name === "write");
      assert.ok(write !== undefined, "T2: write tool must be present in tools");

      // execute must write a real file (not the empty stub)
      await write.execute("call-t2-w1", { path: "019-15-t2.txt", content: "real-write-sentinel" });
      const onDisk = await readFile(join(dir, "019-15-t2.txt"), "utf8").catch(() => null);
      assert.notStrictEqual(
        onDisk,
        null,
        "T2: write.execute must create the file in the worktree — stub no-op detected (real tool expected)",
      );
      assert.equal(
        onDisk,
        "real-write-sentinel",
        "T2: write.execute must write the expected content (proves real factory tool, not stub)",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
