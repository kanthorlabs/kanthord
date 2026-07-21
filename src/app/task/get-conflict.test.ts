/**
 * S2 — GetConflict use case (conflict overview surface, honest labels)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { GetConflict, NoConflictCandidateError } from "./get-conflict.ts";
import type { ConflictOverview } from "./get-conflict.ts";
import type { ChangeCandidate } from "../../domain/landing.ts";
import type { LandingCandidate, PreviewOutcome } from "../../landing/port.ts";

// ---------------------------------------------------------------------------
// Fixed test IDs
// ---------------------------------------------------------------------------
const TASK_ID = "01JZZZZZZZZZZZZZZZZZZZSGTSK0";
const CAND_ID = "01JZZZZZZZZZZZZZZZZZZZSCANDD";
const REPO_ID = "01JZZZZZZZZZZZZZZZZZZZREPOID";
const TARGET_OID = "aaabbbcccdddeee0000000000000000000000001";
const CANDIDATE_OID = "fff111222333444555666777888999aaabbbccc0";
const HOME_DIR = "/fake/mirror/home";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const conflictCandidate: ChangeCandidate = {
  id: CAND_ID,
  taskId: TASK_ID,
  repoId: REPO_ID,
  baseSHA: "base000000000000000000000000000000000001",
  candidateSHA: CANDIDATE_OID,
  ref: `kanthord/${TASK_ID}`,
  target: "main",
  state: "conflict",
};

const conflictPreviewOutcome: PreviewOutcome = {
  kind: "conflict",
  files: ["src/todo.mjs"],
  perFile: [
    {
      path: "src/todo.mjs",
      hunks:
        "<<<<<<< target\napp.get('/tasks', ...)\n=======\napp.delete('/tasks/:id', ...)\n>>>>>>> candidate",
    },
  ],
};

// ---------------------------------------------------------------------------
// Minimal fakes
// ---------------------------------------------------------------------------

function makeCandidateRepo(candidate: ChangeCandidate | undefined) {
  return {
    getCandidateByTask(taskId: string): ChangeCandidate | undefined {
      return candidate?.taskId === taskId ? candidate : undefined;
    },
  };
}

function makeMockLanding(outcome: PreviewOutcome) {
  return {
    async preview(
      _homeDir: string,
      _candidate: LandingCandidate,
      _targetOID: string,
    ): Promise<PreviewOutcome> {
      return outcome;
    },
    async land(): Promise<never> {
      throw new Error("land must not be called by GetConflict");
    },
  };
}

const resolveHomeDir = (_repoId: string): string => HOME_DIR;
const resolveTargetOID = (_homeDir: string, _branch: string): string =>
  TARGET_OID;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("(S2-uc-conflict) execute({taskId}) returns ConflictOverview with files, hunks, targetOID, candidateOID", async () => {
  const uc = new GetConflict(
    makeCandidateRepo(conflictCandidate),
    makeMockLanding(conflictPreviewOutcome),
    resolveHomeDir,
    resolveTargetOID,
  );

  const overview: ConflictOverview = await uc.execute({ taskId: TASK_ID });

  assert.equal(
    overview.taskId,
    TASK_ID,
    "overview.taskId must match input taskId",
  );
  assert.equal(
    overview.branch,
    "main",
    "overview.branch must be the candidate target branch",
  );
  assert.equal(
    overview.targetOID,
    TARGET_OID,
    "overview.targetOID must be the resolved current target OID",
  );
  assert.equal(
    overview.candidateOID,
    CANDIDATE_OID,
    "overview.candidateOID must be the candidate SHA",
  );
  assert.ok(
    overview.files.length > 0,
    "overview.files must be non-empty for a conflict",
  );
  assert.equal(
    overview.files[0]?.path,
    "src/todo.mjs",
    "first conflict file path must match preview output",
  );
  assert.ok(
    overview.files[0]?.hunks.includes("<<<<<<<"),
    `hunks must contain <<<<<<< marker; got: ${overview.files[0]?.hunks}`,
  );
  assert.ok(
    overview.files[0]?.hunks.includes(">>>>>>>"),
    `hunks must contain >>>>>>> marker; got: ${overview.files[0]?.hunks}`,
  );
});

test("(S2-uc-no-candidate) execute({taskId}) with no conflict candidate throws NoConflictCandidateError", async () => {
  const uc = new GetConflict(
    makeCandidateRepo(undefined),
    makeMockLanding(conflictPreviewOutcome),
    resolveHomeDir,
    resolveTargetOID,
  );

  await assert.rejects(
    async () => uc.execute({ taskId: TASK_ID }),
    (err: unknown) => {
      assert.ok(
        err instanceof NoConflictCandidateError,
        `must throw NoConflictCandidateError; got: ${err instanceof Error ? err.constructor.name : typeof err}`,
      );
      return true;
    },
    "must throw a typed NoConflictCandidateError when no conflict candidate exists for the task",
  );
});
