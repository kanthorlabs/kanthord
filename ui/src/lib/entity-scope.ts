// Story 01 — scope validation and gate resolution (decisions 1–3).
// Story 05 — siblingTaskHref for dependency linking (decision 6).
// Pure module: no React, no fetch, no hooks.

import type { AsyncState } from "./async-state";
import type {
  InitiativeRowDto,
  ObjectiveRowDto,
  TaskDetailDto,
  ResourceDto,
} from "./dto";

// --- scope types ---

export type ScopeLevel =
  | "chain"
  | "initiative"
  | "objective"
  | "task"
  | "resource-type"
  | "resource-project";

export interface ScopeMismatchInfo {
  readonly level: ScopeLevel;
  /** The noun the sentence names, e.g. "task". */
  readonly what: string;
  /** The value the URL claims. */
  readonly expected: string;
  /** The entity's real value, or `null` when it cannot be read. */
  readonly actual: string | null;
  /** A router path (no leading `#`), or `null` when it cannot be computed. */
  readonly correctHref: string | null;
}

// --- scope functions (pinned rules, first match wins) ---

export function initiativeScope(args: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly rows: readonly InitiativeRowDto[];
}): ScopeMismatchInfo | null {
  const { projectId, initiativeId, rows } = args;
  const row = rows.find((r) => r.id === initiativeId);
  if (!row) {
    return {
      level: "initiative",
      what: "initiative",
      expected: projectId,
      actual: null,
      correctHref: null,
    };
  }
  if (row.projectId !== projectId) {
    return {
      level: "initiative",
      what: "initiative",
      expected: projectId,
      actual: row.projectId,
      correctHref: `/project/${row.projectId}/initiative/${initiativeId}`,
    };
  }
  return null;
}

export function objectiveScope(args: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly rows: readonly ObjectiveRowDto[];
}): ScopeMismatchInfo | null {
  const { projectId, initiativeId, objectiveId, rows } = args;
  const row = rows.find((r) => r.id === objectiveId);
  if (!row) {
    return {
      level: "objective",
      what: "objective",
      expected: initiativeId,
      actual: null,
      correctHref: null,
    };
  }
  if (row.initiativeId !== initiativeId) {
    return {
      level: "objective",
      what: "objective",
      expected: initiativeId,
      actual: row.initiativeId,
      correctHref: `/project/${projectId}/initiative/${row.initiativeId}/objective/${objectiveId}`,
    };
  }
  return null;
}

export function taskScope(args: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly taskId: string;
  readonly task: TaskDetailDto;
  readonly objectiveRows: readonly ObjectiveRowDto[] | undefined;
}): ScopeMismatchInfo | null {
  const { projectId, initiativeId, objectiveId, taskId, task, objectiveRows } =
    args;
  if (task.objectiveId === objectiveId) {
    return null;
  }
  const hasRealObjective =
    objectiveRows !== undefined &&
    objectiveRows.some((r) => r.id === task.objectiveId);
  return {
    level: "task",
    what: "task",
    expected: objectiveId,
    actual: task.objectiveId,
    correctHref: hasRealObjective
      ? `/project/${projectId}/initiative/${initiativeId}/objective/${task.objectiveId}/task/${taskId}`
      : null,
  };
}

export function resourceScope(args: {
  readonly projectId: string;
  readonly type: string;
  readonly resource: ResourceDto;
}): ScopeMismatchInfo | null {
  const { projectId, type, resource } = args;
  if (resource.type !== type) {
    return {
      level: "resource-type",
      what: "resource",
      expected: type,
      actual: resource.type,
      correctHref: `/project/${projectId}/resource/${resource.type}/${resource.id}`,
    };
  }
  if (
    "projectId" in resource &&
    resource.projectId !== undefined &&
    resource.projectId !== projectId
  ) {
    return {
      level: "resource-project",
      what: "resource",
      expected: projectId,
      actual: resource.projectId,
      correctHref: `/project/${resource.projectId}/resource/${type}/${resource.id}`,
    };
  }
  return null;
}

// --- gate types and resolution ---

export interface GateQuery {
  /** The noun AsyncBoundary names, e.g. "initiative". */
  readonly what: string;
  readonly state: AsyncState;
  readonly message?: string;
  /** Exactly one query in the array is the `"entity"`; the rest are ancestors. */
  readonly role: "ancestor" | "entity";
}

export type Gate =
  | {
      readonly kind: "async";
      readonly state: AsyncState;
      readonly what: string;
      readonly message?: string;
    }
  | { readonly kind: "mismatch"; readonly info: ScopeMismatchInfo }
  | null;

/**
 * Pinned order — first match wins:
 * 1. first query with state === "loading" → async loading
 * 2. entity query with state === "missing" → async missing
 * 3. first ancestor with state === "missing" → mismatch (chain)
 * 4. first query with state === "error" → async error
 * 5. mismatch !== null → mismatch
 * 6. otherwise null
 */
export function resolveGate(input: {
  /** Ancestors first, the entity last. */
  readonly queries: readonly GateQuery[];
  readonly mismatch: ScopeMismatchInfo | null;
}): Gate {
  const { queries, mismatch } = input;

  // Rule 1: first loading
  for (const q of queries) {
    if (q.state === "loading") {
      return { kind: "async", state: "loading", what: q.what };
    }
  }

  // Rule 2: entity missing
  for (const q of queries) {
    if (q.role === "entity" && q.state === "missing") {
      return { kind: "async", state: "missing", what: q.what };
    }
  }

  // Rule 3: ancestor missing → chain mismatch
  for (const q of queries) {
    if (q.role === "ancestor" && q.state === "missing") {
      return {
        kind: "mismatch",
        info: {
          level: "chain",
          what: q.what,
          expected: "",
          actual: null,
          correctHref: null,
        },
      };
    }
  }

  // Rule 4: first error
  for (const q of queries) {
    if (q.state === "error") {
      return {
        kind: "async",
        state: "error",
        what: q.what,
        message: q.message,
      };
    }
  }

  // Rule 5: mismatch
  if (mismatch !== null) {
    return { kind: "mismatch", info: mismatch };
  }

  // Rule 6: all clear
  return null;
}

// --- siblingTaskHref (Story 05, decision 6) ---

/**
 * The URL of a dependency that lives in the same objective, or `null`. Decision
 * 6: a blocking id is linked only when it is in the same chain.
 */
export function siblingTaskHref(args: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly taskId: string;
  readonly siblingIds: readonly string[] | undefined;
}): string | null {
  if (args.siblingIds !== undefined && args.siblingIds.includes(args.taskId)) {
    return (
      "/project/" +
      args.projectId +
      "/initiative/" +
      args.initiativeId +
      "/objective/" +
      args.objectiveId +
      "/task/" +
      args.taskId
    );
  }
  return null;
}
