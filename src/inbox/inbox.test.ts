import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import { createPendingOp } from "../broker/expiry.ts";
import type { VerbRegistryEntry } from "../broker/registry.ts";
import {
  createEscalationItem,
  createBrokerEscalationItem,
  createApprovalItem,
} from "./inbox.ts";
import { listOpenInboxItems } from "../rpc/inbox-list.ts";
import { createStatusServer } from "../daemon/status-server.ts";
import { createConnectTransport } from "@connectrpc/connect-node";
import { createClient } from "@connectrpc/connect";
import { DaemonService } from "../generated/kanthord/v1/daemon_pb.js";

// Suite: src/inbox/inbox.ts
// Story 017-001 Task T1 — Items from escalation events and approval-required ops

const FAKE_APPROVAL_ENTRY: VerbRegistryEntry = {
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

describe("src/inbox/inbox.ts", () => {
  // -------------------------------------------------------------------------
  // T1a — ring-1 escalation event → open escalation item with evidence, no secret
  // -------------------------------------------------------------------------
  test("ring-1 escalation event creates open escalation item carrying evidence and no secret value", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inbox-t1a-"));
    try {
      const store = openStore(join(dir, "inbox.db"), { busyTimeout: 1000 });
      try {
        const clock = new FakeClock(1000);
        const item = createEscalationItem({
          source_id: "evt-write-scope-001",
          task_id: "task-001",
          reason: "out-of-scope-write",
          payload_summary: "attempted write to src/forbidden/file.ts",
          store,
          clock,
        });

        assert.equal(item.kind, "escalation", "kind must be 'escalation'");
        assert.equal(item.status, "open", "item must be open");
        assert.equal(item.created_at, 1000, "created_at must match clock");
        assert.ok(
          typeof item.id === "string" && item.id.length > 0,
          "id must be a non-empty string",
        );
        // Evidence carries task_id, reason, payload_summary
        const ev = item.evidence as Record<string, unknown>;
        assert.equal(ev["task_id"], "task-001");
        assert.equal(ev["reason"], "out-of-scope-write");
        assert.equal(
          ev["payload_summary"],
          "attempted write to src/forbidden/file.ts",
        );
        // Secret value must never appear in evidence (Epic 013 rule)
        const evidenceStr = JSON.stringify(item.evidence);
        assert.ok(
          !evidenceStr.toLowerCase().includes("secret"),
          "evidence must not contain raw secret data",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1b — broker escalation-needed state → escalation item referencing op_id
  // -------------------------------------------------------------------------
  test("broker escalation-needed state creates escalation item referencing op_id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inbox-t1b-"));
    try {
      const store = openStore(join(dir, "inbox.db"), { busyTimeout: 1000 });
      try {
        const clock = new FakeClock(2000);
        const opId = "op-broker-timeout-456";
        const item = createBrokerEscalationItem({
          op_id: opId,
          store,
          clock,
        });

        assert.equal(item.kind, "escalation", "kind must be 'escalation'");
        assert.equal(item.status, "open", "item must be open");
        assert.equal(item.created_at, 2000, "created_at must match clock");
        assert.ok(
          typeof item.id === "string" && item.id.length > 0,
          "id must be a non-empty string",
        );
        // Evidence must reference the op_id (Epic 005 boundary — broker emits)
        const ev = item.evidence as Record<string, unknown>;
        assert.equal(ev["op_id"], opId, "evidence must reference the op_id");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1c — approval_required submit → approval item while op stays pending
  // -------------------------------------------------------------------------
  test("approval_required submit creates approval item while op remains pending", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inbox-t1c-"));
    try {
      const store = openStore(join(dir, "inbox.db"), { busyTimeout: 1000 });
      try {
        const clock = new FakeClock(3000);
        // Create a pending op (Epic 005 state model — approval_required parks the op)
        const opId = createPendingOp(
          FAKE_APPROVAL_ENTRY,
          "idem-pr-001",
          store,
          clock,
        );

        const item = createApprovalItem({
          op_id: opId,
          verb: "github_create_pr",
          tier: "approval_required",
          desired_effect: "open PR against main branch",
          store,
          clock,
        });

        assert.equal(item.kind, "approval", "kind must be 'approval'");
        assert.equal(item.status, "open", "item must be open");
        assert.equal(item.created_at, 3000, "created_at must match clock");
        assert.ok(
          typeof item.id === "string" && item.id.length > 0,
          "id must be a non-empty string",
        );
        // Evidence names verb, tier, desired_effect
        const ev = item.evidence as Record<string, unknown>;
        assert.equal(ev["verb"], "github_create_pr");
        assert.equal(ev["tier"], "approval_required");
        assert.equal(ev["desired_effect"], "open PR against main branch");

        // Op must still be pending — approval_required parks; dispatch waits for human
        const pendingRow = store.get<{ status: string }>(
          "SELECT status FROM broker_pending WHERE op_id = ?",
          opId,
        );
        assert.ok(pendingRow !== undefined, "op must exist in broker_pending");
        assert.equal(pendingRow.status, "pending", "op must stay pending");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1d — item ids are deterministic (derived from source_id / op_id)
  // -------------------------------------------------------------------------
  test("item ids are deterministic — same source_id produces same inbox item id", async () => {

    const dir = await mkdtemp(join(tmpdir(), "inbox-t1d-"));
    try {
      const store = openStore(join(dir, "inbox.db"), { busyTimeout: 1000 });
      try {
        const clock = new FakeClock(1000);
        const opts = {
          source_id: "evt-determ-001",
          task_id: "task-determ",
          reason: "budget-breach",
          payload_summary: "exceeded $50 ceiling",
          store,
          clock,
        };
        const item1 = createEscalationItem(opts);
        const item2 = createEscalationItem(opts);
        assert.equal(
          item1.id,
          item2.id,
          "same source_id must yield same inbox item id (idempotent rebuild)",
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
// Story 017-001 Task T2 — List method + restart survival
// ---------------------------------------------------------------------------
describe("src/rpc/inbox-list.ts", () => {
  // T2a — list returns open items with correct fields; resolved items omitted
  test("list returns open items with kind, created_at, evidence and omits resolved ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inbox-t2a-"));
    try {
      const store = openStore(join(dir, "t2a.db"), { busyTimeout: 1000 });
      try {
        const clock = new FakeClock(1000);
        const openItem = createEscalationItem({
          source_id: "src-t2a-open",
          task_id: "task-t2a",
          reason: "out-of-scope-write",
          payload_summary: "test payload",
          store,
          clock,
        });
        const resolvedItem = createEscalationItem({
          source_id: "src-t2a-resolved",
          task_id: "task-t2a",
          reason: "secret-scan",
          payload_summary: "resolved payload",
          store,
          clock,
        });
        // Mark one item resolved directly (Story 002 will expose the public API)
        store.run(
          "UPDATE inbox_items SET status = 'resolved' WHERE id = ?",
          resolvedItem.id,
        );

        const items = listOpenInboxItems(store);

        assert.equal(items.length, 1, "list must return exactly one open item");
        const it = items[0];
        assert.ok(it !== undefined, "item must be defined");
        assert.equal(it.id, openItem.id, "id must match the open item");
        assert.equal(it.kind, "escalation", "kind must be escalation");
        assert.equal(it.status, "open", "status must be open");
        assert.equal(it.created_at, 1000, "created_at must match clock");
        assert.ok(
          typeof it.evidence === "object" && it.evidence !== null,
          "evidence must be an object (not null, not a raw JSON string)",
        );
        const ev = it.evidence as Record<string, unknown>;
        assert.equal(ev["task_id"], "task-t2a");
        assert.equal(ev["reason"], "out-of-scope-write");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // T2b — restart survival: open items rebuild with same ids; resolved stays resolved
  test("open items survive daemon restart (same ids) and resolved item stays excluded after restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inbox-t2b-"));
    try {
      const dbPath = join(dir, "t2b.db");
      let openItemId = "";

      // Pre-restart: create two items, mark one resolved, then close store
      {
        const store = openStore(dbPath, { busyTimeout: 1000 });
        try {
          const clock = new FakeClock(2000);
          const openItem = createEscalationItem({
            source_id: "src-t2b-open",
            task_id: "task-t2b",
            reason: "budget-breach",
            payload_summary: "budget exceeded",
            store,
            clock,
          });
          const resolvedItem = createEscalationItem({
            source_id: "src-t2b-resolved",
            task_id: "task-t2b",
            reason: "out-of-scope-write",
            payload_summary: "resolved item",
            store,
            clock,
          });
          store.run(
            "UPDATE inbox_items SET status = 'resolved' WHERE id = ?",
            resolvedItem.id,
          );
          openItemId = openItem.id;
        } finally {
          store.close();
        }
      }

      // Post-restart: reopen the same DB file and query again
      const store2 = openStore(dbPath, { busyTimeout: 1000 });
      try {
        const items = listOpenInboxItems(store2);
        assert.equal(
          items.length,
          1,
          "after restart, exactly one open item must be listed",
        );
        const it = items[0];
        assert.ok(it !== undefined, "item must be defined after restart");
        assert.equal(
          it.id,
          openItemId,
          "open item id must be identical after restart (deterministic rebuild)",
        );
        assert.equal(it.status, "open", "status must be open after restart");
      } finally {
        store2.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // T2c — listInboxItems RPC over a real loopback HTTP socket
  test("listInboxItems RPC round-trips over a real loopback HTTP socket — 200 status and items array shape", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inbox-t2c-"));
    try {
      const store = openStore(join(dir, "t2c.db"), { busyTimeout: 1000 });
      try {
        const clock = new FakeClock(3000);
        const created = createEscalationItem({
          source_id: "src-t2c-esc",
          task_id: "task-t2c",
          reason: "out-of-scope-write",
          payload_summary: "HTTP test item",
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
          const resp = await client.listInboxItems({});

          assert.ok(
            Array.isArray(resp.items),
            "listInboxItems response must have an items array",
          );
          assert.equal(
            resp.items.length,
            1,
            "one open item must be returned via the RPC",
          );
          const it = resp.items[0];
          assert.ok(it !== undefined, "RPC item must be defined");
          assert.ok(
            typeof it.id === "string" && it.id.length > 0,
            "RPC item must have a non-empty id",
          );
          assert.equal(it.id, created.id, "RPC item id must match the created item");
          assert.equal(it.kind, "escalation", "RPC item kind must be escalation");
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
