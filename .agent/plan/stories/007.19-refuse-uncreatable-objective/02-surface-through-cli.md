# Story 2 — Surface the refusal through the CLI

Epic: `.agent/plan/epics/007.19-refuse-uncreatable-objective.md`
Depends on: Story 1 (`UncreatableObjectiveError` must exist before it can be mapped).

## Change

### 1. `src/apps/cli/error-map.ts` — register the class

Add `UncreatableObjectiveError` to the existing `./../../app/graph/import-errors.ts`
import group at `:22-29`, then add one clause to the `instanceof` disjunction inside
`toResult`, immediately after the `err instanceof StaleManifestError` clause at `:68`:

```ts
    err instanceof UncreatableObjectiveError ||
```

`toResult` is a flat `instanceof` disjunction, not a table or a switch — match that
style. It returns `{ exitCode: 1, stderr: [`error: ${err.message}`] }` and **re-throws
anything unrecognized** (`:78`). That re-throw is exactly why the error currently
escapes as a stack trace: registration here is the whole fix.

### 2. `src/apps/cli/import-graph.ts` — no change expected

The boundary already exists from EPIC 007.18 Story 3: `runApply` declares
`let result: ApplyGraphResult` at `:176`, wraps the single `await applyGraph.execute`
in `try`, and returns `{ ...toResult(err), stdout: [] }` at `:186`. Once the class is
registered in `toResult`, a throw from Story 1 short-circuits there and never reaches
the formatting at `:192-349`, so `stdout` is `[]` and the only output is the single
`error: <message>` line.

Verify this by reading `:158-192`. If it is intact, this story edits **only**
`error-map.ts`. Do not add a second boundary and do not add a refusal line to the
stderr block at `:316-349` — that block is driven by a _returned_ result's
`conflicts`, and a thrown error never produces a result.

## Constraints

- **One stderr line, empty stdout, exit 1.** The shape is fixed by `toResult` and
  the `stdout: []` spread; do not introduce a different shape for this error.
- Do not reorder or restructure the existing `instanceof` clauses in `toResult`.
- Do not touch the per-node/summary formatting at `import-graph.ts:192-242` or the
  conflict-refusal stderr block at `:316-349`. Proof case 3 asserts the output
  contains **no** stack frames, which the error path already guarantees; adding a
  formatting branch would be dead code.
- `DriftConflictError` is registered in `toResult` but never thrown by `ApplyGraph`.
  Leave it alone — it is out of scope.

## Verify

`node --test src/apps/cli/import-graph.test.ts`

New test in `src/apps/cli/import-graph.test.ts`, reusing the existing
`FakeApplyGraphThatThrows` class (`:1337-1346`) and copying the shape of the 007.18
boundary test at `:1348-1359`:

1. **The mapped one-liner.** Construct
   `new UncreatableObjectiveError(DR_INIT_ID, [{ objectiveRef: "orphan-obj", taskRefs: ["orphan-task"] }])`,
   pass it to `FakeApplyGraphThatThrows`, call `runImportGraph` with
   `{ dir, create: false, apply: true, initiative: DR_INIT_ID }` over
   `makeExportedDir()` (`:369-467`), then assert exactly:
   - `result.exitCode === 1`
   - `assert.deepEqual(result.stdout, [])`
   - `assert.deepEqual(result.stderr, [`error: ${err.message}`])`
2. **The message reaches the user intact.** Assert `result.stderr[0]` contains
   `"orphan-obj"` and `"kanthord create objective --initiative"`. This is the
   assertion Proof case 3's `grep -q 'orphan-obj'` mirrors at the program level.
3. **Not an unhandled rejection.** Assert `runImportGraph` resolves rather than
   rejects — i.e. wrap nothing in `assert.rejects`. Before this story `toResult`
   re-throws at `:78` and the call would reject.
4. **Regression — an unregistered error still re-throws.** Pass a plain
   `new Error("boom")` to `FakeApplyGraphThatThrows` and assert `runImportGraph`
   rejects. Pins that Story 2 widened the map by exactly one class and did not turn
   `toResult` into a catch-all.

`npm run verify` exits 0.

Proof: delivers the remaining half of Proof case 3 — the refusal is a mapped
one-liner containing `orphan-obj`, with no `InvalidObjectiveIdError`, no
`FOREIGN KEY constraint failed`, and no `at ApplyGraph.execute` stack frame.
