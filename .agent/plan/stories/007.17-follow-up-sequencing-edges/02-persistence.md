# Story 2 — Persistence: migration 20, `SequencingRepository`, digest

Epic: `.agent/plan/epics/007.17-follow-up-sequencing-edges.md`
Depends on: Story 1 (`validateDag` is not used here, but `src/domain/sequencing.ts` must exist)

## Change

### 2a. Migration 20 — append to `src/storage/sqlite/migrations.ts`

Insert as the **last** element of `MIGRATIONS`, between the `},` of version 19
(`migrations.ts:521`) and the closing `];` (`:522`). Plain `CREATE TABLE`, no
`disableForeignKeys` (no FK-parent table is rebuilt):

```ts
  {
    version: 20,
    name: "007.17-sequencing-edges",
    up: (db) =>
      db.exec(`
     CREATE TABLE initiative_dependencies (
       initiativeId TEXT NOT NULL REFERENCES initiatives(id),
       dependency   TEXT NOT NULL REFERENCES initiatives(id),
       PRIMARY KEY (initiativeId, dependency)
     );
     CREATE TABLE objective_dependencies (
       objectiveId TEXT NOT NULL REFERENCES objectives(id),
       dependency  TEXT NOT NULL REFERENCES objectives(id),
       PRIMARY KEY (objectiveId, dependency)
     );
     `),
  },
```

- Exactly two columns per table. **No `position` column** (unlike
  `task_dependencies`, `migrations.ts:50-55`) — an `after` set is a set.
- **No column added to `initiatives` or `objectives`.** No `order`, `sequence` or
  `rank`. Do not rebuild either table.
- **No change to the `events` type CHECK constraint** — this epic emits no new
  event types.

### 2b. New port `SequencingRepository` — `src/storage/port.ts`

Append a new interface after `InitiativeRepository` (which ends at
`port.ts:105`). Do **not** add methods to `InitiativeRepository` — five
structural fakes implement it (`src/app/graph/apply-graph.test.ts:75`,
`create-graph.test.ts:37`, `export-initiative.test.ts:165`,
`objective/create-objective.test.ts:16`, `graph/boundary-cases.test.ts:85`) and a
new required method there would break them all at typecheck.

```ts
/** Repository for follow-up sequencing edges (initiative + objective `after` sets). */
export interface SequencingRepository {
  /** The initiative's `after` set, sorted by `dependency` ascending. */
  listInitiativeAfter(initiativeId: string): string[];
  /** Insert one edge (idempotent: `INSERT OR IGNORE`) and re-stamp the owner sha. */
  addInitiativeAfter(initiativeId: string, dependency: string): void;
  removeInitiativeAfter(initiativeId: string, dependency: string): void;
  /** Replace the whole set with `after` (deduped, sorted) and re-stamp the owner sha. */
  setInitiativeAfter(initiativeId: string, after: string[]): void;
  /** Every initiative in the project as a DAG node, sorted by `id` ascending. */
  listInitiativeDag(projectId: string): DagNode[];

  /** The objective's `after` set, sorted by `dependency` ascending. */
  listObjectiveAfter(objectiveId: string): string[];
  addObjectiveAfter(objectiveId: string, dependency: string): void;
  removeObjectiveAfter(objectiveId: string, dependency: string): void;
  setObjectiveAfter(objectiveId: string, after: string[]): void;
  /** Every objective in the initiative as a DAG node, sorted by `id` ascending. */
  listObjectiveDag(initiativeId: string): DagNode[];
}
```

Import `DagNode` from `../domain/graph.ts` with `import type`.

### 2c. New adapter `src/storage/sqlite/sqlite-sequencing-repository.ts`

`export class SqliteSequencingRepository implements SequencingRepository`, single
`readonly #db: DatabaseSync` field + `constructor(db: DatabaseSync)`, mirroring
`SqliteInitiativeRepository` (`sqlite-initiative-repository.ts:17-22`).

Exact SQL, pinned:

| method                  | SQL                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `listInitiativeAfter`   | `SELECT dependency FROM initiative_dependencies WHERE initiativeId = ? ORDER BY dependency ASC`                                 |
| `addInitiativeAfter`    | `INSERT OR IGNORE INTO initiative_dependencies (initiativeId, dependency) VALUES (?, ?)`                                        |
| `removeInitiativeAfter` | `DELETE FROM initiative_dependencies WHERE initiativeId = ? AND dependency = ?`                                                 |
| `setInitiativeAfter`    | `DELETE FROM initiative_dependencies WHERE initiativeId = ?` then one `INSERT OR IGNORE` per id of `[...new Set(after)].sort()` |
| `listInitiativeDag`     | `SELECT id FROM initiatives WHERE projectId = ? ORDER BY id ASC`, then `listInitiativeAfter(id)` per row                        |
| `listObjectiveAfter`    | `SELECT dependency FROM objective_dependencies WHERE objectiveId = ? ORDER BY dependency ASC`                                   |
| `addObjectiveAfter`     | `INSERT OR IGNORE INTO objective_dependencies (objectiveId, dependency) VALUES (?, ?)`                                          |
| `removeObjectiveAfter`  | `DELETE FROM objective_dependencies WHERE objectiveId = ? AND dependency = ?`                                                   |
| `setObjectiveAfter`     | `DELETE FROM objective_dependencies WHERE objectiveId = ?` then sorted `INSERT OR IGNORE`                                       |
| `listObjectiveDag`      | `SELECT id FROM objectives WHERE initiativeId = ? ORDER BY id ASC`, then `listObjectiveAfter(id)` per row                       |

