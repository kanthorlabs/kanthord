import type { ApproveOutcome } from "../../../app/task/approve-task.ts";
import type { AbandonOutcome } from "../../../app/task/abandon-task.ts";

export interface TaskApprovalView {
  readonly outcome: string;
  readonly taskId: string;
  readonly canonicalSHA?: string;
  readonly conflictFiles?: readonly string[];
  readonly message?: string;
  readonly [key: string]: unknown;
}

export function taskApprovalView(result: ApproveOutcome): TaskApprovalView {
  return {
    outcome: result.kind,
    taskId: result.taskId,
    ...(result.kind === "approved"
      ? { canonicalSHA: result.canonicalSHA }
      : {}),
    ...(result.kind === "conflict" && result.conflictFiles !== undefined
      ? { conflictFiles: [...result.conflictFiles] }
      : {}),
    ...(result.kind === "landing_failed" ? { message: result.message } : {}),
  };
}

export interface AbandonmentView {
  readonly outcome: string;
  readonly taskId: string;
  readonly [key: string]: unknown;
}

export function abandonmentView(result: AbandonOutcome): AbandonmentView {
  return { outcome: result.outcome, taskId: result.taskId };
}

export interface ObjectiveApprovalView {
  readonly outcome: string;
  readonly [key: string]: unknown;
}

export function objectiveApprovalView(result: {
  outcome: "integrated" | "conflict";
}): ObjectiveApprovalView {
  return { outcome: result.outcome };
}
