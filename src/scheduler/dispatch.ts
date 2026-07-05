import type { Store } from "../foundations/sqlite-store.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TaskRow = {
  id: string;
  feature_id: string;
  depends_on: string[];
  status: string;
  generation: number;
};

// ---------------------------------------------------------------------------
// Scheduler-owned migration (idempotent DDL)
// ---------------------------------------------------------------------------

function applySchedulerMigration(store: Store): void {
  store.run(
    `CREATE TABLE IF NOT EXISTS scheduler_task (
      node_id          TEXT NOT NULL PRIMARY KEY,
      feature_id       TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending',
      exit_gate_passed INTEGER NOT NULL DEFAULT 0
    )`,
  );
  // Upgrade path: add blocked_on for park/resume support (Story 003).
  // ALTER TABLE has no IF NOT EXISTS in SQLite — guard with PRAGMA table_info.
  const cols = store.all<{ name: string }>("PRAGMA table_info(scheduler_task)");
  if (!cols.some((c) => c.name === "blocked_on")) {
    store.run("ALTER TABLE scheduler_task ADD COLUMN blocked_on TEXT");
  }
}

// ---------------------------------------------------------------------------
// loadTasks — returns task/deploy-stage rows for a feature from the compiled plan
//
// Applies the scheduler migration (idempotent), initialises any new task or
// deploy-stage nodes into scheduler_task with status="pending" (INSERT OR IGNORE),
// then returns one TaskRow per task/deploy-stage plan_node, with depends_on built
// from the distinct task/deploy-stage predecessors in plan_edge.
// ---------------------------------------------------------------------------

export function loadTasks(store: Store, featureId: string): TaskRow[] {
  applySchedulerMigration(store);

  // All task-kind and deploy-stage-kind nodes for the feature
  const nodes = store.all<{ id: string; generation: number }>(
    "SELECT id, generation FROM plan_node WHERE feature_id = ? AND kind IN ('task','deploy-stage')",
    featureId,
  );

  // Initialise scheduler rows for new tasks (idempotent)
  for (const node of nodes) {
    store.run(
      "INSERT OR IGNORE INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, 'pending')",
      node.id,
      featureId,
    );
  }

  // Build TaskRow per node
  return nodes.map((node) => {
    // Distinct task/deploy-stage predecessors (deduplicates grammar + handoff edges)
    const predecessors = store.all<{ from_node_id: string }>(
      `SELECT DISTINCT pe.from_node_id
       FROM plan_edge pe
       JOIN plan_node pn_from ON pe.from_node_id = pn_from.id AND pn_from.kind IN ('task','deploy-stage')
       WHERE pe.to_node_id = ?`,
      node.id,
    );

    const statusRow = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = ?",
      node.id,
    );

    return {
      id: node.id,
      feature_id: featureId,
      depends_on: predecessors.map((p) => p.from_node_id),
      status: statusRow?.status ?? "pending",
      generation: node.generation,
    };
  });
}

// ---------------------------------------------------------------------------
// dispatchable — returns pending nodes whose every task/deploy-stage predecessor
// has a passed exit gate (i.e., all entries in depends_on[] have exit_gate_passed=1).
// Root nodes (no task/deploy-stage predecessors) are always dispatchable.
// ---------------------------------------------------------------------------

export function dispatchable(store: Store, featureId: string): TaskRow[] {
  applySchedulerMigration(store);

  // Pending tasks where no task/deploy-stage predecessor is blocking (gate not yet passed)
  const ready = store.all<{ node_id: string; generation: number }>(
    `SELECT DISTINCT st.node_id, pn.generation
     FROM scheduler_task st
     JOIN plan_node pn ON pn.id = st.node_id
     WHERE st.feature_id = ?
       AND st.status = 'pending'
       AND st.blocked_on IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM plan_edge pe
         JOIN plan_node pn_from
           ON pe.from_node_id = pn_from.id AND pn_from.kind IN ('task','deploy-stage')
         LEFT JOIN scheduler_task st_dep
           ON st_dep.node_id = pe.from_node_id
         WHERE pe.to_node_id = st.node_id
           AND (st_dep.node_id IS NULL OR st_dep.exit_gate_passed = 0)
       )`,
    featureId,
  );

  // Build full TaskRow for each dispatchable node
  return ready.map((node) => {
    const predecessors = store.all<{ from_node_id: string }>(
      `SELECT DISTINCT pe.from_node_id
       FROM plan_edge pe
       JOIN plan_node pn_from ON pe.from_node_id = pn_from.id AND pn_from.kind IN ('task','deploy-stage')
       WHERE pe.to_node_id = ?`,
      node.node_id,
    );
    return {
      id: node.node_id,
      feature_id: featureId,
      depends_on: predecessors.map((p) => p.from_node_id),
      status: "pending",
      generation: node.generation,
    };
  });
}

// ---------------------------------------------------------------------------
// markExitGatePassed — records that the named task node's exit gate has passed.
// This is the write path that the real workflow engine will use (Epic 006).
// ---------------------------------------------------------------------------

export function markExitGatePassed(store: Store, nodeId: string): void {
  applySchedulerMigration(store);
  store.run(
    "UPDATE scheduler_task SET exit_gate_passed = 1 WHERE node_id = ?",
    nodeId,
  );
}

// ---------------------------------------------------------------------------
// setTaskStatus — updates the status field for the named task node.
// ---------------------------------------------------------------------------

export function setTaskStatus(
  store: Store,
  nodeId: string,
  status: string,
): void {
  applySchedulerMigration(store);
  store.run(
    "UPDATE scheduler_task SET status = ? WHERE node_id = ?",
    status,
    nodeId,
  );
}
