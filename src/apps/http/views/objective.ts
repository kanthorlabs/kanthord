import type { GetObjectiveOutput } from "../../../app/objective/get-objective.ts";
import { unsatisfiedEdgeView, type UnsatisfiedEdgeView } from "./shared.ts";

export interface ObjectiveResult {
  readonly id: string;
  readonly initiativeId: string;
  readonly name: string;
  readonly status?: string;
  readonly commitOid?: string;
  readonly parentOid?: string;
  readonly conflictReason?: string;
  readonly note?: string;
  readonly conflictCause?: string;
}

export interface ObjectiveView {
  readonly id: string;
  readonly initiativeId: string;
  readonly name: string;
  readonly status?: string;
  readonly commitOid?: string;
  readonly parentOid?: string;
  readonly conflictReason?: string;
  readonly note?: string;
  readonly conflictCause?: string;
  readonly [key: string]: unknown;
}

export function objectiveView(result: ObjectiveResult): ObjectiveView {
  return {
    id: result.id,
    initiativeId: result.initiativeId,
    name: result.name,
    ...(result.status !== undefined ? { status: result.status } : {}),
    ...(result.commitOid !== undefined ? { commitOid: result.commitOid } : {}),
    ...(result.parentOid !== undefined ? { parentOid: result.parentOid } : {}),
    ...(result.conflictReason !== undefined
      ? { conflictReason: result.conflictReason }
      : {}),
    ...(result.note !== undefined ? { note: result.note } : {}),
    ...(result.conflictCause !== undefined
      ? { conflictCause: result.conflictCause }
      : {}),
  };
}

export interface ObjectiveDetailView {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly commitOid?: string;
  readonly parentOid?: string;
  readonly integrations: ReadonlyArray<{
    readonly repository: string;
    readonly state: string;
  }>;
  readonly after: readonly string[];
  readonly waiting: readonly UnsatisfiedEdgeView[];
  readonly conflictReason: string | null;
  readonly note: string | null;
  readonly [key: string]: unknown;
}

export function objectiveDetailView(
  result: GetObjectiveOutput,
): ObjectiveDetailView {
  return {
    id: result.id,
    name: result.name,
    status: result.status,
    ...(result.commitOid !== undefined ? { commitOid: result.commitOid } : {}),
    ...(result.parentOid !== undefined ? { parentOid: result.parentOid } : {}),
    integrations: result.integrations.map((i) => ({
      repository: i.repository,
      state: i.state,
    })),
    after: [...result.after],
    waiting: result.waiting.map(unsatisfiedEdgeView),
    conflictReason: result.conflictReason,
    note: result.note,
  };
}
