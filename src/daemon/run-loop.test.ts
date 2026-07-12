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
import { loadTasks, setTaskStatus } from "../scheduler/dispatch.ts";
import { resumeEscalationItem, haltEscalationItem } from "../rpc/inbox-respond.ts";
import type { GateResult, GateResultSink } from "../workflow/workflow.ts";
import { latestEvidence } from "../scheduler/attempt-evidence.ts";
import { readAttempts, grantOne, rearmLedger } from "../scheduler/attempt-ledger.ts";
import { initSchema } from "../store/schema.ts";
import type { WorktreeDispatchOpts, WorktreeDispatchResult } from "../slots/worktree.ts";

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
// 019.7 Story 004 T1 — tick triggers deliverSession after committed session
// ---------------------------------------------------------------------------

const S4T1DEL_EPIC_MD = `---
id: feat-s4t1del
repo: backend
ticket_system: jira
ticket: JIRA-S4D1
---

## Acceptance

Feature complete when task-del passes.
`;

const S4T1DEL_TASK_MD = `---
id: task-del
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-S4D2
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

const S4T1DEL_PUSH_ENTRY: VerbRegistryEntry = {
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

const S4T1DEL_CREATE_PR_ENTRY: VerbRegistryEntry = {
  verb: "github.create_pr",
  tier: "auto_with_audit",
  timeout: 30000,
  idempotency: { window_ms: 3600000 },
  retry: { max: 3, backoff: "exponential" },
  poll_interval: 50,
  terminal_states: ["done", "failed", "merged"],
  rate_limit: { requests_per_minute: 60 },
  observed_state_can_regress: false,
};

test("019.7 S4T1 — tick triggers deliverSession once after committed session; skips when no commits ahead", async () => {
  // --- Phase A: commitsAhead=0 → delivery must NOT be triggered ---
  {
    const featureDirA = await mkdtemp(join(tmpdir(), "krl-s4t1del-a-"));
    const storeA = openStore(":memory:", { busyTimeout: 1000 });
    const clockA = new FakeClock(1_000_000_000);
    const loggerA = { info(_r: Record<string, unknown>): void {} };
    await writeFile(join(featureDirA, "epic.md"), S4T1DEL_EPIC_MD, "utf8");
    await writeFile(join(featureDirA, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await mkdir(join(featureDirA, "001-del"), { recursive: true });
    await writeFile(join(featureDirA, "001-del", "INDEX.md"), "# Story Del\n", "utf8");
    await writeFile(join(featureDirA, "001-del", "task-del.md"), S4T1DEL_TASK_MD, "utf8");
    const piSurfaceA = {
      spawnAgent(_opts: unknown) {
        return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
      },
    };
    let pushSubmitCallsA = 0;
    const pushAdapterA: AsyncVerbAdapter = {
      submit: async (_i: unknown): Promise<unknown> => { pushSubmitCallsA++; return "req-push-a"; },
      poll_status: async (_r: unknown): Promise<unknown> => ({ status: "done" }),
      reconcile: async (_l: unknown): Promise<unknown> => ({ status: "done" }),
    };
    const createPrAdapterA: AsyncVerbAdapter = {
      submit: async (_i: unknown): Promise<unknown> => "req-pr-a",
      poll_status: async (_r: unknown): Promise<unknown> => ({ status: "done" }),
      reconcile: async (_l: unknown): Promise<unknown> => ({ status: "done" }),
    };
    const handleA = await runDaemon({
      store: storeA,
      featureDir: featureDirA,
      clock: clockA,
      logger: loggerA,
      piSurface: piSurfaceA,
      statusServerFactory: createStatusServer,
      verbAdapters: {
        "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: pushAdapterA },
        "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: createPrAdapterA },
      },
      commitsAhead: async (_branch: string, _base: string): Promise<number> => 0,
      remote: "origin",
    } as unknown as Parameters<typeof runDaemon>[0]);
    try {
      await compile(featureDirA, storeA, { repoRegistry: ["backend"] });
      loadTasks(storeA, "feat-s4t1del");
      await handleA.tick();
      assert.equal(
        pushSubmitCallsA,
        0,
        "S4T1-A: deliverSession must NOT be called when commitsAhead=0",
      );
    } finally {
      await handleA.stop();
      storeA.close();
      await rm(featureDirA, { recursive: true, force: true });
    }
  }

  // --- Phase B: commitsAhead=1 → delivery triggered exactly once ---
  {
    const featureDirB = await mkdtemp(join(tmpdir(), "krl-s4t1del-b-"));
    const storeB = openStore(":memory:", { busyTimeout: 1000 });
    const clockB = new FakeClock(1_000_000_000);
    const loggerB = { info(_r: Record<string, unknown>): void {} };
    await writeFile(join(featureDirB, "epic.md"), S4T1DEL_EPIC_MD, "utf8");
    await writeFile(join(featureDirB, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await mkdir(join(featureDirB, "001-del"), { recursive: true });
    await writeFile(join(featureDirB, "001-del", "INDEX.md"), "# Story Del\n", "utf8");
    await writeFile(join(featureDirB, "001-del", "task-del.md"), S4T1DEL_TASK_MD, "utf8");
    const piSurfaceB = {
      spawnAgent(_opts: unknown) {
        return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
      },
    };
    const pushSubmitInputsB: unknown[] = [];
    const pushAdapterB: AsyncVerbAdapter = {
      submit: async (input: unknown): Promise<unknown> => {
        pushSubmitInputsB.push(input);
        return "req-push-b";
      },
      poll_status: async (_r: unknown): Promise<unknown> => ({ status: "done" }),
      reconcile: async (_l: unknown): Promise<unknown> => ({ status: "done" }),
    };
    const createPrSubmitInputsB: unknown[] = [];
    const createPrAdapterB: AsyncVerbAdapter = {
      submit: async (input: unknown): Promise<unknown> => {
        createPrSubmitInputsB.push(input);
        return "req-pr-b";
      },
      poll_status: async (_r: unknown): Promise<unknown> => ({ status: "done" }),
      reconcile: async (_l: unknown): Promise<unknown> => ({ status: "done" }),
    };
    const handleB = await runDaemon({
      store: storeB,
      featureDir: featureDirB,
      clock: clockB,
      logger: loggerB,
      piSurface: piSurfaceB,
      statusServerFactory: createStatusServer,
      verbAdapters: {
        "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: pushAdapterB },
        "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: createPrAdapterB },
      },
      commitsAhead: async (_branch: string, _base: string): Promise<number> => 1,
      remote: "origin",
    } as unknown as Parameters<typeof runDaemon>[0]);
    try {
      await compile(featureDirB, storeB, { repoRegistry: ["backend"] });
      loadTasks(storeB, "feat-s4t1del");
      await handleB.tick();

      // RED: delivery trigger not yet wired in tick() — this assertion fails first
      assert.equal(
        pushSubmitInputsB.length,
        1,
        "S4T1-B: tick must call deliverSession → push adapter submit once after ≥1 commit ahead",
      );
      const pushInput = pushSubmitInputsB[0] as Record<string, unknown>;
      assert.ok(
        typeof pushInput["branch"] === "string" && pushInput["branch"].length > 0,
        "S4T1-B: push input must carry a non-empty branch",
      );
      assert.equal(pushInput["remote"], "origin", "S4T1-B: push input must carry remote 'origin'");

      assert.equal(
        createPrSubmitInputsB.length,
        1,
        "S4T1-B: tick must call deliverSession → create_pr adapter submit once",
      );
      const cpi = createPrSubmitInputsB[0] as Record<string, unknown>;
      assert.equal(cpi["base"], "main", "S4T1-B: create_pr input must have base:'main'");
      assert.equal(cpi["head"], pushInput["branch"], "S4T1-B: create_pr head must match push branch");
      assert.ok(
        typeof cpi["title"] === "string" && (cpi["title"] as string).length > 0,
        "S4T1-B: create_pr input must carry a non-empty title",
      );

      // broker ledger carries both ops (push op → create_pr op chain)
      const ops = storeB.all<{ verb: string }>("SELECT verb FROM broker_in_flight");
      assert.ok(ops.some((r) => r.verb === "git.push"), "S4T1-B: push op must appear in broker_in_flight");
      assert.ok(ops.some((r) => r.verb === "github.create_pr"), "S4T1-B: create_pr op must appear in broker_in_flight");
    } finally {
      await handleB.stop();
      storeB.close();
      await rm(featureDirB, { recursive: true, force: true });
    }
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

// ---------------------------------------------------------------------------
// Epic 019.3 Story 001 T2 — exit-gate evaluation after clean session completion
// ---------------------------------------------------------------------------

// Two-story feature: task-t2-alpha (root, produces alpha-out) →
// task-t2-beta (depends on alpha-out).  Used to assert downstream dispatchability.
const T2_EPIC_MD = `---
id: feat-019-3-t2
repo: backend
ticket_system: jira
ticket: JIRA-T2G
---

