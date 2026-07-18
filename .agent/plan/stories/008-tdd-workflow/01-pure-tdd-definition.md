# Story 01 — Pure tdd@1 definition (domain)

Epic: `.agent/plan/epics/008-tdd-workflow.md`

## Goal

`src/domain/tdd.ts` exists: zero-I/O typed contracts + the transition
function for the tdd@1 cycle (epic story "Pure tdd@1 definition (domain)").
Given the previous step and its engine-reported outcome, `nextTddStep` returns
the next step or a terminal — RED → GREEN → CONFIRM (loop while the TE opens
further REDs) → REVIEW → route `action:"yes"` findings back exactly once per
review cycle, bounded review cycles, per-step attempt limit. All terminal
outcomes are enumerated as data; hermetically tested state-by-state.

## Scope guard (why this is authorable before the resolution round)

- Terminals are DATA. The definition never says "park", "approve", or
  "escalate" — mapping terminals to the EPIC 006 human gate is the (gated)
  executor story and waits on D-B.
- D-D (where `task.verification` runs) is engine/executor territory. If its
  ruling adds a step kind, `TDD_STEP_KINDS` is append-only — noted below.
- No lane semantics, no commands, no ledger, no events — outcomes arrive as
  typed input; PRODUCING them is the engine's (gated) job.

## Locked contracts (exact names — tests assert these verbatim)

```ts
export const TDD_EXECUTOR_REF = "tdd@1";
export const TDD_ROLES = [
  "test-engineer@1",
  "software-engineer@1",
  "reviewer-engineer@1",
] as const;
export type TddRole = (typeof TDD_ROLES)[number];
// Append-only: a D-D ruling may add a kind; existing literals never change.
export const TDD_STEP_KINDS = ["RED", "GREEN", "CONFIRM", "REVIEW"] as const;
export type TddStepKind = (typeof TDD_STEP_KINDS)[number];

export interface TddStep {
  seq: number; // 1-based, strictly increasing across NEW steps
  kind: TddStepKind;
  role: TddRole;
  reviewCycle: number; // 1-based
  attempt: number; // 1-based; retries keep seq and increment attempt
}

export interface ReviewFinding {
  severity: "blocker" | "suggestion";
  action: "yes" | "no";
  file: string;
  note: string;
  source: string; // cites the task/spec/loaded repo instruction that created
  // the requirement (S2 — makes project aspects enforceable without an aspect
  // taxonomy). Carried data; the transition never branches on it.
}
export interface ReviewFindings {
  verdict: "accepted" | "rejected";
  findings: ReviewFinding[];
}

export type TddStepOutcome =
  | { status: "succeeded"; kind: "RED" }
  | { status: "succeeded"; kind: "GREEN" }
  | { status: "succeeded"; kind: "CONFIRM"; next: "red" | "review" }
  | { status: "succeeded"; kind: "REVIEW"; review: ReviewFindings }
  | { status: "failed"; kind: TddStepKind; reason: string };

export interface TddConfig {
  maxReviewCycles: number;
  maxStepAttempts: number;
}
export const TDD_DEFAULTS: TddConfig = {
  maxReviewCycles: 2,
  maxStepAttempts: 3,
};

export type TddTerminal =
  | { reason: "review-complete"; review: ReviewFindings; reviewCycles: number }
  | {
      reason: "review-cycles-exhausted";
      review: ReviewFindings;
      unresolved: ReviewFinding[];
    }
  | { reason: "step-attempt-limit"; step: TddStep; failure: string };

export type TddDecision =
  | { kind: "step"; step: TddStep; blockerInput?: ReviewFinding[] }
  | { kind: "terminal"; terminal: TddTerminal };

export class IllegalTddOutcomeError extends Error {} // outcome.kind ≠ prev.step.kind

export function nextTddStep(
  prev: { step: TddStep; outcome: TddStepOutcome } | undefined,
  config?: TddConfig, // default TDD_DEFAULTS
): TddDecision;
```

## Transition table (locked; tests cover every row)

- `undefined` (start) → step `{ seq: 1, kind: "RED", role:
"test-engineer@1", reviewCycle: 1, attempt: 1 }`.
- RED succeeded → GREEN `software-engineer@1`, seq+1, same reviewCycle,
  attempt 1.
