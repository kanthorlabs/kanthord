import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import { createPendingOp } from "../broker/expiry.ts";
import { initSchema } from "../store/schema.ts";
import { JsonlLog } from "../foundations/jsonl.ts";
import type { VerbRegistryEntry, AsyncVerbAdapter } from "../broker/registry.ts";
import { createApprovalItem, createEscalationItem } from "./inbox.ts";
import {
  approveItem,
  denyItem,
  recoverPendingApprovals,
  ItemExpiredError,
  KindMismatchError,
  AlreadyResolvedError,
} from "./respond.ts";
import { resumeEscalationItem, haltEscalationItem } from "../rpc/inbox-respond.ts";
import { createStatusServer } from "../daemon/status-server.ts";
import { projectPendingInteractionIntents } from "../metrics/interaction-capture.ts";
import { createConnectTransport } from "@connectrpc/connect-node";
import { createClient, ConnectError, Code } from "@connectrpc/connect";
import { DaemonService } from "../generated/kanthord/v1/daemon_pb.js";

// Suite: src/inbox/respond.ts
// Story 017-002 Task T1 — Approval responses

const FAKE_ENTRY: VerbRegistryEntry = {
  verb: "github_create_pr",
  tier: "approval_required",
  timeout: 60000,
  idempotency: { window_ms: 3600000 },
  retry: { max: 3, backoff: "exponential" },
  poll_interval: 5000,
  terminal_states: ["done", "failed"],
  rate_limit: { requests_per_minute: 60 },
  observed_state_can_regress: false,
  pending_expiry_ms: 3600000,
};

const EXPIRABLE_ENTRY: VerbRegistryEntry = {
  verb: "github_create_pr",
  tier: "approval_required",
  timeout: 60000,
  idempotency: { window_ms: 3600000 },
  retry: { max: 3, backoff: "exponential" },
  poll_interval: 5000,
  terminal_states: ["done", "failed"],
  rate_limit: { requests_per_minute: 60 },
  observed_state_can_regress: false,
  pending_expiry_ms: 1000,
};

function makeFakeAdapter(submitResults: string[]): {
  adapter: AsyncVerbAdapter;
  submitCalls: () => number;
} {
  let calls = 0;
  const adapter: AsyncVerbAdapter = {
    submit: async (_payload: unknown) => {
      calls++;
      return submitResults[calls - 1] ?? `req-auto-${calls}`;
    },
    poll_status: async () => ({}),
    reconcile: async () => ({ outcome: "done" }),
  };
  return { adapter, submitCalls: () => calls };
}

class SlowJsonlLog extends JsonlLog {
  private appendCalls = 0;
  private releaseAppend!: () => void;
  private resolveFirstAppend!: () => void;
  private readonly appendGate = new Promise<void>((resolve) => {
    this.releaseAppend = resolve;
  });
  private readonly firstAppend = new Promise<void>((resolve) => {
    this.resolveFirstAppend = resolve;
  });

  async append(record: unknown): Promise<void> {
    this.appendCalls++;
    if (this.appendCalls === 1) this.resolveFirstAppend();
    await this.appendGate;
    await super.append(record);
  }

  waitForFirstAppend(): Promise<void> {
    return this.firstAppend;
  }

  release(): void {
    this.releaseAppend();
  }
}

async function expectResolvedOrTypedReplay(
  request: () => Promise<{ status: string }>,
): Promise<void> {
  try {
    const response = await request();
    assert.equal(response.status, "resolved", "an exact retry may report the prior resolved result");
  } catch (error) {
    assert.ok(error instanceof ConnectError, "a replay rejection must cross the Connect boundary");
    assert.ok(
      error.code === Code.AlreadyExists || error.code === Code.FailedPrecondition,
      `a replay rejection must be already_exists or failed_precondition, got ${error.code}`,
    );
  }
}

