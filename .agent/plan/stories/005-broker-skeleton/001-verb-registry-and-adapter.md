# Story 001 - Verb Registry & Async-Verb Adapter

Epic: `.agent/plan/epics/005-broker-skeleton.md`

## Goal

Load the yaml verb registry into typed entries and define the async-verb adapter
interface every verb implements, enforcing the invariant that a verb declared async
must supply a reconcile path.

## Acceptance Criteria

- Loading a verb registry directory yields entries each exposing the full §5
  declaration surface, so per-verb behavior is **declared, not hardcoded** in the
  adapter (debate finding): `verb`, `tier` (`auto` | `auto_with_audit` |
  `approval_required`), `timeout`, `idempotency`, `retry` (`max`, `backoff`),
  `poll_interval`, `terminal_states`, `rate_limit` behavior, and
  `observed_state_can_regress` (PRD §5 — "each async verb must declare submit,
  poll_status, terminal states, backoff, timeout+escalation, rate-limit behavior,
  and whether observed state can regress").
- The async-verb adapter interface declares the code side — `submit`, `poll_status`,
  `reconcile` — while the registry entry declares the data side (intervals, terminal
  states, flags above); a fake verb implements the adapter (PRD §5).
- A verb whose registry entry marks it async but provides **no** `reconcile` adapter
  is rejected at registration with a diagnostic naming the verb ("a verb with no
  reconcile path cannot be async", PRD §5).
- The `tier` value is readable per verb (it is the approval matrix — PRD §5), but no
  approval enforcement happens here (Epic 005 Non-Goals).

## Constraints

- Registry is yaml, loaded via the Epic 001 registry loader keyed by `verb` (PRD §5;
  reuses Epic 001 Story 004).
- The adapter is a small interface the broker consumes; fake verbs are hand-written
  objects implementing it (PROFILE.md fake/mock style — no mocking library).
- "No reconcile ⇒ cannot be async" is enforced in core, model-independent (PRD §5).

## Verification Gate

- `npm test` green for `src/broker/registry.test.ts`.

### Task T1 - Load verb registry entries

**Input:** `src/broker/registry.ts`, `src/broker/registry.test.ts`

**Action - RED:** Write a test loading a temp-dir verb registry (two verbs, the full
§5 declaration surface) and asserting each entry's `verb`, `tier`, `timeout`,
`idempotency`, `retry.max`, `retry.backoff`, `poll_interval`, `terminal_states`,
`rate_limit`, and `observed_state_can_regress`.

**Action - GREEN:** Implement `loadVerbRegistry(dir)` over the Epic 001 registry
loader, returning typed verb entries.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Async adapter interface + reconcile-required rule

**Input:** `src/broker/registry.ts`, `src/broker/registry.test.ts`

**Action - RED:** Write a test: registering an async verb with `submit`+`poll_status`
but no `reconcile` throws a typed error naming the verb; a verb with all four
registers cleanly.

**Action - GREEN:** Define the `AsyncVerbAdapter` interface and a
`registerVerb(entry, adapter)` that enforces the reconcile-required rule for async
verbs.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
