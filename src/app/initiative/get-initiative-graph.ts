// src/app/initiative/get-initiative-graph.ts — Story 3 (EPIC 016).
// One-call assembly of an initiative's whole DAG: initiative header, groups
// (objectives) with their repositories and waiting edges, task nodes with
// status / readiness / downstream / detail fields, edges, the remaining
// critical path, and per-status counts. Read-only: no save*, no event
// append, no transaction. Declares its own structural sources so this
// `app/` module honors the architecture boundary.

import { UnknownReferenceError } from "../errors.ts";
import type { Task, TaskStatus } from "../../domain/task.ts";
import type {
  Initiative,
  InitiativeStatus,
  Objective,
  ObjectiveStatus,
} from "../../domain/initiative.ts";
import type { ChangeCandidate } from "../../domain/landing.ts";
import type { TaskResultRow } from "../../storage/port.ts";
import type { UnsatisfiedEdge } from "../../domain/sequencing.ts";
import {
  unsatisfiedObjectiveEdges,
  unsatisfiedTaskEdges,
  permanentlyBlockedTasks,
} from "../../domain/sequencing.ts";
import {
  dependentClosure,
  longestRemainingChain,
  type GraphNode,
  type RemainingChain,
} from "../../domain/graph.ts";
import {
  groupAction,
  initiativeAction,
  nodeAction,
  type Action,
} from "../../domain/actionability.ts";
import { eventTimeMs } from "../../domain/event.ts";

// ---------------------------------------------------------------------------
// Structural sources — declared locally, exactly mirroring the pattern at
// `src/app/task/get-task.ts:6-20`. `app/` never imports `storage/port.ts`
// interfaces wholesale.
// ---------------------------------------------------------------------------

interface GraphTaskSource {
  listByInitiative(initiativeId: string): Task[];
  getTaskContext(taskId: string): Record<string, string>;
}

interface GraphResultSource {
  getTaskResult(taskId: string): TaskResultRow | undefined;
}

interface GraphInitiativeSource {
  get(id: string): Initiative | undefined;
  listObjectives(initiativeId: string): Objective[];
  listAllInitiatives(): Array<{ id: string; paused: boolean }>;
}

interface GraphSequencingSource {
  listObjectiveAfter(objectiveId: string): string[];
}

interface GraphLandingSource {
  getCandidateByTask(taskId: string): ChangeCandidate | undefined;
}

interface GraphActivitySource {
  latestEventIdByTask(taskIds: readonly string[]): Map<string, string>;
}

interface GraphPublicationSource {
  getPublication(
    repoId: string,
    branch: string,
  ):
    | {
        state: "unpublished" | "published" | "diverged";
        remoteOID: string | null;
      }
    | undefined;
}

// ---------------------------------------------------------------------------
// Output types — exact shapes per Story 3 §Output type block.
// ---------------------------------------------------------------------------

export interface GraphNodeOutput {
  id: string;
  groupId: string;
  title: string;
  status: TaskStatus;
  dependencyState: "ready" | "blocked";
  executionState: "runnable" | "paused";
  dependencies: string[];
  waiting: UnsatisfiedEdge[];
  blockedForever: boolean;
  downstream: number;
  lastEventId: string | null;
  lastEventAtMs: number | null;
  agent: string | null;
  instructions: string | null;
  ac: string[];
  verificationRequested: string[];
  verificationResults: Array<{
    command: string;
    exitCode: number;
    output: string;
  }>;
  failureReason: string | null;
  rejection: { resolution: string; reason: string | null } | null;
  produced: { summary: string | null; evidenceCount: number } | null;
  note: string | null;
  candidate: {
    candidateSHA: string;
    baseSHA: string | null;
    target: string | null;
    state: "pending" | "landed" | "conflict" | null;
    source: "landing_candidate" | "task_result";
  } | null;
  action: Action | null;
}

export interface GraphGroupOutput {
  id: string;
  name: string;
  status: ObjectiveStatus;
  repositories: string[];
  commitOid: string | null;
  conflictReason: string | null;
  after: string[];
  waiting: UnsatisfiedEdge[];
  action: Action | null;
}

