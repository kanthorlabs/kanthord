import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import { createPendingOp } from "../broker/expiry.ts";
import { initSchema } from "../store/schema.ts";
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
        const srv = createStatusServer({ store });
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
          const respondResp = await client.respondToEscalation({ id: item.id, response: "resume" });
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

          const resp = await client.respondToApproval({ id: item.id, approve: true, reason: "" });
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
});
