# Story 001 - Search Interface & Engine

Epic: `.agent/plan/epics/023-fff-search.md`

## Goal

The thin `Search` interface with two implementations: the pinned fff engine and
a hermetic fake — consumers depend on the interface only.

## Acceptance Criteria

- The interface exposes `pathQuery(q, opts)`, `contentQuery(q, opts)`, and
  `engineVersion()`; `opts` carries a mandatory result cap and timeout
  (defaults from config) — over-cap truncates with a marker, timeout is a typed
  error (debate finding — bounded queries); results carry path, match info, and
  engine ordering (frecency-aware for fff) (PRD §6.4 — thin internal
  interface).
- The fake implementation returns deterministic, test-scripted results and is
  exported for downstream tests (fakes are permanent doubles — phases.md).
- The fff implementation adapts the SU2-recorded surface; an engine error (per
  the findings' error modes) surfaces as a typed `search-engine-error`, never a
  crash.
- The real-engine integration suite (required — Epic gate) proves on a temp
  repo: a content query finds a seeded string; a typo'd path query still finds
  the file (fff typo-resistance); results reflect a file added after index
  start (watcher); `engineVersion()` equals the pinned version; the result cap
  truncates a many-match query.
- No module outside `src/search/` imports fff directly (module-boundary
  assertion — the wrap is real).

## Constraints

- fff version pinned exactly (Epic 020 SU2 owns the lockfile); the adapter uses
  only surfaces recorded in `fff-surface.md`.
- The integration suite's placement (in `npm test` vs `test/live/`) follows the
  SU2 findings on hermeticity, with the decision noted in the suite header
  (Epic gate rule).

## Verification Gate

- `npm test` green for `src/search/search.test.ts` (fake-based) and the
  real-engine suite per its placement decision.

### Task T1 - Interface + fake

**Input:** `src/search/search.ts`, `src/search/fake-engine.ts`,
`src/search/search.test.ts`

**Action - RED:** Write tests: (a) interface shape (path/content/version);
(b) the fake returns scripted results; (c) a consumer written against the
interface runs identically on the fake.

**Action - GREEN:** Implement the interface + fake engine.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - fff adapter + integration suite

**Input:** `src/search/fff-engine.ts`, `src/search/fff-engine.integration.test.ts`,
`src/search/search.test.ts`

**Action - RED:** Write the integration tests (seeded content query, typo path
query, watcher pickup) and a unit test that engine errors surface typed.

**Action - GREEN:** Implement the fff adapter per the SU2 surface.

**Action - REFACTOR:** none.

**Verify:** `npm test` green (or the documented live placement); `npm run
typecheck` exits 0.
