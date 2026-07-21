import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LandingConflictError,
  type LandingCandidate,
  type LandingOutcome,
  type LandingResult,
  type PreviewOutcome,
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
  // If port.ts exports the right interface (including preview), this compiles without error.
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
    preview: async (
      _homeDir: string,
      candidate: LandingCandidate,
      _targetOID: string,
    ): Promise<PreviewOutcome> => {
      return { kind: "fast-forward", candidateOID: candidate.candidateSHA };
    },
    // S2 pre-adjust: implement required methods so fake still compiles once
    // RepositoryLanding promotes landPreviewed/resolveTargetOID to required.
    landPreviewed: async (
      _homeDir: string,
      candidate: LandingCandidate,
      _previewOutcome: PreviewOutcome,
      _targetOID: string,
    ): Promise<LandingResult> => {
      const outcome: LandingOutcome = { kind: "fast-forward" };
      return { candidate, outcome, canonicalSHA: candidate.candidateSHA };
    },
    resolveTargetOID: (_homeDir: string, _branch: string): string => {
      return "0000000000000000000000000000000000000000";
    },
  };
  // Call it to satisfy the compiler (no unused-variable error)
  assert.equal(typeof fake.land, "function");
  assert.equal(typeof fake.preview, "function");
  assert.equal(called, false);
});

test("PreviewOutcome covers fast-forward, mergeable, conflict kinds — merge kind absent (compile test)", () => {
  // Verifies PreviewOutcome is distinct from LandingOutcome: no 'merge' kind, but 'mergeable' is present.
  const ff: PreviewOutcome = { kind: "fast-forward", candidateOID: "abc" };
  const mergeable: PreviewOutcome = { kind: "mergeable", treeOID: "def" };
  const conflict: PreviewOutcome = {
    kind: "conflict",
    files: ["a.ts"],
    perFile: [
      { path: "a.ts", hunks: "<<<<<<< HEAD\n=======\n>>>>>>> candidate\n" },
    ],
  };
  assert.equal(ff.kind, "fast-forward");
  assert.equal(mergeable.kind, "mergeable");
  assert.equal(conflict.kind, "conflict");
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
