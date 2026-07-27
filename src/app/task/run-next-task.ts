import type { Task } from "../../domain/task.ts";
import { transitionTask } from "../../domain/task.ts";
import { readiness } from "../../domain/graph.ts";
import { newEvent } from "../../domain/event.ts";
import { unsatisfiedObjectiveEdges } from "../../domain/sequencing.ts";
import { newId } from "../../domain/entity.ts";
import { newChangeCandidate } from "../../domain/landing.ts";
import type { Objective } from "../../domain/initiative.ts";
import { transitionObjective } from "../../domain/initiative.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type {
  UnitOfWork,
  TaskResultRow,
  LandingRepository,
} from "../../storage/port.ts";
import type {
  AgentRunnerResolver,
  ResolvedProvider,
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
  // Story B objective-boundary squash — the objective read/write + expected
  // parent-OID lookup needed to squash + transition an initiative-clone
  // objective once its last task completes.
  getObjective?(id: string): Objective | undefined;
  saveObjective?(objective: Objective): void;
  getObjectiveParentOid?(objectiveId: string): string;
  // Story 3 — objective-level sequencing gate: list prerequisites (deprecated;
  // prefer the `sequencing` constructor param). Kept for test backward compat.
  listObjectiveAfter?(objectiveId: string): string[];
}

interface WorkspaceSquasher {
  squashObjective(
    dir: string,
    parentOid: string,
    message: string,
  ): Promise<{ oid: string }>;
}

// Story A/B wiring gap — the daemon-only initiative branch/clone provisioning
// (LocalWorkspaceManager.prepareInitiative + InitiativeRepository.setWorkspace,
// both already implemented) was never invoked anywhere in the production call
// graph. This narrow collaborator is the seam through which RunNextTask
// triggers that provisioning once per initiative, before the task runs.
interface InitiativeWorkspaces {
  ensure(initiativeId: string): Promise<void>;
}

