// S5 — query option factories for TanStack Query.
// healthQueryOptions and projectQueryOptions return plain { queryKey, queryFn } objects.
// useProjectSummary wraps projectQueryOptions with useQuery.
import type { UseQueryResult } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "./api-client";

export interface Health {
  readonly status: string;
  readonly version: string;
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
}

export function healthQueryOptions() {
  return {
    queryKey: ["healthz"] as const,
    queryFn: (ctx?: { readonly signal?: AbortSignal }): Promise<Health> =>
      apiGet<Health>("/healthz", { signal: ctx?.signal }),
  };
}

export function projectQueryOptions(id: string) {
  return {
    queryKey: ["project", id] as const,
    queryFn: (ctx?: {
      readonly signal?: AbortSignal;
    }): Promise<ProjectSummary> =>
      apiGet<ProjectSummary>(`/api/project/${id}`, { signal: ctx?.signal }),
  };
}

export function useProjectSummary(
  id: string,
): UseQueryResult<ProjectSummary, Error> {
  return useQuery(projectQueryOptions(id));
}
