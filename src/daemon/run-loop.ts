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
import { bootDaemon } from "./boot.ts";
import { submit, getInFlightOp } from "../broker/submit.ts";
import { startPolling } from "../broker/poller.ts";
import { reconcileOp } from "../broker/reconcile.ts";
import { FeatureStore } from "../store/feature-store.ts";
import { makeRing1HookAdapter } from "../ring1/hook-binding.ts";
import { makeBudgetBreaker } from "../ring1/budget.ts";
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
}) => StatusServerHandle;

export interface RunDaemonDeps {
  store: Store;
  featureDir: string;
  clock: Clock;
  logger: Logger;
  piSurface: PiSurface;
  statusServerFactory: StatusServerFactory;
  holdPointEnabled?: boolean;
  /** Hard ceiling for each task's token budget.  When set, `tick()` calls
   *  `makeBudgetBreaker` and halts + parks a task before spawning if the
   *  ceiling would be breached (LP3). */
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
}

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
        shouldHold(_verb: string, cutpoint: "pre-submit" | "pre-completion"): boolean {
          return cutpoint === "pre-submit";
        },
        hold(_opId: string): void {},
        release(_opId: string): void {},
        isHeld(_opId: string): boolean {
          return false;
        },
      }
    : undefined;

  // Budget breaker: durable per-task spend stored in budget_ledger via the
  // shared store so spend survives a daemon restart (GAP4).  Rows use the key
  // "spend:<taskId>" to namespace from reconcile-ledger entries in the same
  // table.  budget_ledger is created by initRing1Schema (called inside
  // lifecycle.start() below); the store calls happen lazily inside tick()
  // — after lifecycle.start() has run — so the table always exists at call
  // time.
  const budgetBreaker =
    deps.taskBudget !== undefined
      ? makeBudgetBreaker(
          deps.taskBudget,
          {
            async load(taskId: string): Promise<number> {
              const row = store.get<{ ledger: string }>(
                "SELECT ledger FROM budget_ledger WHERE task_id = ?",
                `spend:${taskId}`,
              );
              if (row === undefined) return 0;
              const n = Number(row.ledger);
              return Number.isFinite(n) ? n : 0;
            },
            async save(taskId: string, spent: number): Promise<void> {
              store.run(
                "INSERT OR REPLACE INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
                `spend:${taskId}`,
                String(spent),
              );
            },
          },
          () => {}, // onEscalate: halting is handled at the tick call site
          () => {}, // onLog: no-op for finer budgets
        )
      : undefined;

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
  const prOpTaskMap = new Map<string, string>();

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
  const statusServer = statusServerFactory({ store, logger });
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
          } catch {
            // Revert to pending so the task is not stranded in "running".
            setTaskStatus(store, task.id, "pending");
            continue;
          }

          const taskStem = task.id;

          // Budget gate — halt-and-park BEFORE spawning when ceiling is breached.
          if (budgetBreaker !== undefined) {
            const budgetOutcome = await budgetBreaker.reserve(task.id, null);
            if (budgetOutcome === "halted") {
              createEscalationItem({
                source_id: `${task.id}:budget-breach`,
                task_id: task.id,
                reason: "budget-breach",
                payload_summary: `task ${task.id} budget ceiling breached`,
                store,
                clock,
              });
              setTaskStatus(store, task.id, "parked");
              continue;
            }
          }

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
          const featureDirAllowGlob = featureDir + "/**";
          const ring1Chain = makeRing1HookAdapter({
            registry: {
              roles: {
                agent: {
                  read: { allow: [featureDirAllowGlob], deny: [] },
                  write: { allow: [featureDirAllowGlob], deny: [] },
                },
              },
            },
            role: "agent",
            writeScope,
            worktree: featureDir,
            onEscalate: (e) => {
              createEscalationItem({
                source_id: `${task.id}:${String(e["path"] ?? e["toolName"] ?? e.tag)}`,
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
          });

          await sessionHandle.waitForIdle();

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
                await handle.deliverSession({
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
              }
            }
          }
        }
      }

      // Completion check (Story 004 T2) — observe broker_completion for create_pr
      // ops that have reached the "merged" terminal state and mark the associated
      // tasks complete.  The daemon never merges the PR itself; it only observes.
      const completedOps: string[] = [];
      for (const [opId, taskId] of prOpTaskMap) {
        const completion = store.get<{ status: string }>(
          "SELECT status FROM broker_completion WHERE op_id = ?",
          opId,
        );
        if (completion !== undefined && completion.status === "merged") {
          setTaskStatus(store, taskId, "complete");
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

      // Record task→op association for PR merge completion tracking.
      const { taskId } = params;
      if (taskId !== undefined && taskId !== "") {
        prOpTaskMap.set(createPrOpId, taskId);
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
      }
      const heldRows = store.all<HeldRow>(
        `SELECT bif.op_id, bif.verb, bif.idempotency_key
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
          correlation: "",
          desired_effect_hash: "",
          status: "needs_reconciliation" as const,
        };

        await reconcileOp(ledgerEntry, entry.entry, entry.adapter, store, clock);
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
      handle.tick().catch(() => {}).finally(() => {
        scheduleNextTick();
      });
    });
  }
  if (deps.verbAdapters !== undefined) {
    await handle.reconcileHeldOps(deps.verbAdapters);
  }
  scheduleNextTick();

  return handle;
}
