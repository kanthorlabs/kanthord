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

/** Throws `InvalidTaskFieldError(field)` when `value` contains `"\n"` or is all-whitespace. */
function assertSingleLineNonEmpty(field: string, value: string): void {
  if (value.includes("\n") || value.trim() === "") {
    throw new InvalidTaskFieldError(field);
  }
}

export function newTask(input: {
  id?: string;
  objectiveId: string;
  title: string;
  dependencies?: string[];
  agent?: string;
  instructions?: string;
  ac?: string[];
  verification?: string[];
}): Task {
  assertSingleLineNonEmpty("title", input.title);
  if (input.agent !== undefined && input.agent === "")
    throw new InvalidTaskFieldError("agent");
  if (input.instructions !== undefined && input.instructions === "")
    throw new InvalidTaskFieldError("instructions");
  if (input.ac !== undefined) {
    if (input.ac.length === 0) throw new InvalidTaskFieldError("ac");
    for (const item of input.ac) {
      assertSingleLineNonEmpty("ac", item);
    }
  }
  if (input.verification !== undefined) {
    for (const cmd of input.verification) {
      assertSingleLineNonEmpty("verification", cmd);
    }
  }

  const task: Task = {
    id: input.id ?? newId(),
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

export class TaskSpecLockedError extends Error {
  readonly taskId: string;
  readonly status: TaskStatus;

  constructor(taskId: string, status: TaskStatus) {
    super(`Task spec is locked for task ${taskId} in status ${status}`);
    this.name = "TaskSpecLockedError";
    this.taskId = taskId;
    this.status = status;
  }
}

/** Throws `TaskSpecLockedError` unless the task's spec may still be edited. */
export function assertTaskSpecEditable(task: Task): void {
  if (task.status !== "pending") {
    throw new TaskSpecLockedError(task.id, task.status);
  }
}

export interface TaskSpecPatch {
  title?: string;
  instructions?: string;
  ac?: string[];
  agent?: string;
  verification?: string[] | null;
}

export function reparentTask(task: Task, objectiveId: string): Task {
  assertTaskSpecEditable(task);
  return { ...task, objectiveId };
}

export function applyTaskSpec(task: Task, patch: TaskSpecPatch): Task {
  assertTaskSpecEditable(task);

  const updated: Task = { ...task };

  if (patch.title !== undefined) {
    assertSingleLineNonEmpty("title", patch.title);
    updated.title = patch.title;
  }
  if (patch.instructions !== undefined) {
    if (patch.instructions === "")
      throw new InvalidTaskFieldError("instructions");
    updated.instructions = patch.instructions;
  }
  if (patch.ac !== undefined) {
    if (patch.ac.length === 0) throw new InvalidTaskFieldError("ac");
    for (const item of patch.ac) {
      assertSingleLineNonEmpty("ac", item);
    }
    updated.ac = [...patch.ac];
  }
  if (patch.agent !== undefined) {
    if (patch.agent === "") throw new InvalidTaskFieldError("agent");
    updated.agent = patch.agent;
  }
  if ("verification" in patch) {
    if (
      patch.verification === null ||
      (Array.isArray(patch.verification) && patch.verification.length === 0)
    ) {
      updated.verification = undefined;
    } else if (patch.verification !== undefined) {
      for (const cmd of patch.verification) {
        assertSingleLineNonEmpty("verification", cmd);
      }
      updated.verification = [...patch.verification];
    }
  }

  return updated;
}
