# Story 7 — the four verdict routes and their status mapping

Epic: `.agent/plan/epics/026.9-candidate-review.md`
Depends on: Story 3 (`AssertDecisionOpen`), Story 4 (`expectedCommit` on
`ApproveTask`), Story 5 (the error registry), Story 6 (`ROUTES.length === 60`).

Verdicts are CLI-only today: `src/apps/http/deps.ts` carries none of the four
use cases and `routes.ts` has no approval or rejection path.

## Change

### 1. `src/apps/http/deps.ts`

Add the four use cases and the guard:

```ts
readonly approveTask: ApproveTask;
readonly rejectTask: RejectTask;
readonly approveObjective: ApproveObjective;
readonly rejectObjective: RejectObjective;
readonly assertDecisionOpen: AssertDecisionOpen;
```

`src/composition.ts` already builds all four (`:828`, `:431`, `:1058`, `:1095`);
add them to the HTTP deps bundle beside `getDecisionQueue` (`:1259` region)
together with Story 3's `assertDecisionOpen`.

### 2. View `src/apps/http/views/verdict.ts`

```ts
export interface ApprovalView {
  readonly outcome: "approved" | "conflict" | "integrated";
  readonly subjectId: string;
  /** Present for `approved`; `null` when the approval landed nothing. */
  readonly canonicalSHA: string | null;
  /** Present for `conflict` only: the route that explains it. */
  readonly conflictPath: string | null;
  readonly [key: string]: unknown;
}

export interface RejectionView {
  readonly outcome: "rejected" | "previewed";
  readonly subjectId: string;
  readonly resolution: "retry" | "discard";
  readonly skipped: readonly string[];
  readonly preview: {
    readonly digest: string;
    readonly damage: ReadonlyArray<{
      readonly target: { readonly type: string; readonly id: string };
      readonly effect: string;
      readonly name: string | null;
    }>;
  };
  readonly [key: string]: unknown;
}

export function taskApprovalView(
  result: ApproveOutcome & { kind: "approved" | "conflict" },
  taskId: string,
): ApprovalView;
export function objectiveApprovalView(
  result: { outcome: "integrated" | "conflict" },
  objectiveId: string,
): ApprovalView;
export function rejectionView(
  result: { skipped: string[]; preview: DiscardPreview },
  subjectId: string,
  resolution: "retry" | "discard",
  dryRun: boolean,
): RejectionView;
```

Pinned mapping:

- `taskApprovalView`: `approved` → `{ outcome: "approved", canonicalSHA: result.canonicalSHA === "" ? null : result.canonicalSHA, conflictPath: null }`;
  `conflict` → `{ outcome: "conflict", canonicalSHA: null, conflictPath: \`/api/task/${taskId}/conflict\` }`.
- `objectiveApprovalView`: `integrated` → `{ outcome: "integrated", canonicalSHA: null, conflictPath: null }`;
  `conflict` → `{ outcome: "conflict", canonicalSHA: null, conflictPath: \`/api/objective/${objectiveId}/conflict\` }`.
- `rejectionView`: `outcome` is `"previewed"` when `dryRun` is true, else
  `"rejected"`. `damage[].name` is `null` when the preview entry has none. The
  view rebuilds every element; it never spreads `DiscardPreview`.

### 3. Four route rows in `src/apps/http/routes.ts`

All four are `method: "POST"`, `successStatus: 200`, `kind: "json"`, with a
`present`. None declares `readRow` or `location`.

**Shared decode fragment** — declared once above `ROUTES`, beside the other
row-factory helpers (`:177-236`):

```ts
/** `null` iff the caller sent JSON `null`; a missing key is an error. */
function requireNullableCommit(body: unknown, field: string): string | null {
  const record = body as Record<string, unknown> | null;
  if (record === null || typeof record !== "object" || !(field in record)) {
    throw new InvalidInputError(
      field,
      "is required; send null when the subject has no commit",
    );
  }
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidInputError(field, "must be a non-empty string or null");
  }
  return value.trim();
}
```

`requireBodyString` already exists (`src/apps/http/body.ts:20`);
`requireNullableCommit` is new and lives in `src/apps/http/body.ts` beside it,
exported, because `body.ts` owns body reading (EPIC 021 decision 2).

