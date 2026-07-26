import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";

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
