import type { Task } from "../domain/task.ts";
import type { AgentRunner, TaskContextBinding, TaskResult } from "./port.ts";

export class FakeRunner implements AgentRunner {
  readonly calls: Array<{ taskId: string; context: TaskContextBinding[] }> = [];

  readonly #failTaskIds: ReadonlySet<string>;

  constructor(opts: { failTaskIds?: string[] }) {
    this.#failTaskIds = new Set(opts.failTaskIds ?? []);
  }

  async run(task: Task, context: TaskContextBinding[]): Promise<TaskResult> {
    this.calls.push({ taskId: task.id, context });

    if (this.#failTaskIds.has(task.id)) {
      return { outcome: "failed", reason: "scripted failure" };
    }

    return { outcome: "completed", summary: "fake" };
  }
}
