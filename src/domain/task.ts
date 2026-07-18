import type { Entity } from "./entity.ts";
import { newId } from "./entity.ts";

export const TASK_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "awaiting_confirmation",
  "discarded",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task extends Entity {
  objectiveId: string;
  title: string;
  status: TaskStatus;
  dependencies: string[];
  agent?: string;
  instructions?: string;
  ac?: string[];
  verification?: string[];
}

export class InvalidTaskFieldError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`Invalid task field: ${field}`);
    this.name = "InvalidTaskFieldError";
    this.field = field;
  }
}

export function newTask(input: {
  objectiveId: string;
  title: string;
  dependencies?: string[];
  agent?: string;
  instructions?: string;
  ac?: string[];
  verification?: string[];
}): Task {
  if (input.agent !== undefined && input.agent === "")
    throw new InvalidTaskFieldError("agent");
  if (input.instructions !== undefined && input.instructions === "")
    throw new InvalidTaskFieldError("instructions");
  if (input.ac !== undefined && input.ac.length === 0)
    throw new InvalidTaskFieldError("ac");
  if (input.verification !== undefined) {
    for (const cmd of input.verification) {
      if (!cmd) throw new InvalidTaskFieldError("verification");
    }
  }

  const task: Task = {
    id: newId(),
    objectiveId: input.objectiveId,
    title: input.title,
    status: "pending",
    dependencies: input.dependencies ?? [],
  };
  if (input.agent !== undefined) task.agent = input.agent;
  if (input.instructions !== undefined) task.instructions = input.instructions;
  if (input.ac !== undefined) task.ac = [...input.ac];
  if (input.verification !== undefined)
    task.verification = [...input.verification];
  return task;
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

/** Throws `DependenciesLockedError` unless the task's edges may still be edited. */
export function assertDependenciesEditable(task: Task): void {
  if (task.status !== "pending") {
    throw new DependenciesLockedError(task.id, task.status);
  }
}

export function setDependencies(task: Task, dependencies: string[]): Task {
  assertDependenciesEditable(task);
  return { ...task, dependencies: [...dependencies] };
}
