# Story S6 — task rows

Epic: `.agent/plan/epics/020-http-reads.md`
Depends on: Story S3 (`ListTasks` empty-initiative fix), S4 (`views/shared.ts`).

Two rows: the task collection under an initiative, and the task item.

## Change

### 1. `src/apps/http/views/shared.ts` — add the `TaskResultRow` mirror

`TaskResultRow` lives in `src/storage/port.ts:164-175` (an adapter — `apps/` may
not import it), so mirror it here:

```ts
export interface TaskResultView {
  readonly workspace: string | null;
  readonly branch: string | null;
  readonly baseCommit: string | null;
  readonly proposalCommit: string | null;
  readonly commitSha: string | null;
  readonly summary: string | null;
  readonly reason: string | null;
  readonly rejectionResolution: string | null;
  readonly rejectionReason: string | null;
  readonly evidence: ReadonlyArray<{
    readonly command: string;
    readonly exitCode: number;
    readonly output: string;
  }> | null;
  readonly [key: string]: unknown;
}

export function taskResultView(result: {
  readonly workspace: string | null;
  readonly branch: string | null;
  readonly baseCommit: string | null;
  readonly proposalCommit: string | null;
  readonly commitSha: string | null;
  readonly summary: string | null;
  readonly reason: string | null;
  readonly rejectionResolution: string | null;
  readonly rejectionReason: string | null;
  readonly evidence: ReadonlyArray<{
    readonly command: string;
    readonly exitCode: number;
    readonly output: string;
  }> | null;
}): TaskResultView {
  return {
    workspace: result.workspace,
    branch: result.branch,
    baseCommit: result.baseCommit,
    proposalCommit: result.proposalCommit,
    commitSha: result.commitSha,
    summary: result.summary,
    reason: result.reason,
    rejectionResolution: result.rejectionResolution,
    rejectionReason: result.rejectionReason,
    evidence:
      result.evidence === null
        ? null
        : result.evidence.map((e) => ({
            command: e.command,
            exitCode: e.exitCode,
            output: e.output,
          })),
  };
}
```

### 2. `src/apps/http/views/task.ts` (new)

`TaskRow` (`src/app/task/list-tasks.ts:6-13`) and `GetTaskOutput`
(`src/app/task/get-task.ts:65-94`) are `app/` types → `import type`.

- `taskRowView(result: TaskRow): TaskRowView` — exactly `id`, `title`, `status`,
  `state`, `dependencies: [...result.dependencies]`,
  `waiting: [...result.waiting]`.
- `taskDetailView(result: GetTaskOutput): TaskDetailView` — exactly these
  fields, in this order:
  `id`, `title`, `status`, `agent` (optional-by-value: conditional spread on
  `!== undefined`), `objectiveId`, `dependencies: [...]`, `note?`,
  `instructions?`, `ac?: [...]`, `verification?: [...]`,
  `result: result.result === undefined ? null : taskResultView(result.result)`,
  `dependencyStatus?: result.dependencyStatus?.map((d) => ({ id: d.id, status: d.status }))`,
  `context?: { ...result.context }`,
  `landingCandidate: result.landingCandidate === null ? null : { state, baseSHA, candidateSHA, target }`,
  `abandoning`, `waiting: result.waiting.map(unsatisfiedEdgeView)`,
  `blockedForever`, `downstream`, `action: nullableActionView(result.action)`.

  **Binding normalisation:** `GetTaskOutput.result` is `TaskResultRow | undefined`
  and the view emits `result: … | null` — always present, `null` when absent, so
  the UI never has to distinguish a missing key from a null value. Every other
  optional field keeps its optional-key shape via conditional spread.

### 3. `src/apps/http/views/task.ts` — the `?status=` vocabulary

The VALUE list of `TaskStatus` lives in `src/domain/task.ts:4-11` and may not be
imported. Declare it in `views/task.ts` and export it:

```ts
/** Mirrors TASK_STATUSES (src/domain/task.ts:4-11); apps/ may not import domain/. */
export const TASK_STATUS_VALUES = [
  "pending",
  "running",
  "completed",
  "failed",
  "awaiting_confirmation",
  "discarded",
] as const;
```

