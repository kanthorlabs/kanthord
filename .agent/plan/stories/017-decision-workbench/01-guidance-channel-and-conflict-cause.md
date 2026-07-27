# Story 1 — Fix the guidance channel; persist the objective conflict cause

Epic: `.agent/plan/epics/017-decision-workbench.md`

## Change

### A. Migration — new objective columns

Append ONE entry to the end of `MIGRATIONS` in `src/storage/sqlite/migrations.ts`
(array closes at `:797`; last entry is `version: 26`, `:762-796`).

- `name: "017-objective-decision-metadata"` — a deliberately broad name: all four
  columns belong to the same aggregate and are consumed by the same workbench
  capability. SQLite migrations are forward-only, so "revert one column
  independently" is not an available benefit and is not a reason to split.
- **Derive `version` as the previous entry's `version` + 1. Do not hardcode a
  number** — EPICs 011, 013, 014 and 016 also append, so the literal is unknown
  at authoring time.
- Plain `ALTER TABLE` only, mirroring the two-column form at `:387-395`
  (migration 14). **No table rebuild** — `objectives` was last rebuilt by
  migration 19 (`:528-541`) and a verbatim column copy would drop another epic's
  column.

```sql
ALTER TABLE objectives ADD COLUMN note TEXT;
ALTER TABLE objectives ADD COLUMN conflictCause TEXT;
ALTER TABLE objectives ADD COLUMN observedTipOid TEXT;
ALTER TABLE objectives ADD COLUMN conflictReason TEXT;
```

`conflictReason` is included because `Objective.conflictReason`
(`src/domain/initiative.ts:36-37`) is written by
`src/app/objective/retry-objective.ts:180` but exists in **neither** the
`objectives` DDL nor the repository SQL — it is silently discarded today.

### B. Domain type

`src/domain/initiative.ts` — extend `Objective` (`:27-38`) with four optional
fields, keeping the existing JSDoc style:

```ts
  /** Consolidated human guidance recorded at `retry objective` time. */
  note?: string;
  /** Why `approve objective` recorded a conflict. Absent on pre-migration rows. */
  conflictCause?: "non-single-commit" | "cas-mismatch";
  /** The ref's actual OID observed at CAS-failure time. Only set for `cas-mismatch`. */
  observedTipOid?: string;
```

`conflictReason?: string` already exists — do not re-declare it.

### C. Persist the columns

`src/storage/sqlite/sqlite-initiative-repository.ts` — thread all four columns
through every objective read/write. Mirror the task-side `note` pattern
(`src/storage/sqlite/sqlite-task-repository.ts:110,119,133,188,209`).

- `saveObjective` INSERT at `:96` — add `note, conflictCause, observedTipOid,
conflictReason` to the column list, add four `?` placeholders, and add
  `note = excluded.note, conflictCause = excluded.conflictCause,
observedTipOid = excluded.observedTipOid, conflictReason = excluded.conflictReason`
  to the `DO UPDATE SET` clause.
- Bind list at `:98-106` — append the four values, each `?? null`, matching the
  existing nullish-coalescing at `:92-93`.
- `getObjective` SELECT at `:112` — add the four columns; extend the row type at
  `:115-123` with `note: string | null` (etc.); hydrate at `:125-133` with the
  existing `if (row.x !== null) objective.x = row.x` pattern.
- `listObjectives` SELECT at `:139` — same column addition, row type `:141-148`,
  mapping `:149+`.
- `conflictCause` hydrates as the union type; cast via the row's string value
  only when it is `"non-single-commit"` or `"cas-mismatch"`, otherwise leave the
  field absent.

Do **not** touch `:195`, `:227`, `:281`, `:301`, `:315`, `:329` (name/sha256/delete
SQL) — they do not select these columns.

### D. `RetryTask` — one domain operation, called from both branches

`src/app/task/retry-task.ts`. The `awaiting_confirmation` branch writes the note
at `:102`; the `failed` branch at `:133-140` does not.

**Read this before editing.** The two branches differ in _two_ ways today, not
one. `transitionTask(task, "pending")` returns `{ ...task, status: to }`
(`src/domain/task.ts:122-128`), so the `failed` branch **accidentally preserves**
whatever note the task already had, while ignoring the new `--note`. The
`awaiting_confirmation` branch's `note: note ?? undefined` (`:102`) **clears** it.
So the fix is two deliberate changes: a new `--note` must be honoured on the
`failed` branch, and an absent `--note` must clear on **both**. The clearing half
reverses an accidental behaviour, so it needs its own named test.

Put the shared rule in `src/domain/task.ts` as a pure operation beside
`transitionTask` (`:122-128`) — not a module-private helper in the use case.
Guidance selection is a state rule, and AGENTS.md puts logic shared by two call
sites in `domain/`:

```ts
/**
 * The task as re-queued for another attempt, with guidance resolved.
 * An explicit `note` replaces; otherwise `carryNote` decides whether the
 * existing note survives. Carry-forward is OFF by default: a stale note
 * poisons the next agent run.
 */
export function retryTaskWithGuidance(
  task: Task,
  note: string | undefined,
  carryNote: boolean | undefined,
): Task {
  const pending = transitionTask(task, "pending");
  const resolved =
    note !== undefined ? note : carryNote === true ? task.note : undefined;
  return resolved === undefined
    ? (({ note: _drop, ...rest }) => rest as Task)(pending)
    : { ...pending, note: resolved };
}
```

The key must be **omitted**, not set to `undefined` — the repo builds with
`exactOptionalPropertyTypes` (style reference `src/app/task/get-task.ts:88-101`).

- Extend the `execute` input type (`:69-73`) with `carryNote?: boolean`, and
  destructure it at `:74`.
- Replace `:99-103` with
  `this.#store.save(retryTaskWithGuidance(task, note, carryNote));`
- Replace `:134-135` with the same single call.

Change nothing else in either branch: the candidate-state update (`:98`), the
conflict snapshot (`:104-120`), the enqueue and `task.ready` emission
(`:121-124`, `:136-139`) all stay as they are. The branches keep their own
candidate work; only the transition-plus-guidance invariant is shared.

**Clear-by-default is a binding decision, not a preference** (epic binding
decision 3). `--carry-note` is the explicit opt-in. Do not invert the default to
"absent note preserves": every retry today is human-initiated through
`retry task`, and the failure mode being designed against is an obsolete
instruction silently steering the next run.

**The consumer chain is already complete** — no runner change is needed. `Task.note`
→ `getPriorFeedback` (`src/composition.ts:410-418`) → `PiAgentRunner` option
(`src/agent-runner/pi.ts:312,344,365-366`) → read at `:566` and folded into the
prompt. Persisting the note is therefore sufficient for it to reach the next run.

### E. `RetryObjective` — store the note on the objective, on both gate paths

`src/app/objective/retry-objective.ts`.

- **Delete the task fan-out at `:167-174`** (the loop over
  `listTasksByObjective` that skips `completed`/`discarded`). Per 007.12 every
  task under a retryable objective is already `completed`, so it reaches nobody.
- In the gate-passed transaction (`:157-175`), include the note **and clear the
  three conflict-diagnosis fields**:

  ```ts
  const resolved = transitionObjective(objective, "awaiting_confirmation");
  delete resolved.conflictCause;
  delete resolved.observedTipOid;
  delete resolved.conflictReason;
  const updated: Objective = {
    ...resolved,
    commitOid: oid,
    parentOid: newParentOid,
    ...(note !== undefined ? { note } : {}),
  };
  ```

  **Why the clear is mandatory.** `transitionObjective` returns
  `{ ...objective, status: to }` (`src/domain/initiative.ts:91-101`), so every
  diagnosis field survives the transition. Once story 1 persists them, a resolved
  objective would keep reporting the conflict cause and the stale failure reason
  it no longer has. Persisting without clearing converts a silent-loss bug into a
  stale-data bug — a workbench that shows an obsolete failure reason is worse than
  one that shows none. `note` is deliberately **kept**: it is the human's
  guidance, not conflict diagnosis.

  Implement the clear as a pure domain operation
  `clearConflictDiagnosis(objective: Objective): Objective` in
  `src/domain/initiative.ts`, beside `transitionObjective`, returning a new object
  with the three keys **omitted** (not `undefined` —
  `exactOptionalPropertyTypes`). Both this call site and any future resolver use
  it, so the field list lives in one place.

- **Entering a new conflict replaces, never merges.**
  `ApproveObjective.#recordConflict` (section F) sets `conflictCause` and
  `observedTipOid` outright and must **also** clear any prior `conflictReason` —
  that reason belongs to a previous gate run, not to this ref-update failure.
- In the gate-failed transaction (`:179-182`), also persist the note:
  ```ts
  const updated: Objective = {
    ...objective,
    conflictReason: reason,
    ...(note !== undefined ? { note } : {}),
  };
  ```
- Remove `listTasksByObjective` and `saveTask` from the `ObjectiveStore`
  interface (`:28-36`) only if no other method in this file uses them (they are
  used solely by the deleted loop). Leave the rest of the interface untouched.

`composition.ts` passes a store object that still satisfies the narrowed
interface, so no wiring change is needed.

### F. `ApproveObjective` — persist the conflict cause

`src/app/objective/approve-objective.ts`.

