# Story 02 — Per-row `sha256` token + write-hook + idempotency table (migration 6)

Epic: `.agent/plan/epics/007-markdown-import-export.md`

## Goal

Every `initiatives`/`objectives`/`tasks` row carries a `sha256` version token
maintained by an APPLICATION write-hook (never DB triggers, B4). The token is
the hash of the node's canonical aggregate INCLUDING its parent ref + status,
so a spec edit, a dependency edit, a reparent, or a status change all bump it
(B14). Migration 6 also adds the durable idempotency table create-mode uses to
guarantee it never duplicates a ref-created node (TB2/round-5). This story is
the storage groundwork; the CAS _read/compare_ ops are Story 06.

## Locked contracts (exact names — tests assert verbatim)

### Migration 6 — `epic-007-sha256-and-idempotency` (slot 6)

```sql
ALTER TABLE initiatives ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE objectives  ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks       ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
-- Greenfield (B13): no backfill mechanism; a fresh DB has no rows, and the
-- write-hook stamps the real token on every save. DEFAULT '' only satisfies
-- NOT NULL for the (empty) existing table.

CREATE TABLE graph_import_map (
  package_id   TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('objective','task')),
  ref          TEXT NOT NULL,
  objective_id TEXT REFERENCES objectives(id) ON DELETE CASCADE,
  task_id      TEXT REFERENCES tasks(id)      ON DELETE CASCADE,
  creation_sha TEXT NOT NULL,
  UNIQUE(package_id, kind, ref),
  CHECK ((objective_id IS NOT NULL) <> (task_id IS NOT NULL))  -- exactly one
);
-- FK ON DELETE CASCADE is real (open.ts sets PRAGMA foreign_keys=ON): deleting
-- a node drops its mapping, so a later id-less node may reuse the ref. node_id
-- is read as COALESCE(objective_id, task_id). Keyed by a durable packageId
-- (round-5) so two different packages reusing a ref never collide.
```

### Canonicalizer (B12/B16 — the ONE normative field list + encoding)

