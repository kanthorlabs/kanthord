# Story 5c — `after:` on the `--apply` path + confirm-before-delete

Epic: `.agent/plan/epics/007.17-follow-up-sequencing-edges.md`
Depends on: Story 1 (`validateDag`), Story 2 (`SequencingRepository`, `after` in the canonical form), Story 5a (codec), Story 5b (create path + id handoff)

Scope fence: `apply-graph.ts`, the `--apply` branch of `import-graph.ts`, and the
two new CAS methods on `InitiativeRepository`. Do **not** revisit the codec or the
create path.

## Change

### 5c.1 Classification — `src/app/graph/apply-graph.ts`

Switch the two intended-sha computations that Story 2 pointed at the live set to
the package's resolved set:

- `apply-graph.ts:148-153` → `after: resolvedInitAfter`
- `apply-graph.ts:171-176` → `after: resolvedObjAfter.get(obj.id) ?? []`

Resolution in apply mode: entries are already ULIDs in an exported package
(`obj.initiativeRef` is a ULID, `graph-codec.ts` comment at `:174`). Resolve each
entry through the same `refToId` map apply already builds for tasks
(`apply-graph.ts:378-381`, `refToId.get(dep) ?? dep`), then
`[...new Set(x)].sort()`. Cross-initiative / unknown-ULID checks reuse the existing
helpers at `apply-graph.ts:336-360`.

### 5c.2 Merged-graph validation

Beside the existing task `validateGraph` (`apply-graph.ts:395`) add an
objective-level check over the merged objective DAG — package objectives with their
resolved `after`, plus every other objective of the initiative with its live set
from `sequencing.listObjectiveDag(initiativeId)` — via `validateDag`.

### 5c.3 Two new narrow CAS methods

The `updated` branch calls `conditionalRenameInitiative` (`apply-graph.ts:513-522`)
and `conditionalRenameObjective` (`:528-540`). **Leave both signatures alone.**
Name and `after` live in one sha, but the codebase already has the pattern for two
sequential CAS writes on one row: thread the first call's `freshSha` into the
second. `apply-graph.ts:496-501` does exactly this for a task that changed both
spec and parent — `conditionalReparent(cls.id, casResult.freshSha, …)` with the
comment "reparent using the fresh sha returned by compareAndApply (the row's sha
changed after the update)".

So add **one** narrow CAS method per level on `InitiativeRepository`
(`src/storage/port.ts:91-102`), beside the existing rename methods:

```ts
  /** Conditionally replace an initiative's `after` set when its sha matches. */
  conditionalSetInitiativeAfter(
    id: string,
    expectedSha: string,
    after: string[],
  ): CasResult;
  /** Conditionally replace an objective's `after` set when its sha matches. */
  conditionalSetObjectiveAfter(
    id: string,
    expectedSha: string,
    after: string[],
  ): CasResult;
```

`SqliteInitiativeRepository`: same sha guard as `conditionalRenameObjective`
(`sqlite-initiative-repository.ts:250-262`), then `DELETE FROM <edge table> WHERE
<owner> = ?`, one `INSERT OR IGNORE` per id of `[...new Set(after)].sort()`, then
`UPDATE … SET sha256 = <fresh>` computed from the sorted set; return
`{ status: "applied", freshSha }`.

The five structural `InitiativeRepository` fakes
(`src/app/graph/apply-graph.test.ts:75`, `create-graph.test.ts:37`,
`export-initiative.test.ts:165`, `src/app/objective/create-objective.test.ts:16`,
`src/app/graph/boundary-cases.test.ts:85`) gain the two new methods as stubs
returning `{ status: "conflict", currentSha: "" }`, matching how they already stub
the existing CAS methods. **No existing method is renamed**, so no fake call site
changes.

### 5c.4 Apply an `updated` node

Per level (initiative shown; objective is the twin):

```ts
const renameResult = this.#deps.initiatives.conditionalRenameInitiative(
  cls.id,
  baselineSha,
  pkg.initiative.name,
);
if (renameResult.status === "conflict") {
  throw new LateCasConflict(cls);
}
// The rename changed the row's sha — thread the fresh one, the
// same way the task branch threads it into conditionalReparent.
const afterResult = this.#deps.initiatives.conditionalSetInitiativeAfter(
  cls.id,
  renameResult.freshSha,
  resolvedInitAfter,
);
if (afterResult.status === "conflict") {
  throw new LateCasConflict(cls);
}
```

Both writes sit inside the existing single `uow.transaction`
(`apply-graph.ts:436`), so a `LateCasConflict` from either aborts the whole apply.

### 5c.5 Edge removal is never implicit — confirm before deleting

An `after:` entry present in the DB but absent from the file must **not** be
deleted silently. This mirrors the rule the node path already enforces: a node
missing from the package classifies `missing` and is only deleted when
`--delete-missing` + `--confirm-delete` are given (`import-graph.ts:216-230`,
`apply-graph.ts:616-640`). Absence from a file is never by itself a deletion
instruction.

For each package initiative/objective, diff the resolved `after` set against the
live set:

```ts
const liveAfter = this.#deps.sequencing.listObjectiveAfter(obj.id);
const added = resolved.filter((d) => !liveAfter.includes(d));
const removed = liveAfter.filter((d) => !resolved.includes(d));
```

