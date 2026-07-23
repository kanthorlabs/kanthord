/**
 * Story 11 T6 — CLI `repo land` command handler.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runRepoLand } from "./repo.ts";
import type { RepositoryLanding } from "../../landing/port.ts";

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
// Landing factory helpers used by the T6 fakes below
// ---------------------------------------------------------------------------

function makeFfLanding(): RepositoryLanding {
  return {
    resolveTargetOID() {
      return "0000000000000000000000000000000000000000";
    },
    async preview(_homeDir, candidate) {
      return {
        kind: "fast-forward" as const,
        candidateOID: candidate.candidateSHA,
      };
    },
    async landPreviewed() {
      return {
        candidate: CAND_FIXTURE,
        outcome: { kind: "fast-forward" as const },
        canonicalSHA: FF_SHA,
      };
    },
  };
}

function makeConflictLanding(): RepositoryLanding {
  return {
    resolveTargetOID() {
      return "0000000000000000000000000000000000000000";
    },
    async preview() {
      return { kind: "conflict" as const, files: ["conflict.ts"], perFile: [] };
    },
    async landPreviewed() {
      throw new Error(
        "landPreviewed must not be called when preview returns conflict",
      );
    },
  };
}

function makeAlreadyLanding(): RepositoryLanding {
  return {
    resolveTargetOID() {
      return "0000000000000000000000000000000000000000";
    },
    async preview(_homeDir, candidate) {
      return {
        kind: "fast-forward" as const,
        candidateOID: candidate.candidateSHA,
      };
    },
    async landPreviewed() {
      return {
        candidate: CAND_FIXTURE,
        outcome: { kind: "already-landed" as const, canonicalSHA: FF_SHA },
        canonicalSHA: FF_SHA,
      };
    },
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

// ---------------------------------------------------------------------------
// Story C — object/ref-only landing (confirms runRepoLand uses object path)
// ---------------------------------------------------------------------------

test("Story C object-path: runRepoLand with resolveTargetOID/preview/landPreviewed succeeds for fast-forward", async () => {
  const objectPathLanding: import("../../landing/port.ts").RepositoryLanding = {
    resolveTargetOID: async (_homeDir: string, _branch: string) =>
      "0000000000000000000000000000000000000001",
    preview: async (
      _homeDir: string,
      candidate: import("../../landing/port.ts").LandingCandidate,
      _targetOID: string,
    ) => {
      return {
        kind: "fast-forward" as const,
        candidateOID: candidate.candidateSHA,
      };
    },
    landPreviewed: async () => {
      return {
        candidate: CAND_FIXTURE,
        outcome: { kind: "fast-forward" as const },
        canonicalSHA: FF_SHA,
      };
    },
  };

  const result = await runRepoLand(
    makeArgs(),
    objectPathLanding,
    resolveHomeDir,
  );
  assert.equal(
    result.exitCode,
    0,
    `expected exit 0 for fast-forward via object path, got ${result.exitCode}: ${result.stderr.join("")}`,
  );
  const json = JSON.parse(result.stdout.join("")) as Record<string, unknown>;
  assert.equal(json["outcome"], "fast-forward", "outcome must be fast-forward");
  assert.equal(json["canonicalSHA"], FF_SHA, "canonicalSHA must match FF_SHA");
});
