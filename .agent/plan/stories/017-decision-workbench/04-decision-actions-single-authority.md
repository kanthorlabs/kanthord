# Story 4 — `decisionActions` — the single action authority

Epic: `.agent/plan/epics/017-decision-workbench.md`
Depends on: EPIC 016 story 02 (`src/domain/actionability.ts` must already exist).

> **EPIC 016 story 02 was amended on 2026-07-27 (human-approved) to carry this
> story's requirements.** `decisionActions` and `DecisionContext` are declared
> there, `nodeAction`/`groupAction`/`initiativeAction` are already specified as
> one-line projections, the two objective rows already yield concrete
> `retry`/`reject` verdicts, and `resolve-conflict` is already removed from
> `ActionKind`. **If 016 story 02 has already been implemented, most of section A
> and all of section C are done — verify, do not redo.** This story adds only what
> 016 does not need: the task-level `reject` producer, `DecisionKindLabel`, and
> `decisionKindLabel`.

## Change

Extend `src/domain/actionability.ts` — do **not** create a second module. Keep
every exported name and signature 016 story 02 declares.

### A. Add `DecisionKindLabel` and the task-level `reject` producer

```ts
export type DecisionKindLabel =
  | "task-review"
  | "operational-failure"
  | "objective-conflict"
  | "objective-candidate"
  | "publication";

/** The display label for a context. Never a sort key. */
export function decisionKindLabel(
  context: DecisionContext,
): DecisionKindLabel | null;
```

`DecisionContext` and `decisionActions` come from 016 story 02 as amended; do not
re-declare them.

### B. `decisionActions` — the complete table

First matching group wins; the result is the whole array for that group. The four
objective/initiative rows are 016 story 02's amended rows **verbatim** — reproduced
here only so this story reads as one table. The two `node` rows marked **new** are
this story's addition.

