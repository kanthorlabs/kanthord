# 010 Harness Scenario Suite & Phase-1 Gate

## Outcome

The deterministic lifecycle harness assembled from the seams built in Epics 001–009
(fake clock, fake broker modeling success/failure/timeout/regression, temp SQLite,
temp git repo, crash/restart entrypoint) and driven through the **named scenario
tests** that constitute the Phase-1 gate: the golden `tdd@1` feature end-to-end on
fakes, lease expiry + heartbeat timeout, crash/restart with ledger reconciliation,
compaction respawn (respawn-equivalence), dirty-plan recompile with generation
pinning, phase-boundary source hash drift, invalid-plan rejection with
planner-vocabulary diagnostics, and rebuild-SQLite-from-markdown projection equality —
all with **zero network access** enforced in the test run. This Epic is the proof that
the deterministic surface works end-to-end; passing it **is** the gate to Phase 2.

## Decision Anchors

- PRD §7.7 — a small deterministic lifecycle harness is a hard requirement (fake
  clock, fake broker, temp SQLite, temp git, crash/restart entrypoint) with mandated
  scenario tests: lease expiry + heartbeat timeout; crash recovery + broker
  reconciliation; compaction respawn; phase-boundary hash drift. Respawn-equivalence
  asserted field-by-field. Clock + broker injectable from day one. (Property tests over
  interleavings are **later hardening**, Phase 3 — not here.)
- PRD §6.3 — clone-on-sign-off + drift detection: re-hash the source at every workflow
  **phase boundary**; on drift signal the human and keep working unless halted.
- phases.md Phase 1 Deliverable 8 + Success criteria — the golden scenario end-to-end;
  kill-and-restart respawn-equivalence field-by-field; invalid plan set rejected with
  planner-vocabulary diagnostics (asserted text); rebuild == markdown-derived
  projection; **all with zero network access enforced in the test runner**.
- phases.md guiding rule — one golden scenario carries across all phases; in Phase 1
  it runs on fakes.

## Stories

- `001-harness-kit-and-golden-scenario.md` — assemble the harness kit (fakes + temp
  fixtures + crash entrypoint) and run the golden `tdd@1` feature end-to-end; enforce
  no-network in the run.
- `002-lifecycle-scenarios.md` — lease expiry + heartbeat timeout; crash/restart +
  ledger reconciliation; compaction respawn (respawn-equivalence); dirty-plan
  recompile + generation pinning.
- `003-lint-and-projection-scenarios.md` — invalid-plan set rejected with asserted
  planner-vocabulary diagnostics; rebuild-from-markdown projection equality.
- `004-phase-boundary-drift.md` — the source hash-drift detection mechanism (§6.3) and
  its phase-boundary scenario: drift signalled at a phase boundary, work continues.

## Verification Gate (this Epic = the Phase-1 gate)

- `npm run typecheck` exits 0; `npm test` green for the whole suite.
- **Golden scenario:** sign-off compile → DAG-ordered dispatch respecting leases →
  artifact handoff gate → TDD gate pair → fake deploy chain with soak → feature
  complete, fully deterministic on the fake clock.
- **Respawn-equivalence:** kill-and-restart at any scenario step reproduces the
  pending-task set, lease ownership, phase, and injected STATE, asserted
  field-by-field (PRD §7.7).
- **Invalid plan:** a set with a cycle, forward handoff, overlapping lanes, missing
  ticket ref, and missing body section is rejected, each with the expected
  planner-vocabulary diagnostic text.
- **Projection:** rebuilding SQLite from markdown yields the same markdown-derived
  projection (per the Epic 003 contract).
- **No network / no credentials:** every gate test runs under a **first-installed
  suite-level guard** (installed before the SUT is imported) that blocks and fails on
  any use of Node's network primitives — `net`, `tls`, `dns`, `dgram`, `http`,
  `https`, `http2`, global `fetch`/Undici — **and** on access to credential-shaped env
  vars / provider-credential file paths (gap S1; phases.md "no LLM calls, no network,
  no external credentials anywhere"). Honestly "suite-level guard", not "runner-level"
  (S2), since scripts/package.json are lane-locked.
- **Kill/restart respawn-equivalence** (distinct from compaction respawn) and
  **fake-broker failure / timeout / regression** injection each have their own named
  scenario (debate finding — these are separately mandated and were under-named).

## Dependencies

- **All of Epics 001–009** — this Epic **composes** them and introduces **no new
  production mechanism** (debate finding). The §6.3 drift mechanism was moved to its
  proper homes: clone-on-sign-off snapshot → Epic 002 Story 005; phase-boundary
  re-hash/signal hook → Epic 006 Story 004. Epic 010 Story 004 runs only the scenario.
- Harness code (`src/harness/**`) may **arrange fixtures and inject faults** only; it
  must **not** duplicate scheduling, leasing, reconciliation, workflow transitions,
  compaction, projection, linting, artifact-handoff, or deploy-chain logic — those are
  driven through the Epics 001–009 public seams (debate finding — anti-reimplementation).

## Non-Goals

- No **property tests** over DAG + lease interleavings — that is Phase 3 "later
  hardening" (PRD §7.7); this Epic ships the named scenarios only.
- No **real** components (agents, verbs, network, S3, fff, web client) — Phase 2.
- No **ticket-drift handling depth** — Story `004` proves detection + signal at a
  phase boundary; the full re-plan/handling flow is Phase 3 (phases.md).

## Decision notes (from the Phase-1 comparison debate)

- **S2 — zero-network enforcement is suite-level, not runner-level.** phases.md says
  "enforced in the test runner"; because `scripts/`/`package.json` are lane-forbidden
  to engineers, enforcement is a first-installed suite-level guard imported first by
  every gate test. Accepted deviation, recorded so it is not mistaken for the literal
  wording.
- **S3 — CI execution of the gate is a maintainer prerequisite** (CI config is
  toolchain, lane-forbidden), tracked as **Epic 000 SU5**. Story-level proof is
  `npm test` green + guarded; wiring that into CI is the SU5 gate step.

## Findings Out

- none. This Epic is the capstone; its green suite is the Phase-1→Phase-2 gate
  artifact.
