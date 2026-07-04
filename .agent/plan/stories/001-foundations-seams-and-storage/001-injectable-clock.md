# Story 001 - Injectable Clock

Epic: `.agent/plan/epics/001-foundations-seams-and-storage.md`

## Goal

A `Clock` seam that every time-dependent component depends on, with a
deterministic fake that never touches the real wall clock, so lease expiry, soak
timers, and poll intervals are all testable without waiting.

## Acceptance Criteria

- `Clock.now()` returns a millisecond epoch instant.
- A `FakeClock` constructed with a start instant returns exactly that instant from
  `now()` until advanced.
- `FakeClock.advance(ms)` moves `now()` forward by exactly `ms`.
- A timer scheduled at delay `d` via the clock fires exactly once, only after the
  fake has advanced by `>= d`.
- Multiple due timers fire in non-decreasing due-time order; two timers with the
  **same** due time fire in the order they were scheduled (insertion order breaks
  ties — a defined, testable rule, not left to chance).
- Advancing past several timers' due times fires all of them, in that order, within
  the single advance call.

## Constraints

- The seam is a small interface the consumer defines, injected by constructor/
  factory parameter — no module-level `Date.now`/`setTimeout` singletons that a
  test cannot replace (PROFILE.md DI seam style; PRD §7.7 injectable clock).
- Fake lives in `src/` beside the interface and is a permanent test double, never
  deleted (phases.md guiding rule "fakes are never deleted").
- No real `setTimeout` against the event loop in the fake's timer firing — timers
  advance only through `advance()` (PRD §7.7 deterministic harness).

## Verification Gate

- `npm test` green for `src/foundations/clock.test.ts`.
- The timer-ordering test completes with no real elapsed wall-clock delay.

### Task T1 - Clock interface + FakeClock now/advance

**Input:** `src/foundations/clock.ts`, `src/foundations/clock.test.ts`

**Action - RED:** Write a test that constructs a `FakeClock` at a fixed start
instant, asserts `now()` equals it, calls `advance(1000)`, and asserts `now()`
advanced by exactly 1000.

**Action - GREEN:** Define the `Clock` interface (`now(): number`) and a
`FakeClock` implementing it with a mutable current instant and an `advance(ms)`
method.

**Action - REFACTOR:** none.

**Verify:** `npm test` shows the now/advance test green; `npm run typecheck` exits 0.

### Task T2 - Deterministic timer scheduling and ordered firing

**Input:** `src/foundations/clock.ts`, `src/foundations/clock.test.ts`

**Action - RED:** Write a test that schedules three timers at delays 300, 100, 200
recording fire order, advances by 250, asserts only the 100 and 200 timers fired
in that order, then advances by 100 more and asserts the 300 timer fired last.
Add a second case: two timers scheduled at the **same** delay fire in scheduling
order (assert the tie-break rule).

**Action - GREEN:** Add `setTimer(delayMs, cb)` to the clock seam; on `advance`,
fire all timers whose due time `<= now()` in non-decreasing due-time order (ties
broken by insertion order), each exactly once.

**Action - REFACTOR:** Extract the due-timer selection into a small named helper
if the `advance` body exceeds a simple loop; otherwise `none`.

**Verify:** `npm test` shows the timer-ordering test green with no real delay;
`npm run typecheck` exits 0.
