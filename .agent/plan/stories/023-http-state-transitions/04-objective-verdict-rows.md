# Story S4 — the three objective verdict rows

Epic: `.agent/plan/epics/023-http-state-transitions.md`
Depends on: Story S2 (`views/verdict.ts`, `views/impact.ts` and the
`discardPreviewView` helper exist).

Lands 3 rows. `ROUTES.length` 58 → 61.

## Change

**1. `src/apps/http/views/verdict.ts`** — add:

```ts
export interface ObjectiveApprovalView {
  readonly outcome: string;
  readonly [key: string]: unknown;
}

export function objectiveApprovalView(result: {
  outcome: "integrated" | "conflict";
}): ObjectiveApprovalView {
  return { outcome: result.outcome };
}
```

`ApproveObjective.execute` returns `Promise<{ outcome: "integrated" | "conflict" }>`
(`src/app/objective/approve-objective.ts:46-49`); it exports no named result type,
so the input is typed inline as above — do not invent an exported alias in
`app/`.

**2. `src/apps/http/views/impact.ts`** — add:

```ts
export interface ObjectiveRejectionView {
  readonly preview: DiscardPreviewView;
  readonly [key: string]: unknown;
}

export function objectiveRejectionView(result: {
  preview: DiscardPreview;
}): ObjectiveRejectionView {
  return { preview: discardPreviewView(result.preview) };
}
```

`RejectObjective.execute` returns `Promise<{ preview: DiscardPreview }>`
(`src/app/objective/reject-objective.ts:117-122`) — note it has NO `skipped`
field, unlike `RejectTask`. Do not add one.

**3. `src/apps/http/routes.ts`** — append three rows before the closing `];`.

Row `objective.approval.create`:

```
id: "objective.approval.create", method: "POST",
path: "/api/objective/:id/approval", successStatus: 200, kind: "json",
cliCommands: ["approve objective"]
decode:  ({ params, body }) => ({
           objectiveId: requirePathParam(params, "id"),
           expectedCommit: requireBodyString(body, "expectedCommit"),
         })
run:     async (deps, input) => deps.approveObjective.execute(input)
present: (result) => objectiveApprovalView(result)
```

Row `objective.rejection.create`:

```
id: "objective.rejection.create", method: "POST",
path: "/api/objective/:id/rejection", successStatus: 200, kind: "json",
cliCommands: ["reject objective"]
run:     async (deps, input) => deps.rejectObjective.execute(input)
present: (result) => objectiveRejectionView(result)
```

Its `decode` (`{ params, body }`), in this order:

```ts
const reason = optionalBodyString(body, "reason");
const dryRun = optionalBodyBool(body, "dryRun");
const expectImpact = optionalBodyString(body, "expectImpact");
return {
  objectiveId: requirePathParam(params, "id"),
  expectedCommit: requireBodyString(body, "expectedCommit"),
  ...(reason !== undefined ? { reason } : {}),
  ...(dryRun !== undefined ? { dryRun } : {}),
  ...(expectImpact !== undefined ? { expectImpact } : {}),
};
```

**There is no `resolution` field on this row.** The CLI's
`reject objective --resolution retry` is a CLI-side branch between two use cases
(`src/apps/cli/commands/reject/objective.ts:60-63`); over HTTP the retry half IS
`objective.reattempt.create` below (epic decision 6). Input shape source:
`src/app/objective/reject-objective.ts:117-122`.

Row `objective.reattempt.create` — `204`, no `present`:

```
id: "objective.reattempt.create", method: "POST",
path: "/api/objective/:id/reattempt", successStatus: 204, kind: "json",
cliCommands: ["retry objective"]
run: async (deps, input) => deps.retryObjective.execute(input)
```

Its `decode`:

```ts
const note = optionalBodyString(body, "note");
return {
  objectiveId: requirePathParam(params, "id"),
  expectedCommit: requireBodyString(body, "expectedCommit"),
  ...(note !== undefined ? { note } : {}),
};
```

Input shape source: `src/app/objective/retry-objective.ts:81-85`.

**4. Wiring, all in this story:**

