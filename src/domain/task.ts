import type { Entity } from "./entity.ts";
import { newId } from "./entity.ts";

export const TASK_STATUSES = ["pending", "running", "completed", "failed", "awaiting_confirmation", "discarded"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task extends Entity {
  objectiveId: string;
  title: string;
  status: TaskStatus;
  dependencies: string[];
}

export function newTask(input: {
  objectiveId: string;
  title: string;
  dependencies?: string[];
}): Task {
  return {
    id: newId(),
    objectiveId: input.objectiveId,
    title: input.title,
    status: "pending",
    dependencies: input.dependencies ?? [],
  };
}

const LEGAL_TRANSITIONS: ReadonlySet<string> = new Set([
  "pending->running",
  "running->completed",
  "running->failed",
  "failed->pending",
  "running->pending",
  "running->awaiting_confirmation",
  "awaiting_confirmation->completed",
  "awaiting_confirmation->pending",
  "awaiting_confirmation->discarded",
]);

export class IllegalTransitionError extends Error {
  readonly from: TaskStatus;
  readonly to: TaskStatus;

  constructor(from: TaskStatus, to: TaskStatus) {
    super(`Illegal transition: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function transitionTask(task: Task, to: TaskStatus): Task {
  const key = `${task.status}->${to}`;
  if (!LEGAL_TRANSITIONS.has(key)) {
    throw new IllegalTransitionError(task.status, to);
  }
  return { ...task, status: to };
}

export class DependenciesLockedError extends Error {
  readonly taskId: string;
  readonly status: TaskStatus;

  constructor(taskId: string, status: TaskStatus) {
    super(`Dependencies are locked for task ${taskId} in status ${status}`);
    this.name = "DependenciesLockedError";
    this.taskId = taskId;
    this.status = status;
  }
}

export function setDependencies(task: Task, dependencies: string[]): Task {
  if (task.status !== "pending") {
    throw new DependenciesLockedError(task.id, task.status);
  }
  return { ...task, dependencies: [...dependencies] };
}
