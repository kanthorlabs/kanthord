import type { Task } from "../../domain/task.ts";
import type { TaskResultRow } from "../../storage/port.ts";
import type { ChangeCandidate } from "../../domain/landing.ts";
import { UnknownReferenceError } from "../errors.ts";

interface TaskSource {
  get(id: string): Task | undefined;
}

interface ResultSource {
  getTaskResult(taskId: string): TaskResultRow | undefined;
}

interface ContextSource {
  getTaskContext(taskId: string): Record<string, string>;
}

interface LandingSource {
  getCandidateByTask(taskId: string): ChangeCandidate | undefined;
}

/**
 * EPIC 013 Story 6 — narrow consumer of the job queue that exposes only the
 * revocation state. A revoked running job makes the task's read view surface
 * `abandoning: true` (a marker on a `running` task, not a new status).
 */
interface RunningJobSource {
  listRunningJobsForTask(taskId: string): Array<{ revoked: boolean }>;
}

export interface LandingCandidateOutput {
  state: "pending" | "landed" | "conflict";
  baseSHA: string;
  candidateSHA: string;
  target: string;
}

export interface GetTaskOutput {
  id: string;
  title: string;
  status: string;
  agent: string | undefined;
  objectiveId: string;
  dependencies: string[];
  note?: string;
  instructions?: string;
  ac?: string[];
  verification?: string[];
  result: TaskResultRow | undefined;
  dependencyStatus?: Array<{ id: string; status: string }>;
  context?: Record<string, string>;
  landingCandidate: LandingCandidateOutput | null;
  /**
   * EPIC 013 Story 6 — `true` while a revoked run drains. A marker on a
   * `running` task, not a new lifecycle state. `TASK_STATUSES` is NOT widened.
   */
  abandoning: boolean;
}

export class GetTask {
  readonly #tasks: TaskSource;
  readonly #results: ResultSource;
  readonly #context: ContextSource;
  readonly #landing: LandingSource | undefined;
  readonly #jobs: RunningJobSource | undefined;

  constructor(
    tasks: TaskSource,
    results: ResultSource,
    context: ContextSource,
    landing?: LandingSource,
    jobs?: RunningJobSource,
  ) {
    this.#tasks = tasks;
    this.#results = results;
    this.#context = context;
    this.#landing = landing;
    this.#jobs = jobs;
  }

  async execute({ id }: { id: string }): Promise<GetTaskOutput> {
    const task = this.#tasks.get(id);
    if (task === undefined) {
      throw new UnknownReferenceError("task", id);
    }
    const result = this.#results.getTaskResult(id);
    const ctx = this.#context.getTaskContext(id);
    const candidate = this.#landing?.getCandidateByTask(id);
    const landingCandidate: LandingCandidateOutput | null =
      candidate !== undefined
        ? {
            state: candidate.state,
            baseSHA: candidate.baseSHA,
            candidateSHA: candidate.candidateSHA,
            target: candidate.target,
          }
        : null;

    const dependencyStatus =
      task.dependencies.length > 0
        ? task.dependencies.map((depId) => {
            const dep = this.#tasks.get(depId);
            return { id: depId, status: dep?.status ?? "unknown" };
          })
        : undefined;

    // EPIC 013 Story 6 — `abandoning` is true while a revoked run drains on
    // a `running` task. The marker is on a `running` task, not a new
    // lifecycle state, so the task's `status` stays `running`.
    const abandoning =
      this.#jobs?.listRunningJobsForTask(id).some((j) => j.revoked) ?? false;

    return {
      id: task.id,
      title: task.title,
      status: task.status,
      agent: task.agent,
      objectiveId: task.objectiveId,
      dependencies: task.dependencies,
      ...(task.note !== undefined ? { note: task.note } : {}),
      ...(task.instructions !== undefined
        ? { instructions: task.instructions }
        : {}),
      ...(task.ac !== undefined ? { ac: task.ac } : {}),
      ...(task.verification !== undefined
        ? { verification: task.verification }
        : {}),
      result,
      ...(dependencyStatus !== undefined ? { dependencyStatus } : {}),
      ...(Object.keys(ctx).length > 0 ? { context: ctx } : {}),
      landingCandidate,
      abandoning,
    };
  }
}
