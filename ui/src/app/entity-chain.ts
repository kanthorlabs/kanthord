// Story 01 — chain hooks: one hook per entity, reads ancestors + entity, computes gate.
// Story 02 — each hook exposes `segments` for breadcrumb rendering.
import { useQuery } from "@tanstack/react-query";

import type { Gate, ScopeMismatchInfo } from "@/lib/entity-scope";
import type { AsyncState } from "@/lib/async-state";
import type {
  InitiativeDetailDto,
  ObjectiveRowDto,
  ObjectiveDetailDto,
  TaskDetailDto,
  ResourceDto,
} from "@/lib/dto";
import { RESOURCE_TYPE_LABEL } from "@/lib/dto";
import { asyncStateOf } from "@/lib/async-state";
import {
  fetchInitiatives,
  fetchInitiative,
  fetchObjectives,
  fetchObjective,
  fetchTasks,
  fetchTask,
  fetchResource,
} from "@/lib/api-client";
import { useProjectSummary } from "@/lib/queries";
import {
  initiativeKeys,
  objectiveKeys,
  taskKeys,
  resourceKeys,
} from "@/lib/query-keys";
import {
  resolveGate,
  initiativeScope,
  objectiveScope,
  taskScope,
  resourceScope,
} from "@/lib/entity-scope";

/** Drops every level whose name has not resolved. Never falls back to an id. */
function trail(...names: readonly (string | undefined)[]): readonly string[] {
  return names.filter((n): n is string => n !== undefined);
}

// --- useInitiativeChain ---

export interface InitiativeChain {
  readonly gate: Gate;
  readonly initiative: InitiativeDetailDto | undefined;
  readonly objectiveRows: readonly ObjectiveRowDto[] | undefined;
  readonly projectName: string | undefined;
  readonly objectivesState: AsyncState;
  readonly objectivesMessage: string | undefined;
  readonly segments: readonly string[];
}

export function useInitiativeChain({
  projectId,
  initiativeId,
}: {
  readonly projectId: string;
  readonly initiativeId: string;
}): InitiativeChain {
  const projectQuery = useProjectSummary(projectId);

  const initiativeListQuery = useQuery({
    queryKey: initiativeKeys.list(projectId),
    queryFn: ({ signal }) => fetchInitiatives(projectId, { signal }),
    staleTime: Infinity,
  });

  const initiativeQuery = useQuery({
    queryKey: initiativeKeys.detail(initiativeId),
    queryFn: ({ signal }) => fetchInitiative(initiativeId, { signal }),
    staleTime: Infinity,
  });

  const objectivesQuery = useQuery({
    queryKey: objectiveKeys.list(initiativeId),
    queryFn: ({ signal }) => fetchObjectives(initiativeId, { signal }),
    staleTime: Infinity,
  });

  const projectState = asyncStateOf(projectQuery);
  const initiativeListState = asyncStateOf(initiativeListQuery);
  const initiativeState = asyncStateOf(initiativeQuery);
  const objectivesState = asyncStateOf(objectivesQuery);

  const gateQueries = [
    { what: "project", state: projectState, role: "ancestor" as const },
    {
      what: "initiative list",
      state: initiativeListState,
      role: "ancestor" as const,
    },
    { what: "initiative", state: initiativeState, role: "entity" as const },
  ];

  let mismatch: ScopeMismatchInfo | null = null;
  if (
    initiativeState === "resolved" &&
    initiativeListState === "resolved" &&
    initiativeQuery.data &&
    initiativeListQuery.data
  ) {
    mismatch = initiativeScope({
      projectId,
      initiativeId,
      rows: initiativeListQuery.data,
    });
  }

  const gate = resolveGate({ queries: gateQueries, mismatch });

  return {
    gate,
    initiative: initiativeQuery.data,
    objectiveRows: objectivesQuery.data,
    projectName: projectQuery.data?.name,
    objectivesState,
    objectivesMessage:
      objectivesQuery.error instanceof Error
        ? objectivesQuery.error.message
        : undefined,
    segments: trail(projectQuery.data?.name, initiativeQuery.data?.name),
  };
}

// --- useObjectiveChain ---

export interface ObjectiveChain extends InitiativeChain {
  readonly objective: ObjectiveDetailDto | undefined;
}

