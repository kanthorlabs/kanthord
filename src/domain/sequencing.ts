import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";
import type { TaskStatus } from "./task.ts";

export interface UnsatisfiedEdge {
  id: string;
  neverSatisfies: boolean;
}

/**
 * Returns `true` when an initiative's edge is satisfied.
 * Only `"landed"` satisfies an initiative edge.
 */
export function initiativeEdgeSatisfied(
  status: InitiativeStatus | undefined,
): boolean {
  return status === "landed";
}

/**
 * Returns `true` when an objective's edge is satisfied.
 * Only `"integrated"` satisfies an objective edge.
 */
export function objectiveEdgeSatisfied(
  status: ObjectiveStatus | undefined,
): boolean {
  return status === "integrated";
}

/**
 * For each entry in `after`, yields an `UnsatisfiedEdge` when the entry's
 * status does NOT satisfy the initiative edge. Input order is preserved.
 */
export function unsatisfiedInitiativeEdges(
  after: ReadonlyArray<{ id: string; status?: InitiativeStatus }>,
): UnsatisfiedEdge[] {
  const result: UnsatisfiedEdge[] = [];
  for (const entry of after) {
    if (!initiativeEdgeSatisfied(entry.status)) {
      result.push({
        id: entry.id,
        neverSatisfies: entry.status === "discarded",
      });
    }
  }
  return result;
}

/**
 * For each entry in `after`, yields an `UnsatisfiedEdge` when the entry's
 * status does NOT satisfy the objective edge. Input order is preserved.
 */
export function unsatisfiedObjectiveEdges(
  after: ReadonlyArray<{ id: string; status?: ObjectiveStatus }>,
): UnsatisfiedEdge[] {
  const result: UnsatisfiedEdge[] = [];
  for (const entry of after) {
    if (!objectiveEdgeSatisfied(entry.status)) {
      result.push({
        id: entry.id,
        neverSatisfies: entry.status === "discarded",
      });
    }
  }
  return result;
}

/**
 * Error thrown when a sequencing edge is refused because the dependent has
 * already started work (has at least one task past `pending`).
 */
export class SequencingLockedError extends Error {
  readonly nodeId: string;
  readonly startedTaskIds: string[];

  constructor(nodeId: string, startedTaskIds: string[]) {
    const ids = startedTaskIds.join(", ");
    super(
      `Sequencing edge refused: ${nodeId} has already started (tasks: ${ids}); ordering can no longer be guaranteed`,
    );
    this.name = "SequencingLockedError";
    this.nodeId = nodeId;
    this.startedTaskIds = startedTaskIds;
  }
}

/**
 * Error thrown when a sequencing edge crosses a boundary that is not allowed:
 * objectives across different initiatives (`scope = "initiative"`) or
 * initiatives across different projects (`scope = "project"`).
 */
export class SequencingScopeError extends Error {
  readonly dependentId: string;
  readonly dependencyId: string;
  readonly scope: string;

  constructor(dependentId: string, dependencyId: string, scope: string) {
    super(
      `Sequencing edge refused: ${dependentId} and ${dependencyId} are not in the same ${scope}`,
    );
    this.name = "SequencingScopeError";
    this.dependentId = dependentId;
    this.dependencyId = dependencyId;
    this.scope = scope;
  }
}

// ---------------------------------------------------------------------------
// Story 1 (016) — task edge permanence
// ---------------------------------------------------------------------------

export interface TaskEdgeNode {
  id: string;
  status: TaskStatus;
  dependencies: readonly string[];
}

/**
 * Returns `true` when a task's edge is satisfied. Only `"completed"` satisfies.
 * `undefined` (unknown dependency id) returns `false`.
 */
export function taskEdgeSatisfied(status: TaskStatus | undefined): boolean {
  return status === "completed";
}

/**
 * Ids of nodes that can never become runnable through task status transitions
 * alone, given the current dependency graph. The qualifier matters: removing
 * dependencies while a task is `pending` is always legal, so no edge is
 * permanent against graph edits.
 *
 * `failed` is **not** permanent (`failed->pending` is a legal transition).
 * Only `discarded` (terminal — no entry in `LEGAL_TRANSITIONS` for
 * `discarded->*`) and transitive closure over a `discarded` source make a
 * `pending` node permanent.
 */
export function permanentlyBlockedTasks(
  nodes: readonly TaskEdgeNode[],
): Set<string> {
  const statusOf = new Map<string, TaskStatus>();
  for (const n of nodes) statusOf.set(n.id, n.status);

  const blocked = new Set<string>();
  // Fixpoint: each pass scans all nodes; a pass that adds nothing ends the loop.
  // The result is independent of input order because the membership test
  // (statusOf(d) === "discarded" || blocked.has(d)) does not depend on scan
  // order, only on the current set.
  while (true) {
    let added = false;
    for (const n of nodes) {
      if (n.status !== "pending") continue;
      if (blocked.has(n.id)) continue;
      const permanentlyBlocking = n.dependencies.some(
        (d) => statusOf.get(d) === "discarded" || blocked.has(d),
      );
      if (permanentlyBlocking) {
        blocked.add(n.id);
        added = true;
      }
    }
    if (!added) break;
  }
  return blocked;
}

/**
 * Per-node unsatisfied task edges, keyed by node id. Insertion order equals
 * input order; each array preserves the node's own `dependencies` order.
 *
 * Non-`pending` nodes map to `[]` (they are not waiting on anything — only
 * `pending` is the actionable state for the read model).
 */
export function unsatisfiedTaskEdges(
  nodes: readonly TaskEdgeNode[],
): Map<string, UnsatisfiedEdge[]> {
  const statusOf = new Map<string, TaskStatus>();
  for (const n of nodes) statusOf.set(n.id, n.status);

  const blocked = permanentlyBlockedTasks(nodes);

  const result = new Map<string, UnsatisfiedEdge[]>();
  for (const n of nodes) {
    if (n.status !== "pending") {
      result.set(n.id, []);
      continue;
    }
    const edges: UnsatisfiedEdge[] = [];
    for (const d of n.dependencies) {
      const depStatus = statusOf.get(d);
      if (taskEdgeSatisfied(depStatus)) continue;
      edges.push({
        id: d,
        neverSatisfies: depStatus === "discarded" || blocked.has(d),
      });
    }
    result.set(n.id, edges);
  }
  return result;
}
