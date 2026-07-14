/**
 * Run-loop — Epic 019.2
 *
 * Dependency-injected run-loop that assembles the daemon seams into a live
 * process. The thin src/cli/run.ts shell injects real adapters; tests inject
 * doubles.
 *
 * Story 001 — boot, serve, idle
 * Story 002 — tick dispatch to a ring-1-guarded pi session
 * Story 003 — deliver session commits via broker push + create_pr
 * Story 004 — escalation response loop + completion
 */

import { join } from "node:path";
import { createHash } from "node:crypto";
import { bootDaemon } from "./boot.ts";
import { submit, getInFlightOp } from "../broker/submit.ts";
import { startPolling } from "../broker/poller.ts";
import { reconcileOp } from "../broker/reconcile.ts";
import { FeatureStore } from "../store/feature-store.ts";
import { makeRing1HookAdapter } from "../ring1/hook-binding.ts";
import { spawnPiSession } from "../agent/pi-session.ts";
import { PI_DEFAULT_ALLOWED_MANIFEST, PI_EXEC_TOOLS } from "../agent/pi-tools.ts";
import { loadTasks, dispatchable, setTaskStatus, markExitGatePassed } from "../scheduler/dispatch.ts";
import { latestEvidence } from "../scheduler/attempt-evidence.ts";
import { postSessionDecision } from "../scheduler/termination.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import type { Clock } from "../foundations/clock.ts";
import type { Logger } from "./boot.ts";
import type { VerbRegistryEntry, AsyncVerbAdapter } from "../broker/registry.ts";
import type { HoldPoint } from "../broker/hold-point.ts";
import { createEscalationItem } from "../inbox/inbox.ts";
import { makeOutboundScanGuard } from "../ring1/outbound-scan-guard.ts";
import type { PatternRegistry } from "../ring1/secret-scan.ts";
import type { Workflow, GateResultSink } from "../workflow/workflow.ts";
import type { WorktreeDispatchOpts, WorktreeDispatchResult, RunWorktreeGitFn } from "../slots/worktree.ts";
import { runGit as execRunGit } from "../git/exec.ts";
import type { ReviewRouter } from "../review/review-router.ts";
import { pollPrState } from "../review/pr-state.ts";
import type { PrHttpSeam } from "../review/pr-state.ts";
import { appendTimelineEvent } from "../metrics/task-timeline.ts";
import { deriveFailureSignal } from "../metrics/failure-signal.ts";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Structural seam for the pi-agent surface (spawnAgent). */
export interface PiSurface {
  spawnAgent(opts: unknown): {
    abort(): void;
    waitForIdle(): Promise<void>;
    reset(): void;
    contextTokens: number;
    /**
     * Session-end classification (Epic 019.3 Story 001 T2).
     * Absent (undefined) means clean completion; "aborted" or "error" routes
     * the session to the lifecycle/crash path without gate evaluation.
     */
    stopReason?: "aborted" | "error";
  };
}

/** Minimal status-server handle returned by the factory. */
export interface StatusServerHandle {
  start(): Promise<{ host: string; port: number }>;
  stop(): Promise<void>;
}

/**
 * Factory that constructs the HTTP status server.
 * Typed to accept at minimum { store, logger? }; createStatusServer from
 * ./status-server.ts satisfies this via structural subtyping.
 */
export type StatusServerFactory = (opts: {
  store: Store;
  logger?: Logger;
  port?: number;
}) => StatusServerHandle;

export interface RunDaemonDeps {
  store: Store;
  featureDir: string;
  clock: Clock;
  logger: Logger;
  piSurface: PiSurface;
  statusServerFactory: StatusServerFactory;
  /** Optional fixed status HTTP port. Omit or 0 for OS-assigned. */
  statusPort?: number;
  holdPointEnabled?: boolean;
  /** Verbs held when holdPointEnabled is true. Defaults to all verbs for tests. */
  holdPointVerbs?: string[];
  /** Cutpoint used by the debug hold-point. Defaults to pre-submit for tests. */
  holdPointCutpoint?: "pre-submit" | "pre-completion";
  /** Hard ceiling for each task's token budget. Omission uses the bounded
   * conservative default below; budget enforcement is never disabled. */
  taskBudget?: { ceiling: number; conservativeCost: number };
  /**
   * When set, `runDaemon` automatically calls `tick()` on this interval using
   * the injected `clock.setTimer` seam.  Tests drive it with `clock.advance`;
   * the live CLI passes a real interval (e.g. 5_000 ms).  Omit to disable the
   * auto-tick loop (manual `handle.tick()` only).
   */
  tickIntervalMs?: number;
  /**
   * Pattern registry for outbound secret scanning.
   *   - `PatternRegistry`  → scan each push payload; block on match.
   *   - `null`             → registry absent; every push is blocked fail-closed
   *                          with `scan-unavailable`.
   *   - `undefined` (omit) → guard disabled; payloads pass through (no scan).
   */
  patternRegistry?: PatternRegistry | null;
  /**
   * Exit-gate workflow (Epic 019.3 Story 001 T2).
   * When set, `tick()` calls `workflow.gateCheck(phase)` after each cleanly
   * completed session (stopReason absent) and routes the GateResult.
   */
  workflow?: Workflow;
  /**
   * Durable sink for gate results (Epic 019.3 Story 001 T2).
   * When set, `tick()` calls `gateResultSink.record(phase, result)` after
   * each gate evaluation so the result is durably recorded.
   */
  gateResultSink?: GateResultSink;
  /**
   * Verb adapter registry (Story 003 — delivery).
   * When present alongside `commitsAhead`, `tick()` auto-delivers commits
   * via git.push + github.create_pr after each clean session.
   */
  verbAdapters?: Record<string, { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter }>;
  /**
   * Returns the number of commits the task branch is ahead of `base`.
   * When present alongside `verbAdapters`, `tick()` calls this after each
   * clean session to decide whether to trigger delivery.
   */
  commitsAhead?: (branch: string, base: string) => Promise<number>;
  /** Remote name to pass to the push adapter (default: "origin"). */
  remote?: string;
  /**
   * Inspects a session worktree before staging or delivery. `undefined` means
   * clean; a returned hash and summary require an explicit diff-review resume.
   */
  inspectWorktreeDiff?: (cwd: string) => Promise<{ hash: string; summary: string } | undefined>;
  /**
   * Per-task worktree slot (Epic 019.8 Story 002).
   * When present, tick() calls dispatch() for each task before spawning.
   * If the dispatch result is queued (slot cap reached), the task reverts to
   * pending and no session is spawned for this tick.
   */
  worktreeSlot?: {
    worktreesBase: string;
    repoPath: string;
    dispatch: (opts: WorktreeDispatchOpts) => Promise<WorktreeDispatchResult>;
    /** Injected git executor — defaults to the module-level execRunGit when absent. */
    runGit?: RunWorktreeGitFn;
  };
  /**
   * Resolves the effective committer identity (name + email) for a task.
   * Epic 019.17 — called before git.commit is submitted; when absent (backward
   * compat), existing behavior is unchanged (no identity args injected).
   * When present and the task returns undefined, git.commit is skipped and an
   * escalation inbox item is raised with reason "committer-identity".
   */
  resolveCommitterIdentity?: (taskId: string) => Promise<{ name: string; email: string } | undefined>;
  /**
   * Optional review router (Epic 019.18 Story 001).
   * When set, called after a successful delivery (push + create_pr) to record
   * a review-request inbox escalation for the task.
   */
  reviewRouter?: ReviewRouter;
  /**
   * HTTP seam for polling PR state (Epic 019.18 Story 002).
   * When set alongside `prStateRepo`, `tick()` polls each outstanding create_pr op
   * and writes a `broker_completion` row when the PR reaches a terminal state.
   */
  prStateSeam?: PrHttpSeam;
  /** Repository (owner/name) to pass to `prStateSeam.getPrState`. */
  prStateRepo?: string;
  /** Interval hint for PR polling (currently unused; reserved for future throttle). */
  prPollIntervalMs?: number;
}

