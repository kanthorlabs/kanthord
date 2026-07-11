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
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import type { RunDaemonDeps } from "../daemon/run-loop.ts";

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
    } => {
      capturedOpts = opts;
      return {
        abort() {},
        async waitForIdle() {},
        reset() {},
        state: { messages: [] },
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
    } => {
      capturedOpts = opts;
      return {
        abort() {},
        async waitForIdle() {},
        reset() {},
        state: { messages: [] },
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