- Change `#recordConflict` (`:135-141`) to take the cause and the observed tip:
  ```ts
  #recordConflict(
    objective: Objective,
    objectiveId: string,
    cause: "non-single-commit" | "cas-mismatch",
    observedTipOid?: string,
  ): void {
    this.#uow.transaction(() => {
      const updated: Objective = {
        ...transitionObjective(objective, "conflict"),
        conflictCause: cause,
        ...(observedTipOid !== undefined ? { observedTipOid } : {}),
      };
      this.#store.saveObjective(updated);
      this.#feed.append(newEvent("objective.conflict", { objectiveId }));
    });
  }
  ```
- Call site `:87` (the `commitCount !== 1` branch) →
  `this.#recordConflict(objective, objectiveId, "non-single-commit");`
  **No observed tip on this path** — none is read there, and inventing one would
  be a guess.
- Call site `:100` (the `LandingCASMismatchError` branch) →
  `this.#recordConflict(objective, objectiveId, "cas-mismatch", err.newTargetOID);`
  `LandingCASMismatchError.newTargetOID` is the ref's actual current OID
  (`src/landing/port.ts:57-64`).
- The built object must **omit** `conflictReason` (spread the transition result,
  then `delete updated.conflictReason`), so a reason from an earlier gate run
  never attaches to this ref-update failure.

Append **no new event type**. `objective.conflict` already exists in the
`events.type` CHECK list (`src/storage/sqlite/migrations.ts:781`).

### G. CLI surface

- `src/apps/cli/commands/retry/task.ts` — add
  `.option("--carry-note", "keep the note from the previous retry")` after the
  `--note` option at `:13`; extend the `.action` opts type (`:22`) with
  `carryNote?: boolean`; pass `carryNote: opts.carryNote` into `runRetryTask`.
- `src/apps/cli/task.ts` `runRetryTask` (`:114-127`) — read
  `const carryNote = args["carryNote"] === true ? true : undefined;` and forward
  it to `retryTask.execute`. Keep the existing `note` read at `:120` unchanged.
- `src/apps/cli/objective.ts` `runGetObjective` — no change here; the note is
  surfaced by story 7's read path.

## Constraints

- **Derive the migration `version` as last + 1.** Never a literal.
- **`ALTER TABLE ADD COLUMN` only.** No `objectives_new` rebuild.
- Carry-forward default is OFF: absent `--note` and absent `--carry-note` must
  **clear** an existing note in both `RetryTask` branches.
- Do not add `completed->pending` to `LEGAL_TRANSITIONS`
  (`src/domain/task.ts:97-107`). Out of scope for this epic.
- Do not change `retry objective`'s status guards (`:90-107`) or the conflict
  dispatch condition (`:109-127`).
- Do not add `--expected-commit` here — that is EPIC 012's story 04.

## Verify

- `node --test src/domain/task.test.ts` — `retryTaskWithGuidance`, pure:
  - `(017-S1-guidance-note-wins)` explicit note replaces an existing one.
  - `(017-S1-guidance-clears)` no note, no `carryNote` → the returned task has
    **no `note` key** (`"note" in result === false`), not `note: undefined`.
  - `(017-S1-guidance-carries)` `carryNote: true` → the existing note survives.
  - `(017-S1-guidance-illegal-status)` a `completed` task throws
    `IllegalTransitionError` — the transition guard still runs.
- `node --test src/domain/initiative.test.ts` — `clearConflictDiagnosis` omits
  `conflictCause`, `observedTipOid` and `conflictReason`, and **keeps** `note`,
  `commitOid`, `parentOid`, `status`.
- `node --test src/app/task/retry-task.test.ts` — add to the existing file
  (convention: `node:test` + `node:assert/strict`, flat `test(...)`, fakes
  `SimpleTaskStore` `:30-46` / `RecordingJobQueue` `:48-67` /
  `RecordingEventFeed` `:69-79` / `RecordingUnitOfWork` `:81-88` /
  `MockKindResolver` `:90-100`, fixtures `makeTask(status)` `:106-117`):
  - `(017-S1-failed-note)` `execute({taskId, note: "use the anchor"})` on a
    `failed` task → `store.saved[0].note === "use the anchor"`. **This is the
    D1 regression.** No existing test covers note on the `failed` branch
    (`:690-711` checks only status + enqueue).
  - `(017-S1-failed-note-cleared)` a `failed` task with `note: "X"`, retried with
    no `note` and no `carryNote` → the saved task has **no `note` key**. This
    **reverses** today's accidental preserve (the `failed` branch inherits the
    note through `transitionTask`'s spread), so the test must assert the new
    behaviour explicitly and its name must say so. Mirrors the existing
    `awaiting_confirmation` case at `:481-509`.
  - `(017-S1-failed-carry-note)` same task, `execute({taskId, carryNote: true})`
    → saved `note === "X"`.
  - `(017-S1-awaiting-carry-note)` the `awaiting_confirmation` branch honours
    `carryNote` identically (build with `FakeConflictCandidateStore` `:249-288`
    and `makeConflictCandidate()` `:292-316`).
  - `(017-S1-note-wins-over-carry)` `{note: "new", carryNote: true}` → saved
    `note === "new"`.