## Acceptance

Feature complete when task-t2-alpha passes.
`;

const T2_TASK_ALPHA_MD = `---
id: task-t2-alpha
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-T2GA
outputs:
  - alpha-out
artifacts_out:
  - id: alpha-out
    kind: api
    path: api/alpha.yaml
write_scope:
  - src/foo/
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

- alpha-out

## Tests

tests
`;

// Variant of T2_TASK_ALPHA_MD with max_attempts: 2 for Story 003 T3 exhaustion test.
// After Story 004 T3, the ceiling comes from task.max_attempts (task row), not deps.maxAttempts.
const T2_TASK_ALPHA_MAX2_MD = `---
id: task-t2-alpha
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-T2GA
max_attempts: 2
outputs:
  - alpha-out
artifacts_out:
  - id: alpha-out
    kind: api
    path: api/alpha.yaml
write_scope:
  - src/foo/
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

- alpha-out

## Tests

tests
`;

const T2_TASK_BETA_MD = `---
id: task-t2-beta
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-T2GB
depends_on:
  - task: task-t2-alpha
    output: alpha-out
    semantics: frozen
write_scope:
  - src/bar/
---

## Prerequisites

setup

## Inputs

alpha-out from task-t2-alpha.

## Outputs

beta-out

## Tests

tests
`;

/** Captures gateCheck calls; returns the scripted GateResult. */
class MockWorkflow019_3T2 {
  readonly gateCheckCalls: Array<{ phase: string }> = [];
  private readonly result: GateResult;
  constructor(result: GateResult) { this.result = result; }
  readonly version = "tdd@1";
  readonly phases = ["gate"] as const;
  currentPhase(): string { return "gate"; }
  async gateCheck(phase: string): Promise<GateResult> {
    this.gateCheckCalls.push({ phase });
    return this.result;
  }
  async checkpoint(): Promise<void> {}
  on(
    _event: "phase_started" | "phase_changed" | "gate_checked" | "checkpoint_written",
    _listener: (...args: unknown[]) => void,
  ): this { return this; }
}

/** Captures all gate-result sink record() calls. */
class MockGateResultSink019_3T2 implements GateResultSink {
  readonly calls: Array<{ phase: string; result: GateResult }> = [];
  record(phase: string, result: GateResult): void {
    this.calls.push({ phase, result });
  }
}

test("Story 001 T2 (Epic 019.3) — clean session: gateCheck called once, pass marks exit gate, downstream dispatchable on next tick", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-t2-clean-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  // Two-story feature so downstream dispatchability can be asserted
  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MD, "utf8");
  await mkdir(join(featureDir, "002-beta"), { recursive: true });
  await writeFile(join(featureDir, "002-beta", "INDEX.md"), "# Story Beta\n", "utf8");
  await writeFile(join(featureDir, "002-beta", "task-t2-beta.md"), T2_TASK_BETA_MD, "utf8");

  let spawnCount = 0;
  // Session double: no stopReason → clean completion
  const piSurface = {
    spawnAgent(
      _opts: unknown,
    ): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const workflow = new MockWorkflow019_3T2({ outcome: "pass" });
  const sink = new MockGateResultSink019_3T2();

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory: createStatusServer,
    workflow,
    gateResultSink: sink,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");

    // Tick 1: dispatch task-t2-alpha (only root task; task-t2-beta blocked by dependency)
    await handle.tick();

    assert.equal(spawnCount, 1, "exactly one session spawned for the root task on tick 1");

    // AC (Epic 019.3 Story 001 T2): gateCheck called exactly once after clean session completes
    assert.equal(
      workflow.gateCheckCalls.length,
      1,
      "gateCheck must be called exactly once after a clean session completes",
    );

    // AC: gate-result sink received the GateResult with outcome 'pass'
    assert.equal(sink.calls.length, 1, "gate-result sink must receive exactly one record call");
    assert.equal(
      sink.calls[0]?.result.outcome,
      "pass",
      "gate-result sink must record outcome 'pass'",
    );

    // AC: exit gate is marked passed for task-t2-alpha
    const alphaRow = store.get<{ exit_gate_passed: number }>(
      "SELECT exit_gate_passed FROM scheduler_task WHERE node_id = ?",
      "task-t2-alpha",
    );
    assert.equal(
      alphaRow?.exit_gate_passed,
      1,
      "exit gate must be marked passed (exit_gate_passed=1) after a 'pass' gate result",
    );

    // Tick 2: task-t2-beta now dispatchable (alpha exit gate passed)
    await handle.tick();
    assert.equal(
      spawnCount,
      2,
      "task-t2-beta must be dispatched on the next tick after task-t2-alpha exit gate passes",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// Companion tests — first-run pass (vacuous now because no gate-checking exists).
// They become regression tests once the primary clean-session path is implemented:
// if the SE accidentally gate-checks aborted/errored sessions, these will fail RED.
// Sensitivity proven by the primary test above (gateCheckCalls.length === 1 fails RED now).

test("Story 001 T2 (Epic 019.3) — aborted session: NOT gate-checked, no gate-result record", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-t2-abort-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MD, "utf8");

  // Session double: stopReason = "aborted" → lifecycle/crash path (not gate-checked)
  const piSurface = {
    spawnAgent(_opts: unknown) {
      return {
        abort() {},
        async waitForIdle() {},
        reset() {},
        contextTokens: 0,
        stopReason: "aborted" as const,
      };
    },
  };

  const workflow = new MockWorkflow019_3T2({ outcome: "pass" });
  const sink = new MockGateResultSink019_3T2();

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory: createStatusServer,
    workflow,
    gateResultSink: sink,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");
    await handle.tick();

    assert.equal(
      workflow.gateCheckCalls.length,
      0,
      "gateCheck must NOT be called for an aborted session — routes to lifecycle path",
    );
    assert.equal(
      sink.calls.length,
      0,
      "gate-result sink must receive no record for an aborted session",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Story 001 T2 (Epic 019.3) — errored session: NOT gate-checked, no gate-result record", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-t2-error-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MD, "utf8");

  // Session double: stopReason = "error" → lifecycle/crash path (not gate-checked)
  const piSurface = {
    spawnAgent(_opts: unknown) {
      return {
        abort() {},
        async waitForIdle() {},
        reset() {},
        contextTokens: 0,
        stopReason: "error" as const,
      };
    },
  };

  const workflow = new MockWorkflow019_3T2({ outcome: "pass" });
  const sink = new MockGateResultSink019_3T2();

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory: createStatusServer,
    workflow,
    gateResultSink: sink,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");
    await handle.tick();

    assert.equal(
      workflow.gateCheckCalls.length,
      0,
      "gateCheck must NOT be called for an errored session — routes to lifecycle path",
    );
    assert.equal(
      sink.calls.length,
      0,
      "gate-result sink must receive no record for an errored session",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 001 T3 — needs_human parks the task with an escalation inbox item
// ---------------------------------------------------------------------------

test("Story 001 T3 (Epic 019.3) — needs_human: task parked, escalation inbox item names task, no re-dispatch on further ticks", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-t3-nh-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MD, "utf8");

  let spawnCount = 0;
  const piSurface = {
    spawnAgent(
      _opts: unknown,
    ): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Script needs_human outcome — no summary required (outcome is the signal)
  const workflow = new MockWorkflow019_3T2({ outcome: "needs_human" });
  const sink = new MockGateResultSink019_3T2();

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory: createStatusServer,
    workflow,
    gateResultSink: sink,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");

    // Tick 1: dispatch task-t2-alpha → clean session → needs_human gate result
    await handle.tick();

    assert.equal(spawnCount, 1, "exactly one session spawned on tick 1");

    // AC (Epic 019.3 Story 001 T3): task must be parked after needs_human
    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-t2-alpha",
    );
    assert.equal(
      taskRow?.status,
      "parked",
      "task must be parked after a needs_human gate result",
    );

    // AC: an escalation inbox item must exist naming the task
    const inboxItems = store.all<{ kind: string; status: string; evidence: string }>(
      "SELECT kind, status, evidence FROM inbox_items WHERE kind = 'escalation' AND status = 'open'",
    );
    assert.equal(
      inboxItems.length,
      1,
      "exactly one open escalation inbox item must exist after needs_human",
    );
    const evidence = JSON.parse(inboxItems[0]?.evidence ?? "{}") as Record<string, unknown>;
    assert.equal(
      evidence["task_id"],
      "task-t2-alpha",
      "escalation inbox item evidence must name the task id",
    );

    // AC: gate-result sink recorded the needs_human outcome
    assert.equal(sink.calls.length, 1, "gate-result sink must receive one record call");
    assert.equal(
      sink.calls[0]?.result.outcome,
      "needs_human",
      "gate-result sink must record outcome 'needs_human'",
    );

    // AC: two further ticks do NOT re-dispatch the parked task
    await handle.tick();
    await handle.tick();
    assert.equal(
      spawnCount,
      1,
      "parked task must NOT be re-dispatched on subsequent ticks",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 001 T4 — fail returns the task to a dispatchable state
// ---------------------------------------------------------------------------

test("Story 001 T4 (Epic 019.3) — fail: task returns to dispatchable state, next tick re-dispatches it", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-t4-fail-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MD, "utf8");

  let spawnCount = 0;
  // Session double: no stopReason → clean completion
  const piSurface = {
    spawnAgent(
      _opts: unknown,
    ): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Script fail outcome
  const workflow = new MockWorkflow019_3T2({ outcome: "fail", summary: "tests red" });
  const sink = new MockGateResultSink019_3T2();

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory: createStatusServer,
    workflow,
    gateResultSink: sink,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");

    // Tick 1: dispatch task-t2-alpha → clean session → fail gate result
    await handle.tick();

    assert.equal(spawnCount, 1, "exactly one session spawned on tick 1");

    // AC (Epic 019.3 Story 001 T4): task must NOT be complete or parked
    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-t2-alpha",
    );
    assert.notEqual(
      taskRow?.status,
      "complete",
      "task must NOT be complete after a fail gate result",
    );
    assert.notEqual(
      taskRow?.status,
      "parked",
      "task must NOT be parked after a fail gate result",
    );

    // AC: gate-result sink recorded the fail outcome
    assert.equal(sink.calls.length, 1, "gate-result sink must receive one record call");
    assert.equal(
      sink.calls[0]?.result.outcome,
      "fail",
      "gate-result sink must record outcome 'fail'",
    );

    // AC: the next tick re-dispatches the task (a second session spawn)
    await handle.tick();
    assert.equal(
      spawnCount,
      2,
      "task must be re-dispatched on the next tick after a fail gate result",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 002 T3 — run-loop wires record + inject
// ---------------------------------------------------------------------------

const EVIDENCE_SUMMARY_T3_SENTINEL = "SENTINEL-T3-GATE-FAIL-unique-evidence-summary-krl-019-3";

/** Sequence workflow: returns results[0] on first call, results[1] on second, "pass" thereafter. */
class MockWorkflow019_3T3 {
  private callCount = 0;
  private readonly results: GateResult[];
  constructor(results: GateResult[]) { this.results = results; }
  readonly version = "tdd@1";
  readonly phases = ["gate"] as const;
  currentPhase(): string { return "gate"; }
  async gateCheck(_phase: string): Promise<GateResult> {
    const result = this.results[this.callCount] ?? { outcome: "pass" as const };
    this.callCount++;
    return result;
  }
  async checkpoint(): Promise<void> {}
  on(_event: unknown, _listener: unknown): this { return this; }
}

test("Story 002 T3 (Epic 019.3) — fail-then-pass: evidence recorded after fail, second brief contains evidence, pass marks exit gate", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-002-t3-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MD, "utf8");

  let spawnCount = 0;
  const capturedPrompts: string[] = [];
  const piSurface = {
    spawnAgent(
      opts: { systemPrompt: string },
    ): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      capturedPrompts.push(opts.systemPrompt);
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // fail on attempt 1 (with evidence summary), pass on attempt 2
  const workflow = new MockWorkflow019_3T3([
    { outcome: "fail", summary: EVIDENCE_SUMMARY_T3_SENTINEL },
    { outcome: "pass" },
  ]);
  const sink = new MockGateResultSink019_3T2();

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory: createStatusServer,
    workflow,
    gateResultSink: sink,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");

    // Tick 1: dispatch → clean session → fail gate result → evidence recorded
    await handle.tick();
    assert.equal(spawnCount, 1, "exactly one session spawned on tick 1");

    // AC: evidence row must be durably recorded after the fail
    const evidence = latestEvidence(store, "task-t2-alpha");
    assert.ok(
      evidence,
      "evidence row must exist after a fail gate result (run-loop must call recordEvidence)",
    );
    assert.equal(
      evidence.summary,
      EVIDENCE_SUMMARY_T3_SENTINEL,
      "evidence summary must match the GateResult.summary from the workflow",
    );

    // Tick 2: task is pending → re-dispatched; second brief must carry the evidence
    await handle.tick();
    assert.equal(spawnCount, 2, "task must be re-dispatched on tick 2 after fail");

    const secondPrompt = capturedPrompts[1] ?? "";
    assert.ok(
      secondPrompt.includes(EVIDENCE_SUMMARY_T3_SENTINEL),
      "second spawn brief must contain the failure evidence summary (evidence inject not wired)",
    );

    // AC: pass on tick 2 marks exit gate
    const taskRow = store.get<{ exit_gate_passed: number }>(
      "SELECT exit_gate_passed FROM scheduler_task WHERE node_id = ?",
      "task-t2-alpha",
    );
    assert.equal(
      taskRow?.exit_gate_passed,
      1,
      "exit gate must be marked passed after the pass gate result on tick 2",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// S4 (HUMAN_REVIEW blocker) — budget-parked-after-fail: evidence survives;
// budget precedence over retry asserted end-to-end
// ---------------------------------------------------------------------------

test("S4 (Epic 019.3) — budget-parked-after-fail: evidence survives budget park; budget outranks retry on tick 2", async () => {
  // ceiling=15, conservativeCost=10:
  //   tick 1 pre-spawn reserve: current=0,  projected=10 ≤ 15 → proceed (spawn)
  //   tick 2 pre-spawn reserve: current=10, projected=20 > 15 → budget park (no second spawn)
  // Evidence recorded on tick 1 must survive the budget park on tick 2.
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-s4-budgetpark-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MD, "utf8");

  let spawnCount = 0;
  const piSurface = {
    spawnAgent(
      _opts: unknown,
    ): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Script only a fail on attempt 1; gateCheck is never called on tick 2 (budget gate fires before spawn)
  const workflow = new MockWorkflow019_3T3([{ outcome: "fail", summary: EVIDENCE_SUMMARY_T3_SENTINEL }]);
  const sink = new MockGateResultSink019_3T2();

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory: createStatusServer,
    workflow,
    gateResultSink: sink,
    taskBudget: { ceiling: 15, conservativeCost: 10 },
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");

    // Tick 1: dispatch → session → fail gate → evidence recorded; spend=10 consumed
    await handle.tick();
    assert.equal(spawnCount, 1, "S4: exactly one session spawned on tick 1");

    const evidenceAfterTick1 = latestEvidence(store, "task-t2-alpha");
    assert.ok(evidenceAfterTick1, "S4: evidence row must exist after tick 1 fail");
    assert.equal(
      evidenceAfterTick1.summary,
      EVIDENCE_SUMMARY_T3_SENTINEL,
      "S4: evidence must carry the sentinel summary after tick 1 fail",
    );

    // Tick 2: budget gate fires before spawn (spend=10+cost=10=20 > ceiling=15) → no spawn, task parked
    await handle.tick();
    assert.equal(spawnCount, 1, "S4: budget outranks retry — spawnAgent must NOT be called on tick 2");

    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-t2-alpha",
    );
    assert.equal(taskRow?.status, "parked", "S4: task must be parked by budget gate on tick 2");

    // AC: evidence survives the budget park (recorded before verdict, not erased by park)
    const evidenceAfterTick2 = latestEvidence(store, "task-t2-alpha");
    assert.ok(evidenceAfterTick2, "S4: evidence row must still exist after budget park");
    assert.equal(
      evidenceAfterTick2.summary,
      EVIDENCE_SUMMARY_T3_SENTINEL,
      "S4: evidence summary must survive the budget park (evidence not lost on tick 2)",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 003 T3 — run-loop applies the verdict end-to-end
// ---------------------------------------------------------------------------

const S003T3_FAIL_SENTINEL = "SENTINEL-S003T3-FAIL-krl-019-3-attempt-ledger";

test("Story 003 T3 (Epic 019.3) — fail-fail-pass (maxAttempts=3): task completes with attempt ledger reading 3", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-003-t3-ffp-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MD, "utf8");

  let spawnCount = 0;
  const piSurface = {
    spawnAgent(_opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Scripted: fail, fail, pass (3 dispatches total)
  const workflow = new MockWorkflow019_3T3([
    { outcome: "fail", summary: S003T3_FAIL_SENTINEL },
    { outcome: "fail", summary: "second-fail" },
    { outcome: "pass" },
  ]);
  const sink = new MockGateResultSink019_3T2();

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface,
    statusServerFactory: createStatusServer,
    workflow, gateResultSink: sink,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");

    await handle.tick(); // attempt 1: fail
    await handle.tick(); // attempt 2: fail
    await handle.tick(); // attempt 3: pass

    assert.equal(spawnCount, 3, "exactly 3 sessions must be spawned for fail-fail-pass");

    // PRIMARY AC: attempt ledger must read 3 (increments per dispatch)
    assert.equal(
      readAttempts(store, "task-t2-alpha"),
      3,
      "attempt ledger must read 3 dispatched attempts at completion (currently 0 — RED)",
    );

    // Gate must be marked passed
    const taskRow = store.get<{ exit_gate_passed: number }>(
      "SELECT exit_gate_passed FROM scheduler_task WHERE node_id = ?",
      "task-t2-alpha",
    );
    assert.equal(taskRow?.exit_gate_passed, 1, "exit gate must be marked passed after the third (pass) dispatch");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Story 003 T3 (Epic 019.3) — always-fail (maxAttempts=2): parks with attempts-exhausted inbox item after 2 dispatches, no third spawn", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-003-t3-exhaust-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  // Use the max_attempts:2 fixture — after Story 004 T3, ceiling comes from task.max_attempts (task row).
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MAX2_MD, "utf8");

  let spawnCount = 0;
  const piSurface = {
    spawnAgent(_opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Always-fail workflow
  const workflow = new MockWorkflow019_3T2({ outcome: "fail" });
  const sink = new MockGateResultSink019_3T2();

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface,
    statusServerFactory: createStatusServer,
    workflow, gateResultSink: sink,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");

    await handle.tick(); // attempt 1: fail (under max → pending)
    await handle.tick(); // attempt 2: fail (at max → attempts-exhausted → parked)
    await handle.tick(); // attempt 3: should NOT spawn (task is parked)

    // PRIMARY AC: exactly 2 spawns, no third
    assert.equal(spawnCount, 2, "task must NOT be re-dispatched after attempts are exhausted (currently 3 — RED)");

    // Task must be parked
    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-t2-alpha",
    );
    assert.equal(taskRow?.status, "parked", "task must be parked after attempts are exhausted");

    // An 'attempts-exhausted' inbox item must exist naming the task
    const items = store.all<{ kind: string; status: string; evidence: string }>(
      "SELECT kind, status, evidence FROM inbox_items WHERE kind = 'escalation' AND status = 'open'",
    );
    assert.equal(items.length, 1, "exactly one open escalation inbox item must exist");
    const ev = JSON.parse(items[0]?.evidence ?? "{}") as Record<string, unknown>;
    assert.equal(ev["task_id"], "task-t2-alpha", "inbox item evidence must name the task id");
    assert.equal(ev["reason"], "attempts-exhausted", "inbox item reason must be 'attempts-exhausted'");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Story 003 T3 (Epic 019.3) — aborted session (respawn path): attempt ledger not incremented", async () => {
  // This is a characterization/regression test: aborted sessions skip gate-check,
  // so incrementAttempt (inside postSessionDecision) is never called for them.
  // Sensitivity proven by the fail-fail-pass test above: a clean dispatch DOES increment.
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-003-t3-abort-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MD, "utf8");

  let spawnCount = 0;
  // Session always aborts (stopReason: "aborted")
  const piSurface = {
    spawnAgent(_opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number; stopReason: "aborted" } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0, stopReason: "aborted" };
    },
  };

  const workflow = new MockWorkflow019_3T2({ outcome: "pass" }); // irrelevant — never reached
  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface,
    statusServerFactory: createStatusServer,
    workflow,
    maxAttempts: 3,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");

    await handle.tick(); // aborted session — gate-check skipped

    assert.equal(spawnCount, 1, "one session spawned");
    // Ledger must NOT have incremented (aborted is not a completed dispatch)
    assert.equal(readAttempts(store, "task-t2-alpha"), 0, "attempt ledger must not increment for an aborted session");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Story 003 T3 (Epic 019.3) — retry-once: fail after grant-one parks immediately, grant is consumed", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-003-t3-retry1-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MAX2_MD, "utf8");

  let spawnCount = 0;
  const piSurface = {
    spawnAgent(_opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const workflow = new MockWorkflow019_3T2({ outcome: "fail" }); // always fail
  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface,
    statusServerFactory: createStatusServer,
    workflow,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");

    await handle.tick(); // attempt 1: fail → count=1 < max=2 → pending
    await handle.tick(); // attempt 2: fail → count=2 = max=2 → attempts-exhausted → parked

    // Simulate operator "retry-once": grant one extra attempt and re-enable
    grantOne(store, "task-t2-alpha");
    setTaskStatus(store, "task-t2-alpha", "pending");

    await handle.tick(); // granted attempt (tick 3): fail → grant consumed → re-parks immediately
    assert.equal(spawnCount, 3, "exactly 3 sessions spawned (2 regular + 1 granted)");

    // Grant must have been consumed
    const { readGrantOne } = await import("../scheduler/attempt-ledger.ts");
    assert.equal(
      readGrantOne(store, "task-t2-alpha"),
      false,
      "grant-one flag must be cleared after the granted attempt",
    );

    // AC: re-parks immediately — one more tick, task stays parked, no new dispatch
    await handle.tick(); // tick 4: nothing dispatched (task is parked)
    const retrParkedRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-t2-alpha",
    );
    assert.equal(
      retrParkedRow?.status,
      "parked",
      "task must be parked after the granted attempt fails (re-parks immediately)",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 004 T3 — resolved value drives the loop
// ---------------------------------------------------------------------------

const S019_3_S004T3_EPIC_MD = `---
id: feat-019-3-s004t3
repo: backend
ticket_system: jira
ticket: JIRA-019-3-S004T3E
---

