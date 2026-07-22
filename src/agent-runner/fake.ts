import type { Task } from "../domain/task.ts";
import type { AgentRunner, TaskContextBinding, TaskResult } from "./port.ts";

export class FakeRunner implements AgentRunner {
  readonly calls: Array<{ taskId: string; context: TaskContextBinding[] }> = [];

  readonly #failTaskIds: ReadonlySet<string>;
  readonly #failTransient: Map<string, number>;

  constructor(opts: {
    failTaskIds?: string[];
    failTransient?: Record<string, number>;
  }) {
    this.#failTaskIds = new Set(opts.failTaskIds ?? []);
    this.#failTransient = new Map(Object.entries(opts.failTransient ?? {}));
  }

  async run(task: Task, context: TaskContextBinding[]): Promise<TaskResult> {
    this.calls.push({ taskId: task.id, context });

    if (this.#failTaskIds.has(task.id)) {
      return { outcome: "failed", reason: "scripted failure" };
    }

    const remaining = this.#failTransient.get(task.id) ?? 0;
    if (remaining > 0) {
      this.#failTransient.set(task.id, remaining - 1);
      return {
        outcome: "failed",
        reason: "scripted transient failure",
        transient: true,
      };
    }

    return { outcome: "completed", summary: "fake" };
  }
}
