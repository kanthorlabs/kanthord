# Story 2 — persistence: table, migration 32, repository

Epic: `.agent/plan/epics/026.8-decision-identity-and-inbox.md`
Depends on: Story 1 (the state / reason vocabularies).

## Change

1. **Migration 32**, appended to `MIGRATIONS` in
   `src/storage/sqlite/migrations.ts` after the version-31 entry (ends at
   `:928`). Header block comment in the style of the version-30 entry
   (`:895-918`). Exact entry:

```ts
{
  version: 32,
  name: "026.8-s2-decision-occurrences",
  up: (db) =>
    db.exec(`
CREATE TABLE decision_occurrences (
  id             TEXT PRIMARY KEY,
  subjectType    TEXT NOT NULL CHECK (subjectType IN ('task','objective','initiative')),
  subjectId      TEXT NOT NULL,
  kind           TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('open','resolved','expired')),
  closedReason   TEXT CHECK (closedReason IN ('verdict','superseded','vanished')),
  openingEventId TEXT,
  closingEventId TEXT,
  verdictLookupId TEXT,
  projectId      TEXT NOT NULL,
  projectName    TEXT NOT NULL,
  initiativeId   TEXT NOT NULL,
  initiativeName TEXT,
  objectiveId    TEXT,
  objectiveName  TEXT,
  taskId         TEXT,
  taskTitle      TEXT
);
CREATE UNIQUE INDEX decision_occurrences_open
  ON decision_occurrences(subjectType, subjectId) WHERE state = 'open';
`),
},
```

Pinned and binding:

- **No `REFERENCES`, on any column.** A closed occurrence is history; deleting
  the project or task must not delete or rewrite it (epic decision 7). This is a
  deliberate departure from migrations 15 and 30 — state it in the comment.
- The partial unique index is the one-open-occurrence-per-subject invariant; it
  mirrors the `jobs_queued_taskId` partial index (`migrations.ts:113-119`).
- No backfill **SQL**: a migration may not import `src/domain/`, so it cannot
  compute which decisions are open. The backfill is a **post-migration step in
  `db migrate`** (point 5 below), not "whenever someone happens to read the
  queue" — epic decision 2 requires the decisions open at migration time to be
  minted by the upgrade itself.

2. **Port** — append to `src/storage/port.ts`, beside `PublicationRepository`
   (`:231-240`):

```ts
export interface DecisionOccurrenceRow {
  id: string;
  verdictLookupId: string | null;
  subjectType: "task" | "objective" | "initiative";
  subjectId: string;
  kind: string;
  state: "open" | "resolved" | "expired";
  closedReason: "verdict" | "superseded" | "vanished" | null;
  openingEventId: string | null;
  closingEventId: string | null;
  projectId: string;
  projectName: string;
  initiativeId: string;
  initiativeName: string | null;
  objectiveId: string | null;
  objectiveName: string | null;
  taskId: string | null;
  taskTitle: string | null;
}

export interface DecisionOccurrenceRepository {
  listOpen(): DecisionOccurrenceRow[];
  get(id: string): DecisionOccurrenceRow | undefined;
  open(row: DecisionOccurrenceRow): void;
  refresh(
    id: string,
    patch: {
      kind: string;
      projectName: string;
      initiativeName: string | null;
      objectiveName: string | null;
      taskTitle: string | null;
    },
  ): void;
  close(
    id: string,
    patch: {
      state: "resolved" | "expired";
      closedReason: "verdict" | "superseded" | "vanished";
      closingEventId: string | null;
    },
  ): void;
  /** Runs `fn` inside `BEGIN IMMEDIATE` / `COMMIT`; rolls back on throw. */
  transaction<T>(fn: () => T): T;
}
```

`transaction` exists because the reconcile is a read-modify-write: two
concurrent `GET /api/queue` calls must not both mint an id for the same subject
(the partial unique index would fail one of them), and a mid-plan throw must not
leave the table half reconciled. `openDatabase` already sets
`busy_timeout = 5000` (`src/storage/sqlite/open.ts:45-54`).

3. **Adapter** `src/storage/sqlite/decision-occurrence-repository.ts`, modelled
   on `src/storage/sqlite/publication.ts` (header comment, `readonly #db`,
   `(db: DatabaseSync)` constructor, a local row type, statements prepared
   **per call**). Pinned SQL:

- `listOpen()` — `SELECT … FROM decision_occurrences WHERE state='open' ORDER BY id`.
- `get(id)` — `SELECT … WHERE id = ?`, `undefined` when absent.
- `open(row)` — plain `INSERT`, all 17 columns, no `ON CONFLICT`.
- `transaction(fn)` — `db.exec("BEGIN IMMEDIATE")`, `fn()`, `COMMIT`; on throw
  `ROLLBACK` and rethrow. Never nest it.
