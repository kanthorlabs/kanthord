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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
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
import { createEscalationItem } from "../inbox/inbox.ts";
import { getInFlightOp } from "../broker/submit.ts";
import { readTimelineEvents } from "../metrics/task-timeline.ts";

const execFileAsync = promisify(execFile);

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

test("Story 001 T3 — hold-point verb filter holds only configured verbs", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s001t3c-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };
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
    holdPointEnabled: true,
    holdPointVerbs: ["github.create_pr"],
  });

  let pushSubmitCalled = 0;
  let prSubmitCalled = 0;
  const pushAdapter: AsyncVerbAdapter = {
    submit: async () => { pushSubmitCalled++; return "req-push-filter"; },
    poll_status: async () => ({ status: "done" }),
    reconcile: async () => ({ status: "done" }),
  };
  const prAdapter: AsyncVerbAdapter = {
    submit: async () => { prSubmitCalled++; return "req-pr-filter"; },
    poll_status: async () => ({ status: "done" }),
    reconcile: async () => ({ status: "done" }),
  };

  try {
    const pushOpId = await handle.submitBrokerVerb(
      { ...makeTestEntry(), verb: "git.push" },
      pushAdapter,
      { branch: "feat/filter" },
      "push-filter",
    );
    const prOpId = await handle.submitBrokerVerb(
      { ...makeTestEntry(), verb: "github.create_pr" },
      prAdapter,
      { head: "feat/filter", base: "main", title: "filter" },
      "pr-filter",
    );
    const pushRow = store.get<{ status: string }>("SELECT status FROM broker_in_flight WHERE op_id = ?", pushOpId);
    const prRow = store.get<{ status: string }>("SELECT status FROM broker_in_flight WHERE op_id = ?", prOpId);
    assert.equal(pushSubmitCalled, 1, "git.push must not be held by the create_pr-only hold filter");
    assert.equal(pushRow?.status, "in_flight");
    assert.equal(prSubmitCalled, 0, "github.create_pr must be held");
    assert.equal(prRow?.status, "held");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Story 001 T3 — pre-completion hold invokes adapter then records held op", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-s001t3d-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };
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
    holdPointEnabled: true,
    holdPointVerbs: ["github.create_pr"],
    holdPointCutpoint: "pre-completion",
  });
  let submitCalled = 0;
  const adapter: AsyncVerbAdapter = {
    submit: async () => { submitCalled++; return "req-pr-pre-completion"; },
    poll_status: async () => ({ status: "done" }),
    reconcile: async () => ({ status: "done" }),
  };
  try {
    const opId = await handle.submitBrokerVerb(
      { ...makeTestEntry(), verb: "github.create_pr" },
      adapter,
      { head: "feat/pre-completion", base: "main", title: "pre-completion" },
      "pr-pre-completion",
    );
    const row = store.get<{ request_id: string; status: string }>(
      "SELECT request_id, status FROM broker_in_flight WHERE op_id = ?",
      opId,
    );
    assert.equal(submitCalled, 1, "adapter.submit must run before pre-completion hold");
    assert.equal(row?.request_id, "req-pr-pre-completion");
    assert.equal(row?.status, "held");
    assert.equal(getInFlightOp(opId, store), undefined, "held pre-completion op must not start normal poller");
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

test("per-model-call budget — spawned session reserves durably for each call and parks on its first breach", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-per-model-budget-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  let beforeModelCall: (() => Promise<void>) | undefined;
  const piSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      const candidate = (opts as Record<string, unknown>)["beforeModelCall"];
      if (typeof candidate === "function") beforeModelCall = candidate as () => Promise<void>;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger: { info(_r: Record<string, unknown>): void {} },
    piSurface,
    statusServerFactory: createStatusServer,
    taskBudget: { ceiling: 15, conservativeCost: 10 },
  });

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    assert.equal(
      typeof beforeModelCall,
      "function",
      "runDaemon must supply the per-task beforeModelCall callback in pi spawn options",
    );
    if (beforeModelCall === undefined) throw new Error("beforeModelCall was not supplied");
    const reserveBeforeModelCall = beforeModelCall;

    await reserveBeforeModelCall();
    const firstReservation = store.get<{ ledger: string }>("SELECT ledger FROM budget_ledger");
    assert.equal(
      Number(firstReservation?.ledger),
      10,
      "the first model call must durably reserve exactly one conservative cost",
    );

    await assert.rejects(
      () => reserveBeforeModelCall(),
      (err: unknown) => err instanceof Error && err.message.length > 0,
      "the first over-ceiling model-call reservation must reject with a non-empty error",
    );
    const afterBreach = store.get<{ ledger: string }>("SELECT ledger FROM budget_ledger");
    assert.equal(
      Number(afterBreach?.ledger),
      10,
      "the rejected reservation must not durably charge the breaching call",
    );

    const inbox = store.get<{ evidence: string }>("SELECT evidence FROM inbox_items");
    assert.equal(
      (JSON.parse(inbox?.evidence ?? "{}") as { reason?: string }).reason,
      "budget-breach",
      "the over-ceiling model call must create budget-breach inbox evidence",
    );
    const task = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-foo",
    );
    assert.equal(task?.status, "parked", "the task must be parked after its budget breach");
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

test("Story 002 T2 — LP-A2: out-of-scope write is blocked, durably journaled, and cannot execute", async () => {
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
  let outOfScopeEffectsExecuted = 0;

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
          if (writeHookResult?.block !== true) {
            outOfScopeEffectsExecuted += 1;
          }
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

    // LP-A2: ring-1 blocks are independently durable audit events, not inbox-only.
    const timelineEvents = readTimelineEvents(store, "task-bar");
    const ring1Block = timelineEvents.find((event) => event.kind === "ring1_block");
    assert.ok(ring1Block !== undefined, "out-of-scope write must append a ring1_block task timeline event");
    assert.equal(ring1Block.task_id, "task-bar", "ring-1 block timeline event belongs to the escalated task");
    assert.equal(ring1Block.attempt, 1, "ring-1 block timeline event belongs to the first task attempt");
    assert.equal(ring1Block.correlation_id, "task-bar:1", "ring-1 block timeline event correlates to the task escalation attempt");
    assert.equal(ring1Block.summary, "re-planning-signal", "ring-1 block timeline event records the re-planning escalation reason");

    assert.equal(outOfScopeEffectsExecuted, 0, "blocked out-of-scope write must not execute its effect");

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

  let spawnCount = 0;
  let modelCallEffectFired = false;
  const scriptedPiSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number; stopReason?: "aborted" | "error" } {
      spawnCount++;
      const beforeModelCall = (opts as Record<string, unknown>)["beforeModelCall"];
      let stopReason: "error" | undefined;
      return {
        abort() {},
        async waitForIdle() {
          if (typeof beforeModelCall !== "function") throw new Error("beforeModelCall must be supplied");
          try {
            await beforeModelCall();
            modelCallEffectFired = true;
          } catch {
            stopReason = "error";
          }
        },
        reset() {},
        contextTokens: 0,
        get stopReason() { return stopReason; },
      };
    },
  };

  const logger = { info(_r: Record<string, unknown>): void {} };

  // taskBudget: ceiling=0, conservativeCost=1 → the session spawns, then its first model call halts.
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

    assert.equal(spawnCount, 1, "the session may spawn before its first model-call reservation");
    assert.equal(
      modelCallEffectFired,
      false,
      "model-call effect must not fire after the rejected reservation",
    );
    assert.equal(store.all("SELECT ledger FROM budget_ledger").length, 0, "rejected call must not charge spend");

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
    prStateSeam: { async getPrState(_repo: string, _prNumber: number) { return { state: "closed", merged: true }; } },
    prStateRepo: "backend",
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
      prNumber: 99,
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

    // tick() observes the merged PR through durable external_tracking and completes the task.
    await handle.tick();

    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-s4t2",
    );
    assert.equal(taskRow?.status, "complete", "task must be marked complete after PR merge observed");
    const tracking = store.get<{ observed_state_json: string | null }>(
      "SELECT observed_state_json FROM external_tracking WHERE created_by_op_id = ?",
      createPrOpId,
    );
    assert.deepEqual(
      JSON.parse(tracking?.observed_state_json ?? "null"),
      { state: "closed", merged: true },
      "merged observation must be durable",
    );

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
  let providerEffects = 0;
  const countingPiSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number; stopReason?: "aborted" | "error" } {
      spawnCount++;
      const beforeModelCall = (opts as Record<string, unknown>)["beforeModelCall"];
      let stopReason: "error" | undefined;
      return {
        abort() {},
        async waitForIdle() {
          if (typeof beforeModelCall !== "function") throw new Error("beforeModelCall must be supplied");
          try {
            await beforeModelCall();
            providerEffects++;
          } catch {
            stopReason = "error";
          }
        },
        reset() {},
        contextTokens: 0,
        get stopReason() { return stopReason; },
      };
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

  // Pre-restart assertion: the session spawned, but its rejected model call parked the task.
  const parkedRow = store.get<{ status: string }>(
    "SELECT status FROM scheduler_task WHERE node_id = ?",
    "task-restart-halt",
  );
  assert.equal(parkedRow?.status, "parked", "task must be parked after budget breach (pre-restart)");
  assert.equal(spawnCount, 1, "spawnAgent must be called once before its first model-call reservation");
  assert.equal(providerEffects, 0, "the rejected first model call must not reach the provider");

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
    assert.equal(spawnCount, 1, "spawnAgent must NOT be called after restart — task remains parked");
    assert.equal(providerEffects, 0, "restart must not produce another provider effect");

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
  let providerEffects = 0;
  const countingPiSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number; stopReason?: "aborted" | "error" } {
      spawnCount++;
      const beforeModelCall = (opts as Record<string, unknown>)["beforeModelCall"];
      let stopReason: "error" | undefined;
      return {
        abort() {},
        async waitForIdle() {
          if (typeof beforeModelCall !== "function") throw new Error("beforeModelCall must be supplied");
          try {
            await beforeModelCall();
            providerEffects++;
          } catch {
            stopReason = "error";
          }
        },
        reset() {},
        contextTokens: 0,
        get stopReason() { return stopReason; },
      };
    },
  };

  await writeFile(join(featureDir, "epic.md"), GAP4_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-spend"), { recursive: true });
  await writeFile(join(featureDir, "001-spend", "INDEX.md"), "# Story Spend\n", "utf8");
  await writeFile(join(featureDir, "001-spend", "task-gap4-spend.md"), GAP4_TASK_MD, "utf8");

  // --- Daemon 1: first model-call reserve proceeds; spend is consumed ---
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

  // Phase 1 assertion: first model-call reserve proceeded — provider effect fired and spend persisted.
  assert.equal(
    spawnCount,
    1,
    "GAP4: first tick must spawn the session (budget not yet breached; 0+10=10 < 15)",
  );
  assert.equal(providerEffects, 1, "GAP4: first model call must reach the provider");
  assert.equal(
    Number(store.get<{ ledger: string }>("SELECT ledger FROM budget_ledger")?.ledger),
    10,
    "GAP4: first model call must durably reserve one conservative cost",
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

    // AC: spend is durable — the second session spawns, but its model call is rejected.
    assert.equal(
      spawnCount,
      2,
      "GAP4: restart may spawn a session before the per-model-call reservation",
    );
    assert.equal(providerEffects, 1, "GAP4: rejected post-restart call must not reach the provider");
    assert.equal(
      Number(store.get<{ ledger: string }>("SELECT ledger FROM budget_ledger")?.ledger),
      10,
      "GAP4: the rejected post-restart reservation must not change durable spend",
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
  //   tick 1 model-call reserve: current=0, projected=10 ≤ 15 → provider effect + fail gate
  //   tick 2 model-call reserve: current=10, projected=20 > 15 → budget park (no provider effect)
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
  let providerEffects = 0;
  const piSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number; stopReason?: "aborted" | "error" } {
      spawnCount++;
      const beforeModelCall = (opts as Record<string, unknown>)["beforeModelCall"];
      let stopReason: "error" | undefined;
      return {
        abort() {},
        async waitForIdle() {
          if (typeof beforeModelCall !== "function") throw new Error("beforeModelCall must be supplied");
          try {
            await beforeModelCall();
            providerEffects++;
          } catch {
            stopReason = "error";
          }
        },
        reset() {},
        contextTokens: 0,
        get stopReason() { return stopReason; },
      };
    },
  };

  // Script only a fail on attempt 1; the rejected second model call must skip the gate.
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

    // Tick 1: dispatch → model call → fail gate → evidence recorded; spend=10 consumed
    await handle.tick();
    assert.equal(spawnCount, 1, "S4: exactly one session spawned on tick 1");
    assert.equal(providerEffects, 1, "S4: first model call must reach the provider");

    const evidenceAfterTick1 = latestEvidence(store, "task-t2-alpha");
    assert.ok(evidenceAfterTick1, "S4: evidence row must exist after tick 1 fail");
    assert.equal(
      evidenceAfterTick1.summary,
      EVIDENCE_SUMMARY_T3_SENTINEL,
      "S4: evidence must carry the sentinel summary after tick 1 fail",
    );

    // Tick 2: session spawns, but reservation rejects before provider, gate, or delivery.
    await handle.tick();
    assert.equal(spawnCount, 2, "S4: retry may spawn before the per-model-call budget gate");
    assert.equal(providerEffects, 1, "S4: rejected retry must not reach the provider");
    assert.equal(sink.calls.length, 1, "S4: rejected retry must not run another gate check");

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
      prStateSeam: { async getPrState(_repo: string, _prNumber: number) { return { state: "closed", merged: true }; } },
      prStateRepo: "backend",
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
        prNumber: 91,
      });
      await handleM.tick();
      const rowM = storeM.get<{ status: string }>(
        "SELECT status FROM scheduler_task WHERE node_id = ?", TASK_ID,
      );
      assert.equal(rowM?.status, "complete",
        "S4T2-M: task must transition to complete once the durable PR poll reports 'merged'");
      const observedM = storeM.get<{ observed_state_json: string | null }>(
        "SELECT observed_state_json FROM external_tracking WHERE created_by_op_id = ?", opIdM,
      );
      assert.deepEqual(JSON.parse(observedM?.observed_state_json ?? "null"), { state: "closed", merged: true });
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
      prStateSeam: { async getPrState(_repo: string, _prNumber: number) { return { state: "closed", merged: false }; } },
      prStateRepo: "backend",
      prPollIntervalMs: 60_000,
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
        prNumber: 92,
      });
      await handleC.tick();
      const firstClosed = storeC.get<{ tracking_status: string }>(
        "SELECT tracking_status FROM external_tracking WHERE created_by_op_id = ?", opIdC,
      );
      assert.equal(firstClosed?.tracking_status, "active", "first closed-unmerged poll must await confirmation");
      clockC.advance(60_000);
      await handleC.tick();
      // AC: closed-unmerged PR must create an open escalation inbox item
      const inboxRows = storeC.all<{ kind: string; status: string }>(
        "SELECT kind, status FROM inbox_items WHERE kind = 'escalation' AND status = 'open'",
      );
      assert.equal(inboxRows.length, 1,
        "S4T2-C: second consecutive closed-unmerged poll must create exactly one escalation");
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

