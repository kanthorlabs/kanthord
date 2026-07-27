# Story 4 — Required `--expected-commit` on objective verdicts

Epic: `.agent/plan/epics/012-explicit-activation-guarded-verdicts.md`
Depends on: Story 3 (`commitOid` must be readable before it can be echoed back).
Coupled with: Story 5 — the required flag breaks every existing caller, so both
stories land in the same commit.

## Change

### Domain — `src/domain/initiative.ts`

Add the error beside `IllegalObjectiveTransitionError` (`:63-73`) and the guard
function beside `canRetryObjective` (`:87-89`). The guard lives in `domain/`
because three use cases share it and AGENTS.md forbids use-case-calls-use-case.

```ts
export class StaleCandidateError extends Error {
  readonly objectiveId: string;
  readonly expected: string;
  readonly actual: string;

  constructor(objectiveId: string, expected: string, actual: string) {
    super(
      `objective ${objectiveId} candidate moved: expected ${expected}, found ${actual}`,
    );
    this.name = "StaleCandidateError";
    this.objectiveId = objectiveId;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Refuse a verdict whose reviewed candidate is no longer this objective's
 * candidate. `actual === undefined` (no candidate at all) is always stale.
 */
export function assertCandidateFresh(
  objectiveId: string,
  expectedCommit: string,
  actual: string | undefined,
): void {
  if (actual === undefined || actual !== expectedCommit) {
    throw new StaleCandidateError(objectiveId, expectedCommit, actual ?? "");
  }
}
```

The message contains both `expected` and `moved`, satisfying the Proof's
`grep -qiE 'stale|expected|moved'` at `activation-verdict-proof.sh:97`.

### Error catalog + CLI mapping

- `src/app/errors.ts` — re-export it, mirroring the `CycleError` re-export at
  `:4`: `export { StaleCandidateError } from "../domain/initiative.ts";`
- `src/apps/cli/error-map.ts` — import `StaleCandidateError` from
  `../../app/errors.ts` and add `err instanceof StaleCandidateError ||` to the
  allow-list immediately after the `ObjectiveNotAwaitingConfirmationError` line
  (`:81`). Unlisted errors are re-thrown (`:122`), so this line is what makes the
  refusal an `exit 1` + `error: …` message instead of a crash.

### `ApproveObjective` — `src/app/objective/approve-objective.ts`

- `:44-46` — input becomes
  `{ objectiveId: string; expectedCommit: string }` — **required**, not
  `string | undefined`.
- **Early guard**, inserted after the status guard (`:55-60`) and before
  `getInitiative` (`:62`) — i.e. before `broker.fetch` (`:79`), before
  `broker.countCommitsSince` (`:80-84`) and before
  `broker.casUpdateRef` (`:91-97`):

  ```ts
  assertCandidateFresh(objectiveId, input.expectedCommit, objective.commitOid);
  ```

  Ordering is load-bearing: SQLite cannot roll back a moved ref.

- **In-transaction re-check.** `#integrate` (`:110-133`) takes
  `expectedCommit: string` as a new parameter, and the **first two statements**
  inside the `this.#uow.transaction(() => {` at `:116` become:

  ```ts
  const fresh = this.#store.getObjective(objectiveId);
  assertCandidateFresh(objectiveId, expectedCommit, fresh?.commitOid);
  ```

  Everything after them is unchanged. Throwing inside the callback rolls the
  transaction back (`src/storage/sqlite/sqlite-unit-of-work.ts:26`), so no
  transition and no event are persisted.

- Both `#integrate` call sites pass it through: the empty-objective shortcut at
  `:75` and the normal path at `:106`.
- `#recordConflict` (`:135-140`) is **unchanged** — it records a refusal, not a
  verdict.

### `RejectObjective` — `src/app/objective/reject-objective.ts`

- `:43-46` — input becomes
  `{ objectiveId: string; reason?: string; expectedCommit: string }`.
- **Early guard**, inserted after the `DISCARD_ALLOWED_FROM` check (`:54-57`):
  `assertCandidateFresh(objectiveId, input.expectedCommit, objective.commitOid);`
