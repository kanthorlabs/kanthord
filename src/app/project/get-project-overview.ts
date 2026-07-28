// src/app/project/get-project-overview.ts — Story 6 (EPIC 016).
// One-call assembly of a project overview: initiatives with per-status task
// counts and `needsHuman`, repository lanes, ranked `decisions[]` (one entry
// per non-null action across nodes / groups / initiatives), and the
// `digest` over the project-scoped event feed. Read-only: no `setAck`, no
// `append`, no `save*`. `AckProject` is the only writer of `project_acks`.
// Declares its own structural sources so this `app/` module honors the
// architecture boundary.

import { UnknownReferenceError } from "../errors.ts";
import type { Project } from "../../domain/project.ts";
import type {
  Initiative,
  InitiativeStatus,
  Objective,
  ObjectiveStatus,
} from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import type { Event } from "../../domain/event.ts";
import { eventTimeMs } from "../../domain/event.ts";
import {
  groupAction,
  initiativeAction,
  nodeAction,
  type Action,
} from "../../domain/actionability.ts";
import {
  permanentlyBlockedTasks,
  unsatisfiedTaskEdges,
} from "../../domain/sequencing.ts";
import { dependentClosure } from "../../domain/graph.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Capped page size of the digest's `events` field. `totalCount` and `byType`
 * are aggregates over ALL matching rows; only `events` is capped, and
 * `hasMore` reports whether the cap was hit. The value is a named exported
 * constant so a client can size its next-page request against it.
 */
export const DIGEST_PAGE_LIMIT = 50;

// ---------------------------------------------------------------------------
// Structural sources — declared locally, exactly mirroring the pattern at
// `src/app/initiative/get-initiative-graph.ts:39-83` and
// `src/app/task/get-task.ts:6-20`. `app/` never imports capability ports
// wholesale; the adapter (here, `SqliteEventFeed`) is consumed through a
// structural interface and only the composition root knows the real type.
// ---------------------------------------------------------------------------

interface OverviewProjectSource {
  get(id: string): Project | undefined;
}

interface OverviewInitiativeSource {
  listInitiatives(projectId: string): Initiative[];
  listObjectives(initiativeId: string): Objective[];
  listAllInitiatives(): Array<{ id: string; paused: boolean }>;
}

interface OverviewTaskSource {
  listByInitiative(initiativeId: string): Task[];
  getTaskContext(taskId: string): Record<string, string>;
}

interface OverviewAckSource {
  getAck(projectId: string): string | undefined;
}

interface OverviewEventSource {
  countProjectEventsAfter(
    projectId: string,
    after: string | null,
  ): { totalCount: number; byType: Record<string, number> };
  readProjectEventsAfter(
    projectId: string,
    after: string | null,
    limit: number,
  ): Event[];
  latestProjectEventId(projectId: string): string | undefined;
  latestActionableEventIds(initiativeId: string): Map<string, string>;
}

// ---------------------------------------------------------------------------
// Output types — exact shapes per Story 6 §Output type block.
// ---------------------------------------------------------------------------

export interface OverviewDecision {
  action: Action;
  initiativeId: string;
  objectiveId: string | null;
  taskId: string | null;
  downstream: number;
  /** ULID time of the event that made the action actionable, or `null`
   *  for `remove-dependency` and `resume-initiative` (no event marks them). */
  actionableSince: number | null;
}

export interface GetProjectOverviewOutput {
  projectId: string;
  initiatives: Array<{
    id: string;
    name: string;
    status: InitiativeStatus;
    paused: boolean;
    taskCounts: {
      pending: number;
      running: number;
      completed: number;
      failed: number;
      awaiting_confirmation: number;
      discarded: number;
    };
    needsHuman: number;
    action: Action | null;
  }>;
  lanes: Array<{
    repositoryId: string | null;
    objectiveIds: string[];
    initiativeIds: string[];
  }>;
  decisions: OverviewDecision[];
  digest: {
    since: string | null;
    latest: string | null;
    totalCount: number;
    byType: Record<string, number>;
    events: Event[];
    hasMore: boolean;
    pageCursor: string | null;
  };
}

