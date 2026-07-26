# Story 1 — `validateDag` extraction + edge satisfaction domain

Epic: `.agent/plan/epics/007.17-follow-up-sequencing-edges.md`

## Change

### 1a. Extract `validateDag` from `validateGraph` (`src/domain/graph.ts:41-106`)

Add above `validateGraph`:

```ts
/** A node in any dependency DAG — id + edge list, no lifecycle status. */
export interface DagNode {
  id: string;
  dependencies: string[];
}

/**
 * Status-agnostic duplicate / unknown-dependency / cycle validation.
 * Scans `nodes` in input order for determinism.
 */
export function validateDag(nodes: readonly DagNode[]): void {
  /* body = the CURRENT body of validateGraph, lines 42-105, verbatim */
}
```

Then replace the whole body of `validateGraph` with a single delegation:

```ts
export function validateGraph(nodes: GraphNode[]): void {
  validateDag(nodes);
}
```

- Move lines 42-105 **verbatim** into `validateDag`. Do not rename locals, do not
  reorder the three checks, do not change the error classes or their messages
  (`Duplicate task id: …`, `Task <id> depends on unknown task <dep>`,
  `Cycle detected: a -> b -> a`). `DuplicateTaskError`, `UnknownDependencyError`
  and `CycleError` stay exactly where they are (`graph.ts:9`, `:19`, `:31`) and
  keep their `taskId` / `dependency` / `path` field names.
- `validateGraph` keeps its exported signature `(nodes: GraphNode[]): void`.
  `GraphNode` (`graph.ts:3`) is unchanged and is structurally assignable to
  `DagNode`.
- Do not touch `serialOrder` (`:108`), `dependentClosure` (`:150`) or
  `readiness` (`:186`).

### 1b. New file `src/domain/sequencing.ts`

Pure, no I/O. Exactly this surface:

```ts
import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";

/** An `after:` prerequisite that does not yet satisfy its edge. */
export interface UnsatisfiedEdge {
  id: string;
  /** True when the prerequisite can never satisfy the edge (it is `discarded`). */
  neverSatisfies: boolean;
}

/** An initiative edge is satisfied only by `landed`. */
export function initiativeEdgeSatisfied(
  status: InitiativeStatus | undefined,
): boolean {
  return (status ?? "building") === "landed";
}

/** An objective edge is satisfied only by `integrated`. */
export function objectiveEdgeSatisfied(
  status: ObjectiveStatus | undefined,
): boolean {
  return (status ?? "building") === "integrated";
}

/** Unsatisfied initiative prerequisites, in input order. */
export function unsatisfiedInitiativeEdges(
  after: readonly Array<{ id: string; status?: InitiativeStatus }>,
): UnsatisfiedEdge[] {
  /* … */
}

/** Unsatisfied objective prerequisites, in input order. */
export function unsatisfiedObjectiveEdges(
  after: readonly Array<{ id: string; status?: ObjectiveStatus }>,
): UnsatisfiedEdge[] {
  /* … */
}
```

Behaviour, pinned:

- `unsatisfied*Edges` returns one entry per prerequisite whose
  `*EdgeSatisfied(status)` is `false`, **preserving the input array order** (no
  sorting inside — callers pass the already-`dependency`-sorted set from the
  repository).
- `neverSatisfies` is `true` iff `status === "discarded"`, else `false`.
- A prerequisite with `status: undefined` is treated as `"building"`: unsatisfied,
  `neverSatisfies: false`.
- Satisfied prerequisites are omitted entirely; an all-satisfied set returns `[]`.

### 1c. Typed errors for Story 4, in the same new file

