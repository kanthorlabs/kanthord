# EPIC 017 — Decision workbench — stories

Epic: `.agent/plan/epics/017-decision-workbench.md`
Prereq: EPIC 016 (sequence order) — stories 4 and 5 extend
`src/domain/actionability.ts` and reuse `unsatisfiedTaskEdges` /
`permanentlyBlockedTasks`, both authored by EPIC 016.

> **EPIC 016 was amended on 2026-07-27 (human-approved) to serve this epic.** Two
> edits, both in `.agent/plan/stories/016-project-graph-read-model/02-actionability-domain-module.md`
> and mirrored in `.agent/plan/epics/016-project-graph-read-model.md`:
> `decisionActions` is now the single rule table with the three named functions as
> one-line projections; and `resolve-conflict` is removed from `ActionKind`, an
> objective conflict yielding concrete `retry` + `reject` verdicts instead. EPIC
> 016's proof script was also corrected — see the Proof note at the end.
> Also required: EPIC 012 (`--expected-commit` on objective verdicts, used by
> story 3) and EPIC 011 story 1 (`listProjects`, used by story 6).

After this epic the engineer runs one command to see every decision waiting on a
human across all projects, ranked by downstream impact then age; hands back
guidance that is actually persisted; sees exactly what a discard destroys before
confirming it; and inspects an objective conflict through a contract that states
its persisted cause.

## Dispatch order

1. **Story 1** — the guidance channel and the conflict cause. Independent; it is
   the live defect fix and the Proof's first failing phase. Ship it first.
2. **Story 2** — `previewDiscard`. Pure domain, independent.
3. **Story 3** — the confirm protocol. Needs story 2. **Coupled with story 2** —
   story 3's cascade is derived from story 2's output, so review them together.
4. **Story 4** — `decisionActions`. Needs EPIC 016 story 02 on disk.
5. **Story 5** — `projectDecisions` / `rankDecisions`. Needs story 4 and EPIC 016
   story 01.
6. **Story 6** — `GetDecisionQueue` + the `queue` verb. Needs story 5.
   **Coupled with story 5.**
7. **Story 7** — `get conflict --objective`. Needs story 1's columns. Can run any
   time after story 1, in parallel with 2–6.

Stories 1 and 7 form the conflict/guidance track; stories 2–3 the destructive
track; stories 4–6 the queue track. The three tracks touch disjoint files apart
from `src/composition.ts` and `src/apps/cli/deps.ts`.

## Facts (needed for implementation)

### Greenfield — absent on disk

`src/domain/impact.ts`, `src/domain/decision-queue.ts`,
`src/app/project/get-decision-queue.ts`,
`src/app/objective/get-objective-conflict.ts`, `src/apps/cli/queue.ts`,
`src/apps/cli/commands/queue.ts`. Also absent (EPIC 016/011 own them):
`src/domain/actionability.ts`, `src/app/initiative/get-initiative-graph.ts`,
`src/app/project/list-projects.ts`.

### The defect this epic fixes

`RetryTask` persists `note` only in the `awaiting_confirmation` branch
(`src/app/task/retry-task.ts:102`). The `failed` branch (`:133-140`) saves the
task with **no** note. `failed` is the common guidance case. Verified by
execution, not only by inspection.

Two nuances that change story 1's tests:

- The `failed` branch **accidentally preserves** an existing note, because
  `transitionTask` returns `{ ...task, status: to }` (`src/domain/task.ts:122-128`).
  So the defect is precisely "a new `--note` is ignored", and clear-by-default
  (binding decision 3) **reverses** that accidental preserve — it needs its own
  named test.
- The consumer chain is already complete, so no runner change is needed:
  `Task.note` → `getPriorFeedback` (`src/composition.ts:410-418`) →
  `PiAgentRunner` option (`src/agent-runner/pi.ts:312,344,365-366`) → read at
  `:566`.

### Persisting a field means owning its lifecycle

`transitionObjective` also spreads (`src/domain/initiative.ts:91-101`). Story 1
therefore clears `conflictCause`, `observedTipOid` and `conflictReason` when a
conflict resolves, via a pure `clearConflictDiagnosis`. Persisting them without
clearing would turn a silent-loss bug into a stale-data bug. `note` is kept — it is
guidance, not diagnosis.

### Counters and versions — derive, never hardcode

- **Migration version.** Head on disk is `26`
  (`src/storage/sqlite/migrations.ts:763-764`). EPICs 011, 013, 014 and 016 also
  append. **Pin the migration _name_; derive `version` as last + 1.**
- **`migrations.test.ts` head assertions hardcode `26`** at `:70`, `:72`, `:449`,
  `:862`, `:995`, `:1099`, `:1178`, `:1215`, `:1510`, `:1525`, `:1566`, `:1687`,
  `:1816`. Story 1 updates all of them, bumping from the value on disk.