type RunResult =
  | { outcome: "idle" }
  | {
      outcome: "skipped" | "completed" | "failed" | "escalated" | "candidate";
      taskId: string;
      /**
       * 008.4 Story D — how many times this dispatch failed over to the next
       * provider in the chain. Absent when the task never failed over, so
       * RunDaemon's summary can sum it without a per-outcome special case.
       */
      failovers?: number;
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
  readonly #workspaces?: WorkspaceSquasher;
  readonly #initiativeWorkspaces?: InitiativeWorkspaces;
  readonly #sequencing?: { listObjectiveAfter: (id: string) => string[] };
  readonly #providerChainFor?: (initiativeId: string) => ResolvedProvider[];
  readonly #getProjectId?: (initiativeId: string) => string | undefined;

  constructor(
    queue: JobQueue,
    store: TaskStore,
    feed: EventFeed,
    uow: UnitOfWork,
    resolver: AgentRunnerResolver,
    landing?: LandingRepository,
    opts?: {
      maxAttempts?: number;
      sleep?: (ms: number) => Promise<void>;
      workspaces?: WorkspaceSquasher;
      initiativeWorkspaces?: InitiativeWorkspaces;
      sequencing?: { listObjectiveAfter: (id: string) => string[] };
      providerChainFor?: (initiativeId: string) => ResolvedProvider[];
      getProjectId?: (initiativeId: string) => string | undefined;
    },
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
    this.#workspaces = opts?.workspaces;
    this.#initiativeWorkspaces = opts?.initiativeWorkspaces;
    this.#sequencing = opts?.sequencing;
    this.#providerChainFor = opts?.providerChainFor;
    this.#getProjectId = opts?.getProjectId;
  }

  /**
   * Re-scan the initiative and enqueue newly-ready tasks, gating on
   * objective-level after sets so a blocked objective's tasks are not enqueued.
   */
  #enqueueNewlyReady(initiativeId: string | undefined): void {
    const refreshed = initiativeId
      ? this.#store.listByInitiative(initiativeId)
      : [];
    for (const entry of readiness(refreshed)) {
      if (entry.state !== "ready") continue;

      // Objective-level gate: check after edges before enqueuing
      const task = this.#store.get(entry.id);
      if (task !== undefined && task.objectiveId) {
        const listAfter: ((id: string) => string[]) | undefined =
          this.#sequencing?.listObjectiveAfter ??
          this.#store.listObjectiveAfter;
        if (listAfter !== undefined) {
          const after = listAfter(task.objectiveId);
          if (after.length > 0) {
            const deps = after.map((depId) => ({
              id: depId,
              status: this.#store.getObjective?.(depId)?.status,
            }));
            if (unsatisfiedObjectiveEdges(deps).length > 0) continue;
          }
        }
      }

      const inserted = this.#queue.enqueue(entry.id);
      if (inserted) {
        this.#feed.append(newEvent("task.ready", { taskId: entry.id }));
      }
    }
  }

  async execute(): Promise<RunResult> {
    // Claim before tx1 — claim itself is synchronous and its result drives tx1.
    const claimed = this.#queue.claim();
    if (claimed === undefined) return { outcome: "idle" };

    const { id: jobId, taskId } = claimed;

    // Story A/B wiring gap — provision the claimed task's initiative branch
    // + isolated clone (if any) before the task's context is read/it runs, so
    // a freshly-provisioned `workspace` context binding is visible to this
    // same run. Read-only lookup (no mutation), safe to run outside tx1;
    // tx1 re-derives the same initiativeId below.
    if (this.#initiativeWorkspaces !== undefined) {
      const initiativeId = this.#store.getInitiativeId(taskId);
      if (initiativeId !== undefined) {
        await this.#initiativeWorkspaces.ensure(initiativeId);
      }
    }

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

    // 008.3 Story A/B — resolve the provider chain for the task's initiative
    // when the daemon wired a providerChainFor function. Only applies when
    // the function is provided; existing callers that don't wire it keep the
    // legacy behaviour (no provider passed to the runner).
    const chain: ResolvedProvider[] | undefined =
      this.#providerChainFor !== undefined
        ? this.#providerChainFor(initiativeId ?? "")
        : undefined;

    // Between tx1 and tx2: resolve runner and await the run, retrying a
    // transient failure (007.9 Story 02) — bounded by attempts + elapsed time.
    let failReason: string | null = null;
    let failReasonCode: string | undefined;
    // 008.4 Story 04 — exhaustion contract. Populated from each attempted
    // provider's typed `reasonCode` on a `providerError === true` iteration;
    // emitted on the terminal `task.failed` payload only when the chain
    // walks past the last provider without a success (the structured
    // aggregate consumers match on, not free prose).
    const providerReasons: string[] = [];
    // 008.4 Story D — run-scoped failover accounting, surfaced on the result
    // so RunDaemon can report failover counts in its summary.
    let failovers = 0;
    let completedResult:
      Extract<TaskResult, { outcome: "completed" }> | undefined;
    let escalatedResult:
      Extract<TaskResult, { outcome: "escalated" }> | undefined;
    let candidateResult:
      Extract<TaskResult, { outcome: "candidate" }> | undefined;
    let attempts = 0;

    if (chain !== undefined && chain.length === 0) {
      const projectId =
        initiativeId !== undefined
          ? this.#getProjectId?.(initiativeId)
          : undefined;
      failReason = `no AI provider available for project ${projectId ?? initiativeId ?? "unknown"}`;
      failReasonCode = "no_provider_available";
    } else {
      try {
        const runner = this.#resolver.for(runningTask, contextBindings);
        const startedAt = Date.now();
        let result: TaskResult;
        // 008.4 Story B — failover index. Walks the resolved chain on a
        // typed provider-level error; bounded by `chain.length`, separate
        // from the transient-retry budget (which is bounded by
        // `#maxAttempts`).
        let providerIdx = 0;
        for (;;) {
          attempts += 1;
          result = await runner.run(
            runningTask,
            contextBindings,
            chain !== undefined ? chain[providerIdx] : undefined,
          );

          const providerFailure =
            result.outcome === "failed" && result.providerError === true
              ? result
              : undefined;
          if (providerFailure?.reasonCode !== undefined) {
            providerReasons.push(providerFailure.reasonCode);
          }

          // Provider failover branch (008.4 Story B) — advance to the next
          // provider on a typed provider-level failure. Checked BEFORE the
          // transient branch: a 429/503 is both provider-level and transient,
          // and the epic's contract is to move to the next provider rather
          // than retry the one that just rate-limited us. Emits the
          // `provider.failover` event before the next run.
          if (
            providerFailure !== undefined &&
            chain !== undefined &&
            providerIdx + 1 < chain.length
          ) {
            const fromProvider = chain[providerIdx];
            const toProvider = chain[providerIdx + 1];
            if (fromProvider !== undefined && toProvider !== undefined) {
              this.#feed.append(
                newEvent("provider.failover", {
                  taskId,
                  payload: {
                    from: fromProvider.id,
                    to: toProvider.id,
                    reasonCode: providerFailure.reasonCode ?? "provider_error",
                  },
                }),
              );
            }
            failovers += 1;
            providerIdx += 1;
            continue;
          }

          // Transient retry branch (007.9 S2) — same provider, bounded by
          // attempts + elapsed time. Still reached by a provider error on the
          // LAST provider of the chain (nothing left to fail over to), so a
          // trailing rate-limit keeps its backoff retries.
          if (result.outcome === "failed" && result.transient === true) {
            const attemptsRemain = attempts < this.#maxAttempts;
            const elapsedOk = Date.now() - startedAt < this.#maxElapsedMs;
            if (attemptsRemain && elapsedOk) {
              this.#feed.append(
                newEvent("provider.retry", {
                  taskId,
                  payload: { attempt: String(attempts), reason: result.reason },
                }),
              );
              await this.#sleep(backoffDelayMs(attempts, result.retryAfterMs));
              continue;
            }
          }

          // Exhaustion: a provider error with no next provider in a resolved
          // chain. Set the typed aggregate reason so consumers match on the
          // code, not free prose. Only meaningful when a chain was resolved —
          // a caller without `providerChainFor` never had a chain to exhaust.
          if (providerFailure !== undefined && chain !== undefined) {
            failReasonCode = "provider_chain_exhausted";
          }
          break;
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
        this.#enqueueNewlyReady(initiativeId);
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
        // nothing to land → complete directly. A workspace binding marks an
        // initiative-clone task (Story B): the objective, not the task, is
        // the integration unit, so it also completes directly regardless of
        // any repository binding also present (`source` alias requirement).
        const repoBinding = contextBindings.find(
          (b) => b.type === "repository",
        );
        const workspaceBinding = contextBindings.find(
          (b) => b.type === "workspace",
        );
        if (repoBinding === undefined || workspaceBinding !== undefined) {
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
          this.#enqueueNewlyReady(initiativeId);
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
        const payload: Record<string, string> = {
          reason,
          attempts: String(attempts),
        };
        if (failReasonCode !== undefined) {
          payload["reasonCode"] = failReasonCode;
        }
        // 008.4 Story 04 — typed exhaustion aggregate: each attempted
        // provider's `reasonCode` joined in walk order. Set only on chain
        // exhaustion (where `failReasonCode === "provider_chain_exhausted"`),
        // so a non-provider task failure never carries a `providerReasons`
        // field.
        if (
          failReasonCode === "provider_chain_exhausted" &&
          providerReasons.length > 0
        ) {
          payload["providerReasons"] = providerReasons.join(",");
        }
        this.#feed.append(
          newEvent("task.failed", {
            taskId,
            payload,
          }),
        );
        this.#store.saveTaskResult(taskId, {
          workspace: null,
          branch: null,
          baseCommit: null,
          proposalCommit: null,
          commitSha: null,
          summary: null,
          reason,
          rejectionResolution: null,
          rejectionReason: null,
          evidence: null,
        });
        resultOutcome = "failed";
      }
    });

    // Story B objective-boundary squash — outside tx2 since it involves an
    // async git operation on the initiative clone. Only applies to a
    // completed task routed to an initiative clone (a "workspace" context
    // binding), and only once every task sharing its objectiveId is
    // completed.
    if ((resultOutcome as string) === "completed") {
      const workspaceBinding = contextBindings.find(
        (b) => b.type === "workspace",
      );
      if (
        workspaceBinding !== undefined &&
        this.#workspaces !== undefined &&
        this.#store.getObjective !== undefined &&
        this.#store.saveObjective !== undefined &&
        this.#store.getObjectiveParentOid !== undefined
      ) {
        const objectiveId = runningTask.objectiveId;
        const siblings = (
          initiativeId ? this.#store.listByInitiative(initiativeId) : []
        ).filter((t) => t.objectiveId === objectiveId);
        const allCompleted = siblings.every((t) => t.status === "completed");

        if (allCompleted) {
          const parentOid = this.#store.getObjectiveParentOid(objectiveId);
          const { oid } = await this.#workspaces.squashObjective(
            workspaceBinding.resourceId,
            parentOid,
            `objective ${objectiveId}`,
          );
          const objective = this.#store.getObjective(objectiveId);
          if (objective !== undefined) {
            const transitioned = transitionObjective(
              objective,
              "awaiting_confirmation",
            );
            this.#store.saveObjective({
              ...transitioned,
              commitOid: oid,
              parentOid,
            });
            this.#feed.append(
              newEvent("objective.awaiting_confirmation", { objectiveId }),
            );
          }
        }
      }
    }

    return failovers > 0
      ? { outcome: resultOutcome, taskId, failovers }
      : { outcome: resultOutcome, taskId };
  }
}
