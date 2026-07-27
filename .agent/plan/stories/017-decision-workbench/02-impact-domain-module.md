# Story 2 — `src/domain/impact.ts` — `previewDiscard`

Epic: `.agent/plan/epics/017-decision-workbench.md`

## Change

New file `src/domain/impact.ts`. Pure, zero I/O. It may import only other
`src/domain/*` modules (`eslint.config.js:56-59`).

```ts
import type { TaskStatus } from "./task.ts";
import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";
import { dependentClosure, type GraphNode } from "./graph.ts";
import { sha256Hex } from "./sha.ts";

export type DiscardTarget =
  { type: "task"; id: string } | { type: "objective"; id: string };

export interface ImpactTask {
  id: string;
  title: string;
  objectiveId: string;
  status: TaskStatus;
  dependencies: string[];
}

export interface ImpactObjective {
  id: string;
  name: string;
  initiativeId: string;
  status?: ObjectiveStatus;
  /** Sequencing predecessors: objective ids this objective must follow. */
  after: string[];
}

export interface ImpactInitiative {
  id: string;
  name: string;
  status?: InitiativeStatus;
  /** Sequencing predecessors: initiative ids this initiative must follow. */
  after: string[];
}

export interface ImpactInput {
  target: DiscardTarget;
  tasks: ImpactTask[];
  objectives: ImpactObjective[];
  initiatives: ImpactInitiative[];
}

export type DamageEffect =
  "discarded-by-cascade" | "permanently-unsatisfiable" | "left-blocked";

export interface Damage {
  target: {
    type: "task" | "objective" | "initiative";
    id: string;
    name: string;
  };
  effect: DamageEffect;
}

export interface DiscardPreview {
  damage: Damage[];
  counts: Record<DamageEffect, number>;
  /** Stable hash over the sorted `damage` array. */
  digest: string;
}

export function previewDiscard(input: ImpactInput): DiscardPreview;
```

### Pinned rules — implement exactly

**Effect precedence (highest first).** A target appears in `damage` **exactly
once**, under its highest-precedence effect:

1. `discarded-by-cascade`
2. `permanently-unsatisfiable`
3. `left-blocked`

**`discarded-by-cascade`.**

- `target.type === "task"`: build `GraphNode[]` from `input.tasks`
  (`{id, status, dependencies}`) and call
  `dependentClosure(nodes, target.id)` (`src/domain/graph.ts:157`). Every closure
  member whose status is `"pending"` is `discarded-by-cascade`. The target itself
  is **never** in `damage` — `dependentClosure` already excludes the root
  (`graph.ts:170`), and the operator chose the target.
- `target.type === "objective"`: every task with
  `objectiveId === target.id` whose status is `"pending"` or `"failed"`
  (mirrors `src/app/objective/reject-objective.ts:62`).
- **The initiative.** Add the target objective's initiative as
  `discarded-by-cascade` only when the real rule fires
  (`reject-objective.ts:84-102`): the initiative exists, its status is not
  `"discarded"`, and every sibling objective — with the target treated as
  `"discarded"` — is `"integrated"` or `"discarded"`. For a task target apply
  the two-level rule from `src/app/task/reject-task.ts:219-267`: roll each
  touched objective up first (all its tasks terminal, at least one discarded,
  using the post-cascade statuses), then roll the initiative up from the
  resulting objective statuses.

**`permanently-unsatisfiable`.**

- An objective `O` qualifies when `O.after` contains an id that this discard
  makes terminal-and-unsatisfiable, i.e. the discarded objective set (the target
  when it is an objective, plus any objective rolled up to `discarded` above).
  Only `"integrated"` satisfies an objective edge
  (`src/domain/sequencing.ts:22-26`).
- An initiative `I` qualifies **only when its own initiative is actually in the
  cascaded-to-`discarded` set**. Only `"landed"` satisfies an initiative edge
  (`sequencing.ts:12-16`). Do **not** mark initiative dependents merely because
  one of the initiative's objectives was discarded — the initiative survives
  unless the all-terminal rule fires.
- **Computed transitively**: an objective made permanently unsatisfiable is
  itself unsatisfiable for its own dependents. Iterate to a fixpoint so the
  result is order-independent.
- Objectives and initiatives already `"discarded"` before this call are **not**
  reported — nothing new breaks.

**`left-blocked`.**

