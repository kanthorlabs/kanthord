# Story 3 — The confirm protocol on `reject task` and `reject objective`

Epic: `.agent/plan/epics/017-decision-workbench.md`
Depends on: Story 2 (`previewDiscard`). Depends on EPIC 012 story 04
(`--expected-commit` REQUIRED on objective verdicts).

## Change

### A. `RejectTask`

`src/app/task/reject-task.ts`.

1. Add to the store interface (`:34-46`), which already has
   `listByInitiative`, `getInitiativeId`, `listObjectives`, `getInitiative`:
   ```ts
   listInitiativesByProject(projectId: string): Initiative[];
   getProjectId(initiativeId: string): string | undefined;
   listInitiativeAfter(initiativeId: string): string[];
   listObjectiveAfter(objectiveId: string): string[];
   ```
   These supply `ImpactObjective.after` / `ImpactInitiative.after`, which the
   current store cannot produce.
2. Extend the `execute` input (`:66-70`):
   ```ts
   dryRun?: boolean;
   expectImpact?: string;
   ```
3. Add a new typed error, beside `RejectionConflictError` (`:18-32`):
   ```ts
   export class ImpactChangedError extends Error {
     readonly expected: string;
     readonly actual: string;
     constructor(expected: string, actual: string) {
       super(`impact changed: expected ${expected}, found ${actual}`);
       this.name = "ImpactChangedError";
       this.expected = expected;
       this.actual = actual;
     }
   }
   ```
4. Widen the return type to
   `Promise<{ skipped: string[]; preview: DiscardPreview } | undefined>` and add
   a `preview` field to **every** existing `return` (`:98`, `:151`, `:269`).
5. Build the preview once, in a private method, from the store reads:
   ```ts
   #buildPreview(taskId: string, initiativeId: string | undefined): DiscardPreview
   ```
   It assembles `ImpactInput` with `target: {type:"task", id: taskId}` and calls
   `previewDiscard`.
6. **Ordering inside `execute`** — insert after the resolution guards
   (`:102-104`) and before `this.#uow.transaction` (`:106`):
   - Compute `preview = this.#buildPreview(...)`.
   - If `dryRun === true`, `return { skipped: [], preview }` **without entering
     the transaction** — nothing is written.
   - If `expectImpact !== undefined` and `expectImpact !== preview.digest`,
     throw `ImpactChangedError`.
     The `dryRun` check must come **before** the digest check, so `--dry-run` never
     needs a digest.
7. **In-transaction re-check.** As the _first statement_ inside
   `this.#uow.transaction(() => {` at `:106`, when `expectImpact !== undefined`:
   ```ts
   const fresh = this.#buildPreview(taskId, initiativeId);
   if (fresh.digest !== expectImpact) {
     throw new ImpactChangedError(expectImpact, fresh.digest);
   }
   ```
   Throwing inside the callback rolls back
   (`src/storage/sqlite/sqlite-unit-of-work.ts:26`), so no transition and no
   event persists. `initiativeId` must therefore be read before the transaction.
8. **Derive the cascade from the preview.** Replace the ad-hoc closure loop at
   `:172-192` so the set of ids it discards is exactly the preview's
   `discarded-by-cascade` task ids, and `skipped` is exactly the preview's
   `left-blocked` task ids. Keep every existing `save`, `task.discarded`
   (`:186`), `task.blocked` (`:202`), `objective.discarded` (`:237`) and
   `initiative.discarded` (`:262`) emission and its payload shape unchanged.
   Preview and mutation then cannot drift.
9. `dryRun` and `expectImpact` must **not** be applied when
   `resolution === "retry"` — a retry is not destructive. Compute the preview
   only on the `discard` path; for `retry`, `preview` is
   `{ damage: [], counts: {…0}, digest: <digest of []> }`.

### B. `RejectObjective`

`src/app/objective/reject-objective.ts`.

1. Add to `RejectObjectiveStore` (`:16-24`):
   ```ts
   listObjectiveAfter(objectiveId: string): string[];
   listInitiativeAfter(initiativeId: string): string[];
   listInitiatives(projectId: string): Initiative[];
   getProjectId(initiativeId: string): string | undefined;
   listTasksByInitiative(initiativeId: string): Task[];
   ```