- **`objectives` column list** asserted at `migrations.test.ts:129-137`.
- **Architecture counters.** `EXPECTED_LEAF_FILE_COUNT = 65`
  (`src/apps/cli/architecture.test.ts:28`) counts `.ts` files in
  `commands/*/` subdirectories; `EXPECTED_LEAF_COUNT = 68` (`:33`) counts
  registered leaves. **Increment relative to the value on disk** — EPIC 016 adds
  leaves too. A top-level leaf placed directly in `commands/` (like
  `commands/commands.ts`) changes only `EXPECTED_LEAF_COUNT`.
  EPIC 011 story 1's counter arithmetic is already stale — do not copy it.

### Objective conflict — the contract

- `objective.status === "conflict"` is set only by `ApproveObjective.#recordConflict`
  (`src/app/objective/approve-objective.ts:135-141`), from two causes:
  `commitCount !== 1` (`:86-89`) and `LandingCASMismatchError` from `casUpdateRef`
  (`:98-103`). Both mean _the branch moved under the squash_ — **not** a
  file-level merge conflict, so there are no conflicting file paths.
- `LandingCASMismatchError.newTargetOID` (`src/landing/port.ts:57-64`) carries the
  ref's actual OID, so `observedTipOid` is available on the CAS path only.
- `get conflict --id <taskId>` is a **different feature**: it needs
  `ChangeCandidate.state === "conflict"` (`src/app/task/get-conflict.ts:80-83`),
  a 007.5 task landing conflict, reached only via `RunNextTask`'s candidate branch.
- `retry objective` on a conflict objective **requeues nothing** — it re-squashes
  onto the new tip and re-runs the gate (`retry-objective.ts:133-183`). Its note
  fan-out (`:167-174`) skips `completed` tasks, so per 007.12 it reaches nobody.
- `Objective.conflictReason` (`src/domain/initiative.ts:36-37`) is written at
  `retry-objective.ts:180` but exists in **neither** the `objectives` DDL nor the
  repository SQL — it is discarded today. Story 1's migration adds it.
- The initiative ref is `refs/heads/kanthord/init/<initiativeId>`
  (`retry-objective.ts:144`). `ObjectiveBroker.currentTip` is **optional** on the
  port (`src/objective-broker/port.ts`).

### Two paths reach `awaiting_confirmation`, not one

`RunNextTask` transitions a task to `awaiting_confirmation` from (a) the
`escalated` outcome (`src/app/task/run-next-task.ts:404-432`), which emits
`task.escalated` and writes `evidence: null` and no candidate; and (b) the
`candidate` outcome **with** a `repository` context binding and **no** `workspace`
binding (`:470-507`), which saves a `ChangeCandidate` and emits no event.

Consequences, all pinned in story 5:

- Every `task-review` item carries `cause: "candidate" | "escalation"`, derived
  from **candidate-row presence** — the same fact `ApproveTask` keys on
  (`hasPersistedCandidate`, `src/app/task/approve-task.ts:161-175`, where
  conflating the two was the `HUMAN_REVIEW-S2` regression). Never from `status`,
  never from `proposalCommit`.
- The **verdicts are identical** for both causes, and that is verified rather than
  assumed: `ApproveTask` handles a candidate-less escalation via `#promote`
  (`:177-192`) and a candidate via the landing port (`:195-215`). So `cause` never
  enters `decisionActions`.
- Only `cause: "candidate"` makes `get conflict --id` offerable.
- `actionableSince` is **`null`** for the candidate path, because it emits no
  event. Do not substitute the entity id or add an event type to make the column
  non-null for sorting.

### Discard cascade rules — cite before you code

- Task discard cascades over `dependentClosure`, restricted to `pending`; every
  other status is **skipped and reported** (`src/app/task/reject-task.ts:160-192`,
  skip at `:178-180`). Objective rollup `:219-244`, initiative rollup `:246-267`.
- Objective discard discards `pending` and `failed` tasks
  (`src/app/objective/reject-objective.ts:60-72`), then the initiative iff every
  sibling is terminal and any is discarded (`:84-102`). It never consults
  `unsatisfiedObjectiveEdges`, so downstream objectives break silently.
- `dependentClosure` (`src/domain/graph.ts:157-186`) excludes the root and sorts
  each dependents list ascending. Objective/initiative edges are separate
  (`src/domain/sequencing.ts:32-64`); only `"integrated"` satisfies an objective
  edge and only `"landed"` an initiative edge.
- `completed->pending` is **not** in `LEGAL_TRANSITIONS`
  (`src/domain/task.ts:97-107`) — hence no request-changes verdict.
