# Story 2 — Migration 20: re-stamp both sha stores, preserving real drift

Epic: `.agent/plan/epics/007.18-content-vs-lifecycle-sha.md`
Depends on: Story 1 (the new canonical form must exist first).

**The epic calls this "Migration 21". The real next version is 20.** The highest
registered version is 19 (`migrations.ts:462`), and `validateSequence`
(`migrate.ts:56-62`) throws unless versions are contiguous `1..n` by array index —
a migration numbered 21 breaks every DB open.

**Two frozen canonical forms are required, not one.** Re-stamping
`graph_import_map.creation_sha` from live content for _every_ task row would erase
evidence of drift that was genuinely present before migrating: a row whose content
really did change out of band would come out with `liveSha === baselineSha` and
classify `unchanged`. To tell status-only drift from content drift, the migration
must recompute the **old** status-bearing digest at the status every baseline was
minted with. That status is always `"pending"`: `create-graph.ts:230` passes
`task.status` from a freshly-built `newTask` (pending), and `apply-graph.ts:573`
hardcodes `"pending"`.

## Change

### 1. `src/storage/sqlite/migrations.ts` — two frozen canonical forms

Add after `import type { Migration }` (line 1). Both are **exported** so the test
can pin them against the live `canonicalTask`:

```ts
import { createHash } from "node:crypto";

/**
 * FROZEN snapshot of `canonicalTask` as it stood at schema version 19 — status
 * still part of the content hash. Used by migration 20 to recompute what a
 * stored `creation_sha` would have been, so status-only drift can be told apart
 * from genuine content drift. Never edit: it describes the past, not the present.
 */
export function canonicalTaskV19(t: {
  title: string;
  instructions: string;
  ac: string[];
  agent: string;
  verification: string[] | undefined;
  dependencies: string[];
  objectiveId: string;
  status: string;
}): string {
  return JSON.stringify({
    title: t.title,
    instructions: t.instructions,
    ac: t.ac,
    agent: t.agent,
    verification: t.verification ?? null,
    dependencies: [...t.dependencies].sort(),
    objectiveId: t.objectiveId,
    status: t.status,
  });
}

/**
 * FROZEN snapshot of `canonicalTask` as of migration 20 (EPIC 007.18: `status`
 * removed). Migrations must be immutable, so this must never be edited to track
 * later changes to `src/domain/sha.ts` — a future change to the canonical form
 * gets its own migration with its own snapshot. Deliberately not imported from
 * domain/, which no migration does.
 */
export function canonicalTaskV20(t: {
  title: string;
  instructions: string;
  ac: string[];
  agent: string;
  verification: string[] | undefined;
  dependencies: string[];
  objectiveId: string;
}): string {
  return JSON.stringify({
    title: t.title,
    instructions: t.instructions,
    ac: t.ac,
    agent: t.agent,
    verification: t.verification ?? null,
    dependencies: [...t.dependencies].sort(),
    objectiveId: t.objectiveId,
  });
}
```

### 2. Append migration 20 before the closing `];` at `migrations.ts:523`

Every existing migration is a single `db.exec(\`SQL\`)`. This one cannot be — a
sha256 over canonical JSON is not expressible in SQL. It is the first migration in
this registry to loop in JS; say so.

```ts
  {
    version: 20,
    name: "007.18-s2-content-sha-restamp",
    // First JS-looping migration in this registry: the task content digest is a
    // sha256 over canonical JSON and cannot be computed in SQL.
    //
    // `tasks.sha256` is always rewritten to the new status-less digest — it is
    // derived from live content by definition.
    //
    // `graph_import_map.creation_sha` is rewritten ONLY when the row's content
    // has not drifted since the baseline was minted, tested by recomputing the
    // old status-bearing digest at status "pending" (the status every baseline
    // was created with). Rewriting unconditionally would erase real drift;
    // rewriting nothing would leave every progressed task permanently drifted.
    // Each package's row is judged on its own stored baseline.
    //
    // Objective and initiative shas are untouched: their canonical forms never
    // included status.
    up: (db) => {
      type TaskRow = {
        id: string;
        objectiveId: string;
        title: string;
        agent: string;
        instructions: string;
        ac: string;
        verification: string | null;
      };
      const sha = (canonical: string): string =>
        createHash("sha256").update(canonical, "utf8").digest("hex");

      const rows = db
        .prepare(
          "SELECT id, objectiveId, title, agent, instructions, ac, verification FROM tasks",
        )
        .all() as TaskRow[];
      const depsStmt = db.prepare(
        "SELECT dependency FROM task_dependencies WHERE taskId = ? ORDER BY position ASC",
      );
      const mapStmt = db.prepare(
        "SELECT rowid AS rid, creation_sha FROM graph_import_map WHERE task_id = ?",
      );
      const updTask = db.prepare("UPDATE tasks SET sha256 = ? WHERE id = ?");
      const updMap = db.prepare(
        "UPDATE graph_import_map SET creation_sha = ? WHERE rowid = ?",
      );

      for (const row of rows) {
        const deps = (
          depsStmt.all(row.id) as Array<{ dependency: string }>
        ).map((d) => d.dependency);
        const fields = {
          title: row.title,
          instructions: row.instructions,
          ac: JSON.parse(row.ac) as string[],
          agent: row.agent,
          verification:
            row.verification != null
              ? (JSON.parse(row.verification) as string[])
              : undefined,
          dependencies: deps,
          objectiveId: row.objectiveId,
        };
        const newSha = sha(canonicalTaskV20(fields));
        // What `creation_sha` would hold if content never changed since import.
        const undriftedBaseline = sha(
          canonicalTaskV19({ ...fields, status: "pending" }),
        );

        updTask.run(newSha, row.id);

        const mapRows = mapStmt.all(row.id) as Array<{
          rid: number;
          creation_sha: string;
        }>;
        for (const m of mapRows) {
          if (m.creation_sha === undriftedBaseline) updMap.run(newSha, m.rid);
          // else: genuine content drift — leave the baseline so it still
          // classifies `drifted` on the next apply.
        }
      }
    },
  },
```

