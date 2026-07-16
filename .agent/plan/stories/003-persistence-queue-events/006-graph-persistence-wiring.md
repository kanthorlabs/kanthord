# Story 006 - graph persistence wiring

Epic: `.agent/plan/epics/003-persistence-queue-events.md`

## Goal

The EPIC 002 graph functions gain a persisted path in both directions
(debate finding): `StoreGraph` validates a plain graph **before** storing
it atomically; `CheckStoredGraph` loads an initiative's tasks back and
recomputes readiness — proving domain ↔ storage round-trips through the
ports. `CheckStoredGraph` is the read model EPIC 004's `list task` will
reuse.

## Acceptance Criteria

- `StoreGraph.execute({ objectiveId, tasks: [{ id, title?,
  dependencies? }] })` (plain data, same row shape as EPIC 002's
  `CheckGraph`; `id` is the caller's label): builds pending
  label-`GraphNode`s, runs `validateGraph` **first** (domain errors
  propagate; nothing is stored on failure), then creates real `Task`s via
  `newTask` (title defaults to the label), remaps label dependencies to
  the new ULIDs, and persists them with one `TaskRepository.saveAll`
  call. Returns the created `Task[]` in input order.
- `CheckStoredGraph.execute({ initiativeId })`: loads
  `listByInitiative(initiativeId)`, uses the `Task[]` directly as
  `GraphNode[]` (structural typing — EPIC 002 S005), runs
  `validateGraph`, returns the S005 readiness report. Domain errors
  propagate (a stored graph that fails validation is corruption — fail
  loud). Unknown initiative → empty report; reference validation is
  EPIC 004's concern.
- An integration test drives store → load → readiness end to end on a
  temp database through the real SQLite adapters.

## Constraints

- `src/app/graph/store-graph.ts` and
  `src/app/graph/check-stored-graph.ts` import `domain/` and
  `storage/port.ts` (`import type`) only. No CLI surface (epic non-goal —
  EPIC 004 wires it).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 - StoreGraph use case

**Requires:** S003-T3 (`TaskRepository.saveAll`); EPIC 002 S003
(`newTask`), S005 (`validateGraph`).

**Input:** `src/app/graph/store-graph.ts` (new) + test (new);
hand-written `FakeTaskRepository`.

**Action - RED:** hermetic tests: (a) a valid two-node graph (`deploy`
depends on `api`) stores two pending `Task`s with the given
`objectiveId`, ULID ids, and `deploy`'s `dependencies` containing `api`'s
new ULID; return value in input order; (b) a cyclic input throws
`CycleError` and the fake records **no** `saveAll` call; (c) a duplicate
label throws `DuplicateTaskError`, nothing saved. Fails today: module
does not exist.

**Action - GREEN:** implement `StoreGraph` (one class, one `execute()`,
constructor-injected `TaskRepository`).

**Action - REFACTOR:** none.

**Output:** `src/app/graph/store-graph.ts` exports `StoreGraph` per the
Acceptance Criteria.

**Verify:** `npm test` green; `npm run typecheck` exit 0; `npm run lint`
clean.

### Task T2 - CheckStoredGraph use case

**Requires:** S003-T3 (`TaskRepository` port); EPIC 002 S005
(`validateGraph`, `readiness`).

**Input:** `src/app/graph/check-stored-graph.ts` (new) + test (new);
hand-written `FakeTaskRepository`.

**Action - RED:** hermetic tests: (a) a diamond graph of `Task`s (mixed
`completed`/`pending` statuses) returns the expected ready/blocked report
with `waiting` in declared order; (b) empty initiative → `[]`; (c) a task
whose dependency id is absent from the initiative's set →
`UnknownDependencyError` propagates. Fails today: module does not exist.

**Action - GREEN:** implement `CheckStoredGraph` (one class, one
`execute()`, constructor-injected `TaskRepository`).

**Action - REFACTOR:** none.

**Output:** `src/app/graph/check-stored-graph.ts` exports
`CheckStoredGraph` per the Acceptance Criteria.

**Verify:** `npm test` green; `npm run typecheck` exit 0; `npm run lint`
clean.

### Task T3 - persisted round-trip integration

**Requires:** S006-T1, S006-T2; S003-T1..T3 (sqlite repositories).

**Input:** `src/app/graph/graph-roundtrip.integration.test.ts` (new);
consumes the sqlite adapters, `openDatabase`, `MIGRATIONS`, domain
creation helpers (tests may import adapters).

**Action - RED:** on a temp DB: build project → initiative → objective
via the repositories; run `StoreGraph` with `SqliteTaskRepository` on the
EPIC 002 demo-fixture shape (`implement api` no dependencies, `deploy`
depending on it, a second independent root); then `CheckStoredGraph` on
the initiative; assert (a) the report shows both roots `ready` and
`deploy` `blocked` waiting on `implement api`'s ULID; (b) each stored
`Task` re-loaded via `get()` deep-equals the `StoreGraph` return value
(round-trip proof, dependency order included). Fails today: test does
not exist.

**Action - GREEN:** none expected — this is the integration capstone; if
it fails, fix the adapter/use case it exposes.

**Action - REFACTOR:** none.

**Output:** a regression test proving check-and-store → load → readiness
end to end on a real database file.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
