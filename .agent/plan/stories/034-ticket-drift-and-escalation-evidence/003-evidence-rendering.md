# Story 003 - Evidence Rendering (web)

Epic: `.agent/plan/epics/034-ticket-drift-and-escalation-evidence.md`

## Goal

The dashboard inbox renders each escalation class's evidence in a
class-appropriate form — the human answers from the item, not from logs.

## Acceptance Criteria

- For every evidence class from Story 002, the inbox item detail renders its
  payload: diffs (drift, replan, attempted-write) as a diff view; ledger
  excerpts as a table; op chains as an ordered list with the last external
  observation; deploy failures as a per-stage list; artifact changes as
  id + hash pair + byte-diff summary — each asserted with a fixture item per
  class (component tests).
- The truncation marker, when set, is visibly rendered on the evidence block
  (asserted).
- An item whose evidence fails the client-side shape check renders an
  explicit, **visually alarming** "malformed evidence" fallback with the raw
  class name — never a blank section or a crash (asserted with a corrupt
  fixture); every valid class fixture renders **without** hitting the
  fallback (debate finding — a tolerant fallback must not normalize a rotting
  evidence contract; the `missing-evidence` payload from Story 002 renders as
  its own explicit state, distinct from malformed).
- One flow-level test drives list → item detail → evidence render through the
  fake generated client using the actual Epic 026 item shape (debate finding
  — component fixtures prove formatting, not that real items route to the
  right renderer).
- Every interactive or asserted element is selected via locator-registry
  constants (PROFILE web discipline).

## Constraints

- Pure client of the generated Connect-Web client on the Epic 026 methods —
  no raw fetch, no server logic (PROFILE web idioms).
- Extends the Epic 027 inbox surface — no separate evidence page/tool
  (Epic 034 anchor; phases.md — the dashboard grows views).
- Unit/component tests on Vitest + fake client; no E2E in this story
  (`web e2e` not named — Epic 034 Non-Goals).

## Verification Gate

- `npm run test:web` green for the evidence component suites;
  `npm run typecheck:web` exits 0.

### Task T1 - Per-class evidence components

**Input:** `clients/web/src/inbox/evidence/*.tsx`, `clients/web/src/locators.ts` (GREEN adds
missing locator constants), `clients/web/src/inbox/evidence/*.test.tsx`

**Action - RED:** Write component tests: one fixture item per evidence class
asserting its class-appropriate rendering via locator constants (and that no
valid class hits the fallback); the truncation-marker case; the
malformed-evidence fallback case (alarming, class-named); the
missing-evidence state; plus the list → detail → evidence flow test on the
fake generated client.

**Action - GREEN:** Implement the per-class evidence components and register
the needed locator constants.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.
