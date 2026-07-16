import {
  validateGraph,
  readiness,
  type ReadinessEntry,
} from "../../domain/graph.ts";

export class CheckGraph {
  execute(input: {
    tasks: Array<{ id: string; dependencies?: string[] }>;
  }): ReadinessEntry[] {
    const nodes = input.tasks.map((t) => ({
      id: t.id,
      status: "pending" as const,
      dependencies: t.dependencies ?? [],
    }));
    validateGraph(nodes);
    return readiness(nodes);
  }
}
