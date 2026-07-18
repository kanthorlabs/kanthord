import type { Task } from "../../domain/task.ts";
import type { TaskResultRow } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";

interface TaskSource {
  get(id: string): Task | undefined;
}

interface ResultSource {
  getTaskResult(taskId: string): TaskResultRow | undefined;
}

export interface GetTaskOutput {
  id: string;
  title: string;
  status: string;
  agent: string | undefined;
  objectiveId: string;
  dependencies: string[];
  instructions?: string;
  ac?: string[];
  verification?: string[];
  result: TaskResultRow | undefined;
  dependencyStatus?: Array<{ id: string; status: string }>;
}

export class GetTask {
  readonly #tasks: TaskSource;
  readonly #results: ResultSource;

  constructor(tasks: TaskSource, results: ResultSource) {
    this.#tasks = tasks;
    this.#results = results;
  }

  async execute({ id }: { id: string }): Promise<GetTaskOutput> {
    const task = this.#tasks.get(id);
    if (task === undefined) {
      throw new UnknownReferenceError("task", id);
    }
    const result = this.#results.getTaskResult(id);

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
      ...(task.instructions !== undefined
        ? { instructions: task.instructions }
        : {}),
      ...(task.ac !== undefined ? { ac: task.ac } : {}),
      ...(task.verification !== undefined
        ? { verification: task.verification }
        : {}),
      result,
      ...(dependencyStatus !== undefined ? { dependencyStatus } : {}),
    };
  }
}
