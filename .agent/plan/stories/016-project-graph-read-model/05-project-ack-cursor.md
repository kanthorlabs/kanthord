# Story 5 — Project ack cursor: table, repository, use case, `ack project`

Epic: `.agent/plan/epics/016-project-graph-read-model.md`
Depends on: EPIC 011 story 3 (`events.projectId`) — the "not ahead of the feed"
guard reads the project's latest event id.

## Change

### A. Migration — append to `src/storage/sqlite/migrations.ts`

Insert a new object literal between line 796 (`  },`, closing migration 26) and
line 797 (`];`).

- `name: "016-s5-project-acks"` — **pinned**.
- `version:` = **the last entry's version + 1**, read from the file at
  implementation time. It is 27 only if no other epic has appended first; EPIC 011
  story 3, EPIC 013 stories 1 and 5, and EPIC 014 story 3 all append here.
  `validateSequence` (`src/storage/sqlite/migrate.ts:54-63`) throws unless versions
  are exactly `1..n` contiguous, so a wrong number fails loudly — never hardcode
  a number without re-reading the file.

```sql
CREATE TABLE project_acks (
  projectId TEXT PRIMARY KEY REFERENCES projects(id),
  cursor    TEXT NOT NULL
);
```

Plain `CREATE TABLE`, not `IF NOT EXISTS` — mirror migration 15
(`src/storage/sqlite/migrations.ts:396-409`). This is an additive create: it does
**not** rebuild `events`, so it cannot drop another epic's column.

### B. Update the four version literals and the table list in `src/storage/sqlite/migrations.test.ts`

- `:70` test title — bump the version number in the string.
- `:72` `assert.equal(userVersion(db), 26)` → the new version.
- `:73-96` `userTables` array — insert `"project_acks"` in ascending order,
  between `"observability_refs"` and `"project_ai_providers"`.
- `:449` `assert.equal(second.version, 26)` → the new version.
- `:1215` `assert.equal(report.version, 26)` → the new version.
- `:1818` `assert.equal(userVersion(db), 26, …)` → the new version.

Add to the `"schema columns match locked DDL for all tables"` block (starts
`:102`): `assert.deepEqual(columnNames(db, "project_acks"), ["projectId", "cursor"]);`

There is no `MIGRATIONS.length` assertion anywhere — do not add one.

### C. Port + adapter

`src/storage/port.ts` — add after `PublicationRepository` (ends line 240):

```ts
/** Per-project last-acknowledged event cursor (016 story 5). */
export interface ProjectAckRepository {
  getAck(projectId: string): string | undefined;
  setAck(projectId: string, cursor: string): void;
  /** Highest event id belonging to this project, or undefined when it has none. */
  latestProjectEventId(projectId: string): string | undefined;
}
```

New file `src/storage/sqlite/project-ack.ts` — mirror
`src/storage/sqlite/publication.ts` (62 lines) exactly in style:

- `getAck`: `SELECT cursor FROM project_acks WHERE projectId = ?`.
- `setAck`: `INSERT INTO project_acks (projectId, cursor) VALUES (?, ?)
ON CONFLICT(projectId) DO UPDATE SET cursor = excluded.cursor`.
- `latestProjectEventId`:
  `SELECT MAX(id) AS m FROM events WHERE projectId = ?` — returns `undefined` when
  `m` is `NULL`. `events.projectId` is EPIC 011 story 3's column.

### D. Use case `src/app/project/ack-project.ts`

```ts
export class CursorNotUlidError extends Error {
  readonly cursor: string;
}
export class CursorAheadOfFeedError extends Error {
  readonly cursor: string;
  readonly latest: string | null;
}
export class AckProject {
  constructor(
    acks: AckSource,
    projects: { get(id: string): Project | undefined },
  );
  execute(input: { projectId: string; cursor: string }): Promise<void>;
}
```

