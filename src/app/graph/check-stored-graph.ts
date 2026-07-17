import type { TaskRepository } from "../../storage/port.ts";
import { validateGraph, readiness } from "../../domain/graph.ts";
import type { ReadinessEntry } from "../../domain/graph.ts";

export class CheckStoredGraph {
  readonly #repo: TaskRepository;

  constructor(repo: TaskRepository) {
    this.#repo = repo;
  }

  async execute(input: { initiativeId: string }): Promise<ReadinessEntry[]> {
    const tasks = this.#repo.listByInitiative(input.initiativeId);

    // Propagates CycleError / UnknownDependencyError before any further work
    validateGraph(tasks);

    return readiness(tasks);
  }
}
