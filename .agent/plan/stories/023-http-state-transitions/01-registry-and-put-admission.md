# Story S1 — `PUT` admission, the 12 registry codes, the 5 segments, two app-layer edits

Epic: `.agent/plan/epics/023-http-state-transitions.md`
Depends on: EPIC 022 (sequence order).

Lands NO route row. `ROUTES.length` stays at whatever 022 left (54).

## Change

**1. `src/app/task/reject-task.ts:147`** — drop the vestigial `| undefined`:

```
-  }): Promise<{ skipped: string[]; preview: DiscardPreview } | undefined> {
+  }): Promise<{ skipped: string[]; preview: DiscardPreview }> {
```

Change nothing else in the file. All six return sites already return an object
(`:189,196,204,208,301,385`).

**2. `src/app/errors.ts`** — after the landing re-export block that ends at `:31`,
add one type re-export with a one-line comment in the file's existing voice:

```ts
// Impact types — re-exported so apps/ can present a discard preview without
// importing domain/.
export type { DiscardPreview, Damage, DamageEffect } from "../domain/impact.ts";
```

Declarations being re-exported: `DamageEffect` (`src/domain/impact.ts:41`),
`Damage` (`:44`), `DiscardPreview` (`:53`).

**3. `src/apps/http/routes.ts:30`** — admit `PUT` in the method union:

```
-export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
+export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
```

**4. `src/apps/http/app.ts:153`** — the `@koa/cors` preflight answer must
advertise the new method:

```
-      allowMethods: ["GET", "POST", "PATCH", "DELETE"],
+      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
```

No middleware is added, removed or reordered. `requiresJsonContentType`
(`app.ts:26-29`) and `requiresOriginCheck` (`app.ts:31-39`) already list `PUT`;
do not touch them.

**5. `src/apps/http/error-registry.ts`** — add the imports and append 12 mappings
to `DOMAIN_ERROR_MAPPINGS` (array ends `:36`), in this exact order. No class is a
subclass of another, so `mapError`'s `instanceof` scan (`:104-112`) is
order-independent; keep the order anyway so the diff is reviewable.

Imports to add:

- from `"../../app/errors.ts"` (extend the existing import at `:2-6`):
  `StaleCandidateError`, `ObjectiveNotAwaitingConfirmationError`,
  `TaskNotAwaitingConfirmationError`, `ImpactChangedError`,
  `ProposalWorkspaceMissingError`
- `import { RejectionConflictError } from "../../app/task/reject-task.ts";`
- `import { TaskNotRetryableError } from "../../app/task/retry-task.ts";`
- `import { ObjectiveNotRetryableError } from "../../app/objective/retry-objective.ts";`
- `import { TaskNotAbandonableError, NoRunningJobError, AmbiguousRunningJobError } from "../../app/task/abandon-task.ts";`
- `import { ProposalMissingError } from "../../app/task/approve-task.ts";`

Mappings (every one `status: 409`, no `message` override — each class's own
message is the useful one):

| `type`                                  | `code`                                |
| --------------------------------------- | ------------------------------------- |
| `StaleCandidateError`                   | `stale_candidate`                     |
| `ObjectiveNotAwaitingConfirmationError` | `objective_not_awaiting_confirmation` |
| `TaskNotAwaitingConfirmationError`      | `task_not_awaiting_confirmation`      |
| `ImpactChangedError`                    | `impact_changed`                      |
| `RejectionConflictError`                | `rejection_conflict`                  |
| `TaskNotRetryableError`                 | `task_not_retryable`                  |
| `ObjectiveNotRetryableError`            | `objective_not_retryable`             |
| `TaskNotAbandonableError`               | `task_not_abandonable`                |
| `NoRunningJobError`                     | `no_running_job`                      |
| `AmbiguousRunningJobError`              | `ambiguous_running_job`               |
| `ProposalMissingError`                  | `proposal_missing`                    |
| `ProposalWorkspaceMissingError`         | `proposal_workspace_missing`          |

Do NOT register: `LandingCASMismatchError` (caught inside `ApproveTask`,
`approve-task.ts:296-307`), `CycleError`, `DependenciesLockedError`,
`UnknownAgentError`, or the bare `Error("revoke invariant violated…")`
(`abandon-task.ts:139`, correctly `500 internal` through the fallback).

**6. `src/apps/http/routes.test.ts:42-60`** — `PATH_SEGMENTS` gains five entries
after the last entry `"conflict",` (`:59`), one per line, in this order:
`"approval"`, `"rejection"`, `"reattempt"`, `"abandonment"`, `"suspension"`.
`NOT_PLURAL` (`:68`) stays empty — none of the five ends in `s`.

**7. `src/apps/http/routes.test.ts:92-100`** — allow `PUT`, but only for an
allowlisted row. Replace both assertions:

```
-    assert.ok(
-      ["GET", "POST", "PATCH", "DELETE"].includes(route.method),
-      `method ${route.method} not allowed for ${route.id}`,
-    );
-    assert.notEqual(
-      (route.method as string) === "PUT",
-      true,
-      "PUT must never appear",
-    );
+    assert.ok(
+      ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(route.method),
+      `method ${route.method} not allowed for ${route.id}`,
+    );
+    assert.ok(
+      isAllowedPutRow(route),
+      `PUT is allowed only for a row named in PUT_ROWS (${route.id})`,
+    );
```

Add beside the other module-level constants (after `NOT_PLURAL`, `:68`), with a
comment stating the rule:

```ts
/**
 * PUT is admitted for state singletons ONLY, one reviewed row at a time (EPIC
 * 023 decision 2, which reverses 019's blanket PUT non-goal). Every other row
 * must use GET/POST/PATCH/DELETE.
 */
const PUT_ROWS = ["initiative.suspension.put"];

function isAllowedPutRow(route: { method: string; id: string }): boolean {
  return route.method !== "PUT" || PUT_ROWS.includes(route.id);
}
```

**8. `src/apps/http/routes.test.ts`** — add the two new policy tests after the
path-vocabulary negative control (`:209-220`):

- `test("PUT policy negative control: a PUT row outside PUT_ROWS is rejected", …)`
  — build two plain objects `{ method: "PUT", id: "initiative.suspension.put" }`
  and `{ method: "PUT", id: "task.approval.put" }`; assert `isAllowedPutRow` is
  `true` for the first and `false` for the second; assert
  `isAllowedPutRow({ method: "POST", id: "task.approval.put" })` is `true`.
- `test("transition rows are item-scoped: every verdict path carries :id", …)` —
  the decision-10 guard. For every `route` of `ROUTES` whose path contains any of
  `/approval`, `/rejection`, `/reattempt`, `/abandonment`, `/suspension`: assert
  `route.path.includes("/:id/")` and assert the segment is NOT the second segment
  of the path (i.e. `staticSegmentsOf(route.path)[1]` is never one of the five),
  so no collection-level verdict route can exist. With zero such rows today the
  test passes vacuously and becomes load-bearing from Story `02` on.

## Constraints

- Surgical: no row is added, no view is created, no `HttpDeps` field is added.
- `PUT_ROWS` holds exactly one id. Do not generalise it, and do not delete the
  negative control — it is the only thing stopping the next epic from spraying
  `PUT` across the surface.
- `ALLOWED_STATUSES` (`error-registry.test.ts:17-19`) is NOT edited: all 12 codes
  are `409`, which is already listed. `428` belongs to EPIC 021.
- `src/app/task/reject-task.ts` gets the type narrowing and nothing else — no
  behaviour change, no reformatting of the surrounding method.
- `src/app/errors.ts` gains the type re-export only. Do not move or re-order the
  existing exports.

## Verify

- `node --test src/apps/http/error-registry.test.ts` — extend it with one
  `mapError` test per new class, in the shape of `:44-68`: construct the real
  error, call `mapError`, assert `mapped.code` and `mapped.status === 409`. Never
  use `as any` — the twelve constructors are:

  | class                                   | constructor                                           | site                                      |
  | --------------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
  | `StaleCandidateError`                   | `(objectiveId, expected, actual)`                     | `src/domain/initiative.ts:110`            |
  | `ObjectiveNotAwaitingConfirmationError` | `(objectiveId, status: ObjectiveStatus \| undefined)` | `src/app/errors.ts:40`                    |
  | `TaskNotAwaitingConfirmationError`      | `(taskId, status: TaskStatus)`                        | `src/app/errors.ts:70`                    |
  | `ImpactChangedError`                    | `(expected, actual)`                                  | `src/app/errors.ts:58`                    |
  | `RejectionConflictError`                | `(taskId, stored, requested)`                         | `src/app/task/reject-task.ts:34`          |
  | `TaskNotRetryableError`                 | `(taskId, status: TaskStatus)`                        | `src/app/task/retry-task.ts:14`           |
  | `ObjectiveNotRetryableError`            | `(objectiveId)`                                       | `src/app/objective/retry-objective.ts:19` |
  | `TaskNotAbandonableError`               | `(taskId, status: TaskStatus)`                        | `src/app/task/abandon-task.ts:20`         |
  | `NoRunningJobError`                     | `(taskId)`                                            | `src/app/task/abandon-task.ts:34`         |
  | `AmbiguousRunningJobError`              | `(taskId, count: number)`                             | `src/app/task/abandon-task.ts:44`         |
  | `ProposalMissingError`                  | `(taskId)`                                            | `src/app/task/approve-task.ts:43`         |
  | `ProposalWorkspaceMissingError`         | `(taskId)`                                            | `src/app/errors.ts:83`                    |

  Use a real `TaskStatus` value (e.g. `"running"`, `"completed"`) and a real
  `ObjectiveStatus` value (e.g. `"integrated"`) — both unions are re-exported
  through `src/app/errors.ts`. The existing "registry hygiene" test (`:21-42`)
  must stay green with 16 mappings.

- `node --test src/apps/http/routes.test.ts` — the `PATH_SEGMENTS` allowlist test
  (`:185`), the no-plural test (`:196`), the negative control (`:209`), the new
  `PUT` policy test, the new item-scope test, and the unchanged
  `assert.equal(ROUTES.length, 54)` all pass.
- `node --test src/app/task/reject-task.test.ts` — unchanged and green (the
  narrowing must not alter behaviour).
- `node --test src/apps/http/app.test.ts` — green, including
  `requiresJsonContentType is true for POST, PUT, PATCH only` (`:556`) and
  `requiresOriginCheck is true for POST, PUT, PATCH, DELETE only` (`:567`).
- `npx tsc --noEmit` reports no error caused by the `RejectTask` narrowing at any
  call site (`src/apps/cli/task.ts` is the CLI caller).
- `npm run verify` exits 0.
- Proof: none. This story lands no row, so no Proof phase moves. It unblocks
  phases C-G.