export interface GetInitiativeGraphOutput {
  projectId: string;
  initiative: {
    id: string;
    name: string;
    status: InitiativeStatus;
    paused: boolean;
    branch: string;
    action: Action | null;
  };
  groups: GraphGroupOutput[];
  nodes: GraphNodeOutput[];
  edges: Array<{ from: string; to: string }>;
  criticalPath: RemainingChain;
  counts: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    awaiting_confirmation: number;
    discarded: number;
    blocked: number;
    blockedForever: number;
    actionable: number;
  };
}

// ---------------------------------------------------------------------------
// Use case
// ---------------------------------------------------------------------------

export class GetInitiativeGraph {
  readonly #tasks: GraphTaskSource;
  readonly #results: GraphResultSource;
  readonly #initiatives: GraphInitiativeSource;
  readonly #sequencing: GraphSequencingSource;
  readonly #landing: GraphLandingSource;
  readonly #activity: GraphActivitySource;
  readonly #publications: GraphPublicationSource;
  readonly #repositoryBranch: (repositoryId: string) => string | undefined;

  constructor(
    tasks: GraphTaskSource,
    results: GraphResultSource,
    initiatives: GraphInitiativeSource,
    sequencing: GraphSequencingSource,
    landing: GraphLandingSource,
    activity: GraphActivitySource,
    publications: GraphPublicationSource,
    repositoryBranch: (repositoryId: string) => string | undefined,
  ) {
    this.#tasks = tasks;
    this.#results = results;
    this.#initiatives = initiatives;
    this.#sequencing = sequencing;
    this.#landing = landing;
    this.#activity = activity;
    this.#publications = publications;
    this.#repositoryBranch = repositoryBranch;
  }

