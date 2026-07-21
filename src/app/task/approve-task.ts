import { transitionTask } from "../../domain/task.ts";
import type { Task } from "../../domain/task.ts";
import { readiness } from "../../domain/graph.ts";
import { newEvent } from "../../domain/event.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type {
  UnitOfWork,
  TaskResultRow,
  LandingRepository,
} from "../../storage/port.ts";
import type {
  RepositoryLanding,
  LandingCandidate,
} from "../../landing/port.ts";
import { LandingConflictError } from "../../landing/port.ts";
import type { WorkspaceManager } from "../../workspace/port.ts";
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
  readonly landing: RepositoryLanding | undefined;
  readonly #landingRepo: LandingRepository | undefined;
  readonly #workspaceManager: WorkspaceManager | undefined;
  readonly #resolveHomeDir: ((repoId: string) => string) | undefined;

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
    landingRepo?: LandingRepository,
    workspaceManager?: WorkspaceManager,
    resolveHomeDir?: (repoId: string) => string,
  ) {
    this.#store = store;
    this.#queue = queue;
    this.#feed = feed;
    this.#uow = uow;
    this.#promote = promote;
    this.landing = landing;
    this.#landingRepo = landingRepo;
    this.#workspaceManager = workspaceManager;
    this.#resolveHomeDir = resolveHomeDir;
  }

  #legacyCandidate(
    taskId: string,
    context: Record<string, string>,
    result: TaskResultRow,
  ): LandingCandidate {
    return {
      id: `${taskId}-lc`,
      taskId,
      repoId: context["repository"]!,
      baseSHA: result.baseCommit ?? "",
      candidateSHA: result.proposalCommit ?? "",
      ref: result.branch ?? "",
      target: "main",
      workspace: result.workspace ?? "",
    };
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

    // Resolve context early — it drives both the promote gate below and the
    // landing step further down.
    const context = this.#store.getTaskContext(taskId);

    // Repo-bound approve: the landing port MAY own the canonical branch. This
    // is the dispatch's `isRepoBoundLanding` sub-expression, computed BEFORE the
    // promote block. It deliberately does NOT yet decide whether to land: a
    // repo-bound ESCALATION also has `landing` + a `repository` context +
    // `proposalCommit !== null`, so the persisted candidate row (below) is the
    // precise differentiator between an escalation and a candidate landing.
    const isRepoBound =
      this.landing !== undefined &&
      context["repository"] !== undefined &&
      result !== undefined &&
      result.proposalCommit !== null;

    // The persisted landing candidate row distinguishes a repo-bound CANDIDATE
    // landing (which must SKIP #promote and land via the landing port) from a
    // repo-bound ESCALATION (which carries a proposalCommit but no persisted
    // candidate and MUST still #promote — the human's S2 intent + the escalation
    // smoke test). Only query the store when the task is repo-bound, so a
    // filesystem-bound approval never touches it (T3-b invariant). Keying the
    // gate on `proposalCommit !== null` alone wrongly covered escalations — that
    // was the HUMAN_REVIEW-S2 regression; do NOT repeat it.
    const hasPersistedCandidate = isRepoBound
      ? this.#landingRepo?.getCandidateByTask?.(taskId) !== undefined
      : false;
    // Pre-T3 (≤6-arg) constructions have no `landingRepo`; fall back to the
    // legacy landing shape so pre-existing repo-bound approve tests stay green.
    const isRepoBoundLanding =
      isRepoBound && (hasPersistedCandidate || this.#landingRepo === undefined);

    // Promote the task-clone branch to point at the proposal commit (d)/(a) —
    // only for non-landing (escalated / filesystem) approvals. Repo-bound
    // CANDIDATE landings skip this (the landing port advances the canonical
    // branch instead), so it is not dead/retry-unsafe work.
    if (result !== undefined && result.proposalCommit !== null) {
      if (!isRepoBoundLanding) {
        if (result.workspace === null || result.workspace === "") {
          throw new ProposalWorkspaceMissingError(taskId);
        }
        try {
          await this.#promote(result.workspace, taskId, result.proposalCommit);
        } catch {
          throw new ProposalMissingError(taskId);
        }
      }
    }

    // Landing step: if this is a repo-bound CANDIDATE landing, land the
    // candidate commit onto the home repo (the landing port owns the canonical
    // branch). Otherwise #promote already advanced the task-clone branch.
    let canonicalSHA: string | null = null;
    if (isRepoBoundLanding) {
      let candidate: LandingCandidate;
      let homeDir: string;
      // Port members are optional (Story 05 T1) so un-editable fakes stay
      // valid; capture them and fall back to the legacy shape when absent.
      const landingRepo = this.#landingRepo;
      const workspaceManager = this.#workspaceManager;
      const getCandidateByTask = landingRepo?.getCandidateByTask;
      const homeDirOf = workspaceManager?.homeDir;
      const resolveHomeDir = this.#resolveHomeDir;
      if (
        getCandidateByTask !== undefined &&
        (homeDirOf !== undefined || resolveHomeDir !== undefined)
      ) {
        // New path (Story 05 T3): load the persisted candidate (the exact
        // execution attempt's ULID id + configured target). Resolve the
        // repository's canonical home via the durable DB-backed resolver when
        // wired (survives a fresh / cross-process `approve task`), otherwise
        // fall back to the volatile in-memory WorkspaceManager.homeDir.
        const stored = getCandidateByTask.call(landingRepo, taskId);
        if (stored !== undefined) {
          homeDir = resolveHomeDir
            ? resolveHomeDir(stored.repoId)
            : homeDirOf!.call(workspaceManager, stored.repoId);
          candidate = {
            id: stored.id,
            taskId: stored.taskId,
            repoId: stored.repoId,
            baseSHA: stored.baseSHA,
            candidateSHA: stored.candidateSHA,
            ref: stored.ref,
            target: stored.target,
            // The proposal commit lives in the TASK workspace clone (where
            // createProposalCommit wrote it), not in the canonical home mirror.
            // GitRepositoryLanding.land fetches candidateSHA FROM this workspace
            // INTO homeDir, so the source must be the task clone (result.workspace),
            // while homeDir stays the landing cwd.
            workspace: result.workspace ?? "",
          };
        } else {
          // Candidate row missing — fall back to the legacy shape so a
          // repository-bound approve without a persisted candidate still lands.
          homeDir = result.workspace ?? "";
          candidate = this.#legacyCandidate(taskId, context, result);
        }
      } else {
        // Legacy path (pre-T3 tests / composition without the new deps):
        // build the candidate from the task result with the hardcoded id and
        // target "main", using the task workspace as homeDir.
        homeDir = result.workspace ?? "";
        candidate = this.#legacyCandidate(taskId, context, result);
      }
      try {
        const landResult = await this.landing.land(homeDir, candidate);
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
