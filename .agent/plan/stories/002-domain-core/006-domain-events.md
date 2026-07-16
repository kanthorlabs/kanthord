# Story 006 - domain events

Epic: `.agent/plan/epics/002-domain-core.md`

## Goal

The task-lifecycle event vocabulary and event construction exist in the
domain. Storage and delivery stay out (EPIC 003/005).

## Acceptance Criteria

- `EVENT_TYPES` lists exactly: `task.created`, `task.ready`, `task.started`,
  `task.completed`, `task.failed`; `EventType` is their union.
- `newEvent(type, { taskId })` → `{ id: <ULID>, type, taskId }`.
- Successive events have strictly increasing ids (ULID ordering — the
  pull-feed cursor of EPIC 003 depends on it). No `timestamp` field (the ULID
  carries it); `payload` is deferred to EPIC 003 (canonical-model decision,
  story 003).

## Constraints

- `src/domain/event.ts`; ids via `newId()` from `./entity.ts`; no I/O.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 - event vocabulary + construction

**Requires:** S001-T1 (`newId`).

**Input:** `src/domain/event.ts` (new), `src/domain/event.test.ts` (new);
consumes `newId`/`Entity` from `./entity.ts`.

**Action - RED:** test asserts: (a) `EVENT_TYPES` deep-equals the five
literals above in that order; (b) `newEvent('task.created', { taskId })`
returns a ULID-format id, the type, and the taskId; (c) two consecutive
events have strictly increasing ids. Fails today: module does not exist.

**Action - GREEN:** implement `event.ts` per the contract.

**Action - REFACTOR:** none.

**Output:** `src/domain/event.ts` exports `EVENT_TYPES`, `EventType`,
`Event { id, type, taskId }`, and `newEvent`.

**Verify:** `npm test` green (all three RED assertions);
`npm run typecheck` exit 0.
