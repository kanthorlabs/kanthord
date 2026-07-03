# Story 001 - Severity Classification

Epic: `.agent/plan/epics/036-verify-severities-and-boot-hooks.md`

## Goal

Every divergence the verify engine can report carries a declared severity —
warn, repairable drift, or fatal corruption — with fail-closed classification
for anything unknown, severity-grouped reporting, and exit codes an operator
and CI can act on.

## Acceptance Criteria

- Every divergence class named in the versioned projection contract has a
  declared severity mapping; the mapping lives with the contract and the
  contract version is bumped by this change (Epic 018 discipline). The
  mapping follows a stated **classification rule**, with the examples as pins
  (debate finding — example-driven taxonomy invites drift): a divergence is
  `repairable` iff the markdown is valid and a deterministic rebuild restores
  equality; `fatal` iff the markdown truth itself is invalid or ambiguous
  (parse failure, duplicate identity, conflicting truth); `warn` iff advisory
  only (no execution impact); runtime-only fields stay unreported.
- A divergence class with no mapping **under the engine's own contract
  version** classifies **fatal** — fail-closed, asserted. A **contract
  version mismatch** (engine and mapping/store disagree on the projection
  version) is a distinct operational-incompatibility load error, never
  reported as corruption (debate finding — schema evolution must not
  masquerade as fatal store corruption).
- The verify report groups findings by severity with per-severity counts and
  the contract version; the report shape is documented and asserted (it is
  Epic 036 Story 002's hook input and the Epic 026 `daemon.verify` payload).
- Exit codes: 0 = clean or warn-only; 1 = repairable present (no fatal);
  2 = fatal present; `--strict` promotes warn-only to exit 1 — all four
  asserted with injected fixtures.
- Severity examples pinned by test: a runtime-only field difference that has
  no markdown source is not reported at all (Epic 018 rule unchanged); a
  rebuildable derived-row divergence is `repairable`; a markdown parse
  failure or two nodes claiming one id is `fatal`; an advisory-only class
  (per the contract's warn list) is `warn`.

## Constraints

- Extends the Epic 018 engine and CLI — no second differ, no new comparison
  logic outside the engine (Epic 036 anchor).
- Markdown is never repaired or classified as repairable — only derived state
  is (PRD §6.1 division of truth).

## Verification Gate

- `npm test` green for `src/verify/severity.test.ts`; `npm run typecheck`
  exits 0.

### Task T1 - Mapping + fail-closed + report

**Input:** `src/verify/severity.ts`, `src/verify/engine.ts`,
`src/store/projection.ts` (contract version + mapping section only),
`src/verify/severity.test.ts` (debate finding — the contract artifact the
GREEN bumps must be in the Input)

**Action - RED:** Write tests: (a) every contract divergence class resolves
to a severity consistent with the classification rule; (b) unknown class
under the same version ⇒ fatal; a contract-version mismatch ⇒ the distinct
incompatibility error, not corruption; (c) the grouped report shape with
counts + contract version; (d) the four pinned severity examples.

**Action - GREEN:** Implement the severity mapping and grouped report in the
engine; bump the projection-contract version with the mapping section.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Exit codes + --strict

**Input:** `src/cli/verify.ts`, `src/verify/severity.test.ts`

**Action - RED:** Write tests: clean ⇒ 0; warn-only ⇒ 0; repairable ⇒ 1;
fatal ⇒ 2; warn-only with `--strict` ⇒ 1.

**Action - GREEN:** Wire severity-driven exit codes and the flag into the
operator entrypoint.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
