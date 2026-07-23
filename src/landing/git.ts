// src/landing/git.ts — GitRepositoryLanding adapter.
// Uses real git via execFile (no shell). Provides preview (read-only merge-tree)
// and landPreviewed (atomic CAS update-ref) for object/ref-only landing.
// The lock seam is preserved for cross-process coordination during landPreviewed.

import { open, constants } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import type { FileHandle } from "node:fs/promises";
import type {
  RepositoryLanding,
  LandingCandidate,
  LandingResult,
  PreviewOutcome,
} from "./port.ts";
import { LandingCASMismatchError } from "./port.ts";
import type { LandingRepository } from "../storage/port.ts";

const execFile = promisify(execFileCb);

async function gitOut(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

/**
 * Returns true if `sha` is an ancestor of `ref` in the repo at `cwd`.
 * Returns false if not an ancestor OR if `sha` is not in the local object database.
 */
async function isAncestor(
  cwd: string,
  sha: string,
  ref: string,
): Promise<boolean> {
  try {
    await execFile("git", ["merge-base", "--is-ancestor", sha, ref], { cwd });
    return true;
  } catch {
    return false;
  }
}

/** Acquire an exclusive lock file with exponential backoff, up to maxWaitMs. */
async function acquireLock(
  lockPath: string,
  maxWaitMs = 30_000,
): Promise<FileHandle> {
  const start = Date.now();
  let delay = 50;
  for (;;) {
    try {
      return await open(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") throw err;
      const elapsed = Date.now() - start;
      if (elapsed >= maxWaitMs) {
        throw new Error(
          `GitRepositoryLanding: could not acquire lock at ${lockPath} after ${maxWaitMs} ms`,
        );
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, delay + Math.floor(Math.random() * 50)),
      );
      delay = Math.min(Math.floor(delay * 1.5), 2_000);
    }
  }
}

export class GitRepositoryLanding implements RepositoryLanding {
  readonly #lockDir: string;
  readonly #landing: LandingRepository;
  readonly #gitConfig: { name: string; email: string };

  constructor(
    lockDir: string,
    landing: LandingRepository,
    gitConfig: { name: string; email: string },
  ) {
    this.#lockDir = lockDir;
    this.#landing = landing;
    this.#gitConfig = gitConfig;
  }

  /**
   * Pure read-only preview of how a candidate would integrate with the current
   * target OID.  Never touches refs, HEAD, index, or worktree.
   *
   * - fast-forward  → candidateSHA is reachable from targetOID (candidateSHA is
   *                   already ahead); returns {kind:'fast-forward',candidateOID}.
   * - mergeable     → `merge-tree --write-tree` exits 0; returns
   *                   {kind:'mergeable',treeOID} where treeOID is the merged tree.
   * - conflict      → `merge-tree --write-tree` exits non-zero; reads the
   *                   conflicted blobs from the result tree; returns
   *                   {kind:'conflict',files,perFile}.
   */
  async preview(
    homeDir: string,
    candidate: LandingCandidate,
    targetOID: string,
  ): Promise<PreviewOutcome> {
    // Ensure the candidate object is reachable locally (mirrors land() fetch).
    // Skip when workspace is empty: the get-conflict re-preview path passes an
    // empty workspace because the candidateSHA is already in homeDir's object
    // DB from the earlier approve-time fetch.
    if (candidate.workspace) {
      await execFile(
        "git",
        ["fetch", candidate.workspace, candidate.candidateSHA],
        { cwd: homeDir },
      );
    }

    // Fast-forward check: is targetOID an ancestor of candidateSHA?
    // If yes, the candidate is strictly ahead of the target — pure ff, no merge needed.
    const isFf = await isAncestor(homeDir, targetOID, candidate.candidateSHA);
    if (isFf) {
      return { kind: "fast-forward", candidateOID: candidate.candidateSHA };
    }

    // 3-way merge preview — writes result blob/tree objects into the ODB but
    // leaves refs/HEAD/index/worktree completely untouched (git guarantee).
    let mergeTreeStdout = "";
    let isConflict = false;
    try {
      const { stdout } = await execFile(
        "git",
        ["merge-tree", "--write-tree", targetOID, candidate.candidateSHA],
        { cwd: homeDir },
      );
      mergeTreeStdout = stdout;
    } catch (err) {
      // exit 1 on conflict; stdout still carries the result tree OID + CONFLICT lines
      const e = err as { stdout?: string };
      mergeTreeStdout = e.stdout ?? "";
      isConflict = true;
    }

    const lines = mergeTreeStdout.split("\n");
    const treeOID = (lines[0] ?? "").trim();

    if (!isConflict) {
      return { kind: "mergeable", treeOID };
    }

    // Extract conflicting file paths from "CONFLICT … Merge conflict in <path>" lines.
    const files: string[] = [];
    for (const line of lines) {
      const m = /Merge conflict in (.+)$/.exec(line);
      if (m?.[1] !== undefined) {
        files.push(m[1].trim());
      }
    }

    // For each conflicted path, read the hunk text from the result tree blob.
    const perFile: { path: string; hunks: string }[] = [];
    for (const filePath of files) {
      let hunks = "";
      try {
        const { stdout } = await execFile(
          "git",
          ["cat-file", "-p", `${treeOID}:${filePath}`],
          { cwd: homeDir },
        );
        hunks = stdout;
      } catch {
        // blob not found in result tree — include with empty hunks
      }
      perFile.push({ path: filePath, hunks });
    }

    return { kind: "conflict", files, perFile };
  }

  /**
   * Resolves the current OID of a named branch in homeDir.
   * Non-mutating — equivalent to `git rev-parse <branch>`.
   */
  async resolveTargetOID(homeDir: string, branch: string): Promise<string> {
    return gitOut(homeDir, "rev-parse", branch);
  }

  /**
   * Lands the tree that was already computed by `preview`.
   *
   * - fast-forward: atomic CAS `git update-ref refs/heads/<target> <candidateOID> <expectedOld>`.
   * - mergeable:    `git commit-tree <treeOID> -p <targetOID> -p <candidateSHA>` then same CAS.
   * - conflict:     throws (must not be called for conflict outcomes).
   *
   * On CAS mismatch (branch moved between preview and land) throws `LandingCASMismatchError`
   * carrying the new branch OID so the caller can re-preview.
   */
  async landPreviewed(
    homeDir: string,
    candidate: LandingCandidate,
    previewOutcome: PreviewOutcome,
    targetOID: string,
  ): Promise<LandingResult> {
    const ref = `refs/heads/${candidate.target}`;

    if (previewOutcome.kind === "fast-forward") {
      try {
        await execFile(
          "git",
          ["update-ref", ref, previewOutcome.candidateOID, targetOID],
          { cwd: homeDir },
        );
      } catch {
        const newTargetOID = await gitOut(
          homeDir,
          "rev-parse",
          candidate.target,
        );
        throw new LandingCASMismatchError(newTargetOID);
      }
      return {
        candidate,
        outcome: { kind: "fast-forward" },
        canonicalSHA: previewOutcome.candidateOID,
      };
    }

    if (previewOutcome.kind === "mergeable") {
      // Build a merge commit from the already-computed tree OID.
      // Parents: target (left) and candidate (right) — standard merge commit shape.
      const { stdout: commitStdout } = await execFile(
        "git",
        [
          "-c",
          `user.name=${this.#gitConfig.name}`,
          "-c",
          `user.email=${this.#gitConfig.email}`,
          "commit-tree",
          previewOutcome.treeOID,
          "-p",
          targetOID,
          "-p",
          candidate.candidateSHA,
          "-m",
          `Merge task ${candidate.taskId ?? candidate.id}`,
        ],
        { cwd: homeDir },
      );
      const mergeCommit = commitStdout.trim();

      // Atomic CAS: only advance the branch if it still points at targetOID.
      try {
        await execFile("git", ["update-ref", ref, mergeCommit, targetOID], {
          cwd: homeDir,
        });
      } catch {
        const newTargetOID = await gitOut(
          homeDir,
          "rev-parse",
          candidate.target,
        );
        throw new LandingCASMismatchError(newTargetOID);
      }
      return {
        candidate,
        outcome: { kind: "merge", mergeCommit },
        canonicalSHA: mergeCommit,
      };
    }

    // conflict outcome: landPreviewed must not be called
    throw new Error(
      "landPreviewed: must not be called for conflict preview outcomes",
    );
  }
}

/**
 * Tripwire stub — NOT YET IMPLEMENTED (EPIC 007.6 B1).
 * Builds a structured, marker-free conflict context payload from per-file
 * conflict hunk data. Throws immediately so callers discover the gap at
 * runtime rather than silently receiving empty context.
 */
export function buildConflictContext(
  _perFile: Array<{ path: string; hunks: string }>,
): string {
  throw new Error("conflictContext not implemented — EPIC 007.6 B1");
}
