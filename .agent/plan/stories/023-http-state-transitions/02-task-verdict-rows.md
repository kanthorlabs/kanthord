# Story S2 — the two task verdict rows, `views/verdict.ts`, `views/impact.ts`

Epic: `.agent/plan/epics/023-http-state-transitions.md`
Depends on: Story S1 (the registry codes, the narrowed `RejectTask` return type,
the impact type re-export, the `approval` / `rejection` segments).

Lands 2 rows. `ROUTES.length` 54 → 56.

## Change

**1. New `src/apps/http/views/verdict.ts`** — mirror
`src/apps/http/views/conflict.ts:1-24`. Two exports in this story (the third,
`abandonmentView`, belongs to Story S3):

```ts
import type { ApproveOutcome } from "../../../app/task/approve-task.ts";

export interface TaskApprovalView {
  readonly outcome: string;
  readonly taskId: string;
  readonly canonicalSHA?: string;
  readonly conflictFiles?: readonly string[];
  readonly message?: string;
  readonly [key: string]: unknown;
}

export function taskApprovalView(result: ApproveOutcome): TaskApprovalView { … }
```

Mapping rules, exactly:

- `outcome: result.kind` — the wire never carries `kind`.
- `taskId: result.taskId` — always present.
- `canonicalSHA` only when `result.kind === "approved"`, from
  `result.canonicalSHA`.
- `conflictFiles` only when `result.kind === "conflict"` **and**
  `result.conflictFiles !== undefined`, copied with `[...result.conflictFiles]`.
- `message` only when `result.kind === "landing_failed"`, from `result.message`.
- `cause` (`approve-task.ts:37`) is NEVER read and NEVER emitted.

Use conditional spreads for the three optional fields. `ApproveOutcome` is the
union at `src/app/task/approve-task.ts:29-40`; narrow on `result.kind` so the
optional reads typecheck without a cast.

**2. New `src/apps/http/views/impact.ts`**:

```ts
import type { DiscardPreview } from "../../../app/errors.ts";
```

(the re-export Story S1 added — never `../../../domain/impact.ts`).

- `DiscardPreviewView` / `discardPreviewView(result: DiscardPreview)` →
  `{ damage, counts, digest }` where
  `damage: result.damage.map((d) => ({ target: { type: d.target.type, id: d.target.id, name: d.target.name }, effect: d.effect }))`,
  `counts: { ...result.counts }`, `digest: result.digest`.
  Field sources: `src/domain/impact.ts:44-58`.
- `TaskRejectionView` / `taskRejectionView(result: { skipped: string[]; preview: DiscardPreview })`
  → `{ skipped: [...result.skipped], preview: discardPreviewView(result.preview) }`.

`objectiveRejectionView` belongs to Story S4; do not add it here.

**3. `src/apps/http/routes.ts`** — append two rows at the END of the `ROUTES`
array literal, immediately before the closing `];` (line 396 in the 020 tree;
after 021's and 022's rows once they land).

Row `task.approval.create`:

```
id: "task.approval.create", method: "POST", path: "/api/task/:id/approval",
successStatus: 200, kind: "json", cliCommands: ["approve task"]
decode: ({ params }) => ({ taskId: requirePathParam(params, "id") })
run:    async (deps, input) => deps.approveTask.execute(input)
present: (result) => taskApprovalView(result)
```

Row `task.rejection.create`:

```
id: "task.rejection.create", method: "POST", path: "/api/task/:id/rejection",
successStatus: 200, kind: "json", cliCommands: ["reject task"]
present: (result) => taskRejectionView(result)
run:     async (deps, input) => deps.rejectTask.execute(input)
```

Its `decode` (`{ params, body }`), in this order:

```ts
const resolution = requireBodyString(body, "resolution");
if (resolution !== "retry" && resolution !== "discard") {
  throw new InvalidInputError("resolution", 'must be "retry" or "discard"');
}
const reason = optionalBodyString(body, "reason");
const dryRun = optionalBodyBool(body, "dryRun");
const expectImpact = optionalBodyString(body, "expectImpact");
return {
  taskId: requirePathParam(params, "id"),
  resolution,
  ...(reason !== undefined ? { reason } : {}),
  ...(dryRun !== undefined ? { dryRun } : {}),
  ...(expectImpact !== undefined ? { expectImpact } : {}),
};
```

`requireBodyString` / `optionalBodyString` / `optionalBodyBool` come from
`src/apps/http/body.ts` (EPIC 021 decision 2). If any of the three is missing when
this story runs, raise an `OPEN:` blocker — do not hand-roll a local reader.
`InvalidInputError` is already imported in `routes.ts` (`:26`).

Neither row sets `location` (no `201`) or `readRow` (no `PATCH`, no `If-Match`).

**4. Wiring, all three sites, in this story:**

