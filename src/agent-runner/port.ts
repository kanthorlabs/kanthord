import type { Task } from "../domain/task.ts";
import type { VerificationEvidence } from "./verification.ts";

export type { VerificationEvidence };

export interface AgentCatalog {
  has(ref: string): boolean;
}

export class UnknownAgentError extends Error {
  readonly agent: string;

  constructor(agent: string) {
    super(`unknown agent: ${agent}`);
    this.name = "UnknownAgentError";
    this.agent = agent;
  }
}

export type TaskResult =
  | {
      outcome: "completed";
      summary?: string;
      workspace?: string;
      branch?: string;
      commitSha?: string;
      evidence?: VerificationEvidence[];
    }
  | {
      outcome: "failed";
      reason: string;
      transient?: boolean;
      retryAfterMs?: number;
    }
  | {
      outcome: "escalated";
      reason: string;
      summary: string;
      workspace: string;
      branch: string;
      baseCommit: string;
      proposalCommit?: string;
    }
  | {
      outcome: "candidate";
      workspace: string;
      branch: string;
      baseCommit: string;
      candidateCommit: string;
      summary: string;
      evidence?: VerificationEvidence[];
    };

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
  readonly agent: string;

  constructor(taskId: string, agent: string) {
    super(`No runner resolvable for task ${taskId} with agent ${agent}`);
    this.name = "RunnerNotResolvableError";
    this.taskId = taskId;
    this.agent = agent;
  }
}
