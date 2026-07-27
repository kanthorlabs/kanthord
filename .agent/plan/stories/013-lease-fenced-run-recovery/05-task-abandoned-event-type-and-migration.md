# Story 5 — `task.abandoned` event type + migration

Epic: `.agent/plan/epics/013-lease-fenced-run-recovery.md`
Depends on: Story 1 (migration 27 must already exist; this story is migration 28).

## Change

### 1. `src/domain/event.ts` — add the member

Insert `"task.abandoned",` into `EVENT_TYPES` immediately after `"task.discarded",` (line 13), so the task-lifecycle members stay grouped:

```ts
  "task.discarded",
  "task.abandoned", // 013 Story 5 — operator revoked a run's lease
  "task.blocked",
```

`EVENT_TYPES` goes from 27 to 28 members. `Event.payload` is already `Record<string, string>` (line 42) — the `reason` field needs no type change.

### 2. `src/storage/sqlite/migrations.ts` — rebuild the `events` CHECK

Append after the entry added in Story 1. Mirror migration 26
(`migrations.ts:762-796`) exactly: same single-expression `up: (db) =>
db.exec(...)` form, explicit column lists on the `INSERT … SELECT`, no
`disableForeignKeys` (`events` is only an FK child). The next scratch-table name
in the sequence is `events_new11`.

**The `name` is fixed; the `version` is NOT.** Use `name:
"013-s5-task-abandoned-event"` exactly, and set `version` to Story 1's version +
1 at implementation time. EPIC 011 story 3 also appends a migration, so the
absolute numbers depend on land order — never hardcode them from this document.

**Cross-epic hazard — this rebuild can destroy another epic's column.** Do NOT
copy "all 7 columns" from migration 26. Read the CURRENT `events` schema first
and preserve **every** column it has. EPIC 011 story 3
(`011-s3-events-project-id`) adds a nullable `projectId` column by
`ALTER TABLE`; if that migration has already landed, this rebuild must include
`projectId` in both the new `CREATE TABLE` and the `INSERT … SELECT` column
lists, or the project-scoped event feed silently loses its data with no error.

Verify: after a fresh `db migrate` from an empty database, assert
`columnNames(db, "events")` equals the full expected set for the migrations that
exist — including `projectId` when `011-s3-events-project-id` is present. Mirror
the column assertion at `src/storage/sqlite/migrations.test.ts:156`.

```ts
  {
    version: /* Story 1's version + 1 — see above */ 28,
    name: "013-s5-task-abandoned-event",
    // EPIC 013 Story 5 — admit 'task.abandoned' in the events.type CHECK list
    // (SQLite can't ALTER a CHECK constraint; rebuild the table). Mirrors
    // migration 26's events_new10: all 7 columns preserved verbatim, only the
    // CHECK list grows by one literal.
    up: (db) =>
      db.exec(`
CREATE TABLE events_new11 (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN (
                 'task.created','task.ready','task.started','task.completed',
                 'task.failed','task.dependencies_changed',
                 'task.escalated','task.approved','task.rejected','task.discarded',
                 'task.abandoned',
                 'task.blocked','task.conflict','agent.started','agent.progress',
                 'agent.finished','task.verification','provider.retry',
                 'provider.failover',
                 'objective.building','objective.awaiting_confirmation',
                 'objective.integrated','objective.conflict',
                 'initiative.landed','candidate.transplanted','repository.published',
                 'objective.discarded','initiative.discarded'
               )),
  taskId       TEXT REFERENCES tasks(id),
  payload      TEXT,
  objectiveId  TEXT REFERENCES objectives(id),
  initiativeId TEXT REFERENCES initiatives(id),
  repositoryId TEXT
);
INSERT INTO events_new11 (id, type, taskId, payload, objectiveId, initiativeId, repositoryId)
  SELECT id, type, taskId, payload, objectiveId, initiativeId, repositoryId FROM events;
DROP TABLE events;
ALTER TABLE events_new11 RENAME TO events;
`),
  },
```

## Constraints

- Version must be exactly `28` and the entry must be appended last: `validateSequence` (`src/storage/sqlite/migrate.ts:54-63`) requires versions to be contiguous `1..n` matching array index + 1.
- The 28 literals in the CHECK list must be exactly the 28 `EVENT_TYPES` members — no more, no fewer.
- No new column, no new index, no `disableForeignKeys`.
- Nothing appends `task.abandoned` in this story; Story 4 does.

## Verify

- `node --test src/storage/sqlite/migrations.test.ts`:
  - update the "all EVENT_TYPES members are insertable" test at lines 800-813: title becomes `all 28 EVENT_TYPES members`; the loop body is unchanged and must still pass for every member including `task.abandoned`.
  - update the version assertions from `27` (set by Story 1) to `28`: line 70 test title, line 72, and lines 995, 1099, 1178, 1510, 1525, 1566, 1687.
  - new test: the CHECK still **rejects** an unknown type — `INSERT INTO events(id, type, taskId) VALUES ('e','task.bogus',<taskId>)` throws (mirror the assertion at `src/storage/sqlite/migrations.test.ts:1775-1786`).
  - new test: rows survive the rebuild — seed at `MIGRATIONS.slice(0, 27)`, `insertChain(db)`, insert one `events` row of each of two existing types, `migrate(db, MIGRATIONS)`, then assert `userVersion(db) === 28` and both rows are still present with their `payload` intact (mirror `migrations.test.ts:1788-1836`).
  - new test: `columnNames(db, "events")` deep-equals `["id","type","taskId","payload","objectiveId","initiativeId","repositoryId"]` after migration 28 (mirror `migrations.test.ts:1838-1850`).
  - new test: inserting `task.abandoned` with `payload` set to `'{"reason":"stuck on a slow tool"}'` round-trips through `SELECT payload`.
- `node --test src/events/sqlite.test.ts` (if present) and `node --test src/app/task/list-events.test.ts` — pass unchanged.
- `npm run verify` exits 0 (this includes `db status`, which must report version 28).
- Proof: prerequisite for phase **C**'s `task.abandoned` assertions; delivers no Proof line alone.