## Acceptance

Feature complete when task-max1 passes.
`;

const S019_3_S004T3_TASK_MAX1_MD = `---
id: task-max1
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-019-3-S004T3T
max_attempts: 1
outputs:
  - max1-out
artifacts_out:
  - id: max1-out
    kind: api
    path: api/max1.yaml
write_scope:
  - src/max1/
---

## Prerequisites

setup

## Inputs

Nothing.

## Outputs

- max1-out

## Tests

tests
`;

test("Story 004 T3 (Epic 019.3) — max_attempts:1 from task row: always-fail parks after exactly 1 attempt (no deps.maxAttempts)", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-s004t3-max1-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S019_3_S004T3_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-t3"), { recursive: true });
  await writeFile(join(featureDir, "001-t3", "INDEX.md"), "# Story T3\n", "utf8");
  await writeFile(join(featureDir, "001-t3", "task-max1.md"), S019_3_S004T3_TASK_MAX1_MD, "utf8");

  let spawnCount = 0;
  const piSurface = {
    spawnAgent(
      _opts: unknown,
    ): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Always-fail workflow — no deps.maxAttempts so loop MUST read from task row
  const workflow = new MockWorkflow019_3T2({ outcome: "fail" });

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface,
    statusServerFactory: createStatusServer,
    workflow,
    // maxAttempts deliberately omitted — tick must use task.max_attempts from task row
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-s004t3");

    // Tick 1: dispatch task-max1 → clean session → fail gate result
    await handle.tick();

    assert.equal(spawnCount, 1, "exactly 1 session spawned");

    // PRIMARY AC: task must be parked after exactly 1 attempt (max_attempts:1 in frontmatter)
    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-max1",
    );
    assert.equal(
      taskRow?.status,
      "parked",
      "task with max_attempts:1 must park after exactly 1 attempt (task row drives the ceiling)",
    );

    // AC: an attempts-exhausted escalation inbox item must exist naming the task
    const inboxItems = store.all<{ kind: string; status: string; evidence: string }>(
      "SELECT kind, status, evidence FROM inbox_items WHERE kind = 'escalation' AND status = 'open'",
    );
    assert.equal(
      inboxItems.length,
      1,
      "exactly one open attempts-exhausted escalation item must exist",
    );
    const ev = JSON.parse(inboxItems[0]?.evidence ?? "{}") as Record<string, unknown>;
    assert.equal(ev["task_id"], "task-max1", "escalation item must name task-max1");

    // AC: no additional spawn after park
    await handle.tick();
    assert.equal(spawnCount, 1, "no additional session spawned after task is parked");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Story 004 T3 (Epic 019.3) — no max_attempts frontmatter: system default (3) allows 3 attempts before exhaustion", async () => {
  // Characterization test — passes from the start; sensitivity proven by sibling test above.
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-s004t3-def3-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MD, "utf8");

  let spawnCount = 0;
  const piSurface = {
    spawnAgent(
      _opts: unknown,
    ): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  // Always-fail; no deps.maxAttempts — system default 3 applies via task row
  const workflow = new MockWorkflow019_3T2({ outcome: "fail" });

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface,
    statusServerFactory: createStatusServer,
    workflow,
    // maxAttempts deliberately omitted
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");

    await handle.tick(); // attempt 1: fail → pending
    await handle.tick(); // attempt 2: fail → pending

    const afterTick2 = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-t2-alpha",
    );
    assert.equal(
      afterTick2?.status,
      "pending",
      "task must still be pending after 2 fails (default max_attempts=3)",
    );

    await handle.tick(); // attempt 3: fail → attempts-exhausted → parked

    assert.equal(spawnCount, 3, "exactly 3 sessions spawned before exhaustion");

    const afterTick3 = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-t2-alpha",
    );
    assert.equal(
      afterTick3?.status,
      "parked",
      "task must be parked after 3 attempts (default max_attempts=3)",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Story 003 T3 (Epic 019.3) — re-arm: attempt counter resets to 0, subsequent fail is not exhausted", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-019-3-003-t3-rearm-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), T2_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), "# Story Alpha\n", "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-t2-alpha.md"), T2_TASK_ALPHA_MAX2_MD, "utf8");

  let spawnCount = 0;
  const piSurface = {
    spawnAgent(_opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const workflow = new MockWorkflow019_3T2({ outcome: "fail" }); // always fail
  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface,
    statusServerFactory: createStatusServer,
    workflow,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-019-3-t2");

    await handle.tick(); // attempt 1: fail → count=1 < max=2 → pending
    await handle.tick(); // attempt 2: fail → count=2 = max=2 → attempts-exhausted → parked

    // Simulate operator "re-arm": reset counter and re-enable
    rearmLedger(store, "task-t2-alpha");
    setTaskStatus(store, "task-t2-alpha", "pending");

    await handle.tick(); // first attempt after re-arm: fail, dispatch_count becomes 1 (under max=2)

    assert.equal(spawnCount, 3, "3 sessions spawned total");

    // After re-arm + one fail, ledger reads 1 (first attempt after reset)
    assert.equal(
      readAttempts(store, "task-t2-alpha"),
      1,
      "attempt count must be 1 after re-arm + one dispatch (currently 0 — RED)",
    );

    // Task must NOT be exhausted (should be pending for the next retry)
    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-t2-alpha",
    );
    assert.notEqual(taskRow?.status, "parked", "task must NOT be parked after first fail following a re-arm (count=1 < max=2)");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 019.7 Story 004 T2 — completion gating: open / merged / closed PR states
// ---------------------------------------------------------------------------

test("019.7 S4T2 — create_pr completion gating: open stays pending-merge; merged completes task; closed-unmerged escalates", async () => {
  const piSurface = {
    spawnAgent(_opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };
  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_i: unknown): Promise<unknown> => "req-push-s4t2g",
    poll_status: async (_r: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_l: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_i: unknown): Promise<unknown> => "req-pr-s4t2g",
    poll_status: async (_r: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_l: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const TASK_ID = "task-s4t2";
  const FEATURE_ID = "feat-s4t2";
  const CLOCK_TS = 1_000_000_000;

  // --- Phase OPEN: no broker_completion row → PR still open → task NOT complete ---
  {
    const featureDirO = await mkdtemp(join(tmpdir(), "krl-s4t2g-o-"));
    const storeO = openStore(":memory:", { busyTimeout: 1000 });
    const clockO = new FakeClock(CLOCK_TS);
    await writeFile(join(featureDirO, "epic.md"), S004T2_EPIC_MD, "utf8");
    await writeFile(join(featureDirO, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await mkdir(join(featureDirO, "001-task"), { recursive: true });
    await writeFile(join(featureDirO, "001-task", "INDEX.md"), S004T2_INDEX_MD, "utf8");
    await writeFile(join(featureDirO, "001-task", "task-s4t2.md"), S004T2_TASK_MD, "utf8");
    const handleO = await runDaemon({
      store: storeO, featureDir: featureDirO, clock: clockO,
      logger: { info(_r: Record<string, unknown>): void {} },
      piSurface, statusServerFactory: createStatusServer,
    });
    try {
      await compile(featureDirO, storeO, { repoRegistry: ["backend"] });
      storeO.run("INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)", TASK_ID, FEATURE_ID, "running");
      await handleO.deliverSession({
        pushAdapter, pushEntry: S003T1_PUSH_ENTRY,
        pushInput: { cwd: "/tmp/test", branch: TASK_ID, remote: "origin" },
        pushIdempotencyKey: "push:s4t2g-o",
        createPrAdapter, createPrEntry: S004T2_CREATE_PR_ENTRY,
        createPrInput: { head: TASK_ID, base: "main", title: "T2 PR" },
        createPrIdempotencyKey: "create_pr:s4t2g-o",
        taskId: TASK_ID,
      });
      // no broker_completion row → PR still open/polling in progress
      await handleO.tick();
      const rowO = storeO.get<{ status: string }>(
        "SELECT status FROM scheduler_task WHERE node_id = ?", TASK_ID,
      );
      assert.notEqual(rowO?.status, "complete",
        "S4T2-O: task must NOT be complete while PR is still open (awaiting merge)");
    } finally {
      await handleO.stop(); storeO.close();
      await rm(featureDirO, { recursive: true, force: true });
    }
  }

  // --- Phase MERGED: broker_completion.status="merged" → task complete ---
  {
    const featureDirM = await mkdtemp(join(tmpdir(), "krl-s4t2g-m-"));
    const storeM = openStore(":memory:", { busyTimeout: 1000 });
    const clockM = new FakeClock(CLOCK_TS);
    await writeFile(join(featureDirM, "epic.md"), S004T2_EPIC_MD, "utf8");
    await writeFile(join(featureDirM, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await mkdir(join(featureDirM, "001-task"), { recursive: true });
    await writeFile(join(featureDirM, "001-task", "INDEX.md"), S004T2_INDEX_MD, "utf8");
    await writeFile(join(featureDirM, "001-task", "task-s4t2.md"), S004T2_TASK_MD, "utf8");
    const handleM = await runDaemon({
      store: storeM, featureDir: featureDirM, clock: clockM,
      logger: { info(_r: Record<string, unknown>): void {} },
      piSurface, statusServerFactory: createStatusServer,
    });
    try {
      await compile(featureDirM, storeM, { repoRegistry: ["backend"] });
      storeM.run("INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)", TASK_ID, FEATURE_ID, "running");
      const { createPrOpId: opIdM } = await handleM.deliverSession({
        pushAdapter, pushEntry: S003T1_PUSH_ENTRY,
        pushInput: { cwd: "/tmp/test", branch: TASK_ID, remote: "origin" },
        pushIdempotencyKey: "push:s4t2g-m",
        createPrAdapter, createPrEntry: S004T2_CREATE_PR_ENTRY,
        createPrInput: { head: TASK_ID, base: "main", title: "T2 PR" },
        createPrIdempotencyKey: "create_pr:s4t2g-m",
        taskId: TASK_ID,
      });
      storeM.run("INSERT INTO broker_completion (op_id, status, at) VALUES (?, ?, ?)", opIdM, "merged", CLOCK_TS);
      await handleM.tick();
      const rowM = storeM.get<{ status: string }>(
        "SELECT status FROM scheduler_task WHERE node_id = ?", TASK_ID,
      );
      assert.equal(rowM?.status, "complete",
        "S4T2-M: task must transition to complete once create_pr reports 'merged'");
    } finally {
      await handleM.stop(); storeM.close();
      await rm(featureDirM, { recursive: true, force: true });
    }
  }

  // --- Phase CLOSED: broker_completion.status="closed" → escalation (RED — not yet wired) ---
  {
    const featureDirC = await mkdtemp(join(tmpdir(), "krl-s4t2g-c-"));
    const storeC = openStore(":memory:", { busyTimeout: 1000 });
    const clockC = new FakeClock(CLOCK_TS);
    await writeFile(join(featureDirC, "epic.md"), S004T2_EPIC_MD, "utf8");
    await writeFile(join(featureDirC, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await mkdir(join(featureDirC, "001-task"), { recursive: true });
    await writeFile(join(featureDirC, "001-task", "INDEX.md"), S004T2_INDEX_MD, "utf8");
    await writeFile(join(featureDirC, "001-task", "task-s4t2.md"), S004T2_TASK_MD, "utf8");
    const handleC = await runDaemon({
      store: storeC, featureDir: featureDirC, clock: clockC,
      logger: { info(_r: Record<string, unknown>): void {} },
      piSurface, statusServerFactory: createStatusServer,
    });
    try {
      await compile(featureDirC, storeC, { repoRegistry: ["backend"] });
      storeC.run("INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)", TASK_ID, FEATURE_ID, "running");
      const { createPrOpId: opIdC } = await handleC.deliverSession({
        pushAdapter, pushEntry: S003T1_PUSH_ENTRY,
        pushInput: { cwd: "/tmp/test", branch: TASK_ID, remote: "origin" },
        pushIdempotencyKey: "push:s4t2g-c",
        createPrAdapter, createPrEntry: S004T2_CREATE_PR_ENTRY,
        createPrInput: { head: TASK_ID, base: "main", title: "T2 PR" },
        createPrIdempotencyKey: "create_pr:s4t2g-c",
        taskId: TASK_ID,
      });
      storeC.run("INSERT INTO broker_completion (op_id, status, at) VALUES (?, ?, ?)", opIdC, "closed", CLOCK_TS);
      await handleC.tick();
      // AC: closed-unmerged PR must create an open escalation inbox item
      const inboxRows = storeC.all<{ kind: string; status: string }>(
        "SELECT kind, status FROM inbox_items WHERE kind = 'escalation' AND status = 'open'",
      );
      assert.ok(inboxRows.length > 0,
        "S4T2-C: escalation inbox item must exist for a closed-unmerged PR");
      // AC: task must NOT be complete
      const rowC = storeC.get<{ status: string }>(
        "SELECT status FROM scheduler_task WHERE node_id = ?", TASK_ID,
      );
      assert.notEqual(rowC?.status, "complete",
        "S4T2-C: task must NOT be marked complete when PR was closed without merging");
    } finally {
      await handleC.stop(); storeC.close();
      await rm(featureDirC, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// Story 005 T1 (Epic 019.7) — reconcile held ops at daemon boot
// ---------------------------------------------------------------------------

test("019.7 S5T1 — runDaemon reconciles held ops at boot: held create_pr resolves with no second submit", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s5t1rec-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  // Init schema before seeding held op — simulates a prior daemon crash mid-submit.
  initSchema(store);
  const HELD_OP_ID = "op-held-create-pr-s5t1";
  store.run(
    "INSERT INTO broker_in_flight (op_id, verb, request_id, idempotency_key, status) VALUES (?, ?, ?, ?, ?)",
    HELD_OP_ID, "github.create_pr", "", "", "held",
  );

  // Adapter double: reconcile returns done (finds existing open PR via head-branch
  // lookup); submit tracked to assert it is NEVER called (no duplicate PR).
  let submitCallCount = 0;
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_i: unknown): Promise<unknown> => {
      submitCallCount++;
      return "req-duplicate-pr";
    },
    poll_status: async (_r: unknown): Promise<unknown> => ({ status: "open" }),
    reconcile: async (_l: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const S5T1_CREATE_PR_ENTRY: VerbRegistryEntry = {
    verb: "github.create_pr",
    tier: "auto",
    timeout: 30000,
    idempotency: { window_ms: 0 },
    retry: { max: 0, backoff: "none" },
    poll_interval: 5000,
    terminal_states: ["done", "failed"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: false,
  };

  const piSurface = {
    spawnAgent(_opts: unknown) {
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
    verbAdapters: {
      "github.create_pr": { entry: S5T1_CREATE_PR_ENTRY, adapter: createPrAdapter },
    },
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    // After boot, reconcileHeldOps must have been called.
    // The held op must have a terminal broker_completion row (no duplicate submit).
    const completion = store.get<{ status: string }>(
      "SELECT status FROM broker_completion WHERE op_id = ?",
      HELD_OP_ID,
    );
    assert.ok(
      completion !== undefined,
      "S5T1: broker_completion row must exist after boot-time reconcileHeldOps",
    );
    assert.equal(
      submitCallCount,
      0,
      "S5T1: create_pr adapter submit must NOT be called during reconcile (no duplicate PR)",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 005 T2 (Epic 019.7) — secret-scan blocks the live push (tick-driven path)
// ---------------------------------------------------------------------------

const S5T2_EPIC_MD = `---
id: feat-s5t2
repo: backend
ticket_system: jira
ticket: JIRA-S5T2
---

