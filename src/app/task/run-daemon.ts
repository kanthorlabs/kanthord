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
      outcome: "skipped" | "completed" | "failed" | "escalated";
      taskId: string;
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

interface RunDaemonDeps {
  recover: Recover;
  enqueueReady: EnqueueReady;
  runNext: RunNextTask;
  sleep: (ms: number) => Promise<void>;
  logger: Logger;
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
  }): Promise<{ exitCode: 0 | 1; escalatedCount: number }> {
    let hasFailed = false;
    let escalatedCount = 0;

    // Step 1: recover interrupted tasks exactly once at startup.
    // Skip everything if stop() was already called before execute().
    if (this.#stopped) return { exitCode: 0, escalatedCount: 0 };
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

      // Log each non-idle outcome for observability (A1).
      if (runResult.outcome !== "idle") {
        this.#logger.info(`task ${runResult.taskId}: ${runResult.outcome}`);
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

    return { exitCode: hasFailed ? 1 : 0, escalatedCount };
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
