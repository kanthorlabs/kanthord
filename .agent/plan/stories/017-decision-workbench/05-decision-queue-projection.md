# Story 5 — `src/domain/decision-queue.ts` — the shared pure projection

Epic: `.agent/plan/epics/017-decision-workbench.md`
Depends on: Story 4 (`decisionActions`), EPIC 016 story 01
(`unsatisfiedTaskEdges`, `permanentlyBlockedTasks`).

## Change

New file `src/domain/decision-queue.ts`. Pure, zero I/O, domain-only imports.

This module exists so that `GetDecisionQueue` (story 6) and EPIC 016's
`GetProjectOverview` share one implementation. AGENTS.md forbids
use-case-calls-use-case, so the shared work lives here.

```ts
import type { TaskStatus } from "./task.ts";
import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";
import { dependentClosure, type GraphNode } from "./graph.ts";
import { permanentlyBlockedTasks, unsatisfiedTaskEdges } from "./sequencing.ts";
import {
  decisionActions,
  decisionKindLabel,
  type Action,
  type DecisionKindLabel,
} from "./actionability.ts";
import { eventTimeMs } from "./event.ts";

export interface QueueTaskInput {
  id: string;
  title: string;
  objectiveId: string;
  status: TaskStatus;
  dependencies: string[];
}

export interface QueueObjectiveInput {
  id: string;
  name: string;
  initiativeId: string;
  status?: ObjectiveStatus;
  commitOid?: string;
}

export interface QueueInitiativeInput {
  id: string;
  name: string;
  projectId: string;
  status?: InitiativeStatus;
  paused: boolean;
  publication: {
    repositoryId: string;
    branch: string;
    state: "unpublished" | "published" | "diverged";
  } | null;
}

export interface QueueEvidenceInput {
  /** Absolute path of the managed home for this element's repository. */
  homeDir: string | null;
  /** The older side of the diff. */
  baseOid: string | null;
  /** The newer side of the diff. */
  headOid: string | null;
}

export interface QueueProjectInput {
  projectId: string;
  projectName: string;
  tasks: QueueTaskInput[];
  objectives: QueueObjectiveInput[];
  initiatives: QueueInitiativeInput[];
  /** Id of the event that made each element actionable, keyed by element id. */
  actionableEventIds: Map<string, string>;
  /** Evidence identity, keyed by task id and by objective id. */
  evidence: Map<string, QueueEvidenceInput>;
}

export interface DecisionEvidence {
  basis: "verification-and-summary";
  diffAvailable: false;
  inspect: { executable: "git"; args: string[] } | null;
}

export interface DecisionItem {
  verdicts: Action[];
  kindLabel: DecisionKindLabel;
  /**
   * Why a `task-review` item is awaiting review. Two distinct runtime paths
   * reach the same status and they are NOT interchangeable in the detail view.
   * Absent on every other kind.
   */
  cause?: "candidate" | "escalation";
  projectId: string;
  projectName: string;
  initiativeId: string;
  objectiveId?: string;
  taskId?: string;
  downstream: number;
  actionableSince: number | null;
  evidence: DecisionEvidence;
  expectedCommit?: string;
}

export function projectDecisions(input: QueueProjectInput): DecisionItem[];

/** Ranks items across projects. Stable and total. */
export function rankDecisions(items: DecisionItem[]): DecisionItem[];
```

### Pinned rules

**Which elements become items.** Exactly one item per element whose
`decisionKindLabel(...)` is not `null`:

- one per task with `status === "failed"` → `operational-failure`;
- one per task with `status === "awaiting_confirmation"` → `task-review`;
- one per objective with `status === "conflict"` → `objective-conflict`;
- one per objective with `status === "awaiting_confirmation"` →
  `objective-candidate`;
- one per initiative with `status === "landed"` and a publication whose `state`
  is `"unpublished"` or `"diverged"` → `publication`.

A `completed` task under an `awaiting_confirmation` objective produces **no**
item — the objective already produces one. Otherwise every completed task would
duplicate its objective's decision.

**`cause` — derived from durable facts, never from status.** A task reaches
`awaiting_confirmation` by two paths that share a status but not their evidence:

| Path         | How                                                                                                                              | Durable fact                                                          | `get conflict --id` valid? |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------- |
| `candidate`  | `RunNextTask` candidate outcome with a `repository` binding and no `workspace` binding (`src/app/task/run-next-task.ts:470-507`) | a `ChangeCandidate` row exists                                        | **yes**                    |
| `escalation` | `RunNextTask` escalated outcome (`:404-432`)                                                                                     | no candidate row; `task_results.reason` set; a `task.escalated` event | **no**                     |

Set `cause` from **candidate-row presence**, which is exactly the differentiator
`ApproveTask` itself uses — `hasPersistedCandidate` at
`src/app/task/approve-task.ts:161-175`, whose comment records that keying this on
`proposalCommit` alone was the `HUMAN_REVIEW-S2` regression. Do **not** infer it
from `status`, from `proposalCommit`, or from the presence of an event. When
neither fact is present, omit `cause` and omit the item's `inspect` handle rather
than guessing.

`QueueProjectInput` therefore needs one more source datum: a
`candidateTaskIds: ReadonlySet<string>` field listing tasks with a persisted
landing candidate. Story 6 fills it from the landing repository.

**The verdicts are identical for both causes, and that is verified, not assumed.**
`ApproveTask` handles a candidate-less escalation through its `#promote` path and
a candidate through the landing port (`approve-task.ts:177-215`); `RejectTask`
accepts any `awaiting_confirmation` task (`reject-task.ts:87-92`). So `cause` does
**not** enter `decisionActions` — it drives the detail view and which related
command is offerable, nothing else.

**`verdicts`.** `decisionActions(context)` in full, with `expectedCommit` set
from the owning objective's `commitOid ?? null`. For a `publication` item the
context carries only `initiative`.

**`expectedCommit`.** Present on `objective-conflict` and `objective-candidate`
items only, and omitted entirely when the objective has no `commitOid`.

**`downstream`.**

- task items: `dependentClosure(nodes, taskId).length`, where `nodes` is
  `input.tasks` mapped to `GraphNode`.
- objective items: the number of **tasks** in the objective plus the size of the
  transitive dependent closure of those tasks, counted once (a `Set`), excluding
  the objective's own tasks from the closure count. This makes an objective
  blocking many downstream tasks outrank a single failed leaf.
- publication items: `0`.

**`actionableSince`.** `eventTimeMs(input.actionableEventIds.get(elementId))`
when present, else `null`. The key is the task id for task items, the objective
id for objective items, the initiative id for publication items. Never derived
from the entity id — an entity can be days older than the failure.

**`actionableSince` is `null` for `cause: "candidate"`, and that is correct.** The
candidate path emits **no event** (`run-next-task.ts:489-506` saves the candidate
and the task, and appends nothing), so no ULID exists to decode. Do **not**
substitute the entity id, the candidate id, or a `task.started` event, and do
**not** add a new event type to make the column non-null — that would be a
production-contract expansion smuggled in for sort order. Such items sort last
among equal `downstream`, which the ranking rule already handles. If
always-sortable candidate review turns out to be required, it is an explicit
follow-up epic that adds the event.

**`evidence`.**

- `basis` is always the literal `"verification-and-summary"`.
- `diffAvailable` is always the literal `false`.
- `inspect` is:

  ```ts
  { executable: "git", args: ["-C", homeDir, "diff", `${baseOid}..${headOid}`] }
  ```

  …but only when the element's `QueueEvidenceInput` has a non-null `homeDir`,
  `baseOid` and `headOid`, **and** both OIDs match `/^[0-9a-f]{7,64}$/`. Otherwise
  `null`. Never build a single shell string.

**`rankDecisions` — the ordering rule.** Total and deterministic:

1. `downstream` descending;
2. `actionableSince` ascending, with `null` sorting **last**;
3. `taskId ?? objectiveId ?? initiativeId` ascending (lexicographic).

`kindLabel` **never** participates. Sort a copy; do not mutate the argument.

`projectDecisions` returns items in element order (tasks, then objectives, then
initiatives, each in input order); ranking is `rankDecisions`'s job alone, so a
caller can aggregate several projects before ranking once.

