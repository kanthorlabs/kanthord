# Story 2 — `src/domain/actionability.ts`, the single action authority

Epic: `.agent/plan/epics/016-project-graph-read-model.md`
Depends on: Story 1 (consumes `blockedForever` as an input fact, not as an import).

## Change

Create `src/domain/actionability.ts` — **new file, pure, zero I/O**. Exact surface:

```ts
import type { TaskStatus } from "./task.ts";
import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";

export type ActionKind =
  | "retry"
  | "approve"
  | "reject"
  | "resolve-conflict"
  | "publish"
  | "resume-initiative"
  | "remove-dependency";

export interface ActionTarget {
  type: "task" | "objective" | "repository" | "initiative";
  id: string;
}

export interface Action {
  kind: ActionKind;
  target: ActionTarget;
  /** Second operand, e.g. the dead dependency `remove-dependency` must drop. */
  targetDependencyId?: string;
  requiresInput: string[];
  /** Present ONLY when every value is already known. */
  command?: string;
}

export interface NodeActionFacts {
  taskId: string;
  status: TaskStatus;
  objectiveId: string;
  objectiveStatus: ObjectiveStatus | undefined;
  blockedForever: boolean;
  /** First dependency whose edge can never clear, else null. */
  deadDependencyId: string | null;
}

export interface GroupActionFacts {
  objectiveId: string;
  status: ObjectiveStatus | undefined;
}

export interface InitiativeActionFacts {
  initiativeId: string;
  status: InitiativeStatus | undefined;
  paused: boolean;
  publication: {
    repositoryId: string;
    branch: string;
    state: "unpublished" | "published" | "diverged";
  } | null;
}

export function nodeAction(facts: NodeActionFacts): Action | null;
export function groupAction(facts: GroupActionFacts): Action | null;
export function initiativeAction(facts: InitiativeActionFacts): Action | null;
```

### `nodeAction` — first matching rule wins, in this exact order

| #   | Condition                                                                      | Result                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `status === "failed"`                                                          | `{kind:"retry", target:{type:"task", id:taskId}, requiresInput:[], command:\`retry task --id ${taskId}\`}`                                                                                            |
| 2   | `status === "awaiting_confirmation"`                                           | `{kind:"approve", target:{type:"task", id:taskId}, requiresInput:[], command:\`approve task --id ${taskId}\`}`                                                                                        |
| 3   | `status === "pending" && blockedForever === true && deadDependencyId !== null` | `{kind:"remove-dependency", target:{type:"task", id:taskId}, targetDependencyId:deadDependencyId, requiresInput:[], command:\`remove dependency --task ${taskId} --dependency ${deadDependencyId}\`}` |
| 4   | `status === "completed" && objectiveStatus === "awaiting_confirmation"`        | `{kind:"approve", target:{type:"objective", id:objectiveId}, requiresInput:[], command:\`approve objective --id ${objectiveId}\`}`                                                                    |
| 5   | `status === "completed" && objectiveStatus === "conflict"`                     | `{kind:"resolve-conflict", target:{type:"objective", id:objectiveId}, requiresInput:["resolution"]}` — **no `command`**                                                                               |
| 6   | anything else                                                                  | `null`                                                                                                                                                                                                |

Rule 3 with `deadDependencyId === null` falls through to `null`: an action that
cannot name its operand is not offerable.

`reject` is **never** produced for a `pending` task. `RejectTask` refuses
`pending` — it accepts only `awaiting_confirmation`, or `failed` with
`resolution: "discard"` (`src/app/task/reject-task.ts:86-92`). Offering it would
be a button that always errors.

### `groupAction`

| #   | Condition                                                 | Result                                                                                                                             |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `status === "awaiting_confirmation"`                      | `{kind:"approve", target:{type:"objective", id:objectiveId}, requiresInput:[], command:\`approve objective --id ${objectiveId}\`}` |
| 2   | `status === "conflict"`                                   | `{kind:"resolve-conflict", target:{type:"objective", id:objectiveId}, requiresInput:["resolution"]}` — no `command`                |
| 3   | else (`building`, `integrated`, `discarded`, `undefined`) | `null`                                                                                                                             |

### `initiativeAction` — first matching rule wins

| #   | Condition                                                                                                                    | Result                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `paused === true`                                                                                                            | `{kind:"resume-initiative", target:{type:"initiative", id:initiativeId}, requiresInput:[], command:\`resume initiative --id ${initiativeId}\`}`                                                       |
| 2   | `status === "landed" && publication !== null && (publication.state === "unpublished" \|\| publication.state === "diverged")` | `{kind:"publish", target:{type:"repository", id:publication.repositoryId}, requiresInput:[], command:\`publish repository --repository ${publication.repositoryId} --branch ${publication.branch}\`}` |
| 3   | else                                                                                                                         | `null`                                                                                                                                                                                                |

