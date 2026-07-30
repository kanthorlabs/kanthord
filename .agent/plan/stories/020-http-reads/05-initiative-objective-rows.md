# Story S5 — initiative + objective rows

Epic: `.agent/plan/epics/020-http-reads.md`
Depends on: Story S4 (`views/shared.ts`, `optionalQueryString`).

Five rows: the initiative collection under a project, the initiative item, the
initiative graph, the objective collection under an initiative, the objective
item.

## Change

### 1. `src/apps/http/views/initiative.ts` (new)

`Initiative` is a `domain/` entity (`src/domain/initiative.ts:18-28`: `id`,
`projectId`, `name`, `paused`, `status?`, `workspace?`) → local
`InitiativeResult` mirror. `GetInitiativeOutput`
(`src/app/initiative/get-initiative.ts:12-21`) and `GetInitiativeGraphOutput`
(`src/app/initiative/get-initiative-graph.ts:136-161`) are `app/` types →
`import type`.

- `initiativeView(result: InitiativeResult): InitiativeView` — literal fields
  `id`, `projectId`, `name`, `paused`, then optional `status` and `workspace` by
  conditional spread. (This is the LIST row view.)
- `initiativeDetailView(result: GetInitiativeOutput): InitiativeDetailView` —
  fields `id`, `name`, `status`, `paused`, `branch`, optional `workspace`,
  `after: [...result.after]`, `waiting: result.waiting.map(unsatisfiedEdgeView)`.
- `initiativeGraphView(result: GetInitiativeGraphOutput): InitiativeGraphView` —
  every field of the app DTO:
  - `projectId`
  - `initiative`: `{ id, name, status, paused, branch, action:
nullableActionView(result.initiative.action) }`
  - `groups`: `result.groups.map(...)` → `{ id, name, status,
repositories: [...g.repositories], commitOid, conflictReason,
after: [...g.after], waiting: g.waiting.map(unsatisfiedEdgeView),
action: nullableActionView(g.action) }`
  - `nodes`: `result.nodes.map(...)` → `{ id, groupId, title, status,
dependencyState, executionState, dependencies: [...n.dependencies],
waiting: n.waiting.map(unsatisfiedEdgeView), blockedForever, downstream,
lastEventId, lastEventAtMs, agent, instructions, ac: [...n.ac],
verificationRequested: [...n.verificationRequested],
verificationResults: n.verificationResults.map((v) => ({ command: v.command,
exitCode: v.exitCode, output: v.output })), failureReason,
rejection: n.rejection === null ? null : { resolution: n.rejection.resolution,
reason: n.rejection.reason }, produced: n.produced === null ? null :
{ summary: n.produced.summary, evidenceCount: n.produced.evidenceCount },
note, candidate: n.candidate === null ? null : { candidateSHA, baseSHA,
target, state, source }, action: nullableActionView(n.action) }`
  - `edges`: `result.edges.map((e) => ({ from: e.from, to: e.to }))`
  - `criticalPath`: `{ metric: result.criticalPath.metric,
nodeIds: [...result.criticalPath.nodeIds], length: result.criticalPath.length }`
  - `counts`: `{ pending, running, completed, failed, awaiting_confirmation,
discarded, blocked, blockedForever, actionable }`

### 2. `src/apps/http/views/objective.ts` (new)

`Objective` is a `domain/` entity (`src/domain/initiative.ts:31-45`: `id`,
`initiativeId`, `name`, `status?`, `commitOid?`, `parentOid?`,
`conflictReason?`, `note?`, `conflictCause?`) → local `ObjectiveResult` mirror.
`GetObjectiveOutput` (`src/app/objective/get-objective.ts:16-32`) is an `app/`
type.

- `objectiveView(result: ObjectiveResult): ObjectiveView` — literal `id`,
  `initiativeId`, `name`, then optional `status`, `commitOid`, `parentOid`,
  `conflictReason`, `note`, `conflictCause` by conditional spread. (LIST row.)
- `objectiveDetailView(result: GetObjectiveOutput): ObjectiveDetailView` — emit
  exactly these ten fields, in this order, and no others:
  `id`, `name`, `status`, `commitOid?` (conditional spread), `parentOid?`
  (conditional spread), `integrations: result.integrations.map((i) => ({
repository: i.repository, state: i.state }))`, `after: [...result.after]`,
  `waiting: result.waiting.map(unsatisfiedEdgeView)`, `conflictCause` — **not a
  field of `GetObjectiveOutput`; do NOT emit it** — `conflictReason` and `note`
  (both `string | null`, always present, never conditional).

  Authoritative list: `id`, `name`, `status`, `commitOid?`, `parentOid?`,
  `integrations`, `after`, `waiting`, `conflictReason`, `note`
  (`src/app/objective/get-objective.ts:16-32`).

