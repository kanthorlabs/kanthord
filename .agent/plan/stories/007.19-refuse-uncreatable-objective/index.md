# EPIC 007.19 — Refuse an apply that references an uncreatable objective — stories

Epic: `.agent/plan/epics/007.19-refuse-uncreatable-objective.md`
Prereq: EPIC 007.18 (sequence order).

After this epic, an `import graph --apply` whose package references an objective
that does not exist is refused at preflight with one actionable stderr line naming
the objective — instead of silently dropping it, promising `would create` in
`--dry-run`, and then dying mid-transaction with a stack trace.

## Dispatch order

1. **Story 1** — preflight detection + the new error class.
2. **Story 2** — CLI registration. Depends on Story 1's class existing.
3. **Story 3** — run the Proof. Verification only; passes only after 1 and 2.

Stories 1 and 2 are a coupled pair: Story 1 alone makes `ApplyGraph` throw an error
that `toResult` does not recognize, so `toResult` re-throws (`error-map.ts:78`) and
the CLI still prints a stack trace. Proof case 3 fails until Story 2 lands. Do not
signal ready between them.

Story 3 has no `Action — RED:` and no edits — it is a GREEN-only run-through.

## Stories

- 1 — Preflight detection: `UncreatableObjectiveError`, thrown after classification
  and before the write gate → `01-preflight-refuse-uncreatable-objective.md`
- 2 — Register the class in `toResult` so the existing 007.18 boundary maps it to one
  stderr line → `02-surface-through-cli.md`
- 3 — Run the committed Proof scripts; confirm `007.19 PROOF OK` →
  `03-proof-scripts.md`

## Facts (needed for implementation)

- **The bug is an asymmetry.** `apply-graph.ts:683` collects id-**less** TASKS
  (`pkgTaskByRef`, consumed at `:815` to create them); `:686` collects only
  id-**bearing** OBJECTIVES (`pkgObjById`, consumed at `:801` for renames). There is
  no objective-creation branch: `cls.class === "created"` is handled only for
  `cls.kind === "task"` (`:814`).
- **An id-less objective is invisible today.** The classify loop guards
  `if (obj.id !== undefined)` (`:279`), so it emits no classification at all — not
  `created`, not `missing`. It survives only at `:248`, folded into `objRefToId` as
  `[o.ref, o.ref]`, which is how its bare ref slug reaches a live-ULID column.
- **Insertion point for the throw: after `:665`, before `:673`.** `:665` ends the
  `summary` literal — all classification is complete. `:673` is the write gate
  `if (… && !input.dryRun)`, which `--dry-run` skips. Between them nothing mutates
  state (`:679-687` build read-only maps). Before `:673` is what makes `--dry-run`
  exit non-zero, which Proof case 1 requires.
- **`uow.transaction` opens at `:702`** — the last possible moment, far too late:
  007.18's repository guard already throws there, and that is the mid-transaction
  stack trace this epic replaces.
- **One resolver only.** `objRefToId` / `resolveObjectiveId` at `:247-251`, hoisted
  above the classify pass by 007.18 precisely so classify and write agree
  (see its comment at `:688-689`). Four call sites: `:324`, `:358`, `:729-731`,
  `:819-821`. Reuse it; do not add a second.
- **Existence probe: `initiatives.getSha256(id)`.** Already this file's idiom for
  objective existence at `:281`, `:427`, and `:462`. `getObjective(id)`
  (`storage/port.ts:74`) also exists but is never called from this file. Using
  `getSha256` needs no port change and works with the existing test fakes.
- **The earlier ULID check already covers bogus ULIDs.** `:457-465` throws
  `UnknownNodeError` when `ULID_RE_APPLY.test(task.objectiveRef)` and the id is in
  neither package nor DB. It runs before `:665`, so it wins; the new check only ever
  sees non-ULID refs. `ULID_RE_APPLY` is `/^[0-9A-HJKMNP-TV-Z]{26}$/` (`:39-40`).
- **Error-class convention** (`import-errors.ts`): 12 classes, every one
  `extends Error` directly — no shared base. `readonly` fields first, positional
  constructor args, `super(<template message, often with an embedded remedy
command>)`, then `this.name = "X";`, then assignments. `StaleManifestError`
  (`:130-150`) is the template. `ExecutorBindingSetError` (`:233-249`) is the
  precedent for joining many violations into one message.
- **`toResult` is a flat `instanceof` disjunction**, not a table
  (`error-map.ts:44-79`). It returns
  `{ exitCode: 1, stderr: [`error: ${err.message}`] }` and **re-throws** unknown
  errors at `:78` — that re-throw is why the current failure is a stack trace.
- **The CLI boundary already exists** from 007.18 Story 3:
  `import-graph.ts:176` (`let result`), the `try` around the single
  `await applyGraph.execute`, and `:186`
  `return { ...toResult(err), stdout: [] };`. A thrown error short-circuits there and
  never reaches the formatting at `:192-349`.
- **Remedy string** — both flags are `requiredOption` on
  `commands/create/objective.ts:12-13`:
  `kanthord create objective --initiative <id> --name <name>`.
- **`input.initiativeId`, not `manifest.initiativeId`**, in the new error. This is
  deliberately the opposite of 007.18's `StaleManifestError`: the remedy is to create
  the objective on the initiative being applied to.
- **No existing test covers an id-less objective in an `--apply` package.** Id-less
  objectives appear only in `CreateGraph` fixtures (`create-graph.test.ts:245-276`,
  `boundary-cases.test.ts:294-308`); every `apply: true` CLI test uses
  `makeExportedDir`, whose objective carries an `id:`. The nearest apply-side shape is
  `apply-graph.test.ts:1770-1800` (id-bearing objective with a slug `ref` + id-less
  task), which must be adapted by dropping the objective's `id`.
- **Test construction** — `new ApplyGraph(makeDeps())`, `makeDeps` at
  `apply-graph.test.ts:551-567`; hermetic class-based fakes, with CAS spies
  `FakeTaskRepositoryWithCas` (`:381`) and `FakeGraphImportMapWithSpy` (`:409-422`)
  for "nothing was written" assertions. Baseline shas are always computed with the
  real canonicalizers (`:73-103`), never hand-written hex. CLI side:
  `FakeApplyGraphThatThrows` (`import-graph.test.ts:1337-1346`) with the boundary-test
  shape at `:1348-1359`.
- **Both Proof scripts are already committed** (`4687022`) and are lane-forbidden to
  modify (`scripts/lane-check.sh:12`) but always allowed to run. Recorded
  pre-implementation failure: `FAILED: … line 65` (`test "$DRY_STATUS" -ne 0`).
