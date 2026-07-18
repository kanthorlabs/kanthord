# Story 04 — `export initiative` — use case returns `GraphPackage`, CLI writes the tree

Epic: `.agent/plan/epics/007-markdown-import-export.md`

## Goal

`export initiative <id> --out <dir>` writes an initiative to a friendly,
re-editable markdown package. The **use case returns a `GraphPackage`** (query
side, never touches the filesystem/codec — B5/B8); the **CLI adapter serializes

- writes** the cosmetic tree + a read-only `INDEX.md` + `.kanthord-export.json`.
  Export is a pending-work VIEW: only pending tasks become files (B13), but the
  manifest `nodes` snapshot covers every DB node so drift detection has a complete
  baseline (TS1/TB1).

## Ref policy (Ulrich ruling, 2026-07-18)

Two package flavours, told apart by ref SHAPE (B6 case-disjointness):

- **Exported package (export → re-import): the ULID IS the ref.** Every node
  carries `id: <ULID>`; parent (`objective:`/`initiative:`) and `depends-on`
  reference the parent's **ULID**. Exported nodes carry NO lowercase `ref:`
  line — their effective ref is their ULID. So a re-imported export is a
  DB-tied snapshot, and reparent = paste the target's ULID into `objective:`.
- **Created package (hand-authored `--create`): lowercase slug refs.** Nodes
  carry `ref: <slug>`, no `id:`; parent + `depends-on` use slug refs. `--create`
  then assigns ULIDs and (id handoff) writes `id:` back into the files.

This confirms the epic's export bullet ("`depends-on`/parent use ULIDs"); the
epic Proof's reparent step is updated to substitute a ULID (this story's slice

- Story 07 T4 use ULIDs; Story 05 uses slugs).

## Locked contracts

```ts
// src/app/graph/export-initiative.ts — QUERY use case, returns a DTO
export class ExportInitiative {
  constructor(deps: {
    tasks: TaskRepository;
    initiatives: InitiativeRepository; /* read-only */
  });
  execute(initiativeId: string): Promise<GraphPackage>; // pending tasks only in .tasks; manifest full-snapshot
}
```

- **CLI:** `COMMANDS["export initiative"]` in `router.ts`, handler
  `runExportInitiative` in a new `src/apps/cli/export.ts`, `--out <dir>`
  required. Handler calls the use case, then `writePackage` (Story 03) +
  writes `INDEX.md` + `.kanthord-export.json`.
- **Refs:** an exported node's ref IS its ULID (no slug regeneration on export
  — the ruling above). `refToId` is kind-scoped (objectives vs tasks); for a
  pure export it is identity (ULID→ULID), and it carries meaning (slug→ULID)
  only for a `--create`/`--apply` re-snapshot that contained slug refs (TB2).
- **Manifest:** `nodes` = id→sha256 for EVERY DB node of the initiative
  (initiative + all objectives + all tasks, any status) — the sha is COPIED
  from the row, never recomputed (B16). `files` = exactly the ids written as
  files (initiative + objectives + pending tasks) — the delete-eligibility set
  (TB1). `packageId` = a fresh ULID (a package minted by export is a new
  snapshot).
- **Layout (cosmetic):** initiative dir + `<name-slug>.md`; each objective a
  nested dir + file; each pending task a file under its objective dir. File and
  dir names are human-readable slugs and are IGNORED on import (B18).
  `INDEX.md` is a generated, read-only human view (EXCLUDED from the byte-
  round-trip assertion, B16).

## Constraints

- The use case imports NO fs/codec; it reads repos and builds the DTO only
  (eslint boundaries confirm). All serialization is in `src/apps/cli/`.
- Empty objective (no tasks) → its file still written; empty initiative (no
  objectives) → just the initiative file (B/RB7 boundary).

## Verification Gate

- `node --test src/app/graph/export-initiative.test.ts
src/apps/cli/export.test.ts` green; typecheck 0; lint clean. E2E slice:
  export a created initiative, assert files + manifest exist and re-parse.

### Task T1 — `ExportInitiative` use case → `GraphPackage` (hermetic)

**Requires:** Story 02 (rows carry sha256); Story 03 DTO.

**Input:** new `src/app/graph/export-initiative.ts` + test, fakes for the repos.

**Action — RED:** tests (fakes): (a) returns one `PkgInitiative`, its
objectives, and ONLY pending tasks in `.tasks` (a `running`/`completed` task is
excluded from `.tasks`); (b) `manifest.nodes` includes EVERY node id incl. the
non-pending task, each sha COPIED from the fake row (assert exact value, not
recomputed); (c) `manifest.files` excludes the non-pending task id but includes
the initiative + objectives + pending tasks; (d) every node carries `id:
<ULID>` and NO lowercase `ref:` line (the ULID is the ref, ruling above); (e)
each `PkgTask.dependsOn` is the ULIDs of same-package tasks, and each
`objectiveRef`/`initiativeRef` is the parent's ULID. Fails today: use case
absent.

**Action — GREEN:** implement the query + ULID-ref emission + manifest assembly.

**Action — REFACTOR:** none (no slug generation on export; slug→ref generation
lives in create-mode, Story 05).

**Output:** a complete `GraphPackage` with a full-snapshot manifest and a
file-membership set.

**Verify:** `node --test src/app/graph/export-initiative.test.ts` green.

### Task T2 — CLI writes the cosmetic tree + INDEX + manifest

**Requires:** T1; Story 03 `writePackage`.

**Input:** new `src/apps/cli/export.ts` + test; `router.ts` (register
`"export initiative"`).

**Action — RED:** tests: (a) `export initiative <id> --out <dir>` writes
`<dir>/<name-slug>/<name-slug>.md` (filenames are COSMETIC slugs for
readability, B18 — identity is the frontmatter ULID), nested objective dirs,
pending-task files,
`INDEX.md`, and `.kanthord-export.json`; (b) missing `--out` → exit 1 with a
usage error; (c) the written `.kanthord-export.json` deep-equals the use
case's `manifest`; (d) the written tree re-parses (`parseGraphPackage`) to a
`GraphPackage` semantically equal to the use case's return (round-trip).
Fails today: command absent.

**Action — GREEN:** implement the handler; register the command.

**Action — REFACTOR:** none.

**Output:** a runnable `export initiative` producing a re-parseable package.

**Verify:** `node --test src/apps/cli/export.test.ts` green.

### Task T3 — slice e2e assertion (create → export)

**Requires:** T1, T2; Story 05 create-mode is NOT required — this slice may
seed via existing `create` CLI commands to keep it independent.

**Input:** `src/apps/cli/export.test.ts` (or a dedicated slice test).

**Action — RED:** a test that seeds an initiative + objective + 2 pending
tasks via the existing use cases, runs `export initiative --out`, and asserts:
files exist at the expected cosmetic (slug) paths, `id:` present in each
frontmatter (ULID) with no `ref:` line, parent/`depends-on` present as ULIDs,
`.kanthord-export.json.nodes` covers all nodes. Fails today: export absent.

**Action — GREEN:** covered by T1+T2.

**Action — REFACTOR:** none.

**Output:** the export half of the epic Proof, asserted end-to-end.

**Verify:** `node --test src/apps/cli/export.test.ts` green; typecheck 0; lint
clean.
