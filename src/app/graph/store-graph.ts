import type { TaskRepository } from "../../storage/port.ts";
import type { Task } from "../../domain/task.ts";
import { newTask } from "../../domain/task.ts";
import { validateGraph } from "../../domain/graph.ts";
import type { GraphNode } from "../../domain/graph.ts";

export interface TaskInput {
  id: string;
  title?: string;
  dependencies?: string[];
}

export interface StoreGraphInput {
  objectiveId: string;
  tasks: TaskInput[];
}

export class StoreGraph {
  readonly #repo: TaskRepository;

  constructor(repo: TaskRepository) {
    this.#repo = repo;
  }

  async execute(input: StoreGraphInput): Promise<Task[]> {
    const { objectiveId, tasks: taskInputs } = input;

    // Step 1: build label-keyed GraphNodes for validation
    const graphNodes: GraphNode[] = taskInputs.map((t) => ({
      id: t.id,
      status: "pending",
      dependencies: t.dependencies ?? [],
    }));

    // Step 2: validate (throws CycleError / DuplicateTaskError before any I/O)
    validateGraph(graphNodes);

    // Step 3: create Tasks via newTask (title defaults to label id, no deps yet)
    const labelToTask = new Map<string, Task>();
    const tasks: Task[] = taskInputs.map((t) => {
      const task = newTask({
        objectiveId,
        title: t.title ?? t.id,
        dependencies: [],
      });
      labelToTask.set(t.id, task);
      return task;
    });

    // Step 4: remap label dependencies to new ULIDs
    for (let i = 0; i < taskInputs.length; i++) {
      const input = taskInputs[i]!;
      if (input.dependencies && input.dependencies.length > 0) {
        tasks[i] = {
          ...tasks[i]!,
          dependencies: input.dependencies.map((label) => {
            const dep = labelToTask.get(label);
            if (dep === undefined) {
              throw new Error(`Unknown dependency label: ${label}`);
            }
            return dep.id;
          }),
        };
      }
    }

    // Step 5: persist all tasks in one call
    this.#repo.saveAll(tasks);

    // Step 6: return in input order
    return tasks;
  }
}
