# Story 7 — `get conflict --objective <id>`

Epic: `.agent/plan/epics/017-decision-workbench.md`
Depends on: Story 1 (`conflictCause`, `observedTipOid`, `note` persisted).

## Change

### A. `src/app/objective/get-objective-conflict.ts`

New file. Structural sources only, mirroring
`src/app/task/get-conflict.ts:12-22`.

```ts
export interface ObjectiveConflictOutput {
  objectiveId: string;
  initiativeId: string;
  status: "conflict";
  /** Why `approve objective` recorded the conflict. `null` on pre-migration rows. */
  conflictCause: "non-single-commit" | "cas-mismatch" | null;
  /** The stale anchor the squash was built on. */
  parentOid: string | null;
  /** The candidate commit. */
  commitOid: string | null;
  /** The ref's OID observed at CAS-failure time; `null` unless `cas-mismatch`. */
  observedTipOid: string | null;
  /** The initiative branch's live tip, read now. */
  currentTip: string | null;
  /** `currentTip !== parentOid`. Live evidence, NOT the cause. */
  tipMovedSinceAnchor: boolean;
  /** Set when a conflict-resolution gate run failed. */
  conflictReason: string | null;
  /** The consolidated guidance note stored by `retry objective --note`. */
  note: string | null;
  evidence: {
    basis: "verification-and-summary";
    diffAvailable: false;
    inspect: { executable: "git"; args: string[] } | null;
  };
}

export class ObjectiveNotInConflictError extends Error {
  readonly objectiveId: string;
  readonly status: string;
  constructor(objectiveId: string, status: string) {
    super(`objective ${objectiveId} is not in conflict (status: ${status})`);
    this.name = "ObjectiveNotInConflictError";
    this.objectiveId = objectiveId;
    this.status = status;
  }
}
```

`execute(input: { objectiveId: string }): Promise<ObjectiveConflictOutput>`:

1. `getObjective(objectiveId)` → `undefined` throws
   `UnknownReferenceError("objective", objectiveId)` (`src/app/errors.ts`).
2. `(objective.status ?? "building") !== "conflict"` throws
   `ObjectiveNotInConflictError` naming the **actual** status. Never return an
   empty overview.
3. Read `currentTip` from the broker:

   ```ts
   const homeDir = resolveHomeDir(objective.initiativeId);
   const ref = `refs/heads/kanthord/init/${objective.initiativeId}`;
   const currentTip = await broker.currentTip(homeDir, ref);
   ```

   That is the exact ref built at
   `src/app/objective/retry-objective.ts:144`. `currentTip` is **optional** on the
   port (`src/objective-broker/port.ts`), so when it is absent or rejects, set
   `currentTip: null` and `tipMovedSinceAnchor: false`. A read must not fail
   because the mirror is unreadable.

4. `tipMovedSinceAnchor` is true only when all three hold:

   ```ts
   currentTip !== null && parentOid !== null && currentTip !== parentOid;
   ```

   It is **never** used to derive `conflictCause`.

5. Build `evidence.inspect` as:

   ```ts
   { executable: "git", args: ["-C", homeDir, "diff", `${parentOid}..${commitOid}`] }
   ```

   …but only when `homeDir` is non-empty and both OIDs match
   `/^[0-9a-f]{7,64}$/`; otherwise `null`. Never a single shell string.

**There is no `files` key.** An objective conflict is a stale-anchor / CAS failure
at ref-update time (`src/app/objective/approve-objective.ts:86-89,98-103`), not a
file-level merge conflict. Emitting `files: []` would imply a file list exists.

### B. The task path is untouched

Do **not** change `src/app/task/get-conflict.ts`. It reads
`getCandidateByTask(taskId)` and requires `ChangeCandidate.state === "conflict"`
(`:80-83`) — a 007.5 task **landing** conflict with real per-file hunks, reached
only via `RunNextTask`'s candidate branch
(`src/app/task/run-next-task.ts:470-507`). It is a different mechanism.

### C. CLI

`src/apps/cli/commands/get/conflict.ts` — the current `--id` is a
`requiredOption` (`:12`). Change it to `.option(...)` and add
`.option("--objective <id>", "ID of the objective to inspect")`, keeping the
existing `.configureHelp({ commandUsage: () => "kanthord get conflict" })`
(`:11`) so `get conflict --help`'s first line stays exactly
`Usage: kanthord get conflict [options]` — asserted by
`src/apps/cli/architecture.test.ts:167-178`. Add `--json`, and extend the
`Example` help text with the objective form.

`src/apps/cli/task.ts` `runGetConflict` (`:220-248`) — add the mutual-exclusion
guards **before** the existing `MissingFlagError("--id")` check, mirroring
`runGetTask`'s style (`:257-263`):

- both `--id` and `--objective` → exit 1,
  `error: --id and --objective are mutually exclusive`;
- neither → exit 1, `error: one of --id or --objective is required`;
- `--objective` → call `getObjectiveConflict`, not `getConflict`.

Because the handler now needs two use cases, give it a second parameter
`getObjectiveConflict: GetObjectiveConflict` and update the leaf's call site.

Map `ObjectiveNotInConflictError` in `src/apps/cli/error-map.ts` — add
`err instanceof ObjectiveNotInConflictError ||` beside the
`ObjectiveNotAwaitingConfirmationError` entry (`:81`); unlisted errors are
re-thrown (`:122`) rather than becoming exit 1. Re-export it from
`src/app/errors.ts`, mirroring the `CycleError` re-export at `:4`.

