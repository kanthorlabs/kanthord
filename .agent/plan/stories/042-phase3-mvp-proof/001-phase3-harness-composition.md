# Story 001 - Phase-3 Harness Composition

Epic: `.agent/plan/epics/042-phase3-mvp-proof.md`

## Goal

The whole suite — Phases 1, 2, and 3 — is green in one run, and the Phase-3
mechanics have their named scenarios composed in, including the hermetic twin
of the live chaos check.

## Acceptance Criteria

- One `npm test` run is green containing: the full Phase-1/2 suites, the
  named Phase-3 scenarios (`p3-replan-loop`, `p3-continuation-compat`, the
  Epic 036 boot-hook scenarios — self-repair, fatal-halt, non-blocking
  verify-failure — and the Epic 038 draft-ok rework case), and the Epic 039
  property suites on the fixed CI seed list — zero network (the Epic 010
  guard active over everything).
- New named scenario `p3-chaos-rehearsal` passes: one feature exercising
  replan + continuation + a draft_ok edge is killed and restarted at **every**
  step boundary of its scripted run (the Epic 010 crash/restart entrypoint
  iterated) **and at the intra-step external-operation windows** — via the
  Epic 019 broker debug hold-point cutpoints (between ledger write and
  adapter submit; between submit and completion) for each broker op the
  script performs (debate finding — the dangerous crash windows live inside
  steps, not only between them); after each restart, respawn-equivalence
  holds (pending set, lease ownership, phase, injected STATE — field-by-field
  per PRD §7.7) and the run completes **unattended** — zero human/inbox
  responses consumed after the initial sign-off, except the scripted
  approvals the plan itself requires, which are pre-queued fixtures.
- The rehearsal's kill-point list is enumerated in the test — a step added to
  the scripted feature without a kill-point, or a broker op without its
  hold-point kills, fails the suite (the coverage is self-checking).
- The suite report (test names) contains every scenario name promised by
  phases.md-mapped epics — a missing named scenario is a failure of this
  story, not a silent absence.

## Constraints

- Pure composition: existing suites and scenario modules are imported/run,
  never copied (Epic 010 anti-reimplementation rule; reviewer confirms no
  local mechanism code).
- Scenario names are load-bearing — Epic 042's Verification Gate and the LP
  evidence cite them.

## Verification Gate

- `npm test` green for the full composed suite including
  `src/harness/scenarios/p3-chaos-rehearsal.test.ts`;
  `npm run typecheck` exits 0.

### Task T1 - Composition + scenario-name manifest

**Input:** `src/harness/scenarios/p3-manifest.test.ts`

**Action - RED:** Write the manifest test asserting every promised scenario
name (Phase 1, 2A, 2B, and the Phase-3 list above) is present in the test
tree and runs in the suite.

**Action - GREEN:** Fix composition gaps in owning modules (never harness
code) until the manifest and full suite are green.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - `p3-chaos-rehearsal`

**Input:** `src/harness/scenarios/p3-chaos-rehearsal.test.ts`,
`src/harness/**` (fixture arrangement only)

**Action - RED:** Write the rehearsal: the scripted
replan+continuation+draft_ok feature, the enumerated kill-point list over its
step boundaries **plus the hold-point intra-step windows for each broker
op**, respawn-equivalence assertions after each restart, and the
unattended-completion assertion (only pre-queued scripted approvals
consumed).

**Action - GREEN:** Fix composition/wiring gaps the rehearsal exposes in the
owning modules (never in harness code).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
