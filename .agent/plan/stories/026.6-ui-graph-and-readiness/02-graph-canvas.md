# Story 02 — the read-only lane canvas and deterministic layout

Epic: `.agent/plan/epics/026.6-ui-graph-and-readiness.md` (decisions 2–3)
Depends on: Story 01.

## Change

- Create `ui/src/components/graph-canvas.tsx`. Import `@xyflow/react/dist/style.css` here, then export:

```ts
export const LANE_WIDTH = 320;
export const LANE_GAP = 48;
export const LANE_HEADER_HEIGHT = 88;
export const TASK_WIDTH = 264;
export const TASK_HEIGHT = 88;
export const TASK_GAP = 24;
export interface GraphCanvasProps {
  readonly model: InitiativeGraphModel;
  readonly onSelectTask: (taskId: string) => void;
}
export function GraphCanvas(props: GraphCanvasProps): ReactElement;
```

- Build React Flow lane parent nodes in `model.lanes` order at `{x:index*(LANE_WIDTH+LANE_GAP),y:0}`. Each lane width is `LANE_WIDTH`; its content height is `LANE_HEADER_HEIGHT + max(1,nodeCount)*(TASK_HEIGHT+TASK_GAP) + TASK_GAP`. Render it with `data-testid="graph-lane"` and `data-lane-objective-id={objective.id}`. The lane body uses `max-height:calc(100dvh - 12rem)` and `overflow-y:auto`; the canvas can pan horizontally.
- Render repository chips in source order with `data-testid="lane-repository-chip"`; use the adapter label. When `noRepository` is true, render exactly `No repository binding` with `data-testid="lane-no-repository"` and render no repository chip.
- Build each task as a child node of its lane at `{x:(LANE_WIDTH-TASK_WIDTH)/2,y:LANE_HEADER_HEIGHT + index*(TASK_HEIGHT+TASK_GAP)}`. Set width/height to `TASK_WIDTH`/`TASK_HEIGHT`, `extent:"parent"`, `expandParent:false`, `draggable:false`, `connectable:false`, and `deletable:false`. Render `data-testid="graph-node"`, `data-task-id={task.id}`, title, and exact status label.
- Choose the task role with this fixed precedence: `blockedForever` → `danger`; `executionState === "paused"` → `attention`; `dependencyState === "blocked"` → `blocked`; otherwise read `TASK_STATUS_ROLE[task.status as TaskStatus]` only when `task.status in TASK_STATUS_ROLE`, and use `neutral` for an unknown status. Apply the selected literal `ROLE_CLASS[role]`; add no graph palette.
- Map model edges to React Flow `source=from`, `target=to`, `type="smoothstep"`, `selectable:false`, `deletable:false`, `reconnectable:false`. The custom edge renderer puts `data-testid="graph-edge"`, `data-edge-from={from}`, and `data-edge-to={to}` on its visible SVG path.
- Configure `ReactFlow` with `nodesDraggable={false}`, `nodesConnectable={false}`, `edgesReconnectable={false}`, `deleteKeyCode={null}`, no connection callback, no edge-update callback, and no interactive mutation control. A task click invokes `onSelectTask(task.id)` once. Keep pan and zoom enabled.
- Render the root with `data-testid="graph-canvas"` and a minimum height of `32rem`. Use `useNodesInitialized()` and `useReactFlow().fitView({padding:0.08,duration:0})`. After all visible lane and task nodes are measured, await that `fitView` promise, then render an empty marker with `data-testid="layout-ready"`. Reset the marker whenever `model.graph.initiative.id`, lane IDs, or task IDs change. For an empty graph, call and await `fitView` after React Flow `onInit`, then mark ready.
- Create `ui/src/pages/initiative-graph.tsx` exporting `InitiativeGraphPage({projectId,initiativeId}:{readonly projectId:string;readonly initiativeId:string})`. Query `initiativeKeys.graph(initiativeId)` with `fetchInitiativeGraph`, `projectKeys.resources(projectId,"repository")` with `fetchResources`, and `projectKeys.detail(projectId)` with `fetchProject`. All use `staleTime:Infinity` and forward query abort signals.
- Feed `resolveGate` these entries in order: project ancestor with `what:"project"`, repository collection ancestor with `what:"repositories"`, graph entity with `what:"initiative graph"`. Build each state with `asyncStateOf`; pass its error message only for `error`. Pass a mismatch only after graph resolution: when `graph.projectId !== projectId`, use `{level:"initiative",what:"initiative",expected:projectId,actual:graph.projectId,correctHref:"/project/" + graph.projectId + "/initiative/" + initiativeId + "/graph"}`, otherwise `null`. Render the returned async or `ScopeMismatch` state; adapt only when the gate is null. This pins loading first, graph 404 as missing, ancestor 404 as chain mismatch, first error in query order, then URL scope mismatch.
- Render `ProjectShell` exactly once in every gate state with segments `[project.data?.name ?? projectId, graph.data?.initiative.name ?? initiativeId, "Graph"]`. Its child is the gate's `AsyncBoundary` or `ScopeMismatch`; when the gate is null, its child is the W4 workspace containing `<GraphCanvas model={model} onSelectTask={() => undefined} />`. Story 03 replaces this no-op with selection state.
- Append graph-only CSS to `ui/src/index.css` for canvas sizing, lane scrolling, handles, and React Flow variables. Every colour value must reference the existing role CSS variables; do not copy React Flow palette literals.

## Constraints

- The canvas is read-only. Selection is the only node interaction owned here.
- Do not register routes in this story; Story 07 owns both graph routes.
- Do not add counts, critical-path state, inspector content, graph polling, minimap, or graph writes.

## Verify

- `npm run test --workspace ui -- src/components/graph-canvas.test.tsx` — create this file. Stub `ResizeObserver`, element dimensions, `useNodesInitialized`, and `fitView`. Assert API lane order, task parent assignment, exact coordinates/constants, repository selectors, node role precedence, `smoothstep` edges with exact `data-edge-from` and `data-edge-to`, and every read-only React Flow prop. Click a task and assert one callback.
- In that file, assert `layout-ready` is absent before measurement, remains absent while `fitView` is pending, and appears only after the promise resolves. Replace the model and assert it resets. Assert the empty model reaches ready after `onInit` and resolved `fitView`.
- `npm run test --workspace ui -- src/pages/initiative-graph.test.tsx` — create this file with mocked API helpers and a fresh QueryClient. Assert exact graph/repository/project keys and paths are requested. Add one case for each pinned gate branch: pending ancestor, graph 404, project 404, first transport error, and `graph.projectId !== projectId` with the exact corrective href. Assert the pinned `what` text and exactly one ProjectShell in every branch. In resolved state assert one canvas and no form or graph mutation control.
- `npm run verify` exits 0.
- Proof: phase C waits for `layout-ready`, sees exactly two objective lanes and three non-zero task nodes inside their lane boxes, then reads the repository chip on lane one and `lane-no-repository` on lane two; phase D sees one rendered edge per API edge.