### 3. `src/apps/http/deps.ts` — five fields

`listInitiatives: ListInitiatives`, `getInitiative: GetInitiative`,
`getInitiativeGraph: GetInitiativeGraph`, `listObjectives: ListObjectives`,
`getObjective: GetObjective` (all `import type` from `../../app/**`).

### 4. `src/apps/cli/commands/serve.ts:39` — populate all five from `deps`.

### 5. `src/apps/http/routes.ts` — five rows

| id                          | path                            | decode                                                                                     | run                                      | present                        |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------- | ------------------------------ |
| `project.initiative.list`   | `/api/project/:id/initiative`   | `{ projectId: requirePathParam(params,"id"), ...(name !== undefined ? { name } : {}) }`    | `deps.listInitiatives.execute(input)`    | `result.map(initiativeView)`   |
| `initiative.get`            | `/api/initiative/:id`           | `{ id: requirePathParam(params,"id") }`                                                    | `deps.getInitiative.execute(input)`      | `initiativeDetailView(result)` |
| `initiative.graph.get`      | `/api/initiative/:id/graph`     | `{ id: requirePathParam(params,"id") }`                                                    | `deps.getInitiativeGraph.execute(input)` | `initiativeGraphView(result)`  |
| `initiative.objective.list` | `/api/initiative/:id/objective` | `{ initiativeId: requirePathParam(params,"id"), ...(name !== undefined ? { name } : {}) }` | `deps.listObjectives.execute(input)`     | `result.map(objectiveView)`    |
| `objective.get`             | `/api/objective/:id`            | `{ id: requirePathParam(params,"id") }`                                                    | `deps.getObjective.execute(input)`       | `objectiveDetailView(result)`  |

All five: `method: "GET"`, `successStatus: 200`, `kind: "json"`.
`cliCommands`: `["list initiative","find initiative"]`, `["get initiative"]`,
`["get graph"]`, `["list objective","find objective"]`, `["get objective"]`.

## Constraints

- `GetInitiativeGraph.execute` takes `{ id }` — NOT `{ initiativeId }`
  (`src/app/initiative/get-initiative-graph.ts:197`). The CLI flag is
  `--initiative`; do not copy the flag name.
- `initiativeView` must emit `projectId` (an initiative genuinely has one);
  `projectView` (S4) must not.
- The graph view names every one of the ~28 `GraphNodeOutput` fields
  (`get-initiative-graph.ts:88-123`). Missing one is a defect; adding one is a
  defect.

## Verify

- New `src/apps/http/views/initiative.test.ts`:
  - `initiativeView` leak test — extra injected field absent; optional `status`
    / `workspace` keys absent when the source omits them.
  - `initiativeDetailView` key set exactly the declared list; `waiting` mapped
    through `unsatisfiedEdgeView` (an injected extra on an edge is dropped).
  - `initiativeGraphView` over a fixture with one group, one node carrying EVERY
    optional/nullable field populated, one edge: assert the top-level, group,
    node, `criticalPath`, `counts`, `verificationResults[0]`, `rejection`,
    `produced` and `candidate` key sets are each exactly the declared lists, and
    an injected extra on each nested object is dropped. A second case with the
    nullable node fields all `null` asserts they are PRESENT and `null` (they are
    non-optional in the DTO).
- New `src/apps/http/views/objective.test.ts` — the same two shapes
  (`objectiveView`, `objectiveDetailView`), including a case where every optional
  field is absent and a case where all are present.
- New `src/apps/http/routes.initiative.test.ts` (supertest + fake deps):
  - `GET /api/project/p1/initiative` → fake received `{ projectId: "p1" }`;
    with `?name=x` → `{ projectId: "p1", name: "x" }`.
  - `GET /api/initiative/i1` → `{ id: "i1" }`; unknown → `404 unknown_reference`.
  - `GET /api/initiative/i1/graph` → fake received `{ id: "i1" }` (assert the
    field name is `id`, not `initiativeId`).
  - `GET /api/initiative/i1/objective` → `{ initiativeId: "i1" }`.
  - `GET /api/objective/o1` → `{ id: "o1" }`.
  - `GET /api/initiative/%20/graph` → `400 invalid_input`, use case not called.
- `node --test src/apps/http/views/initiative.test.ts src/apps/http/views/objective.test.ts src/apps/http/routes.initiative.test.ts src/apps/http/routes.test.ts src/apps/http/cli-coverage.test.ts` passes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-reads-proof.sh` phase C (initiative/objective lines)
  and phase E's `graph` block.
