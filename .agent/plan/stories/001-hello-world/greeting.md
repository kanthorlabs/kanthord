# Story 001-hello-world/greeting — `greet(name)`

EPIC: `.agent/plan/epics/001-hello-world.md`

## Acceptance Criteria

- **AC1** — `greet("World")` returns exactly `"Hello, World!"`.
- **AC2** — the name is interpolated: `greet("Aelita")` returns `"Hello, Aelita!"`.

## Verification Gate

- Suite `src/greeting.test.ts` passes under `node --test`.
- `tsc --noEmit` is clean.

## Tasks

### Task greeting-1 — greet returns a greeting

**Input:** `src/greeting.ts`

**Action — RED:** In `src/greeting.test.ts`, write a `node:test` suite asserting
`greet("World") === "Hello, World!"` and `greet("Aelita") === "Hello, Aelita!"`
(test methods: `greets World`, `interpolates the name`). The test imports
`greet` from `./greeting.ts`.

**Action — GREEN:** Implement and export `greet(name: string): string` in
`src/greeting.ts` so both assertions pass.

**Action — REFACTOR:** None — the function is a one-liner; keep it minimal.
