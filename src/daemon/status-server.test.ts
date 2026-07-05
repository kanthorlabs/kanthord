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
    test("descriptor has only allowed read method names (no control/mutate methods)", () => {
      const methodNames = Object.keys(DaemonService.method);
      assert.deepEqual(
        methodNames,
        ["getStatus"],
        `descriptor must list exactly ["getStatus"]; got ${JSON.stringify(methodNames)}`
      );
      const forbidden = ["signOff", "approve", "halt", "write", "mutate", "control", "enqueue"];
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