export function useObjectiveChain({
  projectId,
  initiativeId,
  objectiveId,
}: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
}): ObjectiveChain {
  const projectQuery = useProjectSummary(projectId);

  const initiativeListQuery = useQuery({
    queryKey: initiativeKeys.list(projectId),
    queryFn: ({ signal }) => fetchInitiatives(projectId, { signal }),
    staleTime: Infinity,
  });

  const initiativeQuery = useQuery({
    queryKey: initiativeKeys.detail(initiativeId),
    queryFn: ({ signal }) => fetchInitiative(initiativeId, { signal }),
    staleTime: Infinity,
  });

  const objectivesQuery = useQuery({
    queryKey: objectiveKeys.list(initiativeId),
    queryFn: ({ signal }) => fetchObjectives(initiativeId, { signal }),
    staleTime: Infinity,
  });

  const objectiveQuery = useQuery({
    queryKey: objectiveKeys.detail(objectiveId),
    queryFn: ({ signal }) => fetchObjective(objectiveId, { signal }),
    staleTime: Infinity,
  });

  const projectState = asyncStateOf(projectQuery);
  const initiativeListState = asyncStateOf(initiativeListQuery);
  const initiativeState = asyncStateOf(initiativeQuery);
  const objectivesState = asyncStateOf(objectivesQuery);
  const objectiveState = asyncStateOf(objectiveQuery);

  const gateQueries = [
    { what: "project", state: projectState, role: "ancestor" as const },
    {
      what: "initiative list",
      state: initiativeListState,
      role: "ancestor" as const,
    },
    { what: "initiative", state: initiativeState, role: "ancestor" as const },
    {
      what: "objectives",
      state: objectivesState,
      role: "ancestor" as const,
    },
    { what: "objective", state: objectiveState, role: "entity" as const },
  ];

  let mismatch: ScopeMismatchInfo | null = null;
  if (
    initiativeState === "resolved" &&
    initiativeListState === "resolved" &&
    initiativeQuery.data &&
    initiativeListQuery.data
  ) {
    mismatch = initiativeScope({
      projectId,
      initiativeId,
      rows: initiativeListQuery.data,
    });
  }
  if (
    mismatch === null &&
    objectiveState === "resolved" &&
    objectivesState === "resolved" &&
    objectiveQuery.data &&
    objectivesQuery.data
  ) {
    mismatch = objectiveScope({
      projectId,
      initiativeId,
      objectiveId,
      rows: objectivesQuery.data,
    });
  }

  const gate = resolveGate({ queries: gateQueries, mismatch });

  return {
    gate,
    initiative: initiativeQuery.data,
    objective: objectiveQuery.data,
    objectiveRows: objectivesQuery.data,
    projectName: projectQuery.data?.name,
    objectivesState,
    objectivesMessage:
      objectivesQuery.error instanceof Error
        ? objectivesQuery.error.message
        : undefined,
    segments: trail(
      projectQuery.data?.name,
      initiativeQuery.data?.name,
      objectiveQuery.data?.name,
    ),
  };
}

// --- useTaskChain ---

export interface TaskChain extends ObjectiveChain {
  readonly task: TaskDetailDto | undefined;
  readonly siblingTaskIds: readonly string[] | undefined;
}

