# Story 4 — task approval freshness: a required, nullable `expectedCommit`

Epic: `.agent/plan/epics/026.9-candidate-review.md`

`ApproveTask.execute` takes only `{ taskId }` (`src/app/task/approve-task.ts:123`).
`ApproveObjective` guards twice — before any git work (`approve-objective.ts:66`)
and inside the write transaction (`:136`). This story gives the task path the
same guard, and the field is **required and nullable**, never optional.

## Change

### 1. `src/domain/landing.ts` — the freshness rule

Append, importing `StaleCandidateError` from `./initiative.ts` (a
`src/domain/` → `src/domain/` import; `initiative.ts` imports only
`./entity.ts`, so there is no cycle):

```ts
import { StaleCandidateError } from "./initiative.ts";

/**
 * The proposal-freshness compare-and-swap for a task verdict.
 * `null` on either side means "this task has no proposal commit"; the caller
 * must claim that explicitly, so a null claim against a real commit is refused
 * exactly like a wrong oid.
 */
export function assertProposalFresh(
  taskId: string,
  expected: string | null,
  actual: string | null,
): void {
  if (expected === actual) return;
  throw new StaleCandidateError(taskId, expected ?? "", actual ?? "");
}
```

`StaleCandidateError` is reused deliberately: epic decision 15 registers exactly
one `stale_candidate` code, and `src/apps/cli/error-map.ts:116` already maps the
class. Its `objectiveId` field carries the task id on this path; do **not**
rename the field (`activation-verdict-proof.sh:97` pins the message shape, and
the existing objective callers pin the field).

### 2. `src/app/task/approve-task.ts`

- `execute` signature (`:123`) becomes:

```ts
async execute({
  taskId,
  expectedCommit,
}: {
  taskId: string;
  expectedCommit: string | null;
}): Promise<ApproveOutcome> {
```

- **Early guard.** Insert immediately after the status guard's closing brace at
  `:144`, before the `// Resolve context early` comment at `:146`:

```ts
// EPIC 026.9 decision 8 — freshness BEFORE any git work. SQLite cannot roll
// back a moved ref, so the refusal must precede the promote/landing steps.
assertProposalFresh(taskId, expectedCommit, result?.proposalCommit ?? null);
```

`result` is already bound at `:129`.

- **In-transaction re-check.** Inside the final `this.#uow.transaction(() => {`
  that opens at `:334`, as its **first two statements**, before the candidate-state
  write at `:337`:

```ts
const fresh = this.#store.getTaskResult(taskId);
assertProposalFresh(taskId, expectedCommit, fresh?.proposalCommit ?? null);
```

Throwing here rolls the transaction back
(`src/storage/sqlite/sqlite-unit-of-work.ts:26`), so no transition and no event
persist.

- The idempotency branch at `:131-139` stays **above** the guard and is
  unchanged: an already-approved task answers `approved` without a freshness
  claim being meaningful, exactly as today.
- No other line of the file changes. The conflict, `target_moved` and
  `landing_failed` returns keep their current text and position.

### 3. CLI — `src/apps/cli/commands/approve/task.ts`

Add, mirroring `commands/approve/objective.ts:16-19`:

```ts
.requiredOption(
  "--expect-commit <oid>",
  'proposal commit reviewed; the literal "none" when the task has no commit',
)
```

and pass `expectCommit: opts.expectCommit` into `runApproveTask`. Update the
help example at `:13` to
`kanthord approve task --id task-1 --expect-commit <oid>`.

### 4. CLI — `src/apps/cli/task.ts`, `runApproveTask` (`:138-183`)

Between the `--id` check (`:142-145`) and the `execute` call (`:147`):

```ts
const raw = args["expectCommit"];
if (typeof raw !== "string" || raw.trim() === "") {
  return { ...toResult(new MissingFlagError("--expect-commit")), stdout: [] };
}
const expectedCommit = raw.trim() === "none" ? null : raw.trim();
```

mirroring `src/apps/cli/objective.ts:114-123`, and call
`approveTask.execute({ taskId: id, expectedCommit })`. The four outcome branches
(`:148-179`) are unchanged.

### 5. `src/composition.ts`

No change: `ApproveTask`'s constructor (`:828-842`) is untouched — only
`execute`'s input widened.

## Constraints

- `expectedCommit` is **required** on the type and nullable in value. Do not
  make it `expectedCommit?: string`; that would silence exactly the call sites
  this guard exists to enumerate (AGENTS.md).
- Do not change `ApproveObjective`, `RejectTask` or `RejectObjective` here.
- Do not add a new error class or a new CLI error-map entry —
  `StaleCandidateError` is already mapped at `error-map.ts:116`.
- Every existing caller of `ApproveTask.execute` must be updated to pass the
  new field; the type checker enumerates them.

## Verify

- `node --test src/domain/landing.test.ts` — `assertProposalFresh("t","abc","abc")`
  returns; `(…,"abc","def")` throws `StaleCandidateError` with
  `expected === "abc"`, `actual === "def"`; `(…, null, null)` returns;
  `(…, null, "abc")` throws with `expected === ""`, `actual === "abc"`;
  `(…, "abc", null)` throws with `actual === ""`.
- `node --test src/app/task/approve-task.test.ts` — added to the existing suite,
  using its local `MemStore` (`:113-177`):
  - a wrong `expectedCommit` throws `StaleCandidateError` and **nothing is
    written**: `savedTasks` and `savedResults` are empty, no event was appended,
    the landing fake's `preview` was never called, and `#promote` was never
    called;
  - `expectedCommit: null` against a task whose `proposalCommit` is `null`
    approves;
  - `expectedCommit: null` against a task that **has** a `proposalCommit` throws
    `StaleCandidateError`;
  - the matching `expectedCommit` approves and the outcome is unchanged from the
    existing tests;
  - the in-transaction re-check fires: a store whose second `getTaskResult`
    returns a **different** `proposalCommit` throws, and `savedTasks` stays
    empty (the transaction rolled back);
  - the already-completed idempotency branch still returns `approved` for a
    stale `expectedCommit`, because it precedes the guard.
  - every pre-existing test in the file passes `expectedCommit` explicitly; none
    is deleted or weakened.
- `node --test src/apps/cli/task.test.ts` — `approve task` without
  `--expect-commit` exits non-zero naming `--expect-commit` and never calls the
  use case; `--expect-commit none` calls it with `expectedCommit: null`;
  `--expect-commit <oid>` passes that oid verbatim.
- `node --test src/apps/cli/architecture.test.ts` — passes unchanged (the leaf
  count is unaffected; only an option was added).
- `npm run verify` exits 0.
- Proof: phase D (`a stale expectedCommit is refused with 409`, `...and names
the reason`, `the objective did not move`) — the objective path already had
  this guard; this story makes the task path answer the same way for 026.10's
  reattempt work and for the task verdict routes of Story 7.