// ---------------------------------------------------------------------------
// Per-initiative working set — pre-loaded once so the per-initiative loop
// and the lane builder share the same fetched data.
// ---------------------------------------------------------------------------

interface InitiativeData {
  initiative: Initiative;
  paused: boolean;
  status: InitiativeStatus;
  tasks: Task[];
  objectives: Objective[];
}

// ---------------------------------------------------------------------------
// Use case
// ---------------------------------------------------------------------------

export class GetProjectOverview {
  readonly #projects: OverviewProjectSource;
  readonly #initiatives: OverviewInitiativeSource;
  readonly #tasks: OverviewTaskSource;
  readonly #acks: OverviewAckSource;
  readonly #events: OverviewEventSource;

  constructor(
    projects: OverviewProjectSource,
    initiatives: OverviewInitiativeSource,
    tasks: OverviewTaskSource,
    acks: OverviewAckSource,
    events: OverviewEventSource,
  ) {
    this.#projects = projects;
    this.#initiatives = initiatives;
    this.#tasks = tasks;
    this.#acks = acks;
    this.#events = events;
  }

  async execute(input: {
    projectId: string;
  }): Promise<GetProjectOverviewOutput> {
    // Rule 1: unknown project → throw.
    const project = this.#projects.get(input.projectId);
    if (project === undefined) {
      throw new UnknownReferenceError("project", input.projectId);
    }

    // Rule 2: initiatives in source order; `paused` from `listAllInitiatives()`,
    // defaulting to `false` when the id is absent (same reader as Story 3 rule 4).
    const initiatives = this.#initiatives.listInitiatives(input.projectId);
    const pausedById = new Map<string, boolean>();
    for (const row of this.#initiatives.listAllInitiatives()) {
      pausedById.set(row.id, row.paused);
    }

    // Pre-load every initiative's tasks + objectives once; reused by the
    // per-initiative output loop and the lane builder.
    const initiativeDataList: InitiativeData[] = initiatives.map((init) => ({
      initiative: init,
      paused: pausedById.get(init.id) ?? false,
      status: init.status ?? "building",
      tasks: this.#tasks.listByInitiative(init.id),
      objectives: this.#initiatives.listObjectives(init.id),
    }));

    // Per-initiative outputs + per-initiative decisions. One pass over
    // `initiativeDataList`; the actions are computed once and reused for
    // `needsHuman`, the `initiative[]` row, and the `decisions[]` entries.
    const initiativeOutputs: GetProjectOverviewOutput["initiatives"] = [];
    const decisions: OverviewDecision[] = [];

    for (const data of initiativeDataList) {
      const { initiative, paused, status, tasks, objectives } = data;

      // Per-task action facts (Story 1). `permanentlyBlockedTasks` and
      // `unsatisfiedTaskEdges` are pure domain functions over `Task[]`; they
      // return the existing `UnsatisfiedEdge` shape so `nodeAction` can
      // populate `blockedForever` and `deadDependencyId` from them.
      const waitingByNode = unsatisfiedTaskEdges(tasks);
      const permanentlyBlocked = permanentlyBlockedTasks(tasks);
      const objectiveById = new Map<string, Objective>();
      for (const o of objectives) {
        objectiveById.set(o.id, o);
      }

      // Per-task action; reused by the `needsHuman` count and the decisions
      // list. `nodeAction` is the closed-vocabulary projection from Story 2.
      const nodeActions = new Map<string, Action | null>();
      let needsHuman = 0;
      for (const t of tasks) {
        const waiting = waitingByNode.get(t.id) ?? [];
        const deadDep = waiting.find((e) => e.neverSatisfies) ?? null;
        const action = nodeAction({
          taskId: t.id,
          status: t.status,
          objectiveId: t.objectiveId,
          objectiveStatus: objectiveById.get(t.objectiveId)?.status,
          blockedForever: permanentlyBlocked.has(t.id),
          deadDependencyId: deadDep === null ? null : deadDep.id,
        });
        nodeActions.set(t.id, action);
        if (action !== null) needsHuman++;
      }

      // Per-objective action; reused by the `needsHuman` count and the
      // decisions list.
      const groupActions = new Map<string, Action | null>();
      for (const o of objectives) {
        const action = groupAction({
          objectiveId: o.id,
          status: o.status ?? "building",
        });
        groupActions.set(o.id, action);
        if (action !== null) needsHuman++;
      }

      // Rule 4: initiative action with `publication: null`. The overview does
      // not resolve publication state — only `get graph` does — so a
      // `publish` action appears only in the graph payload, never here.
      const initiativeAct = initiativeAction({
        initiativeId: initiative.id,
        status,
        paused,
        publication: null,
      });

      if (initiativeAct !== null) {
        decisions.push({
          action: initiativeAct,
          initiativeId: initiative.id,
          objectiveId: null,
          taskId: null,
          downstream: 0,
          actionableSince: null, // resume-initiative has no event marker (rule 6)
        });
      }

      initiativeOutputs.push({
        id: initiative.id,
        name: initiative.name,
        status,
        paused,
        taskCounts: computeTaskCounts(tasks),
        needsHuman,
        action: initiativeAct,
      });

      // Rule 5 + 6: one decision per non-null node / group action. The
      // actionable-event map is fetched once per initiative (the SQL
      // filters by `initiativeId` so a per-initiative scope is correct).
      const actionable = this.#events.latestActionableEventIds(initiative.id);

      for (const t of tasks) {
        const action = nodeActions.get(t.id);
        if (action === null || action === undefined) continue;
        const downstream = dependentClosure(tasks, t.id).length;
        decisions.push({
          action,
          initiativeId: initiative.id,
          taskId: action.target.type === "task" ? action.target.id : null,
          objectiveId:
            action.target.type === "task" ? t.objectiveId : action.target.id,
          downstream,
          actionableSince: actionableSinceForAction(action, actionable),
        });
      }

      for (const o of objectives) {
        const action = groupActions.get(o.id);
        if (action === null || action === undefined) continue;
        const tasksInObjective = tasks.filter((t) => t.objectiveId === o.id);
        const downstream = tasksInObjective.reduce(
          (acc, t) => acc + dependentClosure(tasks, t.id).length,
          0,
        );
        decisions.push({
          action,
          initiativeId: initiative.id,
          taskId: null,
          objectiveId: action.target.id,
          downstream,
          actionableSince: actionableSinceForAction(action, actionable),
        });
      }
    }

    // Rule 7: sort decisions in the pinned three-key order.
    decisions.sort(compareDecisions);

    // Rule 8: lanes — group objectives by their repository set.
    const lanes = buildLanes(initiativeDataList, this.#tasks);

    // Rule 9 + 10: digest. `since` / `latest` are echoed so a client can
    // ack exactly what it saw. `totalCount` and `byType` are aggregates;
    // `events` is the capped page; `pageCursor` is the last returned id.
    const since = this.#acks.getAck(input.projectId) ?? null;
    const latest = this.#events.latestProjectEventId(input.projectId) ?? null;
    const { totalCount, byType } = this.#events.countProjectEventsAfter(
      input.projectId,
      since,
    );
    const events = this.#events.readProjectEventsAfter(
      input.projectId,
      since,
      DIGEST_PAGE_LIMIT,
    );
    const hasMore = totalCount > events.length;
    const pageCursor = events.length > 0 ? events[events.length - 1]!.id : null;