| Condition                                                                                     | `Action[]` (in order)                                                                                                                                             |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node.status === "awaiting_confirmation"`                                                     | **new** — `approve` task (`approve task --id <t>`) · `reject` task, `requiresInput: ["resolution","reason"]`, **no `command`**                                    |
| `node.status === "failed"`                                                                    | `retry` task (`retry task --id <t>`, from 016) · **new** `reject` task, `requiresInput: ["reason"]`, `command: "reject task --id <t> --resolution discard --yes"` |
| `node.status === "pending" && node.blockedForever && node.deadDependencyId !== null`          | `remove-dependency` task, `targetDependencyId`, `command: "remove dependency --task <t> --dependency <d>"` (016)                                                  |
| `node.status === "completed"`                                                                 | falls through to the matching `group` row below, with the group's target (016 rows 4-5)                                                                           |
| `group.status === "conflict"`                                                                 | `retry` objective, `requiresInput: ["note"]`, `command: "retry objective --id <o> --expected-commit <c>"` · `reject` objective (016)                              |
| `group.status === "awaiting_confirmation"`                                                    | `approve` objective · `reject` objective (016)                                                                                                                    |
| `initiative.paused === true`                                                                  | `resume-initiative` (016)                                                                                                                                         |
| `initiative.status === "landed" && publication !== null && publication.state !== "published"` | `publish` repository (016)                                                                                                                                        |
| otherwise                                                                                     | `[]`                                                                                                                                                              |

Pinned rules:

- **No request-changes verdict exists.** `objective-candidate` yields exactly
  `approve` + `reject`. Do not add an `ActionKind` member for it, and do not emit
  `retry objective` for an `awaiting_confirmation` objective — `RetryObjective`
  falls through to a documented no-op there
  (`src/app/objective/retry-objective.ts:129-131`), and `completed->pending` is
  not a legal transition (`src/domain/task.ts:97-107`).
- **`expectedCommit` gates every objective command.** When
  `context.expectedCommit === null`, emit the objective actions **without** a
  `command` field and with `"expectedCommit"` prepended to `requiresInput`. Never
  emit a `command` string containing an empty or placeholder OID.
- **The `reject task` command carries `--yes`** because story 3 makes an
  unconfirmed discard a usage error. A `command` that the CLI would refuse is not
  a complete command.
- **`reject` on an `awaiting_confirmation` task has no `command`**: `--resolution`
  is a genuine human choice there (`retry` or `discard`), unlike the `failed` row
  where only `discard` is accepted (`src/app/task/reject-task.ts:87-92`).
- **Ordering inside a group is fixed**: the constructive verdict first, the
  destructive one last.
- Omit `command` and `targetDependencyId` **entirely** when absent — the repo
  builds with `exactOptionalPropertyTypes` (style reference
  `src/app/task/get-task.ts:88-101`).
- Command strings carry **no** `kanthord ` prefix and no `--json`.
- **`resolve-conflict` must appear nowhere** — not in `ActionKind`, not in a
  returned action, not in a test literal.

### C. The projections are already specified by 016

`nodeAction`, `groupAction` and `initiativeAction` are one-line projections of
`decisionActions` per the 016 amendment. This story **adds no rule to them** and
must not introduce an `if`, a `switch` or a template literal into any of the
three. The table-driven projection-equivalence test lives in 016 story 02; extend
it with the two new `node` rows rather than writing a second one.

### D. `decisionKindLabel`

Pure mapping, used for display and `counts.byKind` only:

- `node.status === "awaiting_confirmation"` → `"task-review"`
- `node.status === "failed"` → `"operational-failure"`
- `group.status === "conflict"` → `"objective-conflict"`
- `group.status === "awaiting_confirmation"` → `"objective-candidate"`
- `initiative.status === "landed"` with an actionable publication → `"publication"`
- otherwise `null`

## Constraints

- Domain-only imports (`eslint.config.js:56-59`).
- Pure: no I/O, no clock, no randomness.
- Do not change `ActionKind`, `Action`, `ActionTarget`, `NodeActionFacts`,
  `GroupActionFacts` or `InitiativeActionFacts` as 016 declares them.
- Do not add a `verdictsFor(kindLabel)` function. A label-keyed state table is a
  second authority and is forbidden.
- `requiresInput` is always an array, `[]` when nothing is needed.

## Verify

Extend `src/domain/actionability.test.ts` (created by 016 story 02; convention
mirrors `src/domain/sequencing.test.ts:1-11`).

- `(017-S4-equivalence)` **The no-second-table test.** Extend 016 story 02's
  existing table-driven projection-equivalence test with the two new `node` rows;
  do not write a second test. It asserts
  `deepEqual(nodeAction(f), decisionActions({node:f,…})[0] ?? null)` for every
  row, and the same for `groupAction` and `initiativeAction`.
- `(017-S4-no-resolve-conflict)` grep-equivalent assertion: the locally declared
  `ActionKind[]` literal has exactly six members and does not include
  `"resolve-conflict"`; and no case in the table returns an action with that kind.
- `(017-S4-conflict-is-retry)` a `conflict` group with `expectedCommit: "abc"` →
  kinds `["retry","reject"]`, the retry command is
  `retry objective --id <o> --expected-commit abc`, and its `requiresInput` is
  `["note"]`.
- `(017-S4-awaiting-task-reject-no-command)` an `awaiting_confirmation` node's
  `reject` action has `"command" in action === false` and
  `requiresInput` `["resolution","reason"]`.
- `(017-S4-failed-reject-has-yes)` the `failed` node's `reject` command ends with
  `--resolution discard --yes`.
- `(017-S4-objective-candidate-verdicts)` an `awaiting_confirmation` group with
  `expectedCommit: "abc"` → exactly two actions, kinds `["approve","reject"]`,
  targets both `{type:"objective"}`, and the `approve` command is
  `approve objective --id <o> --expected-commit abc`.
- `(017-S4-no-request-changes)` assert the `ActionKind` union has no
  request-changes member (a `const kinds: ActionKind[] = [...all six...]`
  exhaustiveness guard, mirroring 016's closed-vocabulary test), and that **no**
  case in the whole table produces an action whose `command` contains
  `"retry objective"` for an `awaiting_confirmation` group.
- `(017-S4-failure-verdicts)` a `failed` node → kinds `["retry","reject"]` and the
  `retry` command is `retry task --id <t>`.
- `(017-S4-blocked-forever)` `pending` + `blockedForever` + `deadDependencyId` →
  exactly one `remove-dependency` action carrying `targetDependencyId`, and
  **never** a `reject` — `reject task` refuses `pending`
  (`src/app/task/reject-task.ts:87-92`).
- `(017-S4-missing-expected-commit)` an `awaiting_confirmation` group with
  `expectedCommit: null` → both actions omit `command` entirely and
  `requiresInput[0] === "expectedCommit"`.
- `(017-S4-running-and-discarded-empty)` `running`, `completed` with no group
  action, and `discarded` nodes each yield `[]`, and `nodeAction` yields `null`.
- `(017-S4-paused-outranks-publish)` an initiative both `paused` and `landed`
  with an `unpublished` publication → exactly one action, `resume-initiative`
  (016 story 02: _"Paused outranks publish"_).
- `(017-S4-published-no-action)` publication state `"published"` → `[]`.
- `(017-S4-kind-labels)` each of the five labels is produced by its condition,
  and `null` otherwise.
- `(017-S4-optional-props-omitted)` assert `"command" in action === false` where
  the table says no command — not merely `=== undefined`.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/decision-workbench-proof.sh` phase **D** (the
  `verdicts` kinds assertion).