`AckSource` is a use-case-local structural interface over the three
`ProjectAckRepository` methods.

Pinned rules, checked in this exact order:

1. `projects.get(projectId) === undefined` → throw
   `new UnknownReferenceError("project", projectId)` (`src/domain/errors.ts:19`).
2. `cursor` must match `/^[0-9A-HJKMNP-TV-Z]{26}$/` (Crockford base32, 26 chars —
   the ULID alphabet excludes I, L, O, U). Otherwise throw `CursorNotUlidError`
   with message `cursor is not a ULID: <cursor>`.
3. `latest = acks.latestProjectEventId(projectId)`. When `latest === undefined`
   **or** `cursor > latest` (plain string comparison — ULIDs sort
   lexicographically by time), throw `CursorAheadOfFeedError` with message
   `cursor <cursor> is ahead of the project feed (latest: <latest ?? "none">)`.
   A project with no events has nothing to acknowledge.
4. `stored = acks.getAck(projectId)`. When `stored !== undefined && cursor <=
stored`, **return without writing** — the ack is monotonic and a backwards or
   repeat ack is a silent no-op, never an error.
5. Otherwise `acks.setAck(projectId, cursor)`.

**AMENDED 2026-07-28:** `execute` **returns the cursor now in effect** —
`{ cursor: string }`, the value a subsequent `getAck(projectId)` would read.
Rule 4 returns `{ cursor: stored }`; rule 5 returns `{ cursor }`. Reason: a
backwards ack is a no-op, so a caller that echoes its own input claims a cursor
that was never stored. The CLI must be able to report what is true (see §E).

Register both error classes in `src/apps/cli/error-map.ts`'s `toResult`
`instanceof` chain (lines 69-119) so they map to `exitCode: 1` with
`error: <message>` instead of crashing.

### E. New top-level `ack` command group

New file `src/apps/cli/commands/ack.ts` — copy
`src/apps/cli/commands/pause.ts` (19 lines) verbatim, replacing `pause` with
`ack` and the description with `"Acknowledge kanthord activity."`.

New leaf `src/apps/cli/commands/ack/project.ts` — copy
`src/apps/cli/commands/pause/initiative.ts` (23 lines) structure:

```ts
new Command("project")
  .description("Acknowledge a project's activity up to a cursor.")
  .configureHelp({ commandUsage: () => "kanthord ack project" })
  .requiredOption("--id <id>", "ID of the project to acknowledge")
  .requiredOption("--cursor <ulid>", "event id to acknowledge up to")
  .addHelpText(
    "after",
    "\nExample:\n  kanthord ack project --id project-1 --cursor 01JZZZZZZZZZZZZZZZZZZZZZZZ\n",
  );
```

Handler `runAckProject` is appended to the existing `src/apps/cli/project.ts`,
following the `runPauseInitiative` shape (`src/apps/cli/initiative.ts:44-56`):
reads `args["id"]` and `args["cursor"]`; on success
return `{ exitCode: 0, stdout: [], stderr: ["project acknowledged: <id> @ <cursor>"] }`;
on error `{ ...toResult(err), stdout: [] }`.

**AMENDED 2026-07-28:** `<cursor>` in that message is the cursor **returned by
`execute`**, never the raw `args["cursor"]` input. On a backwards ack the two
differ, and printing the input would name a cursor that was not stored while
`get overview`'s `since` kept the higher value.

Register in `src/apps/cli/index.ts`:

- `import { buildAckCommand } from "./commands/ack.ts";` in the import block
  (lines 5-34, alphabetical by module path — place beside `buildAddCommand`).
- `const ack = buildAckCommand(deps, io).name("ack");` in the const block
  (lines 45-70).
- `.addCommand(ack)` in the chain (lines 79-106).

Add `ackProject: AckProject;` to `CliDeps` (`src/apps/cli/deps.ts:131-211`) with a
matching `import type`.

