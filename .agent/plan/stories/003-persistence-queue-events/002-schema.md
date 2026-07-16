# Story 002 - schema

Epic: `.agent/plan/epics/003-persistence-queue-events.md`

## Goal

Migration 2 replaces the skeleton's single-table stamp with the real
schema: eight tables with ULID text primary keys, foreign keys, CHECK
constraints from the EPIC 002 vocabularies, ordered dependencies, and the
partial unique index that makes enqueue idempotent.

## Locked DDL (migration 2, `core-schema`)

```sql
DROP TABLE tasks;
CREATE TABLE projects (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE resources (
  id         TEXT PRIMARY KEY,
  projectId  TEXT NOT NULL REFERENCES projects(id),
  type       TEXT NOT NULL CHECK (type IN
              ('repository','credential','notification','ai_provider','filesystem')),
  name       TEXT NOT NULL,
  attributes TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE initiatives (
  id        TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  name      TEXT NOT NULL
);
CREATE TABLE objectives (
  id           TEXT PRIMARY KEY,
  initiativeId TEXT NOT NULL REFERENCES initiatives(id),
  name         TEXT NOT NULL
);
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  objectiveId TEXT NOT NULL REFERENCES objectives(id),
  title       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN
               ('pending','running','completed','failed'))
);
CREATE TABLE task_dependencies (
  taskId     TEXT NOT NULL REFERENCES tasks(id),
  dependency TEXT NOT NULL REFERENCES tasks(id),
  position   INTEGER NOT NULL,
  PRIMARY KEY (taskId, dependency)
);
CREATE TABLE jobs (
  id     TEXT PRIMARY KEY,
  taskId TEXT NOT NULL REFERENCES tasks(id),
  status TEXT NOT NULL CHECK (status IN
          ('queued','running','completed','failed'))
);
CREATE UNIQUE INDEX jobs_queued_taskId ON jobs(taskId) WHERE status = 'queued';
CREATE TABLE events (
  id     TEXT PRIMARY KEY,
  type   TEXT NOT NULL CHECK (type IN
          ('task.created','task.ready','task.started','task.completed','task.failed',
           'task.dependencies_changed')),
  taskId TEXT NOT NULL REFERENCES tasks(id)
);
```

## Locked decisions

- **`DROP TABLE tasks` first** — the skeleton stamp is replaced wholesale;
  plain `CREATE TABLE` (no `IF NOT EXISTS`), per the EPIC 001 fail-loud
  stance (`user_version` is the idempotency guard).
- **`task_dependencies.position`** (debate finding) — SQL row order is not
  a contract; `position` (0-based, declared order) is the only way
  `dependencies: string[]` can round-trip in order, which the EPIC 002
  readiness report depends on.
- **`resources.projectId`** — the Resource union has no `projectId` field;
  the column is the aggregate association (Project owns resources —
  canonical model / EPIC 004 `create <resource-type> --project`). Storage-level, not
  a domain change.
- **`resources.attributes`** — JSON text with verbatim vendor keys
  (`organization`, `branch`, `provider`, `secretRef`, `destination`,
  `model`, `path`).
- **`jobs.status` includes `completed`/`failed`** — EPIC 005 records
  results here, and changing a SQLite CHECK later means a full table
  rebuild; this epic only exercises `queued`/`running`.
- **No `events.payload` column** (debate finding) — no consumer this epic;
  EPIC 005 adds it with a trivial `ALTER TABLE … ADD COLUMN` migration
  when the failure reason lands.
- Vocabularies (`TaskStatus`, `EventType`, `ResourceType`) come verbatim
  from EPIC 002's canonical model (stories 002/003/006) — not invented
  here. `EventType` is the full **6**-value set including
  `task.dependencies_changed` (EPIC 004 insert/re-arrange audit), so the
  `events.type` CHECK never needs a later rebuild for it.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 - core-schema migration

**Requires:** S001-T1 (`openDatabase`), S001-T2 (report shape).

**Input:** `src/storage/sqlite/migrations.ts` (append migration 2),
`src/storage/sqlite/migrations.test.ts` (new); consumes `openDatabase`,
`migrate`.

**Action - RED:** tests on a temp DB, `migrate(db, MIGRATIONS)`: (a)
final version 2; user tables are exactly the eight above; (b)
`pragma table_info` matches the locked columns per table; (c) inserting a
task with an unknown `objectiveId` throws (FK enforced via
`openDatabase`); (d) a bad `tasks.status`, `resources.type`,
`events.type`, and `jobs.status` are each rejected (CHECK); (e) two
`queued` jobs for one `taskId` are rejected, while `queued` + `running`
for the same `taskId` coexist (partial unique index); (f) a duplicate
`(taskId, dependency)` row is rejected (composite PK); (g) re-run returns
`applied: []`. Fails today: migration 2 does not exist.

**Action - GREEN:** append migration `{ version: 2, name: 'core-schema' }`
executing the locked DDL.

**Action - REFACTOR:** none.

**Output:** `MIGRATIONS` contains migration 2; a migrated database has
the locked schema.

**Verify:** `npm test` green (all seven RED groups); `npm run typecheck`
exit 0.
