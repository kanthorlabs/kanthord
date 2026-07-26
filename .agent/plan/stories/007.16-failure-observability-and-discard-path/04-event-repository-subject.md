# Story 4 — `repositoryId` subject on `repository.published`

Epic: `.agent/plan/epics/007.16-failure-observability-and-discard-path.md`

`repository.published` is the only event with no subject column, so the text
renderer prints the literal `undefined` and the feed cannot be filtered by
repository.

## Change

1. `src/domain/event.ts:32-39` — add `repositoryId?: string;` to `Event`, after
   `initiativeId`.
2. `src/domain/event.ts:41-49` — add `repositoryId?: string` to the `newEvent`
   input type and copy it onto the event with the same
   `if (input.X !== undefined)` pattern used for the other three subjects
   (`:54-62`). Keep the assignment order `taskId, objectiveId, initiativeId,
repositoryId` so serialized key order is deterministic.
3. **Migration 18**, appended to the array in `src/storage/sqlite/migrations.ts`
   after the version-17 entry (ends ~line 400):
   - `version: 18`, `name: "007.16-s4-event-repository-subject"`.
   - Rebuild `events` with an added `repositoryId TEXT` column, copying the
     DROP+RENAME pattern of the version-16 migration (`migrations.ts:~370-381`):
     `CREATE TABLE events_new7 (…, repositoryId TEXT)`, `INSERT INTO events_new7
(id, type, taskId, payload, objectiveId, initiativeId) SELECT … FROM events`,
     `DROP TABLE events`, `ALTER TABLE events_new7 RENAME TO events`.
   - `events` is not an FK parent, so **do not** set `disableForeignKeys`.
4. The SQLite event-feed adapter (find with
   `grep -rn "initiativeId" src/events/sqlite* src/storage/sqlite/*.ts`) — add
   `repositoryId` to the INSERT column list, the bound parameters, and the row→
   `Event` mapper, mirroring `initiativeId` exactly.
5. `src/app/repository/publish-repository.ts:106-111` — move `repositoryId` from
   the payload to the subject; keep `branch` and `remoteOID` in the payload:

   ```ts
   newEvent("repository.published", {
     repositoryId,
     payload: { branch, remoteOID: result.remoteOID },
   });
   ```

6. The `list event` text renderer (`src/apps/cli/events.ts`) — include
   `repositoryId` in whatever subject-resolution expression currently yields
   `undefined` for this event, using the same precedence order as the other
   subjects.

## Constraints

- Migration **18** exactly; Story 5 takes 19. If 18 is already taken when you
  start, stop and escalate rather than renumbering silently.
- `repositoryId` must be the event **subject column**, not a payload key —
  putting it in both is the bug being fixed.
- Do not change `EVENT_TYPES`; `repository.published` already exists at
  `src/domain/event.ts:27`.

## Verify

- `node --test src/storage/sqlite/migrations.test.ts` — add a test that after
  migrating a fresh DB, `pragma_table_info('events')` includes `repositoryId`,
  and that migrating a DB pre-seeded at version 17 with one existing event row
  preserves that row.
- `node --test src/app/repository/publish-repository.test.ts` — assert the
  appended event has `repositoryId === <repo id>` and that its `payload` has
  **no** `repositoryId` key.
- `node --test src/apps/cli/events.test.ts` — assert a `repository.published`
  event renders a line containing the repository id and containing **no**
  occurrence of the string `undefined`.
- `npm run verify` exits 0 (includes `db status`).
- Proof: delivers Proof lines 9 and 10 (second block).
