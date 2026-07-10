/**
 * Run-loop hermetic test suite — Epic 019.2
 *
 * All stories drive `runDaemon(deps)` with injected doubles; no real model
 * call, no real network outside the loopback status server.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { get as httpGet } from "node:http";
import { openStore } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import { createStatusServer } from "./status-server.ts";
import { runDaemon } from "./run-loop.ts";
import type { VerbRegistryEntry, AsyncVerbAdapter } from "../broker/registry.ts";
import { compile } from "../compiler/compile.ts";
import { loadTasks } from "../scheduler/dispatch.ts";
import { resumeEscalationItem, haltEscalationItem } from "../rpc/inbox-respond.ts";

// ---------------------------------------------------------------------------
// Helper — issue a GET /healthz and resolve with the status code
// ---------------------------------------------------------------------------

function fetchHealthz(host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    httpGet(`http://${host}:${port}/healthz`, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Helper — connect and expect the server to be down (ECONNREFUSED or ECONNRESET)
// ---------------------------------------------------------------------------

function expectServerDown(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    httpGet(`http://${host}:${port}/healthz`, (res) => {
      res.resume();
      reject(new Error(`Expected server to be down but got HTTP ${res.statusCode ?? "?"}`));
    }).on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED" || err.code === "ECONNRESET") {
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Story 001 T1 — boot, serve, idle
// ---------------------------------------------------------------------------

test("Story 001 T1 — runDaemon boots, status 200, idles with no dispatchable task", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s001t1-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);

  const spawnCalls: unknown[] = [];
  const logRecords: Array<Record<string, unknown>> = [];

  // Spy pi surface — tracks spawnAgent calls
  const spyPiSurface = {
    spawnAgent(opts: unknown): {
      abort(): void;
      waitForIdle(): Promise<void>;
      reset(): void;
      contextTokens: number;
    } {
      spawnCalls.push(opts);
      return {
        abort() {},
        async waitForIdle() {},
        reset() {},
        contextTokens: 0,
      };
    },
  };

  // Mock logger — captures structured records
  const logger = {
    info(record: Record<string, unknown>): void {
      logRecords.push({ ...record });
    },
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: spyPiSurface,
    statusServerFactory: createStatusServer,
  });

  try {
    // AC: status HTTP surface answers 200 on 127.0.0.1:<port>
    const statusCode = await fetchHealthz(handle.address.host, handle.address.port);
    assert.equal(statusCode, 200, "status endpoint must return 200");

    // AC: no pi session spawned (idle — no dispatchable task in empty feature dir)
    assert.equal(spawnCalls.length, 0, "no spawnAgent call expected when idle");

    // AC: no broker op row created
    const brokerRows = store.all("SELECT * FROM broker_in_flight");
    assert.equal(brokerRows.length, 0, "no broker op rows expected when idle");

    // AC: boot + recovery-summary log records emitted (Epic 009 contract)
    const events = logRecords.map((r) => r["event"]);
    assert.ok(events.includes("boot"), "expected 'boot' log record");
    assert.ok(
      events.includes("recovery-summary"),
      "expected 'recovery-summary' log record",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 001 T3 — hold-point config flag (two cases)
// ---------------------------------------------------------------------------

function makeTestEntry(): VerbRegistryEntry {
  return {
    verb: "push",
    tier: "auto",
    timeout: 30000,
    idempotency: { window_ms: 0 },
    retry: { max: 3, backoff: "exponential" },
    poll_interval: 5000,
    terminal_states: ["done", "failed"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: false,
  };
}

test("Story 001 T3 — hold-point enabled: op recorded held, adapter not called", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s001t3a-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };
  const spyPiSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: spyPiSurface,
    statusServerFactory: createStatusServer,
    holdPointEnabled: true,
  });

  let adapterSubmitCalled = 0;
  const spyAdapter: AsyncVerbAdapter = {
    submit: async (_input: unknown) => {
      adapterSubmitCalled++;
      return "req-hold-t3a";
    },
    poll_status: async (_requestId: unknown) => ({ status: "in_flight" }),
    reconcile: async (_ledger: unknown) => ({ status: "done" }),
  };

  try {
    const opId = await handle.submitBrokerVerb(makeTestEntry(), spyAdapter, { branch: "feat/t3a" }, "key-t3a");

    // AC: adapter.submit must NOT be called when hold-point is enabled
    assert.equal(adapterSubmitCalled, 0, "adapter.submit must not be called when hold-point is active");

    // AC: op is recorded as 'held' in broker_in_flight
    const row = store.get<{ status: string }>("SELECT status FROM broker_in_flight WHERE op_id = ?", opId);
    assert.ok(row !== undefined, "op must be recorded in broker_in_flight");
    assert.equal(row.status, "held", "op status must be 'held' when hold-point is active");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Story 001 T3 — hold-point disabled: adapter called, op in_flight", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s001t3b-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };
  const spyPiSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: spyPiSurface,
    statusServerFactory: createStatusServer,
    holdPointEnabled: false,
  });

  let adapterSubmitCalled = 0;
  const spyAdapter: AsyncVerbAdapter = {
    submit: async (_input: unknown) => {
      adapterSubmitCalled++;
      return "req-hold-t3b";
    },
    poll_status: async (_requestId: unknown) => ({ status: "in_flight" }),
    reconcile: async (_ledger: unknown) => ({ status: "done" }),
  };

  try {
    await handle.submitBrokerVerb(makeTestEntry(), spyAdapter, { branch: "feat/t3b" }, "key-t3b");

    // AC: adapter.submit IS called when hold-point is disabled
    assert.equal(adapterSubmitCalled, 1, "adapter.submit must be called once when hold-point is inactive");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 001 T2 — graceful shutdown
// ---------------------------------------------------------------------------

test("Story 001 T2 — SIGTERM handler installed; stop() closes the HTTP surface", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s001t2-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const spyPiSurface = {
    spawnAgent(_opts: unknown) {
      return {
        abort() {},
        async waitForIdle() {},
        reset() {},
        contextTokens: 0,
      };
    },
  };
  const logger = { info(_r: Record<string, unknown>): void {} };

  // Record signal-handler counts before boot (so we can detect new ones)
  const sigTermBefore = process.listenerCount("SIGTERM");
  const sigIntBefore = process.listenerCount("SIGINT");

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: spyPiSurface,
    statusServerFactory: createStatusServer,
  });

  const { host, port } = handle.address;

  try {
    // AC: runDaemon installs SIGTERM and SIGINT handlers
    assert.ok(
      process.listenerCount("SIGTERM") > sigTermBefore,
      "runDaemon must install a SIGTERM handler",
    );
    assert.ok(
      process.listenerCount("SIGINT") > sigIntBefore,
      "runDaemon must install a SIGINT handler",
    );

    // Confirm serving before stop
    const before = await fetchHealthz(host, port);
    assert.equal(before, 200, "must serve 200 before stop");

    // AC: after stop(), HTTP surface is no longer serving
    await handle.stop();
    await expectServerDown(host, port);
  } finally {
    // Best-effort cleanup (stop is idempotent after GREEN)
    await handle.stop().catch(() => {});
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 002 T1 — tick dispatches to ring-1-guarded pi session
// ---------------------------------------------------------------------------

// Minimal valid feature markdown for the tick dispatch test.
const S002_EPIC_MD = `---
id: feat-s002t1
repo: backend
ticket_system: jira
ticket: JIRA-S1
---

## Acceptance

Feature complete when task-foo passes.
`;

const S002_INDEX_MD = `# Story Alpha\n`;

const S002_TASK_FOO_MD = `---
id: task-foo
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-S2
write_scope:
  - src/foo/
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

out

## Tests

tests
`;

test("Story 002 T1 — tick dispatches to ring-1-guarded pi session; second tick is idle", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s002t1-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);

  // Seed the feature directory
  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  // Capture spawnAgent calls to assert ring-1 hook
  const spawnCalls: Array<Record<string, unknown>> = [];
  const spyPiSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCalls.push(opts as Record<string, unknown>);
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const logger = { info(_r: Record<string, unknown>): void {} };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: spyPiSurface,
    statusServerFactory: createStatusServer,
  });

  try {
    // Compile the feature into the DB so the scheduler can find the task
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    // loadTasks creates the scheduler_task row with status='pending'
    loadTasks(store, "feat-s002t1");

    // One tick: should dispatch to the pi session
    // Tick: dispatches to the pi session
    await handle.tick();

    // AC: exactly one spawnAgent call (one dispatchable task)
    assert.equal(spawnCalls.length, 1, "exactly one spawnAgent call expected on first tick");

    // AC: ring-1 hook attached (beforeToolCall is a function — not undefined/null)
    const spawnOpts = spawnCalls[0] as Record<string, unknown>;
    assert.ok(spawnOpts !== undefined, "spawnAgent must have been called with opts");
    assert.equal(
      typeof spawnOpts["beforeToolCall"],
      "function",
      "ring-1 hook must be attached as beforeToolCall function",
    );

    // AC: task marked in-progress
    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-foo",
    );
    assert.ok(taskRow !== undefined, "task-foo must have a scheduler row");
    assert.equal(taskRow.status, "running", "task must be marked in-progress (running) after tick");

    // AC: second tick spawns nothing (no more dispatchable tasks)
    await handle.tick();
    assert.equal(spawnCalls.length, 1, "no new spawnAgent call expected on second tick");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 002 T2 — LP2: out-of-scope write blocked, inbox item, task parked
// ---------------------------------------------------------------------------

const S002T2_EPIC_MD = `---
id: feat-s002t2
repo: backend
ticket_system: jira
ticket: JIRA-T2
---

## Acceptance

Feature complete when task-bar passes.
`;

const S002T2_TASK_MD = `---
id: task-bar
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-T2B
write_scope:
  - src/foo/
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

out

## Tests

tests
`;

test("Story 002 T2 — LP2: out-of-scope write blocked, inbox item created, task parked; read allowed", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s002t2-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);

  await writeFile(join(featureDir, "epic.md"), S002T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-bar.md"), S002T2_TASK_MD, "utf8");

  let writeHookCalled = false;
  let writeHookResult: { block: boolean; reason?: string } | undefined;
  let readHookCalled = false;
  let readHookResult: { block: boolean; reason?: string } | undefined;

  // Scripted pi surface: captures beforeToolCall and calls it with one
  // out-of-scope write call and one read call during waitForIdle().
  const scriptedPiSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      const o = opts as Record<string, unknown>;
      const hook = o["beforeToolCall"] as (ctx: unknown) => Promise<{ block: boolean; reason?: string } | undefined>;
      return {
        abort() {},
        async waitForIdle() {
          // Out-of-scope write (pi "write" tool) to src/outside/ — outside write_scope src/foo/
          writeHookCalled = true;
          writeHookResult = await hook({
            assistantMessage: { role: "assistant", content: [] },
            toolCall: { id: "call-oos-001", name: "write", input: { path: "src/outside/file.ts" } },
            args: { path: "src/outside/file.ts" },
            context: { systemPrompt: "", messages: [], tools: [] },
          });
          // Read to same out-of-scope path (pi "read" tool) — must be allowed
          readHookCalled = true;
          readHookResult = await hook({
            assistantMessage: { role: "assistant", content: [] },
            toolCall: { id: "call-read-001", name: "read", input: { path: "src/outside/file.ts" } },
            args: { path: "src/outside/file.ts" },
            context: { systemPrompt: "", messages: [], tools: [] },
          });
        },
        reset() {},
        contextTokens: 0,
      };
    },
  };

  const logger = { info(_r: Record<string, unknown>): void {} };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: scriptedPiSurface,
    statusServerFactory: createStatusServer,
  });

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t2");

    await handle.tick();

    // AC: ring-1 hook was invoked and blocked the out-of-scope write
    assert.ok(writeHookCalled, "beforeToolCall must be invoked for the write tool call");
    assert.equal(writeHookResult?.block, true, "out-of-scope write must be blocked by ring-1 hook");

    // AC: a re-planning-tagged escalation inbox item was durably recorded
    const inboxRows = store.all<{ id: string; kind: string; evidence: string }>(
      "SELECT id, kind, evidence FROM inbox_items",
    );
    assert.ok(inboxRows.length > 0, "at least one inbox item must exist after out-of-scope write");
    const firstItem = inboxRows[0];
    assert.ok(firstItem !== undefined, "inbox item row must be non-undefined");
    assert.equal(firstItem.kind, "escalation", "inbox item kind must be 'escalation'");

    // AC: task is parked (not advanced past the ring-1 block)
    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-bar",
    );
    assert.ok(taskRow !== undefined, "task-bar must have a scheduler row");
    assert.equal(taskRow.status, "parked", "task must be parked after ring-1 escalation");

    // AC: read tool call to out-of-scope path is allowed (hook returns undefined = pass-through)
    assert.ok(readHookCalled, "beforeToolCall must be invoked for the read tool call");
    assert.equal(readHookResult, undefined, "read to out-of-scope path must be allowed (hook returns undefined)");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 002 T3 — LP3: budget breach halts before model-call effect
// ---------------------------------------------------------------------------

const S002T3_EPIC_MD = `---
id: feat-s002t3
repo: backend
ticket_system: jira
ticket: JIRA-T3
---

## Acceptance

Feature complete when task-bud passes.
`;

const S002T3_TASK_MD = `---
id: task-bud
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-T3B
write_scope:
  - src/foo/
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

out

## Tests

tests
`;

test("Story 002 T3 — LP3: budget breach halts before model-call effect; inbox item with cost attribution exists", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s002t3-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);

  await writeFile(join(featureDir, "epic.md"), S002T3_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-bud.md"), S002T3_TASK_MD, "utf8");

  // Scripted pi surface: setting modelCallEffectFired=true proves the session was spawned
  let modelCallEffectFired = false;
  const scriptedPiSurface = {
    spawnAgent(_opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      modelCallEffectFired = true;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const logger = { info(_r: Record<string, unknown>): void {} };

  // taskBudget: ceiling=0, conservativeCost=1 → first reserve(taskId, null) halts immediately
  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: scriptedPiSurface,
    statusServerFactory: createStatusServer,
    taskBudget: { ceiling: 0, conservativeCost: 1 },
  });

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t3");

    await handle.tick();

    // AC: model-call effect (spawnAgent) must NOT have fired — halted before spawn
    assert.equal(
      modelCallEffectFired,
      false,
      "model-call effect must not fire after budget breach halt",
    );

    // AC: inbox escalation item with cost attribution (task_id) exists
    const inboxRows = store.all<{ kind: string; evidence: string }>(
      "SELECT kind, evidence FROM inbox_items",
    );
    assert.ok(inboxRows.length > 0, "at least one inbox item must exist after budget breach");
    const item = inboxRows[0];
    assert.ok(item !== undefined, "inbox item must be non-undefined");
    assert.equal(item.kind, "escalation", "inbox item kind must be 'escalation'");
    const evidence = JSON.parse(item.evidence) as Record<string, unknown>;
    assert.ok(
      typeof evidence["task_id"] === "string" && evidence["task_id"].length > 0,
      "inbox item evidence must carry task_id for cost attribution",
    );

    // AC: task is parked after budget halt
    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-bud",
    );
    assert.ok(taskRow !== undefined, "task-bud must have a scheduler row");
    assert.equal(taskRow.status, "parked", "task must be parked after budget breach");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 003 T1 — deliver commits via push then create_pr; poller drives both
// ---------------------------------------------------------------------------

const S003T1_PUSH_ENTRY: VerbRegistryEntry = {
  verb: "git.push",
  tier: "auto",
  timeout: 30000,
  idempotency: { window_ms: 3600000 },
  retry: { max: 3, backoff: "exponential" },
  poll_interval: 50,
  terminal_states: ["done", "failed"],
  rate_limit: { requests_per_minute: 0 },
  observed_state_can_regress: false,
};

const S003T1_CREATE_PR_ENTRY: VerbRegistryEntry = {
  verb: "github.create_pr",
  tier: "auto_with_audit",
  timeout: 30000,
  idempotency: { window_ms: 3600000 },
  retry: { max: 3, backoff: "exponential" },
  poll_interval: 50,
  terminal_states: ["done", "failed", "escalation_needed"],
  rate_limit: { requests_per_minute: 60 },
  observed_state_can_regress: true,
};

test("Story 003 T1 — deliver commits via push then create_pr; poller drives both to terminal", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s003t1-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };
  const spyPiSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Mock push adapter — submit returns request_id; poll_status immediately done
  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_input: unknown): Promise<unknown> => "req-push-s003t1-001",
    poll_status: async (_requestId: unknown): Promise<unknown> => ({
      status: "done",
      result: { branch: "main", sha: "abc123", remote_url: "file:///test-remote" },
    }),
    reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
  };

  // Mock create_pr adapter — counts submit calls; poll_status immediately done
  let createPrCalls = 0;
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_input: unknown): Promise<unknown> => {
      createPrCalls++;
      return "req-create-pr-s003t1-001";
    },
    poll_status: async (_requestId: unknown): Promise<unknown> => ({
      status: "done",
      result: { head_branch: "main", pr_number: 42 },
    }),
    reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: spyPiSurface,
    statusServerFactory: createStatusServer,
  });

  try {
    // AC: deliverSession submits push then create_pr and starts polling for both
    const result = await handle.deliverSession({
      pushAdapter,
      pushEntry: S003T1_PUSH_ENTRY,
      pushInput: { cwd: "/tmp/test-work", branch: "main", remote: "origin" },
      pushIdempotencyKey: "push-s003t1-001",
      createPrAdapter,
      createPrEntry: S003T1_CREATE_PR_ENTRY,
      createPrInput: { head: "main", base: "main", title: "Test PR", body: "test body" },
      createPrIdempotencyKey: "create-pr-s003t1-001",
    });

    // AC: both ops appear in the ledger op chain (broker_in_flight)
    const ops = store.all<{ verb: string; op_id: string }>(
      "SELECT verb, op_id FROM broker_in_flight",
    );
    assert.ok(
      ops.some((r) => r.verb === "git.push"),
      "push op must appear in broker_in_flight ledger",
    );
    assert.ok(
      ops.some((r) => r.verb === "github.create_pr"),
      "create_pr op must appear in broker_in_flight ledger",
    );

    // Drive push poller to terminal (observed_state_can_regress: false → one tick)
    clock.advance(S003T1_PUSH_ENTRY.poll_interval);
    await Promise.resolve();
    await Promise.resolve();

    // Drive create_pr poller to terminal (observed_state_can_regress: true → two ticks)
    clock.advance(S003T1_CREATE_PR_ENTRY.poll_interval);
    await Promise.resolve();
    await Promise.resolve();
    clock.advance(S003T1_CREATE_PR_ENTRY.poll_interval);
    await Promise.resolve();
    await Promise.resolve();

    // AC: poller drives push to a terminal state
    const pushCompletion = store.get<{ status: string }>(
      "SELECT status FROM broker_completion WHERE op_id = ?",
      result.pushOpId,
    );
    assert.ok(pushCompletion !== undefined, "push op must have a completion row");
    assert.ok(
      ["done", "failed"].includes(pushCompletion.status),
      `push op must be terminal, got: ${pushCompletion.status}`,
    );

    // AC: poller drives create_pr to a terminal state
    const createPrCompletion = store.get<{ status: string }>(
      "SELECT status FROM broker_completion WHERE op_id = ?",
      result.createPrOpId,
    );
    assert.ok(createPrCompletion !== undefined, "create_pr op must have a completion row");
    assert.ok(
      ["done", "failed", "escalation_needed"].includes(createPrCompletion.status),
      `create_pr op must be terminal, got: ${createPrCompletion.status}`,
    );

    // AC: mock adapter's submit called exactly once for create_pr
    assert.equal(createPrCalls, 1, "create_pr adapter submit must be called exactly once");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 003 T2 — LP4: kill mid-create_pr; restart reconciles; no duplicate PR
// ---------------------------------------------------------------------------

test("Story 003 T2 — LP4: kill mid-create_pr; restart reconciles via adapter.reconcile; no duplicate PR", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s003t2-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };
  const spyPiSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // --- Phase 1: "daemon killed mid-create_pr" ---
  // hold-point simulates a kill after the ledger write but before adapter completion.
  const handle1 = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: spyPiSurface,
    statusServerFactory: createStatusServer,
    holdPointEnabled: true,
  });

  let createPrSubmitCalls1 = 0;
  const createPrAdapterRun1: AsyncVerbAdapter = {
    submit: async (_input: unknown): Promise<unknown> => {
      createPrSubmitCalls1++;
      return "req-pr-run1";
    },
    poll_status: async (_requestId: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
  };

  const pushAdapterRun1: AsyncVerbAdapter = {
    submit: async (_input: unknown): Promise<unknown> => "req-push-run1",
    poll_status: async (_requestId: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
  };

  // Deliver with hold-point → both ops recorded as "held"; adapters never called
  const { createPrOpId } = await handle1.deliverSession({
    pushAdapter: pushAdapterRun1,
    pushEntry: S003T1_PUSH_ENTRY,
    pushInput: { cwd: "/tmp/test-work", branch: "feat/lp4", remote: "origin" },
    pushIdempotencyKey: "push-s003t2-001",
    createPrAdapter: createPrAdapterRun1,
    createPrEntry: S003T1_CREATE_PR_ENTRY,
    createPrInput: { head: "feat/lp4", base: "main", title: "LP4 PR", body: "lp4 test" },
    createPrIdempotencyKey: "create-pr-s003t2-001",
  });

  // Assert before-kill: op is "held" (ledger written, adapter not invoked)
  const rowBefore = store.get<{ status: string }>(
    "SELECT status FROM broker_in_flight WHERE op_id = ?",
    createPrOpId,
  );
  assert.ok(rowBefore !== undefined, "create_pr op must be in broker_in_flight before restart");
  assert.equal(rowBefore.status, "held", "create_pr op must be 'held' before restart");
  assert.equal(createPrSubmitCalls1, 0, "adapter submit must not be called when hold-point is active");

  // Simulate kill — stop run-loop 1
  await handle1.stop();

  // --- Phase 2: "daemon restarted" on same store ---
  const handle2 = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: spyPiSurface,
    statusServerFactory: createStatusServer,
  });

  let reconcileCalled2 = false;
  let createPrSubmitCalls2 = 0;
  const createPrAdapterRun2: AsyncVerbAdapter = {
    submit: async (_input: unknown): Promise<unknown> => {
      createPrSubmitCalls2++;
      return "req-pr-run2-dup";
    },
    poll_status: async (_requestId: unknown): Promise<unknown> => ({ status: "done" }),
    // reconcile simulates "head-branch lookup finds existing PR" → done, no second submit
    reconcile: async (_ledger: unknown): Promise<unknown> => {
      reconcileCalled2 = true;
      return { status: "done" };
    },
  };

  try {
    // Reconcile held ops — simulates what the run-loop does on restart
    await handle2.reconcileHeldOps({
      "github.create_pr": { entry: S003T1_CREATE_PR_ENTRY, adapter: createPrAdapterRun2 },
    });

    // AC: adapter.reconcile was called (head-branch lookup path)
    assert.ok(reconcileCalled2, "adapter.reconcile must be called for held create_pr op on restart");

    // AC: no duplicate PR — adapter.submit NOT called on restart
    assert.equal(
      createPrSubmitCalls2,
      0,
      "adapter.submit must NOT be called on restart (no duplicate PR)",
    );

    // AC: op is terminal after reconcile (broker_completion row exists with terminal status)
    const completion = store.get<{ status: string }>(
      "SELECT status FROM broker_completion WHERE op_id = ?",
      createPrOpId,
    );
    assert.ok(completion !== undefined, "held op must have a broker_completion row after reconcile");
    assert.ok(
      ["done", "failed", "escalation_needed"].includes(completion.status),
      `reconciled op must be terminal, got: ${completion.status}`,
    );
  } finally {
    await handle2.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 004 T1 — escalation surfaces + response resumes/halts
// ---------------------------------------------------------------------------

const S004T1_EPIC_MD = `---
id: feat-s004t1
repo: backend
ticket_system: jira
ticket: JIRA-S4
---

## Acceptance

Feature complete when task-esc passes.
`;

const S004T1_TASK_MD = `---
id: task-esc
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-S4B
write_scope:
  - src/foo/
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

out

## Tests

tests
`;

test("Story 004 T1 — resume response un-parks task; next tick re-dispatches", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s004t1-resume-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  let spawnCount = 0;
  const scriptedPiSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      const currentSpawn = spawnCount;
      const o = opts as Record<string, unknown>;
      const hook = o["beforeToolCall"] as (ctx: unknown) => Promise<unknown>;
      return {
        abort() {},
        async waitForIdle() {
          if (currentSpawn === 1) {
            // First spawn: fire out-of-scope write → parks task + creates escalation
            await hook({
              assistantMessage: { role: "assistant", content: [] },
              toolCall: { id: "call-oos-s4t1", name: "write", input: { path: "src/outside/esc.ts" } },
              args: { path: "src/outside/esc.ts" },
              context: { systemPrompt: "", messages: [], tools: [] },
            });
          }
          // Second spawn (after resume): return cleanly without escalation
        },
        reset() {},
        contextTokens: 0,
      };
    },
  };

  await writeFile(join(featureDir, "epic.md"), S004T1_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-esc.md"), S004T1_TASK_MD, "utf8");

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: scriptedPiSurface,
    statusServerFactory: createStatusServer,
  });

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s004t1");

    // Tick 1: dispatch → escalation fires → task parked
    await handle.tick();
    assert.equal(spawnCount, 1, "spawnAgent must be called once on first tick");

    // Retrieve the escalation inbox item
    const items = store.all<{ id: string; kind: string; evidence: string }>(
      "SELECT id, kind, evidence FROM inbox_items",
    );
    assert.ok(items.length > 0, "at least one inbox item must exist after escalation");
    const item = items[0];
    assert.ok(item !== undefined, "inbox item must be non-undefined");
    assert.equal(item.kind, "escalation", "inbox item kind must be 'escalation'");
    const evidence = JSON.parse(item.evidence) as Record<string, unknown>;
    const taskId = evidence["task_id"] as string;
    assert.ok(typeof taskId === "string" && taskId.length > 0, "evidence must carry task_id");

    // Verify task is parked
    const parkedRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      taskId,
    );
    assert.equal(parkedRow?.status, "parked", "task must be parked after escalation");

    // AC: resume response un-parks the task (sets status back to 'pending')
    resumeEscalationItem({ item_id: item.id, task_id: taskId, actor: "test-operator", store, clock });

    const resumedRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      taskId,
    );
    assert.equal(resumedRow?.status, "pending", "task must be pending after resume response");

    // AC: next tick re-dispatches (spawnAgent called a second time)
    await handle.tick();
    assert.equal(spawnCount, 2, "spawnAgent must be called again after resume");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Story 004 T1 — halt response stops task; next tick does not re-dispatch", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s004t1-halt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  let spawnCount = 0;
  const scriptedPiSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      const o = opts as Record<string, unknown>;
      const hook = o["beforeToolCall"] as (ctx: unknown) => Promise<unknown>;
      return {
        abort() {},
        async waitForIdle() {
          await hook({
            assistantMessage: { role: "assistant", content: [] },
            toolCall: { id: "call-oos-s4t1-halt", name: "write", input: { path: "src/outside/halt.ts" } },
            args: { path: "src/outside/halt.ts" },
            context: { systemPrompt: "", messages: [], tools: [] },
          });
        },
        reset() {},
        contextTokens: 0,
      };
    },
  };

  await writeFile(join(featureDir, "epic.md"), S004T1_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-esc.md"), S004T1_TASK_MD, "utf8");

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: scriptedPiSurface,
    statusServerFactory: createStatusServer,
  });

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s004t1");

    // Tick 1: dispatch → escalation → task parked
    await handle.tick();
    assert.equal(spawnCount, 1, "spawnAgent must be called once on first tick");

    const items2 = store.all<{ id: string; kind: string; evidence: string }>(
      "SELECT id, kind, evidence FROM inbox_items",
    );
    assert.ok(items2.length > 0, "escalation inbox item must exist");
    const item2 = items2[0];
    assert.ok(item2 !== undefined, "inbox item must be non-undefined");
    const evidence2 = JSON.parse(item2.evidence) as Record<string, unknown>;
    const taskId2 = evidence2["task_id"] as string;
    assert.ok(typeof taskId2 === "string" && taskId2.length > 0, "evidence must carry task_id");

    // AC: halt response sets task to 'halted'
    haltEscalationItem({ item_id: item2.id, task_id: taskId2, actor: "test-operator", store, clock });

    const haltedRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      taskId2,
    );
    assert.equal(haltedRow?.status, "halted", "task must be halted after halt response");

    // AC: next tick does NOT re-dispatch the halted task
    await handle.tick();
    assert.equal(spawnCount, 1, "spawnAgent must NOT be called again after halt response");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 004 T2 — observe merged PR state; tick marks task complete
// ---------------------------------------------------------------------------

// Minimal feature fixtures for S004T2 — used by compile() to create the
// plan_generation table via the real schema path (S4 review fix).
const S004T2_EPIC_MD = `---
id: feat-s4t2
repo: backend
ticket_system: jira
ticket: JIRA-S4T2
---

## Acceptance

Feature complete when task-s4t2 passes.
`;

const S004T2_INDEX_MD = `# Story S4T2\n`;

const S004T2_TASK_MD = `---
id: task-s4t2
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-S4T2B
write_scope:
  - src/
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

out

## Tests

tests
`;

// create_pr entry with "merged" as a recognised terminal state so the poller
// writes the broker_completion row that tick() observes.
const S004T2_CREATE_PR_ENTRY: VerbRegistryEntry = {
  verb: "github.create_pr",
  tier: "auto_with_audit",
  timeout: 30000,
  idempotency: { window_ms: 3600_000 },
  retry: { max: 3, backoff: "exponential" },
  poll_interval: 50,
  terminal_states: ["done", "failed", "merged"],
  rate_limit: { requests_per_minute: 60 },
  observed_state_can_regress: false,
};

test("Story 004 T2 — observe merged PR state; tick marks task complete; no merge call issued", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s004t2-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  // Seed feature dir so compile() creates plan_generation via the real schema
  // path (S4 review fix — replaces the manual CREATE TABLE below).
  await writeFile(join(featureDir, "epic.md"), S004T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-task"), { recursive: true });
  await writeFile(join(featureDir, "001-task", "INDEX.md"), S004T2_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-task", "task-s4t2.md"), S004T2_TASK_MD, "utf8");

  const piSurface = {
    spawnAgent(_opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Push adapter — completes immediately
  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_input: unknown): Promise<unknown> => "req-push-s004t2",
    poll_status: async (_requestId: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
  };

  // Create-PR adapter — polls "merged" (terminal); tracks submit calls to verify
  // the daemon never issues a second (merge) call.
  let createPrSubmitCalls = 0;
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_input: unknown): Promise<unknown> => {
      createPrSubmitCalls++;
      return "req-create-pr-s004t2";
    },
    poll_status: async (_requestId: unknown): Promise<unknown> => ({
      status: "merged",
      result: { pr_number: 99 },
    }),
    reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory: createStatusServer,
  });

  try {
    // compile() creates plan_generation (and the rest of the schema) via the real
    // path — no manual DDL (S4 review fix).  T2 is about the completion-check
    // phase only; the scheduler will find tasks but the manually-inserted
    // scheduler_task below is already "running" so dispatch is a no-op.
    await compile(featureDir, store, { repoRegistry: ["backend"] });

    // Seed the scheduler_task row that tick() will mark "complete"
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-s4t2",
      "feat-s4t2",
      "running",
    );

    // deliverSession links createPrOpId → "task-s4t2" in the prOpTaskMap closure
    const { createPrOpId } = await handle.deliverSession({
      pushAdapter,
      pushEntry: S003T1_PUSH_ENTRY,
      pushInput: { cwd: "/tmp/test", branch: "feat/t2", remote: "origin" },
      pushIdempotencyKey: "push-s4t2-001",
      createPrAdapter,
      createPrEntry: S004T2_CREATE_PR_ENTRY,
      createPrInput: { head: "feat/t2", base: "main", title: "T2 PR", body: "" },
      createPrIdempotencyKey: "create-pr-s4t2-001",
      taskId: "task-s4t2",
    });

    // Advance clock to fire both pollers (push → done; create_pr → merged)
    clock.advance(S004T2_CREATE_PR_ENTRY.poll_interval);
    await Promise.resolve();
    await Promise.resolve();

    // Verify: broker_completion row exists with status "merged"
    const completionRow = store.get<{ status: string }>(
      "SELECT status FROM broker_completion WHERE op_id = ?",
      createPrOpId,
    );
    assert.ok(completionRow !== undefined, "broker_completion row must exist after poller fires");
    assert.equal(completionRow.status, "merged", "completion status must be 'merged'");

    // tick() observes the "merged" broker_completion and marks the task complete
    await handle.tick();

    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-s4t2",
    );
    assert.equal(taskRow?.status, "complete", "task must be marked complete after PR merge observed");

    // AC: daemon never calls merge — submit was called exactly once (initial PR creation only)
    assert.equal(
      createPrSubmitCalls,
      1,
      "create_pr adapter submit must be called exactly once; daemon must not issue a merge call",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 004 T3 — LP3 respawn clause: budget halt survives daemon restart
// ---------------------------------------------------------------------------

const S004T3_EPIC_MD = `---
id: feat-s004t3
repo: backend
ticket_system: jira
ticket: JIRA-S4T3
---

## Acceptance

Feature complete when task-restart-halt passes.
`;

const S004T3_TASK_MD = `---
id: task-restart-halt
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-S4T3B
write_scope:
  - src/foo/
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

out

## Tests

tests
`;

test("Story 004 T3 — LP3 respawn: budget-halted task is not re-dispatched after daemon restart", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s004t3-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  let spawnCount = 0;
  const countingPiSurface = {
    spawnAgent(_opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Seed feature dir
  await writeFile(join(featureDir, "epic.md"), S004T3_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-restart"), { recursive: true });
  await writeFile(join(featureDir, "001-restart", "INDEX.md"), "# Story Restart\n", "utf8");
  await writeFile(join(featureDir, "001-restart", "task-restart-halt.md"), S004T3_TASK_MD, "utf8");

  // --- Daemon 1: budget breach → task parked ---
  const handle1 = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: countingPiSurface,
    statusServerFactory: createStatusServer,
    taskBudget: { ceiling: 0, conservativeCost: 1 },
  });

  await compile(featureDir, store, { repoRegistry: ["backend"] });
  loadTasks(store, "feat-s004t3");

  await handle1.tick();

  // Pre-restart assertion: task is parked, no session was spawned
  const parkedRow = store.get<{ status: string }>(
    "SELECT status FROM scheduler_task WHERE node_id = ?",
    "task-restart-halt",
  );
  assert.equal(parkedRow?.status, "parked", "task must be parked after budget breach (pre-restart)");
  assert.equal(spawnCount, 0, "spawnAgent must not be called when budget is breached");

  await handle1.stop();

  // --- Daemon 2: restart on same store (fresh budgetBreaker, task still 'parked') ---
  const handle2 = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: countingPiSurface,
    statusServerFactory: createStatusServer,
    // No taskBudget: the durable 'parked' status alone must prevent re-dispatch
  });

  try {
    await handle2.tick();

    // AC: LP3 respawn clause — parked task is not re-dispatched after restart
    assert.equal(spawnCount, 0, "spawnAgent must NOT be called after restart — task remains parked");

    // AC: halt is durable — task status unchanged in store
    const restartRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-restart-halt",
    );
    assert.equal(restartRow?.status, "parked", "task must remain parked after daemon restart");
  } finally {
    await handle2.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// B2-review — auto-tick regression
// Reviewer blocker B2: runDaemon never schedules tick() on a timer.
// ---------------------------------------------------------------------------

const B2_REVIEW_EPIC_MD = `---
id: feat-b2review
repo: backend
ticket_system: jira
ticket: JIRA-B2R
---

## Acceptance

Feature complete when auto-tick-task passes.
`;

const B2_REVIEW_TASK_MD = `---
id: auto-tick-task
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-B2RT
write_scope:
  - src/foo/
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

out

## Tests

tests
`;

test("B2-review — runDaemon auto-dispatches via tickIntervalMs timer without manual tick()", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-b2review-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), B2_REVIEW_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "auto-tick-task.md"), B2_REVIEW_TASK_MD, "utf8");
  await compile(featureDir, store, { repoRegistry: ["backend"] });

  let spawnCount = 0;
  let resolveSpawned!: () => void;
  const spawnedPromise = new Promise<void>((res) => {
    resolveSpawned = res;
  });
  const spyPiSurface = {
    spawnAgent(_opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      resolveSpawned();
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // tickIntervalMs is the new dep (B2 fix): runDaemon must schedule tick() on a timer.
  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: spyPiSurface,
    statusServerFactory: createStatusServer,
    tickIntervalMs: 100,
  } as Parameters<typeof runDaemon>[0]);

  try {
    // Do NOT call handle.tick() — the run-loop must self-dispatch.
    clock.advance(100); // fires the timer callback if tickIntervalMs is wired

    // Race the spy-resolved promise against a real 500ms wall-clock timeout.
    // Fails now: no timer is scheduled so spawnedPromise never resolves → "timeout".
    const outcome = await Promise.race([
      spawnedPromise.then(() => "dispatched" as const),
      new Promise<"timeout">((res) => { setTimeout(() => { res("timeout"); }, 500); }),
    ]);

    assert.equal(
      outcome,
      "dispatched",
      "runDaemon must auto-dispatch via tickIntervalMs timer without manual tick()",
    );
    assert.equal(spawnCount, 1, "exactly one spawnAgent call expected from the auto-tick");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// S1-review — readFeature error must not strand task in "running"
// Reviewer suggestion S1: FeatureStore/readFeature() inside per-task loop
// leaves the task stuck in "running" if it throws.
// ---------------------------------------------------------------------------

const S1_REVIEW_EPIC_MD = `---
id: feat-s1review
repo: backend
ticket_system: jira
ticket: JIRA-S1R
---

## Acceptance

Feature complete when s1-review-task passes.
`;

const S1_REVIEW_TASK_MD = `---
id: s1-review-task
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-S1RT
write_scope:
  - src/foo/
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

out

## Tests

tests
`;

test("S1-review — readFeature error does not strand task in 'running' status", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s1review-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };
  const spyPiSurface = {
    spawnAgent(_opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Seed feature dir so compile + bootDaemon succeed (plan_generation gets rows).
  await writeFile(join(featureDir, "epic.md"), S1_REVIEW_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-beta"), { recursive: true });
  await writeFile(join(featureDir, "001-beta", "INDEX.md"), "# Story Beta\n", "utf8");
  await writeFile(join(featureDir, "001-beta", "s1-review-task.md"), S1_REVIEW_TASK_MD, "utf8");
  await compile(featureDir, store, { repoRegistry: ["backend"] });

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: spyPiSurface,
    statusServerFactory: createStatusServer,
  });

  try {
    // Remove epic.md so readFeature() throws ENOENT during tick().
    // Without S1 fix: setTaskStatus("running") runs first, then readFeature throws
    // and the exception propagates — task is stranded in "running" with no cleanup.
    await rm(join(featureDir, "epic.md"));

    // tick() will: loadTasks, setTaskStatus("running"), then readFeature() → ENOENT.
    try {
      await handle.tick();
    } catch {
      // tick may propagate the error — absorb it; we assert task status only.
    }

    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "s1-review-task",
    );
    assert.notEqual(
      taskRow?.status,
      "running",
      "a readFeature error must not strand the task in 'running' — expected cleanup to 'pending' or an error status",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// S2-review — signal-handler stop error logged via injected logger
// ---------------------------------------------------------------------------

test("S2-review — signal-handler stop error is logged via injected logger, not silently swallowed", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s2-review-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const loggedMessages: Array<Record<string, unknown>> = [];
  const logger = {
    info(r: Record<string, unknown>): void {
      loggedMessages.push(r);
    },
  };

  const stopError = new Error("server stop failed S2");

  // statusServerFactory whose stop() throws to exercise the catch path in handleSignal
  const mockStatusServerFactory = (_opts: { store: unknown }) => ({
    start: async (): Promise<{ host: string; port: number }> => ({ host: "127.0.0.1", port: 0 }),
    stop: async (): Promise<void> => {
      throw stopError;
    },
  });

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: {
      spawnAgent(_opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
        return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
      },
    },
    statusServerFactory: mockStatusServerFactory,
  });

  try {
    // Emit SIGTERM to exercise the signal handler path (not handle.stop() directly,
    // which bypasses the .catch() wrapper in handleSignal).
    process.emit("SIGTERM");
    // Drain micro-task queue so the async handler completes.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // AC: logger must be called with the error, not silently discarded.
    assert.ok(
      loggedMessages.some((m) => m["err"] !== undefined || m["error"] !== undefined),
      "logger.info must be called with the stop error before it is swallowed",
    );
  } finally {
    // doStop() already ran (stopped=true); this is a no-op but ensures cleanup.
    await handle.stop().catch(() => {});
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// S3-review — role registry is not a blanket wildcard
// ---------------------------------------------------------------------------

test("S3-review — assembled ring-1 hook blocks read outside write_scope (not a blanket ** allow)", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s3-review-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  // Reuse the S002 feature fixtures (write_scope: ["src/foo/"]) so compile
  // succeeds and tick() dispatches one task.
  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const spawnCalls: Array<Record<string, unknown>> = [];
  const piSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCalls.push(opts as Record<string, unknown>);
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory: createStatusServer,
  });

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    assert.equal(spawnCalls.length, 1, "spawnAgent must be called by tick()");
    const spawnOpts = spawnCalls[0] as Record<string, unknown>;
    const beforeToolCall = spawnOpts["beforeToolCall"] as (
      ctx: unknown,
    ) => Promise<{ block: boolean; reason?: string } | undefined>;

    // A read to an absolute system path outside any reasonable worktree must be
    // blocked by the role read policy once the registry is tightened from "**".
    // Currently fails: read.allow:["**"] returns undefined (pass-through).
    const result = await beforeToolCall({
      toolCall: { id: "tc-s3", name: "read", input: { path: "/etc/passwd" } },
      args: { path: "/etc/passwd" },
      context: { systemPrompt: "", messages: [], tools: [] },
      assistantMessage: { role: "assistant", content: [] },
    });

    assert.equal(
      result?.block,
      true,
      "role read policy must NOT be a blanket ** — reads outside the agent's scope must be blocked",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// GAP1 — tick() must source PI_DEFAULT_ALLOWED_MANIFEST + PI_EXEC_TOOLS
// ---------------------------------------------------------------------------

test("GAP1 — tick() spawns with 6-tool manifest (read,grep,find,ls,edit,write), bash absent, not []", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-gap1a-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const spawnCalls: Array<Record<string, unknown>> = [];
  const piSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCalls.push(opts as Record<string, unknown>);
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory: createStatusServer,
  });

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    assert.equal(spawnCalls.length, 1, "spawnAgent must be called by tick()");
    const toolsArg = (spawnCalls[0] as Record<string, unknown>)["tools"];
    assert.ok(Array.isArray(toolsArg), "spawnAgent must receive a tools array");
    const toolNames = toolsArg as string[];

    const EXPECTED = ["read", "grep", "find", "ls", "edit", "write"];
    assert.equal(
      toolNames.length,
      EXPECTED.length,
      `tools must have exactly ${EXPECTED.length} entries (PI_DEFAULT_ALLOWED_MANIFEST); got ${toolNames.length} — tick() is passing allowedToolNames:[]`,
    );
    for (const name of EXPECTED) {
      assert.ok(toolNames.includes(name), `tool "${name}" must be present in the manifest`);
    }
    assert.ok(!toolNames.includes("bash"), "exec tool 'bash' must NOT be in the manifest");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("GAP1 — tick() ring-1 beforeToolCall blocks exec tool (bash) fail-closed via PI_EXEC_TOOLS", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-gap1b-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const spawnCalls: Array<Record<string, unknown>> = [];
  const piSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCalls.push(opts as Record<string, unknown>);
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory: createStatusServer,
  });

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    assert.equal(spawnCalls.length, 1, "spawnAgent must be called by tick()");
    const beforeToolCall = (spawnCalls[0] as Record<string, unknown>)["beforeToolCall"] as (
      ctx: unknown,
    ) => Promise<{ block: boolean; reason?: string } | undefined>;

    // bash has no path arg — must be blocked by unknownEffectfulToolNames (PI_EXEC_TOOLS)
    // Currently FAILS: unknownEffectfulToolNames is empty Set → bash passes through (undefined)
    const result = await beforeToolCall({
      toolCall: { id: "tc-gap1b", name: "bash", input: { command: "rm -rf /" } },
      args: { command: "rm -rf /" },
      context: { systemPrompt: "", messages: [], tools: [] },
      assistantMessage: { role: "assistant", content: [] },
    });

    assert.equal(
      result?.block,
      true,
      "exec tool 'bash' must be blocked fail-closed — tick() must source PI_EXEC_TOOLS as unknownEffectfulToolNames",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// GAP2 — outbound secret-scan guard threaded into deliverSession
// ---------------------------------------------------------------------------

test("GAP2 — deliverSession with matching pattern: push blocked; escalation carries patternClass only (no secret)", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-gap2a-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };
  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Pattern registry whose regex matches the sentinel embedded in the branch name.
  const patternRegistry = {
    version: "1.0",
    patterns: [{ name: "sentinel-key-class", regex: "SENTINEL_SECRET_XYZ_GAP2" }],
  };

  const handle = await runDaemon(
    // patternRegistry is not yet in RunDaemonDeps — added by GAP2 SE turn
    {
      store,
      featureDir,
      clock,
      logger,
      piSurface,
      statusServerFactory: createStatusServer,
      patternRegistry,
    } as unknown as Parameters<typeof runDaemon>[0],
  );

  let pushSubmitCalls = 0;
  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_input: unknown): Promise<unknown> => {
      pushSubmitCalls++;
      return "req-gap2a-push";
    },
    poll_status: async (_req: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_input: unknown): Promise<unknown> => "req-gap2a-pr",
    poll_status: async (_req: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
  };

  try {
    // pushInput branch name embeds the sentinel — JSON.stringify(pushInput) will match the pattern.
    await handle.deliverSession({
      pushAdapter,
      pushEntry: S003T1_PUSH_ENTRY,
      pushInput: { cwd: "/fake", branch: "feature/SENTINEL_SECRET_XYZ_GAP2", remote: "origin" },
      pushIdempotencyKey: "push-gap2a-001",
      createPrAdapter,
      createPrEntry: S003T1_CREATE_PR_ENTRY,
      createPrInput: { head_branch: "feature/gap2a", repo: "test" },
      createPrIdempotencyKey: "pr-gap2a-001",
      taskId: "gap2a-task",
    }).catch(() => {
      // deliverSession may throw when blocked — acceptable
    });

    // AC: push adapter submit must NOT be called when pattern matches
    assert.equal(
      pushSubmitCalls,
      0,
      "GAP2: push must be blocked — adapter.submit must not fire when pattern matches",
    );

    // AC: escalation inbox item exists with patternClass but no raw secret
    const inboxRows = store.all<{ kind: string; evidence: string }>(
      "SELECT kind, evidence FROM inbox_items",
    );
    assert.ok(inboxRows.length > 0, "GAP2: escalation item must be created when push is blocked by scan");
    const firstItem = inboxRows[0];
    assert.ok(firstItem !== undefined, "inbox item must be non-undefined");
    const evidenceStr = JSON.stringify(JSON.parse(firstItem.evidence));
    // patternClass (class name) must appear; raw secret must not
    assert.ok(
      evidenceStr.includes("sentinel-key-class"),
      "GAP2: escalation evidence must carry patternClass ('sentinel-key-class'), not the raw secret",
    );
    assert.ok(
      !evidenceStr.includes("SENTINEL_SECRET_XYZ_GAP2"),
      "GAP2: escalation evidence must NOT surface the raw secret value",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("GAP2 — deliverSession with null registry (absent): push blocked fail-closed; tagged scan-unavailable", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-gap2b-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };
  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon(
    // patternRegistry: null → registry absent → fail-closed
    {
      store,
      featureDir,
      clock,
      logger,
      piSurface,
      statusServerFactory: createStatusServer,
      patternRegistry: null,
    } as unknown as Parameters<typeof runDaemon>[0],
  );

  let pushSubmitCalls = 0;
  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_input: unknown): Promise<unknown> => {
      pushSubmitCalls++;
      return "req-gap2b-push";
    },
    poll_status: async (_req: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
  };

  try {
    await handle.deliverSession({
      pushAdapter,
      pushEntry: S003T1_PUSH_ENTRY,
      pushInput: { cwd: "/fake", branch: "feature/clean-branch", remote: "origin" },
      pushIdempotencyKey: "push-gap2b-001",
      createPrAdapter: pushAdapter,
      createPrEntry: S003T1_CREATE_PR_ENTRY,
      createPrInput: { head_branch: "feature/clean", repo: "test" },
      createPrIdempotencyKey: "pr-gap2b-001",
      taskId: "gap2b-task",
    }).catch(() => {
      // deliverSession may throw when blocked — acceptable
    });

    // AC: push is blocked when registry is absent (fail-closed, NOT skipped)
    assert.equal(
      pushSubmitCalls,
      0,
      "GAP2: push must be blocked when registry is null — scan-unavailable is fail-closed",
    );

    // AC: escalation inbox item exists tagged scan-unavailable
    const inboxRows = store.all<{ kind: string; evidence: string }>(
      "SELECT kind, evidence FROM inbox_items",
    );
    assert.ok(inboxRows.length > 0, "GAP2: escalation item must be created for scan-unavailable block");
    const firstItem = inboxRows[0];
    assert.ok(firstItem !== undefined, "inbox item must be non-undefined");
    const evidenceStr = JSON.stringify(JSON.parse(firstItem.evidence));
    assert.ok(
      evidenceStr.includes("scan-unavailable"),
      "GAP2: escalation evidence must be tagged 'scan-unavailable' when registry is absent",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// GAP4 — budget spend durability across daemon restart
// Gaps file: .agent/plan/feedback/019.2-kanthord-run-launcher/live-path-enforcement-gaps.md §Gap 4
// AC: breach a budget, restart the daemon (new runDaemon over the same store),
//     and the task is STILL halted — spend survives restart.
// ---------------------------------------------------------------------------

const GAP4_EPIC_MD = `---
id: feat-gap4
repo: backend
ticket_system: jira
ticket: JIRA-GAP4
---

## Acceptance

Feature complete when task-gap4-spend passes.
`;

const GAP4_TASK_MD = `---
id: task-gap4-spend
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-GAP4B
write_scope:
  - src/foo/
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

out

## Tests

tests
`;

// ---------------------------------------------------------------------------
// RB3 — create_pr submit must also be guarded by the outbound scan guard
// Review blocker: run-loop.ts:480-487 create_pr proceeds without scan;
// live-path-enforcement-gaps.md Gap 2 requires "every outbound verb" to be guarded.
//
// AC: push with no sentinel passes (push adapter called once);
//     create_pr with sentinel in payload is blocked (create_pr adapter never called).
// ---------------------------------------------------------------------------

test("RB3 — deliverSession create_pr submit guarded: payload with matching pattern is blocked fail-closed, adapter not called", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-rb3-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };
  const piSurface = {
    spawnAgent(
      _opts: unknown,
    ): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Pattern registry whose regex matches only the create_pr sentinel (not push payload).
  const patternRegistry = {
    version: "1.0",
    patterns: [{ name: "pr-secret-class", regex: "CREATE_PR_SENTINEL_RB3" }],
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory: createStatusServer,
    patternRegistry,
  });

  let pushSubmitCalls = 0;
  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_input: unknown): Promise<unknown> => {
      pushSubmitCalls++;
      return "req-rb3-push";
    },
    poll_status: async (_req: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
  };

  let createPrSubmitCalls = 0;
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_input: unknown): Promise<unknown> => {
      createPrSubmitCalls++;
      return "req-rb3-pr";
    },
    poll_status: async (_req: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
  };

  try {
    // push payload: no sentinel → push scan passes → push adapter called.
    // create_pr payload: title embeds sentinel → scan must block (after RB3 fix).
    await handle
      .deliverSession({
        pushAdapter,
        pushEntry: S003T1_PUSH_ENTRY,
        pushInput: { cwd: "/fake", branch: "feature/clean-no-match", remote: "origin" },
        pushIdempotencyKey: "push-rb3-001",
        createPrAdapter,
        createPrEntry: S003T1_CREATE_PR_ENTRY,
        createPrInput: {
          head_branch: "feature/fix",
          title: "feat: expose CREATE_PR_SENTINEL_RB3 in title",
        },
        createPrIdempotencyKey: "pr-rb3-001",
        taskId: "rb3-task",
      })
      .catch(() => {
        // deliverSession throws when the create_pr scan blocks (after fix) — expected.
      });

    // AC: push proceeded (push payload had no sentinel match).
    assert.equal(pushSubmitCalls, 1, "RB3: push adapter must be called once (no sentinel in push payload)");

    // AC: create_pr is blocked — adapter must NOT be called.
    // Currently FAILS because create_pr submit at run-loop.ts:480-487 has no scan guard.
    assert.equal(
      createPrSubmitCalls,
      0,
      "RB3: create_pr adapter submit must NOT be called — create_pr payload must be guarded by the scan guard (Gap 2: every outbound verb)",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("GAP4 — budget spend survives daemon restart; partially-spent task is halted on second daemon", async () => {
  // ceiling=15, conservativeCost=10:
  //   first reserve:  current=0,  projected=10 < 15  → proceed (saves spend=10)
  //   second reserve: current=10, projected=20 > 15  → halted
  // Bug (in-memory Map): on restart spend resets to 0 → second reserve 0+10=10 < 15 → proceeds (WRONG)
  // Fix (budget_ledger): persisted spend=10 → second reserve 10+10=20 > 15 → halted (CORRECT)
  const featureDir = await mkdtemp(join(tmpdir(), "krl-gap4-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  let spawnCount = 0;
  const countingPiSurface = {
    spawnAgent(
      _opts: unknown,
    ): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  await writeFile(join(featureDir, "epic.md"), GAP4_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-spend"), { recursive: true });
  await writeFile(join(featureDir, "001-spend", "INDEX.md"), "# Story Spend\n", "utf8");
  await writeFile(join(featureDir, "001-spend", "task-gap4-spend.md"), GAP4_TASK_MD, "utf8");

  // --- Daemon 1: first reserve proceeds; spend is consumed ---
  const handle1 = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: countingPiSurface,
    statusServerFactory: createStatusServer,
    taskBudget: { ceiling: 15, conservativeCost: 10 },
  });

  await compile(featureDir, store, { repoRegistry: ["backend"] });
  loadTasks(store, "feat-gap4");

  await handle1.tick();

  // Phase 1 assertion: first reserve proceeded — session was spawned, spend consumed
  assert.equal(
    spawnCount,
    1,
    "GAP4: first tick must spawn the session (budget not yet breached; 0+10=10 < 15)",
  );
  // Reset task to 'pending' to simulate re-queue after restart
  store.run(
    "UPDATE scheduler_task SET status='pending' WHERE node_id=?",
    "task-gap4-spend",
  );

  await handle1.stop();

  // --- Daemon 2: restart over same store; budget_ledger must carry spend=10 ---
  const handle2 = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: countingPiSurface,
    statusServerFactory: createStatusServer,
    taskBudget: { ceiling: 15, conservativeCost: 10 },
  });

  try {
    await handle2.tick();

    // AC: spend is durable — second tick must NOT spawn (10+10=20 > 15 → halted)
    assert.equal(
      spawnCount,
      1,
      "GAP4: budget spend must survive daemon restart — spawnAgent must not be called again",
    );

    // AC: task is parked after the second budget halt
    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-gap4-spend",
    );
    assert.equal(
      taskRow?.status,
      "parked",
      "GAP4: task must be parked after budget halt on restart — spend survived in budget_ledger",
    );
  } finally {
    await handle2.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});
