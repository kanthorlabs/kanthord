/**
 * Daemon boot entrypoint — wires Phase-1 components into a single lifecycle.
 *
 * Story 001 — Daemon Wiring & Crash/Restart Entrypoint (Epic 009)
 *
 * Responsibilities on start():
 *   1. Walk the feature directory to derive pending-task count from markdown
 *      (proves rebuild-from-markdown, never stale SQLite).
 *   2. Recover in-flight ledger ops via Epic 005 recoverFromLedger.
 *   3. Emit structured boot + recovery-summary log records (PRD §3.1).
 *
 * All collaborators are injected so the lifecycle harness (Epic 010) can drive
 * kill/restart deterministically (PRD §7.7).
 */

import { walkFeature } from "../compiler/grammar.ts";
import { recoverFromLedger } from "../broker/ledger.ts";
import { FeatureStore } from "../store/feature-store.ts";
import { initSchema } from "../store/schema.ts";
import type { CompileOptions } from "../compiler/compile.ts";
import type { Clock } from "../foundations/clock.ts";
import type { Store } from "../foundations/sqlite-store.ts";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * Minimal structured-log seam.  Inject a pino instance or a test double.
 */
export interface Logger {
  info(record: Record<string, unknown>): void;
}

/**
 * Single lifecycle handle returned by bootDaemon.
 * start() performs boot + recovery; stop() and restart() are no-ops in Phase 1
 * (Stop and respawn semantics are owned by Epic 010).
 */
export interface DaemonLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

// ---------------------------------------------------------------------------
// bootDaemon — factory
// ---------------------------------------------------------------------------

/**
 * Wire Phase-1 components and return a single lifecycle handle.
 *
 * None of the injected collaborators are used during construction; they are
 * captured in the closure and consumed only when start() is called.
 */
export function bootDaemon(opts: {
  featureDir: string;
  clock: Clock;
  store: Store;
  logger: Logger;
  compileOpts: CompileOptions;
}): DaemonLifecycle {
  const { featureDir, logger } = opts;

  async function doStart(): Promise<void> {
    // -----------------------------------------------------------------------
    // Schema init — ensure all subsystem tables exist before any call.
    // -----------------------------------------------------------------------
    initSchema(opts.store);

    // -----------------------------------------------------------------------
    // Step 1 — Count pending tasks from markdown (proves rebuild-from-markdown,
    // not stale SQLite).  Uses walkFeature which reads only directory/file
    // metadata and classifies files; no compile/lint pipeline is invoked here
    // so the caller is not required to provide RUNBOOK.md for this operation.
    // -----------------------------------------------------------------------
    const walk = await walkFeature(featureDir);

    let pendingTaskCount = 0;
    const taskPairs: Array<{ storyId: string; taskStem: string }> = [];

    for (const group of walk.groups) {
      for (const story of group.stories) {
        for (const file of story.files) {
          if (file.kind === "task") {
            pendingTaskCount++;
            // Derive the journal taskStem from the filename (strip .md extension)
            const taskStem = file.name.slice(0, file.name.length - ".md".length);
            taskPairs.push({ storyId: story.name, taskStem });
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 2 — Recover in-flight ledger operations (Epic 005).
    // Any op that was in_flight before the crash is re-surfaced as
    // "needs_reconciliation" so the runtime can re-dispatch safely.
    // -----------------------------------------------------------------------
    const featureStore = new FeatureStore(featureDir);
    let reconciledOps = 0;

    for (const { storyId, taskStem } of taskPairs) {
      const entries = await recoverFromLedger(featureStore, storyId, taskStem);
      for (const entry of entries) {
        if (entry.status === "needs_reconciliation") {
          reconciledOps++;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 2b — For resuming tasks (reconciledOps >= 1), read their STATE
    // files to surface currentPhase (Epic 006 respawn path, PRD §7.7).
    // -----------------------------------------------------------------------
    let currentPhase: string | undefined;
    if (reconciledOps >= 1) {
      for (const { storyId, taskStem } of taskPairs) {
        const stateContent = await featureStore.readState(storyId, taskStem);
        if (stateContent) {
          const match = /^current_phase:\s*(.+)$/m.exec(stateContent);
          const matched = match?.[1];
          if (matched) {
            const trimmed = matched.trim();
            if (trimmed) {
              currentPhase = trimmed;
              break;
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 3 — Emit structured log records (PRD §3.1).
    // -----------------------------------------------------------------------
    logger.info({ event: "boot" });
    const summaryFields: Record<string, unknown> = {
      event: "recovery-summary",
      pendingTaskCount,
      reconciledOps,
    };
    if (currentPhase !== undefined) {
      summaryFields["currentPhase"] = currentPhase;
    }
    logger.info(summaryFields);
  }

  return {
    start: doStart,

    async stop(): Promise<void> {
      // Phase-1: lifecycle stop is a no-op — Epic 010 owns respawn semantics.
    },

    async restart(): Promise<void> {
      // Simulated kill: discard in-memory runtime state (nothing to discard
      // here yet), then re-run start() against durable markdown + ledger.
      await doStart();
    },
  };
}
