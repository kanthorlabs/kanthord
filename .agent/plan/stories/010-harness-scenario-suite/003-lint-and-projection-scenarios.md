# Story 003 - Invalid-Plan & Projection Scenarios

Epic: `.agent/plan/epics/010-harness-scenario-suite.md`

## Goal

The two deterministic gate scenarios that need no lifecycle fault: a deliberately
invalid plan set is rejected with the expected planner-vocabulary diagnostics, and
rebuilding SQLite from markdown yields the same markdown-derived projection.

## Acceptance Criteria

- **Invalid plan — each violation is its own isolated named fixture** (cycle, forward
  handoff, overlapping lanes, missing ticket ref, missing required body section), each
  rejected by compile with its **expected diagnostic text** asserted string-for-string
  — because a single combined fixture can stop early and hide later diagnostics (debate
  finding). A combined "invalid set" fixture may exist **additionally**, but the
  isolated per-violation scenarios are the primary proof.
- Each invalid case is a **named** scenario mapping to one gate criterion (phases.md —
  named scenarios with observable pass/fail).
- **Projection equality:** compiling the golden feature and then
  `rebuildFromMarkdown` yields a shadow store whose markdown-derived projection equals
  the live store's projection field-by-field (per the Epic 003 contract), and a
  mutated runtime-only field does not cause a divergence (phases.md gate; Epic 003).

## Constraints

- Diagnostic text asserted here must match the diagnostics Epic 002's lint stories
  produce (single source — the harness does not re-define messages) (Epic 002
  diagnostic-vocabulary rule).
- Projection comparison uses the Epic 003 `projectionOf` / `diffProjection`, not an
  ad-hoc field list (Epic 003 contract).
- These scenarios are pure (no clock/broker faults); they still run under the
  no-network guard (Story 001).

## Verification Gate

- `npm test` green for `src/harness/lint-projection.test.ts`.

### Task T1 - Invalid-plan-set rejection with asserted diagnostics

**Input:** `src/harness/lint-projection.ts`, `src/harness/lint-projection.test.ts`

**Action - RED:** Write a test that each **isolated** invalid fixture (one per
violation: cycle, forward handoff, overlapping lanes, missing ticket, missing body
section) is rejected by compile with its expected planner-vocabulary diagnostic text
asserted string-for-string; optionally add a combined-set fixture as an extra case.

**Action - GREEN:** Assemble the invalid fixtures and assert against the Epic 002
compiler's diagnostics (no new mechanism).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Rebuild == markdown-derived projection

**Input:** `src/harness/lint-projection.ts`, `src/harness/lint-projection.test.ts`

**Action - RED:** Write a test compiling the golden feature, calling
`rebuildFromMarkdown`, and asserting `projectionOf(shadow) == projectionOf(live)`
field-by-field, and that a mutated runtime-only field yields no divergence.

**Action - GREEN:** Compose the Epic 002 compile + Epic 003 rebuild/projection to
realize the scenario.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