```ts
defineRoute({
  id: "task.approval.create",
  method: "POST",
  path: "/api/task/:id/approval",
  successStatus: 200,
  kind: "json",
  cliCommands: ["approve task"],
  decode: ({ params, body }) => ({
    taskId: requirePathParam(params, "id"),
    decisionId: requireBodyString(body, "decisionId"),
    expectedCommit: requireNullableCommit(body, "expectedCommit"),
  }),
  run: async (deps, input) => {
    deps.assertDecisionOpen.execute({
      decisionId: input.decisionId,
      subject: { type: "task", id: input.taskId },
    });
    const outcome = await deps.approveTask.execute({
      taskId: input.taskId,
      expectedCommit: input.expectedCommit,
    });
    if (outcome.kind === "target_moved") throw new TargetMovedError(input.taskId);
    if (outcome.kind === "landing_failed") throw new LandingFailedError(input.taskId, outcome.message);
    return outcome;
  },
  present: (result) => taskApprovalView(result, result.taskId),
}),
```

```ts
defineRoute({
  id: "task.rejection.create",
  method: "POST",
  path: "/api/task/:id/rejection",
  successStatus: 200,
  kind: "json",
  cliCommands: ["reject task"],
  decode: ({ params, body }) => {
    const resolution = requireBodyString(body, "resolution");
    if (resolution !== "retry" && resolution !== "discard") {
      throw new InvalidInputError("resolution", 'must be "retry" or "discard"');
    }
    return {
      taskId: requirePathParam(params, "id"),
      decisionId: requireBodyString(body, "decisionId"),
      resolution,
      reason: optionalBodyString(body, "reason"),
      dryRun: optionalBodyBool(body, "dryRun"),
      expectImpact: optionalBodyString(body, "expectImpact"),
    };
  },
  run: async (deps, input) => {
    deps.assertDecisionOpen.execute({
      decisionId: input.decisionId,
      subject: { type: "task", id: input.taskId },
    });
    const value = await deps.rejectTask.execute({
      taskId: input.taskId,
      resolution: input.resolution,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.dryRun !== undefined ? { dryRun: input.dryRun } : {}),
      ...(input.expectImpact !== undefined ? { expectImpact: input.expectImpact } : {}),
    });
    return {
      value: value ?? { skipped: [], preview: { digest: "", damage: [] } },
      taskId: input.taskId,
      resolution: input.resolution,
      dryRun: input.dryRun === true,
    };
  },
  present: (result) => rejectionView(result.value, result.taskId, result.resolution, result.dryRun),
}),
```

This story lands all four rows **complete and green**. Story 9 inserts one
precondition into the two rejection `run` bodies and changes nothing else —
`npm run verify` must exit 0 at the end of this story, not only at the end of
Story 9.

The objective rows are the same two shapes with
`path: "/api/objective/:id/approval"` / `"/api/objective/:id/rejection"`,
`cliCommands: ["approve objective"]` / `["reject objective"]`,
`subject: { type: "objective", id }`, and:

- objective approval calls
  `deps.approveObjective.execute({ objectiveId, expectedCommit })` — its
  `expectedCommit` is a **required non-null string**
  (`approve-objective.ts:46-49`), so the objective rows use
  `requireBodyString(body, "expectedCommit")`, not `requireNullableCommit`.
  Only the task path is nullable, and only because an escalation may have no
  commit (epic decision 8).
- objective rejection calls
  `deps.rejectObjective.execute({ objectiveId, expectedCommit, resolution?, reason?, dryRun?, expectImpact? })`
  per `reject-objective.ts:117-124`, and therefore also requires
  `expectedCommit` as a non-null string.

The guard runs **before** the use case in every one of the four rows, so a
closed occurrence costs no git work.

### 4. `src/apps/http/routes.test.ts`

- `PATH_SEGMENTS` (`:42-71`): add `"approval"` and `"rejection"`. Both singular.
- `BANNED_VERBS` (`:8-35`) needs **no change**: it lists `approve` and `reject`
  (`:14-15`) but not `approval` or `rejection`, and `hasBannedVerbSegment`
  (`:92-97`) compares whole segments. The noun paths pass as they stand. Do not
  add or remove a banned verb.
