// ui/src/lib/invalidation.ts — the invalidation matrix (EPIC 026, decision 5).
//
// Every mutation that writes to the hierarchy maps to a set of query-key
// targets. invalidateFor() translates those targets into QueryClient calls.
// A row whose context field is missing throws — it never silently invalidates less.

import type { QueryClient } from "@tanstack/react-query";
import {
  projectKeys,
  initiativeKeys,
  objectiveKeys,
  taskKeys,
} from "./query-keys";

export type MutationName =
  | "project.create"
  | "project.rename"
  | "initiative.create"
  | "initiative.rename"
  | "objective.create"
  | "objective.rename"
  | "task.create"
  | "dependency.write";

export interface InvalidationTarget {
  readonly queryKey: readonly unknown[];
  readonly exact: boolean;
  /** Narrows a prefix match; used only by the project-list row. */
  readonly predicate?: (queryKey: readonly unknown[]) => boolean;
}

export interface InvalidationContext {
  readonly projectId?: string;
  readonly initiativeId?: string;
  readonly objectiveId?: string;
  readonly id?: string;
  /** The source entity's detail key, for `dependency.write`. */
  readonly entityKey?: readonly unknown[];
}

/**
 * Returns a target that matches project list keys exactly:
 * - `["project"]` (projectKeys.list())
 * - `["project", { name }]` (projectKeys.list(name))
 * but NOT `["project", id]` or `["project", id, "overview"]` etc.
 */
export function projectListTarget(): InvalidationTarget {
  return {
    queryKey: ["project"],
    exact: false,
    predicate: (key) =>
      key.length === 1 ||
      (key.length === 2 &&
        typeof key[1] === "object" &&
        key[1] !== null &&
        !Array.isArray(key[1])),
  };
}

function requireField<K extends keyof InvalidationContext>(
  ctx: InvalidationContext,
  field: K,
  mutation: MutationName,
): NonNullable<InvalidationContext[K]> {
  const value = ctx[field];
  if (value === undefined || value === null) {
    throw new Error(`invalidation ${mutation} needs ctx.${String(field)}`);
  }
  return value as NonNullable<InvalidationContext[K]>;
}

export const INVALIDATION_MATRIX: Readonly<
  Record<
    MutationName,
    (ctx: InvalidationContext) => readonly InvalidationTarget[]
  >
> = {
  "project.create": () => [projectListTarget()],

  "project.rename": (ctx) => {
    const id = requireField(ctx, "id", "project.rename");
    return [
      projectListTarget(),
      { queryKey: projectKeys.detail(id), exact: true },
      { queryKey: projectKeys.overview(id), exact: true },
    ];
  },

  "initiative.create": (ctx) => {
    const projectId = requireField(ctx, "projectId", "initiative.create");
    return [
      { queryKey: initiativeKeys.list(projectId), exact: true },
      { queryKey: projectKeys.overview(projectId), exact: true },
    ];
  },

  "initiative.rename": (ctx) => {
    const projectId = requireField(ctx, "projectId", "initiative.rename");
    const id = requireField(ctx, "id", "initiative.rename");
    return [
      { queryKey: initiativeKeys.list(projectId), exact: true },
      { queryKey: projectKeys.overview(projectId), exact: true },
      { queryKey: initiativeKeys.detail(id), exact: true },
    ];
  },

  "objective.create": (ctx) => {
    const initiativeId = requireField(ctx, "initiativeId", "objective.create");
    const projectId = requireField(ctx, "projectId", "objective.create");
    return [
      { queryKey: objectiveKeys.list(initiativeId), exact: true },
      { queryKey: projectKeys.overview(projectId), exact: true },
    ];
  },

  "objective.rename": (ctx) => {
    const initiativeId = requireField(ctx, "initiativeId", "objective.rename");
    const projectId = requireField(ctx, "projectId", "objective.rename");
    const id = requireField(ctx, "id", "objective.rename");
    return [
      { queryKey: objectiveKeys.list(initiativeId), exact: true },
      { queryKey: projectKeys.overview(projectId), exact: true },
      { queryKey: objectiveKeys.detail(id), exact: true },
    ];
  },

  "task.create": (ctx) => {
    const initiativeId = requireField(ctx, "initiativeId", "task.create");
    const projectId = requireField(ctx, "projectId", "task.create");
    return [
      { queryKey: taskKeys.list(initiativeId), exact: false },
      { queryKey: projectKeys.overview(projectId), exact: true },
    ];
  },

  "dependency.write": (ctx) => {
    const entityKey = requireField(ctx, "entityKey", "dependency.write");
    const projectId = requireField(ctx, "projectId", "dependency.write");
    return [
      { queryKey: entityKey, exact: true },
      { queryKey: projectKeys.overview(projectId), exact: true },
    ];
  },
} as const;

export async function invalidateFor(
  client: QueryClient,
  mutation: MutationName,
  ctx: InvalidationContext,
): Promise<void> {
  const targets = INVALIDATION_MATRIX[mutation](ctx);
  await Promise.all(
    targets.map((target) =>
      client.invalidateQueries({
        queryKey: target.queryKey,
        exact: target.exact,
        ...(target.predicate
          ? {
              predicate: (q: { queryKey: readonly unknown[] }) =>
                target.predicate!(q.queryKey),
            }
          : {}),
      }),
    ),
  );
}