- `reject task` refuses `pending` (`reject-task.ts:87-92`), so a permanently
  blocked pending task's only action is `remove dependency`.

### Conventions to mirror

- Tests: `node:test` + `node:assert/strict`, `node --test` (`package.json:13`),
  flat `test(...)`, hand-written in-memory fakes at the top of the file that
  re-declare the private store interface verbatim
  (`src/app/task/reject-task.test.ts:24-36`), `MemUow` that just calls `fn()`
  (`:144-148`). Domain tests use plain-literal fixtures and `assert.deepEqual` on
  whole results (`src/domain/sequencing.test.ts:65-76`).
- Digests: reuse `sha256Hex` (`src/domain/sha.ts:60-63`) and a fixed key order,
  the way `canonicalObjective` (`:29-42`) does. Do not call `createHash` directly
  from a new domain module.
- Optional properties: **omit** the key entirely rather than setting `undefined` —
  the repo builds with `exactOptionalPropertyTypes` (style reference
  `src/app/task/get-task.ts:88-101`).
- `emitResult` appends `"\n"` per stdout element
  (`src/apps/cli/commands/action.ts:22-26`), so a JSON payload must be a **single**
  element (`src/apps/cli/task.ts:268-274`).
- CLI leaf template: `src/apps/cli/commands/get/objective.ts:8-27`. Every leaf
  needs a non-empty description, `configureHelp({ commandUsage: … })`, and
  `addHelpText("after", "\nExample:\n  kanthord …\n")`.
- `src/apps/cli/index.ts` must contain no `.action(`, `.option(`,
  `.requiredOption(` or `.argument(` (`architecture.test.ts:36,57-65`), and every
  builder must construct with `deps = {}`.
- Import boundaries (`eslint.config.js:22-89`): `domain/` → `domain/` only;
  `app/` → `domain/` + `src/*/port.ts`; `apps/` → `app/` only. Hence the
  use-case-local structural-source convention (`src/app/task/get-task.ts:6-20`)
  and `deps.ts`'s local mirrors (`:64-122`).
- Adding a use case is four edits: `import type` in `src/apps/cli/deps.ts`, the
  `CliDeps` field (`:131-211`), construction in `src/composition.ts`'s
  `buildDeps` (`:163`), and the returned literal (`:850-920`).
- **Never inject a bare method reference** as a function-shaped port — it loses
  `this` and crashes on `#private` fields. Always an arrow wrapper.
- New error types must be added to `src/apps/cli/error-map.ts`'s allow-list
  (beside `:81`) or they are re-thrown (`:122`) instead of becoming exit 1, and
  re-exported from `src/app/errors.ts` (pattern at `:4`).

### Events

Add **no** new event type and do **not** touch the `events` table. The five
actionable types story 6 reads — `task.failed`, `task.escalated`,
`objective.awaiting_confirmation`, `objective.conflict`, `initiative.landed` —
are all already in the CHECK list (`src/storage/sqlite/migrations.ts:770-783`).
`events` has no timestamp column; ids are ULIDs, so every time value is
`decodeTime(id)` via `eventTimeMs` (EPIC 016 story 03).

## Proof

`scripts/e2e/decision-workbench-proof.sh` is written and was run against the
current tree: it fails at **phase A** with
`FAILED: A: note persisted on a failed-task retry — expected 'use the anchor', got '<ABSENT>'`,
after its fixture assertion (`root reached failed`) passes. Phase→story mapping:

| Phase | Story         |
| ----- | ------------- |
| A, B  | 1             |
| C, D  | 6 (with 4, 5) |
| E     | 3 (with 2)    |
| F, G  | 7 (with 1)    |
| H     | 1, 7          |
| I     | 6             |
| J     | 3, 6, 7       |

`run daemon --fail` is honoured only by `FakeRunner` (`src/composition.ts:426`,
runner map `:441-443`), which serves `fake@1`; the todo fixture is `generic@1`, so
the Proof fails the root by swapping `KANTHORD_FAKE_AGENT` for a no-op script and
letting the task's own verification (`test -f src/todo.mjs`,
`scripts/e2e/make-todo-graph.sh:69-71`) exit 1.

**EPIC 016's proof had the same bug and was corrected (human-approved).**
`scripts/e2e/initiative-graph-proof.sh` phase C used `--fail` on the same
`generic@1` fixture, so its `status === "failed"` assertion could never hold. It
now uses the no-op-agent technique and asserts the fixture reached `failed`
**from SQLite, before** any `get graph` assertion. That proof still fails at its
own documented phase A (`get graph` does not exist yet), which is correct and
unchanged; phase C is unreachable until 016 is implemented, so the fix is verified
by the identical, executed technique in 017's phase A rather than end to end.
