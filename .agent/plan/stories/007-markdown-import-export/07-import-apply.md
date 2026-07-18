# Story 07 — `import graph --apply` — preflight-classify, merged validation, CAS apply

Epic: `.agent/plan/epics/007-markdown-import-export.md`

## Goal

`import graph <dir> --apply --initiative <id>` applies an edited package back to
its initiative in ONE `BEGIN IMMEDIATE` UnitOfWork. A **full preflight-classify**
reads every package node's current sha + live status BEFORE any write (so the
scan never sees its own writes — RB5), labels each node
created/updated/unchanged/missing/drifted/locked across ALL node types (B14),
and validates the package MERGED with omitted DB nodes (B10). If clean, it
mutates via the Story 06 CAS ops; any conflict → rollback → itemized report,
exit 1. Create idempotency is DB-durable (`graph_import_map`), so an id-less
create during apply, retried, never duplicates (TB2). Deletion of missing nodes
is Story 08.

## Locked contracts

```ts
// src/app/graph/apply-graph.ts — COMMAND use case, one UnitOfWork
export type NodeClass =
  "created" | "updated" | "unchanged" | "missing" | "drifted" | "locked";
export interface ApplyClassification {
  kind: "initiative" | "objective" | "task";
  ref: string;
  id?: string;
  sourcePath?: string;
  class: NodeClass;
  reason?: string; // reason carries expected-vs-actual (B15)
}
export interface ApplyGraphResult {
  applied: boolean;
  classifications: ApplyClassification[]; // ALL node types (B14/TS1)
  summary: {
    created: number;
    updated: number;
    unchanged: number;
    missing: number;
  };
  conflicts: ApplyClassification[]; // drifted | locked — non-empty ⇒ !applied
}
export class ApplyGraph {
  constructor(deps: {
    initiatives: InitiativeRepository; // + CAS ops (Story 06)
    tasks: TaskRepository; // + CAS ops
    storeGraph: StoreGraph; // for id-less creates
    importMap: GraphImportMap; // idempotency lookup/reserve
    uow: UnitOfWork;
    newId: () => string;
  });
  execute(input: {
    pkg: GraphPackage;
    initiativeId: string;
  }): Promise<ApplyGraphResult>;
}
```

- **CLI:** the `import graph` handler's `--apply --initiative <id>` branch
  (`src/apps/cli/import-graph.ts`, Story 05). Prints the all-node summary
  (`N created / N updated / N unchanged / N missing`), then the id-handoff
  rewrite + full re-snapshot manifest on success; on conflict prints the
  itemized report and exits 1.

## Classification rules (locked)

Per package node, in the preflight (before any write):

- **id-less + `importMap.lookup(packageId,kind,ref)` HIT** → treat as the mapped
  node; CAS against the stored `creationSha` (a mapped node drifted since
  creation is a **conflict**, never a blind update — round-5).
- **id-less + no map hit** → `created`.
- **has id, content == baseline** (`manifest.nodes[id]`) → `unchanged`.
- **has id, content differs, live DB sha == baseline** → `updated` (mutated).
- **mutated node, live DB sha != baseline** → `drifted` (conflict).
- **mutated TASK, live status != pending** → `locked` (conflict; live status
  read in the preflight, B13).
- **DB node in `manifest.files`, absent from the package** → `missing`
  (reported; Story 08 may delete). A node NOT in `files` is "not in this
  package", never missing (TB1).

CAS is scoped to package-present, MUTATED nodes only — an omitted node's drift
never blocks the apply (S2). Reparent (task `objective:` now points at a
different objective of the same initiative) is a mutated field → routed through
`conditionalReparent`; a foreign initiative ref → `CrossInitiativeError`
(Story 09).

## Merged-graph validation (B10)

Before mutating, run `validateGraph` over the package tasks MERGED with the
initiative's omitted DB tasks (dependency endpoints + cycle detection must see
persisted nodes not present in the package). A cycle/unresolved-dep spanning an
omitted task aborts with the reused domain error (Story 09).

## Post-commit (S3/RB6)

Rewrite each newly-created file with its assigned `id` (temp + atomic rename)
and rewrite `.kanthord-export.json` as a FULL re-snapshot (RB3): `nodes` =
every current DB node, `files` = the ids written as files, `refToId`
kind-scoped. A rewrite failure emits a NON-RETRYABLE re-export error — the DB
is committed + correct, and the durable idempotency row makes a blind re-apply
non-duplicating.

## Constraints

- One `UnitOfWork.transaction` only; no savepoints, no nested txn (RB5).
- No raw SQL in the use case — only Story 06 CAS ops + `StoreGraph` +
  `importMap`.
- The initiative id from `--initiative` must equal `pkg.initiative.id`; the
  ownership chain (initiative→objective→task) is verified — a foreign id →
  `CrossInitiativeError`, an unknown id → `UnknownNodeError` (Story 09).

