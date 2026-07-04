import type { Store } from "../foundations/sqlite-store.ts";
import type { TaskRow } from "./dispatch.ts";
import { dispatchable } from "./dispatch.ts";

// ---------------------------------------------------------------------------
// Scheduler-owned DDL: dispatched_generation column on scheduler_task
//
// ALTER TABLE has no IF NOT EXISTS in SQLite — guard with PRAGMA table_info.
// ---------------------------------------------------------------------------

function applyGenerationMigration(store: Store): void {
  const cols = store.all<{ name: string }>(
    "PRAGMA table_info(scheduler_task)",
  );
  // Table absent — nothing to migrate; ALTER TABLE would throw "no such table".
  if (cols.length === 0) return;
  if (!cols.some((c) => c.name === "dispatched_generation")) {
    store.run(
      "ALTER TABLE scheduler_task ADD COLUMN dispatched_generation INTEGER",
    );
  }
}

// ---------------------------------------------------------------------------
// pinGeneration — stamps the task's current plan_node.generation into
// dispatched_generation exactly once (no-op if already pinned).
// ---------------------------------------------------------------------------

export function pinGeneration(store: Store, taskId: string): void {
  applyGenerationMigration(store);

  // Read the current generation from the compiled plan.
  const nodeRow = store.get<{ generation: number }>(
    "SELECT generation FROM plan_node WHERE id = ?",
    taskId,
  );
  if (nodeRow === undefined) return;

  // Conditional update: only writes when the column is still NULL (first dispatch).
  store.run(
    "UPDATE scheduler_task SET dispatched_generation = ? WHERE node_id = ? AND dispatched_generation IS NULL",
    nodeRow.generation,
    taskId,
  );
}

// ---------------------------------------------------------------------------
// getPinnedGeneration — returns the dispatched_generation for taskId,
// or null if the task has never been dispatched.
// ---------------------------------------------------------------------------

export function getPinnedGeneration(
  store: Store,
  taskId: string,
): number | null {
  applyGenerationMigration(store);

  // Guard: if the table still doesn't exist (store is fresh), no task has
  // ever been dispatched — return null without querying.
  const cols = store.all<{ name: string }>("PRAGMA table_info(scheduler_task)");
  if (cols.length === 0) return null;

  const row = store.get<{ dispatched_generation: number | null }>(
    "SELECT dispatched_generation FROM scheduler_task WHERE node_id = ?",
    taskId,
  );

  // row undefined (no such task) or dispatched_generation NULL → null
  return row?.dispatched_generation ?? null;
}

// ---------------------------------------------------------------------------
// isPlanDirty — returns true when liveHash differs from the compile_hash of
// the latest plan_generation row for the feature (or when no row exists).
// ---------------------------------------------------------------------------

export function isPlanDirty(
  store: Store,
  featureId: string,
  liveHash: string,
): boolean {
  const row = store.get<{ compile_hash: string }>(
    "SELECT compile_hash FROM plan_generation WHERE feature_id = ? ORDER BY generation DESC LIMIT 1",
    featureId,
  );
  if (row === undefined) return true;
  return row.compile_hash !== liveHash;
}

// ---------------------------------------------------------------------------
// dispatchableForGeneration — halts all new dispatch when the plan is dirty;
// otherwise delegates to dispatchable() from dispatch.ts.
// ---------------------------------------------------------------------------

export function dispatchableForGeneration(
  store: Store,
  featureId: string,
  liveHash: string,
): TaskRow[] {
  if (isPlanDirty(store, featureId, liveHash)) {
    return [];
  }
  return dispatchable(store, featureId);
}
