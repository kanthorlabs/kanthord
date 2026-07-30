# Story S3 — the task reattempt and abandonment rows

Epic: `.agent/plan/epics/023-http-state-transitions.md`
Depends on: Story S2 (`views/verdict.ts` exists; the task wiring pattern is
established).

Lands 2 rows. `ROUTES.length` 56 → 58.

## Change

**1. `src/apps/http/views/verdict.ts`** — add the third export:

```ts
import type { AbandonOutcome } from "../../../app/task/abandon-task.ts";

export interface AbandonmentView {
  readonly outcome: string;
  readonly taskId: string;
  readonly [key: string]: unknown;
}

export function abandonmentView(result: AbandonOutcome): AbandonmentView {
  return { outcome: result.outcome, taskId: result.taskId };
}
```

`AbandonOutcome` is at `src/app/task/abandon-task.ts:52-55`; both variants carry
`outcome` and `taskId`, so no conditional spread is needed.

**2. `src/apps/http/routes.ts`** — append two rows before the closing `];`.

Row `task.reattempt.create` — `204`, so it declares **no** `present`:

```
id: "task.reattempt.create", method: "POST", path: "/api/task/:id/reattempt",
successStatus: 204, kind: "json", cliCommands: ["retry task"]
run: async (deps, input) => deps.retryTask.execute(input)
```

Its `decode` (`{ params, body }`):

```ts
const note = optionalBodyString(body, "note");
const rebuild = optionalBodyBool(body, "rebuild");
const carryNote = optionalBodyBool(body, "carryNote");
return {
  taskId: requirePathParam(params, "id"),
  ...(note !== undefined ? { note } : {}),
  ...(rebuild !== undefined ? { rebuild } : {}),
  ...(carryNote !== undefined ? { carryNote } : {}),
};
```

Input shape source: `src/app/task/retry-task.ts:69-74`.

Row `task.abandonment.create` — `200` with the outcome DTO:

```
id: "task.abandonment.create", method: "POST", path: "/api/task/:id/abandonment",
successStatus: 200, kind: "json", cliCommands: ["abandon task"]
decode:  ({ params, body }) => ({
           taskId: requirePathParam(params, "id"),
           reason: requireBodyString(body, "reason"),
         })
run:     async (deps, input) => deps.abandonTask.execute(input)
present: (result) => abandonmentView(result)
```

`AbandonTask.execute` is SYNCHRONOUS (`abandon-task.ts:104`). The `async` arrow
wrapping a sync call is the required form — do not change the use case and do not
add `await` gymnastics. `reason` is REQUIRED (the use case's input type demands a
`string`, and the CLI makes it a `requiredOption`,
`src/apps/cli/commands/abandon/task.ts:14`); never make it optional.

**3. Wiring, all in this story:**

- `src/apps/http/deps.ts` — `import type { RetryTask } from "../../app/task/retry-task.ts";`
  and `import type { AbandonTask } from "../../app/task/abandon-task.ts";`;
  fields `readonly retryTask: RetryTask;` and
  `readonly abandonTask: AbandonTask;`.
- `src/apps/cli/commands/serve.ts` — `retryTask: deps.retryTask,` and
  `abandonTask: deps.abandonTask,` (already on `CliDeps` at
  `src/apps/cli/deps.ts:208,218`).
- `src/composition.ts` — **no change**.

**4. `src/apps/http/routes.test.ts`** — row count 58; add
`"task.reattempt.create"` and `"task.abandonment.create"` to the expected-id
array.

## Constraints

- `task.reattempt.create` answers `204` and therefore MUST NOT declare `present`
  (the policy test at `routes.test.ts:138-150` fails otherwise) and MUST NOT emit
  an `ETag`.
- The path segment is `reattempt`. `retry` and `attempt` are both wrong: `retry`
  is in `BANNED_VERBS`, and `attempt` is reserved for EPIC 026's job API
  (epic decision 1).
- `NoRunningJobError` and `AmbiguousRunningJobError` are covered ONLY with fakes
  here. Do not attempt a live-lease scenario in any test or in the Proof: the
  status guard at `abandon-task.ts:117-120` fires first for every task a
  sequential test can reach.
- Do not touch `cli-coverage.test.ts` (Story S6 owns it).

## Verify

- `node --test src/apps/http/views/verdict.test.ts` — add:
  `abandonmentView` for both variants → keys exactly `["outcome","taskId"]`, and
  an input carrying `extra: "leak-me"` cast `as unknown as AbandonOutcome`
  produces no extra key.
- `node --test src/apps/http/routes.task.test.ts` — add:
  - `decode` for `task.reattempt.create` with body
    `{"note":"n","rebuild":true,"carryNote":false}` → exactly
    `{ taskId:"t1", note:"n", rebuild:true, carryNote:false }`;
  - the same with body `{}` → exactly `{ taskId:"t1" }` (no `undefined` keys);
  - `POST /api/task/t1/reattempt` calls the fake once, answers `204`, has an
    EMPTY body and NO `etag` header;
  - `decode` for `task.abandonment.create` with `{"reason":"stuck"}` → exactly
    `{ taskId:"t1", reason:"stuck" }`; with `{}` → `400 invalid_input`; with
    `{"reason":"   "}` → `400 invalid_input` (the trim rule of
    `requireBodyString`);
  - `POST /api/task/t1/abandonment` with a fake returning
    `{ outcome:"abandoning", taskId:"t1" }` → `200`, body `data.outcome ===
"abandoning"`, `ETag` present; with a fake returning `already_abandoning` →
    `200` and that outcome;
  - a SYNCHRONOUS fake (`execute: (i) => { received = i; return { outcome:"abandoning", taskId:"t1" }; }`,
    not `async`) still answers `200` — this is the regression guard for the
    sync-use-case call shape;
  - fakes raising `TaskNotAbandonableError` → `409 task_not_abandonable`,
    `NoRunningJobError` → `409 no_running_job`, `AmbiguousRunningJobError` →
    `409 ambiguous_running_job`, `TaskNotRetryableError` →
    `409 task_not_retryable`.
- `node --test src/apps/http/routes.test.ts` — row count 58, both ids listed, the
  `204`-without-`present` policy rule green.
- `npm run verify` exits 0.
- Proof: unblocks phase **F** of `scripts/e2e/http-transitions-proof.sh`.