- **In-transaction re-check** — the same two statements as the first thing inside
  `this.#uow.transaction(() => {` at `:58`, before the task cascade loop.

### `RetryObjective` — `src/app/objective/retry-objective.ts`

The Proof drives `reject objective --resolution retry --expected-commit <stale>`
(`activation-verdict-proof.sh:103-104`) and requires a non-zero exit, so this use
case is in scope too.

- `execute` input gains `expectedCommit: string` (required).
- **Early guard**, inserted after the `canRetryObjective` check (`:102-107`) and
  before the conflict branch (`:109`) — so the tip-integrated no-op return
  (`:129-130`) is also unreachable with a stale id, and no `broker.currentTip` /
  `workspaces.squashObjective` / `gate.verify` call happens.
- **In-transaction re-check** as the first two statements inside the success
  `uow.transaction(() => {` in `#resolveConflict` (`:158`). Compare against the
  **stored** `commitOid` (still the pre-squash candidate at that point); the new
  oid is only written inside the callback. The failure-branch transaction
  (`:179-182`) is unchanged.

### CLI

- `src/apps/cli/commands/approve/objective.ts:15` — add after `--id`:

  ```ts
      .requiredOption(
        "--expected-commit <oid>",
        "the candidate commit OID read from `get objective --json`",
      )
  ```

  action opts type gains `expectedCommit: string`; the args object passed to
  `runApproveObjective` gains `expectedCommit: opts.expectedCommit`. Extend the
  `addHelpText("after", …)` Example to include the flag.

- `src/apps/cli/commands/reject/objective.ts:12-17` — the same
  `requiredOption`, opts field, args field, and Example update.
- `src/apps/cli/commands/retry/objective.ts` — the same `requiredOption`, opts
  field, args field, and Example update (its use case now requires the field).
- `src/apps/cli/objective.ts` — `runApproveObjective` (`:97`): after the existing
  `--id` `MissingFlagError` check (`:101-104`) add

  ```ts
  const expectedCommit = args["expectedCommit"];
  if (typeof expectedCommit !== "string" || expectedCommit === "") {
    return {
      ...toResult(new MissingFlagError("--expected-commit")),
      stdout: [],
    };
  }
  ```

  then `execute({ objectiveId: id, expectedCommit })`. Success stdout/stderr and
  the `exitCode: 0` conflict wording (`:110-119`) are unchanged.

- `runRetryObjective` (`:126`) — same check, then
  `execute({ objectiveId: id, expectedCommit, …note })`.
- `runRejectObjective` (`:147`) — same check, placed **after** the
  `--resolution` missing check (`:158-163`) and the `--resolution` invalid check
  (`:164-172`), so the existing `--resolution` error messages and their tests are
  unaffected. Then pass `expectedCommit` to both branches:
  `retryObjective.execute({ objectiveId: id, expectedCommit })` and
  `rejectObjective.execute({ objectiveId: id, reason, expectedCommit })`.

## Constraints

- **Guard-check order inside each use case is fixed:** not-found → status guard →
  stale guard. Story 5 depends on it: approving a `discarded` objective must still
  fail with `ObjectiveNotAwaitingConfirmationError`
  (`… is not awaiting confirmation; current status: discarded`), not with the
  stale error.
- The guard is **required** at every layer: `requiredOption` on all three CLI
  leaves, a `MissingFlagError` check in each handler, and a non-optional
  `expectedCommit: string` on each use-case input. Never `string | undefined`,
  never a default.
- The early guard must precede every `ObjectiveBroker` call
  (`src/objective-broker/port.ts:11,18-22,30-35`) and every
  `workspaces.squashObjective` / `gate.verify` call.
- `assertCandidateFresh` is the single comparison implementation. Do not inline a
  second `!==` check in a use case.
- No change to `src/composition.ts` (no new dependency), to
  `ApproveObjective`'s `{ outcome }` return contract, or to any status set.
- `approve task` / `reject task` are out of scope (epic Non-goals).

## Verify

