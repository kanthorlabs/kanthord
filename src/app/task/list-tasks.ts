import type { TaskRepository } from "../../storage/port.ts";
import type { TaskStatus } from "../../domain/task.ts";
import { validateGraph, readiness } from "../../domain/graph.ts";
import { UnknownReferenceError } from "../errors.ts";

export interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  state: "ready" | "blocked";
  waiting: string[];
}

export class ListTasks {
  readonly #taskRepo: TaskRepository;

  constructor(taskRepo: TaskRepository) {
    this.#taskRepo = taskRepo;
  }

  async execute(input: {
    initiativeId: string;
    status?: TaskStatus;
    objectiveId?: string;
  }): Promise<TaskRow[]> {
    const tasks = this.#taskRepo.listByInitiative(input.initiativeId);

    if (tasks.length === 0) {
      throw new UnknownReferenceError("initiative", input.initiativeId);
    }

    const nodes = tasks.map((t) => ({
      id: t.id,
      status: t.status,
      dependencies: t.dependencies,
    }));

    validateGraph(nodes);

    const readinessMap = new Map(readiness(nodes).map((r) => [r.id, r]));

    // Filter by objective when requested; validate against the full initiative graph first.
    const scopedTasks =
      input.objectiveId !== undefined
        ? tasks.filter((t) => t.objectiveId === input.objectiveId)
        : tasks;

    const rows = scopedTasks.map((t) => {
      const r = readinessMap.get(t.id);
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        state: r?.state ?? "ready",
        waiting: r?.waiting ?? [],
      };
    });

    if (input.status !== undefined) {
      return rows.filter((row) => row.status === input.status);
    }
    return rows;
  }
}