  async execute(input: { id: string }): Promise<GetInitiativeGraphOutput> {
    // 1. Resolve the initiative; throw on unknown id (Proof phase A).
    const initiative = this.#initiatives.get(input.id);
    if (initiative === undefined) {
      throw new UnknownReferenceError("initiative", input.id);
    }

    // 2. Load tasks in source order. Source ORDER BY id ASC is the
    //    pinned order — do not re-sort.
    const tasks = this.#tasks.listByInitiative(input.id);
    const taskIds = tasks.map((t) => t.id);

    // 3. Edge permanence: per-node waiting + transitive permanent set.
    //    Both come from `unsatisfiedTaskEdges` (Story 1). The result must be
    //    computed in node order so the per-node `waiting` array matches the
    //    node's own `dependencies` order and the Map keys preserve input
    //    order.
    const waitingByNode = unsatisfiedTaskEdges(tasks);
    const permanentlyBlocked = permanentlyBlockedTasks(tasks);

    // 4. Activity — latest event id per task.
    const latestByTask = this.#activity.latestEventIdByTask(taskIds);

    // 5. Paused = the matching entry in `listAllInitiatives()`; `false` when
    //    the id is absent.
    const allInitiatives = this.#initiatives.listAllInitiatives();
    const paused =
      allInitiatives.find((row) => row.id === input.id)?.paused ?? false;

    // 6. Status, branch on the initiative. Action is resolved below (step 8b)
    //    once the repo union — and with it the real publication facts — is known.
    const initiativeStatus = initiative.status ?? "building";

    // 7. Groups: same source order, build repositories + waiting + status.
    const objectives = this.#initiatives.listObjectives(input.id);
    const objectiveById = new Map<string, Objective>();
    for (const o of objectives) objectiveById.set(o.id, o);

    // 8. Repositories per group = distinct, ascending-sorted union of the
    //    `repository` context binding on the group's tasks. Skip undefined.
    //    `resolveInitiativeRepository` is NOT used (finding 5) — a group
    //    whose tasks name two repositories reports both.
    const reposByGroup = new Map<string, string[]>();
    for (const o of objectives) {
      const set = new Set<string>();
      for (const t of tasks) {
        if (t.objectiveId !== o.id) continue;
        const repoId = this.#tasks.getTaskContext(t.id)["repository"];
        if (repoId !== undefined) set.add(repoId);
      }
      const sorted = [...set].sort();
      reposByGroup.set(o.id, sorted);
    }

    // 8b. Initiative action — resolve the lowest repo, its branch, and its
    //     publication state first, then call `initiativeAction` exactly once
    //     with the real publication facts (never a placeholder null).
    const reposUnion = new Set<string>();
    for (const o of objectives) {
      for (const r of reposByGroup.get(o.id) ?? []) reposUnion.add(r);
    }
    const lowestRepo =
      reposUnion.size === 0 ? null : ([...reposUnion].sort()[0] ?? null);
    let publication: {
      repositoryId: string;
      branch: string;
      state: "unpublished" | "published" | "diverged";
    } | null = null;
    if (lowestRepo !== null) {
      const branch = this.#repositoryBranch(lowestRepo);
      if (branch !== undefined) {
        const record = this.#publications.getPublication(lowestRepo, branch);
        const state: "unpublished" | "published" | "diverged" =
          record === undefined ? "unpublished" : record.state;
        publication = { repositoryId: lowestRepo, branch, state };
      }
    }
    const resolvedInitiativeAction = initiativeAction({
      initiativeId: initiative.id,
      status: initiativeStatus,
      paused,
      publication,
    });

    // 9. Group waiting = `unsatisfiedObjectiveEdges` over each group's
    //    `listObjectiveAfter` ids with each predecessor's status. The
    //    predecessor objective's `status` is read from `objectiveById`.
    const groupOutputs: GraphGroupOutput[] = objectives.map((o) => {
      const after = this.#sequencing.listObjectiveAfter(o.id);
      const afterWithStatus: Array<{
        id: string;
        status?: ObjectiveStatus;
      }> = after.map((id) => ({
        id,
        status: objectiveById.get(id)?.status,
      }));
      const waiting = unsatisfiedObjectiveEdges(afterWithStatus);
      const status = o.status ?? "building";
      const groupActionResult = groupAction({
        objectiveId: o.id,
        status,
      });
      return {
        id: o.id,
        name: o.name,
        status,
        repositories: reposByGroup.get(o.id) ?? [],
        commitOid: o.commitOid ?? null,
        conflictReason: o.conflictReason ?? null,
        after,
        waiting,
        action: groupActionResult,
      };
    });

    // 10. Edges — for each node in node order, for each `d` in its
    //     `dependencies` order, push `{ from: d, to: node.id }`. No dedup,
    //     no sort.
    const edges: Array<{ from: string; to: string }> = [];
    for (const t of tasks) {
      for (const d of t.dependencies) {
        edges.push({ from: d, to: t.id });
      }
    }

    // 11. Nodes — preserve source order.
    const nodeOutputs: GraphNodeOutput[] = tasks.map((t) => {
      const taskResult = this.#results.getTaskResult(t.id);
      const waiting = waitingByNode.get(t.id) ?? [];

      // 12. Action: pull objective status, dead dep id from `waiting`.
      const objectiveStatus = objectiveById.get(t.objectiveId)?.status;
      const deadDep = waiting.find((e) => e.neverSatisfies) ?? null;
      const action = nodeAction({
        taskId: t.id,
        status: t.status,
        objectiveId: t.objectiveId,
        objectiveStatus,
        blockedForever: permanentlyBlocked.has(t.id),
        deadDependencyId: deadDep === null ? null : deadDep.id,
      });

      // 13. Candidate precedence: landing row > task_result, commitSha >
      //     proposalCommit, null when neither.
      const landingRow = this.#landing.getCandidateByTask(t.id);
      const candidate = buildCandidate(landingRow, taskResult);

      // 14. Verification results: `taskResult.evidence ?? []`. evidence is
      //     populated only on the `completed` outcome; every other write
      //     path stores `null` (EPIC 016 §"Verification results come from
      //     task_results.evidence, never from events").
      const verificationResults = taskResult?.evidence ?? [];

      // 15. Rejection: null when rejectionResolution is null, else
      //     { resolution, reason }.
      const rejection =
        taskResult?.rejectionResolution === null ||
        taskResult?.rejectionResolution === undefined
          ? null
          : {
              resolution: taskResult.rejectionResolution,
              reason: taskResult.rejectionReason,
            };

      // 16. Produced: null when no result row, else
      //     { summary, evidenceCount }.
      const produced =
        taskResult === undefined
          ? null
          : {
              summary: taskResult.summary,
              evidenceCount: (taskResult.evidence ?? []).length,
            };

      // 17. Last event: id + decoded time, or null/null.
      const lastEventId = latestByTask.get(t.id) ?? null;
      const lastEventAtMs =
        lastEventId === null ? null : eventTimeMs(lastEventId);

      // 18. Downstream: dependentClosure of the node's own id, against
      //     the graph node set.
      const downstream = dependentClosure(tasks, t.id).length;

      const waitingEdges = waiting;
      const dependencyState: "ready" | "blocked" =
        waitingEdges.length > 0 ? "blocked" : "ready";
      const executionState: "runnable" | "paused" = paused
        ? "paused"
        : "runnable";

      return {
        id: t.id,
        groupId: t.objectiveId,
        title: t.title,
        status: t.status,
        dependencyState,
        executionState,
        dependencies: t.dependencies,
        waiting: waitingEdges,
        blockedForever: permanentlyBlocked.has(t.id),
        downstream,
        lastEventId,
        lastEventAtMs,
        agent: t.agent ?? null,
        instructions: t.instructions ?? null,
        ac: t.ac ?? [],
        verificationRequested: t.verification ?? [],
        verificationResults,
        failureReason: taskResult?.reason ?? null,
        rejection,
        produced,
        note: t.note ?? null,
        candidate,
        action,
      };
    });

    // 19. Critical path — longest remaining chain (Story 1).
    const graphNodes: GraphNode[] = tasks.map((t) => ({
      id: t.id,
      status: t.status,
      dependencies: t.dependencies,
    }));
    const criticalPath = longestRemainingChain(graphNodes);

    // 20. Counts: the six status counts over `nodes`; blocked / blockedForever
    //     as defined; actionable = nodes with action !== null.
    const counts = computeCounts(nodeOutputs);

    return {
      projectId: initiative.projectId,
      initiative: {
        id: initiative.id,
        name: initiative.name,
        status: initiativeStatus,
        paused,
        branch: `kanthord/init/${initiative.id}`,
        action: resolvedInitiativeAction,
      },
      groups: groupOutputs,
      nodes: nodeOutputs,
      edges,
      criticalPath,
      counts,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCandidate(
  landingRow: ChangeCandidate | undefined,
  taskResult: TaskResultRow | undefined,
): GraphNodeOutput["candidate"] {
  if (landingRow !== undefined) {
    return {
      candidateSHA: landingRow.candidateSHA,
      baseSHA: landingRow.baseSHA,
      target: landingRow.target,
      state: landingRow.state,
      source: "landing_candidate",
    };
  }
  if (taskResult === undefined) {
    return null;
  }
  const commitSha = taskResult.commitSha;
  const proposalCommit = taskResult.proposalCommit;
  const candidateSHA =
    commitSha !== null && commitSha !== undefined
      ? commitSha
      : proposalCommit !== null && proposalCommit !== undefined
        ? proposalCommit
        : null;
  if (candidateSHA === null) {
    return null;
  }
  return {
    candidateSHA,
    baseSHA: taskResult.baseCommit,
    target: null,
    state: null,
    source: "task_result",
  };
}

function computeCounts(
  nodes: GraphNodeOutput[],
): GetInitiativeGraphOutput["counts"] {
  const counts = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    awaiting_confirmation: 0,
    discarded: 0,
    blocked: 0,
    blockedForever: 0,
    actionable: 0,
  };
  for (const n of nodes) {
    switch (n.status) {
      case "pending":
        counts.pending++;
        break;
      case "running":
        counts.running++;
        break;
      case "completed":
        counts.completed++;
        break;
      case "failed":
        counts.failed++;
        break;
      case "awaiting_confirmation":
        counts.awaiting_confirmation++;
        break;
      case "discarded":
        counts.discarded++;
        break;
    }
    if (n.dependencyState === "blocked") counts.blocked++;
    if (n.blockedForever) counts.blockedForever++;
    if (n.action !== null) counts.actionable++;
  }
  return counts;
}
