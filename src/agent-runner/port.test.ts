import { test } from "node:test";
import assert from "node:assert/strict";
import type { TaskResult } from "./port.ts";

// (F3 T1) The `candidate` outcome is an executor-neutral arm of TaskResult
// carrying the landing metadata. This is a type-level contract test: it fails
// to *type-check* when `"candidate"` is not an allowed `outcome`, and the
// candidate-only fields are not exposed by the union narrowing.
//
// The value is built through `makeCandidate()`, annotated to return the full
// `TaskResult` union (NOT an inferred literal). Writing
// `const candidate: TaskResult = { outcome: "candidate", … }` makes TS
// const-narrow `candidate.outcome` to the single `"candidate"` arm, which then
// makes the remaining `case` labels `TS2678` (not comparable). Returning the
// union from a helper preserves `candidate.outcome` as the full discriminant so
// the switch below is a valid runtime narrowing.
//
// NOTE: `assert.equal` in `node:assert/strict` is `strictEqual`, whose signature
// is `asserts actual is T` — a type guard. Asserting `candidate.outcome` against
// `"candidate"` *before* the switch would re-introduce the collapse, so the
// discriminant is only asserted inside the `case "candidate"` arm below.
function makeCandidate(): TaskResult {
  return {
    outcome: "candidate",
    workspace: "/w/run",
    branch: "kanthord/t1",
    baseCommit: "baseSHA",
    candidateCommit: "proposalSHA",
    summary: "changed work ready to land",
  };
}

test("(F3 T1) candidate arm: required fields are typed and present", () => {
  const candidate = makeCandidate();

  // switch-narrow test: only the candidate arm exposes the landing fields.
  switch (candidate.outcome) {
    case "completed":
      assert.fail("expected candidate, got completed");
      break;
    case "failed":
      assert.fail("expected candidate, got failed");
      break;
    case "escalated":
      assert.fail("expected candidate, got escalated");
      break;
    case "candidate":
      assert.equal(candidate.outcome, "candidate");
      assert.equal(candidate.workspace, "/w/run");
      assert.equal(candidate.branch, "kanthord/t1");
      assert.equal(candidate.baseCommit, "baseSHA");
      assert.equal(candidate.candidateCommit, "proposalSHA");
      assert.equal(candidate.summary, "changed work ready to land");
      break;
  }
});
