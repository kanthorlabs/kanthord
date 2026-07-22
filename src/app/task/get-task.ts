import type { Task } from "../../domain/task.ts";
import type { TaskResultRow } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";

interface TaskSource {
  get(id: string): Task | undefined;
}

interface ResultSource {
  getTaskResult(taskId: string): TaskResultRow | undefined;
}

interface ContextSource {
  getTaskContext(taskId: string): Record<string, string>;
}

export interface GetTaskOutput {
  id: string;
  title: string;
  status: string;
  agent: string | undefined;
  objectiveId: string;
  dependencies: string[];
  note?: string;
  instructions?: string;
  ac?: string[];
  verification?: string[];
  result: TaskResultRow | undefined;
  dependencyStatus?: Array<{ id: string; status: string }>;
  context?: Record<string, string>;
}

export class GetTask {
  readonly #tasks: TaskSource;
  readonly #results: ResultSource;
  readonly #context: ContextSource;

  constructor(
    tasks: TaskSource,
    results: ResultSource,
    context: ContextSource,
  ) {
    this.#tasks = tasks;
    this.#results = results;
    this.#context = context;
  }

  async execute({ id }: { id: string }): Promise<GetTaskOutput> {
    const task = this.#tasks.get(id);
    if (task === undefined) {
      throw new UnknownReferenceError("task", id);
    }
    const result = this.#results.getTaskResult(id);
    const ctx = this.#context.getTaskContext(id);

    const dependencyStatus =
      task.dependencies.length > 0
        ? task.dependencies.map((depId) => {
            const dep = this.#tasks.get(depId);
            return { id: depId, status: dep?.status ?? "unknown" };
          })
        : undefined;

    return {
      id: task.id,
      title: task.title,
      status: task.status,
      agent: task.agent,
      objectiveId: task.objectiveId,
      dependencies: task.dependencies,
      ...(task.note !== undefined ? { note: task.note } : {}),
      ...(task.instructions !== undefined
        ? { instructions: task.instructions }
        : {}),
      ...(task.ac !== undefined ? { ac: task.ac } : {}),
      ...(task.verification !== undefined
        ? { verification: task.verification }
        : {}),
      result,
      ...(dependencyStatus !== undefined ? { dependencyStatus } : {}),
      ...(Object.keys(ctx).length > 0 ? { context: ctx } : {}),
    };
  }
}