2. Extend `execute` input (`:43-46`) with `expectedCommit: string` (per EPIC 012
   story 04 — **required, not optional**), `dryRun?: boolean`,
   `expectImpact?: string`.
3. Change the return type to `Promise<{ preview: DiscardPreview }>`.
4. **Guard order is fixed**: not-found (`:50-52`) → status guard (`:55-57`) →
   EPIC 012's `assertCandidateFresh(objectiveId, expectedCommit, objective.commitOid)`
   → build preview → `dryRun` early return → `expectImpact` compare →
   transaction (with the in-transaction re-checks). The 012 stale guard runs
   **before** any preview is built, so a preview can never describe a state the
   verdict would refuse.
5. Inside `this.#uow.transaction` (`:59`), as the first two statements: EPIC 012's
   in-transaction `assertCandidateFresh` re-check, then the `expectImpact`
   re-check (same shape as A.7).
6. Derive the discarded task set from the preview's `discarded-by-cascade` task
   ids instead of the inline `pending`/`failed` filter at `:61-72`. Keep every
   event and payload unchanged.

### C. CLI

`src/apps/cli/commands/reject/task.ts` — add after `--reason` (`:17`):

```ts
.option("--dry-run", "print the damage and exit without writing")
.option("--yes", "skip the confirmation prompt; the damage is still printed")
.option("--expect-impact <digest>", "impact digest from a previous --dry-run")
.option("--json", "print the damage report as JSON")
```

`src/apps/cli/commands/reject/objective.ts` — the same four options, plus EPIC
012's `.requiredOption("--expected-commit <oid>", …)`.

`src/apps/cli/task.ts` `runRejectTask` (`:176-218`):

- After the existing `--resolution` validation (`:184-201`), add mutual-exclusion
  guards, mirroring the `runGetTask` style at `:257-263`:
  - `--dry-run` with `--yes` → exit 1,
    `error: --dry-run and --yes are mutually exclusive`.
  - `resolution === "discard"` and neither `--dry-run` nor `--yes` → exit 1,
    `error: reject task --resolution discard requires --yes (or --dry-run to preview)`,
    **after** printing the damage report to stdout. The damage must be visible in
    the same invocation that refuses.
- Forward `dryRun`, `expectImpact` to `execute`.
- **Always print the damage** for the discard path, `--yes` included. Text form,
  one line per `Damage`, so Proof phase E can `grep`:
  ```
  impact: <effect> <type> <id> <name>
  ```
  followed by `impact-digest: <digest>`. With `--json`, stdout is the single
  element `JSON.stringify(preview)` (the `emitResult` contract appends `"\n"` per
  element — `src/apps/cli/commands/action.ts:23`).
- Keep the existing `skipped: <id>` stdout lines (`:210-213`) and the `id` first
  line for the non-JSON path.
- Map `ImpactChangedError` in `src/apps/cli/error-map.ts` — add
  `err instanceof ImpactChangedError ||` next to the
  `ObjectiveNotAwaitingConfirmationError` entry (`:81`); unlisted errors are
  re-thrown (`:122`) instead of becoming exit 1. Re-export `ImpactChangedError`
  from `src/app/errors.ts`, mirroring the `CycleError` re-export at `:4`.

`src/apps/cli/objective.ts` `runRejectObjective` (`:147-186`) — the same
additions. Order the new flag checks **after** the existing `--resolution`
missing/invalid checks (`:156-173`) and after EPIC 012's `--expected-commit`
check, so existing messages and tests are unaffected. `--dry-run`, `--yes`,
`--expect-impact` apply to the `discard` branch (`:180`) only, never to the
`retry` branch (`:178`).

### D. Composition

`src/composition.ts` — the `RejectTask` and `RejectObjective` construction sites
gain the new store methods. Supply them as arrow wrappers over the existing
repositories (never bare method references — they lose `this` and crash on
`#private` fields):
`listObjectiveAfter: (id) => sequencingRepository.listObjectiveAfter(id)`, and
likewise for the others. `sequencingRepository` already backs
`GetObjective` (`:762-766`).

