// src/apps/cli/repo.ts — CLI handlers for the `repo` command group.
//
// Currently: `repo land` — lands an accepted candidate branch onto the
// home canonical branch via the RepositoryLanding port.

import type { CliRepositoryLanding } from "./deps.ts";
import {
  LandingConflictError,
  LandingCASMismatchError,
} from "../../app/errors.ts";
import { MissingFlagError } from "./error-map.ts";

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

function requireFlag(args: Record<string, unknown>, flag: string): string {
  const value = args[flag];
  if (typeof value !== "string" || value === "") {
    throw new MissingFlagError(`--${flag}`);
  }
  return value;
}

/**
 * `repo land` — fetch + fast-forward or merge the candidateSHA into the
 * home repo's target branch under the cross-process lock.
 *
 * Args:
 *   --repository <id>   resource id of the Repository entity
 *   --workspace  <dir>  path to the workspace clone (where candidateSHA lives)
 *   --base       <ref>  target branch name on the home repo
 *   --candidate  <sha>  the commit SHA to land
 *
 * Stdout: JSON result object (always, even on conflict — caller can inspect files).
 * Stderr: human-readable note (e.g. "already landed" for idempotent re-runs).
 * Exit 0: fast-forward, merge, already-landed.
 * Exit 1: conflict (files listed in stdout JSON).
 */
export async function runRepoLand(
  args: Record<string, unknown>,
  landing: CliRepositoryLanding,
  resolveHomeDir: (repoId: string) => string,
): Promise<HandlerResult> {
  const repoId = requireFlag(args, "repository");
  const workspace = requireFlag(args, "workspace");
  const target = requireFlag(args, "base");
  const candidateSHA = requireFlag(args, "candidate");

  const homeDir = resolveHomeDir(repoId);

  // Build a minimal candidate from the CLI flags. taskId / baseSHA / ref are
  // not known at CLI invocation time; the adapter uses candidateSHA for the git
  // operation and the id for crash-idempotent tracking.
  const candidate = {
    id: candidateSHA,
    taskId: null,
    repoId,
    baseSHA: "",
    candidateSHA,
    ref: "",
    target,
    workspace,
  };

  // Object-path landing: resolveTargetOID → preview → landPreviewed (CAS).
  // Retries up to MAX_CAS_RETRIES if the branch moves between preview and land.
  const MAX_CAS_RETRIES = 3;
  let casRetries = 0;
  let currentTargetOID: string;

  try {
    currentTargetOID = await landing.resolveTargetOID(homeDir, target);
  } catch {
    throw new Error(
      `Could not resolve target branch "${target}" in home repository at ${homeDir}`,
    );
  }

  for (;;) {
    if (casRetries >= MAX_CAS_RETRIES) {
      return {
        exitCode: 1,
        stdout: [JSON.stringify({ outcome: "target_moved" }, null, 2)],
        stderr: [],
      };
    }

    const previewOutcome = await landing.preview(
      homeDir,
      candidate,
      currentTargetOID,
    );

    if (previewOutcome.kind === "conflict") {
      const json: Record<string, unknown> = {
        outcome: "conflict",
        files: previewOutcome.files,
      };
      return {
        exitCode: 1,
        stdout: [JSON.stringify(json, null, 2)],
        stderr: [],
      };
    }

    try {
      const result = await landing.landPreviewed(
        homeDir,
        candidate,
        previewOutcome,
        currentTargetOID,
      );
      const { outcome, canonicalSHA } = result;

      let json: Record<string, unknown>;
      let stderr: string[] = [];

      if (outcome.kind === "fast-forward") {
        json = { outcome: "fast-forward", canonicalSHA };
      } else if (outcome.kind === "merge") {
        json = {
          outcome: "merge",
          mergeCommit: outcome.mergeCommit,
          canonicalSHA,
        };
      } else if (outcome.kind === "already-landed") {
        json = { outcome: "already-landed", canonicalSHA };
        // The Proof command greps for "already landed" (space) in combined output.
        stderr = ["already landed"];
      } else {
        // outcome.kind === "conflict" — returned rather than thrown
        const conflictOutcome = outcome as {
          kind: "conflict";
          files: string[];
        };
        json = { outcome: "conflict", files: conflictOutcome.files };
        return {
          exitCode: 1,
          stdout: [JSON.stringify(json, null, 2)],
          stderr: [],
        };
      }

      return { exitCode: 0, stdout: [JSON.stringify(json, null, 2)], stderr };
    } catch (err) {
      if (err instanceof LandingCASMismatchError) {
        currentTargetOID = err.newTargetOID;
        casRetries++;
        continue;
      }
      if (err instanceof LandingConflictError) {
        const json: Record<string, unknown> = {
          outcome: "conflict",
          files: err.conflictFiles,
        };
        return {
          exitCode: 1,
          stdout: [JSON.stringify(json, null, 2)],
          stderr: [],
        };
      }
      throw err;
    }
  }
}