/**
 * Safe live-path fallback: every provider call reserves 10,000 tokens and a
 * task is halted after 100,000 tokens unless the operator configures a lower
 * ceiling. This deliberately finite default keeps the budget gate fail-closed
 * when a caller omits taskBudget.
 */
export const DEFAULT_TASK_BUDGET = Object.freeze({
  ceiling: 100_000,
  conservativeCost: 10_000,
});

/** Parameters for delivering a session's commits through the broker. */
export interface DeliverSessionParams {
  pushAdapter: AsyncVerbAdapter;
  pushEntry: VerbRegistryEntry;
  pushInput: unknown;
  pushIdempotencyKey: string;
  createPrAdapter: AsyncVerbAdapter;
  createPrEntry: VerbRegistryEntry;
  createPrInput: unknown;
  createPrIdempotencyKey: string;
  /**
   * When set, the run-loop tracks the create_pr op so that tick() can mark
   * the task `complete` once the PR reaches the "merged" terminal state.
   * (Story 004 T2 — completion-after-merge observation.)
   */
  taskId?: string;
  /**
   * PR number associated with the create_pr op (Epic 019.18 Story 002).
   * When set alongside `taskId`, stored so tick() can pass it to prStateSeam.
   */
  prNumber?: number;
  /**
   * PR URL associated with the create_pr op (Epic 019.18 B3).
   * When set alongside `taskId`, passed to reviewRouter.requestReview.
   */
  prUrl?: string;
}