- Only for a task target: closure members whose status is **not** `"pending"`
  (`reject-task.ts:178-180` skips and reports them). Not discarded, not
  permanent.

**Ordering.** Sort `damage` by effect precedence (the order above), then by
`target.id` ascending. Deterministic for any input order.

**`counts`.** All three keys always present; `0` when the effect has no member.

**`digest`.** `sha256Hex(JSON.stringify(damage))` using the already-sorted array
and the fixed key order `target` (`type`, `id`, `name`) then `effect`. Reuse
`sha256Hex` from `src/domain/sha.ts:60-63` — do not call `createHash` directly.
An empty `damage` still yields a digest (the hash of `[]`).

**Names.** Take `name` from `ImpactTask.title` / `ImpactObjective.name` /
`ImpactInitiative.name`. An id with no matching record is skipped entirely — never
emitted with a placeholder name.

## Constraints

- Pure: no `Date`, no `Math.random`, no I/O, no mutation of `input`.
- Domain-only imports.
- Do **not** modify `dependentClosure`, `readiness`, `serialOrder`,
  `unsatisfiedInitiativeEdges`, `unsatisfiedObjectiveEdges`, or `sha256Hex`.
- Do not import `unsatisfiedObjectiveEdges` merely to reuse its shape — this
  module needs the discard-set question, not the current-status question. Reuse
  only `objectiveEdgeSatisfied` / `initiativeEdgeSatisfied` if useful.

## Verify

New `src/domain/impact.test.ts`. Convention: `node:test` +
`node:assert/strict`, flat `test(...)`, plain-literal fixtures,
`assert.deepEqual` on the whole result — mirror `src/domain/sequencing.test.ts:1-11,65-76`
and the `node()` helper style at `src/domain/graph.test.ts:14-21`.

Tests, each asserting exact values:

- `(017-S2-task-mixed-closure)` root with two dependents, one `pending` and one
  `running` → `pending` is `discarded-by-cascade`, `running` is `left-blocked`,
  `counts` is `{ "discarded-by-cascade": 1, "permanently-unsatisfiable": 0, "left-blocked": 1 }`.
- `(017-S2-task-transitive)` chain `a→b→c`, all `pending`, target `a` → `b` and
  `c` both `discarded-by-cascade`.
- `(017-S2-leaf)` a task with no dependents → `damage: []` and all three counts
  `0`; `digest` is a non-empty 64-char hex string.
- `(017-S2-objective-tasks)` objective target with one `pending`, one `failed`,
  one `completed` task → the `pending` and `failed` tasks are
  `discarded-by-cascade`; the `completed` task is absent.
- `(017-S2-objective-downstream)` objective `O2` with `after: ["O1"]`, target
  `O1` → `O2` is `permanently-unsatisfiable`.
- `(017-S2-objective-downstream-transitive)` `O3.after = ["O2"]`,
  `O2.after = ["O1"]`, target `O1` → both `O2` and `O3` are
  `permanently-unsatisfiable`.
- `(017-S2-initiative-cascades)` the target is the initiative's only
  non-terminal objective and its sibling is `integrated` → the initiative is
  `discarded-by-cascade`.
- `(017-S2-initiative-survives)` a sibling objective is `building` → the
  initiative is **absent** from `damage`, and an initiative whose `after` names
  this initiative is **also absent**. This is the overstatement guard.
- `(017-S2-initiative-downstream)` the initiative does cascade, and another
  initiative has `after: [thatInitiativeId]` → that one is
  `permanently-unsatisfiable`.
- `(017-S2-precedence-dedup)` a target qualifying for two effects appears
  exactly once, under `discarded-by-cascade`; assert
  `damage.filter(d => d.target.id === X).length === 1`.
- `(017-S2-already-discarded-not-reported)` an objective already `discarded`
  whose `after` names the target is absent from `damage`.
- `(017-S2-order-independent)` the same graph with `tasks` / `objectives` arrays
  shuffled yields a byte-identical `digest` and `deepEqual` `damage`.
- `(017-S2-digest-changes)` two graphs differing by one damaged node yield
  different digests.
- `(017-S2-input-not-mutated)` deep-clone the input, run, and assert the input is
  `deepEqual` to the clone.

Also:

- `npm run verify` exits 0.
- Proof: this story ships no CLI surface; it is exercised through story 3 in
  Proof phase **E**.