Every mutating method (`add*`, `remove*`, `set*`) ends by re-stamping the owner
row's `sha256`, because 2d puts `after` inside the canonical form:

- initiative: read `SELECT projectId, name FROM initiatives WHERE id = ?`, then
  `UPDATE initiatives SET sha256 = ? WHERE id = ?` with
  `sha256Hex(canonicalInitiative({ name, projectId, after: <fresh set> }))`.
- objective: read `SELECT initiativeId, name FROM objectives WHERE id = ?`, then
  `UPDATE objectives SET sha256 = ? WHERE id = ?` with
  `sha256Hex(canonicalObjective({ name, initiativeId, after: <fresh set> }))`.
- If the owner row does not exist, skip the stamp (do not throw).

Import `sha256Hex`, `canonicalInitiative`, `canonicalObjective` from
`./node-sha.ts` (the same import `sqlite-initiative-repository.ts:10-14` uses).

### 2d. `after` joins the canonical form — `src/domain/sha.ts`

Change the two functions at `sha.ts:31-44`. `after` is a **required** field so the
type checker finds every call site:

```ts
export function canonicalObjective(o: {
  name: string;
  initiativeId: string;
  after: string[];
}): string {
  return JSON.stringify({
    name: o.name,
    initiativeId: o.initiativeId,
    after: [...o.after].sort(),
  });
}

export function canonicalInitiative(i: {
  name: string;
  projectId: string;
  after: string[];
}): string {
  return JSON.stringify({
    name: i.name,
    projectId: i.projectId,
    after: [...i.after].sort(),
  });
}
```

`after` is the **last** JSON key and is always `.sort()`ed inside — mirroring how
`canonicalTask` sorts `dependencies` (`sha.ts:22`). This is what makes a reordered
`after:` list a digest no-op (Proof step 7b). Do not touch `canonicalTask`.

### 2e. Update every `canonicalInitiative` / `canonicalObjective` call site

1. `src/storage/sqlite/sqlite-initiative-repository.ts:25-29` (`save`) — pass
   `after: this.#initiativeAfter(initiative.id)`.
2. `sqlite-initiative-repository.ts` `saveObjective` (lines 70-93) — pass
   `after: this.#objectiveAfter(objective.id)`.
3. `sqlite-initiative-repository.ts:236-238` (`conditionalRenameInitiative`) —
   pass `after: this.#initiativeAfter(id)`.
4. `sqlite-initiative-repository.ts:263-265` (`conditionalRenameObjective`) —
   pass `after: this.#objectiveAfter(id)`.
5. `src/app/graph/apply-graph.ts:148-153` (initiative intended sha) — pass
   `after: this.#deps.sequencing.listInitiativeAfter(pkg.initiative.id)`.
6. `src/app/graph/apply-graph.ts:171-176` (objective intended sha) — pass
   `after: this.#deps.sequencing.listObjectiveAfter(obj.id)`.
7. `src/app/graph/create-graph.ts:205` (objective manifest sha) and the
   initiative manifest sha in the same block (`create-graph.ts:194-232`) — pass
   `after: []`.

Add two private helpers to `SqliteInitiativeRepository` (it owns the same `#db`,
so it queries the edge tables directly — no cross-adapter dependency):

```ts
  #initiativeAfter(id: string): string[] {
    return (
      this.#db
        .prepare(
          "SELECT dependency FROM initiative_dependencies WHERE initiativeId = ? ORDER BY dependency ASC",
        )
        .all(id) as Array<{ dependency: string }>
    ).map((r) => r.dependency);
  }
  #objectiveAfter(id: string): string[] { /* same against objective_dependencies / objectiveId */ }
```

Steps 5-7 pass the **live/empty** set in this story, so edge content does not yet
change any classification — Story 5 switches 5-7 to the package's resolved set.
`ApplyGraph`'s deps interface gains a required `sequencing: SequencingRepository`
member (the fakes in `apply-graph.test.ts` / `create-graph.test.ts` gain a
matching stub returning `[]`).

### 2f. Composition — `src/composition.ts`

Beside the other shared adapters (`composition.ts:147-159`):

```ts
const sequencingRepository = new SqliteSequencingRepository(db);
```

Pass it into the `ApplyGraph` and `CreateGraph` deps objects as `sequencing`.
Also expose it on `CliDeps` (`src/apps/cli/deps.ts:118-155`) as
`sequencingRepository: SequencingRepository` — Stories 3, 4 and 6 consume it.

