# Story 002 - Property Suites

Epic: `.agent/plan/epics/039-property-test-hardening.md`

## Goal

Seeded random interleavings drive the model and the real scheduler in
lockstep: the real system must match the model and never break an invariant —
and every failure is a printed seed away from reproduction.

## Acceptance Criteria

- A seeded generator (per the Epic 031 SU4 tooling decision) produces
  operation interleavings over the Story 001 vocabulary; each operation is
  applied to the model **and**, through the Epic 010 harness seams (fake
  clock, temp SQLite), to the real scheduler components.
- After every operation, the real system's observable state (task states,
  lease table, generations) is mapped by an explicit **projection with
  documented canonicalization rules** — sets compared order-insensitively,
  clock values normalized to the fake clock, the authoritative persisted
  rows named, and a real state the model cannot represent is a projection
  **failure**, never silently normalized (debate finding — the projection is
  the oracle boundary: too loose and properties pass vacuously, too strict
  and legitimate in-poll ordering flakes) — and must equal the model state,
  with all Story 001 invariant predicates holding on the projection; first
  mismatch fails with the seed, the step index, and the shrunk operation
  sequence in the output.
- CI determinism: the suite runs a documented fixed seed list; two
  consecutive runs of the suite produce identical results (asserted by a
  double-run test). The time-seeded run is a **non-gating local mode** (env
  opt-in, prints its seed) and is excluded from CI (debate finding — a
  time-seeded gate contradicts the no-flake stance).
- Re-running the suite with a printed seed (env var or CLI arg per the SU4
  findings) reproduces the identical sequence and outcome (asserted).
- **Four planted faults** — test-only injected scheduler bugs, one per
  invariant family: skip the lease-conflict check; dispatch ignoring an
  unmet dependency/gate; run a task under a non-pinned generation; park
  without releasing a lease — each caught by the suite within the fixed seed
  list (debate finding — one fault proves one property bites, not the
  suite).
- The keep/park continuation transition (Epic 037) participates in the
  interleavings via the injected affected-verdict operation.

## Constraints

- The suite drives real dispatch/lease code through public seams only — a
  scheduler reimplementation inside the suite is a review blocker (Epic 010
  anti-reimplementation rule; Epic 039 gate).
- Tooling per the SU4 decision file — no ad-hoc second generator.
- No flake budget: a fixed-seed failure is a failure (Epic 039 Non-Goals).

## Verification Gate

- `npm test` green for `src/harness/properties.test.ts` on the fixed seed
  list; `npm run typecheck` exits 0.

### Task T1 - Lockstep runner + projection

**Input:** `src/harness/properties.ts`, `src/scheduler/fault-injection.ts`
(test-only fault hooks — debate finding: the planted faults need a named
home in the Input), `src/harness/properties.test.ts`

**Action - RED:** Write tests: (a) a short fixed-seed interleaving runs model
and real system in lockstep with canonical-projection equality at every
step; (b) the projection's canonicalization rules pinned by hand-built cases,
including an unrepresentable real state failing loudly; (c) each of the four
planted-fault flags makes the suite fail with seed + step + sequence in the
message.

**Action - GREEN:** Implement the generator wiring, the canonical projection,
the fault hooks, and the lockstep runner over the harness seams.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Seeds, determinism, reproduction

**Input:** `src/harness/properties.ts`, `src/harness/properties.test.ts`

**Action - RED:** Write tests: (a) the fixed seed list runs green and a
double-run yields identical results; (b) the time-seeded mode is opt-in,
non-gating, and prints its seed; (c) re-running with a captured seed
reproduces the identical sequence.

**Action - GREEN:** Implement the seed-list configuration and the
reproduction entry path per the SU4 findings.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
