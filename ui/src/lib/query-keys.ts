// ui/src/lib/query-keys.ts — Decision 11: fixed query-key hierarchy.
// A digest.latest change invalidates the overview key ONLY.

import type { QueryClient } from "@tanstack/react-query";
import type { ResourceTypeKey } from "./dto";

export const projectKeys = {
  all: () => ["project"] as const,
  list: (name?: string) =>
    name === undefined || name === ""
      ? (["project"] as const)
      : (["project", { name }] as const),
  detail: (id: string) => ["project", id] as const,
  overview: (id: string) => ["project", id, "overview"] as const,
  resources: (id: string, type: ResourceTypeKey, name?: string) =>
    name === undefined || name === ""
      ? (["project", id, "resource", type] as const)
      : (["project", id, "resource", type, { name }] as const),
};

export const resourceKeys = {
  detail: (id: string) => ["resource", id] as const,
};

/** Decision 11: a `digest.latest` change invalidates the overview key ONLY. */
export function invalidateOverview(
  client: QueryClient,
  projectId: string,
): Promise<void> {
  return client.invalidateQueries({
    queryKey: projectKeys.overview(projectId),
    exact: true,
  });
}

// --- Story 01: entity workspace query keys ---

export const initiativeKeys = {
  list: (projectId: string) => ["project", projectId, "initiative"] as const,
  detail: (id: string) => ["initiative", id] as const,
};

export const objectiveKeys = {
  list: (initiativeId: string) =>
    ["initiative", initiativeId, "objective"] as const,
  detail: (id: string) => ["objective", id] as const,
};

export const taskKeys = {
  list: (initiativeId: string, objectiveId?: string) =>
    objectiveId === undefined
      ? (["initiative", initiativeId, "task"] as const)
      : ([
          "initiative",
          initiativeId,
          "task",
          { objective: objectiveId },
        ] as const),
  detail: (id: string) => ["task", id] as const,
};