- `node --test src/domain/initiative.test.ts`
  - `assertCandidateFresh("o","abc","abc")` returns without throwing.
  - `assertCandidateFresh("o","abc","def")` throws `StaleCandidateError` with
    `expected === "abc"`, `actual === "def"`, and a message matching
    `/stale|expected|moved/i`.
  - `assertCandidateFresh("o","abc",undefined)` throws with `actual === ""`.
- `node --test src/app/objective/approve-objective.test.ts`
  - all 10 existing constructions (`:156,179,202,236,274,303,333,359,390,434`)
    updated to pass the fixture's own `commitOid` as `expectedCommit`; every
    current assertion stays green.
  - **stale approve, before git**: a `FailIfCalledBroker` whose `fetch`,
    `countCommitsSince` and `casUpdateRef` each `throw new Error("broker reached")`
    → `execute({objectiveId, expectedCommit: "0".repeat(40)})` rejects with
    `StaleCandidateError` (assert `err.name`, not the broker error), and
    `store.savedObjectives.length === 0`, and no event was appended.
  - **stale approve on the empty-objective shortcut**
    (`commitOid === parentOid`, `:74-77`) → same refusal, still no saved
    objective.
  - **in-transaction interleaving**: override `store.getObjective` (the style
    already used for `broker.casUpdateRef` at `:355-357`) so the **first** call
    returns the reviewed objective (`commitOid: "AAA"`) and every later call
    returns the same objective with `commitOid: "BBB"`. `execute` with
    `expectedCommit: "AAA"` must reject with `StaleCandidateError`, and:
    `store.savedObjectives.length === 0`, no `objective.integrated` and no
    `initiative.landed` event.
  - **matching approve** with the interleaving double returning `"AAA"` on every
    call → resolves `{outcome:"integrated"}` and appends `objective.integrated`.
- `node --test src/app/objective/reject-objective.test.ts`
  - existing constructions (`:149,206,249,282`) updated with a matching
    `expectedCommit`; assertions stay green.
  - **stale reject**: rejects with `StaleCandidateError`; no `objective.discarded`
    event, no `task.discarded` event, `savedObjectives` empty.
  - **in-transaction interleaving** on `MemStore.getObjective` (first call
    `"AAA"`, later calls `"BBB"`) → refused, nothing saved.
- `node --test src/app/objective/retry-objective.test.ts`
  - **stale retry**: with a `currentTip` that throws if called, `execute` rejects
    with `StaleCandidateError`; nothing saved, no event.
  - matching retry (both the `conflict` resolution path and the
    `awaiting_confirmation` no-op path) behaves exactly as today.
- `node --test src/apps/cli/objective.test.ts`
  - `runApproveObjective` without `--expected-commit` → `exitCode 1`, stderr
    `error: missing required flag --expected-commit`, stdout `[]`.
  - `runApproveObjective` forwards `{objectiveId, expectedCommit}`.
  - `runRejectObjective` without the flag → the same error, for both
    `--resolution retry` and `--resolution discard`; existing missing/invalid
    `--resolution` tests (`:429`, `:443`) unchanged and still green.
  - `runRejectObjective` forwards `expectedCommit` to `retryObjective` and to
    `rejectObjective`.
  - `runRetryObjective` without the flag → the same error; with it, forwards it.
- `node --test src/apps/cli/commands/mutation.test.ts`
  - `approve objective --id obj-1 --expected-commit abc` → the fake received
    `{objectiveId: "obj-1", expectedCommit: "abc"}` (update the existing
    `deepEqual` at `:320`).
  - `approve objective --id obj-1` (no `--expected-commit`) → non-zero exit from
    Commander's required-option error.
  - the same two cases for `reject objective` and `retry objective`.
- `node --test src/apps/cli/error-map.test.ts` — `StaleCandidateError` →
  `exitCode 1`, stderr `error: objective … candidate moved: expected …, found …`.
- `node --test src/apps/cli/architecture.test.ts` — leaf help still has `Usage:`
  and `Example`.
- `npm run verify` exits 0.
- Proof: `D ok: stale + missing verdict guards refused with no state change;
matching verdict integrates` — `activation-verdict-proof.sh:93-118`, together
  with Story 5.
