# Story 003 - Attempt ledger and the ordered termination contract

Epic: `.agent/plan/epics/019.3-task-goal-loop.md`

## Goal

The loop terminates deterministically: a durable, respawn-proof attempt
ledger counts dispatched attempts, and one ordered decision routes every
outcome — goal reached, needs-human, attempts exhausted, budget, operator
halt — so a task can never retry forever and never retries past a
higher-ranking stop.

## Acceptance Criteria

- The attempt ledger increments by exactly one when an attempt is
  dispatched (debate finding 2026-07-10 — per-dispatch counting reads
  honestly for the operator: first-try pass shows 1, fail-fail-pass shows
  3); it does NOT increment on a lifecycle respawn mid-attempt (threshold /
  task-boundary / crash — Epic 006 triggers), which continues the same
  attempt.
- The ledger value survives a daemon restart (same stable task identity —
  the count continues, never resets; PRD §4 ledger discipline cited in the
  epic).
- When the exit gate fails and the ledger already reads the task's resolved
  `max_attempts`, the task parks and a typed `attempts-exhausted`
  escalation inbox item exists carrying the task id, the attempt count, and
  the latest evidence reference; NO further session spawns for that task on
  subsequent ticks.
- The item offers two distinct typed operator actions (debate finding
  2026-07-10 — "resume" alone is ambiguous): `retry-once` grants exactly
  one more attempt without re-arming (the next `fail` re-parks
  immediately); `re-arm` resets the counter to zero. Both go through the
  Epic 017 respond contract and each is recorded as an interaction,
  distinguishable in the record.
- **Precedence holds, and post-session facts are never lost** (debate
  finding 2026-07-10): the gate result, evidence, and ledger are recorded
  durably BEFORE any verdict is applied — a task parked for budget right
  after a gate fail still shows that fail's evidence. Budget and operator
  halt are enforced at the existing PRE-SPAWN gates: a task whose budget
  ceiling is already breached is parked before any retry spawn, regardless
  of remaining attempts; a task parked/halted by an operator is not
  re-dispatched by the retry path. Order: operator halt > budget >
  needs_human > attempts > retry.
- End-to-end: fake gate scripted fail-fail-pass with `max_attempts: 3`
  reaches `complete` in three attempts with ledger = 3; the same script
  with `max_attempts: 2` parks with the `attempts-exhausted` item and no
  third spawn.

## Constraints

- **Ledger next to the scheduler rows** — SQLite via the Epic 004 schema
  discipline (idempotent DDL); mirrors the budget-ledger durability rule
  (PRD §4 — a respawn cannot reset the breaker), cited in the epic anchors.
- **Two decision points, split by lifecycle** (debate finding 2026-07-10 —
  one merged function risked losing post-session facts): the POST-SESSION
  decision is a single pure function over (gate result, attempts, max, task
  status) that always records first and returns pass / needs-human /
  attempts-exhausted / retry-intent; the PRE-SPAWN gates (operator halt,
  budget — `makeBudgetBreaker`, Epic 019.2 wiring, unchanged) then decide
  whether a retry-intent actually spawns. The tick applies verdicts via
  existing seams (`setTaskStatus`, `createEscalationItem`,
  `markExitGatePassed`); no decision logic scattered across the tick.
- **Budget and halt are consumed, not re-built** — the existing pre-spawn
  enforcement is the enforcement; this story only asserts its precedence
  over retry.
- `retry-once` / `re-arm` go through the Epic 017 respond contract; each is
  recorded through the existing interaction capture (Epic 017), not a new
  record type.

## Verification Gate

- `npm test` green for the ledger + termination suites and the run-loop
  end-to-end cases; `npm run typecheck` exits 0; the Epic 006
  respawn-equivalence suite stays green unmodified.

### Task T1 - durable attempt ledger

**Input:** `src/scheduler/attempt-ledger.ts`,
`src/scheduler/attempt-ledger.test.ts`

**Action - RED:** tests: increment-on-dispatch returns 1, 2, 3 across
calls; the count reads back after a simulated restart (fresh store handle,
same file); a no-op read never increments; an explicit re-arm resets to 0
and returns the prior value (for the interaction record); a grant-one
(`retry-once`) marks exactly one extra attempt allowed without changing
the count.

**Action - GREEN:** implement the ledger module (increment, read, re-arm,
grant-one) with idempotent DDL.

**Action - REFACTOR:** none.

**Verify:** `node --test src/scheduler/attempt-ledger.test.ts` green.

### Task T2 - the termination decision function

**Input:** `src/scheduler/termination.ts`,
`src/scheduler/termination.test.ts`

**Action - RED:** table-driven tests over (gate result, attempts, max,
grant-one?, task status) asserting the post-session verdict for every
branch: `pass` → complete-path; `needs_human` → park+escalate; `fail`
under max (or with a grant-one) → retry-intent; `fail` at max →
park+`attempts-exhausted`; every branch records before deciding (the
recording call precedes the verdict in the observable call order). A
separate case asserts the pre-spawn path: a retry-intent with the budget
breached or the task operator-parked spawns nothing (precedence — the
existing pre-spawn gates outrank retry).

**Action - GREEN:** implement the pure post-session decision function
returning a typed verdict; the pre-spawn case wires the verdict through the
existing budget/halt gates.

**Action - REFACTOR:** none.

**Verify:** `node --test src/scheduler/termination.test.ts` green.

### Task T3 - run-loop applies the verdict end-to-end

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** the two end-to-end AC cases (fail-fail-pass completes
with ledger 3; `max_attempts: 2` parks with the typed item and no third
spawn), plus: a mid-attempt respawn case asserting the ledger did not
increment; a `retry-once`→fail case asserting immediate re-park with the
grant consumed; a `re-arm` case asserting the counter reads 0 and retries
proceed; and a budget-parked-after-fail case asserting that fail's
evidence is still recorded.

**Action - GREEN:** the tick calls the decision function after each gate
check and applies verdicts via the existing seams.

**Action - REFACTOR:** extract the Story 001 outcome-routing into the
decision-function call path so routing lives in one place (named cleanup).

**Verify:** `node --test src/daemon/run-loop.test.ts` green; full
`npm test` no regression.
