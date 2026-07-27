/**
 * RunDaemon — the daemon loop use case (Story 07).
 *
 * Calls recover once at startup, then iterates: enqueueReady → runNext,
 * handling SQLITE_BUSY with a back-off sleep, tracking failures, and
 * exiting on idle (when untilIdle) or on stop().
 */

import type { Logger } from "../../logger/port.ts";

type RunNextResult =
  | { outcome: "idle" }
  | {
      outcome: "skipped" | "completed" | "failed" | "escalated" | "candidate";
      taskId: string;
      /** 008.4 Story D — provider failovers this dispatch performed. */
      failovers?: number;
    };

interface Recover {
  execute(): string[];
}

interface EnqueueReady {
  execute(): Promise<string[]>;
}

interface RunNextTask {
  execute(): Promise<RunNextResult>;
}

/**
 * Story F (007.12) — narrow read seam for the once-per-`execute()` daemon
 * summary: objectives awaiting brokering (`awaiting_confirmation`) and
 * initiatives that have landed (`landed`). Optional so pre-existing fakes
 * that construct `RunDaemon` without it keep compiling; when absent both
 * counts are reported as 0.
 */
interface InitiativeCounts {
  listAllInitiatives(): Array<{ id: string }>;
  get(id: string): { status?: string } | undefined;
  listObjectives(initiativeId: string): Array<{ status?: string }>;
}

/**
 * Story 07 — run-scoped daemon accounting. Lets `RunDaemon` learn, per
 * dispatched task, which initiative it belongs to and its persisted result
 * (for the failure `reason`), without scanning the whole DB. Optional so
 * pre-existing fakes that construct `RunDaemon` without it keep compiling.
 */
interface RunDaemonStore {
  getInitiativeId(taskId: string): string | undefined;
  getTaskResult(taskId: string): { reason: string | null } | undefined;
}

interface RunDaemonDeps {
  recover: Recover;
  enqueueReady: EnqueueReady;
  runNext: RunNextTask;
  sleep: (ms: number) => Promise<void>;
  logger: Logger;
  initiatives?: InitiativeCounts;
  store?: RunDaemonStore;
}

export class RunDaemon {
  readonly #deps: RunDaemonDeps;
  readonly #logger: Logger;
  #stopped = false;

  constructor(deps: RunDaemonDeps) {
    this.#deps = deps;
    this.#logger = deps.logger;
  }

  stop(): void {
    this.#stopped = true;
  }

  async execute(options: {
    untilIdle: boolean;
    pollIntervalMs?: number;
  }): Promise<{
    exitCode: 0 | 1;
    escalatedCount: number;
    objectivesAwaitingConfirmation: number;
    landedInitiativeIds: string[];
    failedTasks: Array<{ id: string; reason: string }>;
    /** 008.4 Story D — total provider failovers across this run. */
    failoverCount: number;
  }> {
    let hasFailed = false;
    let escalatedCount = 0;
    let failoverCount = 0;
    const touchedInitiatives = new Set<string>();
    const failedTasks: Array<{ id: string; reason: string }> = [];

    // Step 1: recover interrupted tasks exactly once at startup.
    // Skip everything if stop() was already called before execute().
    if (this.#stopped) {
      return {
        exitCode: 0,
        escalatedCount: 0,
        objectivesAwaitingConfirmation: 0,
        landedInitiativeIds: [],
        failedTasks: [],
        failoverCount: 0,
      };
    }
    this.#deps.recover.execute();

    // Main loop.
    while (true) {
      // Check stop flag at the top, before any enqueue/runNext work.
      if (this.#stopped) break;

      // Step 2: enqueue ready tasks; on SQLITE_BUSY, back off and retry.
      let enqueueResult: string[];
      try {
        enqueueResult = await this.#deps.enqueueReady.execute();
      } catch (err: unknown) {
        if (isSqliteBusy(err)) {
          await this.#deps.sleep(100);
          continue;
        }
        throw err;
      }

      // Step 3: claim and execute the next queued task.
      const runResult = await this.#deps.runNext.execute();

      // Track any task failures (daemon continues draining after a failure).
      if (runResult.outcome === "failed") {
        hasFailed = true;
      }
      if (runResult.outcome === "escalated") {
        escalatedCount += 1;
      }
      // 008.4 Story D — accumulate provider failovers for the run summary.
      if (runResult.outcome !== "idle") {
        failoverCount += runResult.failovers ?? 0;
      }

      // Log each non-idle outcome for observability (A1).
      if (runResult.outcome !== "idle") {
        this.#logger.info(`task ${runResult.taskId}: ${runResult.outcome}`);
      }

      // Story 07 — run-scoped accounting: record which initiative this
      // dispatch touched, and capture the persisted failure reason.
      if (runResult.outcome !== "idle" && this.#deps.store) {
        const initiativeId = this.#deps.store.getInitiativeId(runResult.taskId);
        if (initiativeId !== undefined) {
          touchedInitiatives.add(initiativeId);
        }
        if (runResult.outcome === "failed") {
          const reason =
            this.#deps.store.getTaskResult(runResult.taskId)?.reason ?? "";
          failedTasks.push({ id: runResult.taskId, reason });
        }
      }

      // Honour stop() — always checked after runNext finishes (never mid-task).
      if (this.#stopped) break;

      // Idle = scan produced nothing new AND the queue was empty when we claimed.
      const isIdle = enqueueResult.length === 0 && runResult.outcome === "idle";

      if (isIdle) {
        if (options.untilIdle) {
          // Exit as requested.
          break;
        } else {
          // Polling mode: sleep then check stop.
          await this.#deps.sleep(options.pollIntervalMs ?? 1000);
          if (this.#stopped) break;
        }
      }
    }

    // Step 4: once per execute() (not per loop iteration), summarise
    // objectives awaiting brokering and initiatives landed (Story F),
    // scoped to only the initiatives this run touched (Story 07).
    let objectivesAwaitingConfirmation = 0;
    const landedInitiativeIds: string[] = [];
    if (this.#deps.initiatives) {
      const ids = [...touchedInitiatives].sort();
      for (const id of ids) {
        const initiative = this.#deps.initiatives.get(id);
        if (initiative?.status === "landed") {
          landedInitiativeIds.push(id);
        }
        for (const objective of this.#deps.initiatives.listObjectives(id)) {
          if (objective.status === "awaiting_confirmation") {
            objectivesAwaitingConfirmation += 1;
          }
        }
      }
    }

    return {
      exitCode: hasFailed ? 1 : 0,
      escalatedCount,
      objectivesAwaitingConfirmation,
      landedInitiativeIds,
      failedTasks,
      failoverCount,
    };
  }
}

function isSqliteBusy(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>)["code"] === "ERR_SQLITE_BUSY"
  );
}
