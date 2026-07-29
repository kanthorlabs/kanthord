import type { TaskStatus } from "./task.ts";
import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";
import { dependentClosure, type GraphNode } from "./graph.ts";
import {
  decisionActions,
  decisionKindLabel,
  type Action,
  type DecisionContext,
  type DecisionKindLabel,
} from "./actionability.ts";
import { eventTimeMs } from "./event.ts";

// ---------------------------------------------------------------------------
// Input shapes — read-only projections of the graph, one project at a time.
// ---------------------------------------------------------------------------

export interface QueueTaskInput {
  id: string;
  title: string;
  objectiveId: string;
  status: TaskStatus;
  dependencies: string[];
}

export interface QueueObjectiveInput {
  id: string;
  name: string;
  initiativeId: string;
  status?: ObjectiveStatus;
  commitOid?: string;
}

export interface QueueInitiativeInput {
  id: string;
  name: string;
  projectId: string;
  status?: InitiativeStatus;
  paused: boolean;
  publication: {
    repositoryId: string;
    branch: string;
    state: "unpublished" | "published" | "diverged";
  } | null;
}

export interface QueueEvidenceInput {
  /** Absolute path of the managed home for this element's repository. */
  homeDir: string | null;
  /** The older side of the diff. */
  baseOid: string | null;
  /** The newer side of the diff. */
  headOid: string | null;
}

