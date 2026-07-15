/**
 * src/rpc/control-verbs.ts
 *
 * Story 002 — Control Verbs.
 *
 * Task T1:
 *   - signOffPlan  — runs the Epic 002 compile seam; returns planner-vocabulary
 *                    diagnostics on failure or the stamped generation on success;
 *                    journals the sign-off with actor.
 *   - haltTask     — parks a pending task by setting blocked_on; throws a typed
 *                    HaltConflictError on a second halt; journals the halt with actor.
 *
 * Task T2:
 *   - approveReplan — validates edit paths, checks base-generation match, applies
 *                     file edits, recompiles atomically (rollback on failure), resets
 *                     affected task gates, journals the replan.
 *   - budgetOverride — one-shot, rate-limited, per-day-capped ceiling raise; appends
 *                      an override entry to budget_ledger and emits an interaction event.
 */

import { readFile, writeFile, lstat, unlink } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import type { Store } from "../foundations/sqlite-store.ts";
import type { LeafLogger } from "../foundations/log.ts";
import { log, errMessage } from "../foundations/log.ts";
import { compile } from "../compiler/compile.ts";
import { parseNodeName } from "../compiler/grammar.ts";
import { newId } from "../foundations/id.ts";

// ---------------------------------------------------------------------------
// Public deps contract
// ---------------------------------------------------------------------------