## Constraints

- `--dry-run` writes nothing: it must return before `uow.transaction`.
- `--yes` suppresses only the prompt, never the damage output.
- The digest is compared **twice**: before the transaction and as the first
  statement inside it.
- `retry` resolution is untouched — no preview, no new required flags, no
  behaviour change.
- Every existing event type, payload key and `skipped` value stays byte-identical.
- Add no new event types.
- Do not implement an interactive y/n prompt. `--yes` is the confirmation; there
  is no prompt helper in `src/apps/cli/` outside `login.ts:13`.

## Verify

- `node --test src/app/task/reject-task.test.ts` — existing fakes `MemStore`
  `:38-148`, `MemQueue`, `MemFeed`, `MemUow` `:144-148`, fixtures `:154-186`.
  Extend `MemStore` with the four new methods.
  - `(017-S3-dry-run-no-writes)` `{resolution:"discard", dryRun:true}` →
    returns a `preview` naming the pending dependent, and
    `store.savedTasks.length === 0`, `store.savedResults.size === 0`,
    `feed.events.length === 0`.
  - `(017-S3-stale-digest-refused)` `{resolution:"discard", expectImpact:"deadbeef"}`
    → rejects with `ImpactChangedError`, and nothing was saved or emitted.
  - `(017-S3-fresh-digest-proceeds)` pass the digest from a prior `dryRun:true`
    call → the target and the pending dependent both reach `discarded`, and
    `skipped` equals the non-pending closure ids.
  - `(017-S3-in-transaction-recheck)` a `MemStore` whose `listByInitiative`
    returns a **different** graph on its second call → rejects with
    `ImpactChangedError` and `savedTasks` is empty, proving the re-check runs
    inside the transaction.
  - `(017-S3-retry-unaffected)` `{resolution:"retry"}` with no new flags still
    reaches `pending` and emits exactly one `task.rejected` — the existing test
    at `:192-258` must stay green unchanged.
  - `(017-S3-cascade-matches-preview)` the ids saved as `discarded` equal the
    preview's `discarded-by-cascade` task ids, and `skipped` equals its
    `left-blocked` ids.
- `node --test src/app/objective/reject-objective.test.ts` — `MemStore` `:29-37`
  extended; the parameterised `building`/`awaiting_confirmation`/`conflict` loop
  at `:128-182` must stay green once `expectedCommit` is supplied.
  - `(017-S3-obj-dry-run-no-writes)` `dryRun:true` → preview returned, nothing
    saved, no events.
  - `(017-S3-obj-stale-commit-before-preview)` a mismatched `expectedCommit`
    rejects with `StaleCandidateError` and the returned error is **not**
    `ImpactChangedError` — proving the 012 guard runs first.
  - `(017-S3-obj-initiative-cascade-in-preview)` the preview names the
    initiative when the all-terminal rule fires, and omits it when it does not.
  - The `task.discarded` `{reason:"cascade", origin}` payload assertions at
    `:191-230` must stay green.
- `node --test src/apps/cli/commands/mutation.test.ts` — leaf option plumbing:
  `--dry-run`, `--yes`, `--expect-impact <d>`, `--json` each reach the use case;
  `--dry-run --yes` exits 1 with the exact message.
- `node --test src/apps/cli/task.test.ts` (`describe("runRejectTask")`
  `:1157-1240`) and `src/apps/cli/objective.test.ts` (`:357-456`):
  - discard without `--yes`/`--dry-run` exits 1 **and** stdout contains at least
    one `impact:` line;
  - `--yes` prints the `impact:` lines and exits 0;
  - `--json` stdout is exactly one element that `JSON.parse`s to an object with
    `damage`, `counts` and `digest` keys.
- `node --test src/apps/cli/architecture.test.ts` — must stay green. This story
  adds **no leaf files and no leaves**, so neither
  `EXPECTED_LEAF_FILE_COUNT` (`:28`) nor `EXPECTED_LEAF_COUNT` (`:33`) changes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/decision-workbench-proof.sh` phase **E**, and the
  `reject task --dry-run` / `reject objective --dry-run` invocations in phase **J**.