```ts
export class SequencingLockedError extends Error {
  readonly nodeId: string;
  readonly startedTaskIds: string[];

  constructor(nodeId: string, startedTaskIds: string[]) {
    super(
      `Sequencing edge refused: ${nodeId} has already started — ordering can no longer be guaranteed; already ran: ${startedTaskIds.join(", ")}`,
    );
    this.name = "SequencingLockedError";
    this.nodeId = nodeId;
    this.startedTaskIds = startedTaskIds;
  }
}

export class SequencingScopeError extends Error {
  readonly dependentId: string;
  readonly dependencyId: string;
  readonly scope: "project" | "initiative";

  constructor(
    dependentId: string,
    dependencyId: string,
    scope: "project" | "initiative",
  ) {
    super(
      `Sequencing edge refused: ${dependentId} and ${dependencyId} are not in the same ${scope}`,
    );
    this.name = "SequencingScopeError";
    this.dependentId = dependentId;
    this.dependencyId = dependencyId;
    this.scope = scope;
  }
}
```

The `SequencingLockedError` message text is load-bearing: the Proof greps it for
both `has already started` and `ordering can no longer be guaranteed`. Do not
reword it.

## Constraints

- `src/domain/` imports nothing outside `src/domain/`.
- No behaviour change to `validateGraph`: every existing test in
  `src/domain/graph.test.ts` must pass untouched.
- No new status values. Do not edit `INITIATIVE_STATUSES` / `OBJECTIVE_STATUSES`
  (`src/domain/initiative.ts:4`, `:8-14`).
- Do not touch `readiness()` — task-level sequencing is a Non-goal.

## Verify

New test file `src/domain/sequencing.test.ts` (`node:test` + `node:assert/strict`,
flat top-level `test(...)` calls, no `describe` — matches
`src/domain/initiative.test.ts`), asserting:

1. `initiativeEdgeSatisfied` — exhaustive `Record<InitiativeStatus, boolean>`
   (`building: false`, `landed: true`, `discarded: false`), looped as in
   `initiative.test.ts:147-164`; plus `initiativeEdgeSatisfied(undefined) === false`.
2. `objectiveEdgeSatisfied` — exhaustive `Record<ObjectiveStatus, boolean>`
   (`building: false`, `awaiting_confirmation: false`, `conflict: false`,
   `integrated: true`, `discarded: false`); plus `undefined` → `false`.
3. `unsatisfiedInitiativeEdges([{id:"a",status:"landed"},{id:"b",status:"building"}])`
   deep-equals `[{ id: "b", neverSatisfies: false }]`.
4. `unsatisfiedInitiativeEdges([{id:"a",status:"discarded"}])` deep-equals
   `[{ id: "a", neverSatisfies: true }]` — a discarded prerequisite blocks and is
   flagged, and nothing cascades (no throw, no status change).
5. `unsatisfiedObjectiveEdges` for each of `building` / `awaiting_confirmation` /
   `conflict` returns one unsatisfied entry with `neverSatisfies: false`;
   `discarded` returns `neverSatisfies: true`; `integrated` returns `[]`.
6. Input order is preserved: input ids `["c","a","b"]` all unsatisfied →
   output ids deep-equal `["c","a","b"]` (assert the exact array, proving the
   function does not sort).
7. `new SequencingLockedError("I1", ["T2","T1"]).message` contains both
   `has already started` and `ordering can no longer be guaranteed`, and
   `.startedTaskIds` deep-equals `["T2","T1"]` (the function does not sort;
   Story 4's caller does).
8. `new SequencingScopeError("O1","O2","initiative").message` equals
   `Sequencing edge refused: O1 and O2 are not in the same initiative`.

Added to `src/domain/graph.test.ts`:

9. `validateDag` is exported and throws `DuplicateTaskError` on a duplicate id,
   `UnknownDependencyError` on an unknown dep, and `CycleError` with
   `path` deep-equal to the same value the existing `validateGraph` cycle test
   asserts — called with plain `{ id, dependencies }` objects that carry **no
   `status` field at all** (proving it is status-agnostic).
10. `validateGraph` still throws the same three errors for the same inputs
    (existing tests at `graph.test.ts:22-99` cover this; do not modify them).

Commands:

- `node --test src/domain/sequencing.test.ts src/domain/graph.test.ts`
- `npm run verify` exits 0

Proof: none directly. This story is the pure foundation for Proof steps 2, 3, 5,
6 and 8.