The type is legally reachable: `import type { TaskStatus } from "../../../app/errors.ts";`
(`src/app/errors.ts:6`).

### 4. `src/apps/http/deps.ts` — `listTasks: ListTasks`, `getTask: GetTask`.

### 5. `src/apps/cli/commands/serve.ts:39` — populate both.

### 6. `src/apps/http/routes.ts` — two rows

```ts
  defineRoute({
    id: "initiative.task.list",
    method: "GET",
    path: "/api/initiative/:id/task",
    successStatus: 200,
    kind: "json",
    cliCommands: ["list task"],
    decode: ({ params, query }) => {
      const status = optionalQueryString(query, "status");
      if (status !== undefined && !TASK_STATUS_VALUES.includes(status as TaskStatus)) {
        throw new InvalidInputError("status", `must be one of ${TASK_STATUS_VALUES.join(", ")}`);
      }
      const objectiveId = optionalQueryString(query, "objective");
      return {
        initiativeId: requirePathParam(params, "id"),
        ...(status !== undefined ? { status: status as TaskStatus } : {}),
        ...(objectiveId !== undefined ? { objectiveId } : {}),
      };
    },
    run: async (deps, input) => deps.listTasks.execute(input),
    present: (result) => result.map(taskRowView),
  }),
  defineRoute({
    id: "task.get",
    method: "GET",
    path: "/api/task/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get task"],
    decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getTask.execute(input),
    present: (result) => taskDetailView(result),
  }),
```

`src/apps/http/routes.ts` must import `InvalidInputError` from `./errors.ts`
(first use in that file) alongside `TASK_STATUS_VALUES` and the `TaskStatus`
type-only import.

## Constraints

- The query parameter is `objective`, the use-case field is `objectiveId`
  (`src/app/task/list-tasks.ts:22-26`).
- An unknown `?status=` value is `400 invalid_input`, never silently ignored and
  never passed through.
- `GetTask.execute` destructures `{ id }` (`src/app/task/get-task.ts:120`).

## Verify

- New `src/apps/http/views/task.test.ts`:
  - `taskRowView` leak test — `Object.keys(view).sort()` is exactly
    `["dependencies","id","state","status","title","waiting"]` (six keys), and an
    injected extra field is dropped.
  - `taskDetailView` case 1 — every optional field ABSENT and every nullable
    field `null`: assert the key set contains `result`, `landingCandidate`,
    `action` (all `null`) and does NOT contain `note`, `instructions`, `ac`,
    `verification`, `agent`, `dependencyStatus`, `context`.
  - `taskDetailView` case 2 — every field populated: assert the full key set,
    the `result` sub-object's exact 10 keys through `taskResultView`, the
    `evidence[0]` keys, the `landingCandidate` keys
    (`["baseSHA","candidateSHA","state","target"]`), the `dependencyStatus[0]`
    keys (`["id","status"]`), and that injected extras on each nested object are
    dropped.
- `src/apps/http/views/shared.test.ts` — add `taskResultView` tests: `evidence:
null` stays `null`; a populated evidence array is mapped element-wise with
  exactly three keys each.
- New `src/apps/http/routes.task.test.ts` (supertest + fake deps):
  - `GET /api/initiative/i1/task` → fake received exactly `{ initiativeId: "i1" }`.
  - `?status=pending&objective=o1` → `{ initiativeId: "i1", status: "pending", objectiveId: "o1" }`.
  - `?status=bogus` → `400 invalid_input`, use case not called.
  - `?objective=o1&objective=o2` → `400 invalid_input`.
  - the fake returning `[]` → `200` with `{ data: [] }` (the decision-7
    statement at the HTTP layer).
  - `GET /api/task/t1` → `{ id: "t1" }`; fake throwing
    `UnknownReferenceError("task","t1")` → `404 unknown_reference`.
- `node --test src/apps/http/views/task.test.ts src/apps/http/views/shared.test.ts src/apps/http/routes.task.test.ts src/apps/http/routes.test.ts src/apps/http/cli-coverage.test.ts` passes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-reads-proof.sh` phase C task lines, including
  `eq "empty initiative task list" "0" …`.
