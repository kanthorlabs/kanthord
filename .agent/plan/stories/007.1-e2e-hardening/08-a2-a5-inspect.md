# Story 08 — A2/A5: GetTask loads context + --result render

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

Two local-inspection gaps fixed — both read from tables that already exist:

- **A5** — `get task --json` shows `undefined` for the `context` field today even
  though `task_context` rows exist. `GetTask` gains a third constructor parameter
  (a `ContextSource`) and includes the resolved context bindings in `GetTaskOutput`.
- **A2** — no CLI to view a task result. `get task --result` renders `summary`,
  verification evidence (commands + exit codes), `commit_sha`, and files changed
  from `task_results`. A raw SQLite poke is no longer needed to inspect a run.

Both are local-only (layer 2 per the epic design notes): the private journal is
read directly with no sanitization required.

## Locked contracts (exact names — tests assert verbatim)

```ts
// src/app/task/get-task.ts

// NEW narrow interface for the 3rd constructor parameter:
interface ContextSource {
  getTaskContext(taskId: string): Record<string, string>;
}

// CHANGED GetTaskOutput — gains context field:
export interface GetTaskOutput {
  id: string;
  title: string;
  status: string;
  agent: string | undefined;
  objectiveId: string;
  dependencies: string[];
  instructions?: string;
  ac?: string[];
  verification?: string[];
  result: TaskResultRow | undefined;
  context?: Record<string, string>; // NEW (A5) — omitted when empty map
  dependencyStatus?: Array<{ id: string; status: string }>;
}

// CHANGED GetTask constructor:
export class GetTask {
  constructor(
    tasks: TaskSource,
    results: ResultSource,
    context: ContextSource, // NEW 3rd parameter
  );
  async execute({ id }: { id: string }): Promise<GetTaskOutput>;
}
// Existing 2-argument instantiations in tests must be updated to pass a
// NullContextSource stub (returns {}) as the 3rd argument.
```

```ts
// src/apps/cli/task.ts — runGetTask gains --result flag
// When args["result"] is truthy and output.result is defined:
//   stdout lines:
//     "Summary: <summary>"
//     "Commit:  <commitSha>"
//     "Files:   <comma-separated list from evidence + workspace>"
//     "--- Verification ---"
//     "$ <command>   exit <exitCode>"   (one line per evidence item)
//     "<output trimmed to 500 chars>"   (one block per evidence item)
// When args["json"] is truthy:
//   JSON output includes the "context" field when present.
// --result and --json are mutually exclusive; if both are set, exit 1 with error.
```

```ts
// src/apps/cli/router.ts — COMMANDS["get task"].parse gains:
//   result: { type: "boolean" }
// (alongside the existing id and json flags)
```

## Constraints

- `GetTask` takes `ContextSource` as the third constructor parameter, not as a
  method argument. This keeps the use case pure: all deps at construction time.
- `SqliteTaskRepository` already implements `getTaskContext(taskId): Record<string,
string>` (it is on the `TaskRepository` interface in `src/storage/port.ts`).
  The composition root passes `tasks` (the existing `SqliteTaskRepository`) as the
  third argument — no new adapter required.
- If `getTaskContext` returns an empty map `{}`, `context` is omitted from
  `GetTaskOutput` (consistent with the existing sparse-field pattern for
  `instructions`, `ac`, `verification`).
- The `--result` render reads only what is already in `GetTaskOutput.result`
  (`TaskResultRow`). No new DB queries in the CLI handler.
- `TaskResultRow.evidence` is `Array<{ command: string; exitCode: number;
output: string }> | null` (already defined in `src/storage/port.ts`). The
  `--result` render uses this array for the verification block.
- `--result` and `--json` are mutually exclusive: if both flags are set, exit 1
  with `"error: --result and --json are mutually exclusive"`.
- This story does NOT add a new use case for `show task` — the `--result` flag
  on the existing `get task` command is sufficient per the epic scope.

## Verification Gate

- `node --test src/app/task/get-task.test.ts` — `GetTaskOutput.context` is
  populated when the injected `ContextSource` returns a non-empty map; omitted
  when it returns `{}`.
- `node --test src/apps/cli/get-task.test.ts` (or `src/apps/cli/task.test.ts`):
  (a) `--result` with a non-null `TaskResultRow` renders lines containing `"Summary"`,
  `"Commit"`, at least one `"$ "` line; (b) `--json` without `--result` includes
  `"context"` in the output when context is non-empty; (c) `--result` with
  `result: undefined` returns exit 1 with an error message; (d) `--result --json`
  together returns exit 1.