export interface QueueProjectInput {
  projectId: string;
  projectName: string;
  tasks: QueueTaskInput[];
  objectives: QueueObjectiveInput[];
  initiatives: QueueInitiativeInput[];
  /** Id of the event that made each element actionable, keyed by element id. */
  actionableEventIds: Map<string, string>;
  /** Evidence identity, keyed by task id and by objective id. */
  evidence: Map<string, QueueEvidenceInput>;
  /** Tasks with a persisted landing candidate — the `cause` differentiator. */
  candidateTaskIds: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Output shape.
// ---------------------------------------------------------------------------

export interface DecisionEvidence {
  basis: "verification-and-summary";
  diffAvailable: false;
  inspect: { executable: "git"; args: string[] } | null;
}

export interface DecisionItem {
  verdicts: Action[];
  kindLabel: DecisionKindLabel;
  /**
   * Why a `task-review` item is awaiting review. Two distinct runtime paths
   * reach the same status and they are NOT interchangeable in the detail view.
   * Absent on every other kind.
   */
  cause?: "candidate" | "escalation";
  projectId: string;
  projectName: string;
  initiativeId: string;
  objectiveId?: string;
  taskId?: string;
  downstream: number;
  actionableSince: number | null;
  evidence: DecisionEvidence;
  expectedCommit?: string;
}

const OID_PATTERN = /^[0-9a-f]{7,64}$/;

function buildInspect(
  evidence: QueueEvidenceInput | undefined,
): { executable: "git"; args: string[] } | null {
  if (evidence === undefined) return null;
  const { homeDir, baseOid, headOid } = evidence;
  if (homeDir === null || baseOid === null || headOid === null) return null;
  if (!OID_PATTERN.test(baseOid) || !OID_PATTERN.test(headOid)) return null;
  return {
    executable: "git",
    args: ["-C", homeDir, "diff", `${baseOid}..${headOid}`],
  };
}

function buildEvidence(
  evidence: QueueEvidenceInput | undefined,
): DecisionEvidence {
  return {
    basis: "verification-and-summary",
    diffAvailable: false,
    inspect: buildInspect(evidence),
  };
}

function actionableSinceFor(eventId: string | undefined): number | null {
  return eventId === undefined ? null : eventTimeMs(eventId);
}

function objectiveDownstream(
  objectiveId: string,
  tasks: QueueTaskInput[],
  graphNodes: GraphNode[],
): number {
  const ownTaskIds = new Set(
    tasks.filter((t) => t.objectiveId === objectiveId).map((t) => t.id),
  );
  const external = new Set<string>();
  for (const id of ownTaskIds) {
    for (const dependentId of dependentClosure(graphNodes, id)) {
      if (!ownTaskIds.has(dependentId)) external.add(dependentId);
    }
  }
  return ownTaskIds.size + external.size;
}

export function projectDecisions(input: QueueProjectInput): DecisionItem[] {
  const items: DecisionItem[] = [];
  const graphNodes: GraphNode[] = input.tasks.map((t) => ({
    id: t.id,
    dependencies: t.dependencies,
    status: t.status,
  }));
  const objectiveById = new Map(input.objectives.map((o) => [o.id, o]));

  for (const t of input.tasks) {
    if (t.status !== "failed" && t.status !== "awaiting_confirmation") continue;
    const objective = objectiveById.get(t.objectiveId);
    if (objective === undefined) continue; // no initiative to report — never fake ""
    const context: DecisionContext = {
      node: {
        taskId: t.id,
        status: t.status,
        objectiveId: t.objectiveId,
        objectiveStatus: objective.status,
        blockedForever: false,
        deadDependencyId: null,
      },
      group: null,
      initiative: null,
      expectedCommit: null,
    };
    const kindLabel = decisionKindLabel(context);
    if (kindLabel === null) continue;

    const item: DecisionItem = {
      verdicts: decisionActions(context),
      kindLabel,
      projectId: input.projectId,
      projectName: input.projectName,
      initiativeId: objective.initiativeId,
      objectiveId: t.objectiveId,
      taskId: t.id,
      downstream: dependentClosure(graphNodes, t.id).length,
      actionableSince: actionableSinceFor(input.actionableEventIds.get(t.id)),
      evidence: buildEvidence(input.evidence.get(t.id)),
    };
    if (t.status === "awaiting_confirmation") {
      item.cause = input.candidateTaskIds.has(t.id)
        ? "candidate"
        : "escalation";
    }
    items.push(item);
  }

  for (const o of input.objectives) {
    if (o.status !== "conflict" && o.status !== "awaiting_confirmation")
      continue;
    const context: DecisionContext = {
      node: null,
      group: { objectiveId: o.id, status: o.status },
      initiative: null,
      expectedCommit: o.commitOid ?? null,
    };
    const kindLabel = decisionKindLabel(context);
    if (kindLabel === null) continue;

    const item: DecisionItem = {
      verdicts: decisionActions(context),
      kindLabel,
      projectId: input.projectId,
      projectName: input.projectName,
      initiativeId: o.initiativeId,
      objectiveId: o.id,
      downstream: objectiveDownstream(o.id, input.tasks, graphNodes),
      actionableSince: actionableSinceFor(input.actionableEventIds.get(o.id)),
      evidence: buildEvidence(input.evidence.get(o.id)),
    };
    if (o.commitOid !== undefined) item.expectedCommit = o.commitOid;
    items.push(item);
  }

  for (const i of input.initiatives) {
    const context: DecisionContext = {
      node: null,
      group: null,
      initiative: {
        initiativeId: i.id,
        status: i.status,
        paused: i.paused,
        publication: i.publication,
      },
      expectedCommit: null,
    };
    const kindLabel = decisionKindLabel(context);
    if (kindLabel === null) continue;

    items.push({
      verdicts: decisionActions(context),
      kindLabel,
      projectId: input.projectId,
      projectName: input.projectName,
      initiativeId: i.id,
      downstream: 0,
      actionableSince: actionableSinceFor(input.actionableEventIds.get(i.id)),
      evidence: buildEvidence(input.evidence.get(i.id)),
    });
  }

  return items;
}

/** Ranks items across projects. Stable and total. */
export function rankDecisions(items: DecisionItem[]): DecisionItem[] {
  const ranked = [...items];
  ranked.sort((a, b) => {
    if (a.downstream !== b.downstream) return b.downstream - a.downstream;

    if (a.actionableSince !== b.actionableSince) {
      if (a.actionableSince === null) return 1;
      if (b.actionableSince === null) return -1;
      return a.actionableSince - b.actionableSince;
    }

    const aId = (a.taskId ?? a.objectiveId ?? a.initiativeId) as string;
    const bId = (b.taskId ?? b.objectiveId ?? b.initiativeId) as string;
    if (aId < bId) return -1;
    if (aId > bId) return 1;
    return 0;
  });
  return ranked;
}