- `refresh(id, patch)` — `UPDATE … SET kind=?, projectName=?, initiativeName=?,
objectiveName=?, taskTitle=? WHERE id=? AND state='open'`.
- `close(id, patch)` — `UPDATE … SET state=?, closedReason=?, closingEventId=?
WHERE id=? AND state='open'`.

Prepare statements inside each method, never in the constructor — `buildDeps`
constructs this adapter eagerly and many tests call it before `db migrate`
(see the comment at `src/composition.ts:685-690`).

4. **Wiring** in `src/composition.ts`: import beside
   `SqlitePublicationRepository` (`:120`) and construct in the eager block
   beside `:252`:
   `const decisionOccurrenceRepository = new SqliteDecisionOccurrenceRepository(db);`
   Story 3 consumes it; Story 5 consumes it too.

5. **The migration-time backfill** (lands after Story 3, inside the 1+2+3
   coupled run, because it needs the reconcile) — `src/apps/cli/db.ts:24-51`
   (`runDbMigrate`):
   after `migrate()` reports applied migrations, call the queue read once so the
   reconcile mints an occurrence for every decision open at that moment, and
   print one extra line `backfilled decisions: <n>`. The CLI deps bundle already
   carries `getDecisionQueue` (`src/composition.ts:1259`); add it to the
   `runDbMigrate` dependency set. Pinned behaviour:
   - the backfill runs on **every** `db migrate`, and is idempotent — a second
     run mints nothing because every open decision already has an open
     occurrence (Story 1's reuse rule);
   - `up to date` runs still perform it, so an operator who upgraded before this
     epic landed is not left with an empty table;
   - a backfill failure prints `error: …` and exits 1, exactly like a failed
     migration — a half-migrated database must not look healthy.

## Constraints

- Do not edit any existing migration entry.
- `initiativeName` is nullable because `projectDecisions` may not find the
  initiative row; never write `""` in its place.

## Verify

- `node --test src/storage/sqlite/decision-occurrence-repository.test.ts` using
  the `makeTempDb()` harness copied verbatim from
  `src/storage/sqlite/daemon-heartbeat-repository.test.ts:19-25`, and binding
  the adapter to the **port** type. Assertions:
  - `listOpen()` on a fresh migrated db is `[]`.
  - `open()` then `get(id)` returns every column round-tripped, nulls as
    `null`.
  - a second `open()` for the same `(subjectType, subjectId)` while the first is
    open **throws** (the partial unique index).
  - after `close(id, …)`, a new `open()` for the same subject succeeds, and
    `listOpen()` holds only the new row.
  - `refresh()` changes `kind` and the four name columns and nothing else.
  - `close()` on an already-closed id changes nothing.
  - `listOpen()` returns rows ordered by `id` ascending.
  - a row survives deleting its `projectId`'s project row (no FK cascade).
- `node --test src/storage/sqlite/migrations.test.ts`, updated to:
  - `userVersion(db) === 32` and the test title's version; every other pinned
    `31` in that file (`:463, :882, :1014, :1119, :1198, :1235, :1530, :1545,
:1586, :1707, :1842, :2083`) re-checked and moved where it names the head.
  - `userTables(db)` gains `"decision_occurrences"` in alphabetical position
    (immediately after `daemon_heartbeats`).
  - the locked-DDL column test gains `decision_occurrences` with the 17 column
    names in the order above.
  - the last-migration-identity test (`:2180-2192`) becomes migration 32 named
    `026.8-s2-decision-occurrences`.
  - the upgrade-path test (`:2212-2258`) uses `MIGRATIONS.slice(0, 31)` then the
    full array, seeds with `insertChain(db)`, and asserts pre-existing rows
    survive and the new table exists. (The schema step alone mints nothing; the
    minting is the `db migrate` backfill, tested below.)
  - `transaction()` rolls back: a `fn` that opens a row and then throws leaves
    `listOpen()` empty.
- `node --test src/apps/cli/commands/db.test.ts` (or `src/apps/cli/db.test.ts`,
  whichever holds `runDbMigrate`) — with a fake `getDecisionQueue` returning two
  items, `db migrate` prints `backfilled decisions: 2`; a second run over the
  same store mints nothing new (the fake occurrence store records one `open` per
  subject in total); a throwing backfill exits 1.
- `npm run verify` exits 0 (its final `node src/main.ts db status` must list
  `decision_occurrences: 0`).
- Proof: phase B's `db migrate` step.