export interface RunDaemonHandle {
  address: { host: string; port: number };
  stop(): Promise<void>;
  /** One dispatch cycle: find dispatchable tasks and spawn ring-1-guarded sessions. */
  tick(): Promise<void>;
  submitBrokerVerb(
    entry: VerbRegistryEntry,
    adapter: AsyncVerbAdapter,
    payload: unknown,
    idempotencyKey: string,
  ): Promise<string>;
  /**
   * Deliver a session's commits through the broker: submit push then
   * create_pr, start the poller for each, and return both op IDs.
   */
  deliverSession(
    params: DeliverSessionParams,
  ): Promise<{ pushOpId: string; createPrOpId: string }>;
  /**
   * Reconcile all held ops whose verb appears in verbAdapters.
   * Scans broker_in_flight for status="held" ops with no completion row,
   * then calls adapter.reconcile (head-branch lookup) for each — no duplicate
   * submit is ever issued.  LP4 restart safety.
   */
  reconcileHeldOps(
    verbAdapters: Record<string, { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter }>,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// runDaemon
// ---------------------------------------------------------------------------

/**
 * Boot the daemon, start the status server, and enter an idle run-loop.
 * Returns a handle with the bound address and a stop function.
 */
export async function runDaemon(deps: RunDaemonDeps): Promise<RunDaemonHandle> {
  const { store, featureDir, clock, logger, statusServerFactory } = deps;

  // Hold-point: when enabled, all broker verbs are held at "pre-submit" so the
  // adapter is never invoked until the operator releases the hold (LP4 cutpoint).
  const holdPoint: HoldPoint | undefined = deps.holdPointEnabled
    ? {
        shouldHold(verb: string, cutpoint: "pre-submit" | "pre-completion"): boolean {
          const verbs = deps.holdPointVerbs;
          const configuredCutpoint = deps.holdPointCutpoint ?? "pre-submit";
          return cutpoint === configuredCutpoint && (verbs === undefined || verbs.includes(verb));
        },
        hold(_opId: string): void {},
        release(_opId: string): void {},
        isHeld(_opId: string): boolean {
          return false;
        },
      }
    : undefined;

  // Budget reservations are durable and use one conditional upsert, rather
  // than a load/add/save sequence. SQLite executes this statement atomically:
  // one contender can advance a task at its ceiling and every other contender
  // observes the committed ledger and receives no RETURNING row. Rows use the
  // "spend:<taskId>" namespace so they do not collide with reconcile entries.
  // initSchema creates budget_ledger during lifecycle.start() before tick().
  const taskBudget = deps.taskBudget ?? DEFAULT_TASK_BUDGET;
  function reserveTaskBudget(taskId: string): "proceed" | "halted" {
    const cost = taskBudget.conservativeCost;
    const reservation = store.get<{ ledger: string }>(
      `INSERT INTO budget_ledger (task_id, ledger)
       SELECT ?, ?
       WHERE ? <= ?
       ON CONFLICT(task_id) DO UPDATE SET ledger = CAST(CAST(ledger AS REAL) + ? AS TEXT)
       WHERE CAST(ledger AS REAL) + ? <= ?
       RETURNING ledger`,
      `spend:${taskId}`,
      String(cost),
      cost,
      taskBudget.ceiling,
      cost,
      cost,
      taskBudget.ceiling,
    );
    return reservation === undefined ? "halted" : "proceed";
  }

  // Outbound scan guard (GAP2): blocks push payloads that match secret patterns.
  // Created only when patternRegistry is explicitly provided (null = fail-closed).
  // When undefined (not provided), scanning is disabled and payloads pass through.
  const scanGuard =
    deps.patternRegistry !== undefined
      ? makeOutboundScanGuard({
          registry: deps.patternRegistry,
          onEscalate: (e) => {
            createEscalationItem({
              source_id: `${e.taskId}:scan-${e.tag}`,
              task_id: e.taskId,
              reason: e.tag,
              payload_summary: JSON.stringify(e),
              store,
              clock,
            });
          },
        })
      : undefined;

  // PR merge completion tracker: maps create_pr op_id → task_id.
  // Populated by deliverSession (when taskId is supplied); consumed by tick()
  // to mark a task "complete" once the PR reaches the "merged" terminal state.
  // In-memory is sufficient for the completion observation pattern — durable
  // halt (budget halt, LP3/T3) is handled separately via the scheduler status.
  const prOpTaskMap = new Map<string, { taskId: string; prNumber: number }>();

  // Step 1 — Schema init + ledger recovery + structured boot log records.
  // bootDaemon.start() calls initSchema internally (Epic 009 contract).
  const lifecycle = bootDaemon({
    featureDir,
    clock,
    store,
    logger,
    compileOpts: {},
  });
  await lifecycle.start();

  // Step 2 — Start the status server (loopback, port 0 → assigned by OS).
  const statusServer = statusServerFactory({ store, logger, port: deps.statusPort });
  const address = await statusServer.start();

  // Step 3 — Graceful shutdown: install SIGTERM/SIGINT handlers.
  // Handlers are removed in stop() so they do not leak across tests.
  let stopped = false;

  async function doStop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    process.off("SIGTERM", handleSignal);
    process.off("SIGINT", handleSignal);
    await statusServer.stop();
  }

  function handleSignal(): void {
    doStop().catch((err: unknown) => {
      logger.info({ event: "stop-error", err });
    });
  }

  process.on("SIGTERM", handleSignal);
  process.on("SIGINT", handleSignal);

  async function recoverPrTrackingFromCompletions(): Promise<void> {
    if (deps.reviewRouter === undefined) return;
    const rows = store.all<{
      op_id: string;
      idempotency_key: string;
      result_json: string | null;
    }>(
      `SELECT c.op_id, i.idempotency_key, c.result_json
       FROM broker_completion c
       JOIN broker_in_flight i ON i.op_id = c.op_id
       WHERE i.verb = 'github.create_pr'
         AND c.status = 'done'
         AND i.idempotency_key LIKE 'create_pr:%'`,
    );
    for (const row of rows) {
      if (row.result_json === null) continue;
      const taskId = row.idempotency_key.slice("create_pr:".length);
      if (taskId.length === 0) continue;
      const parsed = JSON.parse(row.result_json) as { pr_number?: number; pr_url?: string };
      if (typeof parsed.pr_number !== "number" || parsed.pr_number <= 0) continue;
      const prUrl = typeof parsed.pr_url === "string"
        ? parsed.pr_url
        : deps.prStateRepo !== undefined
          ? `https://github.com/${deps.prStateRepo}/pull/${parsed.pr_number}`
          : row.op_id;
      const etId = `ext:${createHash("sha256").update(`create_pr:${taskId}`).digest("hex").slice(0, 32)}`;
      store.run(
        `INSERT OR IGNORE INTO external_tracking
           (id, local_kind, local_id, external_kind, external_provider, external_id, external_url,
            created_by_op_id, idempotency_key, tracking_status, next_poll_at, attempt_count, created_at, updated_at)
         VALUES (?, 'task', ?, 'pull_request', 'github', ?, ?, ?, ?, 'active', ?, 0, ?, ?)`,
        etId,
        taskId,
        String(parsed.pr_number),
        prUrl,
        row.op_id,
        row.idempotency_key,
        clock.now(),
        clock.now(),
        clock.now(),
      );
      store.run(
        `UPDATE external_tracking
         SET external_id = ?, external_url = ?, created_by_op_id = ?, updated_at = ?
         WHERE id = ?`,
        String(parsed.pr_number),
        prUrl,
        row.op_id,
        clock.now(),
        etId,
      );
      await deps.reviewRouter.requestReview({ taskId, prNumber: parsed.pr_number, prUrl });
    }
  }

  async function requireDiffReview(taskId: string, cwd: string): Promise<boolean> {
    if (deps.inspectWorktreeDiff === undefined) return true;

    let diff: { hash: string; summary: string } | undefined;
    try {
      diff = await deps.inspectWorktreeDiff(cwd);
    } catch (err: unknown) {
      logger.info({
        event: "worktree-diff-inspection-failed",
        task_id: taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      createEscalationItem({
        source_id: `${taskId}:diff-review:inspection-error`,
        task_id: taskId,
        reason: "diff-review",
        payload_summary: "worktree diff inspection failed; delivery is blocked",
        store,
        clock,
      });
      setTaskStatus(store, taskId, "parked");
      return false;
    }
    if (diff === undefined) return true;

    const item = createEscalationItem({
      source_id: `${taskId}:diff-review:${diff.hash}`,
      task_id: taskId,
      reason: "diff-review",
      payload_summary: diff.summary,
      store,
      clock,
    });
    store.run(
      "UPDATE inbox_items SET evidence = ? WHERE id = ?",
      JSON.stringify({
        task_id: taskId,
        reason: "diff-review",
        hash: diff.hash,
        summary: diff.summary,
      }),
      item.id,
    );
    const response = store.get<{ action: string }>(
      "SELECT action FROM escalation_responses WHERE item_id = ? ORDER BY responded_at DESC LIMIT 1",
      item.id,
    );
    if (response?.action === "resume") return true;

    setTaskStatus(store, taskId, "parked");
    return false;
  }

  const handle: RunDaemonHandle = {
    address,
    stop: doStop,

    // tick — one dispatch cycle.
    // Queries all compiled features, finds dispatchable tasks, marks each
    // in-progress, assembles the ring-1 write-scope hook, and spawns a pi
    // session that awaits idle before returning.
    // After the dispatch loop, observes broker_completion for create_pr ops
    // whose PR has been merged and marks the associated task "complete".
    async tick(): Promise<void> {
      const featureRows = store.all<{ feature_id: string }>(
        "SELECT DISTINCT feature_id FROM plan_generation",
      );

      for (const featureRow of featureRows) {
        const featureId = featureRow.feature_id;

        // Initialise scheduler rows (idempotent) then query dispatchable tasks.
        loadTasks(store, featureId);
        const ready = dispatchable(store, featureId);

        for (const task of ready) {
          // Mark in-progress before spawning so a second tick does not re-dispatch.
          setTaskStatus(store, task.id, "running");

          // Resolve storyId and write_scope from the feature doc on disk.
          // Guard against readFeature() failures (e.g. ENOENT) so a missing
          // or unreadable feature file does not strand the task in "running".
          // featureStore is declared outside the try so spawnPiSession can use
          // it after the block; the catch always calls continue so the definite
          // assignment assertion (!:) is safe.
          let storyId = "";
          let writeScope: string[] = [];
          // eslint-disable-next-line prefer-const
          let featureStore!: FeatureStore;
          try {
            featureStore = new FeatureStore(featureDir);
            const featureDoc = await featureStore.readFeature();

            outer: for (const storyEntry of featureDoc.stories) {
              for (const t of storyEntry.tasks) {
                const taskFmId = t.frontmatter["id"] as string | undefined;
                const stemFromFilename = t.filename.replace(/\.md$/, "");
                if (taskFmId === task.id || stemFromFilename === task.id) {
                  storyId = storyEntry.story.id;
                  const ws = t.frontmatter["write_scope"];
                  writeScope = Array.isArray(ws) ? (ws as string[]) : [];
                  break outer;
                }
              }
            }
          } catch (err) {
            // Revert to pending so the task is not stranded in "running".
            // Log why the feature read failed so the bounce is not invisible.
            logger.info({
              event: "feature-read-failed",
              task_id: task.id,
              error: err instanceof Error ? err.message : String(err),
            });
            setTaskStatus(store, task.id, "pending");
            continue;
          }

          const taskStem = task.id;

          const beforeModelCall = async (): Promise<void> => {
            if (reserveTaskBudget(task.id) !== "halted") return;
            createEscalationItem({
              source_id: `${task.id}:budget-breach`,
              task_id: task.id,
              reason: "budget-breach",
              payload_summary: `task ${task.id} budget ceiling breached`,
              store,
              clock,
            });
            setTaskStatus(store, task.id, "parked");
            logger.info({ event: "budget-breach", task_id: task.id });
            throw new Error(`task ${task.id} budget ceiling breached`);
          };

          // Worktree dispatch (Epic 019.8 Story 002).
          // Acquire a per-task worktree before spawning. When the slot cap is
          // reached the dispatch returns queued=true: revert to pending so the
          // next tick can retry; never strand the task in "running".
          let sessionWorktreePath: string | undefined = undefined;
          let taskBranch = task.id;
          if (deps.worktreeSlot !== undefined) {
            const dispatchResult = await deps.worktreeSlot.dispatch({
              repoPath: deps.worktreeSlot.repoPath,
              worktreesBase: deps.worktreeSlot.worktreesBase,
              taskId: task.id,
              runGit: deps.worktreeSlot.runGit ?? execRunGit,
            });
            if (dispatchResult.queued) {
              setTaskStatus(store, task.id, "pending");
              continue;
            }
            sessionWorktreePath = dispatchResult.worktreePath;
            taskBranch = dispatchResult.branchName;
          }

          // Assemble ring-1 write-scope hook.  The role read/write policy is
          // anchored to featureDir so absolute system paths (e.g. /etc/passwd)
          // are blocked at the role-policy layer; relative paths from the agent
          // are resolved against featureDir before matching.  PI_EXEC_TOOLS
          // (bash) is passed as unknownEffectfulToolNames so pathless exec tool
          // calls are blocked fail-closed.
          // Cast: makeRing1HookAdapter returns (ctx: BeforeToolCallContext) => ...
          // but PiSpawnOpts.ring1Chain is typed as (ctx: unknown) => ...; the
          // cast is safe because pi always calls beforeToolCall with a
          // BeforeToolCallContext-shaped object at runtime.
          const wtRoot = sessionWorktreePath ?? featureDir;
          const wtAllow = [wtRoot, wtRoot + "/**"];
          const ring1Chain = makeRing1HookAdapter({
            registry: {
              roles: {
                agent: {
                  read: { allow: wtAllow, deny: [] },
                  write: { allow: wtAllow, deny: [] },
                },
              },
            },
            role: "agent",
            writeScope,
            worktree: sessionWorktreePath ?? featureDir,
            onEscalate: (e) => {
              const escalationSource = String(e["path"] ?? e["toolName"] ?? e.tag);
              appendTimelineEvent(store, {
                task_id: task.id,
                attempt: 1,
                correlation_id: `${task.id}:1`,
                kind: "ring1_block",
                ts: clock.now(),
                observed_failure_signal: deriveFailureSignal({ kind: "ring1_block" }),
                summary: e.tag,
              });
              createEscalationItem({
                source_id: `${task.id}:${escalationSource}`,
                task_id: task.id,
                reason: e.tag,
                payload_summary: JSON.stringify(e),
                store,
                clock,
              });
              setTaskStatus(store, task.id, "parked");
            },
            unknownEffectfulToolNames: new Set<string>(PI_EXEC_TOOLS),
          }) as unknown as (ctx: unknown, signal?: AbortSignal) => Promise<unknown>;

          // Spawn the pi session with the ring-1 hook attached as beforeToolCall.
          // allowedToolNames comes from PI_DEFAULT_ALLOWED_MANIFEST (6 tools,
          // bash excluded) so the live session gets the correct tool surface.
          // Evidence (Epic 019.3 Story 002 T3): inject latest failure evidence
          // into the brief so the re-spawned session can see the prior gate summary.
          const evidence = latestEvidence(store, task.id);
          const sessionHandle = await spawnPiSession({
            store: featureStore,
            storyId,
            taskStem,
            agentsMdPath: join(featureDir, "AGENTS.md"),
            ring1Chain,
            piSurface: deps.piSurface,
            allowedToolNames: [...PI_DEFAULT_ALLOWED_MANIFEST],
            spawnEnv: {},
            evidence,
            worktreePath: sessionWorktreePath,
            beforeModelCall,
          });

          await sessionHandle.waitForIdle();

          const postSessionTask = store.get<{ status: string }>(
            "SELECT status FROM scheduler_task WHERE node_id = ?",
            task.id,
          );
          if (postSessionTask?.status !== "running") {
            logger.info({
              event: "post-session-processing-skipped",
              task_id: task.id,
              status: postSessionTask?.status ?? "missing",
              reason: "durable task is not running",
            });
            continue;
          }

          if (
            sessionHandle.stopReason !== "aborted" &&
            sessionHandle.stopReason !== "error" &&
            !(await requireDiffReview(task.id, sessionWorktreePath ?? featureDir))
          ) {
            continue;
          }

          // Session-end classification (Epic 019.3 Story 001 T2).
          // Only a cleanly completed session (stopReason absent) is gate-checked.
          // An aborted or errored session routes to the lifecycle/crash path.
          if (
            sessionHandle.stopReason !== "aborted" &&
            sessionHandle.stopReason !== "error" &&
            deps.workflow !== undefined
          ) {
            const phase = deps.workflow.currentPhase();
            const gateResult = await deps.workflow.gateCheck(phase);
            await deps.gateResultSink?.record(phase, gateResult);
            const verdict = postSessionDecision(store, {
              taskId: task.id,
              phase,
              gateResult,
              maxAttempts: task.max_attempts,
            });
            if (verdict.kind === "complete") {
              markExitGatePassed(store, task.id);
            } else if (verdict.kind === "needs-human") {
              createEscalationItem({
                source_id: `${task.id}:needs-human`,
                task_id: task.id,
                reason: "needs_human",
                payload_summary: gateResult.summary ?? `task ${task.id} gate returned needs_human`,
                store,
                clock,
              });
              setTaskStatus(store, task.id, "parked");
            } else if (verdict.kind === "retry-intent") {
              // Return the task to a dispatchable state; the next tick re-dispatches it.
              setTaskStatus(store, task.id, "pending");
            } else if (verdict.kind === "attempts-exhausted") {
              createEscalationItem({
                source_id: `${task.id}:attempts-exhausted`,
                task_id: task.id,
                reason: "attempts-exhausted",
                payload_summary: `task ${task.id} attempts exhausted after ${verdict.attemptCount} attempts`,
                store,
                clock,
              });
              setTaskStatus(store, task.id, "parked");
            }
          }

          // Epic 019.16 S001 T2 — stage + commit worktree changes before delivery.
          // After a clean session that wrote files, submit git.add then git.commit
          // through the broker so that commitsAhead > 0 and the delivery block fires.
          if (
            sessionHandle.stopReason !== "aborted" &&
            sessionHandle.stopReason !== "error" &&
            deps.verbAdapters !== undefined
          ) {
            const addVA = deps.verbAdapters["git.add"];
            const commitVA = deps.verbAdapters["git.commit"];
            if (addVA !== undefined && commitVA !== undefined) {
              const stageCwd = sessionWorktreePath ?? featureDir;
              await handle.submitBrokerVerb(
                addVA.entry,
                addVA.adapter,
                { cwd: stageCwd },
                `git.add:${task.id}`,
              );
              // Epic 019.17 — resolve committer identity before git.commit.
              if (deps.resolveCommitterIdentity !== undefined) {
                const identity = await deps.resolveCommitterIdentity(task.id);
                if (identity === undefined) {
                  // No identity configured — skip commit, escalate.
                  createEscalationItem({
                    source_id: `${task.id}:committer-identity`,
                    task_id: task.id,
                    reason: "committer-identity",
                    payload_summary: `task ${task.id}: committer identity is not configured; git.commit skipped`,
                    store,
                    clock,
                  });
                } else {
                  await handle.submitBrokerVerb(
                    commitVA.entry,
                    commitVA.adapter,
                    { cwd: stageCwd, message: `agent delivery: ${task.id}`, name: identity.name, email: identity.email },
                    `git.commit:${task.id}`,
                  );
                }
              } else {
                await handle.submitBrokerVerb(
                  commitVA.entry,
                  commitVA.adapter,
                  { cwd: stageCwd, message: `agent delivery: ${task.id}` },
                  `git.commit:${task.id}`,
                );
              }
            }
          }

          // Story 004 T1 — auto-deliver when commits are ahead of base.
          // Triggered for every cleanly completed session when verbAdapters +
          // commitsAhead are wired (deps.workflow may be absent).
          if (
            sessionHandle.stopReason !== "aborted" &&
            sessionHandle.stopReason !== "error" &&
            deps.verbAdapters !== undefined &&
            deps.commitsAhead !== undefined
          ) {
            const ahead = await deps.commitsAhead(taskBranch, "main");
            if (ahead > 0) {
              const pushVA = deps.verbAdapters["git.push"];
              const createPrVA = deps.verbAdapters["github.create_pr"];
              if (pushVA !== undefined && createPrVA !== undefined) {
                const { createPrOpId } = await handle.deliverSession({
                  pushAdapter: pushVA.adapter,
                  pushEntry: pushVA.entry,
                  pushInput: { cwd: sessionWorktreePath ?? featureDir, branch: taskBranch, remote: deps.remote ?? "origin" },
                  pushIdempotencyKey: `push:${task.id}`,
                  createPrAdapter: createPrVA.adapter,
                  createPrEntry: createPrVA.entry,
                  createPrInput: { base: "main", head: taskBranch, title: task.id },
                  createPrIdempotencyKey: `create_pr:${task.id}`,
                  taskId: task.id,
                });
                void createPrOpId;
                // Epic 019.16 S003 T1 — in the no-workflow live path, transition
                // the task off "running" to "delivering" so it does not strand.
                if (deps.workflow === undefined) {
                  setTaskStatus(store, task.id, "delivering");
                }
              }
            }
          }
        }
      }

      // Completion check (B1 / B5 / B6) — read durable external_tracking rows that are
      // due for polling (tracking_status='active' AND next_poll_at <= now).  The
      // in-memory prOpTaskMap is consulted only as a same-process fast-path; on restart
      // the rows drive the loop independently.
      const prPollIntervalMs: number = deps.prPollIntervalMs ?? 60_000;
      const activeRows = store.all<{
        id: string;
        local_id: string;
        external_id: string;
        external_url: string | null;
        created_by_op_id: string;
        attempt_count: number;
      }>(
        `SELECT id, local_id, external_id, external_url, created_by_op_id, attempt_count
         FROM external_tracking
         WHERE local_kind = 'task'
           AND external_kind = 'pull_request'
           AND tracking_status = 'active'
           AND next_poll_at <= ?`,
        clock.now(),
      );
      for (const row of activeRows) {
        const taskId = row.local_id;
        let prNumber = Number(row.external_id);
        let prUrl = row.external_url ?? "";

        const openedCompletion = store.get<{ result_json: string | null }>(
          "SELECT result_json FROM broker_completion WHERE op_id = ? AND status = 'done'",
          row.created_by_op_id,
        );
        if (openedCompletion?.result_json !== undefined && openedCompletion.result_json !== null) {
          const opened = JSON.parse(openedCompletion.result_json) as { pr_number?: number; pr_url?: string };
          if (typeof opened.pr_number === "number" && opened.pr_number > 0) {
            prNumber = opened.pr_number;
            prUrl = typeof opened.pr_url === "string" ? opened.pr_url : prUrl;
            if (row.external_id !== String(prNumber) || row.external_url !== prUrl) {
              store.run(
                "UPDATE external_tracking SET external_id = ?, external_url = ?, updated_at = ? WHERE id = ?",
                String(prNumber), prUrl, clock.now(), row.id,
              );
              if (deps.reviewRouter !== undefined) {
                await deps.reviewRouter.requestReview({ taskId, prNumber, prUrl });
              }
            }
          }
        }

        if (Number.isFinite(prNumber) && prNumber > 0 && deps.prStateSeam !== undefined && deps.prStateRepo !== undefined) {
          let prState: { state: string; merged: boolean } | undefined;
          try {
            prState = await deps.prStateSeam.getPrState(deps.prStateRepo, prNumber);
          } catch (err: unknown) {
            // B5 — persist failure, advance next_poll_at with backoff, keep row active.
            const backoff = prPollIntervalMs > 0 ? prPollIntervalMs : 60_000;
            store.run(
              `UPDATE external_tracking
               SET last_error_json = ?, attempt_count = ?, next_poll_at = ?, updated_at = ?
               WHERE id = ?`,
              JSON.stringify({ message: err instanceof Error ? err.message : String(err) }),
              row.attempt_count + 1,
              clock.now() + backoff,
              clock.now(),
              row.id,
            );
            continue;
          }
          if (prState !== undefined && (prState.merged || prState.state === "closed")) {
            // Mark terminal before acting so a second tick skips it.
            store.run(
              "UPDATE external_tracking SET tracking_status = 'terminal', updated_at = ? WHERE id = ?",
              clock.now(), row.id,
            );
            if (prState.merged) {
              setTaskStatus(store, taskId, "complete");
              const reviewItemId = `esc:${createHash("sha256").update(`review_requested:${taskId}:${row.external_id}`).digest("hex").slice(0, 32)}`;
              store.run("UPDATE inbox_items SET status = 'resolved' WHERE id = ?", reviewItemId);
            } else {
              // closed without merge — INSERT OR IGNORE for exactly-once escalation.
              createEscalationItem({
                source_id: `${taskId}:pr-closed-unmerged`,
                task_id: taskId,
                reason: "pr-closed-unmerged",
                payload_summary: `task ${taskId} PR was closed without merging`,
                store,
                clock,
              });
              const reviewItemId = `esc:${createHash("sha256").update(`review_requested:${taskId}:${row.external_id}`).digest("hex").slice(0, 32)}`;
              store.run("UPDATE inbox_items SET status = 'resolved' WHERE id = ?", reviewItemId);
            }
            // Remove from in-memory cache if present.
            prOpTaskMap.delete(row.created_by_op_id);
          }
        }

        const legacyCompletion = store.get<{ status: string }>(
          "SELECT status FROM broker_completion WHERE op_id = ?",
          row.created_by_op_id,
        );
        if (legacyCompletion !== undefined && (legacyCompletion.status === "merged" || legacyCompletion.status === "closed")) {
          store.run(
            "UPDATE external_tracking SET tracking_status = 'terminal', updated_at = ? WHERE id = ?",
            clock.now(), row.id,
          );
          if (legacyCompletion.status === "merged") {
            setTaskStatus(store, taskId, "complete");
            const reviewItemId = `esc:${createHash("sha256").update(`review_requested:${taskId}:${row.external_id}`).digest("hex").slice(0, 32)}`;
            store.run("UPDATE inbox_items SET status = 'resolved' WHERE id = ?", reviewItemId);
          } else {
            createEscalationItem({
              source_id: `${taskId}:pr-closed-unmerged`,
              task_id: taskId,
              reason: "pr-closed-unmerged",
              payload_summary: `task ${taskId} PR was closed without merging`,
              store,
              clock,
            });
            const reviewItemId = `esc:${createHash("sha256").update(`review_requested:${taskId}:${row.external_id}`).digest("hex").slice(0, 32)}`;
            store.run("UPDATE inbox_items SET status = 'resolved' WHERE id = ?", reviewItemId);
          }
          prOpTaskMap.delete(row.created_by_op_id);
        }
      }

      // Legacy fallback: handle any prOpTaskMap entries NOT yet in external_tracking
      // (created before the durable row was introduced).
      const completedOps: string[] = [];
      for (const [opId, { taskId, prNumber }] of prOpTaskMap) {
        // Skip if already handled via external_tracking above.
        const alreadyTracked = store.get<{ id: string }>(
          "SELECT id FROM external_tracking WHERE created_by_op_id = ? AND tracking_status = 'terminal'",
          opId,
        );
        if (alreadyTracked !== undefined) {
          completedOps.push(opId);
          continue;
        }
        // Also skip rows that are active and were just polled above.
        const activeTracked = store.get<{ id: string }>(
          "SELECT id FROM external_tracking WHERE created_by_op_id = ?",
          opId,
        );
        if (activeTracked !== undefined) {
          // Handled by the external_tracking loop; don't double-poll.
          continue;
        }

        // No durable row — legacy path using broker_completion.
        if (deps.prStateSeam !== undefined && deps.prStateRepo !== undefined) {
          const prStateLegacy = await pollPrState({
            repo: deps.prStateRepo,
            prNumber,
            http: deps.prStateSeam,
          });
          if (prStateLegacy === "merged" || prStateLegacy === "closed") {
            store.run(
              "INSERT OR REPLACE INTO broker_completion (op_id, status, result_json, error_json, at) VALUES (?, ?, NULL, NULL, ?)",
              opId,
              prStateLegacy,
              clock.now(),
            );
          }
        }

        const completion = store.get<{ status: string }>(
          "SELECT status FROM broker_completion WHERE op_id = ?",
          opId,
        );
        if (completion !== undefined && completion.status === "merged") {
          setTaskStatus(store, taskId, "complete");
          const reviewItemId = `esc:${createHash("sha256").update(`review_requested:${taskId}:0`).digest("hex").slice(0, 32)}`;
          store.run("UPDATE inbox_items SET status = 'resolved' WHERE id = ?", reviewItemId);
          completedOps.push(opId);
        } else if (completion !== undefined && completion.status === "closed") {
          createEscalationItem({
            source_id: `${taskId}:pr-closed-unmerged`,
            task_id: taskId,
            reason: "pr-closed-unmerged",
            payload_summary: `task ${taskId} PR was closed without merging`,
            store,
            clock,
          });
          const reviewItemId = `esc:${createHash("sha256").update(`review_requested:${taskId}:0`).digest("hex").slice(0, 32)}`;
          store.run("UPDATE inbox_items SET status = 'resolved' WHERE id = ?", reviewItemId);
          completedOps.push(opId);
        }
      }
      for (const opId of completedOps) {
        prOpTaskMap.delete(opId);
      }
    },

    async submitBrokerVerb(
      entry: VerbRegistryEntry,
      adapter: AsyncVerbAdapter,
      payload: unknown,
      idempotencyKey: string,
    ): Promise<string> {
      return submit(
        entry,
        adapter,
        payload,
        idempotencyKey,
        store,
        holdPoint !== undefined ? { holdPoint } : undefined,
      );
    },

    // deliverSession — Story 003
    // Submits push then create_pr through the broker, starts the poller for
    // each in-flight op, and returns both op IDs. The hold-point from the
    // run-loop closure is threaded to each submit call (same as submitBrokerVerb).
    // When params.taskId is supplied, records the create_pr op_id → task_id
    // association in prOpTaskMap so tick() can detect PR merge and mark complete.
    async deliverSession(
      params: DeliverSessionParams,
    ): Promise<{ pushOpId: string; createPrOpId: string }> {
      const submitOpts = holdPoint !== undefined ? { holdPoint } : undefined;

      // GAP2: outbound secret-scan guard — blocks the push before the broker
      // submit is called.  When guard is active and the scan blocks, an
      // escalation item is recorded (via onEscalate above) and we throw so the
      // caller knows the push did not proceed.  The broker adapter.submit is
      // never invoked on a blocked scan.
      if (scanGuard !== undefined) {
        const scanResult = await scanGuard.guardedSubmit({
          verb: params.pushEntry.verb,
          taskId: params.taskId ?? "",
          serializedPayload: JSON.stringify(params.pushInput),
          submit: async (_payload: unknown): Promise<unknown> => {
            // no-op: we only use guardedSubmit for the scan + escalation side-effect;
            // the real broker submit runs separately below when status is "ok".
            return undefined;
          },
        });
        if (scanResult.status === "blocked") {
          throw new Error(
            `outbound scan blocked push for task ${params.taskId ?? ""}`,
          );
        }
      }

      const pushOpId = await submit(
        params.pushEntry,
        params.pushAdapter,
        params.pushInput,
        params.pushIdempotencyKey,
        store,
        submitOpts,
      );

      // Start polling only when the op is actually in_flight (request_id is
      // non-empty); a held op has request_id="" and has not called the adapter.
      const pushOp = getInFlightOp(pushOpId, store);
      if (pushOp !== undefined && pushOp.request_id !== "") {
        startPolling(pushOp, params.pushEntry, params.pushAdapter, store, clock);
      }

      // GAP2 (create_pr): scan the create_pr payload before submitting —
      // same fail-closed semantics as the push guard above.
      if (scanGuard !== undefined) {
        const createPrScanResult = await scanGuard.guardedSubmit({
          verb: params.createPrEntry.verb,
          taskId: params.taskId ?? "",
          serializedPayload: JSON.stringify(params.createPrInput),
          submit: async (_payload: unknown): Promise<unknown> => undefined,
        });
        if (createPrScanResult.status === "blocked") {
          throw new Error(
            `outbound scan blocked create_pr for task ${params.taskId ?? ""}`,
          );
        }
      }

      const createPrOpId = await submit(
        params.createPrEntry,
        params.createPrAdapter,
        params.createPrInput,
        params.createPrIdempotencyKey,
        store,
        submitOpts,
      );

      const createPrOp = getInFlightOp(createPrOpId, store);
      if (createPrOp !== undefined && createPrOp.request_id !== "") {
        startPolling(
          createPrOp,
          params.createPrEntry,
          params.createPrAdapter,
          store,
          clock,
        );
      }

      // Record task→op association in durable external_tracking so PR merge
      // completion survives a daemon restart (B1 — replaces in-memory prOpTaskMap
      // as source of truth).
      const { taskId } = params;
      if (taskId !== undefined && taskId !== "") {
        const prNum = params.prNumber ?? 0;
        const etId = `ext:${createHash("sha256").update(`create_pr:${taskId}`).digest("hex").slice(0, 32)}`;
        store.run(
          `INSERT OR IGNORE INTO external_tracking
             (id, local_kind, local_id, external_kind, external_provider, external_id, external_url,
              created_by_op_id, idempotency_key, tracking_status, next_poll_at, attempt_count, created_at, updated_at)
           VALUES (?, 'task', ?, 'pull_request', 'github', ?, ?,
                   ?, ?, 'active', ?, 0, ?, ?)`,
          etId,
          taskId,
          String(prNum),
          params.prUrl ?? null,
          createPrOpId,
          params.createPrIdempotencyKey,
          clock.now(),
          clock.now(),
          clock.now(),
        );
        // Also keep the in-memory map as a fast read-cache for the same process.
        prOpTaskMap.set(createPrOpId, { taskId, prNumber: prNum });

        // Epic 019.18 B3 — route review request with real prNumber/prUrl from params.
        if (deps.reviewRouter !== undefined && params.prNumber !== undefined) {
          await deps.reviewRouter.requestReview({
            taskId,
            prNumber: prNum,
            prUrl: params.prUrl ?? createPrOpId,
          });
        }
      }

      return { pushOpId, createPrOpId };
    },

    // reconcileHeldOps — Story 003 LP4
    // Scans broker_in_flight for held ops (status="held") that have no
    // broker_completion row, filters to verbs present in verbAdapters, and
    // calls reconcileOp for each.  The adapter's reconcile path does a
    // head-branch lookup and writes a terminal completion row — no duplicate
    // adapter.submit is issued (LedgerEntry carries "" for correlation /
    // desired_effect_hash, consistent with how held ops skip those fields).
    async reconcileHeldOps(
      verbAdapters: Record<string, { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter }>,
    ): Promise<void> {
      interface HeldRow {
        op_id: string;
        verb: string;
        idempotency_key: string;
        payload_json: string | null;
      }
      const heldRows = store.all<HeldRow>(
        `SELECT bif.op_id, bif.verb, bif.idempotency_key, bif.payload_json
         FROM broker_in_flight bif
         LEFT JOIN broker_completion bc ON bc.op_id = bif.op_id
         WHERE bif.status = 'held' AND bc.op_id IS NULL`,
      );

      for (const row of heldRows) {
        const entry = verbAdapters[row.verb];
        if (entry === undefined) continue;

        const ledgerEntry = {
          op_id: row.op_id,
          verb: row.verb,
          idempotency_key: row.idempotency_key,
          correlation: row.payload_json ?? "",
          desired_effect_hash: "",
          status: "needs_reconciliation" as const,
        };

        const payload = row.payload_json !== null ? JSON.parse(row.payload_json) : undefined;
        const outcome = await reconcileOp(ledgerEntry, entry.entry, entry.adapter, store, clock, payload);
        // A held op reconciled at boot must be visible in the logs — an earlier
        // LP-A4 failure was invisible because this path logged nothing (the
        // boot.ts "reconciledOps" counter is a different, misleading path).
        // AGENTS.md "logs first": one line that pinpoints the recovery.
        logger.info({
          event: "held-op-reconciled",
          op_id: row.op_id,
          verb: row.verb,
          idempotency_key: row.idempotency_key,
          outcome,
        });
      }
    },
  };

  // Schedule periodic ticks using the injected clock seam.
  // The callback is one-shot; it re-schedules itself on completion so
  // FakeClock.advance() drives it deterministically in tests.
  function scheduleNextTick(): void {
    if (stopped) return;
    const intervalMs = deps.tickIntervalMs;
    if (intervalMs === undefined) return;
    clock.setTimer(intervalMs, () => {
      handle.tick().catch((err: unknown) => {
        // Never swallow a tick failure silently — an invisible tick error once hid
        // a whole delivery bug (see AGENTS.md "Debugging and error handling").
        logger.info({
          event: "tick-error",
          error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        });
      }).finally(() => {
        scheduleNextTick();
      });
    });
  }
  if (deps.verbAdapters !== undefined) {
    await handle.reconcileHeldOps(deps.verbAdapters);
  }
  await recoverPrTrackingFromCompletions();
  scheduleNextTick();

  return handle;
}
