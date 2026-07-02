# Story 001 - Harness on 2A Bricks

Epic: `.agent/plan/epics/019-phase2a-single-repo-proof.md`

## Goal

The Phase-1 harness scenarios run green with the 2A bricks swapped in, and the
three 2A security scenarios run end-to-end hermetically — proving the brick
swaps kept the seams and the new enforcement composes through the whole system.

## Acceptance Criteria

- The Epic 010 golden scenario passes with: the real git-backed store (Epic 012),
  `git.*` verbs against a temp bare remote (Epic 014), `github.create_pr` against
  its double, and the pi session adapter on the SU3 fake (Epic 016) — fake clock
  and fault injection retained (phases.md 2B criterion "harness green on real
  components" starts holding at the 2A subset here).
- Scenario `2a-out-of-scope-write`: a scripted session attempts an out-of-scope
  write → blocked, escalated, inbox item appears, task waits; a `resume` response
  continues it (Epics 015+017 composed).
- Scenario `2a-budget-breach`: scripted call costs cross the ceiling → halt
  before the breaching call, escalation captured with cost attribution, respawn
  does not reset (Epics 013+016+017 composed).
- Scenario `2a-kill-mid-create-pr`: daemon killed between submit and completion
  → restart reconciles via head-branch lookup on the double, no second create
  request in the double's log, op terminal (Epics 009+014 composed).
- Zero network + zero credentials in the whole run (the Epic 010 guard stays
  active over the new scenarios).

## Constraints

- Harness code arranges fixtures and injects faults only — no duplicated
  production logic (Epic 010 anti-reimplementation rule). **The
  reviewer-engineer pass must explicitly confirm** the scenario code invokes
  public seams only and contains no local copies of enforcement/reconciliation
  logic (debate finding — the rule needs a checker, not just a statement).
- New scenarios are named files under the harness suite, one scenario per name
  above (phases.md — gate criteria are named scenarios).
- The broker **debug hold-point** (T3) is production diagnostic config: gated by
  an explicit config flag, default off, holding an op at a named cutpoint
  (pre-submit / pre-completion); it exists for the Epic 019 LP4 live proof and
  fault-injection — it must not alter any semantics when off.

## Verification Gate

- `npm test` green including the new scenario files; `npm run typecheck` exits 0
  (debate finding — the story gate now states what the task Verify lines
  require).

### Task T1 - Golden scenario on 2A bricks

**Input:** `src/harness/scenarios/2a-golden.test.ts`, `src/harness/**` (fixture
arrangement only)

**Action - RED:** Write the golden scenario wiring the 2A bricks (real store on
a temp git root, git verbs on a temp bare remote, github double, pi fake) and
assert the Phase-1 end-to-end outcome fields.

**Action - GREEN:** Fix composition/wiring gaps the scenario exposes in the
bricks' own modules (each fix in its owning module, not in harness code).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - The three 2A security scenarios

**Input:** `src/harness/scenarios/2a-out-of-scope-write.test.ts`,
`src/harness/scenarios/2a-budget-breach.test.ts`,
`src/harness/scenarios/2a-kill-mid-create-pr.test.ts`, `src/harness/**`

**Action - RED:** Write the three named scenarios per the Story ACs.

**Action - GREEN:** Fix exposed composition gaps in owning modules.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T3 - Broker debug hold-point

**Input:** `src/broker/hold-point.ts`, `src/broker/hold-point.test.ts`

**Action - RED:** Write tests: (a) with the hold flag set for a verb at
`pre-submit`, a submitted op stays held (ledger written, adapter not called)
until released; (b) at `pre-completion`, the op holds after submit; (c) with the
flag off (default), behavior is byte-identical to a run without the feature
(asserted on the op timeline).

**Action - GREEN:** Implement the config-gated hold-point at the two named
cutpoints in the broker lifecycle.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
