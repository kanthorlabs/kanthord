# Story 6 — `GET /api/task/:id/candidate` and `GET /api/objective/:id/candidate`

Epic: `.agent/plan/epics/026.9-candidate-review.md`
Depends on: Story 1 (both use cases), Story 5 (`no_candidate` mapping).

## Change

### 1. View `src/apps/http/views/candidate.ts`

Mirror `views/conflict.ts:4-24` — an interface with the index signature the
sibling views carry, plus a whitelist mapper.

```ts
import type { CandidateDiffOutput } from "../../../app/task/get-task-candidate.ts";

export interface CandidateFileView {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "renamed";
  readonly oldPath: string | null;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
  readonly patch: string | null;
  readonly omitted: "too-large" | "binary" | "budget" | null;
}

export interface CandidateView {
  readonly subject: "task" | "objective";
  readonly subjectId: string;
  readonly source: "landing-candidate" | "escalation" | "objective-candidate";
  readonly base: string | null;
  readonly head: string | null;
  readonly available: boolean;
  readonly unavailableReason:
    "workspace-missing" | "objects-unreachable" | "no-commit" | null;
  readonly files: readonly CandidateFileView[];
  readonly totalFiles: number;
  readonly truncated: boolean;
  readonly inspect: {
    readonly executable: "git";
    readonly args: readonly string[];
  } | null;
  readonly [key: string]: unknown;
}

export function candidateView(result: CandidateDiffOutput): CandidateView;
```

`candidateView` copies exactly the eleven fields — no spread of the input, and
`files` is rebuilt element by element so an extra field on a `DiffFile` cannot
leak.

### 2. Two route rows in `src/apps/http/routes.ts`

Inserted immediately after `task.conflict.get` (`:525-535`) and
`objective.conflict.get` (`:536-547`) respectively, so the candidate row sits
beside the conflict row for the same subject:

```ts
defineRoute({
  id: "task.candidate.get",
  method: "GET",
  path: "/api/task/:id/candidate",
  successStatus: 200,
  kind: "json",
  cliCommands: [],
  decode: ({ params }) => ({ taskId: requirePathParam(params, "id") }),
  run: async (deps, input) => deps.getTaskCandidate.execute(input),
  present: (result) => candidateView(result),
}),
```

```ts
defineRoute({
  id: "objective.candidate.get",
  method: "GET",
  path: "/api/objective/:id/candidate",
  successStatus: 200,
  kind: "json",
  cliCommands: [],
  decode: ({ params }) => ({ objectiveId: requirePathParam(params, "id") }),
  run: async (deps, input) => deps.getObjectiveCandidate.execute(input),
  present: (result) => candidateView(result),
}),
```

`cliCommands: []` follows the `health.get` precedent (`:267-272`): no CLI leaf
renders a candidate diff.

### 3. `src/apps/http/routes.test.ts`

- `PATH_SEGMENTS` (`:42-71`): add `"candidate"`. It is singular, so the
  `NOT_PLURAL` test at `:255-266` needs no change.
- The id inventory (`:337-388`): add `"task.candidate.get"` and
  `"objective.candidate.get"`.
- `ROUTES.length` (`:316-318`): **60** — 58 after 026.8, plus these two. The
  title string is updated to name EPIC 026.9's two read rows.

### 4. `src/apps/http/deps.ts`

Add beside `getConflict` (`:70`):

```ts
readonly getTaskCandidate: GetTaskCandidate;
readonly getObjectiveCandidate: GetObjectiveCandidate;
```

with `import type` lines beside the existing `GetConflict` import.

## Constraints

- Neither row is a PATCH, so neither declares `readRow`; both are `200`, so
  neither declares `location` (`routes.test.ts:153-189` enforces both).
- Do not add a CLI leaf for either route in this story.
- An unavailable diff is `200`, never an error. Only "no source pair at all"
  raises `NoCandidateError` → `409 no_candidate` (Story 5).

## Verify

- `node --test src/apps/http/views/candidate.test.ts` — the presented key set is
  exactly the eleven fields; an extra field on the input and an extra field on a
  `DiffFile` are both absent from the output; `files: []` presents as `[]`, not
  `undefined`.
- `node --test src/apps/http/routes.candidate.test.ts` — new file, following the
  `routes.task.test.ts:1-17` fixture header (`KEY`/`AUTH`/`REQUEST_ID`,
  `makeDeps()` with recording stubs, supertest against `buildHttpApp`):
  - `GET /api/task/<id>/candidate` is `200` and the body's `data` carries
    `source`, `available`, `files`, `totalFiles`, `truncated`;
  - the same for `GET /api/objective/<id>/candidate`;
  - a stub throwing `NoCandidateError` answers `409` with
    `error.code === "no_candidate"`;
  - a stub throwing `UnknownReferenceError` answers `404`;
  - a stub returning `available: false, unavailableReason: "objects-unreachable"`
    answers **`200`**, and the body carries that reason — the boundary epic
    decision 3 draws;
  - `GET /api/task/%20/candidate` is `400` `invalid_input` and the use case is
    not called;
  - the decoded input is exactly `{ taskId }` / `{ objectiveId }` — asserted
    from the recorder, so a decode drift is caught.
- `node --test src/apps/http/routes.test.ts` — `ROUTES.length === 60`, both ids
  present, the policy test and the path-vocabulary test pass with `candidate`
  allowlisted.
- `node --test src/apps/http/cli-coverage.test.ts` passes unchanged: both rows
  claim no leaf, so the uncovered count is untouched.
- `npm run verify` exits 0.
- Proof: phase C, every label.