- **Additions** apply as part of 5c.4's existing `updated` handling.
- **Removals** are gated:
  - `input.confirmDelete !== true` → the apply is **refused**. Emit one
    `ApplyClassification` per removal so the CLI can print
    `would remove edge: <ownerId> -> <depId>`, and count them into a new
    `refused:` clause `N edge removal(s) need --confirm-delete` (stderr, exit 1)
    alongside the existing `drifted` / `locked` clauses
    (`import-graph.ts:288-299`).
  - `input.confirmDelete === true` → apply the removal through the same
    `conditionalSet*After` CAS as 5c.4, and print
    `removed edge: <ownerId> -> <depId>` on stdout.
- A **`drifted` owner is refused first**, before any edge diff — the existing rule,
  unchanged. This is what makes the confirmation safe: because `after` is inside
  the sha (Story 2), an edge added to the DB by `add objective-dependency` after
  the export re-stamps the owner's sha, so `liveSha !== baselineSha` → `drifted` →
  refuse. Without `after` in the sha, that case would be indistinguishable from an
  intentional file-side deletion, and the confirmation would be asking the human to
  approve reverting a change they never saw.

`--dry-run` reports the `would remove edge:` lines and exits 0, writing nothing.

Exact strings (the Proof greps them):

| situation                       | stream | line                                               |
| ------------------------------- | ------ | -------------------------------------------------- |
| removal detected, not confirmed | stdout | `would remove edge: <owner> -> <dep>`              |
| removal detected, not confirmed | stderr | `refused: N edge removal(s) need --confirm-delete` |
| removal confirmed and applied   | stdout | `removed edge: <owner> -> <dep>`                   |

## Constraints

- Reuse `validateDag` (Story 1); do not write a second cycle detector.
- Do not rename `conditionalRenameInitiative` / `conditionalRenameObjective`.
- Objective `after` edges may not cross initiatives.
- Do not fix `--apply`'s false-success / unresolved-ref defects (F1, F2) — they
  belong to EPIC 007.16 Story 3 (Non-goal).

## Verify

`src/app/graph/apply-graph.test.ts`:

1. **Reorder is a no-op.** Seed an objective whose live `after` is `[A, B]` with a
   matching baseline sha; apply a package declaring `after: [B, A]` → the objective
   classifies `unchanged`, `result.conflicts` is empty, `result.applied` is `true`.
   Unit form of Proof claim 8.
2. **A real edge addition is `updated` and is written.** Live `after` `[A]`,
   package `after: [A, B]` → classifies `updated`; `conditionalRenameObjective` is
   called with the manifest baseline sha, then `conditionalSetObjectiveAfter` is
   called with **that call's `freshSha`** (not the baseline) and `after` deep-equal
   `[A, B]` sorted. Assert the recorded call order and the threaded sha.
3. `--dry-run` on case 2 classifies `updated` but calls no CAS method.
4. If `conditionalSetObjectiveAfter` returns `conflict`, the whole apply reports
   `applied: false` and the rename is rolled back with it (one transaction,
   `LateCasConflict`).
5. A drifted objective (live sha ≠ baseline) still classifies `drifted` and blocks
   the apply — regression on `apply-graph.test.ts:560-590`.
6. An objective `after` entry naming an objective of a different initiative →
   `CrossInitiativeError`.
7. Merged objective DAG cycle (package edge + a live edge closing a loop) →
   `CycleError` before any write.
8. **Edge removal without confirmation is refused.** Live `after` `[A, B]`,
   package `after: [A]`, `confirmDelete` unset → `result.applied` is `false`, one
   classification carries the removal of `B`, and no CAS method is called (the edge
   survives).
9. Same input with `dryRun: true` → the removal is reported, `applied` is `false`,
   nothing is written.
10. Same input with `confirmDelete: true` → `conditionalSetObjectiveAfter` is
    called with `[A]` and the result reports the removal.
11. **A DB-side edge addition is `drifted`, not a confirmable removal.** Baseline
    sha computed with `after: [A]`, live edge set `[A, B]` (so live sha differs),
    package `after: [A]` → the objective classifies `drifted` and the apply is
    refused **even with `confirmDelete: true`** — the human is never asked to
    approve reverting a change they did not make.
12. Adding an edge via the file needs no confirmation: live `[A]`, package
    `[A, B]` → `updated`, applied, no removal reported.
13. Initiative-level twins of cases 1, 8 and 10 (the gate is not objective-only).

`src/apps/cli/import-graph.test.ts`:

14. The three exact strings render as specified: `would remove edge: <o> -> <d>`
    (stdout), `refused: 1 edge removal(s) need --confirm-delete` (stderr, exit 1),
    and `removed edge: <o> -> <d>` (stdout, exit 0) under `--confirm-delete`.
15. `--dry-run` with a pending removal exits **0** and prints the
    `would remove edge:` line.

`src/app/graph/graph-roundtrip.integration.test.ts`:

16. create → export → re-import `--apply --dry-run` over a package containing both
    an initiative-level and an objective-level `after` reports every node
    `unchanged` and zero `drifted`.

Commands:

- `node --test src/app/graph/ src/apps/cli/import-graph.test.ts`
- `npm run verify` exits 0

Proof: delivers claims 8 (reorder is a no-op), 9 (a dropped edge is refused and
named) and 11 (`--confirm-delete` applies the removal).