Wire in `src/composition.ts`: build `const projectAckRepository = new
SqliteProjectAckRepository(db);` beside `publicationRepository` (line 223), then
`const ackProject = new AckProject(projectAckRepository, { get: (id) =>
projectRepository.get(id) });` and add `ackProject` to the returned bundle
(lines 850-920).

### F. Bump the architecture counters

- `src/apps/cli/architecture.test.ts:28` — `EXPECTED_LEAF_FILE_COUNT` **66 → 67**.
- `src/apps/cli/architecture.test.ts:33` — `EXPECTED_LEAF_COUNT` **69 → 70**.

(Story 4 set 66/69; Story 6 will set 68/71.)

## Constraints

- `AckProject` is the **only** writer of `project_acks`. No other use case may
  call `setAck`.
- Do not add an `--all` / `--latest` convenience flag: the client must echo the
  exact cursor it displayed, or the digest can silently skip events the human
  never saw.
- Do not rebuild the `events` table. The cross-epic hazard notes at
  `.agent/plan/stories/011-client-discovery-surface/03-denormalise-event-project-id.md:19-24`
  and `.agent/plan/stories/013-lease-fenced-run-recovery/05-task-abandoned-event-type-and-migration.md:33-44`
  apply to rebuilds; this migration is a plain additive `CREATE TABLE`.

## Verify

`node --test src/storage/sqlite/migrations.test.ts` — the version literals, the
`userTables` entry, and the new `project_acks` column assertion all pass from a
fresh temp DB via `withMigratedDb` (`migrations.test.ts:55-66`).

`node --test src/storage/sqlite/project-ack.test.ts` — new file using the
`makeTempDb()` harness from `src/storage/sqlite/publication.test.ts:15-21`:

- `getAck` on an unknown project returns `undefined`.
- `setAck` then `getAck` round-trips the cursor.
- `setAck` twice for the same project **overwrites** (one row, latest value).
- `latestProjectEventId` returns `undefined` for a project with no events, and the
  maximum id when several events carry that `projectId`, ignoring another
  project's higher id.

`node --test src/app/project/ack-project.test.ts` — new file, fakes only:

- unknown project id throws `UnknownReferenceError` with `kind === "project"`.
- a 25-char cursor, a 27-char cursor, a lowercase cursor, and a cursor containing
  `I`, `L`, `O` or `U` each throw `CursorNotUlidError`; a valid 26-char
  upper-case Crockford ULID does not.
- `latestProjectEventId` returning `undefined` throws `CursorAheadOfFeedError`
  even for a syntactically valid cursor.
- a cursor greater than `latest` throws `CursorAheadOfFeedError`; a cursor exactly
  equal to `latest` is accepted and written.
- monotonic: ack `B`, then ack `A` where `A < B` → `setAck` is **not** called a
  second time and `getAck` still reports `B`.
- idempotent: acking the same cursor twice calls `setAck` at most once for the
  second call (asserted via a call counter on the fake).
- ordering: an invalid-ULID cursor for an unknown project throws
  `UnknownReferenceError`, proving rule 1 runs before rule 2.

`node --test src/apps/cli/commands/special.test.ts` (or the mutation-style
equivalent) — `ack project` with `--id` and `--cursor` calls the use case with
`{ projectId, cursor }`; a missing `--cursor` exits non-zero.

`node --test src/apps/cli/error-map.test.ts` — `CursorNotUlidError` and
`CursorAheadOfFeedError` map to `{ exitCode: 1, stderr: ["error: <message>"] }`
rather than being re-thrown.

`node --test src/apps/cli/architecture.test.ts` — passes with 67/70 and the new
`ack project` leaf satisfying description + `Usage:` + `Example`.

`npm run verify` exits 0.

Proof: delivers phase **H**'s `ack project --cursor <latest>` write and the
refusal of `01ZZZZZZZZZZZZZZZZZZZZZZZZ` as ahead of the feed.
