import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { initSchedulerSchema, loadTasks, setTaskStatus, dispatchable, markExitGatePassed } from "./dispatch.ts";

// ---------------------------------------------------------------------------
// Suite: src/scheduler/migration
//
// Verifies the scheduler schema-init seam contract:
//   (a) initSchedulerSchema is idempotent — calling twice on the same store
//       creates the table and does not throw on the second call.
//   (b) A scheduler method called on a FRESH store WITHOUT initSchedulerSchema
//       throws because the scheduler_task table does not exist — proving methods
//       no longer self-migrate.
// ---------------------------------------------------------------------------

describe("src/scheduler/migration", () => {
  let tmpDir = "";

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-migration-"));
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test("initSchedulerSchema creates scheduler_task and is idempotent (calling twice does not throw)", () => {
    const dbPath = join(tmpDir, "idempotent.db");
    const store: Store = openStore(dbPath, { busyTimeout: 1000 });
    try {
      // First call: creates the table
      assert.doesNotThrow(() => initSchedulerSchema(store), "first call must not throw");

      // Verify the table exists by querying PRAGMA
      const tables = store.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='scheduler_task'",
      );
      assert.equal(tables.length, 1, "scheduler_task table must exist after initSchedulerSchema");

      // Second call: must be idempotent (no throw)
      assert.doesNotThrow(() => initSchedulerSchema(store), "second call must not throw (idempotent)");
    } finally {
      store.close();
    }
  });

  test("loadTasks on a fresh store without initSchedulerSchema throws — methods no longer self-migrate", () => {
    const dbPath = join(tmpDir, "no-init.db");
    const store: Store = openStore(dbPath, { busyTimeout: 1000 });
    try {
      // Calling loadTasks without initSchedulerSchema must throw because
      // the scheduler_task table does not exist (lazy migration was removed).
      assert.throws(
        () => loadTasks(store, "feat-nomigrate"),
        (err: unknown) => {
          assert.ok(err instanceof Error, "must throw an Error");
          assert.ok(
            err.message.includes("no such table"),
            `error must mention missing table, got: ${err.message}`,
          );
          return true;
        },
        "loadTasks must throw 'no such table' on a fresh store without initSchedulerSchema",
      );
    } finally {
      store.close();
    }
  });

  test("setTaskStatus on a fresh store without initSchedulerSchema throws — methods no longer self-migrate", () => {
    const dbPath = join(tmpDir, "no-init-set.db");
    const store: Store = openStore(dbPath, { busyTimeout: 1000 });
    try {
      assert.throws(
        () => setTaskStatus(store, "task-x", "done"),
        (err: unknown) => {
          assert.ok(err instanceof Error, "must throw an Error");
          assert.ok(
            err.message.includes("no such table"),
            `error must mention missing table, got: ${err.message}`,
          );
          return true;
        },
        "setTaskStatus must throw 'no such table' on a fresh store without initSchedulerSchema",
      );
    } finally {
      store.close();
    }
  });

  test("dispatchable on a fresh store without initSchedulerSchema throws — methods no longer self-migrate", () => {
    const dbPath = join(tmpDir, "no-init-dispatchable.db");
    const store: Store = openStore(dbPath, { busyTimeout: 1000 });
    try {
      assert.throws(
        () => dispatchable(store, "feat-dispatchable"),
        (err: unknown) => {
          assert.ok(err instanceof Error, "must throw an Error");
          assert.ok(
            err.message.includes("no such table"),
            `error must mention missing table, got: ${err.message}`,
          );
          return true;
        },
        "dispatchable must throw 'no such table' on a fresh store without initSchedulerSchema",
      );
    } finally {
      store.close();
    }
  });

  test("markExitGatePassed on a fresh store without initSchedulerSchema throws — methods no longer self-migrate", () => {
    const dbPath = join(tmpDir, "no-init-exitgate.db");
    const store: Store = openStore(dbPath, { busyTimeout: 1000 });
    try {
      assert.throws(
        () => markExitGatePassed(store, "node-exitgate"),
        (err: unknown) => {
          assert.ok(err instanceof Error, "must throw an Error");
          assert.ok(
            err.message.includes("no such table"),
            `error must mention missing table, got: ${err.message}`,
          );
          return true;
        },
        "markExitGatePassed must throw 'no such table' on a fresh store without initSchedulerSchema",
      );
    } finally {
      store.close();
    }
  });
});