## Constraints

- Domain-only imports. `eventTimeMs` comes from `src/domain/event.ts` (added by
  EPIC 016 story 03); if it is not yet present, add it there per that story's
  spec rather than inlining `decodeTime`.
- Pure: no clock, no randomness, no mutation of `input`.
- Do not re-implement fan-out. `dependentClosure` (`src/domain/graph.ts:157`) is
  the only closure walker.
- Do not re-derive verdicts. `decisionActions` (story 4) is the only producer.
- `diffAvailable` is typed as the literal `false`, not `boolean`, so a future
  change must be deliberate.

## Verify

New `src/domain/decision-queue.test.ts`. Convention: `node:test` +
`node:assert/strict`, flat `test(...)`, plain-literal fixtures.

- `(017-S5-one-item-per-element)` a project with one `failed` task, one `conflict`
  objective, one `awaiting_confirmation` objective and one publishable initiative
  → exactly four items with the four expected `kindLabel` values.
- `(017-S5-completed-task-no-duplicate)` an `awaiting_confirmation` objective with
  three `completed` tasks → exactly **one** item, the objective's.
- `(017-S5-downstream-task)` a failed root with four pending dependents →
  `downstream === 4`.
- `(017-S5-downstream-objective)` an objective whose two tasks have three
  downstream dependents → `downstream` counts each id once.
- `(017-S5-actionable-since)` an old task id with a recent `actionableEventIds`
  entry ranks **before** a recent task id with an old entry; assert on
  `rankDecisions` output order, not on the raw values.
- `(017-S5-actionable-since-null-last)` an item with no entry has
  `actionableSince === null` and sorts last among equal `downstream`.
- `(017-S5-rank-order)` a fixture with one deliberate tie at each level:
  differing `downstream`; equal `downstream` differing `actionableSince`; equal
  both, differing id. Assert the exact id order.
- `(017-S5-kind-not-a-sort-key)` a `publication` item with `downstream: 5`
  outranks an `objective-candidate` with `downstream: 1`. This is the binding
  decision-5 guard.
- `(017-S5-rank-pure)` `rankDecisions` does not mutate its argument (compare a
  clone) and is idempotent (ranking twice equals ranking once).
- `(017-S5-inspect-structured)` valid identity → `inspect.executable === "git"`
  and `inspect.args` deep-equals
  `["-C", "/home/x", "diff", "aaaaaaa..bbbbbbb"]`.
- `(017-S5-inspect-null)` each of: `homeDir` null; `baseOid` null; `headOid`
  null; a malformed OID `"not-an-oid"` → `inspect === null`.
- `(017-S5-inspect-no-shell-string)` assert the item's `evidence` has no string
  field containing `" "`-joined git text — i.e. `typeof inspect.args === "object"`
  and `Array.isArray(inspect.args)`.
- `(017-S5-diff-unavailable)` every produced item has
  `evidence.diffAvailable === false` and
  `evidence.basis === "verification-and-summary"`.
- `(017-S5-cause-candidate)` an `awaiting_confirmation` task whose id **is** in
  `candidateTaskIds` → `cause === "candidate"`.
- `(017-S5-cause-escalation)` an `awaiting_confirmation` task **not** in
  `candidateTaskIds` → `cause === "escalation"`.
- `(017-S5-cause-absent-other-kinds)` a `failed` task item and an objective item
  each have **no `cause` key**.
- `(017-S5-cause-same-verdicts)` both causes produce `deepEqual` `verdicts` —
  proving `cause` does not leak into `decisionActions`.
- `(017-S5-candidate-actionable-since-null)` a `cause: "candidate"` item with no
  entry in `actionableEventIds` → `actionableSince === null`, and it sorts after
  an equal-`downstream` item that has one.
- `(017-S5-expected-commit)` an objective with `commitOid` → item has
  `expectedCommit` equal to it; without `commitOid` → the key is absent
  (`"expectedCommit" in item === false`).
- `npm run verify` exits 0.
- Proof: `scripts/e2e/decision-workbench-proof.sh` phases **D** and **I**.