Paused outranks publish: a paused initiative's first blocker is the pause.

### Command-string convention (pinned)

Every `command` is the CLI invocation **without** the `kanthord ` prefix and
**without** `--json`, matching EPIC 014 story 2
(`.agent/plan/stories/014-project-readiness-check/02-structured-next-action.md`).
Flag spellings are verified against the real leaves:
`retry task --id` (`src/apps/cli/commands/retry/task.ts:12`),
`approve task --id` (`approve/task.ts:12`),
`approve objective --id` (`approve/objective.ts:15`),
`resume initiative --id` (`resume/initiative.ts:15`),
`remove dependency --task … --dependency …` (`remove/dependency.ts:12-16`),
`publish repository --repository … --branch …` (`publish/repository.ts:15-16`).

## Constraints

- `src/domain/actionability.ts` imports **only** from `src/domain/`. No `app/`,
  no port, no adapter.
- `requiresInput` is always an array, never `undefined`. `[]` means "nothing needed".
- Omit `command` and `targetDependencyId` entirely when absent — do not set them
  to `undefined` (the repo builds with `exactOptionalPropertyTypes`; see the
  conditional-spread style at `src/app/task/get-task.ts:88-101`).
- Do not add a `reject` producer in this story. The `kind` stays in the union for
  story 7's `get task` reuse and future escalation paths, and is exercised only
  through rule 2's sibling assertions.

## Verify

`node --test src/domain/actionability.test.ts` — new file, flat `test(...)` style
mirroring `src/domain/sequencing.test.ts:1-11`:

- `nodeAction`: exhaustive over all six `TASK_STATUSES` with
  `objectiveStatus: "building"`, `blockedForever: false`,
  `deadDependencyId: null` — asserts `retry` for `failed`, `approve` (target
  task) for `awaiting_confirmation`, and `null` for `pending`, `running`,
  `completed`, `discarded`.
- `nodeAction`: `running` is always `null`, even when the objective is
  `awaiting_confirmation` (rule 4 requires `completed`).
- `nodeAction`: `discarded` is always `null`, even when `blockedForever` is
  `true`.
- `nodeAction`: `completed` + objective `awaiting_confirmation` → `approve`
  targeting `{type:"objective", id:objectiveId}` — asserts the target is the
  objective and **not** the task.
- `nodeAction`: `completed` + objective `conflict` → `resolve-conflict`,
  `requiresInput: ["resolution"]`, and `"command" in action === false`.
- `nodeAction`: `pending` + `blockedForever: true` + `deadDependencyId: "dep-1"` →
  `remove-dependency` with `targetDependencyId: "dep-1"` and
  `command === "remove dependency --task task-1 --dependency dep-1"`.
- `nodeAction`: `pending` + `blockedForever: true` + `deadDependencyId: null` →
  `null`.
- `nodeAction`: `pending` + `blockedForever: true` is **never** `kind: "reject"` —
  asserted explicitly with a comment citing `reject-task.ts:86-92`.
- `nodeAction`: precedence — `failed` with `blockedForever: true` yields `retry`,
  not `remove-dependency`.
- `groupAction`: exhaustive over all five `OBJECTIVE_STATUSES`
  (`src/domain/initiative.ts:8-14`) plus `undefined` — only
  `awaiting_confirmation` and `conflict` are non-null.
- `initiativeAction`: `paused: true` → `resume-initiative`, asserted for
  `status: "building"` and `status: "landed"`.
- `initiativeAction`: precedence — `paused: true`, `status: "landed"`,
  publication `unpublished` → `resume-initiative`, not `publish`.
- `initiativeAction`: `status: "landed"` + publication `unpublished` → `publish`
  targeting `{type:"repository", id}` with the exact `--repository`/`--branch`
  command.
- `initiativeAction`: `status: "landed"` + publication `diverged` → `publish`.
- `initiativeAction`: `status: "landed"` + publication `published` → `null`.
- `initiativeAction`: `status: "building"` + publication `unpublished` → `null`.
- `initiativeAction`: `publication: null` → `null`.
- A closed-vocabulary guard: every `Action` returned by the three functions has a
  `kind` present in a locally declared `ActionKind[]` literal listing all seven
  values, so a new kind cannot be introduced without touching this test.

`npm run verify` exits 0.

Proof: delivers the `action` assertions in phases **B** (all `null`),
**C** (`retry`), **D** (`null` on discarded), **E** (`remove-dependency`),
**F** (`approve` targeting the objective) and **G** (`resume-initiative`).
