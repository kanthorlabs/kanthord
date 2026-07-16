# Story 005 - dependency readiness

Epic: `.agent/plan/epics/002-domain-core.md`

## Goal

The pure scheduling heart: DAG validation (duplicate id, unknown dependency,
cycle — all named, structured errors, in that precedence) and the readiness
report, both over a structural `GraphNode` — so the same functions serve
`check graph` (YAML labels as node ids) today and real `Task` entities
(ULID ids) in EPIC 005. `validateGraph` is also the guard reused when a
dependency edge is **added or re-arranged** later (EPIC 004): the use case
applies the proposed edge to the task set and re-runs `validateGraph`, so a
mutation that would create a cycle or reference an unknown task is rejected by
this same function — no separate mutation path.

## Acceptance Criteria

- `GraphNode` is exported: `{ id: string; status: TaskStatus;
  dependencies: string[] }`. `Task` satisfies it structurally.
- `validateGraph(nodes)` checks in locked precedence — duplicates, then
  unknown dependencies, then cycles — each scanning nodes in input order:
  duplicate node id → `DuplicateTaskError { taskId }`; unknown dependency →
  `UnknownDependencyError { taskId, dependency }`; any cycle (including a
  self-loop) → `CycleError { path }` where `path` starts and ends with the
  same node id (e.g. `['a','b','a']`). A valid DAG returns without throwing.
- `readiness(nodes)` assumes an already-validated graph (callers validate
  first; `CheckGraph` in story 007 is the validated operation): reports
  **pending** nodes only, in input order. A pending node is
  `{ id, state: 'ready', waiting: [] }` when every dependency has status
  `completed`; otherwise `{ id, state: 'blocked', waiting: <not-completed
  dependencies, declared order> }`. Running/completed/failed nodes do not
  appear. A failed dependency blocks (it is not completed).

## Constraints

- `src/domain/graph.ts`. Pure functions over `GraphNode[]`; no I/O; imports
  only sibling domain modules.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 - graph validation

**Requires:** S003-T2 (`TaskStatus` — `GraphNode` reuses it).

**Input:** `src/domain/graph.ts` (new), `src/domain/graph.test.ts` (new);
consumes `TaskStatus` from `./task.ts`.

**Action - RED:** tests assert: (a) two nodes sharing an id throw
`DuplicateTaskError`; (b) a dependency naming a missing id throws
`UnknownDependencyError` with the right `taskId`/`dependency`; (c) a two-node
cycle throws `CycleError` with `path` `['a','b','a']`; (d) a self-loop throws
with `['a','a']`; (e) a graph containing both a duplicate id and a cycle
throws `DuplicateTaskError` (precedence); (f) a valid diamond DAG does not
throw. Fails today: module does not exist.

**Action - GREEN:** implement `GraphNode`, `validateGraph`, and the three
error classes. Detect the first cycle scanning nodes in input order so the
reported path is deterministic.

**Action - REFACTOR:** none.

**Output:** `src/domain/graph.ts` exports `GraphNode`, `validateGraph(nodes)`,
`CycleError { path }`, `UnknownDependencyError { taskId, dependency }`,
`DuplicateTaskError { taskId }` — precedence duplicates → unknown → cycles.

**Verify:** `npm test` green (the six RED cases pass); `npm run typecheck`
exit 0.

### Task T2 - readiness report

**Requires:** S005-T1 (`GraphNode`; readiness assumes a validated graph).

**Input:** `src/domain/graph.ts`, `src/domain/graph.test.ts`; consumes
`GraphNode`.

**Action - RED:** tests assert, on a valid graph: (a) a pending node with no
dependencies is `ready`; (b) a pending node whose only dependency is
`completed` is `ready`; (c) dependencies that are `pending`, `running`, or
`failed` each yield `blocked` with that dependency listed in `waiting`, in
declared order; (d) non-pending nodes are absent from the report; (e) report
order equals input order. Fails today: `readiness` does not exist.

**Action - GREEN:** implement `readiness(nodes)` per the contract above.

**Action - REFACTOR:** none.

**Output:** `src/domain/graph.ts` additionally exports `readiness(nodes):
Array<{ id: string; state: 'ready' | 'blocked'; waiting: string[] }>` per the
Acceptance Criteria.

**Verify:** `npm test` green (all five readiness cases); `npm run typecheck`
exit 0.
