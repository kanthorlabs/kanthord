import type { TaskRow } from "../../../app/task/list-tasks.ts";
import type { GetTaskOutput } from "../../../app/task/get-task.ts";
import {
  taskResultView,
  unsatisfiedEdgeView,
  nullableActionView,
} from "./shared.ts";

/** Mirrors TASK_STATUSES (src/domain/task.ts:4-11); apps/ may not import domain/. */
export const TASK_STATUS_VALUES = [
  "pending",
  "running",
  "completed",
  "failed",
  "awaiting_confirmation",
  "discarded",
] as const;

export interface TaskRowView {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly state: string;
  readonly dependencies: readonly string[];
  readonly waiting: readonly string[];
  readonly [key: string]: unknown;
}

export function taskRowView(result: TaskRow): TaskRowView {
  return {
    id: result.id,
    title: result.title,
    status: result.status,
    state: result.state,
    dependencies: [...result.dependencies],
    waiting: [...result.waiting],
  };
}

export interface TaskDetailView {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly agent?: string;
  readonly objectiveId: string;
  readonly dependencies: readonly string[];
  readonly note?: string;
  readonly instructions?: string;
  readonly ac?: readonly string[];
  readonly verification?: readonly string[];
  readonly result: unknown;
  readonly dependencyStatus?: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
  }>;
  readonly context?: Record<string, string>;
  readonly landingCandidate: {
    readonly state: string;
    readonly baseSHA: string;
    readonly candidateSHA: string;
    readonly target: string;
  } | null;
  readonly abandoning: boolean;
  readonly waiting: ReadonlyArray<{
    readonly id: string;
    readonly neverSatisfies: boolean;
  }>;
  readonly blockedForever: boolean;
  readonly downstream: number;
  readonly action: unknown;
  readonly [key: string]: unknown;
}

export function taskDetailView(result: GetTaskOutput): TaskDetailView {
  return {
    id: result.id,
    title: result.title,
    status: result.status,
    ...(result.agent !== undefined ? { agent: result.agent } : {}),
    objectiveId: result.objectiveId,
    dependencies: [...result.dependencies],
    ...(result.note !== undefined ? { note: result.note } : {}),
    ...(result.instructions !== undefined
      ? { instructions: result.instructions }
      : {}),
    ...(result.ac !== undefined ? { ac: [...result.ac] } : {}),
    ...(result.verification !== undefined
      ? { verification: [...result.verification] }
      : {}),
    result: result.result === undefined ? null : taskResultView(result.result),
    ...(result.dependencyStatus !== undefined
      ? {
          dependencyStatus: result.dependencyStatus.map((d) => ({
            id: d.id,
            status: d.status,
          })),
        }
      : {}),
    ...(result.context !== undefined ? { context: { ...result.context } } : {}),
    landingCandidate:
      result.landingCandidate === null
        ? null
        : {
            state: result.landingCandidate.state,
            baseSHA: result.landingCandidate.baseSHA,
            candidateSHA: result.landingCandidate.candidateSHA,
            target: result.landingCandidate.target,
          },
    abandoning: result.abandoning,
    waiting: result.waiting.map(unsatisfiedEdgeView),
    blockedForever: result.blockedForever,
    downstream: result.downstream,
    action: nullableActionView(result.action),
  };
}