export interface ControlVerbsDeps {
  store: Store;
  featureDirFn: (featureId: string) => string;
  logger?: LeafLogger;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class HaltConflictError extends Error {
  constructor(taskId: string) {
    super(`Task "${taskId}" is already halted`);
    this.name = "HaltConflictError";
  }
}

export class HaltFeatureConflictError extends Error {
  constructor(featureId: string) {
    super(`Feature "${featureId}" is already halted`);
    this.name = "HaltFeatureConflictError";
  }
}

export class PathViolationError extends Error {
  constructor(editPath: string) {
    super(`Edit path "${editPath}" violates the allowed path contract (traversal or absolute path)`);
    this.name = "PathViolationError";
  }
}

export class GenerationConflictError extends Error {
  constructor(baseGeneration: number, liveGeneration: number) {
    super(
      `Base generation ${baseGeneration} does not match live generation ${liveGeneration}`,
    );
    this.name = "GenerationConflictError";
  }
}

export class OverrideRateLimitError extends Error {
  constructor() {
    super("Budget override rate limit reached");
    this.name = "OverrideRateLimitError";
  }
}

export class OverrideDayCapError extends Error {
  constructor() {
    super("Budget override per-day cap reached");
    this.name = "OverrideDayCapError";
  }
}

export class OverrideAlreadyAppliedError extends Error {
  constructor(taskId: string) {
    super(`Budget override already applied for task "${taskId}" (one-shot enforcement)`);
    this.name = "OverrideAlreadyAppliedError";
  }
}

export class DuplicateEditTargetError extends Error {
  constructor(editPath: string) {
    super(`Duplicate edit target: "${editPath}" resolves to the same absolute path as a prior edit`);
    this.name = "DuplicateEditTargetError";
  }
}

// ---------------------------------------------------------------------------
// signOffPlan — compile via Epic 002 seam; journal on success
// ---------------------------------------------------------------------------

export async function signOffPlan(
  featureId: string,
  actor: string,
  deps: ControlVerbsDeps,
): Promise<{ valid: false; diagnostics: string[] } | { valid: true; generation: number }> {
  const { store, featureDirFn } = deps;
  const featureDir = featureDirFn(featureId);

  try {
    await compile(featureDir, store, {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, diagnostics: [msg] };
  }

  // Read the latest generation stamped by compile().
  const genRow = store.get<{ generation: number }>(
    "SELECT generation FROM plan_generation WHERE feature_id = ? ORDER BY generation DESC LIMIT 1",
    featureId,
  );
  const generation = genRow?.generation ?? 1;

  // Journal the sign-off.
  store.run(
    "INSERT INTO control_journal (id, action, target_id, actor, recorded_at) VALUES (?, ?, ?, ?, ?)",
    newId("cj"),
    "sign_off",
    featureId,
    actor,
    Date.now(),
  );

  return { valid: true, generation };
}

// ---------------------------------------------------------------------------
// haltTask — park via blocked_on sentinel; journal the halt
// ---------------------------------------------------------------------------

export function haltTask(
  taskId: string,
  actor: string,
  deps: ControlVerbsDeps,
): void {
  const { store } = deps;

  // Check whether the task is already halted.
  const row = store.get<{ blocked_on: string | null }>(
    "SELECT blocked_on FROM scheduler_task WHERE node_id = ?",
    taskId,
  );
  if (row !== undefined && row.blocked_on !== null) {
    throw new HaltConflictError(taskId);
  }

  // Park the task by setting blocked_on to a halt sentinel.
  store.run(
    "UPDATE scheduler_task SET blocked_on = ? WHERE node_id = ?",
    `halt:${actor}`,
    taskId,
  );

  // Journal the halt.
  store.run(
    "INSERT INTO control_journal (id, action, target_id, actor, recorded_at) VALUES (?, ?, ?, ?, ?)",
    newId("cj"),
    "halt_task",
    taskId,
    actor,
    Date.now(),
  );
}

// ---------------------------------------------------------------------------
// haltFeature — park all pending tasks for the feature; journal with actor
// ---------------------------------------------------------------------------

export function haltFeature(
  featureId: string,
  actor: string,
  deps: ControlVerbsDeps,
): void {
  const { store } = deps;

  // Conflict check: if a halt_feature journal row already exists for this feature,
  // the feature is already halted.
  const existing = store.get<{ id: string }>(
    "SELECT id FROM control_journal WHERE target_id = ? AND action = 'halt_feature' LIMIT 1",
    featureId,
  );
  if (existing !== undefined) {
    throw new HaltFeatureConflictError(featureId);
  }

  // Park all pending tasks for this feature via the Epic 004 blocked_on transition.
  store.run(
    "UPDATE scheduler_task SET blocked_on = ? WHERE feature_id = ? AND blocked_on IS NULL",
    `halt:${actor}`,
    featureId,
  );

  // Journal the feature halt.
  store.run(
    "INSERT INTO control_journal (id, action, target_id, actor, recorded_at) VALUES (?, ?, ?, ?, ?)",
    newId("cj"),
    "halt_feature",
    featureId,
    actor,
    Date.now(),
  );
}

// ---------------------------------------------------------------------------
// Per-feature async mutex for approveReplan's critical section
// ---------------------------------------------------------------------------

// Tail of the serialized promise chain per featureId. The stored promise never
// rejects (errors are suppressed by .catch) so subsequent callers can always
// queue on it; the entry is deleted once the chain drains to avoid leaks.
const pendingByFeature = new Map<string, Promise<unknown>>();

function withFeatureLock<T>(featureId: string, fn: () => Promise<T>): Promise<T> {
  const prev = pendingByFeature.get(featureId) ?? Promise.resolve();
  const resultPromise = prev.then(() => fn());
  const tail = resultPromise.catch(() => {});
  pendingByFeature.set(featureId, tail);
  void tail.finally(() => {
    if (pendingByFeature.get(featureId) === tail) {
      pendingByFeature.delete(featureId);
    }
  });
  return resultPromise;
}

// ---------------------------------------------------------------------------
// approveReplan — apply edit set atomically; rollback on compile failure
// ---------------------------------------------------------------------------

export interface ReplanEdit {
  path: string;
  newContent: string;
}

export interface ReplanDiff {
  featureId: string;
  baseGeneration: number;
  edits: ReplanEdit[];
}

/**
 * Extract the `id:` value from a YAML-frontmatter plan file (between `---` markers).
 * Returns null when no `id:` field is found.
 */
function extractIdFromContent(content: string): string | null {
  const match = /(?:^|\n)id:\s*(\S+)/.exec(content);
  return match?.[1] ?? null;
}

/**
 * B7 allowlist: mirrors compile.ts computeCompileHash's covered-set rule.
 *
 * Allowed at the feature-root level: epic.md, INDEX.md.
 * Allowed inside a story dir (one path segment that parses as "story" kind):
 *   any file except RUNBOOK.md, *.state.md, *.journal.jsonl.
 * All other paths → PathViolationError.
 */
function assertAllowedEditPath(editPath: string): void {
  const segments = editPath.split("/");
  if (segments.length === 1) {
    const fname = segments[0]!;
    if (fname !== "epic.md" && fname !== "INDEX.md") {
      throw new PathViolationError(editPath);
    }
  } else if (segments.length === 2) {
    const dirPart = segments[0]!;
    const filePart = segments[1]!;
    // First segment must parse as a story directory name (mirrors compile.ts grammar walk).
    let isStoryDir = false;
    try {
      const parsed = parseNodeName(`${dirPart}/`);
      isStoryDir = parsed.kind === "story";
    } catch (err) {
      log.debug("replan-path-not-story-dir", { dir: dirPart, error: errMessage(err) });
    }
    if (!isStoryDir) {
      throw new PathViolationError(editPath);
    }
    // Excluded files within story dirs (same exclusions as computeCompileHash):
    if (
      filePart === "RUNBOOK.md" ||
      filePart.endsWith(".state.md") ||
      filePart.endsWith(".journal.jsonl")
    ) {
      throw new PathViolationError(editPath);
    }
  } else {
    throw new PathViolationError(editPath);
  }
}

async function doApproveReplan(
  diff: ReplanDiff,
  actor: string,
  deps: ControlVerbsDeps,
): Promise<{ generation: number }> {
  const { store, featureDirFn } = deps;
  const featureDir = featureDirFn(diff.featureId);

  // 1. Validate all edit paths before any disk or DB writes.
  const resolvedSet = new Set<string>();
  for (const edit of diff.edits) {
    if (isAbsolute(edit.path)) {
      throw new PathViolationError(edit.path);
    }
    const resolved = resolve(featureDir, edit.path);
    // The resolved path must be strictly inside featureDir (not featureDir itself).
    if (!resolved.startsWith(featureDir + "/")) {
      throw new PathViolationError(edit.path);
    }
    // Duplicate target check: reject two edits resolving to the same absolute path.
    if (resolvedSet.has(resolved)) {
      throw new DuplicateEditTargetError(edit.path);
    }
    resolvedSet.add(resolved);
    // Symlink check: lstat (does not follow symlinks) — reject symlinks typed.
    // ENOENT means new file (not yet created) — allowed. Other errors rethrown.
    try {
      const entryStat = await lstat(resolved);
      if (entryStat.isSymbolicLink()) {
        throw new PathViolationError(edit.path);
      }
    } catch (lstatErr) {
      if (lstatErr instanceof PathViolationError) throw lstatErr;
      const errCode = (lstatErr as { code?: string }).code;
      if (errCode !== "ENOENT") throw lstatErr;
    }
    // B7 allowlist: only covered plan files (epic.md, INDEX.md, story task files).
    assertAllowedEditPath(edit.path);
  }

  // 2. Check that the submitted base generation matches the live generation.
  const liveGenRow = store.get<{ max_gen: number | null }>(
    "SELECT MAX(generation) AS max_gen FROM plan_generation WHERE feature_id = ?",
    diff.featureId,
  );
  const liveGen = liveGenRow?.max_gen ?? 0;
  if (liveGen !== diff.baseGeneration) {
    throw new GenerationConflictError(diff.baseGeneration, liveGen);
  }

  // 3. Save original file contents so we can restore them on compile failure.
  //    Newly-created files (ENOENT) are tracked in newFilePaths for unlink-on-rollback.
  const originalContents = new Map<string, string>();
  const newFilePaths = new Set<string>();
  for (const edit of diff.edits) {
    const absPath = join(featureDir, edit.path);
    try {
      const original = await readFile(absPath, "utf8");
      originalContents.set(edit.path, original);
    } catch (err) {
      const errCode = (err as { code?: string }).code;
      if (errCode === "ENOENT") {
        // File does not yet exist — track for unlink on rollback (not writeFile "").
        newFilePaths.add(absPath);
      } else {
        deps.logger?.warn("approveReplan.read-error", {
          path: edit.path,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }
  }

  // 4 + 5. Apply edits to disk and recompile inside a SQLite SAVEPOINT.
  //
  // Transactional store rollback on a caught compile error + best-effort disk restore
  // under the daemon single-writer assumption — NOT crash-atomic. compile() is now
  // self-atomic (SAVEPOINT compile_apply); the only remaining deferred item is
  // subscribeSessionEvents live streaming. Concurrent-approval serialization is
  // done (per-feature async mutex in the public approveReplan wrapper).
  store.run("SAVEPOINT replan_apply");
  try {
    // 4. Apply edits to disk.
    for (const edit of diff.edits) {
      const absPath = join(featureDir, edit.path);
      await writeFile(absPath, edit.newContent, "utf8");
    }
    // 5. Recompile.
    await compile(featureDir, store, {});
  } catch (originalErr) {
    // Roll back the store to the pre-apply savepoint.
    try {
      store.run("ROLLBACK TO replan_apply");
      store.run("RELEASE replan_apply");
    } catch (cleanupErr) {
      deps.logger?.warn("approveReplan.rollback-cleanup-error", {
        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
    }
    // Restore disk originals — independent per-file best-effort.
    for (const edit of diff.edits) {
      const absPath = join(featureDir, edit.path);
      try {
        if (newFilePaths.has(absPath)) {
          // Newly-created file: unlink it (not written as empty stub); ignore ENOENT.
          await unlink(absPath);
        } else {
          const original = originalContents.get(edit.path);
          if (original !== undefined) {
            await writeFile(absPath, original, "utf8");
          }
        }
      } catch (restoreErr) {
        deps.logger?.warn("approveReplan.restore-error", {
          path: edit.path,
          error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
        });
      }
    }
    throw originalErr;
  }
  store.run("RELEASE replan_apply");

  // 6. Read the new generation stamped by compile().
  const newGenRow = store.get<{ max_gen: number | null }>(
    "SELECT MAX(generation) AS max_gen FROM plan_generation WHERE feature_id = ?",
    diff.featureId,
  );
  const newGen = newGenRow?.max_gen ?? liveGen;

  // 7. Re-open exit gates for tasks whose plan files were edited.
  //    The task node_id is the `id:` field in the YAML frontmatter of the file.
  for (const edit of diff.edits) {
    const taskId = extractIdFromContent(edit.newContent);
    if (taskId !== null) {
      store.run(
        "UPDATE scheduler_task SET exit_gate_passed = 0 WHERE node_id = ?",
        taskId,
      );
    }
  }

  // 8. Journal the replan.
  store.run(
    "INSERT INTO control_journal (id, action, target_id, actor, recorded_at) VALUES (?, ?, ?, ?, ?)",
    newId("cj"),
    "approve_replan",
    diff.featureId,
    actor,
    Date.now(),
  );

  return { generation: newGen };
}

export async function approveReplan(
  diff: ReplanDiff,
  actor: string,
  deps: ControlVerbsDeps,
): Promise<{ generation: number }> {
  return withFeatureLock(diff.featureId, () => doApproveReplan(diff, actor, deps));
}

// ---------------------------------------------------------------------------
// budgetOverride — one-shot, rate-limited, per-day-capped ceiling raise
// ---------------------------------------------------------------------------

export interface BudgetOverrideDeps {
  store: Store;
  overrideRateLimitFn: (taskId: string) => { allowed: boolean };
  overrideDayCapFn: (taskId: string) => { allowed: boolean };
  nowMs: number;
}

type LedgerOverrideEntry = {
  kind: "override";
  amount: number;
  reason: string;
  actor: string;
};

type AnyLedgerEntry = { kind: string; [key: string]: unknown };

export async function budgetOverride(
  opts: { taskId: string; featureId: string; amount: number; reason: string; actor: string },
  deps: BudgetOverrideDeps,
): Promise<{ applied: true }> {
  const { store, overrideRateLimitFn, overrideDayCapFn, nowMs } = deps;
  const { taskId, featureId, amount, reason, actor } = opts;

  // 1. Rate limit check.
  if (!overrideRateLimitFn(taskId).allowed) {
    throw new OverrideRateLimitError();
  }

  // 2. Per-day cap check.
  if (!overrideDayCapFn(taskId).allowed) {
    throw new OverrideDayCapError();
  }

  // 3. One-shot check: reject if an override entry already exists in the ledger.
  const existingRow = store.get<{ ledger: string }>(
    "SELECT ledger FROM budget_ledger WHERE task_id = ?",
    taskId,
  );
  let entries: AnyLedgerEntry[] = [];
  if (existingRow !== undefined) {
    entries = JSON.parse(existingRow.ledger) as AnyLedgerEntry[];
  }
  if (entries.some((e) => e.kind === "override")) {
    throw new OverrideAlreadyAppliedError(taskId);
  }

  // 4. Append override entry to the ledger.
  const overrideEntry: LedgerOverrideEntry = { kind: "override", amount, reason, actor };
  entries.push(overrideEntry);
  store.run(
    "INSERT OR REPLACE INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
    taskId,
    JSON.stringify(entries),
  );

  // 5. Write one interaction event to the outbox (actor + amount + reason + recorded_at).
  const itemId = newId("ov");
  const eventJson = JSON.stringify({
    actor,
    amount,
    reason,
    taskId,
    featureId,
    kind: "budget_override",
    recorded_at: nowMs,
  });
  const fingerprint = `budget_override:${taskId}:${itemId}`;
  store.run(
    "INSERT INTO interaction_outbox (item_id, event_json, request_fingerprint, projected_at) VALUES (?, ?, ?, NULL)",
    itemId,
    eventJson,
    fingerprint,
  );

  return { applied: true };
}