describe("src/inbox/respond.ts", () => {
  // ---------------------------------------------------------------------------
  // T1a — approve: durable decision recorded, op in_flight, submit exactly once
  // ---------------------------------------------------------------------------
  test("approve records a durable decision, transitions op to in_flight, and runs adapter submit exactly once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-t1a-"));
    try {
      const store = openStore(join(dir, "respond.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(1000);
        const { adapter, submitCalls } = makeFakeAdapter(["req-t1a"]);

        const opId = createPendingOp(FAKE_ENTRY, "idem-t1a", store, clock);
        const item = createApprovalItem({
          op_id: opId,
          verb: FAKE_ENTRY.verb,
          tier: FAKE_ENTRY.tier,
          desired_effect: "open PR against main",
          store,
          clock,
        });

        await approveItem({
          item_id: item.id,
          actor: "ops@test.com",
          op_id: opId,
          entry: FAKE_ENTRY,
          adapter,
          payload: { pr: "main" },
          store,
          clock,
        });

        // Durable decision recorded first (crash-safe)
        const decision = store.get<{ actor: string; action: string }>(
          "SELECT actor, action FROM approval_decisions WHERE item_id = ?",
          item.id,
        );
        assert.ok(decision !== undefined, "approval_decisions must have a row");
        assert.equal(decision.actor, "ops@test.com", "actor must be recorded");
        assert.equal(decision.action, "approve", "action must be 'approve'");

        // Op moved to in_flight in broker_in_flight
        const inFlight = store.get<{ op_id: string }>(
          "SELECT op_id FROM broker_in_flight WHERE verb = ? AND idempotency_key = ?",
          FAKE_ENTRY.verb,
          "idem-t1a",
        );
        assert.ok(inFlight !== undefined, "op must appear in broker_in_flight after approve");

        // Adapter submit called exactly once
        assert.equal(submitCalls(), 1, "adapter.submit must be called exactly once");

        // Item resolved
        const updated = store.get<{ status: string }>(
          "SELECT status FROM inbox_items WHERE id = ?",
          item.id,
        );
        assert.ok(updated !== undefined, "inbox item must still exist");
        assert.equal(updated.status, "resolved", "item must be resolved after approve");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // ---------------------------------------------------------------------------
  // T1b — crash between decision and submit: recovery fires submit exactly once
  // ---------------------------------------------------------------------------
  test("crash between durable decision and adapter submit: recoverPendingApprovals runs submit exactly once and is idempotent on second call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-t1b-"));
    try {
      const store = openStore(join(dir, "respond.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(1000);
        const { adapter, submitCalls } = makeFakeAdapter(["req-t1b"]);

        const opId = createPendingOp(FAKE_ENTRY, "idem-t1b", store, clock);
        const item = createApprovalItem({
          op_id: opId,
          verb: FAKE_ENTRY.verb,
          tier: FAKE_ENTRY.tier,
          desired_effect: "open PR against main",
          store,
          clock,
        });

        // Simulate crash: decision recorded, releasePendingOp never called.
        store.run(
          `CREATE TABLE IF NOT EXISTS approval_decisions (
            item_id TEXT PRIMARY KEY,
            op_id TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            decided_at INTEGER NOT NULL
          )`,
        );
        store.run(
          "INSERT OR IGNORE INTO approval_decisions (item_id, op_id, actor, action, decided_at) VALUES (?, ?, ?, ?, ?)",
          item.id,
          opId,
          "ops@test.com",
          "approve",
          1000,
        );

        // First recovery: processes pending decision, calls submit once.
        await recoverPendingApprovals({
          store,
          clock,
          getContext: (id: string) =>
            id === opId
              ? { entry: FAKE_ENTRY, adapter, payload: { pr: "main" } }
              : undefined,
        });

        assert.equal(submitCalls(), 1, "recovery must call adapter.submit exactly once");

        // Second recovery: item now resolved or broker_in_flight deduplicates — submit NOT called again.
        await recoverPendingApprovals({
          store,
          clock,
          getContext: (id: string) =>
            id === opId
              ? { entry: FAKE_ENTRY, adapter, payload: { pr: "main" } }
              : undefined,
        });

        assert.equal(
          submitCalls(),
          1,
          "second recovery must not call adapter.submit again (idempotency key dedup)",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // ---------------------------------------------------------------------------
  // T1c — deny: op failed(denied), adapter never runs, item resolved
  // ---------------------------------------------------------------------------
  test("deny resolves the op as failed without the adapter running", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-t1c-"));
    try {
      const store = openStore(join(dir, "respond.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(1000);
        const { adapter, submitCalls } = makeFakeAdapter(["req-t1c"]);

        const opId = createPendingOp(FAKE_ENTRY, "idem-t1c", store, clock);
        const item = createApprovalItem({
          op_id: opId,
          verb: FAKE_ENTRY.verb,
          tier: FAKE_ENTRY.tier,
          desired_effect: "open PR against main",
          store,
          clock,
        });

        await denyItem({
          item_id: item.id,
          actor: "ops@test.com",
          op_id: opId,
          store,
          clock,
        });

        // Op status must be "failed" (denied)
        const pendingRow = store.get<{ status: string }>(
          "SELECT status FROM broker_pending WHERE op_id = ?",
          opId,
        );
        assert.ok(pendingRow !== undefined, "broker_pending row must still exist");
        assert.equal(pendingRow.status, "failed", "op must be marked failed after denial");

        // Adapter never called
        assert.equal(submitCalls(), 0, "adapter.submit must never be called on denial");

        // Item resolved
        const updated = store.get<{ status: string }>(
          "SELECT status FROM inbox_items WHERE id = ?",
          item.id,
        );
        assert.ok(updated !== undefined, "inbox item must still exist");
        assert.equal(updated.status, "resolved", "item must be resolved after denial");

        // Journal row must exist (S2 regression: deny must write approval_decisions)
        interface DecisionRow {
          item_id: string;
          actor: string;
          action: string;
          decided_at: number;
        }
        const decision = store.get<DecisionRow>(
          "SELECT item_id, actor, action, decided_at FROM approval_decisions WHERE item_id = ?",
          item.id,
        );
        assert.ok(decision !== undefined, "approval_decisions row must exist after denyItem");
        assert.equal(decision.item_id, item.id, "journal item_id must match the inbox item");
        assert.equal(decision.actor, "ops@test.com", "journal actor must be recorded");
        assert.equal(decision.action, "deny", "journal action must be 'deny'");
        assert.ok(decision.decided_at > 0, "journal decided_at must be a positive timestamp");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // ---------------------------------------------------------------------------
  // T1d — expired op: ItemExpiredError, op stays expired, item auto-resolves + journaled
  // ---------------------------------------------------------------------------
  test("approving an expired op throws ItemExpiredError, auto-resolves item as expired, and journals the transition", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-t1d-"));
    try {
      const store = openStore(join(dir, "respond.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(0);
        const { adapter, submitCalls } = makeFakeAdapter(["req-t1d"]);

        const opId = createPendingOp(EXPIRABLE_ENTRY, "idem-t1d", store, clock);
        const item = createApprovalItem({
          op_id: opId,
          verb: EXPIRABLE_ENTRY.verb,
          tier: EXPIRABLE_ENTRY.tier,
          desired_effect: "open PR against main",
          store,
          clock,
        });

        // Advance past the 1000 ms expiry window
        clock.advance(1001);

        await assert.rejects(
          () =>
            approveItem({
              item_id: item.id,
              actor: "ops@test.com",
              op_id: opId,
              entry: EXPIRABLE_ENTRY,
              adapter,
              payload: {},
              store,
              clock,
            }),
          ItemExpiredError,
          "approving an expired op must throw ItemExpiredError",
        );

        // Op must stay expired
        const pendingRow = store.get<{ status: string }>(
          "SELECT status FROM broker_pending WHERE op_id = ?",
          opId,
        );
        assert.ok(pendingRow !== undefined, "broker_pending row must still exist");
        assert.equal(pendingRow.status, "expired", "op must stay expired");

        // Adapter never called
        assert.equal(submitCalls(), 0, "adapter.submit must never be called for an expired op");

        // Item auto-resolves
        const updated = store.get<{ status: string }>(
          "SELECT status FROM inbox_items WHERE id = ?",
          item.id,
        );
        assert.ok(updated !== undefined, "inbox item must still exist");
        assert.equal(updated.status, "resolved", "item must auto-resolve after expiry");

        // Transition journaled in approval_decisions
        const journal = store.get<{ action: string }>(
          "SELECT action FROM approval_decisions WHERE item_id = ?",
          item.id,
        );
        assert.ok(journal !== undefined, "expired transition must be journaled in approval_decisions");
        assert.ok(
          journal.action.includes("expir"),
          `journal action must indicate expiry, got: ${journal.action}`,
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // ---------------------------------------------------------------------------
  // T1e — journal with actor; double-respond → AlreadyResolvedError
  // ---------------------------------------------------------------------------
  test("response is journaled with actor and timestamp; double-respond throws AlreadyResolvedError", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-t1e-"));
    try {
      const store = openStore(join(dir, "respond.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(1000);
        const { adapter } = makeFakeAdapter(["req-t1e"]);

        const opId = createPendingOp(FAKE_ENTRY, "idem-t1e", store, clock);
        const item = createApprovalItem({
          op_id: opId,
          verb: FAKE_ENTRY.verb,
          tier: FAKE_ENTRY.tier,
          desired_effect: "open PR against main",
          store,
          clock,
        });

        await approveItem({
          item_id: item.id,
          actor: "ops@test.com",
          op_id: opId,
          entry: FAKE_ENTRY,
          adapter,
          payload: {},
          store,
          clock,
        });

        // Journal entry with actor and timestamp
        const journal = store.get<{ actor: string; decided_at: number }>(
          "SELECT actor, decided_at FROM approval_decisions WHERE item_id = ?",
          item.id,
        );
        assert.ok(journal !== undefined, "approval_decisions must have a journal entry");
        assert.equal(journal.actor, "ops@test.com", "actor must be journaled");
        assert.ok(
          typeof journal.decided_at === "number" && journal.decided_at > 0,
          "decided_at must be a positive number",
        );

        // Double-respond must throw AlreadyResolvedError
        await assert.rejects(
          () =>
            approveItem({
              item_id: item.id,
              actor: "ops@test.com",
              op_id: opId,
              entry: FAKE_ENTRY,
              adapter,
              payload: {},
              store,
              clock,
            }),
          AlreadyResolvedError,
          "double-respond must throw AlreadyResolvedError",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // ---------------------------------------------------------------------------
  // T1f — kind mismatch: approving an escalation item throws KindMismatchError
  // ---------------------------------------------------------------------------
  test("approving an escalation item throws KindMismatchError", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-t1f-"));
    try {
      const store = openStore(join(dir, "respond.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(1000);
        const { adapter } = makeFakeAdapter([]);

        // Create an escalation item (kind = "escalation", not "approval")
        const escalationItem = createEscalationItem({
          source_id: "evt-t1f-001",
          task_id: "task-t1f",
          reason: "out-of-scope-write",
          payload_summary: "attempted write to forbidden file",
          store,
          clock,
        });

        // Attempting to approve an escalation item must be rejected
        await assert.rejects(
          () =>
            approveItem({
              item_id: escalationItem.id,
              actor: "ops@test.com",
              op_id: "fake-op-id",
              entry: FAKE_ENTRY,
              adapter,
              payload: {},
              store,
              clock,
            }),
          KindMismatchError,
          "approving an escalation item must throw KindMismatchError",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Story 017-002 Task T2 — Escalation responses + RPC round-trip
// ---------------------------------------------------------------------------

/** Insert a scheduler_task row for resume/halt assertions. */
function insertSchedulerTask(
  store: import("../foundations/sqlite-store.ts").Store,
  taskId: string,
  featureId: string,
  opts: { status?: string; blocked_on?: string } = {},
): void {
  store.run(
    `CREATE TABLE IF NOT EXISTS scheduler_task (
      node_id          TEXT NOT NULL PRIMARY KEY,
      feature_id       TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending',
      exit_gate_passed INTEGER NOT NULL DEFAULT 0,
      blocked_on       TEXT
    )`,
  );
  store.run(
    `INSERT OR REPLACE INTO scheduler_task (node_id, feature_id, status, blocked_on)
     VALUES (?, ?, ?, ?)`,
    taskId,
    featureId,
    opts.status ?? "running",
    opts.blocked_on ?? null,
  );
}

describe("src/rpc/inbox-respond.ts", () => {
  // -------------------------------------------------------------------------
  // T2a — resume re-dispatches the parked task (scheduler row back to pending)
  // -------------------------------------------------------------------------
  test("resume re-dispatches the parked task: scheduler task becomes pending with blocked_on cleared", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-t2a-"));
    try {
      const store = openStore(join(dir, "t2a.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(5000);
        const taskId = "task-t2a";

        // Park a scheduler task (simulates a task blocked on an escalation)
        insertSchedulerTask(store, taskId, "feat-t2a", {
          status: "running",
          blocked_on: "esc-op-t2a",
        });

        // Create the escalation item (kind = "escalation")
        const item = createEscalationItem({
          source_id: "evt-t2a-001",
          task_id: taskId,
          reason: "out-of-scope-write",
          payload_summary: "wrote to forbidden path",
          store,
          clock,
        });

        // Resume response → task re-dispatched
        resumeEscalationItem({ item_id: item.id, task_id: taskId, actor: "ops@test.com", store, clock });

        // Scheduler row must be pending with no blocked_on (re-dispatchable)
        const row = store.get<{ status: string; blocked_on: string | null }>(
          "SELECT status, blocked_on FROM scheduler_task WHERE node_id = ?",
          taskId,
        );
        assert.ok(row !== undefined, "scheduler_task row must exist");
        assert.equal(row.status, "pending", "task must be re-dispatchable (status = pending) after resume");
        assert.equal(row.blocked_on, null, "blocked_on must be cleared after resume");

        // Inbox item must be resolved
        const updated = store.get<{ status: string }>(
          "SELECT status FROM inbox_items WHERE id = ?",
          item.id,
        );
        assert.ok(updated !== undefined, "inbox item must exist");
        assert.equal(updated.status, "resolved", "item must be resolved after resume");

        // Journal must record actor and timestamp
        const journal = store.get<{ actor: string; responded_at: number }>(
          "SELECT actor, responded_at FROM escalation_responses WHERE item_id = ?",
          item.id,
        );
        assert.ok(journal !== undefined, "escalation_responses must have a journal entry");
        assert.equal(journal.actor, "ops@test.com", "actor must be journaled");
        assert.ok(journal.responded_at > 0, "responded_at must be a positive timestamp");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2b — halt marks the task halted; not re-dispatched
  // -------------------------------------------------------------------------
  test("halt marks the task halted and does not re-dispatch it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-t2b-"));
    try {
      const store = openStore(join(dir, "t2b.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(6000);
        const taskId = "task-t2b";

        insertSchedulerTask(store, taskId, "feat-t2b", {
          status: "running",
          blocked_on: "esc-op-t2b",
        });

        const item = createEscalationItem({
          source_id: "evt-t2b-001",
          task_id: taskId,
          reason: "budget-breach",
          payload_summary: "exceeded cost ceiling",
          store,
          clock,
        });

        // Halt response → task halted, not re-dispatched
        haltEscalationItem({ item_id: item.id, task_id: taskId, actor: "ops@test.com", store, clock });

        // Scheduler row must be 'halted'
        const row = store.get<{ status: string }>(
          "SELECT status FROM scheduler_task WHERE node_id = ?",
          taskId,
        );
        assert.ok(row !== undefined, "scheduler_task row must exist");
        assert.equal(row.status, "halted", "task must be halted after halt response");

        // Inbox item must be resolved
        const updated = store.get<{ status: string }>(
          "SELECT status FROM inbox_items WHERE id = ?",
          item.id,
        );
        assert.ok(updated !== undefined, "inbox item must exist");
        assert.equal(updated.status, "resolved", "item must be resolved after halt");

        // Journal must record actor and timestamp
        const journal = store.get<{ actor: string; action: string }>(
          "SELECT actor, action FROM escalation_responses WHERE item_id = ?",
          item.id,
        );
        assert.ok(journal !== undefined, "escalation_responses must have a journal entry");
        assert.equal(journal.actor, "ops@test.com", "actor must be journaled");
        assert.equal(journal.action, "halt", "action must be 'halt'");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2c — full list→respond round-trip over a real loopback HTTP socket
  // -------------------------------------------------------------------------
  test("respondToEscalation RPC: full list-then-respond round-trip resolves the item over a loopback socket", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-t2c-"));
    try {
      const store = openStore(join(dir, "t2c.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(7000);
        const taskId = "task-t2c";

        insertSchedulerTask(store, taskId, "feat-t2c", {
          status: "running",
          blocked_on: "esc-op-t2c",
        });

        const item = createEscalationItem({
          source_id: "evt-t2c-001",
          task_id: taskId,
          reason: "out-of-scope-write",
          payload_summary: "HTTP round-trip test item",
          store,
          clock,
        });

        // Start the status server (loopback bind — default)
        const srv = createStatusServer({
          store,
          interactionLog: new JsonlLog(join(dir, "t2c-interactions.jsonl")),
        });
        const { host, port } = await srv.start();
        try {
          const transport = createConnectTransport({
            baseUrl: `http://${host}:${port}`,
            httpVersion: "1.1",
          });
          const client = createClient(DaemonService, transport);

          // Step 1: list items — must include the open escalation item
          const listResp = await client.listInboxItems({});
          assert.ok(Array.isArray(listResp.items), "listInboxItems must return an items array");
          assert.equal(listResp.items.length, 1, "one open item must appear in the list");
          const listedItem = listResp.items[0];
          assert.ok(listedItem !== undefined, "listed item must be defined");
          assert.equal(listedItem.id, item.id, "listed item id must match the created item");
          assert.equal(listedItem.kind, "escalation", "listed item kind must be escalation");

          // Step 2: respond (resume) — must succeed with status "resolved"
          const respondResp = await client.respondToEscalation({
            id: item.id,
            response: "resume",
            confirmedCategory: "correction",
          });
          assert.equal(
            respondResp.status,
            "resolved",
            "respondToEscalation must return status = 'resolved'",
          );

          // Step 3: list again — resolved item must no longer appear
          const listResp2 = await client.listInboxItems({});
          assert.equal(
            listResp2.items.length,
            0,
            "resolved item must not appear in a subsequent list",
          );
        } finally {
          await srv.stop();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2d — control method refuses on a non-loopback bind
  // -------------------------------------------------------------------------
  test("control method refuses with a connect error when server is configured on a non-loopback bind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-t2d-"));
    try {
      const store = openStore(join(dir, "t2d.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(8000);

        const item = createEscalationItem({
          source_id: "evt-t2d-001",
          task_id: "task-t2d",
          reason: "out-of-scope-write",
          payload_summary: "non-loopback guard test",
          store,
          clock,
        });

        // Server configured on a non-loopback bind — control methods must refuse
        const srv = createStatusServer({ store, bind: "0.0.0.0" });
        const { host, port } = await srv.start();
        try {
          const transport = createConnectTransport({
            baseUrl: `http://${host}:${port}`,
            httpVersion: "1.1",
          });
          const client = createClient(DaemonService, transport);

          await assert.rejects(
            () => client.respondToEscalation({ id: item.id, response: "resume" }),
            ConnectError,
            "respondToEscalation must reject with ConnectError on a non-loopback bind",
          );
        } finally {
          await srv.stop();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // B2 regression — respondToEscalation on an approval item must be a typed
  // ConnectError at the RPC boundary (kind-incompatible).
  // EPIC gate line: "resume/halt only on escalation items; a mismatched action
  // is a typed error (debate finding)" — enforced at the RPC boundary.
  //
  // Sensitivity note: scheduler_task table is created so the handler's UPDATE
  // call does not fail on "no such table" — without a kind check the handler
  // would return { status: "resolved" } and assert.rejects would fail.
  // -------------------------------------------------------------------------
  test("respondToEscalation on an approval item returns a typed ConnectError (kind-incompatible)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-b2-"));
    try {
      const store = openStore(join(dir, "b2.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(9000);
        const opId = createPendingOp(FAKE_ENTRY, "idem-b2", store, clock);
        const item = createApprovalItem({
          op_id: opId,
          verb: FAKE_ENTRY.verb,
          tier: FAKE_ENTRY.tier,
          desired_effect: "kind-mismatch regression",
          store,
          clock,
        });

        // Ensure scheduler_task table exists so the handler's UPDATE is a no-op
        // (not a "no such table" error) — forces sensitivity to the kind check.
        insertSchedulerTask(store, "dummy-b2", "feat-b2", { status: "pending" });

        const srv = createStatusServer({ store });
        const { host, port } = await srv.start();
        try {
          const transport = createConnectTransport({
            baseUrl: `http://${host}:${port}`,
            httpVersion: "1.1",
          });
          const client = createClient(DaemonService, transport);

          await assert.rejects(
            () => client.respondToEscalation({ id: item.id, response: "resume" }),
            ConnectError,
            "respondToEscalation on an approval item must reject with ConnectError",
          );
        } finally {
          await srv.stop();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // B1 regression — RespondToApproval not wired in status-server.ts.
  // EPIC gate lines 83-85: "full list/respond round-trip ... over a real
  // loopback HTTP socket" — approval path.
  // EPIC gate lines 65-67: "approve/deny valid only on approval items;
  // a mismatched action is a typed error" at the RPC boundary.
  // -------------------------------------------------------------------------

  test("respondToApproval RPC: approve resolves the item and returns status='resolved' over loopback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-b1a-"));
    try {
      const store = openStore(join(dir, "b1a.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        // Use Date.now() so pending_at is in the real epoch — the server's real
        // clock must not see the op as expired (FakeClock(10000) would set
        // pending_at=10000ms, which is far past the 3600s expiry window).
        const clock = new FakeClock(Date.now());
        const { adapter } = makeFakeAdapter(["req-b1a"]);
        const opId = createPendingOp(FAKE_ENTRY, "idem-b1a", store, clock);
        const item = createApprovalItem({
          op_id: opId,
          verb: FAKE_ENTRY.verb,
          tier: FAKE_ENTRY.tier,
          desired_effect: "B1 regression approve test",
          store,
          clock,
        });

        // Pass getApprovalContext via a variable (not a direct literal) to avoid
        // excess-property TS error — SE must add this opt + wire the handler.
        const srvOpts = {
          store,
          interactionLog: new JsonlLog(join(dir, "b1a-interactions.jsonl")),
          getApprovalContext: (_opId: string) => ({
            entry: FAKE_ENTRY,
            adapter,
            payload: {} as unknown,
          }),
        };
        const srv = createStatusServer(srvOpts);
        const { host, port } = await srv.start();
        try {
          const transport = createConnectTransport({
            baseUrl: `http://${host}:${port}`,
            httpVersion: "1.1",
          });
          const client = createClient(DaemonService, transport);

          const resp = await client.respondToApproval({
            id: item.id,
            approve: true,
            reason: "",
            confirmedCategory: "approval",
          });
          assert.equal(resp.status, "resolved", "respondToApproval must return status='resolved'");

          // Op must be dispatched (in broker_in_flight)
          const inFlight = store.get<{ op_id: string }>(
            "SELECT op_id FROM broker_in_flight WHERE verb = ? AND idempotency_key = ?",
            FAKE_ENTRY.verb,
            "idem-b1a",
          );
          assert.ok(inFlight !== undefined, "op must appear in broker_in_flight after approve");

          // Resolved item must no longer appear in the list
          const listResp = await client.listInboxItems({});
          assert.equal(listResp.items.length, 0, "resolved approval item must not appear in list");
        } finally {
          await srv.stop();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("respondToApproval is refused with permission_denied on a non-loopback bind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-b1b-"));
    try {
      const store = openStore(join(dir, "b1b.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(11000);
        const opId = createPendingOp(FAKE_ENTRY, "idem-b1b", store, clock);
        const item = createApprovalItem({
          op_id: opId,
          verb: FAKE_ENTRY.verb,
          tier: FAKE_ENTRY.tier,
          desired_effect: "B1 non-loopback guard test",
          store,
          clock,
        });

        const srv = createStatusServer({ store, bind: "0.0.0.0" });
        const { port } = await srv.start();
        try {
          // Connect via 127.0.0.1 (allowed by no-network-guard) so the server
          // receives the request — the handler checks its own bind address
          // ("0.0.0.0" ≠ loopback) and throws Code.PermissionDenied.
          const transport = createConnectTransport({
            baseUrl: `http://127.0.0.1:${port}`,
            httpVersion: "1.1",
          });
          const client = createClient(DaemonService, transport);

          await assert.rejects(
            () => client.respondToApproval({ id: item.id, approve: true, reason: "" }),
            (err: unknown) => {
              assert.ok(err instanceof ConnectError, "must be ConnectError");
              assert.equal(err.code, Code.PermissionDenied, "must be permission_denied (not unimplemented)");
              return true;
            },
          );
        } finally {
          await srv.stop();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("respondToApproval on an escalation item returns a typed ConnectError (kind-incompatible)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-b1c-"));
    try {
      const store = openStore(join(dir, "b1c.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(12000);

        // Escalation item — calling respondToApproval on it must be a typed error.
        const item = createEscalationItem({
          source_id: "evt-b1c-001",
          task_id: "task-b1c",
          reason: "out-of-scope-write",
          payload_summary: "B1 kind-mismatch regression",
          store,
          clock,
        });

        const srv = createStatusServer({ store });
        const { host, port } = await srv.start();
        try {
          const transport = createConnectTransport({
            baseUrl: `http://${host}:${port}`,
            httpVersion: "1.1",
          });
          const client = createClient(DaemonService, transport);

          await assert.rejects(
            () => client.respondToApproval({ id: item.id, approve: true, reason: "" }),
            (err: unknown) => {
              assert.ok(err instanceof ConnectError, "must be ConnectError");
              assert.ok(
                err.code !== Code.Unimplemented,
                "must be a kind-mismatch error, not unimplemented",
              );
              return true;
            },
          );
        } finally {
          await srv.stop();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("respondToEscalation captures one budget-breach override interaction with cumulative durable ledger cost over loopback HTTP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-ic-http-"));
    try {
      const store = openStore(join(dir, "interaction.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const taskId = "task-ic-http";
        const featureId = "feature-ic-http";
        insertSchedulerTask(store, taskId, featureId, {
          status: "running",
          blocked_on: "budget-op-ic-http",
        });
        store.run(
          "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
          taskId,
          JSON.stringify([
            { kind: "reservation", reservationId: "reserve-1", conservativeCharge: 10 },
            { kind: "reservation", reservationId: "reserve-2", conservativeCharge: 5 },
            { kind: "reconcile", reservationId: "reserve-1", finalActual: 7.25 },
          ]),
        );
        const item = createEscalationItem({
          source_id: "evt-ic-http-001",
          task_id: taskId,
          reason: "budget-breach",
          payload_summary: "durable budget ledger was exceeded",
          store,
          clock: new FakeClock(Date.now()),
        });
        const log = new JsonlLog(join(dir, "interactions.jsonl"));
        const srvOpts = { store, interactionLog: log };
        const srv = createStatusServer(srvOpts);
        const { host, port } = await srv.start();
        try {
          const transport = createConnectTransport({
            baseUrl: `http://${host}:${port}`,
            httpVersion: "1.1",
          });
          const client = createClient(DaemonService, transport);

          const response = await client.respondToEscalation({
            id: item.id,
            response: "halt",
            confirmedCategory: "rework",
          });
          assert.equal(response.status, "resolved");

          const events = await log.readAll();
          assert.equal(events.length, 1, "one successful response must append exactly one interaction event");
          const event = events[0] as Record<string, unknown>;
          assert.equal(event["item_id"], item.id);
          assert.equal(event["task_id"], taskId);
          assert.equal(event["feature_id"], featureId);
          assert.equal(event["proposed_type"], "correction");
          assert.equal(event["confirmed_category"], "rework");
          assert.equal(event["classification_mode"], "override");
          assert.equal(event["actor"], "operator");
          assert.ok(typeof event["timestamp"] === "number" && event["timestamp"] > 0);
          assert.equal(event["cost_to_date"], 12.25);
          assert.equal(event["no_ledger"], false);
        } finally {
          await srv.stop();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("respondToEscalation rejects a missing confirmed category as invalid_argument over loopback HTTP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-ic-category-"));
    try {
      const store = openStore(join(dir, "category.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const taskId = "task-ic-category";
        insertSchedulerTask(store, taskId, "feature-ic-category", {
          status: "running",
          blocked_on: "budget-op-ic-category",
        });
        const item = createEscalationItem({
          source_id: "evt-ic-category-001",
          task_id: taskId,
          reason: "budget-breach",
          payload_summary: "missing category must not resolve this item",
          store,
          clock: new FakeClock(Date.now()),
        });
        const log = new JsonlLog(join(dir, "interactions.jsonl"));
        const srvOpts = { store, interactionLog: log };
        const srv = createStatusServer(srvOpts);
        const { host, port } = await srv.start();
        try {
          const transport = createConnectTransport({
            baseUrl: `http://${host}:${port}`,
            httpVersion: "1.1",
          });
          const client = createClient(DaemonService, transport);

          await assert.rejects(
            () =>
              client.respondToEscalation({
                id: item.id,
                response: "halt",
                confirmedCategory: "",
              }),
            (err: unknown) => {
              assert.ok(err instanceof ConnectError, "missing category must be surfaced as ConnectError");
              assert.equal(err.code, Code.InvalidArgument, "missing category must be invalid_argument");
              assert.match(err.message, /confirmed_category/i);
              return true;
            },
          );
          assert.equal((await log.readAll()).length, 0, "a rejected response must not append an interaction event");
        } finally {
          await srv.stop();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("respondToEscalation rejects every non-exact resume or halt response before recording any effect over loopback HTTP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-escalation-action-"));
    try {
      const store = openStore(join(dir, "action.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const log = new JsonlLog(join(dir, "interactions.jsonl"));
        const srv = createStatusServer({ store, interactionLog: log });
        const { host, port } = await srv.start();
        try {
          const transport = createConnectTransport({
            baseUrl: `http://${host}:${port}`,
            httpVersion: "1.1",
          });
          const client = createClient(DaemonService, transport);

          for (const response of ["resume ", "halt ", "RESUME", "continue"]) {
            const taskId = `task-escalation-action-${response}`;
            insertSchedulerTask(store, taskId, "feature-escalation-action", {
              status: "running",
              blocked_on: "blocked-escalation-action",
            });
            const item = createEscalationItem({
              source_id: `evt-escalation-action-${response}`,
              task_id: taskId,
              reason: "budget-breach",
              payload_summary: "invalid response must not change durable state",
              store,
              clock: new FakeClock(Date.now()),
            });

            await assert.rejects(
              () => client.respondToEscalation({ id: item.id, response, confirmedCategory: "correction" }),
              (err: unknown) => {
                assert.ok(err instanceof ConnectError, "invalid response must cross the Connect boundary");
                assert.equal(err.code, Code.InvalidArgument, "invalid response must be invalid_argument");
                return true;
              },
            );

            const task = store.get<{ status: string; blocked_on: string | null }>(
              "SELECT status, blocked_on FROM scheduler_task WHERE node_id = ?",
              taskId,
            );
            assert.ok(task !== undefined, "the scheduler task must still exist");
            assert.equal(task.status, "running", `invalid response ${JSON.stringify(response)} must not mutate the task status`);
            assert.equal(task.blocked_on, "blocked-escalation-action", `invalid response ${JSON.stringify(response)} must not clear the task block`);
            assert.equal(
              store.get<{ count: number }>(
                "SELECT COUNT(*) AS count FROM interaction_outbox WHERE item_id = ?",
                item.id,
              )?.count,
              0,
              `invalid response ${JSON.stringify(response)} must not persist an interaction intent`,
            );
            assert.equal(
              store.get<{ count: number }>(
                "SELECT COUNT(*) AS count FROM escalation_responses WHERE item_id = ?",
                item.id,
              )?.count,
              0,
              `invalid response ${JSON.stringify(response)} must not journal a response`,
            );
            assert.equal(
              store.get<{ status: string }>("SELECT status FROM inbox_items WHERE id = ?", item.id)?.status,
              "open",
              `invalid response ${JSON.stringify(response)} must not resolve the inbox item`,
            );
          }

          assert.equal((await log.readAll()).length, 0, "invalid responses must not append interaction events");
        } finally {
          await srv.stop();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("respondToEscalation persists a keyed intent before resolution and startup reconciles a failed or interrupted JSONL projection exactly once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-interaction-outbox-escalation-"));
    try {
      const store = openStore(join(dir, "interaction-outbox.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const taskId = "task-interaction-outbox-escalation";
        insertSchedulerTask(store, taskId, "feature-interaction-outbox-escalation", {
          status: "running",
          blocked_on: "blocked-interaction-outbox",
        });
        const item = createEscalationItem({
          source_id: "evt-interaction-outbox-escalation",
          task_id: taskId,
          reason: "budget-breach",
          payload_summary: "capture must survive an unavailable journal",
          store,
          clock: new FakeClock(Date.now()),
        });
        store.run(
          `CREATE TRIGGER require_interaction_intent_before_resolution
           BEFORE UPDATE OF status ON inbox_items
           WHEN NEW.id = '${item.id}' AND NEW.status = 'resolved'
             AND NOT EXISTS (
               SELECT 1 FROM interaction_outbox WHERE item_id = NEW.id
             )
           BEGIN
             SELECT RAISE(ABORT, 'interaction intent missing before resolution');
           END`,
        );

        const failedLogPath = join(dir, "failed-interactions.jsonl");
        await mkdir(failedLogPath);
        const failedServer = createStatusServer({
          store,
          interactionLog: new JsonlLog(failedLogPath),
        });
        const { host, port } = await failedServer.start();
        try {
          const client = createClient(
            DaemonService,
            createConnectTransport({ baseUrl: `http://${host}:${port}`, httpVersion: "1.1" }),
          );
          await client.respondToEscalation({
            id: item.id,
            response: "halt",
            confirmedCategory: "correction",
          }).catch(() => undefined);
        } finally {
          await failedServer.stop();
        }

        const resolved = store.get<{ status: string }>(
          "SELECT status FROM inbox_items WHERE id = ?",
          item.id,
        );
        assert.equal(resolved?.status, "resolved", "a journal failure must not roll back the response");
        const intent = store.get<{ item_id: string; projected_at: number | null }>(
          "SELECT item_id, projected_at FROM interaction_outbox WHERE item_id = ?",
          item.id,
        );
        assert.equal(intent?.item_id, item.id, "the durable interaction intent is keyed by inbox item id");
        assert.equal(intent?.projected_at, null, "a failed append remains pending for reconciliation");

        const log = new JsonlLog(join(dir, "interactions.jsonl"));
        const reconcileOnce = createStatusServer({ store, interactionLog: log });
        await reconcileOnce.start();
        await reconcileOnce.stop();
        assert.equal(
          (await log.readAll()).filter((event) => (event as { item_id?: string }).item_id === item.id).length,
          1,
          "startup reconciliation must project one pending interaction",
        );

        store.run("UPDATE interaction_outbox SET projected_at = NULL WHERE item_id = ?", item.id);
        const reconcileAfterMarkingCrash = createStatusServer({ store, interactionLog: log });
        await reconcileAfterMarkingCrash.start();
        await reconcileAfterMarkingCrash.stop();
        assert.equal(
          (await log.readAll()).filter((event) => (event as { item_id?: string }).item_id === item.id).length,
          1,
          "reconciliation must recognize an already-appended item id rather than duplicate it",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("respondToApproval persists interaction intent before its external action and retries do not submit twice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-interaction-outbox-approval-"));
    try {
      const store = openStore(join(dir, "interaction-outbox.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(Date.now());
        const opId = createPendingOp(FAKE_ENTRY, "idem-interaction-outbox-approval", store, clock);
        const item = createApprovalItem({
          op_id: opId,
          verb: FAKE_ENTRY.verb,
          tier: FAKE_ENTRY.tier,
          desired_effect: "perform exactly one external effect",
          store,
          clock,
        });
        let submitCalls = 0;
        const adapter: AsyncVerbAdapter = {
          submit: async () => {
            submitCalls++;
            const intent = store.get<{ item_id: string }>(
              "SELECT item_id FROM interaction_outbox WHERE item_id = ?",
              item.id,
            );
            assert.equal(intent?.item_id, item.id, "intent must be durable before adapter.submit");
            return "request-interaction-outbox-approval";
          },
          poll_status: async () => ({}),
          reconcile: async () => ({ outcome: "done" }),
        };
        const failedLogPath = join(dir, "failed-interactions.jsonl");
        await mkdir(failedLogPath);
        const failedServer = createStatusServer({
          store,
          interactionLog: new JsonlLog(failedLogPath),
          getApprovalContext: () => ({ entry: FAKE_ENTRY, adapter, payload: {} }),
        });
        const { host, port } = await failedServer.start();
        try {
          const client = createClient(
            DaemonService,
            createConnectTransport({ baseUrl: `http://${host}:${port}`, httpVersion: "1.1" }),
          );
          await client.respondToApproval({
            id: item.id,
            approve: true,
            confirmedCategory: "approval",
          }).catch(() => undefined);
        } finally {
          await failedServer.stop();
        }

        assert.equal(submitCalls, 1, "the response may dispatch its external effect once");
        assert.equal(
          store.get<{ status: string }>("SELECT status FROM inbox_items WHERE id = ?", item.id)?.status,
          "resolved",
          "a failed JSONL append leaves the approval response resolved",
        );

        const log = new JsonlLog(join(dir, "interactions.jsonl"));
        const retryServer = createStatusServer({
          store,
          interactionLog: log,
          getApprovalContext: () => ({ entry: FAKE_ENTRY, adapter, payload: {} }),
        });
        const retryAddress = await retryServer.start();
        try {
          const client = createClient(
            DaemonService,
            createConnectTransport({
              baseUrl: `http://${retryAddress.host}:${retryAddress.port}`,
              httpVersion: "1.1",
            }),
          );
          await client.respondToApproval({
            id: item.id,
            approve: true,
            confirmedCategory: "approval",
          }).catch(() => undefined);
        } finally {
          await retryServer.stop();
        }
        assert.equal(submitCalls, 1, "retrying a resolved approval must not submit the adapter again");
        assert.equal(
          (await log.readAll()).filter((event) => (event as { item_id?: string }).item_id === item.id).length,
          1,
          "approval retry and startup reconciliation must retain exactly one interaction event",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("control RPCs without interaction capture reject missing and invalid categories before mutating inbox items", async () => {
    for (const endpoint of ["escalation", "approval"] as const) {
      for (const confirmedCategory of ["", "not-a-category"]) {
        const dir = await mkdtemp(join(tmpdir(), `respond-b4-${endpoint}-`));
        try {
          const store = openStore(join(dir, "b4.db"), { busyTimeout: 1000 });
          initSchema(store);
          try {
            const clock = new FakeClock(Date.now());
            const taskId = `task-b4-${endpoint}`;
            let itemId: string;
            let opId: string | undefined;

            if (endpoint === "escalation") {
              insertSchedulerTask(store, taskId, "feature-b4", {
                status: "running",
                blocked_on: "b4-escalation",
              });
              itemId = createEscalationItem({
                source_id: `evt-b4-${confirmedCategory || "missing"}`,
                task_id: taskId,
                reason: "budget-breach",
                payload_summary: "category validation must precede resolution",
                store,
                clock,
              }).id;
            } else {
              opId = createPendingOp(FAKE_ENTRY, `idem-b4-${confirmedCategory || "missing"}`, store, clock);
              itemId = createApprovalItem({
                op_id: opId,
                verb: FAKE_ENTRY.verb,
                tier: FAKE_ENTRY.tier,
                desired_effect: "category validation must precede denial",
                store,
                clock,
              }).id;
            }

            // Deliberately omit interactionLog: public validation cannot depend on capture wiring.
            const srv = createStatusServer({ store });
            const { host, port } = await srv.start();
            try {
              const transport = createConnectTransport({
                baseUrl: `http://${host}:${port}`,
                httpVersion: "1.1",
              });
              const client = createClient(DaemonService, transport);
              const send = async (): Promise<void> => {
                if (endpoint === "escalation") {
                  await client.respondToEscalation({
                    id: itemId,
                    response: "halt",
                    confirmedCategory,
                  });
                } else {
                  await client.respondToApproval({
                    id: itemId,
                    approve: false,
                    reason: "",
                    confirmedCategory,
                  });
                }
              };

              await assert.rejects(send, (err: unknown) => {
                assert.ok(err instanceof ConnectError, "category rejection must cross the Connect boundary");
                assert.equal(err.code, Code.InvalidArgument, "category rejection must be invalid_argument");
                assert.match(err.message, /confirmed_category/i);
                return true;
              });

              const item = store.get<{ status: string }>(
                "SELECT status FROM inbox_items WHERE id = ?",
                itemId,
              );
              assert.equal(item?.status, "open", "a category-rejected item must remain open");
              if (endpoint === "escalation") {
                const task = store.get<{ status: string }>(
                  "SELECT status FROM scheduler_task WHERE node_id = ?",
                  taskId,
                );
                assert.equal(task?.status, "running", "a category-rejected escalation must not change task state");
                assert.equal(
                  store.all("SELECT * FROM escalation_responses WHERE item_id = ?", itemId).length,
                  0,
                  "a category-rejected escalation must not be journaled",
                );
              } else {
                assert.equal(
                  store.get<{ status: string }>("SELECT status FROM broker_pending WHERE op_id = ?", opId)?.status,
                  "pending",
                  "a category-rejected approval must not alter the pending operation",
                );
                assert.equal(
                  store.all("SELECT * FROM approval_decisions WHERE item_id = ?", itemId).length,
                  0,
                  "a category-rejected approval must not be journaled",
                );
              }
            } finally {
              await srv.stop();
            }
          } finally {
            store.close();
          }
        } finally {
          await rm(dir, { recursive: true });
        }
      }
    }
  });

  test("control RPCs without interaction capture fail closed for valid categories instead of resolving uncaptured decisions", async () => {
    for (const endpoint of ["escalation", "approval"] as const) {
      const dir = await mkdtemp(join(tmpdir(), `respond-b4-capture-${endpoint}-`));
      try {
        const store = openStore(join(dir, "b4-capture.db"), { busyTimeout: 1000 });
        initSchema(store);
        try {
          const clock = new FakeClock(Date.now());
          const taskId = `task-b4-capture-${endpoint}`;
          let itemId: string;
          let opId: string | undefined;

          if (endpoint === "escalation") {
            insertSchedulerTask(store, taskId, "feature-b4-capture", {
              status: "running",
              blocked_on: "b4-capture",
            });
            itemId = createEscalationItem({
              source_id: "evt-b4-capture",
              task_id: taskId,
              reason: "budget-breach",
              payload_summary: "capture configuration is required",
              store,
              clock,
            }).id;
          } else {
            opId = createPendingOp(FAKE_ENTRY, "idem-b4-capture", store, clock);
            itemId = createApprovalItem({
              op_id: opId,
              verb: FAKE_ENTRY.verb,
              tier: FAKE_ENTRY.tier,
              desired_effect: "capture configuration is required",
              store,
              clock,
            }).id;
          }

          // A valid category isolates missing capture configuration from category validation.
          const srv = createStatusServer({ store });
          const { host, port } = await srv.start();
          try {
            const transport = createConnectTransport({
              baseUrl: `http://${host}:${port}`,
              httpVersion: "1.1",
            });
            const client = createClient(DaemonService, transport);
            const send = async (): Promise<void> => {
              if (endpoint === "escalation") {
                await client.respondToEscalation({
                  id: itemId,
                  response: "halt",
                  confirmedCategory: "correction",
                });
              } else {
                await client.respondToApproval({
                  id: itemId,
                  approve: false,
                  reason: "",
                  confirmedCategory: "approval",
                });
              }
            };

            await assert.rejects(send, (err: unknown) => {
              assert.ok(err instanceof ConnectError, "capture configuration failure must cross Connect");
              assert.equal(err.code, Code.FailedPrecondition, "missing capture must fail closed");
              assert.match(err.message, /interaction.*capture/i);
              return true;
            });

            const item = store.get<{ status: string }>(
              "SELECT status FROM inbox_items WHERE id = ?",
              itemId,
            );
            assert.equal(item?.status, "open", "an uncaptured decision must leave its item open");
            if (endpoint === "escalation") {
              assert.equal(
                store.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", taskId)?.status,
                "running",
                "an uncaptured escalation must not change task state",
              );
            } else {
              assert.equal(
                store.get<{ status: string }>("SELECT status FROM broker_pending WHERE op_id = ?", opId)?.status,
                "pending",
                "an uncaptured approval must not alter the pending operation",
              );
            }
          } finally {
            await srv.stop();
          }
        } finally {
          store.close();
        }
      } finally {
        await rm(dir, { recursive: true });
      }
    }
  });

  test("concurrent pending interaction projections append exactly one JSONL record for an inbox item", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-interaction-concurrency-"));
    try {
      const store = openStore(join(dir, "interaction-concurrency.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const itemId = "esc:concurrent-projection";
        store.run(
          "INSERT INTO interaction_outbox (item_id, event_json, projected_at) VALUES (?, ?, NULL)",
          itemId,
          JSON.stringify({ item_id: itemId, confirmed_category: "correction" }),
        );
        const log = new SlowJsonlLog(join(dir, "interactions.jsonl"));

        const firstProjection = projectPendingInteractionIntents(store, log, 1000);
        await log.waitForFirstAppend();
        const secondProjection = projectPendingInteractionIntents(store, log, 1001);

        // The first append is deliberately held while the second projection reads
        // the still-pending intent and reaches its own pre-append window.
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        log.release();
        await Promise.all([firstProjection, secondProjection]);

        assert.equal(
          (await log.readAll()).filter((event) => (event as { item_id?: string }).item_id === itemId).length,
          1,
          "overlapping projection attempts for one intent must emit one JSONL record",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("an exact escalation retry does not reapply the task transition", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-escalation-exact-retry-"));
    try {
      const store = openStore(join(dir, "escalation-exact-retry.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const taskId = "task-escalation-exact-retry";
        insertSchedulerTask(store, taskId, "feature-escalation-exact-retry", {
          status: "running",
          blocked_on: "blocked-exact-retry",
        });
        const item = createEscalationItem({
          source_id: "evt-escalation-exact-retry",
          task_id: taskId,
          reason: "budget-breach",
          payload_summary: "exact retries must not reapply the transition",
          store,
          clock: new FakeClock(Date.now()),
        });
        const srv = createStatusServer({
          store,
          interactionLog: new JsonlLog(join(dir, "interactions.jsonl")),
        });
        const { host, port } = await srv.start();
        try {
          const client = createClient(
            DaemonService,
            createConnectTransport({ baseUrl: `http://${host}:${port}`, httpVersion: "1.1" }),
          );
          await client.respondToEscalation({
            id: item.id,
            response: "halt",
            confirmedCategory: "correction",
          });
          store.run(
            `CREATE TRIGGER reject_exact_escalation_retry_transition
             BEFORE UPDATE OF status ON scheduler_task
             WHEN NEW.node_id = '${taskId}'
             BEGIN SELECT RAISE(ABORT, 'exact retry reapplied escalation transition'); END`,
          );

          await expectResolvedOrTypedReplay(() =>
            client.respondToEscalation({
              id: item.id,
              response: "halt",
              confirmedCategory: "correction",
            }),
          );
          assert.equal(
            store.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", taskId)?.status,
            "halted",
            "an exact retry must leave the completed escalation transition unchanged",
          );
          assert.equal(
            store.all("SELECT * FROM escalation_responses WHERE item_id = ?", item.id).length,
            1,
            "an exact retry must not journal a second escalation response",
          );
        } finally {
          await srv.stop();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("conflicting escalation action or category retries are typed and leave the original task state and interaction intact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-escalation-conflict-retry-"));
    try {
      const store = openStore(join(dir, "escalation-conflict-retry.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const taskId = "task-escalation-conflict-retry";
        insertSchedulerTask(store, taskId, "feature-escalation-conflict-retry", {
          status: "running",
          blocked_on: "blocked-conflict-retry",
        });
        const item = createEscalationItem({
          source_id: "evt-escalation-conflict-retry",
          task_id: taskId,
          reason: "budget-breach",
          payload_summary: "conflicting retries cannot alter a completed escalation",
          store,
          clock: new FakeClock(Date.now()),
        });
        const log = new JsonlLog(join(dir, "interactions.jsonl"));
        const srv = createStatusServer({ store, interactionLog: log });
        const { host, port } = await srv.start();
        try {
          const client = createClient(
            DaemonService,
            createConnectTransport({ baseUrl: `http://${host}:${port}`, httpVersion: "1.1" }),
          );
          await client.respondToEscalation({
            id: item.id,
            response: "halt",
            confirmedCategory: "correction",
          });

          for (const conflictingRetry of [
            { response: "resume" as const, confirmedCategory: "correction" },
            { response: "halt" as const, confirmedCategory: "rework" },
          ]) {
            await assert.rejects(
              () => client.respondToEscalation({ id: item.id, ...conflictingRetry }),
              (error: unknown) => {
                assert.ok(error instanceof ConnectError, "a conflicting retry must cross Connect");
                assert.ok(
                  error.code === Code.AlreadyExists || error.code === Code.FailedPrecondition,
                  `a conflicting retry must be already_exists or failed_precondition, got ${error.code}`,
                );
                return true;
              },
            );
          }
          assert.equal(
            store.get<{ status: string }>("SELECT status FROM scheduler_task WHERE node_id = ?", taskId)?.status,
            "halted",
            "a conflicting retry must not change the original halted task state",
          );
          assert.equal(
            store.get<{ action: string }>("SELECT action FROM escalation_responses WHERE item_id = ?", item.id)?.action,
            "halt",
            "a conflicting retry must not replace the recorded escalation action",
          );
          const events = await log.readAll();
          assert.equal(events.length, 1, "a conflicting retry must not append a second interaction event");
          assert.equal(
            (events[0] as Record<string, unknown>)["confirmed_category"],
            "correction",
            "a conflicting retry must not replace the original confirmed category",
          );
        } finally {
          await srv.stop();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("approval retries bind the original action and category without redispatching the adapter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "respond-approval-conflict-retry-"));
    try {
      const store = openStore(join(dir, "approval-conflict-retry.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(Date.now());
        const { adapter, submitCalls } = makeFakeAdapter(["request-approval-conflict-retry"]);
        const opId = createPendingOp(FAKE_ENTRY, "idem-approval-conflict-retry", store, clock);
        const item = createApprovalItem({
          op_id: opId,
          verb: FAKE_ENTRY.verb,
          tier: FAKE_ENTRY.tier,
          desired_effect: "conflicting approval retries must not redispatch",
          store,
          clock,
        });
        const log = new JsonlLog(join(dir, "interactions.jsonl"));
        const srv = createStatusServer({
          store,
          interactionLog: log,
          getApprovalContext: () => ({ entry: FAKE_ENTRY, adapter, payload: {} }),
        });
        const { host, port } = await srv.start();
        try {
          const client = createClient(
            DaemonService,
            createConnectTransport({ baseUrl: `http://${host}:${port}`, httpVersion: "1.1" }),
          );
          await client.respondToApproval({
            id: item.id,
            approve: true,
            confirmedCategory: "approval",
          });

          await expectResolvedOrTypedReplay(() =>
            client.respondToApproval({
              id: item.id,
              approve: true,
              confirmedCategory: "approval",
            }),
          );
          for (const conflictingRetry of [
            { approve: false, confirmedCategory: "approval" },
            { approve: true, confirmedCategory: "rework" },
          ]) {
            await assert.rejects(
              () => client.respondToApproval({ id: item.id, ...conflictingRetry }),
              (error: unknown) => {
                assert.ok(error instanceof ConnectError, "a conflicting retry must cross Connect");
                assert.ok(
                  error.code === Code.AlreadyExists || error.code === Code.FailedPrecondition,
                  `a conflicting retry must be already_exists or failed_precondition, got ${error.code}`,
                );
                return true;
              },
            );
          }
          assert.equal(submitCalls(), 1, "approval retries must not submit the adapter again");
          assert.ok(
            store.get<{ op_id: string }>(
              "SELECT op_id FROM broker_in_flight WHERE verb = ? AND idempotency_key = ?",
              FAKE_ENTRY.verb,
              "idem-approval-conflict-retry",
            ),
            "conflicting retries must leave the original operation in_flight",
          );
          const events = await log.readAll();
          assert.equal(events.length, 1, "approval retries must not append another interaction event");
          assert.equal(
            (events[0] as Record<string, unknown>)["confirmed_category"],
            "approval",
            "approval retries must preserve the original confirmed category",
          );
        } finally {
          await srv.stop();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
