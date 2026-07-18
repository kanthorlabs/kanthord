import type { Task } from "../../domain/task.ts";
import { transitionTask } from "../../domain/task.ts";
import { readiness } from "../../domain/graph.ts";
import { newEvent } from "../../domain/event.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork, TaskResultRow } from "../../storage/port.ts";
import type {
  AgentRunnerResolver,
  TaskContextBinding,
  TaskResult,
} from "../../agent-runner/port.ts";

// Narrow structural interface — avoids cascading stub changes on TaskRepository.
interface TaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
  listByInitiative(initiativeId: string): Task[];
  getInitiativeId(taskId: string): string | undefined;
  getTaskContext(taskId: string): Record<string, string>;
  saveTaskResult(taskId: string, row: TaskResultRow): void;
}

type RunResult =
  | { outcome: "idle" }
  | {
      outcome: "skipped" | "completed" | "failed" | "escalated";
      taskId: string;
    };

type Tx1Outcome =
  | { done: true }
  | {
      done: false;
      runningTask: Task;
      contextBindings: TaskContextBinding[];
      initiativeId: string | undefined;
    };

export class RunNextTask {
  readonly #queue: JobQueue;
  readonly #store: TaskStore;
  readonly #feed: EventFeed;
  readonly #uow: UnitOfWork;
  readonly #resolver: AgentRunnerResolver;

  constructor(
    queue: JobQueue,
    store: TaskStore,
    feed: EventFeed,
    uow: UnitOfWork,
    resolver: AgentRunnerResolver,
  ) {
    this.#queue = queue;
    this.#store = store;
    this.#feed = feed;
    this.#uow = uow;
    this.#resolver = resolver;
  }

  async execute(): Promise<RunResult> {
    // Claim before tx1 — claim itself is synchronous and its result drives tx1.
    const claimed = this.#queue.claim();
    if (claimed === undefined) return { outcome: "idle" };

    const { id: jobId, taskId } = claimed;

    // tx1: check readiness; start the task, or discard a stale job.
    const tx1: Tx1Outcome = this.#uow.transaction((): Tx1Outcome => {
      const task = this.#store.get(taskId);
      if (task === undefined) {
        this.#queue.discard(jobId);
        return { done: true };
      }

      const initiativeId = this.#store.getInitiativeId(taskId);
      const allTasks = initiativeId
        ? this.#store.listByInitiative(initiativeId)
        : [task];
      const entries = readiness(allTasks);
      const entry = entries.find((e) => e.id === taskId);

      if (entry === undefined || entry.state !== "ready") {
        this.#queue.discard(jobId);
        return { done: true };
      }

      const contextRecord = this.#store.getTaskContext(taskId);
      const contextBindings: TaskContextBinding[] = Object.entries(
        contextRecord,
      ).map(([type, resourceId]) => ({ type, resourceId }));

      const runningTask = transitionTask(task, "running");
      this.#store.save(runningTask);
      this.#feed.append(newEvent("task.started", { taskId }));

      return { done: false, runningTask, contextBindings, initiativeId };
    });

    if (tx1.done) return { outcome: "skipped", taskId };

    const { runningTask, contextBindings, initiativeId } = tx1;

    // Between tx1 and tx2: resolve runner and await the run.
    let failReason: string | null = null;
    let completedResult:
      Extract<TaskResult, { outcome: "completed" }> | undefined;
    let escalatedResult:
      Extract<TaskResult, { outcome: "escalated" }> | undefined;

    try {
      const runner = this.#resolver.for(runningTask, contextBindings);
      const result = await runner.run(runningTask, contextBindings);
      if (result.outcome === "completed") {
        completedResult = result;
      } else if (result.outcome === "escalated") {
        escalatedResult = result;
      } else {
        failReason = result.reason;
      }
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      failReason = `${e.name}: ${e.message}`;
    }

    // tx2: persist the outcome.
    this.#uow.transaction(() => {
      if (completedResult !== undefined) {
        const completedTask = transitionTask(runningTask, "completed");
        this.#store.save(completedTask);
        this.#queue.finish(jobId, "completed");
        this.#feed.append(newEvent("task.completed", { taskId }));

        // Persist the task result row so `get task` can display it.
        this.#store.saveTaskResult(taskId, {
          workspace: completedResult.workspace ?? null,
          branch: completedResult.branch ?? null,
          baseCommit: null,
          proposalCommit: null,
          commitSha: completedResult.commitSha ?? null,
          summary: completedResult.summary ?? null,
          reason: null,
          rejectionResolution: null,
          rejectionReason: null,
          evidence: completedResult.evidence ?? null,
        });

        // Re-scan the initiative for newly-ready tasks.
        const refreshed = initiativeId
          ? this.#store.listByInitiative(initiativeId)
          : [];
        for (const entry of readiness(refreshed)) {
          if (entry.state === "ready") {
            const inserted = this.#queue.enqueue(entry.id);
            if (inserted) {
              this.#feed.append(newEvent("task.ready", { taskId: entry.id }));
            }
          }
        }
      } else if (escalatedResult !== undefined) {
        const escalatedTask = transitionTask(
          runningTask,
          "awaiting_confirmation",
        );
        this.#store.save(escalatedTask);
        this.#queue.finish(jobId, "completed");
        const payload: Record<string, string> = {
          reason: escalatedResult.reason,
          baseCommit: escalatedResult.baseCommit,
          summary: escalatedResult.summary,
        };
        if (escalatedResult.proposalCommit !== undefined) {
          payload["proposalCommit"] = escalatedResult.proposalCommit;
        }
        this.#feed.append(newEvent("task.escalated", { taskId, payload }));
        this.#store.saveTaskResult(taskId, {
          workspace: escalatedResult.workspace,
          branch: escalatedResult.branch,
          baseCommit: escalatedResult.baseCommit,
          proposalCommit: escalatedResult.proposalCommit ?? null,
          commitSha: null,
          summary: escalatedResult.summary,
          reason: escalatedResult.reason,
          rejectionResolution: null,
          rejectionReason: null,
          evidence: null,
        });
      } else {
        const reason = failReason ?? "unknown failure";
        const failedTask = transitionTask(runningTask, "failed");
        this.#store.save(failedTask);
        this.#queue.finish(jobId, "failed");
        this.#feed.append(
          newEvent("task.failed", { taskId, payload: { reason } }),
        );
      }
    });

    if (completedResult !== undefined) return { outcome: "completed", taskId };
    if (escalatedResult !== undefined) return { outcome: "escalated", taskId };
    return { outcome: "failed", taskId };
  }
}
