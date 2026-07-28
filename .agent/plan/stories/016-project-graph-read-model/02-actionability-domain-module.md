# Story 2 — `src/domain/actionability.ts`, the single action authority

Epic: `.agent/plan/epics/016-project-graph-read-model.md`
Depends on: Story 1 (consumes `blockedForever` as an input fact, not as an import).

> **AMENDED 2026-07-27 (human-approved), for EPIC 017.** Two changes, both driven
> by an adversarial debate on EPIC 017's plan:
>
> 1. **`decisionActions` is the authority; the three named functions are
>    projections.** EPIC 017's cross-project queue needs _every_ verdict on an
>    element, not just the first. Two functions returning "the one action" and "all
>    the actions" from two rule tables would drift, which the one-pure-function rule
>    exists to prevent. So the rule table now lives in `decisionActions`, and
>    `nodeAction` / `groupAction` / `initiativeAction` each return its first element
>    or `null`. Their signatures and their per-row answers are **unchanged**.
> 2. **An objective conflict yields concrete `retry` + `reject` verdicts, and
>    `resolve-conflict` is removed from `ActionKind`.** `resolve-conflict` named a
>    problem category, not an operation: no CLI command is spelled
>    "resolve conflict", and `requiresInput: ["resolution"]` named a flag no
>    objective verdict accepts (`retry objective` takes `--note`;
>    `reject objective` takes `--resolution retry|discard`). A verdict a client
>    cannot execute is worse than none.
>
> Everything below reflects the amendment. Rows not mentioned are untouched.

## Change

Create `src/domain/actionability.ts` — **new file, pure, zero I/O**. Exact surface:

```ts
import type { TaskStatus } from "./task.ts";
import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";

export type ActionKind =
  | "retry"
  | "approve"
  | "reject"
  | "publish"
  | "resume-initiative"
  | "remove-dependency";
// AMENDED: six members. `resolve-conflict` is removed — see the header note.

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

// AMENDED — the single rule table. Every consumer calls this; the three
// functions below are one-line projections of it and hold no rules of their own.
export interface DecisionContext {
  node: NodeActionFacts | null;
  group: GroupActionFacts | null;
  initiative: InitiativeActionFacts | null;
  /**
   * The objective's candidate OID. EPIC 012 makes `--expected-commit` REQUIRED on
   * every objective verdict, so an objective command is only complete when this
   * is known. The three projections below always pass `null`, because their
   * facts types do not carry it.
   */
  expectedCommit: string | null;
}

export function decisionActions(context: DecisionContext): Action[];

export function nodeAction(facts: NodeActionFacts): Action | null;
export function groupAction(facts: GroupActionFacts): Action | null;
export function initiativeAction(facts: InitiativeActionFacts): Action | null;
```

The three projections are exactly:

```ts
export function nodeAction(facts: NodeActionFacts): Action | null {
  return (
    decisionActions({
      node: facts,
      group: null,
      initiative: null,
      expectedCommit: null,
    })[0] ?? null
  );
}
```

…and the same one-liner for `groupAction` and `initiativeAction`, each passing
only its own facts. **No `if` and no command string may appear in any of the
three.**

### `nodeAction` — first matching rule wins, in this exact order

| #   | Condition                                                                      | Result                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `status === "failed"`                                                          | `{kind:"retry", target:{type:"task", id:taskId}, requiresInput:[], command:\`retry task --id ${taskId}\`}`                                                                                                                                                                                                                                                                                                                                        |
| 2   | `status === "awaiting_confirmation"`                                           | `{kind:"approve", target:{type:"task", id:taskId}, requiresInput:[], command:\`approve task --id ${taskId}\`}`                                                                                                                                                                                                                                                                                                                                    |
| 3   | `status === "pending" && blockedForever === true && deadDependencyId !== null` | `{kind:"remove-dependency", target:{type:"task", id:taskId}, targetDependencyId:deadDependencyId, requiresInput:[], command:\`remove dependency --task ${taskId} --dependency ${deadDependencyId}\`}`                                                                                                                                                                                                                                             |
| 4   | `status === "completed" && objectiveStatus === "awaiting_confirmation"`        | **AMENDED 2026-07-28** → `{kind:"approve", target:{type:"objective", id:objectiveId}, requiresInput:["expectedCommit"]}` — `command` is **omitted**. The node-scoped projection never knows the candidate OID, and `approve objective` declares `--expected-commit` as a `requiredOption` (`approve/objective.ts:16-19`), so any command emitted here would always exit non-zero. Same shape as `groupAction` rule 1 with `expectedCommit: null`. |
| 5   | `status === "completed" && objectiveStatus === "conflict"`                     | **AMENDED** → the `conflict` group row's actions (see `groupAction` rule 2), i.e. `[retry, reject]` targeting the objective. `nodeAction` therefore returns the `retry`.                                                                                                                                                                                                                                                                          |
| 6   | anything else                                                                  | `null`                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Rule 3 with `deadDependencyId === null` falls through to `null`: an action that
cannot name its operand is not offerable.

