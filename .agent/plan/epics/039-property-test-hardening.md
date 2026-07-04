# 039 Property-Test Hardening

## Outcome

The PRD's "later hardening" arrives on schedule: a **small explicit state
model** of DAG dispatch + lease lifecycle (the precondition the PRD names —
property tests without it "become flaky"), and **property suites** that drive
seeded random operation interleavings against the model and the real
scheduler components side by side, asserting the safety invariants (no
overlapping capability leases, dispatch respects DAG order and gates, pinned
generations never mix, leases always heartbeat or expire) at every step.
Failures reproduce from a printed seed; CI runs a fixed seed set
deterministically.

## Decision Anchors

- phases.md Phase 3 Deliverable 4 — "property tests over DAG + lease
  interleavings on a small state model (PRD §7.7 'later hardening' arrives
  now)".
- PRD §7.7 — property tests are later hardening, **need a small state model
  first, or they become flaky**; the harness's injectable clock/broker seams
  are what make interleavings drivable.
- Epic 031 SU4 — the property tooling decision (fast-check vs hand-rolled
  seeded generators) and its determinism/shrinking spike; this Epic codes
  against that findings file.
- Epics 004/010 — the scheduler under test and the harness it runs on —
  composed, never duplicated (Epic 010's anti-reimplementation rule).

## Stories

- `001-state-model.md` — a pure, I/O-free model module: compact state
  (pending/running/done sets, held leases with expiry, generation, parked
  set) + operations (dispatch-poll, acquire/heartbeat/expire lease, complete,
  crash-restart, recompile) with the safety invariants as named predicates;
  the model's own unit tests pin each transition and each invariant violation.
- `002-property-suites.md` — seeded generators produce operation
  interleavings; each op applies to the model **and** to the real scheduler
  (harness, fake clock); after every op the real system's observable state
  projects onto the model state and must match, and all invariant predicates
  must hold; a violation report prints the seed + shrunk op sequence; CI runs
  the documented fixed seed list plus one time-seeded run whose seed is
  printed.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green including the property suites
  on the fixed CI seed list (deterministic — two consecutive runs produce
  identical results; asserted by the SU4 tooling contract); the time-seeded
  run is a local, non-gating mode, excluded from CI (debate finding — a
  time-seeded gate contradicts the no-flake stance).
- Each safety invariant has at least one model unit test constructing the
  invalid state or transition directly and proving the predicate trips — the
  model is falsifiable, not vacuous (debate finding — the representation
  must permit invalid states, and state vs transition invariants are
  declared as such).
- Four planted scheduler bugs (test-only injected faults, one per invariant
  family per the Story) are each caught by the property suite with the
  reproducing seed and the shrunk sequence in the failure output (debate
  finding — one fault proves too little).
- Re-running with a failure's printed seed reproduces the same failing
  sequence (the reproduction workflow from the SU4 findings, asserted).
- The property suites drive the **real** dispatch/lease code through the
  harness seams — no scheduler reimplementation inside the suite (Epic 010
  anti-reimplementation review check).

## Dependencies

- **Epic 031 SU4** (tooling decision + spike findings — the input contract).
- **Epic 004** (scheduler + leases under test), **Epic 010** (harness kit),
  **Epic 037** (generation continuation — its keep/park transition joins the
  modeled operation set).

## Non-Goals

- No property testing of broker adapters, store, or compiler — DAG + lease
  interleavings only (the PRD names exactly this surface).
- No performance/stress claims — the suites assert safety, not throughput.
- No flake budget: a nondeterministic property run on a fixed seed is a
  failure, not a retry.

## Findings Out

- none. The model's invariants and the seed workflow are documented in the
  model module and Story tests.
