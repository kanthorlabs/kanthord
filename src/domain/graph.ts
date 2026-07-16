import type { TaskStatus } from "./task.ts";

export interface GraphNode {
  id: string;
  status: TaskStatus;
  dependencies: string[];
}

export class DuplicateTaskError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`Duplicate task id: ${taskId}`);
    this.name = "DuplicateTaskError";
    this.taskId = taskId;
  }
}

export class UnknownDependencyError extends Error {
  readonly taskId: string;
  readonly dependency: string;

  constructor(taskId: string, dependency: string) {
    super(`Task ${taskId} depends on unknown task ${dependency}`);
    this.name = "UnknownDependencyError";
    this.taskId = taskId;
    this.dependency = dependency;
  }
}

export class CycleError extends Error {
  readonly path: string[];

  constructor(path: string[]) {
    super(`Cycle detected: ${path.join(" -> ")}`);
    this.name = "CycleError";
    this.path = path;
  }
}

export function validateGraph(nodes: GraphNode[]): void {
  // 1. Duplicates first (highest precedence)
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) {
      throw new DuplicateTaskError(node.id);
    }
    seen.add(node.id);
  }

  const idSet = new Set(nodes.map((n) => n.id));

  // 2. Unknown dependency references
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      if (!idSet.has(dep)) {
        throw new UnknownDependencyError(node.id, dep);
      }
    }
  }

  // 3. Cycle detection via DFS, scanning nodes in input order for determinism
  const adjMap = new Map<string, string[]>();
  for (const node of nodes) {
    adjMap.set(node.id, node.dependencies);
  }

  const WHITE = 0; // unvisited
  const GRAY = 1; // on current recursion stack
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  for (const node of nodes) {
    color.set(node.id, WHITE);
  }

  const stack: string[] = [];

  function dfs(nodeId: string): void {
    color.set(nodeId, GRAY);
    stack.push(nodeId);

    const deps = adjMap.get(nodeId) ?? [];
    for (const dep of deps) {
      if (color.get(dep) === GRAY) {
        // Build cycle path: from the first occurrence of dep in stack to current, then dep again
        const cycleStart = stack.indexOf(dep);
        const cyclePath = stack.slice(cycleStart);
        cyclePath.push(dep);
        throw new CycleError(cyclePath);
      }
      if (color.get(dep) === WHITE) {
        dfs(dep);
      }
    }

    stack.pop();
    color.set(nodeId, BLACK);
  }

  for (const node of nodes) {
    if (color.get(node.id) === WHITE) {
      dfs(node.id);
    }
  }
}

export interface ReadinessEntry {
  id: string;
  state: "ready" | "blocked";
  waiting: string[];
}

export function readiness(nodes: GraphNode[]): ReadinessEntry[] {
  const statusMap = new Map<string, string>();
  for (const node of nodes) {
    statusMap.set(node.id, node.status);
  }

  const result: ReadinessEntry[] = [];
  for (const node of nodes) {
    if (node.status !== "pending") continue;

    const waiting = node.dependencies.filter(
      (dep) => statusMap.get(dep) !== "completed"
    );

    result.push({
      id: node.id,
      state: waiting.length === 0 ? "ready" : "blocked",
      waiting,
    });
  }
  return result;
}