No `disableForeignKeys` — this migration creates and drops nothing.

The `ac` / `verification` decoding must match `#stampSha`
(`sqlite-task-repository.ts:72-77`): `ac` is always a JSON array string
(`NOT NULL DEFAULT '[]'`); `verification` is `undefined` when SQL NULL.

`graph_import_map` rows with `kind = 'objective'` have `task_id IS NULL`, so
`WHERE task_id = ?` never matches them.

### 3. Update the three locked assertions in `migrations.test.ts`

- `:65` test name `"migrates to version 19 and creates exactly seventeen core
tables"` → `20`; `:67` `assert.equal(userVersion(db), 19)` → `20`. The
  seventeen-table list at `:68-86` is unchanged (no new tables).
- `:981` (inside the migration-18 test) `assert.equal(userVersion(db), 19);` → `20`.

## Constraints

- Version **20**. Do not write 21.
- Both stores move in one migration. A DB where `tasks.sha256` was re-stamped but
  `graph_import_map.creation_sha` was not is the exact bug this epic fixes.
- Never re-stamp a `creation_sha` that does not equal `undriftedBaseline` — that
  row's drift is real and must survive the migration.
- Do not import from `src/domain/` or `node-sha.ts` inside `migrations.ts`; the
  frozen copies exist so migration 20's meaning can never drift.
- Do not touch `initiatives.sha256`, `objectives.sha256`, or any
  `kind = 'objective'` map row.
- Do not add a port method — `GraphImportMap` (`port.ts:211-237`) stays
  `reserve` + `lookup`. The migration talks to the table directly, as all
  migrations do.

## Verify

`node --test src/storage/sqlite/migrations.test.ts`

Mirror the migration-7 data-step pattern at `:486-528` (build at N-1 with
`MIGRATIONS.slice(0, 19)`, seed fixtures, `migrate(db, MIGRATIONS)`, assert).
Import `canonicalTask`, `sha256Hex` from `../../domain/sha.ts` and
`canonicalTaskV19`, `canonicalTaskV20` from `./migrations.ts`.

1. **Frozen-copy alignment** (catches silent divergence when someone later edits
   the live canonical form): for a fixture object with no `status` field,
   `assert.equal(canonicalTaskV20(fixture), canonicalTask(fixture))`.
2. **V19 pins the old form**: `assert.equal(canonicalTaskV19({...fixture, status:
"pending"}), <the exact JSON string ending in '"status":"pending"}'>)` — write
   the expected string as a literal; it can no longer be produced by production
   code.
3. **The progressed task (the epic's case)**: seed
   `projects → initiatives → objectives → tasks` plus one `task_dependencies` row
   and one `graph_import_map` row with `kind='task'`. Task `status='completed'`;
   `tasks.sha256` = sha of `canonicalTaskV19({...content, status: "completed"})`;
   `creation_sha` = sha of `canonicalTaskV19({...content, status: "pending"})`.
   After migrating, assert **both** equal `sha256Hex(canonicalTask(content))` and
   equal each other. This is the lockstep assertion.
4. **The genuinely drifted task**: same seed, but `creation_sha` is a digest of
   _different_ content (e.g. a different title). After migrating, assert
   `tasks.sha256` equals the new status-less digest of the **live** content, and
   `creation_sha` is **byte-identical to its seeded value**, and the two still
   differ — so the next apply still classifies it `drifted`.
5. **Objective baselines untouched**: a `kind='objective'` row with `task_id`
   NULL and a known `creation_sha` is byte-identical after migrating.
6. **Multi-package**: two `graph_import_map` rows for the same `task_id`, one
   matching `undriftedBaseline` and one not. Assert only the matching row is
   re-stamped.
7. **Empty `tasks` table** migrates cleanly to version 20.

`node --test src/app/graph/apply-graph.test.ts`

- New: the **id-less map-hit path** (`apply-graph.ts:221-252`, the one branch where
  `creation_sha` is the baseline and which the Proof cannot reach) classifies a
  progressed-but-untouched task as `unchanged` when the map's `creation_sha`
  equals the live sha. This is the unit that covers the migration's
  `creation_sha` re-stamp.

`node src/main.ts db status` reports `schemaVersion: 20`.

`npm run verify` exits 0 (its last step is `node src/main.ts db status`).

Proof: precondition for the whole script — `node src/main.ts db migrate` must
reach version 20 on a fresh DB.