`--json` → stdout is the single element `JSON.stringify(output)`. Text form
prints one `key: value` line per field, and `inspect: git -C <dir> diff <a>..<b>`
rendered **shell-escaped** for copy-paste — the JSON consumer gets `args[]`.

### D. Surface `note` and the conflict fields on `get objective`

`src/app/objective/get-objective.ts` — add to `GetObjectiveOutput` (`:16-23`) and
the returned literal (`:59-69`): `commitOid`, `parentOid`, `conflictCause`,
`conflictReason`, `note`, each `string | null`. Proof phase H reads the objective
note through `get objective --json`, because a successful `retry objective` moves
the objective to `awaiting_confirmation`, which `get conflict --objective`
refuses by contract.

`src/apps/cli/objective.ts` `runGetObjective` (`:61-95`) — print the new fields in
the text branch only when non-null; the `--json` branch (`:69`) already emits the
whole output object, so it needs no change.

> EPIC 016 story 03 also adds `commitOid` to a read view (its graph payload) and
> EPIC 012 story 03 adds `commitOid` to the objective read view. If either has
> already added a field here, extend rather than duplicate.

### E. Wiring

- `src/apps/cli/deps.ts` — add `getObjectiveConflict: GetObjectiveConflict;` to
  `CliDeps` with an `import type`.
- `src/composition.ts` — construct beside `getConflict` (`:591-596`) and add to
  the returned literal (`:850-920`), with **arrow wrappers** only:
  ```ts
  const getObjectiveConflict = new GetObjectiveConflict(
    { getObjective: (id) => initiativeRepository.getObjective(id) },
    { currentTip: (dir, ref) => objectiveBroker.currentTip!(dir, ref) },
    (initiativeId) => resolveHomeDir(initiativeId),
  );
  ```
  Use the same `resolveHomeDir` the objective use cases already receive
  (`src/app/objective/retry-objective.ts` gets it via its store's
  `resolveHomeDir`, wired in `composition.ts`).

## Constraints

- Read-only: no `UnitOfWork`, no event append, no `save*`.
- No `files` key in `ObjectiveConflictOutput`.
- `conflictCause` is read from the column, never inferred from `currentTip`.
- Do not modify `src/app/task/get-conflict.ts` or `ConflictOverview`.
- Keep `get conflict`'s help usage string exactly `kanthord get conflict`.
- Add no migration — story 1 owns the columns.

## Verify

- New `src/app/objective/get-objective-conflict.test.ts`:
  - `(017-S7-unknown)` unknown id → rejects with `UnknownReferenceError`.
  - `(017-S7-not-conflict)` each of `building`, `awaiting_confirmation`,
    `integrated`, `discarded` → rejects with `ObjectiveNotInConflictError` whose
    `status` equals the actual status. Parameterised loop, mirroring
    `src/app/objective/reject-objective.test.ts:128-182`.
  - `(017-S7-fields)` a conflict objective with all columns set → every field is
    returned verbatim, and `"files" in output === false`.
  - `(017-S7-cause-not-inferred)` `conflictCause: "cas-mismatch"` with
    `currentTip === parentOid` → `conflictCause` stays `"cas-mismatch"` and
    `tipMovedSinceAnchor === false`. The pair must be independent.
  - `(017-S7-tip-moved)` `currentTip !== parentOid` → `tipMovedSinceAnchor` is
    `true`.
  - `(017-S7-legacy-row)` no `conflictCause` column value → `conflictCause` is
    `null`, and the call still succeeds.
  - `(017-S7-broker-absent)` a broker with no `currentTip`, and one whose
    `currentTip` rejects → `currentTip: null`, `tipMovedSinceAnchor: false`, no
    throw.
  - `(017-S7-inspect)` valid OIDs → `inspect.args` deep-equals
    `["-C", "/home", "diff", "<parent>..<commit>"]`; a missing `commitOid` or a
    malformed OID → `inspect === null`.
  - `(017-S7-no-writes)` sources whose write methods throw → resolves.
- `node --test src/apps/cli/get-conflict.test.ts` — `runGetConflict`:
  both flags → exit 1 with the exact message; neither → exit 1 with the exact
  message; `--objective` routes to `getObjectiveConflict`; `--id` still routes to
  `getConflict` and still maps `NoConflictCandidateError` to
  `error: no conflict candidate found for task <id>` (the existing assertion must
  stay green).
- `node --test src/apps/cli/commands/read.test.ts` — `get conflict --help`
  contains `Usage: kanthord get conflict`, `--objective <id>` and the literal
  `Example`.
- `node --test src/apps/cli/architecture.test.ts` — must stay green. This story
  adds **no leaf file and no leaf**, so neither counter changes; the
  `["get","conflict"]` MATRIX pair (`:168`) must still print
  `Usage: kanthord get conflict [options]`.
- `node --test src/app/objective/get-objective.test.ts` — the new fields appear in
  the output; an objective with none of them set returns `null` for each; the
  existing `waiting` / `after` / `integrations` assertions stay green.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/decision-workbench-proof.sh` phases **F**, **G**, **H**, and
  the `get conflict --objective` invocations in phase **J**.