- `src/apps/http/deps.ts` — `import type` for `ApproveObjective`
  (`../../app/objective/approve-objective.ts`), `RejectObjective`
  (`…/reject-objective.ts`), `RetryObjective` (`…/retry-objective.ts`); fields
  `readonly approveObjective: ApproveObjective;`,
  `readonly rejectObjective: RejectObjective;`,
  `readonly retryObjective: RetryObjective;`.
- `src/apps/cli/commands/serve.ts` — `approveObjective: deps.approveObjective,`,
  `rejectObjective: deps.rejectObjective,`, `retryObjective: deps.retryObjective,`
  (already on `CliDeps` at `src/apps/cli/deps.ts:214-216`).
- `src/composition.ts` — **no change**.

**5. `src/apps/http/routes.test.ts`** — row count 61; add the three ids to the
expected-id array.

## Constraints

- `expectedCommit` is REQUIRED on all three rows. Absent, blank, or non-string →
  `400 invalid_input` from `requireBodyString`. Never make it optional and never
  default it: EPIC 012 decision 4 made the guard mandatory, and a silently
  unguarded verdict is the exact failure that decision prevents.
- No row sets `readRow` and no row uses `If-Match`. The freshness guard is
  `expectedCommit` in the body (epic decision 3).
- `objective.reattempt.create` answers `204`, so no `present` and no `ETag`.
- `run` stays one line: no branching on `dryRun`, no branching on outcome.
- Do not touch `cli-coverage.test.ts` (Story S6 owns it).

## Verify

- `node --test src/apps/http/views/verdict.test.ts` — add: `objectiveApprovalView`
  for `integrated` and for `conflict` → keys exactly `["outcome"]`, with an input
  carrying `extra: "leak-me"` proving nothing else is copied.
- `node --test src/apps/http/views/impact.test.ts` — add: `objectiveRejectionView`
  → keys exactly `["preview"]`, and the nested preview keys are
  `["counts","damage","digest"]`.
- **New** `node --test src/apps/http/routes.verdict.test.ts` — a per-surface row
  test file, following the precedent of `routes.conflict.test.ts` (which groups
  the task and objective conflict rows), using the `makeDeps()` fake pattern of
  `routes.task.test.ts:1-100`:
  - `decode` for `objective.approval.create` with `{"expectedCommit":"abc"}` →
    exactly `{ objectiveId:"o1", expectedCommit:"abc" }`; with `{}` →
    `400 invalid_input`; with `{"expectedCommit":"  "}` → `400 invalid_input`;
  - `POST /api/objective/o1/approval` calls the fake once, answers `200` with
    `data.outcome === "integrated"` and an `ETag`; a fake returning
    `{ outcome:"conflict" }` also answers `200` (NOT 409 — epic decision 4);
  - `decode` for `objective.rejection.create` with
    `{"expectedCommit":"abc","reason":"r","dryRun":true,"expectImpact":"d"}` →
    exactly `{ objectiveId:"o1", expectedCommit:"abc", reason:"r", dryRun:true, expectImpact:"d" }`;
    with only `{"expectedCommit":"abc"}` → exactly
    `{ objectiveId:"o1", expectedCommit:"abc" }`;
  - the rejection row's decoded input has NO `resolution` key, asserted
    explicitly (`assert.equal("resolution" in received, false)`);
  - `decode` for `objective.reattempt.create` with
    `{"expectedCommit":"abc","note":"n"}` → exactly
    `{ objectiveId:"o1", expectedCommit:"abc", note:"n" }`; `POST` answers `204`
    with an empty body and NO `etag`;
  - a blank `:id` on each of the three paths → `400 invalid_input`;
  - fakes raising `StaleCandidateError` → `409 stale_candidate`,
    `ObjectiveNotAwaitingConfirmationError` →
    `409 objective_not_awaiting_confirmation`, `ObjectiveNotRetryableError` →
    `409 objective_not_retryable`, `ImpactChangedError` → `409 impact_changed`.
- `node --test src/apps/http/routes.test.ts` — row count 61, three ids listed,
  the item-scope test green over five verdict rows.
- `npm run verify` exits 0.
- Proof: unblocks phase **E** of `scripts/e2e/http-transitions-proof.sh`.
