import { transitionTask } from "../../domain/task.ts";
import type { Task } from "../../domain/task.ts";
import { readiness } from "../../domain/graph.ts";
import { newEvent } from "../../domain/event.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork, TaskResultRow } from "../../storage/port.ts";
import type {
  RepositoryLanding,
  LandingCandidate,
} from "../../landing/port.ts";
import { LandingConflictError } from "../../landing/port.ts";
import {
  UnknownReferenceError,
  TaskNotAwaitingConfirmationError,
  ProposalWorkspaceMissingError,
} from "../errors.ts";

// Re-export so existing importers (tests, CLI error-map) keep working.
export { TaskNotAwaitingConfirmationError } from "../errors.ts";

export class ProposalMissingError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`proposal commit for task ${taskId} is missing or unreachable`);
    this.name = "ProposalMissingError";
    this.taskId = taskId;
  }
}

interface ApproveTaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
  getTaskResult(taskId: string): TaskResultRow | undefined;
  saveTaskResult(taskId: string, row: TaskResultRow): void;
  listByInitiative(initiativeId: string): Task[];
  getInitiativeId(taskId: string): string | undefined;
  getTaskContext(taskId: string): Record<string, string>;
}

export class ApproveTask {
  readonly #store: ApproveTaskStore;
  readonly #queue: JobQueue;
  readonly #feed: EventFeed;
  readonly #uow: UnitOfWork;
  readonly #promote: (
    dir: string,
    taskId: string,
    proposalCommit: string,
  ) => Promise<void>;
  readonly #landing: RepositoryLanding | undefined;

  constructor(
    store: ApproveTaskStore,
    queue: JobQueue,
    feed: EventFeed,
    uow: UnitOfWork,
    promote: (
      dir: string,
      taskId: string,
      proposalCommit: string,
    ) => Promise<void>,
    landing?: RepositoryLanding,
  ) {
    this.#store = store;
    this.#queue = queue;
    this.#feed = feed;
    this.#uow = uow;
    this.#promote = promote;
    this.#landing = landing;
  }

  async execute({ taskId }: { taskId: string }): Promise<void> {
    const task = this.#store.get(taskId);
    if (task === undefined) {
      throw new UnknownReferenceError("task", taskId);
    }

    const result = this.#store.getTaskResult(taskId);

    // (b) idempotent: already completed and commitSha matches proposalCommit
    if (
      task.status === "completed" &&
      result !== undefined &&
      result.commitSha !== null &&
      result.commitSha === result.proposalCommit
    ) {
      return;
    }

    // (c) wrong status
    if (task.status !== "awaiting_confirmation") {
      throw new TaskNotAwaitingConfirmationError(taskId, task.status);
    }

    // Promote the task branch to point at the proposal commit (d)/(a)
    if (result !== undefined && result.proposalCommit !== null) {
      if (result.workspace === null || result.workspace === "") {
        throw new ProposalWorkspaceMissingError(taskId);
      }
      try {
        await this.#promote(result.workspace, taskId, result.proposalCommit);
      } catch {
        throw new ProposalMissingError(taskId);
      }
    }

    // Landing step: if a RepositoryLanding port is wired and the task context
    // has a repository binding, land the candidate commit onto the home repo.
    const context = this.#store.getTaskContext(taskId);
    let canonicalSHA: string | null = null;
    if (
      this.#landing !== undefined &&
      context["repository"] !== undefined &&
      result !== undefined &&
      result.proposalCommit !== null
    ) {
      const candidate: LandingCandidate = {
        id: `${taskId}-lc`,
        taskId,
        repoId: context["repository"],
        baseSHA: result.baseCommit ?? "",
        candidateSHA: result.proposalCommit,
        ref: result.branch ?? "",
        target: "main",
        workspace: result.workspace ?? "",
      };
      const homeDir = result.workspace ?? "";
      try {
        const landResult = await this.#landing.land(homeDir, candidate);
        canonicalSHA = landResult.canonicalSHA;
      } catch (err) {
        if (err instanceof LandingConflictError) {
          this.#feed.append(newEvent("task.conflict", { taskId }));
          return;
        }
        throw err;
      }
    }

    // Determine the final commitSha (null if no proposalCommit)
    const commitSha = result?.proposalCommit ?? null;

    this.#uow.transaction(() => {
      // Persist the updated result row with commitSha (and canonicalSHA as baseCommit if landed)
      if (result !== undefined) {
        const updatedResult: TaskResultRow =
          canonicalSHA !== null
            ? { ...result, commitSha, baseCommit: canonicalSHA }
            : { ...result, commitSha };
        this.#store.saveTaskResult(taskId, updatedResult);
      }

      const completedTask = transitionTask(task, "completed");
      this.#store.save(completedTask);

      const approvedPayload: Record<string, string> = { actor: "human" };
      if (commitSha !== null) {
        approvedPayload["proposalCommit"] = commitSha;
      }
      this.#feed.append(
        newEvent("task.approved", { taskId, payload: approvedPayload }),
      );
      this.#feed.append(newEvent("task.completed", { taskId }));

      // Re-scan initiative for newly-ready dependents
      const initiativeId = this.#store.getInitiativeId(taskId);
      const allTasks = initiativeId
        ? this.#store.listByInitiative(initiativeId)
        : [];
      for (const entry of readiness(allTasks)) {
        if (entry.state === "ready") {
          const inserted = this.#queue.enqueue(entry.id);
          if (inserted) {
            this.#feed.append(newEvent("task.ready", { taskId: entry.id }));
          }
        }
      }
    });
  }
}
