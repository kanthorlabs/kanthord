# Story 001 - State Model

Epic: `.agent/plan/epics/039-property-test-hardening.md`

## Goal

A small, pure, falsifiable model of DAG dispatch + lease lifecycle — the
precondition PRD §7.7 sets before any property test may exist.

## Acceptance Criteria

- The model's **state vocabulary is complete for its own invariants** (debate
  finding — an invariant you cannot evaluate from the declared state is
  vacuous): a `now` clock value; the dependency graph; per-task capability
  requirements; per-task gate outcomes; pending/running/done/parked task
  sets; held leases as a **list of (capability, holder, expiry, last
  heartbeat)** entries — a representation that *can* express two holders of
  one capability, so the invariant is behavioral, not structural (debate
  finding); current generation and per-task pinned generation.
- Deterministic operations: dispatch-poll, acquire-lease, heartbeat,
  expire-lease, complete-task, park-task, crash-restart, recompile (keep/park
  per an injected affected-verdict). `crash-restart`'s semantics are field-
  explicit: durable fields (task sets, generations, gate outcomes) survive;
  volatile fields (held leases, in-poll ordering) reset per the documented
  durability table (debate finding — "crash" in a pure model must say what
  survives).
- The safety invariants are named predicates, each declared as a **state
  invariant** (holds on every state) or a **transition invariant** (holds on
  every (before, op, after) triple — debate finding: "done is terminal" is a
  transition property): (a) state — no capability has two holders; (b) state
  — a running task's dependencies are done and its entry gates passed;
  (c) state — no task runs under a generation other than its pinned one;
  (d) state — every held lease has a future expiry or a heartbeat within the
  window; (e) state — a parked task holds no lease; (f) transition — a done
  task never leaves done.
- Every operation has unit tests pinning its transition on hand-built
  states, including its no-op/refusal cases.
- **Falsifiability:** for every invariant there is a test that constructs an
  invalid state (or transition) directly — the representation permits it —
  and asserts the predicate trips.
- The model's operation and state vocabulary is documented in the module
  header as the projection target Story 002 maps real scheduler state onto.

## Constraints

- Pure and dependency-free by design (PRD §7.7 — a *small* state model; the
  point is reviewability); property tooling is not imported here.
- The invariant list is the load-bearing contract for Story 002 — changing it
  later is a plan change, not a refactor.

## Verification Gate

- `npm test` green for `src/harness/state-model.test.ts`;
  `npm run typecheck` exits 0.

### Task T1 - State + operations

**Input:** `src/harness/state-model.ts`, `src/harness/state-model.test.ts`

**Action - RED:** Write transition unit tests for every operation on
hand-built states, including refusal/no-op cases (e.g. acquiring a held
capability, dispatching with an unmet dependency).

**Action - GREEN:** Implement the pure state + operations.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Invariants + falsifiability

**Input:** `src/harness/state-model.ts`, `src/harness/state-model.test.ts`

**Action - RED:** Write the invariant predicates' tests: each holds on valid
sequences, and each trips on its deliberately broken transition (one
violation fixture per invariant).

**Action - GREEN:** Implement the named invariant predicates.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
