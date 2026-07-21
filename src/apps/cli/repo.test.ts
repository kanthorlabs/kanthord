/**
 * Story 11 T6 — CLI `repo land` command handler.
 *
 * Fails today: `src/apps/cli/repo.ts` does not exist → ERR_MODULE_NOT_FOUND.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runRepoLand } from "./repo.ts";
import type { RepositoryLanding, LandingResult } from "../../landing/port.ts";
import { LandingConflictError } from "../../landing/port.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FF_SHA = "ff-canonical-sha-001";
const CAND_SHA = "cand-sha-001";
const REPO_ID = "repo-t6-01";
const WS_DIR = "/tmp/fake-ws-t6";
const HOME_DIR = "/tmp/fake-home-t6";
const BASE = "main";

const CAND_FIXTURE = {
  id: "cand-t6-01",
  taskId: "task-t6-01",
  repoId: REPO_ID,
  baseSHA: "base-sha-000",
  candidateSHA: CAND_SHA,
  ref: "kanthord/task-t6-01",
  target: BASE,
  workspace: WS_DIR,
};

function makeArgs(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    repository: REPO_ID,
    workspace: WS_DIR,
    base: BASE,
    candidate: CAND_SHA,
    ...extra,
  };
}

// Returns the homeDir for a known repo id.
function resolveHomeDir(repoId: string): string {
  if (repoId === REPO_ID) return HOME_DIR;
  throw new Error(`unknown repo id in test fixture: ${repoId}`);
}

// ---------------------------------------------------------------------------
// Fake landings
// ---------------------------------------------------------------------------

// S2 pre-adjust: shared stub methods added so these fakes still satisfy
// RepositoryLanding once preview/landPreviewed/resolveTargetOID become required.
// runRepoLand uses CliRepositoryLanding (land-only), so these stubs are never called.
function s2Stubs(): Pick<
  RepositoryLanding,
  "preview" | "landPreviewed" | "resolveTargetOID"
> {
  return {
    async preview(_homeDir, candidate) {
      return {
        kind: "fast-forward" as const,
        candidateOID: candidate.candidateSHA,
      };
    },
    async landPreviewed(_homeDir, candidate, _previewOutcome, _targetOID) {
      return {
        candidate,
        outcome: { kind: "fast-forward" as const },
        canonicalSHA: candidate.candidateSHA,
      };
    },
    resolveTargetOID(_homeDir, _branch) {
      return "0000000000000000000000000000000000000000";
    },
  };
}

function makeFfLanding(): RepositoryLanding {
  const result: LandingResult = {
    candidate: CAND_FIXTURE,
    outcome: { kind: "fast-forward" },
    canonicalSHA: FF_SHA,
  };
  return {
    async land(_homeDir, _candidate) {
      return result;
    },
    ...s2Stubs(),
  };
}

function makeConflictLanding(): RepositoryLanding {
  return {
    async land(_homeDir, candidate) {
      throw new LandingConflictError(candidate, ["conflict.ts"]);
    },
    ...s2Stubs(),
  };
}

function makeAlreadyLanding(): RepositoryLanding {
  const result: LandingResult = {
    candidate: CAND_FIXTURE,
    outcome: { kind: "already-landed", canonicalSHA: FF_SHA },
    canonicalSHA: FF_SHA,
  };
  return {
    async land(_homeDir, _candidate) {
      return result;
    },
    ...s2Stubs(),
  };
}

// ---------------------------------------------------------------------------
// T6-fast-forward
// ---------------------------------------------------------------------------

test("T6-fast-forward: runRepoLand returns exitCode 0 and stdout JSON with outcome fast-forward and canonicalSHA", async () => {
  const result = await runRepoLand(makeArgs(), makeFfLanding(), resolveHomeDir);
  assert.equal(
    result.exitCode,
    0,
    `expected exitCode 0 for fast-forward, got ${result.exitCode}: ${result.stderr.join("")}`,
  );
  const json = JSON.parse(result.stdout.join("")) as Record<string, unknown>;
  assert.equal(json["outcome"], "fast-forward", "outcome must be fast-forward");
  assert.equal(json["canonicalSHA"], FF_SHA, "canonicalSHA must match FF_SHA");
});

// ---------------------------------------------------------------------------
// T6-conflict
// ---------------------------------------------------------------------------

test("T6-conflict: runRepoLand with conflict fake returns exitCode 1 and stdout JSON with outcome conflict and files", async () => {
  const result = await runRepoLand(
    makeArgs(),
    makeConflictLanding(),
    resolveHomeDir,
  );
  assert.equal(
    result.exitCode,
    1,
    `expected exitCode 1 for conflict, got ${result.exitCode}`,
  );
  // Conflict is reported as JSON to stdout (not a thrown error) so the
  // caller can inspect the files list.
  const json = JSON.parse(result.stdout.join("")) as Record<string, unknown>;
  assert.equal(json["outcome"], "conflict", "outcome must be conflict");
  assert.ok(Array.isArray(json["files"]), "files must be an array");
  assert.ok(
    (json["files"] as string[]).includes("conflict.ts"),
    "files must include conflict.ts",
  );
});

// ---------------------------------------------------------------------------
// T6-already-landed
// ---------------------------------------------------------------------------

test("T6-already-landed: runRepoLand when already landed returns exitCode 0 and stdout JSON with outcome already-landed", async () => {
  const result = await runRepoLand(
    makeArgs(),
    makeAlreadyLanding(),
    resolveHomeDir,
  );
  assert.equal(
    result.exitCode,
    0,
    `expected exitCode 0 for already-landed, got ${result.exitCode}: ${result.stderr.join("")}`,
  );
  const json = JSON.parse(result.stdout.join("")) as Record<string, unknown>;
  assert.equal(
    json["outcome"],
    "already-landed",
    "outcome must be already-landed",
  );
});
