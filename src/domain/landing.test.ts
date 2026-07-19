import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newChangeCandidate,
  type Acceptance,
  type Integration,
  type LandedChange,
} from "./landing.ts";

// Suite: src/domain/landing.ts

const BASE_INPUT = {
  taskId: "task-1",
  repoId: "repo-1",
  baseSHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  candidateSHA: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ref: "kanthord/task-1",
  target: "main",
};

test("newChangeCandidate returns a ChangeCandidate with state: pending and all supplied fields", () => {
  const candidate = newChangeCandidate({ id: "cand-1", ...BASE_INPUT });
  assert.equal(candidate.id, "cand-1");
  assert.equal(candidate.taskId, "task-1");
  assert.equal(candidate.repoId, "repo-1");
  assert.equal(candidate.baseSHA, BASE_INPUT.baseSHA);
  assert.equal(candidate.candidateSHA, BASE_INPUT.candidateSHA);
  assert.equal(candidate.ref, "kanthord/task-1");
  assert.equal(candidate.target, "main");
  assert.equal(candidate.state, "pending");
});

test("newChangeCandidate returns a fresh value (input not mutated)", () => {
  const input = { id: "cand-2", ...BASE_INPUT };
  const candidate = newChangeCandidate(input);
  // mutate the return value — input object must be unaffected
  (candidate as Record<string, unknown>)["state"] = "landed";
  assert.equal((input as Record<string, unknown>)["state"], undefined);
});

test("Acceptance, Integration, LandedChange types are importable without error (compile test)", () => {
  // These are compile-only checks — if the types are importable, the test passes.
  const acceptance: Acceptance = {
    candidateId: "cand-1",
    approvedBy: "human",
    approvedAt: new Date().toISOString(),
  };
  const integration: Integration = {
    candidateId: "cand-1",
    outcome: "fast-forward",
    canonicalSHA: "cccccccccccccccccccccccccccccccccccccccc",
  };
  const landedChange: LandedChange = {
    candidateId: "cand-1",
    canonicalSHA: "cccccccccccccccccccccccccccccccccccccccc",
    landedAt: new Date().toISOString(),
  };
  assert.ok(acceptance.candidateId);
  assert.ok(integration.outcome);
  assert.ok(landedChange.landedAt);
});
