import { readFile } from "node:fs/promises";
import { parse } from "yaml";

import {
  CheckGraph,
  CycleError,
  DuplicateTaskError,
  UnknownDependencyError,
  type ReadinessEntry,
} from "../../app/graph/check-graph.ts";

interface TaskRow {
  id: string;
  dependencies?: string[];
}

class ShapeError extends Error {}

function validateShape(data: unknown): TaskRow[] {
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as Record<string, unknown>)["tasks"])
  ) {
    throw new ShapeError();
  }
  const tasks = (data as Record<string, unknown>)["tasks"] as unknown[];
  for (const task of tasks) {
    if (
      typeof task !== "object" ||
      task === null ||
      typeof (task as Record<string, unknown>)["id"] !== "string"
    ) {
      throw new ShapeError();
    }
  }
  return tasks as TaskRow[];
}

function formatEntry(entry: ReadinessEntry): string {
  if (entry.state === "ready") {
    return `${entry.id}: ready`;
  }
  return `${entry.id}: blocked (waiting: ${entry.waiting.join(", ")})`;
}

export async function runGraphCheck(
  filePath: string,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return {
      exitCode: 1,
      stderr: ["error: invalid graph file: cannot read file"],
      stdout: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch {
    return {
      exitCode: 1,
      stderr: ["error: invalid graph file: invalid YAML"],
      stdout: [],
    };
  }

  let tasks: TaskRow[];
  try {
    tasks = validateShape(parsed);
  } catch {
    return {
      exitCode: 1,
      stderr: [
        "error: invalid graph file: tasks must be a list of { id, dependencies? }",
      ],
      stdout: [],
    };
  }

  let entries: ReadinessEntry[];
  try {
    entries = new CheckGraph().execute({ tasks });
  } catch (err) {
    if (err instanceof CycleError) {
      return {
        exitCode: 1,
        stderr: [`error: cycle detected: ${err.path.join(" -> ")}`],
        stdout: [],
      };
    }
    if (err instanceof UnknownDependencyError) {
      return {
        exitCode: 1,
        stderr: [
          `error: unknown dependency: ${err.dependency} (referenced by ${err.taskId})`,
        ],
        stdout: [],
      };
    }
    if (err instanceof DuplicateTaskError) {
      return {
        exitCode: 1,
        stderr: [`error: duplicate task id: ${err.taskId}`],
        stdout: [],
      };
    }
    throw err;
  }

  return {
    exitCode: 0,
    stdout: entries.map(formatEntry),
    stderr: [],
  };
}
