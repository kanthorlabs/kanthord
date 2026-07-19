import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LandingConflictError,
  type LandingCandidate,
  type LandingOutcome,
  type LandingResult,
  type RepositoryLanding,
} from "./port.ts";

// Suite: src/landing/port.ts

const CANDIDATE: LandingCandidate = {
  id: "cand-1",
  taskId: "task-1",
  repoId: "repo-1",
  baseSHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  candidateSHA: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ref: "kanthord/task-1",
  target: "main",
  workspace: "/tmp/fake-ws",
};

test("LandingConflictError has name === 'LandingConflictError' and .candidate set", () => {
  const err = new LandingConflictError(CANDIDATE, ["src/foo.ts"]);
  assert.equal(err.name, "LandingConflictError");
  assert.deepEqual(err.candidate, CANDIDATE);
  assert.deepEqual(err.conflictFiles, ["src/foo.ts"]);
  assert.ok(err instanceof Error);
});

test("LandingConflictError with empty conflictFiles array", () => {
  const err = new LandingConflictError(CANDIDATE, []);
  assert.deepEqual(err.conflictFiles, []);
});

test("FakeLanding implements RepositoryLanding (compile test — interface surface)", () => {
  // A hand-written fake that satisfies the RepositoryLanding interface.
  // If port.ts exports the right interface, this compiles without error.
  let called = false;
  const fake: RepositoryLanding = {
    land: async (
      homeDir: string,
      candidate: LandingCandidate,
    ): Promise<LandingResult> => {
      called = true;
      const outcome: LandingOutcome = { kind: "fast-forward" };
      return {
        candidate,
        outcome,
        canonicalSHA: candidate.candidateSHA,
      };
    },
  };
  // Call it to satisfy the compiler (no unused-variable error)
  assert.equal(typeof fake.land, "function");
  assert.equal(called, false);
});

test("LandingOutcome union covers all four kinds (compile test)", () => {
  const ff: LandingOutcome = { kind: "fast-forward" };
  const merge: LandingOutcome = { kind: "merge", mergeCommit: "abc" };
  const conflict: LandingOutcome = { kind: "conflict", files: ["a.ts"] };
  const alreadyLanded: LandingOutcome = {
    kind: "already-landed",
    canonicalSHA: "abc",
  };
  assert.equal(ff.kind, "fast-forward");
  assert.equal(merge.kind, "merge");
  assert.equal(conflict.kind, "conflict");
  assert.equal(alreadyLanded.kind, "already-landed");
});