// ---------------------------------------------------------------------------
// 019.13 S001 T1 — ring-1 is bound to the session worktree (not featureDir)
// Asserts: a read to an absolute path inside the per-task worktree is allowed
// by the ring-1 hook.  Currently RED: the allowlist is featureDir/**, so
// mockWorktreePath/** is outside it → hook blocks → assert fails.
// ---------------------------------------------------------------------------

test("019.13 S001 T1 — ring-1 hook is bound to the session worktree; read inside worktree is allowed", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01913s1t1-"));
  const worktreesBase = await mkdtemp(join(tmpdir(), "krl-01913s1t1-wt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const mockBranchName = "wt-01913-branch";
  const mockWorktreePath = join(worktreesBase, mockBranchName);
  const mockDispatch = async (_opts: WorktreeDispatchOpts): Promise<WorktreeDispatchResult> =>
    ({ worktreePath: mockWorktreePath, branchName: mockBranchName, queued: false });

  // Sentinel: starts truthy so the assert fails if waitForIdle is never called.
  let hookResult: { block: boolean; reason?: string } | undefined = { block: true };
  const scriptedPiSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      const o = opts as Record<string, unknown>;
      const hook = o["beforeToolCall"] as (ctx: unknown) => Promise<{ block: boolean; reason?: string } | undefined>;
      return {
        abort() {},
        async waitForIdle() {
          // Read to absolute path inside session worktree.
          // Must be allowed when ring-1 is bound to mockWorktreePath.
          // Currently blocked: allowlist is featureDir/**, not mockWorktreePath/**.
          hookResult = await hook({
            assistantMessage: { role: "assistant", content: [] },
            toolCall: { id: "call-wt-read-001", name: "read", input: { path: join(mockWorktreePath, "slugify.mjs") } },
            args: { path: join(mockWorktreePath, "slugify.mjs") },
            context: { systemPrompt: "", messages: [], tools: [] },
          });
        },
        reset() {},
        contextTokens: 0,
      };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger,
    piSurface: scriptedPiSurface,
    statusServerFactory: createStatusServer,
    worktreeSlot: { worktreesBase, repoPath: worktreesBase, dispatch: mockDispatch },
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    // AC: a read inside the session worktree must pass ring-1 (hook returns undefined).
    // Fails now because ring-1 uses featureDir/** as the allowlist; worktree path is outside it.
    assert.equal(hookResult, undefined, "read inside session worktree must be allowed when ring-1 is bound to the session worktree (not featureDir)");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(worktreesBase, { recursive: true, force: true });
  }
});

// 019.14 S002 T1 — read of bare worktree root is allowed (no trailing slash)
// Asserts: the ring-1 read allowlist includes the bare worktree path, not just
// <wt>/**. A read of <wt> itself must return undefined (allowed), while a read
// of a sibling path outside the worktree must return { block: true }.
// Currently RED: allow=[<wt>/**] — globToRegex("…/**") does not match bare "…".

