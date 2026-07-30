import type { ConflictOverview } from "../../../app/task/get-conflict.ts";
import type { ObjectiveConflictOutput } from "../../../app/objective/get-objective-conflict.ts";

export interface TaskConflictView {
  readonly taskId: string;
  readonly branch: string;
  readonly targetOID: string;
  readonly candidateOID: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly hunks: string;
  }>;
  readonly [key: string]: unknown;
}

export function taskConflictView(result: ConflictOverview): TaskConflictView {
  return {
    taskId: result.taskId,
    branch: result.branch,
    targetOID: result.targetOID,
    candidateOID: result.candidateOID,
    files: result.files.map((f) => ({ path: f.path, hunks: f.hunks })),
  };
}

export interface ObjectiveConflictView {
  readonly objectiveId: string;
  readonly initiativeId: string;
  readonly status: string;
  readonly conflictCause: string | null;
  readonly parentOid: string | null;
  readonly commitOid: string | null;
  readonly observedTipOid: string | null;
  readonly currentTip: string | null;
  readonly tipMovedSinceAnchor: boolean;
  readonly conflictReason: string | null;
  readonly note: string | null;
  readonly evidence: {
    readonly basis: string;
    readonly diffAvailable: boolean;
    readonly inspect: {
      readonly executable: string;
      readonly args: readonly string[];
    } | null;
  };
  readonly [key: string]: unknown;
}

export function objectiveConflictView(
  result: ObjectiveConflictOutput,
): ObjectiveConflictView {
  return {
    objectiveId: result.objectiveId,
    initiativeId: result.initiativeId,
    status: result.status,
    conflictCause: result.conflictCause,
    parentOid: result.parentOid,
    commitOid: result.commitOid,
    observedTipOid: result.observedTipOid,
    currentTip: result.currentTip,
    tipMovedSinceAnchor: result.tipMovedSinceAnchor,
    conflictReason: result.conflictReason,
    note: result.note,
    evidence: {
      basis: result.evidence.basis,
      diffAvailable: result.evidence.diffAvailable,
      inspect:
        result.evidence.inspect === null
          ? null
          : {
              executable: result.evidence.inspect.executable,
              args: [...result.evidence.inspect.args],
            },
    },
  };
}
