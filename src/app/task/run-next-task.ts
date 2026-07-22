import type { Task } from "../../domain/task.ts";
import { transitionTask } from "../../domain/task.ts";
import { readiness } from "../../domain/graph.ts";
import { newEvent } from "../../domain/event.ts";
import { newId } from "../../domain/entity.ts";
import { newChangeCandidate } from "../../domain/landing.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type {
  UnitOfWork,
  TaskResultRow,
  LandingRepository,
} from "../../storage/port.ts";
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
  getRepositoryBranch?(repoId: string): string | undefined;
  saveTaskResult(taskId: string, row: TaskResultRow): void;
}

type RunResult =
  | { outcome: "idle" }
  | {
      outcome: "skipped" | "completed" | "failed" | "escalated" | "candidate";
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

// 007.9 Story 02 — retry policy tuning. Small default (investigation: the SDK
// already absorbs some transient HTTP noise below the turn boundary, so this
// task/turn-level retry budget is kept small rather than stacked deep).
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_ELAPSED_MS = 120_000;
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5_000;

/** Exponential backoff with full jitter, capped, honoring retryAfterMs as a floor. */
function backoffDelayMs(attempt: number, retryAfterMs?: number): number {
  const cap = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
  const jittered = Math.random() * cap;
  return Math.max(jittered, retryAfterMs ?? 0);
}

export class RunNextTask {
  readonly #queue: JobQueue;
  readonly #store: TaskStore;
  readonly #feed: EventFeed;
  readonly #uow: UnitOfWork;
  readonly #resolver: AgentRunnerResolver;
  readonly #landing?: LandingRepository;
  readonly #maxAttempts: number;
  readonly #maxElapsedMs: number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(
    queue: JobQueue,
    store: TaskStore,
    feed: EventFeed,
    uow: UnitOfWork,
    resolver: AgentRunnerResolver,
    landing?: LandingRepository,
    opts?: { maxAttempts?: number; sleep?: (ms: number) => Promise<void> },
  ) {
    this.#queue = queue;
    this.#store = store;
    this.#feed = feed;
    this.#uow = uow;
    this.#resolver = resolver;
    this.#landing = landing;
    this.#maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#maxElapsedMs = DEFAULT_MAX_ELAPSED_MS;
    this.#sleep =
      opts?.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
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

    // Between tx1 and tx2: resolve runner and await the run, retrying a
    // transient failure (007.9 Story 02) — bounded by attempts + elapsed time.
    let failReason: string | null = null;
    let completedResult:
      Extract<TaskResult, { outcome: "completed" }> | undefined;
    let escalatedResult:
      Extract<TaskResult, { outcome: "escalated" }> | undefined;
    let candidateResult:
      Extract<TaskResult, { outcome: "candidate" }> | undefined;
    let attempts = 0;

    try {
      const runner = this.#resolver.for(runningTask, contextBindings);
      const startedAt = Date.now();
      let result: TaskResult;
      for (;;) {
        attempts += 1;
        result = await runner.run(runningTask, contextBindings);

        if (result.outcome !== "failed" || result.transient !== true) break;

        const attemptsRemain = attempts < this.#maxAttempts;
        const elapsedOk = Date.now() - startedAt < this.#maxElapsedMs;
        if (!attemptsRemain || !elapsedOk) break;

        this.#feed.append(
          newEvent("provider.retry", {
            taskId,
            payload: { attempt: String(attempts), reason: result.reason },
          }),
        );
        await this.#sleep(backoffDelayMs(attempts, result.retryAfterMs));
      }

      if (result.outcome === "completed") {
        completedResult = result;
      } else if (result.outcome === "escalated") {
        escalatedResult = result;
      } else if (result.outcome === "failed") {
        failReason = result.reason;
      } else {
        candidateResult = result;
      }
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      failReason = `${e.name}: ${e.message}`;
    }

    // tx2: persist the outcome.
    let resultOutcome: "completed" | "failed" | "escalated" | "candidate" =
      "failed";
    this.#uow.transaction(() => {
      if (completedResult !== undefined) {
        resultOutcome = "completed";
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
        resultOutcome = "escalated";
      } else if (candidateResult !== undefined) {
        // A changed run produced a landing candidate.
        // With a repository binding there is something to land → hold at
        // awaiting_confirmation and persist the candidate atomically (F3).
        // Without a repository binding (filesystem-backed task) there is
        // nothing to land → complete directly.
        const repoBinding = contextBindings.find(
          (b) => b.type === "repository",
        );
        if (repoBinding === undefined) {
          const completedTask = transitionTask(runningTask, "completed");
          this.#store.save(completedTask);
          this.#queue.finish(jobId, "completed");
          // A filesystem-bound changed task still completes — emit the event so
          // a client polling `list event` observes it (mirrors the repo-bound
          // completed path at :145).
          this.#feed.append(newEvent("task.completed", { taskId }));
          this.#store.saveTaskResult(taskId, {
            workspace: candidateResult.workspace,
            branch: candidateResult.branch,
            baseCommit: candidateResult.baseCommit,
            proposalCommit: candidateResult.candidateCommit,
            commitSha: null,
            summary: candidateResult.summary,
            reason: null,
            rejectionResolution: null,
            rejectionReason: null,
            evidence: candidateResult.evidence ?? null,
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
          resultOutcome = "completed";
        } else {
          // Persist a fresh candidate id that identifies THIS execution attempt
          // (not the legacy `${taskId}-lc`), in the SAME transaction as the
          // task transition so a crash can never leave a candidate-less
          // awaiting_confirmation (F3 / Story 04 T1).
          const candidateId = newId();
          const target =
            this.#store.getRepositoryBranch?.(repoBinding.resourceId) ?? "main";
          const candidate = newChangeCandidate({
            id: candidateId,
            taskId,
            repoId: repoBinding.resourceId,
            baseSHA: candidateResult.baseCommit,
            candidateSHA: candidateResult.candidateCommit,
            ref: candidateResult.branch,
            target,
          });
          this.#landing?.saveCandidate(candidate);

          const candidateTask = transitionTask(
            runningTask,
            "awaiting_confirmation",
          );
          this.#store.save(candidateTask);
          this.#queue.finish(jobId, "completed");
          this.#store.saveTaskResult(taskId, {
            workspace: candidateResult.workspace,
            branch: candidateResult.branch,
            baseCommit: candidateResult.baseCommit,
            proposalCommit: candidateResult.candidateCommit,
            commitSha: null,
            summary: candidateResult.summary,
            reason: null,
            rejectionResolution: null,
            rejectionReason: null,
            evidence: candidateResult.evidence ?? null,
          });
          resultOutcome = "candidate";
        }
      } else {
        const reason = failReason ?? "unknown failure";
        const failedTask = transitionTask(runningTask, "failed");
        this.#store.save(failedTask);
        this.#queue.finish(jobId, "failed");
        this.#feed.append(
          newEvent("task.failed", {
            taskId,
            payload: { reason, attempts: String(attempts) },
          }),
        );
        resultOutcome = "failed";
      }
    });

    return { outcome: resultOutcome, taskId };
  }
}