`src/storage/sqlite/node-sha.ts` (adapter-internal; the exporter never
recomputes — it COPIES the row's sha, B16):

```ts
// Deterministic, collision-safe: JSON.stringify over a fixed key-insertion
// order. dependencies are a SET (sorted); ac/verification are ORDERED arrays;
// absent verification encodes as null. Hash = sha256 hex of the UTF-8 bytes.
export function canonicalTask(t: {
  title: string;
  instructions: string;
  ac: string[];
  agent: string;
  verification: string[] | undefined;
  dependencies: string[];
  objectiveId: string;
  status: string;
}): string; // JSON.stringify({ title, instructions, ac, agent,
//   verification: t.verification ?? null,
//   dependencies: [...t.dependencies].sort(),
//   objectiveId: t.objectiveId, status: t.status })
export function canonicalObjective(o: {
  name: string;
  initiativeId: string;
}): string;
export function canonicalInitiative(i: {
  name: string;
  projectId: string;
}): string;
export function sha256Hex(canonical: string): string; // node:crypto
```

## Write-hook — EVERY mutation path (B6)

The audit found dependency edits use `addDependency`/`removeDependency`
(separate SQL from `save`) — the same missed-write-path risk that killed the
counter. The hook stamps `sha256` inside the SAME statement/txn on:

- `TaskRepository.save` / `saveAll` — recompute from the assembled aggregate
  (row + its `task_dependencies`) and write `sha256` in the INSERT/UPSERT.
- `TaskRepository.addDependency` / `removeDependency` — after the
  `task_dependencies` change, re-read the task's deps, recompute, `UPDATE tasks
SET sha256=? WHERE id=?` in the same call.
- `InitiativeRepository.save` (initiative) / `saveObjective` (objective) —
  stamp on insert/upsert.
- Status transitions persist via `save`, so they are covered by the `save`
  hook (status is in the hashed aggregate).

## Constraints

- No DB triggers (B4 ruling). One place computes the token — the repo — so no
  two-canonicalizer divergence is possible.
- `node-sha.ts` is adapter-internal (`src/storage/sqlite/`); the app/domain
  layers never import it. The exporter reads the stored column, never hashes.

## Verification Gate

- `node --test src/storage/sqlite/node-sha.test.ts
src/storage/sqlite/sqlite-task-repository.test.ts
src/storage/sqlite/sqlite-initiative-repository.test.ts
src/storage/sqlite/migrations.test.ts` green; typecheck 0; lint clean;
  `node src/main.ts db status` shows version 6 on a migrated DB.

### Task T1 — migration 6 (columns + idempotency table)

**Requires:** nothing (extends the migration list).

**Input:** `src/storage/sqlite/migrations.ts`, `migrations.test.ts`.

**Action — RED:** tests: (a) after `migrate`, `PRAGMA user_version` = 6;
(b) `sha256` column exists on all three tables (`PRAGMA table_info`); (c)
`graph_import_map` exists with the `UNIQUE(package_id,kind,ref)` + the
exactly-one CHECK (inserting both/neither of objective_id/task_id fails); (d)
deleting a task row cascades its `graph_import_map` row (FK). Fails today:
migration 6 absent.

**Action — GREEN:** append migration 6 with the locked DDL.

**Action — REFACTOR:** none.

**Output:** schema at version 6 with the token columns + idempotency table.

**Verify:** `node --test src/storage/sqlite/migrations.test.ts` green;
`node src/main.ts db migrate && node src/main.ts db status` prints version 6.

### Task T2 — canonicalizer + `sha256Hex`

**Requires:** T1 (only for the shared package; logically independent).

**Input:** new `src/storage/sqlite/node-sha.ts` + `node-sha.test.ts`.

**Action — RED:** tests: (a) `canonicalTask` is stable — same input twice →
identical string; (b) reordering a task's `dependencies` array yields the SAME
canonical string (SET semantics), but reordering `ac` yields a DIFFERENT one
(ordered); (c) `verification: undefined` and `verification: []` produce
DIFFERENT strings (`null` vs `[]`); (d) a title with an embedded quote/newline
is JSON-escaped, no collision with a differently-partitioned input; (e)
`sha256Hex` matches a known `node:crypto` vector. Fails today: module absent.

**Action — GREEN:** implement the three canonicalizers + `sha256Hex`.

**Action — REFACTOR:** none.

**Output:** the single normative token encoding, hermetically pinned.

**Verify:** `node --test src/storage/sqlite/node-sha.test.ts` green.

### Task T3 — write-hook on every task mutation path

**Requires:** T1, T2.

**Input:** `src/storage/sqlite/sqlite-task-repository.ts`, its test.

**Action — RED:** tests (real SQLite): (a) after `save(task)`, `SELECT sha256`
equals `sha256Hex(canonicalTask(...))` for that task; (b) `saveAll` stamps each
row; (c) `addDependency` bumps the token to a value different from before AND
equal to the recomputed aggregate (deps now include the new one); (d)
`removeDependency` bumps it back; (e) a `save` after a status transition
(pending→running) produces a different token than the pending row. Fails today:
no `sha256` written.

**Action — GREEN:** compute + stamp `sha256` in `save`/`saveAll`/
`addDependency`/`removeDependency`.

**Action — REFACTOR:** extract the "assemble aggregate → canonicalTask →
stamp" into one private helper reused by all four paths (one place, fails safe).

**Output:** every task mutation path refreshes the token in the same txn.

**Verify:** `node --test src/storage/sqlite/sqlite-task-repository.test.ts`
green.

### Task T4 — write-hook on initiative + objective

**Requires:** T1, T2.

**Input:** `src/storage/sqlite/sqlite-initiative-repository.ts`, its test.

**Action — RED:** tests: (a) `save(initiative)` stamps
`sha256Hex(canonicalInitiative({name, projectId}))`; (b) `saveObjective` stamps
`canonicalObjective({name, initiativeId})`; (c) re-saving with a changed name
bumps the token. Fails today: no `sha256` written.

**Action — GREEN:** stamp on `save` + `saveObjective`.

**Action — REFACTOR:** none.

**Output:** initiative/objective tokens maintained on every save.

**Verify:** `node --test src/storage/sqlite/sqlite-initiative-repository.test.ts`
green; typecheck 0; lint clean.