- GREEN succeeded → CONFIRM `test-engineer@1`, seq+1.
- CONFIRM succeeded `next:"red"` → RED `test-engineer@1`, seq+1, same
  reviewCycle (the TE opens the next failing test within the task's ACs).
- CONFIRM succeeded `next:"review"` → REVIEW `reviewer-engineer@1`, seq+1.
- REVIEW succeeded, zero `action:"yes"` findings → terminal
  `review-complete` carrying the full `review` (verdict is carried data for
  the human gate; the machine branches on `action:"yes"` findings ONLY, per
  the epic's routing rule — a `verdict:"rejected"` with no actionable
  finding still ends `review-complete`).
- REVIEW succeeded, ≥1 `action:"yes"` finding, `reviewCycle <
maxReviewCycles` → RED `test-engineer@1`, seq+1, reviewCycle+1,
  `blockerInput` = exactly the `action:"yes"` findings, order preserved
  (route exactly once per cycle — the increment IS the once-guard).
- REVIEW succeeded, ≥1 `action:"yes"` finding, cycles exhausted → terminal
  `review-cycles-exhausted` with `unresolved` = those findings.
- any `failed` with `attempt < maxStepAttempts` → SAME step (same
  seq/kind/role/reviewCycle), attempt+1.
- any `failed` with `attempt >= maxStepAttempts` → terminal
  `step-attempt-limit` `{ step: prev.step, failure: outcome.reason }`.
- `outcome.kind !== prev.step.kind` → throw `IllegalTddOutcomeError`.

## Constraints

- `src/domain/tdd.ts` imports nothing outside `src/domain/`
  (eslint boundaries enforce this); zero I/O, no Date/random/env.
- Pure: same input → same output; never mutates `prev`.
- Follow `src/domain/task.ts` idioms (const array + derived union type,
  named Error classes).
- No executor, no persistence, no events — those are gated sibling stories.

## Verification Gate

- `node --test src/domain/tdd.test.ts` green; `npm run typecheck`
  exit 0; `npm run lint` clean (boundaries).

### Task T1 — contracts + happy path

**Requires:** nothing beyond `src/domain/` (EPIC 002 conventions).

**Input:** new `src/domain/tdd.ts`, new `src/domain/tdd.test.ts`.

**Action — RED:** tests: (a) `nextTddStep(undefined)` returns the seq-1 RED
step literal from the table; (b) the chain RED → GREEN → CONFIRM(`next:
"red"`) → RED → GREEN → CONFIRM(`next:"review"`) → REVIEW walks with seq
1..7 strictly increasing, roles per table, reviewCycle constant 1;
(c) REVIEW succeeded with one `action:"no"` suggestion and zero
`action:"yes"` findings → terminal `review-complete`, `reviewCycles: 1`,
`review` carried verbatim. Fails today: module absent.

**Action — GREEN:** implement the locked contracts + succeeded-path
transitions.

**Action — REFACTOR:** none.

**Output:** contracts compile as locked; happy path decided correctly.

**Verify:** `node --test src/domain/tdd.test.ts` green; typecheck 0.

### Task T2 — review routing + bounded cycles

**Requires:** T1.

**Input:** same files.

**Action — RED:** tests: (a) REVIEW with two `action:"yes"` + one
`action:"no"` findings at reviewCycle 1 → decision step RED
`test-engineer@1`, reviewCycle 2, `blockerInput` deep-equals exactly the two
`action:"yes"` findings in order; (b) the same outcome at reviewCycle 2
(= default `maxReviewCycles`) → terminal `review-cycles-exhausted`,
`unresolved` = the `action:"yes"` findings, `review` carried; (c) config
`{ maxReviewCycles: 3, maxStepAttempts: 3 }` routes again at cycle 2;
(d) `verdict:"rejected"` with zero `action:"yes"` findings → terminal
`review-complete` whose `review.verdict === "rejected"` (verdict carried,
never branched on).

**Action — GREEN:** routing + bounds.

**Action — REFACTOR:** none.

**Output:** once-per-cycle routing and both review terminals proven.

**Verify:** suite green; typecheck 0.

### Task T3 — failure/attempt semantics + misuse guard

**Requires:** T1.

**Input:** same files.

**Action — RED:** tests: (a) GREEN `failed` at attempt 1 → SAME step
(seq/kind/role/reviewCycle unchanged), attempt 2 — spot-check the same rule
on RED and REVIEW; (b) `failed` at attempt 3 (default) → terminal
`step-attempt-limit` with `failure` = the outcome reason and `step` =
`prev.step`; (c) config `{ maxStepAttempts: 1, maxReviewCycles: 2 }` →
immediate terminal on first failure; (d) `outcome.kind` ≠ `prev.step.kind`
→ throws `IllegalTddOutcomeError`; (e) `TDD_DEFAULTS` deep-equals
`{ maxReviewCycles: 2, maxStepAttempts: 3 }`; (f) purity: the same input
twice returns deep-equal decisions and `prev` is not mutated.

**Action — GREEN:** retry/terminal branches + the guard.

**Action — REFACTOR:** none.

**Output:** all terminals enumerated and reachable; misuse throws named
error.

**Verify:** suite green; typecheck 0; lint clean.
