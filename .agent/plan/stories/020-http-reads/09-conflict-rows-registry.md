# Story S9 — conflict rows + two error-registry entries

Epic: `.agent/plan/epics/020-http-reads.md` (decision 8)
Depends on: Story S4 (`views/shared.ts`).

Two rows, two new error codes.

## Change

### 1. `src/apps/http/error-registry.ts` — extend `DOMAIN_ERROR_MAPPINGS` (`:12-19`)

```ts
  {
    error: NoConflictCandidateError,
    code: "no_conflict_candidate",
    status: 409,
    message: "the task has no conflicted landing candidate",
  },
  {
    error: ObjectiveNotInConflictError,
    code: "objective_not_in_conflict",
    status: 409,
    message: "the objective is not in conflict",
  },
```

Import sites: `ObjectiveNotInConflictError` from `../../app/errors.ts` (already
re-exported at `src/app/errors.ts:15`); `NoConflictCandidateError` from
`../../app/task/get-conflict.ts:40` (its declaration site — `app/errors.ts` does
not re-export it, and adding a re-export is out of scope).

Match the existing entry shape exactly — read `error-registry.ts:12-19` and copy
the field names it already uses.

### 2. `src/apps/http/views/conflict.ts` (new)

Both outputs are `app/` types → `import type`.

`taskConflictView(result: ConflictOverview): TaskConflictView`
(`src/app/task/get-conflict.ts:28-34`) emits exactly:
`taskId`, `branch`, `targetOID`, `candidateOID`,
`files: result.files.map((f) => ({ path: f.path, hunks: f.hunks }))`.

`objectiveConflictView(result: ObjectiveConflictOutput): ObjectiveConflictView`
(`src/app/objective/get-objective-conflict.ts:29-54`) emits exactly, in this
order: `objectiveId`, `initiativeId`, `status`, `conflictCause`, `parentOid`,
`commitOid`, `observedTipOid`, `currentTip`, `tipMovedSinceAnchor`,
`conflictReason`, `note`,
`evidence: { basis, diffAvailable, inspect: result.evidence.inspect === null ?
null : { executable: result.evidence.inspect.executable, args: [...result.evidence.inspect.args] } }`.
Every field is non-optional (nullable, not optional) — no conditional spread in
this view.

### 3. `src/apps/http/deps.ts` — `getConflict: GetConflict`, `getObjectiveConflict: GetObjectiveConflict`.

### 4. `src/apps/cli/commands/serve.ts:39` — populate both.

### 5. `src/apps/http/routes.ts` — two rows

```ts
  defineRoute({
    id: "task.conflict.get",
    method: "GET",
    path: "/api/task/:id/conflict",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get conflict"],
    decode: ({ params }) => ({ taskId: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getConflict.execute(input),
    present: (result) => taskConflictView(result),
  }),
  defineRoute({
    id: "objective.conflict.get",
    method: "GET",
    path: "/api/objective/:id/conflict",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get conflict"],
    decode: ({ params }) => ({ objectiveId: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getObjectiveConflict.execute(input),
    present: (result) => objectiveConflictView(result),
  }),
```

## Constraints

- `GetConflict.execute` takes `{ taskId }` (`src/app/task/get-conflict.ts:77`);
  `GetObjectiveConflict.execute` takes `{ objectiveId }`
  (`get-objective-conflict.ts:95`). The path param is `id` in both — decode
  renames it.
- `get conflict` appears in both rows' `cliCommands`; the CLI's `--id` XOR
  `--objective` rule is NOT ported — two paths replace it.
- Add ONLY these two registry entries. `AmbiguousNameError` is unreachable from
  an 020 route (decision 5) and must not be mapped.

## Verify

- New `src/apps/http/views/conflict.test.ts`:
  - `taskConflictView` key set exactly
    `["branch","candidateOID","files","targetOID","taskId"]`; `files[0]` exactly
    `["hunks","path"]`; injected extras dropped.
  - `objectiveConflictView` key set exactly the twelve declared fields; a case
    with every nullable field `null` asserts the keys are PRESENT and `null`;
    `evidence.inspect: null` stays `null`, and a populated `inspect` has exactly
    `["args","executable"]`.
- `src/apps/http/error-registry.test.ts` — the existing hygiene tests must cover
  the new codes automatically (unique `snake_case`, status in the allowed set).
  Add two direct tests: `mapError(new NoConflictCandidateError(...))` →
  `{ code: "no_conflict_candidate", status: 409 }` and
  `mapError(new ObjectiveNotInConflictError(...))` →
  `{ code: "objective_not_in_conflict", status: 409 }`. Construct each error with
  the arguments its own constructor requires (read `get-conflict.ts:40` and
  `get-objective-conflict.ts:60`).
- New `src/apps/http/routes.conflict.test.ts` (supertest + fake deps):
  - `GET /api/task/t1/conflict` → the fake received `{ taskId: "t1" }`; a
    successful result is enveloped as `{ data: { … } }`.
  - the fake throwing `NoConflictCandidateError` → `409 no_conflict_candidate`
    with a `requestId` in the body, and the original message NOT echoed.
  - `GET /api/objective/o1/conflict` → the fake received `{ objectiveId: "o1" }`;
    the fake throwing `ObjectiveNotInConflictError` → `409
objective_not_in_conflict`.
  - `GET /api/task/%20/conflict` → `400 invalid_input`, use case not called.
- `node --test src/apps/http/views/conflict.test.ts src/apps/http/error-registry.test.ts src/apps/http/routes.conflict.test.ts src/apps/http/routes.test.ts src/apps/http/cli-coverage.test.ts` passes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-reads-proof.sh` phase F lines
  `ERR "task with no conflict" … 409 no_conflict_candidate` and
  `ERR "objective not in conflict" … 409 objective_not_in_conflict`.