- `npm run typecheck && npm run lint` clean.

---

### Task T1 — A5: GetTask loads task_context

**Requires:** Story 06 (migration 7 in place; though `task_context` exists since
migration 3, this story's `Requires` ensures the migration chain is coherent and
`task.verification` events are available for the result render in T2).

**Input:** `src/app/task/get-task.ts`, `src/app/task/get-task.test.ts`.

**Action — RED:** In `src/app/task/get-task.test.ts`: (a) construct `GetTask` with
a `ContextSource` stub returning `{ repository: "REPO-1", ai_provider: "AIP-1" }`;
call `execute({ id: "T1" })`; assert `output.context` deep-equals
`{ repository: "REPO-1", ai_provider: "AIP-1" }`. (b) With a stub returning `{}`:
assert `output.context === undefined`. Fails today: `GetTask` constructor takes 2
arguments; `context` field absent from `GetTaskOutput`.

**Action — GREEN:** Add `ContextSource` interface and `context: ContextSource`
as the third constructor parameter; store as `#context`. In `execute()`, call
`const ctx = this.#context.getTaskContext(id)` and include it in the return only
when `Object.keys(ctx).length > 0`. Update all existing `GetTask` test
instantiations to pass a `NullContextSource` stub `({ getTaskContext: () => ({}) })`
as the third argument. Update `composition.ts` to pass `tasks` (which is
`SqliteTaskRepository`) as the third argument — it already satisfies `ContextSource`.

**Action — REFACTOR:** None.

**Output:** `GetTaskOutput.context` is populated from `task_context`; existing
tests remain green.

**Verify:** `node --test src/app/task/get-task.test.ts` green; `npm run typecheck` 0.

---

### Task T2 — A2: --result CLI render + --json context field

**Requires:** T1.

**Input:** `src/apps/cli/task.ts`, `src/apps/cli/router.ts`,
`src/apps/cli/get-task.test.ts` (or `src/apps/cli/task.test.ts` — whichever file
contains `runGetTask` tests).

**Action — RED:** In the get-task CLI test file: (a) call `runGetTask` with
`args = { id: "T1", result: true }` and a `GetTask` stub returning
`{ ..., result: { summary: "done", commitSha: "abc123", branch: "b",
workspace: "/ws", evidence: [{ command: "npm test", exitCode: 0, output: "ok" }],
baseCommit: "base", proposalCommit: null, reason: null,
rejectionResolution: null, rejectionReason: null } }`; assert `stdout.join("")`
contains `"Summary"`, `"Commit"`, `"abc123"`, `"npm test"`, and `"exit 0"`.
(b) Same with `args = { id: "T1", result: true }` but `result: undefined`:
assert `exitCode === 1` and `stderr[0]` contains `"no result"`.
(c) `args = { id: "T1", json: true }`: assert stdout JSON includes `"context"`.
(d) `args = { id: "T1", result: true, json: true }`: assert `exitCode === 1`
and `stderr[0]` matches `/mutually exclusive/`. Fails today: `--result` flag is
not handled; `--json` omits context.

**Action — GREEN:**

- In `src/apps/cli/task.ts`, `runGetTask`: (1) check for `args["result"] &&
args["json"]` → return exitCode 1 with the error. (2) If `args["result"]`: call
  `getTask.execute({ id })` and render `result` fields per the locked format;
  if `output.result === undefined`, return exitCode 1 with `"error: task T1 has
no result yet"`. (3) If `args["json"]`: include `context` in the serialized
  object when present (`{ ...output, context: output.context }`).
- In `src/apps/cli/router.ts`: add `result: { type: "boolean" }` to the
  `COMMANDS["get task"].parse` options object.

**Action — REFACTOR:** Extract a `renderTaskResult(result: TaskResultRow): string[]`
pure function if the render block exceeds ~25 lines — keeps `runGetTask` readable
and the renderer independently testable.

**Output:** `get task --id X --result` renders summary/verification/commit/files;
`get task --id X --json` includes context; mutually-exclusive guard works.

**Verify:** `node --test src/apps/cli/get-task.test.ts` (or `task.test.ts`) green;
`npm run typecheck` 0; `npm run verify` clean.