- `node --test src/app/objective/retry-objective.test.ts` — using
  `FakeObjectiveStore` `:34-78`, `FakeBroker` `:80-92`, `FakeSquasher` `:94-111`,
  `FakeGate` `:113-125`, `noopUow` `:134`:
  - `(017-S1-objective-note-gate-passed)` conflict objective, **all tasks
    `completed`**, gate passes, `execute({objectiveId, note: "resolve at the new
tip"})` → the saved objective has `note === "resolve at the new tip"` and
    `store.savedTasks.length === 0`. Replaces the assertions at `:378-441`.
  - `(017-S1-objective-note-gate-failed)` gate fails → the saved objective has
    both `note` and `conflictReason` set, and status stays `conflict`.
  - `(017-S1-objective-no-note)` no `note` → the saved objective has no `note`
    key.
  - `(017-S1-diagnosis-cleared-on-resolve)` a conflict objective carrying
    `conflictCause: "cas-mismatch"`, `observedTipOid: "aaa"` and
    `conflictReason: "gate failed"`, gate passes → the saved objective has **none**
    of those three keys, and still has `note`, `commitOid` and `parentOid`. This
    is the stale-data guard.
  - `(017-S1-diagnosis-kept-on-gate-failure)` gate fails → `conflictReason` is
    the new reason and `conflictCause` is unchanged, because the objective is
    still in conflict.
  - Update/replace the existing note tests at `:378-441` and `:443-489`, which
    assert the deleted task fan-out.
- `node --test src/app/objective/approve-objective.test.ts` — using `FakeStore`
  `:39+`, `FakeUow` `:18-22`, `FakeFeed` `:24-32`:
  - `(017-S1-cause-non-single-commit)` broker `countCommitsSince` returns `2` →
    saved objective has `status === "conflict"`,
    `conflictCause === "non-single-commit"`, and **no `observedTipOid` key**.
  - `(017-S1-cause-cas-mismatch)` `casUpdateRef` throws
    `new LandingCASMismatchError("abc123")` → saved objective has
    `conflictCause === "cas-mismatch"` and `observedTipOid === "abc123"`.
  - `(017-S1-integrated-no-cause)` the happy path leaves both fields absent.
  - `(017-S1-stale-reason-dropped)` an objective carrying a
    `conflictReason` from an earlier gate run, driven into a new conflict → the
    saved objective has **no** `conflictReason` key.
  - Existing `{ outcome: "conflict" }` return-value tests must still pass.
- `node --test src/storage/sqlite/migrations.test.ts`:
  - Add a per-migration test mirroring `:1788-1836`: `migrate(db, MIGRATIONS.slice(0, MIGRATIONS.length - 1))`, seed an objective via `insertChain(db)`, `migrate(db, MIGRATIONS)`, then assert the row survived and the four new columns read `null`.
  - **Update every head-version assertion** — they hardcode `26`: `:70` (test
    title), `:72`, `:449`, `:862`, `:995`, `:1099`, `:1178`, `:1215`, `:1510`,
    `:1525`, `:1566`, `:1687`, `:1816`. Set each to the new head. If EPIC 011/013/014/016 already bumped them, bump from the value on disk.
  - **Update the `objectives` column list at `:129-137`** to
    `["id","initiativeId","name","sha256","status","commitOid","parentOid","note","conflictCause","observedTipOid","conflictReason"]`
    (ALTER appends in statement order).
  - The table list at `:73-96` is unchanged — no new table.
- `node --test src/storage/sqlite/sqlite-initiative-repository.test.ts` —
  round-trip each new column: `saveObjective` with all four set, then
  `getObjective` and `listObjectives` return them; and an objective saved without
  them reads back with the keys absent.
- `node --test src/apps/cli/commands/mutation.test.ts` — `retry task
--id t --carry-note` reaches the use case as `{taskId:"t", carryNote:true}`
  (harness `capture()` `:16-33`, `parseAsync([...], {from:"user"})`).
- `node --test src/apps/cli/task.test.ts` — `runRetryTask` forwards
  `carryNote`, and omits it (`undefined`) when the flag is absent.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/decision-workbench-proof.sh` phases **A** and **B**.