## Acceptance

Feature complete when task-s5t2 passes.
`;

const S5T2_TASK_MD = `---
id: task-s5t2
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-S5T2B
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

test("019.7 S5T2 — tick-driven delivery with matching pattern blocks push + escalates; null registry blocks fail-closed", async () => {
  // Phase M — patternRegistry whose regex matches the push branch name embedded in
  // JSON.stringify(pushInput).  pushInput.branch === "task-s5t2" so the pattern
  // "task-s5t2" matches.  The wiring already exists (tick→deliverSession→scanGuard);
  // this test pins the tick()-driven path explicitly as a coverage assertion.
  {
    const featureDirM = await mkdtemp(join(tmpdir(), "krl-s5t2m-"));
    const storeM = openStore(":memory:", { busyTimeout: 1000 });
    const clockM = new FakeClock(1_000_000_000);
    const loggerM = { info(_r: Record<string, unknown>): void {} };
    await writeFile(join(featureDirM, "epic.md"), S5T2_EPIC_MD, "utf8");
    await writeFile(join(featureDirM, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await mkdir(join(featureDirM, "001-scan"), { recursive: true });
    await writeFile(join(featureDirM, "001-scan", "INDEX.md"), "# Story Scan\n", "utf8");
    await writeFile(join(featureDirM, "001-scan", "task-s5t2.md"), S5T2_TASK_MD, "utf8");
    const piSurfaceM = {
      spawnAgent(_opts: unknown) {
        return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
      },
    };
    const patternRegistryM = {
      version: "1.0",
      patterns: [{ name: "scan-class-s5t2", regex: "task-s5t2" }],
    };
    let pushSubmitCallsM = 0;
    const pushAdapterM: AsyncVerbAdapter = {
      submit: async (_i: unknown): Promise<unknown> => { pushSubmitCallsM++; return "req-push-m"; },
      poll_status: async (_r: unknown): Promise<unknown> => ({ status: "done" }),
      reconcile: async (_l: unknown): Promise<unknown> => ({ status: "done" }),
    };
    let createPrSubmitCallsM = 0;
    const createPrAdapterM: AsyncVerbAdapter = {
      submit: async (_i: unknown): Promise<unknown> => { createPrSubmitCallsM++; return "req-pr-m"; },
      poll_status: async (_r: unknown): Promise<unknown> => ({ status: "done" }),
      reconcile: async (_l: unknown): Promise<unknown> => ({ status: "done" }),
    };
    const handleM = await runDaemon({
      store: storeM,
      featureDir: featureDirM,
      clock: clockM,
      logger: loggerM,
      piSurface: piSurfaceM,
      statusServerFactory: createStatusServer,
      verbAdapters: {
        "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: pushAdapterM },
        "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: createPrAdapterM },
      },
      commitsAhead: async (_branch: string, _base: string): Promise<number> => 1,
      remote: "origin",
      patternRegistry: patternRegistryM,
    } as unknown as Parameters<typeof runDaemon>[0]);
    try {
      await compile(featureDirM, storeM, { repoRegistry: ["backend"] });
      loadTasks(storeM, "feat-s5t2");
      // tick() throws when the scan blocks delivery — absorb the error
      await handleM.tick().catch(() => {});
      // AC: push adapter submit must NOT be called (blocked before remote)
      assert.equal(
        pushSubmitCallsM, 0,
        "S5T2-M: push must be blocked — submit must not fire when pattern matches",
      );
      // AC: create_pr must NOT be called (delivery halts after push blocked)
      assert.equal(
        createPrSubmitCallsM, 0,
        "S5T2-M: create_pr must not be called when push is blocked by scan",
      );
      // AC: escalation inbox item raised (block durably recorded in store)
      const inboxRowsM = storeM.all<{ kind: string; status: string }>(
        "SELECT kind, status FROM inbox_items WHERE kind = 'escalation' AND status = 'open'",
      );
      assert.ok(
        inboxRowsM.length > 0,
        "S5T2-M: escalation inbox item must be raised when push is blocked by scan",
      );
    } finally {
      await handleM.stop();
      storeM.close();
      await rm(featureDirM, { recursive: true, force: true });
    }
  }

  // Phase N — patternRegistry=null → push blocked fail-closed, tagged scan-unavailable.
  {
    const featureDirN = await mkdtemp(join(tmpdir(), "krl-s5t2n-"));
    const storeN = openStore(":memory:", { busyTimeout: 1000 });
    const clockN = new FakeClock(1_000_000_000);
    const loggerN = { info(_r: Record<string, unknown>): void {} };
    await writeFile(join(featureDirN, "epic.md"), S5T2_EPIC_MD, "utf8");
    await writeFile(join(featureDirN, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await mkdir(join(featureDirN, "001-scan"), { recursive: true });
    await writeFile(join(featureDirN, "001-scan", "INDEX.md"), "# Story Scan\n", "utf8");
    await writeFile(join(featureDirN, "001-scan", "task-s5t2.md"), S5T2_TASK_MD, "utf8");
    const piSurfaceN = {
      spawnAgent(_opts: unknown) {
        return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
      },
    };
    let pushSubmitCallsN = 0;
    const pushAdapterN: AsyncVerbAdapter = {
      submit: async (_i: unknown): Promise<unknown> => { pushSubmitCallsN++; return "req-push-n"; },
      poll_status: async (_r: unknown): Promise<unknown> => ({ status: "done" }),
      reconcile: async (_l: unknown): Promise<unknown> => ({ status: "done" }),
    };
    const handleN = await runDaemon({
      store: storeN,
      featureDir: featureDirN,
      clock: clockN,
      logger: loggerN,
      piSurface: piSurfaceN,
      statusServerFactory: createStatusServer,
      verbAdapters: {
        "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: pushAdapterN },
        "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: pushAdapterN },
      },
      commitsAhead: async (_branch: string, _base: string): Promise<number> => 1,
      remote: "origin",
      patternRegistry: null,
    } as unknown as Parameters<typeof runDaemon>[0]);
    try {
      await compile(featureDirN, storeN, { repoRegistry: ["backend"] });
      loadTasks(storeN, "feat-s5t2");
      // tick() throws when scan blocks — absorb
      await handleN.tick().catch(() => {});
      // AC: push blocked fail-closed when registry is absent
      assert.equal(
        pushSubmitCallsN, 0,
        "S5T2-N: push must be blocked fail-closed when patternRegistry=null",
      );
      // AC: escalation tagged scan-unavailable
      const inboxRowsN = storeN.all<{ kind: string; evidence: string }>(
        "SELECT kind, evidence FROM inbox_items WHERE kind = 'escalation'",
      );
      assert.ok(inboxRowsN.length > 0, "S5T2-N: escalation inbox item must be raised for scan-unavailable");
      const firstN = inboxRowsN[0];
      assert.ok(firstN !== undefined, "S5T2-N: inbox item row must be non-undefined");
      const evidenceN = JSON.stringify(JSON.parse(firstN.evidence));
      assert.ok(
        evidenceN.includes("scan-unavailable"),
        "S5T2-N: escalation evidence must be tagged scan-unavailable when registry is null",
      );
    } finally {
      await handleN.stop();
      storeN.close();
      await rm(featureDirN, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// 019.8 S002 T1 — per-task worktree dispatch
// Asserts: dispatchWorktree called with task id; session spawned with worktree
// path; push branch = worktree branchName; queued → no spawn.
// With no worktreeSlot configured, existing tests (above) already prove that
// tick() spawns as before.
// ---------------------------------------------------------------------------

test("019.8 S002 T1-a — tick() calls dispatchWorktree with task id; session in worktree path; push branch = branchName", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-0198s2ta-"));
  const worktreesBase = await mkdtemp(join(tmpdir(), "krl-0198s2ta-wt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  // Recording mock — branchName deliberately != task.id so push-branch assertion
  // is sensitive: current tick() uses task.id; GREEN must use branchName.
  const dispatchCalls: WorktreeDispatchOpts[] = [];
  const mockBranchName = "wt-dispatch-branch";
  const mockWorktreePath = join(worktreesBase, mockBranchName);
  const mockDispatch = async (opts: WorktreeDispatchOpts): Promise<WorktreeDispatchResult> => {
    dispatchCalls.push(opts);
    return { worktreePath: mockWorktreePath, branchName: mockBranchName, queued: false };
  };

  const spawnCalls: Array<Record<string, unknown>> = [];
  const piSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCalls.push(opts as Record<string, unknown>);
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const pushInputs: Array<Record<string, unknown>> = [];
  const pushAdapter: AsyncVerbAdapter = {
    submit: async (input: unknown): Promise<unknown> => { pushInputs.push(input as Record<string, unknown>); return "req-push-wt"; },
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-pr-wt",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    worktreeSlot: { worktreesBase, repoPath: worktreesBase, dispatch: mockDispatch },
    verbAdapters: {
      "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: pushAdapter },
      "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: createPrAdapter },
    },
    commitsAhead: async (_b: string, _base: string): Promise<number> => 1,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    // AC1: dispatchWorktree must be called with the task id
    assert.equal(dispatchCalls.length, 1, "dispatchWorktree must be called once per dispatched task");
    assert.equal(dispatchCalls[0]?.taskId, "task-foo", "dispatchWorktree must receive the task id");

    // AC2: spawnAgent must receive the worktree path from the dispatch result
    assert.equal(spawnCalls.length, 1, "spawnAgent must be called once");
    assert.equal(spawnCalls[0]?.["worktreePath"], mockWorktreePath, "spawnAgent must receive worktreePath from dispatch result");

    // AC3: push branch = branchName from dispatch (not task.id)
    assert.equal(pushInputs.length, 1, "push adapter must be called once for auto-delivery");
    assert.equal(pushInputs[0]?.["branch"], mockBranchName, "push branch must equal worktree branchName from dispatchWorktree, not task.id");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(worktreesBase, { recursive: true, force: true });
  }
});

test("019.8 S002 T1-b — queued dispatch result: session not spawned; task not stranded in running", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-0198s2tb-"));
  const worktreesBase = await mkdtemp(join(tmpdir(), "krl-0198s2tb-wt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  // Mock returns queued=true (lease cap reached)
  const queuedDispatch = async (_opts: WorktreeDispatchOpts): Promise<WorktreeDispatchResult> =>
    ({ worktreePath: join(worktreesBase, "task-foo"), branchName: "task-foo", queued: true });

  let spawnCount = 0;
  const piSurface = {
    spawnAgent(_: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      spawnCount++;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    worktreeSlot: { worktreesBase, repoPath: worktreesBase, dispatch: queuedDispatch },
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    // AC: session must NOT be spawned when lease cap is reached (queued=true)
    assert.equal(spawnCount, 0, "spawnAgent must not be called when dispatchWorktree returns queued=true");

    // AC: task must not be stranded in 'running' after queued dispatch
    const row = store.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", "task-foo");
    assert.ok(row !== undefined, "task-foo must have a scheduler row");
    assert.notEqual(row.status, "running", "queued task must not be left stranded in running status");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(worktreesBase, { recursive: true, force: true });
  }
});
