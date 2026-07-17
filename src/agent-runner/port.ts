import type { Task } from "../domain/task.ts";

export type TaskResult =
  | { outcome: "completed"; summary?: string }
  | { outcome: "failed"; reason: string };

export interface TaskContextBinding {
  type: string;
  resourceId: string;
}

export interface AgentRunner {
  run(task: Task, context: TaskContextBinding[]): Promise<TaskResult>;
}

export interface AgentRunnerResolver {
  for(task: Task, context: TaskContextBinding[]): AgentRunner;
}

export class RunnerNotResolvableError extends Error {
  readonly taskId: string;
  readonly resourceId: string;

  constructor(taskId: string, resourceId: string) {
    super(
      `No runner resolvable for task ${taskId} with resource ${resourceId}`,
    );
    this.name = "RunnerNotResolvableError";
    this.taskId = taskId;
    this.resourceId = resourceId;
  }
}
