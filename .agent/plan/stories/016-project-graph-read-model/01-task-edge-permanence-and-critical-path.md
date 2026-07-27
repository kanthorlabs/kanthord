# Story 1 — Task edge permanence + remaining critical path (domain, pure)

Epic: `.agent/plan/epics/016-project-graph-read-model.md`

## Change

### A. `src/domain/sequencing.ts` — append after line 62 (end of `unsatisfiedObjectiveEdges`)

Import `TaskStatus`: add `import type { TaskStatus } from "./task.ts";` beside the
existing line 1 `import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";`.

Add exactly these exports:

```ts
export interface TaskEdgeNode {
  id: string;
  status: TaskStatus;
  dependencies: readonly string[];
}

/** Only `completed` satisfies a task edge. */
export function taskEdgeSatisfied(status: TaskStatus | undefined): boolean;

/**
 * Ids of nodes that can never become runnable through status transitions alone,
 * given the current dependency graph.
 */
export function permanentlyBlockedTasks(
  nodes: readonly TaskEdgeNode[],
): Set<string>;

/**
 * Per-node unsatisfied edges, keyed by node id. Insertion order equals input
 * order; each array preserves the node's own `dependencies` order.
 */
export function unsatisfiedTaskEdges(
  nodes: readonly TaskEdgeNode[],
): Map<string, UnsatisfiedEdge[]>;
```

Pinned rules — no build-time choices:

1. `taskEdgeSatisfied(status)` returns `status === "completed"`. `undefined` → `false`.
2. `unsatisfiedTaskEdges`: for a node whose `status !== "pending"`, the value is
   **always** `[]`. For a `pending` node, emit one `UnsatisfiedEdge` per
   dependency `d` where `taskEdgeSatisfied(statusOf(d)) === false`, in the node's
   own `dependencies` order.
3. `neverSatisfies` for edge `d` is `true` when `statusOf(d) === "discarded"`
   **or** `d ∈ permanentlyBlockedTasks(nodes)`; otherwise `false`.
4. A dependency id absent from `nodes` yields an entry with
   `neverSatisfies: false` (unknown, not permanent). `validateDag`
   (`src/domain/graph.ts:44`) rejects unknown ids upstream; this is the defensive
   default, not a new rule.
5. `permanentlyBlockedTasks` is a **fixpoint**: start with the empty set; repeat a
   full pass over `nodes` adding any node `n` where `n.status === "pending"` and
   some dependency `d` has `statusOf(d) === "discarded"` or `d` is already in the
   set; stop when a pass adds nothing. A node whose status is not `pending` is
   never added. The fixpoint makes the result independent of input order.
6. `failed` is **not** permanent — `failed->pending` is legal
   (`src/domain/task.ts:96-107`).

### B. `src/domain/graph.ts` — append after line 211 (end of `readiness`)

```ts
export interface RemainingChain {
  metric: "remaining-node-count";
  nodeIds: string[];
  length: number;
}

/** Longest dependency chain among nodes that are neither completed nor discarded. */
export function longestRemainingChain(
  nodes: readonly GraphNode[],
): RemainingChain;
```

Pinned rules:

1. A node is **remaining** when `status !== "completed" && status !== "discarded"`.
2. Only remaining→remaining edges count: a dependency that is not remaining is
   ignored, it does not break the chain.
3. `length` is the node count of the longest such chain. `metric` is the literal
   `"remaining-node-count"` — never a duration.
4. `nodeIds` is **dependency-first**: the chain's deepest dependency is index 0,
   the terminal dependent is last.
5. Tie-break among equal-length chains: the lexicographically smallest `nodeIds`
   array, compared element by element. This makes the result deterministic for
   any input order.
6. No remaining nodes → `{ metric: "remaining-node-count", nodeIds: [], length: 0 }`.
7. Implement with memoised DFS over `dependencies` (the graph is acyclic —
   `validateDag` guarantees it). Do not sort `nodes`.

## Constraints

