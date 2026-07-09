/**
 * src/slots/worktree — Worktree lifecycle + lease-capped concurrency
 * Story 001 — Repo Slots & Worktrees
 * Task T2 — Worktree lifecycle + lease-capped concurrency
 */

import { realpath } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RunWorktreeGitFn = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ kind: string; stdout: string; stderr: string }>;

export interface WorktreeDispatchOpts {
  repoPath: string;
  worktreesBase: string;
  taskId: string;
  runGit: RunWorktreeGitFn;
  slotCapabilityKey?: string;
  maxConcurrentTasks?: number;
  treatExistingBranchAsConflict?: boolean;
}

export interface WorktreeDispatchResult {
  worktreePath: string;
  branchName: string;
  queued: boolean;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a branch already exists and is not owned by the current task
 * (only when `treatExistingBranchAsConflict` is true).
 */
export class WorktreeConflictError extends Error {
  constructor(branchName: string, taskId: string) {
    super(
      `WorktreeConflictError: branch "${branchName}" already exists and is not owned by task "${taskId}"`,
    );
    this.name = "WorktreeConflictError";
  }
}

/**
 * Thrown when `git worktree remove` fails (no silent force-delete).
 */
export class WorktreeRemoveError extends Error {
  constructor(worktreePath: string, stderr: string) {
    super(
      `WorktreeRemoveError: failed to remove worktree at "${worktreePath}": ${stderr}`,
    );
    this.name = "WorktreeRemoveError";
  }
}

// ---------------------------------------------------------------------------
// In-memory lease registry
// Tracks active taskIds per slotCapabilityKey across calls within the same
// process. This is the "slot capability" lease cap (Epic 004 pattern).
// ---------------------------------------------------------------------------

const _activeLeases: Map<string, Set<string>> = new Map();

function getLeaseSet(key: string): Set<string> {
  let set = _activeLeases.get(key);
  if (set === undefined) {
    set = new Set<string>();
    _activeLeases.set(key, set);
  }
  return set;
}

/** Exposed for test isolation (not exported in the public surface). */
export function _resetLeases(): void {
  _activeLeases.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a taskId into a safe git branch name.
 * Replaces any char that is not alphanumeric, underscore, period, or hyphen
 * with a hyphen, then strips leading/trailing hyphens.
 */
function sanitizeBranchName(taskId: string): string {
  return taskId
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "") || "task";
}

/**
 * Check if a branch exists in the git repo by listing it.
 * Returns true if `git branch --list <branch>` output is non-empty.
 */
async function branchExists(
  branchName: string,
  repoPath: string,
  runGit: RunWorktreeGitFn,
): Promise<boolean> {
  const result = await runGit(["branch", "--list", branchName], {
    cwd: repoPath,
  });
  return result.kind === "success" && result.stdout.trim().length > 0;
}

/**
 * Check if a worktree already exists at the given path by listing all
 * worktrees and matching the path.
 *
 * On macOS, `/var/folders/…` is a symlink to `/private/var/folders/…`. Both
 * the candidate path and the paths emitted by git are resolved to their
 * canonical real paths before comparison so that symlinked temp-dir prefixes
 * do not produce false negatives.
 */
async function worktreeExistsAtPath(
  worktreePath: string,
  repoPath: string,
  runGit: RunWorktreeGitFn,
): Promise<boolean> {
  const result = await runGit(["worktree", "list", "--porcelain"], {
    cwd: repoPath,
  });
  if (result.kind !== "success") return false;

  // Resolve the candidate path; if it doesn't exist yet, realpath will fail —
  // that means it definitely isn't an existing worktree.
  let realCandidate: string;
  try {
    realCandidate = await realpath(worktreePath);
  } catch {
    return false;
  }

  // Each worktree block starts with "worktree <path>"
  const lines = result.stdout.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("worktree ")) continue;
    const gitPath = trimmed.slice("worktree ".length);
    let realGitPath: string;
    try {
      realGitPath = await realpath(gitPath);
    } catch {
      realGitPath = gitPath;
    }
    if (realGitPath === realCandidate) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// dispatchWorktree
// ---------------------------------------------------------------------------

/**
 * Create a git worktree for the given taskId.
 *
 * Behaviour:
 * - Sanitizes `taskId` → `branchName` (no slashes or special chars).
 * - If `slotCapabilityKey` + `maxConcurrentTasks` are set and the lease is
 *   full, returns `{ queued: true }` without creating a worktree.
 * - If the branch already exists and `treatExistingBranchAsConflict` is true,
 *   throws `WorktreeConflictError`.
 * - If the same taskId's worktree already exists (crash re-dispatch), reuses
 *   the existing worktree path idempotently.
 * - Otherwise creates `worktreesBase/<branchName>` via `git worktree add`.
 *
 * @throws {WorktreeConflictError} Pre-existing foreign branch when
 *   `treatExistingBranchAsConflict` is true.
 */
export async function dispatchWorktree(
  opts: WorktreeDispatchOpts,
): Promise<WorktreeDispatchResult> {
  const {
    repoPath,
    worktreesBase,
    taskId,
    runGit,
    slotCapabilityKey,
    maxConcurrentTasks,
    treatExistingBranchAsConflict = false,
  } = opts;

  const branchName = sanitizeBranchName(taskId);
  const worktreePath = join(worktreesBase, branchName);

  // 1. Lease/concurrency check — if cap exceeded, return queued
  if (slotCapabilityKey !== undefined && maxConcurrentTasks !== undefined) {
    const leases = getLeaseSet(slotCapabilityKey);
    if (!leases.has(taskId) && leases.size >= maxConcurrentTasks) {
      return { worktreePath, branchName, queued: true };
    }
  }

  // 2. Check for pre-existing branch conflict
  if (treatExistingBranchAsConflict) {
    const exists = await branchExists(branchName, repoPath, runGit);
    if (exists) {
      throw new WorktreeConflictError(branchName, taskId);
    }
  }

  // 3. Idempotent re-dispatch: if worktree already exists at this path, reuse
  const alreadyExists = await worktreeExistsAtPath(
    worktreePath,
    repoPath,
    runGit,
  );
  if (alreadyExists) {
    // Register in lease if needed
    if (slotCapabilityKey !== undefined) {
      getLeaseSet(slotCapabilityKey).add(taskId);
    }
    return { worktreePath, branchName, queued: false };
  }

  // 4. Create the worktree on a new branch
  const addResult = await runGit(
    ["worktree", "add", "-b", branchName, worktreePath],
    { cwd: repoPath },
  );

  if (addResult.kind !== "success") {
    throw new Error(
      `Failed to create worktree at "${worktreePath}" on branch "${branchName}": ${addResult.stderr}`,
    );
  }

  // 5. Register lease
  if (slotCapabilityKey !== undefined) {
    getLeaseSet(slotCapabilityKey).add(taskId);
  }

  return { worktreePath, branchName, queued: false };
}

// ---------------------------------------------------------------------------
// completeWorktree
// ---------------------------------------------------------------------------

/**
 * Remove the worktree directory via `git worktree remove`. The branch is
 * intentionally kept (branch survival is part of the task history).
 *
 * If `slotCapabilityKey` and `taskId` are provided, the task is removed from
 * the in-memory lease set after a successful removal so that the slot capacity
 * is freed for the next dispatch.
 *
 * @throws {WorktreeRemoveError} If `git worktree remove` fails (no silent
 *   force-delete — the caller must decide whether to escalate or force).
 */
export async function completeWorktree(
  opts: WorktreeDispatchResult & {
    repoPath: string;
    runGit: RunWorktreeGitFn;
    slotCapabilityKey?: string;
    taskId?: string;
  },
): Promise<void> {
  const { worktreePath, repoPath, runGit, slotCapabilityKey, taskId } = opts;

  const result = await runGit(["worktree", "remove", worktreePath], {
    cwd: repoPath,
  });

  if (result.kind !== "success") {
    throw new WorktreeRemoveError(worktreePath, result.stderr);
  }

  // Release the lease so the slot capacity is freed for the next dispatch.
  if (slotCapabilityKey !== undefined && taskId !== undefined) {
    getLeaseSet(slotCapabilityKey).delete(taskId);
  }
}

// ---------------------------------------------------------------------------
// parkWorktree
// ---------------------------------------------------------------------------

/**
 * Park the current task session — keeps the worktree directory and all
 * uncommitted changes intact. Only the session ends; no git operations are
 * performed.
 *
 * The worktree survives so that in-progress work is not destroyed. The
 * `single_checkout` WIP-commit park/resume protocol (2B) will add the commit
 * path; for now, park is a no-op on the filesystem.
 */
export async function parkWorktree(
  _opts: WorktreeDispatchResult & {
    repoPath: string;
    runGit: RunWorktreeGitFn;
  },
): Promise<void> {
  // No git operations — the worktree directory remains untouched.
  // The lease is intentionally retained: the worktree holds state that
  // must not be garbage-collected until the session explicitly completes.
}
