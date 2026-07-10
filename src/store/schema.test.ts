import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { initSchema } from "./schema.ts";
import { getInFlightOp } from "../broker/submit.ts";
import { createEscalationItem } from "../inbox/inbox.ts";
import { FakeClock } from "../foundations/clock.ts";

// ---------------------------------------------------------------------------
// Suite: src/store/schema
//
// Pins the aggregator contract:
//   (a) initSchema(store) creates all migrated tables across every subsystem.
//   (b) initSchema(store) is idempotent — calling twice does not throw.
// ---------------------------------------------------------------------------

const EXPECTED_TABLES = [
  "broker_in_flight",
  "broker_completion",
  "broker_pending",
  "inbox_items",
  "approval_decisions",
  "escalation_responses",
  "scheduler_task",
  "blocked_on_capability",
  "scheduler_lease",
  "budget_ledger",
] as const;

describe("src/store/schema", () => {
  let tmpDir = "";

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-schema-"));
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test("initSchema creates all migrated tables across every subsystem", () => {
    const dbPath = join(tmpDir, "all-tables.db");
    const store: Store = openStore(dbPath, { busyTimeout: 1000 });
    try {
      initSchema(store);
      for (const table of EXPECTED_TABLES) {
        const rows = store.all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          table,
        );
        assert.equal(rows.length, 1, `table '${table}' must exist after initSchema`);
      }
    } finally {
      store.close();
    }
  });

  test("initSchema is idempotent — calling twice does not throw", () => {
    const dbPath = join(tmpDir, "idempotent.db");
    const store: Store = openStore(dbPath, { busyTimeout: 1000 });
    try {
      assert.doesNotThrow(() => initSchema(store), "first call must not throw");
      assert.doesNotThrow(() => initSchema(store), "second call must not throw (idempotent)");
    } finally {
      store.close();
    }
  });

  // ---------------------------------------------------------------------------
  // No-self-migration contract — subsystem functions must NOT perform their own
  // DDL. On a store without initSchema, they throw "no such table" rather than
  // silently bootstrapping. This proves the central-schema-only discipline.
  // ---------------------------------------------------------------------------

  describe("no-self-migration contract", () => {
    let noSchemaDir = "";
    let noSchemaStore: Store | undefined;

    beforeEach(async () => {
      noSchemaDir = await mkdtemp(join(tmpdir(), "kanthord-no-schema-"));
      noSchemaStore = openStore(join(noSchemaDir, "no-schema.db"), { busyTimeout: 1000 });
    });

    afterEach(async () => {
      noSchemaStore?.close();
      noSchemaStore = undefined;
      if (noSchemaDir) await rm(noSchemaDir, { recursive: true, force: true });
      noSchemaDir = "";
    });

    test("broker getInFlightOp throws 'no such table' on uninitialised store", () => {
      assert.throws(
        () => getInFlightOp("op-x", noSchemaStore!),
        /no such table/,
        "getInFlightOp must not self-migrate; it throws on an uninitialised store",
      );
    });

    test("inbox createEscalationItem throws 'no such table' on uninitialised store", () => {
      assert.throws(
        () =>
          createEscalationItem({
            source_id: "src-1",
            task_id: "task-1",
            reason: "test",
            payload_summary: "summary",
            store: noSchemaStore!,
            clock: new FakeClock(0),
          }),
        /no such table/,
        "createEscalationItem must not self-migrate; it throws on an uninitialised store",
      );
    });
  });
});