export function useTaskChain({
  projectId,
  initiativeId,
  objectiveId,
  taskId,
}: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly taskId: string;
}): TaskChain {
  const projectQuery = useProjectSummary(projectId);

  const initiativeListQuery = useQuery({
    queryKey: initiativeKeys.list(projectId),
    queryFn: ({ signal }) => fetchInitiatives(projectId, { signal }),
    staleTime: Infinity,
  });

  const initiativeQuery = useQuery({
    queryKey: initiativeKeys.detail(initiativeId),
    queryFn: ({ signal }) => fetchInitiative(initiativeId, { signal }),
    staleTime: Infinity,
  });

  const objectivesQuery = useQuery({
    queryKey: objectiveKeys.list(initiativeId),
    queryFn: ({ signal }) => fetchObjectives(initiativeId, { signal }),
    staleTime: Infinity,
  });

  const objectiveQuery = useQuery({
    queryKey: objectiveKeys.detail(objectiveId),
    queryFn: ({ signal }) => fetchObjective(objectiveId, { signal }),
    staleTime: Infinity,
  });

  const taskQuery = useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: ({ signal }) => fetchTask(taskId, { signal }),
    staleTime: Infinity,
  });

  // Story 05: sibling task list, ungated — a failed query only costs dependency links.
  const siblingQuery = useQuery({
    queryKey: taskKeys.list(initiativeId, objectiveId),
    queryFn: ({ signal }) => fetchTasks(initiativeId, objectiveId, { signal }),
    staleTime: Infinity,
  });

  const projectState = asyncStateOf(projectQuery);
  const initiativeListState = asyncStateOf(initiativeListQuery);
  const initiativeState = asyncStateOf(initiativeQuery);
  const objectivesState = asyncStateOf(objectivesQuery);
  const objectiveState = asyncStateOf(objectiveQuery);
  const taskState = asyncStateOf(taskQuery);

  const gateQueries = [
    { what: "project", state: projectState, role: "ancestor" as const },
    {
      what: "initiative list",
      state: initiativeListState,
      role: "ancestor" as const,
    },
    { what: "initiative", state: initiativeState, role: "ancestor" as const },
    {
      what: "objectives",
      state: objectivesState,
      role: "ancestor" as const,
    },
    { what: "objective", state: objectiveState, role: "ancestor" as const },
    { what: "task", state: taskState, role: "entity" as const },
  ];

  let mismatch: ScopeMismatchInfo | null = null;
  if (
    initiativeState === "resolved" &&
    initiativeListState === "resolved" &&
    initiativeQuery.data &&
    initiativeListQuery.data
  ) {
    mismatch = initiativeScope({
      projectId,
      initiativeId,
      rows: initiativeListQuery.data,
    });
  }
  if (
    mismatch === null &&
    objectiveState === "resolved" &&
    objectivesState === "resolved" &&
    objectiveQuery.data &&
    objectivesQuery.data
  ) {
    mismatch = objectiveScope({
      projectId,
      initiativeId,
      objectiveId,
      rows: objectivesQuery.data,
    });
  }
  if (mismatch === null && taskState === "resolved" && taskQuery.data) {
    mismatch = taskScope({
      projectId,
      initiativeId,
      objectiveId,
      taskId,
      task: taskQuery.data,
      objectiveRows: objectivesQuery.data,
    });
  }

  const gate = resolveGate({ queries: gateQueries, mismatch });

  return {
    gate,
    initiative: initiativeQuery.data,
    objective: objectiveQuery.data,
    task: taskQuery.data,
    objectiveRows: objectivesQuery.data,
    projectName: projectQuery.data?.name,
    objectivesState,
    objectivesMessage:
      objectivesQuery.error instanceof Error
        ? objectivesQuery.error.message
        : undefined,
    segments: trail(
      projectQuery.data?.name,
      initiativeQuery.data?.name,
      objectiveQuery.data?.name,
      taskQuery.data?.title,
    ),
    siblingTaskIds: siblingQuery.data?.map((t) => t.id),
  };
}

// --- useResourceChain ---

export interface ResourceChain {
  readonly gate: Gate;
  readonly resource: ResourceDto | undefined;
  readonly projectName: string | undefined;
  readonly segments: readonly string[];
}

export function useResourceChain({
  projectId,
  type,
  resourceId,
}: {
  readonly projectId: string;
  readonly type: string;
  readonly resourceId: string;
}): ResourceChain {
  const projectQuery = useProjectSummary(projectId);

  const resourceQuery = useQuery({
    queryKey: resourceKeys.detail(resourceId),
    queryFn: ({ signal }) => fetchResource(resourceId, { signal }),
    staleTime: Infinity,
  });

  const projectState = asyncStateOf(projectQuery);
  const resourceState = asyncStateOf(resourceQuery);

  const gateQueries = [
    { what: "project", state: projectState, role: "ancestor" as const },
    { what: "resource", state: resourceState, role: "entity" as const },
  ];

  let mismatch: ScopeMismatchInfo | null = null;
  if (resourceState === "resolved" && resourceQuery.data) {
    mismatch = resourceScope({
      projectId,
      type,
      resource: resourceQuery.data,
    });
  }

  const gate = resolveGate({ queries: gateQueries, mismatch });

  return {
    gate,
    resource: resourceQuery.data,
    projectName: projectQuery.data?.name,
    segments: trail(
      projectQuery.data?.name,
      RESOURCE_TYPE_LABEL[type as keyof typeof RESOURCE_TYPE_LABEL],
      resourceQuery.data?.name,
    ),
  };
}
