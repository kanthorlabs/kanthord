import test, { describe } from "node:test";
import assert from "node:assert/strict";
import type { Store } from "../foundations/sqlite-store.ts";
import { createStatusServer } from "./status-server.ts";
import { createConnectTransport } from "@connectrpc/connect-node";
import { createClient } from "@connectrpc/connect";
import { DaemonService } from "../generated/kanthord/v1/daemon_pb.js";

const fakeStore: Store = {
  get: () => undefined,
  run: () => {},
  all: () => [],
  close: () => {},
};

describe("src/daemon/status-server", () => {
  describe("T1 — /healthz responds healthy", () => {
    test("/healthz returns 200 ok on loopback", async () => {
      const srv = createStatusServer({ store: fakeStore });
      const { host, port } = await srv.start();
      try {
        const res = await fetch(`http://${host}:${port}/healthz`);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes("ok"), `expected "ok" in body, got: ${text}`);
      } finally {
        await srv.stop();
      }
    });

    test("bind address is 127.0.0.1 (not 0.0.0.0)", async () => {
      const srv = createStatusServer({ store: fakeStore });
      const { host } = await srv.start();
      try {
        assert.notEqual(host, "0.0.0.0", "server must not bind to 0.0.0.0");
        assert.ok(
          host === "127.0.0.1" || host === "::1",
          `expected loopback bind, got: ${host}`
        );
      } finally {
        await srv.stop();
      }
    });
  });

  describe("T2 — Read-only status method over SQLite", () => {
    // Epic 011 SU6 superseded the Epic 000 read-only rule for 2A; Epic 020 SU6
    // extends the descriptor with the full Phase-2B control-plane surface (Epic
    // 026). The gate stays "descriptor is exactly this allowlist", asserted by
    // local name + method kind + read/control class. 2B messages are an interface
    // hypothesis — Epic 026 owns behavior and may force a re-gen (decision record
    // in connect-surface.md).
    test("descriptor lists exactly the Phase-1 + 2A + 2B allowlist", () => {
      const methodNames = Object.keys(DaemonService.method).sort();
      const allowlist = [
        // Phase-1 read + 2A inbox surface.
        "getStatus",
        "listInboxItems",
        "respondToApproval",
        "respondToEscalation",
        // 2B reads (Epic 026 Story 001).
        "listFeatures",
        "getFeature",
        "listBrokerOperations",
        "listBrokerVerbs",
        "listSlots",
        "getBudget",
        "listBudgets",          // Epic 027 N4 — per-task ledger list
        "getInboxItem",         // Epic 027 N2 — deep-link item view
        "getDaemonStatus",
        "getTaskTimeline",
        "subscribeSessionEvents",
        // 2B read-with-single-write.
        "triggerVerify",
        // 2B control verbs (Epic 026 Story 002).
        "signOffPlan",
        "haltTask",
        "haltFeature",
        "approveReplan",
        "overrideBudget",
      ].sort();
      assert.deepEqual(
        methodNames,
        allowlist,
        `descriptor must list exactly ${JSON.stringify(allowlist)}; got ${JSON.stringify(methodNames)}`
      );
      // Method kinds: the session-event stream is server-streaming; all others
      // are unary (Epic 026 depends on kind-level checks, not just names).
      for (const [local, m] of Object.entries(DaemonService.method)) {
        const expectedKind =
          local === "subscribeSessionEvents" ? "server_streaming" : "unary";
        assert.equal(m.methodKind, expectedKind, `method ${local} must be ${expectedKind}`);
      }
      // Broker write verbs are NEVER control-plane RPC methods: they flow through
      // the broker registry, not the descriptor (Epic 026 AC — no registry-write
      // method; broker.verbs is read-only).
      const forbidden = [
        "mergePr",
        "createIssue",
        "enqueue",
        "lease",
        "registerVerb",
      ];
      for (const name of forbidden) {
        assert.ok(
          !methodNames.includes(name),
          `forbidden method present in descriptor: ${name}`
        );
      }
    });

    test("getStatus call performs zero writes (write-counting store seam)", async () => {
      let writeCount = 0;
      const countingStore: Store = {
        get: () => undefined,
        run: () => { writeCount++; },
        all: () => [],
        close: () => {},
      };
      const srv = createStatusServer({ store: countingStore });
      const { host, port } = await srv.start();
      try {
        const transport = createConnectTransport({
          baseUrl: `http://${host}:${port}`,
          httpVersion: "1.1",
        });
        const client = createClient(DaemonService, transport);
        await client.getStatus({});
        assert.equal(writeCount, 0, "getStatus must not write to the store");
      } finally {
        await srv.stop();
      }
    });

    test("getStatus returns feature/task status rows from SQLite", async () => {
      let readCount = 0;
      const readingStore: Store = {
        get: () => undefined,
        run: () => {},
        all: <T,>(sql: string): T[] => {
          readCount++;
          if (sql.startsWith("PRAGMA table_info(scheduler_task)")) {
            return [
              { name: "node_id" },
              { name: "feature_id" },
              { name: "status" },
              { name: "exit_gate_passed" },
            ] as T[];
          }
          return [
            {
              node_id: "task-alpha",
              feature_id: "feat-001",
              status: "running",
              exit_gate_passed: 0,
            },
            {
              node_id: "task-beta",
              feature_id: "feat-001",
              status: "pending",
              exit_gate_passed: 1,
            },
          ] as T[];
        },
        close: () => {},
      };
      const srv = createStatusServer({ store: readingStore });
      const { host, port } = await srv.start();
      try {
        const transport = createConnectTransport({
          baseUrl: `http://${host}:${port}`,
          httpVersion: "1.1",
        });
        const client = createClient(DaemonService, transport);
        const status = await client.getStatus({});
        assert.ok(
          readCount > 0,
          `getStatus must read from the store; readCount=${readCount} (no reads = status is not SQLite-derived)`
        );
        assert.deepEqual(
          status.features.map((feature) => ({
            featureId: feature.featureId,
            status: feature.status,
            tasks: feature.tasks.map((task) => ({
              taskId: task.taskId,
              status: task.status,
              exitGatePassed: task.exitGatePassed,
            })),
          })),
          [
            {
              featureId: "feat-001",
              status: "running",
              tasks: [
                { taskId: "task-alpha", status: "running", exitGatePassed: false },
                { taskId: "task-beta", status: "pending", exitGatePassed: true },
              ],
            },
          ],
          "getStatus must return the current feature/task status from scheduler_task",
        );
      } finally {
        await srv.stop();
      }
    });
  });

  describe("T3 — Structured logger receives server-listen record", () => {
    test("logger receives server-listen record on start", async () => {
      const records: Array<Record<string, unknown>> = [];
      const mockLogger = {
        info(record: Record<string, unknown>): void {
          records.push(record);
        },
      };
      const srv = createStatusServer({ store: fakeStore, logger: mockLogger });
      const { host, port } = await srv.start();
      try {
        const listenRecord = records.find((r) => r["event"] === "server-listen");
        assert.ok(
          listenRecord !== undefined,
          "logger must receive a { event: 'server-listen' } record when start() completes"
        );
        assert.equal(
          listenRecord["host"],
          host,
          "server-listen record host must match bound address"
        );
        assert.equal(
          listenRecord["port"],
          port,
          "server-listen record port must match bound port"
        );
      } finally {
        await srv.stop();
      }
    });
  });
});