- The id inventory (`:337-388`): add the four ids.
- `ROUTES.length` (`:316-318`): **64**.

### 5. `src/apps/http/cli-coverage.test.ts`

The four rows claim four leaves that no row claims today: `approve task`,
`reject task`, `approve objective`, `reject objective`. Add an EPIC-026.9
expected-covered list of exactly those four, following the 020/021 pattern
(`:65-101`, `:103-141`), and change the pinned uncovered count at `:149` from
`26` to **22**, with the comment updated to
`// 78 retirable leaves, 25 claimed by 020, 27 by 021, 4 by 026.9.`

If the observed uncovered count is not `22`, that is predecessor drift — report
it as a blocker; do not silently re-pin the number.

## Constraints

- `outcome.cause` from `ApproveOutcome`'s `landing_failed` arm
  (`approve-task.ts:33-38`) must **not** reach `LandingFailedError`, the view, or
  the wire.
- No route may answer `500` for a state. `landing_failed` is the only `500`, and
  it means the landing itself failed, not that a rule refused the request.
- The conflict outcome is a **`200`**. Do not convert it to a `4xx`.
- Do not change any of the four use cases in this story; Story 4 already changed
  `ApproveTask`.

## Verify

- `node --test src/apps/http/body.test.ts` — `requireNullableCommit`: a missing
  key throws `InvalidInputError`; an explicit `null` returns `null`; a string
  returns it trimmed; `""` and `"   "` throw; a number throws; a non-object body
  throws.
- `node --test src/apps/http/views/verdict.test.ts` — each of the five mappings
  above, asserting the exact key set; `canonicalSHA: ""` presents as `null`;
  a `conflict` carries the right `conflictPath` for each subject.
- `node --test src/apps/http/routes.verdict.test.ts` — new file, fixture header
  per `routes.task.test.ts:1-17`:
  - `POST /api/task/:id/approval` with a valid body is `200`,
    `outcome === "approved"`, and the guard was called **before** the use case
    (both stubs push to one shared order array);
  - a guard throwing `DecisionClosedError` answers `409 decision_closed` **and
    the approve stub was never called**;
  - a guard throwing `DecisionSubjectMismatchError` answers
    `409 decision_subject_mismatch`;
  - `ApproveTask` throwing `StaleCandidateError` answers `409 stale_candidate`;
  - an `ApproveTask` returning `{kind:"conflict"}` answers **`200`** with
    `outcome === "conflict"` and a `conflictPath`;
  - returning `{kind:"target_moved"}` answers `409 target_moved`;
  - returning `{kind:"landing_failed", message, cause}` answers `500
landing_failed`, and the response body contains neither the message nor
    anything from `cause`;
  - a body with no `decisionId` is `400 invalid_input` and neither the guard nor
    the use case was called;
  - a body with `expectedCommit` **absent** is `400`; with `expectedCommit: null`
    the use case receives `null`;
  - the same axes for `POST /api/objective/:id/approval`, plus: a body with
    `expectedCommit: null` is `400` there (objective approval is not nullable);
  - `POST /api/task/:id/rejection` with `resolution: "banana"` is `400
invalid_input`;
  - every one of the four routes, driven through each registered error class of
    Story 5, answers a `4xx` — **no response in the file has status `500`
    except the one explicit `landing_failed` case**, asserted by collecting
    every status the file produced.
- `node --test src/apps/http/routes.test.ts` — `ROUTES.length === 64`; the four
  ids present; the policy test passes (POST + 200 + `present`, no `location`,
  no `readRow`); the path-vocabulary test passes with `approval` and `rejection`
  allowlisted; the banned-verb test still passes.
- `node --test src/apps/http/cli-coverage.test.ts` — the four leaves are
  covered; `uncovered.length === 22`.
- `npm run verify` exits 0.
- Proof: phases D and E (`a stale expectedCommit is refused with 409`, `an
unknown decision occurrence is refused with 409`, `the approval answers 200`,
  `it reports the outcome, not a bare success`, `the objective really
transitioned in SQLite`, `replaying the same verdict is refused, not
re-run`).
