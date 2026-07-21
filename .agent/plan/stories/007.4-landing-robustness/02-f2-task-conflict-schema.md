# Story 2 — F2: add `task.conflict` to events schema + drift guard

Epic: `.agent/plan/epics/007.4-landing-robustness.md`

## Goal

Domain `EVENT_TYPES` includes `"task.conflict"` (`src/domain/event.ts:15`, 16
members), but the events table CHECK constraint lists only 15 —
`task.conflict` is ABSENT (`src/storage/sqlite/migrations.ts:180-185`). Any
non-fast-forward landing reaches
`this.#feed.append(newEvent("task.conflict", { taskId }))`
(`src/app/task/approve-task.ts:234`) → SQLite `CHECK constraint failed` → raw
crash; the task is stuck. Reproduced in the E2E: 3 of 5 sibling tasks (all edit
`src/todo.mjs`, all branch from the same base).

This story adds a forward migration that rebuilds the events table with the
corrected CHECK, and a bidirectional schema-contract test so domain↔DB drift
fails CI thereafter.

## Contract (tests assert this)

- A new forward migration (next schema version) rebuilds `events`:
  - Decide FK handling **before** `BEGIN` — `PRAGMA foreign_keys=OFF` inside an
    open transaction is a NO-OP (debate B3). If no FKs reference `events`, state
    that and skip; otherwise disable before the txn and re-enable after.
  - `CREATE TABLE events_new (...)` with the CHECK listing **all 16** domain
    types incl `task.conflict`.
  - `INSERT INTO events_new (<explicit cols>) SELECT <explicit cols> FROM events`
    — explicit column lists, never `SELECT *` (debate B5).
  - Recreate every index/trigger/view that referenced `events` (inventory them
    first — debate S4).
  - `DROP TABLE events; ALTER TABLE events_new RENAME TO events;`
  - Optional: backfill any legacy relative `workspace` paths in the candidate
    store against the configured base (coordinated with S1).
- The migration is applied once by the version-tracked runner; the SQL itself is
  NOT claimed idempotent (debate S5) — do not assert idempotence of the SQL.
- Bidirectional schema-contract test (`migrations.test.ts` or new):
  1. every `EVENT_TYPES` member INSERTs into the migrated events table;
  2. an unknown/misspelled type (e.g. `"task.nope"`) is REJECTED by the CHECK;
  3. pre-existing event rows AND indexes survive the rebuild (seed rows on the
     old schema, migrate, assert count + a SELECT + index presence).

## Constraints

- Forward-only migration; do not edit the historical migration at lines 180-185.
- Preserve column order/types and all constraints other than the widened CHECK.
- Hermetic.

## Verification Gate

- `node --test src/storage/sqlite/migrations.test.ts` — the three assertions
  above.
- `npm run start -- db status` shows the new schema version.
- `npm run typecheck` 0; `npm run lint` clean.
