# Story 3 — the decision-occurrence guard shared by all four verdict routes

Epic: `.agent/plan/epics/026.9-candidate-review.md`
Depends on: EPIC 026.8 Story 2 (`DecisionOccurrenceRepository`, `DecisionOccurrenceRow`).

026.8 defines **no** "is this occurrence open" predicate. It gives
`DecisionOccurrenceRepository.get(id): DecisionOccurrenceRow | undefined`,
which returns a row in any state. This story adds the predicate once, in the
app layer, and every verdict route uses it.

## Change

### 1. New app module `src/app/project/assert-decision-open.ts`

```ts
export interface DecisionOpenSource {
  get(id: string):
    | {
        readonly id: string;
        readonly state: "open" | "resolved" | "expired";
        readonly subjectType: "task" | "objective" | "initiative";
        readonly subjectId: string;
      }
    | undefined;
}

export class DecisionClosedError extends Error {
  readonly decisionId: string;
  /** `"unknown"` when the server never issued the id. */
  readonly state: "unknown" | "resolved" | "expired";
  constructor(decisionId: string, state: "unknown" | "resolved" | "expired") {
    super(`decision ${decisionId} is ${state}`);
    this.name = "DecisionClosedError";
    this.decisionId = decisionId;
    this.state = state;
  }
}

export class DecisionSubjectMismatchError extends Error {
  readonly decisionId: string;
  readonly expected: string;
  readonly actual: string;
  constructor(decisionId: string, expected: string, actual: string) {
    super(`decision ${decisionId} is about ${actual}, not ${expected}`);
    this.name = "DecisionSubjectMismatchError";
    this.decisionId = decisionId;
    this.expected = expected;
    this.actual = actual;
  }
}

export class AssertDecisionOpen {
  constructor(source: DecisionOpenSource) {}
  /** Throws unless `decisionId` is an OPEN occurrence whose subject is exactly `subject`. */
  execute(input: {
    decisionId: string;
    subject: { type: "task" | "objective"; id: string };
  }): void;
}
```

Pinned rules, evaluated in this order:

1. `source.get(decisionId)` is `undefined` → `throw new DecisionClosedError(decisionId, "unknown")`.
   An id the server never issued and an id that closed are the **same answer** to
   the caller — the client must refetch either way, and distinguishing them
   would let a caller probe which ids exist.
2. `row.state !== "open"` → `throw new DecisionClosedError(decisionId, row.state)`.
3. `row.subjectType !== subject.type || row.subjectId !== subject.id` →
   `throw new DecisionSubjectMismatchError(decisionId, \`${subject.type}:${subject.id}\`, \`${row.subjectType}:${row.subjectId}\`)`.
   Without this a caller could approve task B while holding task A's open
   occurrence id.
4. Otherwise return `void`.

`execute` is synchronous and reads only. It appends no event, opens no
transaction, and never reconciles — reconciliation is 026.8's
`ReconcileDecisions`, driven by the queue reads, and a verdict must not
recompute the whole projection to answer one question.

### 2. Wiring — `src/composition.ts`

Construct once, immediately after 026.8's `decisionOccurrenceRepository`
(built eagerly beside `:252`), and before the verdict use cases:

```ts
const assertDecisionOpen = new AssertDecisionOpen({
  get: (id) => decisionOccurrenceRepository.get(id),
});
```

Expose `assertDecisionOpen` on the deps bundle beside `getDecision`.

## Constraints

- Do not add a method to `DecisionOccurrenceRepository`; `get` is enough.
- Do not import this from `ApproveTask`, `RejectTask`, `ApproveObjective` or
  `RejectObjective`. The guard is applied by the **route** (Story 7), so the CLI
  keeps working with no occurrence — epic decision 7.
- No use case calls another use case.

## Verify

- `node --test src/app/project/assert-decision-open.test.ts` — a fake source:
  an unknown id throws `DecisionClosedError` with `state === "unknown"`; a
  `resolved` row throws with `state === "resolved"`; an `expired` row throws
  with `state === "expired"`; a row whose `subjectType` differs throws
  `DecisionSubjectMismatchError`; a row whose `subjectId` differs throws the
  same; a matching open row returns `undefined` and the source was called
  exactly once. Assert the checks fire in the pinned order: a **closed row with
  a mismatched subject** throws `DecisionClosedError`, not the mismatch error.
- `npm run verify` exits 0.
- Proof: phase D (`an unknown decision occurrence is refused with 409`, `...and
names the reason`, `the objective still did not move`).