## Constraints

- Migration 20 is append-only. Do not renumber or edit migrations 1-19;
  `validateSequence` (`src/storage/sqlite/migrate.ts:55-63`) enforces dense
  1-based ordering.
- Reads always return the set sorted by `dependency` ascending. Never rely on
  insertion order — there is no `position` column.
- `SqliteInitiativeRepository`'s public method signatures are unchanged in this
  story.
- No new event types, no `events` CHECK change, no new status values.

## Verify

`src/storage/sqlite/migrations.test.ts` — update the existing schema locks:

1. `migrations.test.ts:65-86` — rename to "migrates to version 20 and creates
   exactly nineteen core tables", assert `userVersion(db) === 20`, and add
   `"initiative_dependencies"` (between `"graph_import_map"` and `"initiatives"`)
   and `"objective_dependencies"` (between `"landing_integrations"` and
   `"objectives"`) to the `deepEqual` list — `userTables` returns them sorted.
2. `migrations.test.ts:92-…` — add
   `assert.deepEqual(columnNames(db, "initiative_dependencies"), ["initiativeId", "dependency"])`
   and `assert.deepEqual(columnNames(db, "objective_dependencies"), ["objectiveId", "dependency"])`.
3. Update every remaining hard-coded `19` version assertion to `20`:
   `migrations.test.ts:67`, `:330`, `:743-744`, `:876`, `:980`, `:1059`, `:1096`.
4. New test: neither table has a `position` column (assert the exact two-column
   lists above — the `deepEqual` in step 2 already pins this) and neither
   `initiatives` nor `objectives` gained a column (their `columnNames` lists are
   unchanged from the version-19 locks).
5. New test, modelled on `migrations.test.ts:299-322`: the composite PK rejects a
   duplicate `(initiativeId, dependency)` row (`assert.throws`), and the same for
   `(objectiveId, dependency)`.
6. New test: the FK on `dependency` is enforced — inserting an
   `initiative_dependencies` row whose `dependency` names no initiative throws
   (`assert.throws`) with `PRAGMA foreign_keys=ON`.

New test file `src/storage/sqlite/sqlite-sequencing-repository.test.ts` (real
SQLite in a `mkdtempSync` temp dir + `migrate(db, MIGRATIONS)`, the style of
`src/app/task/failure-semantics.test.ts:44-58`), asserting:

7. `listInitiativeAfter` returns `[]` for a fresh initiative.
8. Inserting edges in order `["C…","A…","B…"]` via three `addInitiativeAfter`
   calls makes `listInitiativeAfter` return them **sorted ascending** — assert
   the exact array. Same for `addObjectiveAfter` / `listObjectiveAfter`.
9. `addInitiativeAfter` twice with the same pair does not throw and leaves one
   entry (idempotent `INSERT OR IGNORE`).
10. `removeInitiativeAfter` for an absent edge does not throw and changes nothing.
11. `setInitiativeAfter(id, ["B","A","B"])` yields exactly `["A","B"]`
    (deduped + sorted); a following `setInitiativeAfter(id, [])` yields `[]`.
12. Each of `addInitiativeAfter` / `removeInitiativeAfter` / `setInitiativeAfter`
    changes the initiative's stored `sha256` (read via
    `new SqliteInitiativeRepository(db).getSha256(id)`), and setting the set back
    to its previous content restores the **same** sha — proving the stamp is a
    pure function of the sorted set. Same for the objective methods.
13. `listInitiativeDag(projectId)` returns one `{ id, dependencies }` per
    initiative of that project, sorted by `id` ascending, each `dependencies`
    sorted ascending, and excludes initiatives of another project. Same shape for
    `listObjectiveDag(initiativeId)`.

`src/domain/sha.test.ts` (create if absent, else extend):

14. `canonicalInitiative({name:"n",projectId:"p",after:["b","a"]})` equals
    `canonicalInitiative({name:"n",projectId:"p",after:["a","b"]})` — reordering
    is a digest no-op. Same for `canonicalObjective`.
15. `canonicalObjective` with `after: ["a"]` differs from `after: []` — a real
    edge change **is** visible to the digest.
16. `after` is the last JSON key: the canonical string ends with
    `,"after":["a","b"]}`.

Existing suites that must stay green (update their fakes/expected shas only, not
their intent): `src/app/graph/apply-graph.test.ts`,
`src/app/graph/create-graph.test.ts`,
`src/storage/sqlite/sqlite-initiative-repository.test.ts`.

Commands:

- `node --test src/storage/sqlite/migrations.test.ts src/storage/sqlite/sqlite-sequencing-repository.test.ts src/domain/sha.test.ts`
- `node --test src/app/graph/` (apply/create-graph regression)
- `node src/main.ts db migrate` reports `applied: 20 007.17-sequencing-edges`
- `npm run verify` exits 0

Proof: enables `node src/main.ts db migrate` (Proof line 71) and is the store
behind Proof steps 1, 2, 7 and 7b.