test("019.14 S002 T1 — ring-1 read allowlist includes bare worktree root; sibling path remains blocked", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01914s2t1-"));
  const worktreesBase = await mkdtemp(join(tmpdir(), "krl-01914s2t1-wt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const mockBranchName = "wt-01914s2-branch";
  const mockWorktreePath = join(worktreesBase, mockBranchName);
  const siblingPath = join(worktreesBase, "sibling-outside-wt");
  const mockDispatch = async (_opts: WorktreeDispatchOpts): Promise<WorktreeDispatchResult> =>
    ({ worktreePath: mockWorktreePath, branchName: mockBranchName, queued: false });

  // Sentinel: starts truthy so the assert fails if waitForIdle is never called.
  let bareRootResult: { block: boolean; reason?: string } | undefined = { block: true, reason: "sentinel — waitForIdle never called" };
  let siblingResult: { block: boolean; reason?: string } | undefined = undefined;

  const scriptedPiSurface = {
    spawnAgent(opts: unknown): { abort(): void; waitForIdle(): Promise<void>; reset(): void; contextTokens: number } {
      const o = opts as Record<string, unknown>;
      const hook = o["beforeToolCall"] as (ctx: unknown) => Promise<{ block: boolean; reason?: string } | undefined>;
      return {
        abort() {},
        async waitForIdle() {
          // AC1: read of the bare worktree root (no trailing slash) must be allowed.
          // Currently blocked: allow=[<wt>/**] does not match bare <wt>.
          bareRootResult = await hook({
            assistantMessage: { role: "assistant", content: [] },
            toolCall: { id: "call-bare-root", name: "read", input: { path: mockWorktreePath } },
            args: { path: mockWorktreePath },
            context: { systemPrompt: "", messages: [], tools: [] },
          });
          // AC2: read of a sibling path outside the worktree must remain blocked.
          siblingResult = await hook({
            assistantMessage: { role: "assistant", content: [] },
            toolCall: { id: "call-sibling", name: "read", input: { path: siblingPath } },
            args: { path: siblingPath },
            context: { systemPrompt: "", messages: [], tools: [] },
          });
        },
        reset() {},
        contextTokens: 0,
      };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger,
    piSurface: scriptedPiSurface,
    statusServerFactory: createStatusServer,
    worktreeSlot: { worktreesBase, repoPath: worktreesBase, dispatch: mockDispatch },
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    // AC1: bare worktree root read must be allowed (undefined = no escalation).
    // Fails today: allow=[<wt>/**] only — globToRegex("…/**") does not match bare "…".
    assert.equal(bareRootResult, undefined, "read of bare worktree root must be allowed by ring-1 allowlist");
    // AC2: sibling path outside the worktree must remain blocked.
    assert.equal((siblingResult as { block: boolean; reason?: string } | undefined)?.block, true, "read of a sibling path outside the worktree must be blocked");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(worktreesBase, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 019.16 S001 T2 — tick() stages + commits a writing session before delivery
// ---------------------------------------------------------------------------

const S016S1T2_GIT_ADD_ENTRY: VerbRegistryEntry = {
  verb: "git.add",
  tier: "auto",
  timeout: 30000,
  idempotency: { window_ms: 3600000 },
  retry: { max: 3, backoff: "exponential" },
  poll_interval: 50,
  terminal_states: ["done", "failed"],
  rate_limit: { requests_per_minute: 0 },
  observed_state_can_regress: false,
};

const S016S1T2_GIT_COMMIT_ENTRY: VerbRegistryEntry = {
  verb: "git.commit",
  tier: "auto",
  timeout: 30000,
  idempotency: { window_ms: 3600000 },
  retry: { max: 3, backoff: "exponential" },
  poll_interval: 50,
  terminal_states: ["done", "failed"],
  rate_limit: { requests_per_minute: 0 },
  observed_state_can_regress: false,
};

test("019.16 S001 T2-a — tick() submits git.add then git.commit before delivery; push fires when commitsAhead > 0", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01916s1t2a-"));
  const worktreesBase = await mkdtemp(join(tmpdir(), "krl-01916s1t2a-wt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const mockBranchName = "wt-commit-test-a";
  const mockWorktreePath = join(worktreesBase, mockBranchName);
  const mockDispatch = async (_opts: WorktreeDispatchOpts): Promise<WorktreeDispatchResult> =>
    ({ worktreePath: mockWorktreePath, branchName: mockBranchName, queued: false });

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const addSubmitInputs: unknown[] = [];
  const commitSubmitInputs: unknown[] = [];
  const pushSubmitCalls: unknown[] = [];

  const addAdapter: AsyncVerbAdapter = {
    submit: async (i: unknown): Promise<unknown> => { addSubmitInputs.push(i); return "req-add-a"; },
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const commitAdapter: AsyncVerbAdapter = {
    submit: async (i: unknown): Promise<unknown> => { commitSubmitInputs.push(i); return "req-commit-a"; },
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const pushAdapter: AsyncVerbAdapter = {
    submit: async (i: unknown): Promise<unknown> => { pushSubmitCalls.push(i); return "req-push-a"; },
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-pr-a",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    worktreeSlot: { worktreesBase, repoPath: worktreesBase, dispatch: mockDispatch },
    verbAdapters: {
      "git.add": { entry: S016S1T2_GIT_ADD_ENTRY, adapter: addAdapter },
      "git.commit": { entry: S016S1T2_GIT_COMMIT_ENTRY, adapter: commitAdapter },
      "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: pushAdapter },
      "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: createPrAdapter },
    },
    commitsAhead: async (_b: string, _base: string): Promise<number> => 1,
    remote: "origin",
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    // (a) git.add submit called with session worktree cwd
    assert.equal(addSubmitInputs.length, 1, "git.add submit must be called once for a writing session");
    assert.equal(
      (addSubmitInputs[0] as Record<string, unknown>)["cwd"],
      mockWorktreePath,
      "git.add cwd must equal the session worktree path",
    );
    // (b) git.commit submit called with message containing task id
    assert.equal(commitSubmitInputs.length, 1, "git.commit submit must be called once for a writing session");
    assert.ok(
      String((commitSubmitInputs[0] as Record<string, unknown>)["message"]).includes("task-foo"),
      "git.commit message must contain the task id",
    );
    // (c) delivery ran because commitsAhead > 0
    assert.equal(pushSubmitCalls.length, 1, "push adapter must be called when commitsAhead > 0 (delivery triggered)");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(worktreesBase, { recursive: true, force: true });
  }
});

test("019.16 S001 T2-b — tick() makes no delivery when commitsAhead stays 0 (no-change session)", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01916s1t2b-"));
  const worktreesBase = await mkdtemp(join(tmpdir(), "krl-01916s1t2b-wt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const mockBranchName = "wt-commit-test-b";
  const mockWorktreePath = join(worktreesBase, mockBranchName);
  const mockDispatch = async (_opts: WorktreeDispatchOpts): Promise<WorktreeDispatchResult> =>
    ({ worktreePath: mockWorktreePath, branchName: mockBranchName, queued: false });

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  let pushSubmitCallsB = 0;
  const addAdapterB: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-add-b",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const commitAdapterB: AsyncVerbAdapter = {
    // Simulates nothing-to-commit: submit succeeds but poll returns failed
    submit: async (_: unknown): Promise<unknown> => "req-commit-b",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "failed", error: { stderr: "nothing to commit" } }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "failed", error: { stderr: "nothing to commit" } }),
  };
  const pushAdapterB: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => { pushSubmitCallsB++; return "req-push-b"; },
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapterB: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-pr-b",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    worktreeSlot: { worktreesBase, repoPath: worktreesBase, dispatch: mockDispatch },
    verbAdapters: {
      "git.add": { entry: S016S1T2_GIT_ADD_ENTRY, adapter: addAdapterB },
      "git.commit": { entry: S016S1T2_GIT_COMMIT_ENTRY, adapter: commitAdapterB },
      "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: pushAdapterB },
      "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: createPrAdapterB },
    },
    // commitsAhead always returns 0 — simulates nothing committed
    commitsAhead: async (_b: string, _base: string): Promise<number> => 0,
    remote: "origin",
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    // delivery must NOT be triggered when commitsAhead stays 0
    assert.equal(pushSubmitCallsB, 0, "push adapter must NOT be called when commitsAhead is 0 (no-change session)");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(worktreesBase, { recursive: true, force: true });
  }
});

// 019.16 S003 T1 — delivered task transitions to "delivering"; complete on merge
// ---------------------------------------------------------------------------

test("019.16 S003 T1-a/b — task is 'delivering' after delivery tick; 'complete' after PR merge observed", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01916s3t1ab-"));
  const worktreesBase = await mkdtemp(join(tmpdir(), "krl-01916s3t1ab-wt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const mockBranchName = "wt-s3t1ab";
  const mockWorktreePath = join(worktreesBase, mockBranchName);
  const mockDispatch = async (_opts: WorktreeDispatchOpts): Promise<WorktreeDispatchResult> =>
    ({ worktreePath: mockWorktreePath, branchName: mockBranchName, queued: false });

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const addAdapterS3T1: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-add-s3t1ab",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const commitAdapterS3T1: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-commit-s3t1ab",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const pushAdapterS3T1: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-push-s3t1ab",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapterS3T1: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-pr-s3t1ab",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    worktreeSlot: { worktreesBase, repoPath: worktreesBase, dispatch: mockDispatch },
    verbAdapters: {
      "git.add": { entry: S016S1T2_GIT_ADD_ENTRY, adapter: addAdapterS3T1 },
      "git.commit": { entry: S016S1T2_GIT_COMMIT_ENTRY, adapter: commitAdapterS3T1 },
      "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: pushAdapterS3T1 },
      "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: createPrAdapterS3T1 },
    },
    commitsAhead: async (_b: string, _base: string): Promise<number> => 1,
    remote: "origin",
    prStateSeam: { async getPrState(_repo: string, _prNumber: number) { return { state: "closed", merged: true }; } },
    prStateRepo: "backend",
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");

    // Tick 1: session completes cleanly, commitsAhead > 0 → delivery fires
    await handle.tick();

    // T1-a: task must be "delivering" after delivery, not "running"
    const afterDelivery = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-foo",
    );
    assert.equal(
      afterDelivery?.status,
      "delivering",
      "task must be 'delivering' after delivery tick (not 'running')",
    );

    // T1-b: reconciliation has learned the PR number; the next durable poll reports merged.
    const prOp = store.get<{ op_id: string }>(
      "SELECT op_id FROM broker_in_flight WHERE idempotency_key = ?",
      "create_pr:task-foo",
    );
    assert.ok(prOp !== undefined, "create_pr op must be in broker_in_flight after delivery");
    store.run(
      `UPDATE external_tracking
       SET external_id = ?, observed_state_json = ?, next_poll_at = ?
       WHERE created_by_op_id = ?`,
      "46", JSON.stringify({ state: "open", merged: false }), clock.now(), prOp.op_id,
    );

    await handle.tick();

    const afterMerge = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-foo",
    );
    assert.equal(
      afterMerge?.status,
      "complete",
      "task must be 'complete' after PR merge observed",
    );
    const observedMerge = store.get<{ observed_state_json: string | null }>(
      "SELECT observed_state_json FROM external_tracking WHERE created_by_op_id = ?", prOp.op_id,
    );
    assert.deepEqual(JSON.parse(observedMerge?.observed_state_json ?? "null"), { state: "closed", merged: true });
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(worktreesBase, { recursive: true, force: true });
  }
});

test("019.16 S003 T1-c — clean session with commitsAhead = 0 does NOT set 'delivering'", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01916s3t1c-"));
  const worktreesBase = await mkdtemp(join(tmpdir(), "krl-01916s3t1c-wt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const mockBranchName = "wt-s3t1c";
  const mockWorktreePath = join(worktreesBase, mockBranchName);
  const mockDispatch = async (_opts: WorktreeDispatchOpts): Promise<WorktreeDispatchResult> =>
    ({ worktreePath: mockWorktreePath, branchName: mockBranchName, queued: false });

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    worktreeSlot: { worktreesBase, repoPath: worktreesBase, dispatch: mockDispatch },
    verbAdapters: {
      "git.add": { entry: S016S1T2_GIT_ADD_ENTRY, adapter: { submit: async (_: unknown): Promise<unknown> => "req-add-s3t1c", poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }), reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }) } },
      "git.commit": { entry: S016S1T2_GIT_COMMIT_ENTRY, adapter: { submit: async (_: unknown): Promise<unknown> => "req-commit-s3t1c", poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }), reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }) } },
      "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: { submit: async (_: unknown): Promise<unknown> => "req-push-s3t1c", poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }), reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }) } },
      "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: { submit: async (_: unknown): Promise<unknown> => "req-pr-s3t1c", poll_status: async (_: unknown): Promise<unknown> => ({ status: "pending" }), reconcile: async (_: unknown): Promise<unknown> => ({ status: "pending" }) } },
    },
    commitsAhead: async (_b: string, _base: string): Promise<number> => 0,
    remote: "origin",
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-foo",
    );
    // guard: commitsAhead=0 must NOT set "delivering"
    assert.notEqual(
      taskRow?.status,
      "delivering",
      "task must NOT be 'delivering' when commitsAhead = 0 (nothing delivered)",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(worktreesBase, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 019.17 S003 T2 — run-loop resolves + passes identity; escalates when unconfigured
// ---------------------------------------------------------------------------

test("019.17 S003 T2-a — git.commit submit carries resolved name and email when identity is configured", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01917s3t2a-"));
  const worktreesBase = await mkdtemp(join(tmpdir(), "krl-01917s3t2a-wt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const mockBranchName = "wt-ident-test-a";
  const mockWorktreePath = join(worktreesBase, mockBranchName);
  const mockDispatch = async (_opts: WorktreeDispatchOpts): Promise<WorktreeDispatchResult> =>
    ({ worktreePath: mockWorktreePath, branchName: mockBranchName, queued: false });

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const commitSubmitInputsT2a: unknown[] = [];

  const addAdapterT2a: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-add-t2a",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const commitAdapterT2a: AsyncVerbAdapter = {
    submit: async (i: unknown): Promise<unknown> => { commitSubmitInputsT2a.push(i); return "req-commit-t2a"; },
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    worktreeSlot: { worktreesBase, repoPath: worktreesBase, dispatch: mockDispatch },
    verbAdapters: {
      "git.add": { entry: S016S1T2_GIT_ADD_ENTRY, adapter: addAdapterT2a },
      "git.commit": { entry: S016S1T2_GIT_COMMIT_ENTRY, adapter: commitAdapterT2a },
    },
    commitsAhead: async (_b: string, _base: string): Promise<number> => 0,
    resolveCommitterIdentity: async (_taskId: string) => ({ name: "Ada Lovelace", email: "ada@example.com" }),
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    assert.equal(commitSubmitInputsT2a.length, 1, "git.commit submit must be called once when identity is configured");
    const payloadT2a = commitSubmitInputsT2a[0] as Record<string, unknown>;
    assert.equal(payloadT2a["name"], "Ada Lovelace", "git.commit submit must carry resolved committer name");
    assert.equal(payloadT2a["email"], "ada@example.com", "git.commit submit must carry resolved committer email");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(worktreesBase, { recursive: true, force: true });
  }
});

test("019.17 S003 T2-b — no git.commit submit and escalation inbox item created when identity is unconfigured", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01917s3t2b-"));
  const worktreesBase = await mkdtemp(join(tmpdir(), "krl-01917s3t2b-wt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const mockBranchName = "wt-ident-test-b";
  const mockWorktreePath = join(worktreesBase, mockBranchName);
  const mockDispatchT2b = async (_opts: WorktreeDispatchOpts): Promise<WorktreeDispatchResult> =>
    ({ worktreePath: mockWorktreePath, branchName: mockBranchName, queued: false });

  const piSurfaceT2b = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const commitSubmitInputsT2b: unknown[] = [];

  const addAdapterT2b: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-add-t2b",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const commitAdapterT2b: AsyncVerbAdapter = {
    submit: async (i: unknown): Promise<unknown> => { commitSubmitInputsT2b.push(i); return "req-commit-t2b"; },
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };

  const handleT2b = await runDaemon({
    store, featureDir, clock, logger, piSurface: piSurfaceT2b, statusServerFactory: createStatusServer,
    worktreeSlot: { worktreesBase, repoPath: worktreesBase, dispatch: mockDispatchT2b },
    verbAdapters: {
      "git.add": { entry: S016S1T2_GIT_ADD_ENTRY, adapter: addAdapterT2b },
      "git.commit": { entry: S016S1T2_GIT_COMMIT_ENTRY, adapter: commitAdapterT2b },
    },
    commitsAhead: async (_b: string, _base: string): Promise<number> => 0,
    resolveCommitterIdentity: async (_taskId: string) => undefined,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handleT2b.tick();

    assert.equal(commitSubmitInputsT2b.length, 0, "git.commit must NOT be submitted when committer identity is unconfigured");

    const inboxRowsT2b = store.all<{ kind: string; evidence: string }>(
      "SELECT kind, evidence FROM inbox_items",
    );
    assert.ok(inboxRowsT2b.length > 0, "at least one inbox item must exist when committer identity is unconfigured");
    const itemT2b = inboxRowsT2b[0];
    assert.ok(itemT2b !== undefined, "inbox item must be non-undefined");
    assert.equal(itemT2b.kind, "escalation", "inbox item kind must be 'escalation'");
    const evidenceT2b = JSON.parse(itemT2b.evidence) as { reason: string };
    assert.ok(
      evidenceT2b.reason.includes("committer-identity"),
      `escalation reason must name the committer identity issue; got: ${evidenceT2b.reason}`,
     );
  } finally {
    await handleT2b.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(worktreesBase, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 019.18 B3/B4 — reviewRouter receives real prNumber; poller resolves real review item
// ---------------------------------------------------------------------------

test("019.18 B3 — deliverSession passes params.prNumber (not 0) to reviewRouter.requestReview", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918b3-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const capturedReviewRequests: Array<{ taskId: string; prNumber: number; prUrl: string }> = [];
  const reviewRouter = {
    async requestReview(req: { taskId: string; prNumber: number; prUrl: string }) {
      capturedReviewRequests.push({ taskId: req.taskId, prNumber: req.prNumber, prUrl: req.prUrl });
    },
  };

  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-push-b3",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-pr-b3",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger,
    piSurface: { spawnAgent(_opts: unknown) { return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 }; } },
    statusServerFactory: createStatusServer,
    reviewRouter,
    prStateSeam: { async getPrState(_r: string, _n: number) { return { state: "open", merged: false }; } },
    prStateRepo: "backend",
    prPollIntervalMs: 0,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo", "feat-s002t1", "delivering",
    );

    await handle.deliverSession({
      pushAdapter,
      pushEntry: S003T1_PUSH_ENTRY,
      pushInput: { cwd: "/tmp/test", branch: "feat/b3", remote: "origin" },
      pushIdempotencyKey: "push-b3-001",
      createPrAdapter,
      createPrEntry: S01918S2T2_CREATE_PR_ENTRY,
      createPrInput: { head: "feat/b3", base: "main", title: "B3 PR", body: "" },
      createPrIdempotencyKey: "create-pr-b3-001",
      taskId: "task-foo",
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
    });

    // B3 contract: reviewRouter must receive prNumber=42, not 0 or placeholder.
    assert.equal(capturedReviewRequests.length, 1, "reviewRouter.requestReview must be called once");
    assert.equal(
      capturedReviewRequests[0]!.prNumber,
      42,
      "B3: reviewRouter must receive the real prNumber (42), not 0",
    );
    assert.equal(
      capturedReviewRequests[0]!.prUrl,
      "https://github.com/org/repo/pull/42",
      "B3: reviewRouter must receive the real prUrl, not the opId placeholder",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("019.18 B4 — tick resolves review inbox item using real PR number (not hardcoded :0)", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918b4-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const handle = await runDaemon({
    store, featureDir, clock, logger,
    piSurface: { spawnAgent(_opts: unknown) { return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 }; } },
    statusServerFactory: createStatusServer,
    prStateSeam: { async getPrState(_r: string, _n: number) { return { state: "closed", merged: true }; } },
    prStateRepo: "backend",
    prPollIntervalMs: 0,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo", "feat-s002t1", "delivering",
    );

    // Seed external_tracking row with prNumber=55 (simulates a persisted row after restart).
    const { createHash } = await import("node:crypto");
    const etId = `ext:${createHash("sha256").update("create_pr:task-foo").digest("hex").slice(0, 32)}`;    store.run(
      `INSERT OR IGNORE INTO external_tracking
         (id, local_kind, local_id, external_kind, external_provider, external_id,
          created_by_op_id, idempotency_key, tracking_status, next_poll_at, attempt_count, created_at, updated_at)
       VALUES (?, 'task', 'task-foo', 'pull_request', 'github', '55',
               'op-pr-b4', 'create_pr:task-foo', 'active', ?, 0, ?, ?)`,
      etId, clock.now(), clock.now(), clock.now(),
    );

    // Seed the review inbox item using real PR number 55 (source_id = review_requested:task-foo:55).
    const reviewItemB4 = createEscalationItem({
      source_id: "review_requested:task-foo:55",
      task_id: "task-foo",
      reason: "review_requested",
      payload_summary: "PR #55",
      store,
      clock,
    });
    const reviewItemId = reviewItemB4.id;

    await handle.tick();

    // B4 contract: the real review item (source_id with :55) must be resolved, not the :0 placeholder.
    const reviewItem = store.get<{ status: string }>(
      "SELECT status FROM inbox_items WHERE id = ?",
      reviewItemId,
    );
    assert.equal(
      reviewItem?.status,
      "resolved",
      "B4: review inbox item keyed by real prNumber (55) must be resolved when PR merges",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 019.18 B6 crash-survival gates — external_tracking durability
// ---------------------------------------------------------------------------

// Gate 1: after deliverSession, an external_tracking row exists for the PR (survives restart).
test("019.18 B6 gate1 — deliverSession writes an external_tracking row for the PR", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918b6g1-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-push-b6g1",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-pr-b6g1",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
  };
  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    prStateSeam: { async getPrState(_r: string, _n: number) { return { state: "open", merged: false }; } },
    prStateRepo: "backend",
    prPollIntervalMs: 0,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo", "feat-s002t1", "delivering",
    );

    await handle.deliverSession({
      pushAdapter,
      pushEntry: S003T1_PUSH_ENTRY,
      pushInput: { cwd: "/tmp/test", branch: "feat/b6g1", remote: "origin" },
      pushIdempotencyKey: "push-b6g1-001",
      createPrAdapter,
      createPrEntry: S01918S2T2_CREATE_PR_ENTRY,
      createPrInput: { head: "feat/b6g1", base: "main", title: "B6G1 PR", body: "" },
      createPrIdempotencyKey: "create-pr-b6g1-001",
      taskId: "task-foo",
      prNumber: 77,
    });

    // The durable external_tracking row must exist immediately after deliverSession —
    // so a crash before tick() does not lose the PR→task link.
    const row = store.get<{ local_id: string; tracking_status: string; external_id: string }>(
      "SELECT local_id, tracking_status, external_id FROM external_tracking WHERE local_id = ? AND local_kind = 'task'",
      "task-foo",
    );
    assert.ok(row !== undefined, "external_tracking row must exist for the PR after deliverSession");
    assert.equal(row.external_id, "77", "external_tracking.external_id must equal the PR number");
    assert.equal(row.tracking_status, "active", "external_tracking.tracking_status must be 'active' after delivery");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// Gate 2: poller uses external_tracking rows even when prOpTaskMap is empty (restart scenario).
test("019.18 B6 gate2 — poller completes task from external_tracking row when prOpTaskMap is empty (restart)", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918b6g2-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  // Seed the external_tracking row directly (simulating post-restart state, prOpTaskMap is empty).
  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    prStateSeam: { async getPrState(_r: string, _n: number) { return { state: "closed", merged: true }; } },
    prStateRepo: "backend",
    prPollIntervalMs: 0,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo", "feat-s002t1", "delivering",
    );

    // Seed the durable row directly — simulating a prior run that crashed after writing the row.
    store.run(
      `INSERT INTO external_tracking
         (id, local_kind, local_id, external_kind, external_provider, external_id,
          created_by_op_id, idempotency_key, tracking_status, next_poll_at, attempt_count, created_at, updated_at)
       VALUES (?, 'task', 'task-foo', 'pull_request', 'github', '77',
               'op-create-pr-b6g2', 'create-pr-b6g2', 'active', ?, 0, ?, ?)`,
      "ext-b6g2-row", clock.now(), clock.now(), clock.now(),
    );

    // Tick with empty in-memory prOpTaskMap — poller must read from external_tracking.
    await handle.tick();

    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-foo",
    );
    assert.equal(
      taskRow?.status,
      "complete",
      "task must become complete from external_tracking row even when prOpTaskMap is empty at restart",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// Gate 3 / reviewer B3: poll failure remains durable and visible to operators.
test("Reviewer B3 — prStateSeam failure persists backoff and logs tracking context", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918b6g3-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logRecords: Array<Record<string, unknown>> = [];
  const logger = { info(record: Record<string, unknown>): void { logRecords.push({ ...record }); } };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    prStateSeam: { async getPrState(_r: string, _n: number): Promise<{ state: string; merged: boolean }> {
      throw new Error("network-error-b6g3");
    }},
    prStateRepo: "backend",
    prPollIntervalMs: 60_000,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo", "feat-s002t1", "delivering",
    );

    // Seed durable tracking row due for polling now.
    const beforePoll = clock.now();
    store.run(
      `INSERT INTO external_tracking
         (id, local_kind, local_id, external_kind, external_provider, external_id,
          created_by_op_id, idempotency_key, tracking_status, next_poll_at, attempt_count, created_at, updated_at)
       VALUES (?, 'task', 'task-foo', 'pull_request', 'github', '77',
               'op-b6g3', 'key-b6g3', 'active', ?, 0, ?, ?)`,
      "ext-b6g3", beforePoll, beforePoll, beforePoll,
    );

    await handle.tick();

    const row = store.get<{ last_error_json: string | null; next_poll_at: number; attempt_count: number }>(
      "SELECT last_error_json, next_poll_at, attempt_count FROM external_tracking WHERE id = ?",
      "ext-b6g3",
    );
    assert.ok(row !== undefined, "external_tracking row must still exist after poll failure");
    assert.ok(row.last_error_json !== null, "last_error_json must be set after poll failure");
    const err = JSON.parse(row.last_error_json!) as { message: string };
    assert.ok(err.message.includes("network-error-b6g3"), "last_error_json must capture the error message");
    assert.ok(row.next_poll_at > beforePoll, "next_poll_at must advance after poll failure (backoff)");
    assert.equal(row.attempt_count, 1, "attempt_count must increment after poll failure");

    const failureLog = logRecords.find(
      (record) =>
        record["tracking_id"] === "ext-b6g3" &&
        record["task_id"] === "task-foo" &&
        record["pr_number"] === 77 &&
        typeof record["error"] === "string" &&
        record["error"].includes("network-error-b6g3"),
    );
    assert.ok(
      failureLog !== undefined,
      "prStateSeam failure must emit a structured log with tracking, task, PR, and error context",
    );

    // Tracking row must NOT be deleted — it survives failure.
    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-foo",
    );
    assert.equal(taskRow?.status, "delivering", "task must remain delivering after poll failure");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// Gate 4: closed-unmerged escalates exactly once — second tick does not double-escalate.
test("019.18 B6 gate4 — closed-unmerged PR escalates exactly once (idempotent after restart)", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918b6g4-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    prStateSeam: { async getPrState(_r: string, _n: number) { return { state: "closed", merged: false }; } },
    prStateRepo: "backend",
    prPollIntervalMs: 0,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo", "feat-s002t1", "delivering",
    );

    store.run(
      `INSERT INTO external_tracking
         (id, local_kind, local_id, external_kind, external_provider, external_id,
          created_by_op_id, idempotency_key, tracking_status, next_poll_at, attempt_count, created_at, updated_at)
       VALUES (?, 'task', 'task-foo', 'pull_request', 'github', '77',
               'op-b6g4', 'key-b6g4', 'active', ?, 0, ?, ?)`,
      "ext-b6g4", clock.now(), clock.now(), clock.now(),
    );

    await handle.tick();
    // Second tick simulates restart with same durable row but terminal tracking_status.
    await handle.tick();

    const escalations = store.all<{ kind: string }>(
      "SELECT kind FROM inbox_items WHERE kind = 'escalation' AND json_extract(evidence, '$.reason') LIKE '%pr-closed%'",
    );
    assert.equal(escalations.length, 1, "closed-unmerged escalation must be created exactly once, not duplicated");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// Gate 5: merged PR completes task exactly once (idempotent after restart).
test("019.18 B6 gate5 — merged PR completes task exactly once (idempotent after restart)", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918b6g5-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  let getPrStateCalls = 0;
  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    prStateSeam: { async getPrState(_r: string, _n: number) {
      getPrStateCalls++;
      return { state: "closed", merged: true };
    }},
    prStateRepo: "backend",
    prPollIntervalMs: 0,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo", "feat-s002t1", "delivering",
    );

    store.run(
      `INSERT INTO external_tracking
         (id, local_kind, local_id, external_kind, external_provider, external_id,
          created_by_op_id, idempotency_key, tracking_status, next_poll_at, attempt_count, created_at, updated_at)
       VALUES (?, 'task', 'task-foo', 'pull_request', 'github', '77',
               'op-b6g5', 'key-b6g5', 'active', ?, 0, ?, ?)`,
      "ext-b6g5", clock.now(), clock.now(), clock.now(),
    );

    // First tick: transitions task to complete, sets tracking_status='terminal'.
    await handle.tick();

    const taskAfterFirst = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-foo",
    );
    assert.equal(taskAfterFirst?.status, "complete", "task must be complete after first tick");

    // Second tick: tracking_status='terminal' — poller must NOT re-fire task transition.
    const firstCallCount = getPrStateCalls;
    await handle.tick();

    // After second tick, prStateSeam must not be called again for a terminal row.
    assert.equal(
      getPrStateCalls,
      firstCallCount,
      "prStateSeam must not be called for a terminal external_tracking row on second tick",
    );

    const taskAfterSecond = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-foo",
    );
    assert.equal(taskAfterSecond?.status, "complete", "task must remain complete after second tick");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 019.18 Story 002 T2 — run-loop polls outstanding PRs and records terminal completions
// ---------------------------------------------------------------------------

// Reuse S002 fixtures for feature scaffolding
const S01918S2T2_CREATE_PR_ENTRY: VerbRegistryEntry = {
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

test("019.18 S002 T2 — tick writes merged broker_completion and marks task complete when PR state is merged", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918s2t2a-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  // fake pr-state seam: always reports merged
  const seenGetPrState: Array<{ repo: string; prNumber: number }> = [];
  const fakePrStateSeam = {
    async getPrState(repo: string, prNumber: number): Promise<{ state: string; merged: boolean }> {
      seenGetPrState.push({ repo, prNumber });
      return { state: "closed", merged: true };
    },
  };

  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-push-01918s2t2a",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-pr-01918s2t2a",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
  };

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    prStateSeam: fakePrStateSeam,
    prStateRepo: "backend",
    prPollIntervalMs: 60_000,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo",
      "feat-s002t1",
      "delivering",
    );

    const { createPrOpId } = await handle.deliverSession({
      pushAdapter,
      pushEntry: S003T1_PUSH_ENTRY,
      pushInput: { cwd: "/tmp/test", branch: "feat/s2t2a", remote: "origin" },
      pushIdempotencyKey: "push-s2t2a-001",
      createPrAdapter,
      createPrEntry: S01918S2T2_CREATE_PR_ENTRY,
      createPrInput: { head: "feat/s2t2a", base: "main", title: "S2T2A PR", body: "" },
      createPrIdempotencyKey: "create-pr-s2t2a-001",
      taskId: "task-foo",
      prNumber: 42,
    });

     // tick: run-loop polls prStateSeam for outstanding ops → merged → sets external_tracking terminal → mark complete
    await handle.tick();

    const trackingRow = store.get<{ tracking_status: string }>(
      "SELECT tracking_status FROM external_tracking WHERE created_by_op_id = ?",
      createPrOpId,
    );
    assert.equal(
      trackingRow?.tracking_status,
      "terminal",
      "external_tracking row must be set to terminal when PR state is merged",
    );
    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-foo",
    );
    assert.equal(taskRow?.status, "complete", "task must be marked complete after merged completion observed");
    assert.equal(seenGetPrState.length >= 1, true, "prStateSeam.getPrState must be called at least once");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("019.18 S002 T2 — two closed-unmerged polls terminalize and escalate exactly once", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918s2t2b-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const fakePrStateSeam = {
    async getPrState(_repo: string, _prNumber: number): Promise<{ state: string; merged: boolean }> {
      return { state: "closed", merged: false };
    },
  };

  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-push-01918s2t2b",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-pr-01918s2t2b",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
  };

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    prStateSeam: fakePrStateSeam,
    prStateRepo: "backend",
    prPollIntervalMs: 0,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo",
      "feat-s002t1",
      "delivering",
    );

    const { createPrOpId } = await handle.deliverSession({
      pushAdapter,
      pushEntry: S003T1_PUSH_ENTRY,
      pushInput: { cwd: "/tmp/test", branch: "feat/s2t2b", remote: "origin" },
      pushIdempotencyKey: "push-s2t2b-001",
      createPrAdapter,
      createPrEntry: S01918S2T2_CREATE_PR_ENTRY,
      createPrInput: { head: "feat/s2t2b", base: "main", title: "S2T2B PR", body: "" },
      createPrIdempotencyKey: "create-pr-s2t2b-001",
      taskId: "task-foo",
      prNumber: 43,
    });

    await handle.tick();

    const firstTrackingRow = store.get<{ tracking_status: string }>(
      "SELECT tracking_status FROM external_tracking WHERE created_by_op_id = ?",
      createPrOpId,
    );
    assert.equal(firstTrackingRow?.tracking_status, "active", "first closed-unmerged poll must remain active");
    assert.equal(
      store.all("SELECT id FROM inbox_items WHERE json_extract(evidence, '$.reason') = 'pr-closed-unmerged'").length,
      0,
      "first closed-unmerged poll must not escalate",
    );
    clock.advance(60_000);
    await handle.tick();

    const trackingRow2 = store.get<{ tracking_status: string }>(
      "SELECT tracking_status FROM external_tracking WHERE created_by_op_id = ?",
      createPrOpId,
    );
    assert.equal(
      trackingRow2?.tracking_status,
      "terminal",
      "external_tracking row must be set to terminal when PR is closed unmerged",
    );
    const escalations = store.all<{ evidence: string }>(
      "SELECT evidence FROM inbox_items WHERE json_extract(evidence, '$.task_id') = ?",
      "task-foo",
    );
    assert.ok(
      escalations.some((e) => {
        try { return JSON.parse(e.evidence).reason === "pr-closed-unmerged"; } catch { return false; }
      }),
      "an escalation inbox item with reason 'pr-closed-unmerged' must be created",
    );
    await handle.tick();
    assert.equal(
      store.all("SELECT id FROM inbox_items WHERE json_extract(evidence, '$.reason') = 'pr-closed-unmerged'").length,
      1,
      "terminal tracking must preserve exactly-once escalation across subsequent ticks",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("019.18 S002 T2 — tick writes no completion and task stays delivering when PR is still open", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918s2t2c-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const fakePrStateSeam = {
    async getPrState(_repo: string, _prNumber: number): Promise<{ state: string; merged: boolean }> {
      return { state: "open", merged: false };
    },
  };

  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-push-01918s2t2c",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-pr-01918s2t2c",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
  };

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    prStateSeam: fakePrStateSeam,
    prStateRepo: "backend",
    prPollIntervalMs: 0,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo",
      "feat-s002t1",
      "delivering",
    );

    const { createPrOpId } = await handle.deliverSession({
      pushAdapter,
      pushEntry: S003T1_PUSH_ENTRY,
      pushInput: { cwd: "/tmp/test", branch: "feat/s2t2c", remote: "origin" },
      pushIdempotencyKey: "push-s2t2c-001",
      createPrAdapter,
      createPrEntry: S01918S2T2_CREATE_PR_ENTRY,
      createPrInput: { head: "feat/s2t2c", base: "main", title: "S2T2C PR", body: "" },
      createPrIdempotencyKey: "create-pr-s2t2c-001",
      taskId: "task-foo",
      prNumber: 44,
    });

    await handle.tick();

    const completionRow = store.get<{ status: string }>(
      "SELECT status FROM broker_completion WHERE op_id = ?",
      createPrOpId,
    );
    assert.equal(completionRow, undefined, "no broker_completion must be written when PR is still open");
    const taskRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      "task-foo",
    );
    assert.equal(taskRow?.status, "delivering", "task must remain in delivering status when PR is open");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("019.18 S002 T2 — prStateSeam is never called when no outstanding create_pr op exists", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918s2t2d-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  let getPrStateCalls = 0;
  const fakePrStateSeam = {
    async getPrState(_repo: string, _prNumber: number): Promise<{ state: string; merged: boolean }> {
      getPrStateCalls++;
      return { state: "open", merged: false };
    },
  };

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    prStateSeam: fakePrStateSeam,
    prStateRepo: "backend",
    prPollIntervalMs: 0,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });

    // tick with no outstanding create_pr ops → seam must not be called
    await handle.tick();

    assert.equal(getPrStateCalls, 0, "prStateSeam.getPrState must not be called when no outstanding create_pr op exists");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 019.18 Story 001 T2 — run-loop invokes ReviewRouter after delivery
// ---------------------------------------------------------------------------

test("019.18 S001 T2 — run-loop calls reviewRouter.requestReview with task id and PR details after delivery", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918s1t2-"));
  const worktreesBase = await mkdtemp(join(tmpdir(), "krl-01918s1t2-wt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const mockBranchName = "wt-01918s1t2";
  const mockWorktreePath = join(worktreesBase, mockBranchName);
  const mockDispatch = async (_opts: WorktreeDispatchOpts): Promise<WorktreeDispatchResult> =>
    ({ worktreePath: mockWorktreePath, branchName: mockBranchName, queued: false });

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const addAdapterT2: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-add-01918t2",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const commitAdapterT2: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-commit-01918t2",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const pushAdapterT2: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-push-01918t2",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapterT2: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-pr-01918t2",
    poll_status: async (_: unknown): Promise<unknown> => ({
      status: "done",
      result: {
        pr_number: 46,
        pr_url: "https://github.com/example/repo/pull/46",
      },
    }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
  };

  // Fake ReviewRouter — captures calls for assertion
  const reviewRequests: Array<{ taskId: string; prNumber: number; prUrl: string }> = [];
  const fakeReviewRouter = {
    async requestReview(req: { taskId: string; prNumber: number; prUrl: string }): Promise<void> {
      reviewRequests.push(req);
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    worktreeSlot: { worktreesBase, repoPath: worktreesBase, dispatch: mockDispatch },
    verbAdapters: {
      "git.add": { entry: S016S1T2_GIT_ADD_ENTRY, adapter: addAdapterT2 },
      "git.commit": { entry: S016S1T2_GIT_COMMIT_ENTRY, adapter: commitAdapterT2 },
      "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: pushAdapterT2 },
      "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: createPrAdapterT2 },
    },
    commitsAhead: async (_b: string, _base: string): Promise<number> => 1,
    remote: "origin",
    reviewRouter: fakeReviewRouter,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");

    // Tick 1: session completes cleanly, commitsAhead > 0 → delivery fires
    await handle.tick();
    clock.advance(S4T1DEL_CREATE_PR_ENTRY.poll_interval);
    await Promise.resolve();
    await handle.tick();

    // T2: reviewRouter.requestReview must have been called once with task id and PR info
    assert.equal(reviewRequests.length, 1, "reviewRouter.requestReview must be called exactly once after delivery");
    assert.equal(reviewRequests[0]?.taskId, "task-foo", "requestReview must receive the delivered task id");
    assert.ok(
      reviewRequests[0]?.prNumber === 46,
      "requestReview must receive the real prNumber",
    );
    assert.ok(
      reviewRequests[0]?.prUrl === "https://github.com/example/repo/pull/46",
      "requestReview must receive the real prUrl string",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(worktreesBase, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 019.18 Story 003 T1 — resolve review_requested inbox item on terminal PR state
// ---------------------------------------------------------------------------

test("019.18 S003 T1 — merged PR resolves the review_requested inbox item", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918s3t1a-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const fakePrStateSeam = {
    async getPrState(_repo: string, _prNumber: number): Promise<{ state: string; merged: boolean }> {
      return { state: "closed", merged: true };
    },
  };

  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-push-01918s3t1a",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-pr-01918s3t1a",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
  };

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    prStateSeam: fakePrStateSeam,
    prStateRepo: "backend",
    prPollIntervalMs: 60_000,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo",
      "feat-s002t1",
      "delivering",
    );

    await handle.deliverSession({
      pushAdapter,
      pushEntry: S003T1_PUSH_ENTRY,
      pushInput: { cwd: "/tmp/test", branch: "feat/s3t1a", remote: "origin" },
      pushIdempotencyKey: "push-s3t1a-001",
      createPrAdapter,
      createPrEntry: S01918S2T2_CREATE_PR_ENTRY,
      createPrInput: { head: "feat/s3t1a", base: "main", title: "S3T1A PR", body: "" },
      createPrIdempotencyKey: "create-pr-s3t1a-001",
      taskId: "task-foo",
      prNumber: 44,
    });

    // Pre-seed a review_requested inbox item using the real PR number (B4 contract).
    const reviewItem = createEscalationItem({
      source_id: "review_requested:task-foo:44",
      task_id: "task-foo",
      reason: "review_requested",
      payload_summary: "task task-foo PR ready for review",
      store,
      clock,
    });

    await handle.tick();

    // The review_requested item must no longer be open.
    const itemRow = store.get<{ status: string }>(
      "SELECT status FROM inbox_items WHERE id = ?",
      reviewItem.id,
    );
    assert.equal(
      itemRow?.status,
      "resolved",
      "review_requested inbox item must be resolved after PR merges",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("019.18 S003 T1 — closed-unmerged PR resolves the review_requested inbox item", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-01918s3t1b-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const fakePrStateSeam = {
    async getPrState(_repo: string, _prNumber: number): Promise<{ state: string; merged: boolean }> {
      return { state: "closed", merged: false };
    },
  };

  const pushAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-push-01918s3t1b",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
  };
  const createPrAdapter: AsyncVerbAdapter = {
    submit: async (_: unknown): Promise<unknown> => "req-pr-01918s3t1b",
    poll_status: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
    reconcile: async (_: unknown): Promise<unknown> => ({ status: "pending" }),
  };

  const piSurface = {
    spawnAgent(_opts: unknown) {
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store, featureDir, clock, logger, piSurface, statusServerFactory: createStatusServer,
    prStateSeam: fakePrStateSeam,
    prStateRepo: "backend",
    prPollIntervalMs: 60_000,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo",
      "feat-s002t1",
      "delivering",
    );

    await handle.deliverSession({
      pushAdapter,
      pushEntry: S003T1_PUSH_ENTRY,
      pushInput: { cwd: "/tmp/test", branch: "feat/s3t1b", remote: "origin" },
      pushIdempotencyKey: "push-s3t1b-001",
      createPrAdapter,
      createPrEntry: S01918S2T2_CREATE_PR_ENTRY,
      createPrInput: { head: "feat/s3t1b", base: "main", title: "S3T1B PR", body: "" },
      createPrIdempotencyKey: "create-pr-s3t1b-001",
      taskId: "task-foo",
      prNumber: 45,
    });

    // Pre-seed a review_requested inbox item using the real PR number (B4 contract).
    const reviewItem = createEscalationItem({
      source_id: "review_requested:task-foo:45",
      task_id: "task-foo",
      reason: "review_requested",
      payload_summary: "task task-foo PR ready for review",
      store,
      clock,
    });

    await handle.tick();

    const afterFirstPoll = store.get<{ status: string }>(
      "SELECT status FROM inbox_items WHERE id = ?",
      reviewItem.id,
    );
    assert.equal(afterFirstPoll?.status, "open", "first closed-unmerged poll must leave the review request open");
    clock.advance(60_000);
    await handle.tick();

    // The review_requested item must no longer be open after closed-unmerged.
    const itemRow = store.get<{ status: string }>(
      "SELECT status FROM inbox_items WHERE id = ?",
      reviewItem.id,
    );
    assert.equal(
      itemRow?.status,
      "resolved",
      "review_requested inbox item must be resolved after PR is closed unmerged",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Phase 2A escalate-all-diffs — a diff hash must be responded to before staging or delivery, and a changed hash re-escalates", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-diff-review-gate-"));
  const worktreesBase = await mkdtemp(join(tmpdir(), "krl-diff-review-gate-wt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  const logger = { info(_r: Record<string, unknown>): void {} };
  const worktreePath = join(worktreesBase, "wt-diff-review");
  let observedDiff = { hash: "diff-hash-a", summary: "src/example.ts changed" };
  const inspectionPaths: string[] = [];
  const mutations: string[] = [];

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const makeMutationAdapter = (name: string): AsyncVerbAdapter => ({
    submit: async (_input: unknown): Promise<unknown> => {
      mutations.push(name);
      return `req-${name}`;
    },
    poll_status: async (_requestId: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_requestId: unknown): Promise<unknown> => ({ status: "done" }),
  });

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: {
      spawnAgent(_opts: unknown) {
        return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
      },
    },
    statusServerFactory: createStatusServer,
    worktreeSlot: {
      worktreesBase,
      repoPath: worktreesBase,
      dispatch: async (_opts: WorktreeDispatchOpts): Promise<WorktreeDispatchResult> => ({
        worktreePath,
        branchName: "wt-diff-review",
        queued: false,
      }),
    },
    inspectWorktreeDiff: async (cwd: string): Promise<{ hash: string; summary: string }> => {
      inspectionPaths.push(cwd);
      return observedDiff;
    },
    verbAdapters: {
      "git.add": { entry: S016S1T2_GIT_ADD_ENTRY, adapter: makeMutationAdapter("git.add") },
      "git.commit": { entry: S016S1T2_GIT_COMMIT_ENTRY, adapter: makeMutationAdapter("git.commit") },
      "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: makeMutationAdapter("git.push") },
      "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: makeMutationAdapter("github.create_pr") },
    },
    commitsAhead: async (_branch: string, _base: string): Promise<number> => 1,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");

    await handle.tick();

    assert.deepEqual(
      inspectionPaths,
      [worktreePath],
      "a clean session must inspect its worktree diff before any staging or delivery",
    );
    const firstItems = store.all<{ id: string; evidence: string }>(
      "SELECT id, evidence FROM inbox_items WHERE kind = 'escalation' AND status = 'open'",
    );
    assert.equal(firstItems.length, 1, "the first unreviewed diff hash must create one open escalation");
    const firstItem = firstItems[0];
    assert.ok(firstItem !== undefined, "the diff-review escalation must be durable");
    const firstEvidence = JSON.parse(firstItem.evidence) as Record<string, unknown>;
    assert.equal(firstEvidence["reason"], "diff-review", "the escalation reason must identify diff review");
    assert.equal(firstEvidence["hash"], "diff-hash-a", "the escalation evidence must retain the reviewed diff hash");
    assert.equal(
      store.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", "task-foo")?.status,
      "parked",
      "an unreviewed diff must park the task",
    );
    assert.deepEqual(mutations, [], "no staging, commit, push, or PR creation may occur before a diff response");

    await handle.tick();
    assert.equal(
      store.all("SELECT id FROM inbox_items WHERE kind = 'escalation' AND status = 'open'").length,
      1,
      "the same unresponded diff hash must not create a duplicate open escalation",
    );

    resumeEscalationItem({
      item_id: firstItem.id,
      task_id: "task-foo",
      actor: "operator",
      store,
      clock,
    });
    await handle.tick();

    assert.deepEqual(
      mutations,
      ["git.add", "git.commit", "git.push", "github.create_pr"],
      "a durable response for the same hash may permit the existing staging and delivery path",
    );
    assert.equal(
      store.all("SELECT id FROM inbox_items WHERE kind = 'escalation' AND status = 'open'").length,
      0,
      "a response for the reviewed hash must not produce another open diff-review item",
    );

    observedDiff = { hash: "diff-hash-b", summary: "src/example.ts changed again" };
    setTaskStatus(store, "task-foo", "pending");
    await handle.tick();

    const changedItems = store.all<{ evidence: string }>(
      "SELECT evidence FROM inbox_items WHERE kind = 'escalation' AND status = 'open'",
    );
    assert.equal(changedItems.length, 1, "a changed diff hash must require a new open response");
    const changedEvidence = JSON.parse(changedItems[0]?.evidence ?? "{}") as Record<string, unknown>;
    assert.equal(changedEvidence["hash"], "diff-hash-b", "the new escalation must identify the changed hash");
    assert.equal(
      store.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", "task-foo")?.status,
      "parked",
      "a changed unreviewed diff must park the task again",
    );
    assert.deepEqual(
      mutations,
      ["git.add", "git.commit", "git.push", "github.create_pr"],
      "the changed hash must not trigger another external mutation before its response",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(worktreesBase, { recursive: true, force: true });
  }
});

test("Phase 2A remediation B1 — omitted taskBudget still gates every spawned session with a durable conservative reservation", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-phase2a-b1-default-budget-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  type ModelCallGate = () => Promise<void>;
  const capturedGates: Array<ModelCallGate | undefined> = [];
  const reservationsBeforeProvider: number[] = [];
  let providerEffects = 0;

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const piSurface = {
    spawnAgent(opts: unknown) {
      const candidate = (opts as Record<string, unknown>)["beforeModelCall"];
      const gate = typeof candidate === "function" ? candidate as ModelCallGate : undefined;
      capturedGates.push(gate);
      return {
        abort() {},
        async waitForIdle() {
          if (gate !== undefined) {
            await gate();
            reservationsBeforeProvider.push(
              Number(store.get<{ ledger: string }>("SELECT ledger FROM budget_ledger WHERE task_id = ?", "spend:task-foo")?.ledger),
            );
          }
          providerEffects++;
        },
        reset() {},
        contextTokens: 0,
      };
    },
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger: { info(_r: Record<string, unknown>): void {} },
    piSurface,
    statusServerFactory: createStatusServer,
  });

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();
    setTaskStatus(store, "task-foo", "pending");
    await handle.tick();

    assert.equal(capturedGates.length, 2, "the test must spawn two sessions for the same task");
    assert.equal(
      capturedGates.filter((gate) => gate !== undefined).length,
      2,
      "every spawned session must receive a beforeModelCall gate when taskBudget is omitted",
    );
    assert.equal(providerEffects, 2, "both provider effects must run only after their default-budget gates");
    assert.ok(
      reservationsBeforeProvider.every((reservation) => Number.isFinite(reservation) && reservation > 0),
      "the safe default must durably record a positive conservative reservation before each provider effect",
    );
    assert.ok(
      Number(store.get<{ ledger: string }>("SELECT ledger FROM budget_ledger WHERE task_id = ?", "spend:task-foo")?.ledger) > 0,
      "the default budget must leave durable spend instead of bypassing budget enforcement",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Phase 2A remediation B2 — overlapping model-call gates permit one reservation and reject the competing call", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-phase2a-b2-atomic-budget-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  type ModelCallGate = () => Promise<void>;
  let capturedGate: ModelCallGate | undefined;

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const piSurface = {
    spawnAgent(opts: unknown) {
      const candidate = (opts as Record<string, unknown>)["beforeModelCall"];
      capturedGate = typeof candidate === "function" ? candidate as ModelCallGate : undefined;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger: { info(_r: Record<string, unknown>): void {} },
    piSurface,
    statusServerFactory: createStatusServer,
    taskBudget: { ceiling: 1, conservativeCost: 1 },
  });
  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    assert.ok(capturedGate !== undefined, "the spawned session must expose a model-call gate");
    const reserveBeforeModelCall = capturedGate;
    let providerPermissions = 0;
    const attemptProviderCall = async (): Promise<void> => {
      await reserveBeforeModelCall();
      providerPermissions++;
    };
    const results = await Promise.allSettled([attemptProviderCall(), attemptProviderCall()]);

    assert.equal(
      providerPermissions,
      1,
      "two overlapping reservations at a one-call ceiling must grant exactly one provider permission",
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
      "exactly one overlapping model call must be rejected",
    );
    assert.equal(
      store.all<{ evidence: string }>("SELECT evidence FROM inbox_items").length,
      1,
      "the rejected competing call must create exactly one durable budget escalation",
    );
    assert.equal(
      (JSON.parse(store.get<{ evidence: string }>("SELECT evidence FROM inbox_items")?.evidence ?? "{}") as { reason?: string }).reason,
      "budget-breach",
      "the competing call must be rejected as a budget breach",
    );
    assert.equal(
      store.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", "task-foo")?.status,
      "parked",
      "the rejected competing call must park the task",
    );
    assert.equal(
      Number(store.get<{ ledger: string }>("SELECT ledger FROM budget_ledger WHERE task_id = ?", "spend:task-foo")?.ledger),
      1,
      "the durable total must contain exactly one conservative reservation",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

type BudgetReservationAttempt = {
  task_id: string;
  attempted_at: number;
  conservative_cost: number;
  outcome: "proceed" | "halted";
  reserved_total: number;
};

function plainBudgetReservationAttempt(attempt: BudgetReservationAttempt): BudgetReservationAttempt {
  return {
    task_id: attempt.task_id,
    attempted_at: attempt.attempted_at,
    conservative_cost: attempt.conservative_cost,
    outcome: attempt.outcome,
    reserved_total: attempt.reserved_total,
  };
}

function readBudgetReservationAttempts(store: Store): BudgetReservationAttempt[] {
  return store.all<BudgetReservationAttempt>(
    `SELECT task_id, attempted_at, conservative_cost, outcome, reserved_total
     FROM budget_reservation_attempt
     ORDER BY attempted_at, outcome`,
  ).map(plainBudgetReservationAttempt);
}

async function seedStrictBudgetEvidenceFeature(featureDir: string): Promise<void> {
  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");
}

test("LP-A1/LP-A3 strict budget evidence — schema exposes a durable per-decision reservation table", () => {
  const store = openStore(":memory:", { busyTimeout: 1000 });
  try {
    initSchema(store);
    const table = store.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'budget_reservation_attempt'",
    );
    assert.equal(table?.name, "budget_reservation_attempt", "schema must create the budget reservation attempt table");

    const columns = store.all<{ name: string }>("PRAGMA table_info(budget_reservation_attempt)");
    assert.deepEqual(
      columns.map((column) => column.name).filter((name) => [
        "task_id",
        "attempted_at",
        "conservative_cost",
        "outcome",
        "reserved_total",
      ].includes(name)).sort(),
      ["attempted_at", "conservative_cost", "outcome", "reserved_total", "task_id"],
      "each reservation attempt must retain task, injected-clock instant, cost, outcome, and resulting reserved total",
    );
  } finally {
    store.close();
  }
});

test("LP-A1/LP-A3 strict budget evidence — a ceiling-zero first call durably halts before any provider effect", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-strict-budget-halt-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_234_567_890);
  let providerEffects = 0;

  await seedStrictBudgetEvidenceFeature(featureDir);
  const piSurface = {
    spawnAgent(opts: unknown) {
      const gate = (opts as Record<string, unknown>)["beforeModelCall"];
      let stopReason: "error" | undefined;
      return {
        abort() {},
        async waitForIdle() {
          if (typeof gate !== "function") throw new Error("beforeModelCall must be supplied");
          try {
            await gate();
            providerEffects++;
          } catch {
            stopReason = "error";
          }
        },
        reset() {},
        contextTokens: 0,
        get stopReason() { return stopReason; },
      };
    },
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger: { info(_record: Record<string, unknown>): void {} },
    piSurface,
    statusServerFactory: createStatusServer,
    taskBudget: { ceiling: 0, conservativeCost: 1 },
  });

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    assert.deepEqual(readBudgetReservationAttempts(store), [{
      task_id: "task-foo",
      attempted_at: 1_234_567_890,
      conservative_cost: 1,
      outcome: "halted",
      reserved_total: 0,
    }], "the rejected first decision must be durable evidence, not an omitted ledger write");
    assert.equal(
      Number(store.get<{ total: number }>(
        "SELECT COALESCE((SELECT CAST(ledger AS REAL) FROM budget_ledger WHERE task_id = ?), 0) AS total",
        "spend:task-foo",
      )?.total),
      0,
      "a halted first decision must leave the cumulative reserved total at zero",
    );
    assert.equal(providerEffects, 0, "a halted attempt must not invoke the provider");
    assert.equal(
      (JSON.parse(store.get<{ evidence: string }>("SELECT evidence FROM inbox_items")?.evidence ?? "{}") as { reason?: string }).reason,
      "budget-breach",
      "the halted decision must create budget-breach escalation evidence",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("LP-A1/LP-A3 strict budget evidence — concurrent one-slot decisions atomically retain evidence through restart", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-strict-budget-concurrent-"));
  const dbDir = await mkdtemp(join(tmpdir(), "krl-strict-budget-db-"));
  const dbPath = join(dbDir, "budget.db");
  const clock = new FakeClock(2_000_000_000);
  const store = openStore(dbPath, { busyTimeout: 1000 });
  let storeClosed = false;
  type ModelCallGate = () => Promise<void>;
  let gate: ModelCallGate | undefined;
  let providerEffects = 0;

  await seedStrictBudgetEvidenceFeature(featureDir);
  const piSurface = {
    spawnAgent(opts: unknown) {
      const candidate = (opts as Record<string, unknown>)["beforeModelCall"];
      gate = typeof candidate === "function" ? candidate as ModelCallGate : undefined;
      return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 };
    },
  };

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger: { info(_record: Record<string, unknown>): void {} },
    piSurface,
    statusServerFactory: createStatusServer,
    taskBudget: { ceiling: 1, conservativeCost: 1 },
  });
  let handleStopped = false;

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();
    assert.ok(gate !== undefined, "the spawned session must expose its before-model-call gate");
    const beforeModelCall = gate;

    const invokeProvider = async (): Promise<void> => {
      await beforeModelCall();
      const proceed = store.get<BudgetReservationAttempt>(
        `SELECT task_id, attempted_at, conservative_cost, outcome, reserved_total
         FROM budget_reservation_attempt
         WHERE task_id = ? AND outcome = 'proceed'`,
        "task-foo",
      );
      assert.deepEqual(
        proceed === undefined ? undefined : plainBudgetReservationAttempt(proceed),
        {
          task_id: "task-foo",
          attempted_at: 2_000_000_000,
          conservative_cost: 1,
          outcome: "proceed",
          reserved_total: 1,
        },
        "provider invocation is permitted only after its committed proceed evidence exists",
      );
      assert.equal(
        Number(store.get<{ total: number }>(
          "SELECT CAST(ledger AS REAL) AS total FROM budget_ledger WHERE task_id = ?",
          "spend:task-foo",
        )?.total),
        1,
        "a proceed attempt exposes its matching cumulative ledger total before provider invocation",
      );
      providerEffects++;
    };

    const results = await Promise.allSettled([invokeProvider(), invokeProvider()]);
    assert.equal(providerEffects, 1, "only the single proceed decision may invoke the provider");
    assert.equal(results.filter((result) => result.status === "rejected").length, 1, "one concurrent one-slot decision must halt");
    assert.deepEqual(readBudgetReservationAttempts(store), [
      {
        task_id: "task-foo",
        attempted_at: 2_000_000_000,
        conservative_cost: 1,
        outcome: "halted",
        reserved_total: 1,
      },
      {
        task_id: "task-foo",
        attempted_at: 2_000_000_000,
        conservative_cost: 1,
        outcome: "proceed",
        reserved_total: 1,
      },
    ], "each competing decision must leave exactly one durable outcome with its resulting total");
    assert.equal(
      Number(store.get<{ total: number }>(
        "SELECT CAST(ledger AS REAL) AS total FROM budget_ledger WHERE task_id = ?",
        "spend:task-foo",
      )?.total),
      1,
      "the successful ledger update and its proceed evidence must expose one cumulative cost",
    );

    await handle.stop();
    handleStopped = true;
    store.close();
    storeClosed = true;

    const restartedStore = openStore(dbPath, { busyTimeout: 1000 });
    const restartedHandle = await runDaemon({
      store: restartedStore,
      featureDir,
      clock,
      logger: { info(_record: Record<string, unknown>): void {} },
      piSurface: { spawnAgent() { throw new Error("parked task must not respawn after restart"); } },
      statusServerFactory: createStatusServer,
      taskBudget: { ceiling: 1, conservativeCost: 1 },
    });
    try {
      assert.deepEqual(
        readBudgetReservationAttempts(restartedStore),
        [
          { task_id: "task-foo", attempted_at: 2_000_000_000, conservative_cost: 1, outcome: "halted", reserved_total: 1 },
          { task_id: "task-foo", attempted_at: 2_000_000_000, conservative_cost: 1, outcome: "proceed", reserved_total: 1 },
        ],
        "restart must retain every pre-call decision as durable budget evidence",
      );
      await restartedHandle.tick();
      assert.equal(providerEffects, 1, "restart must not resume spending after the halted competing decision");
    } finally {
      await restartedHandle.stop();
      restartedStore.close();
    }
  } finally {
    if (!handleStopped) await handle.stop();
    if (!storeClosed) store.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  }
});

test("reviewer budget B1 — failed reservation and failed fallback latch an absorbed session before post-session mutation", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-review-budget-b1-"));
  const baseStore = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(3_000_000_000);
  const mutations: string[] = [];
  const logRecords: Array<Record<string, unknown>> = [];
  let diffInspections = 0;
  let spawnCount = 0;
  let fallbackPersistenceFailed = false;
  let handleStopped = false;
  const faultStore: Store = {
    get: baseStore.get.bind(baseStore),
    all: baseStore.all.bind(baseStore),
    close: baseStore.close.bind(baseStore),
    run(sql: string, ...params: unknown[]): void {
      if (sql.includes("INSERT INTO budget_reservation_attempt")) {
        throw new Error("injected budget reservation transaction failure");
      }
      if (!fallbackPersistenceFailed && sql.includes("INSERT OR IGNORE INTO inbox_items")) {
        fallbackPersistenceFailed = true;
        throw new Error("injected budget fallback persistence failure");
      }
      baseStore.run(sql, ...params);
    },
  };

  await seedStrictBudgetEvidenceFeature(featureDir);
  const piSurface = {
    spawnAgent(opts: unknown) {
      spawnCount++;
      const gate = (opts as Record<string, unknown>)["beforeModelCall"];
      return {
        abort() {},
        async waitForIdle() {
          if (typeof gate !== "function") throw new Error("beforeModelCall must be supplied");
          try {
            await gate();
          } catch {
            // The provider surface may absorb a gate rejection; lifecycle safety remains durable.
          }
        },
        reset() {},
        contextTokens: 0,
      };
    },
  };
  const mutationAdapter = (verb: string): AsyncVerbAdapter => ({
    submit: async (): Promise<unknown> => {
      mutations.push(verb);
      return `request-${verb}`;
    },
    poll_status: async (): Promise<unknown> => ({ status: "done" }),
    reconcile: async (): Promise<unknown> => ({ status: "done" }),
  });
  const handle = await runDaemon({
    store: faultStore,
    featureDir,
    clock,
    logger: { info(record: Record<string, unknown>): void { logRecords.push({ ...record }); } },
    piSurface,
    statusServerFactory: createStatusServer,
    taskBudget: { ceiling: 1, conservativeCost: 1 },
    inspectWorktreeDiff: async () => {
      diffInspections++;
      return undefined;
    },
    verbAdapters: {
      "git.add": { entry: { ...makeTestEntry(), verb: "git.add" }, adapter: mutationAdapter("git.add") },
      "git.commit": { entry: { ...makeTestEntry(), verb: "git.commit" }, adapter: mutationAdapter("git.commit") },
      "git.push": { entry: { ...makeTestEntry(), verb: "git.push" }, adapter: mutationAdapter("git.push") },
      "github.create_pr": { entry: { ...makeTestEntry(), verb: "github.create_pr" }, adapter: mutationAdapter("github.create_pr") },
    },
    commitsAhead: async () => 1,
  });

  try {
    await compile(featureDir, faultStore, { repoRegistry: ["backend"] });
    loadTasks(faultStore, "feat-s002t1");
    await handle.tick();

    assert.equal(
      baseStore.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", "task-foo")?.status,
      "running",
      "when fallback persistence also fails, the durable row may remain running while the in-memory latch blocks it",
    );
    assert.equal(
      baseStore.all("SELECT id FROM inbox_items").length,
      0,
      "the injected fallback persistence failure must leave no durable fallback inbox row",
    );
    assert.ok(
      logRecords.some((record) => record["event"] === "budget-reservation-transaction-failed"),
      "the reservation transaction error must be logged",
    );
    assert.ok(
      logRecords.some((record) => record["event"] === "budget-ledger-failure-persistence-failed"),
      "the fallback persistence error must be logged",
    );
    assert.equal(diffInspections, 0, "the fatal in-memory latch must skip post-session diff inspection");
    assert.deepEqual(mutations, [], "the fatal in-memory latch must block staging and delivery mutations");

    setTaskStatus(baseStore, "task-foo", "pending");
    await handle.tick();
    assert.equal(spawnCount, 1, "a latched task must not re-dispatch on a later tick even when SQLite says pending");
    assert.deepEqual(mutations, [], "a later tick must not issue git or GitHub mutations for a latched task");
  } finally {
    if (!handleStopped) {
      await handle.stop();
      handleStopped = true;
    }
    baseStore.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("reviewer budget S1 — a one-shot transactional escalation fault rolls back the halt before durable fallback parking", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-review-budget-b2-"));
  const dbDir = await mkdtemp(join(tmpdir(), "krl-review-budget-b2-db-"));
  const dbPath = join(dbDir, "budget.db");
  const clock = new FakeClock(3_100_000_000);
  const crashingStore = openStore(dbPath, { busyTimeout: 1000 });
  let failTransactionalEscalation = true;
  let firstHandleStopped = false;
  let crashingStoreClosed = false;
  const crashAfterHaltStore: Store = {
    get: crashingStore.get.bind(crashingStore),
    all: crashingStore.all.bind(crashingStore),
    close: crashingStore.close.bind(crashingStore),
    run(sql: string, ...params: unknown[]): void {
      if (failTransactionalEscalation && sql.includes("INSERT OR IGNORE INTO inbox_items")) {
        failTransactionalEscalation = false;
        throw new Error("injected transactional budget escalation failure");
      }
      crashingStore.run(sql, ...params);
    },
  };

  await seedStrictBudgetEvidenceFeature(featureDir);
  const absorbingPiSurface = {
    spawnAgent(opts: unknown) {
      const gate = (opts as Record<string, unknown>)["beforeModelCall"];
      return {
        abort() {},
        async waitForIdle() {
          if (typeof gate !== "function") throw new Error("beforeModelCall must be supplied");
          try {
            await gate();
          } catch {
            // The provider may absorb the rejected pre-call gate.
          }
        },
        reset() {},
        contextTokens: 0,
      };
    },
  };
  const firstHandle = await runDaemon({
    store: crashAfterHaltStore,
    featureDir,
    clock,
    logger: { info(_record: Record<string, unknown>): void {} },
    piSurface: absorbingPiSurface,
    statusServerFactory: createStatusServer,
    taskBudget: { ceiling: 0, conservativeCost: 1 },
  });

  try {
    await compile(featureDir, crashAfterHaltStore, { repoRegistry: ["backend"] });
    loadTasks(crashAfterHaltStore, "feat-s002t1");
    await firstHandle.tick();
    assert.equal(
      crashingStore.all("SELECT id FROM budget_reservation_attempt").length,
      0,
      "a transactional escalation failure must roll back the halted attempt evidence",
    );
    assert.equal(
      crashingStore.all("SELECT task_id FROM budget_ledger WHERE task_id = ?", "spend:task-foo").length,
      0,
      "a transactional escalation failure must roll back the rejected reservation ledger write",
    );
    assert.equal(
      crashingStore.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", "task-foo")?.status,
      "parked",
      "the durable fallback must park the task after the transaction rolls back",
    );
    assert.equal(
      (JSON.parse(crashingStore.get<{ evidence: string }>("SELECT evidence FROM inbox_items")?.evidence ?? "{}") as { reason?: string }).reason,
      "budget-ledger-failure",
      "the durable fallback must record budget-ledger failure escalation evidence",
    );
    await firstHandle.stop();
    firstHandleStopped = true;
    crashingStore.close();
    crashingStoreClosed = true;

    const restartedStore = openStore(dbPath, { busyTimeout: 1000 });
    const restartedHandle = await runDaemon({
      store: restartedStore,
      featureDir,
      clock,
      logger: { info(_record: Record<string, unknown>): void {} },
      piSurface: { spawnAgent() { throw new Error("reconciled halted task must not respawn"); } },
      statusServerFactory: createStatusServer,
      taskBudget: { ceiling: 0, conservativeCost: 1 },
    });
    try {
      assert.equal(
        restartedStore.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", "task-foo")?.status,
        "parked",
        "restart must retain the fallback parked lifecycle after the transaction rollback",
      );
      assert.equal(
        (JSON.parse(restartedStore.get<{ evidence: string }>("SELECT evidence FROM inbox_items")?.evidence ?? "{}") as { reason?: string }).reason,
        "budget-ledger-failure",
        "restart must retain durable fallback budget-ledger failure evidence",
      );
    } finally {
      await restartedHandle.stop();
      restartedStore.close();
    }
  } finally {
    if (!firstHandleStopped) await firstHandle.stop();
    if (!crashingStoreClosed) crashingStore.close();
    await rm(featureDir, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  }
});

test("reviewer budget B3 — lifecycle stop errors are asserted instead of swallowed by test cleanup", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-review-budget-b3-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const handle = await runDaemon({
    store,
    featureDir,
    clock: new FakeClock(3_200_000_000),
    logger: { info(_record: Record<string, unknown>): void {} },
    piSurface: { spawnAgent() { throw new Error("no task must spawn"); } },
    statusServerFactory: () => ({
      async start() { return { host: "127.0.0.1", port: 0 }; },
      async stop() { throw new Error("injected lifecycle stop failure"); },
    }),
  });
  try {
    await assert.rejects(
      () => handle.stop(),
      /injected lifecycle stop failure/,
      "test lifecycle cleanup must expose a daemon stop failure",
    );
  } finally {
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("reviewer budget S1 — independent processes contend through the public reservation seam without a lost update", async () => {
  const dbDir = await mkdtemp(join(tmpdir(), "krl-review-budget-s1-"));
  const dbPath = join(dbDir, "budget.db");
  const bootstrapStore = openStore(dbPath, { busyTimeout: 5000 });
  initSchema(bootstrapStore);
  bootstrapStore.close();
  const reservationUrl = pathToFileURL(join(process.cwd(), "src/ring1/budget-reservation.ts")).href;
  const workerSource = `
    import { DatabaseSync } from "node:sqlite";
    import { reserveBudgetReservation } from ${JSON.stringify(reservationUrl)};
    const db = new DatabaseSync(process.env.BUDGET_RESERVATION_DB_PATH);
    db.exec("PRAGMA busy_timeout = 5000");
    const store = {
      get(sql, ...params) { return db.prepare(sql).get(...params); },
      run(sql, ...params) { db.prepare(sql).run(...params); },
      all(sql, ...params) { return db.prepare(sql).all(...params); },
      close() { db.close(); },
    };
    try {
      console.log(JSON.stringify(reserveBudgetReservation({
        store,
        taskId: "task-contention",
        attemptedAt: 3_300_000_000,
        conservativeCost: 1,
        ceiling: 1,
      })));
    } finally {
      store.close();
    }
  `;

  try {
    const runReservation = async (): Promise<{ outcome: "proceed" | "halted"; reservedTotal: number }> => {
      const { stdout } = await execFileAsync(
        process.execPath,
        ["--input-type=module", "--eval", workerSource],
        { env: { ...process.env, BUDGET_RESERVATION_DB_PATH: dbPath } },
      );
      return JSON.parse(stdout) as { outcome: "proceed" | "halted"; reservedTotal: number };
    };
    const outcomes = await Promise.all([runReservation(), runReservation()]);
    assert.deepEqual(
      outcomes.map((outcome) => outcome.outcome).sort(),
      ["halted", "proceed"],
      "independent SQLite processes must return exactly one proceed and one halted decision",
    );

    const checkStore = openStore(dbPath, { busyTimeout: 5000 });
    try {
      assert.deepEqual(readBudgetReservationAttempts(checkStore), [
        { task_id: "task-contention", attempted_at: 3_300_000_000, conservative_cost: 1, outcome: "halted", reserved_total: 1 },
        { task_id: "task-contention", attempted_at: 3_300_000_000, conservative_cost: 1, outcome: "proceed", reserved_total: 1 },
      ]);
      assert.equal(
        Number(checkStore.get<{ ledger: string }>("SELECT ledger FROM budget_ledger WHERE task_id = ?", "spend:task-contention")?.ledger),
        1,
        "cross-process contention must retain the one successful cumulative reservation",
      );
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(dbDir, { recursive: true, force: true });
  }
});

test("LP-A1 — absorbed budget rejection with undefined stopReason skips post-session mutation", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-lpa1-absorbed-budget-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  let providerEffects = 0;
  let beforeModelCallCalls = 0;
  let diffReviews = 0;
  let workflowGates = 0;
  const mutations: string[] = [];

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const piSurface = {
    spawnAgent(opts: unknown) {
      const beforeModelCall = (opts as Record<string, unknown>)["beforeModelCall"];
      return {
        abort() {},
        async waitForIdle() {
          if (typeof beforeModelCall !== "function") {
            throw new Error("beforeModelCall must be supplied");
          }
          while (true) {
            try {
              beforeModelCallCalls++;
              await beforeModelCall();
              providerEffects++;
            } catch {
              return;
            }
          }
        },
        reset() {},
        contextTokens: 0,
        get stopReason(): undefined { return undefined; },
      };
    },
  };

  const mutationAdapter = (verb: string): AsyncVerbAdapter => ({
    submit: async (_input: unknown): Promise<unknown> => {
      mutations.push(verb);
      return `req-${verb}`;
    },
    poll_status: async (_requestId: unknown): Promise<unknown> => ({ status: "done" }),
    reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
  });

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger: { info(_record: Record<string, unknown>): void {} },
    piSurface,
    statusServerFactory: createStatusServer,
    taskBudget: { ceiling: 15, conservativeCost: 10 },
    inspectWorktreeDiff: async (_cwd: string) => {
      diffReviews++;
      return undefined;
    },
    workflow: {
      currentPhase: () => "implementation",
      gateCheck: async (_phase: string) => {
        workflowGates++;
        return { outcome: "pass" };
      },
    },
    verbAdapters: {
      "git.add": { entry: S016S1T2_GIT_ADD_ENTRY, adapter: mutationAdapter("git.add") },
      "git.commit": { entry: S016S1T2_GIT_COMMIT_ENTRY, adapter: mutationAdapter("git.commit") },
      "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: mutationAdapter("git.push") },
      "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: mutationAdapter("github.create_pr") },
    },
    commitsAhead: async (_branch: string, _base: string): Promise<number> => 1,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    loadTasks(store, "feat-s002t1");
    await handle.tick();

    assert.equal(beforeModelCallCalls, 2, "the provider must retry model calls until the second reservation rejects");
    assert.equal(providerEffects, 1, "the breaching model call must not reach the provider");
    assert.equal(
      store.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", "task-foo")?.status,
      "parked",
      "the durable budget breach must park the task even when pi reports no stopReason",
    );
    const budgetEscalation = store.get<{ evidence: string }>("SELECT evidence FROM inbox_items");
    assert.equal(
      (JSON.parse(budgetEscalation?.evidence ?? "{}") as { reason?: string }).reason,
      "budget-breach",
      "the absorbed rejection must retain a durable budget escalation",
    );
    assert.equal(diffReviews, 0, "a durably parked task must skip diff review after waitForIdle");
    assert.equal(workflowGates, 0, "a durably parked task must skip the workflow gate after waitForIdle");
    assert.deepEqual(
      mutations,
      [],
      "a durably parked task must not stage, commit, push, or create a PR after waitForIdle",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("reviewer blocker — missing or non-running durable task status skips all post-session mutation", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-post-session-status-"));
  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  try {
    for (const durableStatus of [undefined, "pending", "delivering"] as const) {
      const store = openStore(":memory:", { busyTimeout: 1000 });
      const clock = new FakeClock(1_000_000_000);
      const statusLabel = durableStatus ?? "missing";
      const logs: Array<Record<string, unknown>> = [];
      const mutations: string[] = [];
      let diffReviews = 0;
      let workflowGates = 0;
      const mutationAdapter = (verb: string): AsyncVerbAdapter => ({
        submit: async (_input: unknown): Promise<unknown> => {
          mutations.push(verb);
          return `req-${verb}-${statusLabel}`;
        },
        poll_status: async (_requestId: unknown): Promise<unknown> => ({ status: "done" }),
        reconcile: async (_ledger: unknown): Promise<unknown> => ({ status: "done" }),
      });
      const piSurface = {
        spawnAgent(_opts: unknown) {
          return {
            abort() {},
            async waitForIdle() {
              if (durableStatus === undefined) {
                store.run("DELETE FROM scheduler_task WHERE node_id = ?", "task-foo");
              } else {
                setTaskStatus(store, "task-foo", durableStatus);
              }
            },
            reset() {},
            contextTokens: 0,
          };
        },
      };
      const handle = await runDaemon({
        store,
        featureDir,
        clock,
        logger: { info(record: Record<string, unknown>): void { logs.push(record); } },
        piSurface,
        statusServerFactory: createStatusServer,
        inspectWorktreeDiff: async (_cwd: string) => {
          diffReviews++;
          return undefined;
        },
        workflow: {
          currentPhase: () => "implementation",
          gateCheck: async (_phase: string) => {
            workflowGates++;
            return { outcome: "pass" };
          },
        },
        verbAdapters: {
          "git.add": { entry: S016S1T2_GIT_ADD_ENTRY, adapter: mutationAdapter("git.add") },
          "git.commit": { entry: S016S1T2_GIT_COMMIT_ENTRY, adapter: mutationAdapter("git.commit") },
          "git.push": { entry: S4T1DEL_PUSH_ENTRY, adapter: mutationAdapter("git.push") },
          "github.create_pr": { entry: S4T1DEL_CREATE_PR_ENTRY, adapter: mutationAdapter("github.create_pr") },
        },
        commitsAhead: async (_branch: string, _base: string): Promise<number> => 1,
      } as unknown as Parameters<typeof runDaemon>[0]);

      try {
        await compile(featureDir, store, { repoRegistry: ["backend"] });
        loadTasks(store, "feat-s002t1");
        await handle.tick();

        assert.equal(diffReviews, 0, `${statusLabel} durable status must skip diff review`);
        assert.equal(workflowGates, 0, `${statusLabel} durable status must skip workflow gating`);
        assert.deepEqual(
          mutations,
          [],
          `${statusLabel} durable status must skip staging, commit, push, and PR creation`,
        );
        assert.ok(
          logs.some((record) => record["event"] === "post-session-processing-skipped" && record["task_id"] === "task-foo"),
          `${statusLabel} durable status must emit a post-session skip log`,
        );
      } finally {
        await handle.stop();
        store.close();
      }
    }
  } finally {
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("LP-A1 merge race — first closed-unmerged observation is durably confirmed before escalation", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-lpa1-merge-race-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger: { info(_record: Record<string, unknown>): void {} },
    piSurface: { spawnAgent(_opts: unknown) { return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 }; } },
    statusServerFactory: createStatusServer,
    prStateSeam: { async getPrState(_repo: string, _prNumber: number) { return { state: "closed", merged: false }; } },
    prStateRepo: "backend",
    prPollIntervalMs: 60_000,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
      "task-foo", "feat-s002t1", "delivering",
    );
    store.run(
      `INSERT INTO external_tracking
         (id, local_kind, local_id, external_kind, external_provider, external_id,
          created_by_op_id, idempotency_key, tracking_status, next_poll_at, attempt_count, created_at, updated_at)
       VALUES (?, 'task', 'task-foo', 'pull_request', 'github', '88',
               'op-lpa1-race', 'create_pr:task-foo', 'active', ?, 0, ?, ?)`,
      "ext-lpa1-race", clock.now(), clock.now(), clock.now(),
    );

    await handle.tick();

    const first = store.get<{
      tracking_status: string;
      observed_state_json: string | null;
      next_poll_at: number;
    }>(
      "SELECT tracking_status, observed_state_json, next_poll_at FROM external_tracking WHERE id = ?",
      "ext-lpa1-race",
    );
    assert.equal(first?.tracking_status, "active", "first closed-unmerged observation must remain non-terminal");
    const firstObservation = JSON.parse(first?.observed_state_json ?? "null") as {
      state?: string;
      merged?: boolean;
    };
    assert.deepEqual(
      { state: firstObservation.state, merged: firstObservation.merged },
      { state: "closed", merged: false },
      "first closed-unmerged observation must be stored durably for confirmation",
    );
    assert.ok(first!.next_poll_at > clock.now(), "first closed-unmerged observation must schedule another poll");
    assert.equal(
      store.all("SELECT id FROM inbox_items WHERE json_extract(evidence, '$.reason') = 'pr-closed-unmerged'").length,
      0,
      "first closed-unmerged observation must not create a pr-closed-unmerged escalation",
    );

    clock.advance(60_000);
    await handle.tick();

    const second = store.get<{ tracking_status: string }>(
      "SELECT tracking_status FROM external_tracking WHERE id = ?",
      "ext-lpa1-race",
    );
    assert.equal(second?.tracking_status, "terminal", "second consecutive closed-unmerged observation may terminalize");
    assert.equal(
      store.all("SELECT id FROM inbox_items WHERE json_extract(evidence, '$.reason') = 'pr-closed-unmerged'").length,
      1,
      "second consecutive closed-unmerged observation may create one escalation",
    );
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("LP-A1 merge race — legacy terminal unobserved PR is re-polled and repaired when merged", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-lpa1-legacy-pr-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  initSchema(store);
  await compile(featureDir, store, { repoRegistry: ["backend"] });
  store.run(
    "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)",
    "task-foo", "feat-s002t1", "delivering",
  );
  store.run(
    `INSERT INTO external_tracking
       (id, local_kind, local_id, external_kind, external_provider, external_id,
        created_by_op_id, idempotency_key, tracking_status, observed_state_json,
        next_poll_at, attempt_count, created_at, updated_at)
     VALUES (?, 'task', 'task-foo', 'pull_request', 'github', '89',
             'op-lpa1-legacy', 'create_pr:task-foo', 'terminal', NULL, ?, 0, ?, ?)`,
    "ext-lpa1-legacy", clock.now(), clock.now(), clock.now(),
  );
  const reviewItem = createEscalationItem({
    source_id: "review_requested:task-foo:89",
    task_id: "task-foo",
    reason: "review_requested",
    payload_summary: "PR #89",
    store,
    clock,
  });
  const falseClosedItem = createEscalationItem({
    source_id: "task-foo:pr-closed-unmerged",
    task_id: "task-foo",
    reason: "pr-closed-unmerged",
    payload_summary: "stale close observation",
    store,
    clock,
  });
  let prStateCalls = 0;
  const handle = await runDaemon({
    store,
    featureDir,
    clock,
    logger: { info(_record: Record<string, unknown>): void {} },
    piSurface: { spawnAgent(_opts: unknown) { return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 }; } },
    statusServerFactory: createStatusServer,
    prStateSeam: {
      async getPrState(_repo: string, _prNumber: number) {
        prStateCalls++;
        return { state: "closed", merged: true };
      },
    },
    prStateRepo: "backend",
    prPollIntervalMs: 60_000,
  } as unknown as Parameters<typeof runDaemon>[0]);

  try {
    await handle.tick();

    assert.equal(prStateCalls, 1, "legacy terminal row without an observation must be re-polled");
    const tracking = store.get<{ tracking_status: string; observed_state_json: string | null }>(
      "SELECT tracking_status, observed_state_json FROM external_tracking WHERE id = ?",
      "ext-lpa1-legacy",
    );
    assert.equal(tracking?.tracking_status, "terminal", "merged recovery must terminalize the tracking row as merged");
    assert.deepEqual(
      JSON.parse(tracking?.observed_state_json ?? "null"),
      { state: "closed", merged: true },
      "merged recovery must durably record the observed GitHub state",
    );
    assert.equal(
      store.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", "task-foo")?.status,
      "complete",
      "merged recovery must complete the task",
    );
    assert.equal(store.get<{ status: string }>("SELECT status FROM inbox_items WHERE id = ?", reviewItem.id)?.status, "resolved");
    assert.equal(store.get<{ status: string }>("SELECT status FROM inbox_items WHERE id = ?", falseClosedItem.id)?.status, "resolved");
  } finally {
    await handle.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Reviewer blockers B1-B3 — terminal-effect ordering and crash recovery
// ---------------------------------------------------------------------------

function storeThatCrashesAfterPrTrackingTerminalMarker(store: Store): Store {
  let crashed = false;
  return {
    get: store.get.bind(store),
    all: store.all.bind(store),
    close: store.close.bind(store),
    run(sql: string, ...params: unknown[]): void {
      store.run(sql, ...params);
      if (
        !crashed &&
        sql.includes("UPDATE external_tracking") &&
        sql.includes("tracking_status = 'terminal'")
      ) {
        crashed = true;
        throw new Error("crash-after-pr-tracking-terminal-marker");
      }
    },
  };
}

test("Reviewer B1 — merged terminal effects survive a crash after the tracking terminal marker", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-reviewer-b1-merged-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const crashingStore = storeThatCrashesAfterPrTrackingTerminalMarker(store);
  const clock = new FakeClock(1_000_000_000);
  let crashedHandle: Awaited<ReturnType<typeof runDaemon>> | undefined;
  let restartedHandle: Awaited<ReturnType<typeof runDaemon>> | undefined;

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  try {
    crashedHandle = await runDaemon({
      store: crashingStore,
      featureDir,
      clock,
      logger: { info(_record: Record<string, unknown>): void {} },
      piSurface: { spawnAgent(_opts: unknown) { return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 }; } },
      statusServerFactory: createStatusServer,
      prStateSeam: { async getPrState(_repo: string, _prNumber: number) { return { state: "closed", merged: true }; } },
      prStateRepo: "backend",
    });
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run("INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)", "task-foo", "feat-s002t1", "delivering");
    store.run(
      `INSERT INTO external_tracking
         (id, local_kind, local_id, external_kind, external_provider, external_id,
          created_by_op_id, idempotency_key, tracking_status, next_poll_at, attempt_count, created_at, updated_at)
       VALUES (?, 'task', 'task-foo', 'pull_request', 'github', '101',
               'op-reviewer-b1-merged', 'create_pr:task-foo', 'active', ?, 0, ?, ?)`,
      "ext-reviewer-b1-merged", clock.now(), clock.now(), clock.now(),
    );
    const reviewItem = createEscalationItem({
      source_id: "review_requested:task-foo:101",
      task_id: "task-foo",
      reason: "review_requested",
      payload_summary: "PR #101",
      store,
      clock,
    });

    await assert.rejects(
      () => crashedHandle!.tick(),
      /crash-after-pr-tracking-terminal-marker/,
      "the test store must simulate a process crash after durable terminalization",
    );
    await crashedHandle.stop();
    crashedHandle = undefined;

    restartedHandle = await runDaemon({
      store,
      featureDir,
      clock,
      logger: { info(_record: Record<string, unknown>): void {} },
      piSurface: { spawnAgent(_opts: unknown) { return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 }; } },
      statusServerFactory: createStatusServer,
      prStateSeam: { async getPrState(_repo: string, _prNumber: number) { return { state: "closed", merged: true }; } },
      prStateRepo: "backend",
    });
    await restartedHandle.tick();

    assert.equal(
      store.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", "task-foo")?.status,
      "complete",
      "restart must retain or repair merged task completion after terminal-marker crash",
    );
    assert.equal(
      store.get<{ status: string }>("SELECT status FROM inbox_items WHERE id = ?", reviewItem.id)?.status,
      "resolved",
      "restart must retain or repair the merged PR review-item resolution",
    );
  } finally {
    await restartedHandle?.stop();
    await crashedHandle?.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Reviewer B1 — closed-unmerged escalation survives a crash after the tracking terminal marker", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-reviewer-b1-closed-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const crashingStore = storeThatCrashesAfterPrTrackingTerminalMarker(store);
  const clock = new FakeClock(1_000_000_000);
  let crashedHandle: Awaited<ReturnType<typeof runDaemon>> | undefined;
  let restartedHandle: Awaited<ReturnType<typeof runDaemon>> | undefined;

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  try {
    crashedHandle = await runDaemon({
      store: crashingStore,
      featureDir,
      clock,
      logger: { info(_record: Record<string, unknown>): void {} },
      piSurface: { spawnAgent(_opts: unknown) { return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 }; } },
      statusServerFactory: createStatusServer,
      prStateSeam: { async getPrState(_repo: string, _prNumber: number) { return { state: "closed", merged: false }; } },
      prStateRepo: "backend",
    });
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run("INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)", "task-foo", "feat-s002t1", "delivering");
    store.run(
      `INSERT INTO external_tracking
         (id, local_kind, local_id, external_kind, external_provider, external_id,
          created_by_op_id, idempotency_key, tracking_status, observed_state_json,
          next_poll_at, attempt_count, created_at, updated_at)
       VALUES (?, 'task', 'task-foo', 'pull_request', 'github', '102',
               'op-reviewer-b1-closed', 'create_pr:task-foo', 'active', ?, ?, 0, ?, ?)`,
      "ext-reviewer-b1-closed",
      JSON.stringify({ state: "closed", merged: false, confirmation_count: 1 }),
      clock.now(), clock.now(), clock.now(),
    );
    const reviewItem = createEscalationItem({
      source_id: "review_requested:task-foo:102",
      task_id: "task-foo",
      reason: "review_requested",
      payload_summary: "PR #102",
      store,
      clock,
    });

    await assert.rejects(() => crashedHandle!.tick(), /crash-after-pr-tracking-terminal-marker/);
    await crashedHandle.stop();
    crashedHandle = undefined;

    restartedHandle = await runDaemon({
      store,
      featureDir,
      clock,
      logger: { info(_record: Record<string, unknown>): void {} },
      piSurface: { spawnAgent(_opts: unknown) { return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 }; } },
      statusServerFactory: createStatusServer,
      prStateSeam: { async getPrState(_repo: string, _prNumber: number) { return { state: "closed", merged: false }; } },
      prStateRepo: "backend",
    });
    await restartedHandle.tick();

    assert.equal(
      store.all("SELECT id FROM inbox_items WHERE json_extract(evidence, '$.reason') = 'pr-closed-unmerged'").length,
      1,
      "restart must retain or repair exactly one closed-unmerged escalation after terminal-marker crash",
    );
    assert.equal(
      store.get<{ status: string }>("SELECT status FROM inbox_items WHERE id = ?", reviewItem.id)?.status,
      "resolved",
      "restart must retain or repair the closed PR review-item resolution",
    );
  } finally {
    await restartedHandle?.stop();
    await crashedHandle?.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});

test("Reviewer B2 — restart projects a completed create_pr and polls it without a review router", async () => {
  const featureDir = await mkdtemp(join(tmpdir(), "krl-reviewer-b2-"));
  const store = openStore(":memory:", { busyTimeout: 1000 });
  const clock = new FakeClock(1_000_000_000);
  let handle: Awaited<ReturnType<typeof runDaemon>> | undefined;

  await writeFile(join(featureDir, "epic.md"), S002_EPIC_MD, "utf8");
  await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await writeFile(join(featureDir, "001-alpha", "INDEX.md"), S002_INDEX_MD, "utf8");
  await writeFile(join(featureDir, "001-alpha", "task-foo.md"), S002_TASK_FOO_MD, "utf8");

  try {
    initSchema(store);
    await compile(featureDir, store, { repoRegistry: ["backend"] });
    store.run("INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, ?)", "task-foo", "feat-s002t1", "delivering");
    // Durable checkpoint left by a process that completed github.create_pr, then
    // crashed before it could project the PR into external_tracking.
    store.run(
      "INSERT INTO broker_in_flight (op_id, verb, request_id, idempotency_key, payload_json, status) VALUES (?, ?, ?, ?, ?, ?)",
      "op-reviewer-b2", "github.create_pr", "request-reviewer-b2", "create_pr:task-foo", "{}", "in_flight",
    );
    store.run(
      "INSERT INTO broker_completion (op_id, status, result_json, error_json, at) VALUES (?, ?, ?, NULL, ?)",
      "op-reviewer-b2", "done", JSON.stringify({ pr_number: 103, pr_url: "https://github.com/backend/pull/103" }), clock.now(),
    );
    assert.equal(store.all("SELECT id FROM external_tracking").length, 0, "crash boundary must start without a tracking projection");

    let polls = 0;
    handle = await runDaemon({
      store,
      featureDir,
      clock,
      logger: { info(_record: Record<string, unknown>): void {} },
      piSurface: { spawnAgent(_opts: unknown) { return { abort() {}, async waitForIdle() {}, reset() {}, contextTokens: 0 }; } },
      statusServerFactory: createStatusServer,
      prStateSeam: {
        async getPrState(_repo: string, prNumber: number) {
          polls++;
          assert.equal(prNumber, 103, "recovered tracking must use the completed create_pr number");
          return { state: "closed", merged: true };
        },
      },
      prStateRepo: "backend",
      // Deliberately no reviewRouter: recovery cannot be conditional on routing.
    });

    const projection = store.get<{ local_id: string; external_id: string; tracking_status: string }>(
      "SELECT local_id, external_id, tracking_status FROM external_tracking WHERE created_by_op_id = ?",
      "op-reviewer-b2",
    );
    assert.ok(projection !== undefined, "restart must upsert a durable tracking row from the create_pr completion");
    assert.deepEqual(
      {
        local_id: projection.local_id,
        external_id: projection.external_id,
        tracking_status: projection.tracking_status,
      },
      { local_id: "task-foo", external_id: "103", tracking_status: "active" },
      "restart must upsert an active durable tracking row from the create_pr completion",
    );

    await handle.tick();
    assert.equal(polls, 1, "recovered durable tracking must be polled once");
    assert.equal(
      store.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", "task-foo")?.status,
      "complete",
      "merged state from the recovered projection must complete the task",
    );
  } finally {
    await handle?.stop();
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  }
});
