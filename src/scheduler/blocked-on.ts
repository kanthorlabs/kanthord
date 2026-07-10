import type { Store } from "../foundations/sqlite-store.ts";
import type { Capability, LeaseManager } from "./leases.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ResumeContext = {
  taskId: string;
  resultJson: string | null;
  errorJson: string | null;
};

// ---------------------------------------------------------------------------
// park — records that a task is waiting on an async op.
//
// Persists the task's current capabilities (so resume can re-acquire them),
// sets blocked_on = opId on the scheduler_task row, and releases all leases
// held by the task so other tasks can proceed in the same poll pass.
// ---------------------------------------------------------------------------

export function park(
  store: Store,
  taskId: string,
  opId: string,
  capabilities: Capability[],
  lm: LeaseManager,
): void {
  // Persist capabilities for re-acquisition on resume (idempotent: delete first).
  store.run("DELETE FROM blocked_on_capability WHERE task_id = ?", taskId);
  for (const cap of capabilities) {
    const capValue = cap.kind === "write_scope" ? cap.path : cap.key;
    store.run(
      "INSERT INTO blocked_on_capability (task_id, cap_kind, cap_value) VALUES (?, ?, ?)",
      taskId,
      cap.kind,
      capValue,
    );
  }

  // Mark the task row as blocked on the given op.
  store.run(
    "UPDATE scheduler_task SET blocked_on = ? WHERE node_id = ?",
    opId,
    taskId,
  );

  // Release leases immediately so other tasks can acquire them.
  lm.release(taskId);
}

// ---------------------------------------------------------------------------
// writeCompletion — records the result of a broker op.
//
// This is the write contract that Epic 005's real broker will also use.
// Idempotent: INSERT OR REPLACE overwrites any prior row for the same op_id.
// ---------------------------------------------------------------------------

export function writeCompletion(
  store: Store,
  opId: string,
  status: "done" | "failed",
  resultJson: string | null,
  errorJson: string | null,
  at: number,
): void {
  store.run(
    `INSERT OR REPLACE INTO broker_completion
       (op_id, status, result_json, error_json, at)
     VALUES (?, ?, ?, ?, ?)`,
    opId,
    status,
    resultJson,
    errorJson,
    at,
  );
}

// ---------------------------------------------------------------------------
// resume — re-dispatches tasks whose blocking op has completed.
//
// Finds all scheduler_task rows for the feature where blocked_on IS NOT NULL
// and a matching broker_completion row exists.  For each such task:
//   1. Reconstructs the persisted capabilities.
//   2. Re-acquires the leases via lm.acquire.
//   3. Clears blocked_on (sets to NULL) and resets status = 'pending' so
//      dispatchable() sees the task again.
//   4. Removes the stored capability rows.
// Returns one ResumeContext per resumed task, carrying the completion result.
// ---------------------------------------------------------------------------

export function resume(
  store: Store,
  featureId: string,
  lm: LeaseManager,
): ResumeContext[] {
  // Tasks parked on a now-completed op.
  const parked = store.all<{
    node_id: string;
    blocked_on: string;
    result_json: string | null;
    error_json: string | null;
  }>(
    `SELECT st.node_id, st.blocked_on, bc.result_json, bc.error_json
     FROM scheduler_task st
     JOIN broker_completion bc ON bc.op_id = st.blocked_on
     WHERE st.feature_id = ? AND st.blocked_on IS NOT NULL`,
    featureId,
  );

  const contexts: ResumeContext[] = [];

  for (const row of parked) {
    // Reconstruct the capability list that was stored at park time.
    const capRows = store.all<{ cap_kind: string; cap_value: string }>(
      "SELECT cap_kind, cap_value FROM blocked_on_capability WHERE task_id = ?",
      row.node_id,
    );
    const capabilities: Capability[] = capRows.map((cr) => {
      if (cr.cap_kind === "write_scope") {
        return { kind: "write_scope" as const, path: cr.cap_value };
      }
      return { kind: "resource" as const, key: cr.cap_value };
    });

    // Re-acquire leases before making the task dispatchable again.
    // If acquire returns false (a competing holder still holds an overlapping
    // capability), leave the task fully parked so it retries on the next poll.
    const acquired = lm.acquire(row.node_id, capabilities);
    if (!acquired) continue;

    // Clear blocked_on and restore pending status.
    store.run(
      "UPDATE scheduler_task SET blocked_on = NULL, status = 'pending' WHERE node_id = ?",
      row.node_id,
    );

    // Clean up persisted capability rows.
    store.run(
      "DELETE FROM blocked_on_capability WHERE task_id = ?",
      row.node_id,
    );

    contexts.push({
      taskId: row.node_id,
      resultJson: row.result_json,
      errorJson: row.error_json,
    });
  }

  return contexts;
}