- Both files stay **pure**: zero imports outside `src/domain/`, no I/O, no clock.
- Do **not** modify `readiness`, `unsatisfiedInitiativeEdges`,
  `unsatisfiedObjectiveEdges`, `dependentClosure`, or `serialOrder`. Existing
  callers (`src/app/task/list-tasks.ts:40`, `src/app/task/reject-task.ts:172`,
  `src/app/initiative/get-initiative.ts:45`,
  `src/app/objective/get-objective.ts:57`) must keep compiling unchanged.
- Reuse the existing `UnsatisfiedEdge` interface (`src/domain/sequencing.ts:3`).
  Do not declare a second edge type.

## Verify

`node --test src/domain/sequencing.test.ts` — add to the existing flat
`test(...)` style (no `describe`; see `src/domain/sequencing.test.ts:1-11` for the
import block and `:65-71` for the assertion style). New tests, each asserting with
`assert.deepEqual` on the full expected value:

- `taskEdgeSatisfied`: exhaustive over all six `TASK_STATUSES`
  (`src/domain/task.ts:3-10`) — only `completed` is `true`; `undefined` is `false`.
- `unsatisfiedTaskEdges`: a `pending` node with one `completed` dependency → `[]`.
- `unsatisfiedTaskEdges`: a `pending` node with a `failed` dependency → one entry,
  `neverSatisfies: false`.
- `unsatisfiedTaskEdges`: a `pending` node with a `discarded` dependency → one
  entry, `neverSatisfies: true`.
- `unsatisfiedTaskEdges`: a `running`, a `completed`, a `failed`, an
  `awaiting_confirmation` and a `discarded` node each map to `[]` even when their
  dependencies are not completed.
- `unsatisfiedTaskEdges`: edge order equals the node's `dependencies` order, and
  `Map` key order equals input order.
- `unsatisfiedTaskEdges`: a dependency id not present in `nodes` yields
  `neverSatisfies: false`.
- `permanentlyBlockedTasks`: direct — `pending` B depends on `discarded` A → `{B}`.
- `permanentlyBlockedTasks`: two-hop transitive — `discarded` A, `pending` B→A,
  `pending` C→B → `{B, C}`, and `unsatisfiedTaskEdges` reports
  `neverSatisfies: true` on C's edge to B.
- `permanentlyBlockedTasks`: `failed` A with `pending` B→A → empty set.
- `permanentlyBlockedTasks`: diamond — `pending` D depends on `discarded` A and
  `completed` B → D is permanently blocked, and D's edge list contains **only**
  the A edge (B is satisfied).
- `permanentlyBlockedTasks`: a node with two dead arms reports both edges with
  `neverSatisfies: true`.
- `permanentlyBlockedTasks`: the same graph given in reversed input order yields
  the identical set (fixpoint independence).

`node --test src/domain/graph.test.ts` — reuse the local `node(id, status, deps)`
helper at `src/domain/graph.test.ts:15-21`:

- `longestRemainingChain`: empty input → `{metric:"remaining-node-count", nodeIds:[], length:0}`.
- `longestRemainingChain`: every node `completed` → `nodeIds: []`, `length: 0`.
- `longestRemainingChain`: chain a→b→c all `pending` → `nodeIds: ["a","b","c"]`,
  `length: 3`, dependency-first order.
- `longestRemainingChain`: a `completed` dependency is skipped without breaking
  the chain — `completed` a, `pending` b→a, `pending` c→b → `["b","c"]`, `length: 2`.
- `longestRemainingChain`: `discarded` nodes are excluded from the path entirely.
- `longestRemainingChain`: two equal-length chains → the lexicographically
  smallest `nodeIds` wins; asserted with the input given in both orders.
- `longestRemainingChain`: asserts `metric` is exactly the string
  `"remaining-node-count"`.

`npm run verify` exits 0.

Proof: none directly. Story 1 is consumed by stories 3 and 7; its behaviour is
observed in Proof phases **B** (`criticalPath`), **C** (`neverSatisfies: false`)
and **E** (`neverSatisfies: true`, `blockedForever: true`).
