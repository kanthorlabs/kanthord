// src/landing/git.ts — GitRepositoryLanding adapter.
// Uses real git via execFile (no shell). Acquires a cross-process per-repo+branch
// lock, classifies ancestry (ff / merge / conflict / already-landed), and persists
// durable candidate metadata for crash-idempotent recovery.

import { open, unlink, constants } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import type { FileHandle } from "node:fs/promises";
import type {
  RepositoryLanding,
  LandingCandidate,
  LandingResult,
} from "./port.ts";
import { LandingConflictError } from "./port.ts";
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
            canonicalSHA: candidate.candidateSHA,
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
}
