# Story 05 — `import graph --create` — build a new graph, assign ULIDs, id handoff

Epic: `.agent/plan/epics/007-markdown-import-export.md`

## Goal

`import graph <dir> --create --project <id>` turns a hand-authored markdown
package into a new Initiative → Objective → Task graph in ONE UnitOfWork,
reusing `StoreGraph` for the task layer. It rejects any persisted `id` (create
is for fresh graphs, B5), NEVER creates a project, assigns ULIDs, and on success
performs the **id handoff** (B1): rewrites each created file with its assigned
ULID + writes a fresh `.kanthord-export.json` — so a later `--apply` matches by
id and never duplicates. Duplication across retries is guaranteed impossible by
a DB idempotency row, not the filesystem (TB2).

## Locked contracts

```ts
// src/app/graph/create-graph.ts — COMMAND use case, runs inside a UnitOfWork
export interface CreateGraphInput {
  pkg: GraphPackage; // must have NO persisted ids anywhere
  projectId: string; // must exist; import never creates it
  packageId: string; // ULID minted by the CLI at --create
}
export interface CreateGraphResult {
  initiativeId: string;
  refToId: {
    objectives: Record<string, string>;
    tasks: Record<string, string>;
  };
  nodes: Record<string, string>; // id → creationSha (for the fresh manifest)
}
export class CreateGraph {
  constructor(deps: {
    initiatives: InitiativeRepository;
    tasks: TaskRepository;
    storeGraph: StoreGraph; // reused for the task layer
    projects: ProjectRepository; // read-only existence check
    importMap: GraphImportMap; // idempotency-row port (Story 02 table)
    uow: UnitOfWork;
    newId: () => string; // injected ULID factory (hermetic)
  });
  execute(input: CreateGraphInput): Promise<CreateGraphResult>;
}
```

- **`GraphImportMap` port** (new, in `src/storage/port.ts`) —
  `reserve(packageId, kind, ref, nodeId, creationSha): void` and
  `lookup(packageId, kind, ref): { nodeId; creationSha } | undefined`, over the
  `graph_import_map` table. Used by create (reserve) + apply (lookup, Story 07).
- **CLI:** `COMMANDS["import graph"]` handler in a new `src/apps/cli/import-graph.ts`
  dispatches on flags: `--create --project <id>` XOR `--apply --initiative <id>`
  (mode is NEVER inferred from frontmatter — B5). Create-mode mints
  `packageId`, parses the dir, runs `CreateGraph` in a transaction, then does
  the id handoff.

## Behavior (locked)

- Any persisted `id` anywhere in the package under `--create` →
  `CreateModeIdError` citing `sourcePath` (create builds fresh nodes only).
- Refs resolved package-locally (objective refs, task refs — two namespaces);
  duplicate ref → named error citing both files (Story 09). `validateGraph`
  runs over the task DAG before any write (self-dep/cycle/unknown-dep).
- One `UnitOfWork.transaction`: create the initiative, objectives, tasks
  (`StoreGraph` for tasks under each objective), and `importMap.reserve` one
  row per created objective + task, keyed by `packageId` — ALL atomic.
- Missing `--project` / non-existent project → exit 1 named error; import never
  creates a project.
- **Post-commit id handoff (S3/RB6):** rewrite each source file with its `id`
  (temp file + atomic rename) and write `.kanthord-export.json` (packageId +
  full snapshot) into the source dir. If the rewrite fails, emit a
  NON-RETRYABLE error telling the user to re-export — the DB is committed +
  correct, and a blind re-apply cannot duplicate (the idempotency row already
  exists).

## Constraints

- Reuse `StoreGraph` for tasks (do not re-implement dep remapping). The use
  case imports domain + ports only; no codec/fs (handoff rewrite is CLI-side).
- `newId` injected so tests assert deterministic ULIDs and hermetic runs.

## Verification Gate

- `node --test src/app/graph/create-graph.test.ts
src/apps/cli/import-graph.test.ts` green; typecheck 0; lint clean. E2E slice:
  `--create` a 1-initiative/2-objective/2-task package, assert exact counts +
  SRC files rewritten with ULIDs.

### Task T1 — `CreateGraph` use case (hermetic, fakes)

**Requires:** Story 01 (newTask rules), Story 02 (importMap table + port),
Story 03 (DTO). `StoreGraph` (existing).

**Input:** new `src/app/graph/create-graph.ts` + test; `GraphImportMap` added
to `src/storage/port.ts`; fakes.

**Action — RED:** tests: (a) a package with no ids creates 1 initiative + N
objectives + M tasks, returns `refToId` (kind-scoped) + `nodes`; (b) a package
containing ANY persisted `id` throws `CreateModeIdError`; (c) a non-existent
`projectId` throws (project never created); (d) `importMap.reserve` is called
once per created objective + task with the correct `(packageId, kind, ref,
id, creationSha)`; (e) a cyclic dep throws `CycleError` and NOTHING is saved
(the fake UoW records no writes). Fails today: use case absent.

**Action — GREEN:** implement `CreateGraph` reusing `StoreGraph`; add
`GraphImportMap` port + fake.

**Action — REFACTOR:** none.

**Output:** transactional create-mode with idempotency reservation.

**Verify:** `node --test src/app/graph/create-graph.test.ts` green.

### Task T2 — `GraphImportMap` SQLite adapter

**Requires:** Story 02 T1 (table), T1 above (port).

**Input:** new `src/storage/sqlite/sqlite-graph-import-map.ts` + test.

**Action — RED:** tests (real SQLite): (a) `reserve` then `lookup` round-trips
`{nodeId, creationSha}`; (b) a second `reserve` with the same
`(packageId,kind,ref)` violates `UNIQUE` (throws); (c) deleting the mapped node
row cascades the map row away (FK); (d) the SAME ref under a DIFFERENT
`packageId` is independent. Fails today: adapter absent.

**Action — GREEN:** implement the adapter; wire it in `composition.ts`.

**Action — REFACTOR:** none.

**Output:** durable ref→id idempotency store.

**Verify:** `node --test src/storage/sqlite/sqlite-graph-import-map.test.ts`
green.

### Task T3 — CLI `import graph --create` + id handoff + slice e2e

**Requires:** T1, T2; Story 03 codec (`parseGraphPackage`, `writePackage`);
Story 04 manifest writer (reuse).

**Input:** new `src/apps/cli/import-graph.ts` + test; `router.ts`.

**Action — RED:** tests: (a) `--create --project <id>` on a hand-authored dir
creates the graph; `list initiative/objective/task` return exact counts 1/2/2;
(b) each SRC file is REWRITTEN in place with `^id: <ULID>$` frontmatter
(atomic); (c) a `.kanthord-export.json` with `packageId` + full snapshot is
written to the SRC dir; (d) `--create` without `--project` → exit 1; (e)
supplying BOTH `--create` and `--apply` → exit 1 (mutually exclusive). Fails
today: command absent.

**Action — GREEN:** implement the handler (mint packageId, parse, transact,
handoff rewrite); register `"import graph"`.

**Action — REFACTOR:** none.

**Output:** the create half of the epic Proof, asserted end-to-end incl. the
id handoff.

**Verify:** `node --test src/apps/cli/import-graph.test.ts` green; typecheck 0;
lint clean.