`reject` is **never** produced for a `pending` task. `RejectTask` refuses
`pending` — it accepts only `awaiting_confirmation`, or `failed` with
`resolution: "discard"` (`src/app/task/reject-task.ts:86-92`). Offering it would
be a button that always errors.

### `groupAction`

**AMENDED.** Each row now yields an ordered **list**: the constructive verdict
first, the destructive one last. `groupAction` returns element `[0]`.

`<c>` below is `context.expectedCommit`. When it is `null` — which is always the
case through `groupAction`, and the case in the queue when the objective has no
`commitOid` — **omit `command` entirely** and prepend `"expectedCommit"` to
`requiresInput`. Never emit a command containing an empty or placeholder OID.

| #   | Condition                                                 | Result (ordered)                                                                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `status === "awaiting_confirmation"`                      | `{kind:"approve", target:{type:"objective",id}, requiresInput:[], command:\`approve objective --id ${id} --expected-commit ${c}\`}`·`{kind:"reject", target:{type:"objective",id}, requiresInput:["reason"], command:\`reject objective --id ${id} --expected-commit ${c} --resolution discard --yes\`}` |
| 2   | `status === "conflict"`                                   | `{kind:"retry", target:{type:"objective",id}, requiresInput:["note"], command:\`retry objective --id ${id} --expected-commit ${c}\`}`· the same`reject` action as row 1                                                                                                                                  |
| 3   | else (`building`, `integrated`, `discarded`, `undefined`) | `[]` (so `groupAction` returns `null`)                                                                                                                                                                                                                                                                   |

Row 2's `retry` is the conflict resolution: `RetryObjective` on a `conflict`
objective re-squashes onto the current tip and re-runs the gate
(`src/app/objective/retry-objective.ts:133-183`). `--note` is optional at the CLI
(`src/apps/cli/commands/retry/objective.ts:13`), so it is listed in
`requiresInput` as the operand a human is expected to supply while the `command`
stays complete without it.

**There is no request-changes verdict for `awaiting_confirmation`.** Making one
real needs `completed->pending`, which is not a legal transition
(`src/domain/task.ts:97-107`). Human decision, 2026-07-27: objective candidates
carry `approve` / `reject` only.

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
- **AMENDED — this story now DOES add the `reject` producer**, on the two group
  rows above. `reject` is still never produced for a `pending` task
  (`reject-task.ts:86-92` refuses it), and never for a task at all in this story.
- **AMENDED — the rule table lives only in `decisionActions`.** The three named
  functions must each be the single-expression projection shown above. A reviewer
  should be able to confirm by reading that no `if`, no `switch` and no template
  literal appears in any of them.
- **AMENDED — no `resolve-conflict` anywhere**: not in `ActionKind`, not in a
  returned action, not in a test literal.

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
- **AMENDED 2026-07-28** `nodeAction`: `completed` + objective
  `awaiting_confirmation` → `approve` targeting
  `{type:"objective", id:objectiveId}` — asserts the target is the objective and
  **not** the task, plus `requiresInput: ["expectedCommit"]` and
  `"command" in action === false`.
- **AMENDED** `nodeAction`: `completed` + objective `conflict` → `kind: "retry"`
  targeting `{type:"objective", id:objectiveId}`, with
  `requiresInput: ["expectedCommit","note"]` and `"command" in action === false`
  (the projection passes `expectedCommit: null`).
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
- **AMENDED** `groupAction`: `awaiting_confirmation` → `kind: "approve"`;
  `conflict` → `kind: "retry"`. Both target the objective, both omit `command`
  through the projection.
- **AMENDED** `decisionActions`: an `awaiting_confirmation` group with
  `expectedCommit: "abc"` → exactly two actions, kinds `["approve","reject"]`, and
  the approve command is
  `approve objective --id <o> --expected-commit abc`.
- **AMENDED** `decisionActions`: a `conflict` group with `expectedCommit: "abc"` →
  kinds `["retry","reject"]`, retry command
  `retry objective --id <o> --expected-commit abc`.
- **AMENDED** `decisionActions`: the same two groups with `expectedCommit: null` →
  every action omits `command` and `requiresInput[0] === "expectedCommit"`.
- **AMENDED — the projection-equivalence test.** Table-driven over every row of
  all three rule tables: assert
  `deepEqual(nodeAction(f), decisionActions({node:f,…})[0] ?? null)`, and the same
  for `groupAction` and `initiativeAction`. This is what makes a second rule table
  impossible to add without a failing test.
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
  `kind` present in a locally declared `ActionKind[]` literal listing all **six**
  values (**AMENDED** from seven — `resolve-conflict` is gone), so a new kind
  cannot be introduced without touching this test. Assert also that the literal
  does not contain `"resolve-conflict"`.

`npm run verify` exits 0.

Proof: delivers the `action` assertions in phases **B** (all `null`),
**C** (`retry`), **D** (`null` on discarded), **E** (`remove-dependency`),
**F** (`approve` targeting the objective) and **G** (`resume-initiative`).