## Verification Gate

- `node --test src/app/graph/apply-graph.test.ts
src/apps/cli/import-graph.test.ts` green; typecheck 0; lint clean.

### Task T1 — preflight classifier (hermetic, fakes)

**Requires:** Story 02 (baselines), Story 03 (DTO+manifest), Story 05
(importMap port), Story 06 (CAS result types).

**Input:** new `src/app/graph/apply-graph.ts` (classify half) + test; fakes
with per-node sha + status.

**Action — RED:** tests: (a) an unchanged package → all `unchanged`, summary
zeros except unchanged; (b) an edited task ac → that task `updated`, siblings
`unchanged`, INITIATIVE + objectives classified too (all-node coverage); (c) a
DB task whose live sha != baseline, when the package edits it → `drifted`
conflict, `applied:false`; (d) a task exported pending but now `running`, when
edited → `locked` conflict; (e) an id-less package node with a matching
`importMap` hit whose stored `creationSha` still matches → `unchanged`/`updated`
(mapped), NOT `created` (no dup); (f) a `manifest.files` id absent from the
package → `missing`. Fails today: module absent.

**Action — GREEN:** implement the classifier reading current sha + live status.

**Action — REFACTOR:** none.

**Output:** correct all-node classification incl. locked-vs-drifted.

**Verify:** `node --test src/app/graph/apply-graph.test.ts` green.

### Task T2 — merged-graph validation

**Requires:** T1.

**Input:** `apply-graph.ts` + test.

**Action — RED:** tests: (a) a package omitting a persisted task, where a
package task `depends-on` the omitted (persisted) task → validation PASSES
(dep resolves against the merged graph); (b) an edit that introduces a cycle
through an omitted persisted task → `CycleError`, `applied:false`, nothing
written; (c) a `depends-on` resolving to neither package nor DB →
`UnknownNodeError`. Fails today: validation runs on package-only.

**Action — GREEN:** merge omitted DB nodes into the node set before
`validateGraph`.

**Action — REFACTOR:** none.

**Output:** cycle/unresolved-dep detection spanning persisted omitted nodes.

**Verify:** `node --test src/app/graph/apply-graph.test.ts` green.

### Task T3 — apply execution (CAS mutate + id-less create + idempotency)

**Requires:** T1, T2; Story 06 CAS ops; Story 05 importMap adapter.

**Input:** `apply-graph.ts` (apply half) + test (fakes; one real-SQLite case
for the idempotency retry).

**Action — RED:** tests: (a) a clean edited package mutates only the changed
nodes via CAS (`compareAndApply`/rename/reparent) and returns `applied:true`
with the right summary; (b) any preflight conflict → NO CAS op is issued
(fake records zero writes), `applied:false`, `conflicts` itemized; (c) an
id-less task in the package is created (StoreGraph) AND an `importMap` row
reserved keyed by packageId; (d) re-running the SAME package (real SQLite):
the second apply finds the map row → `0 created`, no duplicate task; (e) a
reparent edit routes through `conditionalReparent`. Fails today: apply half
absent.

**Action — GREEN:** implement preflight→(validate)→mutate in one UoW; consult
`importMap` before create; CAS mapped retries against `creationSha`.

**Action — REFACTOR:** none.

**Output:** transactional apply with durable create-idempotency.

**Verify:** `node --test src/app/graph/apply-graph.test.ts` green.

### Task T4 — CLI `--apply` wiring + all-node summary + id handoff + slice e2e

**Requires:** T1–T3; Story 03 codec; Story 04 manifest writer.

**Input:** `src/apps/cli/import-graph.ts` (--apply branch) + test.

**Action — RED:** tests exercising the epic Proof's apply legs: (a) edit a
task ac, `--apply` prints `1 updated` + `4 unchanged` (all-node counts — B14),
the change lands, no dup; (b) an id-less create during `--apply` prints
`1 created`, rewrites the file with a ULID, and a re-apply prints `0 created`
(no dup); (c) reparent via editing `objective:` (to the target objective's ULID — the
exported package is ULID-based per the Story 04 ruling) prints `1 updated` and
the task moves; (d) a stale package (DB drifted) `--apply` exits 1, cites the node's
`sourcePath` + `drift`, and leaves the DB UNCHANGED (preflight rejection). Fails
today: branch absent.

**Action — GREEN:** implement the branch: parse, run `ApplyGraph`, print the
summary or the itemized conflict report, do the post-commit handoff +
re-snapshot.

**Action — REFACTOR:** none.

**Output:** the apply/reparent/no-dup/conflict-rejection legs of the epic Proof,
asserted end-to-end.

**Verify:** `node --test src/apps/cli/import-graph.test.ts` green; typecheck 0;
lint clean.