    return {
      projectId: input.projectId,
      initiatives: initiativeOutputs,
      lanes,
      decisions,
      digest: {
        since,
        latest,
        totalCount,
        byType,
        events,
        hasMore,
        pageCursor,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeTaskCounts(
  tasks: Task[],
): GetProjectOverviewOutput["initiatives"][number]["taskCounts"] {
  const counts = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    awaiting_confirmation: 0,
    discarded: 0,
  };
  for (const t of tasks) {
    counts[t.status]++;
  }
  return counts;
}

/**
 * The `actionableSince` oracle. Rule 6 maps a `kind` + `target.type` pair to
 * the event key whose ULID time is the actionable moment. Anything outside
 * the four combinations (including `remove-dependency` and
 * `resume-initiative`) returns `null` — those decisions have no event marker
 * by spec, and `entity.id` is NEVER a fallback (an old task id can be days
 * older than the failure event).
 */
function actionableSinceForAction(
  action: Action,
  actionable: Map<string, string>,
): number | null {
  let key: string | null = null;
  if (action.kind === "retry" && action.target.type === "task") {
    key = `task.failed:${action.target.id}`;
  } else if (action.kind === "approve" && action.target.type === "task") {
    key = `task.escalated:${action.target.id}`;
  } else if (action.kind === "approve" && action.target.type === "objective") {
    key = `objective.awaiting_confirmation:${action.target.id}`;
  } else if (action.kind === "retry" && action.target.type === "objective") {
    key = `objective.conflict:${action.target.id}`;
  }
  if (key === null) return null;
  const id = actionable.get(key);
  return id === undefined ? null : eventTimeMs(id);
}

/**
 * Three-key comparator for the decision inbox. Total order, so the result
 * is deterministic across runs. `null` `actionableSince` always sorts AFTER
 * a non-null one at the same `downstream` — the longest-waiting decision
 * shows up first, and the never-waiting one falls to the end.
 */
function compareDecisions(a: OverviewDecision, b: OverviewDecision): number {
  // 1. downstream descending.
  if (a.downstream !== b.downstream) {
    return b.downstream - a.downstream;
  }
  // 2. actionableSince ascending with null last.
  if (a.actionableSince !== null && b.actionableSince !== null) {
    if (a.actionableSince !== b.actionableSince) {
      return a.actionableSince - b.actionableSince;
    }
  } else if (a.actionableSince !== null) {
    return -1;
  } else if (b.actionableSince !== null) {
    return 1;
  }
  // 3. id ascending (taskId ?? objectiveId ?? initiativeId).
  const aId = a.taskId ?? a.objectiveId ?? a.initiativeId;
  const bId = b.taskId ?? b.objectiveId ?? b.initiativeId;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/**
 * Build the lane list. An objective that names a `repository` context on
 * any of its tasks lands in that repository's lane; one that names two
 * lands in BOTH; one that names none lands in the `null` lane. Lanes are
 * sorted by `repositoryId` ascending with the null lane last;
 * `objectiveIds` and `initiativeIds` are sorted and deduplicated within
 * each lane. `resolveInitiativeRepository` is NOT used (finding 5).
 */
function buildLanes(
  initiativeDataList: InitiativeData[],
  tasks: OverviewTaskSource,
): GetProjectOverviewOutput["lanes"] {
  const perRepo = new Map<
    string,
    { objectiveIds: Set<string>; initiativeIds: Set<string> }
  >();
  const nullLane = {
    objectiveIds: new Set<string>(),
    initiativeIds: new Set<string>(),
  };

  for (const data of initiativeDataList) {
    for (const o of data.objectives) {
      const repos = new Set<string>();
      for (const t of data.tasks) {
        if (t.objectiveId !== o.id) continue;
        const repoId = tasks.getTaskContext(t.id)["repository"];
        if (repoId !== undefined) repos.add(repoId);
      }
      if (repos.size === 0) {
        nullLane.objectiveIds.add(o.id);
        nullLane.initiativeIds.add(data.initiative.id);
      } else {
        for (const repoId of repos) {
          let lane = perRepo.get(repoId);
          if (lane === undefined) {
            lane = {
              objectiveIds: new Set<string>(),
              initiativeIds: new Set<string>(),
            };
            perRepo.set(repoId, lane);
          }
          lane.objectiveIds.add(o.id);
          lane.initiativeIds.add(data.initiative.id);
        }
      }
    }
  }

  const lanes: GetProjectOverviewOutput["lanes"] = [];
  for (const repoId of [...perRepo.keys()].sort()) {
    const lane = perRepo.get(repoId)!;
    lanes.push({
      repositoryId: repoId,
      objectiveIds: [...lane.objectiveIds].sort(),
      initiativeIds: [...lane.initiativeIds].sort(),
    });
  }
  if (nullLane.objectiveIds.size > 0) {
    lanes.push({
      repositoryId: null,
      objectiveIds: [...nullLane.objectiveIds].sort(),
      initiativeIds: [...nullLane.initiativeIds].sort(),
    });
  }
  return lanes;
}
