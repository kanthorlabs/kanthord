import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonlLog } from "../foundations/jsonl.ts";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import { applyCompiledPlanMigration } from "../compiler/compile.ts";
import { getFeatureSummary } from "./feature-summary.ts";

const FEATURE_ID = "feature-summary-target";
const OTHER_FEATURE_ID = "feature-summary-other";
const TASK_A = `${FEATURE_ID}/001-story/T1`;
const TASK_B = `${FEATURE_ID}/001-story/T2`;
const OTHER_TASK = `${OTHER_FEATURE_ID}/001-story/T1`;

const EMPTY_BREAKDOWN = {
  approval: 0,
  clarification: 0,
  correction: 0,
  rework: 0,
  takeover: 0,
  external: 0,
};

function openTestStore(dir: string): Store {
  const store = openStore(join(dir, "feature-summary.db"), { busyTimeout: 1000 });
  initSchema(store);
  applyCompiledPlanMigration(store);
  return store;
}

function addFeatureTask(store: Store, taskId: string, featureId: string): void {
  store.run(
    "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
    taskId,
    "task",
    featureId,
    1,
  );
  store.run(
    "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed) VALUES (?, ?, ?, ?)",
    taskId,
    featureId,
    "done",
    1,
  );
}

async function appendEvent(
  log: JsonlLog,
  input: {
    itemId: string;
    taskId: string;
    featureId: string;
    confirmedCategory: keyof typeof EMPTY_BREAKDOWN;
    excluded?: boolean;
  },
): Promise<void> {
  await log.append({
    item_id: input.itemId,
    task_id: input.taskId,
    feature_id: input.featureId,
    confirmed_category: input.confirmedCategory,
    ...(input.excluded === true ? { excluded_from_automation_metric: true } : {}),
  });
}

describe("src/metrics/feature-summary.ts", () => {
  test("returns the documented per-feature shape without leaking another feature's events or ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feature-summary-fixture-"));
    try {
      const store = openTestStore(dir);
      const interactionLog = new JsonlLog(join(dir, "interactions.jsonl"));
      try {
        addFeatureTask(store, TASK_A, FEATURE_ID);
        addFeatureTask(store, OTHER_TASK, OTHER_FEATURE_ID);
        store.run(
          "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
          TASK_A,
          JSON.stringify([{ kind: "reservation", reservationId: "target-reservation", conservativeCharge: 11 }]),
        );
        store.run(
          "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
          OTHER_TASK,
          JSON.stringify([{ kind: "reservation", reservationId: "other-reservation", conservativeCharge: 100 }]),
        );

        await appendEvent(interactionLog, { itemId: "target-approval-1", taskId: TASK_A, featureId: FEATURE_ID, confirmedCategory: "approval" });
        await appendEvent(interactionLog, { itemId: "target-approval-2", taskId: TASK_A, featureId: FEATURE_ID, confirmedCategory: "approval" });
        await appendEvent(interactionLog, { itemId: "target-correction", taskId: TASK_A, featureId: FEATURE_ID, confirmedCategory: "correction" });
        await appendEvent(interactionLog, { itemId: "target-clarification", taskId: TASK_A, featureId: FEATURE_ID, confirmedCategory: "clarification" });
        await appendEvent(interactionLog, { itemId: "target-excluded", taskId: TASK_A, featureId: FEATURE_ID, confirmedCategory: "rework", excluded: true });
        await appendEvent(interactionLog, { itemId: "other-approval", taskId: OTHER_TASK, featureId: OTHER_FEATURE_ID, confirmedCategory: "approval" });

        assert.deepEqual(
          await getFeatureSummary(FEATURE_ID, { interactionLog, store }),
          {
            featureId: FEATURE_ID,
            headline: 4,
            byConfirmedType: {
              approval: 2,
              clarification: 1,
              correction: 1,
              rework: 0,
              takeover: 0,
              external: 0,
            },
            excluded: 1,
            netCost: 11,
          },
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses a final reconcile once and sums net cost across the feature's tasks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feature-summary-reconcile-"));
    try {
      const store = openTestStore(dir);
      const interactionLog = new JsonlLog(join(dir, "interactions.jsonl"));
      try {
        addFeatureTask(store, TASK_A, FEATURE_ID);
        addFeatureTask(store, TASK_B, FEATURE_ID);
        store.run(
          "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
          TASK_A,
          JSON.stringify([
            { kind: "reservation", reservationId: "reconciled-reservation", conservativeCharge: 10 },
            { kind: "reconcile", reservationId: "reconciled-reservation", finalActual: 4 },
          ]),
        );
        store.run(
          "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
          TASK_B,
          JSON.stringify([{ kind: "reservation", reservationId: "second-reservation", conservativeCharge: 7 }]),
        );

        assert.deepEqual(
          await getFeatureSummary(FEATURE_ID, { interactionLog, store }),
          {
            featureId: FEATURE_ID,
            headline: 0,
            byConfirmedType: EMPTY_BREAKDOWN,
            excluded: 0,
            netCost: 11,
          },
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("prefers the live spend ledger over a conflicting legacy JSON ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feature-summary-live-spend-"));
    try {
      const store = openTestStore(dir);
      const interactionLog = new JsonlLog(join(dir, "interactions.jsonl"));
      try {
        addFeatureTask(store, TASK_A, FEATURE_ID);
        store.run(
          "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
          `spend:${TASK_A}`,
          "5",
        );
        store.run(
          "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
          TASK_A,
          JSON.stringify([{ kind: "reservation", reservationId: "legacy-reservation", conservativeCharge: 99 }]),
        );

        const summary = await getFeatureSummary(FEATURE_ID, { interactionLog, store });

        assert.equal(
          summary.netCost,
          5,
          "the live spend ledger must take precedence over and not add the legacy JSON ledger",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns exact explicit zeros for empty and unknown features", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feature-summary-empty-"));
    try {
      const store = openTestStore(dir);
      const interactionLog = new JsonlLog(join(dir, "interactions.jsonl"));
      try {
        for (const featureId of ["feature-summary-empty", "feature-summary-unknown"]) {
          assert.deepEqual(
            await getFeatureSummary(featureId, { interactionLog, store }),
            {
              featureId,
              headline: 0,
              byConfirmedType: EMPTY_BREAKDOWN,
              excluded: 0,
              netCost: 0,
            },
          );
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("performs zero sqlite writes while aggregating a feature summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feature-summary-read-only-"));
    try {
      const store = openTestStore(dir);
      const interactionLog = new JsonlLog(join(dir, "interactions.jsonl"));
      try {
        addFeatureTask(store, TASK_A, FEATURE_ID);
        store.run(
          "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
          TASK_A,
          JSON.stringify([{ kind: "reservation", reservationId: "read-only-reservation", conservativeCharge: 5 }]),
        );
        await appendEvent(interactionLog, { itemId: "read-only-event", taskId: TASK_A, featureId: FEATURE_ID, confirmedCategory: "approval" });

        let writes = 0;
        const readOnlyStore: Store = {
          get: <T>(sql: string, ...params: unknown[]): T | undefined => store.get<T>(sql, ...params),
          all: <T>(sql: string, ...params: unknown[]): T[] => store.all<T>(sql, ...params),
          run: (): void => {
            writes++;
          },
          close: (): void => store.close(),
        };

        const summary = await getFeatureSummary(FEATURE_ID, { interactionLog, store: readOnlyStore });

        assert.equal(summary.netCost, 5);
        assert.equal(writes, 0, "feature summary aggregation must not call store.run()");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
