// src/landing/git.ts — GitRepositoryLanding adapter.
// Uses real git via execFile (no shell). Acquires a cross-process per-repo+branch
// lock, classifies ancestry (ff / merge / conflict / already-landed), and persists
// durable candidate metadata for crash-idempotent recovery.

import { open, unlink, constants } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import type { FileHandle } from "node:fs/promises";
import type {
  RepositoryLanding,
  LandingCandidate,
  LandingResult,
  PreviewOutcome,
} from "./port.ts";
import {
  LandingConflictError,
  LandingInvariantError,
  LandingCASMismatchError,
} from "./port.ts";
import type { LandingRepository } from "../storage/port.ts";
import type { ChangeCandidate, Integration } from "../domain/landing.ts";

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

  async land(
    homeDir: string,
    candidate: LandingCandidate,
  ): Promise<LandingResult> {
    const lockPath = join(
      this.#lockDir,
      `${candidate.repoId}-${candidate.target}.lock`,
    );

    if (!isAbsolute(candidate.workspace)) {
      throw new LandingInvariantError(
        `candidate.workspace must be an absolute path; got: ${candidate.workspace}`,
      );
    }

    const fh = await acquireLock(lockPath);
    try {
      // --- Fetch candidate object from workspace clone into home repo ---
      // Ensures candidateSHA is reachable locally before any ancestry/merge ops.
      await execFile(
        "git",
        ["fetch", candidate.workspace, candidate.candidateSHA],
        { cwd: homeDir },
      );

      // --- Idempotent already-landed check ---
      // candidateSHA reachable from target → no mutation needed.
      const alreadyLanded = await isAncestor(
        homeDir,
        candidate.candidateSHA,
        candidate.target,
      );
      if (alreadyLanded) {
        const canonicalSHA = await gitOut(
          homeDir,
          "rev-parse",
          candidate.target,
        );
        return {
          candidate,
          outcome: { kind: "already-landed", canonicalSHA },
          canonicalSHA,
        };
      }

      // --- Crash-idempotent: save pending row if not already persisted ---
      const existing = this.#landing.getCandidate(candidate.id);
      if (existing === undefined) {
        const record: ChangeCandidate = {
          id: candidate.id,
          taskId: candidate.taskId,
          repoId: candidate.repoId,
          baseSHA: candidate.baseSHA,
          candidateSHA: candidate.candidateSHA,
          ref: candidate.ref,
          target: candidate.target,
          state: "pending",
        };
        this.#landing.saveCandidate(record);
      }

      // --- Move onto the NAMED target ref before any ff/merge so we never
      // mutate the checked-out HEAD (which may be a different branch, e.g.
      // `main`). Landing is executor-neutral: the target comes from
      // `candidate.target` (the repository's configured canonical branch),
      // never from the currently checked-out branch. This is what makes a
      // non-checked-out target (like `trunk`) advance while `main` stays put.
      await execFile("git", ["checkout", "-q", candidate.target], {
        cwd: homeDir,
      });

      // --- Classify: fast-forward or merge ---
      // FF: current target HEAD is an ancestor of candidateSHA
      const currentHead = await gitOut(homeDir, "rev-parse", candidate.target);
      const isFf = await isAncestor(
        homeDir,
        currentHead,
        candidate.candidateSHA,
      );

      let outcome: LandingResult["outcome"];
      let canonicalSHA: string;

      if (isFf) {
        // Fast-forward: use --ff-only to guarantee no merge commit
        await execFile("git", ["merge", "--ff-only", candidate.candidateSHA], {
          cwd: homeDir,
        });
        canonicalSHA = await gitOut(homeDir, "rev-parse", candidate.target);
        outcome = { kind: "fast-forward" };
      } else {
        // Merge — may conflict
        try {
          await execFile(
            "git",
            [
              "-c",
              `user.name=${this.#gitConfig.name}`,
              "-c",
              `user.email=${this.#gitConfig.email}`,
              "merge",
              "--no-edit",
              candidate.candidateSHA,
            ],
            { cwd: homeDir },
          );
          const mergeCommit = await gitOut(homeDir, "rev-parse", "HEAD");
          canonicalSHA = mergeCommit;
          outcome = { kind: "merge", mergeCommit };
        } catch {
          // Collect conflict files, then abort
          let conflictFiles: string[] = [];
          try {
            const out = await gitOut(
              homeDir,
              "diff",
              "--name-only",
              "--diff-filter=U",
            );
            conflictFiles = out.split("\n").filter((f) => f.length > 0);
          } catch {
            // fallback: no files listed
          }
          try {
            await execFile("git", ["merge", "--abort"], { cwd: homeDir });
          } catch {
            // ignore abort errors
          }
          this.#landing.updateCandidateState(candidate.id, "conflict");
          const integration: Integration = {
            candidateId: candidate.id,
            outcome: "conflict",
            // The target HEAD captured before the (aborted) merge — not the
            // candidate SHA. The lock invariant is that a conflict leaves the
            // canonical branch untouched, so the recorded canonicalSHA must be
            // the unchanged target HEAD, never the diverged candidate.
            canonicalSHA: currentHead,
            conflictFiles,
          };
          this.#landing.saveIntegration(integration);
          throw new LandingConflictError(candidate, conflictFiles);
        }
      }

      // --- Persist outcome ---
      this.#landing.updateCandidateState(candidate.id, "landed");
      const integration: Integration = {
        candidateId: candidate.id,
        outcome: outcome.kind === "fast-forward" ? "fast-forward" : "merge",
        canonicalSHA,
        ...(outcome.kind === "merge"
          ? { mergeCommit: outcome.mergeCommit }
          : {}),
      };
      this.#landing.saveIntegration(integration);

      return { candidate, outcome, canonicalSHA };
    } finally {
      // Always release the lock
      try {
        await fh.close();
        await unlink(lockPath);
      } catch {
        // ignore cleanup errors
      }
    }
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