- `src/apps/http/deps.ts` — after the last import (`:20`):
  `import type { ApproveTask } from "../../app/task/approve-task.ts";` and
  `import type { RejectTask } from "../../app/task/reject-task.ts";`; after the
  last field (`:46`): `readonly approveTask: ApproveTask;` and
  `readonly rejectTask: RejectTask;`.
- `src/apps/cli/commands/serve.ts` — after the last entry of the `httpDeps`
  literal (`:59`): `approveTask: deps.approveTask,` and
  `rejectTask: deps.rejectTask,`. Both already exist on `CliDeps`
  (`src/apps/cli/deps.ts:213,217`).
- `src/composition.ts` — **no change**.

**5. `src/apps/http/routes.test.ts`** — `assert.equal(ROUTES.length, 56)` (`:248`,
whatever the base is + 2) and add `"task.approval.create"` and
`"task.rejection.create"` to the expected-id array (`:253-276`).

## Constraints

- `run` is one line per row: no branching, no validation, no formatting. The
  `resolution` enum check lives in `decode`, which is the only layer allowed to
  reject input.
- `RejectTask.execute` accepts `resolution: "retry" | "discard"`, so `decode`'s
  return type must be that union, not `string`. Do not widen the use-case input.
- Never present `cause`. Never present `kind`.
- `taskRejectionView` must not be given an `undefined` branch — Story S1 removed
  that case.
- Do not touch `cli-coverage.test.ts` (Story S6 owns it) and do not touch
  `src/app/task/approve-task.ts` or `reject-task.ts`.

## Verify

- **New** `node --test src/apps/http/views/verdict.test.ts`, in the shape of
  `views/conflict.test.ts:7-29`:
  - `approved` outcome → `Object.keys(view).sort()` equals
    `["canonicalSHA","outcome","taskId"]`, `view.outcome === "approved"`, and
    `"kind" in view === false`;
  - `conflict` with `conflictFiles: ["a.ts"]` → keys
    `["conflictFiles","outcome","taskId"]`, and the array is a copy
    (mutating the input afterwards does not change the view);
  - `conflict` with `conflictFiles` absent → keys `["outcome","taskId"]`;
  - `target_moved` → keys `["outcome","taskId"]`;
  - `landing_failed` built with `{ kind:"landing_failed", taskId:"t1",
message:"boom", cause: { secret:"leak-me" } }` → keys
    `["message","outcome","taskId"]`, and
    `JSON.stringify(view).includes("leak-me") === false`.
- **New** `node --test src/apps/http/views/impact.test.ts`:
  - `discardPreviewView` over one damage entry carrying an extra field cast
    `as unknown as DiscardPreview` → top-level keys
    `["counts","damage","digest"]`, damage-entry keys `["effect","target"]`,
    target keys `["id","name","type"]`;
  - `counts` keys are exactly
    `["discarded-by-cascade","left-blocked","permanently-unsatisfiable"]`;
  - `taskRejectionView` → keys `["preview","skipped"]` and `skipped` is a copy.
- `node --test src/apps/http/routes.task.test.ts` — add, using the `makeDeps()`
  fake pattern at `:1-100`:
  - `decode` for `task.approval.create` produces exactly `{ taskId: "t1" }`
    (`assert.deepEqual`), and a blank `:id` (`"/api/task/%20/approval"`) is
    `400 invalid_input`;
  - `POST /api/task/t1/approval` with `Content-Type: application/json` and body
    `{}` calls the fake exactly ONCE and answers `200` with an `ETag` header
    present;
  - `decode` for `task.rejection.create` with body
    `{"resolution":"discard","reason":"r","dryRun":true,"expectImpact":"d"}`
    produces exactly
    `{ taskId:"t1", resolution:"discard", reason:"r", dryRun:true, expectImpact:"d" }`;
  - the same with body `{"resolution":"retry"}` produces exactly
    `{ taskId:"t1", resolution:"retry" }` — no `undefined`-valued keys;
  - body `{}` → `400 invalid_input`; body `{"resolution":"maybe"}` →
    `400 invalid_input`;
  - a fake raising `TaskNotAwaitingConfirmationError` → `409` with code
    `task_not_awaiting_confirmation`; a fake raising `RejectionConflictError` →
    `409 rejection_conflict`; a fake raising `ImpactChangedError` →
    `409 impact_changed` (proves Story S1's registry rows are reachable through a
    real row).
- `node --test src/apps/http/routes.test.ts` — row count 56, both ids listed,
  the item-scope test from S1 now covers two real rows.
- `npm run verify` exits 0.
- Proof: unblocks phases **C** and **D** of
  `scripts/e2e/http-transitions-proof.sh`. Both still fail until S6 (E-G need
  later rows), so do not run the Proof to completion in this story.
