# Story 01 — the graph adapter and repository-name resolution

Epic: `.agent/plan/epics/026.6-ui-graph-and-readiness.md` (decision 1)
Depends on: EPIC 026.5.

## Change

- Append to `ui/src/lib/dto.ts` after the resource DTOs. Mirror `src/apps/http/views/initiative.ts:67-155` exactly as `InitiativeGraphInitiativeDto`, `InitiativeGraphGroupDto`, `InitiativeGraphNodeDto`, and `InitiativeGraphDto`. Reuse `ActionDto`; add `UnsatisfiedEdgeDto { id:string; neverSatisfies:boolean }`. Preserve every node field and nullability from the wire. Type `criticalPath.metric` as `"remaining-node-count"`; type the six lifecycle counts and three operational counts as required numeric fields.
- Append `initiativeKeys.graph(id: string) => ["initiative", id, "graph"] as const` at the `initiativeKeys` object in `ui/src/lib/query-keys.ts`.
- Append to `ui/src/lib/api-client.ts` beside `fetchInitiative`: `fetchInitiativeGraph(id: string, init?: RequestInitLike): Promise<InitiativeGraphDto>`. It calls `apiGet` with `/api/initiative/${encodeURIComponent(id)}/graph` and forwards `init`.
- Create `ui/src/lib/graph-adapter.ts` with these exported types and function:

```ts
export interface GraphRepository {
  readonly id: string;
  readonly label: string;
  readonly known: boolean;
}
export interface GraphNodeModel {
  readonly task: InitiativeGraphNodeDto;
  readonly depth: number;
}
export interface GraphLaneModel {
  readonly objective: InitiativeGraphGroupDto;
  readonly repositories: readonly GraphRepository[];
  readonly noRepository: boolean;
  readonly nodes: readonly GraphNodeModel[];
}
export interface GraphEdgeModel {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}
export interface InitiativeGraphModel {
  readonly graph: InitiativeGraphDto;
  readonly lanes: readonly GraphLaneModel[];
  readonly edges: readonly GraphEdgeModel[];
}
export function adaptInitiativeGraph(
  graph: InitiativeGraphDto,
  repositories: readonly RepositoryResourceDto[],
): InitiativeGraphModel;
```

- In `adaptInitiativeGraph`, preserve `graph.groups` order. Resolve each `group.repositories` entry by exact repository `id`; a match becomes `{id,label:repository.name,known:true}`, and a miss becomes `{id,label:"unknown resource",known:false}`. Never expose the unmatched ID as its label. Set `noRepository` only when the source array is empty.
- Compute task depth over the complete graph before grouping. A task with no known dependency has depth `0`; otherwise depth is `1 + max(depth of known dependencies)`. Ignore an unknown dependency for depth. The server DAG is acyclic; if a malformed fixture forms a cycle, throw `new Error("initiative graph contains a task cycle")`.
- Put each task only in the lane whose `objective.id === task.groupId`. Throw `new Error(`initiative graph task ${task.id} has unknown group ${task.groupId}`)` when no lane exists. Sort lane tasks by ascending depth, then by code-unit ID order using `a < b ? -1 : a > b ? 1 : 0`; do not use `localeCompare`.
- Map every API edge in API order to `{id:`${from}->${to}`,from,to}`. Throw `new Error(`duplicate initiative graph edge ${id}`)` if that ID repeats.

## Constraints

- The adapter is pure. It imports DTO types only and performs no query, rendering, or mutation.
- Lane order is API order. Task order is global dependency depth then ID, including cross-lane dependencies.
- Do not add an API route, package, or graph-write behavior.

## Verify

- `npm run test --workspace ui -- src/lib/graph-adapter.test.ts` — create this file with one fixture whose group order is `o2,o1`, repository IDs are `r2,missing`, and tasks are supplied out of order. Assert lane order stays `o2,o1`; labels are the resolved name and `unknown resource`; the raw missing ID is not a label; an empty repository list has `noRepository:true`; node order is depth then ID; cross-lane depth is included; edges retain API order and use `from->to` IDs.
- In the same file, assert an unknown `groupId`, a task cycle, and a duplicate edge each throw the exact error above.
- `npm run test --workspace ui -- src/lib/query-keys.test.ts` — append the exact `initiativeKeys.graph("i1")` assertion.
- `npm run test --workspace ui -- src/lib/api-client.test.ts` — append that `fetchInitiativeGraph("a/b")` requests `/api/initiative/a%2Fb/graph`, forwards the abort signal, unwraps `data`, and records only the `accept` header.
- `npm run verify` exits 0.
- Proof: supplies the phase C lane/task assignment and phase D edge model consumed by Story 02. Phase C also asserts the resolved name path: the seeded lane one renders one `lane-repository-chip` containing `proof-repo` and never the resource id, and lane two renders `lane-no-repository`. The unknown-resource chip stays hermetic coverage beyond the Proof.
